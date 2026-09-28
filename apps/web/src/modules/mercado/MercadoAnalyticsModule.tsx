import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { AlertTriangle, BarChart3, Download, Gauge, Search, Table2, TrendingUp } from "lucide-react";
import {
  getMercadoAnalytics,
  getMercadoCoverageDiagnostics,
  type MercadoAnalyticsResponse,
  type MercadoCoverageDiagnosticsResponse
} from "../../api";
import { getTodayInputValue } from "../../app-shell/AppState";
import { downloadBlob } from "../../components/technical-data-table/TechnicalDataTableHelpers";
import { EChart, PanelTitle, formatDecimalNumber, formatNumber } from "../shared/RestoredModuleCommon";

type MercadoAnalyticsFilters = {
  fechaDesde: string;
  fechaHasta: string;
  geoId: string;
};

const DEFAULT_SERIES = ["precioOmie", "demandaPrevista", "huecoTermico", "eolica", "fotovoltaica", "termosolar"];
const CORE_VARIABLES = ["precioOmie", "demandaPrevista", "huecoTermico", "demandaResidual", "eolica", "fotovoltaica", "termosolar", "nuclear", "hidraulicaUGH", "hidraulicaNoUGH"];

export function MercadoAnalyticsModule() {
  const [filters, setFilters] = useState<MercadoAnalyticsFilters>(() => {
    const today = getTodayInputValue();
    return { fechaDesde: `${today.slice(0, 4)}-01-01`, fechaHasta: today, geoId: "" };
  });
  const [analytics, setAnalytics] = useState<MercadoAnalyticsResponse>();
  const [diagnostics, setDiagnostics] = useState<MercadoCoverageDiagnosticsResponse>();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string }>();
  const [sortKey, setSortKey] = useState<"absPearson" | "pearson" | "spearman" | "observations" | "coverage">("absPearson");
  const [matrixVariables, setMatrixVariables] = useState<string[]>(["precioOmie", "huecoTermico", "demandaResidual", "demandaPrevista", "eolica", "fotovoltaica", "termosolar", "nuclear"]);
  const [scatterX, setScatterX] = useState("huecoTermico");
  const [scatterY, setScatterY] = useState("precioOmie");
  const [activeSeries, setActiveSeries] = useState<string[]>(DEFAULT_SERIES);
  const [outlierFilter, setOutlierFilter] = useState("");

  const variableNames = useMemo(() => {
    const fromStats = Object.keys(analytics?.statistics ?? {});
    return unique([...CORE_VARIABLES, ...fromStats]);
  }, [analytics]);

  const ranking = useMemo(() => buildRanking(analytics, diagnostics, sortKey), [analytics, diagnostics, sortKey]);
  const incompleteVariables = useMemo(() => diagnostics?.variables.filter((item) => item.status !== "complete") ?? [], [diagnostics]);
  const unavailableVariables = useMemo(() => diagnostics?.variables.filter((item) => item.status === "absent" || item.status === "not_mapped" || item.status === "not_exposed") ?? [], [diagnostics]);
  const scatterRows = useMemo(() => buildScatterRows(analytics, scatterX, scatterY), [analytics, scatterX, scatterY]);
  const scatterR = useMemo(() => correlationFor(analytics, scatterX, scatterY), [analytics, scatterX, scatterY]);
  const outlierRows = useMemo(() => buildOutlierRows(analytics, outlierFilter), [analytics, outlierFilter]);

  useEffect(() => {
    void loadAnalytics();
  }, []);

  async function loadAnalytics() {
    setLoading(true);
    setMessage(undefined);
    try {
      const request = buildRequest(filters);
      const [nextAnalytics, nextDiagnostics] = await Promise.all([getMercadoAnalytics(request), getMercadoCoverageDiagnostics(request)]);
      setAnalytics(nextAnalytics);
      setDiagnostics(nextDiagnostics);
      setMessage({ tone: "success", text: "Mercado Analytics actualizado." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo cargar Mercado Analytics." });
    } finally {
      setLoading(false);
    }
  }

  function exportExcel() {
    if (!analytics) {
      return;
    }
    const html = buildAnalyticsExcelHtml(analytics, diagnostics);
    downloadBlob(`mercado-analytics-${filters.fechaDesde}-${filters.fechaHasta}.xls`, html, "application/vnd.ms-excel;charset=utf-8");
  }

  return (
    <section className="omie-layout omie-layout-a mercado-module mercado-analytics-module">
      <div className="panel wide omie-control-panel">
        <PanelTitle icon={<BarChart3 size={18} />} title="Mercado Analytics" subtitle="cuadro de mando exploratorio sobre precio OMIE e indicadores ESIOS" />
        <div className="omie-toolbar compact">
          <label className="filter-field">
            <span>Fecha desde</span>
            <input disabled={loading} onChange={(event) => setFilters((current) => ({ ...current, fechaDesde: event.target.value }))} type="date" value={filters.fechaDesde} />
          </label>
          <label className="filter-field">
            <span>Fecha hasta</span>
            <input disabled={loading} onChange={(event) => setFilters((current) => ({ ...current, fechaHasta: event.target.value }))} type="date" value={filters.fechaHasta} />
          </label>
          <label className="filter-field">
            <span>Geo ID</span>
            <input disabled={loading} inputMode="numeric" onChange={(event) => setFilters((current) => ({ ...current, geoId: event.target.value.replace(/\D/g, "") }))} placeholder="Auto" value={filters.geoId} />
          </label>
          <button className="primary-button" disabled={loading} onClick={loadAnalytics} type="button">
            <Search size={16} />
            Analizar
          </button>
          <button className="secondary-button" disabled={!analytics || loading} onClick={exportExcel} type="button">
            <Download size={16} />
            Excel
          </button>
        </div>
      </div>

      {message && <div className={`status-message ${message.tone}`}>{message.text}</div>}

      <div className="mercado-kpi-grid mercado-analytics-kpis">
        <MercadoKpi label="Cobertura base" value={pct(analytics?.qualityReport.baseCoveragePct)} tone={coverageTone(analytics?.qualityReport.baseCoveragePct)} />
        <MercadoKpi label="Cobertura derivada" value={pct(analytics?.qualityReport.derivedCoveragePct)} tone={coverageTone(analytics?.qualityReport.derivedCoveragePct)} />
        <MercadoKpi label="Horas analizadas" value={formatNumber(analytics?.datasetSummary.rows)} />
        <MercadoKpi label="Variables disponibles" value={formatNumber(ranking.filter((row) => row.status === "Completa" || row.status === "Parcial").length)} />
        <MercadoKpi label="Incompletas" value={formatNumber(incompleteVariables.length)} tone={incompleteVariables.length ? "warning" : "ok"} />
        <MercadoKpi label="No disponibles" value={formatNumber(unavailableVariables.length)} tone={unavailableVariables.length ? "danger" : "ok"} />
      </div>

      <section className="panel wide mercado-panel">
        <div className="mercado-panel-head">
          <PanelTitle icon={<TrendingUp size={18} />} title="Ranking de variables" subtitle="ordenado por relacion con precio OMIE" />
          <select className="mercado-mapping-select" value={sortKey} onChange={(event) => setSortKey(event.target.value as typeof sortKey)}>
            <option value="absPearson">|Pearson|</option>
            <option value="pearson">Pearson</option>
            <option value="spearman">Spearman</option>
            <option value="observations">Observaciones</option>
            <option value="coverage">Cobertura</option>
          </select>
        </div>
        <div className="mercado-table-shell mercado-ranking-shell">
          <table className="mercado-table mercado-analytics-table">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Pearson</th>
                <th>Spearman</th>
                <th>Observaciones</th>
                <th>Cobertura</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((row) => (
                <tr key={row.variable}>
                  <td><strong>{row.variable}</strong></td>
                  <td>{formatNullable(row.pearson, 3)}</td>
                  <td>{formatNullable(row.spearman, 3)}</td>
                  <td>{formatNumber(row.observations)}</td>
                  <td>{pct(row.coveragePct)}</td>
                  <td><span className={`ops-status-badge ${row.status === "Completa" ? "valid" : row.status === "Parcial" ? "partial" : "error"}`}>{row.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mercado-dashboard-grid two">
        <section className="panel mercado-panel">
          <PanelTitle icon={<Gauge size={18} />} title="Matriz de correlacion" subtitle="Pearson entre variables seleccionadas" />
          <div className="mercado-variable-chips">
            {variableNames.slice(0, 18).map((variable) => (
              <button
                className={matrixVariables.includes(variable) ? "active" : ""}
                key={variable}
                onClick={() => setMatrixVariables((current) => toggleValue(current, variable).slice(0, 10))}
                type="button"
              >
                {variable}
              </button>
            ))}
          </div>
          <EChart height={360} option={buildCorrelationHeatmapOption(analytics, matrixVariables)} />
        </section>

        <section className="panel mercado-panel">
          <PanelTitle icon={<BarChart3 size={18} />} title="Analisis temporal" subtitle="precio medio por hora, mes y tipo de dia" />
          <EChart height={360} option={buildTemporalOption(analytics)} />
        </section>
      </div>

      <div className="mercado-dashboard-grid two">
        <section className="panel mercado-panel">
          <div className="mercado-panel-head">
            <PanelTitle icon={<Search size={18} />} title="Scatter interactivo" subtitle={`R Pearson ${formatNullable(scatterR, 3)}`} />
            <div className="mercado-chart-controls">
              <select value={scatterX} onChange={(event) => setScatterX(event.target.value)}>{variableNames.map((item) => <option key={item}>{item}</option>)}</select>
              <select value={scatterY} onChange={(event) => setScatterY(event.target.value)}>{variableNames.map((item) => <option key={item}>{item}</option>)}</select>
            </div>
          </div>
          <EChart height={360} option={buildScatterOption(scatterRows, scatterX, scatterY, scatterR)} />
        </section>

        <section className="panel mercado-panel">
          <PanelTitle icon={<TrendingUp size={18} />} title="Series temporales" subtitle="precio, demanda, hueco termico y renovables" />
          <div className="mercado-variable-chips">
            {DEFAULT_SERIES.map((variable) => (
              <button className={activeSeries.includes(variable) ? "active" : ""} key={variable} onClick={() => setActiveSeries((current) => toggleValue(current, variable))} type="button">
                {variable}
              </button>
            ))}
          </div>
          <EChart height={360} option={buildTimeSeriesOption(analytics, activeSeries)} />
        </section>
      </div>

      <section className="panel wide mercado-panel">
        <PanelTitle icon={<Table2 size={18} />} title="Calidad del dataset" subtitle="cobertura, disponibilidad y huecos por variable" />
        <div className="mercado-table-shell">
          <table className="mercado-table mercado-analytics-table">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Estado</th>
                <th>Cobertura</th>
                <th>Registros</th>
                <th>Faltantes</th>
                <th>Primer dato</th>
                <th>Ultimo dato</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {(diagnostics?.variables ?? []).map((row) => (
                <tr key={row.variable}>
                  <td><strong>{row.variable}</strong><small>{row.indicatorId ? `${row.indicatorId} ${row.indicatorName ?? ""}` : "-"}</small></td>
                  <td><span className={`ops-status-badge ${row.status === "complete" ? "valid" : row.status === "partial" ? "partial" : "error"}`}>{row.status}</span></td>
                  <td><CoverageBar value={row.coveragePct} /></td>
                  <td>{formatNumber(row.matchedRecords)}</td>
                  <td>{formatNumber(row.missingHoursCount)}</td>
                  <td>{formatDateShort(row.firstAvailable)}</td>
                  <td>{formatDateShort(row.lastAvailable)}</td>
                  <td>{row.probableReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel wide mercado-panel">
        <div className="mercado-panel-head">
          <PanelTitle icon={<AlertTriangle size={18} />} title="Anomalias" subtitle="valores extremos y horas incompletas" />
          <input className="mercado-anomaly-filter" placeholder="Filtrar variable" value={outlierFilter} onChange={(event) => setOutlierFilter(event.target.value)} />
        </div>
        <div className="mercado-table-shell">
          <table className="mercado-table mercado-analytics-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Variable</th>
                <th>Fecha</th>
                <th>Valor</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {outlierRows.slice(0, 300).map((row, index) => (
                <tr key={`${row.type}-${row.variable}-${row.timestampUtc}-${index}`}>
                  <td>{row.type}</td>
                  <td><strong>{row.variable}</strong></td>
                  <td>{formatDateShort(row.timestampUtc)}</td>
                  <td>{formatNullable(row.value, 2)}</td>
                  <td>{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function MercadoKpi({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warning" | "danger" }) {
  return (
    <div className={`technical-kpi ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildRequest(filters: MercadoAnalyticsFilters) {
  return {
    fechaDesde: filters.fechaDesde,
    fechaHasta: filters.fechaHasta,
    ...(filters.geoId ? { geoId: filters.geoId } : {})
  };
}

function buildRanking(analytics: MercadoAnalyticsResponse | undefined, diagnostics: MercadoCoverageDiagnosticsResponse | undefined, sortKey: string) {
  const correlationByVariable = new Map((analytics?.correlations.withPrecioOmie ?? []).map((item) => [item.variable, item]));
  const diagnosticByVariable = new Map((diagnostics?.variables ?? []).map((item) => [item.variable, item]));
  const variables = unique([...Object.keys(analytics?.statistics ?? {}), ...(diagnostics?.variables ?? []).map((item) => item.variable)]).filter((variable) => variable !== "precioOmie");
  return variables
    .map((variable) => {
      const stat = analytics?.statistics[variable];
      const corr = correlationByVariable.get(variable);
      const diagnostic = diagnosticByVariable.get(variable);
      const derived = analytics?.derivedVariables.find((item) => item.variable === variable);
      const coveragePct = stat?.coveragePct ?? diagnostic?.coveragePct ?? derived?.coveragePct ?? 0;
      return {
        variable,
        pearson: corr?.pearson ?? null,
        spearman: corr?.spearman ?? null,
        observations: corr?.observations ?? stat?.observations ?? 0,
        coveragePct,
        status: coveragePct >= 99.9 ? "Completa" : coveragePct > 0 ? "Parcial" : "No calculable"
      };
    })
    .sort((left, right) => sortValue(right, sortKey) - sortValue(left, sortKey));
}

function sortValue(row: { pearson: number | null; spearman: number | null; observations: number; coveragePct: number }, sortKey: string) {
  if (sortKey === "pearson") return row.pearson ?? -Infinity;
  if (sortKey === "spearman") return row.spearman ?? -Infinity;
  if (sortKey === "observations") return row.observations;
  if (sortKey === "coverage") return row.coveragePct;
  return Math.abs(row.pearson ?? 0);
}

function buildCorrelationHeatmapOption(analytics: MercadoAnalyticsResponse | undefined, variables: string[]): EChartsOption {
  const matrix = analytics?.correlations.matrix ?? [];
  const rows = variables.flatMap((left, y) =>
    variables.map((right, x) => {
      const value = matrix.find((item) => item.variable === left)?.correlations[right]?.pearson ?? null;
      return [x, y, value === null ? "-" : Number(value.toFixed(3))];
    })
  );
  return {
    tooltip: { position: "top" },
    grid: { left: 100, right: 20, top: 30, bottom: 80 },
    xAxis: { type: "category", data: variables, axisLabel: { rotate: 45, interval: 0 } },
    yAxis: { type: "category", data: variables },
    visualMap: { min: -1, max: 1, calculable: true, orient: "horizontal", left: "center", bottom: 0, inRange: { color: ["#2d6cdf", "#f7f9fb", "#d04a3a"] } },
    series: [{ type: "heatmap", data: rows, label: { show: false }, emphasis: { itemStyle: { shadowBlur: 8 } } }]
  };
}

function buildTemporalOption(analytics: MercadoAnalyticsResponse | undefined): EChartsOption {
  const byHour = analytics?.timeAnalysis.byHour ?? [];
  const byMonth = analytics?.timeAnalysis.byMonth ?? [];
  const byDayType = analytics?.timeAnalysis.byDayType ?? [];
  return {
    tooltip: { trigger: "axis" },
    legend: { top: 0 },
    grid: [{ left: 48, right: 20, top: 44, height: 85 }, { left: 48, right: 20, top: 170, height: 85 }, { left: 48, right: 20, top: 296, height: 40 }],
    xAxis: [
      { type: "category", gridIndex: 0, data: byHour.map((item) => item.label) },
      { type: "category", gridIndex: 1, data: byMonth.map((item) => item.label) },
      { type: "category", gridIndex: 2, data: byDayType.map((item) => item.label) }
    ],
    yAxis: [{ type: "value", gridIndex: 0 }, { type: "value", gridIndex: 1 }, { type: "value", gridIndex: 2 }],
    series: [
      { name: "Hora", type: "line", xAxisIndex: 0, yAxisIndex: 0, data: byHour.map((item) => item.means.precioOmie) },
      { name: "Mes", type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: byMonth.map((item) => item.means.precioOmie) },
      { name: "Tipo dia", type: "bar", xAxisIndex: 2, yAxisIndex: 2, data: byDayType.map((item) => item.means.precioOmie) }
    ]
  };
}

function buildScatterRows(analytics: MercadoAnalyticsResponse | undefined, x: string, y: string) {
  return (analytics?.chartData.timeSeries ?? [])
    .map((row) => ({ x: row.values[x], y: row.values[y], timestampUtc: row.timestampUtc }))
    .filter((row): row is { x: number; y: number; timestampUtc: string } => typeof row.x === "number" && typeof row.y === "number");
}

function buildScatterOption(rows: Array<{ x: number; y: number; timestampUtc: string }>, x: string, y: string, r: number | null): EChartsOption {
  const trend = linearTrend(rows);
  return {
    tooltip: { trigger: "item", formatter: (params: unknown) => scatterTooltip(params, x, y) },
    grid: { left: 58, right: 22, top: 30, bottom: 45 },
    xAxis: { type: "value", name: x },
    yAxis: { type: "value", name: y },
    series: [
      { name: `R ${formatNullable(r, 3)}`, type: "scatter", symbolSize: 5, data: rows.map((row) => [row.x, row.y, row.timestampUtc]) },
      ...(trend ? [{ name: "Tendencia", type: "line" as const, symbol: "none", data: trend, lineStyle: { color: "#d04a3a", width: 2 } }] : [])
    ]
  };
}

function buildTimeSeriesOption(analytics: MercadoAnalyticsResponse | undefined, variables: string[]): EChartsOption {
  const rows = analytics?.chartData.timeSeries ?? [];
  return {
    tooltip: { trigger: "axis" },
    legend: { top: 0 },
    grid: { left: 58, right: 22, top: 44, bottom: 44 },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 8 }],
    xAxis: { type: "category", data: rows.map((row) => row.datetimeLocal) },
    yAxis: { type: "value" },
    series: variables.map((variable) => ({ name: variable, type: "line", showSymbol: false, data: rows.map((row) => row.values[variable]) }))
  };
}

function buildOutlierRows(analytics: MercadoAnalyticsResponse | undefined, filter: string) {
  const normalized = filter.trim().toLowerCase();
  const rows = Object.entries(analytics?.outliers.byVariable ?? {}).flatMap(([variable, report]) =>
    report.examples.map((example) => ({
      type: "Extremo",
      variable,
      timestampUtc: String(example.timestampUtc ?? ""),
      value: typeof example.value === "number" ? example.value : null,
      detail: `umbral ${formatNullable(example.low as number | null, 2)} / ${formatNullable(example.high as number | null, 2)}`
    }))
  );
  const incomplete = (analytics?.outliers.incompleteHours ?? []).map((row) => ({
    type: "Incompleta",
    variable: row.missingVariables.join(", "),
    timestampUtc: row.timestampUtc,
    value: null,
    detail: row.status
  }));
  return [...rows, ...incomplete].filter((row) => !normalized || row.variable.toLowerCase().includes(normalized));
}

function correlationFor(analytics: MercadoAnalyticsResponse | undefined, x: string, y: string) {
  if (!analytics) return null;
  if (y === "precioOmie") return analytics.correlations.withPrecioOmie.find((item) => item.variable === x)?.pearson ?? null;
  if (x === "precioOmie") return analytics.correlations.withPrecioOmie.find((item) => item.variable === y)?.pearson ?? null;
  return analytics.correlations.matrix.find((item) => item.variable === x)?.correlations[y]?.pearson ?? null;
}

function CoverageBar({ value }: { value: number }) {
  return (
    <div className="mercado-coverage-bar">
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      <strong>{pct(value)}</strong>
    </div>
  );
}

function buildAnalyticsExcelHtml(analytics: MercadoAnalyticsResponse, diagnostics: MercadoCoverageDiagnosticsResponse | undefined) {
  const ranking = buildRanking(analytics, diagnostics, "absPearson");
  const outliers = buildOutlierRows(analytics, "");
  return `<!doctype html><html><meta charset="utf-8"><body>${tableHtml("Ranking", ranking)}${tableHtml("Cobertura", diagnostics?.variables ?? [])}${tableHtml("Anomalias", outliers)}</body></html>`;
}

function tableHtml(title: string, rows: object[]) {
  const columns = Object.keys(rows[0] ?? {});
  return `<h2>${escapeHtml(title)}</h2><table border="1"><thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => {
      const record = row as Record<string, unknown>;
      return `<tr>${columns.map((column) => `<td>${escapeHtml(String(record[column] ?? ""))}</td>`).join("")}</tr>`;
    })
    .join("")}</tbody></table>`;
}

function linearTrend(rows: Array<{ x: number; y: number }>) {
  if (rows.length < 2) return null;
  const xMean = rows.reduce((sum, row) => sum + row.x, 0) / rows.length;
  const yMean = rows.reduce((sum, row) => sum + row.y, 0) / rows.length;
  const denominator = rows.reduce((sum, row) => sum + (row.x - xMean) ** 2, 0);
  if (denominator === 0) return null;
  const slope = rows.reduce((sum, row) => sum + (row.x - xMean) * (row.y - yMean), 0) / denominator;
  const intercept = yMean - slope * xMean;
  const xs = [Math.min(...rows.map((row) => row.x)), Math.max(...rows.map((row) => row.x))];
  return xs.map((x) => [x, slope * x + intercept]);
}

function scatterTooltip(params: unknown, x: string, y: string) {
  const value = (params as { value?: unknown[] }).value ?? [];
  return `${x}: ${formatNullable(Number(value[0]), 2)}<br/>${y}: ${formatNullable(Number(value[1]), 2)}<br/>${value[2] ?? ""}`;
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function pct(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : `${formatDecimalNumber(value, 2)}%`;
}

function formatNullable(value: number | null | undefined, decimals = 2) {
  return typeof value === "number" && Number.isFinite(value) ? formatDecimalNumber(value, decimals) : "-";
}

function coverageTone(value?: number) {
  if (value === undefined) return undefined;
  if (value >= 95) return "ok";
  if (value >= 75) return "warning";
  return "danger";
}

function formatDateShort(value: string | null | undefined) {
  return value ? value.replace("T", " ").slice(0, 16) : "-";
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
