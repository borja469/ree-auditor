import type { IncomingHttpHeaders } from "node:http";
import type { MibgasPrivateDownloadStatus, MibgasPrivateEnvironment, MibgasPrivateQueryKind, Prisma } from "@prisma/client";

export type MibgasPrivateConnectionConfig = {
  environment: MibgasPrivateEnvironment;
  endpoint: string;
  p12Path?: string;
  p12Base64?: string;
  p12Passphrase?: string;
  rejectUnauthorized: boolean;
  timeoutMs: number;
};

export type MibgasPrivateResponse = {
  statusCode: number;
  statusMessage: string;
  headers: IncomingHttpHeaders;
  body: string;
  rawBody: Buffer;
};

export type MibgasPrivateParsedResponse = {
  statusCode: number;
  serviceName: string;
  xml: string;
  payloadRootName: string | null;
  json: Prisma.JsonValue;
};

export type MibgasUserData = {
  agentCode: string | null;
  agentDescription: string | null;
  agentProfile: string | null;
  certificateCode: string | null;
  registryProfile: string | null;
  tradingProfile: string | null;
  holderName: string | null;
  holderSurnames: string | null;
  holderEmail: string | null;
  validFrom: string | null;
  validTo: string | null;
};

export type MibgasDirectoryEntry = {
  queryCode: string;
  title: string | null;
  section: string | null;
  queryType: string | null;
  rawPayloadJson: Prisma.InputJsonObject;
};

export type MibgasQueryParameter = {
  type: string;
  name: string | null;
  description: string | null;
  length: string | null;
  wildcard: string | null;
  values: Array<{
    code: string | null;
    description: string | null;
    attributes: Record<string, string>;
  }>;
  attributes: Record<string, string>;
};

export type MibgasQueryColumn = {
  type: string;
  name: string | null;
  description: string | null;
  length: string | null;
  aggregated: string | null;
  xmlTag: string | null;
  attributes: Record<string, string>;
};

export type MibgasQueryConfigurationResult = {
  queryCode: string | null;
  title: string | null;
  section: string | null;
  queryType: string | null;
  parameters: MibgasQueryParameter[];
  columns: MibgasQueryColumn[];
  rawPayloadJson: Prisma.InputJsonObject;
};

export type MibgasMarketMessageHeader = {
  messageId: string | null;
  messageVersion: string | null;
  messageDatetime: string | null;
  tradingDay: string | null;
  senderId: string | null;
  receiverId: string | null;
};

export type MibgasParsedTransaction = MibgasMarketMessageHeader & {
  contractId: string;
  messageScope: string | null;
  marketParticipantId: string | null;
  portfolioId: string | null;
  contractType: string | null;
  auctionNumber: string | null;
  orderId: string | null;
  transactionId: string;
  buySellIndicator: string | null;
  price: string | null;
  quantity: string | null;
  transactionDatetime: string | null;
  rawPayloadJson: Prisma.InputJsonObject;
};

export type MibgasParsedAnnotation = MibgasMarketMessageHeader & {
  contractId: string;
  messageScope: string | null;
  marketParticipantId: string | null;
  portfolioId: string | null;
  registryAccountId: string | null;
  clearingAccountId: string | null;
  contractType: string | null;
  auctionNumber: string | null;
  annotationId: string;
  annotationType: string | null;
  orderId: string | null;
  transactionId: string | null;
  firstGasDay: string | null;
  lastGasDay: string | null;
  buySellIndicator: string | null;
  price: string | null;
  quantity: string | null;
  quantitySign: string | null;
  delivery: string | null;
  amount: string | null;
  amountSign: string | null;
  taxAmount: string | null;
  taxAmountSign: string | null;
  rawPayloadJson: Prisma.InputJsonObject;
};

export type MibgasParsedNetPosition = {
  rowKey: string;
  tradingDay: string | null;
  installation: string | null;
  portfolioId: string | null;
  productId: string | null;
  segmentId: string | null;
  saleQuantity: string | null;
  purchaseQuantity: string | null;
  netQuantity: string | null;
  isTotal: boolean;
  rawPayloadJson: Prisma.InputJsonObject;
};

export type MibgasPrivateDownloadRow = {
  id: string;
  environment: MibgasPrivateEnvironment;
  queryKind: MibgasPrivateQueryKind;
  queryCode: string | null;
  queryTitle: string | null;
  sessionDate: string | null;
  parametersJson: Prisma.JsonValue;
  status: MibgasPrivateDownloadStatus;
  records: number;
  durationMs: number | null;
  publishedAt: string | null;
  executedBy: string;
  contentHash: string | null;
  fileName: string | null;
  errorMessage: string | null;
  rawXmlAvailable: boolean;
  rawJsonAvailable: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MibgasPrivateDownloadDetail = MibgasPrivateDownloadRow & {
  rawXml: string | null;
  rawJson: Prisma.JsonValue | null;
};
