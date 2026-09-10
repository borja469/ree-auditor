import { Injectable, Logger } from "@nestjs/common";
import { Agent, request as httpsRequest } from "node:https";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import type { IncomingHttpHeaders } from "node:http";
import { loadOmiePkcs12Identity } from "../omie-siom2/certificates/omie-pkcs12-loader";
import {
  extractMibgasPayloadXml,
  findMibgasPayloadRootName,
  parseMibgasDirectory,
  parseMibgasQueryConfiguration,
  parseMibgasUserData,
  xmlToJson
} from "./mibgas-private.parser";
import { MibgasPrivateSoapBuilder } from "./mibgas-private-soap.builder";
import type {
  MibgasDirectoryEntry,
  MibgasPrivateConnectionConfig,
  MibgasPrivateParsedResponse,
  MibgasPrivateResponse,
  MibgasQueryConfigurationResult,
  MibgasQueryParameter,
  MibgasUserData
} from "./mibgas-private.types";

export const MIBGAS_PREPROD_ENDPOINT = "https://www.preprod.market.mibgas.es/jsiom/webServices/SIOMServiceRouter";
export const MIBGAS_PROD_ENDPOINT = "https://www.market.mibgas.es/jsiom/webServices/SIOMServiceRouter";

export const MIBGAS_SERVICE_DATOS_USUARIO = "ServicioConsultaDatosUsuario";
export const MIBGAS_SERVICE_DIRECTORIO = "ServicioConsultaDirectorioConsultas";
export const MIBGAS_SERVICE_CONFIGURACION = "ServicioConsultaConfiguracionConsulta";
export const MIBGAS_SERVICE_ENCOLUMNADA = "ServicioEjecucionConsultaEncolumnada";
export const MIBGAS_SERVICE_RESULTADOS = "ServicioEjecucionConsultaResultados";

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

@Injectable()
export class MibgasPrivateClientService {
  private readonly logger = new Logger(MibgasPrivateClientService.name);
  private agent?: Agent;
  private agentCacheKey?: string;

  constructor(private readonly soapBuilder: MibgasPrivateSoapBuilder) {}

  readConfig(): MibgasPrivateConnectionConfig {
    const environment = parseEnvironment(process.env.MIBGAS_PRIVATE_ENVIRONMENT);
    return {
      environment,
      endpoint: nonEmpty(process.env.MIBGAS_PRIVATE_ENDPOINT) ?? defaultEndpoint(environment),
      p12Path: nonEmpty(process.env.MIBGAS_PRIVATE_P12_PATH),
      p12Base64: nonEmpty(process.env.MIBGAS_PRIVATE_P12_BASE64),
      p12Passphrase: process.env.MIBGAS_PRIVATE_P12_PASSPHRASE,
      rejectUnauthorized: process.env.MIBGAS_PRIVATE_REJECT_UNAUTHORIZED?.toLowerCase() !== "false",
      timeoutMs: positiveInteger(process.env.MIBGAS_PRIVATE_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS
    };
  }

  getConnectionSummary() {
    const config = this.readConfig();
    return {
      environment: config.environment,
      endpoint: config.endpoint,
      timeoutMs: config.timeoutMs,
      certificateConfigured: Boolean(config.p12Path || config.p12Base64),
      certificateSource: config.p12Base64 ? "base64" : config.p12Path ? "path" : null,
      rejectUnauthorized: config.rejectUnauthorized
    };
  }

  async consultaDatosUsuario(): Promise<MibgasPrivateParsedResponse & { userData: MibgasUserData }> {
    const response = await this.invokeParsed(MIBGAS_SERVICE_DATOS_USUARIO);
    return { ...response, userData: parseMibgasUserData(response.xml) };
  }

  async consultaDirectorioConsultas(): Promise<MibgasPrivateParsedResponse & { entries: MibgasDirectoryEntry[] }> {
    const response = await this.invokeParsed(MIBGAS_SERVICE_DIRECTORIO);
    return { ...response, entries: parseMibgasDirectory(response.xml) };
  }

  async consultaConfiguracionConsulta(codigoConsulta: string): Promise<MibgasPrivateParsedResponse & { configuration: MibgasQueryConfigurationResult }> {
    const response = await this.invokeParsed(MIBGAS_SERVICE_CONFIGURACION, buildCodConsultaPayload(codigoConsulta));
    return { ...response, configuration: parseMibgasQueryConfiguration(response.xml) };
  }

  async ejecutarConsultaResultados(
    codigoConsulta: string,
    parametros: Record<string, string>,
    parameterDefinitions: MibgasQueryParameter[] = []
  ): Promise<MibgasPrivateParsedResponse> {
    return this.invokeParsed(MIBGAS_SERVICE_RESULTADOS, buildEjecucionConsultaPayload(codigoConsulta, parametros, parameterDefinitions));
  }

  async ejecutarConsultaEncolumnada(
    codigoConsulta: string,
    parametros: Record<string, string>,
    parameterDefinitions: MibgasQueryParameter[] = []
  ): Promise<MibgasPrivateParsedResponse> {
    return this.invokeParsed(MIBGAS_SERVICE_ENCOLUMNADA, buildEjecucionConsultaPayload(codigoConsulta, parametros, parameterDefinitions));
  }

  async invokeParsed(serviceName: string, xmlPayload?: string): Promise<MibgasPrivateParsedResponse> {
    const raw = await this.invokeRaw(serviceName, xmlPayload);
    const payloadXml = extractMibgasPayloadXml(raw.body);
    return {
      statusCode: raw.statusCode,
      serviceName,
      xml: payloadXml,
      payloadRootName: findMibgasPayloadRootName(payloadXml),
      json: xmlToJson(payloadXml)
    };
  }

  async invokeRaw(serviceName: string, xmlPayload?: string): Promise<MibgasPrivateResponse> {
    const envelope = this.soapBuilder.buildEnvelope(serviceName, xmlPayload);
    return this.request(envelope, serviceName);
  }

  getCertificateInfo() {
    const config = this.readConfig();
    const p12Buffer = this.loadPkcs12(config);
    const identity = loadOmiePkcs12Identity(p12Buffer, config.p12Passphrase ?? "");
    return {
      ok: true,
      selectedCertificate: identity.selectedCertificate,
      certificates: identity.certificates
    };
  }

  private async request(body: string, serviceName: string): Promise<MibgasPrivateResponse> {
    const config = this.readConfig();
    const url = new URL(config.endpoint);
    const bodyBuffer = Buffer.from(body, "utf8");
    const startedAt = Date.now();
    this.logger.log(`MIBGAS private SOAP request: service=${serviceName} environment=${config.environment} host=${url.host}.`);

    const response = await new Promise<MibgasPrivateResponse>((resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          method: "POST",
          agent: this.getAgent(config),
          timeout: config.timeoutMs,
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            SOAPAction: "",
            "Content-Length": bodyBuffer.byteLength
          }
        },
        (res) => {
          const chunks: Buffer[] = [];
          let totalBytes = 0;
          res.on("data", (chunk: Buffer) => {
            totalBytes += chunk.byteLength;
            if (totalBytes > DEFAULT_MAX_RESPONSE_BYTES) {
              req.destroy(new MibgasPrivateConnectionError(`Respuesta MIBGAS demasiado grande: ${totalBytes} bytes.`));
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            const rawBody = Buffer.concat(chunks);
            resolve({
              statusCode: res.statusCode ?? 0,
              statusMessage: res.statusMessage ?? "",
              headers: res.headers,
              body: rawBody.toString("utf8"),
              rawBody
            });
          });
        }
      );
      req.on("timeout", () => req.destroy(new MibgasPrivateConnectionError(`Timeout conectando con MIBGAS tras ${config.timeoutMs}ms.`)));
      req.on("error", reject);
      req.write(bodyBuffer);
      req.end();
    });

    this.logger.log(
      `MIBGAS private SOAP response: service=${serviceName} status=${response.statusCode} bytes=${response.rawBody.byteLength} durationMs=${Date.now() - startedAt}.`
    );
    if (response.statusCode >= 400) {
      throw new MibgasPrivateConnectionError(`MIBGAS respondio HTTP ${response.statusCode}: ${response.statusMessage}. ${response.body.slice(0, 500)}`);
    }
    return {
      ...response,
      headers: normalizeResponseHeaders(response.headers)
    };
  }

  private getAgent(config: MibgasPrivateConnectionConfig) {
    const cacheKey = `${config.environment}|${config.endpoint}|${config.p12Path ?? ""}|${hashBase64Config(config.p12Base64)}|${config.rejectUnauthorized}`;
    if (!this.agent || this.agentCacheKey !== cacheKey) {
      const p12Buffer = this.loadPkcs12(config);
      const identity = loadOmiePkcs12Identity(p12Buffer, config.p12Passphrase ?? "");
      this.agent = new Agent({
        cert: identity.certificatePem,
        key: identity.privateKeyPem,
        ca: identity.caPem.length > 0 ? identity.caPem : undefined,
        rejectUnauthorized: config.rejectUnauthorized,
        keepAlive: true
      });
      this.agentCacheKey = cacheKey;
    }
    return this.agent;
  }

  private loadPkcs12(config: MibgasPrivateConnectionConfig) {
    if (config.p12Base64) {
      const buffer = Buffer.from(config.p12Base64, "base64");
      if (buffer.length === 0) {
        throw new MibgasPrivateConnectionError("MIBGAS_PRIVATE_P12_BASE64 esta configurado pero esta vacio.");
      }
      return buffer;
    }
    if (config.p12Path) {
      try {
        return readFileSync(config.p12Path);
      } catch (error) {
        throw new MibgasPrivateConnectionError(
          `No se pudo leer el certificado MIBGAS_PRIVATE_P12_PATH (${config.p12Path}): ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    throw new MibgasPrivateConnectionError("Falta certificado MIBGAS. Configura MIBGAS_PRIVATE_P12_PATH o MIBGAS_PRIVATE_P12_BASE64.");
  }
}

export function buildCodConsultaPayload(codigoConsulta: string) {
  return `<CodConsulta v="${escapeXmlAttribute(normalizeCodigoConsulta(codigoConsulta))}"/>`;
}

export function buildEjecucionConsultaPayload(codigoConsulta: string, parametros: Record<string, string>, definitions: MibgasQueryParameter[] = []) {
  const entries = Object.entries(parametros).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");
  const paramsXml = entries.map(([name, value]) => {
    const tag = resolveParameterTag(name, value, definitions);
    return `<${tag} n="${escapeXmlAttribute(name)}" v="${escapeXmlAttribute(String(value))}"/>`;
  });

  return [
    `<MensajeEjecucionConsulta xmlns="http://www.omie.es/Gas/Schemas">`,
    `  <CodConsulta v="${escapeXmlAttribute(normalizeCodigoConsulta(codigoConsulta))}"/>`,
    paramsXml.length > 0 ? "  <Parametros>" : "",
    ...paramsXml.map((line) => `    ${line}`),
    paramsXml.length > 0 ? "  </Parametros>" : "",
    `</MensajeEjecucionConsulta>`
  ].filter(Boolean).join("\n");
}

function resolveParameterTag(name: string, value: string, definitions: MibgasQueryParameter[]) {
  const match = definitions.find((parameter) => parameter.name?.toLowerCase() === name.toLowerCase());
  const type = match?.type?.trim();
  if (type && ["Txt", "Num", "Fec", "Feh", "Hor"].includes(type)) {
    return type;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "Fec";
  }
  if (/^-?\d+(?:[.,]\d+)?$/.test(value)) {
    return "Num";
  }
  return "Txt";
}

function normalizeCodigoConsulta(codigoConsulta: string) {
  const normalized = codigoConsulta.trim();
  if (!/^\d{1,6}$/.test(normalized)) {
    throw new MibgasPrivateConnectionError(`Codigo de consulta MIBGAS no valido: ${codigoConsulta}`);
  }
  return normalized;
}

function parseEnvironment(value: string | undefined) {
  const normalized = value?.trim().toUpperCase();
  return normalized === "PROD" || normalized === "PRODUCCION" || normalized === "PRODUCCION_REAL" ? "PROD" : "PREPROD";
}

function defaultEndpoint(environment: "PREPROD" | "PROD") {
  return environment === "PROD" ? MIBGAS_PROD_ENDPOINT : MIBGAS_PREPROD_ENDPOINT;
}

function nonEmpty(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function positiveInteger(value: string | undefined) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeResponseHeaders(headers: IncomingHttpHeaders) {
  return headers;
}

function escapeXmlAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function hashBase64Config(value: string | undefined) {
  return value ? `${value.length}:${value.slice(0, 12)}` : "";
}

export class MibgasPrivateConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MibgasPrivateConnectionError";
  }
}
