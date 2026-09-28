import { useEffect, useMemo, useState } from "react";
import { Eye, FileSpreadsheet, Info, Play, PlugZap, RefreshCw, Save, Search, Trash2, X } from "lucide-react";
import {
  deleteBillingInvoicesByInvoiceDate,
  getBillingGisceConfig,
  getBillingInvoiceCurve,
  getBillingInvoiceDetail,
  getBillingInvoices,
  getBillingJobs,
  processBillingInvoice,
  saveBillingGisceConfig,
  startBillingImportJob,
  startBillingProcessPendingJob,
  testBillingGisceConnection,
  type BillingGisceConfig,
  type BillingGisceConfigInput,
  type BillingGisceConnectionTest,
  type BillingInvoiceCurveResponse,
  type BillingInvoiceDetail,
  type BillingInvoiceRow,
  type BillingInvoiceStatus,
  type BillingInvoicesResponse,
  type BillingJob
} from "../../api";
import { PanelTitle, formatEnergy, formatFullDate } from "../shared/RestoredModuleCommon";

const PAGE_SIZE_OPTIONS = [30, 50, 100] as const;
const STATUS_OPTIONS: Array<BillingInvoiceStatus | ""> = ["", "IMPORTED", "READY", "WARNING", "ERROR", "PROCESSING"];
const PERIODS = ["", "P1", "P2", "P3", "P4", "P5", "P6"];
const CURVE_SOURCES = ["", "F1", "TgP1", "F5D", "P5D", "PROFILE", "MISSING"];
const INITIAL_BILLING_FILTERS = {
  search: "",
  invoiceDateFrom: "",
  invoiceDateTo: "",
  cups: "",
  invoiceNumber: "",
  polissa: "",
  tariff: "",
  status: "" as BillingInvoiceStatus | "",
  curveSource: "",
  withIssues: ""
};

export function BillingDashboardModule() {
  const [importFrom, setImportFrom] = useState(() => monthStart());
  const [importTo, setImportTo] = useState(() => monthEnd());
  const [filters, setFilters] = useState(() => ({ ...INITIAL_BILLING_FILTERS }));
  const [sort, setSort] = useState({ field: "invoiceDate", direction: "desc" });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(30);
  const [response, setResponse] = useState<BillingInvoicesResponse>();
  const [jobs, setJobs] = useState<BillingJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<BillingJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string }>();
  const [gisceConfig, setGisceConfig] = useState<BillingGisceConfig | null>(null);
  const [configDraft, setConfigDraft] = useState<BillingGisceConfigInput>({ username: "", password: "" });
  const [connectionTest, setConnectionTest] = useState<BillingGisceConnectionTest | null>(null);
  const [detail, setDetail] = useState<BillingInvoiceDetail | null>(null);
  const [curve, setCurve] = useState<BillingInvoiceCurveResponse | null>(null);
  const [curveFilter, setCurveFilter] = useState({ source: "", period: "", page: 0, pageSize: 50 });

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
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setPage(0);
      void load(0);
    }, 350);
    return () => window.clearTimeout(handle);
  }, [filters, sort, pageSize]);

  useEffect(() => {
    if (detail) void loadCurve(detail.id, 0);
  }, [curveFilter.source, curveFilter.period, curveFilter.pageSize]);

  useEffect(() => {
    if (!jobs.some(isActiveBillingJob)) return;
    const handle = window.setInterval(() => {
      void refreshJobs();
    }, 3000);
    return () => window.clearInterval(handle);
  }, [jobs]);

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
      setCurveFilter({ source: "", period: "", page: 0, pageSize: 50 });
      await loadCurve(id, 0);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error abriendo factura." });
    } finally {
      setLoading(false);
    }
  }

  async function loadCurve(id: string, nextPage = curveFilter.page) {
    const result = await getBillingInvoiceCurve(id, {
      source: curveFilter.source,
      period: curveFilter.period,
      skip: nextPage * curveFilter.pageSize,
      take: curveFilter.pageSize
    });
    setCurve(result);
    setCurveFilter((current) => ({ ...current, page: nextPage }));
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
        <PanelTitle icon={<FileSpreadsheet size={22} />} title="Cuadro de Mando de Facturacion" subtitle="Importacion GISCE, curvas F1/TgP1/F5D/P5D, perfilado, PF y BC sin costes ni margen." />
      </div>

      {message && <div className={`module-message ${message.tone}`}>{message.text}</div>}

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

      <section className="data-card">
        <div className="data-card-header"><h3>Importar facturas</h3></div>
        <div className="filter-band">
          <label>Fecha factura desde<input disabled={disabled} type="date" value={importFrom} onChange={(event) => setImportFrom(event.target.value)} /></label>
          <label>Fecha factura hasta<input disabled={disabled} type="date" value={importTo} onChange={(event) => setImportTo(event.target.value)} /></label>
          <button className="primary-button" disabled={disabled} onClick={() => void runImport()} type="button"><RefreshCw size={16} /> Importar GISCE</button>
          <button className="secondary-button" disabled={disabled} onClick={() => void runProcessPending()} type="button"><Play size={16} /> Procesar pendientes</button>
          <button className="secondary-button danger-button" disabled={disabled} onClick={() => void runDeleteInvoices()} type="button"><Trash2 size={16} /> Eliminar rango</button>
          {activeJob && <span className="ops-status-badge processing">{billingJobTypeLabel(activeJob.type)}: {activeJob.message ?? activeJob.status}</span>}
        </div>
      </section>

      <section className="panel wide mercado-panel billing-jobs-panel">
        <PanelTitle icon={<RefreshCw size={18} />} title="Trabajos de facturacion" subtitle="importacion, procesamiento y auditoria por fechas" />
        <div className="omie-toolbar compact">
          <button className="secondary-button" disabled={loading} onClick={() => void refreshJobs()} type="button"><RefreshCw size={16} />Actualizar</button>
        </div>
        <div className="mercado-table-shell compact">
          <table className="mercado-table forecast-table compact billing-jobs-table">
            <thead><tr><th>Inicio</th><th>Tipo</th><th>Rango</th><th>Paginas GISCE</th><th>Encontradas</th><th>Nuevas</th><th>Actualizadas</th><th>Sin cambios</th><th>Procesadas</th><th>Estado</th><th>Mensaje</th><th>Progreso</th><th>OK</th><th>Warnings</th><th>Errores</th><th>Info</th></tr></thead>
            <tbody>{jobs.map((job) => <tr key={job.id}><td>{formatDateTime(job.startedAt ?? job.createdAt)}</td><td>{billingJobTypeLabel(job.type)}</td><td>{billingJobRange(job)}</td><td className="number">{billingJobGiscePages(job)}</td><td className="number">{billingJobFound(job)}</td><td className="number">{billingJobCreated(job)}</td><td className="number">{billingJobUpdated(job)}</td><td className="number">{billingJobUnchanged(job)}</td><td className="number">{billingJobProcessed(job)}</td><td><JobStatusBadge job={job} /></td><td>{job.message ?? "-"}</td><td className="number">{formatJobProgress(job)}</td><td className="number">{job.successCount.toLocaleString("es-ES")}</td><td className="number">{job.warningCount.toLocaleString("es-ES")}</td><td className="number">{job.errorCount.toLocaleString("es-ES")}</td><td><button className="icon-button" title="Ver informacion del job" onClick={() => setSelectedJob(job)} type="button"><Info size={16} /></button></td></tr>)}{jobs.length === 0 && <tr><td colSpan={16}>Sin trabajos registrados.</td></tr>}</tbody>
          </table>
        </div>
      </section>


      <section className="panel wide billing-invoices-panel">
        <div className="data-card-header">
          <h3>Facturas</h3>
        </div>
        <BillingFiltersPanel filters={filters} disabled={disabled} onFilterChange={updateFilter} onClear={clearFilters} onSubmit={() => void load(page)} />
        <div className="billing-results-count">{loading ? "Cargando..." : `${visibleFrom}-${visibleTo} de ${(response?.total ?? 0).toLocaleString("es-ES")} facturas`}</div>
        <div className="table-scroll">
          <table className="omie-liquidation-table billing-invoices-table">
            <thead>
              <tr>
                <SortTh label="Factura" field="invoiceNumber" sort={sort} onSort={toggleSort} />
                <SortTh label="Fecha factura" field="invoiceDate" sort={sort} onSort={toggleSort} />
                <SortTh label="CUPS" field="cups" sort={sort} onSort={toggleSort} />
                <th>Poliza</th><th>Periodo consumo</th><th>Tarifa</th><SortTh label="Energia facturada" field="energy" sort={sort} onSort={toggleSort} align="right" /><th className="number">F1 %</th><th className="number">TgP1 %</th><th className="number">F5D %</th><th className="number">P5D %</th><th className="number">Perfil %</th><th className="number">PF</th><th className="number">BC</th><SortTh label="Estado" field="status" sort={sort} onSort={toggleSort} /><th>Incidencias</th><th>Accion</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} onDoubleClick={() => void openDetail(row.id)}>
                  <td><button className="link-button" onClick={() => void openDetail(row.id)} type="button">{row.invoiceNumber ?? row.gisceInvoiceId}</button></td>
                  <td>{formatDate(row.invoiceDate)}</td><td>{row.cups}</td><td>{row.polissaNumber ?? "-"}</td><td>{formatDate(row.periodStart)} - {formatDate(row.periodEnd)}</td><td>{row.tariffCode ?? "-"}</td>
                  <td className="number">{formatEnergy(row.billedEnergyKwh ?? totalEnergy(row.energyByPeriod))}</td><td className="number">{formatPct(row.f1Pct)}</td><td className="number">{formatPct(row.p1Pct)}</td><td className="number">{formatPct(row.f5dPct)}</td><td className="number">{formatPct(row.p5dPct)}</td><td className="number">{formatPct(row.profilePct)}</td><td className="number">{row.expectedIntervals ? formatEnergy(totalEnergy(row.energyByPeriod)) : "-"}</td><td className="number">{row.processingStatus === "READY" ? "OK" : "-"}</td>
                  <td><StatusBadge status={row.processingStatus} /></td><td>{row.issueCount ? <span className="ops-status-badge partial">{row.issueCount}</span> : "-"}</td>
                  <td><button className="icon-button" title="Ver detalle" onClick={() => void openDetail(row.id)} type="button"><Eye size={16} /></button><button className="icon-button" disabled={disabled} title="Procesar/reprocesar" onClick={() => void runProcessOne(row)} type="button"><Play size={16} /></button></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={17}>Sin facturas para los filtros seleccionados.</td></tr>}
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

      {selectedJob && <BillingJobInfoModal job={selectedJob} onClose={() => setSelectedJob(null)} />}
      {detail && <InvoiceDetailModal detail={detail} curve={curve} curveFilter={curveFilter} onClose={() => setDetail(null)} onCurveFilter={setCurveFilter} onCurvePage={(next) => void loadCurve(detail.id, next)} onProcess={() => void runProcessOne(detail)} />}
    </div>
  );
}

function InvoiceDetailModal({ detail, curve, curveFilter, onClose, onCurveFilter, onCurvePage, onProcess }: { detail: BillingInvoiceDetail; curve: BillingInvoiceCurveResponse | null; curveFilter: { source: string; period: string; page: number; pageSize: number }; onClose: () => void; onCurveFilter: (next: { source: string; period: string; page: number; pageSize: number }) => void; onCurvePage: (page: number) => void; onProcess: () => void }) {
  const [showHourlyCurve, setShowHourlyCurve] = useState(false);
  const processed = detail.curveSummary.expectedIntervals > 0;
  const energyTotal = detail.billedEnergyKwh ?? totalEnergy(detail.energyByPeriod);
  const groupedIssues = groupIssues(detail.issues);
  const reconciliationTotal = detail.reconciliation.reduce((total, row) => ({
    invoiceKwh: total.invoiceKwh + row.invoiceKwh,
    curveKwh: total.curveKwh + row.curveKwh,
    differenceKwh: total.differenceKwh + row.differenceKwh
  }), { invoiceKwh: 0, curveKwh: 0, differenceKwh: 0 });
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
            <button className="primary-button billing-process-button" onClick={onProcess} type="button"><Play size={16} /> {processed ? "Reprocesar" : "Procesar factura"}</button>
          </section>

          <DetailSection title="Datos factura">
            <div className="billing-field-grid">
              <DetailField label="Numero" value={detail.invoiceNumber ?? "-"} />
              <DetailField label="ID GISCE" value={detail.gisceInvoiceId} />
              <DetailField label="CUPS" value={detail.cups} />
              <DetailField label="Poliza" value={detail.polissaNumber ?? "-"} />
              <DetailField label="Tarifa" value={detail.tariffCode ?? "-"} />
              <DetailField label="Fecha factura" value={formatDate(detail.invoiceDate)} />
              <DetailField label="Inicio periodo" value={formatDate(detail.periodStart)} />
              <DetailField label="Fin periodo" value={formatDate(detail.periodEnd)} />
              <DetailField label="Estado" value={statusLabel(detail.processingStatus)} />
            </div>
          </DetailSection>

          <div className="billing-two-column">
            <DetailSection title="Energia facturada"><PeriodTable values={detail.energyByPeriod} /></DetailSection>
            <DetailSection title="Curva">
              {processed ? <div className="billing-curve-summary">
                <DetailMetric label="Estado" value={curveStatusLabel(detail)} />
                <DetailMetric label="Intervalos" value={detail.curveSummary.expectedIntervals.toLocaleString("es-ES")} />
                <DetailMetric label="F1" value={`${detail.curveSummary.f1Intervals.toLocaleString("es-ES")} (${formatPct(detail.f1Pct)})`} />
                <DetailMetric label="TgP1" value={`${detail.curveSummary.p1Intervals.toLocaleString("es-ES")} (${formatPct(detail.p1Pct)})`} />
                <DetailMetric label="F5D" value={`${detail.curveSummary.f5dIntervals.toLocaleString("es-ES")} (${formatPct(detail.f5dPct)})`} />
                <DetailMetric label="P5D" value={`${detail.curveSummary.p5dIntervals.toLocaleString("es-ES")} (${formatPct(detail.p5dPct)})`} />
                <DetailMetric label="Perfil" value={`${detail.curveSummary.profiledIntervals.toLocaleString("es-ES")} (${formatPct(detail.profilePct)})`} />
                <DetailMetric label="Missing" value={detail.curveSummary.missingIntervals.toLocaleString("es-ES")} />
                <DetailMetric label="PF" value={formatEnergy(detail.curveSummary.pfTotalKwh)} />
                <DetailMetric label="BC" value={detail.curveSummary.bcTotalKwh === null ? "-" : formatEnergy(detail.curveSummary.bcTotalKwh)} />
              </div> : <div className="billing-unprocessed-curve">
                <DetailMetric label="Estado" value="Sin procesar" />
                <DetailMetric label="Intervalos" value="" />
                <DetailMetric label="F1" value="" />
                <DetailMetric label="TgP1" value="" />
                <DetailMetric label="F5D" value="" />
                <DetailMetric label="P5D" value="" />
                <DetailMetric label="Perfil" value="" />
                <DetailMetric label="PF" value="" />
                <DetailMetric label="BC" value="" />
                <p>Procesa la factura para generar la curva.</p>
              </div>}
            </DetailSection>
          </div>

          <DetailSection title="Lineas de factura">
            <div className="billing-lines-scroll">
              <table className="technical-table billing-lines-table">
                <thead><tr><th>Cuenta</th><th>Concepto</th><th>Periodo/nombre</th><th className="number">Cantidad</th><th className="number">Precio unitario</th><th className="number">Importe</th></tr></thead>
                <tbody>{detail.lines.map((line) => <tr key={line.id}><td>{line.accountName ?? line.accountId ?? "-"}</td><td>{lineConcept(line)}</td><td>{line.lineName ?? "-"}</td><td className="number">{formatNumber(line.quantity)}</td><td className="number">{formatMoney(line.priceUnit, 6)}</td><td className="number">{formatMoney(line.priceSubtotal)}</td></tr>)}</tbody>
              </table>
            </div>
          </DetailSection>

          {processed && <DetailSection title="Reconciliacion">
            <table className="technical-table billing-compact-table"><thead><tr><th>Periodo</th><th className="number">Factura kWh</th><th className="number">Curva kWh</th><th className="number">Diferencia</th><th>Estado</th></tr></thead><tbody>{detail.reconciliation.map((row) => <tr key={row.period}><td>{row.period}</td><td className="number">{formatEnergy(row.invoiceKwh)}</td><td className="number">{formatEnergy(row.curveKwh)}</td><td className="number">{formatEnergy(row.differenceKwh)}</td><td>{Math.abs(row.differenceKwh) <= 0.000001 ? "OK" : "Diferencia"}</td></tr>)}<tr><th>Total</th><th className="number">{formatEnergy(reconciliationTotal.invoiceKwh)}</th><th className="number">{formatEnergy(reconciliationTotal.curveKwh)}</th><th className="number">{formatEnergy(reconciliationTotal.differenceKwh)}</th><th>{Math.abs(reconciliationTotal.differenceKwh) <= 0.000001 ? "OK" : "Diferencia"}</th></tr></tbody></table>
          </DetailSection>}

          <DetailSection title="Incidencias">
            {groupedIssues.length === 0 ? <p className="billing-empty-state">Sin incidencias</p> : <div className="billing-lines-scroll"><table className="technical-table billing-compact-table"><thead><tr><th>Codigo</th><th className="number">Nº intervalos</th><th>Descripcion</th></tr></thead><tbody>{groupedIssues.map((issue) => <tr key={issue.code}><td>{issue.code}</td><td className="number">{issue.count.toLocaleString("es-ES")}</td><td>{issue.description}</td></tr>)}</tbody></table></div>}
          </DetailSection>

          <DetailSection title="Curva horaria">
            {!showHourlyCurve ? <button className="secondary-button" onClick={() => setShowHourlyCurve(true)} type="button">Ver curva horaria</button> : <>
              <div className="filter-band billing-curve-filters"><label>Fuente<select value={curveFilter.source} onChange={(event) => onCurveFilter({ ...curveFilter, source: event.target.value, page: 0 })}>{CURVE_SOURCES.map((item) => <option key={item || "all"} value={item}>{formatCurveSource(item) || "Todas"}</option>)}</select></label><label>Periodo<select value={curveFilter.period} onChange={(event) => onCurveFilter({ ...curveFilter, period: event.target.value, page: 0 })}>{PERIODS.map((item) => <option key={item || "all"} value={item}>{item || "Todos"}</option>)}</select></label></div>
              <div className="billing-lines-scroll"><table className="technical-table billing-curve-table"><thead><tr><th>Fecha/hora</th><th>Periodo</th><th className="number">Consumo</th><th>Fuente</th><th>Resolucion origen</th><th>Perfil</th><th className="number">Perdidas %</th><th className="number">PF</th><th className="number">BC</th></tr></thead><tbody>{curve?.items.map((row) => <tr key={row.id}><td>{formatDateTime(row.datetime)}</td><td>{row.tariffPeriod}</td><td className="number">{formatEnergy(row.consumptionMeterKwh)}</td><td>{formatCurveSource(row.consumptionSource)}</td><td>{row.sourceResolutionMinutes ? `${row.sourceResolutionMinutes} min` : "-"}</td><td>{row.profileVersionId ?? "-"}</td><td className="number">{formatNumber(row.lossPercentage)}</td><td className="number">{formatEnergy(row.consumptionPfKwh)}</td><td className="number">{formatEnergy(row.consumptionBcKwh)}</td></tr>)}{(!curve || curve.items.length === 0) && <tr><td colSpan={9}>Sin curva horaria.</td></tr>}</tbody></table></div>
              <div className="table-pagination"><button disabled={curveFilter.page === 0} onClick={() => onCurvePage(curveFilter.page - 1)} type="button">Anterior</button><span>{curve && curve.total > 0 ? `${curveFilter.page * curveFilter.pageSize + 1}-${Math.min((curveFilter.page + 1) * curveFilter.pageSize, curve.total)} de ${curve.total}` : "0 de 0"}</span><button disabled={!curve || (curveFilter.page + 1) * curveFilter.pageSize >= curve.total} onClick={() => onCurvePage(curveFilter.page + 1)} type="button">Siguiente</button></div>
            </>}
          </DetailSection>
        </div>
      </div>
    </div>
  );
}

function LegacyInvoiceDetailModal({ detail, curve, curveFilter, onClose, onCurveFilter, onCurvePage, onProcess }: { detail: BillingInvoiceDetail; curve: BillingInvoiceCurveResponse | null; curveFilter: { source: string; period: string; page: number; pageSize: number }; onClose: () => void; onCurveFilter: (next: { source: string; period: string; page: number; pageSize: number }) => void; onCurvePage: (page: number) => void; onProcess: () => void }) {
  return (
    <div className="ops-modal-backdrop"><div className="ops-modal billing-detail-modal"><div className="ops-modal-head"><div><h3>Factura {detail.invoiceNumber ?? detail.gisceInvoiceId}</h3><span>{detail.cups} · {detail.polissaNumber ?? "-"} · {detail.tariffCode ?? "-"}</span></div><button className="secondary-button" onClick={onClose} type="button">Cerrar</button></div>
      <div className="filter-band"><StatusBadge status={detail.processingStatus} /><span>Fecha {formatDate(detail.invoiceDate)}</span><span>Periodo {formatDate(detail.periodStart)} - {formatDate(detail.periodEnd)}</span><button className="secondary-button" onClick={onProcess} type="button"><Play size={16} /> Procesar/reprocesar</button></div>
      <DetailSection title="Datos factura"><table className="technical-table"><tbody><tr><th>Numero</th><td>{detail.invoiceNumber}</td><th>ID GISCE</th><td>{detail.gisceInvoiceId}</td></tr><tr><th>CUPS</th><td>{detail.cups}</td><th>Poliza</th><td>{detail.polissaNumber}</td></tr><tr><th>Tarifa</th><td>{detail.tariffCode}</td><th>Estado</th><td>{statusLabel(detail.processingStatus)}</td></tr></tbody></table></DetailSection>
      <DetailSection title="Energia facturada"><PeriodTable values={detail.energyByPeriod} /></DetailSection>
      <DetailSection title="Lineas de factura"><div className="technical-table-scroll"><table className="technical-table"><thead><tr><th>Cuenta</th><th>Concepto</th><th>Periodo/nombre</th><th className="number">Cantidad</th><th className="number">Precio unitario</th><th className="number">Importe</th></tr></thead><tbody>{detail.lines.map((line) => <tr key={line.id}><td>{line.accountName ?? line.accountId ?? "-"}</td><td>{line.accountName ?? "-"}</td><td>{line.lineName ?? "-"}</td><td className="number">{formatNumber(line.quantity)}</td><td className="number">{formatNumber(line.priceUnit, 6)}</td><td className="number">{formatNumber(line.priceSubtotal)}</td></tr>)}</tbody></table></div></DetailSection>
      <DetailSection title="Curva"><div className="kpi-grid"><Kpi label="Intervalos esperados" value={detail.curveSummary.expectedIntervals} /><Kpi label="F1" value={detail.curveSummary.f1Intervals} /><Kpi label="TgP1" value={detail.curveSummary.p1Intervals} /><Kpi label="F5D" value={detail.curveSummary.f5dIntervals} /><Kpi label="P5D" value={detail.curveSummary.p5dIntervals} /><Kpi label="Intervalos perfilados" value={detail.curveSummary.profiledIntervals} /><Kpi label="Missing" value={detail.curveSummary.missingIntervals} /><Kpi label="PF total kWh" value={detail.curveSummary.pfTotalKwh} /></div></DetailSection>
      <DetailSection title="Reconciliacion"><table className="technical-table"><thead><tr><th>Periodo</th><th className="number">Factura</th><th className="number">Curva</th><th className="number">Diferencia</th><th className="number">%</th></tr></thead><tbody>{detail.reconciliation.map((row) => <tr key={row.period}><td>{row.period}</td><td className="number">{formatEnergy(row.invoiceKwh)}</td><td className="number">{formatEnergy(row.curveKwh)}</td><td className="number">{formatEnergy(row.differenceKwh)}</td><td className="number">{row.differencePct === null ? "-" : formatPct(row.differencePct)}</td></tr>)}</tbody></table></DetailSection>
      <DetailSection title="Incidencias"><div className="technical-table-scroll"><table className="technical-table"><thead><tr><th>Codigo</th><th>Fecha/hora</th><th>Periodo</th><th>Detalle</th></tr></thead><tbody>{detail.issues.slice(0, 200).map((issue, index) => <tr key={index}><td>{issue.code ?? "-"}</td><td>{issue.datetime ?? "-"}</td><td>{issue.period ?? "-"}</td><td>{JSON.stringify(issue.detail ?? {})}</td></tr>)}{detail.issues.length === 0 && <tr><td colSpan={4}>Sin incidencias.</td></tr>}</tbody></table></div></DetailSection>
      <DetailSection title="Tabla de curva"><div className="filter-band"><label>Fuente<select value={curveFilter.source} onChange={(event) => onCurveFilter({ ...curveFilter, source: event.target.value, page: 0 })}>{CURVE_SOURCES.map((item) => <option key={item || "all"} value={item}>{formatCurveSource(item) || "Todas"}</option>)}</select></label><label>Periodo<select value={curveFilter.period} onChange={(event) => onCurveFilter({ ...curveFilter, period: event.target.value, page: 0 })}>{PERIODS.map((item) => <option key={item || "all"} value={item}>{item || "Todos"}</option>)}</select></label></div><div className="technical-table-scroll"><table className="technical-table"><thead><tr><th>Fecha/hora</th><th>Periodo</th><th className="number">Consumo contador</th><th>Fuente</th><th>Resolucion origen</th><th>Perfil version</th><th>Perdidas version</th><th className="number">PF</th><th className="number">BC</th></tr></thead><tbody>{curve?.items.map((row) => <tr key={row.id}><td>{formatDateTime(row.datetime)}</td><td>{row.tariffPeriod}</td><td className="number">{formatEnergy(row.consumptionMeterKwh)}</td><td>{formatCurveSource(row.consumptionSource)}</td><td>{row.sourceResolutionMinutes ? `${row.sourceResolutionMinutes} min` : "-"}</td><td>{row.profileVersionId ?? "-"}</td><td>{row.lossVersion ?? "-"}</td><td className="number">{formatEnergy(row.consumptionPfKwh)}</td><td className="number">{formatEnergy(row.consumptionBcKwh)}</td></tr>)}</tbody></table></div><div className="table-pagination"><button disabled={curveFilter.page === 0} onClick={() => onCurvePage(curveFilter.page - 1)} type="button">Anterior</button><span>{curve ? `${curveFilter.page * curveFilter.pageSize + 1}-${Math.min((curveFilter.page + 1) * curveFilter.pageSize, curve.total)} de ${curve.total}` : "-"}</span><button disabled={!curve || (curveFilter.page + 1) * curveFilter.pageSize >= curve.total} onClick={() => onCurvePage(curveFilter.page + 1)} type="button">Siguiente</button></div></DetailSection>
    </div></div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="billing-detail-section"><div className="billing-section-head"><h3>{title}</h3></div>{children}</section>; }
function DetailMetric({ label, value }: { label: string; value: React.ReactNode }) { return <div className="billing-detail-metric"><span>{label}</span><strong>{value}</strong></div>; }
function DetailField({ label, value }: { label: string; value: React.ReactNode }) { return <div className="billing-detail-field"><span>{label}</span><strong>{value}</strong></div>; }
function BillingFiltersPanel({ filters, disabled, onFilterChange, onClear, onSubmit }: { filters: typeof INITIAL_BILLING_FILTERS; disabled: boolean; onFilterChange: (key: keyof typeof INITIAL_BILLING_FILTERS, value: string) => void; onClear: () => void; onSubmit: () => void }) {
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
        <label className="billing-filter-field billing-filter-status">Estado<select value={filters.status} onChange={(event) => onFilterChange("status", event.target.value)}>{STATUS_OPTIONS.map((option) => <option key={option || "all"} value={option}>{statusLabel(option)}</option>)}</select></label>
        <label className="billing-filter-field billing-filter-source">Origen curva<select value={filters.curveSource} onChange={(event) => onFilterChange("curveSource", event.target.value)}>{CURVE_SOURCES.map((option) => <option key={option || "all"} value={option}>{formatCurveSource(option) || "Todos"}</option>)}</select></label>
        <label className="billing-filter-field billing-filter-issues">Incidencias<select value={filters.withIssues} onChange={(event) => onFilterChange("withIssues", event.target.value)}><option value="">Todas</option><option value="true">Con incidencias</option><option value="false">Sin incidencias</option></select></label>
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
function PeriodTable({ values }: { values: Record<string, number> }) { const total = PERIODS.filter(Boolean).reduce((sum, p) => sum + (values[p] ?? 0), 0); return <table className="technical-table"><thead><tr><th>Periodo</th><th className="number">kWh</th></tr></thead><tbody>{PERIODS.filter(Boolean).map((period) => <tr key={period}><td>{period}</td><td className="number">{formatEnergy(values[period] ?? 0)}</td></tr>)}<tr><th>Total</th><th className="number">{formatEnergy(total)}</th></tr></tbody></table>; }
function SortTh({ label, field, sort, onSort, align }: { label: string; field: string; sort: { field: string; direction: string }; onSort: (field: string) => void; align?: "right" }) { return <th className={align === "right" ? "number" : undefined}><button className="link-button" onClick={() => onSort(field)} type="button">{label}{sort.field === field ? ` ${sort.direction === "desc" ? "↓" : "↑"}` : ""}</button></th>; }
function Kpi({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "good" | "bad" }) { return <div className={`kpi-card ${tone}`}><span>{label}</span><strong>{Number(value).toLocaleString("es-ES")}</strong></div>; }
function StatusBadge({ status, label }: { status: BillingInvoiceStatus | "READY"; label?: string }) { const tone = status === "READY" ? "valid" : status === "ERROR" ? "error" : status === "WARNING" ? "partial" : "processing"; return <span className={`ops-status-badge ${tone}`}>{label ?? statusLabel(status)}</span>; }
function JobStatusBadge({ job }: { job: BillingJob }) { const tone = job.status === "SUCCESS" ? "valid" : job.status === "ERROR" ? "error" : "processing"; return <span className={`ops-status-badge ${tone}`}>{billingJobStatusLabel(job.status)}</span>; }
function isActiveBillingJob(job: BillingJob) { return job.status === "QUEUED" || job.status === "RUNNING"; }
function billingJobTypeLabel(type: string) { return type === "IMPORT_INVOICES" ? "Importacion GISCE" : type === "PROCESS_PENDING" ? "Procesar pendientes" : type; }
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
  const pages = typeof job.result?.giscePages === "number" ? job.result.giscePages : null;
  return pages === null ? "-" : pages.toLocaleString("es-ES");
}
function billingJobFound(job: BillingJob) {
  const totalFound = typeof job.result?.totalFound === "number" ? job.result.totalFound : null;
  return totalFound === null ? "-" : totalFound.toLocaleString("es-ES");
}
function billingJobCreated(job: BillingJob) {
  const createdCount = typeof job.result?.createdCount === "number" ? job.result.createdCount : null;
  return createdCount === null ? "-" : createdCount.toLocaleString("es-ES");
}
function billingJobUpdated(job: BillingJob) {
  const updatedCount = typeof job.result?.updatedCount === "number" ? job.result.updatedCount : null;
  return updatedCount === null ? "-" : updatedCount.toLocaleString("es-ES");
}
function billingJobUnchanged(job: BillingJob) {
  const unchangedCount = typeof job.result?.unchangedCount === "number" ? job.result.unchangedCount : null;
  return unchangedCount === null ? "-" : unchangedCount.toLocaleString("es-ES");
}
function billingJobProcessed(job: BillingJob) {
  const processedCount = typeof job.result?.processedCount === "number" ? job.result.processedCount : null;
  const processed = typeof job.result?.processed === "number" ? job.result.processed : null;
  return (processedCount ?? processed ?? job.processedItems).toLocaleString("es-ES");
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
  if (dateFrom && dateTo && dateFrom === dateTo) return { label: "Fecha de importacion", value: dateFrom };
  if (dateFrom || dateTo) return { label: "Periodo importado", value: `${dateFrom ?? "-"} - ${dateTo ?? "-"}` };
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
function statusLabel(status: string) { return status === "" ? "Todos" : status === "READY" ? "READY_FOR_COSTS" : status; }
function totalEnergy(values: Record<string, number>) { return Object.values(values).reduce((sum, value) => sum + value, 0); }
function curveStatusLabel(detail: BillingInvoiceDetail) { return detail.processingStatus === "READY" ? "Preparada" : detail.processingStatus === "WARNING" ? "Con incidencias" : detail.processingStatus === "ERROR" ? "Error" : "Procesada"; }
function lineConcept(line: BillingInvoiceDetail["lines"][number]) {
  if (!line.lineName) return "-";
  if (/^P[1-6]$/i.test(line.lineName) && line.accountName?.includes("/")) return line.accountName.split("/").pop()?.trim() || line.lineName;
  return line.lineName;
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
function formatMoney(value: number | null, digits = 2) { return value === null ? "-" : new Intl.NumberFormat("es-ES", { minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits }).format(value); }
function monthStart() { const now = new Date(); return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10); }
function monthEnd() { const now = new Date(); return new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).toISOString().slice(0, 10); }
