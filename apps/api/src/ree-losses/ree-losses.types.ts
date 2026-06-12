import { Prisma, ReeKFactorFileType, ReeSettlementVersion } from "@prisma/client";
import { PeriodRule } from "./period-engine";

export type ImportResultStatus = "IMPORTED" | "FAILED";
export type ImportableFile = Pick<Express.Multer.File, "originalname" | "buffer" | "size">;
export type CacheEntry<T> = { value: T; expiresAt: number };
export type DistinctTextOptionRow = { value: string | null };
export type MonthOptionRow = { month: string | null };

export type ReeLossesFilterOptions = {
  versions: string[];
  months: string[];
  tarifas: string[];
  periodos: string[];
  latestMonth: string | null;
};

export type ReeLossesAnnualSummaryRow = {
  mes: string;
  version: string;
  tarifa: string;
  periodo: string;
  perdidaBoe: number | null;
  perdidaFinal: number | null;
  diferenciaVsBoe: number | null;
  diferenciaPct: number | null;
  records: number;
};

export type ReeLossesVersionComparisonRow = {
  label: string;
  value: number | null;
  records: number;
};

export type ReeLossesHeatmapSummaryRow = {
  fecha: string;
  hora: number;
  perdidaFinal: number | null;
};

export type ReeLossesAnalyticsSummary = {
  latestMonth: string | null;
  latestVersion: string | null;
  months: string[];
  latestVersionByMonth: Array<{ mes: string; version: string }>;
  annualPeriodRows: ReeLossesAnnualSummaryRow[];
  heatmapRows: ReeLossesHeatmapSummaryRow[];
  versionComparison: ReeLossesVersionComparisonRow[];
};

export type ImportResult = {
  id?: string;
  fileName: string;
  status: ImportResultStatus;
  tipoArchivo?: ReeKFactorFileType | null;
  version?: ReeSettlementVersion | null;
  fechaInicio?: string | null;
  fechaFin?: string | null;
  importedAt?: string;
  recordsImported: number;
  validRecords: number;
  invalidRecords: number;
  duplicatedRecords: number;
  errors: Array<{
    sourceFileName: string;
    lineNumber: number;
    message: string;
  }>;
};

export type PeriodContext = {
  rules: Map<string, PeriodRule>;
  holidays: Set<string>;
};

export type NormalizedKFactorInput = {
  fecha: Date;
  hora: number;
  cuartohora: number;
  version: ReeSettlementVersion;
  tipoArchivo: ReeKFactorFileType;
  tarifa: string;
  periodo: string;
  valorK: number;
};

export type SelectedKFactor = NormalizedKFactorInput & {
  id: string;
  createdAt: Date;
  duplicateCount: number;
  kestimValorK: number | null;
  krealValorK: number | null;
};

export type LossReportRow = {
  id: string;
  fecha: string;
  hora: number;
  cuartohora: number;
  tarifa: string;
  periodo: string;
  perdidaBoe: number | null;
  factorKAplicado: number;
  perdidaFinal: number | null;
  diferenciaVsBoe: number | null;
  diferenciaPct: number | null;
  tipoFicheroUtilizado: string;
  version: string;
  versionBoe: string | null;
  kestimValorK: number | null;
  krealValorK: number | null;
  anomalies: string[];
};

export type BoeLoss = {
  tarifa: string;
  periodo: string;
  porcentajePerdida: Prisma.Decimal;
  fechaInicio: Date;
  fechaFin: Date;
  versionBoe: string;
};

export type DateRange = {
  gte: Date;
  lt: Date;
};
