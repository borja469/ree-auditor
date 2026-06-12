import type { ReactNode } from "react";
import type { OmieAnalisisMensualPeriodo, OmieAnalisisMensualResponse } from "../../../api";

export type OmieDetalleCargaTechnicalColumn<T> = {
  id: string;
  label: string;
  help?: string;
  width: number;
  align?: "left" | "center" | "right";
  type?: "text" | "number" | "date";
  sticky?: boolean;
  visibility?: "basic" | "advanced";
  advanced?: boolean;
  heatmap?: boolean;
  heatmapTone?: "signed" | "risk";
  numericTone?: "signed" | "zero-danger" | "neutral";
  filter?: "text" | "number" | "select";
  defaultHidden?: boolean;
  expectedEmpty?: (row: T) => boolean;
  value: (row: T) => string | number | null | undefined;
  render?: (row: T) => ReactNode;
  exportValue?: (row: T) => string | number | null | undefined;
};

export type OmieAnalisisDailyRow = {
  fecha: string;
  diaSemana: string;
  periodos: number;
  programaMd: number | null;
  volIda1: number | null;
  volIda2: number | null;
  volIda3: number | null;
  volXbid: number | null;
  energiaTotal: number | null;
  profitIda1: number | null;
  profitIda2: number | null;
  profitIda3: number | null;
  profitXbid: number | null;
  profitTotal: number | null;
  profitMedioEurMWh: number | null;
  rows: OmieAnalisisMensualPeriodo[];
};

export type OmieMonthlyAnalysisDailyCellValue = string | number | null | undefined;

export type OmieMonthlyAnalysisTableRow = OmieAnalisisDailyRow | OmieAnalisisMensualPeriodo;

export type OmieDetalleCargaKpi = {
  label: string;
  value: string;
  meta?: string;
  tone?: "neutral" | "good" | "warning" | "danger";
};

export type OmieDetalleCargaModuleProps = {
  year: string;
  month: string;
  analisis?: OmieAnalisisMensualResponse;
  loading: boolean;
  onYearChange: (value: string) => void;
  onMonthChange: (value: string) => void;
  onRefresh: () => Promise<void> | void;
  onGoToDownloads: () => void;
};
