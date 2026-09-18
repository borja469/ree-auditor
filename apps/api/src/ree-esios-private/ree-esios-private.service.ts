import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ReeEsiosPrivateClientService } from "./ree-esios-private-client.service";
import { ReeEsiosPrivateParserService } from "./ree-esios-private-parser.service";
import type { ReeEsiosDownloadOptions, ReeEsiosListMessagesOptions } from "./types/ree-esios-private.types";

@Injectable()
export class ReeEsiosPrivateService {
  constructor(
    private readonly client: ReeEsiosPrivateClientService,
    private readonly parser: ReeEsiosPrivateParserService
  ) {}

  async diagnostics() {
    const config = this.client.getConnectionSummary();
    const result: Record<string, unknown> = {
      config,
      certificateLoaded: false,
      tlsHandshake: { ok: false },
      wsdl: { ok: false, operations: [] },
      errors: [] as string[]
    };

    try {
      result.certificateLoaded = this.client.getCertificateInfo().loaded;
    } catch (error) {
      (result.errors as string[]).push(sanitizeError(error));
    }

    if (!config.enabled) {
      return result;
    }

    try {
      result.tlsHandshake = await this.client.testHandshake();
    } catch (error) {
      (result.errors as string[]).push(sanitizeError(error));
    }

    try {
      const wsdlResponse = await this.client.getWsdl();
      const wsdl = this.parser.parseWsdl(wsdlResponse.body);
      result.wsdl = { ...wsdl, statusCode: wsdlResponse.statusCode };
    } catch (error) {
      (result.errors as string[]).push(sanitizeError(error));
    }

    return result;
  }

  async listMessages(options: ReeEsiosListMessagesOptions) {
    validateListOptions(options);
    try {
      const response = await this.client.listMessages(options);
      const messages = this.parser.parseMessageList(response.body);
      return {
        query: normalizeListOptions(options),
        count: messages.length,
        messages
      };
    } catch (error) {
      throw toHttpError(error, "Error consultando mensajes REE/eSIOS.");
    }
  }

  async downloadMessage(id: string, options: { version?: string } = {}) {
    const downloadOptions = buildDownloadOptions(id, options.version);
    try {
      const response = await this.client.downloadMessage(downloadOptions);
      const xml = this.parser.extractPayloadXml(response.body);
      if (!xml.trim()) {
        throw new NotFoundException("Mensaje REE/eSIOS sin payload XML.");
      }

      return {
        request: downloadOptions,
        contentType: "application/xml",
        bytes: Buffer.byteLength(xml, "utf8"),
        p48: xml.includes("<P48 ") ? this.parser.parseP48Summary(xml) : null,
        xml
      };
    } catch (error) {
      throw toHttpError(error, "Error descargando mensaje REE/eSIOS.");
    }
  }
}

function validateListOptions(options: ReeEsiosListMessagesOptions) {
  if (options.date && !/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new BadRequestException("date debe tener formato YYYY-MM-DD.");
  }
  if ((options.startTime && !options.endTime) || (!options.startTime && options.endTime)) {
    throw new BadRequestException("startTime y endTime deben informarse juntos.");
  }
  if (options.intervalType && options.intervalType !== "Application" && options.intervalType !== "Server") {
    throw new BadRequestException("intervalType debe ser Application o Server.");
  }
}

function normalizeListOptions(options: ReeEsiosListMessagesOptions) {
  return {
    date: options.date ?? null,
    startTime: options.startTime ?? null,
    endTime: options.endTime ?? null,
    intervalType: options.intervalType ?? "Application",
    messageType: options.messageType ?? null,
    messageIdentification: options.messageIdentification ?? null,
    owner: options.owner ?? null,
    code: options.code ?? null
  };
}

function buildDownloadOptions(id: string, version?: string): ReeEsiosDownloadOptions {
  const normalizedId = id.trim();
  if (!normalizedId) {
    throw new BadRequestException("Identificador de mensaje no valido.");
  }
  if (/^\d+$/.test(normalizedId)) {
    return { code: normalizedId };
  }
  return { messageIdentification: normalizedId, messageVersion: version };
}

function toHttpError(error: unknown, fallback: string) {
  if (error instanceof BadRequestException || error instanceof NotFoundException) {
    return error;
  }
  return new BadGatewayException(`${fallback} ${sanitizeError(error)}`);
}

function sanitizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/[A-Za-z]:\\[^\s)]+/g, "[path]")
    .replace(/-----BEGIN[\s\S]*?-----END [^-]+-----/g, "[certificate]")
    .slice(0, 800);
}
