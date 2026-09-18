import type { IncomingHttpHeaders } from "node:http";

export const REE_ESIOS_PRIVATE_DEFAULT_URL = "https://participa.esios.ree.es/ServicioSM/ServiceEME";
export const REE_ESIOS_PRIVATE_LQ_DEFAULT_URL = "https://participa.esios.ree.es/ServicioLQ/ServiceEME";
export const REE_ESIOS_SOAP12_NAMESPACE = "http://www.w3.org/2003/05/soap-envelope";
export const REE_ESIOS_MESSAGE_NAMESPACE = "http://iec.ch/TC57/2011/schema/message";
export const REE_ESIOS_COMMON_MESSAGE_NAMESPACE = "urn:iec62325.504:messages:1:0";

export type ReeEsiosPrivateConfig = {
  enabled: boolean;
  endpoint: string;
  p12Path?: string;
  p12Base64?: string;
  p12Password?: string;
  timeoutMs: number;
  rejectUnauthorized: boolean;
};

export type ReeEsiosPrivateResponse = {
  statusCode: number;
  statusMessage: string;
  headers: IncomingHttpHeaders;
  body: string;
  rawBody: Buffer;
};

export type ReeEsiosMessageMetadata = {
  code: string;
  messageId: string;
  version: number | null;
  status: string | null;
  messageType: string | null;
  owner: string | null;
  applicationStart: string | null;
  applicationEnd: string | null;
  messageDate: string | null;
  applicationDate: string | null;
  filename: string | null;
};

export type ReeEsiosListMessagesOptions = {
  date?: string;
  startTime?: string;
  endTime?: string;
  intervalType?: "Application" | "Server";
  messageType?: string;
  messageIdentification?: string;
  owner?: string;
  code?: string;
  endpoint?: string;
};

export type ReeEsiosDownloadOptions = {
  code?: string;
  messageIdentification?: string;
  messageVersion?: string;
  endpoint?: string;
};

export type ReeEsiosWsdlInfo = {
  ok: boolean;
  statusCode?: number;
  operations: string[];
  endpoints: string[];
  namespaces: { prefix: string; uri: string }[];
  error?: string;
};
