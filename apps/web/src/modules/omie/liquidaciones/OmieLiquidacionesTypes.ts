import type { OmieComprobacionLiquidacionDiaria } from "../../../api";

export type OmieFacturaDraftRow = {
  facturaCompra?: string;
  facturaVenta?: string;
};

export type OmieFacturaDraftMap = Record<string, OmieFacturaDraftRow>;

export type OmieLiquidationValidationRow = OmieComprobacionLiquidacionDiaria & {
  facturaCompra: number | null;
  facturaVenta: number | null;
  iva: number | null;
  omieConIva: number | null;
  descuadre: number | null;
  descuadreTone: "ok" | "warning" | "danger" | "pending";
  weekKey: string;
  weekLabel: string;
};

export type OmieLiquidationHierarchyRow = OmieLiquidationValidationRow & {
  monthKey: string;
  monthLabel: string;
};

export type OmieLiquidationWeeklySummary = {
  key: string;
  weekLabel: string;
  startDateLabel: string;
  endDateLabel: string;
  costeTotalOmie: number | null;
  facturaCompra: number | null;
  facturaVenta: number | null;
  iva: number | null;
  omieConIva: number | null;
  descuadre: number | null;
  descuadreTone: "ok" | "warning" | "danger" | "pending";
  rowCount: number;
};

export type OmieLiquidationWeeklyGroup = {
  key: string;
  summary: OmieLiquidationWeeklySummary;
  rows: OmieLiquidationValidationRow[];
};

export type OmieLiquidationKpi = {
  label: string;
  value: string;
  meta?: string;
  tone?: "good" | "warning" | "danger" | "neutral";
};
