import { useCallback, useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Download, Eye, LineChart, Play, RefreshCw, Table2, Zap } from "lucide-react";
import type {
  EsiosDownloadSummary,
  ForecastCompareResponse,
  ForecastFeatureImportanceItem,
  ForecastModelDetail,
  ForecastModelListItem,
  ForecastPredictionRangeResponse,
  ForecastPredictionRun,
  ForecastTrainResponse,
  MercadoCoverageDiagnosticsResponse,
  MercadoCoverageDiagnosticVariable
} from "../../../api";
import { downloadEsiosIndicator, getMercadoCoverageDiagnostics } from "../../../api";
import { getTodayInputValue } from "../../../app-shell/AppState";
import { downloadBlob } from "../../../components/technical-data-table/TechnicalDataTableHelpers";
import { EChart, PanelTitle, formatDecimalNumber, formatNumber } from "../../shared/RestoredModuleCommon";
import {
  useActivateForecastModel,
  useCompareForecastModels,
  useForecastModels,
  useForecastPredictionHistory,
  usePredictForecastRange,
  useTrainForecastModel
} from "./useForecast";

const D1_QUICK_DOWNLOADS: Record<string, number> = {
  demandaPrevista: 460,
  eolica: 541,
  fotovoltaica: 542,
  termosolar: 543
};

export function ForecastPage() {
  const today = getTodayInputValue();
  const tomorrow = addDays(today, 1);
  const defaultStart = `${today.slice(0, 4)}-01-01`;
  const models = useForecastModels();
  const history = useForecastPredictionHistory();
  const activate = useActivateForecastModel(models.refresh);
  const train = useTrainForecastModel(() => void models.refresh());
  const compare = useCompareForecastModels();
  const prediction = usePredictForecastRange(() => void history.refresh());
  const [selectedCompareIds, setSelectedCompareIds] = useState<string[]>([]);
  const [selectedHistoryRun, setSelectedHistoryRun] = useState<ForecastPredictionRun>();
  const [forecastDate, setForecastDate] = useState(tomorrow);
  const [coverage, setCoverage] = useState<MercadoCoverageDiagnosticsResponse>();
  const [coverageError, setCoverageError] = useState<string>();
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [downloadSummary, setDownloadSummary] = useState<EsiosDownloadSummary>();
  const [downloadLoadingId, setDownloadLoadingId] = useState<number>();

  const activeModelId = models.data?.models.find((model) => model.activo)?.id ?? models.data?.models[0]?.id ?? "";
  const activeModel = models.data?.models.find((model) => model.id === activeModelId);
  const historyForTarget = useMemo(
    () => history.result.filter((run) => run.fechaDesde <= forecastDate && run.fechaHasta >= forecastDate),
    [forecastDate, history.result]
  );

  const loadCoverage = useCallback(async (date: string) => {
    setCoverageLoading(true);
    setCoverageError(undefined);
    try {
      setCoverage(await getMercadoCoverageDiagnostics({ fechaDesde: date, fechaHasta: date }));
    } catch (caught) {
      setCoverageError(readError(caught));
    } finally {
      setCoverageLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCoverage(forecastDate);
    void history.refresh({ fechaDesde: forecastDate, fechaHasta: forecastDate });
  }, [forecastDate, history.refresh, loadCoverage]);

  async function downloadCoverageIndicator(indicatorId: number) {
    setDownloadLoadingId(indicatorId);
    setCoverageError(undefined);
    try {
      const summary = await downloadEsiosIndicator(indicatorId, forecastDate, forecastDate);
      setDownloadSummary(summary);
      await loadCoverage(forecastDate);
    } catch (caught) {
      setCoverageError(readError(caught));
    } finally {
      setDownloadLoadingId(undefined);
    }
  }

  return (
    <section className="omie-layout omie-layout-a mercado-module forecast-page">
      <div className="panel wide omie-control-panel forecast-header">
        <PanelTitle icon={<LineChart size={18} />} title="Prevision Horaria" subtitle="Entrena, compara y utiliza modelos de prevision del mercado electrico." />
        <button className="secondary-button" disabled={models.loading} onClick={models.refresh} type="button">
          <RefreshCw size={16} />
          Refrescar
        </button>
      </div>

      {(models.error || activate.error) && <div className="status-message error">{models.error ?? activate.error}</div>}

      <ForecastOperationsPanel
        activeModel={activeModel}
        coverage={coverage}
        downloadLoadingId={downloadLoadingId}
        downloadSummary={downloadSummary}
        error={coverageError}
        forecastDate={forecastDate}
        historyRuns={historyForTarget}
        loading={coverageLoading}
        onDateChange={setForecastDate}
        onDownloadIndicator={downloadCoverageIndicator}
        onRefreshCoverage={() => loadCoverage(forecastDate)}
      />

      <ForecastModelsPanel
        activeLoadingId={activate.loadingId}
        detail={models.detail}
        loading={models.loading}
        models={models.data?.models ?? []}
        onActivate={activate.activate}
        onSelectCompare={setSelectedCompareIds}
        onViewDetail={models.loadDetail}
        selectedCompareIds={selectedCompareIds}
      />

      <div className="mercado-dashboard-grid two">
        <ForecastTrainingForm
          defaultFechaDesde={defaultStart}
          defaultFechaHasta={today}
          loading={train.loading}
          models={models.data?.registeredModels ?? []}
          onTrain={train.train}
          result={train.result}
          error={train.error}
        />
        <ForecastModelComparison
          comparison={compare.result}
          error={compare.error}
          loading={compare.loading}
          models={models.data?.models ?? []}
          onCompare={compare.compare}
          selectedIds={selectedCompareIds}
          setSelectedIds={setSelectedCompareIds}
        />
      </div>

      <div className="mercado-dashboard-grid two">
        <ForecastPredictionRangeForm
          activeModelId={activeModelId}
          fechaDesde={forecastDate}
          fechaHasta={forecastDate}
          error={prediction.error}
          loading={prediction.loading}
          models={models.data?.models ?? []}
          onDateChange={setForecastDate}
          onPredict={prediction.predict}
          result={prediction.result}
        />
        <ForecastPredictionChart result={prediction.result} />
      </div>

      <ForecastHourlyTable result={prediction.result} />

      <div className="mercado-dashboard-grid two">
        <ForecastFeatureImportance comparison={compare.result} detail={models.detail} prediction={prediction.result} />
        <ForecastPredictionHistory
          error={history.error}
          loading={history.loading}
          models={models.data?.models ?? []}
          onRefresh={history.refresh}
          onView={setSelectedHistoryRun}
          runs={history.result}
          selectedRun={selectedHistoryRun}
        />
      </div>
    </section>
  );
}

function ForecastOperationsPanel({
  activeModel,
  coverage,
  downloadLoadingId,
  downloadSummary,
  error,
  forecastDate,
  historyRuns,
  loading,
  onDateChange,
  onDownloadIndicator,
  onRefreshCoverage
}: {
  activeModel?: ForecastModelListItem;
  coverage?: MercadoCoverageDiagnosticsResponse;
  downloadLoadingId?: number;
  downloadSummary?: EsiosDownloadSummary;
  error?: string;
  forecastDate: string;
  historyRuns: ForecastPredictionRun[];
  loading: boolean;
  onDateChange: (date: string) => void;
  onDownloadIndicator: (indicatorId: number) => void;
  onRefreshCoverage: () => void;
}) {
  const relevantCoverage = useMemo(() => {
    const preferred = ["demandaPrevista", "eolica", "fotovoltaica", "termosolar"];
    const byVariable = new Map((coverage?.variables ?? []).map((item) => [item.variable, item]));
    return preferred.map((variable) => byVariable.get(variable)).filter(Boolean) as MercadoCoverageDiagnosticVariable[];
  }, [coverage]);
  const completeCount = relevantCoverage.filter((item) => item.status === "complete").length;
  const missingCoverage = relevantCoverage.filter((item) => item.status !== "complete");
  const latestRun = historyRuns[0];
  const latestMean = latestRun ? readRunAverage(latestRun) : null;

  return (
    <section className="panel wide mercado-panel forecast-ops-panel">
      <div className="mercado-panel-head">
        <PanelTitle icon={<Activity size={18} />} title="Operativa D+1" subtitle="estado para lanzar la prevision de manana" />
        <div className="forecast-date-control">
          <label className="filter-field">
            <span>Fecha objetivo</span>
            <input type="date" value={forecastDate} onChange={(event) => onDateChange(event.target.value)} />
          </label>
          <button className="secondary-button" disabled={loading} onClick={onRefreshCoverage} type="button">
            <RefreshCw size={16} />
            Cobertura
          </button>
        </div>
      </div>
      {error && <div className="status-message error">{error}</div>}
      {downloadSummary && (
        <div className="status-message success">
          Indicador {downloadSummary.indicatorId}: {formatNumber(downloadSummary.insertedRecords)} nuevos, {formatNumber(downloadSummary.updatedRecords)} actualizados.
        </div>
      )}
      {missingCoverage.length > 0 && (
        <div className="status-message info">
          <AlertTriangle size={16} />
          Faltan senales D+1 para {missingCoverage.map((item) => coverageLabel(item.variable)).join(", ")}.
        </div>
      )}
      <div className="forecast-ops-grid">
        <ForecastMiniMetric label="Modelo activo" value={activeModel ? `v${activeModel.version} ${activeModel.tipo}` : "-"} />
        <ForecastMiniMetric label="RMSE activo" value={fmt(activeModel?.metricas.rmse)} />
        <ForecastMiniMetric label="Cobertura base" value={coverage ? `${completeCount}/${relevantCoverage.length}` : loading ? "..." : "-"} />
        <ForecastMiniMetric label="Ultima prevision" value={fmt(latestMean)} />
      </div>
      <div className="forecast-coverage-grid">
        {relevantCoverage.map((item) => (
          <ForecastCoverageCard
            item={item}
            key={item.variable}
            loadingIndicatorId={downloadLoadingId}
            onDownloadIndicator={onDownloadIndicator}
          />
        ))}
        <ForecastSignalDownload
          indicatorId={474}
          label="Nuclear disponible"
          loadingIndicatorId={downloadLoadingId}
          onDownloadIndicator={onDownloadIndicator}
        />
        <ForecastSignalDownload
          indicatorId={623}
          label="Almacenamiento hidraulico"
          loadingIndicatorId={downloadLoadingId}
          onDownloadIndicator={onDownloadIndicator}
        />
      </div>
      {latestRun && (
        <div className="forecast-detail-strip">
          <strong>Run guardado {latestRun.id.slice(0, 8)}</strong>
          <span>{formatDateTime(latestRun.fechaEjecucion)}</span>
          <span>{latestRun.fechaDesde} / {latestRun.fechaHasta}</span>
          <span>{fmt(latestMean)} EUR/MWh</span>
        </div>
      )}
    </section>
  );
}

function ForecastCoverageCard({
  item,
  loadingIndicatorId,
  onDownloadIndicator
}: {
  item: MercadoCoverageDiagnosticVariable;
  loadingIndicatorId?: number;
  onDownloadIndicator: (indicatorId: number) => void;
}) {
  const indicatorId = item.indicatorId ?? D1_QUICK_DOWNLOADS[item.variable];
  return (
    <div className={`forecast-coverage-card ${coverageTone(item.status)}`}>
      <div>
        <strong>{coverageLabel(item.variable)}</strong>
        <span>{coverageStatusLabel(item.status)} - {formatNumber(item.distinctHours)}/{formatNumber(item.expectedHours)} h</span>
      </div>
      <div className="mercado-coverage-bar">
        <span style={{ width: `${Math.min(Math.max(item.coveragePct, 0), 100)}%` }} />
        <strong>{fmt(item.coveragePct, 0)}%</strong>
      </div>
      {indicatorId && (
        <button className="secondary-button" disabled={loadingIndicatorId === indicatorId} onClick={() => onDownloadIndicator(indicatorId)} type="button">
          <Download size={15} />
          {loadingIndicatorId === indicatorId ? "Descargando" : "Descargar"}
        </button>
      )}
    </div>
  );
}

function ForecastSignalDownload({
  indicatorId,
  label,
  loadingIndicatorId,
  onDownloadIndicator
}: {
  indicatorId: number;
  label: string;
  loadingIndicatorId?: number;
  onDownloadIndicator: (indicatorId: number) => void;
}) {
  return (
    <div className="forecast-coverage-card optional">
      <div>
        <strong>{label}</strong>
        <span>Indicador {indicatorId}</span>
      </div>
      <button className="secondary-button" disabled={loadingIndicatorId === indicatorId} onClick={() => onDownloadIndicator(indicatorId)} type="button">
        <Download size={15} />
        {loadingIndicatorId === indicatorId ? "Descargando" : "Descargar"}
      </button>
    </div>
  );
}

export function ForecastModelsPanel({
  activeLoadingId,
  detail,
  loading,
  models,
  onActivate,
  onSelectCompare,
  onViewDetail,
  selectedCompareIds
}: {
  activeLoadingId?: string;
  detail?: ForecastModelDetail;
  loading: boolean;
  models: ForecastModelListItem[];
  onActivate: (id: string) => void;
  onSelectCompare: (ids: string[]) => void;
  onViewDetail: (id: string) => void;
  selectedCompareIds: string[];
}) {
  return (
    <section className="panel wide mercado-panel">
      <PanelTitle icon={<Table2 size={18} />} title="Modelos" subtitle="versiones entrenadas y estado operativo" />
      {models.length === 0 ? (
        <div className="empty-state">No hay modelos entrenados todavia.</div>
      ) : (
        <div className="mercado-table-shell forecast-models-shell">
          <table className="mercado-table forecast-table">
            <thead>
              <tr>
                <th>Comparar</th>
                <th>Modelo</th>
                <th>Activo</th>
                <th>Version</th>
                <th>Fecha entrenamiento</th>
                <th>MAE</th>
                <th>RMSE</th>
                <th>R</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => (
                <tr key={model.id}>
                  <td>
                    <input checked={selectedCompareIds.includes(model.id)} onChange={() => onSelectCompare(toggleValue(selectedCompareIds, model.id))} type="checkbox" />
                  </td>
                  <td><strong>{model.nombre}</strong><small>{model.tipo}</small></td>
                  <td><span className={`ops-status-badge ${model.activo ? "valid" : "partial"}`}>{model.activo ? "Activo" : "Inactivo"}</span></td>
                  <td>{model.version}</td>
                  <td>{formatDateTime(model.fecha)}</td>
                  <td>{fmt(model.metricas.mae)}</td>
                  <td>{fmt(model.metricas.rmse)}</td>
                  <td>{fmt(model.metricas.r, 4)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="secondary-button" disabled={loading} onClick={() => onViewDetail(model.id)} type="button">
                        <Eye size={15} />
                        Detalle
                      </button>
                      <button className="secondary-button" disabled={model.activo || activeLoadingId === model.id} onClick={() => onActivate(model.id)} type="button">
                        <CheckCircle2 size={15} />
                        Activar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detail && (
        <div className="forecast-detail-strip">
          <strong>{detail.nombre} v{detail.version}</strong>
          <span>Registros {formatNumber(detail.numeroRegistros)}</span>
          <span>Variables {formatNumber(detail.variablesUtilizadas.length)}</span>
          <span>Walk-forward RMSE {fmt(detail.walkForwardMetricas.rmse)}</span>
        </div>
      )}
    </section>
  );
}

export function ForecastTrainingForm({
  defaultFechaDesde,
  defaultFechaHasta,
  error,
  loading,
  models,
  onTrain,
  result
}: {
  defaultFechaDesde: string;
  defaultFechaHasta: string;
  error?: string;
  loading: boolean;
  models: Array<{ id: string; name: string; status: string }>;
  onTrain: (request: { fechaDesde: string; fechaHasta: string; modelo: string }) => void;
  result?: ForecastTrainResponse;
}) {
  const [fechaDesde, setFechaDesde] = useState(defaultFechaDesde);
  const [fechaHasta, setFechaHasta] = useState(defaultFechaHasta);
  const [modelo, setModelo] = useState("randomForestD1");

  return (
    <section className="panel mercado-panel">
      <PanelTitle icon={<Zap size={18} />} title="Entrenamiento" subtitle="crea una nueva version del modelo" />
      <div className="omie-toolbar compact">
        <label className="filter-field"><span>Fecha desde</span><input type="date" value={fechaDesde} onChange={(event) => setFechaDesde(event.target.value)} /></label>
        <label className="filter-field"><span>Fecha hasta</span><input type="date" value={fechaHasta} onChange={(event) => setFechaHasta(event.target.value)} /></label>
        <label className="filter-field">
          <span>Modelo</span>
          <select value={modelo} onChange={(event) => setModelo(event.target.value)}>
            {models.map((item) => <option disabled={item.status !== "available"} key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <button className="primary-button" disabled={loading} onClick={() => onTrain({ fechaDesde, fechaHasta, modelo })} type="button">
          <Play size={16} />
          Entrenar modelo
        </button>
      </div>
      {error && <div className="status-message error">{error}</div>}
      {result && (
        <div className="forecast-result-grid">
          <ForecastMiniMetric label="MAE" value={fmt(result.mae)} />
          <ForecastMiniMetric label="RMSE" value={fmt(result.rmse)} />
          <ForecastMiniMetric label="R" value={fmt(result.r, 4)} />
          <ForecastMiniMetric label="Observaciones" value={formatNumber(result.numeroObservaciones)} />
          <div className="forecast-variable-list"><strong>Usadas</strong><span>{result.variablesUtilizadas.join(", ")}</span></div>
          <div className="forecast-variable-list"><strong>Excluidas</strong><span>{result.variablesExcluidas.map((item) => item.variable).join(", ") || "-"}</span></div>
        </div>
      )}
    </section>
  );
}

export function ForecastModelComparison({
  comparison,
  error,
  loading,
  models,
  onCompare,
  selectedIds,
  setSelectedIds
}: {
  comparison?: ForecastCompareResponse;
  error?: string;
  loading: boolean;
  models: ForecastModelListItem[];
  onCompare: (ids: string[]) => void;
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
}) {
  return (
    <section className="panel mercado-panel">
      <div className="mercado-panel-head">
        <PanelTitle icon={<BarChart3 size={18} />} title="Comparacion" subtitle="MAE/RMSE, variables e importancia" />
        <button className="secondary-button" disabled={loading || selectedIds.length < 2} onClick={() => onCompare(selectedIds)} type="button">Comparar</button>
      </div>
      <div className="forecast-chip-list">
        {models.map((model) => (
          <button className={selectedIds.includes(model.id) ? "active" : ""} key={model.id} onClick={() => setSelectedIds(toggleValue(selectedIds, model.id))} type="button">
            v{model.version} {model.tipo}
          </button>
        ))}
      </div>
      {error && <div className="status-message error">{error}</div>}
      {comparison ? (
        <>
          <div className="page-note">{comparison.recomendacion.motivo}</div>
          <EChart height={230} option={buildComparisonChart(comparison)} />
          <div className="mercado-table-shell compact">
            <table className="mercado-table forecast-table compact">
              <thead><tr><th>Modelo</th><th>MAE</th><th>RMSE</th><th>R</th><th>Variables</th><th>Top importance</th></tr></thead>
              <tbody>
                {comparison.models.map((model) => (
                  <tr key={model.id}>
                    <td><strong>v{model.version}</strong><small>{model.tipo}</small></td>
                    <td>{fmt(model.metricas.mae)}</td>
                    <td>{fmt(model.metricas.rmse)}</td>
                    <td>{fmt(model.metricas.r, 4)}</td>
                    <td>{model.variablesUtilizadas.length}</td>
                    <td>{model.featureImportance.slice(0, 3).map((item) => item.variable).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="empty-state">Selecciona dos o mas modelos para comparar.</div>
      )}
    </section>
  );
}

export function ForecastPredictionRangeForm({
  activeModelId,
  fechaDesde,
  fechaHasta,
  error,
  loading,
  models,
  onDateChange,
  onPredict,
  result
}: {
  activeModelId: string;
  fechaDesde: string;
  fechaHasta: string;
  error?: string;
  loading: boolean;
  models: ForecastModelListItem[];
  onDateChange: (date: string) => void;
  onPredict: (request: { modeloId: string; fechaDesde: string; fechaHasta: string }) => void;
  result?: ForecastPredictionRangeResponse;
}) {
  const [modeloId, setModeloId] = useState(activeModelId);
  const effectiveModelId = modeloId || activeModelId;
  const average = useMemo(() => averagePrediction(result), [result]);

  return (
    <section className="panel mercado-panel">
      <PanelTitle icon={<Activity size={18} />} title="Prediccion" subtitle="prevision horaria por rango de fechas" />
      <div className="omie-toolbar compact">
        <label className="filter-field">
          <span>Modelo</span>
          <select value={effectiveModelId} onChange={(event) => setModeloId(event.target.value)}>
            {models.map((model) => <option key={model.id} value={model.id}>{model.activo ? "Activo - " : ""}v{model.version} {model.tipo}</option>)}
          </select>
        </label>
        <label className="filter-field"><span>Fecha desde</span><input type="date" value={fechaDesde} onChange={(event) => onDateChange(event.target.value)} /></label>
        <label className="filter-field"><span>Fecha hasta</span><input type="date" value={fechaHasta} onChange={(event) => onDateChange(event.target.value)} /></label>
        <button className="primary-button" disabled={loading || !effectiveModelId} onClick={() => onPredict({ modeloId: effectiveModelId, fechaDesde, fechaHasta })} type="button">
          <Play size={16} />
          Predecir
        </button>
      </div>
      {error && <div className="status-message error">{error}</div>}
      {result && (
        <div className="forecast-result-grid">
          <ForecastMiniMetric label="Precio medio previsto" value={fmt(average)} />
          <ForecastMiniMetric label="Dias" value={formatNumber(result.predicciones.length)} />
          <ForecastMiniMetric label="Intervalos" value={result.intervalosConfianza ? "Disponibles" : "Pendiente"} />
        </div>
      )}
    </section>
  );
}

export function ForecastPredictionChart({ result }: { result?: ForecastPredictionRangeResponse }) {
  return (
    <section className="panel mercado-panel">
      <PanelTitle icon={<LineChart size={18} />} title="Grafico de prediccion" subtitle="precio previsto horario" />
      {result ? <EChart height={320} option={buildPredictionChart(result)} /> : <div className="empty-state">Ejecuta una prediccion para ver la serie horaria.</div>}
    </section>
  );
}

export function ForecastHourlyTable({ result }: { result?: ForecastPredictionRangeResponse }) {
  const rows = flattenPredictionRows(result);
  function exportRows() {
    const html = tableHtml("Prediccion horaria", rows);
    downloadBlob(`forecast-prediccion-${result?.fechaDesde}-${result?.fechaHasta}.xls`, html, "application/vnd.ms-excel;charset=utf-8");
  }
  return (
    <section className="panel wide mercado-panel">
      <div className="mercado-panel-head">
        <PanelTitle icon={<Table2 size={18} />} title="Predicciones horarias" subtitle="agrupadas por dia y exportables" />
        <button className="secondary-button" disabled={rows.length === 0} onClick={exportRows} type="button"><Download size={16} />Excel</button>
      </div>
      {rows.length === 0 ? <div className="empty-state">Sin predicciones calculadas.</div> : (
        <div className="mercado-table-shell forecast-hourly-shell">
          <table className="mercado-table forecast-table">
            <thead><tr><th>Fecha</th><th>Hora local</th><th>UTC</th><th>Precio previsto</th><th>Intervalo confianza</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.timestampUtc}>
                  <td>{row.fecha}</td>
                  <td>{row.datetimeLocal?.slice(11, 16) ?? "-"}</td>
                  <td>{row.timestampUtc.slice(11, 16)}</td>
                  <td>{fmt(row.precioPrevisto)}</td>
                  <td>Pendiente</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ForecastFeatureImportance({ comparison, detail }: { comparison?: ForecastCompareResponse; detail?: ForecastModelDetail; prediction?: ForecastPredictionRangeResponse }) {
  const items = comparison?.models[0]?.featureImportance ?? detail?.featureImportance ?? [];
  return (
    <section className="panel mercado-panel">
      <PanelTitle icon={<BarChart3 size={18} />} title="Importancia de variables" subtitle="ranking del modelo seleccionado/comparado" />
      {items.length ? <EChart height={300} option={buildImportanceChart(items)} /> : <div className="empty-state">Abre el detalle de un modelo o ejecuta una comparacion.</div>}
    </section>
  );
}

export function ForecastPredictionHistory({
  error,
  loading,
  models,
  onRefresh,
  onView,
  runs,
  selectedRun
}: {
  error?: string;
  loading: boolean;
  models: ForecastModelListItem[];
  onRefresh: (filters?: { modeloId?: string; fechaDesde?: string; fechaHasta?: string }) => void;
  onView: (run: ForecastPredictionRun) => void;
  runs: ForecastPredictionRun[];
  selectedRun?: ForecastPredictionRun;
}) {
  const [modeloId, setModeloId] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");

  return (
    <section className="panel mercado-panel">
      <PanelTitle icon={<RefreshCw size={18} />} title="Historico" subtitle="auditoria de predicciones ejecutadas" />
      <div className="omie-toolbar compact">
        <label className="filter-field"><span>Modelo</span><select value={modeloId} onChange={(event) => setModeloId(event.target.value)}><option value="">Todos</option>{models.map((model) => <option key={model.id} value={model.id}>v{model.version} {model.tipo}</option>)}</select></label>
        <label className="filter-field"><span>Desde</span><input type="date" value={fechaDesde} onChange={(event) => setFechaDesde(event.target.value)} /></label>
        <label className="filter-field"><span>Hasta</span><input type="date" value={fechaHasta} onChange={(event) => setFechaHasta(event.target.value)} /></label>
        <button className="secondary-button" disabled={loading} onClick={() => onRefresh({ modeloId: modeloId || undefined, fechaDesde: fechaDesde || undefined, fechaHasta: fechaHasta || undefined })} type="button">Filtrar</button>
      </div>
      {error && <div className="status-message error">{error}</div>}
      <div className="mercado-table-shell compact">
        <table className="mercado-table forecast-table compact">
          <thead><tr><th>Ejecutado</th><th>Modelo</th><th>Rango</th><th>Media</th><th>Accion</th></tr></thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{formatDateTime(run.fechaEjecucion)}</td>
                <td>{run.modeloId.slice(0, 8)}</td>
                <td>{run.fechaDesde} / {run.fechaHasta}</td>
                <td>{fmt(readRunAverage(run))}</td>
                <td><button className="secondary-button" onClick={() => onView(run)} type="button"><Eye size={15} />Resultado</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selectedRun && <pre className="forecast-history-result">{JSON.stringify(selectedRun.output, null, 2)}</pre>}
    </section>
  );
}

function ForecastMiniMetric({ label, value }: { label: string; value: string }) {
  return <div className="technical-kpi"><span>{label}</span><strong>{value}</strong></div>;
}

function buildComparisonChart(comparison: ForecastCompareResponse): EChartsOption {
  return {
    tooltip: { trigger: "axis" },
    legend: { top: 0 },
    grid: { left: 44, right: 16, top: 42, bottom: 32 },
    xAxis: { type: "category", data: comparison.models.map((model) => `v${model.version}`) },
    yAxis: { type: "value" },
    series: [
      { name: "MAE", type: "bar", data: comparison.models.map((model) => model.metricas.mae) },
      { name: "RMSE", type: "bar", data: comparison.models.map((model) => model.metricas.rmse) }
    ]
  };
}

function buildPredictionChart(result: ForecastPredictionRangeResponse): EChartsOption {
  const rows = flattenPredictionRows(result);
  return {
    tooltip: { trigger: "axis" },
    grid: { left: 54, right: 20, top: 24, bottom: 50 },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 8 }],
    xAxis: { type: "category", data: rows.map((row) => row.datetimeLocal?.slice(11, 16) ?? row.timestampUtc.slice(11, 16)) },
    yAxis: { type: "value" },
    series: [{ name: "Precio previsto", type: "line", showSymbol: false, data: rows.map((row) => row.precioPrevisto) }]
  };
}

function buildImportanceChart(items: ForecastFeatureImportanceItem[]): EChartsOption {
  const ordered = [...items].slice(0, 12).reverse();
  return {
    tooltip: { trigger: "axis" },
    grid: { left: 130, right: 18, top: 20, bottom: 28 },
    xAxis: { type: "value" },
    yAxis: { type: "category", data: ordered.map((item) => item.variable) },
    series: [{ name: "Importancia", type: "bar", data: ordered.map((item) => Number((item.importance * 100).toFixed(2))) }]
  };
}

function flattenPredictionRows(result: ForecastPredictionRangeResponse | undefined) {
  return (result?.predicciones ?? []).flatMap((day) => day.prediccionesHorarias.map((row) => ({ fecha: day.fecha, ...row })));
}

function averagePrediction(result: ForecastPredictionRangeResponse | undefined) {
  const rows = flattenPredictionRows(result);
  return rows.length ? rows.reduce((sum, row) => sum + row.precioPrevisto, 0) / rows.length : null;
}

function readRunAverage(run: ForecastPredictionRun) {
  const output = run.output as Partial<ForecastPredictionRangeResponse> | null | undefined;
  const days = output?.predicciones;
  if (!Array.isArray(days) || days.length === 0) {
    return null;
  }
  const values = days.map((day) => day.precioMedioPrevisto).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function fmt(value: number | null | undefined, decimals = 2) {
  return typeof value === "number" && Number.isFinite(value) ? formatDecimalNumber(value, decimals) : "-";
}

function formatDateTime(value: string | null | undefined) {
  return value ? value.replace("T", " ").slice(0, 16) : "-";
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo completar la operacion.";
}

function coverageLabel(variable: string) {
  const labels: Record<string, string> = {
    demandaPrevista: "Demanda",
    eolica: "Eolica",
    fotovoltaica: "Fotovoltaica",
    termosolar: "Termosolar",
    nuclear: "Nuclear",
    hidraulicaUGH: "Hidraulica UGH",
    hidraulicaNoUGH: "Hidraulica no UGH",
    bombeo: "Bombeo",
    intercambios: "Intercambios"
  };
  return labels[variable] ?? variable;
}

function coverageStatusLabel(status: MercadoCoverageDiagnosticVariable["status"]) {
  const labels: Record<MercadoCoverageDiagnosticVariable["status"], string> = {
    complete: "Completo",
    partial: "Parcial",
    absent: "Sin datos",
    not_exposed: "No expuesto",
    not_mapped: "Sin mapeo"
  };
  return labels[status] ?? status;
}

function coverageTone(status: MercadoCoverageDiagnosticVariable["status"]) {
  if (status === "complete") {
    return "complete";
  }
  if (status === "partial") {
    return "partial";
  }
  return "missing";
}

function tableHtml(title: string, rows: object[]) {
  const columns = Object.keys(rows[0] ?? {});
  return `<html><meta charset="utf-8"><body><h2>${escapeHtml(title)}</h2><table border="1"><thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => {
      const record = row as Record<string, unknown>;
      return `<tr>${columns.map((column) => `<td>${escapeHtml(String(record[column] ?? ""))}</td>`).join("")}</tr>`;
    })
    .join("")}</tbody></table></body></html>`;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
