import { Prisma } from "@prisma/client";

export const ESIOS_DEFAULT_API_URL = "https://api.esios.ree.es";
export const ESIOS_DEFAULT_INDICATORS = [
  { indicatorId: 460, name: "Demanda prevista peninsular" },
  { indicatorId: 541, name: "Previsión eólica" },
  { indicatorId: 542, name: "Solar fotovoltaica" },
  { indicatorId: 543, name: "Solar térmica" }
] as const;
export const ESIOS_DEFAULT_INDICATOR_ID = ESIOS_DEFAULT_INDICATORS[0].indicatorId;
export const ESIOS_DEFAULT_INDICATOR_NAME = ESIOS_DEFAULT_INDICATORS[0].name;

export type EsiosConfigDto = {
  apiUrl: string;
  tokenConfigured: boolean;
  timeoutSeconds: number;
  retries: number;
  active: boolean;
};

export type EsiosConfigInput = {
  apiUrl?: string;
  apiToken?: string;
  timeoutSeconds?: number;
  retries?: number;
  active?: boolean;
};

export type EsiosConnectionStatus = "ok" | "invalid_token" | "network_error" | "api_error" | "inactive";

export type EsiosConnectionResult = {
  status: EsiosConnectionStatus;
  message: string;
  statusCode?: number;
};

export type EsiosIndicatorCatalogItem = {
  indicatorId: number;
  name: string | null;
  description: string | null;
  shortName: string | null;
  unit: string | null;
  frequency: string | null;
  active: boolean;
};

export type EsiosIndicatorValueInput = {
  indicatorId: number;
  datetime: Date;
  datetimeUtc: Date | null;
  value: Prisma.Decimal | null;
  geoId: number | null;
  geoName: string | null;
};

export type EsiosDownloadSummary = {
  indicatorId: number;
  startDate: string;
  endDate: string;
  downloadedRecords: number;
  insertedRecords: number;
  updatedRecords: number;
  executionTimeMs: number;
  status: "SUCCESS" | "ERROR";
  errorMessage: string | null;
};

export type EsiosValuesQuery = {
  fechaDesde?: string;
  fechaHasta?: string;
  year?: number;
  month?: number;
  skip?: number;
  take?: number;
};

export type EsiosProfileTariff = "2.0TD" | "3.0TD" | "3.0TDVE";

export type EsiosProfileIntermediateRow = {
  id: string;
  year: number;
  datetime: string;
  month: number;
  day: number;
  hour: number;
  tariff: EsiosProfileTariff;
  initialProfile: number;
  h0: number;
  h1: number;
  hf: number;
  c0: number;
  c1: number;
  cf: number;
  m0: number;
  m1: number;
  intermediateProfile: number;
  demandUsedMw: number;
  demandSource: "REE_DEMR" | "FINAL_1335" | "FORECAST_460" | "REFERENCE_REE";
  referenceDemandMw: number;
  forecastDemandMw: number | null;
  finalDemandMw: number | null;
  systemDemandMw?: number | null;
  reeFinalProfile?: number | null;
  finalProfileDifference?: number | null;
  finalProfileValidationStatus?: "VALIDADO" | "DIFERENTE" | "SIN_PERFF";
  calculatedIntermediateProfile?: number;
  profileValidationDifference?: number;
  profileValidationStatus?: "VALIDADO" | "DIFERENTE";
  validationStatus?: "VALIDADO" | "DIFERENTE" | "SIN_PERFF";
  createdAt: string;
  updatedAt: string;
};

export type EsiosProfileIntermediateLog = {
  id: string;
  year: number;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  executionTimeMs: number | null;
  rowsProcessed: number;
  errorMessage: string | null;
  createdAt: string;
};

export type EsiosProfileIntermediateSummary = {
  year: number;
  expectedHours: number;
  calculatedHours: number;
  calculatedTariffs: number;
  status: string;
  latestCalculation: EsiosProfileIntermediateLog | null;
  sumIntermediateProfiles: Record<EsiosProfileTariff, number | null>;
  totalDemandUsedMw: number | null;
  totalForecastDemandMw: number | null;
  totalFinalDemandMw: number | null;
  totalReferenceDemandMw: number | null;
  finalDemandValidation?: {
    loadedHours: number;
    matchedHours: number;
    mismatchedHours: number;
    pendingHours: number;
    toleranceMw: number;
  };
  finalProfileValidation?: {
    loadedHours: number;
    matchedRows: number;
    mismatchedRows: number;
    pendingRows: number;
    tolerance: number;
  };
  profileValidation?: {
    matchedRows: number;
    mismatchedRows: number;
    tolerance: number;
  };
};

export type EsiosProfileIntermediatesResponse = {
  rows: EsiosProfileIntermediateRow[];
  total: number;
  hasNext: boolean;
  filters: EsiosValuesQuery & { year: number };
};

export type EsiosProfileCalculationLogsResponse = {
  total: number;
  hasNext: boolean;
  logs: EsiosProfileIntermediateLog[];
};
