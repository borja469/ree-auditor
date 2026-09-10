export const MIBGAS_SOAP11_NAMESPACE = "http://schemas.xmlsoap.org/soap/envelope/";
export const MIBGAS_BUSINESS_NAMESPACE = "http://www.omie.es/Gas/Schemas";

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const XML_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9._-]*$/;

export class MibgasPrivateSoapBuilder {
  buildEnvelope(serviceName: string, xmlPayload?: string): string {
    const normalizedServiceName = normalizeServiceName(serviceName);
    const payload = xmlPayload?.trim();
    const serviceContent = payload ? `\n${indent(payload, 6)}\n    ` : "";

    return [
      XML_DECLARATION,
      `<soapenv:Envelope xmlns:soapenv="${MIBGAS_SOAP11_NAMESPACE}" xmlns:gas="${MIBGAS_BUSINESS_NAMESPACE}">`,
      "  <soapenv:Header/>",
      "  <soapenv:Body>",
      `    <gas:${normalizedServiceName}>${serviceContent}</gas:${normalizedServiceName}>`,
      "  </soapenv:Body>",
      "</soapenv:Envelope>"
    ].join("\n");
  }
}

function normalizeServiceName(serviceName: string) {
  const normalized = serviceName.trim();
  if (!XML_NAME_PATTERN.test(normalized)) {
    throw new MibgasPrivateSoapBuilderError(`Nombre de servicio MIBGAS no valido: ${serviceName}`);
  }

  return normalized;
}

function indent(value: string, spaces: number) {
  const prefix = " ".repeat(spaces);
  return value
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `${prefix}${line}` : line))
    .join("\n");
}

export class MibgasPrivateSoapBuilderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MibgasPrivateSoapBuilderError";
  }
}
