import type { OmieComprobacionLiquidacionDiaria } from "../../../api";

export type OmieFacturaDraftRow = {
  facturaCompra?: string;
  facturaVenta?: string;
};

export type OmieFacturaDraftMap = Record<string, OmieFacturaDraftRow>;

export type OmieLiquidationValidationRow = OmieComprobacionLiquidacionDiaria & {
  facturaCompra: number | null;
  facturaVenta: number | null;
  facturaCompraCalculada: number | null;
  facturaVentaCalculada: number | null;
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
  compraMercados: number | null;
  ventaMercados: number | null;
  conceptosCompra: number | null;
  conceptosVenta: number | null;
  compraBaseImponible: number | null;
  ventaBaseImponible: number | null;
  ivaCompra: number | null;
  ivaVenta: number | null;
  compraFactura: number | null;
  ventaFactura: number | null;
  netoFactura: number | null;
  netoBaseImponible: number | null;
  netoAnalitico: number | null;
  facturaCompra: number | null;
  facturaVenta: number | null;
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
