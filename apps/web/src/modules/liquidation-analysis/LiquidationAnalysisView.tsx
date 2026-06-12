import { type ReactNode, useMemo } from "react";
import { BarChart3, TrendingUp } from "lucide-react";
import type { EChartsOption } from "echarts";
import { InlineLoading } from "../../GlobalLoadingOverlay";
import { TechnicalDataTable } from "../../components/technical-data-table/TechnicalDataTable";
import type { RowQuality, TechnicalColumn, TechnicalKpi } from "../../components/technical-data-table/TechnicalDataTableTypes";
import { hasCompleteLiquidationAnalysisFilters } from "../../app-shell/AppState";
import type { LiquidationAnalysisFilters, LiquidationAnalysisRow } from "../../api";
import { EChart, PanelTitle, formatDecimalNumber, formatEnergy, formatEuroAmount, formatFixedDecimalNumber, formatFullDate, formatMonthKeyLabel, formatNumber, formatPrice, formatRatioPercent, formatWeekdayLabel, normalizeNumericValue, ratioPercentValue, sumNumeric } from "../shared/RestoredModuleCommon";
type LiquidationAnalysisProps = {
  filters: LiquidationAnalysisFilters;
  loading: boolean;
  rows: LiquidationAnalysisRow[];
};

type LiquidationAnalysisTotals = {
  medidasRecords: number;
  reganecuRecords: number;
  reganecuQhRecords: number;
  medidaMwh: number;
  dsvMwh: number;
  dsvAbsMwh: number;
  costeDsvEur: number;
  costeCadEur: number;
  costePc3Eur: number;
  costeBs3Eur: number;
  costeRad3Eur: number;
  warningRows: number;
};

const LIQUIDATION_ANALYSIS_TOLERANCE_MWH = 0.001;

export function LiquidationAnalysisView({ filters, loading, rows }: LiquidationAnalysisProps) {
  const totals = useMemo(() => summarizeLiquidationAnalysisRows(rows), [rows]);
  const chartOption = useMemo<EChartsOption>(() => buildLiquidationAnalysisChartOption(rows), [rows]);
  const outlierLabels = useMemo(() => buildLiquidationAnalysisOutlierLabels(rows), [rows]);
  const kpis = useMemo(() => buildLiquidationAnalysisKpis(totals), [totals]);
  const scopeLabel = useMemo(() => buildLiquidationAnalysisScopeLabel(filters), [filters]);
  const columns = useMemo<Array<TechnicalColumn<LiquidationAnalysisRow>>>(
    () => [
      {
        id: "fecha",
        label: "Fecha",
        width: 118,
        sticky: true,
        type: "date",
        filter: "text",
        value: (row) => row.fecha,
        render: (row) => formatFullDate(row.fecha)
      },
      {
        id: "diaSemana",
        label: "Dia",
        width: 72,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.diaSemana,
        render: (row) => formatWeekdayLabel(row.diaSemana)
      },
      {
        id: "version",
        label: "Version",
        width: 90,
        sticky: true,
        filter: "select",
        value: (row) => row.version
      },
      {
        id: "medidasRecords",
        label: "Med. recs",
        width: 104,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.medidasRecords
      },
      {
        id: "reganecuRecords",
        label: "Reganecu",
        width: 104,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.reganecuRecords
      },
      {
        id: "reganecuQhRecords",
        label: "ReganecuQH",
        width: 110,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.reganecuQhRecords
      },
      {
        id: "medidaMwh",
        label: "Medida MWh",
        width: 118,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.medidaMwh,
        render: (row) => formatEnergy(row.medidaMwh)
      },
      {
        id: "programaMwh",
        label: "Programa MWh",
        width: 122,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.programaMwh,
        render: (row) => formatEnergy(row.programaMwh)
      },
      {
        id: "dsvMwh",
        label: "DSV MWh",
        width: 118,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.dsvMwh,
        render: (row) => formatEnergy(row.dsvMwh)
      },
      {
        id: "dsvPct",
        label: "DSV %",
        width: 92,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => ratioPercentValue(row.dsvPct),
        render: (row) => formatRatioPercent(row.dsvPct)
      },
      {
        id: "dsvAbsMwh",
        label: "DSV ABS",
        width: 118,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.dsvAbsMwh,
        render: (row) => formatEnergy(row.dsvAbsMwh)
      },
      {
        id: "dsvAbsPct",
        label: "DSV ABS %",
        width: 92,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => ratioPercentValue(row.dsvAbsPct),
        render: (row) => formatRatioPercent(row.dsvAbsPct)
      },
      {
        id: "costeDsvEur",
        label: "Coste DSV",
        width: 124,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.costeDsvEur,
        render: (row) => formatEuroAmount(row.costeDsvEur)
      },
      {
        id: "precioDsvEurMwh",
        label: "Precio DSV",
        width: 108,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.precioDsvEurMwh,
        render: (row) => formatPrice(row.precioDsvEurMwh)
      },
      {
        id: "costeCadEur",
        label: "Coste CAD",
        width: 124,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.costeCadEur,
        render: (row) => formatEuroAmount(row.costeCadEur)
      },
      {
        id: "precioCadEurMwh",
        label: "Precio CAD",
        width: 108,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.precioCadEurMwh,
        render: (row) => formatPrice(row.precioCadEurMwh)
      },
      {
        id: "costePc3Eur",
        label: "Coste PC3",
        width: 124,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.costePc3Eur,
        render: (row) => formatEuroAmount(row.costePc3Eur)
      },
      {
        id: "precioPc3EurMwh",
        label: "Precio PC3",
        width: 108,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.precioPc3EurMwh,
        render: (row) => formatPrice(row.precioPc3EurMwh)
      },
      {
        id: "costeBs3Eur",
        label: "Coste BS3",
        width: 124,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.costeBs3Eur,
        render: (row) => formatEuroAmount(row.costeBs3Eur)
      },
      {
        id: "precioBs3EurMwh",
        label: "Precio BS3",
        width: 108,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.precioBs3EurMwh,
        render: (row) => formatPrice(row.precioBs3EurMwh)
      },
      {
        id: "costeRad3Eur",
        label: "Coste RAD3",
        width: 124,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.costeRad3Eur,
        render: (row) => formatEuroAmount(row.costeRad3Eur)
      },
      {
        id: "precioRad3EurMwh",
        label: "Precio RAD3",
        width: 108,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.precioRad3EurMwh,
        render: (row) => formatPrice(row.precioRad3EurMwh)
      }
    ],
    []
  );

  if (loading && rows.length === 0) {
    return (
      <section className="content-grid">
        <div className="panel wide">
          <InlineLoading label="Cargando analisis de liquidacion" />
        </div>
      </section>
    );
  }

  if (rows.length === 0) {
    return (
      <section className="content-grid">
        <div className="panel wide">
          <div className="empty-state">
            <strong>Liquidation Analysis</strong>
            <div>
              {hasCompleteLiquidationAnalysisFilters(filters)
                ? "No hay registros para los filtros seleccionados."
                : "Selecciona mes y version y pulsa Filtrar."}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="content-grid">
        <div className="panel wide">
          <PanelTitle icon={<BarChart3 size={18} />} title="Liquidation Analysis" subtitle={scopeLabel} />
        </div>
      </section>

      <section className="content-grid">
        <div className="panel wide">
          <PanelTitle icon={<TrendingUp size={18} />} title="Evolucion" subtitle="DSV y precios por fecha" />
          <LiquidationAnalysisChart rows={rows} option={chartOption} />
        </div>
      </section>

      <TechnicalDataTable
        columns={columns}
        exportFileName="liquidation-analysis"
        getDuplicateKey={(row) => row.fecha}
        getGroupLabel={() => ""}
        getRowId={(row) => row.fecha}
        getRowQuality={(row) => liquidationAnalysisQuality(row, outlierLabels)}
        getTotalsRow={buildLiquidationAnalysisTotalsRow}
        hasNext={false}
        kpis={kpis}
        loading={loading}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        page={0}
        pageSize={rows.length}
        rows={rows}
        showHeaderTitle
        showModeSelector={false}
        showPagination={false}
        showQuality
        title="Detalle de liquidacion"
      />
    </>
  );
}


function LiquidationAnalysisChart({ rows, option }: { rows: LiquidationAnalysisRow[]; option: EChartsOption }) {
  const chartOption = useMemo<EChartsOption>(() => option, [option]);
  void rows;
  return <EChart option={chartOption} height={360} />;
}

function buildLiquidationAnalysisChartOption(rows: LiquidationAnalysisRow[]): EChartsOption {
  const dates = rows.map((row) => formatFullDate(row.fecha));
  const percentSeries = [
    { name: "DSV %", key: "dsvPct" as const },
    { name: "DSV ABS %", key: "dsvAbsPct" as const }
  ];
  const priceSeries = [
    { name: "COSTE DSV / DSV", key: "precioDsvEurMwh" as const },
    { name: "PRECIO CAD", key: "precioCadEurMwh" as const },
    { name: "PRECIO PC3", key: "precioPc3EurMwh" as const },
    { name: "PRECIO BS3", key: "precioBs3EurMwh" as const },
    { name: "PRECIO RAD3", key: "precioRad3EurMwh" as const }
  ];

  return {
    color: ["#2563eb", "#16a34a", "#f97316", "#7c3aed", "#0f766e", "#dc2626", "#0891b2"],
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => (typeof value === "number" ? formatFixedDecimalNumber(value, 2) : String(value ?? "-"))
    },
    legend: {
      type: "scroll",
      top: 2,
      textStyle: { color: "#294553", fontWeight: 700 }
    },
    grid: { left: 56, right: 64, top: 58, bottom: 66, containLabel: true },
    dataZoom: [
      { type: "inside", filterMode: "none" },
      { type: "slider", height: 22, bottom: 20, filterMode: "none" }
    ],
    xAxis: {
      type: "category",
      data: dates,
      axisLabel: { color: "#5a7381", hideOverlap: true },
      axisLine: { lineStyle: { color: "#bccbd4" } }
    },
    yAxis: [
      {
        type: "value",
        name: "%",
        axisLabel: { color: "#5a7381", formatter: (value: number) => `${formatDecimalNumber(value, 0)}%` },
        splitLine: { lineStyle: { color: "#edf2f5" } }
      },
      {
        type: "value",
        name: "EUR/MWh",
        axisLabel: { color: "#5a7381", formatter: (value: number) => formatDecimalNumber(value, 0) },
        splitLine: { show: false }
      }
    ],
    series: [
      ...percentSeries.map((serie) => ({
        name: serie.name,
        type: "line" as const,
        smooth: true,
        symbolSize: 6,
        yAxisIndex: 0,
        data: rows.map((row) => ratioPercentValue(row[serie.key]))
      })),
      ...priceSeries.map((serie) => ({
        name: serie.name,
        type: "line" as const,
        smooth: true,
        symbolSize: 6,
        yAxisIndex: 1,
        data: rows.map((row) => normalizeNumericValue(row[serie.key]) ?? null)
      }))
    ]
  };
}

function buildLiquidationAnalysisKpis(totals: LiquidationAnalysisTotals): TechnicalKpi[] {
  return [
    { label: "Total Medida", value: `${formatEnergy(totals.medidaMwh)} MWh` },
    { label: "Total DSV", value: `${formatEnergy(totals.dsvMwh)} MWh` },
    { label: "Coste total DSV", value: formatEuroAmount(totals.costeDsvEur) },
    { label: "Coste total CAD", value: formatEuroAmount(totals.costeCadEur) },
    { label: "Coste total PC3", value: formatEuroAmount(totals.costePc3Eur) },
    { label: "Coste total BS3", value: formatEuroAmount(totals.costeBs3Eur) },
    { label: "Coste total RAD3", value: formatEuroAmount(totals.costeRad3Eur) }
  ];
}

function buildLiquidationAnalysisTotalsRow(rows: LiquidationAnalysisRow[]): Record<string, ReactNode> {
  const totals = summarizeLiquidationAnalysisRows(rows);
  const dsvPct = totalRatio(totals.dsvMwh, totals.medidaMwh);
  const dsvAbsPct = totalRatio(totals.dsvAbsMwh, totals.medidaMwh);
  const precioDsv = totalRatio(totals.costeDsvEur, totals.dsvMwh);
  const precioCad = totalRatio(totals.costeCadEur, totals.medidaMwh);
  const precioPc3 = totalRatio(totals.costePc3Eur, totals.medidaMwh);
  const precioBs3 = totalRatio(totals.costeBs3Eur, totals.medidaMwh);
  const precioRad3 = totalRatio(totals.costeRad3Eur, totals.medidaMwh);

  return {
    fecha: "TOTAL",
    diaSemana: "",
    version: "",
    medidasRecords: formatNumber(totals.medidasRecords),
    reganecuRecords: formatNumber(totals.reganecuRecords),
    reganecuQhRecords: formatNumber(totals.reganecuQhRecords),
    medidaMwh: formatEnergy(totals.medidaMwh),
    programaMwh: "",
    dsvMwh: formatEnergy(totals.dsvMwh),
    dsvPct: dsvPct === undefined ? "" : formatRatioPercent(dsvPct),
    dsvAbsMwh: formatEnergy(totals.dsvAbsMwh),
    dsvAbsPct: dsvAbsPct === undefined ? "" : formatRatioPercent(dsvAbsPct),
    costeDsvEur: formatEuroAmount(totals.costeDsvEur),
    precioDsvEurMwh: precioDsv === undefined ? "" : formatPrice(precioDsv),
    costeCadEur: formatEuroAmount(totals.costeCadEur),
    precioCadEurMwh: precioCad === undefined ? "" : formatPrice(precioCad),
    costePc3Eur: formatEuroAmount(totals.costePc3Eur),
    precioPc3EurMwh: precioPc3 === undefined ? "" : formatPrice(precioPc3),
    costeBs3Eur: formatEuroAmount(totals.costeBs3Eur),
    precioBs3EurMwh: precioBs3 === undefined ? "" : formatPrice(precioBs3),
    costeRad3Eur: formatEuroAmount(totals.costeRad3Eur),
    precioRad3EurMwh: precioRad3 === undefined ? "" : formatPrice(precioRad3)
  };
}

function buildLiquidationAnalysisOutlierLabels(rows: LiquidationAnalysisRow[]) {
  const labels = new Map<string, string[]>();
  const checks = [
    { label: "DSV % anomalo", value: (row: LiquidationAnalysisRow) => ratioPercentValue(row.dsvPct) },
    { label: "DSV ABS % anomalo", value: (row: LiquidationAnalysisRow) => ratioPercentValue(row.dsvAbsPct) },
    { label: "COSTE DSV / DSV anomalo", value: (row: LiquidationAnalysisRow) => normalizeNumericValue(row.precioDsvEurMwh) },
    { label: "PRECIO CAD anomalo", value: (row: LiquidationAnalysisRow) => normalizeNumericValue(row.precioCadEurMwh) },
    { label: "PRECIO PC3 anomalo", value: (row: LiquidationAnalysisRow) => normalizeNumericValue(row.precioPc3EurMwh) },
    { label: "PRECIO BS3 anomalo", value: (row: LiquidationAnalysisRow) => normalizeNumericValue(row.precioBs3EurMwh) },
    { label: "PRECIO RAD3 anomalo", value: (row: LiquidationAnalysisRow) => normalizeNumericValue(row.precioRad3EurMwh) }
  ];

  for (const check of checks) {
    const values = rows.map(check.value).filter((value): value is number => value !== undefined);
    if (values.length < 4) {
      continue;
    }
    const bounds = outlierBounds(values);
    for (const row of rows) {
      const value = check.value(row);
      if (value === undefined || (value >= bounds.low && value <= bounds.high)) {
        continue;
      }
      labels.set(row.fecha, [...(labels.get(row.fecha) ?? []), check.label]);
    }
  }

  return labels;
}

function liquidationAnalysisQuality(row: LiquidationAnalysisRow, outlierLabels: Map<string, string[]>): RowQuality {
  const labels = [
    ...(outlierLabels.get(row.fecha) ?? []),
    row.medidaMwh === null || row.medidaMwh === undefined ? "Medida vacia" : ""
  ].filter(Boolean);
  return {
    tone: outlierLabels.has(row.fecha) ? "danger" : labels.length > 0 ? "warning" : "ok",
    labels
  };
}

function summarizeLiquidationAnalysisRows(rows: LiquidationAnalysisRow[]): LiquidationAnalysisTotals {
  return {
    medidasRecords: rows.reduce((sum, row) => sum + row.medidasRecords, 0),
    reganecuRecords: rows.reduce((sum, row) => sum + row.reganecuRecords, 0),
    reganecuQhRecords: rows.reduce((sum, row) => sum + row.reganecuQhRecords, 0),
    medidaMwh: sumNumeric(rows.map((row) => row.medidaMwh)),
    dsvMwh: sumNumeric(rows.map((row) => row.dsvMwh)),
    dsvAbsMwh: sumNumeric(rows.map((row) => row.dsvAbsMwh)),
    costeDsvEur: sumNumeric(rows.map((row) => row.costeDsvEur)),
    costeCadEur: sumNumeric(rows.map((row) => row.costeCadEur)),
    costePc3Eur: sumNumeric(rows.map((row) => row.costePc3Eur)),
    costeBs3Eur: sumNumeric(rows.map((row) => row.costeBs3Eur)),
    costeRad3Eur: sumNumeric(rows.map((row) => row.costeRad3Eur)),
    warningRows: rows.filter(hasLiquidationAnalysisWarning).length
  };
}

function hasLiquidationAnalysisWarning(row: LiquidationAnalysisRow) {
  return Math.abs(normalizeNumericValue(row.dsvMwh) ?? 0) > LIQUIDATION_ANALYSIS_TOLERANCE_MWH;
}

function buildLiquidationAnalysisScopeLabel(filters: LiquidationAnalysisFilters) {
  const parts = [];
  if (filters.fecha) {
    parts.push(`Mes ${formatMonthKeyLabel(filters.fecha)}`);
  }
  if (filters.version) {
    parts.push(`Version ${filters.version}`);
  }
  return parts.length > 0 ? parts.join(" Â· ") : "Selecciona mes y version";
}

function totalRatio(numerator: number | string | null | undefined, denominator: number | string | null | undefined) {
  const numeratorValue = normalizeNumericValue(numerator);
  const denominatorValue = normalizeNumericValue(denominator);
  return numeratorValue !== undefined && denominatorValue !== undefined && denominatorValue !== 0 ? numeratorValue / denominatorValue : undefined;
}

function outlierBounds(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  return {
    low: q1 - 1.5 * iqr,
    high: q3 + 1.5 * iqr
  };
}

function quantile(sortedValues: number[], quantileValue: number) {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = (sortedValues.length - 1) * quantileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}
