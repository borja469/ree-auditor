import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";
import { Calculator, ChevronDown, ChevronRight, Download, Eye, FileSpreadsheet, FileText, Info, MoreHorizontal, Play, PlugZap, Plus, RefreshCw, Save, Search, Trash2, X } from "lucide-react";
import {
  calculateBillingInvoiceCostsAndMargin,
  cancelBillingJob,
  createBillingRegulatedPriceVersion,
  deleteBillingInvoice,
  deleteBillingInvoicesByInvoiceDate,
  deleteBillingRegulatedPriceVersion,
  downloadBillingInvoicesExport,
  downloadBillingInvoiceCostRunAudit,
  getBillingGisceConfig,
  getBillingInvoiceCosts,
  getBillingInvoiceDetail,
  getBillingInvoices,
  getBillingInvoicingModes,
  getBillingJobs,
  getBillingOperationalBalance,
  getBillingRegulatedPriceVersions,
  getBillingTariffs,
  processBillingInvoice,
  recalculateBillingOperationalBalance,
  updateBillingRegulatedPriceVersion,
  saveBillingGisceConfig,
  startBillingImportJob,
  startBillingCalculateCostsAndMarginsJob,
  startBillingFullRecalculationJob,
  startBillingProcessPendingJob,
  testBillingGisceConnection,
  type BillingGisceConfig,
  type BillingGisceConfigInput,
  type BillingGisceConnectionTest,
  type BillingCostsResponse,
  type BillingInvoiceDetail,
  type BillingInvoiceRow,
  type BillingInvoiceStatus,
  type BillingInvoicesResponse,
  type BillingJob,
  type BillingOperationalBalanceResponse,
  type BillingOperationalBalanceRow,
  type RegulatedPriceCode,
  type RegulatedPriceVersion,
  type RegulatedPriceVersionInput
} from "../../api";
import { downloadBlob } from "../../components/technical-data-table/TechnicalDataTableHelpers";
import { PanelTitle, formatEnergy, formatFullDate } from "../shared/RestoredModuleCommon";

const PAGE_SIZE_OPTIONS = [30, 50, 100] as const;
const STATUS_OPTIONS: Array<BillingInvoiceStatus | ""> = ["", "IMPORTED", "READY", "WARNING", "ERROR", "PROCESSING"];
const PERIODS = ["", "P1", "P2", "P3", "P4", "P5", "P6"];
const CURVE_SOURCES = ["", "F1", "TgP1", "F5D", "P5D", "PROFILE", "MISSING"];
const RECONCILIATION_DIFFERENCE_THRESHOLD_KWH = 0.1;
const REGULATED_PRICE_TABS: Array<{ code: RegulatedPriceCode; label: string }> = [
  { code: "RETH", label: "RETh" },
  { code: "EFIH", label: "EFIh" },
  { code: "PC3", label: "PC3" },
  { code: "TOLLS_CHARGES", label: "Peajes + Cargos" },
  { code: "BONO_SOCIAL", label: "Bono Social" },
  { code: "OTROS", label: "Otros" },
  { code: "IMU", label: "IMU" }
];
const INITIAL_BILLING_FILTERS = {
  search: "",
  invoiceDateFrom: "",
  invoiceDateTo: "",
  cups: "",
  invoiceNumber: "",
  polissa: "",
  tariff: "",
  invoicingMode: "",
  status: "" as BillingInvoiceStatus | "",
  curveSource: "",
  withIssues: ""
  , marginStatus: ""
  , marginEurMin: ""
  , marginEurMax: ""
  , marginEurMwhMin: ""
  , marginEurMwhMax: ""
  , hasAnyIssues: ""
};

export function BillingDashboardModule() {
  const [billingSection, setBillingSection] = useState<"invoices" | "balance" | "jobs" | "config">("invoices");
  const [configSection, setConfigSection] = useState<"gisce" | "cost-prices">("gisce");
  const [importFrom, setImportFrom] = useState(() => monthStart());
  const [importTo, setImportTo] = useState(() => monthEnd());
  const [marginMode, setMarginMode] = useState<"PENDING_ONLY" | "RECALCULATE">("PENDING_ONLY");
  const [filters, setFilters] = useState(() => ({ ...INITIAL_BILLING_FILTERS }));
  const [sort, setSort] = useState({ field: "invoiceDate", direction: "desc" });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(30);
  const [response, setResponse] = useState<BillingInvoicesResponse>();
  const [jobs, setJobs] = useState<BillingJob[]>([]);
  const [invoicingModes, setInvoicingModes] = useState<Array<{ id: number; name: string }>>([]);
  const [tariffs, setTariffs] = useState<string[]>([]);
  const [selectedJob, setSelectedJob] = useState<BillingJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [rowActionId, setRowActionId] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string }>();
  const [gisceConfig, setGisceConfig] = useState<BillingGisceConfig | null>(null);
  const [configDraft, setConfigDraft] = useState<BillingGisceConfigInput>({ username: "", password: "" });
  const [connectionTest, setConnectionTest] = useState<BillingGisceConnectionTest | null>(null);
  const [detail, setDetail] = useState<BillingInvoiceDetail | null>(null);
  const [costs, setCosts] = useState<BillingCostsResponse | null>(null);
  const [regulatedTab, setRegulatedTab] = useState<RegulatedPriceCode>("RETH");
  const [regulatedVersions, setRegulatedVersions] = useState<RegulatedPriceVersion[]>([]);
  const [regulatedDraft, setRegulatedDraft] = useState<RegulatedPriceVersionInput>(() => defaultRegulatedDraft("RETH"));
  const [editingRegulatedId, setEditingRegulatedId] = useState<string | null>(null);
  const [regulatedEditorOpen, setRegulatedEditorOpen] = useState(false);
  const [regulatedSaving, setRegulatedSaving] = useState(false);
  const [regulatedError, setRegulatedError] = useState<string | null>(null);
  const [balanceYear, setBalanceYear] = useState(() => new Date().getFullYear());
  const [balanceReport, setBalanceReport] = useState<BillingOperationalBalanceResponse | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceCalculating, setBalanceCalculating] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [balanceFilters, setBalanceFilters] = useState({ cups: "", tariff: "", invoicingMode: "" });
  const [appliedBalanceFilters, setAppliedBalanceFilters] = useState({ cups: "", tariff: "", invoicingMode: "" });

  const rows = response?.rows ?? [];
  const summary = response?.summary;
  const activeJob = jobs.find(isActiveBillingJob);
  const latestImportJob = jobs.find((job) => job.type === "IMPORT_INVOICES" && Boolean(job.finishedAt));
  const disabled = loading || configLoading || Boolean(activeJob);
  const visibleFrom = response?.total ? page * pageSize + 1 : 0;
  const visibleTo = response ? Math.min((page + 1) * pageSize, response.total) : 0;

  async function load(nextPage = page) {
    setLoading(true);
    try {
      const [invoices, nextJobs] = await Promise.all([
        getBillingInvoices({
          ...filters,
          skip: nextPage * pageSize,
          take: pageSize,
          sort: sort.field,
          direction: sort.direction
        }),
        getBillingJobs({ take: 10 })
      ]);
      setResponse(invoices);
      setJobs(nextJobs);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando facturacion." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadGisceConfig();
    void loadInvoicingModes();
    void loadTariffs();
    void loadRegulatedPrices("RETH");
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setPage(0);
      void load(0);
    }, 350);
    return () => window.clearTimeout(handle);
  }, [filters, sort, pageSize]);

  useEffect(() => {
    if (!jobs.some(isActiveBillingJob)) return;
    const handle = window.setInterval(() => {
      void refreshJobs();
    }, 3000);
    return () => window.clearInterval(handle);
  }, [jobs]);

  useEffect(() => {
    void loadRegulatedPrices(regulatedTab);
  }, [regulatedTab]);

  useEffect(() => {
    if (billingSection !== "balance") return;
    void loadOperationalBalance(balanceYear);
  }, [billingSection, balanceYear, appliedBalanceFilters]);

  async function refreshJobs() {
    try {
      const nextJobs = await getBillingJobs({ take: 10 });
      setJobs(nextJobs);
      if (!nextJobs.some(isActiveBillingJob)) {
        await load(page);
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error actualizando trabajos." });
    }
  }

  async function loadGisceConfig() {
    setConfigLoading(true);
    try {
      const config = await getBillingGisceConfig();
      setGisceConfig(config);
      setConfigDraft({
        baseUrl: config.baseUrl,
        username: config.username ?? "",
        password: "",
        timeoutMs: config.timeoutMs,
        invoiceDateField: config.invoiceDateField,
        invoiceStartField: config.invoiceStartField,
        invoiceEndField: config.invoiceEndField
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando configuracion GISCE." });
    } finally {
      setConfigLoading(false);
    }
  }

  async function saveConfig() {
    setConfigLoading(true);
    try {
      const saved = await saveBillingGisceConfig({ ...configDraft, password: configDraft.password || undefined });
      setGisceConfig(saved);
      setConfigDraft((current) => ({ ...current, password: "" }));
      setMessage({ tone: "success", text: "Configuracion GISCE guardada." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error guardando configuracion GISCE." });
    } finally {
      setConfigLoading(false);
    }
  }

  async function testConnection() {
    setConfigLoading(true);
    try {
      const result = await testBillingGisceConnection();
      setConnectionTest(result);
      setMessage({ tone: result.tokenEndpoint.ok ? "success" : "error", text: result.tokenEndpoint.ok ? "Conexion GISCE validada." : result.tokenEndpoint.message ?? "No se pudo validar GISCE." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error probando conexion GISCE." });
    } finally {
      setConfigLoading(false);
    }
  }

  async function runImport() {
    setLoading(true);
    try {
      const job = await startBillingImportJob(importFrom, importTo);
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)].slice(0, 10));
      setMessage({ tone: "info", text: job.message ?? "Importacion GISCE lanzada." });
      await refreshJobs();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error importando facturas GISCE." });
    } finally {
      setLoading(false);
    }
  }

  async function runDeleteInvoices() {
    const confirmed = window.confirm(`Se eliminaran las facturas con fecha factura entre ${importFrom} y ${importTo}, incluyendo lineas, RAW F1/TgP1/F5D/P5D y curva normalizada. Despues podras importarlas de nuevo desde GISCE. ¿Continuar?`);
    if (!confirmed) return;
    setLoading(true);
    try {
      const result = await deleteBillingInvoicesByInvoiceDate(importFrom, importTo);
      setMessage({ tone: "success", text: `Eliminadas ${result.deletedInvoices} facturas, ${result.deletedLines} lineas y ${result.deletedCurveRows} intervalos de curva.` });
      setPage(0);
      await load(0);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error eliminando facturas." });
    } finally {
      setLoading(false);
    }
  }

  async function runDeleteInvoice(row: BillingInvoiceRow) {
    const label = row.invoiceNumber ?? String(row.gisceInvoiceId);
    const confirmed = window.confirm(`Se eliminara solo la factura ${label}, incluyendo lineas, curva, costes y margen asociados. Despues podras importarla de nuevo desde GISCE. ¿Continuar?`);
    if (!confirmed) return;
    setRowActionId(row.id);
    try {
      await deleteBillingInvoice(row.id);
      if (detail?.id === row.id) {
        setDetail(null);
        setCosts(null);
      }
      setMessage({ tone: "success", text: `Factura ${label} eliminada.` });
      await load(page);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error eliminando factura." });
    } finally {
      setRowActionId(null);
    }
  }

  async function runProcessPending() {
    setLoading(true);
    try {
      const job = await startBillingProcessPendingJob(5);
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)].slice(0, 10));
      setMessage({ tone: "info", text: job.message ?? "Procesamiento de pendientes lanzado." });
      await refreshJobs();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error procesando facturas." });
    } finally {
      setLoading(false);
    }
  }

  async function runProcessOne(row: BillingInvoiceRow) {
    setLoading(true);
    try {
      await processBillingInvoice(row.id);
      setMessage({ tone: "success", text: `Curva preparada para ${row.invoiceNumber ?? row.gisceInvoiceId}.` });
      await load(page);
      if (detail?.id === row.id) await openDetail(row.id);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error preparando curva." });
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(id: string) {
    setLoading(true);
    try {
      const invoice = await getBillingInvoiceDetail(id);
      setDetail(invoice);
      await loadCosts(id);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error abriendo factura." });
    } finally {
      setLoading(false);
    }
  }

  async function loadRegulatedPrices(code = regulatedTab) {
    try {
      const rows = await getBillingRegulatedPriceVersions({ code });
      setRegulatedVersions(rows);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando precios de costes." });
    }
  }

  async function cancelJob(job: BillingJob) {
    if (!isActiveBillingJob(job)) return;
    const confirmed = window.confirm(`Se cancelara el job ${billingJobTypeLabel(job.type)}. Se detendra en el siguiente punto seguro. Continuar?`);
    if (!confirmed) return;
    setCancellingJobId(job.id);
    try {
      const cancelled = await cancelBillingJob(job.id);
      setJobs((current) => current.map((item) => (item.id === cancelled.id ? cancelled : item)));
      setSelectedJob((current) => (current?.id === cancelled.id ? cancelled : current));
      setMessage({ tone: "info", text: "Cancelacion solicitada. El job se detendra en el siguiente punto seguro." });
      await refreshJobs();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cancelando el job." });
    } finally {
      setCancellingJobId(null);
    }
  }

  async function loadOperationalBalance(year = balanceYear, filtersToLoad = appliedBalanceFilters) {
    setBalanceLoading(true);
    setBalanceError(null);
    try {
      const report = await getBillingOperationalBalance(year, filtersToLoad);
      setBalanceReport(report);
      if (report.year !== year) setBalanceYear(report.year);
    } catch (error) {
      setBalanceError(error instanceof Error ? error.message : "Error cargando Balance Operativo.");
      setBalanceReport(null);
    } finally {
      setBalanceLoading(false);
    }
  }

  async function recalculateOperationalBalance() {
    setBalanceCalculating(true);
    setBalanceError(null);
    const filtersToApply = { ...balanceFilters };
    try {
      const report = await recalculateBillingOperationalBalance(balanceYear, filtersToApply);
      setAppliedBalanceFilters(filtersToApply);
      setBalanceReport(report);
      if (report.year !== balanceYear) setBalanceYear(report.year);
      setMessage({ tone: "success", text: "Balance Operativo actualizado." });
    } catch (error) {
      setBalanceError(error instanceof Error ? error.message : "Error actualizando Balance Operativo.");
    } finally {
      setBalanceCalculating(false);
    }
  }

  function applyOperationalBalanceFilters(nextFilters = balanceFilters) {
    const filtersToApply = { ...nextFilters };
    setAppliedBalanceFilters(filtersToApply);
    void loadOperationalBalance(balanceYear, filtersToApply);
  }

  async function loadInvoicingModes() {
    try {
      setInvoicingModes(await getBillingInvoicingModes());
    } catch {
      setInvoicingModes([]);
    }
  }

  async function loadTariffs() {
    try {
      setTariffs(await getBillingTariffs());
    } catch {
      setTariffs([]);
    }
  }

  async function runFullRecalculation() {
    setLoading(true);
    try {
      const job = await startBillingFullRecalculationJob(importFrom, importTo, marginMode);
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)].slice(0, 10));
      setMessage({ tone: "info", text: job.message ?? "Proceso completo de facturacion lanzado." });
      await refreshJobs();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error lanzando el proceso completo." });
    } finally {
      setLoading(false);
    }
  }

  async function runCalculateCostsAndMargins() {
    setLoading(true);
    try {
      const job = await startBillingCalculateCostsAndMarginsJob(importFrom, importTo, marginMode);
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)].slice(0, 10));
      setMessage({ tone: "info", text: job.message ?? "Calculo de costes y margenes lanzado." });
      await refreshJobs();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error lanzando el calculo de costes y margenes." });
    } finally {
      setLoading(false);
    }
  }

  function startNewRegulatedVersion(code = regulatedTab) {
    setEditingRegulatedId(null);
    setRegulatedDraft(defaultRegulatedDraft(code));
    setRegulatedError(null);
    setRegulatedEditorOpen(true);
  }

  function editRegulatedVersion(row: RegulatedPriceVersion) {
    setEditingRegulatedId(row.id);
    setRegulatedDraft(versionToDraft(row));
    setRegulatedError(null);
    setRegulatedEditorOpen(true);
  }

  function cancelRegulatedVersionEdit() {
    setRegulatedEditorOpen(false);
    setEditingRegulatedId(null);
    setRegulatedError(null);
  }

  async function saveRegulatedVersion() {
    setRegulatedSaving(true);
    setRegulatedError(null);
    try {
      if (editingRegulatedId) {
        await updateBillingRegulatedPriceVersion(editingRegulatedId, regulatedDraft);
      } else {
        await createBillingRegulatedPriceVersion(regulatedDraft);
      }
      setMessage({ tone: "success", text: "Version de precios guardada." });
      setEditingRegulatedId(null);
      setRegulatedEditorOpen(false);
      await loadRegulatedPrices(regulatedDraft.code);
    } catch (error) {
      setRegulatedError(functionalPriceError(error));
    } finally {
      setRegulatedSaving(false);
    }
  }

  async function deleteRegulatedVersion(row: RegulatedPriceVersion) {
    const confirmed = window.confirm(`Eliminar version ${row.name}\n\nVigencia:\n${formatDate(row.validFrom)} - ${row.validTo ? formatDate(row.validTo) : "Indefinida"}\n\nSeguro?`);
    if (!confirmed) return;
    setLoading(true);
    try {
      await deleteBillingRegulatedPriceVersion(row.id);
      setMessage({ tone: "success", text: "Version de precios eliminada." });
      if (editingRegulatedId === row.id) startNewRegulatedVersion(row.code);
      await loadRegulatedPrices(row.code);
    } catch (error) {
      setMessage({ tone: "error", text: functionalPriceError(error) });
    } finally {
      setLoading(false);
    }
  }

  async function loadCosts(id: string) {
    const nextCosts = await getBillingInvoiceCosts(id);
    setCosts(nextCosts);
  }

  async function runCalculateCosts(id: string) {
    setLoading(true);
    try {
      const result = await calculateBillingInvoiceCostsAndMargin(id, "RECALCULATE");
      setCosts(result.costs);
      setMessage({ tone: result.costs.status === "COSTS_READY" ? "success" : "info", text: result.costs.latestRun?.message ?? "Costes y margen calculados." });
      await loadCosts(id);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error calculando costes y margen." });
    } finally {
      setLoading(false);
    }
  }

  async function exportAuditForRow(row: BillingInvoiceRow) {
    if (!row.costRunId) return;
    setRowActionId(row.id);
    try {
      const result = await downloadBillingInvoiceCostRunAudit(row.id, row.costRunId);
      downloadBlob(result.fileName, result.blob, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error exportando Excel." });
    } finally {
      setRowActionId(null);
    }
  }

  async function exportInvoices() {
    setLoading(true);
    try {
      const blob = await downloadBillingInvoicesExport({
        ...filters,
        sort: sort.field,
        direction: sort.direction
      });
      downloadBlob(`facturas-${new Date().toISOString().slice(0, 10)}.xlsx`, blob, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      setMessage({ tone: "success", text: "Exportacion de facturas generada con los filtros actuales." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error exportando facturas." });
    } finally {
      setLoading(false);
    }
  }

  async function runCalculateCostsAndMarginForRow(row: BillingInvoiceRow) {
    setRowActionId(row.id);
    try {
      const result = await calculateBillingInvoiceCostsAndMargin(row.id, "RECALCULATE");
      setMessage({ tone: result.costs.status === "COSTS_READY" ? "success" : "info", text: result.costs.latestRun?.message ?? `Costes y margen recalculados para ${row.invoiceNumber ?? row.gisceInvoiceId}.` });
      await load(page);
      if (detail?.id === row.id) await loadCosts(row.id);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error calculando costes y margen." });
    } finally {
      setRowActionId(null);
    }
  }

  function updateFilter(key: keyof typeof filters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    setPage(0);
    setFilters({ ...INITIAL_BILLING_FILTERS });
  }

  function toggleSort(field: string) {
    setSort((current) => ({ field, direction: current.field === field && current.direction === "desc" ? "asc" : "desc" }));
  }

  return (
    <div className="module-page pricing-base-module billing-dashboard-module">
      <div className="module-header">
        <PanelTitle icon={<FileSpreadsheet size={22} />} title="Cuadro de Mando de Facturacion" subtitle="Control operativo de facturas, costes, margenes y procesos." />
      </div>

      {message && <div className={`module-message ${message.tone}`}>{message.text}</div>}

      <div className="billing-module-tabs" role="tablist" aria-label="Cuadro de Mando de Facturacion">
        <button className={billingSection === "invoices" ? "active" : ""} onClick={() => setBillingSection("invoices")} type="button">Facturas</button>
        <button className={billingSection === "balance" ? "active" : ""} onClick={() => setBillingSection("balance")} type="button">Balance Operativo</button>
        <button className={billingSection === "jobs" ? "active" : ""} onClick={() => setBillingSection("jobs")} type="button">Jobs / Procesos</button>
        <button className={billingSection === "config" ? "active" : ""} onClick={() => setBillingSection("config")} type="button">Configuracion</button>
      </div>

      {billingSection === "config" && <>
        <div className="billing-config-head">
          <div>
            <span>Cuadro de Mando de Facturacion &gt; Configuracion</span>
            <h3>{configSection === "gisce" ? "GISCE" : "Precios de costes"}</h3>
          </div>
          <div className="billing-config-tabs" role="tablist" aria-label="Configuracion de facturacion">
            <button className={configSection === "gisce" ? "active" : ""} onClick={() => setConfigSection("gisce")} type="button">GISCE</button>
            <button className={configSection === "cost-prices" ? "active" : ""} onClick={() => setConfigSection("cost-prices")} type="button">Precios de costes</button>
          </div>
        </div>

      {configSection === "gisce" && (
      <section className="data-card">
        <div className="data-card-header"><h3>Configuracion GISCE</h3><StatusBadge status={gisceConfig?.authSource === "missing" ? "ERROR" : "READY"} label={gisceConfig?.authSource ?? "missing"} /></div>
        <div className="filter-band">
          <label>Usuario API GISCE<input disabled={disabled} value={String(configDraft.username ?? "")} onChange={(event) => setConfigDraft((current) => ({ ...current, username: event.target.value }))} /></label>
          <label>Contrasena API GISCE<input disabled={disabled} type="password" placeholder={gisceConfig?.passwordConfigured ? "Configurada" : ""} value={String(configDraft.password ?? "")} onChange={(event) => setConfigDraft((current) => ({ ...current, password: event.target.value }))} /></label>
          <button className="secondary-button" disabled={disabled} onClick={() => void saveConfig()} type="button"><Save size={16} /> Guardar configuracion</button>
          <button className="secondary-button" disabled={disabled} onClick={() => void testConnection()} type="button"><PlugZap size={16} /> Probar conexion</button>
          {connectionTest && <span className={`ops-status-badge ${connectionTest.tokenEndpoint.ok ? "valid" : "error"}`}>/token {connectionTest.tokenEndpoint.ok ? "OK" : "ERROR"}</span>}
        </div>
      </section>
      )}

      {configSection === "cost-prices" && (
      <section className="data-card">
        <div className="regulated-prices-head">
          <div>
            <h3>Precios de costes</h3>
            <span>Versiones por vigencia para conceptos regulados</span>
          </div>
          <button className="primary-button" onClick={() => startNewRegulatedVersion(regulatedTab)} type="button"><Plus size={16} /> Nueva version</button>
        </div>
        <div className="regulated-price-tabs" role="tablist" aria-label="Conceptos de precios">
          {REGULATED_PRICE_TABS.map((tab) => <button key={tab.code} className={regulatedTab === tab.code ? "active" : ""} onClick={() => setRegulatedTab(tab.code)} type="button">{tab.label}</button>)}
        </div>
        <div className="billing-section-head regulated-versions-title">
          <h3>Versiones {regulatedCodeLabel(regulatedTab)}</h3>
        </div>
        <div className="billing-lines-scroll">
          <table className="technical-table billing-compact-table regulated-versions-table">
            <thead><tr><th>Nombre</th><th>Vigencia desde</th><th>Vigencia hasta</th><th>Estado</th><th>Resumen</th><th>Acciones</th></tr></thead>
            <tbody>{regulatedVersions.map((row) => <tr key={row.id}><td>{row.name}</td><td>{formatDate(row.validFrom)}</td><td>{row.validTo ? formatDate(row.validTo) : "Indefinida"}</td><td><RegulatedStatusBadge status={row.status} /></td><td>{regulatedSummary(row)}</td><td><div className="regulated-actions"><button className="secondary-button" onClick={() => editRegulatedVersion(row)} type="button">Editar</button><button className="secondary-button danger-button" onClick={() => void deleteRegulatedVersion(row)} type="button">Eliminar</button></div></td></tr>)}{regulatedVersions.length === 0 && <tr><td colSpan={6}>Sin versiones para este concepto.</td></tr>}</tbody>
          </table>
        </div>
      </section>
      )}
      </>}

      {billingSection === "invoices" && <>
      <section className="billing-operation-board">
        <div className="billing-operation-card">
          <div className="billing-operation-card-head">
            <h3>Importacion</h3>
            <span>Ultima importacion: {latestImportJob?.finishedAt ? formatDateTime(latestImportJob.finishedAt) : "-"}</span>
          </div>
          <div className="billing-operation-fields">
            <label>Fecha factura desde<input disabled={disabled} type="date" value={importFrom} onChange={(event) => setImportFrom(event.target.value)} /></label>
            <label>Fecha factura hasta<input disabled={disabled} type="date" value={importTo} onChange={(event) => setImportTo(event.target.value)} /></label>
            <button className="primary-button" disabled={disabled} onClick={() => void runImport()} type="button"><RefreshCw size={16} /> Importar GISCE</button>
          </div>
        </div>
        <div className="billing-operation-card billing-processing-card">
          <div className="billing-operation-card-head">
            <h3>Procesamiento</h3>
            {activeJob && <span className="ops-status-badge processing">{billingJobTypeLabel(activeJob.type)}: {activeJob.message ?? activeJob.status}</span>}
          </div>
          <div className="billing-operation-fields">
            <label>Modo<select disabled={disabled} value={marginMode} onChange={(event) => setMarginMode(event.target.value as "PENDING_ONLY" | "RECALCULATE")}><option value="PENDING_ONLY">Calcular pendientes</option><option value="RECALCULATE">Recalcular rango</option></select></label>
            <button className="secondary-button" disabled={disabled} onClick={() => void runProcessPending()} type="button"><Play size={16} /> Procesar pendientes</button>
            <button className="primary-button" disabled={disabled} onClick={() => void runCalculateCostsAndMargins()} type="button"><Calculator size={16} /> Calcular costes y margenes</button>
            <button className="secondary-button" disabled={disabled} onClick={() => void runFullRecalculation()} type="button"><Play size={16} /> Proceso completo</button>
          </div>
        </div>
        <div className="billing-operation-danger">
          <button className="secondary-button danger-button" disabled={disabled} onClick={() => void runDeleteInvoices()} type="button"><Trash2 size={16} /> Eliminar rango</button>
        </div>
      </section>
      <BillingSummaryStrip summary={summary} />
      </>}

      {billingSection === "jobs" && (
      <section className="panel wide mercado-panel billing-jobs-panel">
        <PanelTitle icon={<RefreshCw size={18} />} title="Trabajos de facturacion" subtitle="importacion, procesamiento y auditoria por fechas" />
        <div className="omie-toolbar compact">
          <button className="secondary-button" disabled={loading} onClick={() => void refreshJobs()} type="button"><RefreshCw size={16} />Actualizar</button>
        </div>
        <div className="mercado-table-shell compact">
          <table className="mercado-table forecast-table compact billing-jobs-table">
            <thead><tr><th>Inicio</th><th>Fin</th><th>Tipo</th><th>Rango</th><th>Paginas GISCE</th><th>Encontradas</th><th>Nuevas/Sin curva</th><th>Actualizadas/Sin costes</th><th>Sin cambios/Sin PF</th><th>Procesadas</th><th>Estado</th><th>Mensaje</th><th>Progreso</th><th>OK</th><th>Warnings</th><th>Errores</th><th>Acciones</th></tr></thead>
            <tbody>{jobs.map((job) => <tr key={job.id}><td>{formatDateTime(job.startedAt ?? job.createdAt)}</td><td>{job.finishedAt ? formatDateTime(job.finishedAt) : "-"}</td><td>{billingJobTypeLabel(job.type)}</td><td>{billingJobRange(job)}</td><td className="number">{billingJobGiscePages(job)}</td><td className="number">{billingJobFound(job)}</td><td className="number">{billingJobCreated(job)}</td><td className="number">{billingJobUpdated(job)}</td><td className="number">{billingJobUnchanged(job)}</td><td className="number">{billingJobProcessed(job)}</td><td><JobStatusBadge job={job} /></td><td>{job.message ?? "-"}</td><td className="billing-job-progress-cell"><BillingJobProgressBar job={job} compact /></td><td className="number">{job.successCount.toLocaleString("es-ES")}</td><td className="number">{job.warningCount.toLocaleString("es-ES")}</td><td className="number">{job.errorCount.toLocaleString("es-ES")}</td><td><div className="billing-row-actions"><button className="icon-button" title="Ver informacion del job" onClick={() => setSelectedJob(job)} type="button"><Info size={16} /></button>{isActiveBillingJob(job) && <button className="icon-button danger-button" disabled={cancellingJobId === job.id} title="Cancelar job" onClick={() => void cancelJob(job)} type="button"><X size={16} /></button>}</div></td></tr>)}{jobs.length === 0 && <tr><td colSpan={17}>Sin trabajos registrados.</td></tr>}</tbody>
          </table>
        </div>
      </section>
      )}

      {billingSection === "balance" && (
        <OperationalBalanceSection
          report={balanceReport}
          selectedYear={balanceYear}
          loading={balanceLoading}
          calculating={balanceCalculating}
          error={balanceError}
          filters={balanceFilters}
          invoicingModes={invoicingModes}
          tariffs={tariffs}
          onFiltersChange={setBalanceFilters}
          onApplyFilters={applyOperationalBalanceFilters}
          onYearChange={setBalanceYear}
          onRecalculate={() => void recalculateOperationalBalance()}
        />
      )}


      {billingSection === "invoices" && (
      <section className="panel wide billing-invoices-panel">
        <BillingFiltersPanel filters={filters} invoicingModes={invoicingModes} disabled={disabled} onFilterChange={updateFilter} onClear={clearFilters} onSubmit={() => void load(page)} />
        <div className="billing-table-toolbar">
          <div>
            <h3>Facturas</h3>
            <span>{loading ? "Cargando..." : `${visibleFrom}-${visibleTo} de ${(response?.total ?? 0).toLocaleString("es-ES")} facturas`}</span>
          </div>
          <div className="billing-row-actions">
            <button className="secondary-button" disabled={disabled} onClick={() => void exportInvoices()} type="button"><FileSpreadsheet size={16} /> Excel</button>
            <button className="secondary-button" disabled={disabled} onClick={() => void load(page)} type="button"><RefreshCw size={16} /> Actualizar</button>
          </div>
        </div>
        <div className="table-scroll">
          <table className="omie-liquidation-table billing-invoices-table">
            <thead>
              <tr>
                <SortTh label="Factura" field="invoiceNumber" sort={sort} onSort={toggleSort} />
                <SortTh label="Fecha factura" field="invoiceDate" sort={sort} onSort={toggleSort} />
                <SortTh label="CUPS" field="cups" sort={sort} onSort={toggleSort} />
                <th>Poliza</th><th>Periodo consumo</th><th>Tarifa</th><SortTh label="Consumo PF (kWh)" field="pf" sort={sort} onSort={toggleSort} align="right" /><th>Origen calculo</th><SortTh label="Costes" field="costs" sort={sort} onSort={toggleSort} align="right" /><th className="number">Ingresos</th><SortTh label="Margen €" field="margin" sort={sort} onSort={toggleSort} align="right" /><SortTh label="Margen €/MWh" field="marginEurMwh" sort={sort} onSort={toggleSort} align="right" /><SortTh label="Estado" field="globalStatus" sort={sort} onSort={toggleSort} /><th>Incidencias</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} onDoubleClick={() => void openDetail(row.id)}>
                  <td><button className="link-button" onClick={() => void openDetail(row.id)} type="button">{row.invoiceNumber ?? row.gisceInvoiceId}</button></td>
                  <td>{formatDate(row.invoiceDate)}</td><td>{row.cups}</td><td>{row.polissaNumber ?? "-"}</td><td>{formatDate(row.periodStart)} - {formatDate(row.periodEnd)}</td><td>{row.tariffCode ?? "-"}</td>
                  <td className="number">{row.pfTotalKwh === null || row.pfTotalKwh === undefined ? "-" : formatEnergy(row.pfTotalKwh)}</td><td title={curveTooltip(row)}>{row.curveSummaryText ?? curveSummaryText(row)}</td><td className="number billing-economic-cell">{formatCurrencyEuro(row.totalCostEur)}</td><td className="number billing-economic-cell">{formatCurrencyEuro(row.associatedRevenueEur)}</td><td className={`number billing-margin-cell ${marginToneClass(row.marginEur)}`}>{formatCurrencyEuro(row.marginEur)}</td><td className={`number billing-margin-cell ${marginToneClass(row.marginEurMwh)}`}>{row.marginEurMwh === null || row.marginEurMwh === undefined ? "-" : `${formatNumberFixed(row.marginEurMwh, 2)} €/MWh`}</td>
                  <td><GlobalBillingStatusBadge status={row.globalStatus ?? "CURVE_PENDING"} /></td><td title={issuesTooltip(row)}>{formatInvoiceIssuesBadge(row)}</td>
                  <td><div className="billing-row-actions"><button className="secondary-button billing-row-view-button" title="Ver detalle de factura" onClick={() => void openDetail(row.id)} type="button"><Eye size={14} /> Ver</button><div className="billing-row-more"><button className="icon-button" title="Mas acciones" onClick={() => setRowMenuId((current) => current === row.id ? null : row.id)} type="button"><MoreHorizontal size={16} /></button>{rowMenuId === row.id && <div className="billing-row-action-menu"><button disabled={Boolean(activeJob) || rowActionId === row.id} onClick={() => { setRowMenuId(null); void runProcessOne(row); }} type="button"><Play size={14} /> Procesar curva</button><button disabled={!rowCanCalculateCosts(row) || rowActionId === row.id} onClick={() => { setRowMenuId(null); void runCalculateCostsAndMarginForRow(row); }} type="button"><Calculator size={14} /> Calcular costes y margen</button><button disabled={!row.costRunId || rowActionId === row.id} onClick={() => { setRowMenuId(null); void exportAuditForRow(row); }} type="button"><Download size={14} /> Descargar Excel</button><button className="danger-menu-item" disabled={Boolean(activeJob) || rowActionId === row.id} onClick={() => { setRowMenuId(null); void runDeleteInvoice(row); }} type="button"><Trash2 size={14} /> Eliminar factura</button></div>}</div></div></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={15}>Sin facturas para los filtros seleccionados.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="table-pagination">
          <label>Registros <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value) as 30 | 50 | 100); setPage(0); }}>{PAGE_SIZE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
          <button disabled={disabled || page === 0} onClick={() => { const next = page - 1; setPage(next); void load(next); }} type="button">Anterior</button>
          <span>Pagina {page + 1}</span>
          <button disabled={disabled || !response?.hasNext} onClick={() => { const next = page + 1; setPage(next); void load(next); }} type="button">Siguiente</button>
        </div>
      </section>
      )}

      {selectedJob && <BillingJobInfoModal job={selectedJob} onClose={() => setSelectedJob(null)} />}
      {regulatedEditorOpen && <RegulatedPriceVersionModal draft={regulatedDraft} editing={Boolean(editingRegulatedId)} error={regulatedError} saving={regulatedSaving} onChange={setRegulatedDraft} onCancel={cancelRegulatedVersionEdit} onSave={() => void saveRegulatedVersion()} />}
      {detail && <InvoiceDetailModal detail={detail} costs={costs} onClose={() => setDetail(null)} onProcess={() => void runProcessOne(detail)} onCalculateCosts={() => void runCalculateCosts(detail.id)} />}
    </div>
  );
}

function OperationalBalanceSection({
  report,
  selectedYear,
  loading,
  calculating,
  error,
  filters,
  invoicingModes,
  tariffs,
  onFiltersChange,
  onApplyFilters,
  onYearChange,
  onRecalculate
}: {
  report: BillingOperationalBalanceResponse | null;
  selectedYear: number;
  loading: boolean;
  calculating: boolean;
  error: string | null;
  filters: { cups: string; tariff: string; invoicingMode: string };
  invoicingModes: Array<{ id: number; name: string }>;
  tariffs: string[];
  onFiltersChange: Dispatch<SetStateAction<{ cups: string; tariff: string; invoicingMode: string }>>;
  onApplyFilters: (filters?: { cups: string; tariff: string; invoicingMode: string }) => void;
  onYearChange: (year: number) => void;
  onRecalculate: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["used-revenue", "used-revenue:energy", "used-revenue:power", "excluded-revenue"]));
  const years = useMemo(() => {
    const unique = new Set([selectedYear, ...(report?.availableYears ?? [])]);
    return [...unique].filter(Number.isFinite).sort((left, right) => right - left);
  }, [report?.availableYears, selectedYear]);
  const visibleRows = useMemo(() => flattenOperationalBalanceRows(report?.rows ?? [], expanded), [expanded, report?.rows]);

  function toggle(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section className="panel wide annual-report-panel billing-operational-balance-panel">
      <div className="annual-report-header">
        <PanelTitle icon={<FileText size={18} />} title="Balance Operativo" subtitle="Facturacion, consumos, costes y margen por fecha de factura" />
        <div className="indexed-price-history-filters">
          <label className="annual-report-year-filter">
            <span>Ano</span>
            <select value={selectedYear} onChange={(event) => onYearChange(Number(event.target.value))} disabled={loading || calculating}>
              {years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <button className="primary-button compact" disabled={loading || calculating} onClick={onRecalculate} type="button">
            {calculating ? "Calculando..." : "Actualizar calculo"}
          </button>
        </div>
      </div>
      <div className="billing-operational-balance-filters filter-band">
        <label>CUPS<input disabled={loading || calculating} value={filters.cups} onChange={(event) => onFiltersChange((current) => ({ ...current, cups: event.target.value }))} placeholder="Todos" /></label>
        <label>Tarifa ATR<select disabled={loading || calculating} value={filters.tariff} onChange={(event) => onFiltersChange((current) => ({ ...current, tariff: event.target.value }))}><option value="">Todas</option>{tariffs.map((tariff) => <option key={tariff} value={tariff}>{tariff}</option>)}</select></label>
        <label>Modo facturacion<select disabled={loading || calculating} value={filters.invoicingMode} onChange={(event) => onFiltersChange((current) => ({ ...current, invoicingMode: event.target.value }))}><option value="">Todos</option>{invoicingModes.map((mode) => <option key={`${mode.id}-${mode.name}`} value={mode.name}>{mode.name}</option>)}</select></label>
        <button className="secondary-button" disabled={loading || calculating} type="button" onClick={() => onApplyFilters()}>Consultar</button>
        <button className="secondary-button" disabled={loading || calculating} type="button" onClick={() => { const emptyFilters = { cups: "", tariff: "", invoicingMode: "" }; onFiltersChange(emptyFilters); onApplyFilters(emptyFilters); }}>Limpiar filtros</button>
      </div>
      {report?.calculatedAt && <div className="indexed-price-history-meta">Ultimo calculo: {formatDateTime(report.calculatedAt)}</div>}
      {loading && <div className="annual-report-loading">Cargando Balance Operativo guardado...</div>}
      {calculating && <div className="annual-report-loading">Calculando y guardando Balance Operativo...</div>}
      {error && <div className="form-message error">{error}</div>}
      {report && report.rows.length > 0 && (
        <div className="annual-report-tables">
          <section className="annual-report-table-section">
            <h3>Balance Operativo {report.year}</h3>
            <div className="table-scroll omie-annual-summary-scroll annual-report-table-shell">
              <table className="omie-liquidation-table omie-annual-summary-table annual-report-table billing-operational-balance-table">
                <colgroup>
                  <col className="annual-report-metric-col" />
                  {report.months.map((month) => <col className="annual-report-month-col" key={month} />)}
                  <col className="annual-report-total-col" />
                </colgroup>
                <thead>
                  <tr>
                    <th className="annual-report-sticky-col">Metrica</th>
                    {report.months.map((month) => <th key={month}>{month.slice(0, 3)}</th>)}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((entry) => (
                    <OperationalBalanceRowView
                      expanded={expanded.has(entry.row.key)}
                      key={entry.row.key}
                      row={entry.row}
                      hasChildren={Boolean(entry.row.children?.length)}
                      onToggle={() => toggle(entry.row.key)}
                    />
                  ))}
                  {visibleRows.length === 0 && <tr><td colSpan={14}>Sin datos disponibles para el Balance Operativo.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
      {!loading && !calculating && !error && (!report || report.rows.length === 0) && (
        <div className="empty-state compact">
          <FileText size={18} />
          <span>Sin calculo guardado para el ano y filtros seleccionados. Usa Actualizar calculo para generarlo.</span>
        </div>
      )}
    </section>
  );
}

function OperationalBalanceRowView({ row, hasChildren, expanded, onToggle }: { row: BillingOperationalBalanceRow; hasChildren: boolean; expanded: boolean; onToggle: () => void }) {
  return (
    <tr className={`billing-operational-balance-level-${row.level} ${row.level === 0 ? "annual-report-highlight-row" : ""}`}>
      <th className="annual-report-sticky-col" scope="row">
        <span className="billing-operational-balance-label" style={{ paddingLeft: `${row.level * 16}px` }}>
          {hasChildren ? <button className="icon-button mini" onClick={onToggle} title={expanded ? "Contraer" : "Expandir"} type="button">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="billing-operational-balance-spacer" />}
          {row.label}
        </span>
      </th>
      {row.months.map((cell, index) => <td className={`number ${operationalBalanceToneClass(row, cell.value)}`} key={`${row.key}-${index}`} title={operationalBalanceCellTitle(cell)}>{formatOperationalBalanceValue(cell.value, row.unit)}</td>)}
      <td className={`number annual-report-total ${operationalBalanceToneClass(row, row.total.value)}`} title={operationalBalanceCellTitle(row.total)}>{formatOperationalBalanceValue(row.total.value, row.unit)}</td>
    </tr>
  );
}

function flattenOperationalBalanceRows(rows: BillingOperationalBalanceRow[], expanded: Set<string>) {
  const output: Array<{ row: BillingOperationalBalanceRow }> = [];
  function visit(row: BillingOperationalBalanceRow) {
    output.push({ row });
    if (!expanded.has(row.key)) return;
    for (const child of row.children ?? []) visit(child);
  }
  for (const row of rows) visit(row);
  return output;
}

function formatOperationalBalanceValue(value: number | null, unit: "COUNT" | "EUR" | "EUR_MWH" | "KWH" | "PERCENT") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  if (unit === "COUNT") return value.toLocaleString("es-ES", { maximumFractionDigits: 0 });
  if (unit === "PERCENT") return `${value.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  if (unit === "EUR_MWH") return `${value.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/MWh`;
  if (Math.abs(value) < 0.0000001) return unit === "EUR" ? formatCurrencyEuro(0) : formatEnergy(0);
  return unit === "EUR" ? formatCurrencyEuro(value) : formatEnergy(value);
}

function operationalBalanceToneClass(row: BillingOperationalBalanceRow, value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value) || Math.abs(value) < 0.0000001) return "";
  if (value < 0) return "negative";
  return row.key.startsWith("margin") ? "positive" : "";
}

function operationalBalanceCellTitle(cell: { invoiceCount: number; calculatedInvoiceCount: number; missingInvoiceCount: number; warningInvoiceCount: number }) {
  return [
    `Facturas: ${cell.invoiceCount.toLocaleString("es-ES")}`,
    `Calculadas: ${cell.calculatedInvoiceCount.toLocaleString("es-ES")}`,
    `Pendientes: ${cell.missingInvoiceCount.toLocaleString("es-ES")}`,
    `Warnings: ${cell.warningInvoiceCount.toLocaleString("es-ES")}`
  ].join("\n");
}

function InvoiceDetailModal({ detail, costs, onClose, onProcess, onCalculateCosts }: { detail: BillingInvoiceDetail; costs: BillingCostsResponse | null; onClose: () => void; onProcess: () => void; onCalculateCosts: () => void }) {
  const [exportingAudit, setExportingAudit] = useState(false);
  const processed = detail.curveSummary.expectedIntervals > 0;
  const energyTotal = detail.billedEnergyKwh ?? totalEnergy(detail.energyByPeriod);
  const groupedIssues = groupIssues(detail.issues);
  const lineSummary = useMemo(() => summarizeInvoiceLines(detail.lines), [detail.lines]);
  const marginSummary = useMemo(() => buildInvoiceMargin(lineSummary, costs, detail.curveSummary.pfTotalKwh, detail.economicSign), [lineSummary, costs, detail.curveSummary.pfTotalKwh, detail.economicSign]);
  const curveSources = curveSourceRows(detail);
  const exportRunId = costs?.latestRun?.id || "";
  const reconciliationTotal = detail.reconciliation.reduce((total, row) => ({
    invoiceKwh: total.invoiceKwh + row.invoiceKwh,
    curveKwh: total.curveKwh + row.curveKwh,
    differenceKwh: total.differenceKwh + row.differenceKwh
  }), { invoiceKwh: 0, curveKwh: 0, differenceKwh: 0 });
  async function exportAuditExcel() {
    if (!exportRunId) return;
    setExportingAudit(true);
    try {
      const result = await downloadBillingInvoiceCostRunAudit(detail.id, exportRunId);
      downloadBlob(result.fileName, result.blob, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "No se pudo exportar el Excel.");
    } finally {
      setExportingAudit(false);
    }
  }
  return (
    <div className="ops-modal-backdrop">
      <div className="ops-modal billing-detail-modal">
        <div className="billing-detail-head">
          <div className="billing-detail-title">
            <div className="billing-detail-title-row">
              <h3>Factura {detail.invoiceNumber ?? detail.gisceInvoiceId}</h3>
              <StatusBadge status={detail.processingStatus} />
            </div>
            <span>{detail.cups} · Poliza {detail.polissaNumber ?? "-"} · {detail.tariffCode ?? "-"}</span>
          </div>
          <button className="icon-button billing-close-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </div>
        <div className="billing-detail-body">
          <section className="billing-operational-strip">
            <DetailMetric label="Fecha factura" value={formatDate(detail.invoiceDate)} />
            <DetailMetric label="Periodo consumo" value={`${formatDate(detail.periodStart)} - ${formatDate(detail.periodEnd)}`} />
            <DetailMetric label="Energia" value={formatEnergy(energyTotal)} />
            <DetailMetric label="Estado curva" value={processed ? curveStatusLabel(detail) : "Sin procesar"} />
            <div className="billing-detail-actions">
              <button className="icon-button" onClick={onProcess} title={processed ? "Reprocesar curva" : "Procesar factura"} type="button"><Play size={16} /></button>
              <button className="icon-button" disabled={!processed} onClick={onCalculateCosts} title="Recalcular costes y margen" type="button"><Calculator size={16} /></button>
              <button className="icon-button" disabled={!processed || !exportRunId || exportingAudit} onClick={() => void exportAuditExcel()} title={exportingAudit ? "Generando Excel" : "Exportar Excel"} type="button"><FileSpreadsheet size={16} /></button>
            </div>
          </section>

          <DetailSection title="Datos factura">
            <div className="billing-field-grid">
              <DetailField label="Numero" value={detail.invoiceNumber ?? "-"} />
              <DetailField label="ID GISCE" value={detail.gisceInvoiceId} />
              <DetailField label="CUPS" value={detail.cups} />
              <DetailField label="Poliza" value={detail.polissaNumber ?? "-"} />
              <DetailField label="Tarifa" value={detail.tariffCode ?? "-"} />
              <DetailField label="Lista de precios" value={detail.priceListName ?? "-"} />
              <DetailField label="Modo de facturacion" value={detail.compatibleInvoicingModes.length ? detail.compatibleInvoicingModes.map((mode) => mode.name).join(" · ") : "-"} />
              <DetailField label="Fecha factura" value={formatDate(detail.invoiceDate)} />
              <DetailField label="Inicio periodo" value={formatDate(detail.periodStart)} />
              <DetailField label="Fin periodo" value={formatDate(detail.periodEnd)} />
              <DetailField label="Estado" value={statusLabel(detail.processingStatus)} />
            </div>
          </DetailSection>

          <DetailSection title="Curva">
            {processed ? <div className="billing-curve-compact">
              <div className="billing-curve-summary">
                <DetailMetric label="Estado" value={curveStatusLabel(detail)} />
                <DetailMetric label="Intervalos" value={detail.curveSummary.expectedIntervals.toLocaleString("es-ES")} />
                <DetailMetric label="PF" value={formatEnergy(detail.curveSummary.pfTotalKwh)} />
                <DetailMetric label="BC" value={detail.curveSummary.bcTotalKwh === null ? "-" : formatEnergy(detail.curveSummary.bcTotalKwh)} />
              </div>
              <div className="billing-curve-origin">
                <h4>Origen de curva</h4>
                <div className="billing-curve-origin-list">{curveSources.sources.map((source) => <div key={source.label} className="billing-curve-origin-row"><span>{source.label}</span><strong>{source.count.toLocaleString("es-ES")} · {formatPct(source.pct)}</strong></div>)}</div>
              </div>
              {curveSources.missing && <div className="billing-curve-origin warning"><h4>Incidencia</h4><div className="billing-curve-origin-list"><div className="billing-curve-origin-row"><span>Missing</span><strong>{curveSources.missing.count.toLocaleString("es-ES")} · {formatPct(curveSources.missing.pct)}</strong></div></div></div>}
            </div> : <div className="billing-unprocessed-curve">
              <DetailMetric label="Estado" value="Sin procesar" />
              <DetailMetric label="Intervalos" value="" />
              <DetailMetric label="PF" value="" />
              <DetailMetric label="BC" value="" />
              <p>Procesa la factura para generar la curva.</p>
            </div>}
          </DetailSection>

          <DetailSection title="Lineas de factura">
            <div className="billing-margin-summary">
              <DetailMetric label="Margen" value={marginSummary.marginEur === null ? "-" : formatCurrencyEuro(marginSummary.marginEur)} />
              <DetailMetric label="Margen unitario" value={marginSummary.marginEurMwh === null ? "-" : `${formatNumberFixed(marginSummary.marginEurMwh, 2)} €/MWh`} />
              <span className={`ops-status-badge ${marginSummary.status === "READY" ? "valid" : marginSummary.status === "WARNING" ? "partial" : "processing"}`}>{marginStatusLabel(marginSummary.status)}</span>
            </div>
            <div className="billing-lines-scroll">
              <table className="technical-table billing-lines-summary-table">
                <thead><tr><th>Concepto</th><th className="number">Importe</th><th className="number">Coste calculado</th><th className="number">Diferencia</th></tr></thead>
                <tbody>{marginSummary.rows.map((row) => <tr key={row.concept}><td>{row.concept}</td><td className="number">{formatCurrencyEuro(row.amount)}</td><td className="number">{row.costEur === null ? "" : formatCurrencyEuro(row.costEur)}</td><td className="number">{row.differenceEur === null ? "" : formatCurrencyEuro(row.differenceEur)}</td></tr>)}<tr className="billing-lines-total-row"><th>Total</th><th className="number">{formatCurrencyEuro(marginSummary.invoiceTotalEur)}</th><th className="number">{marginSummary.associatedCostEur === null ? "" : formatCurrencyEuro(marginSummary.associatedCostEur)}</th><th className="number">{marginSummary.marginEur === null ? "" : formatCurrencyEuro(marginSummary.marginEur)}</th></tr></tbody>
              </table>
            </div>
          </DetailSection>

          {processed && <DetailSection title="Reconciliacion">
            <table className="technical-table billing-compact-table"><thead><tr><th>Periodo</th><th className="number">Factura kWh</th><th className="number">Curva kWh</th><th className="number">Diferencia</th><th>Estado</th></tr></thead><tbody>{detail.reconciliation.map((row) => <tr key={row.period}><td>{row.period}</td><td className="number">{formatEnergy(row.invoiceKwh)}</td><td className="number">{formatEnergy(row.curveKwh)}</td><td className="number">{formatEnergy(row.differenceKwh)}</td><td>{reconciliationStatus(row.differenceKwh)}</td></tr>)}<tr><th>Total</th><th className="number">{formatEnergy(reconciliationTotal.invoiceKwh)}</th><th className="number">{formatEnergy(reconciliationTotal.curveKwh)}</th><th className="number">{formatEnergy(reconciliationTotal.differenceKwh)}</th><th>{reconciliationStatus(reconciliationTotal.differenceKwh)}</th></tr></tbody></table>
          </DetailSection>}

          <DetailSection title="Incidencias">
            {groupedIssues.length === 0 ? <p className="billing-empty-state">Sin incidencias</p> : <div className="billing-lines-scroll"><table className="technical-table billing-compact-table"><thead><tr><th>Codigo</th><th className="number">Nº intervalos</th><th>Descripcion</th></tr></thead><tbody>{groupedIssues.map((issue) => <tr key={issue.code}><td>{issue.code}</td><td className="number">{issue.count.toLocaleString("es-ES")}</td><td>{issue.description}</td></tr>)}</tbody></table></div>}
          </DetailSection>

          <DetailSection title="Costes">
            <div className="billing-cost-summary">
              <DetailMetric label="Estado costes" value={<CostStatusBadge status={costs?.status ?? "NOT_CALCULATED"} />} />
              <DetailMetric label="Version calculo" value={costs?.latestRun?.calculationVersion ?? "-"} />
              <DetailMetric label="Ultimo calculo" value={costs?.latestRun?.completedAt ? formatDateTime(costs.latestRun.completedAt) : "-"} />
              <DetailMetric label="Intervalos OK" value={(costs?.latestRun?.okIntervalsCount ?? 0).toLocaleString("es-ES")} />
              <DetailMetric label="Errores" value={(costs?.latestRun?.errorIntervalsCount ?? 0).toLocaleString("es-ES")} />
            </div>
            <div className="billing-lines-scroll">
              <table className="technical-table billing-compact-table">
                <thead><tr><th>Concepto</th><th>Naturaleza</th><th className="number">Coste</th><th className="number">Precio medio ponderado</th><th className="number">Intervalos</th><th className="number">Incidencias</th><th>Versiones</th></tr></thead>
                <tbody>{(costs?.componentSummary ?? []).map((row) => <tr key={row.componentCode}><td>{costComponentLabel(row.componentCode)}</td><td><CostNatureBadge nature={row.nature} /></td><td className="number">{formatEuro(row.costEur)}</td><td className="number">{formatPrice(row.weightedPriceEurMwh)}</td><td className="number">{row.intervals.toLocaleString("es-ES")}</td><td className="number">{row.incidents.toLocaleString("es-ES")}</td><td>{row.versions.length ? row.versions.join(", ") : "-"}</td></tr>)}{costs && costs.componentSummary.length > 0 && <tr className="billing-cost-total-row"><th>TOTAL</th><th>-</th><th className="number">{formatEuro(costs.totals?.totalCostEur ?? null)}</th><th className="number">-</th><th className="number">-</th><th className="number">-</th><th>-</th></tr>}{(!costs || costs.componentSummary.length === 0) && <tr><td colSpan={7}>Sin costes calculados.</td></tr>}</tbody>
              </table>
            </div>
          </DetailSection>

        </div>
      </div>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="billing-detail-section"><div className="billing-section-head"><h3>{title}</h3></div>{children}</section>; }
function DetailMetric({ label, value }: { label: string; value: React.ReactNode }) { return <div className="billing-detail-metric"><span>{label}</span><strong>{value}</strong></div>; }
function DetailField({ label, value }: { label: string; value: React.ReactNode }) { return <div className="billing-detail-field"><span>{label}</span><strong>{value}</strong></div>; }
function CostStatusBadge({ status }: { status: string }) {
  const tone = status === "COSTS_READY" || status === "COMPLETED" ? "valid" : status === "ERROR" ? "error" : status === "NOT_CALCULATED" ? "processing" : "partial";
  return <span className={`ops-status-badge ${tone}`}>{costStatusLabel(status)}</span>;
}
function CostNatureBadge({ nature }: { nature: "ENERGY" | "POWER" }) {
  return <span className="billing-cost-nature-badge">{nature === "POWER" ? "Potencia" : "Energ\u00eda"}</span>;
}
function BillingFiltersPanel({ filters, invoicingModes, disabled, onFilterChange, onClear, onSubmit }: { filters: typeof INITIAL_BILLING_FILTERS; invoicingModes: Array<{ id: number; name: string }>; disabled: boolean; onFilterChange: (key: keyof typeof INITIAL_BILLING_FILTERS, value: string) => void; onClear: () => void; onSubmit: () => void }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  return (
    <div className="billing-filters-zone">
      <div className="billing-filters-head">
        <span className="billing-filters-eyebrow">Filtros</span>
        <button className="secondary-button billing-more-filters-button" type="button" onClick={() => setAdvancedOpen((current) => !current)}>{advancedOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Más filtros</button>
      </div>
      <div className="billing-filters-grid billing-filters-main-grid">
        <label className="billing-filter-field billing-filter-search">Búsqueda<span className="billing-search-input"><Search size={15} /><input disabled={disabled} placeholder="Factura, CUPS o póliza" value={filters.search} onChange={(event) => onFilterChange("search", event.target.value)} /></span></label>
        <label className="billing-filter-field billing-filter-date-from">Fecha desde<input disabled={disabled} type="date" value={filters.invoiceDateFrom} onChange={(event) => onFilterChange("invoiceDateFrom", event.target.value)} /></label>
        <label className="billing-filter-field billing-filter-date-to">Fecha hasta<input disabled={disabled} type="date" value={filters.invoiceDateTo} onChange={(event) => onFilterChange("invoiceDateTo", event.target.value)} /></label>
        <label className="billing-filter-field billing-filter-status">Estado<select disabled={disabled} value={filters.status} onChange={(event) => onFilterChange("status", event.target.value)}>{STATUS_OPTIONS.map((option) => <option key={option || "all"} value={option}>{statusLabel(option)}</option>)}</select></label>
        <label className="billing-filter-field billing-filter-issues">Incidencias totales<select disabled={disabled} value={filters.hasAnyIssues} onChange={(event) => onFilterChange("hasAnyIssues", event.target.value)}><option value="">Todas</option><option value="true">Con incidencias</option><option value="false">Sin incidencias</option></select></label>
        <div className="billing-filter-actions">
          <button className="secondary-button billing-clear-filters-button" disabled={disabled} onClick={onClear} type="button">Limpiar filtros</button>
          <button className="primary-button" disabled={disabled} onClick={onSubmit} type="button"><Search size={16} /> Consultar</button>
        </div>
      </div>
      {advancedOpen && <div className="billing-filters-grid billing-filters-secondary-grid">
        <label className="billing-filter-field billing-filter-cups">CUPS<input disabled={disabled} value={filters.cups} onChange={(event) => onFilterChange("cups", event.target.value)} /></label>
        <label className="billing-filter-field billing-filter-invoice">Numero factura<input disabled={disabled} value={filters.invoiceNumber} onChange={(event) => onFilterChange("invoiceNumber", event.target.value)} /></label>
        <label className="billing-filter-field billing-filter-polissa">Poliza<input disabled={disabled} value={filters.polissa} onChange={(event) => onFilterChange("polissa", event.target.value)} /></label>
        <label className="billing-filter-field billing-filter-tariff">Tarifa<input disabled={disabled} value={filters.tariff} onChange={(event) => onFilterChange("tariff", event.target.value)} /></label>
        <label className="billing-filter-field billing-filter-source">Origen curva<select disabled={disabled} value={filters.curveSource} onChange={(event) => onFilterChange("curveSource", event.target.value)}>{CURVE_SOURCES.map((option) => <option key={option || "all"} value={option}>{formatCurveSource(option) || "Todos"}</option>)}</select></label>
        <label className="billing-filter-field">Modo de facturacion<select disabled={disabled} value={filters.invoicingMode} onChange={(event) => onFilterChange("invoicingMode", event.target.value)}><option value="">Todos</option>{invoicingModes.map((mode) => <option key={`${mode.id}-${mode.name}`} value={mode.name}>{mode.name}</option>)}</select></label>
        <label className="billing-filter-field">Estado margen<select disabled={disabled} value={filters.marginStatus} onChange={(event) => onFilterChange("marginStatus", event.target.value)}><option value="">Todos</option><option value="READY">Correcto</option><option value="WARNING">Con avisos</option><option value="NOT_AVAILABLE">No disponible</option></select></label>
        <label className="billing-filter-field">Margen minimo<input disabled={disabled} type="number" step="0.01" value={filters.marginEurMin} onChange={(event) => onFilterChange("marginEurMin", event.target.value)} /></label>
        <label className="billing-filter-field">Margen maximo<input disabled={disabled} type="number" step="0.01" value={filters.marginEurMax} onChange={(event) => onFilterChange("marginEurMax", event.target.value)} /></label>
        <label className="billing-filter-field">Margen €/MWh minimo<input disabled={disabled} type="number" step="0.01" value={filters.marginEurMwhMin} onChange={(event) => onFilterChange("marginEurMwhMin", event.target.value)} /></label>
        <label className="billing-filter-field">Margen €/MWh maximo<input disabled={disabled} type="number" step="0.01" value={filters.marginEurMwhMax} onChange={(event) => onFilterChange("marginEurMwhMax", event.target.value)} /></label>
        <label className="billing-filter-field">Incidencias curva<select disabled={disabled} value={filters.withIssues} onChange={(event) => onFilterChange("withIssues", event.target.value)}><option value="">Todas</option><option value="true">Con incidencias</option><option value="false">Sin incidencias</option></select></label>
      </div>}
    </div>
  );
}
function BillingSummaryStrip({ summary }: { summary: BillingInvoicesResponse["summary"] | undefined }) {
  const invoices = summary?.invoices ?? 0;
  const ready = summary?.ready ?? 0;
  const pending = Math.max(invoices - ready, 0);
  const withIssues = summary?.withIssues ?? 0;
  const items = [
    { label: "Facturas", value: invoices },
    { label: "Preparadas", value: ready, tone: "good" },
    { label: "Pendientes", value: pending, tone: pending ? "bad" : "good" },
    { label: "Con incidencias", value: withIssues, tone: withIssues ? "bad" : "good" }
  ];
  return <div className="billing-summary-strip billing-operational-summary">{items.map((item) => <span key={item.label} className={item.tone ?? ""}><b>{item.label}</b><strong>{item.value.toLocaleString("es-ES")}</strong></span>)}</div>;
}
function BillingJobInfoModal({ job, onClose }: { job: BillingJob; onClose: () => void }) {
  const detailRows = billingJobDetailRows(job);
  const resultSummary = billingJobResultSummary(job);
  return (
    <div className="ops-modal-backdrop">
      <div className="ops-modal billing-job-modal">
        <div className="ops-modal-head billing-job-head">
          <div><h3>{billingJobModalTitle(job)}</h3><span>{formatDateTime(job.startedAt ?? job.createdAt)}</span></div>
          <JobStatusBadge job={job} />
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </div>
        <div className="billing-job-body">
          <BillingJobProgressBar job={job} />
          <div className="billing-job-indicators">
            <JobIndicator label="Procesadas" value={billingJobProcessed(job)} />
            <JobIndicator label="Correctas" value={job.successCount.toLocaleString("es-ES")} tone="good" />
            <JobIndicator label="Advertencias" value={job.warningCount.toLocaleString("es-ES")} tone={job.warningCount ? "warning" : "neutral"} />
            <JobIndicator label="Errores" value={job.errorCount.toLocaleString("es-ES")} tone={job.errorCount ? "danger" : "neutral"} />
          </div>
          <section className={`billing-job-result ${resultSummary.tone}`}>
            <strong>{resultSummary.title}</strong>
            <span>{resultSummary.description}</span>
          </section>
          <section className="billing-job-detail-panel">
            <div className="billing-section-head"><h3>Detalle</h3></div>
            <div className="billing-job-detail-rows">
              {detailRows.map((row) => <div key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>)}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
function JobIndicator({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "warning" | "danger" }) {
  return <div className={`billing-job-indicator ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}
function RegulatedPriceVersionModal({ draft, editing, error, saving, onChange, onCancel, onSave }: { draft: RegulatedPriceVersionInput; editing: boolean; error: string | null; saving: boolean; onChange: Dispatch<SetStateAction<RegulatedPriceVersionInput>>; onCancel: () => void; onSave: () => void }) {
  const noEndDate = draft.validTo === null || draft.validTo === undefined || draft.validTo === "";
  return (
    <div className="ops-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <div className="ops-modal regulated-price-modal" role="dialog" aria-modal="true" aria-label={`${regulatedCodeLabel(draft.code)} ${editing ? "Editar version" : "Nueva version"}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="ops-modal-head regulated-price-modal-head">
          <div>
            <strong>{regulatedCodeLabel(draft.code)} &gt; {editing ? "Editar version" : "Nueva version"}</strong>
            <span>Las fechas de inicio y fin son inclusivas.</span>
          </div>
          <button onClick={onCancel} title="Cerrar" type="button"><X size={18} /></button>
        </div>
        <div className="ops-modal-body regulated-price-modal-body">
          {error && <div className="module-message error">{error}</div>}
          <section className="billing-detail-section">
            <div className="billing-section-head"><h3>Informacion general</h3></div>
            <div className="regulated-form-grid">
              <label>Nombre<input value={draft.name} onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))} /></label>
              <label>Vigencia desde<input type="date" value={draft.validFrom} onChange={(event) => onChange((current) => ({ ...current, validFrom: event.target.value }))} /></label>
              <label className={noEndDate ? "disabled-field" : ""}>Vigencia hasta<input disabled={noEndDate} type="date" value={draft.validTo ?? ""} onChange={(event) => onChange((current) => ({ ...current, validTo: event.target.value || null }))} /></label>
              <label className="regulated-check-field"><input checked={noEndDate} type="checkbox" onChange={(event) => onChange((current) => ({ ...current, validTo: event.target.checked ? null : current.validTo ?? current.validFrom }))} /> Sin fecha fin</label>
              <label className="regulated-notes-field">Notas<textarea value={draft.notes ?? ""} onChange={(event) => onChange((current) => ({ ...current, notes: event.target.value || null }))} /></label>
            </div>
          </section>
          <RegulatedPriceEditor draft={draft} onChange={onChange} />
          <div className="regulated-modal-actions">
            <button className="secondary-button" disabled={saving} onClick={onCancel} type="button">Cancelar</button>
            <button className="primary-button" disabled={saving} onClick={onSave} type="button"><Save size={16} /> {saving ? "Guardando..." : "Guardar version"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
function RegulatedPriceEditor({ draft, onChange }: { draft: RegulatedPriceVersionInput; onChange: Dispatch<SetStateAction<RegulatedPriceVersionInput>> }) {
  if (draft.code === "RETH") {
    return <DetailSection title="Precio RETh"><div className="regulated-meta-grid"><DetailMetric label="Base" value="BC" /><DetailMetric label="Unidad" value="EUR/MWh" /></div><div className="regulated-single-price"><label>Precio<input type="number" step="0.000001" value={numberInput(draft.reth?.priceEurMwh)} onChange={(event) => onChange((current) => ({ ...current, reth: { priceEurMwh: parseOptionalNumber(event.target.value) } }))} /></label></div></DetailSection>;
  }
  if (draft.code === "EFIH") {
    return <DetailSection title="Precio EFIh"><div className="regulated-meta-grid"><DetailMetric label="Base" value="PF" /><DetailMetric label="Unidad" value="EUR/MWh" /></div><div className="regulated-single-price"><label>Precio<input type="number" step="0.000001" value={numberInput(draft.efih?.priceEurMwh)} onChange={(event) => onChange((current) => ({ ...current, efih: { priceEurMwh: parseOptionalNumber(event.target.value) } }))} /></label></div></DetailSection>;
  }
  if (draft.code === "BONO_SOCIAL") {
    return <DetailSection title="Precio Bono Social"><div className="regulated-meta-grid"><DetailMetric label="Base" value="PF" /><DetailMetric label="Unidad" value="EUR/MWh" /></div><div className="regulated-single-price"><label>Precio<input type="number" step="0.000001" value={numberInput(draft.socialBonus?.priceEurMwh)} onChange={(event) => onChange((current) => ({ ...current, socialBonus: { priceEurMwh: parseOptionalNumber(event.target.value) } }))} /></label></div></DetailSection>;
  }
  if (draft.code === "OTROS") {
    return <DetailSection title="Precio Otros"><div className="regulated-meta-grid"><DetailMetric label="Base" value="BC" /><DetailMetric label="Unidad" value="EUR/MWh" /></div><div className="regulated-single-price"><label>Precio<input type="number" step="0.000001" value={numberInput(draft.other?.priceEurMwh)} onChange={(event) => onChange((current) => ({ ...current, other: { priceEurMwh: parseOptionalNumber(event.target.value) } }))} /></label></div></DetailSection>;
  }
  if (draft.code === "IMU") {
    return <DetailSection title="IMU"><div className="regulated-section-subhead"><div className="regulated-meta-grid"><DetailMetric label="Base" value="Importes economicos" /><DetailMetric label="Unidad" value="%" /></div><span><Info size={14} /> Se aplica sobre la base IMU; Peajes + Cargos queda excluido.</span></div><div className="regulated-single-price"><label>Porcentaje IMU<input type="number" step="0.000001" value={numberInput(draft.imu?.percentage)} onChange={(event) => onChange((current) => ({ ...current, imu: { percentage: parseOptionalNumber(event.target.value) } }))} /></label></div></DetailSection>;
  }
  if (draft.code === "PC3") {
    const rows = draft.pc3 ?? [];
    return <DetailSection title="PC3"><div className="regulated-section-subhead"><div className="regulated-meta-grid"><DetailMetric label="Base" value="BC" /><DetailMetric label="Unidad" value="EUR/MWh" /></div><span><Info size={14} /> Vacio = sin configurar - 0 = precio real</span></div><PeriodPriceTable rows={rows} onChange={(next) => onChange((current) => ({ ...current, pc3: next }))} /></DetailSection>;
  }
  return <DetailSection title="Peajes + Cargos">
    <div className="regulated-price-block"><div className="regulated-section-subhead"><h4>Termino de energia</h4><div className="regulated-meta-grid"><DetailMetric label="Base futura" value="PF" /><DetailMetric label="Unidad" value="EUR/MWh" /></div></div><TollsChargesTable rows={draft.tollsCharges ?? []} fieldPrefix="energy" onChange={(next) => onChange((current) => ({ ...current, tollsCharges: next }))} /></div>
    <div className="regulated-price-block"><div className="regulated-section-subhead"><h4>Termino de potencia</h4><div className="regulated-meta-grid"><DetailMetric label="Base futura" value="Potencia contratada" /><DetailMetric label="Unidad" value="EUR/kW ano" /></div></div><TollsChargesTable rows={draft.tollsCharges ?? []} fieldPrefix="power" onChange={(next) => onChange((current) => ({ ...current, tollsCharges: next }))} /></div>
  </DetailSection>;
}
function PeriodPriceTable({ rows, onChange }: { rows: NonNullable<RegulatedPriceVersionInput["pc3"]>; onChange: (next: NonNullable<RegulatedPriceVersionInput["pc3"]>) => void }) {
  return <div className="billing-lines-scroll"><table className="technical-table billing-compact-table"><thead><tr><th>Tarifa</th>{["P1", "P2", "P3", "P4", "P5", "P6"].map((period) => <th key={period} className="number">{period}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.tariffCode}><td>{row.tariffCode}</td>{(["p1EurMwh", "p2EurMwh", "p3EurMwh", "p4EurMwh", "p5EurMwh", "p6EurMwh"] as const).map((field) => <td key={field} className="number"><input className={row[field] === null ? "empty-price-input" : ""} type="number" step="0.000001" placeholder="sin configurar" value={numberInput(row[field])} onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: parseOptionalNumber(event.target.value) } : item))} /></td>)}</tr>)}</tbody></table></div>;
}
function TollsChargesTable({ rows, fieldPrefix, onChange }: { rows: NonNullable<RegulatedPriceVersionInput["tollsCharges"]>; fieldPrefix: "energy" | "power"; onChange: (next: NonNullable<RegulatedPriceVersionInput["tollsCharges"]>) => void }) {
  const fields = fieldPrefix === "energy"
    ? ["energyP1EurMwh", "energyP2EurMwh", "energyP3EurMwh", "energyP4EurMwh", "energyP5EurMwh", "energyP6EurMwh"] as const
    : ["powerP1EurKwYear", "powerP2EurKwYear", "powerP3EurKwYear", "powerP4EurKwYear", "powerP5EurKwYear", "powerP6EurKwYear"] as const;
  return <div className="billing-lines-scroll"><table className="technical-table billing-compact-table"><thead><tr><th>Tarifa</th>{["P1", "P2", "P3", "P4", "P5", "P6"].map((period) => <th key={period} className="number">{period}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.tariffCode}><td>{row.tariffCode}</td>{fields.map((field) => <td key={field} className="number"><input className={row[field] === null ? "empty-price-input" : ""} type="number" step="0.000001" placeholder="sin configurar" value={numberInput(row[field])} onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: parseOptionalNumber(event.target.value) } : item))} /></td>)}</tr>)}</tbody></table></div>;
}
function PeriodTable({ values }: { values: Record<string, number> }) { const total = PERIODS.filter(Boolean).reduce((sum, p) => sum + (values[p] ?? 0), 0); return <table className="technical-table"><thead><tr><th>Periodo</th><th className="number">kWh</th></tr></thead><tbody>{PERIODS.filter(Boolean).map((period) => <tr key={period}><td>{period}</td><td className="number">{formatEnergy(values[period] ?? 0)}</td></tr>)}<tr><th>Total</th><th className="number">{formatEnergy(total)}</th></tr></tbody></table>; }
function SortTh({ label, field, sort, onSort, align }: { label: string; field: string; sort: { field: string; direction: string }; onSort: (field: string) => void; align?: "right" }) { return <th className={align === "right" ? "number" : undefined}><button className="link-button" onClick={() => onSort(field)} type="button">{label}{sort.field === field ? ` ${sort.direction === "desc" ? "↓" : "↑"}` : ""}</button></th>; }
function Kpi({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "good" | "bad" }) { return <div className={`kpi-card ${tone}`}><span>{label}</span><strong>{Number(value).toLocaleString("es-ES")}</strong></div>; }
function StatusBadge({ status, label }: { status: BillingInvoiceStatus | "READY"; label?: string }) { const tone = status === "READY" ? "valid" : status === "ERROR" ? "error" : status === "WARNING" ? "partial" : "processing"; return <span className={`ops-status-badge ${tone}`}>{label ?? statusLabel(status)}</span>; }
function GlobalBillingStatusBadge({ status }: { status: string }) {
  const tone = status === "MARGIN_OK" ? "valid" : status.includes("WARNING") ? "partial" : status === "CURVE_PENDING" ? "processing" : "muted";
  return <span className={`ops-status-badge ${tone}`}>{globalStatusLabel(status)}</span>;
}
function globalStatusLabel(status: string) {
  const labels: Record<string, string> = {
    CURVE_PENDING: "Pendiente",
    READY_FOR_COSTS: "Lista para costes",
    COSTS_WARNING: "Con avisos",
    READY_FOR_MARGIN: "Lista para margen",
    MARGIN_WARNING: "Con avisos",
    MARGIN_OK: "Correcto",
    ERROR: "Error",
    PENDING: "Pendiente",
    COMPLETED: "Correcto",
    OK: "Correcto"
  };
  return labels[status] ?? status;
}
function JobStatusBadge({ job }: { job: BillingJob }) { const tone = job.status === "SUCCESS" ? "valid" : job.status === "ERROR" ? "error" : job.status === "CANCELLED" ? "muted" : "processing"; return <span className={`ops-status-badge ${tone}`}>{billingJobStatusLabel(job.status)}</span>; }
function isActiveBillingJob(job: BillingJob) { return job.status === "QUEUED" || job.status === "RUNNING"; }
function billingJobTypeLabel(type: string) { return type === "IMPORT_INVOICES" ? "Importacion GISCE" : type === "PROCESS_PENDING" ? "Procesar pendientes" : type === "CALCULATE_MARGINS" ? "Calcular margenes" : type === "CALCULATE_COSTS_AND_MARGINS" ? "Calcular costes y margenes" : type === "FULL_RECALCULATION" ? "Proceso completo" : type; }
function billingJobModalTitle(job: BillingJob) { return job.type === "IMPORT_INVOICES" ? "Importacion GISCE" : billingJobTypeLabel(job.type); }
function billingJobStatusLabel(status: string) { return status === "QUEUED" ? "En cola" : status === "RUNNING" ? "En curso" : status === "SUCCESS" ? "Finalizado" : status === "ERROR" ? "Error" : status === "CANCELLED" ? "Cancelado" : status; }
function formatJobProgress(job: BillingJob) { return job.totalItems > 0 ? `${job.processedItems.toLocaleString("es-ES")} / ${job.totalItems.toLocaleString("es-ES")}` : job.processedItems.toLocaleString("es-ES"); }
function BillingJobProgressBar({ job, compact = false }: { job: BillingJob; compact?: boolean }) {
  const progress = billingJobProgress(job);
  return (
    <div className={`billing-job-progress ${compact ? "compact" : ""} ${progress.tone}`} title={progress.detail}>
      <div className="billing-job-progress-head">
        <span>{progress.label}</span>
        {!compact && <strong>{progress.percent.toLocaleString("es-ES", { maximumFractionDigits: 0 })}%</strong>}
      </div>
      <div className="billing-job-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
        <span style={{ width: `${progress.percent}%` }} />
      </div>
      {compact ? <small>{progress.percent.toLocaleString("es-ES", { maximumFractionDigits: 0 })}%</small> : <em>{progress.detail}</em>}
    </div>
  );
}
function billingJobProgress(job: BillingJob) {
  const done = job.status === "SUCCESS";
  const failed = job.status === "ERROR" || job.status === "CANCELLED";
  if (done) return { percent: 100, label: "Completado", detail: formatJobProgress(job), tone: "good" };
  if (job.type === "FULL_RECALCULATION") {
    const full = fullBillingJobProgress(job);
    return { ...full, tone: failed ? "danger" : "processing" };
  }
  const importResult = billingJobImportResult(job);
  const imported = numberFromRecord(importResult, "processedCount");
  const found = numberFromRecord(importResult, "totalFound");
  const fallbackDone = imported ?? job.processedItems;
  const fallbackTotal = found ?? job.totalItems;
  const percent = progressPercent(fallbackDone, fallbackTotal);
  return {
    percent,
    label: failed ? billingJobStatusLabel(job.status) : isActiveBillingJob(job) ? "En curso" : "Progreso",
    detail: fallbackTotal > 0 ? `${fallbackDone.toLocaleString("es-ES")} / ${fallbackTotal.toLocaleString("es-ES")}` : formatJobProgress(job),
    tone: failed ? "danger" : isActiveBillingJob(job) ? "processing" : "neutral"
  };
}
function fullBillingJobProgress(job: BillingJob) {
  const message = job.message ?? "";
  const importResult = billingJobImportResult(job);
  const imported = numberFromRecord(importResult, "processedCount") ?? 0;
  const found = numberFromRecord(importResult, "totalFound") ?? numberFromRecord(job.result, "totalFound") ?? 0;
  if (message.startsWith("Fase 1/3")) {
    const ratio = progressRatio(imported, found);
    return { percent: Math.round(ratio * 30), label: "Fase 1/3", detail: found > 0 ? `Importando GISCE ${imported.toLocaleString("es-ES")} / ${found.toLocaleString("es-ES")}` : message };
  }
  if (message.startsWith("Fase 2/3")) {
    const ratio = progressRatioFromMessage(message) ?? progressRatio(job.processedItems, job.totalItems);
    return { percent: Math.round(30 + ratio * 30), label: "Fase 2/3", detail: message };
  }
  if (message.startsWith("Fase 3/3")) {
    const ratio = progressRatioFromMessage(message) ?? progressRatio(job.processedItems, job.totalItems);
    return { percent: Math.round(60 + ratio * 40), label: "Fase 3/3", detail: message };
  }
  const percent = found > 0 ? Math.round(progressRatio(imported, found) * 30) : progressPercent(job.processedItems, job.totalItems);
  return { percent, label: isActiveBillingJob(job) ? "En curso" : "Progreso", detail: message || formatJobProgress(job) };
}
function progressRatioFromMessage(message: string) {
  const match = message.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return null;
  return progressRatio(Number(match[1]), Number(match[2]));
}
function progressPercent(done: number, total: number) {
  return Math.round(progressRatio(done, total) * 100);
}
function progressRatio(done: number, total: number) {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(1, done / total));
}
function numberFromRecord(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function billingJobRange(job: BillingJob) {
  const dateFrom = typeof job.params?.dateFrom === "string" ? job.params.dateFrom : null;
  const dateTo = typeof job.params?.dateTo === "string" ? job.params.dateTo : null;
  if (dateFrom || dateTo) return `${dateFrom ?? "-"} - ${dateTo ?? "-"}`;
  return "-";
}
function billingJobGiscePages(job: BillingJob) {
  if (isBillingEconomicRangeJob(job)) return "-";
  const importResult = billingJobImportResult(job);
  const pages = typeof importResult?.giscePages === "number" ? importResult.giscePages : typeof job.result?.giscePages === "number" ? job.result.giscePages : null;
  return pages === null ? "-" : pages.toLocaleString("es-ES");
}
function billingJobFound(job: BillingJob) {
  const totalFound = typeof job.result?.totalFound === "number" ? job.result.totalFound : null;
  return totalFound === null ? "-" : totalFound.toLocaleString("es-ES");
}
function billingJobCreated(job: BillingJob) {
  if (isBillingEconomicRangeJob(job)) return resultNumber(job, "withoutCurve");
  const importResult = billingJobImportResult(job);
  const createdCount = typeof importResult?.createdCount === "number" ? importResult.createdCount : typeof job.result?.createdCount === "number" ? job.result.createdCount : null;
  return createdCount === null ? "-" : createdCount.toLocaleString("es-ES");
}
function billingJobUpdated(job: BillingJob) {
  if (isBillingEconomicRangeJob(job)) return resultNumber(job, "withoutCosts");
  const importResult = billingJobImportResult(job);
  const updatedCount = typeof importResult?.updatedCount === "number" ? importResult.updatedCount : typeof job.result?.updatedCount === "number" ? job.result.updatedCount : null;
  return updatedCount === null ? "-" : updatedCount.toLocaleString("es-ES");
}
function billingJobUnchanged(job: BillingJob) {
  if (isBillingEconomicRangeJob(job)) return resultNumber(job, "withoutPf");
  const importResult = billingJobImportResult(job);
  const unchangedCount = typeof importResult?.unchangedCount === "number" ? importResult.unchangedCount : typeof job.result?.unchangedCount === "number" ? job.result.unchangedCount : null;
  return unchangedCount === null ? "-" : unchangedCount.toLocaleString("es-ES");
}
function billingJobProcessed(job: BillingJob) {
  const processedCount = typeof job.result?.processedCount === "number" ? job.result.processedCount : null;
  const processed = typeof job.result?.processed === "number" ? job.result.processed : null;
  return (processedCount ?? processed ?? job.processedItems).toLocaleString("es-ES");
}
function resultNumber(job: BillingJob, key: string) {
  const value = typeof job.result?.[key] === "number" ? job.result[key] : null;
  return value === null ? "-" : value.toLocaleString("es-ES");
}
function billingJobImportResult(job: BillingJob) {
  return job.result && typeof job.result.import === "object" && job.result.import !== null ? job.result.import as Record<string, unknown> : null;
}
function billingJobDetailRows(job: BillingJob) {
  const rows: Array<{ label: string; value: string }> = [];
  const period = billingJobPeriodLabel(job);
  if (period) rows.push(period);
  if (job.type === "IMPORT_INVOICES") {
    rows.push(
      { label: "Paginas GISCE", value: billingJobGiscePages(job) },
      { label: "Facturas encontradas", value: billingJobFound(job) },
      { label: "Facturas procesadas", value: billingJobProcessed(job) }
    );
  } else {
    rows.push(
      { label: "Elementos previstos", value: job.totalItems.toLocaleString("es-ES") },
      { label: "Elementos procesados", value: billingJobProcessed(job) }
    );
  }
  return rows;
}
function billingJobPeriodLabel(job: BillingJob) {
  const dateFrom = typeof job.params?.dateFrom === "string" ? formatDateOnlyEs(job.params.dateFrom) : null;
  const dateTo = typeof job.params?.dateTo === "string" ? formatDateOnlyEs(job.params.dateTo) : null;
  const byInvoiceDate = isBillingEconomicRangeJob(job) || job.type === "FULL_RECALCULATION";
  if (dateFrom && dateTo && dateFrom === dateTo) return { label: byInvoiceDate ? "Fecha factura" : "Fecha de importacion", value: dateFrom };
  if (dateFrom || dateTo) return { label: byInvoiceDate ? "Rango fecha factura" : "Periodo importado", value: `${dateFrom ?? "-"} - ${dateTo ?? "-"}` };
  return null;
}
function isBillingEconomicRangeJob(job: BillingJob) {
  return job.type === "CALCULATE_MARGINS" || job.type === "CALCULATE_COSTS_AND_MARGINS";
}
function billingJobResultSummary(job: BillingJob) {
  const processed = billingJobProcessed(job);
  if (job.status === "ERROR" || job.errorCount > 0) {
    return { tone: "danger", title: "Importacion finalizada con errores", description: `${processed} facturas procesadas, ${job.warningCount.toLocaleString("es-ES")} advertencias y ${job.errorCount.toLocaleString("es-ES")} errores.` };
  }
  if (job.warningCount > 0) {
    return { tone: "warning", title: "Importacion completada con advertencias", description: `${processed} facturas procesadas, ${job.warningCount.toLocaleString("es-ES")} advertencias y sin errores.` };
  }
  if (job.status === "RUNNING" || job.status === "QUEUED") {
    return { tone: "neutral", title: "Importacion en curso", description: `${processed} facturas procesadas hasta ahora.` };
  }
  return { tone: "good", title: "Importacion completada correctamente", description: `${processed} facturas procesadas sin incidencias.` };
}
function formatDateOnlyEs(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}
function formatCurveSource(source: string) {
  if (!source) return "";
  if (source === "P1") return "TgP1";
  if (source === "PROFILE") return "Perfil";
  if (source.startsWith("PROFILE_")) return "Perfil";
  return source;
}
function curveSummaryText(row: BillingInvoiceRow) {
  const entries = [
    ["F1", row.f1Pct],
    ["TgP1", row.p1Pct],
    ["F5D", row.f5dPct],
    ["P5D", row.p5dPct],
    ["Perfil", row.profilePct]
  ] as const;
  const parts = entries.filter(([, pctValue]) => pctValue > 0).map(([label, pctValue]) => `${label} ${formatPct(pctValue)}`);
  return parts.length ? parts.join(" · ") : "-";
}
function curveTooltip(row: BillingInvoiceRow) {
  return [`F1: ${formatPct(row.f1Pct)}`, `TgP1: ${formatPct(row.p1Pct)}`, `F5D: ${formatPct(row.f5dPct)}`, `P5D: ${formatPct(row.p5dPct)}`, `Perfil: ${formatPct(row.profilePct)}`, `Missing: ${row.expectedIntervals ? formatPct((row.missingIntervals / row.expectedIntervals) * 100) : "0%"}`].join("\n");
}
function issuesTooltip(row: BillingInvoiceRow) {
  return [`Curva: ${row.curveIssueCount ?? row.issueCount ?? 0}`, `Costes: ${row.costIssueCount ?? 0}`, `Margen: ${row.marginIssueCount ?? 0}`].join("\n");
}
function formatInvoiceIssuesBadge(row: BillingInvoiceRow) {
  const total = row.totalIssueCount ?? row.issueCount ?? 0;
  if (!total) return "-";
  return <span className="ops-status-badge partial">{total.toLocaleString("es-ES")} incidencias</span>;
}
function marginToneClass(value: number | null | undefined) {
  if (value === null || value === undefined) return "";
  return value < 0 ? "negative-value" : "positive-value";
}
function rowCanCalculateCosts(row: BillingInvoiceRow) {
  return row.expectedIntervals > 0 && (row.processingStatus === "READY" || row.processingStatus === "WARNING");
}
function statusLabel(status: string) { return status === "" ? "Todos" : status === "READY" ? "READY_FOR_COSTS" : status; }
function totalEnergy(values: Record<string, number>) { return Object.values(values).reduce((sum, value) => sum + value, 0); }
function curveStatusLabel(detail: BillingInvoiceDetail) { return detail.processingStatus === "READY" ? "Preparada" : detail.processingStatus === "WARNING" ? "Con incidencias" : detail.processingStatus === "ERROR" ? "Error" : "Procesada"; }
function reconciliationStatus(differenceKwh: number) { return Math.abs(differenceKwh) >= RECONCILIATION_DIFFERENCE_THRESHOLD_KWH ? "Diferencia" : "OK"; }
function lineConcept(line: BillingInvoiceDetail["lines"][number]) {
  if (!line.lineName) return "-";
  if (/^P[1-6]$/i.test(line.lineName) && line.accountName) return line.accountName.includes("/") ? line.accountName.split("/").pop()?.trim() || line.lineName : line.accountName;
  return line.lineName;
}
function summarizeInvoiceLines(lines: BillingInvoiceDetail["lines"]) {
  const groups = new Map<string, { concept: string; amount: number }>();
  let total = 0;
  for (const line of lines) {
    const concept = lineConcept(line);
    const amount = line.priceSubtotal ?? 0;
    total += amount;
    const current = groups.get(concept) ?? { concept, amount: 0 };
    current.amount += amount;
    groups.set(concept, current);
  }
  return {
    rows: [...groups.values()],
    total
  };
}
function buildInvoiceMargin(lineSummary: ReturnType<typeof summarizeInvoiceLines>, costs: BillingCostsResponse | null, pfTotalKwh: number | null | undefined, economicSign?: number | null) {
  const hasRun = Boolean(costs?.latestRun);
  const sign = economicSign === -1 ? -1 : 1;
  const energyCost = hasRun ? sumCostByNature(costs, "ENERGY") : null;
  const powerCost = hasRun ? sumCostByNature(costs, "POWER") : null;
  const rows = lineSummary.rows.map((row) => {
    const amount = row.amount * sign;
    if (!hasRun) return { ...row, amount, costEur: null as number | null, differenceEur: null as number | null, participatesInMargin: false };
    if (isEnergyInvoiceConcept(row.concept)) {
      const costEur = energyCost ?? 0;
      return { ...row, amount, costEur, differenceEur: amount - costEur, participatesInMargin: true };
    }
    if (isPowerInvoiceConcept(row.concept)) {
      const costEur = powerCost ?? 0;
      return { ...row, amount, costEur, differenceEur: amount - costEur, participatesInMargin: true };
    }
    if (isNetworkSystemAdjustmentConcept(row.concept)) {
      return { ...row, amount, costEur: 0, differenceEur: amount, participatesInMargin: true };
    }
    return { ...row, amount, costEur: null as number | null, differenceEur: null as number | null, participatesInMargin: false };
  });
  const associatedCostEur = hasRun ? rows.filter((row) => row.participatesInMargin).reduce((sum, row) => sum + (row.costEur ?? 0), 0) : null;
  const marginEur = hasRun ? rows.filter((row) => row.participatesInMargin).reduce((sum, row) => sum + (row.differenceEur ?? 0), 0) : null;
  const signedPfKwh = pfTotalKwh && Number.isFinite(pfTotalKwh) ? pfTotalKwh * sign : null;
  const pfMwh = signedPfKwh && signedPfKwh !== 0 ? signedPfKwh / 1000 : null;
  const marginEurMwh = marginEur !== null && pfMwh ? marginEur / pfMwh : null;
  const status: "READY" | "WARNING" | "NOT_AVAILABLE" = !hasRun || !pfMwh ? "NOT_AVAILABLE" : (costs?.latestRun?.incidentsCount ?? 0) > 0 || costs?.status !== "COSTS_READY" ? "WARNING" : "READY";
  return { rows, invoiceTotalEur: lineSummary.total * sign, associatedCostEur, marginEur, marginEurMwh, status };
}
function sumCostByNature(costs: BillingCostsResponse | null, nature: "ENERGY" | "POWER") {
  return costs?.componentSummary.filter((row) => row.nature === nature).reduce((sum, row) => sum + row.costEur, 0) ?? 0;
}
function invoiceConceptKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}
const ENERGY_INVOICE_CONCEPT_KEYS = new Set([
  "ENERGIA",
  "REPERCUSION DE GARANTIAS DE ORIGEN",
  "GARANTIAS DE ORIGEN",
  "COSTE FINANCIERO [%]",
  "COSTE DE GESTION 3,3 €/MES",
  "COSTE DE GESTION 6,75 €/MES",
  "PENALIZACION POR RESOLUCION ANTICIPADA DE CONTRATO",
  "FACTURACION COMPLEMENTARIA IMPUTAD",
  "FACTURACION COMPLEMENTARIA IMPUTADA",
  "SERVICIO ADICIONAL \"TECHO DE PRECIO A 80 €/MWH\""
]);
const ENERGY_INVOICE_CONCEPT_CONTAINS = ["TECHO DE PRECIO"];
const NETWORK_SYSTEM_ADJUSTMENT_CONCEPT_KEYS = new Set([
  "AJUSTE POR COSTES DEL SISTEMA DE RED ELECTRICA DE ESPANA",
  "AJUST PER COSTOS DEL SISTEMA DE LA XARXA ELECTRICA D'ESPANYA"
]);
function isEnergyInvoiceConcept(value: string) {
  const key = invoiceConceptKey(value);
  return ENERGY_INVOICE_CONCEPT_KEYS.has(key) || ENERGY_INVOICE_CONCEPT_CONTAINS.some((token) => key.includes(token));
}
function isPowerInvoiceConcept(value: string) { return invoiceConceptKey(value) === "POTENCIA"; }
function isNetworkSystemAdjustmentConcept(value: string) { return NETWORK_SYSTEM_ADJUSTMENT_CONCEPT_KEYS.has(invoiceConceptKey(value)); }
function marginStatusLabel(status: "READY" | "WARNING" | "NOT_AVAILABLE") { return status === "READY" ? "Margen listo" : status === "WARNING" ? "Provisional" : "Margen no disponible"; }
function curveSourceRows(detail: BillingInvoiceDetail) {
  const expected = detail.curveSummary.expectedIntervals || 0;
  const pct = (count: number) => expected > 0 ? (count / expected) * 100 : 0;
  const candidates = [
    { label: "F1", count: detail.curveSummary.f1Intervals },
    { label: "TgP1", count: detail.curveSummary.p1Intervals },
    { label: "F5D", count: detail.curveSummary.f5dIntervals },
    { label: "P5D", count: detail.curveSummary.p5dIntervals },
    { label: "Perfil", count: detail.curveSummary.profiledIntervals }
  ];
  const missingCount = detail.curveSummary.missingIntervals;
  return {
    sources: candidates.filter((item) => item.count > 0).map((item) => ({ ...item, pct: pct(item.count) })),
    missing: missingCount > 0 ? { count: missingCount, pct: pct(missingCount) } : null
  };
}
function groupIssues(issues: BillingInvoiceDetail["issues"]) {
  const groups = new Map<string, { code: string; count: number; description: string }>();
  for (const issue of issues) {
    const code = String(issue.code ?? "UNKNOWN");
    const current = groups.get(code) ?? { code, count: 0, description: issueDescription(code) };
    current.count += 1;
    groups.set(code, current);
  }
  return [...groups.values()].sort((a, b) => a.code.localeCompare(b.code));
}
function issueDescription(code: string) {
  const descriptions: Record<string, string> = {
    LOSSES_NOT_FOUND: "Perdidas no disponibles",
    BC_NOT_CALCULATED: "BC pendiente",
    PF_NOT_CALCULATED: "PF pendiente",
    CURVE_INCOMPLETE: "Curva incompleta",
    PROFILE_NOT_FOUND: "Perfil no disponible",
    REAL_ENERGY_EXCEEDS_INVOICE: "Energia real superior a factura",
    PERIOD_RECONCILIATION_ERROR: "Diferencia entre factura y curva",
    PERIOD_NOT_RESOLVED: "Periodo tarifario no resuelto",
    TARIFF_NOT_FOUND: "Tarifa no disponible",
    DUPLICATE_F1_INTERVAL: "Intervalo F1 duplicado",
    DUPLICATE_F5D_INTERVAL: "Intervalo F5D duplicado",
    DUPLICATE_P1_INTERVAL: "Intervalo TgP1 duplicado",
    DUPLICATE_P5D_INTERVAL: "Intervalo P5D duplicado",
    PROFILE_VERSION_NOT_RESOLVED: "Version de perfil no resuelta",
    LOSS_VERSION_NOT_RESOLVED: "Version de perdidas no resuelta",
    NO_PENDING_ENERGY: "Sin energia pendiente para perfilar"
  };
  return descriptions[code] ?? "Incidencia de validacion";
}
function formatDate(value: string | null) { return value ? formatFullDate(value.slice(0, 10)) : "-"; }
function formatDateTime(value: string | null) { return value ? new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "-"; }
function formatPct(value: number) { return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value)}%`; }
function formatNumber(value: number | null, digits = 2) { return value === null ? "-" : new Intl.NumberFormat("es-ES", { maximumFractionDigits: digits }).format(value); }
function formatNumberFixed(value: number, digits = 2) { return new Intl.NumberFormat("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value); }
function formatMoney(value: number | null, digits = 2) { return value === null ? "-" : new Intl.NumberFormat("es-ES", { minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits }).format(value); }
function formatCurrencyEuro(value: number | null | undefined) { return value === null || value === undefined ? "-" : `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} €`; }
function formatEuro(value: number | null | undefined, digits = 6) { return value === null || value === undefined ? "-" : `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: digits }).format(value)} €`; }
function formatPrice(value: number | null | undefined) { return value === null || value === undefined ? "-" : `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value)} EUR/MWh`; }
function costStatusLabel(status: string) { return status === "NOT_CALCULATED" ? "Sin calcular" : status === "COSTS_READY" ? "READY" : status; }
function costComponentLabel(code: string) {
  if (code === "OMIE_MD") return "OMIE MD";
  if (code === "RETH") return "RETh";
  if (code === "EFIH") return "EFIh";
  if (code === "PC3_CONFIG") return "PC3";
  if (code === "TOLLS_CHARGES_ENERGY") return "Peajes + Cargos - Energia";
  if (code === "TOLLS_CHARGES_POWER") return "Peajes + Cargos - Potencia";
  if (code === "BONO_SOCIAL") return "Bono Social";
  if (code === "OTROS") return "Otros";
  if (code === "IMU") return "IMU";
  return code;
}
function defaultRegulatedDraft(code: RegulatedPriceCode): RegulatedPriceVersionInput {
  const base = { code, name: `${regulatedCodeLabel(code)} inicial`, validFrom: "2026-01-01", validTo: null, notes: "" };
  if (code === "RETH") return { ...base, reth: { priceEurMwh: 0 } };
  if (code === "EFIH") return { ...base, efih: { priceEurMwh: 0 } };
  if (code === "BONO_SOCIAL") return { ...base, socialBonus: { priceEurMwh: null } };
  if (code === "OTROS") return { ...base, other: { priceEurMwh: null } };
  if (code === "IMU") return { ...base, imu: { percentage: 1.5 } };
  if (code === "PC3") return { ...base, pc3: defaultPc3Rows() };
  return { ...base, tollsCharges: defaultTollsRows() };
}
function versionToDraft(row: RegulatedPriceVersion): RegulatedPriceVersionInput {
  return {
    code: row.code,
    name: row.name,
    validFrom: row.validFrom,
    validTo: row.validTo,
    notes: row.notes,
    reth: row.reth ? { priceEurMwh: row.reth.priceEurMwh } : undefined,
    efih: row.efih ? { priceEurMwh: row.efih.priceEurMwh } : undefined,
    socialBonus: row.socialBonus ? { priceEurMwh: row.socialBonus.priceEurMwh } : undefined,
    other: row.other ? { priceEurMwh: row.other.priceEurMwh } : undefined,
    imu: row.imu ? { percentage: row.imu.percentage } : undefined,
    pc3: row.pc3.map(({ tariffCode, p1EurMwh, p2EurMwh, p3EurMwh, p4EurMwh, p5EurMwh, p6EurMwh }) => ({ tariffCode, p1EurMwh, p2EurMwh, p3EurMwh, p4EurMwh, p5EurMwh, p6EurMwh })),
    tollsCharges: row.tollsCharges.map(({ tariffCode, powerP1EurKwYear, powerP2EurKwYear, powerP3EurKwYear, powerP4EurKwYear, powerP5EurKwYear, powerP6EurKwYear, energyP1EurMwh, energyP2EurMwh, energyP3EurMwh, energyP4EurMwh, energyP5EurMwh, energyP6EurMwh }) => ({ tariffCode, powerP1EurKwYear, powerP2EurKwYear, powerP3EurKwYear, powerP4EurKwYear, powerP5EurKwYear, powerP6EurKwYear, energyP1EurMwh, energyP2EurMwh, energyP3EurMwh, energyP4EurMwh, energyP5EurMwh, energyP6EurMwh }))
  };
}
function defaultPc3Rows() {
  return [
    pc3Row("2.0TD", [0.8, 0.133, 0, 0, 0, 0]),
    pc3Row("3.0TD", [1.082, 0.5, 0.333, 0.25, 0.25, 0]),
    pc3Row("6.1TD", [0.465, 0.213, 0.142, 0.107, 0.107, 0]),
    pc3Row("6.2TD", [0.465, 0.213, 0.142, 0.107, 0.107, 0]),
    pc3Row("6.3TD", [0.465, 0.213, 0.142, 0.107, 0.107, 0]),
    pc3Row("6.4TD", [0.465, 0.213, 0.142, 0.107, 0.107, 0]),
    pc3Row("3.0TDVE", [null, null, null, null, null, null]),
    pc3Row("6.1TDVE", [null, null, null, null, null, null])
  ];
}
function pc3Row(tariffCode: string, values: Array<number | null>) {
  return { tariffCode, p1EurMwh: values[0], p2EurMwh: values[1], p3EurMwh: values[2], p4EurMwh: values[3], p5EurMwh: values[4], p6EurMwh: values[5] };
}
function defaultTollsRows() {
  return [
    tollsRow("2.0TD", [27.704413, 0.725423, 0, 0, 0, 0], [97.553, 29.267, 3.292, 0, 0, 0]),
    tollsRow("3.0TD", [20.376927, 10.617621, 4.481534, 3.886333, 2.513851, 1.442287], [63.352, 38.914, 19.279, 9.795, 4.706, 2.898]),
    tollsRow("6.1TD", [29.595368, 15.514709, 6.801881, 5.393829, 2.125113, 1.004181], [46.274, 26.717, 12.928, 6.678, 2.619, 1.588]),
    tollsRow("6.2TD", [20.103588, 11.115668, 3.709113, 2.728152, 1.265617, 0.605381], [23.88, 13.975, 6.2, 3.083, 1.234, 0.752]),
    tollsRow("6.3TD", [13.053392, 7.587863, 3.062065, 2.332116, 1.010041, 0.481394], [18.775, 10.876, 4.992, 2.494, 1.009, 0.614]),
    tollsRow("6.4TD", [7.905445, 4.585787, 1.460005, 1.15856, 0.492827, 0.230511], [11.275, 6.055, 2.597, 1.286, 0.403, 0.232]),
    tollsRow("3.0TDVE", [3.727958, 1.968328, 0.623462, 0.471799, 0.130238, 0.130238], [187.451, 106.578, 50.751, 26.122, 10.216, 6.227]),
    tollsRow("6.1TDVE", [5.523814, 2.926765, 1.09528, 0.770513, 0.016375, 0.014472], [222.504, 119.324, 55.4, 28.975, 8.585, 5.084])
  ];
}
function tollsRow(tariffCode: string, power: number[], energy: number[]) {
  return { tariffCode, powerP1EurKwYear: power[0], powerP2EurKwYear: power[1], powerP3EurKwYear: power[2], powerP4EurKwYear: power[3], powerP5EurKwYear: power[4], powerP6EurKwYear: power[5], energyP1EurMwh: energy[0], energyP2EurMwh: energy[1], energyP3EurMwh: energy[2], energyP4EurMwh: energy[3], energyP5EurMwh: energy[4], energyP6EurMwh: energy[5] };
}
function parseOptionalNumber(value: string) { return value.trim() === "" ? null : Number(value); }
function numberInput(value: number | null | undefined) { return value === null || value === undefined ? "" : String(value); }
function regulatedCodeLabel(code: RegulatedPriceCode) { return code === "RETH" ? "RETh" : code === "EFIH" ? "EFIh" : code === "TOLLS_CHARGES" ? "Peajes + Cargos" : code === "BONO_SOCIAL" ? "Bono Social" : code === "OTROS" ? "Otros" : code; }
function regulatedStatusLabel(status: string) { return status === "CURRENT" ? "Vigente" : status === "FUTURE" ? "Futura" : status === "FINISHED" ? "Finalizada" : status; }
function RegulatedStatusBadge({ status }: { status: string }) {
  const tone = status === "CURRENT" ? "valid" : status === "FUTURE" ? "processing" : "partial";
  return <span className={`ops-status-badge ${tone}`}>{regulatedStatusLabel(status)}</span>;
}
function regulatedSummary(row: RegulatedPriceVersion) {
  if (row.code === "RETH") return `Precio: ${formatPrice(row.reth?.priceEurMwh ?? null)}`;
  if (row.code === "EFIH") return `Precio: ${formatPrice(row.efih?.priceEurMwh ?? null)}`;
  if (row.code === "BONO_SOCIAL") return `Precio: ${formatPrice(row.socialBonus?.priceEurMwh ?? null)}`;
  if (row.code === "OTROS") return `Precio: ${formatPrice(row.other?.priceEurMwh ?? null)}`;
  if (row.code === "IMU") return `Porcentaje: ${row.imu?.percentage === null || row.imu?.percentage === undefined ? "-" : `${formatNumber(row.imu.percentage, 6)}%`}`;
  if (row.code === "PC3") {
    const complete = row.pc3.filter((item) => [item.p1EurMwh, item.p2EurMwh, item.p3EurMwh, item.p4EurMwh, item.p5EurMwh, item.p6EurMwh].every((value) => value !== null)).length;
    const incomplete = row.pc3.length - complete;
    return incomplete ? `${complete} tarifas completas - ${incomplete} sin configurar` : `${complete} tarifas configuradas`;
  }
  const energyConfigured = row.tollsCharges.every((item) => [item.energyP1EurMwh, item.energyP2EurMwh, item.energyP3EurMwh, item.energyP4EurMwh, item.energyP5EurMwh, item.energyP6EurMwh].every((value) => value !== null));
  const powerConfigured = row.tollsCharges.every((item) => [item.powerP1EurKwYear, item.powerP2EurKwYear, item.powerP3EurKwYear, item.powerP4EurKwYear, item.powerP5EurKwYear, item.powerP6EurKwYear].every((value) => value !== null));
  return `${row.tollsCharges.length} tarifas - Energia ${energyConfigured ? "configurada" : "incompleta"} - Potencia ${powerConfigured ? "configurada" : "incompleta"}`;
}
function functionalPriceError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes("PRICE_VERSION_OVERLAP")) return "Existe otra version cuya vigencia se solapa con estas fechas.";
  if (raw.includes("PRICE_VERSION_NOT_FOUND")) return "No se ha encontrado la version de precios.";
  if (raw.includes("REGULATED_PRICE_VERSION_IN_USE")) return "No se puede eliminar esta version porque esta referenciada por calculos historicos.";
  if (raw.includes("VALID_TO_BEFORE_VALID_FROM")) return "La fecha hasta no puede ser anterior a la fecha desde.";
  if (raw.includes("INVALID_PRICE")) return "Revisa los precios: deben estar vacios o ser mayores o iguales que cero.";
  if (raw.includes("PC3_PRICE_NOT_CONFIGURED")) return "El precio PC3 esta sin configurar para esa tarifa y periodo.";
  return raw || "No se pudo completar la operacion.";
}
function monthStart() { const now = new Date(); return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10); }
function monthEnd() { const now = new Date(); return new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).toISOString().slice(0, 10); }

