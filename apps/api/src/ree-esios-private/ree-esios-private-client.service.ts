import { Injectable, Logger } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { Agent, request as httpsRequest } from "node:https";
import { URL } from "node:url";
import { loadOmiePkcs12Identity } from "../omie-siom2/certificates/omie-pkcs12-loader";
import {
  REE_ESIOS_MESSAGE_NAMESPACE,
  REE_ESIOS_PRIVATE_DEFAULT_URL,
  REE_ESIOS_PRIVATE_LQ_DEFAULT_URL,
  REE_ESIOS_SOAP12_NAMESPACE,
  type ReeEsiosDownloadOptions,
  type ReeEsiosListMessagesOptions,
  type ReeEsiosPrivateConfig,
  type ReeEsiosPrivateResponse
} from "./types/ree-esios-private.types";

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RESPONSE_BYTES = 60 * 1024 * 1024;

@Injectable()
export class ReeEsiosPrivateClientService {
  private readonly logger = new Logger(ReeEsiosPrivateClientService.name);
  private agent?: Agent;
  private agentCacheKey?: string;

  readConfig(): ReeEsiosPrivateConfig {
    return {
      enabled: parseBoolean(process.env.REE_ESIOS_PRIVATE_ENABLED),
      endpoint: nonEmpty(process.env.REE_ESIOS_PRIVATE_URL) ?? REE_ESIOS_PRIVATE_DEFAULT_URL,
      p12Path: nonEmpty(process.env.REE_ESIOS_PRIVATE_P12_PATH) ?? nonEmpty(process.env.OMIE_SIOM2_P12_PATH),
      p12Base64: nonEmpty(process.env.REE_ESIOS_PRIVATE_P12_BASE64) ?? nonEmpty(process.env.OMIE_SIOM2_P12_BASE64),
      p12Password: process.env.REE_ESIOS_PRIVATE_P12_PASSWORD ?? process.env.OMIE_SIOM2_P12_PASSPHRASE,
      timeoutMs: positiveInteger(process.env.REE_ESIOS_PRIVATE_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS,
      rejectUnauthorized: process.env.REE_ESIOS_PRIVATE_REJECT_UNAUTHORIZED?.toLowerCase() !== "false"
    };
  }

  getConnectionSummary() {
    const config = this.readConfig();
    return {
      enabled: config.enabled,
      endpoint: config.endpoint,
      timeoutMs: config.timeoutMs,
      certificateConfigured: Boolean(config.p12Path || config.p12Base64),
      certificateSource: config.p12Base64 ? "base64" : config.p12Path ? "path" : null,
      rejectUnauthorized: config.rejectUnauthorized
    };
  }

  getCertificateInfo() {
    const config = this.readConfig();
    const identity = loadOmiePkcs12Identity(this.loadPkcs12(config), config.p12Password ?? "");
    return {
      loaded: true,
      selectedCertificate: identity.selectedCertificate,
      certificates: identity.certificates
    };
  }

  async getWsdl() {
    return this.request({ method: "GET", url: `${this.readConfig().endpoint}?wsdl`, traceLabel: "wsdl" });
  }

  async listMessages(options: ReeEsiosListMessagesOptions) {
    return this.request({
      method: "POST",
      body: buildSoapEnvelope("MessageList", buildRequestXml(options)),
      traceLabel: "get/MessageList",
      endpoint: options.endpoint
    });
  }

  async downloadMessage(options: ReeEsiosDownloadOptions) {
    return this.request({
      method: "POST",
      body: buildSoapEnvelope("Any", buildDownloadRequestXml(options)),
      traceLabel: "get/Any",
      endpoint: options.endpoint
    });
  }

  lqEndpoint() {
    return nonEmpty(process.env.REE_ESIOS_PRIVATE_LQ_URL) ?? this.readConfig().endpoint.replace("/ServicioSM/", "/ServicioLQ/") ?? REE_ESIOS_PRIVATE_LQ_DEFAULT_URL;
  }

  async testHandshake() {
    const response = await this.request({ method: "GET", url: this.readConfig().endpoint, traceLabel: "handshake", maxResponseBytes: 1024 * 1024 });
    return {
      ok: response.statusCode >= 200 && response.statusCode < 500,
      statusCode: response.statusCode,
      contentType: response.headers["content-type"] ?? null
    };
  }

  private async request(options: {
    method: "GET" | "POST";
    url?: string;
    body?: string;
    traceLabel: string;
    maxResponseBytes?: number;
    endpoint?: string;
  }): Promise<ReeEsiosPrivateResponse> {
    const config = { ...this.readConfig(), endpoint: options.endpoint ?? this.readConfig().endpoint };
    if (!config.enabled) {
      throw new ReeEsiosPrivateConnectionError("Integracion privada REE/eSIOS inactiva. Configura REE_ESIOS_PRIVATE_ENABLED=true.");
    }

    const url = new URL(options.url ?? config.endpoint);
    const body = options.body ? Buffer.from(options.body, "utf8") : undefined;
    const headers: Record<string, string | number> = {};
    if (body) {
      headers["Content-Type"] = "application/soap+xml; charset=utf-8";
      headers["Content-Length"] = body.byteLength;
    } else {
      headers.Accept = "text/xml, application/wsdl+xml, */*";
    }

    const attempts = [0, 1000, 3000];
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts.length; attempt += 1) {
      if (attempt > 1) {
        await delay(attempts[attempt - 1]);
      }
      try {
        this.logger.log(`REE/eSIOS private request: ${options.traceLabel} host=${url.host} attempt=${attempt}/${attempts.length}.`);
        return await this.executeOnce(url, options.method, headers, body, config, options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
      } catch (error) {
        lastError = error;
        if (attempt === attempts.length || !isRetriable(error)) {
          break;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new ReeEsiosPrivateConnectionError("Error conectando con REE/eSIOS.");
  }

  private executeOnce(
    url: URL,
    method: "GET" | "POST",
    headers: Record<string, string | number>,
    body: Buffer | undefined,
    config: ReeEsiosPrivateConfig,
    maxResponseBytes: number
  ) {
    return new Promise<ReeEsiosPrivateResponse>((resolve, reject) => {
      const req = httpsRequest(url, { method, agent: this.getAgent(config), timeout: config.timeoutMs, headers }, (res) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        res.on("data", (chunk: Buffer) => {
          totalBytes += chunk.byteLength;
          if (totalBytes > maxResponseBytes) {
            req.destroy(new ReeEsiosPrivateConnectionError(`Respuesta REE/eSIOS demasiado grande: supera ${maxResponseBytes} bytes.`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks);
          const response = {
            statusCode: res.statusCode ?? 0,
            statusMessage: res.statusMessage ?? "",
            headers: res.headers,
            body: rawBody.toString("utf8"),
            rawBody
          };
          if (response.statusCode >= 400) {
            reject(new ReeEsiosPrivateConnectionError(`REE/eSIOS respondio HTTP ${response.statusCode}: ${response.statusMessage}. ${response.body.slice(0, 500)}`));
            return;
          }
          resolve(response);
        });
      });
      req.on("timeout", () => req.destroy(new ReeEsiosPrivateConnectionError(`Timeout conectando con REE/eSIOS tras ${config.timeoutMs}ms.`)));
      req.on("error", reject);
      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  private getAgent(config: ReeEsiosPrivateConfig) {
    const cacheKey = `${config.endpoint}|${config.p12Path ?? ""}|${hashBase64Config(config.p12Base64)}|${config.rejectUnauthorized}`;
    if (!this.agent || this.agentCacheKey !== cacheKey) {
      const identity = loadOmiePkcs12Identity(this.loadPkcs12(config), config.p12Password ?? "");
      this.agent = new Agent({
        cert: identity.certificatePem,
        key: identity.privateKeyPem,
        minVersion: "TLSv1.2",
        keepAlive: true,
        rejectUnauthorized: config.rejectUnauthorized
      });
      this.agentCacheKey = cacheKey;
    }
    return this.agent;
  }

  private loadPkcs12(config: ReeEsiosPrivateConfig) {
    if (config.p12Base64) {
      const decoded = Buffer.from(config.p12Base64.replace(/^data:[^,]+,/, "").replace(/\s+/g, ""), "base64");
      if (decoded.byteLength === 0) {
        throw new ReeEsiosPrivateConnectionError("REE_ESIOS_PRIVATE_P12_BASE64 esta configurado pero esta vacio.");
      }
      return decoded;
    }
    if (config.p12Path) {
      try {
        return readFileSync(config.p12Path);
      } catch (error) {
        throw new ReeEsiosPrivateConnectionError(`No se pudo leer REE_ESIOS_PRIVATE_P12_PATH (${config.p12Path}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new ReeEsiosPrivateConnectionError("Falta certificado REE/eSIOS. Configura REE_ESIOS_PRIVATE_P12_PATH o REE_ESIOS_PRIVATE_P12_BASE64.");
  }
}

function buildSoapEnvelope(noun: "MessageList" | "Any", requestXml: string) {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<soap:Envelope xmlns:soap="${REE_ESIOS_SOAP12_NAMESPACE}">`,
    "  <soap:Body>",
    `    <RequestMessage xmlns="${REE_ESIOS_MESSAGE_NAMESPACE}" xmlns:ns2="urn:iec62325.504:messages:1:0">`,
    "      <Header>",
    "        <Verb>get</Verb>",
    `        <Noun>${noun}</Noun>`,
    `        <Timestamp>${new Date().toISOString()}</Timestamp>`,
    "        <Source>STROM</Source>",
    `        <MessageID>ree-auditor-${Date.now()}</MessageID>`,
    "      </Header>",
    requestXml,
    "    </RequestMessage>",
    "  </soap:Body>",
    "</soap:Envelope>"
  ].join("\n");
}

function buildRequestXml(options: ReeEsiosListMessagesOptions) {
  const { startTime, endTime } = resolveInterval(options);
  return [
    "      <Request>",
    `        <StartTime>${escapeXml(startTime)}</StartTime>`,
    `        <EndTime>${escapeXml(endTime)}</EndTime>`,
    ...buildOptions([
      ["IntervalType", options.intervalType ?? "Application"],
      ["MsgType", options.messageType],
      ["MessageIdentification", options.messageIdentification],
      ["Owner", options.owner],
      ["Code", options.code]
    ]),
    "      </Request>"
  ].join("\n");
}

function buildDownloadRequestXml(options: ReeEsiosDownloadOptions) {
  return [
    "      <Request>",
    ...buildOptions([
      ["Code", options.code],
      ["MessageIdentification", options.messageIdentification],
      ["MessageVersion", options.messageVersion]
    ]),
    "      </Request>"
  ].join("\n");
}

function buildOptions(entries: Array<[string, string | undefined | null]>) {
  return entries
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .flatMap(([name, value]) => [
      "        <Option>",
      `          <name>${escapeXml(name)}</name>`,
      `          <value>${escapeXml(String(value))}</value>`,
      "        </Option>"
    ]);
}

function resolveInterval(options: ReeEsiosListMessagesOptions) {
  if (options.startTime && options.endTime) {
    return { startTime: options.startTime, endTime: options.endTime };
  }
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  return {
    startTime: `${date}T00:00:00Z`,
    endTime: `${date}T23:59:59Z`
  };
}

function parseBoolean(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function positiveInteger(value: string | undefined) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nonEmpty(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hashBase64Config(value: string | undefined) {
  return value ? `${value.length}:${value.slice(0, 12)}` : "";
}

function isRetriable(error: unknown) {
  const code = (error as { code?: string } | undefined)?.code;
  return code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EAI_AGAIN";
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ReeEsiosPrivateConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReeEsiosPrivateConnectionError";
  }
}
