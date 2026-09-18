import { useCallback, useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { Activity, AlertTriangle, CheckCircle2, Download, Eye, LineChart, Play, RefreshCw, Table2, Trash2, X } from "lucide-react";
import type {
  EsiosDownloadSummary,
  ForecastModelDetail,
  ForecastModelListItem,
  ForecastPredictionRangeResponse,
  ForecastPredictionRun,
  ForecastTrainingAutomationConfig,
  ForecastTrainingAutomationConfigInput,
  ForecastTrainingJob,
  GasMibgasManualPriceRow,
  MercadoDatasetRow,
  MercadoCoverageDiagnosticsResponse,
  MercadoCoverageDiagnosticVariable
} from "../../../api";
import { downloadEsiosIndicator, getForecastModelDetail, getGasMibgasManualPrices, getMercadoCoverageDiagnostics, getMercadoDataset, getOfficialForecastPredictions, saveGasMibgasManualPrice } from "../../../api";
import { getTodayInputValue } from "../../../app-shell/AppState";
import { downloadBlob } from "../../../components/technical-data-table/TechnicalDataTableHelpers";
import { EChart, PanelTitle, formatDecimalNumber, formatNumber } from "../../shared/RestoredModuleCommon";
import {
  useActivateForecastModel,
  useForecastModels,
  useForecastPredictionHistory,
  useForecastTrainingAutomation,
  usePredictForecastRange
} from "./useForecast";

const D1_QUICK_DOWNLOADS: Record<string, number> = {
  demandaPrevista: 460,
  eolica: 541,
  solarPrevista: 10034,
  nuclearDisponibleMw: 474,
  hidraulicaStorageIndex: 623,
  ntcFranceImportD1: 1844,
  ntcFranceExportD1: 1848,
  ntcPortugalImportD1: 1845,
  ntcPortugalExportD1: 1849,
  ntcMoroccoImportD1: 1846,
  ntcMoroccoExportD1: 1850,
  ccgtDisponibleMw: 477,
  hydroDisponibleMw: 472,
  pumpingDisponibleMw: 473
};

const DEMAND_DEPENDENT_FEATURES = [
  "demandaPrevista",
  "demandaResidual",
  "rampaDemanda",
  "huecoTermicoD1",
  "rampaHuecoTermicoD1",
  "huecoTermicoSobreDemandaPct",
  "huecoSobreCcgtDisponible",
  "huecoSobreDespachableDisponible",
  "margenDespachableMw",
  "ntcNetSobreDemandaPct",
  "exportPressure",
  "importSupport",
  "huecoAjustadoInterconexion",
  "hydroScarcityThermalPressure",
  "hydroSupportRatio",
  "lowStorageHighGap",
  "thermalGapRampPressure",
  "demandRampThermalPressure"
];

const EOLICA_DEPENDENT_FEATURES = [
  "eolica",
  "eolicaSobreDemandaPct",
  "windPressurePct",
  "rampaEolica",
  "demandaResidual",
  "huecoTermicoD1",
  "rampaHuecoTermicoD1",
  "huecoTermicoSobreDemandaPct",
  "huecoSobreCcgtDisponible",
  "huecoSobreDespachableDisponible",
  "margenDespachableMw",
  "hydroScarcityThermalPressure",
  "hydroSupportRatio",
  "lowStorageHighGap",
  "thermalGapRampPressure",
  "demandRampThermalPressure"
];

const SOLAR_DEPENDENT_FEATURES = [
  "solarPrevista",
  "solarSobreDemandaPct",
  "solarPctOfDailyMax",
  "solarDropFromDailyMax",
  "solarResidualDemandLow",
  "solarPressureHigh",
  "rampaSolar",
  "demandaResidual",
  "huecoTermicoD1",
  "rampaHuecoTermicoD1",
  "huecoTermicoSobreDemandaPct",
  "huecoSobreCcgtDisponible",
  "huecoSobreDespachableDisponible",
  "margenDespachableMw",
  "hydroScarcityThermalPressure",
  "hydroSupportRatio",
  "lowStorageHighGap",
  "thermalGapRampPressure",
  "demandRampThermalPressure",
  "eveningSolarExitThermalGap"
];

const NUCLEAR_DEPENDENT_FEATURES = [
  "nuclearDisponibleMw",
  "nuclearDisponibleSobreDemandaPct",
  "nuclearPressureLow",
  "huecoTermicoD1",
  "huecoSobreDespachableDisponible",
  "margenDespachableMw",
  "hydroScarcityThermalPressure",
  "hydroSupportRatio",
  "lowStorageHighGap",
  "huecoAjustadoInterconexion",
  "thermalGapRampPressure"
];

const STORAGE_DEPENDENT_FEATURES = [
  "hidraulicaStorageIndex",
  "hidraulicaStoragePctOfMax",
  "hidraulicaStorageLow",
  "hydroScarcityThermalPressure",
  "lowStorageHighGap"
];

const NTC_DEPENDENT_FEATURES = [
  "ntcNetSobreDemandaPct",
  "exportPressure",
  "importSupport",
  "huecoAjustadoInterconexion"
];

type ForecastDerivedSignalCoverage = {
  variable: string;
  label: string;
  indicatorId: number;
  status: MercadoCoverageDiagnosticVariable["status"];
  expectedHours: number;
  distinctHours: number;
  coveragePct: number;
};

type ForecastModelSourceItem = {
  key: string;
  label: string;
  source: string;
  indicatorId?: number;
  status?: MercadoCoverageDiagnosticVariable["status"];
  coveragePct?: number;
  expectedHours?: number;
  distinctHours?: number;
  note: string;
};

export function ForecastPage() {
  const today = getTodayInputValue();
  const tomorrow = addDays(today, 1);
  const models = useForecastModels();
  const history = useForecastPredictionHistory();
  const trainingAutomation = useForecastTrainingAutomation();
  const activate = useActivateForecastModel(models.refresh);
  const prediction = usePredictForecastRange(() => void history.refresh());
  const [selectedHistoryRun, setSelectedHistoryRun] = useState<ForecastPredictionRun>();
  const [forecastDate, setForecastDate] = useState(tomorrow);
  const [coverage, setCoverage] = useState<MercadoCoverageDiagnosticsResponse>();
  const [derivedCoverage, setDerivedCoverage] = useState<ForecastDerivedSignalCoverage[]>([]);
  const [coverageError, setCoverageError] = useState<string>();
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [downloadSummary, setDownloadSummary] = useState<EsiosDownloadSummary>();
  const [downloadLoadingId, setDownloadLoadingId] = useState<number>();
  const [activeModelDetail, setActiveModelDetail] = useState<ForecastModelDetail>();

  const activeModelId = models.data?.models.find((model) => model.activo)?.id ?? models.data?.models[0]?.id ?? "";
  const activeModel = models.data?.models.find((model) => model.id === activeModelId);
  const modelById = useMemo(() => new Map((models.data?.models ?? []).map((model) => [model.id, model])), [models.data?.models]);
  const historyForTarget = useMemo(
    () => history.result.filter((run) => run.fechaDesde <= forecastDate && run.fechaHasta >= forecastDate),
    [forecastDate, history.result]
  );

  const loadCoverage = useCallback(async (date: string) => {
    setCoverageLoading(true);
    setCoverageError(undefined);
    try {
      const [nextCoverage, dataset] = await Promise.all([
        getMercadoCoverageDiagnostics({ fechaDesde: date, fechaHasta: date }),
        getMercadoDataset({ fechaDesde: date, fechaHasta: date })
      ]);
      setCoverage(nextCoverage);
      setDerivedCoverage(buildDerivedSignalCoverage(dataset.rows, nextCoverage.expectedHours));
    } catch (caught) {
      setCoverageError(readError(caught));
    } finally {
      setCoverageLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeModelId || activeModelDetail?.id === activeModelId) {
      return;
    }
    let cancelled = false;
    getForecastModelDetail(activeModelId)
      .then((detail) => {
        if (!cancelled) {
          setActiveModelDetail(detail);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setActiveModelDetail(undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeModelDetail?.id, activeModelId]);

  useEffect(() => {
    void loadCoverage(forecastDate);
  }, [forecastDate, loadCoverage]);

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
        <PanelTitle icon={<LineChart size={18} />} title="Prevision Horaria" subtitle="Operacion diaria, validacion e historico oficial del mercado electrico." />
        <button className="secondary-button" disabled={models.loading} onClick={models.refresh} type="button">
          <RefreshCw size={16} />
          Refrescar
        </button>
      </div>

      {(models.error || activate.error) && <div className="status-message error">{models.error ?? activate.error}</div>}

      <ForecastOperationsPanel
        activeModel={activeModel}
        activeModelDetail={activeModelDetail}
        activeModelId={activeModelId}
        coverage={coverage}
        derivedCoverage={derivedCoverage}
        downloadLoadingId={downloadLoadingId}
        downloadSummary={downloadSummary}
        error={coverageError}
        forecastDate={forecastDate}
        historyRuns={historyForTarget}
        loading={coverageLoading}
        models={models.data?.models ?? []}
        onDateChange={setForecastDate}
        onDownloadIndicator={downloadCoverageIndicator}
        onPredict={prediction.predict}
        onRefreshCoverage={() => loadCoverage(forecastDate)}
        predictionError={prediction.error}
        predictionLoading={prediction.loading}
        predictionResult={prediction.result}
      />

      <ForecastPredictionChart result={prediction.result} />

      <ForecastOfficialHistoryChart />

      <ForecastPredictionHistory
        deletingId={history.deletingId}
        error={history.error}
        loading={history.loading}
        models={models.data?.models ?? []}
        onDelete={(id, filters) => history.deleteRun(id, filters)}
        onRefresh={history.refresh}
        onReject={(id, filters) => history.rejectRun(id, filters)}
        onValidate={(id, filters) => history.validateRun(id, filters)}
        onView={setSelectedHistoryRun}
        runs={history.result}
        validatingId={history.validatingId}
      />

      {selectedHistoryRun && (
        <ForecastPredictionResultModal
          model={modelById.get(selectedHistoryRun.modeloId)}
          onClose={() => setSelectedHistoryRun(undefined)}
          run={selectedHistoryRun}
        />
      )}

      <details className="forecast-internal-tools">
        <summary>Herramientas del modelo</summary>
        <ForecastModelsPanel
          activeLoadingId={activate.loadingId}
          automation={trainingAutomation}
          detail={models.detail}
          loading={models.loading}
          models={models.data?.models ?? []}
          onActivate={activate.activate}
          onCloseDetail={() => models.setDetail(undefined)}
          onViewDetail={models.loadDetail}
        />
      </details>
    </section>
  );
}

function ForecastOperationsPanel({
  activeModel,
  activeModelDetail,
  activeModelId,
  coverage,
  derivedCoverage,
  downloadLoadingId,
  downloadSummary,
  error,
  forecastDate,
  historyRuns,
  loading,
  models,
  onDateChange,
  onDownloadIndicator,
  onPredict,
  onRefreshCoverage,
  predictionError,
  predictionLoading,
  predictionResult
}: {
  activeModel?: ForecastModelListItem;
  activeModelDetail?: ForecastModelDetail;
  activeModelId: string;
  coverage?: MercadoCoverageDiagnosticsResponse;
  derivedCoverage: ForecastDerivedSignalCoverage[];
  downloadLoadingId?: number;
  downloadSummary?: EsiosDownloadSummary;
  error?: string;
  forecastDate: string;
  historyRuns: ForecastPredictionRun[];
  loading: boolean;
  models: ForecastModelListItem[];
  onDateChange: (date: string) => void;
  onDownloadIndicator: (indicatorId: number) => void;
  onPredict: (request: { modeloId: string; fechaDesde: string; fechaHasta: string }) => void;
  onRefreshCoverage: () => void;
  predictionError?: string;
  predictionLoading: boolean;
  predictionResult?: ForecastPredictionRangeResponse;
}) {
  const [modeloId, setModeloId] = useState(activeModelId);
  const activeSources = useMemo(
    () => buildActiveModelSources(activeModelDetail, coverage, derivedCoverage),
    [activeModelDetail, coverage, derivedCoverage]
  );
  const operationalCoverage = activeSources.filter((item) => item.status);
  const completeCount = operationalCoverage.filter((item) => item.status === "complete").length;
  const missingCoverage = operationalCoverage.filter((item) => item.status !== "complete");
  const latestRun = historyRuns[0];
  const latestMean = latestRun ? readRunAverage(latestRun) : null;
  const effectiveModelId = modeloId || activeModelId;
  const predictionRows = useMemo(() => flattenPredictionRows(predictionResult), [predictionResult]);
  const predictionAverage = useMemo(() => averagePrediction(predictionResult), [predictionResult]);

  useEffect(() => {
    if (!modeloId && activeModelId) {
      setModeloId(activeModelId);
    }
  }, [activeModelId, modeloId]);

  function exportRows() {
    const rows = predictionRows.map((row) => ({
      fecha: row.fecha,
      horaLocal: row.datetimeLocal?.slice(11, 16) ?? "",
      timestampUtc: row.timestampUtc,
      precioPrevisto: row.precioPrevisto
    }));
    const html = tableHtml("Prediccion horaria", rows);
    downloadBlob(`forecast-prediccion-${predictionResult?.fechaDesde}-${predictionResult?.fechaHasta}.xls`, html, "application/vnd.ms-excel;charset=utf-8");
  }

  return (
    <section className="panel wide mercado-panel forecast-ops-panel">
      <div className="mercado-panel-head">
        <PanelTitle icon={<Activity size={18} />} title="Operativa D+1" subtitle="fecha objetivo, modelo, cobertura y prevision del dia" />
        <div className="forecast-date-control forecast-ops-actions">
          <label className="filter-field">
            <span>Modelo</span>
            <select value={effectiveModelId} onChange={(event) => setModeloId(event.target.value)}>
              {models.map((model) => <option key={model.id} value={model.id}>{model.activo ? "Activo - " : ""}v{model.version} {model.tipo}</option>)}
            </select>
          </label>
          <label className="filter-field">
            <span>Fecha objetivo</span>
            <input type="date" value={forecastDate} onChange={(event) => onDateChange(event.target.value)} />
          </label>
          <button className="secondary-button" disabled={loading} onClick={onRefreshCoverage} type="button">
            <RefreshCw size={16} />
            Cobertura
          </button>
          <button className="primary-button" disabled={predictionLoading || !effectiveModelId} onClick={() => onPredict({ modeloId: effectiveModelId, fechaDesde: forecastDate, fechaHasta: forecastDate })} type="button">
            <Play size={16} />
            Calcular
          </button>
          <button className="secondary-button" disabled={predictionRows.length === 0} onClick={exportRows} type="button">
            <Download size={16} />
            Excel
          </button>
        </div>
      </div>
      {error && <div className="status-message error">{error}</div>}
      {predictionError && <div className="status-message error">{predictionError}</div>}
      {downloadSummary && (
        <div className="status-message success">
          Indicador {downloadSummary.indicatorId}: {formatNumber(downloadSummary.insertedRecords)} nuevos, {formatNumber(downloadSummary.updatedRecords)} actualizados.
        </div>
      )}
      {missingCoverage.length > 0 && (
        <div className="status-message info">
          <AlertTriangle size={16} />
          Faltan senales D+1 para {missingCoverage.map((item) => item.label).join(", ")}.
        </div>
      )}
      <div className="forecast-ops-grid">
        <ForecastMiniMetric label="Version modelo activo" value={activeModel ? `v${activeModel.version}` : "-"} />
        <ForecastMiniMetric label="Tipo modelo" value={activeModel?.tipo ?? "-"} />
        <ForecastMiniMetric label="RMSE activo" value={fmt(activeModel?.metricas.rmse)} />
        <ForecastMiniMetric label="Cobertura modelo" value={coverage ? `${completeCount}/${operationalCoverage.length}` : loading ? "..." : "-"} />
        <ForecastMiniMetric label="Precio medio previsto" value={fmt(predictionAverage)} />
        <ForecastMiniMetric label="Horas previstas" value={formatNumber(predictionRows.length)} />
      </div>
      <ForecastGasD1Card forecastDate={forecastDate} />
      <ForecastActiveSources sources={activeSources} loadingIndicatorId={downloadLoadingId} onDownloadIndicator={onDownloadIndicator} />
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

function ForecastGasD1Card({ forecastDate }: { forecastDate: string }) {
  const [priceText, setPriceText] = useState("");
  const [savedRow, setSavedRow] = useState<GasMibgasManualPriceRow>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await getGasMibgasManualPrices({
        deliveryFrom: forecastDate,
        deliveryTo: forecastDate,
        product: ["GDAES_D+1"],
        placeOfDelivery: ["PVB"],
        area: ["ES"],
        take: 1
      });
      const row = response.rows[0];
      setSavedRow(row);
      if (row) {
        setPriceText(String(row.priceEurMwh).replace(".", ","));
      } else {
        setPriceText("");
      }
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setLoading(false);
    }
  }, [forecastDate]);

  useEffect(() => {
    setMessage(undefined);
    void load();
  }, [load]);

  async function save() {
    const price = parseUserNumber(priceText);
    if (price === null || price < 0) {
      setError("Introduce un precio MIBGAS valido.");
      return;
    }
    setSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const row = await saveGasMibgasManualPrice({
        product: "GDAES_D+1",
        placeOfDelivery: "PVB",
        area: "ES",
        firstDayDelivery: forecastDate,
        lastDayDelivery: forecastDate,
        priceEurMwh: price,
        source: "SUBASTA_MANUAL",
        comment: "MIBGAS D+1 desde pantalla de prevision"
      });
      setSavedRow(row);
      setPriceText(String(row.priceEurMwh).replace(".", ","));
      setMessage(`Guardado ${fmt(row.priceEurMwh)} EUR/MWh para ${forecastDate}.`);
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="forecast-gas-card">
      <div>
        <strong>MIBGAS D+1</strong>
        <span>
          {savedRow
            ? `Manual ${fmt(savedRow.priceEurMwh)} EUR/MWh - ${savedRow.source}`
            : loading
              ? "Consultando valor manual..."
              : "Sin override manual para esta fecha"}
        </span>
      </div>
      <label className="filter-field">
        <span>Precio EUR/MWh</span>
        <input inputMode="decimal" placeholder="84,21" value={priceText} onChange={(event) => setPriceText(event.target.value)} />
      </label>
      <div className="forecast-gas-actions">
        <button className="secondary-button" disabled={loading || saving} onClick={load} type="button">
          <RefreshCw size={15} />
          Revisar
        </button>
        <button className="primary-button" disabled={saving} onClick={save} type="button">
          {saving ? "Guardando" : "Guardar gas"}
        </button>
      </div>
      {(message || error) && <div className={`forecast-gas-message ${error ? "error" : "success"}`}>{error ?? message}</div>}
    </div>
  );
}

function ForecastActiveSources({
  loadingIndicatorId,
  onDownloadIndicator,
  sources
}: {
  loadingIndicatorId?: number;
  onDownloadIndicator: (indicatorId: number) => void;
  sources: ForecastModelSourceItem[];
}) {
  return (
    <div className="forecast-source-grid">
      {sources.map((source) => (
        <div className={`forecast-source-card ${source.status ? coverageTone(source.status) : "unknown"}`} key={source.key}>
          <div>
            <strong>{source.label}</strong>
            <span>{source.source}</span>
          </div>
          {typeof source.coveragePct === "number" && <b>{fmt(source.coveragePct, 0)}%</b>}
          <small>
            {source.expectedHours ? `${coverageStatusLabel(source.status ?? "complete")} - ${formatNumber(source.distinctHours ?? 0)}/${formatNumber(source.expectedHours)} h - ` : ""}
            {source.note}
          </small>
          {source.indicatorId && (
            <button className="secondary-button" disabled={loadingIndicatorId === source.indicatorId} onClick={() => onDownloadIndicator(source.indicatorId!)} type="button">
              <Download size={15} />
              {loadingIndicatorId === source.indicatorId ? "Descargando" : "Descargar"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function ForecastModelsPanel({
  activeLoadingId,
  automation,
  detail,
  loading,
  models,
  onActivate,
  onCloseDetail,
  onViewDetail
}: {
  activeLoadingId?: string;
  automation: ReturnType<typeof useForecastTrainingAutomation>;
  detail?: ForecastModelDetail;
  loading: boolean;
  models: ForecastModelListItem[];
  onActivate: (id: string) => void;
  onCloseDetail: () => void;
  onViewDetail: (id: string) => void;
}) {
  return (
    <section className="panel wide mercado-panel">
      <PanelTitle icon={<Table2 size={18} />} title="Modelos" subtitle="versiones entrenadas y estado operativo" />
      <ForecastTrainingAutomationPanel
        config={automation.config}
        error={automation.error}
        jobs={automation.jobs}
        loading={automation.loading}
        onRefresh={automation.refresh}
        onRunNow={automation.runNow}
        onSave={automation.save}
        running={automation.running}
        saving={automation.saving}
      />
      {models.length === 0 ? (
        <div className="empty-state">No hay modelos entrenados todavia.</div>
      ) : (
        <div className="mercado-table-shell forecast-models-shell">
          <table className="mercado-table forecast-table">
            <thead>
              <tr>
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
      {detail && <ForecastModelDetailModal detail={detail} onClose={onCloseDetail} />}
    </section>
  );
}

function ForecastTrainingAutomationPanel({
  config,
  error,
  jobs,
  loading,
  onRefresh,
  onRunNow,
  onSave,
  running,
  saving
}: {
  config?: ForecastTrainingAutomationConfig;
  error?: string;
  jobs: ForecastTrainingJob[];
  loading: boolean;
  onRefresh: () => void;
  onRunNow: () => void;
  onSave: (input: ForecastTrainingAutomationConfigInput) => void;
  running: boolean;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<ForecastTrainingAutomationConfig>();

  useEffect(() => {
    if (config) {
      setDraft(config);
    }
  }, [config]);

  return (
    <div className="forecast-automation-box">
      <div className="forecast-automation-head">
        <div>
          <strong>Entrenamiento diario</strong>
          <span>
            {config?.active ? "Activo" : "Pausado"} - proximo hasta {config?.nextTrainingEndDate ?? "-"}
          </span>
        </div>
        <div className="row-actions">
          <button className="secondary-button" disabled={loading} onClick={onRefresh} type="button">
            <RefreshCw size={15} />
            Refrescar
          </button>
          <button className="primary-button" disabled={running || !draft} onClick={onRunNow} type="button">
            <Play size={15} />
            {running ? "Lanzando" : "Lanzar ahora"}
          </button>
        </div>
      </div>
      {error && <div className="status-message error">{error}</div>}
      {draft ? (
        <>
          <div className="forecast-automation-form">
            <label className="filter-field">
              <span>Activo</span>
              <select value={draft.active ? "yes" : "no"} onChange={(event) => setDraft({ ...draft, active: event.target.value === "yes" })}>
                <option value="no">No</option>
                <option value="yes">Si</option>
              </select>
            </label>
            <label className="filter-field">
              <span>Hora</span>
              <input type="time" value={draft.scheduleTime} onChange={(event) => setDraft({ ...draft, scheduleTime: event.target.value })} />
            </label>
            <label className="filter-field">
              <span>Desde entrenamiento</span>
              <input type="date" value={draft.trainingStartDate} onChange={(event) => setDraft({ ...draft, trainingStartDate: event.target.value })} />
            </label>
            <label className="filter-field">
              <span>Tipo</span>
              <input value={draft.modelo} onChange={(event) => setDraft({ ...draft, modelo: event.target.value })} />
            </label>
            <label className="filter-field">
              <span>Usar tipo activo</span>
              <select value={draft.useActiveModelType ? "yes" : "no"} onChange={(event) => setDraft({ ...draft, useActiveModelType: event.target.value === "yes" })}>
                <option value="yes">Si</option>
                <option value="no">No</option>
              </select>
            </label>
            <button className="secondary-button" disabled={saving} onClick={() => onSave(draft)} type="button">
              <CheckCircle2 size={15} />
              {saving ? "Guardando" : "Guardar"}
            </button>
          </div>
          <div className="forecast-detail-strip">
            <strong>Ultima ejecucion</strong>
            <span>{config?.lastRunAt ?? "Sin ejecuciones"}</span>
            <span>{config?.lastRunKey ?? "-"}</span>
            {config?.lastJobId && <span>Job {config.lastJobId.slice(0, 8)}</span>}
          </div>
        </>
      ) : (
        <div className="empty-state">Cargando automatismo de entrenamiento.</div>
      )}
      <ForecastTrainingJobsTable jobs={jobs} />
    </div>
  );
}

function ForecastTrainingJobsTable({ jobs }: { jobs: ForecastTrainingJob[] }) {
  if (jobs.length === 0) {
    return <div className="empty-state">Sin entrenamientos registrados.</div>;
  }
  return (
    <div className="mercado-table-shell compact forecast-training-jobs-table">
      <table className="mercado-table forecast-table compact">
        <thead><tr><th>Creado</th><th>Estado</th><th>Modelo</th><th>Rango</th><th>Duracion</th><th>MAE WF</th><th>Modelo generado</th></tr></thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>{formatDateTime(job.createdAt)}</td>
              <td><span className={`ops-status-badge ${trainingJobTone(job.status)}`}>{trainingJobLabel(job.status)}</span></td>
              <td>{job.modelo}</td>
              <td>{job.fechaDesde} / {job.fechaHasta}</td>
              <td>{formatTrainingDuration(job)}</td>
              <td>{fmt(job.result?.walkForwardMetricas?.mae)}</td>
              <td>{job.forecastModelId ? job.forecastModelId.slice(0, 8) : job.errorMessage ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ForecastModelDetailModal({ detail, onClose }: { detail: ForecastModelDetail; onClose: () => void }) {
  const topImportance = [...detail.featureImportance].sort((left, right) => right.importance - left.importance).slice(0, 15);
  return (
    <div className="ops-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="ops-modal forecast-result-modal forecast-model-detail-modal" role="dialog" aria-modal="true" aria-label="Detalle del modelo" onMouseDown={(event) => event.stopPropagation()}>
        <div className="ops-modal-head">
          <div>
            <strong>{detail.nombre} v{detail.version}</strong>
            <span>{detail.tipo} - {detail.fechaDesde} / {detail.fechaHasta}</span>
          </div>
          <button aria-label="Cerrar" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="ops-modal-body">
          <div className="forecast-result-grid">
            <ForecastMiniMetric label="Activo" value={detail.activo ? "Si" : "No"} />
            <ForecastMiniMetric label="Registros" value={formatNumber(detail.numeroRegistros)} />
            <ForecastMiniMetric label="MAE" value={fmt(detail.metricas.mae)} />
            <ForecastMiniMetric label="RMSE" value={fmt(detail.metricas.rmse)} />
            <ForecastMiniMetric label="R" value={fmt(detail.metricas.r, 4)} />
            <ForecastMiniMetric label="WF MAE" value={fmt(detail.walkForwardMetricas.mae)} />
            <ForecastMiniMetric label="WF RMSE" value={fmt(detail.walkForwardMetricas.rmse)} />
            <ForecastMiniMetric label="WF folds" value={formatNumber(detail.walkForwardMetricas.folds)} />
          </div>
          <div className="forecast-detail-strip">
            <strong>Entrenamiento</strong>
            <span>{formatDateTime(detail.fecha)}</span>
            <span>Duracion {formatNumber(Math.round(detail.duracionMs / 1000))} s</span>
            {detail.usuario && <span>{detail.usuario}</span>}
          </div>
          <div className="forecast-model-detail-grid">
            <section className="forecast-model-detail-box">
              <strong>Variables utilizadas</strong>
              <div className="forecast-chip-list readonly">
                {detail.variablesUtilizadas.map((variable) => <span key={variable}>{variable}</span>)}
              </div>
            </section>
            <section className="forecast-model-detail-box">
              <strong>Variables excluidas</strong>
              {detail.variablesDescartadas.length === 0 ? (
                <span className="forecast-muted-text">Sin exclusiones registradas.</span>
              ) : (
                <div className="mercado-table-shell compact forecast-model-detail-table">
                  <table className="mercado-table forecast-table compact">
                    <thead><tr><th>Variable</th><th>Motivo</th><th>Cobertura</th></tr></thead>
                    <tbody>
                      {detail.variablesDescartadas.map((item) => (
                        <tr key={item.variable}>
                          <td>{item.variable}</td>
                          <td>{item.reason}</td>
                          <td>{fmt(item.coveragePct, 0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
          <section className="forecast-model-detail-box">
            <strong>Importancia de variables</strong>
            {topImportance.length === 0 ? (
              <span className="forecast-muted-text">Sin importancia registrada.</span>
            ) : (
              <div className="mercado-table-shell compact forecast-model-detail-table">
                <table className="mercado-table forecast-table compact">
                  <thead><tr><th>Variable</th><th>Importancia</th></tr></thead>
                  <tbody>
                    {topImportance.map((item) => (
                      <tr key={item.variable}>
                        <td>{item.variable}</td>
                        <td>{fmt(item.importance * 100, 2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export function ForecastPredictionChart({ result }: { result?: ForecastPredictionRangeResponse }) {
  return (
    <section className="panel wide mercado-panel">
      <PanelTitle icon={<LineChart size={18} />} title="Grafico de prediccion" subtitle="precio previsto horario" />
      {result ? <EChart height={320} option={buildPredictionChart(result)} /> : <div className="empty-state">Ejecuta una prediccion para ver la serie horaria.</div>}
    </section>
  );
}

export function ForecastPredictionHistory({
  deletingId,
  error,
  loading,
  models,
  onDelete,
  onRefresh,
  onReject,
  onValidate,
  onView,
  runs,
  validatingId
}: {
  deletingId?: string;
  error?: string;
  loading: boolean;
  models: ForecastModelListItem[];
  onDelete: (id: string, filters?: { modeloId?: string; fechaDesde?: string; fechaHasta?: string }) => void;
  onRefresh: (filters?: { modeloId?: string; fechaDesde?: string; fechaHasta?: string }) => void;
  onReject: (id: string, filters?: { modeloId?: string; fechaDesde?: string; fechaHasta?: string }) => void;
  onValidate: (id: string, filters?: { modeloId?: string; fechaDesde?: string; fechaHasta?: string }) => void;
  onView: (run: ForecastPredictionRun) => void;
  runs: ForecastPredictionRun[];
  validatingId?: string;
}) {
  const [modeloId, setModeloId] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");

  return (
    <section className="panel wide mercado-panel">
      <PanelTitle icon={<RefreshCw size={18} />} title="Historico de previsiones" subtitle="validacion, oficiales y auditoria por fechas" />
      <div className="omie-toolbar compact">
        <label className="filter-field"><span>Modelo</span><select value={modeloId} onChange={(event) => setModeloId(event.target.value)}><option value="">Todos</option>{models.map((model) => <option key={model.id} value={model.id}>v{model.version} {model.tipo}</option>)}</select></label>
        <label className="filter-field"><span>Desde</span><input type="date" value={fechaDesde} onChange={(event) => setFechaDesde(event.target.value)} /></label>
        <label className="filter-field"><span>Hasta</span><input type="date" value={fechaHasta} onChange={(event) => setFechaHasta(event.target.value)} /></label>
        <button className="secondary-button" disabled={loading} onClick={() => onRefresh({ modeloId: modeloId || undefined, fechaDesde: fechaDesde || undefined, fechaHasta: fechaHasta || undefined })} type="button">Filtrar</button>
      </div>
      {error && <div className="status-message error">{error}</div>}
      <div className="mercado-table-shell compact">
        <table className="mercado-table forecast-table compact">
          <thead><tr><th>Ejecutado</th><th>Estado</th><th>Modelo</th><th>Version</th><th>Rango</th><th>Media</th><th>Accion</th></tr></thead>
          <tbody>
            {runs.map((run) => {
              const model = models.find((item) => item.id === run.modeloId);
              return (
                <tr key={run.id}>
                  <td>{formatDateTime(run.fechaEjecucion)}</td>
                  <td><span className={`ops-status-badge ${predictionStatusTone(run)}`}>{predictionStatusLabel(run)}</span></td>
                  <td>{model ? model.tipo : run.modeloId.slice(0, 8)}</td>
                  <td>{model ? `v${model.version}` : "-"}</td>
                  <td>{run.fechaDesde} / {run.fechaHasta}</td>
                  <td>{fmt(readRunAverage(run))}</td>
                  <td>
                    <div className="forecast-history-actions">
                      <button className="secondary-button" onClick={() => onView(run)} type="button"><Eye size={15} />Resultado</button>
                      <button
                        className="secondary-button"
                        disabled={run.isOfficial || validatingId === run.id}
                        onClick={() => onValidate(run.id, { modeloId: modeloId || undefined, fechaDesde: fechaDesde || undefined, fechaHasta: fechaHasta || undefined })}
                        type="button"
                      >
                        <CheckCircle2 size={15} />
                        {validatingId === run.id ? "Validando" : "Validar"}
                      </button>
                      <button
                        className="secondary-button"
                        disabled={run.status === "RECHAZADA" || validatingId === run.id}
                        onClick={() => onReject(run.id, { modeloId: modeloId || undefined, fechaDesde: fechaDesde || undefined, fechaHasta: fechaHasta || undefined })}
                        type="button"
                      >
                        <AlertTriangle size={15} />
                        Rechazar
                      </button>
                      <button
                        className="secondary-button danger"
                        disabled={deletingId === run.id}
                        onClick={() => onDelete(run.id, { modeloId: modeloId || undefined, fechaDesde: fechaDesde || undefined, fechaHasta: fechaHasta || undefined })}
                        type="button"
                      >
                        <Trash2 size={15} />
                        {deletingId === run.id ? "Eliminando" : "Eliminar"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type ForecastPredictionDetailRow = {
  datetimeLocal: string;
  precioPrevisto: number;
  precioReal: number | null;
  error: number | null;
  demandaPrevista: number | null;
  eolica: number | null;
  solarPrevista: number | null;
  nuclearDisponibleMw: number | null;
  hidraulicaStorageIndex: number | null;
};

type ForecastOfficialHistoryRow = {
  fecha: string;
  runId: string;
  previsto: number | null;
  real: number | null;
  error: number | null;
  absError: number | null;
  validatedAt: string | null;
};

function ForecastPredictionResultModal({
  model,
  onClose,
  run
}: {
  model?: ForecastModelListItem;
  onClose: () => void;
  run: ForecastPredictionRun;
}) {
  const [datasetRows, setDatasetRows] = useState<MercadoDatasetRow[]>([]);
  const [coverage, setCoverage] = useState<MercadoCoverageDiagnosticsResponse>();
  const [derivedCoverage, setDerivedCoverage] = useState<ForecastDerivedSignalCoverage[]>([]);
  const [modelDetail, setModelDetail] = useState<ForecastModelDetail>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const detailRows = useMemo(() => buildPredictionDetailRows(run, datasetRows), [datasetRows, run]);
  const metrics = useMemo(() => buildPredictionDetailMetrics(detailRows), [detailRows]);
  const modelSources = useMemo(() => buildActiveModelSources(modelDetail, coverage, derivedCoverage), [coverage, derivedCoverage, modelDetail]);
  const usedVariables = modelDetail?.variablesUtilizadas ?? [];

  const loadReal = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [response, nextCoverage, nextModelDetail] = await Promise.all([
        getMercadoDataset({ fechaDesde: run.fechaDesde, fechaHasta: run.fechaHasta, take: 5000 }),
        getMercadoCoverageDiagnostics({ fechaDesde: run.fechaDesde, fechaHasta: run.fechaHasta }),
        getForecastModelDetail(run.modeloId)
      ]);
      setDatasetRows(response.rows);
      setCoverage(nextCoverage);
      setDerivedCoverage(buildDerivedSignalCoverage(response.rows, nextCoverage.expectedHours));
      setModelDetail(nextModelDetail);
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setLoading(false);
    }
  }, [run.fechaDesde, run.fechaHasta]);

  useEffect(() => {
    void loadReal();
  }, [loadReal]);

  return (
    <div className="ops-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="ops-modal forecast-result-modal" role="dialog" aria-modal="true" aria-label="Resultado de prevision" onMouseDown={(event) => event.stopPropagation()}>
        <div className="ops-modal-head">
          <div>
            <strong>Resultado de prevision</strong>
            <span>
              {run.fechaDesde} / {run.fechaHasta} - {model ? `${model.tipo} v${model.version}` : run.modeloId.slice(0, 8)}
            </span>
          </div>
          <button aria-label="Cerrar" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="ops-modal-body">
          {error && <div className="status-message error">{error}</div>}
          <div className="forecast-detail-strip">
            <strong>{predictionStatusLabel(run)}</strong>
            <span>Ejecutada {formatDateTime(run.fechaEjecucion)}</span>
            {run.validatedAt && <span>Validada {formatDateTime(run.validatedAt)}</span>}
            {run.validatedBy && <span>{run.validatedBy}</span>}
            <button className="secondary-button" disabled={loading} onClick={loadReal} type="button">
              <RefreshCw size={16} />
              Actualizar real
            </button>
          </div>
          <div className="forecast-result-grid">
            <ForecastMiniMetric label="Horas" value={formatNumber(detailRows.length)} />
            <ForecastMiniMetric label="Previsto medio" value={fmt(metrics.meanForecast)} />
            <ForecastMiniMetric label="Real medio" value={fmt(metrics.meanActual)} />
            <ForecastMiniMetric label="MAE" value={fmt(metrics.mae)} />
            <ForecastMiniMetric label="Bias" value={fmt(metrics.bias)} />
          </div>
          <ForecastModelSourcesTable sources={modelSources} variables={usedVariables} />
          <EChart height={320} option={buildPredictionDetailChart(detailRows)} />
          <div className="mercado-table-shell forecast-result-detail-table">
            <table className="mercado-table forecast-table compact">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Hora</th>
                  <th>Previsto</th>
                  <th>Real OMIE</th>
                  <th>Error</th>
                  <th>Demanda</th>
                  <th>Eolica</th>
                  <th>Solar</th>
                  <th>Nuclear disp.</th>
                  <th>Llenado hidr.</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.map((row) => (
                  <tr key={row.datetimeLocal}>
                    <td>{row.datetimeLocal.slice(0, 10)}</td>
                    <td>{row.datetimeLocal.slice(11, 16)}</td>
                    <td>{fmt(row.precioPrevisto)}</td>
                    <td>{fmt(row.precioReal)}</td>
                    <td>{fmt(row.error)}</td>
                    <td>{fmt(row.demandaPrevista, 0)}</td>
                    <td>{fmt(row.eolica, 0)}</td>
                    <td>{fmt(row.solarPrevista, 0)}</td>
                    <td>{fmt(row.nuclearDisponibleMw, 0)}</td>
                    <td>{fmt(row.hidraulicaStorageIndex, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detailRows.length === 0 && !loading && <div className="empty-state">Sin datos horarios para este resultado.</div>}
        </div>
      </div>
    </div>
  );
}

function ForecastModelSourcesTable({ sources, variables }: { sources: ForecastModelSourceItem[]; variables: string[] }) {
  if (sources.length === 0 && variables.length === 0) {
    return null;
  }
  return (
    <div className="forecast-result-sources">
      <div className="forecast-result-sources-head">
        <strong>Variables utilizadas por el modelo</strong>
        {variables.length > 0 && <span>{formatNumber(variables.length)} features</span>}
      </div>
      {sources.length > 0 && (
        <div className="mercado-table-shell forecast-source-table-shell">
          <table className="mercado-table forecast-table compact">
            <thead>
              <tr>
                <th>Senal</th>
                <th>Fuente</th>
                <th>Cobertura</th>
                <th>Horas</th>
                <th>Uso</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr key={source.key}>
                  <td><strong>{source.label}</strong></td>
                  <td>{source.source}</td>
                  <td>{source.status ? coverageStatusLabel(source.status) : "Manual / calculada"}</td>
                  <td>{source.expectedHours ? `${formatNumber(source.distinctHours ?? 0)}/${formatNumber(source.expectedHours)} h (${fmt(source.coveragePct, 0)}%)` : "-"}</td>
                  <td>{source.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {variables.length > 0 && (
        <div className="forecast-variable-chip-list">
          {variables.map((variable) => <span key={variable}>{variable}</span>)}
        </div>
      )}
    </div>
  );
}

function ForecastOfficialHistoryChart() {
  const today = getTodayInputValue();
  const [fechaDesde, setFechaDesde] = useState(addDays(today, -14));
  const [fechaHasta, setFechaHasta] = useState(today);
  const [runs, setRuns] = useState<ForecastPredictionRun[]>([]);
  const [datasetRows, setDatasetRows] = useState<MercadoDatasetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [officialRuns, dataset] = await Promise.all([
        getOfficialForecastPredictions({ fechaDesde, fechaHasta }),
        getMercadoDataset({ fechaDesde, fechaHasta, take: 5000 })
      ]);
      setRuns(officialRuns);
      setDatasetRows(dataset.rows);
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setLoading(false);
    }
  }, [fechaDesde, fechaHasta]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => buildOfficialHistoryRows(runs, datasetRows), [datasetRows, runs]);
  const metrics = useMemo(() => buildOfficialHistoryMetrics(rows), [rows]);

  return (
    <section className="panel wide mercado-panel forecast-official-panel">
      <div className="mercado-panel-head">
        <PanelTitle icon={<LineChart size={18} />} title="Historico oficial" subtitle="prevision validada frente a OMIE real" />
        <div className="forecast-date-control">
          <label className="filter-field"><span>Desde</span><input type="date" value={fechaDesde} onChange={(event) => setFechaDesde(event.target.value)} /></label>
          <label className="filter-field"><span>Hasta</span><input type="date" value={fechaHasta} onChange={(event) => setFechaHasta(event.target.value)} /></label>
          <button className="secondary-button" disabled={loading} onClick={load} type="button">
            <RefreshCw size={16} />
            Actualizar
          </button>
        </div>
      </div>
      {error && <div className="status-message error">{error}</div>}
      <div className="forecast-result-grid">
        <ForecastMiniMetric label="Dias validos" value={formatNumber(rows.length)} />
        <ForecastMiniMetric label="MAE diario" value={fmt(metrics.mae)} />
        <ForecastMiniMetric label="RMSE diario" value={fmt(metrics.rmse)} />
        <ForecastMiniMetric label="Bias diario" value={fmt(metrics.bias)} />
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">Todavia no hay previsiones validadas en este rango.</div>
      ) : (
        <div className="mercado-dashboard-grid two">
          <EChart height={320} option={buildOfficialHistoryChart(rows)} />
          <div className="mercado-table-shell forecast-official-table">
            <table className="mercado-table forecast-table compact">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Validada</th>
                  <th>Previsto</th>
                  <th>Real</th>
                  <th>Error</th>
                  <th>Abs</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.fecha}>
                    <td>{row.fecha}</td>
                    <td>{formatDateTime(row.validatedAt)}</td>
                    <td>{fmt(row.previsto)}</td>
                    <td>{fmt(row.real)}</td>
                    <td>{fmt(row.error)}</td>
                    <td>{fmt(row.absError)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function ForecastMiniMetric({ label, value }: { label: string; value: string }) {
  return <div className="technical-kpi"><span>{label}</span><strong>{value}</strong></div>;
}

function buildPredictionChart(result: ForecastPredictionRangeResponse): EChartsOption {
  const rows = flattenPredictionRows(result);
  return {
    tooltip: { trigger: "axis" },
    legend: { top: 0, textStyle: { color: "#17313f", fontWeight: 700 } },
    grid: { left: 64, right: 28, top: 48, bottom: 62 },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 8 }],
    xAxis: {
      type: "category",
      name: "Hora",
      nameLocation: "middle",
      nameGap: 34,
      data: rows.map((row) => row.datetimeLocal?.slice(11, 16) ?? row.timestampUtc.slice(11, 16)),
      axisLabel: { color: "#31505d" },
      axisLine: { lineStyle: { color: "#9eb3bd" } }
    },
    yAxis: {
      type: "value",
      name: "EUR/MWh",
      nameGap: 42,
      axisLabel: { color: "#31505d" },
      splitLine: { lineStyle: { color: "#e6eef2" } }
    },
    series: [{
      name: "Precio previsto",
      type: "line",
      showSymbol: true,
      symbolSize: 5,
      label: chartValueLabel("top"),
      lineStyle: { color: "#006c8f", width: 2 },
      data: rows.map((row) => row.precioPrevisto)
    }]
  };
}

function buildPredictionDetailChart(rows: ForecastPredictionDetailRow[]): EChartsOption {
  return {
    tooltip: { trigger: "axis" },
    legend: { top: 0, textStyle: { color: "#17313f", fontWeight: 700 } },
    grid: { left: 64, right: 28, top: 48, bottom: 56 },
    dataZoom: [{ type: "inside" }],
    xAxis: {
      type: "category",
      name: "Hora",
      nameLocation: "middle",
      nameGap: 34,
      data: rows.map((row) => row.datetimeLocal.slice(11, 16)),
      axisLabel: { color: "#31505d" },
      axisLine: { lineStyle: { color: "#9eb3bd" } },
      splitLine: { lineStyle: { color: "#e6eef2" } }
    },
    yAxis: {
      type: "value",
      name: "EUR/MWh",
      nameGap: 42,
      axisLabel: { color: "#31505d" },
      axisLine: { lineStyle: { color: "#9eb3bd" } },
      splitLine: { lineStyle: { color: "#e6eef2" } }
    },
    series: [
      { name: "Previsto", type: "line", showSymbol: true, symbolSize: 5, label: chartValueLabel("top"), lineStyle: { color: "#006c8f", width: 2 }, data: rows.map((row) => row.precioPrevisto) },
      { name: "Real OMIE", type: "line", showSymbol: true, symbolSize: 5, label: chartValueLabel("bottom"), lineStyle: { color: "#b54708", width: 2 }, data: rows.map((row) => row.precioReal) }
    ]
  };
}

function buildOfficialHistoryChart(rows: ForecastOfficialHistoryRow[]): EChartsOption {
  return {
    tooltip: { trigger: "axis" },
    legend: { top: 0, textStyle: { color: "#17313f", fontWeight: 700 } },
    grid: { left: 64, right: 28, top: 48, bottom: 56 },
    dataZoom: [{ type: "inside" }],
    xAxis: {
      type: "category",
      name: "Fecha",
      nameLocation: "middle",
      nameGap: 34,
      data: rows.map((row) => row.fecha),
      axisLabel: { color: "#31505d" },
      axisLine: { lineStyle: { color: "#9eb3bd" } }
    },
    yAxis: {
      type: "value",
      name: "EUR/MWh",
      nameGap: 42,
      axisLabel: { color: "#31505d" },
      splitLine: { lineStyle: { color: "#e6eef2" } }
    },
    series: [
      { name: "Previsto validado", type: "line", showSymbol: true, symbolSize: 6, label: chartValueLabel("top"), lineStyle: { color: "#006c8f", width: 2 }, data: rows.map((row) => row.previsto) },
      { name: "Real OMIE", type: "line", showSymbol: true, symbolSize: 6, label: chartValueLabel("bottom"), lineStyle: { color: "#b54708", width: 2 }, data: rows.map((row) => row.real) },
      { name: "Error", type: "bar", yAxisIndex: 0, label: chartValueLabel("top"), itemStyle: { color: "#8a9aa3" }, data: rows.map((row) => row.error) }
    ]
  };
}

function chartValueLabel(position: "top" | "bottom") {
  return {
    show: true,
    position,
    hideOverlap: true,
    color: "#17313f",
    fontSize: 10,
    fontWeight: 700,
    formatter: (params: { value?: unknown }) => (isFiniteNumber(params.value) ? formatDecimalNumber(params.value, 0) : "")
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

function predictionStatusLabel(run: ForecastPredictionRun) {
  if (run.isOfficial) {
    return "Oficial";
  }
  const labels: Record<ForecastPredictionRun["status"], string> = {
    PENDIENTE_VALIDACION: "Pendiente",
    VALIDADA: "Validada",
    RECHAZADA: "Rechazada"
  };
  return labels[run.status] ?? run.status;
}

function predictionStatusTone(run: ForecastPredictionRun) {
  if (run.isOfficial || run.status === "VALIDADA") {
    return "valid";
  }
  if (run.status === "RECHAZADA") {
    return "invalid";
  }
  return "partial";
}

function trainingJobLabel(status: ForecastTrainingJob["status"]) {
  const labels: Record<ForecastTrainingJob["status"], string> = {
    PENDING: "Pendiente",
    RUNNING: "Entrenando",
    SUCCESS: "Correcto",
    ERROR: "Error",
    SKIPPED: "Saltado"
  };
  return labels[status] ?? status;
}

function trainingJobTone(status: ForecastTrainingJob["status"]) {
  if (status === "SUCCESS") {
    return "valid";
  }
  if (status === "ERROR") {
    return "invalid";
  }
  if (status === "SKIPPED") {
    return "partial";
  }
  return "partial";
}

function formatTrainingDuration(job: ForecastTrainingJob) {
  if (job.result?.tiempoEntrenamientoMs) {
    return `${fmt(job.result.tiempoEntrenamientoMs / 60000, 1)} min`;
  }
  if (job.startedAt && job.finishedAt) {
    const minutes = (new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 60000;
    return `${fmt(minutes, 1)} min`;
  }
  if (job.startedAt) {
    const minutes = (Date.now() - new Date(job.startedAt).getTime()) / 60000;
    return `${fmt(minutes, 1)} min`;
  }
  return "-";
}

function buildPredictionDetailRows(run: ForecastPredictionRun, datasetRows: MercadoDatasetRow[]): ForecastPredictionDetailRow[] {
  const output = run?.output as Partial<ForecastPredictionRangeResponse> | null | undefined;
  const forecastRows = output?.predicciones?.flatMap((day) => day.prediccionesHorarias) ?? [];
  const realByLocalTime = new Map(
    datasetRows
      .map((row) => [row.datetimeLocal, row])
  );
  return forecastRows.flatMap((row) => {
    const datetimeLocal = row.datetimeLocal;
    if (!datetimeLocal || !isFiniteNumber(row.precioPrevisto)) {
      return [];
    }
    const datasetRow = realByLocalTime.get(datetimeLocal);
    const precioReal = isFiniteNumber(datasetRow?.precioOmie) ? datasetRow.precioOmie : null;
    const error = isFiniteNumber(precioReal) ? row.precioPrevisto - precioReal : null;
    return [{
      datetimeLocal,
      precioPrevisto: row.precioPrevisto,
      precioReal,
      error,
      demandaPrevista: finiteOrNull(datasetRow?.demandaPrevista),
      eolica: finiteOrNull(datasetRow?.eolica),
      solarPrevista: finiteOrNull(datasetRow?.solarPrevista),
      nuclearDisponibleMw: finiteOrNull(datasetRow?.nuclearDisponibleMw),
      hidraulicaStorageIndex: finiteOrNull(datasetRow?.hidraulicaStorageIndex)
    }];
  });
}

function buildPredictionDetailMetrics(rows: ForecastPredictionDetailRow[]) {
  if (rows.length === 0) {
    return { meanForecast: null, meanActual: null, mae: null, bias: null };
  }
  const meanForecast = average(rows.map((row) => row.precioPrevisto));
  const rowsWithReal = rows.filter((row): row is ForecastPredictionDetailRow & { precioReal: number; error: number } => isFiniteNumber(row.precioReal) && isFiniteNumber(row.error));
  const meanActual = rowsWithReal.length ? average(rowsWithReal.map((row) => row.precioReal)) : null;
  const mae = rowsWithReal.length ? average(rowsWithReal.map((row) => Math.abs(row.error))) : null;
  const bias = rowsWithReal.length ? average(rowsWithReal.map((row) => row.error)) : null;
  return { meanForecast, meanActual, mae, bias };
}

function buildOfficialHistoryRows(runs: ForecastPredictionRun[], datasetRows: MercadoDatasetRow[]): ForecastOfficialHistoryRow[] {
  const realByDate = new Map<string, number>();
  const groupedReal = new Map<string, number[]>();
  for (const row of datasetRows) {
    if (!isFiniteNumber(row.precioOmie)) {
      continue;
    }
    const date = row.datetimeLocal.slice(0, 10);
    groupedReal.set(date, [...(groupedReal.get(date) ?? []), row.precioOmie]);
  }
  for (const [date, values] of groupedReal) {
    realByDate.set(date, average(values));
  }

  const byDate = new Map<string, ForecastOfficialHistoryRow>();
  for (const run of runs) {
    const output = run.output as Partial<ForecastPredictionRangeResponse> | null | undefined;
    for (const day of output?.predicciones ?? []) {
      if (byDate.has(day.fecha)) {
        continue;
      }
      const previsto = isFiniteNumber(day.precioMedioPrevisto) ? day.precioMedioPrevisto : average(day.prediccionesHorarias.map((row) => row.precioPrevisto).filter(isFiniteNumber));
      const real = realByDate.get(day.fecha) ?? null;
      const error = isFiniteNumber(previsto) && isFiniteNumber(real) ? previsto - real : null;
      byDate.set(day.fecha, {
        fecha: day.fecha,
        runId: run.id,
        previsto: isFiniteNumber(previsto) ? previsto : null,
        real,
        error,
        absError: isFiniteNumber(error) ? Math.abs(error) : null,
        validatedAt: run.validatedAt
      });
    }
  }
  return [...byDate.values()].sort((left, right) => left.fecha.localeCompare(right.fecha));
}

function buildOfficialHistoryMetrics(rows: ForecastOfficialHistoryRow[]) {
  const comparable = rows.filter((row): row is ForecastOfficialHistoryRow & { error: number; absError: number } => isFiniteNumber(row.error) && isFiniteNumber(row.absError));
  if (comparable.length === 0) {
    return { mae: null, rmse: null, bias: null };
  }
  return {
    mae: average(comparable.map((row) => row.absError)),
    rmse: Math.sqrt(average(comparable.map((row) => row.error * row.error))),
    bias: average(comparable.map((row) => row.error))
  };
}

function buildDerivedSignalCoverage(rows: MercadoDatasetRow[], expectedHours: number): ForecastDerivedSignalCoverage[] {
  const expected = expectedHours || rows.length;
  return [
    buildDerivedSignal(rows, expected, "nuclearDisponibleMw", "Nuclear disponible", 474),
    buildDerivedSignal(rows, expected, "hidraulicaStorageIndex", "Almacenamiento hidraulico", 623)
  ];
}

function buildDerivedSignal(rows: MercadoDatasetRow[], expectedHours: number, variable: keyof MercadoDatasetRow, label: string, indicatorId: number): ForecastDerivedSignalCoverage {
  const distinctHours = rows.filter((row) => isFiniteNumber(row[variable])).length;
  const coveragePct = expectedHours > 0 ? (distinctHours / expectedHours) * 100 : 100;
  return {
    variable: String(variable),
    label,
    indicatorId,
    status: coverageStatusFromHours(expectedHours, distinctHours),
    expectedHours,
    distinctHours,
    coveragePct
  };
}

function buildActiveModelSources(
  detail: ForecastModelDetail | undefined,
  coverage: MercadoCoverageDiagnosticsResponse | undefined,
  derivedCoverage: ForecastDerivedSignalCoverage[]
): ForecastModelSourceItem[] {
  const features = new Set(detail?.variablesUtilizadas ?? []);
  const showAll = features.size === 0;
  const baseByVariable = new Map((coverage?.variables ?? []).map((item) => [item.variable, item]));
  const forecastD1ByVariable = new Map((coverage?.forecastD1Variables ?? []).map((item) => [item.variable, item]));
  const derivedByVariable = new Map(derivedCoverage.map((item) => [item.variable, item]));
  const items: ForecastModelSourceItem[] = [];

  if (showAll || usesAny(features, DEMAND_DEPENDENT_FEATURES)) {
    const item = baseByVariable.get("demandaPrevista");
    items.push(sourceFromCoverage("demandaPrevista", "Demanda prevista", item, "Base del modelo activo"));
  }
  if (showAll || usesAny(features, EOLICA_DEPENDENT_FEATURES)) {
    const item = baseByVariable.get("eolica");
    items.push(sourceFromCoverage("eolica", "Eolica", item, "Prevision D+1 usada por el activo"));
  }
  if (showAll || usesAny(features, SOLAR_DEPENDENT_FEATURES)) {
    const item = baseByVariable.get("solarPrevista");
    items.push(sourceFromCoverage("solarPrevista", "Solar prevista", item, "Solar total; no exige termosolar separada"));
  }
  if (showAll || usesAny(features, NUCLEAR_DEPENDENT_FEATURES)) {
    const item = derivedByVariable.get("nuclearDisponibleMw");
    items.push(sourceFromDerived("nuclearDisponibleMw", "Nuclear disponible", item, "Suma horaria de centrales"));
  }
  if (showAll || usesAny(features, STORAGE_DEPENDENT_FEATURES)) {
    const item = derivedByVariable.get("hidraulicaStorageIndex");
    items.push(sourceFromDerived("hidraulicaStorageIndex", "Llenado hidraulico", item, "Ultimo dato disponible hasta D+1"));
  }
  if (showAll || usesAny(features, ["ccgtDisponibleMw", "ccgtDisponibleSobreDemandaPct", "thermalAvailabilityPressure", "huecoSobreCcgtDisponible", "huecoSobreDespachableDisponible", "margenDespachableMw"])) {
    items.push(sourceFromForecastD1("ccgtDisponibleMw", "CCGT disponible", forecastD1ByVariable.get("ccgtDisponibleMw"), "Ciclos combinados disponibles D+1"));
  }
  if (showAll || usesAny(features, ["hydroDisponibleMw", "hydroDisponibleSobreDemandaPct", "hydroSupportRatio", "huecoSobreDespachableDisponible", "margenDespachableMw"])) {
    items.push(sourceFromForecastD1("hydroDisponibleMw", "Hidraulica disponible", forecastD1ByVariable.get("hydroDisponibleMw"), "UGH disponible D+1"));
  }
  if (showAll || usesAny(features, ["pumpingDisponibleMw", "pumpingDisponibleSobreDemandaPct"])) {
    items.push(sourceFromForecastD1("pumpingDisponibleMw", "Bombeo disponible", forecastD1ByVariable.get("pumpingDisponibleMw"), "Turbinacion bombeo disponible D+1"));
  }
  if (showAll || usesAny(features, ["ntcFranceImportD1", "ntcFranceNetD1", "ntcImportTotalD1", "ntcNetImportD1", ...NTC_DEPENDENT_FEATURES])) {
    items.push(sourceFromForecastD1("ntcFranceImportD1", "NTC Francia importacion", forecastD1ByVariable.get("ntcFranceImportD1"), "Interconexion D+1 para netos y soporte importador"));
  }
  if (showAll || usesAny(features, ["ntcFranceExportD1", "ntcFranceNetD1", "ntcExportTotalD1", "ntcNetImportD1", ...NTC_DEPENDENT_FEATURES])) {
    items.push(sourceFromForecastD1("ntcFranceExportD1", "NTC Francia exportacion", forecastD1ByVariable.get("ntcFranceExportD1"), "Interconexion D+1 para netos y presion exportadora"));
  }
  if (showAll || usesAny(features, ["ntcPortugalImportD1", "ntcPortugalNetD1", "ntcImportTotalD1", "ntcNetImportD1", ...NTC_DEPENDENT_FEATURES])) {
    items.push(sourceFromForecastD1("ntcPortugalImportD1", "NTC Portugal importacion", forecastD1ByVariable.get("ntcPortugalImportD1"), "Interconexion D+1 para netos y soporte importador"));
  }
  if (showAll || usesAny(features, ["ntcPortugalExportD1", "ntcPortugalNetD1", "ntcExportTotalD1", "ntcNetImportD1", ...NTC_DEPENDENT_FEATURES])) {
    items.push(sourceFromForecastD1("ntcPortugalExportD1", "NTC Portugal exportacion", forecastD1ByVariable.get("ntcPortugalExportD1"), "Interconexion D+1 para netos y presion exportadora"));
  }
  if (showAll || usesAny(features, ["ntcMoroccoImportD1", "ntcMoroccoNetD1", "ntcImportTotalD1", "ntcNetImportD1", ...NTC_DEPENDENT_FEATURES])) {
    items.push(sourceFromForecastD1("ntcMoroccoImportD1", "NTC Marruecos importacion", forecastD1ByVariable.get("ntcMoroccoImportD1"), "Interconexion D+1 para netos y soporte importador"));
  }
  if (showAll || usesAny(features, ["ntcMoroccoExportD1", "ntcMoroccoNetD1", "ntcExportTotalD1", "ntcNetImportD1", ...NTC_DEPENDENT_FEATURES])) {
    items.push(sourceFromForecastD1("ntcMoroccoExportD1", "NTC Marruecos exportacion", forecastD1ByVariable.get("ntcMoroccoExportD1"), "Interconexion D+1 para netos y presion exportadora"));
  }
  if (showAll || features.has("precioGasMibgas")) {
    items.push({
      key: "precioGasMibgas",
      label: "Gas MIBGAS",
      source: "GDAES_D+1 PVB ES",
      note: "Oficial si existe; override manual como respaldo"
    });
  }

  return items;
}

function sourceFromCoverage(key: string, label: string, item: MercadoCoverageDiagnosticVariable | undefined, note: string): ForecastModelSourceItem {
  const indicatorId = item?.indicatorId ?? D1_QUICK_DOWNLOADS[key];
  return {
    key,
    label,
    source: indicatorId ? `Indicador ${indicatorId}${item?.indicatorName ? ` - ${item.indicatorName}` : ""}` : "Sin indicador resuelto",
    indicatorId,
    status: item?.status,
    coveragePct: item?.coveragePct,
    expectedHours: item?.expectedHours,
    distinctHours: item?.distinctHours,
    note
  };
}

function sourceFromDerived(key: string, label: string, item: ForecastDerivedSignalCoverage | undefined, note: string): ForecastModelSourceItem {
  const indicatorId = item?.indicatorId ?? D1_QUICK_DOWNLOADS[key];
  return {
    key,
    label,
    source: indicatorId ? `Indicador ${indicatorId}` : "Sin indicador resuelto",
    indicatorId,
    status: item?.status,
    coveragePct: item?.coveragePct,
    expectedHours: item?.expectedHours,
    distinctHours: item?.distinctHours,
    note
  };
}

function sourceFromForecastD1(key: string, label: string, item: MercadoCoverageDiagnosticVariable | undefined, note: string): ForecastModelSourceItem {
  const indicatorId = item?.indicatorId ?? D1_QUICK_DOWNLOADS[key];
  return {
    key,
    label,
    source: indicatorId ? `Indicador ${indicatorId}${item?.indicatorName ? ` - ${item.indicatorName}` : ""}` : "Sin indicador resuelto",
    indicatorId,
    status: item?.status,
    coveragePct: item?.coveragePct,
    expectedHours: item?.expectedHours,
    distinctHours: item?.distinctHours,
    note: item ? note : `${note}. Descarga directa; cobertura no medida aqui`
  };
}

function usesAny(features: Set<string>, candidates: string[]) {
  return candidates.some((candidate) => features.has(candidate));
}

function coverageStatusFromHours(expectedHours: number, distinctHours: number): MercadoCoverageDiagnosticVariable["status"] {
  if (expectedHours === 0 || distinctHours >= expectedHours) {
    return "complete";
  }
  if (distinctHours > 0) {
    return "partial";
  }
  return "absent";
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteOrNull(value: unknown) {
  return isFiniteNumber(value) ? value : null;
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

function parseUserNumber(value: string) {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
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
