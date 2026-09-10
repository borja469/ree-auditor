export type GasMibgasSyncRunType = "MANUAL" | "AUTO" | "HISTORICAL";
export type GasMibgasSyncStatus = "STARTED" | "SUCCESS" | "PARTIAL" | "ERROR";

export type GasMibgasDownloadResult = {
  year: number;
  url: string;
  filename: string;
  content: Buffer;
  contentType: string | null;
  contentLength: number;
};

export type ParsedGasMibgasRow = {
  tradingDay: Date;
  product: string;
  placeOfDelivery: string;
  area: string;
  firstDayDelivery: Date;
  lastDayDelivery: Date;
  priceEurMwh: string | null;
  sourceYear: number;
  sourceFilename: string;
  sourceEmissionDatetime: Date | null;
  deliveryPeriodLabel: string | null;
  rawPayloadJson: Record<string, string | null>;
};

export type GasMibgasParseError = {
  row: number;
  message: string;
};

export type GasMibgasParsedFile = {
  year: number;
  filename: string;
  sourceEmissionDatetime: Date | null;
  rows: ParsedGasMibgasRow[];
  errors: GasMibgasParseError[];
};

export type GasMibgasSyncResponse = {
  runId: string;
  year: number;
  runType: GasMibgasSyncRunType;
  status: GasMibgasSyncStatus;
  url: string | null;
  sourceFilename: string | null;
  sourceEmissionDatetime: string | null;
  rowsRead: number;
  inserted: number;
  updated: number;
  unchanged: number;
  nullPrices: number;
  errors: GasMibgasParseError[];
  errorMessage: string | null;
};

export type GasMibgasQuery = {
  tradingDayFrom?: string;
  tradingDayTo?: string;
  deliveryFrom?: string;
  deliveryTo?: string;
  product?: string[];
  placeOfDelivery?: string[];
  area?: string[];
  skip: number;
  take: number;
};
