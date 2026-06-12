import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, BarChart3, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clipboard, Database, FileClock, FileDown, Gauge, RefreshCw, Search, TrendingUp, UploadCloud, RotateCcw } from "lucide-react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import { InlineLoading } from "../../GlobalLoadingOverlay";
import { TechnicalDataTable } from "../../components/technical-data-table/TechnicalDataTable";
import type { TechnicalColumn } from "../../components/technical-data-table/TechnicalDataTableTypes";
import type { ReeLossesAnnualSummaryRow, ReeLossesAnalyticsSummary, ReeLossesFilterOptions, ReeLossesFilters, ReeLossesImportFile, ReeLossesImportResponse, ReeLossesReport, ReeLossesRow } from "../../api";
import type { ReeLossesViewKey, LoadStatus } from "../../app-shell/AppShellTypes";
import { buildReeLossesAnalyticsScopeLabel, buildReeLossesAnnualColumns, buildReeLossesEvolutionOption, buildReeLossesHeatmapScopeLabel, buildReeLossesHistoryCharts, buildReeLossesHistoryKpis, buildReeLossesKpis, buildReeLossesLatestAnnualScopeLabel, buildReeLossesRowsScopeLabel, buildReeLossesSummaryHeatmapOption, buildReeLossesTotalsRow, buildReeLossesVersionCompareOption, buildReeLossesVersionSourceCompareOption, compareReeLossesLoads, exportReeLossesLoadCsv, formatAnomalyLabel, formatDateTime, formatFactor, formatFullDate, formatLossPercent, formatMonthKeyLabel, formatNumber, formatSignedLossPercent, getReeLossesImportPeriodKey, getReeLossesImportPeriodLabel, getReeLossesLoadStatus, reeLossesQuality, buildReeLossesPeriodDistributionFromAnnualOption, pivotReeLossesAnnualRows, anomalyBadgeTone } from "./ReeLossesHelpers";
import type { ReeLossesLoadSortKey } from "./ReeLossesTypes";

const SEARCHABLE_SELECT_THRESHOLD = 24;

export function ReeLossesFilterBand({
  filters,
  options,
  onChange,
  onApply,
  disabled = false,
  showVersion = true
}: {
  filters: ReeLossesFilters;
  options?: ReeLossesFilterOptions;
  onChange: (key: keyof ReeLossesFilters, value: string) => void;
  onApply: () => void;
  disabled?: boolean;
  showVersion?: boolean;
}) {
  const loadingOptions = !options;

  return (
    <section className={`filter-band ree-losses-filter-band ${showVersion ? "" : "no-version"}`}>
      {showVersion && <FilterSelect disabled={disabled} loading={loadingOptions} label="Versión" value={filters.version ?? ""} options={options?.versions ?? []} onChange={(value) => onChange("version", value)} />}
      <FilterSelect disabled={disabled} loading={loadingOptions} label="Mes" value={filters.mes ?? ""} options={options?.months ?? []} onChange={(value) => onChange("mes", value)} />
      <FilterSelect disabled={disabled} loading={loadingOptions} label="Tarifa" value={filters.tarifa ?? ""} options={options?.tarifas ?? []} onChange={(value) => onChange("tarifa", value)} />
      <FilterSelect disabled={disabled} loading={loadingOptions} label="Periodo" value={filters.periodo ?? ""} options={options?.periodos ?? []} onChange={(value) => onChange("periodo", value)} />
      <DateFilterField disabled={disabled} label="Fecha inicio" value={filters.fechaInicio ?? ""} onChange={(value) => onChange("fechaInicio", value)} />
      <DateFilterField disabled={disabled} label="Fecha fin" value={filters.fechaFin ?? ""} onChange={(value) => onChange("fechaFin", value)} />
      <button className="secondary-button" disabled={disabled || loadingOptions} onClick={onApply} type="button">
        <Search size={16} />
        Filtrar
      </button>
    </section>
  );
}

export function ReeLossesView({
  view,
  imports,
  report,
  loading,
  latestImport,
  onRefreshHistory
}: {
  view: ReeLossesViewKey;
  imports: ReeLossesImportFile[];
  report?: ReeLossesReport;
  loading: boolean;
  latestImport?: ReeLossesImportResponse;
  onRefreshHistory?: () => Promise<void> | void;
}) {
  const rows = report?.rows ?? [];

  if (view === "history") {
    return <ReeLossesHistoryModule files={imports} loading={loading} latestImport={latestImport} onRefresh={onRefreshHistory} />;
  }

  if (!report && loading) {
    return <section className="content-grid"><div className="panel wide"><InlineLoading label="Cargando perdidas REE" /></div></section>;
  }

  if (!report) {
    return (
      <section className="content-grid">
        <div className="panel wide">
          <div className="empty-state">Sin datos cargados de KESTIMQH/KREALQH.</div>
        </div>
      </section>
    );
  }

  if (view === "detail") {
    return <ReeLossesDetailModule rows={rows} loading={loading} />;
  }

  return <ReeLossesSystemModule report={report} rows={rows} loading={loading} latestImport={latestImport} />;
}

function ReeLossesHistoryModule({
  files,
  loading,
  latestImport,
  onRefresh
}: {
  files: ReeLossesImportFile[];
  loading: boolean;
  latestImport?: ReeLossesImportResponse;
  onRefresh?: () => Promise<void> | void;
}) {
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState("");
  const [fileType, setFileType] = useState("");
  const [loadDate, setLoadDate] = useState("");
  const [period, setPeriod] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [compact, setCompact] = useState(true);
  const [sortKey, setSortKey] = useState<ReeLossesLoadSortKey>("importedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [tablePage, setTablePage] = useState(0);
  const versionOptions = useMemo(() => [...new Set(files.map((file) => file.version).filter(Boolean))].sort(), [files]);
  const typeOptions = useMemo(() => [...new Set(files.map((file) => file.tipoArchivo).filter(Boolean))].sort(), [files]);
  const filteredFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return files
      .filter((file) => {
        const filePeriod = getReeLossesImportPeriodKey(file);
        const importedDate = file.importedAt.slice(0, 10);
        const haystack = [
          file.fileName,
          file.tipoArchivo ?? "",
          file.version ?? "",
          filePeriod,
          importedDate,
          file.errorMessage ?? ""
        ].join(" ").toLowerCase();
        if (normalizedQuery && !haystack.includes(normalizedQuery)) {
          return false;
        }
        if (version && file.version !== version) {
          return false;
        }
        if (fileType && file.tipoArchivo !== fileType) {
          return false;
        }
        if (loadDate && importedDate !== loadDate) {
          return false;
        }
        if (period && !filePeriod.includes(period)) {
          return false;
        }
        if (onlyErrors && file.invalidRecords === 0 && file.status !== "FAILED") {
          return false;
        }
        return true;
      })
      .sort((left, right) => compareReeLossesLoads(left, right, sortKey, sortDirection));
  }, [fileType, files, loadDate, onlyErrors, period, query, sortDirection, sortKey, version]);
  const tablePageSize = compact ? 12 : 8;
  const pagedFiles = filteredFiles.slice(tablePage * tablePageSize, tablePage * tablePageSize + tablePageSize);
  const pageCount = Math.max(Math.ceil(filteredFiles.length / tablePageSize), 1);
  const kpis = buildReeLossesHistoryKpis(files, latestImport);
  const chartData = buildReeLossesHistoryCharts(files);

  useEffect(() => {
    if (tablePage > pageCount - 1) {
      setTablePage(Math.max(pageCount - 1, 0));
    }
  }, [pageCount, tablePage]);

  function resetFilters() {
    setQuery("");
    setVersion("");
    setFileType("");
    setLoadDate("");
    setPeriod("");
    setOnlyErrors(false);
    setTablePage(0);
  }

  function toggleSort(nextKey: ReeLossesLoadSortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      setSortDirection(nextKey === "fileName" || nextKey === "status" || nextKey === "type" ? "asc" : "desc");
    }
  }

  return (
    <section className="ops-dashboard">
      <div className="ops-hero">
        <div>
          <p className="ops-eyebrow">Pérdidas REE · Histórico</p>
          <h2>Histórico de cargas K REE</h2>
          <span>Supervisión de ficheros KESTIMQH/KREALQH, estado de carga y trazabilidad de registros usados en pérdidas.</span>
        </div>
        <div className="ops-hero-actions">
          <button className="ops-primary-button" onClick={() => exportReeLossesLoadCsv("cargas-perdidas-ree.csv", filteredFiles)} type="button">
            <FileDown size={17} />
            Exportar cargas
          </button>
          <button className="ops-secondary-button" disabled={loading} onClick={() => void onRefresh?.()} type="button">
            <RefreshCw size={17} />
            Actualizar
          </button>
        </div>
      </div>

      <div className="ops-kpi-grid">
        {kpis.map((kpi) => (
          <div className={`ops-kpi-card ${kpi.tone}`} key={kpi.label}>
            <div className="ops-kpi-icon">{kpiIcon(kpi.label)}</div>
            <span>{kpi.label}</span>
            <strong>{kpi.value}</strong>
            <small>{kpi.detail}</small>
          </div>
        ))}
      </div>

      <div className="ops-workbench">
        <div className="ops-drop-panel">
          <div className="ops-drop-icon">
            <UploadCloud size={24} />
          </div>
          <div>
            <strong>Importación rápida</strong>
            <span>Arrastra ficheros KESTIMQH/KREALQH en la zona superior y selecciona el modo K REE.</span>
          </div>
          <div className="ops-progress-track">
            <span style={{ width: `${Math.min(100, Math.max(8, latestImport ? 100 : 18))}%` }} />
          </div>
          <small>{latestImport ? `${latestImport.summary.recordsImported} registros K en la última carga` : "Sin carga reciente en esta sesión"}</small>
        </div>
        <OpsMiniChart title="Evolución cargas" rows={chartData.monthlyLoads} valueLabel="cargas" tone="cyan" />
        <OpsMiniChart title="Inválidos por mes" rows={chartData.monthlyInvalids} valueLabel="incidencias" tone="rose" />
        <OpsMiniChart title="Volumen por tipo" rows={chartData.byType} valueLabel="registros" tone="emerald" />
      </div>

      <div className="ops-filter-bar">
        <label className="ops-search">
          <Search size={16} />
          <input value={query} onChange={(event) => { setQuery(event.target.value); setTablePage(0); }} placeholder="Buscar archivo, tipo, version..." />
        </label>
        <select value={version} onChange={(event) => { setVersion(event.target.value); setTablePage(0); }}>
          <option value="">Todas las versiones</option>
          {versionOptions.map((item) => (
            <option key={item} value={item ?? ""}>{item}</option>
          ))}
        </select>
        <select value={fileType} onChange={(event) => { setFileType(event.target.value); setTablePage(0); }}>
          <option value="">Todos los tipos</option>
          {typeOptions.map((item) => (
            <option key={item} value={item ?? ""}>{item}</option>
          ))}
        </select>
        <input type="date" value={loadDate} onChange={(event) => { setLoadDate(event.target.value); setTablePage(0); }} />
        <input value={period} onChange={(event) => { setPeriod(event.target.value); setTablePage(0); }} placeholder="Periodo YYYY-MM" />
        <button className={onlyErrors ? "active" : ""} onClick={() => { setOnlyErrors((current) => !current); setTablePage(0); }} type="button">Solo errores</button>
        <button onClick={resetFilters} type="button">
          <RotateCcw size={15} />
        </button>
      </div>

      <div className="ops-table-panel">
        <div className="ops-table-head">
          <div>
            <strong>Cargas de pérdidas REE</strong>
            <span>{filteredFiles.length} ficheros filtrados</span>
          </div>
          <div className="ops-view-toggle">
            <button className={compact ? "active" : ""} onClick={() => setCompact(true)} type="button">Compacto</button>
            <button className={!compact ? "active" : ""} onClick={() => setCompact(false)} type="button">Cómodo</button>
          </div>
        </div>

        {loading && files.length === 0 ? (
          <InlineLoading label="Cargando histórico de pérdidas REE" />
        ) : (
          <ReeLossesLoadsTable
            compact={compact}
            files={pagedFiles}
            sortDirection={sortDirection}
            sortKey={sortKey}
            onSort={toggleSort}
          />
        )}

        <div className="ops-pagination">
          <span>Página {tablePage + 1} de {pageCount}</span>
          <button disabled={tablePage === 0} onClick={() => setTablePage((current) => Math.max(0, current - 1))} type="button">
            <ChevronLeft size={16} />
          </button>
          <button disabled={tablePage >= pageCount - 1} onClick={() => setTablePage((current) => Math.min(pageCount - 1, current + 1))} type="button">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}

function ReeLossesLoadsTable({
  files,
  compact,
  sortKey,
  sortDirection,
  onSort
}: {
  files: ReeLossesImportFile[];
  compact: boolean;
  sortKey: ReeLossesLoadSortKey;
  sortDirection: "asc" | "desc";
  onSort: (key: ReeLossesLoadSortKey) => void;
}) {
  const header = [
    { key: "status" as const, label: "Estado" },
    { key: "type" as const, label: "Tipo" },
    { key: "period" as const, label: "Periodo" },
    { key: "fileName" as const, label: "Archivo" },
    { key: "totalRecords" as const, label: "Registros" },
    { key: "validRecords" as const, label: "Válidos" },
    { key: "invalidRecords" as const, label: "Inválidos" },
    { key: "duplicatedRecords" as const, label: "Duplicados" },
    { key: "importedAt" as const, label: "Fecha carga" }
  ];

  return (
    <div className={`ops-load-table ${compact ? "compact" : ""}`}>
      <div className="ops-load-row ops-load-header">
        <span className="ops-select-cell" />
        {header.map((column) => (
          <button className={sortKey === column.key ? "sorted" : ""} key={column.key} onClick={() => onSort(column.key)} type="button">
            {column.label}
            {sortKey === column.key && <small>{sortDirection === "asc" ? "↑" : "↓"}</small>}
          </button>
        ))}
        <span>Observaciones</span>
      </div>
      {files.map((file) => (
        <div className="ops-load-row" key={file.id}>
          <span className="ops-select-cell" />
          <span><LoadStatusBadge status={getReeLossesLoadStatus(file)} /></span>
          <span>{file.version ?? "-"}</span>
          <span>{getReeLossesImportPeriodLabel(file)}</span>
          <span className="ops-file-cell" title={file.fileName}>{file.fileName}</span>
          <span className="ops-number-cell">{file.totalRecords.toLocaleString("es-ES")}</span>
          <span className="ops-number-cell good">{file.validRecords.toLocaleString("es-ES")}</span>
          <span className="ops-number-cell danger">{file.invalidRecords.toLocaleString("es-ES")}</span>
          <span className="ops-number-cell warning">{file.duplicatedRecords.toLocaleString("es-ES")}</span>
          <span>{formatDateTime(file.importedAt)}</span>
          <span className="ops-file-cell" title={file.errorMessage ?? file.tipoArchivo ?? ""}>{file.errorMessage ?? file.tipoArchivo ?? "-"}</span>
        </div>
      ))}
      {files.length === 0 && <div className="ops-empty">Sin cargas de pérdidas REE con los filtros seleccionados.</div>}
    </div>
  );
}

function ReeLossesSystemModule({
  report,
  rows,
  loading,
  latestImport
}: {
  report: ReeLossesReport;
  rows: ReeLossesRow[];
  loading: boolean;
  latestImport?: ReeLossesImportResponse;
}) {
  return (
    <section className="content-grid ree-losses-grid">
      <div className="panel wide liquidation-summary-panel">
        <PanelTitle icon={<Gauge size={18} />} title="Sistema peninsular" />
        <div className="technical-kpis liquidation-kpis">
          {buildReeLossesKpis(report).map((kpi) => (
            <div className={`technical-kpi ${kpi.tone ?? "neutral"}`} key={kpi.label}>
              <span>{kpi.label}</span>
              <strong>{kpi.value}</strong>
              {kpi.meta && <small>{kpi.meta}</small>}
            </div>
          ))}
        </div>
        {latestImport && <div className="energy-chart-insight"><span>Ultima carga: {formatNumber(latestImport.summary.recordsImported)} registros K procesados.</span></div>}
      </div>

      {loading && rows.length === 0 ? (
        <div className="panel wide"><InlineLoading label="Actualizando perdidas REE" /></div>
      ) : rows.length > 0 ? (
        <ReeLossesEvolutionPanel rows={rows} />
      ) : (
        <div className="panel wide"><div className="empty-state">Sin registros para los filtros seleccionados.</div></div>
      )}
    </section>
  );
}

function ReeLossesDetailModule({ rows, loading }: { rows: ReeLossesRow[]; loading: boolean }) {
  const columns = useMemo<Array<TechnicalColumn<ReeLossesRow>>>(
    () => [
      { id: "fecha", label: "Fecha", width: 116, sticky: true, type: "date", filter: "text", heatmap: false, value: (row) => row.fecha, render: (row) => formatFullDate(row.fecha) },
      { id: "hora", label: "Hora", width: 76, sticky: true, align: "right", type: "number", filter: "select", heatmap: false, value: (row) => row.hora },
      { id: "cuartohora", label: "QH", width: 68, sticky: true, align: "right", type: "number", filter: "select", heatmap: false, value: (row) => row.cuartohora },
      { id: "tarifa", label: "Tarifa", width: 96, filter: "select", heatmap: false, value: (row) => row.tarifa },
      { id: "periodo", label: "Periodo", width: 92, filter: "select", heatmap: false, value: (row) => row.periodo },
      { id: "perdidaBoe", label: "Perdida BOE", width: 126, align: "right", type: "number", filter: "number", heatmap: false, value: (row) => row.perdidaBoe, render: (row) => formatLossPercent(row.perdidaBoe) },
      { id: "factorK", label: "Factor K", width: 112, align: "right", type: "number", filter: "number", value: (row) => row.factorKAplicado, render: (row) => formatFactor(row.factorKAplicado) },
      { id: "perdidaFinal", label: "Perdida final", width: 126, align: "right", type: "number", filter: "number", value: (row) => row.perdidaFinal, render: (row) => formatLossPercent(row.perdidaFinal) },
      { id: "diferenciaVsBoe", label: "Dif. BOE", width: 112, align: "right", type: "number", filter: "number", heatmapTone: "risk", value: (row) => row.diferenciaVsBoe, render: (row) => formatLossPercent(row.diferenciaVsBoe) },
      { id: "diferenciaPct", label: "Dif. %", width: 104, align: "right", type: "number", filter: "number", heatmapTone: "risk", value: (row) => row.diferenciaPct, render: (row) => formatSignedLossPercent(row.diferenciaPct) },
      { id: "tipo", label: "Tipo fichero", width: 118, filter: "select", heatmap: false, value: (row) => row.tipoFicheroUtilizado },
      { id: "version", label: "Version", width: 88, filter: "select", heatmap: false, value: (row) => row.version },
      { id: "versionBoe", label: "BOE", width: 120, advanced: true, filter: "select", heatmap: false, value: (row) => row.versionBoe },
      { id: "anomalias", label: "Anomalias", width: 240, advanced: true, filter: "text", heatmap: false, value: (row) => row.anomalies.join(" "), render: (row) => <LossAnomalyBadges anomalies={row.anomalies} /> }
    ],
    []
  );

  return (
    <section className="content-grid ree-losses-grid">
      {loading && rows.length === 0 ? (
        <div className="panel wide"><InlineLoading label="Actualizando detalle de perdidas REE" /></div>
      ) : rows.length > 0 ? (
        <TechnicalDataTable
          columns={columns}
          exportFileName="analisis-perdidas-ree"
          getDuplicateKey={(row) => [row.fecha, row.hora, row.cuartohora, row.tarifa, row.periodo, row.version].join("|")}
          getGroupLabel={(row) => `${formatFullDate(row.fecha)} · ${row.tarifa}`}
          getRowId={(row) => row.id}
          getRowQuality={reeLossesQuality}
          hasNext={false}
          kpis={[]}
          loading={loading}
          onPageChange={() => undefined}
          onPageSizeChange={() => undefined}
          page={0}
          pageSize={Math.max(rows.length, 1)}
          rows={rows}
          showPagination={false}
          title="Detalle de perdidas REE"
          getTotalsRow={buildReeLossesTotalsRow}
        />
      ) : (
        <div className="panel wide"><div className="empty-state">Sin registros para los filtros seleccionados.</div></div>
      )}
    </section>
  );
}

function ReeLossesAnalyticsModule({
  report,
  analyticsSummary,
  rows,
  loading,
  latestImport
}: {
  report: ReeLossesReport;
  analyticsSummary?: ReeLossesAnalyticsSummary;
  rows: ReeLossesRow[];
  loading: boolean;
  latestImport?: ReeLossesImportResponse;
}) {
  const hasAnalyticsData = Boolean(analyticsSummary && (analyticsSummary.annualPeriodRows.length > 0 || analyticsSummary.heatmapRows.length > 0));

  return (
    <section className="content-grid ree-losses-grid">
      <div className="panel wide liquidation-summary-panel">
        <PanelTitle icon={<AlertTriangle size={18} />} title="Analisis automatico" />
        <div className="energy-chart-insight">
          {(report.anomalies.length > 0 ? report.anomalies : ["No hay anomalias relevantes."]).map((message) => (
            <span key={message}>{message}</span>
          ))}
          {latestImport && <span>Ultima carga: {formatNumber(latestImport.summary.recordsImported)} registros K procesados.</span>}
        </div>
      </div>

      {loading && !analyticsSummary ? (
        <div className="panel wide"><InlineLoading label="Actualizando analitica de perdidas REE" /></div>
      ) : hasAnalyticsData && analyticsSummary ? (
        <>
          <ReeLossesAnnualSummaryTable rows={analyticsSummary.annualPeriodRows} />
          <ReeLossesAnalyticsCharts summary={analyticsSummary} fallbackRows={rows} />
        </>
      ) : (
        <div className="panel wide"><div className="empty-state">Sin registros para los filtros seleccionados.</div></div>
      )}
    </section>
  );
}

function ReeLossesEvolutionPanel({ rows }: { rows: ReeLossesRow[] }) {
  const evolution = useMemo<EChartsOption>(() => buildReeLossesEvolutionOption(rows), [rows]);
  const scope = useMemo(() => buildReeLossesRowsScopeLabel(rows), [rows]);

  return (
    <div className="panel wide">
      <PanelTitle icon={<TrendingUp size={18} />} title="Evolucion temporal" subtitle={scope} />
      <EChart option={evolution} height={360} />
    </div>
  );
}

function ReeLossesAnalyticsCharts({ summary, fallbackRows }: { summary: ReeLossesAnalyticsSummary; fallbackRows: ReeLossesRow[] }) {
  const heatmap = useMemo<EChartsOption>(() => buildReeLossesSummaryHeatmapOption(summary), [summary]);
  const sourceCompare = useMemo<EChartsOption>(() => buildReeLossesVersionSourceCompareOption(summary.versionComparison), [summary.versionComparison]);
  const versionCompare = useMemo<EChartsOption>(() => buildReeLossesVersionCompareOption(fallbackRows), [fallbackRows]);
  const periodDistribution = useMemo<EChartsOption>(() => buildReeLossesPeriodDistributionFromAnnualOption(summary.annualPeriodRows), [summary.annualPeriodRows]);
  const heatmapScope = useMemo(() => buildReeLossesHeatmapScopeLabel(summary), [summary]);
  const summaryScope = useMemo(() => buildReeLossesAnalyticsScopeLabel(summary), [summary]);
  const latestAnnualScope = useMemo(() => buildReeLossesLatestAnnualScopeLabel(summary.annualPeriodRows, summary.months), [summary.annualPeriodRows, summary.months]);
  const fallbackScope = useMemo(() => buildReeLossesRowsScopeLabel(fallbackRows), [fallbackRows]);

  return (
    <>
      <div className="panel">
        <PanelTitle icon={<BarChart3 size={18} />} title="Heatmap horario" subtitle={heatmapScope} />
        <EChart option={heatmap} height={340} />
      </div>
      <div className="panel">
        <PanelTitle icon={<BarChart3 size={18} />} title="BOE vs versiones" subtitle={summaryScope} />
        <EChart option={sourceCompare} height={340} />
      </div>
      <div className="panel">
        <PanelTitle icon={<TrendingUp size={18} />} title="Comparativa versiones" subtitle={fallbackScope} />
        <EChart option={versionCompare} height={340} />
      </div>
      <div className="panel wide">
        <PanelTitle icon={<BarChart3 size={18} />} title="Distribucion por periodo y tarifa" subtitle={latestAnnualScope} />
        <EChart option={periodDistribution} height={540} />
      </div>
    </>
  );
}

function ReeLossesAnnualSummaryTable({ rows }: { rows: ReeLossesAnnualSummaryRow[] }) {
  const pivotRows = useMemo(() => pivotReeLossesAnnualRows(rows), [rows]);
  const columns = useMemo(() => buildReeLossesAnnualColumns(rows), [rows]);
  const scope = useMemo(() => buildReeLossesLatestAnnualScopeLabel(rows, rows.map((row) => row.mes)), [rows]);

  return (
    <div className="panel wide">
      <PanelTitle icon={<Clipboard size={18} />} title="Ultimo año movil por fecha y tarifa-periodo" subtitle={scope} />
      <div className="segment-summary-scroll">
        <table className="segment-summary-table ree-losses-annual-table">
          <thead>
            <tr>
              <th>Fecha</th>
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
              <th>Registros</th>
            </tr>
          </thead>
          <tbody>
            {pivotRows.map((row) => (
              <tr key={row.mes}>
                <th scope="row">
                  <span>{formatMonthKeyLabel(row.mes)}</span>
                  <small>{row.versionLabel ? `Version ${row.versionLabel}` : "-"}</small>
                </th>
                {columns.map((column) => {
                  const value = row.values[column.key];
                  return (
                    <td key={column.key}>
                      <strong>{formatLossPercent(value?.perdidaFinal)}</strong>
                      <small>{value ? `BOE ${formatLossPercent(value.perdidaBoe)} · ${formatNumber(value.records)} reg.` : "-"}</small>
                    </td>
                  );
                })}
                <td>
                  <strong>{formatNumber(row.records)}</strong>
                </td>
              </tr>
            ))}
            {pivotRows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 2}>Sin datos del ultimo año movil.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LossAnomalyBadges({ anomalies }: { anomalies: string[] }) {
  if (anomalies.length === 0) {
    return <span className="loss-badge good">OK</span>;
  }

  return (
    <span className="loss-badge-list">
      {anomalies.slice(0, 3).map((anomaly) => (
        <span className={`loss-badge ${anomalyBadgeTone(anomaly)}`} key={anomaly}>
          {formatAnomalyLabel(anomaly)}
        </span>
      ))}
      {anomalies.length > 3 && <span className="loss-badge warning">+{anomalies.length - 3}</span>}
    </span>
  );
}

function LoadStatusBadge({ status }: { status: LoadStatus }) {
  const label = status === "valid" ? "Validado" : status === "partial" ? "Parcial" : status === "error" ? "Error" : "Procesando";
  return <span className={`ops-status-badge ${status}`}>{label}</span>;
}

function PanelTitle({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle?: ReactNode }) {
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

function FilterSelect({
  label,
  value,
  options,
  onChange,
  placeholder = "Todos",
  disabled = false,
  loading = false
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const normalizedOptions = useMemo(() => {
    const seen = new Set<string>();
    return [...options, value]
      .map((option) => option.trim())
      .filter((option) => {
        if (!option || seen.has(option)) {
          return false;
        }
        seen.add(option);
        return true;
      });
  }, [options, value]);
  const filteredOptions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return normalizedSearch
      ? normalizedOptions.filter((option) => option.toLowerCase().includes(normalizedSearch)).slice(0, 200)
      : normalizedOptions.slice(0, 200);
  }, [normalizedOptions, search]);
  const searchable = normalizedOptions.length > SEARCHABLE_SELECT_THRESHOLD;
  const controlDisabled = disabled || loading;
  const displayValue = loading ? "Cargando..." : value || placeholder;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  useEffect(() => {
    if (controlDisabled) {
      setOpen(false);
    }
  }, [controlDisabled]);

  if (!searchable) {
    return (
      <label className="filter-field">
        <span>{label}</span>
        <select disabled={controlDisabled} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{loading ? "Cargando..." : placeholder}</option>
          {normalizedOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className={`filter-field filter-select-field ${open ? "open" : ""}`} ref={containerRef}>
      <span>{label}</span>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="searchable-select-trigger"
        disabled={controlDisabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          }
          if (event.key === "ArrowDown") {
            setOpen(true);
          }
        }}
        type="button"
      >
        <span className={value ? "" : "placeholder"}>{displayValue}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="searchable-select-popover">
          <input
            autoFocus
            className="searchable-select-search"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder={`Buscar ${label.toLowerCase()}`}
            value={search}
          />
          <div className="searchable-select-options" role="listbox">
            <button
              className={`searchable-select-option ${value ? "" : "active"}`}
              onClick={() => {
                onChange("");
                setOpen(false);
                setSearch("");
              }}
              role="option"
              type="button"
            >
              {placeholder}
            </button>
            {filteredOptions.map((option) => (
              <button
                className={`searchable-select-option ${option === value ? "active" : ""}`}
                key={option}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                  setSearch("");
                }}
                role="option"
                type="button"
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DateFilterField({
  label,
  value,
  onChange,
  disabled = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="filter-field">
      <span>{label}</span>
      <input disabled={disabled} type="date" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function EChart({ option, height = 360 }: { option: EChartsOption; height?: number }) {
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

function OpsMiniChart({
  title,
  rows,
  valueLabel,
  tone
}: {
  title: string;
  rows: Array<{ label: string; value: number }>;
  valueLabel: string;
  tone: "cyan" | "emerald" | "rose";
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <div className={`ops-chart-card ${tone}`}>
      <div className="ops-chart-title">
        <strong>{title}</strong>
        <span>{rows.reduce((sum, row) => sum + row.value, 0).toLocaleString("es-ES")} {valueLabel}</span>
      </div>
      <div className="ops-bars">
        {rows.length === 0 && <small>Sin datos</small>}
        {rows.map((row) => (
          <div className="ops-bar-row" key={row.label}>
            <span>{row.label}</span>
            <div><i style={{ width: `${Math.max((row.value / max) * 100, row.value > 0 ? 4 : 0)}%` }} /></div>
            <small>{row.value.toLocaleString("es-ES")}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function kpiIcon(label: string) {
  switch (label) {
    case "Total registros":
      return <Database size={18} />;
    case "Válidos":
      return <CheckCircle2 size={18} />;
    case "Inválidos":
      return <AlertTriangle size={18} />;
    case "Duplicados":
      return <Clipboard size={18} />;
    case "Última carga":
      return <FileClock size={18} />;
    case "Último periodo":
      return <Activity size={18} />;
    default:
      return null;
  }
}
