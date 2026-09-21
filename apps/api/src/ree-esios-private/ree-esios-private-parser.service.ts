import { Injectable } from "@nestjs/common";
import { gunzipSync } from "node:zlib";
import type { ReeEsiosMessageMetadata, ReeEsiosWsdlInfo } from "./types/ree-esios-private.types";

@Injectable()
export class ReeEsiosPrivateParserService {
  parseWsdl(xml: string): ReeEsiosWsdlInfo {
    return {
      ok: true,
      operations: unique([...xml.matchAll(/<(?:\w+:)?operation\b[^>]*\bname=["']([^"']+)["'][^>]*>/g)].map((match) => match[1])),
      endpoints: unique([...xml.matchAll(/<(?:\w+:)?address\b[^>]*\blocation=["']([^"']+)["'][^>]*>/g)].map((match) => match[1])),
      namespaces: uniqueBy(
        [...xml.matchAll(/\bxmlns(?::([^=\s]+))?=["']([^"']+)["']/g)].map((match) => ({ prefix: match[1] ?? "", uri: match[2] })),
        (item) => `${item.prefix}:${item.uri}`
      )
    };
  }

  parseMessageList(soapXml: string): ReeEsiosMessageMetadata[] {
    this.throwIfSoapFault(soapXml);
    const messages = soapXml.match(/<Message>[\s\S]*?<\/Message>/g) ?? [];
    return messages.map((message) => ({
      code: requiredText(message, "Code"),
      messageId: requiredText(message, "MessageIdentification"),
      version: integerOrNull(text(message, "MessageVersion")),
      status: text(message, "Status"),
      messageType: text(message, "Type"),
      owner: text(message, "Owner"),
      applicationStart: text(extractBlock(message, "ApplicationTimeInterval"), "start"),
      applicationEnd: text(extractBlock(message, "ApplicationTimeInterval"), "end"),
      messageDate: text(message, "ServerTimestamp"),
      applicationDate: deriveApplicationDate(text(extractBlock(message, "ApplicationTimeInterval"), "start")),
      filename: buildFilename(text(message, "MessageIdentification"), text(message, "MessageVersion"))
    }));
  }

  extractPayloadXml(soapXml: string) {
    this.throwIfSoapFault(soapXml);
    const compressed = text(soapXml, "Compressed");
    if (compressed) {
      return gunzipSync(Buffer.from(compressed.replace(/\s+/g, ""), "base64")).toString("utf8");
    }

    const payload = extractBlock(soapXml, "Payload");
    if (!payload) {
      return soapXml;
    }

    const payloadContent = payload.replace(/^<Payload[^>]*>/, "").replace(/<\/Payload>$/, "").trim();
    return payloadContent || soapXml;
  }

  extractPayloadBuffer(soapXml: string) {
    this.throwIfSoapFault(soapXml);
    const compressed = text(soapXml, "Compressed");
    if (compressed) {
      const payload = Buffer.from(compressed.replace(/\s+/g, ""), "base64");
      try {
        return gunzipSync(payload);
      } catch {
        return payload;
      }
    }

    const payload = extractBlock(soapXml, "Payload");
    return Buffer.from(payload ?? soapXml, "utf8");
  }

  parseP48Summary(xml: string) {
    return {
      IdentificacionMensaje: attr(xml, "IdentificacionMensaje"),
      VersionMensaje: attr(xml, "VersionMensaje"),
      TipoMensaje: attr(xml, "TipoMensaje"),
      TipoProceso: attr(xml, "TipoProceso"),
      TipoClasificacion: attr(xml, "TipoClasificacion"),
      IdentificacionRemitente: attr(xml, "IdentificacionRemitente"),
      IdentificacionDestinatario: attr(xml, "IdentificacionDestinatario"),
      Resolucion: attr(xml, "Resolucion"),
      hasSeriesTemporales: xml.includes("<SeriesTemporales>"),
      hasUPEntrada: xml.includes("<UPEntrada "),
      hasUPSalida: xml.includes("<UPSalida "),
      positions: summarizePositions(xml)
    };
  }

  throwIfSoapFault(soapXml: string) {
    if (!/<(?:\w+:)?Fault\b/.test(soapXml) && !/<FaultMessage\b/.test(soapXml)) {
      return;
    }
    throw new ReeEsiosPrivateSoapFaultError(text(soapXml, "Reason") ?? text(soapXml, "faultstring") ?? text(soapXml, "Result") ?? "SOAP Fault REE/eSIOS");
  }
}

function text(xml: string | null, tag: string) {
  if (!xml) {
    return null;
  }
  const match = xml.match(new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`));
  return match?.[1]?.trim() || null;
}

function requiredText(xml: string, tag: string) {
  const value = text(xml, tag);
  if (!value) {
    throw new ReeEsiosPrivateParserError(`Respuesta REE/eSIOS sin ${tag}.`);
  }
  return value;
}

function extractBlock(xml: string, tag: string) {
  return xml.match(new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>[\\s\\S]*?</(?:\\w+:)?${tag}>`))?.[0] ?? null;
}

function attr(xml: string, tag: string, name = "v") {
  return xml.match(new RegExp(`<${tag}\\s+[^>]*${name}="([^"]*)"`))?.[1] ?? null;
}

function integerOrNull(value: string | null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function deriveApplicationDate(value: string | null) {
  return value?.slice(0, 10) ?? null;
}

function buildFilename(messageId: string | null, version: string | null) {
  if (!messageId) {
    return null;
  }
  return version ? `${messageId}.${version}.xml` : `${messageId}.xml`;
}

function summarizePositions(xml: string) {
  const positions = new Set<number>();
  let min: number | null = null;
  let max: number | null = null;
  for (const match of xml.matchAll(/<Pos v="(\d+)"\/>/g)) {
    const position = Number(match[1]);
    positions.add(position);
    min = min === null ? position : Math.min(min, position);
    max = max === null ? position : Math.max(max, position);
  }
  return { min, max, count: positions.size };
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueBy<T>(values: T[], keyFn: (item: T) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = keyFn(value);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export class ReeEsiosPrivateParserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReeEsiosPrivateParserError";
  }
}

export class ReeEsiosPrivateSoapFaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReeEsiosPrivateSoapFaultError";
  }
}
