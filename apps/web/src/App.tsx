import { type DragEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clipboard,
  Database,
  Download,
  FileDown,
  FileClock,
  FileSpreadsheet,
  Gauge,
  Info,
  Maximize2,
  Minimize2,
  RefreshCw,
  RotateCcw,
  Search,
  TrendingUp,
  Trash2,
  UploadCloud,
  Zap,
  X
} from "lucide-react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import { ButtonLoadingContent, GlobalLoadingOverlay, InlineLoading, LoadingSquares } from "./GlobalLoadingOverlay";
import {
  createTechnicalDataTableAdapter,
  type TechnicalDataTableAdapterColumn
} from "./technical-module-v2/adapters/technicalDataTableAdapter";
import { TechnicalDataTable } from "./components/technical-data-table/TechnicalDataTable";
import { TechnicalDataRow } from "./components/technical-data-table/TechnicalDataTable";
import { SidebarSection } from "./app-shell/Sidebar";
import {
  activeSidebarGroupKeys,
  activeSidebarItemKeys,
  getLatestLiquidationAnalysisVersionForMonth,
  getTodayInputValue,
  isEsiosSection,
  isOmieSection,
  hasAnyReeLossesDateFilter,
  hasCompleteLiquidationAnalysisFilters,
  resolveLiquidationAnalysisFilters,
  normalizeOmieSesionInput,
  monthDateRange,
  selectOmieTransactionDownloadId
} from "./app-shell/AppState";
import { LiquidationAnalysisView } from "./modules/liquidation-analysis/LiquidationAnalysisView";
import { OmieDescargasControlModule, formatDurationMs, getOmieDailyBulkDate, normalizeOmieDownloadRequest } from "./modules/omie/descargas/OmieDescargasControlModule";
import { OmiePreciosModule } from "./modules/omie/precios/OmiePreciosModule";
import { OmieProgramasModule } from "./modules/omie/programas/OmieProgramasModule";
import { OmieTransaccionesModule } from "./modules/omie/transacciones/OmieTransaccionesModule";
import { EsiosModule, type EsiosViewKey } from "./modules/esios/EsiosModule";
import { MedperFilterBand, MedperViewPanel } from "./modules/medper/MedperModule";
import { HistoryView } from "./modules/import-history/ImportHistoryModule";
import { isLikelyMedperFileName, loadAllMedperRows, loadMedperRecordPage, sanitizeMedperFiltersForView } from "./modules/medper/MedperHelpers";
import { ReeDownloadCenterModule } from "./modules/ree-download-center/ReeDownloadCenterModule";
import type {
  ImportHistoryFile,
  ImportHistoryMode,
  MedidasView,
  LoadSortKey,
  LoadStatus,
  Message,
  OmieProgramasViewKey,
  ReganecuView,
  ReeLossesViewKey,
  Section,
  SidebarGroupConfig,
  SidebarGroupKey,
  SidebarMenuItem,
  ImportMode,
  UploadResponse
} from "./app-shell/AppShellTypes";
import {
  buildTechnicalColumnsSignature,
  buildTechnicalPresetHiddenColumns,
  buildTechnicalQuality,
  copyTechnicalRows,
  exportTechnicalRows,
  filterTechnicalRows,
  formatCompleteness,
  stickyCellStyle,
  stringifyCellValue,
  technicalCellClass,
  technicalColumnVisibility,
  technicalNumericToneClass,
  downloadBlob
} from "./components/technical-data-table/TechnicalDataTableHelpers";
import type { RowQuality, TechnicalColumn, TechnicalDataMode, TechnicalEntry, TechnicalKpi, TechnicalSortDirection, TechnicalTotalsRow } from "./components/technical-data-table/TechnicalDataTableTypes";
import { ReeLossesFilterBand, ReeLossesView } from "./modules/ree-losses/ReeLossesModule";
import { OmieDetalleCargaModule } from "./modules/omie/detalle-carga/OmieDetalleCargaModule";
import { OmieLiquidacionesModule } from "./modules/omie/liquidaciones/OmieLiquidacionesModule";
import {
  type A1Record,
  type Filters,
  type ImportHistoryDetail,
  type ImportHistoryLogs,
  type ImportResponse,
  type LiquidationAnalysisFilterOptions,
  type LiquidationAnalysisFilters,
  type LiquidationAnalysisRow,
  type MedperFilterOptions,
  type MedperCurves,
  type MedperFile,
  type MedperFilters,
  type MedperImportResponse,
  type MedperMonthlyConsumptionRow,
  type MedperSummary,
  type MedperqhRecord,
  type OmieDownloadControlFilters,
  type OmieDownloadControlRow,
  type OmieDownloadCodigo,
  type OmieDownloadDetail,
  type OmieDownloadEstado,
  type OmieDownloadDocumentType,
  type OmieDownloadExecuteRequest,
  type OmieDownloadModulo,
  type OmieDailyBulkDownloadResponse,
  type OmieAnalisisMensualResponse,
  type OmieComprobacionLiquidacionesResponse,
  type OmiePrecioPeriodo,
  type OmiePreciosResponse,
  type OmieProgramaEvolucionPeriodo,
  type OmieProgramaEvolucionResponse,
  type OmieProgramaPeriodo,
  type OmieProgramaResponse,
  type OmieTransactionDownloadFilters,
  type OmieTransactionDownloadRow,
  type OmieTransactionStagingRow,
  type ReeFile,
  type ReeLossesFilterOptions,
  type ReeLossesFilters,
  type ReeLossesImportFile,
  type ReeLossesImportResponse,
  type ReeLossesReport,
  type ReeVersion,
  type SettlementGroup,
  type SettlementFilterOptions,
  type SettlementSummary,
  type UploadConflict,
  UploadConflictError,
  deleteImportFile,
  executeOmieDescarga,
  executeOmieDescargaDiaria,
  getImportFileDetail,
  getImportFileErrorsCsv,
  getImportFileLogs,
  getLiquidationAnalysisFilterOptions,
  getLiquidationAnalysisReport,
  getMedperCurves,
  getMedperFilterOptions,
  getMedperMonthlyConsumption,
  getMedperSummary,
  getOmieAnalisisMensual,
  getOmieComprobacionLiquidaciones,
  getOmieDescargaDetalle,
  getOmieDescargasControl,
  getOmiePrecios,
  getOmieProgramaIntradiario,
  getOmieProgramaMercadoDiario,
  getOmieProgramasEvolucion,
  getOmieTransactionStagingRows,
  getOmieTransactionsHistorico,
  getReeLossesFilterOptions,
  getReeLossesReport,
  getSettlementFilterOptions,
  getSettlementSummary,
  listMedperFiles,
  listReeLossesImports,
  listMedperqh,
  listImports,
  listReganecu,
  listReganecuQh,
  redownloadOmieDescarga,
  reprocessImportFile,
  reprocessOmieDescarga,
  uploadMedperFiles,
  uploadReeLossesFiles,
  uploadReganecuFiles,
} from "./api";
import { useGlobalLoadingState, withGlobalLoading } from "./loading";

const VERSIONS: ReeVersion[] = ["C1", "C2", "C3", "C4", "C5"];
const SUMMARY_VERSIONS: ReeVersion[] = ["C3", "C4", "C5"];
const VERSION_PALETTE = ["#64748b", "#2563eb", "#16a34a", "#7c3aed", "#f97316", "#0f766e"];
const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [25, 50, 100, 500] as const;
const EXPORT_PAGE_SIZE = 1000;
const LIQUIDATION_ANALYSIS_TOLERANCE_MWH = 0.001;
const OMIE_DOWNLOAD_ESTADOS: OmieDownloadEstado[] = ["PENDIENTE", "DESCARGANDO", "DESCARGADO", "PROCESADO", "ERROR"];
const OMIE_SESSION_OPTIONS = ["01", "02", "03", "04", "05", "06", "07"];
const MONTH_OPTIONS = [
  { value: "01", label: "Enero" },
  { value: "02", label: "Febrero" },
  { value: "03", label: "Marzo" },
  { value: "04", label: "Abril" },
  { value: "05", label: "Mayo" },
  { value: "06", label: "Junio" },
  { value: "07", label: "Julio" },
  { value: "08", label: "Agosto" },
  { value: "09", label: "Septiembre" },
  { value: "10", label: "Octubre" },
  { value: "11", label: "Noviembre" },
  { value: "12", label: "Diciembre" }
];
const OMIE_NO_DOWNLOADED_DATA_MESSAGE = "No existen datos descargados para los filtros seleccionados. Utilice OMIE > Descargas para realizar la descarga.";
const OMIE_DOWNLOAD_MODULOS: OmieDownloadModulo[] = ["Programas", "Precios", "Transacciones"];
const OMIE_DOWNLOAD_QUERIES: Array<{
  modulo: OmieDownloadModulo;
  consulta: string;
  codigoOmie: OmieDownloadCodigo;
  requiereSesion: boolean;
  requiereRango: boolean;
}> = [
  { modulo: "Programas", consulta: "PVD", codigoOmie: "5302", requiereSesion: false, requiereRango: false },
  { modulo: "Programas", consulta: "PHF", codigoOmie: "5608", requiereSesion: true, requiereRango: false },
  { modulo: "Precios", consulta: "Mercado Diario", codigoOmie: "5202", requiereSesion: false, requiereRango: false },
  { modulo: "Precios", consulta: "Intradiario", codigoOmie: "5603", requiereSesion: true, requiereRango: false },
  { modulo: "Precios", consulta: "XBID", codigoOmie: "4125", requiereSesion: false, requiereRango: false },
  { modulo: "Transacciones", consulta: "Histórico", codigoOmie: "4121", requiereSesion: false, requiereRango: true }
];
const SUMMARY_SEGMENTS = [
  { code: "CAD", label: "Costes asignados a la demanda" },
  { code: "DSV", label: "Desvios" },
  { code: "PC3", label: "Pagos por capacidad" },
  { code: "BS3", label: "Banda Secundaria" },
  { code: "RAD3", label: "RAD3" }
] as const;

export function App() {
  const globalLoading = useGlobalLoadingState();
  const refreshInFlight = useRef(false);
  const uploadInFlight = useRef(false);
  const [section, setSection] = useState<Section>("reganecu");
  const [reganecuView, setReganecuView] = useState<ReganecuView>("summary");
  const [medidasView, setMedidasView] = useState<MedidasView>("history");
  const [reeLossesView, setReeLossesView] = useState<ReeLossesViewKey>("system");
  const [omieProgramasView, setOmieProgramasView] = useState<OmieProgramasViewKey>("mercadoDiario");
  const [files, setFiles] = useState<File[]>([]);
  const [importMode, setImportMode] = useState<ImportMode>("reganecu");
  const [imports, setImports] = useState<ReeFile[]>([]);
  const [summary, setSummary] = useState<SettlementSummary>();
  const [reganecuFilterOptions, setReganecuFilterOptions] = useState<SettlementFilterOptions>();
  const [hourly, setHourly] = useState<A1Record[]>([]);
  const [qh, setQh] = useState<A1Record[]>([]);
  const [filters, setFilters] = useState<Filters>({});
  const [latestImport, setLatestImport] = useState<ImportResponse>();
  const [medperFiles, setMedperFiles] = useState<MedperFile[]>([]);
  const [medperSummary, setMedperSummary] = useState<MedperSummary>();
  const [medperFilterOptions, setMedperFilterOptions] = useState<MedperFilterOptions>();
  const [medperqh, setMedperqh] = useState<MedperqhRecord[]>([]);
  const [medperFilters, setMedperFilters] = useState<MedperFilters>({});
  const [medperMonthlyConsumption, setMedperMonthlyConsumption] = useState<MedperMonthlyConsumptionRow[]>([]);
  const [medperGraphQhFilters, setMedperGraphQhFilters] = useState<MedperFilters>({});
  const [medperCurves, setMedperCurves] = useState<MedperCurves>();
  const [latestMedperImport, setLatestMedperImport] = useState<MedperImportResponse>();
  const [liquidationAnalysisFilterOptions, setLiquidationAnalysisFilterOptions] = useState<LiquidationAnalysisFilterOptions>();
  const [liquidationAnalysisFilters, setLiquidationAnalysisFilters] = useState<LiquidationAnalysisFilters>({});
  const [liquidationAnalysisRows, setLiquidationAnalysisRows] = useState<LiquidationAnalysisRow[]>([]);
  const [reeLossesFilterOptions, setReeLossesFilterOptions] = useState<ReeLossesFilterOptions>();
  const [reeLossesFilters, setReeLossesFilters] = useState<ReeLossesFilters>({});
  const [reeLossesReport, setReeLossesReport] = useState<ReeLossesReport>();
  const [reeLossesImports, setReeLossesImports] = useState<ReeLossesImportFile[]>([]);
  const [latestReeLossesImport, setLatestReeLossesImport] = useState<ReeLossesImportResponse>();
  const [omieFecha, setOmieFecha] = useState(getTodayInputValue);
  const [omieSesion, setOmieSesion] = useState("01");
  const [omieMercadoDiario, setOmieMercadoDiario] = useState<OmieProgramaResponse>();
  const [omieIntradiario, setOmieIntradiario] = useState<OmieProgramaResponse>();
  const [omieEvolucion, setOmieEvolucion] = useState<OmieProgramaEvolucionResponse>();
  const [omiePrecioFecha, setOmiePrecioFecha] = useState(getTodayInputValue);
  const [omiePrecios, setOmiePrecios] = useState<OmiePreciosResponse>();
  const [omieAnalisisYear, setOmieAnalisisYear] = useState(() => getTodayInputValue().slice(0, 4));
  const [omieAnalisisMonth, setOmieAnalisisMonth] = useState(() => getTodayInputValue().slice(5, 7));
  const [omieAnalisisMensual, setOmieAnalisisMensual] = useState<OmieAnalisisMensualResponse>();
  const [omieComprobacionLiquidaciones, setOmieComprobacionLiquidaciones] = useState<OmieComprobacionLiquidacionesResponse>();
  const [omieDescargas, setOmieDescargas] = useState<OmieDownloadControlRow[]>([]);
  const [omieDownloadFilters, setOmieDownloadFilters] = useState<OmieDownloadControlFilters>({});
  const [omieDownloadDraft, setOmieDownloadDraft] = useState<OmieDownloadExecuteRequest>(() => {
    const today = getTodayInputValue();
    return { codigoOmie: "5302", fecha: today, fechaDesde: today, fechaHasta: today, sesion: "01" };
  });
  const [latestOmieDailyBulkDownload, setLatestOmieDailyBulkDownload] = useState<OmieDailyBulkDownloadResponse>();
  const [selectedOmieDownloadDetail, setSelectedOmieDownloadDetail] = useState<OmieDownloadDetail>();
  const [omieTransactionFilters, setOmieTransactionFilters] = useState<OmieTransactionDownloadFilters>({});
  const [omieTransactionDownloads, setOmieTransactionDownloads] = useState<OmieTransactionDownloadRow[]>([]);
  const [omieTransactionRows, setOmieTransactionRows] = useState<OmieTransactionStagingRow[]>([]);
  const [selectedOmieTransactionDownloadId, setSelectedOmieTransactionDownloadId] = useState<string>();
  const [esiosRefreshKey, setEsiosRefreshKey] = useState(0);
  const [reganecuDefaultMonthApplied, setReganecuDefaultMonthApplied] = useState(false);
  const [openSidebarGroups, setOpenSidebarGroups] = useState<Record<SidebarGroupKey, boolean>>({
    ree: true,
    omie: false,
    esios: false
  });
  const [openSidebarItems, setOpenSidebarItems] = useState<Record<string, boolean>>({
    "ree-reganecu-menu": true,
    "ree-losses-menu": true,
    "omie-programas-menu": true,
    "omie-hoja-control-menu": true,
    "esios-menu": true
  });
  const [hourlyPage, setHourlyPage] = useState(0);
  const [qhPage, setQhPage] = useState(0);
  const [medperqhPage, setMedperqhPage] = useState(0);
  const [hourlyPageSize, setHourlyPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [qhPageSize, setQhPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [medperqhPageSize, setMedperqhPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [hourlyHasNext, setHourlyHasNext] = useState(false);
  const [qhHasNext, setQhHasNext] = useState(false);
  const [medperqhHasNext, setMedperqhHasNext] = useState(false);
  const [medperDefaultMonthApplied, setMedperDefaultMonthApplied] = useState(false);
  const [medperGraphsDefaultMonthApplied, setMedperGraphsDefaultMonthApplied] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<Message>();
  const isBusy = loading || uploading;
  const appBusy = isBusy || globalLoading.blocking;

  useEffect(() => {
    setOpenSidebarGroups((current) => {
      const next = { ...current };
      for (const key of activeSidebarGroupKeys(section)) {
        next[key] = true;
      }
      return next;
    });
    setOpenSidebarItems((current) => {
      const next = { ...current };
      for (const key of activeSidebarItemKeys(section)) {
        next[key] = true;
      }
      return next;
    });
  }, [section]);

  function beginDataRefresh() {
    if (refreshInFlight.current) {
      return undefined;
    }

    refreshInFlight.current = true;
    setLoading(true);
    setMessage(undefined);

    return () => {
      refreshInFlight.current = false;
      setLoading(false);
    };
  }

  const chartGroups = useMemo(() => [...(summary?.hourly ?? []), ...(summary?.qh ?? [])], [summary]);
  async function refreshReganecu(
    nextView = reganecuView,
    nextFilters = filters,
    pageOptions: Partial<Record<"hourly" | "qh", number>> = {},
    pageSizeOptions: Partial<Record<"hourly" | "qh", number>> = {}
  ) {
    const stopLoading = beginDataRefresh();
    if (!stopLoading) {
      return;
    }

    try {
      const [nextImports, nextFilterOptions] = await Promise.all([listImports({ take: 200 }), getSettlementFilterOptions()]);
      setImports(nextImports);
      setReganecuFilterOptions(nextFilterOptions);

      const hasMonthFilter = Boolean(nextFilters.fecha);
      const resolvedFilters =
        !reganecuDefaultMonthApplied && !hasMonthFilter && nextFilterOptions.latestMonth
          ? { ...nextFilters, fecha: nextFilterOptions.latestMonth, fechaInicio: undefined, fechaFin: undefined }
          : nextFilters;
      if (!reganecuDefaultMonthApplied && !hasMonthFilter && nextFilterOptions.latestMonth) {
        setReganecuDefaultMonthApplied(true);
        setFilters(resolvedFilters);
      }

      if (nextView === "summary") {
        setSummary(await getSettlementSummary(resolvedFilters));
      }
      if (nextView === "history") {
        setSummary((current) => current);
      }
      if (nextView === "hourly") {
        const page = pageOptions.hourly ?? hourlyPage;
        const pageSize = pageSizeOptions.hourly ?? hourlyPageSize;
        const pageResult = await loadRecordPage(listReganecu, resolvedFilters, page, pageSize);
        setHourly(sortHourlyRecords(pageResult.rows));
        setHourlyHasNext(pageResult.hasNext);
      }
      if (nextView === "qh") {
        const page = pageOptions.qh ?? qhPage;
        const pageSize = pageSizeOptions.qh ?? qhPageSize;
        const pageResult = await loadRecordPage(listReganecuQh, resolvedFilters, page, pageSize);
        setQh(sortQuarterHourlyRecords(pageResult.rows));
        setQhHasNext(pageResult.hasNext);
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando datos." });
    } finally {
      stopLoading();
    }
  }

  async function refreshMedidas(
    nextMedidasView = medidasView,
    nextFilters = medperFilters,
    pageOptions: Partial<Record<"qh", number>> = {},
    pageSizeOptions: Partial<Record<"qh", number>> = {}
  ) {
    const stopLoading = beginDataRefresh();
    if (!stopLoading) {
      return;
    }

    try {
      const [nextFiles, nextFilterOptions] = await Promise.all([
        listMedperFiles({ take: 200 }),
        getMedperFilterOptions(nextFilters)
      ]);
      setMedperFiles(nextFiles);
      setMedperFilterOptions(nextFilterOptions);

      const hasDateFilter = Boolean(nextFilters.fecha || nextFilters.fechaInicio || nextFilters.fechaFin);
      const defaultDateFilter = nextMedidasView === "summary" ? {} : { fecha: nextFilterOptions.latestMonth ?? undefined };
      const resolvedFilters =
        nextMedidasView === "summary"
          ? ({} as MedperFilters)
          : !medperDefaultMonthApplied && !hasDateFilter && nextFilterOptions.latestMonth
          ? { ...nextFilters, ...defaultDateFilter }
          : nextFilters;
      if (nextMedidasView !== "summary" && !medperDefaultMonthApplied && !hasDateFilter && nextFilterOptions.latestMonth) {
        setMedperDefaultMonthApplied(true);
        setMedperFilters(resolvedFilters);
      }

      if (nextMedidasView === "graphs") {
        setMedperSummary(await getMedperSummary(resolvedFilters));
      }
      if (nextMedidasView === "summary") {
        setMedperSummary(undefined);
        setMedperMonthlyConsumption(await getMedperMonthlyConsumption());
      }
      if (nextMedidasView === "qh") {
        const page = pageOptions.qh ?? medperqhPage;
        const pageSize = pageSizeOptions.qh ?? medperqhPageSize;
        const pageResult = await loadMedperRecordPage(listMedperqh, resolvedFilters, page, pageSize);
        setMedperqh(pageResult.rows);
        setMedperqhHasNext(pageResult.hasNext);
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando medidas." });
    } finally {
      stopLoading();
    }
  }

  async function refreshLiquidationAnalysis(nextFilters = liquidationAnalysisFilters) {
    const stopLoading = beginDataRefresh();
    if (!stopLoading) {
      return;
    }

    try {
      const nextFilterOptions = await getLiquidationAnalysisFilterOptions();
      setLiquidationAnalysisFilterOptions(nextFilterOptions);
      const resolvedFilters = resolveLiquidationAnalysisFilters(nextFilters, nextFilterOptions);
      if (resolvedFilters.fecha !== nextFilters.fecha || resolvedFilters.version !== nextFilters.version) {
        setLiquidationAnalysisFilters(resolvedFilters);
      }
      if (!hasCompleteLiquidationAnalysisFilters(resolvedFilters)) {
        setLiquidationAnalysisRows([]);
        return;
      }

      setLiquidationAnalysisRows(await getLiquidationAnalysisReport(resolvedFilters));
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando análisis de liquidaciones." });
    } finally {
      stopLoading();
    }
  }

  async function refreshReeLosses(nextFilters = reeLossesFilters) {
    const stopLoading = beginDataRefresh();
    if (!stopLoading) {
      return;
    }

    try {
      const [nextFilterOptions, nextImports] = await Promise.all([getReeLossesFilterOptions(), listReeLossesImports({ take: 200 })]);
      setReeLossesFilterOptions(nextFilterOptions);
      setReeLossesImports(nextImports);
      const resolvedFilters =
        !hasAnyReeLossesDateFilter(nextFilters) && nextFilterOptions.latestMonth
          ? { ...nextFilters, mes: nextFilterOptions.latestMonth }
          : nextFilters;
      if (!hasAnyReeLossesDateFilter(nextFilters) && nextFilterOptions.latestMonth) {
        setReeLossesFilters(resolvedFilters);
      }
      setReeLossesReport(await getReeLossesReport(resolvedFilters));
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando análisis de Liquidaciones REE." });
    } finally {
      stopLoading();
    }
  }

  async function refreshReeDownloadCenter() {
    const stopLoading = beginDataRefresh();
    if (!stopLoading) {
      return;
    }

    try {
      const [nextImports, nextMedperFiles, nextMedperMonthlyConsumption, nextReeLossesImports] = await Promise.all([
        listImports({ take: 200 }),
        listMedperFiles({ take: 200 }),
        getMedperMonthlyConsumption(),
        listReeLossesImports({ take: 200 })
      ]);
      setImports(nextImports);
      setMedperFiles(nextMedperFiles);
      setMedperMonthlyConsumption(nextMedperMonthlyConsumption);
      setReeLossesImports(nextReeLossesImports);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando centro de descargas Liquidaciones REE." });
    } finally {
      stopLoading();
    }
  }

  async function refreshOmieProgramas(nextView = omieProgramasView, fecha = omieFecha, sesion = omieSesion) {
    const stopLoading = beginDataRefresh();
    if (!stopLoading) {
      return;
    }

    try {
      if (!fecha) {
        setMessage({ tone: "error", text: "Selecciona fecha de programa." });
        return;
      }

      if (nextView === "mercadoDiario") {
        setOmieMercadoDiario(await getOmieProgramaMercadoDiario(fecha));
      }
      if (nextView === "intradiarios") {
        setOmieIntradiario(await getOmieProgramaIntradiario(fecha, normalizeOmieSesionInput(sesion)));
      }
      if (nextView === "evolucion") {
        setOmieEvolucion(await getOmieProgramasEvolucion(fecha));
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando programas OMIE." });
    } finally {
      stopLoading();
    }
  }

  async function refreshOmiePrecios(fecha = omiePrecioFecha) {
    const stopLoading = beginDataRefresh();
    if (!stopLoading) {
      return;
    }

    try {
      if (!fecha) {
        setMessage({ tone: "error", text: "Selecciona fecha de precios." });
        return;
      }
      setOmiePrecios(await getOmiePrecios(fecha));
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando precios OMIE." });
    } finally {
      stopLoading();
    }
  }

  async function refreshOmieAnalisisMensual(year = omieAnalisisYear, month = omieAnalisisMonth) {
    const stopLoading = beginDataRefresh();
    if (!stopLoading) {
      return;
    }

    try {
      if (!year || !month) {
        setMessage({ tone: "error", text: "Selecciona mes y año para el análisis mensual." });
        return;
      }
      setOmieAnalisisMensual(await getOmieAnalisisMensual(year, month));
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando análisis mensual OMIE." });
    } finally {
      stopLoading();
    }
  }

  async function refreshOmieComprobacionLiquidaciones(year = omieAnalisisYear, month = omieAnalisisMonth) {
    const stopLoading = beginDataRefresh();
    if (!stopLoading) {
      return;
    }

    try {
      if (!year || !month) {
        setMessage({ tone: "error", text: "Selecciona mes y año para la comprobación OMIE." });
        return;
      }
      setOmieComprobacionLiquidaciones(await getOmieComprobacionLiquidaciones(year, month));
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando comprobación de liquidaciones OMIE." });
    } finally {
      stopLoading();
    }
  }

  async function refreshOmieDescargas(nextFilters = omieDownloadFilters) {
    const stopLoading = beginDataRefresh();
    if (!stopLoading) {
      return;
    }

    try {
      setOmieDescargas(await getOmieDescargasControl(nextFilters));
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando control de descargas OMIE." });
    } finally {
      stopLoading();
    }
  }

  async function refreshOmieTransacciones(nextFilters = omieTransactionFilters, nextSelectedDownloadId = selectedOmieTransactionDownloadId) {
    const stopLoading = beginDataRefresh();
    if (!stopLoading) {
      return;
    }

    try {
      const historico = await getOmieTransactionsHistorico(nextFilters);
      setOmieTransactionDownloads(historico.descargas);
      const selectedId = selectOmieTransactionDownloadId(historico.descargas, nextSelectedDownloadId);
      setSelectedOmieTransactionDownloadId(selectedId);
      if (selectedId) {
        const rows = await getOmieTransactionStagingRows(selectedId, 1000);
        setOmieTransactionRows(rows.filas);
      } else {
        setOmieTransactionRows([]);
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando transacciones OMIE." });
    } finally {
      stopLoading();
    }
  }

  async function executeOmieDownloadDraft(force = false) {
    const stopLoading = beginDataRefresh();
    if (!stopLoading) {
      return;
    }

    try {
      const request = normalizeOmieDownloadRequest(omieDownloadDraft);
      if (!request) {
        setMessage({ tone: "error", text: "Completa fecha y sesión cuando sean obligatorias." });
        return;
      }

      const response = await executeOmieDescarga(request, force);
      setSelectedOmieDownloadDetail(response.download);
      await refreshAfterOmieDownload(response.download);
      setMessage({
        tone: response.message ? "info" : "success",
        text: response.message ?? `${response.download.modulo} € ${response.download.consulta}: ${response.download.registros.toLocaleString("es-ES")} registros.`
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error ejecutando descarga OMIE." });
    } finally {
      stopLoading();
    }
  }

  async function executeOmieDailyBulkDownload(force = false) {
    const stopLoading = beginDataRefresh();
    if (!stopLoading) {
      return;
    }

    try {
      const fecha = getOmieDailyBulkDate(omieDownloadDraft);
      if (!fecha) {
        setMessage({ tone: "error", text: "Selecciona Fecha Programa para descargar todo el día." });
        return;
      }

      const response = await executeOmieDescargaDiaria(fecha, force);
      setLatestOmieDailyBulkDownload(response);
      setOmieDownloadFilters((current) => ({
        ...current,
        fechaDesde: fecha,
        fechaHasta: fecha
      }));
      setOmieDescargas(await getOmieDescargasControl({ ...omieDownloadFilters, fechaDesde: fecha, fechaHasta: fecha }));
      setMessage({
        tone: response.errores > 0 ? "error" : "success",
        text: `Descarga diaria OMIE ${fecha}: ${response.totalConsultasEjecutadas} ejecutadas, ${response.procesadas} procesadas, ${response.sinDatos} sin datos, ${response.errores} errores, ${formatDurationMs(response.tiempoTotalMs)}.`
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error ejecutando descarga diaria OMIE." });
    } finally {
      stopLoading();
    }
  }

  async function syncOmieDownload(row: OmieDownloadControlRow, force: boolean) {
    const stopLoading = beginDataRefresh();
    if (!stopLoading) {
      return;
    }

    try {
      const response = force ? await redownloadOmieDescarga(row.id) : await reprocessOmieDescarga(row.id);
      setSelectedOmieDownloadDetail(response.download);
      await refreshAfterOmieDownload(response.download);
      setMessage({
        tone: response.message ? "info" : "success",
        text: response.message ?? `${row.consulta} ${force ? "redescargado" : "reprocesado"}: ${response.download.registros.toLocaleString("es-ES")} registros.`
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error ejecutando descarga OMIE." });
    } finally {
      stopLoading();
    }
  }

  async function showOmieDownloadDetail(row: OmieDownloadControlRow) {
    const stopLoading = beginDataRefresh();
    if (!stopLoading) {
      return;
    }

    try {
      setSelectedOmieDownloadDetail(await getOmieDescargaDetalle(row.id));
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando detalle de descarga OMIE." });
    } finally {
      stopLoading();
    }
  }

  async function refreshAfterOmieDownload(download: OmieDownloadControlRow) {
    setOmieDescargas(await getOmieDescargasControl(omieDownloadFilters));
    if (download.codigoOmie === "5302") {
      setOmieFecha(download.fechaPrograma);
      setOmieMercadoDiario(await getOmieProgramaMercadoDiario(download.fechaPrograma));
      return;
    }
    if (download.codigoOmie === "5608") {
      const sesion = normalizeOmieSesionInput(download.sesion ?? "01");
      setOmieFecha(download.fechaPrograma);
      setOmieSesion(sesion);
      setOmieIntradiario(await getOmieProgramaIntradiario(download.fechaPrograma, sesion));
      return;
    }
    if (download.modulo === "Precios") {
      setOmiePrecioFecha(download.fechaPrograma);
      setOmiePrecios(await getOmiePrecios(download.fechaPrograma));
      return;
    }
    if (download.codigoOmie === "4121") {
      const historico = await getOmieTransactionsHistorico(omieTransactionFilters);
      setOmieTransactionDownloads(historico.descargas);
      const selectedId = selectOmieTransactionDownloadId(historico.descargas, download.id, { keepPreferredEvenIfEmpty: true });
      setSelectedOmieTransactionDownloadId(selectedId);
      if (selectedId) {
        const rows = await getOmieTransactionStagingRows(selectedId, 1000);
        setOmieTransactionRows(rows.filas);
      }
    }
  }

  async function refreshMedperGraphs(
    nextQhFilters = medperGraphQhFilters
  ) {
    const stopLoading = beginDataRefresh();
    if (!stopLoading) {
      return;
    }

    try {
      const nextFilterOptions = medperFilterOptions ?? (await getMedperFilterOptions());
      if (!medperFilterOptions) {
        setMedperFilterOptions(nextFilterOptions);
      }

      const hasDateFilter = Boolean(nextQhFilters.fecha || nextQhFilters.fechaInicio || nextQhFilters.fechaFin);
      const resolvedQhFilters =
        !medperGraphsDefaultMonthApplied && !hasDateFilter && nextFilterOptions.latestMonth
          ? { ...nextQhFilters, ...monthDateRange(nextFilterOptions.latestMonth) }
          : nextQhFilters;

      if (!medperGraphsDefaultMonthApplied && nextFilterOptions.latestMonth && !hasDateFilter) {
        setMedperGraphsDefaultMonthApplied(true);
        setMedperGraphQhFilters(resolvedQhFilters);
      }

      const qhCurves = await getMedperCurves(sanitizeMedperFiltersForView("qh", resolvedQhFilters));

      setMedperCurves({
        qh: qhCurves.qh
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando gráficas de medidas." });
    } finally {
      stopLoading();
    }
  }

  async function refreshMedperGraphCurves(nextFilters: MedperFilters) {
    const stopLoading = beginDataRefresh();
    if (!stopLoading) {
      return;
    }

    try {
      const nextFilterOptions = medperFilterOptions ?? (await getMedperFilterOptions());
      if (!medperFilterOptions) {
        setMedperFilterOptions(nextFilterOptions);
      }

      const hasDateFilter = Boolean(nextFilters.fecha || nextFilters.fechaInicio || nextFilters.fechaFin);
      const resolvedFilters =
        !medperGraphsDefaultMonthApplied && !hasDateFilter && nextFilterOptions.latestMonth
          ? { ...nextFilters, ...monthDateRange(nextFilterOptions.latestMonth) }
          : nextFilters;

      if (!medperGraphsDefaultMonthApplied && !hasDateFilter && nextFilterOptions.latestMonth) {
        setMedperGraphsDefaultMonthApplied(true);
        setMedperGraphQhFilters(resolvedFilters);
      }

      const curves = await getMedperCurves(sanitizeMedperFiltersForView("qh", resolvedFilters));
      setMedperCurves({
        qh: curves.qh
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando gráficas de medidas." });
    } finally {
      stopLoading();
    }
  }

  async function upload() {
    if (uploadInFlight.current) {
      return;
    }

    if (files.length === 0) {
      setMessage({ tone: "error", text: "Selecciona ficheros TXT, CSV o ZIP." });
      return;
    }

    uploadInFlight.current = true;
    setUploading(true);
    setProgress(0);
    setMessage(undefined);
    const runUpload = async (overwrite: boolean) => {
      const medperUploadFiles = importMode === "medper" ? files : [];
      const reganecuUploadFiles = importMode === "reganecu" ? files : [];
      const reeLossesUploadFiles = importMode === "reeLosses" ? files : [];
      const responses: UploadResponse[] = [];
      let importedRecords = 0;
      let duplicatedFiles = 0;
      let invalidRecords = 0;
      let failedFiles = 0;

      if (reganecuUploadFiles.length > 0) {
        const response = await uploadReganecuFiles(reganecuUploadFiles, medperUploadFiles.length === 0 ? setProgress : undefined, { overwrite });
        setLatestImport(response);
        responses.push(response);
        importedRecords += response.summary.recordsImported;
        duplicatedFiles += response.summary.duplicatedFiles;
        invalidRecords += response.summary.invalidRecords;
        failedFiles += response.summary.failedFiles;
      }

      if (medperUploadFiles.length > 0) {
        const response = await uploadMedperFiles(medperUploadFiles, setProgress, { overwrite });
        setLatestMedperImport(response);
        responses.push(response);
        importedRecords += response.summary.recordsImported;
        duplicatedFiles += response.summary.duplicatedFiles;
        invalidRecords += response.summary.invalidRecords;
        failedFiles += response.summary.failedFiles;
      }

      if (reeLossesUploadFiles.length > 0) {
        const response = await uploadReeLossesFiles(reeLossesUploadFiles, setProgress);
        setLatestReeLossesImport(response);
        responses.push(response);
        importedRecords += response.summary.recordsImported;
        duplicatedFiles += response.summary.duplicatedFiles;
        invalidRecords += response.summary.invalidRecords;
        failedFiles += response.summary.failedFiles;
      }

      return { medperUploadFiles, responses, importedRecords, duplicatedFiles, invalidRecords, failedFiles, overwrite };
    };
    const finishUpload = async ({
      medperUploadFiles,
      responses,
      importedRecords,
      duplicatedFiles,
      invalidRecords,
      failedFiles,
      overwrite
    }: Awaited<ReturnType<typeof runUpload>>) => {
      setFiles([]);
      setMessage({
        tone: failedFiles > 0 || invalidRecords > 0 ? "info" : "success",
        text: `${overwrite ? "Carga sobrescrita. " : ""}${summarizeUploadFeedback(responses, importedRecords, duplicatedFiles, invalidRecords, failedFiles)}`
      });
      if (section === "reeDownloads") {
        await refreshReeDownloadCenter();
      } else if (medperUploadFiles.length > 0) {
        await refreshMedidas("summary", medperFilters);
        setMedidasView("summary");
        setSection("medidas");
      } else if (importMode === "reeLosses") {
        await refreshReeLosses(reeLossesFilters);
        setSection("reeLosses");
      } else {
        await refreshReganecu("summary", filters);
        setReganecuView("summary");
        setSection("reganecu");
      }
    };

    try {
      await finishUpload(await runUpload(false));
    } catch (error) {
      if (error instanceof UploadConflictError && window.confirm(formatUploadConflictConfirmation(error.conflicts))) {
        setProgress(0);
        try {
          await finishUpload(await runUpload(true));
        } catch (overwriteError) {
          setMessage({ tone: "error", text: overwriteError instanceof Error ? overwriteError.message : "Error sobreescribiendo la carga." });
        }
      } else {
        setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error importando ficheros." });
      }
    } finally {
      uploadInFlight.current = false;
      setUploading(false);
    }
  }

  function selectFiles(fileList: FileList | null) {
    if (!fileList || isBusy) {
      return;
    }
    const incomingFiles = Array.from(fileList).filter((file) => file.size > 0);
    if (incomingFiles.some(isLikelyReeLossesFileName)) {
      setImportMode("reeLosses");
    } else if (incomingFiles.some(isLikelyMedperFileName)) {
      setImportMode("medper");
    }
    setFiles((current) => dedupeFiles([...current, ...incomingFiles]));
  }

  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    selectFiles(event.dataTransfer.files);
  }

  function updateFilter(key: keyof Filters, value: string) {
    const next = { ...filters, [key]: value || undefined, skip: 0 };
    if (key === "fecha") {
      next.fechaInicio = undefined;
      next.fechaFin = undefined;
    }
    setFilters(next);
    setHourlyPage(0);
    setQhPage(0);
  }

  function updateMedperFilter(key: keyof MedperFilters, value: string) {
    const next = { ...medperFilters, [key]: value || undefined, skip: 0 };
    if (key === "fecha") {
      next.fechaInicio = undefined;
      next.fechaFin = undefined;
    }
    setMedperFilters(next);
    setMedperqhPage(0);
  }

  function updateMedperGraphQhFilter(key: keyof MedperFilters, value: string) {
    setMedperGraphQhFilters((current) => {
      const next = { ...current, [key]: value || undefined };
      if (key === "fechaInicio" || key === "fechaFin") {
        next.fecha = undefined;
      }
      if (key === "fecha") {
        next.fechaInicio = undefined;
        next.fechaFin = undefined;
      }
      return next;
    });
  }

  function updateLiquidationAnalysisFilter(key: keyof LiquidationAnalysisFilters, value: string) {
    setLiquidationAnalysisFilters((current) => {
      if (key === "fecha") {
        const fecha = value || undefined;
        return {
          ...current,
          fecha,
          version: fecha ? getLatestLiquidationAnalysisVersionForMonth(liquidationAnalysisFilterOptions, fecha) : undefined
        };
      }
      return { ...current, version: (value || undefined) as ReeVersion | undefined };
    });
  }

  function updateReeLossesFilter(key: keyof ReeLossesFilters, value: string) {
    setReeLossesFilters((current) => {
      const next = { ...current, [key]: value || undefined };
      if (key === "fechaInicio" || key === "fechaFin") {
        next.mes = undefined;
      }
      if (key === "mes") {
        next.fechaInicio = undefined;
        next.fechaFin = undefined;
      }
      return next;
    });
  }

  function applyMedperGraphQhFilters() {
    if (isBusy) {
      return;
    }

    const sanitized = sanitizeMedperFiltersForView("qh", medperGraphQhFilters);
    setMedperGraphQhFilters(sanitized);
    void refreshMedperGraphCurves(sanitized);
  }

  function sanitizeReganecuFiltersForView(view: ReganecuView, value: Filters) {
    if (view === "history") {
      return {} as Filters;
    }

    const next: Filters = {
      fecha: value.fecha,
      brp: value.brp,
      sujeto: value.sujeto
    };

    if (view === "summary") {
      return next;
    }

    return {
      ...next,
      version: value.version,
      segmento: value.segmento,
      codigoApunte: value.codigoApunte,
      codigoPrecio: value.codigoPrecio,
      eicUpr: value.eicUpr
    };
  }

  function applyFilters() {
    if (isBusy) {
      return;
    }

    if (section === "liquidationAnalysis") {
      if (!hasCompleteLiquidationAnalysisFilters(liquidationAnalysisFilters)) {
        setMessage({ tone: "error", text: "Selecciona versión y mes." });
        return;
      }
      void refreshLiquidationAnalysis(liquidationAnalysisFilters);
      return;
    }

    if (section === "reeLosses") {
      void refreshReeLosses(reeLossesFilters);
      return;
    }

    if (section === "omieProgramas") {
      void refreshOmieProgramas(omieProgramasView);
      return;
    }

    if (section === "omiePrecios") {
      void refreshOmiePrecios();
      return;
    }

    if (section === "omieAnalisisMensual") {
      void refreshOmieAnalisisMensual();
      return;
    }

    if (section === "omieComprobacionLiquidaciones") {
      void refreshOmieComprobacionLiquidaciones();
      return;
    }

    if (section === "omieTransacciones") {
      void refreshOmieTransacciones();
      return;
    }

    if (section === "omieDescargas") {
      void refreshOmieDescargas(omieDownloadFilters);
      return;
    }

    if (isEsiosSection(section)) {
      setEsiosRefreshKey((current) => current + 1);
      return;
    }

    if (section === "medidas") {
      if (medidasView === "graphs") {
        void refreshMedperGraphs();
        return;
      }
      setMedperqhPage(0);
      const sanitized = sanitizeMedperFiltersForView(medidasView, medperFilters);
      setMedperFilters(sanitized);
      void refreshMedidas(medidasView, sanitized, { qh: 0 });
      return;
    }
    if (section === "reganecu" && reganecuView === "hourly") {
      setHourlyPage(0);
      const sanitized = sanitizeReganecuFiltersForView(reganecuView, filters);
      setFilters(sanitized);
      void refreshReganecu(reganecuView, sanitized, { hourly: 0 });
      return;
    }
    if (section === "reganecu" && reganecuView === "qh") {
      setQhPage(0);
      const sanitized = sanitizeReganecuFiltersForView(reganecuView, filters);
      setFilters(sanitized);
      void refreshReganecu(reganecuView, sanitized, { qh: 0 });
      return;
    }
    const sanitized = sanitizeReganecuFiltersForView(reganecuView, filters);
    setFilters(sanitized);
    void refreshReganecu(reganecuView, sanitized);
  }

  function changeSection(nextSection: Section) {
    if (isBusy) {
      return;
    }

    setSection(nextSection);
    setImportMode(nextSection === "medidas" ? "medper" : nextSection === "reeLosses" ? "reeLosses" : "reganecu");
    if (nextSection === "reeDownloads") {
      void refreshReeDownloadCenter();
      return;
    }
    if (nextSection === "medidas") {
      if (medidasView === "graphs") {
        void refreshMedperGraphs();
        return;
      }
      const sanitized = sanitizeMedperFiltersForView(medidasView, medperFilters);
      setMedperFilters(sanitized);
      void refreshMedidas(medidasView, sanitized);
      return;
    }
    if (nextSection === "liquidationAnalysis") {
      void refreshLiquidationAnalysis(liquidationAnalysisFilters);
      return;
    }
    if (nextSection === "reeLosses") {
      void refreshReeLosses(reeLossesFilters);
      return;
    }
    if (nextSection === "omieProgramas") {
      void refreshOmieProgramas(omieProgramasView);
      return;
    }
    if (nextSection === "omiePrecios") {
      void refreshOmiePrecios();
      return;
    }
    if (nextSection === "omieAnalisisMensual") {
      void refreshOmieAnalisisMensual();
      return;
    }
    if (nextSection === "omieComprobacionLiquidaciones") {
      void refreshOmieComprobacionLiquidaciones();
      return;
    }
    if (nextSection === "omieTransacciones") {
      void refreshOmieTransacciones();
      return;
    }
    if (nextSection === "omieDescargas") {
      void refreshOmieDescargas(omieDownloadFilters);
      return;
    }
    if (isEsiosSection(nextSection)) {
      return;
    }
    const sanitized = sanitizeReganecuFiltersForView(reganecuView, filters);
    setFilters(sanitized);
    void refreshReganecu(reganecuView, sanitized);
  }

  function changeReganecuView(nextReganecuView: ReganecuView) {
    if (isBusy) {
      return;
    }

    setReganecuView(nextReganecuView);
    const sanitized = sanitizeReganecuFiltersForView(nextReganecuView, filters);
    setFilters(sanitized);
    void refreshReganecu(nextReganecuView, sanitized);
  }

  function changeMedidasView(nextMedidasView: MedidasView) {
    if (isBusy) {
      return;
    }

    setMedidasView(nextMedidasView);
    if (nextMedidasView === "graphs") {
      void refreshMedperGraphs();
      return;
    }
    const sanitized = sanitizeMedperFiltersForView(nextMedidasView, medperFilters);
    setMedperFilters(sanitized);
    void refreshMedidas(nextMedidasView, sanitized);
  }

  function changeOmieProgramasView(nextOmieProgramasView: OmieProgramasViewKey) {
    if (isBusy) {
      return;
    }

    setSection("omieProgramas");
    setOmieProgramasView(nextOmieProgramasView);
    void refreshOmieProgramas(nextOmieProgramasView);
  }

  function changeOmieAnalisisYear(nextYear: string) {
    setOmieAnalisisYear(nextYear);
    if (/^\d{4}$/.test(nextYear)) {
      if (section === "omieComprobacionLiquidaciones") {
        void refreshOmieComprobacionLiquidaciones(nextYear, omieAnalisisMonth);
      } else {
        void refreshOmieAnalisisMensual(nextYear, omieAnalisisMonth);
      }
    }
  }

  function changeOmieAnalisisMonth(nextMonth: string) {
    setOmieAnalisisMonth(nextMonth);
    if (section === "omieComprobacionLiquidaciones") {
      void refreshOmieComprobacionLiquidaciones(omieAnalisisYear, nextMonth);
    } else {
      void refreshOmieAnalisisMensual(omieAnalisisYear, nextMonth);
    }
  }

  function toggleSidebarGroup(key: SidebarGroupKey) {
    setOpenSidebarGroups((current) => ({
      ...current,
      [key]: !current[key]
    }));
  }

  function toggleSidebarItem(key: string) {
    setOpenSidebarItems((current) => ({
      ...current,
      [key]: !current[key]
    }));
  }

  function changeHourlyPage(nextPage: number) {
    if (isBusy) {
      return;
    }

    const page = Math.max(nextPage, 0);
    setHourlyPage(page);
    void refreshReganecu("hourly", filters, { hourly: page });
  }

  function changeHourlyPageSize(nextPageSize: number) {
    if (isBusy) {
      return;
    }

    setHourlyPageSize(nextPageSize);
    setHourlyPage(0);
    void refreshReganecu("hourly", filters, { hourly: 0 }, { hourly: nextPageSize });
  }

  function changeQhPage(nextPage: number) {
    if (isBusy) {
      return;
    }

    const page = Math.max(nextPage, 0);
    setQhPage(page);
    void refreshReganecu("qh", filters, { qh: page });
  }

  function changeQhPageSize(nextPageSize: number) {
    if (isBusy) {
      return;
    }

    setQhPageSize(nextPageSize);
    setQhPage(0);
    void refreshReganecu("qh", filters, { qh: 0 }, { qh: nextPageSize });
  }

  function changeMedperqhPage(nextPage: number) {
    if (isBusy) {
      return;
    }

    const page = Math.max(nextPage, 0);
    setMedperqhPage(page);
    void refreshMedidas("qh", medperFilters, { qh: page });
  }

  function changeMedperqhPageSize(nextPageSize: number) {
    if (isBusy) {
      return;
    }

    setMedperqhPageSize(nextPageSize);
    setMedperqhPage(0);
    void refreshMedidas("qh", medperFilters, { qh: 0 }, { qh: nextPageSize });
  }

  useEffect(() => {
    void refreshReganecu("summary", filters);
  }, []);

  useEffect(() => {
    if (section !== "reganecu" || reganecuView !== "summary" || filters.fechaInicio || filters.fechaFin) {
      return;
    }

    const latestLiquidationDate = summary?.files
      .filter((file) => file.status === "IMPORTED")
      .map((file) => file.fechaLiquidacion)
      .sort((left, right) => right.localeCompare(left, "es"))[0];

    if (!latestLiquidationDate) {
      return;
    }

    setFilters((current) => {
      if (current.fechaInicio || current.fechaFin) {
        return current;
      }
      return {
        ...current,
        fechaInicio: latestLiquidationDate,
        fechaFin: latestLiquidationDate
      };
    });
  }, [filters.fechaFin, filters.fechaInicio, reganecuView, section, summary?.files]);

  const workspaceTitle =
    section === "reeDownloads"
      ? "Centro de Descargas Liquidaciones REE"
      : section === "reganecu"
        ? "Auditoria de liquidaciones REGANECU"
      : section === "liquidationAnalysis"
        ? "Análisis de liquidaciones"
        : section === "reeLosses"
          ? "Liquidaciones REE"
          : section === "omieProgramas"
            ? "OMIE Programas"
            : section === "omiePrecios"
              ? "OMIE Precios"
              : section === "omieAnalisisMensual"
                ? "OMIE Detalle de Carga"
                : section === "omieComprobacionLiquidaciones"
                  ? "OMIE Comprobación Liquidaciones"
                  : section === "omieTransacciones"
                    ? "OMIE Transacciones"
                  : section === "omieDescargas"
                    ? "OMIE Control de descargas"
                    : section === "esiosIndicadores"
                      ? "ESIOS Indicadores"
                    : section === "esiosPerfiles"
                        ? "ESIOS Perfiles"
                      : section === "esiosSeries"
                        ? "ESIOS Series"
                    : section === "esiosDescargas"
                          ? "ESIOS Descargas"
                          : section === "esiosConfiguracion"
                            ? "ESIOS Configuracion"
                      : "Auditoria de medidas";
  const refreshCurrent = () => {
    if (isBusy) {
      return;
    }

      if (section === "reganecu") {
        const sanitized = sanitizeReganecuFiltersForView(reganecuView, filters);
        setFilters(sanitized);
        void refreshReganecu(reganecuView, sanitized);
        return;
      }

      if (section === "reeDownloads") {
        void refreshReeDownloadCenter();
        return;
      }
  
      if (section === "liquidationAnalysis") {
      void refreshLiquidationAnalysis(liquidationAnalysisFilters);
      return;
    }

    if (section === "reeLosses") {
      void refreshReeLosses(reeLossesFilters);
      return;
    }

    if (section === "omieProgramas") {
      void refreshOmieProgramas(omieProgramasView);
      return;
    }

    if (section === "omiePrecios") {
      void refreshOmiePrecios();
      return;
    }

    if (section === "omieAnalisisMensual") {
      void refreshOmieAnalisisMensual();
      return;
    }

    if (section === "omieComprobacionLiquidaciones") {
      void refreshOmieComprobacionLiquidaciones();
      return;
    }

    if (section === "omieTransacciones") {
      void refreshOmieTransacciones();
      return;
    }

    if (section === "omieDescargas") {
      void refreshOmieDescargas(omieDownloadFilters);
      return;
    }

    if (isEsiosSection(section)) {
      setEsiosRefreshKey((current) => current + 1);
      return;
    }

    if (medidasView === "graphs") {
      void refreshMedperGraphs();
      return;
    }

    const sanitized = sanitizeMedperFiltersForView(medidasView, medperFilters);
    setMedperFilters(sanitized);
    void refreshMedidas(medidasView, sanitized);
  };

  const sidebarGroups: SidebarGroupConfig[] = [
    {
      key: "ree",
      title: "Liquidaciones REE",
      active: section === "reeDownloads" || section === "reganecu" || section === "medidas" || section === "reeLosses",
      items: [
        {
          key: "ree-download-center",
          label: "Centro de descargas",
          description: "control operativo de liquidaciones",
          active: section === "reeDownloads",
          onSelect: () => changeSection("reeDownloads")
        },
        {
          key: "ree-reganecu-menu",
          label: "REGANECU",
          description: "liquidaciones y validaciones",
          active: section === "reganecu",
          children: [
            {
              key: "reganecu-history",
              label: "Histórico",
              description: "cargas y estado de las cargas",
              active: section === "reganecu" && reganecuView === "history",
              onSelect: () => {
                setSection("reganecu");
                setImportMode("reganecu");
                changeReganecuView("history");
              }
            },
            {
              key: "reganecu-summary",
              label: "Resumen",
              description: "liquidación y validaciones",
              active: section === "reganecu" && reganecuView === "summary",
              onSelect: () => {
                setSection("reganecu");
                setImportMode("reganecu");
                changeReganecuView("summary");
              }
            },
            {
              key: "reganecu-hourly",
              label: "Horario",
              description: "detalle horario",
              active: section === "reganecu" && reganecuView === "hourly",
              onSelect: () => {
                setSection("reganecu");
                setImportMode("reganecu");
                changeReganecuView("hourly");
              }
            },
            {
              key: "reganecu-qh",
              label: "Cuartohorario",
              description: "detalle cuarto horario",
              active: section === "reganecu" && reganecuView === "qh",
              onSelect: () => {
                setSection("reganecu");
                setImportMode("reganecu");
                changeReganecuView("qh");
              }
            },
            {
              key: "liquidation-analysis",
              label: "Análisis de liquidaciones",
              description: "cuadre económico y energético",
              active: section === "liquidationAnalysis",
              onSelect: () => changeSection("liquidationAnalysis")
            }
          ]
        },
        {
          key: "ree-medidas-menu",
          label: "Medidas",
          description: "resumen y detalle de medidas",
          active: section === "medidas",
          children: [
            {
              key: "medidas-history",
              label: "Histórico",
              description: "cargas y estado de las cargas",
              active: section === "medidas" && medidasView === "history",
              onSelect: () => {
                setSection("medidas");
                setImportMode("medper");
                changeMedidasView("history");
              }
            },
            {
              key: "medidas-summary",
              label: "Resumen medidas",
              description: "métricas agregadas",
              active: section === "medidas" && medidasView === "summary",
              onSelect: () => {
                setSection("medidas");
                setImportMode("medper");
                changeMedidasView("summary");
              }
            },
            {
              key: "medidas-qh",
              label: "Cuartohorario",
              description: "detalle cuarto horario",
              active: section === "medidas" && medidasView === "qh",
              onSelect: () => {
                setSection("medidas");
                setImportMode("medper");
                changeMedidasView("qh");
              }
            },
            {
              key: "medidas-graphs",
              label: "Gráficos",
              description: "curvas BC/PF",
              active: section === "medidas" && medidasView === "graphs",
              onSelect: () => {
                setSection("medidas");
                setImportMode("medper");
                changeMedidasView("graphs");
              }
            }
          ]
        },
        {
          key: "ree-losses-history",
          label: "Histórico",
          description: "cargas y estado de las cargas",
          active: section === "reeLosses" && reeLossesView === "history",
          onSelect: () => {
            setSection("reeLosses");
            setImportMode("reeLosses");
            setReeLossesView("history");
            void refreshReeLosses(reeLossesFilters);
          }
        },
        {
          key: "ree-losses-menu",
          label: "Pérdidas",
          description: "detalle y evolución",
          active: section === "reeLosses" && (reeLossesView === "detail" || reeLossesView === "system"),
          children: [
            {
              key: "ree-losses-detail",
              label: "Detalle de pérdidas",
              description: "tabla y exportaciones",
              active: section === "reeLosses" && reeLossesView === "detail",
              onSelect: () => {
                setSection("reeLosses");
                setImportMode("reeLosses");
                setReeLossesView("detail");
                void refreshReeLosses(reeLossesFilters);
              }
            },
            {
              key: "ree-losses-system",
              label: "Sistema + evolución",
              description: "peninsular y KPIs",
              active: section === "reeLosses" && reeLossesView === "system",
              onSelect: () => {
                setSection("reeLosses");
                setImportMode("reeLosses");
                setReeLossesView("system");
                void refreshReeLosses(reeLossesFilters);
              }
            }
          ]
        }
      ]
    },
    {
      key: "omie",
      title: "OMIE",
      active: isOmieSection(section),
      items: [
        {
          key: "omie-programas-menu",
          label: "Programas",
          description: "programas y transacciones",
          active: section === "omieProgramas" || section === "omieTransacciones",
          children: [
            {
              key: "omie-mercado-diario",
              label: "Mercado Diario",
              description: "PVD cuarto horario",
              active: section === "omieProgramas" && omieProgramasView === "mercadoDiario",
              onSelect: () => changeOmieProgramasView("mercadoDiario")
            },
            {
              key: "omie-intradiarios",
              label: "Intradiario",
              description: "PHF por sesión",
              active: section === "omieProgramas" && omieProgramasView === "intradiarios",
              onSelect: () => changeOmieProgramasView("intradiarios")
            },
            {
              key: "omie-transacciones-historico",
              label: "Transacciones",
              description: "consulta 4121 RAW",
              active: section === "omieTransacciones",
              onSelect: () => changeSection("omieTransacciones")
            }
          ]
        },
        {
          key: "omie-precios-consulta",
          label: "Precios",
          description: "MD, MI y XBID",
          active: section === "omiePrecios",
          onSelect: () => changeSection("omiePrecios")
        },
        {
          key: "omie-control-descargas",
          label: "Descargas",
          description: "estado y reproceso",
          active: section === "omieDescargas",
          onSelect: () => changeSection("omieDescargas")
        },
        {
          key: "omie-hoja-control-menu",
          label: "Hoja de control",
          description: "detalle y cuadres",
          active: section === "omieAnalisisMensual" || section === "omieComprobacionLiquidaciones",
          children: [
            {
              key: "omie-analisis-mensual",
              label: "Detalle de carga",
              description: "precios, programas, volúmenes y profit",
              active: section === "omieAnalisisMensual",
              onSelect: () => changeSection("omieAnalisisMensual")
            },
            {
              key: "omie-comprobacion-liquidaciones",
              label: "Comprobación Liquidaciones",
              description: "cuadre económico y energético",
              active: section === "omieComprobacionLiquidaciones",
              onSelect: () => changeSection("omieComprobacionLiquidaciones")
            }
          ]
        }
      ]
    },
    {
      key: "esios",
      title: "ESIOS",
      active: isEsiosSection(section),
      items: [
        {
          key: "esios-perfiles",
          label: "Perfiles",
          description: "perfiles iniciales REE",
          active: section === "esiosPerfiles",
          onSelect: () => changeSection("esiosPerfiles")
        },
        {
          key: "esios-menu",
          label: "Indicadores ESIOS",
          description: "catalogo, series y descargas",
          active: isEsiosSection(section),
          children: [
            {
              key: "esios-indicadores",
              label: "Indicadores",
              description: "catalogo ESIOS",
              active: section === "esiosIndicadores",
              onSelect: () => changeSection("esiosIndicadores")
            },
            {
              key: "esios-series",
              label: "Series",
              description: "indicadores con datos",
              active: section === "esiosSeries",
              onSelect: () => changeSection("esiosSeries")
            },
            {
              key: "esios-descargas",
              label: "Descargas",
              description: "descarga manual",
              active: section === "esiosDescargas",
              onSelect: () => changeSection("esiosDescargas")
            },
            {
              key: "esios-configuracion",
              label: "Configuracion",
              description: "API y token",
              active: section === "esiosConfiguracion",
              onSelect: () => changeSection("esiosConfiguracion")
            }
          ]
        }
      ]
    }
  ];
  const showGlobalUploadBand = false;

  return (
    <div className={`app-layout ${appBusy ? "is-busy" : ""}`} aria-busy={appBusy}>
        <GlobalLoadingOverlay />
        <aside className="sidebar">
          <div className="sidebar-brand">
            <p>Liquidaciones REE</p>
            <strong>Auditoria</strong>
          </div>
          <nav className="sidebar-nav">
            {sidebarGroups.map((group) => {
              const visibleItems = hideOperationalHistoryItems(group.items);
              return (
                <SidebarSection
                  active={group.active}
                  disabled={isBusy}
                  items={visibleItems}
                  key={group.key}
                  onToggleItem={toggleSidebarItem}
                  onToggle={() => toggleSidebarGroup(group.key)}
                  open={openSidebarGroups[group.key]}
                  openItems={openSidebarItems}
                  title={group.title}
                />
              );
            })}
          </nav>
        </aside>

        <main className="app-shell">
          <header className="topbar">
            <div>
              <p className="eyebrow">Facturacion A1 - Liquidaciones REE</p>
              <h1>{workspaceTitle}</h1>
            </div>
            <button className="icon-button" onClick={refreshCurrent} disabled={isBusy} title="Actualizar">
              {loading ? <LoadingSquares compact /> : <RefreshCw size={18} />}
            </button>
          </header>

          {showGlobalUploadBand && !isOmieSection(section) && section !== "reeDownloads" && (
            <section className="upload-band">
              <label
                className={`dropzone ${dragging ? "dragging" : ""} ${isBusy ? "disabled" : ""}`}
                onDragEnter={() => {
                  if (!isBusy) {
                    setDragging(true);
                  }
                }}
                onDragLeave={() => setDragging(false)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  if (isBusy) {
                    event.preventDefault();
                    return;
                  }
                  drop(event);
                }}
              >
                <UploadCloud size={28} />
                <span>{files.length ? `${files.length} fichero(s) preparados` : "Soltar TXT, CSV, ZIP o ficheros REE"}</span>
                <input
                  type="file"
                  disabled={isBusy}
                  multiple
                  onChange={(event) => {
                    selectFiles(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <div className="upload-queue">
                {files.slice(0, 3).map((file, index) => (
                  <span className="file-chip" key={`${file.name}-${file.size}-${file.lastModified}`}>
                    {file.name}
                    <button disabled={isBusy} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} type="button">
                      <X size={14} />
                    </button>
                  </span>
                ))}
                {files.length > 3 && <span className="file-chip">{files.length - 3} mas</span>}
              </div>
              <div className="upload-actions">
                <div className="import-mode" aria-label="Tipo de importacion" role="group">
                  <button className={importMode === "reganecu" ? "active" : ""} disabled={isBusy} onClick={() => setImportMode("reganecu")} type="button">
                    <Database size={15} />
                    REGANECU
                  </button>
                  <button className={importMode === "medper" ? "active" : ""} disabled={isBusy} onClick={() => setImportMode("medper")} type="button">
                    <Activity size={15} />
                    MEDPER
                  </button>
                  <button className={importMode === "reeLosses" ? "active" : ""} disabled={isBusy} onClick={() => setImportMode("reeLosses")} type="button">
                    <TrendingUp size={15} />
                    K REE
                  </button>
                </div>
                {uploading && (
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                )}
                <button className="primary-button" disabled={isBusy || files.length === 0} onClick={() => void upload()} type="button">
                  <ButtonLoadingContent loading={uploading} loadingLabel="Importando" icon={<UploadCloud size={18} />}>
                    Importar
                  </ButtonLoadingContent>
                </button>
              </div>
            </section>
          )}

          {section === "reganecu" && (
            <ReganecuFilterBand
              view={reganecuView}
              filters={filters}
              options={reganecuFilterOptions}
              onChange={updateFilter}
              onApply={applyFilters}
              disabled={isBusy}
            />
          )}
          {section === "medidas" && medidasView !== "graphs" && (
            <MedperFilterBand
              view={medidasView}
              filters={medperFilters}
              options={medperFilterOptions}
              onChange={updateMedperFilter}
              onApply={applyFilters}
              disabled={isBusy}
            />
          )}
          {section === "liquidationAnalysis" && (
            <LiquidationAnalysisFilterBand
              filters={liquidationAnalysisFilters}
              options={liquidationAnalysisFilterOptions}
              onChange={updateLiquidationAnalysisFilter}
              onApply={applyFilters}
              disabled={isBusy}
            />
          )}
          {section === "reeLosses" && reeLossesView !== "history" && (
            <ReeLossesFilterBand
              filters={reeLossesFilters}
              options={reeLossesFilterOptions}
              onChange={updateReeLossesFilter}
              onApply={applyFilters}
              disabled={isBusy}
            />
          )}

          {message && <div className={`status-message ${message.tone}`}>{message.text}</div>}

          {section === "omieProgramas" && (
            <OmieProgramasModule
              view={omieProgramasView}
              fecha={omieFecha}
              sesion={omieSesion}
              mercadoDiario={omieMercadoDiario}
              intradiario={omieIntradiario}
              evolucion={omieEvolucion}
              loading={loading}
              onFechaChange={setOmieFecha}
              onSesionChange={(value) => setOmieSesion(normalizeOmieSesionInput(value))}
              onRefresh={() => refreshOmieProgramas(omieProgramasView)}
              onGoToDownloads={() => changeSection("omieDescargas")}
            />
          )}
          {section === "omiePrecios" && (
            <OmiePreciosModule
              fecha={omiePrecioFecha}
              precios={omiePrecios}
              loading={loading}
              onFechaChange={setOmiePrecioFecha}
              onRefresh={() => refreshOmiePrecios()}
              onGoToDownloads={() => changeSection("omieDescargas")}
            />
          )}
          {section === "omieAnalisisMensual" && (
            <OmieDetalleCargaModule
              year={omieAnalisisYear}
              month={omieAnalisisMonth}
              analisis={omieAnalisisMensual}
              loading={loading}
              onYearChange={changeOmieAnalisisYear}
              onMonthChange={changeOmieAnalisisMonth}
              onRefresh={() => refreshOmieAnalisisMensual()}
              onGoToDownloads={() => changeSection("omieDescargas")}
            />
          )}
          {section === "omieComprobacionLiquidaciones" && (
            <OmieLiquidacionesModule
              year={omieAnalisisYear}
              month={omieAnalisisMonth}
              comprobacion={omieComprobacionLiquidaciones}
              loading={loading}
              onYearChange={changeOmieAnalisisYear}
              onMonthChange={changeOmieAnalisisMonth}
              onRefresh={() => refreshOmieComprobacionLiquidaciones()}
              onGoToDownloads={() => changeSection("omieDescargas")}
            />
          )}
          {section === "omieTransacciones" && (
            <OmieTransaccionesModule
              filters={omieTransactionFilters}
              downloads={omieTransactionDownloads}
              rows={omieTransactionRows}
              selectedDownloadId={selectedOmieTransactionDownloadId}
              loading={loading}
              onFiltersChange={setOmieTransactionFilters}
              onRefresh={() => refreshOmieTransacciones()}
              onGoToDownloads={() => changeSection("omieDescargas")}
            />
          )}
          {section === "omieDescargas" && (
            <OmieDescargasControlModule
              descargas={omieDescargas}
              filters={omieDownloadFilters}
              draft={omieDownloadDraft}
              detail={selectedOmieDownloadDetail}
              latestDailyBulkDownload={latestOmieDailyBulkDownload}
              loading={loading}
              onFiltersChange={setOmieDownloadFilters}
              onDraftChange={setOmieDownloadDraft}
              onApply={() => refreshOmieDescargas(omieDownloadFilters)}
              onDownload={() => executeOmieDownloadDraft(false)}
              onForceDownload={() => executeOmieDownloadDraft(true)}
              onDownloadDay={() => executeOmieDailyBulkDownload(false)}
              onForceDownloadDay={() => executeOmieDailyBulkDownload(true)}
              onShowDetail={showOmieDownloadDetail}
              onCloseDetail={() => setSelectedOmieDownloadDetail(undefined)}
              onReprocess={(row) => syncOmieDownload(row, false)}
              onRedownload={(row) => syncOmieDownload(row, true)}
            />
          )}

          {isEsiosSection(section) && <EsiosModule key={`${section}-${esiosRefreshKey}`} view={esiosViewFromSection(section)} />}

          {section === "reeDownloads" && (
            <ReeDownloadCenterModule
              reganecuFiles={imports}
              medperFiles={medperFiles}
              medperMonthlyConsumption={medperMonthlyConsumption}
              reeLossesImports={reeLossesImports}
              loading={loading}
              files={files}
              importMode={importMode}
              uploading={uploading}
              progress={progress}
              disabled={isBusy}
              onImportModeChange={setImportMode}
              onSelectFiles={selectFiles}
              onRemoveFile={(index) => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
              onUpload={() => void upload()}
              onRefresh={refreshReeDownloadCenter}
            />
          )}

          {section === "reganecu" && reganecuView === "history" && (
            <HistoryView files={imports} latestImport={latestImport} onRefresh={() => refreshReganecu("history", filters)} />
          )}
          {section === "reganecu" && reganecuView === "summary" && <SummaryView groups={chartGroups} />}
          {section === "reganecu" && reganecuView === "hourly" && (
            <DetailView
              rows={hourly}
              title="Detalle horario REGANECU"
              timeColumnLabel="Hora"
              page={hourlyPage}
              pageSize={hourlyPageSize}
              hasNext={hourlyHasNext}
              loading={loading}
              onPageChange={changeHourlyPage}
              onPageSizeChange={changeHourlyPageSize}
              loadExportRows={() => loadAllRecordRows(listReganecu, sanitizeReganecuFiltersForView("hourly", filters))}
            />
          )}
          {section === "reganecu" && reganecuView === "qh" && (
            <DetailView
              rows={qh}
              title="Detalle cuartohorario REGANECUQH"
              showRelatedHour
              timeColumnLabel="Cuarto de hora"
              page={qhPage}
              pageSize={qhPageSize}
              hasNext={qhHasNext}
              loading={loading}
              onPageChange={changeQhPage}
              onPageSizeChange={changeQhPageSize}
              loadExportRows={() => loadAllRecordRows(listReganecuQh, sanitizeReganecuFiltersForView("qh", filters))}
            />
          )}
          {section === "medidas" && (
            <MedperViewPanel
              activeView={medidasView}
              files={medperFiles}
              latestImport={latestMedperImport}
              summary={medperSummary}
              monthlyConsumption={medperMonthlyConsumption}
              qhRows={medperqh}
              curves={medperCurves}
              qhGraphFilters={medperGraphQhFilters}
              filterOptions={medperFilterOptions}
              selectedMonth={medperFilters.fecha ?? medperFilterOptions?.latestMonth ?? null}
              qhPage={medperqhPage}
              qhPageSize={medperqhPageSize}
              qhHasNext={medperqhHasNext}
              loading={loading}
              onQhPageChange={changeMedperqhPage}
              onQhPageSizeChange={changeMedperqhPageSize}
              loadQhExportRows={() => loadAllMedperRows(listMedperqh, sanitizeMedperFiltersForView("qh", medperFilters))}
              onQhGraphFilterChange={updateMedperGraphQhFilter}
              onQhGraphApply={applyMedperGraphQhFilters}
              onRefreshHistory={() => refreshMedidas("history", medperFilters)}
            />
          )}
          {section === "liquidationAnalysis" && (
            <LiquidationAnalysisView
              rows={liquidationAnalysisRows}
              filters={liquidationAnalysisFilters}
              loading={loading}
            />
          )}
          {section === "reeLosses" && (
            <ReeLossesView
              view={reeLossesView}
              imports={reeLossesImports}
              report={reeLossesReport}
              loading={loading}
              latestImport={latestReeLossesImport}
              onRefreshHistory={() => refreshReeLosses(reeLossesFilters)}
            />
          )}
        </main>
    </div>
  );
}

async function loadRecordPage(
  loader: (filters: Filters) => Promise<A1Record[]>,
  filters: Filters,
  page: number,
  pageSize: number
) {
  const rows = await loader({ ...filters, skip: page * pageSize, take: pageSize + 1 });
  return {
    rows: rows.slice(0, pageSize),
    hasNext: rows.length > pageSize
  };
}

async function loadAllRecordRows(loader: (filters: Filters) => Promise<A1Record[]>, filters: Filters) {
  return loadAllPagedRows(loader, filters);
}

async function loadAllPagedRows<T, TFilters extends { skip?: number; take?: number }>(
  loader: (filters: TFilters) => Promise<T[]>,
  filters: TFilters
) {
  const rows: T[] = [];
  let skip = 0;

  while (true) {
    const page = await loader({ ...filters, skip, take: EXPORT_PAGE_SIZE });
    rows.push(...page);
    if (page.length < EXPORT_PAGE_SIZE) {
      return rows;
    }
    skip += EXPORT_PAGE_SIZE;
  }
}

function hideOperationalHistoryItems(items: SidebarMenuItem[]): SidebarMenuItem[] {
  const hiddenKeys = new Set(["reganecu-history", "medidas-history", "ree-losses-history", "liquidation-analysis"]);
  return items
    .filter((item) => !hiddenKeys.has(item.key))
    .map((item) => ({
      ...item,
      children: item.children ? hideOperationalHistoryItems(item.children) : undefined
    }));
}

const SEARCHABLE_SELECT_THRESHOLD = 24;

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
                aria-selected={value === option}
                className={`searchable-select-option ${value === option ? "active" : ""}`}
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
            {filteredOptions.length === 0 && <div className="searchable-select-empty">Sin resultados</div>}
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

function ReganecuFilterBand({
  view,
  filters,
  options,
  onChange,
  onApply,
  disabled = false
}: {
  view: ReganecuView;
  filters: Filters;
  options?: SettlementFilterOptions;
  onChange: (key: keyof Filters, value: string) => void;
  onApply: () => void;
  disabled?: boolean;
}) {
  if (view === "history") {
    return null;
  }

  const loadingOptions = !options;
  const months = options?.months ?? [];

  return (
    <section className="filter-band">
      {view !== "summary" && <FilterSelect disabled={disabled} loading={loadingOptions} label="Versión" value={filters.version ?? ""} options={options?.versions ?? []} onChange={(value) => onChange("version", value)} />}
      <FilterSelect disabled={disabled} loading={loadingOptions} label="Mes" value={filters.fecha ?? ""} options={months} onChange={(value) => onChange("fecha", value)} />
      <FilterSelect disabled={disabled} loading={loadingOptions} label="BRP" value={filters.brp ?? ""} options={options?.brps ?? []} onChange={(value) => onChange("brp", value)} />
      <FilterSelect disabled={disabled} loading={loadingOptions} label="Sujeto" value={filters.sujeto ?? ""} options={options?.subjects ?? []} onChange={(value) => onChange("sujeto", value)} />
      {view !== "summary" && (
        <>
          <FilterSelect disabled={disabled} loading={loadingOptions} label="Segmento" value={filters.segmento ?? ""} options={options?.segments ?? []} onChange={(value) => onChange("segmento", value)} />
          <FilterSelect disabled={disabled} loading={loadingOptions} label="Cod. apunte" value={filters.codigoApunte ?? ""} options={options?.settlementCodes ?? []} onChange={(value) => onChange("codigoApunte", value)} />
          <FilterSelect disabled={disabled} loading={loadingOptions} label="Cod. precio" value={filters.codigoPrecio ?? ""} options={options?.priceCodes ?? []} onChange={(value) => onChange("codigoPrecio", value)} />
          <FilterSelect disabled={disabled} loading={loadingOptions} label="EIC UPR" value={filters.eicUpr ?? ""} options={options?.eicUprs ?? []} onChange={(value) => onChange("eicUpr", value)} />
        </>
      )}
      <button className="secondary-button" disabled={disabled} onClick={onApply} type="button">
        <Search size={16} />
        Filtrar
      </button>
    </section>
  );
}

function LiquidationAnalysisFilterBand({
  filters,
  options,
  onChange,
  onApply,
  disabled = false
}: {
  filters: LiquidationAnalysisFilters;
  options?: LiquidationAnalysisFilterOptions;
  onChange: (key: keyof LiquidationAnalysisFilters, value: string) => void;
  onApply: () => void;
  disabled?: boolean;
}) {
  const loadingOptions = !options;
  const complete = hasCompleteLiquidationAnalysisFilters(filters);

  return (
    <section className="filter-band liquidation-analysis-filter-band">
      <FilterSelect disabled={disabled} loading={loadingOptions} label="Mes" placeholder="Selecciona" value={filters.fecha ?? ""} options={options?.months ?? []} onChange={(value) => onChange("fecha", value)} />
      <FilterSelect disabled={disabled} loading={loadingOptions} label="Versión" placeholder="Selecciona" value={filters.version ?? ""} options={options?.versions ?? []} onChange={(value) => onChange("version", value)} />
      <button className="secondary-button" disabled={disabled || loadingOptions || !complete} onClick={onApply} type="button">
        <Search size={16} />
        Filtrar
      </button>
    </section>
  );
}

function LiquidationAnalysisChart({ rows }: { rows: LiquidationAnalysisRow[] }) {
  const option = useMemo<EChartsOption>(() => buildLiquidationAnalysisChartOption(rows), [rows]);
  return <EChart option={option} height={360} />;
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
        name: "€/MWh",
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

function buildLiquidationAnalysisKpis(totals: ReturnType<typeof summarizeLiquidationAnalysisRows>): TechnicalKpi[] {
  return [
    { label: "Total Medida", value: `${formatEnergy(totals.medidaMwh)} MWh` },
    { label: "Total DSV", value: `${formatEnergy(totals.dsvMwh)} MWh` },
    { label: "Coste total DSV", value: formatCurrency(totals.costeDsvEur) },
    { label: "Coste total CAD", value: formatCurrency(totals.costeCadEur) },
    { label: "Coste total PC3", value: formatCurrency(totals.costePc3Eur) },
    { label: "Coste total BS3", value: formatCurrency(totals.costeBs3Eur) },
    { label: "Coste total RAD3", value: formatCurrency(totals.costeRad3Eur) }
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
    medida: formatEnergy(totals.medidaMwh),
    dsv: formatEnergy(totals.dsvMwh),
    dsvPct: dsvPct === undefined ? "" : formatRatioPercent(dsvPct),
    dsvAbs: formatEnergy(totals.dsvAbsMwh),
    dsvAbsPct: dsvAbsPct === undefined ? "" : formatRatioPercent(dsvAbsPct),
    costeDsv: formatEuroAmount(totals.costeDsvEur),
    precioDsv: precioDsv === undefined ? "" : formatPrice(precioDsv),
    costeCad: formatEuroAmount(totals.costeCadEur),
    precioCad: precioCad === undefined ? "" : formatPrice(precioCad),
    costePc3: formatEuroAmount(totals.costePc3Eur),
    precioPc3: precioPc3 === undefined ? "" : formatPrice(precioPc3),
    costeBs3: formatEuroAmount(totals.costeBs3Eur),
    precioBs3: precioBs3 === undefined ? "" : formatPrice(precioBs3),
    costeRad3: formatEuroAmount(totals.costeRad3Eur),
    precioRad3: precioRad3 === undefined ? "" : formatPrice(precioRad3)
  };
}

function buildLiquidationAnalysisOutlierLabels(rows: LiquidationAnalysisRow[]) {
  const labels = new Map<string, string[]>();
  const checks = [
    { label: "DSV % anómalo", value: (row: LiquidationAnalysisRow) => ratioPercentValue(row.dsvPct) },
    { label: "DSV ABS % anómalo", value: (row: LiquidationAnalysisRow) => ratioPercentValue(row.dsvAbsPct) },
    { label: "COSTE DSV / DSV anómalo", value: (row: LiquidationAnalysisRow) => normalizeNumericValue(row.precioDsvEurMwh) },
    { label: "PRECIO CAD anómalo", value: (row: LiquidationAnalysisRow) => normalizeNumericValue(row.precioCadEurMwh) },
    { label: "PRECIO PC3 anómalo", value: (row: LiquidationAnalysisRow) => normalizeNumericValue(row.precioPc3EurMwh) },
    { label: "PRECIO BS3 anómalo", value: (row: LiquidationAnalysisRow) => normalizeNumericValue(row.precioBs3EurMwh) },
    { label: "PRECIO RAD3 anómalo", value: (row: LiquidationAnalysisRow) => normalizeNumericValue(row.precioRad3EurMwh) }
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

function totalRatio(numerator: number, denominator: number) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0 ? numerator / denominator : undefined;
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

function liquidationAnalysisQuality(row: LiquidationAnalysisRow, outlierLabels: Map<string, string[]>): RowQuality {
  const labels = [
    ...(outlierLabels.get(row.fecha) ?? []),
    row.medidaMwh === null || row.medidaMwh === undefined ? "Medida vacía" : ""
  ].filter(Boolean);
  return {
    tone: outlierLabels.has(row.fecha) ? "danger" : labels.length > 0 ? "warning" : "ok",
    labels
  };
}

function buildReganecuKpis(rows: A1Record[]): TechnicalKpi[] {
  const anomalies = rows.filter((row) => reganecuQuality(row).tone !== "ok").length;
  return [
    { label: "Total registros", value: formatNumber(rows.length), meta: "página cargada" },
    { label: "MWh", value: formatNumber(sumNumeric(rows.map((row) => row.energiaMwh))), meta: "energía total" },
    { label: "Importe", value: formatCurrency(sumNumeric(rows.map((row) => row.importeEur))), meta: "importe total" },
    { label: "Cod. precio dominante", value: dominantValue(rows.map((row) => row.codigoPrecio)) || "-", meta: "en página" },
    { label: "Anomalías", value: formatNumber(anomalies), meta: "importe/precio/datos", tone: anomalies > 0 ? "warning" : "good" },
    { label: "Última actualización", value: latestUpdate(rows.map((row) => row.file?.importedAt)), meta: "fichero REE" }
  ];
}

function summarizeLiquidationAnalysisRows(rows: LiquidationAnalysisRow[]) {
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

function reganecuQuality(row: A1Record): RowQuality {
  const labels = [
    !row.importeConsistente ? "Importe/precio incoherente" : "",
    row.precioAnomalo ? "Precio fuera de rango" : "",
    !row.fecha && !row.rawPayloadJson?.fecha ? "Fecha vacía" : "",
    row.energiaMwh === null || row.energiaMwh === undefined ? "Energía vacía" : "",
    row.importeEur === null || row.importeEur === undefined ? "Importe vacío" : ""
  ].filter(Boolean);
  return { tone: labels.length > 0 ? (row.precioAnomalo ? "danger" : "warning") : "ok", labels };
}

function sumNumeric(values: Array<string | number | null | undefined>): number {
  return values.reduce<number>((sum, value) => sum + (normalizeNumericValue(value) ?? 0), 0);
}

function meanNumeric(values: Array<string | number | null | undefined>): number | null {
  const present = values.map(normalizeNumericValue).filter((value): value is number => value !== undefined);
  return present.length === 0 ? null : present.reduce<number>((sum, value) => sum + value, 0) / present.length;
}

function dominantValue(values: Array<string | null | undefined>) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value?.trim();
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function latestUpdate(values: Array<string | null | undefined>) {
  const latest = values
    .map((value) => parseDateTimeValue(value)?.getTime())
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => right - left)[0];
  return latest === undefined ? "-" : formatDateTime(new Date(latest).toISOString());
}

function TechnicalDataTableV2<T extends object>({
  title,
  rows,
  columns,
  kpis,
  page,
  pageSize,
  hasNext,
  loading,
  onPageChange,
  onPageSizeChange,
  getRowId,
  getRowQuality,
  getGroupLabel,
  getDuplicateKey,
  exportFileName,
  loadExportRows,
  showHeaderTitle = true,
  showQuality = true,
  showPagination = true,
  showModeSelector = true
}: {
  title: string;
  rows: T[];
  columns: Array<TechnicalColumn<T>>;
  kpis: TechnicalKpi[];
  page: number;
  pageSize: number;
  hasNext: boolean;
  loading: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  getRowId: (row: T) => string;
  getRowQuality: (row: T) => RowQuality;
  getGroupLabel: (row: T) => string;
  getDuplicateKey: (row: T) => string;
  exportFileName: string;
  loadExportRows?: () => Promise<T[]>;
  showHeaderTitle?: boolean;
  showQuality?: boolean;
  showPagination?: boolean;
  showModeSelector?: boolean;
}) {
  const fixedMode: TechnicalDataMode = showModeSelector ? "basic" : "advanced";
  const [mode, setMode] = useState<TechnicalDataMode>(fixedMode);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ id: string; direction: TechnicalSortDirection }>();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => buildTechnicalPresetHiddenColumns(columns, fixedMode));
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const columnsMenuRef = useRef<HTMLDivElement | null>(null);
  const columnsSignatureRef = useRef("");
  const rowHeight = 42;
  const viewportHeight = 560;
  const columnsSignature = useMemo(() => buildTechnicalColumnsSignature(columns), [columns]);
  const adapterColumns = useMemo<Array<TechnicalDataTableAdapterColumn<T>>>(
    () =>
      columns.map((column) => ({
        id: column.id,
        label: column.label,
        help: column.help,
        width: column.width,
        align: column.align,
        type: column.type,
        sticky: column.sticky,
        visibility: column.visibility,
        advanced: technicalColumnVisibility(column) === "advanced",
        heatmap: column.heatmap,
        heatmapTone: column.heatmapTone,
        numericTone: column.numericTone,
        filter: column.filter,
        defaultHidden: Boolean(column.defaultHidden),
        expectedEmpty: column.expectedEmpty,
        value: column.value,
        render: column.render,
        exportValue: column.exportValue
      })),
    [columns]
  );
  const adapter = useMemo(
    () =>
      createTechnicalDataTableAdapter({
        rows,
        columns: adapterColumns,
        state: {
          mode,
          search,
          filters,
          sort: sort ? { columnId: sort.id, direction: sort.direction } : undefined,
          hiddenColumns: [...hiddenColumns]
        },
        showModeSelector
      }),
    [adapterColumns, filters, hiddenColumns, mode, rows, search, showModeSelector, sort]
  );
  const activeColumnIds = useMemo(() => new Set(adapter.activeColumns.map((column) => column.id)), [adapter.activeColumns]);
  const activeColumns = useMemo(() => columns.filter((column) => activeColumnIds.has(column.id)), [activeColumnIds, columns]);
  const gridTemplateColumns = activeColumns.map((column) => `${column.width}px`).join(" ");
  const stickyOffsets = useMemo(() => {
    let left = 0;
    const offsets = new Map<string, number>();
    for (const column of activeColumns) {
      if (column.sticky) {
        offsets.set(column.id, left);
        left += column.width;
      }
    }
    return offsets;
  }, [activeColumns]);
  const selectOptions = adapter.filterOptions;
  const maxByNumericColumn = useMemo(() => {
    const maxValues = new Map<string, number>();
    for (const column of activeColumns) {
      if (column.type !== "number") {
        continue;
      }
      const max = Math.max(...rows.map((row) => Math.abs(normalizeNumericValue(column.value(row)) ?? 0)), 0);
      maxValues.set(column.id, max);
    }
    return maxValues;
  }, [activeColumns, rows]);
  const duplicateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = getDuplicateKey(row);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [getDuplicateKey, rows]);
  const visibleRows = adapter.sortedRows;
  const totalsRow = undefined;
  const entries = useMemo(() => {
    const nextEntries: Array<TechnicalEntry<T>> = [];
    let previousGroup = "";
    for (const row of visibleRows) {
      const group = getGroupLabel(row);
      if (group && group !== previousGroup) {
        nextEntries.push({ type: "group", key: `group-${group}-${nextEntries.length}`, label: group });
        previousGroup = group;
      }
      nextEntries.push({ type: "row", key: getRowId(row), row });
    }
    return nextEntries;
  }, [getGroupLabel, getRowId, visibleRows]);
  const start = Math.max(Math.floor(scrollTop / rowHeight) - 6, 0);
  const visible = Math.ceil(viewportHeight / rowHeight) + 12;
  const visibleEntries = entries.slice(start, start + visible);
  const topSpacer = start * rowHeight;
  const bottomSpacer = Math.max((entries.length - start - visibleEntries.length) * rowHeight, 0);
  const from = rows.length === 0 ? 0 : page * pageSize + 1;
  const to = page * pageSize + rows.length;
  const pageTotalLabel = hasNext ? `más de ${formatNumber(to)}` : formatNumber(to);
  const quality = buildTechnicalQuality(rows, activeColumns, getRowQuality, duplicateCounts);

  function updateSort(column: TechnicalColumn<T>) {
    setSort((current) => {
      if (current?.id !== column.id) {
        return { id: column.id, direction: "asc" };
      }
      if (current.direction === "asc") {
        return { id: column.id, direction: "desc" };
      }
      return undefined;
    });
  }

  function updateFilter(key: string, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setScrollTop(0);
  }

  function toggleColumn(columnId: string) {
    setHiddenColumns((current) => {
      const next = new Set(current);
      if (next.has(columnId)) {
        next.delete(columnId);
      } else if (activeColumns.length > 1) {
        next.add(columnId);
      }
      return next;
    });
  }

  function applyModePreset(nextMode: TechnicalDataMode) {
    setMode(nextMode);
    setHiddenColumns(buildTechnicalPresetHiddenColumns(columns, nextMode));
    setScrollTop(0);
  }

  useEffect(() => {
    if (!columnsSignatureRef.current) {
      columnsSignatureRef.current = columnsSignature;
      return;
    }

    if (columnsSignatureRef.current !== columnsSignature) {
      columnsSignatureRef.current = columnsSignature;
      setHiddenColumns(buildTechnicalPresetHiddenColumns(columns, showModeSelector ? mode : "advanced"));
      return;
    }

    setHiddenColumns((current) => {
      const available = new Set(columns.map((column) => column.id));
      const next = new Set([...current].filter((columnId) => available.has(columnId)));
      return next.size === current.size ? current : next;
    });
  }, [columns, columnsSignature, mode, showModeSelector]);

  useEffect(() => {
    if (!columnsOpen) {
      return undefined;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!columnsMenuRef.current?.contains(event.target as Node)) {
        setColumnsOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [columnsOpen]);

  const exportRows = visibleRows;

  async function exportTechnicalDataset(format: "csv" | "xls") {
    const sourceRows = loadExportRows ? await loadExportRows() : rows;
    const sourceAdapter = createTechnicalDataTableAdapter({
      rows: sourceRows,
      columns: adapterColumns,
      state: {
        mode,
        search,
        filters,
        sort: sort ? { columnId: sort.id, direction: sort.direction } : undefined,
        hiddenColumns: [...hiddenColumns]
      },
      showModeSelector
    });
    const rowsToExport = sourceAdapter.sortedRows;
    exportTechnicalRows(`${exportFileName}.${format}`, activeColumns, rowsToExport, format, totalsRow);
  }

  return (
    <section className="panel wide technical-data-panel">
      <div className={`technical-data-head ${showHeaderTitle ? "" : "no-title"}`}>
        {showHeaderTitle && <PanelTitle icon={<FileSpreadsheet size={18} />} title={title} />}
        <div className="technical-toolbar" role="toolbar" aria-label={showHeaderTitle ? `Acciones de ${title}` : "Acciones de tabla"}>
          <label className="technical-search">
            <Search size={15} />
            <input
              aria-label="Buscar en tabla"
              disabled={loading}
              onChange={(event) => {
                setSearch(event.target.value);
                setScrollTop(0);
              }}
              placeholder="Buscar..."
              value={search}
            />
          </label>
          {showModeSelector && (
            <div className="technical-mode" aria-label="Modo de visualización" role="group">
              <button className={mode === "basic" ? "active" : ""} disabled={loading} onClick={() => applyModePreset("basic")} type="button">
                B?sica
              </button>
              <button className={mode === "advanced" ? "active" : ""} disabled={loading} onClick={() => applyModePreset("advanced")} type="button">
                Avanzada
              </button>
            </div>
          )}
          <div className="column-menu" ref={columnsMenuRef}>
            <button className="secondary-button" disabled={loading} onClick={() => setColumnsOpen((current) => !current)} type="button">
              <ChevronDown size={16} />
              Columnas
            </button>
            {columnsOpen && (
              <div className="column-menu-popover">
                {columns.map((column) => {
                  const hidden = hiddenColumns.has(column.id);
                  const disabledColumn = !hidden && activeColumns.length <= 1;
                  return (
                    <label className="column-menu-option" key={column.id}>
                      <input checked={!hidden} disabled={disabledColumn} onChange={() => toggleColumn(column.id)} type="checkbox" />
                      <span>{column.label}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <button className="secondary-button" disabled={loading} onClick={() => void exportTechnicalDataset("csv")} type="button">
            <Download size={16} />
            CSV
          </button>
          <button className="secondary-button" disabled={loading} onClick={() => void exportTechnicalDataset("xls")} type="button">
            <FileDown size={16} />
            Excel
          </button>
          <button className="secondary-button" disabled={loading} onClick={() => copyTechnicalRows(activeColumns, exportRows, totalsRow)} type="button">
            <Clipboard size={16} />
            Copiar
          </button>
        </div>
      </div>

      {kpis.length > 0 && (
        <div className="technical-kpis">
          {kpis.map((kpi) => (
            <div className={`technical-kpi ${kpi.tone ?? "neutral"}`} key={kpi.label}>
              <span>{kpi.label}</span>
              <strong>{kpi.value}</strong>
              {kpi.meta && <small>{kpi.meta}</small>}
            </div>
          ))}
        </div>
      )}

      {showQuality && (
        <div className="quality-strip" aria-label="Calidad de datos">
          <span className={quality.completeness >= 98 ? "good" : quality.completeness >= 90 ? "warning" : "danger"}>
            Datos completos: {formatCompleteness(quality.completeness)}
          </span>
          <span className={quality.anomalies > 0 ? "warning" : "good"}>{formatNumber(quality.anomalies)} registros anómalos</span>
          <span className={quality.duplicates > 0 ? "warning" : "good"}>{formatNumber(quality.duplicates)} duplicados en página</span>
          <span className={quality.nulls > 0 ? "warning" : "good"}>{formatNumber(quality.nulls)} valores vacíos</span>
        </div>
      )}

      {showPagination && (
        <div className="technical-pagination">
          <span>
            Mostrando {formatNumber(from)}-{formatNumber(to)} de {pageTotalLabel} registros
            {visibleRows.length !== rows.length ? ` · ${formatNumber(visibleRows.length)} visibles con filtros` : ""}
          </span>
          <label>
            Filas
            <select disabled={loading} value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <button className="pagination-button" disabled={loading || page === 0} onClick={() => onPageChange(page - 1)} title="Página anterior" type="button">
            <ChevronLeft size={16} />
          </button>
          <button className="pagination-button" disabled={loading || !hasNext} onClick={() => onPageChange(page + 1)} title="Página siguiente" type="button">
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      <div className="technical-table-shell">
        <div className={`technical-table ${totalsRow ? "has-total-row" : ""}`} style={{ minWidth: activeColumns.reduce((sum, column) => sum + column.width, 0) }}>
          {totalsRow && (
            <div className="technical-grid technical-total-row" style={{ gridTemplateColumns }}>
              {activeColumns.map((column) => (
                <div className={technicalCellClass(column, "total")} key={column.id} style={stickyCellStyle(column, stickyOffsets)} title={stringifyCellValue(totalsRow[column.id] as string | number | null | undefined)}>
                  {totalsRow[column.id] ?? ""}
                </div>
              ))}
            </div>
          )}
          <div className="technical-grid technical-header-row" style={{ gridTemplateColumns }}>
            {activeColumns.map((column) => (
              <div className={technicalCellClass(column, "header")} key={column.id} style={stickyCellStyle(column, stickyOffsets)}>
                <button disabled={loading} onClick={() => updateSort(column)} title={column.help ?? `Ordenar por ${column.label}`} type="button">
                  {column.label}
                  {column.help && <span className="column-help">?</span>}
                  {sort?.id === column.id && <small>{sort.direction === "asc" ? "?" : "?"}</small>}
                </button>
              </div>
            ))}
          </div>
          <div className="technical-grid technical-filter-row" style={{ gridTemplateColumns }}>
            {activeColumns.map((column) => (
              <div className={technicalCellClass(column, "filter")} key={column.id} style={stickyCellStyle(column, stickyOffsets)}>
                {column.filter === "number" ? (
                  <div className="range-filter">
                    <input aria-label={`${column.label} mínimo`} disabled={loading} onChange={(event) => updateFilter(`${column.id}:min`, event.target.value)} placeholder="Min" value={filters[`${column.id}:min`] ?? ""} />
                    <input aria-label={`${column.label} máximo`} disabled={loading} onChange={(event) => updateFilter(`${column.id}:max`, event.target.value)} placeholder="Max" value={filters[`${column.id}:max`] ?? ""} />
                  </div>
                ) : column.filter === "select" ? (
                  <select aria-label={`Filtrar ${column.label}`} disabled={loading} onChange={(event) => updateFilter(column.id, event.target.value)} value={filters[column.id] ?? ""}>
                    <option value="">Todos</option>
                    {(selectOptions[column.id] ?? []).map((option) => (
                      <option key={String(option.value)} value={String(option.value)}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input aria-label={`Filtrar ${column.label}`} disabled={loading} onChange={(event) => updateFilter(column.id, event.target.value)} placeholder="Filtrar" value={filters[column.id] ?? ""} />
                )}
              </div>
            ))}
          </div>
          <div className="technical-virtual-body" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} style={{ height: viewportHeight }}>
            <div style={{ height: topSpacer }} />
            {visibleEntries.map((entry) =>
              entry.type === "group" ? (
                <div className="technical-group-row" key={entry.key} style={{ height: rowHeight }}>
                  {entry.label}
                </div>
              ) : (
                <TechnicalDataRow
                  columns={activeColumns}
                  duplicate={Boolean((duplicateCounts.get(getDuplicateKey(entry.row)) ?? 0) > 1)}
                  gridTemplateColumns={gridTemplateColumns}
                  maxByNumericColumn={maxByNumericColumn}
                  quality={getRowQuality(entry.row)}
                  row={entry.row}
                  stickyOffsets={stickyOffsets}
                  key={entry.key}
                />
              )
            )}
            <div style={{ height: bottomSpacer }} />
            {rows.length === 0 && <div className="empty-state">Sin registros.</div>}
            {rows.length > 0 && visibleRows.length === 0 && <div className="empty-state">Sin coincidencias con los filtros actuales.</div>}
            {loading && <InlineLoading label="Actualizando tabla" />}
          </div>
        </div>
      </div>
    </section>
  );
}

function TableHead({
  title,
  page,
  pageSize,
  rows,
  hasNext,
  loading,
  onPageChange,
  onExport
}: {
  title: string;
  page: number;
  pageSize: number;
  rows: number;
  hasNext: boolean;
  loading: boolean;
  onPageChange: (page: number) => void;
  onExport: () => void;
}) {
  return (
    <div className="panel-head">
      <PanelTitle icon={<FileSpreadsheet size={18} />} title={title} />
      <div className="panel-actions">
        <div className="pagination-controls">
          <button className="pagination-button" disabled={loading || page === 0} onClick={() => onPageChange(page - 1)} title="Pagina anterior" type="button">
            <ChevronLeft size={16} />
          </button>
          <span>
            Pagina {formatNumber(page + 1)} € {formatNumber(rows)}/{formatNumber(pageSize)}
          </span>
          <button className="pagination-button" disabled={loading || !hasNext} onClick={() => onPageChange(page + 1)} title="Pagina siguiente" type="button">
            <ChevronRight size={16} />
          </button>
        </div>
        <button className="secondary-button" onClick={onExport} type="button">
          <Download size={16} />
          CSV
        </button>
      </div>
    </div>
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

function formatMonthKeyLabel(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) {
    return value;
  }

  return `${match[2]}/${match[1]}`;
}

function formatRatioPercent(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : `${formatFixedDecimalNumber(numeric * 100, 2)}%`;
}

function ratioPercentValue(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? undefined : numeric * 100;
}

function formatEnergy(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : formatFixedDecimalNumber(numeric, 2);
}

function formatSignedEnergy(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  if (numeric === undefined) {
    return "-";
  }
  return `${numeric > 0 ? "+" : ""}${formatFixedDecimalNumber(numeric, 2)}`;
}

function formatEuroAmount(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : `${formatFixedDecimalNumber(numeric, 2)} €`;
}

function formatPrice(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : `${formatFixedDecimalNumber(numeric, 2)} €/MWh`;
}

function formatOmiePrice(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : formatFixedDecimalNumber(numeric, 2);
}

function formatOmieEnergy(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : formatFixedDecimalNumber(numeric, 3);
}

function formatOmieProfit(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : `${formatFixedDecimalNumber(numeric, 3)} €`;
}

function formatOmieProfitRate(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : `${formatFixedDecimalNumber(numeric, 3)} €/MWh`;
}

function formatOmieProfitRateValue(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : formatFixedDecimalNumber(numeric, 3);
}

function percentile(sortedValues: number[], rank: number) {
  if (sortedValues.length === 0) {
    return 0;
  }
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }

  const index = (sortedValues.length - 1) * rank;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sortedValues[lower];
  }

  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function formatDecimalNumber(value: number, decimals = 3) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const fixed = absolute.toFixed(decimals);
  const [integerPart, decimalPart = ""] = fixed.split(".");
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const trimmedDecimals = decimalPart.replace(/0+$/, "");
  return trimmedDecimals ? `${sign}${groupedInteger},${trimmedDecimals}` : `${sign}${groupedInteger}`;
}

function formatFixedDecimalNumber(value: number, decimals = 2) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const fixed = absolute.toFixed(decimals);
  const [integerPart, decimalPart = ""] = fixed.split(".");
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimals > 0 ? `${sign}${groupedInteger},${decimalPart}` : `${sign}${groupedInteger}`;
}

function SummaryView({ groups }: { groups: SettlementGroup[] }) {
  const latestVersion = getLatestSettlementVersion(groups);
  return (
    <section className="content-grid">
      <div className="panel wide">
        <PanelTitle
          icon={<Gauge size={18} />}
          title="Costes horarios clave"
          subtitle={latestVersion ? `${latestVersion} € ${describeSettlementVersion(latestVersion)}` : "Sin versión disponible"}
        />
        <KeyCostSegments groups={groups} version={latestVersion} />
      </div>
      <div className="panel wide">
        <PanelTitle icon={<BarChart3 size={18} />} title="Energia e importe por version" />
        <EnergyChart groups={groups} />
      </div>
      <div className="panel wide">
        <PanelTitle icon={<BarChart3 size={18} />} title="Segmentos clave por version" />
        <SegmentSummaryTable groups={groups} />
      </div>
    </section>
  );
}

function KeyCostSegments({ groups, version }: { groups: SettlementGroup[]; version: ReeVersion | null }) {
  const versionGroups = version ? groups.filter((group) => group.version === version) : [];
  const rows = SUMMARY_SEGMENTS.map((segment) => ({
    ...segment,
    totals: summarizeGroups(versionGroups.filter((group) => normalizeSegment(group.segmento) === segment.code))
  }));

  return (
    <div className="key-cost-grid">
      {rows.map((row) => (
        <div className="key-cost-item" key={row.code}>
          <span className="key-cost-code">{row.code}</span>
          <span>{row.label}</span>
          <strong>{formatCurrency(row.totals.amount)}</strong>
          <small>{formatNumber(row.totals.records)} registros ? {formatNumber(row.totals.energy)} MWh</small>
        </div>
      ))}
    </div>
  );
}

function getLatestSettlementVersion(groups: SettlementGroup[]) {
  const availableVersions = new Set(groups.map((group) => group.version));
  return [...VERSIONS].reverse().find((version) => availableVersions.has(version)) ?? null;
}

function describeSettlementVersion(version: ReeVersion) {
  return version === "C5" ? "Versión definitiva" : "Versión provisional";
}

function DetailView({
  rows,
  title,
  timeColumnLabel,
  showRelatedHour = false,
  page,
  pageSize,
  hasNext,
  loading,
  onPageChange,
  onPageSizeChange,
  loadExportRows
}: {
  rows: A1Record[];
  title: string;
  timeColumnLabel: string;
  showRelatedHour?: boolean;
  page: number;
  pageSize: number;
  hasNext: boolean;
  loading: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  loadExportRows?: () => Promise<A1Record[]>;
}) {
  const columns = useMemo<Array<TechnicalColumn<A1Record>>>(() => {
    const codeLabel = showRelatedHour ? "EIC UPR" : "EIC UPR";
    return [
      { id: "fecha", label: "Fecha", width: 118, sticky: true, type: "date", filter: "text", value: (row) => row.fecha ?? row.rawPayloadJson?.fecha ?? "", render: (row) => formatRecordDate(row) },
      { id: "periodo", label: timeColumnLabel, help: showRelatedHour ? "Cuarto horario de la liquidación." : "Hora de la liquidación.", width: 90, sticky: true, align: "right", type: "number", filter: "number", value: (row) => recordQuarterHour(row) },
      ...(showRelatedHour
        ? [{ id: "horaRelacionada", label: "Hora", help: "Hora agregada a la que pertenece el QH.", width: 78, sticky: true, align: "right" as const, type: "number" as const, filter: "number" as const, value: (row: A1Record) => formatRelatedHour(row) }]
        : []),
      { id: "codigo", label: codeLabel, width: 154, sticky: true, filter: "text", value: (row) => row.eicUpr ?? row.codigoUpr },
      { id: "energia", label: "Energía", help: "Energía liquidada en MWh.", width: 128, align: "right", type: "number", filter: "number", value: (row) => row.energiaMwh },
      { id: "importe", label: "Importe", help: "Importe liquidado en euros.", width: 128, align: "right", type: "number", filter: "number", value: (row) => row.importeEur, render: (row) => formatCurrency(Number(row.importeEur ?? 0)) },
      { id: "diferencia", label: "Dif.", help: "Diferencia entre importe informado e importe calculado.", width: 110, align: "right", type: "number", filter: "number", value: (row) => row.importeDiferenciaEur },
      { id: "version", label: "Versión", width: 86, advanced: true, filter: "select", value: (row) => row.version },
      { id: "segmento", label: "Segmento", width: 110, filter: "select", value: (row) => row.segmento },
      { id: "codigoPrecio", label: "Cod. precio", help: "Código de precio REE aplicado al apunte.", width: 132, advanced: true, filter: "select", value: (row) => row.codigoPrecio },
      { id: "codigoApunte", label: "Cod. apunte", help: "Código técnico del apunte liquidado.", width: 136, advanced: true, filter: "select", value: (row) => row.codigoApunte },
      { id: "precio", label: "Precio", width: 126, advanced: true, align: "right", type: "number", filter: "number", value: (row) => row.precioEurMwh },
      { id: "brp", label: "BRP", width: 120, advanced: true, filter: "text", value: (row) => row.brp ?? row.codigoAgenteVendedor },
      { id: "linea", label: "Línea", width: 86, advanced: true, align: "right", type: "number", filter: "number", value: (row) => row.sourceLineNumber }
    ];
  }, [showRelatedHour, timeColumnLabel]);

  return (
    <TechnicalDataTableV2
      columns={columns}
      exportFileName={showRelatedHour ? "reganecuqh-filtrado" : "reganecu-filtrado"}
      getDuplicateKey={(row) => [formatRecordDate(row), formatRecordHour(row), row.eicUpr ?? row.codigoUpr ?? "", row.codigoPrecio ?? "", row.codigoApunte ?? ""].join("|")}
      getGroupLabel={(row) => `Fecha ${formatRecordDate(row)} € ${showRelatedHour ? `Hora ${formatRelatedHour(row)}` : `Hora ${formatRecordHour(row)}`}`}
      getRowId={(row) => row.id}
      getRowQuality={reganecuQuality}
      hasNext={hasNext}
      kpis={buildReganecuKpis(rows)}
      loading={loading}
      loadExportRows={loadExportRows}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      page={page}
      pageSize={pageSize}
      rows={rows}
      title={title}
    />
  );
}

function VirtualGrid({
  rows,
  timeColumnLabel,
  showRelatedHour
}: {
  rows: A1Record[];
  timeColumnLabel: string;
  showRelatedHour: boolean;
}) {
  const rowHeight = 42;
  const height = 520;
  const [scrollTop, setScrollTop] = useState(0);
  const start = Math.max(Math.floor(scrollTop / rowHeight) - 4, 0);
  const visible = Math.ceil(height / rowHeight) + 8;
  const slice = rows.slice(start, start + visible);
  const bottom = Math.max((rows.length - start - slice.length) * rowHeight, 0);

  return (
    <div className={`virtual-grid ${showRelatedHour ? "with-related-hour" : ""}`}>
      <div className="grid-header">
        <span>Fecha</span>
        <span>{timeColumnLabel}</span>
        {showRelatedHour && <span>Hora</span>}
        <span>Version</span>
        <span>Segmento</span>
        <span>Cod. precio</span>
        <span>Cod. apunte</span>
        <span>EIC UPR</span>
        <span>Energia</span>
        <span>Precio</span>
        <span>MWh</span>
        <span>Importe</span>
      </div>
      <div className="grid-body" style={{ height }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <div style={{ height: start * rowHeight }} />
        {slice.map((row) => (
          <div className={`grid-row ${row.importeConsistente && !row.precioAnomalo ? "" : "warning"}`} key={row.id}>
            <span>{formatRecordDate(row)}</span>
            <span>{formatRecordHour(row)}</span>
            {showRelatedHour && <span>{formatRelatedHour(row)}</span>}
            <span>{row.version}</span>
            <span>{row.segmento ?? "-"}</span>
            <span>{row.codigoPrecio ?? "-"}</span>
            <span>{row.codigoApunte ?? "-"}</span>
            <span>{row.eicUpr ?? row.codigoUpr ?? "-"}</span>
            <span>{formatNumber(Number(row.energiaMwh ?? 0))}</span>
            <span>{formatNumber(Number(row.precioEurMwh ?? 0))}</span>
            <span>{formatNumber(Number(row.importeDiferenciaEur ?? 0))}</span>
            <span>{formatCurrency(Number(row.importeEur ?? 0))}</span>
          </div>
        ))}
        <div style={{ height: bottom }} />
        {rows.length === 0 && <div className="empty-state">Sin registros.</div>}
      </div>
    </div>
  );
}

function EnergyChart({ groups }: { groups: SettlementGroup[] }) {
  const byVersion = VERSIONS.map((version) => {
    const versionGroups = groups.filter((group) => group.version === version);
    return {
      version,
      energy: versionGroups.reduce((sum, group) => sum + Number(group.sums.energiaMwh ?? 0), 0),
      amount: -versionGroups.reduce((sum, group) => sum + Number(group.sums.importeEur ?? 0), 0)
    };
  });
  const max = Math.max(...byVersion.map((item) => Math.abs(item.amount)), 1);

  return (
    <div className="chart">
      {byVersion.map((item) => (
        <div className="chart-row" key={item.version}>
          <strong>{item.version}</strong>
          <div className="chart-track">
            <span style={{ width: `${Math.min((Math.abs(item.amount) / max) * 100, 100)}%` }} />
          </div>
          <small>{formatCurrency(item.amount)} € {formatNumber(item.energy)} MWh</small>
        </div>
      ))}
    </div>
  );
}

function SegmentSummaryTable({ groups }: { groups: SettlementGroup[] }) {
  const rows = VERSIONS.map((version) => {
    const versionGroups = groups.filter((group) => group.version === version);
    return {
      version,
      segments: SUMMARY_SEGMENTS.map((segment) => ({
        ...segment,
        totals: summarizeGroups(versionGroups.filter((group) => normalizeSegment(group.segmento) === segment.code))
      })),
      total: summarizeGroups(versionGroups)
    };
  });

  return (
    <div className="segment-summary-scroll">
      <table className="segment-summary-table">
        <thead>
          <tr>
            <th>Version</th>
            {SUMMARY_SEGMENTS.map((segment) => (
              <th key={segment.code}>
                <span>{segment.label}</span>
                <small>{segment.code}</small>
              </th>
            ))}
            <th>
              <span>Total segmentos</span>
              <small>TOTAL</small>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.version}>
              <th scope="row">{row.version}</th>
              {row.segments.map((segment) => (
                <td key={segment.code}>
                  <strong>{formatCurrency(segment.totals.amount)}</strong>
                  <small>{segment.totals.records} registros</small>
                </td>
              ))}
              <td>
                <strong>{formatCurrency(row.total.amount)}</strong>
                <small>{row.total.records} registros</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

function summarizeGroups(groups: SettlementGroup[]) {
  return groups.reduce(
    (total, group) => ({
      records: total.records + group.records,
      energy: total.energy + Number(group.sums.energiaMwh ?? 0),
      amount: total.amount + Number(group.sums.importeEur ?? 0)
    }),
    { records: 0, energy: 0, amount: 0 }
  );
}

function normalizeSegment(value?: string | null) {
  return value?.trim().toUpperCase() ?? "";
}

function esiosViewFromSection(section: Section): EsiosViewKey {
  if (section === "esiosIndicadores") {
    return "indicadores";
  }
  if (section === "esiosPerfiles") {
    return "perfiles";
  }
  if (section === "esiosSeries") {
    return "series";
  }
  if (section === "esiosDescargas") {
    return "descargas";
  }
  return "configuracion";
}

function summarizeUploadFeedback(
  responses: UploadResponse[],
  importedRecords: number,
  duplicatedFiles: number,
  invalidRecords: number,
  failedFiles: number
) {
  const importedFiles = responses.reduce((sum, response) => sum + response.summary.importedFiles, 0);
  const errors = responses
    .flatMap((response) => response.results)
    .flatMap((result) =>
      result.errors.map((error) => `${error.sourceFileName}:${error.lineNumber} ${error.message}`)
    )
    .slice(0, 3);

  const details = [
    `${importedRecords} registros importados`,
    `${importedFiles} ficheros importados`,
    `${duplicatedFiles} duplicados`,
    `${failedFiles} fallidos`,
    `${invalidRecords} incidencias`
  ];

  return errors.length > 0 ? `${details.join(". ")}. Primer error: ${errors.join(" | ")}` : `${details.join(". ")}.`;
}

function formatUploadConflictConfirmation(conflicts: UploadConflict[]) {
  if (conflicts.length === 1) {
    const conflict = conflicts[0];
    return `Ya existe una carga para ${conflict.tipoArchivo} con fecha ${formatDate(conflict.fecha)} y versión ${conflict.version}.\n¿Deseas sobreescribirla?`;
  }

  const details = conflicts
    .slice(0, 8)
    .map((conflict) => `- ${conflict.tipoArchivo} ${formatDate(conflict.fecha)} ${conflict.version}`)
    .join("\n");
  const remaining = conflicts.length > 8 ? `\n... y ${conflicts.length - 8} más` : "";
  return `Ya existen cargas previas para estos ficheros:\n${details}${remaining}\n¿Deseas sobreescribirlas?`;
}

function isLikelyReeLossesFileName(file: File) {
  return /k(?:estim|real)qh/i.test(file.name);
}

function dedupeFiles(files: File[]) {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = `${file.name}-${file.size}-${file.lastModified}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function formatRecordDate(row: A1Record) {
  return formatDate(row.fecha ?? row.rawPayloadJson?.fecha);
}

function sortHourlyRecords(rows: A1Record[]) {
  return [...rows].sort((left, right) => {
    return (
      compareNumbers(recordDateTime(left), recordDateTime(right)) ||
      compareNumbers(recordTimeValue(left), recordTimeValue(right)) ||
      compareRecordTieBreakers(left, right)
    );
  });
}

function sortQuarterHourlyRecords(rows: A1Record[]) {
  return [...rows].sort((left, right) => {
    return (
      compareNumbers(recordDateTime(left), recordDateTime(right)) ||
      compareNumbers(recordRelatedHourValue(left), recordRelatedHourValue(right)) ||
      compareNumbers(recordQuarterHourValue(left), recordQuarterHourValue(right)) ||
      compareRecordTieBreakers(left, right)
    );
  });
}

function formatRecordHour(row: A1Record) {
  return recordQuarterHour(row) ?? "-";
}

function formatRelatedHour(row: A1Record) {
  const quarterHour = recordQuarterHour(row);
  return quarterHour === undefined ? "-" : Math.floor((quarterHour - 1) / 4) + 1;
}

function recordQuarterHour(row: A1Record) {
  return row.hora ?? parseIntegerText(row.rawPayloadJson?.hora) ?? quarterHourFromDateText(row.rawPayloadJson?.fecha);
}

function recordDateTime(row: A1Record) {
  return parseDateText(row.fecha ?? row.rawPayloadJson?.fecha)?.date.getTime() ?? Number.MAX_SAFE_INTEGER;
}

function recordTimeValue(row: A1Record) {
  return recordQuarterHour(row) ?? Number.MAX_SAFE_INTEGER;
}

function recordRelatedHourValue(row: A1Record) {
  const quarterHour = recordQuarterHour(row);
  return quarterHour === undefined ? Number.MAX_SAFE_INTEGER : Math.floor((quarterHour - 1) / 4) + 1;
}

function recordQuarterHourValue(row: A1Record) {
  return recordQuarterHour(row) ?? Number.MAX_SAFE_INTEGER;
}

function compareNumbers(left: number, right: number) {
  return left - right;
}

function compareRecordTieBreakers(left: A1Record, right: A1Record) {
  return (
    left.version.localeCompare(right.version) ||
    (left.segmento ?? "").localeCompare(right.segmento ?? "") ||
    (left.codigoPrecio ?? "").localeCompare(right.codigoPrecio ?? "") ||
    (left.codigoApunte ?? "").localeCompare(right.codigoApunte ?? "") ||
    (left.eicUpr ?? left.codigoUpr ?? "").localeCompare(right.eicUpr ?? right.codigoUpr ?? "") ||
    left.id.localeCompare(right.id)
  );
}

function formatDate(value?: string | null) {
  const parsed = parseDateText(value);
  return parsed ? new Intl.DateTimeFormat("es-ES").format(parsed.date) : "-";
}

function formatFullDate(value?: string | null) {
  const parsed = parseDateText(value);
  if (!parsed) {
    return "-";
  }

  return `${pad2(parsed.date.getUTCDate())}/${pad2(parsed.date.getUTCMonth() + 1)}/${parsed.date.getUTCFullYear()}`;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatDateTime(value?: string | null) {
  const date = parseDateTimeValue(value);
  return date
    ? new Intl.DateTimeFormat("es-ES", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC"
      }).format(date)
    : "-";
}

function formatIsoDate(value?: string | null) {
  return parseDateTimeValue(value)?.toISOString().slice(0, 10) ?? "-";
}

function parseDateTimeValue(value?: string | null) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  const nativeDate = new Date(trimmed);
  if (!Number.isNaN(nativeDate.getTime())) {
    return nativeDate;
  }

  const parsed = parseDateText(trimmed);
  if (!parsed) {
    return undefined;
  }

  const date = new Date(parsed.date);
  if (parsed.hour !== undefined && parsed.minute !== undefined) {
    date.setUTCHours(parsed.hour, parsed.minute, 0, 0);
  }
  return date;
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

function parseIntegerText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed && /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

function quarterHourFromDateText(value?: string | null) {
  const parsed = parseDateText(value);
  if (parsed?.hour === undefined || parsed.minute === undefined || parsed.minute % 15 !== 0) {
    return undefined;
  }

  return parsed.hour * 4 + parsed.minute / 15 + 1;
}

function formatNumber(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  if (numeric === undefined) {
    return "-";
  }

  const sign = numeric < 0 ? "-" : "";
  const absolute = Math.abs(numeric);
  const fixed = absolute.toFixed(3);
  const [integerPart, decimalPart = ""] = fixed.split(".");
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const trimmedDecimals = decimalPart.replace(/0+$/, "");
  return trimmedDecimals ? `${sign}${groupedInteger},${trimmedDecimals}` : `${sign}${groupedInteger}`;
}

function formatPercentOf(part: number, total: number) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total === 0) {
    return "-";
  }

  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format((part / total) * 100) + "%";
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value || 0);
}

function normalizeNumericValue(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed.replace(/\s+/g, "");
  const hasComma = normalized.includes(",");
  const hasDot = normalized.includes(".");

  if (hasComma && hasDot) {
    const lastComma = normalized.lastIndexOf(",");
    const lastDot = normalized.lastIndexOf(".");
    const parsed =
      lastComma > lastDot
        ? Number(normalized.replace(/\./g, "").replace(",", "."))
        : Number(normalized.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  if (hasComma) {
    const parsed = Number(normalized.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}
