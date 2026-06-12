import { type ReactNode, useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import type { OmieDownloadEstado } from "../../api";

export function formatFullDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(parsed);
}

export function sumNumeric(values: Array<string | number | null | undefined>): number {
  return values.reduce<number>((sum, value) => sum + (normalizeNumericValue(value) ?? 0), 0);
}

export function formatDecimalNumber(value: number, decimals = 2) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

export function formatNumber(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(numeric);
}

export function normalizeNumericValue(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  const parsed = Number(String(value).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function formatFixedDecimalNumber(value: number, decimals = 2) {
  return formatDecimalNumber(value, decimals);
}

export function formatEnergy(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : formatFixedDecimalNumber(numeric, 2);
}

export function formatRatioPercent(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : `${formatFixedDecimalNumber(numeric * 100, 2)}%`;
}

export function ratioPercentValue(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? undefined : numeric * 100;
}

export function formatCurrency(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : `${formatFixedDecimalNumber(numeric, 2)} €`;
}

export function formatEuroAmount(value: number | string | null | undefined) {
  return formatCurrency(value);
}

export function formatPrice(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : `${formatFixedDecimalNumber(numeric, 2)} EUR/MWh`;
}

export function formatMonthKeyLabel(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) {
    return value;
  }
  return `${match[2]}/${match[1]}`;
}

export function formatFullDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return value;
  }
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatWeekdayLabel(value: number | null) {
  if (value === null || value === undefined) {
    return "-";
  }
  const labels = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];
  return labels[value] ?? "-";
}

export function LoadStatusBadge({ status }: { status: OmieDownloadEstado }) {
  const label = status === "PROCESADO" ? "Procesado" : status === "DESCARGADO" ? "Descargado" : status === "DESCARGANDO" ? "Descargando" : status === "PENDIENTE" ? "Pendiente" : "Error";
  return <span className={`ops-status-badge ${status === "ERROR" ? "error" : status === "PROCESADO" ? "valid" : "partial"}`}>{label}</span>;
}

export function EChart({ option, height = 360 }: { option: EChartsOption; height?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chart.setOption(option, true);

    const resize = () => {
      chart.resize();
    };

    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : undefined;
    observer?.observe(ref.current);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      observer?.disconnect();
      chart.dispose();
    };
  }, [option]);

  return <div className="chart-canvas energy-chart-canvas" ref={ref} style={{ height }} />;
}

export function PanelTitle({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle?: ReactNode }) {
  return (
    <div className="panel-title">
      {icon}
      <div className="panel-title-copy">
        <h2>{title}</h2>
        {subtitle && <span>{subtitle}</span>}
      </div>
    </div>
  );
}
