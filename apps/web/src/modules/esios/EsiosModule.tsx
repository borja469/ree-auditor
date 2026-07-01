import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Calculator, CheckCircle2, ChevronDown, Clock3, Download, FileDown, FileSpreadsheet, RefreshCw, RotateCcw, Save, Search, Settings, XCircle, Zap } from "lucide-react";
import type { EChartsOption } from "echarts";
import { FilterToolbar, FilterToolbarField, FilterToolbarGroup } from "../../components/filter-toolbar/FilterToolbar";
import {
  calculateEsiosIntermediateProfiles,
  downloadEsiosIndicator,
  getEsiosConfig,
  getEsiosDownloadLogs,
  getEsiosInitialProfiles,
  getEsiosIndicatorValues,
  getEsiosIntermediateProfiles,
  getEsiosIntermediateProfilesSummary,
  getEsiosIndicators,
  getEsiosProfileCalculationLogs,
  getEsiosProfileCoefficients,
  getEsiosProfileUploads,
  getEsiosProfilesSummary,
  getEsiosReeFinalDemandUploads,
  getEsiosReeFinalProfileUploads,
  saveEsiosProfileCoefficients,
  saveEsiosConfig,
  syncEsiosIndicators,
  testEsiosConnection,
  uploadEsiosProfiles,
  uploadEsiosReeFinalDemand,
  uploadEsiosReeFinalProfiles,
  type EsiosConfig,
  type EsiosConnectionResult,
  type EsiosDownloadLog,
  type EsiosDownloadLogsResponse,
  type EsiosDownloadSummary,
  type EsiosIndicator,
  type EsiosIndicatorValue,
  type EsiosInitialProfile,
  type EsiosInitialProfilesResponse,
  type EsiosProfileCalculationLogsResponse,
  type EsiosProfileCoefficient,
  type EsiosProfileIntermediateLog,
  type EsiosProfileIntermediateRow,
  type EsiosProfileIntermediatesResponse,
  type EsiosProfileIntermediateSummary,
  type EsiosProfileUpload,
  type EsiosProfilesFilters,
  type EsiosProfilesSummary,
  type EsiosProfilesUploadsResponse,
  type EsiosReeFinalDemandUpload,
  type EsiosReeFinalDemandUploadsResponse,
  type EsiosReeFinalProfileUpload,
  type EsiosReeFinalProfileUploadsResponse,
  type EsiosValuesFilters,
  type EsiosValuesResponse
} from "../../api";
import { downloadBlob } from "../../components/technical-data-table/TechnicalDataTableHelpers";
import { TechnicalDataTable } from "../../components/technical-data-table/TechnicalDataTable";
import type { TechnicalColumn, TechnicalKpi, RowQuality } from "../../components/technical-data-table/TechnicalDataTableTypes";
import { EChart, PanelTitle, formatDecimalNumber, formatNumber } from "../shared/RestoredModuleCommon";

export type EsiosViewKey = "indicadores" | "perfiles" | "series" | "descargas" | "configuracion";

const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_SERIES_SELECTION_SIZE = 4;
const PROFILE_TARIFFS = ["2.0TD", "3.0TD", "3.0TDVE"] as const;
type ProfileTariff = (typeof PROFILE_TARIFFS)[number];

type EsiosProfilePivotRow = {
  id: string;
  year: number;
  datetime: string;
  hour: number;
  referenceDemandMw: number | null;
  demandUsedMw: number | null;
  demandSource: EsiosProfileIntermediateRow["demandSource"] | "";
  byTariff: Partial<Record<ProfileTariff, EsiosProfileIntermediateRow>>;
};

type UnifiedProfileUploadRow = {
  id: string;
  uploadedAt: string;
  kind: "Perfiles iniciales" | "DEMR" | "PERFF";
  year: number;
  month: number | null;
  day: number | null;
  period: string;
  fileName: string;
  rows: number;
  status: string;
  errorMessage: string | null;
  uploadedBy: string | null;
};

type SeriesIndicatorFilter = "all" | "withData";

export function EsiosModule({ view }: { view: EsiosViewKey }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string }>();
  const [indicators, setIndicators] = useState<EsiosIndicator[]>([]);
  const [indicatorsWithData, setIndicatorsWithData] = useState<EsiosIndicator[]>([]);
  const [indicatorSearch, setIndicatorSearch] = useState("");
  const [selectedIndicatorIds, setSelectedIndicatorIds] = useState<number[]>([]);
  const [seriesByIndicatorId, setSeriesByIndicatorId] = useState<Record<number, EsiosValuesResponse>>({});
  const [seriesFilters, setSeriesFilters] = useState<EsiosValuesFilters>(() => defaultSeriesFilters());
  const [logs, setLogs] = useState<EsiosDownloadLogsResponse>();
  const [config, setConfig] = useState<EsiosConfig>();
  const [configToken, setConfigToken] = useState("");
  const [connectionResult, setConnectionResult] = useState<EsiosConnectionResult>();
  const [downloadDraft, setDownloadDraft] = useState(() => defaultDownloadDraft());
  const [latestDownload, setLatestDownload] = useState<EsiosDownloadSummary>();
  const [downloadIndicatorId, setDownloadIndicatorId] = useState<number>(460);
  const [profilesFilters, setProfilesFilters] = useState<EsiosProfilesFilters>(() => defaultProfilesFilters());
  const [profilesPage, setProfilesPage] = useState(0);
  const [profilesPageSize, setProfilesPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [profilesResponse, setProfilesResponse] = useState<EsiosInitialProfilesResponse>();
  const [profilesSummary, setProfilesSummary] = useState<EsiosProfilesSummary>();
  const [profileCoefficients, setProfileCoefficients] = useState<EsiosProfileCoefficient[]>([]);
  const [profileUploads, setProfileUploads] = useState<EsiosProfilesUploadsResponse>();
  const [intermediateResponse, setIntermediateResponse] = useState<EsiosProfileIntermediatesResponse>();
  const [intermediateSummary, setIntermediateSummary] = useState<EsiosProfileIntermediateSummary>();
  const [intermediateCalculationLogs, setIntermediateCalculationLogs] = useState<EsiosProfileCalculationLogsResponse>();
  const [finalDemandUploads, setFinalDemandUploads] = useState<EsiosReeFinalDemandUploadsResponse>();
  const [finalProfileUploads, setFinalProfileUploads] = useState<EsiosReeFinalProfileUploadsResponse>();
  const [intermediateHeaderRows, setIntermediateHeaderRows] = useState<EsiosProfilePivotRow[]>([]);
  const [profilesTab, setProfilesTab] = useState<"perfiles" | "coeficientes" | "cargas">("perfiles");
  const [intermediatePage, setIntermediatePage] = useState(0);
  const [intermediatePageSize, setIntermediatePageSize] = useState(DEFAULT_PAGE_SIZE);
  const [finalDemandDay, setFinalDemandDay] = useState("");
  const [profilesUploadProgress, setProfilesUploadProgress] = useState(0);
  const [finalDemandUploadProgress, setFinalDemandUploadProgress] = useState(0);
  const [finalProfileUploadProgress, setFinalProfileUploadProgress] = useState(0);
  const unifiedUploads = useMemo(() => buildUnifiedProfileUploads(profileUploads?.uploads ?? [], finalDemandUploads?.uploads ?? [], finalProfileUploads?.uploads ?? []), [finalDemandUploads?.uploads, finalProfileUploads?.uploads, profileUploads?.uploads]);

  async function loadCurrent(nextFilters = seriesFilters) {
    setLoading(true);
    setMessage(undefined);
    try {
      if (view === "indicadores" || view === "series" || view === "descargas") {
        const nextIndicators = await getEsiosIndicators();
        setIndicators(nextIndicators);

        const available = nextIndicators.filter((indicator) => indicator.hasData);
        setIndicatorsWithData(available);
        setDownloadIndicatorId((current) => resolveDownloadIndicatorId(current, nextIndicators));

        if (view === "series") {
          const nextSelection = await resolveSeriesSelection(selectedIndicatorIds, available);
          if (!sameIds(nextSelection, selectedIndicatorIds)) {
            setSelectedIndicatorIds(nextSelection);
          }
          const selectedSeries = await loadSelectedSeries(nextSelection, nextFilters);
          setSeriesByIndicatorId(selectedSeries);
        }

        if (view === "descargas") {
          setLogs(await getEsiosDownloadLogs({ take: 100 }));
        }
      } else if (view === "perfiles") {
        await loadProfiles(profilesFilters, profilesPage, profilesPageSize);
        if (profilesTab === "perfiles") {
          await loadIntermediates(profilesFilters, intermediatePage, intermediatePageSize);
        }
      } else if (view === "configuracion") {
        const nextConfig = await getEsiosConfig();
        setConfig(nextConfig);
        setConfigToken("");
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando ESIOS." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCurrent();
  }, [view]);

  useEffect(() => {
    if (view !== "series" || indicatorsWithData.length === 0) {
      return;
    }

    if (selectedIndicatorIds.length === 0) {
      const nextSelection = indicatorsWithData.slice(0, DEFAULT_SERIES_SELECTION_SIZE).map((indicator) => indicator.indicatorId);
      setSelectedIndicatorIds(nextSelection);
      void (async () => setSeriesByIndicatorId(await refreshSeries(nextSelection, seriesFilters)))();
    }
  }, [indicatorsWithData, selectedIndicatorIds, seriesFilters, view]);

  async function searchSeries() {
    const nextFilters = normalizeSeriesFilters(seriesFilters);
    setSeriesFilters(nextFilters);
    setSeriesByIndicatorId(await refreshSeries(selectedIndicatorIds, nextFilters));
  }

  async function clearSeries() {
    const nextFilters = defaultSeriesFilters();
    setSeriesFilters(nextFilters);
    setSeriesByIndicatorId(await refreshSeries(selectedIndicatorIds, nextFilters));
  }

  async function loadProfiles(nextFilters = profilesFilters, page = profilesPage, pageSize = profilesPageSize) {
    const normalized = normalizeProfilesFilters(nextFilters);
    const year = Number(normalized.year);
    const [rows, summary, coefficients, uploads] = await Promise.all([
      getEsiosInitialProfiles({ ...normalized, skip: page * pageSize, take: pageSize }),
      getEsiosProfilesSummary(year),
      getEsiosProfileCoefficients(year),
      getEsiosProfileUploads({ year, take: 50 })
    ]);
    setProfilesFilters(normalized);
    setProfilesResponse(rows);
    setProfilesSummary(summary);
    setProfileCoefficients(withCoefficientDefaults(year, coefficients));
    setProfileUploads(uploads);
  }

  async function loadIntermediates(nextFilters = profilesFilters, page = intermediatePage, pageSize = intermediatePageSize) {
    const normalized = normalizeProfilesFilters(nextFilters);
    const year = Number(normalized.year);
    const [rows, summary, logs, finalDemand, finalProfiles] = await Promise.all([
      getEsiosIntermediateProfiles({ ...normalized, skip: page * pageSize, take: pageSize }),
      getEsiosIntermediateProfilesSummary(year),
      getEsiosProfileCalculationLogs({ year, take: 50 }),
      getEsiosReeFinalDemandUploads({ year, take: 50 }),
      getEsiosReeFinalProfileUploads({ year, take: 50 })
    ]);
    setProfilesFilters(normalized);
    setIntermediateResponse(rows);
    setIntermediateSummary(summary);
    setIntermediateCalculationLogs(logs);
    setFinalDemandUploads(finalDemand);
    setFinalProfileUploads(finalProfiles);
    setIntermediateHeaderRows(await loadAllIntermediateExportRows(normalized));
  }

  async function loadAllIntermediateExportRows(nextFilters = profilesFilters) {
    const normalized = normalizeProfilesFilters(nextFilters);
    const rows: EsiosProfileIntermediateRow[] = [];
    const pageSize = 5000;
    let skip = 0;

    while (true) {
      const response = await getEsiosIntermediateProfiles({ ...normalized, skip, take: pageSize });
      rows.push(...response.rows);
      if (!response.hasNext) {
        break;
      }
      skip += pageSize;
    }

    return buildProfilePivotRows(rows);
  }

  async function searchProfiles() {
    setLoading(true);
    setMessage(undefined);
    try {
      setProfilesPage(0);
      await loadProfiles(profilesFilters, 0, profilesPageSize);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando perfiles ESIOS." });
    } finally {
      setLoading(false);
    }
  }

  async function clearProfiles() {
    const nextFilters = defaultProfilesFilters();
    setLoading(true);
    setMessage(undefined);
    try {
      setProfilesPage(0);
      await loadProfiles(nextFilters, 0, profilesPageSize);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando perfiles ESIOS." });
    } finally {
      setLoading(false);
    }
  }

  async function calculateIntermediates() {
    const year = Number(profilesFilters.year);
    setLoading(true);
    setMessage(undefined);
    try {
      const response = await calculateEsiosIntermediateProfiles(year);
      setIntermediateSummary(response.summary);
      setMessage({ tone: "success", text: `Perfiles intermedios calculados: ${formatNumber(response.rowsProcessed)} filas y ${formatNumber(response.tariffsProcessed)} tarifas.` });
      setIntermediatePage(0);
      await loadIntermediates(profilesFilters, 0, intermediatePageSize);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error calculando perfiles intermedios." });
    } finally {
      setLoading(false);
    }
  }

  async function searchIntermediates() {
    setLoading(true);
    setMessage(undefined);
    try {
      setIntermediatePage(0);
      await loadIntermediates(profilesFilters, 0, intermediatePageSize);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando perfiles intermedios." });
    } finally {
      setLoading(false);
    }
  }

  async function clearIntermediates() {
    const nextFilters = defaultProfilesFilters();
    setLoading(true);
    setMessage(undefined);
    try {
      setIntermediatePage(0);
      await loadIntermediates(nextFilters, 0, intermediatePageSize);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando perfiles intermedios." });
    } finally {
      setLoading(false);
    }
  }

  async function uploadProfilesFile(file: File) {
    const year = Number(profilesFilters.year);
    setLoading(true);
    setMessage(undefined);
    setProfilesUploadProgress(0);
    try {
      const runUpload = async (replace: boolean) => uploadEsiosProfiles(file, year, replace, setProfilesUploadProgress);
      try {
        const response = await runUpload(false);
        setProfilesSummary(response.summary);
        setMessage({ tone: "success", text: `Perfiles ESIOS cargados: ${formatNumber(response.rowsImported)} horas y ${formatNumber(response.coefficientsImported)} coeficientes.` });
      } catch (error) {
        const text = error instanceof Error ? error.message : "Error cargando Excel.";
        if (text.includes("Ya existe") && window.confirm(`${text}\n\n¿Reemplazar los datos del año ${year}?`)) {
          const response = await runUpload(true);
          setProfilesSummary(response.summary);
          setMessage({ tone: "success", text: `Perfiles ESIOS reemplazados: ${formatNumber(response.rowsImported)} horas y ${formatNumber(response.coefficientsImported)} coeficientes.` });
        } else {
          throw error;
        }
      }
      setProfilesPage(0);
      await loadProfiles(profilesFilters, 0, profilesPageSize);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando Excel de perfiles." });
    } finally {
      setLoading(false);
      setProfilesUploadProgress(0);
    }
  }

  async function uploadFinalDemandFile(file: File) {
    const year = Number(profilesFilters.year);
    const month = Number(profilesFilters.month);
    const day = finalDemandDay.trim() === "" ? undefined : Number(finalDemandDay);
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      setMessage({ tone: "error", text: "Selecciona un mes para cargar el fichero DEMR." });
      return;
    }
    if (day !== undefined && (!Number.isFinite(day) || day < 1 || day > 31)) {
      setMessage({ tone: "error", text: "El día DEMR no es válido." });
      return;
    }
    setLoading(true);
    setMessage(undefined);
    setFinalDemandUploadProgress(0);
    try {
      const runUpload = async (replace: boolean) => uploadEsiosReeFinalDemand(file, year, month, replace, setFinalDemandUploadProgress, day);
      try {
        const response = await runUpload(false);
        setIntermediateSummary(response.validation);
        setMessage({ tone: "success", text: `DEMR cargado: ${formatNumber(response.rowsImported)} horas para ${response.upload.periodKey ?? `${year}-${String(month).padStart(2, "0")}`}.` });
      } catch (error) {
        const text = error instanceof Error ? error.message : "Error cargando DEMR.";
        if (text.includes("Ya existe") && window.confirm(`${text}\n\n¿Reemplazar la carga DEMR del mes ${year}-${String(month).padStart(2, "0")}?`)) {
          const response = await runUpload(true);
          setIntermediateSummary(response.validation);
          setMessage({ tone: "success", text: `DEMR reemplazado: ${formatNumber(response.rowsImported)} horas para ${response.upload.periodKey ?? `${year}-${String(month).padStart(2, "0")}`}.` });
        } else {
          throw error;
        }
      }
      setIntermediatePage(0);
      await loadIntermediates(profilesFilters, 0, intermediatePageSize);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando fichero DEMR." });
    } finally {
      setLoading(false);
      setFinalDemandUploadProgress(0);
    }
  }

  async function uploadFinalProfileFile(file: File) {
    const year = Number(profilesFilters.year);
    const month = Number(profilesFilters.month);
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      setMessage({ tone: "error", text: "Selecciona un mes para cargar el fichero PERFF." });
      return;
    }
    setLoading(true);
    setMessage(undefined);
    setFinalProfileUploadProgress(0);
    try {
      const runUpload = async (replace: boolean) => uploadEsiosReeFinalProfiles(file, year, month, replace, setFinalProfileUploadProgress);
      try {
        const response = await runUpload(false);
        setIntermediateSummary(response.validation);
        setMessage({ tone: "success", text: `PERFF cargado: ${formatNumber(response.rowsImported)} horas para ${year}-${String(month).padStart(2, "0")}.` });
      } catch (error) {
        const text = error instanceof Error ? error.message : "Error cargando PERFF.";
        if (text.includes("Ya existe") && window.confirm(`${text}\n\n¿Reemplazar la carga PERFF del mes ${year}-${String(month).padStart(2, "0")}?`)) {
          const response = await runUpload(true);
          setIntermediateSummary(response.validation);
          setMessage({ tone: "success", text: `PERFF reemplazado: ${formatNumber(response.rowsImported)} horas para ${year}-${String(month).padStart(2, "0")}.` });
        } else {
          throw error;
        }
      }
      setIntermediatePage(0);
      await loadIntermediates(profilesFilters, 0, intermediatePageSize);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando fichero PERFF." });
    } finally {
      setLoading(false);
      setFinalProfileUploadProgress(0);
    }
  }

  async function saveCoefficients() {
    const year = Number(profilesFilters.year);
    setLoading(true);
    setMessage(undefined);
    try {
      const saved = await saveEsiosProfileCoefficients(year, profileCoefficients);
      setProfileCoefficients(withCoefficientDefaults(year, saved));
      setProfilesSummary(await getEsiosProfilesSummary(year));
      setMessage({ tone: "success", text: "Coeficientes ESIOS guardados." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error guardando coeficientes." });
    } finally {
      setLoading(false);
    }
  }

  async function runIndicatorDownload(indicatorId = downloadIndicatorId, startDate = downloadDraft.startDate, endDate = downloadDraft.endDate) {
    setLoading(true);
    setMessage(undefined);
    try {
      const summary = await downloadEsiosIndicator(indicatorId, startDate, endDate);
      setLatestDownload(summary);
      setMessage({
        tone: "success",
        text: `Descarga ESIOS completada: ${formatNumber(summary.downloadedRecords)} descargados, ${formatNumber(summary.insertedRecords)} insertados, ${formatNumber(summary.updatedRecords)} actualizados.`
      });
      await loadCurrent(view === "series" ? seriesFilters : undefined);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error descargando ESIOS." });
    } finally {
      setLoading(false);
    }
  }

  async function syncCatalog() {
    setLoading(true);
    setMessage(undefined);
    try {
      const response = await syncEsiosIndicators();
      setIndicators(response.indicators);
      setMessage({ tone: "success", text: `Catalogo ESIOS sincronizado: ${formatNumber(response.savedRecords)} indicadores guardados.` });
      await loadCurrent(seriesFilters);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error sincronizando catalogo ESIOS." });
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    if (!config) {
      return;
    }
    setLoading(true);
    setMessage(undefined);
    try {
      const saved = await saveEsiosConfig({ ...config, apiToken: configToken || undefined });
      setConfig(saved);
      setConfigToken("");
      setMessage({ tone: "success", text: "Configuracion ESIOS guardada." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error guardando configuracion ESIOS." });
    } finally {
      setLoading(false);
    }
  }

  async function testConnection() {
    setLoading(true);
    setMessage(undefined);
    try {
      const result = await testEsiosConnection();
      setConnectionResult(result);
      setMessage({ tone: result.status === "ok" ? "success" : "error", text: connectionLabel(result) });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error probando conexion ESIOS." });
    } finally {
      setLoading(false);
    }
  }

  function toggleSelectedIndicator(indicatorId: number) {
    const next = selectedIndicatorIds.includes(indicatorId)
      ? selectedIndicatorIds.filter((value) => value !== indicatorId)
      : [...selectedIndicatorIds, indicatorId];
    setSelectedIndicatorIds(next);
    void (async () => setSeriesByIndicatorId(await refreshSeries(next, seriesFilters)))();
  }

  function selectAllIndicators() {
    const next = indicatorsWithData.map((indicator) => indicator.indicatorId);
    setSelectedIndicatorIds(next);
    void (async () => setSeriesByIndicatorId(await refreshSeries(next, seriesFilters)))();
  }

  function clearIndicators() {
    setSelectedIndicatorIds([]);
    setSeriesByIndicatorId({});
  }

  return (
    <section className="omie-layout omie-layout-a esios-module">
      {message && <div className={`status-message ${message.tone}`}>{message.text}</div>}
      {view === "indicadores" && <IndicatorsView indicators={indicators} indicatorsWithData={indicatorsWithData} loading={loading} search={indicatorSearch} onRefresh={() => loadCurrent()} onSearchChange={setIndicatorSearch} onSync={syncCatalog} />}
      {view === "perfiles" && (
        <ProfilesView
          coefficients={profileCoefficients}
          calculationLogs={intermediateCalculationLogs?.logs ?? []}
          filters={profilesFilters}
          loading={loading}
          headerRows={intermediateHeaderRows}
          intermediateResponse={intermediateResponse}
          intermediateSummary={intermediateSummary}
          intermediatePage={intermediatePage}
          intermediatePageSize={intermediatePageSize}
          intermediateTotal={intermediateResponse?.total ?? 0}
          loadExportRows={loadAllIntermediateExportRows}
          unifiedUploads={unifiedUploads}
          tab={profilesTab}
          uploadProgress={profilesUploadProgress}
          finalDemandUploadProgress={finalDemandUploadProgress}
          finalProfileUploadProgress={finalProfileUploadProgress}
          finalDemandDay={finalDemandDay}
          onCalculateIntermediates={calculateIntermediates}
          onCoefficientsChange={setProfileCoefficients}
          onFiltersChange={setProfilesFilters}
          onIntermediatePageChange={async (nextPage) => {
            setIntermediatePage(nextPage);
            await loadIntermediates(profilesFilters, nextPage, intermediatePageSize);
          }}
          onIntermediatePageSizeChange={async (nextPageSize) => {
            setIntermediatePageSize(nextPageSize);
            setIntermediatePage(0);
            await loadIntermediates(profilesFilters, 0, nextPageSize);
          }}
          onIntermediateSearch={searchIntermediates}
          onIntermediateClear={clearIntermediates}
          onIntermediateRefresh={async () => loadIntermediates(profilesFilters, intermediatePage, intermediatePageSize)}
          onSaveCoefficients={saveCoefficients}
          onTabChange={async (tab) => {
            setProfilesTab(tab);
            if (tab === "perfiles") {
              await loadIntermediates(profilesFilters, intermediatePage, intermediatePageSize);
            }
          }}
          onFinalDemandDayChange={setFinalDemandDay}
          onUpload={uploadProfilesFile}
          onUploadFinalDemand={uploadFinalDemandFile}
          onUploadFinalProfile={uploadFinalProfileFile}
        />
      )}
      {view === "series" && (
        <SeriesView
          availableIndicators={indicatorsWithData}
          loading={loading}
          selectedIndicatorIds={selectedIndicatorIds}
          seriesByIndicatorId={seriesByIndicatorId}
          seriesFilters={seriesFilters}
          onClearIndicators={clearIndicators}
          onClearFilters={clearSeries}
          onFiltersChange={setSeriesFilters}
          onRefresh={async () => setSeriesByIndicatorId(await refreshSeries(selectedIndicatorIds, seriesFilters))}
          onSearch={searchSeries}
          onSelectAll={selectAllIndicators}
          onToggleIndicator={toggleSelectedIndicator}
        />
      )}
      {view === "descargas" && (
        <DownloadsView
          downloadDraft={downloadDraft}
          indicators={indicators}
          latestDownload={latestDownload}
          loading={loading}
          logs={logs?.logs ?? []}
          downloadIndicatorId={downloadIndicatorId}
          onDownload={() => runIndicatorDownload()}
          onDraftChange={setDownloadDraft}
          onDownloadIndicatorChange={setDownloadIndicatorId}
        />
      )}
      {view === "configuracion" && (
        <ConfigurationView
          config={config}
          connectionResult={connectionResult}
          loading={loading}
          token={configToken}
          onConfigChange={setConfig}
          onSave={saveConfig}
          onTest={testConnection}
          onTokenChange={setConfigToken}
        />
      )}
    </section>
  );
}

function ProfilesView({
  coefficients,
  calculationLogs,
  filters,
  loading,
  headerRows,
  intermediatePage,
  intermediatePageSize,
  intermediateResponse,
  intermediateSummary,
  intermediateTotal,
  loadExportRows,
  unifiedUploads,
  tab,
  uploadProgress,
  finalDemandUploadProgress,
  finalProfileUploadProgress,
  finalDemandDay,
  onCalculateIntermediates,
  onCoefficientsChange,
  onFiltersChange,
  onIntermediateClear,
  onIntermediatePageChange,
  onIntermediatePageSizeChange,
  onIntermediateRefresh,
  onIntermediateSearch,
  onSaveCoefficients,
  onTabChange,
  onFinalDemandDayChange,
  onUpload,
  onUploadFinalDemand,
  onUploadFinalProfile
}: {
  coefficients: EsiosProfileCoefficient[];
  calculationLogs: EsiosProfileIntermediateLog[];
  filters: EsiosProfilesFilters;
  loading: boolean;
  headerRows: EsiosProfilePivotRow[];
  intermediatePage: number;
  intermediatePageSize: number;
  intermediateResponse?: EsiosProfileIntermediatesResponse;
  intermediateSummary?: EsiosProfileIntermediateSummary;
  intermediateTotal: number;
  loadExportRows: () => Promise<EsiosProfilePivotRow[]>;
  unifiedUploads: UnifiedProfileUploadRow[];
  tab: "perfiles" | "coeficientes" | "cargas";
  uploadProgress: number;
  finalDemandUploadProgress: number;
  finalProfileUploadProgress: number;
  finalDemandDay: string;
  onCalculateIntermediates: () => void;
  onCoefficientsChange: (rows: EsiosProfileCoefficient[]) => void;
  onFiltersChange: (filters: EsiosProfilesFilters) => void;
  onIntermediateClear: () => void;
  onIntermediatePageChange: (page: number) => void;
  onIntermediatePageSizeChange: (pageSize: number) => void;
  onIntermediateRefresh: () => void;
  onIntermediateSearch: () => void;
  onSaveCoefficients: () => void;
  onTabChange: (tab: "perfiles" | "coeficientes" | "cargas") => void;
  onFinalDemandDayChange: (value: string) => void;
  onUpload: (file: File) => void;
  onUploadFinalDemand: (file: File) => void;
  onUploadFinalProfile: (file: File) => void;
}) {
  const intermediateRows = intermediateResponse?.rows ?? [];
  const profileRows = useMemo(() => buildProfilePivotRows(intermediateRows), [intermediateRows]);
  const profileColumns = useMemo<Array<TechnicalColumn<EsiosProfilePivotRow>>>(() => buildProfilePivotColumns(headerRows), [headerRows]);

  return (
    <>
      <div className="panel wide omie-control-panel">
        <PanelTitle icon={<FileSpreadsheet size={18} />} title="Perfiles REE" subtitle="Carga de perfiles iniciales, demanda de referencia y coeficientes anuales" />
        <FilterToolbar ariaLabel="Filtros y acciones de Perfiles REE">
          <FilterToolbarGroup className="filter-toolbar-group--filters">
            <FilterToolbarField label="Año" width={92}>
              <input type="number" value={filters.year ?? ""} onChange={(event) => onFiltersChange({ ...filters, year: event.target.value })} />
            </FilterToolbarField>
            <FilterToolbarField label="Mes" width={76}>
              <input max="12" min="1" type="number" value={filters.month ?? ""} onChange={(event) => onFiltersChange({ ...filters, month: event.target.value })} />
            </FilterToolbarField>
            <FilterToolbarField label="Fecha desde" width={148}>
              <input type="date" value={filters.fechaDesde ?? ""} onChange={(event) => onFiltersChange({ ...filters, fechaDesde: event.target.value })} />
            </FilterToolbarField>
            <FilterToolbarField label="Fecha hasta" width={148}>
              <input type="date" value={filters.fechaHasta ?? ""} onChange={(event) => onFiltersChange({ ...filters, fechaHasta: event.target.value })} />
            </FilterToolbarField>
          </FilterToolbarGroup>
          <FilterToolbarGroup className="filter-toolbar-group--actions">
            <button className="secondary-button filter-toolbar-action" disabled={loading} onClick={onIntermediateSearch} type="button"><Search size={16} />Buscar</button>
            <button className="secondary-button filter-toolbar-action" disabled={loading} onClick={onIntermediateClear} type="button"><RotateCcw size={16} />Limpiar</button>
            <button className="secondary-button filter-toolbar-action" disabled={loading} onClick={onIntermediateRefresh} type="button"><RefreshCw size={16} />Actualizar</button>
          </FilterToolbarGroup>
          <FilterToolbarGroup className="filter-toolbar-group--primary">
            <button className="primary-button filter-toolbar-action filter-toolbar-action--primary" disabled={loading} onClick={onCalculateIntermediates} type="button"><Calculator size={16} />Calcular perfiles</button>
            <label className={`primary-button filter-toolbar-action filter-toolbar-action--file filter-toolbar-action--wide ${loading ? "disabled" : ""}`}>
              <FileSpreadsheet size={16} />
              Cargar perfiles iniciales
              <input
                accept=".xlsx,.xls"
                disabled={loading}
                style={{ display: "none" }}
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) {
                    onUpload(file);
                  }
                }}
              />
            </label>
          </FilterToolbarGroup>
          <FilterToolbarGroup className="filter-toolbar-group--manual">
            <FilterToolbarField label="Día DEMR" width={92}>
              <input
                max="31"
                min="1"
                type="number"
                value={finalDemandDay}
                onChange={(event) => onFinalDemandDayChange(event.target.value)}
              />
            </FilterToolbarField>
            <label className={`primary-button filter-toolbar-action filter-toolbar-action--file filter-toolbar-action--narrow ${loading ? "disabled" : ""}`}>
              <FileSpreadsheet size={16} />
              Cargar DEMR
              <input
                accept=".txt,.csv,.gz"
                disabled={loading}
                style={{ display: "none" }}
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) {
                    onUploadFinalDemand(file);
                  }
                }}
              />
            </label>
            <label className={`primary-button filter-toolbar-action filter-toolbar-action--file filter-toolbar-action--narrow ${loading ? "disabled" : ""}`}>
              <FileSpreadsheet size={16} />
              Cargar PERFF
              <input
                accept=".txt,.csv"
                disabled={loading}
                style={{ display: "none" }}
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) {
                    onUploadFinalProfile(file);
                  }
                }}
              />
            </label>
          </FilterToolbarGroup>
        </FilterToolbar>
        {uploadProgress > 0 && <div className="progress-bar"><span style={{ width: `${uploadProgress}%` }} /></div>}
        {finalDemandUploadProgress > 0 && <div className="progress-bar"><span style={{ width: `${finalDemandUploadProgress}%` }} /></div>}
        {finalProfileUploadProgress > 0 && <div className="progress-bar"><span style={{ width: `${finalProfileUploadProgress}%` }} /></div>}
      </div>

      <div className="view-tabs">
        <button className={tab === "perfiles" ? "active" : ""} onClick={() => onTabChange("perfiles")} type="button">Perfiles</button>
        <button className={tab === "coeficientes" ? "active" : ""} onClick={() => onTabChange("coeficientes")} type="button">Coeficientes</button>
        <button className={tab === "cargas" ? "active" : ""} onClick={() => onTabChange("cargas")} type="button">Cargas</button>
      </div>

      {tab === "coeficientes" && (
        <CoefficientsTable coefficients={coefficients} loading={loading} onChange={onCoefficientsChange} onSave={onSaveCoefficients} />
      )}

      {tab === "perfiles" && (
        <>
          <TechnicalDataTable
            columns={profileColumns}
            exportFileName={`esios-perfiles-intermedios-${filters.year ?? "base"}`}
            getDuplicateKey={(row) => `${row.year}|${row.datetime}`}
            getGroupLabel={() => "Perfiles"}
            getRowId={(row) => row.id}
            getRowQuality={buildProfilePivotRowQuality}
            hasNext={intermediateResponse?.hasNext ?? false}
            loadExportRows={loadExportRows}
            kpis={[]}
            loading={loading}
            onPageChange={onIntermediatePageChange}
            onPageSizeChange={onIntermediatePageSizeChange}
            page={intermediatePage}
            pageSize={intermediatePageSize}
            rows={profileRows}
            title={`Perfiles (${formatNumber(intermediateTotal)} registros)`}
          />

        </>
      )}

      {tab === "cargas" && (
        <>
          <div className="panel wide">
            <PanelTitle icon={<Clock3 size={18} />} title="Cargas" subtitle="Historial unificado de cálculos y ficheros de perfiles" />
            <div className="table-scroll">
              <table className="ree-download-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Periodo</th>
                    <th>Tipo</th>
                    <th>Estado</th>
                    <th>Inicio</th>
                    <th>Fin</th>
                    <th>Tiempo ms</th>
                    <th>Filas</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {calculationLogs.length === 0 && unifiedUploads.length === 0 && (
                    <tr>
                      <td colSpan={9}><div className="empty-state">Sin cargas registradas.</div></td>
                    </tr>
                  )}
                  {calculationLogs.map((log) => (
                    <tr key={`calc-${log.id}`}>
                      <td>{formatOptionalDateTime(log.finishedAt ?? log.startedAt)}</td>
                      <td>-</td>
                      <td>Cálculo perfiles</td>
                      <td><span className={`ops-status-badge ${log.status === "SUCCESS" ? "valid" : log.status === "ERROR" ? "error" : "warning"}`}>{log.status}</span></td>
                      <td>{formatOptionalDateTime(log.startedAt)}</td>
                      <td>{formatOptionalDateTime(log.finishedAt)}</td>
                      <td>{log.executionTimeMs ?? "-"}</td>
                      <td>{formatNumber(log.rowsProcessed)}</td>
                      <td>{log.errorMessage ?? "-"}</td>
                    </tr>
                  ))}
                  {unifiedUploads.map((upload) => (
                    <tr key={`upload-${upload.id}`}>
                      <td>{formatOptionalDateTime(upload.uploadedAt)}</td>
                      <td>{upload.period}</td>
                      <td>{upload.kind}</td>
                      <td><span className={`ops-status-badge ${upload.status === "IMPORTED" ? "valid" : "error"}`}>{upload.status}</span></td>
                      <td>-</td>
                      <td>-</td>
                      <td>-</td>
                      <td>{formatNumber(upload.rows)}</td>
                      <td>{upload.errorMessage ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function CoefficientsTable({
  coefficients,
  loading,
  onChange,
  onSave
}: {
  coefficients: EsiosProfileCoefficient[];
  loading: boolean;
  onChange: (rows: EsiosProfileCoefficient[]) => void;
  onSave: () => void;
}) {
  function update(index: number, key: "alpha" | "beta" | "gamma", value: string) {
    const number = Number(value);
    onChange(coefficients.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: Number.isFinite(number) ? number : 0 } : row)));
  }

  return (
    <div className="panel wide">
      <div className="omie-toolbar compact">
        <button className="primary-button" disabled={loading} onClick={onSave} type="button"><Save size={16} />Guardar coeficientes</button>
      </div>
      <div className="table-scroll">
        <table className="ree-download-table">
          <thead>
            <tr><th>Tarifa</th><th>Alpha ai</th><th>Beta bi</th><th>Gamma gi</th></tr>
          </thead>
          <tbody>
            {coefficients.map((row, index) => (
              <tr key={row.tariff}>
                <td>{row.tariff}</td>
                <td><input type="number" step="0.000000000000001" value={row.alpha} onChange={(event) => update(index, "alpha", event.target.value)} /></td>
                <td><input type="number" step="0.000000000000001" value={row.beta} onChange={(event) => update(index, "beta", event.target.value)} /></td>
                <td><input type="number" step="0.000000000000001" value={row.gamma} onChange={(event) => update(index, "gamma", event.target.value)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IndicatorsView({
  indicators,
  indicatorsWithData,
  loading,
  search,
  onRefresh,
  onSearchChange,
  onSync
}: {
  indicators: EsiosIndicator[];
  indicatorsWithData: EsiosIndicator[];
  loading: boolean;
  search: string;
  onRefresh: () => void;
  onSearchChange: (value: string) => void;
  onSync: () => void;
}) {
  const filteredIndicators = indicators.filter((indicator) => matchesIndicatorSearch(indicator, search));
  return (
    <>
      <div className="panel wide omie-control-panel">
        <PanelTitle icon={<Activity size={18} />} title="Indicadores ESIOS" subtitle={`${formatNumber(filteredIndicators.length)} de ${formatNumber(indicators.length)} indicadores · ${formatNumber(indicatorsWithData.length)} con datos`} />
        <div className="omie-toolbar compact">
          <button className="secondary-button" disabled={loading} onClick={onSync} type="button">
            <RefreshCw size={16} />
            Sincronizar catalogo ESIOS
          </button>
          <button className="secondary-button" disabled={loading} onClick={onRefresh} type="button">
            <Search size={16} />
            Actualizar
          </button>
          <label className="filter-field">
            <span>Buscar</span>
            <input
              placeholder="ID, nombre o descripción"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </label>
        </div>
      </div>
      <div className="panel wide">
        <div className="table-scroll">
          <table className="ree-download-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nombre</th>
                <th>Nombre corto</th>
                <th>Unidad</th>
                <th>Frecuencia</th>
                <th>Activo</th>
                <th>Datos</th>
              </tr>
            </thead>
            <tbody>
              {filteredIndicators.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">{indicators.length === 0 ? "Sin indicadores ESIOS guardados." : "No hay coincidencias con la búsqueda."}</div>
                  </td>
                </tr>
              )}
              {filteredIndicators.map((indicator) => (
                <tr key={indicator.id}>
                  <td>{indicator.indicatorId}</td>
                  <td>{indicator.name ?? "-"}</td>
                  <td>{indicator.shortName ?? "-"}</td>
                  <td>{indicator.unit ?? "-"}</td>
                  <td>{indicator.frequency ?? "-"}</td>
                  <td>{indicator.active ? "Si" : "No"}</td>
                  <td>{indicatorsWithData.some((item) => item.indicatorId === indicator.indicatorId) ? "Si" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function buildUnifiedProfileUploads(
  profileUploads: EsiosProfileUpload[],
  finalDemandUploads: EsiosReeFinalDemandUpload[],
  finalProfileUploads: EsiosReeFinalProfileUpload[]
) {
  const uploads: UnifiedProfileUploadRow[] = [
    ...profileUploads.map((upload) => ({
      id: upload.id,
      uploadedAt: upload.uploadedAt,
      kind: "Perfiles iniciales" as const,
      year: upload.year,
      month: null,
      day: null,
      period: formatProfileUploadPeriod(upload.year, null, null),
      fileName: upload.fileName,
      rows: upload.validRows,
      status: upload.status,
      errorMessage: upload.errorMessage,
      uploadedBy: upload.uploadedBy
    })),
    ...finalDemandUploads.map((upload) => ({
      id: upload.id,
      uploadedAt: upload.uploadedAt,
      kind: "DEMR" as const,
      year: upload.year,
      month: upload.month,
      day: upload.day,
      period: formatProfileUploadPeriod(upload.year, upload.month, upload.day),
      fileName: upload.fileName,
      rows: upload.validRows,
      status: upload.status,
      errorMessage: upload.errorMessage,
      uploadedBy: upload.uploadedBy
    })),
    ...finalProfileUploads.map((upload) => ({
      id: upload.id,
      uploadedAt: upload.uploadedAt,
      kind: "PERFF" as const,
      year: upload.year,
      month: upload.month,
      day: null,
      period: formatProfileUploadPeriod(upload.year, upload.month, null),
      fileName: upload.fileName,
      rows: upload.validRows,
      status: upload.status,
      errorMessage: upload.errorMessage,
      uploadedBy: upload.uploadedBy
    }))
  ];
  return uploads.sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
}

function formatProfileUploadPeriod(year: number, month: number | null, day: number | null) {
  if (month === null) {
    return String(year);
  }
  if (day === null) {
    return `${year}-${String(month).padStart(2, "0")}`;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function SeriesView({
  availableIndicators,
  loading,
  selectedIndicatorIds,
  seriesByIndicatorId,
  seriesFilters,
  onClearIndicators,
  onClearFilters,
  onFiltersChange,
  onRefresh,
  onSearch,
  onSelectAll,
  onToggleIndicator
}: {
  availableIndicators: EsiosIndicator[];
  loading: boolean;
  selectedIndicatorIds: number[];
  seriesByIndicatorId: Record<number, EsiosValuesResponse>;
  seriesFilters: EsiosValuesFilters;
  onClearIndicators: () => void;
  onClearFilters: () => void;
  onFiltersChange: (filters: EsiosValuesFilters) => void;
  onRefresh: () => void;
  onSearch: () => void;
  onSelectAll: () => void;
  onToggleIndicator: (indicatorId: number) => void;
}) {
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerFilter, setPickerFilter] = useState<SeriesIndicatorFilter>("all");
  const selectedIndicators = useMemo(
    () => selectedIndicatorIds
      .map((indicatorId) => availableIndicators.find((indicator) => indicator.indicatorId === indicatorId))
      .filter((indicator): indicator is EsiosIndicator => Boolean(indicator)),
    [availableIndicators, selectedIndicatorIds]
  );
  const filteredIndicators = useMemo(() => {
    const needle = pickerSearch.trim().toLowerCase();
    return availableIndicators.filter((indicator) => {
      if (pickerFilter === "withData" && !indicator.hasData) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return [
        String(indicator.indicatorId),
        indicator.name ?? "",
        indicator.shortName ?? "",
        indicator.description ?? "",
        indicator.frequency ?? "",
        indicator.unit ?? ""
      ].join(" ").toLowerCase().includes(needle);
    });
  }, [availableIndicators, pickerFilter, pickerSearch]);

  return (
    <>
      <div className="panel wide omie-control-panel">
        <PanelTitle icon={<Zap size={18} />} title="ESIOS Series" subtitle="Selecciona uno o varios indicadores descargados y compáralos en la misma pantalla." />
        <div className="omie-toolbar compact">
          <label className="filter-field">
            <span>Fecha desde</span>
            <input type="date" value={seriesFilters.fechaDesde ?? ""} onChange={(event) => onFiltersChange({ ...seriesFilters, fechaDesde: event.target.value, year: undefined, month: undefined })} />
          </label>
          <label className="filter-field">
            <span>Fecha hasta</span>
            <input type="date" value={seriesFilters.fechaHasta ?? ""} onChange={(event) => onFiltersChange({ ...seriesFilters, fechaHasta: event.target.value, year: undefined, month: undefined })} />
          </label>
          <label className="filter-field">
            <span>Año</span>
            <input type="number" value={seriesFilters.year ?? ""} onChange={(event) => onFiltersChange({ ...seriesFilters, year: event.target.value, fechaDesde: undefined, fechaHasta: undefined })} />
          </label>
          <label className="filter-field">
            <span>Mes</span>
            <input max="12" min="1" type="number" value={seriesFilters.month ?? ""} onChange={(event) => onFiltersChange({ ...seriesFilters, month: event.target.value, fechaDesde: undefined, fechaHasta: undefined })} />
          </label>
          <button className="secondary-button" disabled={loading} onClick={onSearch} type="button">
            <Search size={16} />
            Buscar
          </button>
          <button className="secondary-button" disabled={loading} onClick={onClearFilters} type="button">
            <RotateCcw size={16} />
            Limpiar
          </button>
          <button className="secondary-button" disabled={loading || availableIndicators.length === 0} onClick={onSelectAll} type="button">
            <CheckCircle2 size={16} />
            Seleccionar todo
          </button>
          <button className="secondary-button" disabled={loading || selectedIndicatorIds.length === 0} onClick={onClearIndicators} type="button">
            <XCircle size={16} />
            Limpiar selección
          </button>
          <button className="secondary-button" disabled={loading} onClick={onRefresh} type="button">
            <RefreshCw size={16} />
            Recargar
          </button>
          <button className="secondary-button" disabled={loading || selectedIndicatorIds.length === 0} onClick={() => exportComparisonSeries(selectedIndicatorIds, seriesByIndicatorId, availableIndicators, "xls")} type="button">
            <FileSpreadsheet size={16} />
            Exportar Excel
          </button>
          <button className="secondary-button" disabled={loading || selectedIndicatorIds.length === 0} onClick={() => exportComparisonSeries(selectedIndicatorIds, seriesByIndicatorId, availableIndicators, "csv")} type="button">
            <FileDown size={16} />
            Exportar CSV
          </button>
        </div>
      </div>

      <div className="panel wide">
        <div className="esios-indicator-selector">
          <div className="esios-selected-summary">
            <div>
              <strong>{formatNumber(selectedIndicators.length)} seleccionados</strong>
              <span>{selectedIndicators.length === 0 ? "Sin indicador seleccionado" : selectedIndicators.map((indicator) => `${indicator.indicatorId} - ${indicator.shortName ?? indicator.name ?? "-"}`).join(" · ")}</span>
            </div>
            <button className="secondary-button" disabled={loading || selectedIndicatorIds.length === 0} onClick={onClearIndicators} type="button">
              <XCircle size={16} />
              Limpiar
            </button>
          </div>

          {selectedIndicators.length > 0 && (
            <div className="esios-selected-list">
              {selectedIndicators.map((indicator) => (
                <button disabled={loading} key={indicator.id} onClick={() => onToggleIndicator(indicator.indicatorId)} title="Quitar indicador" type="button">
                  <strong>{indicator.indicatorId}</strong>
                  <span>{indicator.shortName ?? indicator.name ?? "-"}</span>
                  <XCircle size={14} />
                </button>
              ))}
            </div>
          )}

          <div className="esios-indicator-filterbar">
            <label className="ops-search">
              <Search size={16} />
              <input
                aria-label="Buscar indicador ESIOS"
                placeholder="Buscar ID, nombre, familia..."
                value={pickerSearch}
                onChange={(event) => setPickerSearch(event.target.value)}
              />
            </label>
            <div className="technical-mode" aria-label="Filtro de indicadores ESIOS">
              <button className={pickerFilter === "all" ? "active" : ""} onClick={() => setPickerFilter("all")} type="button">Todos</button>
              <button className={pickerFilter === "withData" ? "active" : ""} onClick={() => setPickerFilter("withData")} type="button">Con datos</button>
            </div>
            <span>{formatNumber(filteredIndicators.length)} de {formatNumber(availableIndicators.length)}</span>
          </div>

          <div className="esios-indicator-table-shell">
            <div className="esios-indicator-row header">
              <span>ID</span>
              <span>Nombre</span>
              <span>Familia</span>
              <span>Datos</span>
              <span>Acción</span>
            </div>
            {availableIndicators.length === 0 ? (
              <div className="empty-state">No hay indicadores con datos descargados.</div>
            ) : filteredIndicators.length === 0 ? (
              <div className="empty-state">No hay coincidencias con la búsqueda.</div>
            ) : (
              filteredIndicators.map((indicator) => {
                const selected = selectedIndicatorIds.includes(indicator.indicatorId);
                return (
                  <div className={`esios-indicator-row ${selected ? "selected" : ""}`} key={indicator.id}>
                    <span>{indicator.indicatorId}</span>
                    <span title={indicator.name ?? indicator.shortName ?? "-"}>{indicator.name ?? indicator.shortName ?? "-"}</span>
                    <span title={indicator.description ?? indicator.shortName ?? indicator.frequency ?? "-"}>{indicatorFamily(indicator)}</span>
                    <span>{indicator.hasData ? "Si" : "No"}</span>
                    <span>
                      <button className="secondary-button" disabled={loading} onClick={() => onToggleIndicator(indicator.indicatorId)} type="button">
                        {selected ? "Quitar" : "Seleccionar"}
                      </button>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {selectedIndicatorIds.length === 0 ? (
        <div className="panel wide">
          <div className="empty-state">Selecciona uno o varios indicadores con datos para ver su serie.</div>
        </div>
      ) : (
        <>
          <SeriesComparisonChart selectedIndicatorIds={selectedIndicatorIds} seriesByIndicatorId={seriesByIndicatorId} availableIndicators={availableIndicators} />
          <SeriesComparisonTable selectedIndicatorIds={selectedIndicatorIds} seriesByIndicatorId={seriesByIndicatorId} availableIndicators={availableIndicators} />
        </>
      )}
    </>
  );
}

function IndicatorSeriesPanel({
  indicator,
  response
}: {
  indicator: EsiosIndicator | null;
  response?: EsiosValuesResponse;
}) {
  const rows = response?.rows ?? [];
  const columns = useMemo<Array<TechnicalColumn<EsiosIndicatorValue>>>(() => buildSeriesColumns(), []);
  const kpis = useMemo(() => buildSeriesKpis(indicator, response), [indicator, response]);
  const title = indicator ? `${indicator.indicatorId} - ${indicator.name ?? indicator.shortName ?? "Sin nombre"}` : "Indicador ESIOS";

  return (
    <div className="esios-series-block">
      <div className="panel wide omie-control-panel">
        <PanelTitle icon={<Zap size={18} />} title={title} subtitle={response ? `${formatNumber(rows.length)} puntos � ${response.indicator?.unit ?? indicator?.unit ?? "-"}` : "Sin datos cargados"} />
        <div className="omie-toolbar compact">
          <span className="esios-indicator-badge">{indicator ? `${indicator.indicatorId} � ${indicator.shortName ?? indicator.name ?? "-"}` : "Indicador sin cargar"}</span>
        </div>
      </div>

      <TechnicalDataTable
        columns={columns}
        exportFileName={`esios-${indicator?.indicatorId ?? "serie"}`}
        getDuplicateKey={(row) => `${row.indicatorId}|${row.datetimeUtc ?? row.datetime}`}
        getGroupLabel={() => indicator?.name ?? "Serie ESIOS"}
        getRowId={(row) => row.id}
        getRowQuality={buildSeriesRowQuality}
        hasNext={response?.hasNext ?? false}
        kpis={kpis}
        loading={false}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        page={0}
        pageSize={rows.length || DEFAULT_PAGE_SIZE}
        rows={rows}
        showPagination={false}
        title="Detalle de serie"
      />
    </div>
  );
}

function SeriesComparisonChart({
  selectedIndicatorIds,
  seriesByIndicatorId,
  availableIndicators
}: {
  selectedIndicatorIds: number[];
  seriesByIndicatorId: Record<number, EsiosValuesResponse>;
  availableIndicators: EsiosIndicator[];
}) {
  const option = useMemo(
    () => buildSeriesComparisonChart(selectedIndicatorIds, seriesByIndicatorId, availableIndicators),
    [availableIndicators, selectedIndicatorIds, seriesByIndicatorId]
  );
  const totalRows = selectedIndicatorIds.reduce((total, indicatorId) => total + (seriesByIndicatorId[indicatorId]?.rows.length ?? 0), 0);

  return (
    <div className="panel wide omie-secondary-chart">
      <PanelTitle icon={<Activity size={18} />} title="Comparativa de series" subtitle={`${formatNumber(totalRows)} puntos visibles`} />
      <EChart option={option} height={360} />
    </div>
  );
}

function SeriesComparisonTable({
  selectedIndicatorIds,
  seriesByIndicatorId,
  availableIndicators
}: {
  selectedIndicatorIds: number[];
  seriesByIndicatorId: Record<number, EsiosValuesResponse>;
  availableIndicators: EsiosIndicator[];
}) {
  const rows = useMemo(() => buildSeriesComparisonRows(selectedIndicatorIds, seriesByIndicatorId), [selectedIndicatorIds, seriesByIndicatorId]);
  const columns = useMemo<Array<TechnicalColumn<EsiosComparisonRow>>>(() => buildSeriesComparisonColumns(selectedIndicatorIds, seriesByIndicatorId, availableIndicators), [
    availableIndicators,
    selectedIndicatorIds,
    seriesByIndicatorId
  ]);
  const kpis = useMemo<TechnicalKpi[]>(() => buildSeriesComparisonKpis(rows), [rows]);

  return (
    <div className="panel wide omie-control-panel">
      <PanelTitle icon={<Activity size={18} />} title="Tabla comparativa" subtitle="Una fila por fecha y una columna por indicador." />
      <TechnicalDataTable
        columns={columns}
        exportFileName="esios-series-comparativa"
        getDuplicateKey={(row) => row.datetime}
        getGroupLabel={() => "Series por columnas"}
        getRowId={(row) => row.datetime}
        getRowQuality={buildSeriesComparisonRowQuality}
        hasNext={false}
        kpis={kpis}
        loading={false}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        page={0}
        pageSize={rows.length || DEFAULT_PAGE_SIZE}
        rows={rows}
        showPagination={false}
        title="Series por columna"
      />
    </div>
  );
}

function DownloadsView({
  downloadDraft,
  indicators,
  latestDownload,
  loading,
  logs,
  downloadIndicatorId,
  onDownload,
  onDraftChange,
  onDownloadIndicatorChange
}: {
  downloadDraft: { startDate: string; endDate: string };
  indicators: EsiosIndicator[];
  latestDownload?: EsiosDownloadSummary;
  loading: boolean;
  logs: EsiosDownloadLog[];
  downloadIndicatorId: number;
  onDownload: () => void;
  onDraftChange: (value: { startDate: string; endDate: string }) => void;
  onDownloadIndicatorChange: (indicatorId: number) => void;
}) {
  const indicator = indicators.find((item) => item.indicatorId === downloadIndicatorId) ?? indicators[0];
  return (
    <>
      <div className="panel wide omie-control-panel">
        <PanelTitle icon={<Download size={18} />} title="Descargas ESIOS" subtitle={indicator?.name ?? "Indicadores del catálogo"} />
        <div className="omie-toolbar compact">
          <SearchableIndicatorSelect
            indicators={indicators}
            loading={loading}
            value={downloadIndicatorId}
            onChange={onDownloadIndicatorChange}
          />
          <label className="filter-field">
            <span>Fecha inicio</span>
            <input type="date" value={downloadDraft.startDate} onChange={(event) => onDraftChange({ ...downloadDraft, startDate: event.target.value })} />
          </label>
          <label className="filter-field">
            <span>Fecha fin</span>
            <input type="date" value={downloadDraft.endDate} onChange={(event) => onDraftChange({ ...downloadDraft, endDate: event.target.value })} />
          </label>
          <button className="primary-button" disabled={loading || !downloadDraft.startDate || !downloadDraft.endDate} onClick={onDownload} type="button">
            <Download size={16} />
            Descargar ESIOS
          </button>
        </div>
      </div>
      {latestDownload && (
        <div className="technical-kpis">
          <div className="technical-kpi good"><span>Descargados</span><strong>{formatNumber(latestDownload.downloadedRecords)}</strong></div>
          <div className="technical-kpi good"><span>Insertados</span><strong>{formatNumber(latestDownload.insertedRecords)}</strong></div>
          <div className="technical-kpi warning"><span>Actualizados</span><strong>{formatNumber(latestDownload.updatedRecords)}</strong></div>
          <div className="technical-kpi"><span>Duracion</span><strong>{formatNumber(latestDownload.executionTimeMs)} ms</strong></div>
        </div>
      )}
      <HistoryTable logs={logs.slice(0, 25)} showErrors />
    </>
  );
}

function SearchableIndicatorSelect({
  indicators,
  loading,
  value,
  onChange
}: {
  indicators: EsiosIndicator[];
  loading: boolean;
  value: number;
  onChange: (indicatorId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = indicators.find((indicator) => indicator.indicatorId === value) ?? indicators[0];
  const filteredIndicators = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return indicators;
    }
    return indicators.filter((indicator) => matchesIndicatorSearch(indicator, needle));
  }, [indicators, search]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const displayValue = selected ? `${selected.indicatorId} - ${selected.shortName ?? selected.name ?? "-"}` : "Selecciona un indicador";

  return (
    <div className={`filter-field filter-select-field ${open ? "open" : ""}`} ref={containerRef}>
      <span>Indicador</span>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="searchable-select-trigger"
        disabled={loading || indicators.length === 0}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            setOpen(true);
          }
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        type="button"
      >
        <span className={selected ? "" : "placeholder"}>{displayValue}</span>
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
            placeholder="Buscar por ID, nombre o descripción"
            value={search}
          />
          <div className="searchable-select-options" role="listbox">
            <button
              className={`searchable-select-option ${selected ? "" : "active"}`}
              onClick={() => {
                const first = indicators[0];
                if (first) {
                  onChange(first.indicatorId);
                }
                setOpen(false);
                setSearch("");
              }}
              role="option"
              type="button"
            >
              {indicators.length === 0 ? "Sin indicadores" : "Primer indicador disponible"}
            </button>
            {filteredIndicators.map((indicator) => (
              <button
                aria-selected={value === indicator.indicatorId}
                className={`searchable-select-option ${value === indicator.indicatorId ? "active" : ""}`}
                key={indicator.id}
                onClick={() => {
                  onChange(indicator.indicatorId);
                  setOpen(false);
                  setSearch("");
                }}
                role="option"
                type="button"
              >
                {indicator.indicatorId} - {indicator.shortName ?? indicator.name ?? "-"}
              </button>
            ))}
            {filteredIndicators.length === 0 && <div className="searchable-select-empty">Sin resultados</div>}
          </div>
        </div>
      )}
    </div>
  );
}
function ConfigurationView({
  config,
  connectionResult,
  loading,
  token,
  onConfigChange,
  onSave,
  onTest,
  onTokenChange
}: {
  config?: EsiosConfig;
  connectionResult?: EsiosConnectionResult;
  loading: boolean;
  token: string;
  onConfigChange: (config: EsiosConfig) => void;
  onSave: () => void;
  onTest: () => void;
  onTokenChange: (value: string) => void;
}) {
  if (!config) {
    return <div className="panel wide"><div className="empty-state">Cargando configuracion ESIOS.</div></div>;
  }

  return (
    <div className="panel wide omie-control-panel">
      <PanelTitle icon={<Settings size={18} />} title="Configuracion ESIOS" subtitle={config.tokenConfigured ? "Token configurado" : "Token pendiente"} />
      <div className="filter-band esios-config-grid">
        <label className="filter-field">
          <span>URL API</span>
          <input value={config.apiUrl} onChange={(event) => onConfigChange({ ...config, apiUrl: event.target.value })} />
        </label>
        <label className="filter-field">
          <span>Token API</span>
          <input placeholder={config.tokenConfigured ? "Token guardado" : "Sin token"} type="password" value={token} onChange={(event) => onTokenChange(event.target.value)} />
        </label>
        <label className="filter-field">
          <span>Timeout (segundos)</span>
          <input min="1" type="number" value={config.timeoutSeconds} onChange={(event) => onConfigChange({ ...config, timeoutSeconds: Number(event.target.value) })} />
        </label>
        <label className="filter-field">
          <span>Reintentos</span>
          <input min="0" type="number" value={config.retries} onChange={(event) => onConfigChange({ ...config, retries: Number(event.target.value) })} />
        </label>
        <label className="filter-field">
          <span>Activo</span>
          <select value={config.active ? "yes" : "no"} onChange={(event) => onConfigChange({ ...config, active: event.target.value === "yes" })}>
            <option value="yes">Si</option>
            <option value="no">No</option>
          </select>
        </label>
      </div>
      <div className="omie-toolbar compact">
        <button className="primary-button" disabled={loading} onClick={onSave} type="button">
          <Save size={16} />
          Guardar
        </button>
        <button className="secondary-button" disabled={loading} onClick={onTest} type="button">
          <Activity size={16} />
          Probar conexion
        </button>
        {connectionResult && (
          <span className={`ops-status-badge ${connectionResult.status === "ok" ? "valid" : "error"}`}>
            {connectionResult.status === "ok" ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
            {connectionLabel(connectionResult)}
          </span>
        )}
      </div>
    </div>
  );
}

function HistoryTable({ logs, showErrors = false }: { logs: EsiosDownloadLog[]; showErrors?: boolean }) {
  return (
    <div className="panel wide">
      <div className="table-scroll">
        <table className="ree-download-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Indicador</th>
              <th>Desde</th>
              <th>Hasta</th>
              <th>Descargados</th>
              <th>Insertados</th>
              <th>Actualizados</th>
              <th>Estado</th>
              {showErrors && <th>Error</th>}
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={showErrors ? 9 : 8}>
                  <div className="empty-state">Sin ejecuciones ESIOS registradas.</div>
                </td>
              </tr>
            )}
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{formatOptionalDateTime(log.createdAt)}</td>
                <td>{log.indicatorId ? `${log.indicatorId} - ${log.indicatorName ?? "-"}` : "-"}</td>
                <td>{log.startDate ? formatEsiosDate(log.startDate) : "-"}</td>
                <td>{log.endDate ? formatEsiosDate(log.endDate) : "-"}</td>
                <td>{formatNumber(log.downloadedRecords)}</td>
                <td>{formatNumber(log.insertedRecords)}</td>
                <td>{formatNumber(log.updatedRecords)}</td>
                <td><span className={`ops-status-badge ${log.status === "SUCCESS" ? "valid" : "error"}`}>{log.status}</span></td>
                {showErrors && <td>{log.errorMessage ?? "-"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function buildSeriesColumns(): Array<TechnicalColumn<EsiosIndicatorValue>> {
  return [
    { id: "fecha", label: "Fecha", width: 118, sticky: true, type: "date", filter: "text", value: (row) => formatEsiosDate(row.datetimeUtc ?? row.datetime) },
    { id: "hora", label: "Hora", width: 90, sticky: true, type: "text", filter: "text", value: (row) => formatEsiosTime(row.datetimeUtc ?? row.datetime) },
    { id: "fechaHora", label: "FechaHora", width: 156, type: "date", filter: "text", value: (row) => row.datetimeUtc ?? row.datetime, render: (row) => formatEsiosDateTime(row.datetimeUtc ?? row.datetime) },
    { id: "valor", label: "Valor", width: 130, align: "right", type: "number", filter: "number", value: (row) => row.value, render: (row) => formatDecimalNumber(row.value ?? Number.NaN, 3) },
    { id: "geo", label: "Geo", width: 130, filter: "text", value: (row) => row.geoName ?? "-" },
    { id: "geoId", label: "Geo ID", width: 90, align: "right", type: "number", filter: "number", value: (row) => row.geoId }
  ];
}

function buildSeriesKpis(indicator: EsiosIndicator | null, response?: EsiosValuesResponse): TechnicalKpi[] {
  if (!response) {
    return [];
  }

  return [
    { label: "Indicador", value: indicator ? String(indicator.indicatorId) : "-", meta: indicator?.name ?? indicator?.shortName ?? "-" },
    { label: "Primer registro", value: formatOptionalDateTime(response.kpis.firstRecord), meta: "FechaHora" },
    { label: "Ultimo registro", value: formatOptionalDateTime(response.kpis.lastRecord), meta: "FechaHora" },
    { label: "Total registros", value: formatNumber(response.kpis.totalRecords), meta: "BD" },
    { label: "Media", value: formatDecimalNumber(response.kpis.average ?? Number.NaN, 3), meta: indicator?.unit ?? "" },
    { label: "Maximo", value: formatDecimalNumber(response.kpis.maximum ?? Number.NaN, 3), meta: indicator?.unit ?? "" },
    { label: "Minimo", value: formatDecimalNumber(response.kpis.minimum ?? Number.NaN, 3), meta: indicator?.unit ?? "" },
    { label: "Ultima descarga", value: formatOptionalDateTime(response.kpis.latestDownload), meta: "ESIOS" }
  ];
}

function buildSeriesChart(indicator: EsiosIndicator | null, rows: EsiosIndicatorValue[]): EChartsOption {
  return {
    color: ["#0f766e"],
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => (typeof value === "number" ? formatDecimalNumber(value, 3) : String(value ?? "-"))
    },
    legend: {
      show: false
    },
    grid: { left: 56, right: 32, top: 28, bottom: 62, containLabel: true },
    dataZoom: [
      { type: "inside", filterMode: "none" },
      { type: "slider", height: 22, bottom: 20, filterMode: "none" }
    ],
    xAxis: {
      type: "category",
      data: rows.map((row) => formatEsiosDateTime(row.datetimeUtc ?? row.datetime)),
      axisLabel: { color: "#5a7381", hideOverlap: true }
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#5a7381" },
      splitLine: { lineStyle: { color: "#edf2f5" } }
    },
    series: [
      {
        name: indicator?.name ?? indicator?.shortName ?? "Serie ESIOS",
        type: "line",
        smooth: true,
        symbolSize: 4,
        data: rows.map((row) => row.value)
      }
    ]
  };
}

function buildSeriesComparisonChart(
  selectedIndicatorIds: number[],
  seriesByIndicatorId: Record<number, EsiosValuesResponse>,
  availableIndicators: EsiosIndicator[]
): EChartsOption {
  const palette = ["#0f766e", "#2563eb", "#b45309", "#7c3aed", "#dc2626", "#15803d"];
  const activeSeries = selectedIndicatorIds
    .map((indicatorId) => {
      const response = seriesByIndicatorId[indicatorId];
      const indicator = response?.indicator ?? availableIndicators.find((item) => item.indicatorId === indicatorId) ?? null;
      return response ? { indicatorId, indicator, rows: response.rows } : null;
    })
    .filter((item): item is { indicatorId: number; indicator: EsiosIndicator | null; rows: EsiosIndicatorValue[] } => Boolean(item));

  return {
    color: palette,
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => (typeof value === "number" ? formatDecimalNumber(value, 3) : String(value ?? "-"))
    },
    legend: {
      type: "scroll",
      top: 0
    },
    grid: { left: 56, right: 32, top: 52, bottom: 62, containLabel: true },
    dataZoom: [
      { type: "inside", filterMode: "none" },
      { type: "slider", height: 22, bottom: 20, filterMode: "none" }
    ],
    xAxis: {
      type: "time",
      axisLabel: { color: "#5a7381", hideOverlap: true }
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#5a7381" },
      splitLine: { lineStyle: { color: "#edf2f5" } }
    },
    series: activeSeries.map((series, index) => ({
      name: `${series.indicatorId} - ${series.indicator?.shortName ?? series.indicator?.name ?? "Serie"}`,
      type: "line",
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2 },
      emphasis: { focus: "series" },
      data: series.rows
        .filter((row) => row.value !== null && row.value !== undefined)
        .map((row) => [new Date(row.datetimeUtc ?? row.datetime).getTime(), row.value as number]),
      color: palette[index % palette.length]
    }))
  };
}

type EsiosComparisonRow = {
  datetime: string;
  datetimeUtc: string | null;
  indicatorValues: Record<number, number | null>;
};

function buildSeriesComparisonRows(selectedIndicatorIds: number[], seriesByIndicatorId: Record<number, EsiosValuesResponse>) {
  const rowsByTimestamp = new Map<string, EsiosComparisonRow>();

  for (const indicatorId of selectedIndicatorIds) {
    const response = seriesByIndicatorId[indicatorId];
    for (const row of response?.rows ?? []) {
      const datetime = row.datetimeUtc ?? row.datetime;
      const existing = rowsByTimestamp.get(datetime) ?? {
        datetime,
        datetimeUtc: row.datetimeUtc,
        indicatorValues: {}
      };
      existing.indicatorValues[indicatorId] = row.value ?? null;
      if (!existing.datetimeUtc && row.datetimeUtc) {
        existing.datetimeUtc = row.datetimeUtc;
      }
      rowsByTimestamp.set(datetime, existing);
    }
  }

  return Array.from(rowsByTimestamp.values()).sort((left, right) => left.datetime.localeCompare(right.datetime));
}

function buildSeriesComparisonColumns(
  selectedIndicatorIds: number[],
  seriesByIndicatorId: Record<number, EsiosValuesResponse>,
  availableIndicators: EsiosIndicator[]
): Array<TechnicalColumn<EsiosComparisonRow>> {
  const columns: Array<TechnicalColumn<EsiosComparisonRow>> = [
    { id: "fecha", label: "Fecha", width: 118, sticky: true, type: "date", filter: "text", value: (row) => formatEsiosDate(row.datetimeUtc ?? row.datetime) },
    { id: "hora", label: "Hora", width: 90, sticky: true, type: "text", filter: "text", value: (row) => formatEsiosTime(row.datetimeUtc ?? row.datetime) },
    { id: "fechaHora", label: "FechaHora", width: 156, type: "date", filter: "text", value: (row) => row.datetimeUtc ?? row.datetime, render: (row) => formatEsiosDateTime(row.datetimeUtc ?? row.datetime) }
  ];

  for (const indicatorId of selectedIndicatorIds) {
    const response = seriesByIndicatorId[indicatorId];
    const indicator = response?.indicator ?? availableIndicators.find((item) => item.indicatorId === indicatorId) ?? null;
    const indicatorLabel = indicator?.shortName ?? indicator?.name ?? `Indicador ${indicatorId}`;
    columns.push({
      id: `ind-${indicatorId}`,
      label: indicatorLabel,
      help: `ID ${indicatorId}`,
      width: 140,
      align: "right",
      type: "number",
      filter: "number",
      value: (row) => row.indicatorValues[indicatorId],
      render: (row) => formatDecimalNumber(row.indicatorValues[indicatorId] ?? Number.NaN, 3)
    });
  }

  return columns;
}

function buildSeriesComparisonKpis(rows: EsiosComparisonRow[]): TechnicalKpi[] {
  if (rows.length === 0) {
    return [];
  }

  return [
    { label: "Fechas", value: formatNumber(rows.length), meta: "comparadas" },
    { label: "Primer registro", value: formatOptionalDateTime(rows[0]?.datetimeUtc ?? rows[0]?.datetime), meta: "FechaHora" },
    { label: "Ultimo registro", value: formatOptionalDateTime(rows[rows.length - 1]?.datetimeUtc ?? rows[rows.length - 1]?.datetime), meta: "FechaHora" }
  ];
}

function buildSeriesComparisonRowQuality(row: EsiosComparisonRow): RowQuality {
  const values = Object.values(row.indicatorValues);
  const missing = values.filter((value) => value === null || value === undefined).length;
  return {
    tone: missing > 0 ? "warning" : "ok",
    labels: missing > 0 ? [`${formatNumber(missing)} sin dato`] : []
  };
}

function buildProfileColumns(): Array<TechnicalColumn<EsiosInitialProfile>> {
  return [
    { id: "fecha", label: "Fecha", width: 118, sticky: true, type: "date", filter: "text", value: (row) => row.datetime, render: (row) => formatEsiosDate(row.datetime) },
    { id: "mes", label: "Mes", width: 70, align: "right", type: "number", filter: "number", value: (row) => row.month },
    { id: "dia", label: "Día", width: 70, align: "right", type: "number", filter: "number", value: (row) => row.day },
    { id: "hora", label: "Hora", width: 74, align: "right", type: "number", filter: "number", value: (row) => row.hour },
    { id: "profile20td", label: "Perfil inicial 2.0TD", width: 152, align: "right", type: "number", filter: "number", value: (row) => row.profile20td, render: (row) => formatDecimalNumber(row.profile20td, 12) },
    { id: "profile30td", label: "Perfil inicial 3.0TD", width: 152, align: "right", type: "number", filter: "number", value: (row) => row.profile30td, render: (row) => formatDecimalNumber(row.profile30td, 12) },
    { id: "profile30tdve", label: "Perfil inicial 3.0TDVE", width: 166, align: "right", type: "number", filter: "number", value: (row) => row.profile30tdve, render: (row) => formatDecimalNumber(row.profile30tdve, 12) },
    { id: "referenceDemandMw", label: "Demanda referencia MW", width: 174, align: "right", type: "number", filter: "number", value: (row) => row.referenceDemandMw, render: (row) => formatDecimalNumber(row.referenceDemandMw, 3) }
  ];
}

function buildProfileKpis(summary?: EsiosProfilesSummary): TechnicalKpi[] {
  if (!summary) {
    return [];
  }
  return [
    { label: "Año", value: String(summary.year), meta: "Perfiles REE" },
    { label: "Horas esperadas", value: formatNumber(summary.expectedHours), meta: "calendario" },
    { label: "Horas cargadas", value: formatNumber(summary.loadedHours), meta: "BD", tone: summary.loadedHours === summary.expectedHours ? "good" : "warning" },
    { label: "Estado carga", value: summary.loadStatus, meta: summary.latestUpload?.fileName ?? "sin fichero" },
    { label: "Última carga", value: formatOptionalDateTime(summary.latestUpload?.uploadedAt), meta: summary.latestUpload?.uploadedBy ?? "" },
    { label: "Suma perfil inicial 2.0TD", value: formatDecimalNumber(summary.sumProfile20td ?? Number.NaN, 6), meta: "anual" },
    { label: "Suma perfil inicial 3.0TD", value: formatDecimalNumber(summary.sumProfile30td ?? Number.NaN, 6), meta: "anual" },
    { label: "Suma perfil inicial 3.0TDVE", value: formatDecimalNumber(summary.sumProfile30tdve ?? Number.NaN, 6), meta: "anual" },
    { label: "Total demanda referencia MW", value: formatDecimalNumber(summary.totalReferenceDemandMw ?? Number.NaN, 3), meta: "anual" },
    { label: "Coeficientes cargados", value: formatNumber(summary.coefficientCount), meta: "tarifas" }
  ];
}

function buildProfileRowQuality(row: EsiosInitialProfile): RowQuality {
  if (row.referenceDemandMw <= 0 || row.profile20td < 0 || row.profile30td < 0 || row.profile30tdve < 0) {
    return { tone: "danger", labels: ["No válido"] };
  }
  return { tone: "ok", labels: ["Válido"] };
}

function buildProfilePivotRows(rows: EsiosProfileIntermediateRow[]): EsiosProfilePivotRow[] {
  const byDatetime = new Map<string, EsiosProfilePivotRow>();
  for (const row of rows) {
    const existing = byDatetime.get(row.datetime) ?? {
      id: `${row.year}-${row.datetime}`,
      year: row.year,
      datetime: row.datetime,
      hour: row.hour,
      referenceDemandMw: row.referenceDemandMw,
      demandUsedMw: row.demandUsedMw,
      demandSource: row.demandSource,
      byTariff: {}
    };
    existing.referenceDemandMw ??= row.referenceDemandMw;
    existing.demandUsedMw ??= row.demandUsedMw;
    existing.demandSource = existing.demandSource || row.demandSource;
    existing.byTariff[row.tariff] = row;
    byDatetime.set(row.datetime, existing);
  }
  return Array.from(byDatetime.values()).sort((left, right) => left.datetime.localeCompare(right.datetime));
}

function buildProfilePivotColumns(rows: EsiosProfilePivotRow[]): Array<TechnicalColumn<EsiosProfilePivotRow>> {
  const sumBy = (selector: (row: EsiosProfilePivotRow) => number | null | undefined, digits: number) => {
    const total = rows.reduce((accumulator, row) => {
      const value = selector(row);
      return value === null || value === undefined || !Number.isFinite(value) ? accumulator : accumulator + value;
    }, 0);
    return formatDecimalNumber(total, digits);
  };

  const columns: Array<TechnicalColumn<EsiosProfilePivotRow>> = [
    { id: "fecha", label: "Fecha", width: 118, sticky: true, type: "date", filter: "text", value: (row) => row.datetime, render: (row) => formatEsiosDate(row.datetime) },
    { id: "hora", label: "Hora", width: 74, sticky: true, align: "right", type: "number", filter: "number", value: (row) => row.hour },
    { id: "ref", label: "Demanda inicial MW", headerMeta: sumBy((row) => row.referenceDemandMw, 3), width: 158, align: "right", type: "number", filter: "number", value: (row) => row.referenceDemandMw, render: (row) => formatDecimalNumber(row.referenceDemandMw ?? Number.NaN, 3) },
    { id: "used", label: "Demanda usada MW", headerMeta: sumBy((row) => row.demandUsedMw, 3), width: 162, align: "right", type: "number", filter: "number", value: (row) => row.demandUsedMw, render: (row) => formatDecimalNumber(row.demandUsedMw ?? Number.NaN, 3) },
    { id: "source", label: "Origen demanda", width: 150, filter: "select", value: (row) => row.demandSource }
  ];

  for (const tariff of PROFILE_TARIFFS) {
    columns.push(
      {
        id: `initial-${tariff}`,
        label: `Inicial ${tariff}`,
        headerMeta: sumBy((row) => row.byTariff[tariff]?.initialProfile, 12),
        width: 132,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.byTariff[tariff]?.initialProfile,
        render: (row) => formatDecimalNumber(row.byTariff[tariff]?.initialProfile ?? Number.NaN, 12)
      },
      {
        id: `intermediate-${tariff}`,
        label: `Intermedio ${tariff}`,
        headerMeta: sumBy((row) => row.byTariff[tariff]?.intermediateProfile, 12),
        width: 150,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.byTariff[tariff]?.intermediateProfile,
        render: (row) => formatDecimalNumber(row.byTariff[tariff]?.intermediateProfile ?? Number.NaN, 12)
      },
      {
        id: `final-${tariff}`,
        label: `Final REE ${tariff}`,
        headerMeta: sumBy((row) => row.byTariff[tariff]?.reeFinalProfile, 12),
        width: 150,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.byTariff[tariff]?.reeFinalProfile,
        render: (row) => formatDecimalNumber(row.byTariff[tariff]?.reeFinalProfile ?? Number.NaN, 12)
      },
      {
        id: `diff-${tariff}`,
        label: `Dif. perfil ${tariff}`,
        headerMeta: sumBy((row) => row.byTariff[tariff]?.finalProfileDifference, 15),
        width: 142,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.byTariff[tariff]?.finalProfileDifference,
        render: (row) => formatDecimalNumber(row.byTariff[tariff]?.finalProfileDifference ?? Number.NaN, 15),
        cellTone: (row) => diffCellTone(row.byTariff[tariff]?.finalProfileDifference)
      },
      {
        id: `valid-${tariff}`,
        label: `Validado ${tariff}`,
        width: 126,
        filter: "select",
        value: (row) => row.byTariff[tariff]?.validationStatus,
        render: (row) => validationLabel(row.byTariff[tariff]?.validationStatus ?? "SIN_PERFF")
      }
    );
  }

  return withNeutralProfilePivotNumberTone(columns);
}

function withNeutralProfilePivotNumberTone(columns: Array<TechnicalColumn<EsiosProfilePivotRow>>) {
  return columns.map((column) => column.type === "number" ? { ...column, numericTone: "neutral" as const } : column);
}

function diffCellTone(value: number | null | undefined): "good" | "bad" | "neutral" {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "neutral";
  }
  return Math.abs(value) <= 0.000000000001 ? "good" : "bad";
}

function buildProfilePivotRowQuality(row: EsiosProfilePivotRow): RowQuality {
  const hasInvalidProfile = Object.values(row.byTariff).some((tariffRow) => (tariffRow?.initialProfile ?? 0) < 0 || (tariffRow?.intermediateProfile ?? 0) < 0);
  if (hasInvalidProfile || (row.referenceDemandMw ?? 0) < 0 || (row.demandUsedMw ?? 0) < 0) {
    return { tone: "ok", labels: ["No válido"] };
  }
  return { tone: "ok", labels: ["Válido"] };
}

function validationLabel(status: EsiosProfileIntermediateRow["validationStatus"] | EsiosProfileIntermediateRow["finalProfileValidationStatus"] | EsiosProfileIntermediateRow["profileValidationStatus"]) {
  if (status === "VALIDADO") {
    return "Validado";
  }
  if (status === "DIFERENTE") {
    return "Diferente";
  }
  return "Sin PERFF";
}

function matchesIndicatorSearch(indicator: EsiosIndicator, search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  const haystacks = [
    String(indicator.indicatorId),
    indicator.name ?? "",
    indicator.shortName ?? "",
    indicator.description ?? "",
    indicator.unit ?? "",
    indicator.frequency ?? ""
  ].map((value) => value.toLowerCase());

  return haystacks.some((value) => value.includes(needle));
}

function indicatorFamily(indicator: EsiosIndicator) {
  return indicator.frequency ?? indicator.unit ?? indicator.shortName ?? "-";
}

function exportComparisonSeries(
  selectedIndicatorIds: number[],
  seriesByIndicatorId: Record<number, EsiosValuesResponse>,
  availableIndicators: EsiosIndicator[],
  format: "csv" | "xls"
) {
  const rows = buildSeriesComparisonRows(selectedIndicatorIds, seriesByIndicatorId);

  if (rows.length === 0) {
    return;
  }

  const exportRows = rows.map((row) => {
    const base: Record<string, string | number | null> = {
      Fecha: formatEsiosDate(row.datetimeUtc ?? row.datetime),
      Hora: formatEsiosTime(row.datetimeUtc ?? row.datetime),
      FechaHora: formatEsiosDateTime(row.datetimeUtc ?? row.datetime)
    };
    for (const indicatorId of selectedIndicatorIds) {
      const response = seriesByIndicatorId[indicatorId];
      const indicator = response?.indicator ?? availableIndicators.find((item) => item.indicatorId === indicatorId) ?? null;
      const key = `${indicator?.shortName ?? indicator?.name ?? `Indicador ${indicatorId}`}`;
      base[key] = row.indicatorValues[indicatorId] ?? "";
    }
    return base;
  });

  const fileName = "esios-series-comparativa";
  if (format === "csv") {
    downloadBlob(`${fileName}.csv`, toCsv(exportRows), "text/csv;charset=utf-8");
    return;
  }
  downloadBlob(`${fileName}.xls`, toExcelHtml(exportRows), "application/vnd.ms-excel;charset=utf-8");
}

function buildSeriesRowQuality(row: EsiosIndicatorValue): RowQuality {
  return {
    tone: row.value === null ? "warning" : "ok",
    labels: row.value === null ? ["Valor vacio"] : []
  };
}

function defaultSeriesFilters(): EsiosValuesFilters {
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  return {
    fechaDesde: start.toISOString().slice(0, 10),
    fechaHasta: today.toISOString().slice(0, 10),
    take: DEFAULT_PAGE_SIZE
  };
}

function defaultDownloadDraft() {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 7);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: today.toISOString().slice(0, 10)
  };
}

function defaultProfilesFilters(): EsiosProfilesFilters {
  return { year: new Date().getFullYear() };
}

function normalizeProfilesFilters(filters: EsiosProfilesFilters): EsiosProfilesFilters {
  const fallback = defaultProfilesFilters();
  const year = Number(filters.year || fallback.year);
  const { tariff, ...rest } = filters;
  void tariff;
  return {
    ...rest,
    year: Number.isFinite(year) ? year : fallback.year,
    month: filters.month ? Number(filters.month) : undefined,
    fechaDesde: filters.fechaDesde || undefined,
    fechaHasta: filters.fechaHasta || undefined
  };
}

function withCoefficientDefaults(year: number, rows: EsiosProfileCoefficient[]) {
  const byTariff = new Map(rows.map((row) => [row.tariff, row]));
  return PROFILE_TARIFFS.map((tariff) => byTariff.get(tariff) ?? { year, tariff, alpha: 0, beta: 0, gamma: 0 });
}

function normalizeSeriesFilters(filters: EsiosValuesFilters): EsiosValuesFilters {
  const year = filters.year === "" ? undefined : filters.year;
  const month = filters.month === "" ? undefined : filters.month;
  if (year && month) {
    return { year, month, take: DEFAULT_PAGE_SIZE };
  }
  return {
    fechaDesde: filters.fechaDesde,
    fechaHasta: filters.fechaHasta,
    take: DEFAULT_PAGE_SIZE
  };
}

function connectionLabel(result: EsiosConnectionResult) {
  if (result.status === "ok") {
    return "Conexion correcta";
  }
  if (result.status === "invalid_token") {
    return "Token invalido";
  }
  if (result.status === "network_error") {
    return "Error de red";
  }
  if (result.status === "inactive") {
    return "Integracion inactiva";
  }
  return "Error API";
}

function toCsv<T extends object>(rows: T[]) {
  if (rows.length === 0) {
    return "";
  }
  const headers = Object.keys(rows[0]);
  return [headers.join(";"), ...rows.map((row) => headers.map((header) => csvCell(row[header as keyof T])).join(";"))].join("\n");
}

function toExcelHtml<T extends object>(rows: T[]) {
  if (rows.length === 0) {
    return "";
  }
  const headers = Object.keys(rows[0]);
  const headerCells = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const bodyRows = rows
    .map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(String(row[header as keyof T] ?? ""))}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatOptionalDateTime(value?: string | null) {
  return value ? formatEsiosDateTime(value) : "-";
}

function formatEsiosDate(value: string) {
  return formatMadridParts(value).date;
}

function formatEsiosTime(value: string) {
  return formatMadridParts(value).time;
}

function formatEsiosDateTime(value: string) {
  const parts = formatMadridParts(value);
  return `${parts.date}, ${parts.time}`;
}

function formatMadridParts(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { date: value.slice(0, 10) || "-", time: value.slice(11, 16) || "-" };
  }

  const formatter = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    year: "2-digit",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(parsed);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${read("day")}/${read("month")}/${read("year")}`.replace(/\/+/g, "/"),
    time: `${read("hour")}:${read("minute").padStart(2, "0")}`
  };
}

function sameIds(left: number[], right: number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function resolveDownloadIndicatorId(current: number, indicators: EsiosIndicator[]) {
  if (indicators.some((indicator) => indicator.indicatorId === current)) {
    return current;
  }
  return indicators[0]?.indicatorId ?? current;
}

function resolveSeriesSelection(selectedIndicatorIds: number[], indicators: EsiosIndicator[]) {
  const availableIds = indicators.map((indicator) => indicator.indicatorId);
  const cleaned = selectedIndicatorIds.filter((indicatorId) => availableIds.includes(indicatorId));
  if (cleaned.length > 0) {
    return cleaned;
  }
  return indicators.slice(0, DEFAULT_SERIES_SELECTION_SIZE).map((indicator) => indicator.indicatorId);
}

async function loadSelectedSeries(selectedIndicatorIds: number[], filters: EsiosValuesFilters) {
  const entries = await Promise.all(
    selectedIndicatorIds.map(async (indicatorId) => {
      const rows: EsiosIndicatorValue[] = [];
      let skip = 0;
      let lastResponse: EsiosValuesResponse | undefined;

      while (true) {
        lastResponse = await getEsiosIndicatorValues(indicatorId, { ...filters, skip, take: 5000 });
        rows.push(...lastResponse.rows);
        if (!lastResponse.hasNext || lastResponse.rows.length === 0) {
          break;
        }
        skip += lastResponse.rows.length;
      }

      return [
        indicatorId,
        lastResponse
          ? {
              ...lastResponse,
              rows,
              hasNext: false
            }
          : lastResponse
      ] as const;
    })
  );
  return Object.fromEntries(entries);
}

async function refreshSeries(selectedIndicatorIds: number[], filters: EsiosValuesFilters) {
  if (selectedIndicatorIds.length === 0) {
    return {};
  }
  return loadSelectedSeries(selectedIndicatorIds, normalizeSeriesFilters(filters));
}



