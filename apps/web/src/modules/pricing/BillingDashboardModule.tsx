import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";
import { Calculator, Download, Eye, FileSpreadsheet, Info, Play, PlugZap, Plus, RefreshCw, Save, Search, Trash2, X } from "lucide-react";
import {
  calculateBillingInvoiceCostsAndMargin,
  createBillingRegulatedPriceVersion,
  deleteBillingInvoicesByInvoiceDate,
  deleteBillingRegulatedPriceVersion,
  downloadBillingInvoiceCostRunAudit,
  getBillingGisceConfig,
  getBillingInvoiceCosts,
  getBillingInvoiceDetail,
  getBillingInvoices,
  getBillingInvoicingModes,
  getBillingJobs,
  getBillingRegulatedPriceVersions,
  processBillingInvoice,
  updateBillingRegulatedPriceVersion,
  saveBillingGisceConfig,
  startBillingImportJob,
  startBillingCalculateMarginsJob,
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
  const [billingSection, setBillingSection] = useState<"invoices" | "jobs" | "config">("invoices");
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
  const [selectedJob, setSelectedJob] = useState<BillingJob | null>(null);
  const [loading, setLoading] = useState(false);
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

  const rows = response?.rows ?? [];
  const summary = response?.summary;
  const activeJob = jobs.find(isActiveBillingJob);
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

  async function loadInvoicingModes() {
    try {
      setInvoicingModes(await getBillingInvoicingModes());
    } catch {
      setInvoicingModes([]);
    }
  }

  async function runCalculateMargins() {
    setLoading(true);
    try {
      const job = await startBillingCalculateMarginsJob(importFrom, importTo, marginMode);
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)].slice(0, 10));
      setMessage({ tone: "info", text: job.message ?? "Calculo de costes y margenes lanzado." });
      await refreshJobs();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error calculando margenes." });
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
      <section className="data-card">
        <div className="data-card-header"><h3>Importar facturas</h3></div>
        <div className="filter-band">
          <label>Fecha factura desde<input disabled={disabled} type="date" value={importFrom} onChange={(event) => setImportFrom(event.target.value)} /></label>
          <label>Fecha factura hasta<input disabled={disabled} type="date" value={importTo} onChange={(event) => setImportTo(event.target.value)} /></label>
          <button className="primary-button" disabled={disabled} onClick={() => void runImport()} type="button"><RefreshCw size={16} /> Importar GISCE</button>
          <button className="secondary-button" disabled={disabled} onClick={() => void runProcessPending()} type="button"><Play size={16} /> Procesar pendientes</button>
          <label>Margen<select disabled={disabled} value={marginMode} onChange={(event) => setMarginMode(event.target.value as "PENDING_ONLY" | "RECALCULATE")}><option value="PENDING_ONLY">Calcular pendientes</option><option value="RECALCULATE">Recalcular rango</option></select></label>
          <button className="secondary-button" disabled={disabled} onClick={() => void runCalculateMargins()} type="button"><Play size={16} /> Calcular costes y margenes</button>
          <button className="secondary-button danger-button" disabled={disabled} onClick={() => void runDeleteInvoices()} type="button"><Trash2 size={16} /> Eliminar rango</button>
          {activeJob && <span className="ops-status-badge processing">{billingJobTypeLabel(activeJob.type)}: {activeJob.message ?? activeJob.status}</span>}
        </div>
      </section>
      </>}

      {billingSection === "jobs" && (
      <section className="panel wide mercado-panel billing-jobs-panel">
        <PanelTitle icon={<RefreshCw size={18} />} title="Trabajos de facturacion" subtitle="importacion, procesamiento y auditoria por fechas" />
        <div className="omie-toolbar compact">
          <button className="secondary-button" disabled={loading} onClick={() => void refreshJobs()} type="button"><RefreshCw size={16} />Actualizar</button>
        </div>
        <div className="mercado-table-shell compact">
          <table className="mercado-table forecast-table compact billing-jobs-table">
            <thead><tr><th>Inicio</th><th>Tipo</th><th>Rango</th><th>Paginas GISCE</th><th>Encontradas</th><th>Nuevas/Sin curva</th><th>Actualizadas/Sin costes</th><th>Sin cambios/Sin PF</th><th>Procesadas</th><th>Estado</th><th>Mensaje</th><th>Progreso</th><th>OK</th><th>Warnings</th><th>Errores</th><th>Info</th></tr></thead>
            <tbody>{jobs.map((job) => <tr key={job.id}><td>{formatDateTime(job.startedAt ?? job.createdAt)}</td><td>{billingJobTypeLabel(job.type)}</td><td>{billingJobRange(job)}</td><td className="number">{billingJobGiscePages(job)}</td><td className="number">{billingJobFound(job)}</td><td className="number">{billingJobCreated(job)}</td><td className="number">{billingJobUpdated(job)}</td><td className="number">{billingJobUnchanged(job)}</td><td className="number">{billingJobProcessed(job)}</td><td><JobStatusBadge job={job} /></td><td>{job.message ?? "-"}</td><td className="number">{formatJobProgress(job)}</td><td className="number">{job.successCount.toLocaleString("es-ES")}</td><td className="number">{job.warningCount.toLocaleString("es-ES")}</td><td className="number">{job.errorCount.toLocaleString("es-ES")}</td><td><button className="icon-button" title="Ver informacion del job" onClick={() => setSelectedJob(job)} type="button"><Info size={16} /></button></td></tr>)}{jobs.length === 0 && <tr><td colSpan={16}>Sin trabajos registrados.</td></tr>}</tbody>
          </table>
        </div>
      </section>
      )}


      {billingSection === "invoices" && (
      <section className="panel wide billing-invoices-panel">
        <div className="data-card-header">
          <h3>Facturas</h3>
        </div>
        <BillingFiltersPanel filters={filters} invoicingModes={invoicingModes} disabled={disabled} onFilterChange={updateFilter} onClear={clearFilters} onSubmit={() => void load(page)} />
        <div className="billing-results-count">{loading ? "Cargando..." : `${visibleFrom}-${visibleTo} de ${(response?.total ?? 0).toLocaleString("es-ES")} facturas`}</div>
        <div className="table-scroll">
          <table className="omie-liquidation-table billing-invoices-table">
            <thead>
              <tr>
                <SortTh label="Factura" field="invoiceNumber" sort={sort} onSort={toggleSort} />
                <SortTh label="Fecha factura" field="invoiceDate" sort={sort} onSort={toggleSort} />
                <SortTh label="CUPS" field="cups" sort={sort} onSort={toggleSort} />
                <th>Poliza</th><th>Periodo consumo</th><th>Tarifa</th><SortTh label="PF kWh" field="pf" sort={sort} onSort={toggleSort} align="right" /><th>Curva</th><SortTh label="Costes EUR" field="costs" sort={sort} onSort={toggleSort} align="right" /><th className="number">Importe asociado</th><SortTh label="Margen EUR" field="margin" sort={sort} onSort={toggleSort} align="right" /><SortTh label="Margen EUR/MWh" field="marginEurMwh" sort={sort} onSort={toggleSort} align="right" /><SortTh label="Estado" field="globalStatus" sort={sort} onSort={toggleSort} /><th>Incidencias</th><th>Accion</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} onDoubleClick={() => void openDetail(row.id)}>
                  <td><button className="link-button" onClick={() => void openDetail(row.id)} type="button">{row.invoiceNumber ?? row.gisceInvoiceId}</button></td>
                  <td>{formatDate(row.invoiceDate)}</td><td>{row.cups}</td><td>{row.polissaNumber ?? "-"}</td><td>{formatDate(row.periodStart)} - {formatDate(row.periodEnd)}</td><td>{row.tariffCode ?? "-"}</td>
                  <td className="number">{row.pfTotalKwh === null || row.pfTotalKwh === undefined ? "-" : formatEnergy(row.pfTotalKwh)}</td><td title={curveTooltip(row)}>{row.curveSummaryText ?? curveSummaryText(row)}</td><td className="number">{formatCurrencyEuro(row.totalCostEur)}</td><td className="number">{formatCurrencyEuro(row.associatedRevenueEur)}</td><td className={`number ${marginToneClass(row.marginEur)}`}>{formatCurrencyEuro(row.marginEur)}</td><td className={`number ${marginToneClass(row.marginEurMwh)}`}>{row.marginEurMwh === null || row.marginEurMwh === undefined ? "-" : `${formatNumberFixed(row.marginEurMwh, 2)} €/MWh`}</td>
                  <td><GlobalBillingStatusBadge status={row.globalStatus ?? "CURVE_PENDING"} /></td><td title={issuesTooltip(row)}>{(row.totalIssueCount ?? row.issueCount) ? <span className="ops-status-badge partial">{(row.totalIssueCount ?? row.issueCount).toLocaleString("es-ES")}</span> : "-"}</td>
                  <td><div className="billing-row-actions"><button className="icon-button" title="Ver detalle" onClick={() => void openDetail(row.id)} type="button"><Eye size={16} /></button><button className="icon-button" disabled={Boolean(activeJob) || rowActionId === row.id} title="Procesar/reprocesar curva" onClick={() => void runProcessOne(row)} type="button"><Play size={16} /></button><button className="icon-button" disabled={!rowCanCalculateCosts(row) || rowActionId === row.id} title="Calcular/recalcular costes y margen" onClick={() => void runCalculateCostsAndMarginForRow(row)} type="button"><Calculator size={16} /></button><button className="icon-button" disabled={!row.costRunId || rowActionId === row.id} title="Descargar Excel de auditoria" onClick={() => void exportAuditForRow(row)} type="button"><Download size={16} /></button></div></td>
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
        <BillingSummaryStrip summary={summary} />
      </section>
      )}

      {selectedJob && <BillingJobInfoModal job={selectedJob} onClose={() => setSelectedJob(null)} />}
      {regulatedEditorOpen && <RegulatedPriceVersionModal draft={regulatedDraft} editing={Boolean(editingRegulatedId)} error={regulatedError} saving={regulatedSaving} onChange={setRegulatedDraft} onCancel={cancelRegulatedVersionEdit} onSave={() => void saveRegulatedVersion()} />}
      {detail && <InvoiceDetailModal detail={detail} costs={costs} onClose={() => setDetail(null)} onProcess={() => void runProcessOne(detail)} onCalculateCosts={() => void runCalculateCosts(detail.id)} />}
    </div>
  );
}

function InvoiceDetailModal({ detail, costs, onClose, onProcess, onCalculateCosts }: { detail: BillingInvoiceDetail; costs: BillingCostsResponse | null; onClose: () => void; onProcess: () => void; onCalculateCosts: () => void }) {
  const [exportingAudit, setExportingAudit] = useState(false);
  const processed = detail.curveSummary.expectedIntervals > 0;
  const energyTotal = detail.billedEnergyKwh ?? totalEnergy(detail.energyByPeriod);
  const groupedIssues = groupIssues(detail.issues);
  const lineSummary = useMemo(() => summarizeInvoiceLines(detail.lines), [detail.lines]);
  const marginSummary = useMemo(() => buildInvoiceMargin(lineSummary, costs, detail.curveSummary.pfTotalKwh), [lineSummary, costs, detail.curveSummary.pfTotalKwh]);
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
  return (
    <div className="billing-filters-zone">
      <span className="billing-filters-eyebrow">Filtros</span>
      <div className="billing-filters-grid">
        <label className="billing-filter-field billing-filter-search">Búsqueda<span className="billing-search-input"><Search size={15} /><input placeholder="Factura, CUPS o póliza" value={filters.search} onChange={(event) => onFilterChange("search", event.target.value)} /></span></label>
        <label className="billing-filter-field billing-filter-date-from">Fecha desde<input type="date" value={filters.invoiceDateFrom} onChange={(event) => onFilterChange("invoiceDateFrom", event.target.value)} /></label>
        <label className="billing-filter-field billing-filter-date-to">Fecha hasta<input type="date" value={filters.invoiceDateTo} onChange={(event) => onFilterChange("invoiceDateTo", event.target.value)} /></label>
        <label className="billing-filter-field billing-filter-cups">CUPS<input value={filters.cups} onChange={(event) => onFilterChange("cups", event.target.value)} /></label>
        <label className="billing-filter-field billing-filter-invoice">Número factura<input value={filters.invoiceNumber} onChange={(event) => onFilterChange("invoiceNumber", event.target.value)} /></label>
        <label className="billing-filter-field billing-filter-polissa">Póliza<input value={filters.polissa} onChange={(event) => onFilterChange("polissa", event.target.value)} /></label>
        <label className="billing-filter-field billing-filter-tariff">Tarifa<input value={filters.tariff} onChange={(event) => onFilterChange("tariff", event.target.value)} /></label>
        <label className="billing-filter-field">Modo de facturacion<select value={filters.invoicingMode} onChange={(event) => onFilterChange("invoicingMode", event.target.value)}><option value="">Todos</option>{invoicingModes.map((mode) => <option key={`${mode.id}-${mode.name}`} value={mode.name}>{mode.name}</option>)}</select></label>
        <label className="billing-filter-field billing-filter-status">Estado<select value={filters.status} onChange={(event) => onFilterChange("status", event.target.value)}>{STATUS_OPTIONS.map((option) => <option key={option || "all"} value={option}>{statusLabel(option)}</option>)}</select></label>
        <label className="billing-filter-field">Estado margen<select value={filters.marginStatus} onChange={(event) => onFilterChange("marginStatus", event.target.value)}><option value="">Todos</option><option value="READY">READY</option><option value="WARNING">WARNING</option><option value="NOT_AVAILABLE">NOT_AVAILABLE</option></select></label>
        <label className="billing-filter-field">Margen min<input type="number" step="0.01" value={filters.marginEurMin} onChange={(event) => onFilterChange("marginEurMin", event.target.value)} /></label>
        <label className="billing-filter-field">Margen max<input type="number" step="0.01" value={filters.marginEurMax} onChange={(event) => onFilterChange("marginEurMax", event.target.value)} /></label>
        <label className="billing-filter-field">Margen €/MWh min<input type="number" step="0.01" value={filters.marginEurMwhMin} onChange={(event) => onFilterChange("marginEurMwhMin", event.target.value)} /></label>
        <label className="billing-filter-field">Margen €/MWh max<input type="number" step="0.01" value={filters.marginEurMwhMax} onChange={(event) => onFilterChange("marginEurMwhMax", event.target.value)} /></label>
        <label className="billing-filter-field billing-filter-source">Origen curva<select value={filters.curveSource} onChange={(event) => onFilterChange("curveSource", event.target.value)}>{CURVE_SOURCES.map((option) => <option key={option || "all"} value={option}>{formatCurveSource(option) || "Todos"}</option>)}</select></label>
        <label className="billing-filter-field billing-filter-issues">Incidencias<select value={filters.withIssues} onChange={(event) => onFilterChange("withIssues", event.target.value)}><option value="">Todas</option><option value="true">Con incidencias</option><option value="false">Sin incidencias</option></select></label>
        <label className="billing-filter-field">Incidencias total<select value={filters.hasAnyIssues} onChange={(event) => onFilterChange("hasAnyIssues", event.target.value)}><option value="">Todas</option><option value="true">Con incidencias</option><option value="false">Sin incidencias</option></select></label>
        <div className="billing-filter-actions">
          <button className="secondary-button billing-clear-filters-button" disabled={disabled} onClick={onClear} type="button">Limpiar filtros</button>
          <button className="primary-button" disabled={disabled} onClick={onSubmit} type="button"><Search size={16} /> Consultar</button>
        </div>
      </div>
    </div>
  );
}
function BillingSummaryStrip({ summary }: { summary: BillingInvoicesResponse["summary"] | undefined }) {
  const items = [
    { label: "Facturas", value: summary?.invoices ?? 0 },
    { label: "Preparadas", value: summary?.ready ?? 0 },
    { label: "Facturas con F1", value: summary?.withF1 ?? 0 },
    { label: "Facturas con TgP1", value: summary?.withP1 ?? 0 },
    { label: "Facturas con F5D", value: summary?.withF5d ?? 0 },
    { label: "Facturas con P5D", value: summary?.withP5d ?? 0 },
    { label: "Facturas con perfilado", value: summary?.withProfile ?? 0 },
    { label: "Con incidencias", value: summary?.withIssues ?? 0, tone: summary?.withIssues ? "bad" : "good" }
  ];
  return <div className="billing-summary-strip">{items.map((item) => <span key={item.label} className={item.tone ?? ""}><b>{item.label}</b><strong>{item.value.toLocaleString("es-ES")}</strong></span>)}</div>;
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
    CURVE_PENDING: "Curva pendiente",
    READY_FOR_COSTS: "Lista para costes",
    COSTS_WARNING: "Costes warning",
    READY_FOR_MARGIN: "Lista para margen",
    MARGIN_WARNING: "Margen warning",
    MARGIN_OK: "Margen OK"
  };
  return labels[status] ?? status;
}
function JobStatusBadge({ job }: { job: BillingJob }) { const tone = job.status === "SUCCESS" ? "valid" : job.status === "ERROR" ? "error" : "processing"; return <span className={`ops-status-badge ${tone}`}>{billingJobStatusLabel(job.status)}</span>; }
function isActiveBillingJob(job: BillingJob) { return job.status === "QUEUED" || job.status === "RUNNING"; }
function billingJobTypeLabel(type: string) { return type === "IMPORT_INVOICES" ? "Importacion GISCE" : type === "PROCESS_PENDING" ? "Procesar pendientes" : type === "CALCULATE_MARGINS" ? "Calcular costes y margenes" : type; }
function billingJobModalTitle(job: BillingJob) { return job.type === "IMPORT_INVOICES" ? "Importacion GISCE" : billingJobTypeLabel(job.type); }
function billingJobStatusLabel(status: string) { return status === "QUEUED" ? "En cola" : status === "RUNNING" ? "En curso" : status === "SUCCESS" ? "Finalizado" : status === "ERROR" ? "Error" : status; }
function formatJobProgress(job: BillingJob) { return job.totalItems > 0 ? `${job.processedItems.toLocaleString("es-ES")} / ${job.totalItems.toLocaleString("es-ES")}` : job.processedItems.toLocaleString("es-ES"); }
function billingJobRange(job: BillingJob) {
  const dateFrom = typeof job.params?.dateFrom === "string" ? job.params.dateFrom : null;
  const dateTo = typeof job.params?.dateTo === "string" ? job.params.dateTo : null;
  if (dateFrom || dateTo) return `${dateFrom ?? "-"} - ${dateTo ?? "-"}`;
  return "-";
}
function billingJobGiscePages(job: BillingJob) {
  if (job.type === "CALCULATE_MARGINS") return "-";
  const pages = typeof job.result?.giscePages === "number" ? job.result.giscePages : null;
  return pages === null ? "-" : pages.toLocaleString("es-ES");
}
function billingJobFound(job: BillingJob) {
  const totalFound = typeof job.result?.totalFound === "number" ? job.result.totalFound : null;
  return totalFound === null ? "-" : totalFound.toLocaleString("es-ES");
}
function billingJobCreated(job: BillingJob) {
  if (job.type === "CALCULATE_MARGINS") return resultNumber(job, "withoutCurve");
  const createdCount = typeof job.result?.createdCount === "number" ? job.result.createdCount : null;
  return createdCount === null ? "-" : createdCount.toLocaleString("es-ES");
}
function billingJobUpdated(job: BillingJob) {
  if (job.type === "CALCULATE_MARGINS") return resultNumber(job, "withoutCosts");
  const updatedCount = typeof job.result?.updatedCount === "number" ? job.result.updatedCount : null;
  return updatedCount === null ? "-" : updatedCount.toLocaleString("es-ES");
}
function billingJobUnchanged(job: BillingJob) {
  if (job.type === "CALCULATE_MARGINS") return resultNumber(job, "withoutPf");
  const unchangedCount = typeof job.result?.unchangedCount === "number" ? job.result.unchangedCount : null;
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
  if (dateFrom && dateTo && dateFrom === dateTo) return { label: job.type === "CALCULATE_MARGINS" ? "Fecha factura" : "Fecha de importacion", value: dateFrom };
  if (dateFrom || dateTo) return { label: job.type === "CALCULATE_MARGINS" ? "Rango fecha factura" : "Periodo importado", value: `${dateFrom ?? "-"} - ${dateTo ?? "-"}` };
  return null;
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
  if (/^P[1-6]$/i.test(line.lineName) && line.accountName?.includes("/")) return line.accountName.split("/").pop()?.trim() || line.lineName;
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
function buildInvoiceMargin(lineSummary: ReturnType<typeof summarizeInvoiceLines>, costs: BillingCostsResponse | null, pfTotalKwh: number | null | undefined) {
  const hasRun = Boolean(costs?.latestRun);
  const energyCost = hasRun ? sumCostByNature(costs, "ENERGY") : null;
  const powerCost = hasRun ? sumCostByNature(costs, "POWER") : null;
  const rows = lineSummary.rows.map((row) => {
    if (!hasRun) return { ...row, costEur: null as number | null, differenceEur: null as number | null, participatesInMargin: false };
    if (isEnergyInvoiceConcept(row.concept)) {
      const costEur = energyCost ?? 0;
      return { ...row, costEur, differenceEur: row.amount - costEur, participatesInMargin: true };
    }
    if (isPowerInvoiceConcept(row.concept)) {
      const costEur = powerCost ?? 0;
      return { ...row, costEur, differenceEur: row.amount - costEur, participatesInMargin: true };
    }
    if (isNetworkSystemAdjustmentConcept(row.concept)) {
      return { ...row, costEur: 0, differenceEur: row.amount, participatesInMargin: true };
    }
    return { ...row, costEur: null as number | null, differenceEur: null as number | null, participatesInMargin: false };
  });
  const associatedCostEur = hasRun ? rows.filter((row) => row.participatesInMargin).reduce((sum, row) => sum + (row.costEur ?? 0), 0) : null;
  const marginEur = hasRun ? rows.filter((row) => row.participatesInMargin).reduce((sum, row) => sum + (row.differenceEur ?? 0), 0) : null;
  const pfMwh = pfTotalKwh && Number.isFinite(pfTotalKwh) && pfTotalKwh > 0 ? pfTotalKwh / 1000 : null;
  const marginEurMwh = marginEur !== null && pfMwh ? marginEur / pfMwh : null;
  const status: "READY" | "WARNING" | "NOT_AVAILABLE" = !hasRun || !pfMwh ? "NOT_AVAILABLE" : (costs?.latestRun?.incidentsCount ?? 0) > 0 || costs?.status !== "COSTS_READY" ? "WARNING" : "READY";
  return { rows, invoiceTotalEur: lineSummary.total, associatedCostEur, marginEur, marginEurMwh, status };
}
function sumCostByNature(costs: BillingCostsResponse | null, nature: "ENERGY" | "POWER") {
  return costs?.componentSummary.filter((row) => row.nature === nature).reduce((sum, row) => sum + row.costEur, 0) ?? 0;
}
function invoiceConceptKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}
function isEnergyInvoiceConcept(value: string) { return invoiceConceptKey(value) === "ENERGIA"; }
function isPowerInvoiceConcept(value: string) { return invoiceConceptKey(value) === "POTENCIA"; }
function isNetworkSystemAdjustmentConcept(value: string) { return invoiceConceptKey(value) === "AJUSTE POR COSTES DEL SISTEMA DE RED ELECTRICA DE ESPANA"; }
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

