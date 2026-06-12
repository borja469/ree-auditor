import type { ReactNode } from "react";
import { buildHierarchyWithAggregates, type TechnicalAggregateColumnDefinition } from "../../../technical-module-v2/index.js";
import type { TechnicalDataTableAdapterColumn } from "../../../technical-module-v2/adapters/technicalDataTableAdapter";
import { withGlobalLoading } from "../../../loading";
import type { OmieComprobacionLiquidacionDiaria, OmieComprobacionLiquidacionesResponse } from "../../../api";
import type {
  OmieFacturaDraftRow,
  OmieFacturaDraftMap,
  OmieLiquidationHierarchyRow,
  OmieLiquidationKpi,
  OmieLiquidationValidationRow,
  OmieLiquidationWeeklyGroup
} from "./OmieLiquidacionesTypes";

const OMIE_LIQUIDATION_MONTH_LEVELS = [
  {
    id: "month",
    getKey: (row: OmieLiquidationHierarchyRow) => row.monthKey,
    getLabel: (row: OmieLiquidationHierarchyRow) => row.monthLabel
  },
  {
    id: "day",
    getKey: (row: OmieLiquidationHierarchyRow) => row.fechaIso,
    getLabel: (row: OmieLiquidationHierarchyRow) => row.fecha
  }
] satisfies Array<{ id: string; getKey: (row: OmieLiquidationHierarchyRow) => string; getLabel: (row: OmieLiquidationHierarchyRow) => string }>;

const OMIE_LIQUIDATION_MONTH_AGGREGATES: Array<TechnicalAggregateColumnDefinition<OmieLiquidationHierarchyRow>> = [
  { id: "rowCount", aggregate: "count" },
  { id: "costeTotalOmie", aggregate: { kind: "custom", calculate: (currentRows) => sumDefinedValues(currentRows.map((row) => row.costeTotalOmie)) } },
  { id: "facturaCompra", aggregate: { kind: "custom", calculate: (currentRows) => sumDefinedValues(currentRows.map((row) => row.facturaCompra)) } },
  { id: "facturaVenta", aggregate: { kind: "custom", calculate: (currentRows) => sumDefinedValues(currentRows.map((row) => row.facturaVenta)) } }
];

type OmieLiquidationExportSection = {
  title: string;
  rows: string[][];
};

export function buildOmieLiquidationWeeklyGroups(rows: OmieComprobacionLiquidacionDiaria[], drafts: OmieFacturaDraftMap): OmieLiquidationWeeklyGroup[] {
  const groups = new Map<string, OmieLiquidationValidationRow[]>();

  for (const row of buildOmieLiquidationValidatedRowsV2(rows, drafts)) {
    const current = groups.get(row.weekKey);
    if (current) {
      current.push(row);
    } else {
      groups.set(row.weekKey, [row]);
    }
  }

  return [...groups.entries()].map(([key, groupRows]) => ({
    key,
    rows: groupRows,
    summary: buildOmieWeeklySummary(groupRows)
  }));
}

export function buildOmieLiquidationValidationKpis(groups: OmieLiquidationWeeklyGroup[]): OmieLiquidationKpi[] {
  const summaries = groups.map((group) => group.summary);
  const validated = summaries.filter((summary) => summary.descuadre !== null);
  const correctWeeks = validated.filter((summary) => Math.abs(summary.descuadre ?? 0) < 1).length;
  const mismatchedWeeks = validated.filter((summary) => Math.abs(summary.descuadre ?? 0) >= 1).length;
  const accumulatedMismatch = sumDefinedValues(validated.map((summary) => summary.descuadre));
  const pendingWeeks = Math.max(summaries.length - validated.length, 0);

  return [
    {
      label: "Semanas correctas",
      value: String(correctWeeks),
      meta: pendingWeeks > 0 ? `${validated.length}/${summaries.length} validadas` : undefined,
      tone: correctWeeks > 0 ? "good" : "neutral"
    },
    {
      label: "Semanas con diferencias",
      value: String(mismatchedWeeks),
      meta: pendingWeeks > 0 ? `${pendingWeeks} pendientes` : undefined,
      tone: mismatchedWeeks > 0 ? "warning" : "good"
    },
    {
      label: "Descuadre acumulado",
      value: formatEuroAmount(accumulatedMismatch),
      tone: mismatchTone(accumulatedMismatch) === "danger" ? "danger" : mismatchTone(accumulatedMismatch) === "warning" ? "warning" : "good"
    }
  ];
}

export function exportOmieLiquidationCheck(
  comprobacion: OmieComprobacionLiquidacionesResponse,
  weeklyGroups: OmieLiquidationWeeklyGroup[],
  activeColumns: Array<TechnicalDataTableAdapterColumn<OmieLiquidationValidationRow>>,
  format: "csv" | "xls"
) {
  void withGlobalLoading(
    () => {
      const sections = buildOmieLiquidationExportSections(comprobacion, weeklyGroups, activeColumns);
      const fileName = `omie-comprobacion-liquidaciones-${comprobacion.mes}.${format}`;

      if (format === "xls") {
        const html = sections
          .map(
            (section) =>
              `<h2>${escapeHtml(section.title)}</h2><table>${section.rows
                .map((line, index) => `<tr>${line.map((cell) => `<${index === 0 ? "th" : "td"}>${escapeHtml(cell)}</${index === 0 ? "th" : "td"}>`).join("")}</tr>`)
                .join("")}</table>`
          )
          .join("<br/>");
        downloadBlob(fileName, html, "application/vnd.ms-excel;charset=utf-8");
        return;
      }

      const csv = sections
        .flatMap((section) => [[section.title], ...section.rows, []])
        .map((line) => line.map(csvCell).join(";"))
        .join("\n");
      downloadBlob(fileName, csv, "text/csv;charset=utf-8");
    },
    { label: "Preparando exportación OMIE" }
  );
}

export function copyTechnicalRows<T extends object>(columns: Array<TechnicalDataTableAdapterColumn<T>>, rows: T[], totalsRow?: Record<string, ReactNode>) {
  void withGlobalLoading(
    async () => {
      const text = [
        columns.map((column) => column.label).join("\t"),
        ...(totalsRow ? [columns.map((column) => stringifyTotalsCellValue(totalsRow[column.id])).join("\t")] : []),
        ...rows.map((row) => columns.map((column) => stringifyCellValue(technicalExportValue(column, row))).join("\t"))
      ].join("\n");
      await navigator.clipboard?.writeText(text);
    },
    { label: "Copiando datos" }
  );
}

function buildOmieLiquidationValidatedRowsV2(rows: OmieComprobacionLiquidacionDiaria[], drafts: OmieFacturaDraftMap): OmieLiquidationValidationRow[] {
  const hierarchyRows: OmieLiquidationHierarchyRow[] = [...rows]
    .sort((left, right) => left.fechaIso.localeCompare(right.fechaIso))
    .map((row) => {
      const weekInfo = getIsoWeekInfo(row.fechaIso);
      const validatedRow = buildOmieLiquidationValidationRow(row, drafts[row.fechaIso], weekInfo);
      return {
        ...validatedRow,
        monthKey: row.fechaIso.slice(0, 7),
        monthLabel: formatMonthKeyLabel(row.fechaIso.slice(0, 7))
      };
    });

  return buildHierarchyWithAggregates(hierarchyRows, OMIE_LIQUIDATION_MONTH_LEVELS, OMIE_LIQUIDATION_MONTH_AGGREGATES).flatMap((monthNode) =>
    monthNode.children.flatMap((dayNode) => dayNode.rows.map(({ monthKey: _monthKey, monthLabel: _monthLabel, ...row }) => row))
  );
}

function buildOmieLiquidationValidationRow(
  row: OmieComprobacionLiquidacionDiaria,
  draft: OmieFacturaDraftRow | undefined,
  weekInfo: ReturnType<typeof getIsoWeekInfo>
): OmieLiquidationValidationRow {
  const facturaCompra = parseEuroInputValue(draft?.facturaCompra);
  const facturaVenta = parseEuroInputValue(draft?.facturaVenta);
  const breakdown = calculateOmieMismatch(row.costeTotalOmie, facturaCompra, facturaVenta);

  return {
    ...row,
    facturaCompra,
    facturaVenta,
    iva: breakdown.iva,
    omieConIva: breakdown.omieConIva,
    descuadre: breakdown.descuadre,
    descuadreTone: mismatchTone(breakdown.descuadre),
    weekKey: weekInfo.key,
    weekLabel: weekInfo.label
  };
}

function buildOmieWeeklySummary(rows: OmieLiquidationValidationRow[]) {
  const startRow = rows[0];
  const endRow = rows[rows.length - 1];
  const costeTotalOmie = sumDefinedValues(rows.map((row) => row.costeTotalOmie));
  const facturaCompra = sumDefinedValues(rows.map((row) => row.facturaCompra));
  const facturaVenta = sumDefinedValues(rows.map((row) => row.facturaVenta));
  const isCompleteWeek = rows.every((row) => row.facturaCompra !== null && row.facturaVenta !== null && row.costeTotalOmie !== null);
  const breakdown = isCompleteWeek ? calculateOmieMismatch(costeTotalOmie, facturaCompra, facturaVenta) : { iva: costeTotalOmie === null ? null : roundCurrencyAmount(costeTotalOmie * 0.21), omieConIva: costeTotalOmie === null ? null : roundCurrencyAmount(costeTotalOmie * 1.21), descuadre: null };

  return {
    key: rows[0]?.weekKey ?? "",
    weekLabel: rows[0]?.weekLabel ?? "SEMANA",
    startDateLabel: startRow?.fecha ?? "-",
    endDateLabel: endRow?.fecha ?? "-",
    costeTotalOmie,
    facturaCompra,
    facturaVenta,
    iva: breakdown.iva,
    omieConIva: breakdown.omieConIva,
    descuadre: breakdown.descuadre,
    descuadreTone: mismatchTone(breakdown.descuadre),
    rowCount: rows.length
  };
}

function buildOmieLiquidationExportSections(
  comprobacion: OmieComprobacionLiquidacionesResponse,
  weeklyGroups: OmieLiquidationWeeklyGroup[],
  activeColumns: Array<TechnicalDataTableAdapterColumn<OmieLiquidationValidationRow>>
): OmieLiquidationExportSection[] {
  const detalleDiario = weeklyGroups.flatMap((group) => group.rows);
  return [
    {
      title: "Resumen mensual",
      rows: [
        ["Mercado", "Energía (MWh)", "Importe (€)"],
        ...comprobacion.resumenMensual.map((row) => [row.mercado, formatOmieEnergy(row.energiaMWh), formatEuroAmount(row.importeEur)])
      ]
    },
    {
      title: "Detalle diario",
      rows: [
        activeColumns.map((column) => column.label),
        ...detalleDiario.map((row) => activeColumns.map((column) => stringifyCellValue(column.exportValue ? column.exportValue(row) : column.value(row))))
      ]
    },
    {
      title: "Validación semanal",
      rows: [
        ["Semana", "Periodo", "Coste OMIE", "Coste OMIE con IVA", "Factura Compra", "Factura Venta", "Descuadre"],
        ...weeklyGroups.map((group) => [
          group.summary.weekLabel,
          `${group.summary.startDateLabel} - ${group.summary.endDateLabel}`,
          formatEuroAmount(group.summary.costeTotalOmie),
          formatEuroAmount(group.summary.omieConIva),
          formatEuroAmount(group.summary.facturaCompra),
          formatEuroAmount(group.summary.facturaVenta),
          formatEuroAmount(group.summary.descuadre)
        ])
      ]
    },
    {
      title: "Detalle horario",
      rows: [
        ["Fecha", "Hora", "MD MWh", "PMD", "Coste MD", "IDA1 MWh", "PIDA1", "Coste IDA1", "IDA2 MWh", "PIDA2", "Coste IDA2", "IDA3 MWh", "PIDA3", "Coste IDA3", "XBID MWh", "PXBID", "Coste XBID"],
        ...detalleDiario.flatMap((day) =>
          day.horas.map((row) => [
            day.fecha,
            String(row.hora),
            formatOmieEnergy(row.mdMWh),
            formatOmiePrice(row.pmd),
            formatEuroAmount(row.costeMd),
            formatOmieEnergy(row.ida1MWh),
            formatOmiePrice(row.pida1),
            formatEuroAmount(row.costeIda1),
            formatOmieEnergy(row.ida2MWh),
            formatOmiePrice(row.pida2),
            formatEuroAmount(row.costeIda2),
            formatOmieEnergy(row.ida3MWh),
            formatOmiePrice(row.pida3),
            formatEuroAmount(row.costeIda3),
            formatOmieEnergy(row.xbidMWh),
            formatOmiePrice(row.pxbid),
            formatEuroAmount(row.costeXbid)
          ])
        )
      ]
    },
    {
      title: "Cuadres",
      rows: [
        ["Tipo", "Calculado", "Liquidado", "Diferencia"],
        [
          "Económico",
          formatEuroAmount(comprobacion.cuadroEconomico.calculado),
          formatEuroAmount(comprobacion.cuadroEconomico.liquidado),
          formatEuroAmount(comprobacion.cuadroEconomico.diferencia)
        ],
        [
          "Energético",
          `${formatOmieEnergy(comprobacion.cuadroEnergetico.calculado)} MWh`,
          `${formatOmieEnergy(comprobacion.cuadroEnergetico.liquidado)} MWh`,
          `${formatOmieEnergy(comprobacion.cuadroEnergetico.diferencia)} MWh`
        ]
      ]
    }
  ];
}

function calculateOmieMismatch(costeTotalOmie: number | null, facturaCompra: number | null, facturaVenta: number | null) {
  const iva = costeTotalOmie === null ? null : roundCurrencyAmount(costeTotalOmie * 0.21);
  const omieConIva = costeTotalOmie === null ? null : roundCurrencyAmount(costeTotalOmie + (iva ?? 0));
  if (omieConIva === null || facturaCompra === null || facturaVenta === null) {
    return { iva, omieConIva, descuadre: null };
  }

  return {
    iva,
    omieConIva,
    descuadre: roundCurrencyAmount(omieConIva - facturaCompra + facturaVenta)
  };
}

function mismatchTone(value: number | null): "ok" | "warning" | "danger" | "pending" {
  if (value === null || !Number.isFinite(value)) {
    return "pending";
  }

  const absolute = Math.abs(value);
  if (absolute < 1) {
    return "ok";
  }
  if (absolute < 10) {
    return "warning";
  }
  return "danger";
}

export function parseEuroInputValue(value?: string) {
  const numeric = normalizeNumericValue(value?.replace(/€/g, ""));
  return numeric === undefined ? null : roundCurrencyAmount(numeric);
}

function sumDefinedValues(values: Array<number | null | undefined>) {
  const present = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  if (present.length === 0) {
    return null;
  }
  return roundCurrencyAmount(present.reduce((sum, value) => sum + value, 0));
}

function roundCurrencyAmount(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getIsoWeekInfo(value: string) {
  const parsed = parseDateText(value);
  const date = parsed?.date;
  if (!date) {
    return { key: value, label: "SEMANA" };
  }

  const normalized = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = normalized.getUTCDay() || 7;
  normalized.setUTCDate(normalized.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(normalized.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((normalized.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return {
    key: `${normalized.getUTCFullYear()}-W${pad2(week)}`,
    label: `SEMANA ${week}`
  };
}

function formatMonthKeyLabel(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) {
    return value;
  }

  return `${match[2]}/${match[1]}`;
}

export function formatEuroAmount(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : `${formatFixedDecimalNumber(numeric, 2)} €`;
}

export function formatOmieEnergy(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : formatFixedDecimalNumber(numeric, 3);
}

export function formatOmiePrice(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : formatFixedDecimalNumber(numeric, 2);
}

export function formatFixedDecimalNumber(value: number, decimals = 2) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const fixed = absolute.toFixed(decimals);
  const [integerPart, decimalPart = ""] = fixed.split(".");
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimals > 0 ? `${sign}${groupedInteger},${decimalPart}` : `${sign}${groupedInteger}`;
}

function normalizeNumericValue(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function stringifyCellValue(value: string | number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function stringifyTotalsCellValue(value: ReactNode) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function technicalExportValue<T>(column: TechnicalDataTableAdapterColumn<T>, row: T) {
  return column.exportValue ? column.exportValue(row) : column.value(row);
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

function downloadBlob(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[char] ?? char);
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function parseDateText(value?: string | null) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  const compact = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?$/.exec(trimmed);
  if (compact) {
    return buildDateParts(
      Number(compact[1]),
      Number(compact[2]),
      Number(compact[3]),
      compact[4] === undefined ? undefined : Number(compact[4]),
      compact[5] === undefined ? undefined : Number(compact[5])
    );
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z)?)?$/.exec(trimmed);
  if (iso) {
    return buildDateParts(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      iso[4] === undefined ? undefined : Number(iso[4]),
      iso[5] === undefined ? undefined : Number(iso[5])
    );
  }

  const european = /^(\d{2})[/-](\d{2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?$/.exec(trimmed);
  if (european) {
    return buildDateParts(
      Number(european[3]),
      Number(european[2]),
      Number(european[1]),
      european[4] === undefined ? undefined : Number(european[4]),
      european[5] === undefined ? undefined : Number(european[5])
    );
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? undefined : { date };
}

function buildDateParts(year: number, month: number, day: number, hour?: number, minute?: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }

  if (hour === undefined && minute === undefined) {
    return { date };
  }

  if (hour === undefined || minute === undefined || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return undefined;
  }

  return { date, hour, minute };
}
