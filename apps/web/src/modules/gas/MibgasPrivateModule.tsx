import { useEffect, useMemo, useState } from "react";
import { BarChart3, Check, Clock3, Download, Eye, FileDown, RefreshCw, RotateCw, Search, TrendingUp } from "lucide-react";
import { TechnicalDataTable } from "../../components/technical-data-table/TechnicalDataTable";
import type { RowQuality, TechnicalColumn } from "../../components/technical-data-table/TechnicalDataTableTypes";
import {
  downloadMibgasPrivateNetPositions,
  downloadMibgasPrivateTransactions,
  executeMibgasPrivateAutomation,
  getMibgasPrivateAutomationConfig,
  getMibgasPrivateDirectory,
  getMibgasPrivateDownloadDetail,
  getMibgasPrivateDownloads,
  getMibgasPrivateStatus,
  refreshMibgasPrivateDirectory,
  saveMibgasPrivateAutomationConfig,
  testMibgasPrivateConnection,
  type MibgasPrivateAutomationConfig,
  type MibgasPrivateAutomationRunResponse,
  type MibgasDirectoryEntry,
  type MibgasPrivateDownloadDetail,
  type MibgasPrivateDownloadRow,
  type MibgasPrivateDownloadStatus,
  type MibgasPrivateQueryKind,
  type MibgasPrivateStatus
} from "../../api";
import { formatDateTime } from "../ree-losses/ReeLossesHelpers";
import { formatDurationMs } from "../omie/descargas/OmieDescargasControlModule";
import { LoadStatusBadge, PanelTitle, formatFullDate, formatNumber } from "../shared/RestoredModuleCommon";

const DEFAULT_QUERY_CODE = "3144";
const ENABLED_QUERY_CODES = ["3140", "3144"] as const;
const AUTOMATION_HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const AUTOMATION_MINUTE_OPTIONS = ["00", "15", "30", "45"];
const QUERY_OPTIONS_FALLBACK: MibgasDirectoryEntry[] = [
  { queryCode: "3140", title: "Transacciones por periodo de entrega", section: "Transacciones por cartera de negociacion", queryType: "ENCOL" },
  { queryCode: "3144", title: "Posicion neta por periodo de entrega", section: "Transacciones por cartera de negociacion", queryType: "ENCOL" }
];

type Message = { tone: "success" | "error" | "info"; text: string };

type DownloadFilters = {
  sessionDateFrom?: string;
  sessionDateTo?: string;
  queryKind?: MibgasPrivateQueryKind | "";
  status?: MibgasPrivateDownloadStatus | "";
};

type DownloadDraft = {
  queryCode: string;
  sessionDate: string;
};

const defaultDateValue = () => new Date().toISOString().slice(0, 10);

export function MibgasPrivateModule() {
  const [status, setStatus] = useState<MibgasPrivateStatus>();
  const [directory, setDirectory] = useState<MibgasDirectoryEntry[]>([]);
  const [downloads, setDownloads] = useState<MibgasPrivateDownloadRow[]>([]);
  const [filters, setFilters] = useState<DownloadFilters>({});
  const [draft, setDraft] = useState<DownloadDraft>({ queryCode: DEFAULT_QUERY_CODE, sessionDate: defaultDateValue() });
  const [automationConfig, setAutomationConfig] = useState<MibgasPrivateAutomationConfig>();
  const [latestAutomationRun, setLatestAutomationRun] = useState<MibgasPrivateAutomationRunResponse>();
  const [detail, setDetail] = useState<MibgasPrivateDownloadDetail>();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<Message>();

  const queryOptions = useMemo(() => buildMarketQueryOptions(directory), [directory]);
  const historyColumns = useMemo(() => buildMibgasDownloadHistoryColumns(showDetail, redownload), []);

  async function load(nextFilters = filters) {
    setLoading(true);
    try {
      const [statusResult, directoryResult, downloadsResult, automationResult] = await Promise.all([
        getMibgasPrivateStatus(),
        getMibgasPrivateDirectory(),
        getMibgasPrivateDownloads({
          queryKind: nextFilters.queryKind || undefined,
          status: nextFilters.status || undefined,
          sessionDateFrom: nextFilters.sessionDateFrom || undefined,
          sessionDateTo: nextFilters.sessionDateTo || undefined
        }),
        getMibgasPrivateAutomationConfig()
      ]);
      setStatus(statusResult);
      setDirectory(directoryResult);
      setDownloads(downloadsResult);
      setAutomationConfig(automationResult);
      if (!draft.queryCode && directoryResult.length > 0) {
        const options = buildMarketQueryOptions(directoryResult);
        setDraft((current) => ({ ...current, queryCode: options.find((item) => item.queryCode === DEFAULT_QUERY_CODE)?.queryCode ?? options[0]?.queryCode ?? DEFAULT_QUERY_CODE }));
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando MIBGAS Market." });
    } finally {
      setLoading(false);
    }
  }

  async function refreshDownloads(nextFilters = filters) {
    const [statusResult, downloadsResult, automationResult] = await Promise.all([
      getMibgasPrivateStatus(),
        getMibgasPrivateDownloads({
          queryKind: nextFilters.queryKind || undefined,
          status: nextFilters.status || undefined,
          sessionDateFrom: nextFilters.sessionDateFrom || undefined,
          sessionDateTo: nextFilters.sessionDateTo || undefined
        }),
      getMibgasPrivateAutomationConfig()
      ]);
      setStatus(statusResult);
      setDownloads(downloadsResult);
      setAutomationConfig(automationResult);
  }

  useEffect(() => {
    void load();
  }, []);

  async function runConnectionTest() {
    setLoading(true);
    setMessage(undefined);
    try {
      const result = await testMibgasPrivateConnection();
      setMessage({ tone: "success", text: `${result.message}: ${result.user.agentCode ?? "agente sin codigo"} (${result.environment}).` });
      await load();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error probando conexion privada MIBGAS." });
    } finally {
      setLoading(false);
    }
  }

  async function runDirectoryRefresh() {
    setLoading(true);
    setMessage(undefined);
    try {
      const result = await refreshMibgasPrivateDirectory();
      setMessage({ tone: "success", text: `Directorio MIBGAS actualizado: ${formatNumber(result.total)} consultas.` });
      await load();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error actualizando directorio MIBGAS." });
    } finally {
      setLoading(false);
    }
  }

  async function runDownload(force = false, row?: MibgasPrivateDownloadRow) {
    const queryCode = row?.queryCode ?? draft.queryCode;
    const sessionDate = row?.sessionDate ?? draft.sessionDate;
    if (!queryCode || !sessionDate) {
      setMessage({ tone: "error", text: "Selecciona consulta y dia gas." });
      return;
    }

    setLoading(true);
    setMessage(undefined);
    try {
      const selectedQuery = queryOptions.find((query) => query.queryCode === queryCode) ?? directory.find((query) => query.queryCode === queryCode);
      if (!isEnabledQueryCode(queryCode)) {
        throw new Error("Solo estan habilitadas las consultas MIBGAS 3140 y 3144.");
      }
      const result = isNetPositionQuery(selectedQuery)
        ? await downloadMibgasPrivateNetPositions(sessionDate, force, queryCode)
        : await downloadMibgasPrivateTransactions(sessionDate, force, queryCode);
      setMessage({ tone: result.download.status === "ERROR" ? "error" : "success", text: `${result.download.queryCode ?? queryCode}: ${formatNumber(result.records)} registros.` });
      await refreshDownloads();
      if (detail?.id === row?.id) {
        setDetail(await getMibgasPrivateDownloadDetail(result.download.id));
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error descargando MIBGAS privado." });
    } finally {
      setLoading(false);
    }
  }

  async function showDetail(row: MibgasPrivateDownloadRow) {
    setLoading(true);
    setMessage(undefined);
    try {
      setDetail(await getMibgasPrivateDownloadDetail(row.id));
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando detalle de descarga MIBGAS." });
    } finally {
      setLoading(false);
    }
  }

  function redownload(row: MibgasPrivateDownloadRow) {
    void runDownload(true, row);
  }

  function applyFilters() {
    void load(filters);
  }

  const automation = automationConfig ?? defaultAutomationConfig();

  function updateAutomation(patch: Partial<MibgasPrivateAutomationConfig>) {
    setAutomationConfig({ ...automation, ...patch });
  }

  function updateAutomationSession(index: number, value: string) {
    const sessions = [...automation.sessions] as [string, string, string];
    sessions[index] = value;
    updateAutomation({ sessions });
  }

  async function saveAutomation() {
    setLoading(true);
    setMessage(undefined);
    try {
      const saved = await saveMibgasPrivateAutomationConfig(automation);
      setAutomationConfig(saved);
      setMessage({ tone: "success", text: "Automatismo MIBGAS privado guardado." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error guardando automatismo MIBGAS." });
    } finally {
      setLoading(false);
    }
  }

  async function runAutomationNow() {
    setLoading(true);
    setMessage(undefined);
    try {
      const result = await executeMibgasPrivateAutomation(automation.daysBack, automation.daysForward);
      setLatestAutomationRun(result);
      setMessage({
        tone: result.errores > 0 ? "error" : "success",
        text: `Automatismo MIBGAS: ${formatNumber(result.procesadas)} procesadas, ${formatNumber(result.sinDatos)} sin datos, ${formatNumber(result.errores)} errores.`
      });
      await refreshDownloads();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error ejecutando automatismo MIBGAS." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="omie-layout omie-layout-c gas-mibgas-module">
      <div className="omie-command-grid omie-download-command-grid">
        <div className="panel omie-control-panel">
          <PanelTitle icon={<BarChart3 size={18} />} title="Descargas" subtitle="MIBGAS Market privado SOAP" />
          <div className="omie-toolbar">
            <label className="filter-field">
              <span>Dia gas desde</span>
              <input disabled={loading} type="date" value={filters.sessionDateFrom ?? ""} onChange={(event) => setFilters({ ...filters, sessionDateFrom: event.target.value || undefined })} />
            </label>
            <label className="filter-field">
              <span>Dia gas hasta</span>
              <input disabled={loading} type="date" value={filters.sessionDateTo ?? ""} onChange={(event) => setFilters({ ...filters, sessionDateTo: event.target.value || undefined })} />
            </label>
            <label className="filter-field">
              <span>Consulta</span>
              <select disabled={loading} value={filters.queryKind ?? ""} onChange={(event) => setFilters({ ...filters, queryKind: event.target.value as DownloadFilters["queryKind"] })}>
                <option value="">Todas</option>
                <option value="TRANSACCIONES">3140 - Transacciones</option>
                <option value="POSICIONES_PERIODO">3144 - Posicion neta</option>
              </select>
            </label>
            <label className="filter-field">
              <span>Estado</span>
              <select disabled={loading} value={filters.status ?? ""} onChange={(event) => setFilters({ ...filters, status: event.target.value as DownloadFilters["status"] })}>
                <option value="">Todos</option>
                <option value="PENDIENTE">PENDIENTE</option>
                <option value="DESCARGANDO">DESCARGANDO</option>
                <option value="PROCESADO">PROCESADO</option>
                <option value="SIN_DATOS">SIN_DATOS</option>
                <option value="ERROR">ERROR</option>
              </select>
            </label>
            <button className="secondary-button" disabled={loading} onClick={applyFilters} type="button">
              <Search size={16} />
              Aplicar
            </button>
          </div>
        </div>

        <div className="panel omie-operational-panel">
          <PanelTitle icon={<Download size={18} />} title="Nueva descarga" subtitle="Catalogo privado MIBGAS" />
          <div className="omie-toolbar compact">
            <label className="filter-field">
              <span>Codigo MIBGAS</span>
              <select disabled={loading || queryOptions.length === 0} value={draft.queryCode} onChange={(event) => setDraft({ ...draft, queryCode: event.target.value })}>
                {queryOptions.map((query) => (
                  <option key={query.queryCode} value={query.queryCode}>
                    {query.queryCode} - {query.title ?? "Consulta sin titulo"}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Dia gas</span>
              <input disabled={loading} type="date" value={draft.sessionDate} onChange={(event) => setDraft({ ...draft, sessionDate: event.target.value })} />
            </label>
          </div>
          <div className="omie-toolbar compact" style={{ marginTop: 12 }}>
            <button className="secondary-button" disabled={loading} onClick={() => void runDownload(false)} type="button">
              <Download size={16} />
              Descargar
            </button>
            <button className="secondary-button" disabled={loading} onClick={() => void runDownload(true)} type="button">
              <Download size={16} />
              Descargar forzada
            </button>
            <button className="secondary-button" disabled={loading} onClick={() => void runConnectionTest()} type="button">
              <Check size={16} />
              Probar conexion
            </button>
            <button className="secondary-button" disabled={loading} onClick={() => void runDirectoryRefresh()} type="button">
              <RefreshCw size={16} />
              Actualizar directorio
            </button>
          </div>
        </div>
      </div>

      {message && <div className={`status-message ${message.tone}`}>{message.text}</div>}

      <div className="panel wide omie-compact-detail">
        <PanelTitle icon={<Clock3 size={18} />} title="Automatismo MIBGAS" subtitle={automation.active ? "Activo" : "Pausado"} />
        <div className="omie-toolbar compact">
          <label className="filter-field">
            <span>Estado</span>
            <select disabled={loading} value={automation.active ? "yes" : "no"} onChange={(event) => updateAutomation({ active: event.target.value === "yes" })}>
              <option value="yes">Activo</option>
              <option value="no">Pausado</option>
            </select>
          </label>
          <label className="filter-field">
            <span>Dias atras</span>
            <input disabled={loading} min={0} max={31} type="number" value={automation.daysBack} onChange={(event) => updateAutomation({ daysBack: Number(event.target.value) })} />
          </label>
          <label className="filter-field">
            <span>Dias vista</span>
            <input disabled={loading} min={0} max={31} type="number" value={automation.daysForward} onChange={(event) => updateAutomation({ daysForward: Number(event.target.value) })} />
          </label>
          {automation.sessions.map((session, index) => (
            <label className="filter-field" key={index}>
              <span>Sesion {index + 1}</span>
              <AutomationTimeSelect disabled={loading} value={session} onChange={(value) => updateAutomationSession(index, value)} />
            </label>
          ))}
          <button className="secondary-button" disabled={loading || !automationConfig} onClick={() => void saveAutomation()} type="button">
            <Clock3 size={16} />
            Guardar
          </button>
          <button className="secondary-button" disabled={loading || !automationConfig} onClick={() => void runAutomationNow()} type="button">
            <FileDown size={16} />
            Ejecutar ahora
          </button>
        </div>
        <div className="technical-kpis">
          <div className="technical-kpi neutral">
            <span>Modo</span>
            <strong>Forzado</strong>
            <small>3140 y 3144</small>
          </div>
          <div className="technical-kpi neutral">
            <span>Ventana gas</span>
            <strong>{`-${automation.daysBack} / +${automation.daysForward}`}</strong>
            <small>{formatNumber(automation.daysBack + automation.daysForward + 1)} dias</small>
          </div>
          <div className="technical-kpi neutral">
            <span>Ultima sesion</span>
            <strong>{automation.lastRunKey ?? "-"}</strong>
            <small>{automation.lastRunAt ? formatAutomationLocalDateTime(automation.lastRunAt) : "Sin ejecucion"}</small>
          </div>
          {latestAutomationRun && (
            <div className="technical-kpi neutral">
              <span>Ultima ejecucion manual</span>
              <strong>{formatNumber(latestAutomationRun.procesadas)} procesadas</strong>
              <small>{formatNumber(latestAutomationRun.errores)} errores · {formatDurationMs(latestAutomationRun.tiempoTotalMs)}</small>
            </div>
          )}
        </div>
      </div>

      {latestAutomationRun && (
        <div className="panel wide omie-compact-detail">
          <PanelTitle
            icon={<TrendingUp size={18} />}
            title="Resultado automatismo MIBGAS"
            subtitle={`${latestAutomationRun.dates[0] ?? "-"} / ${latestAutomationRun.dates[latestAutomationRun.dates.length - 1] ?? "-"}`}
          />
          <div>
            <table className="omie-download-results-table">
              <thead>
                <tr>
                  <th>Dia gas</th>
                  <th>Codigo</th>
                  <th>Consulta</th>
                  <th>Estado</th>
                  <th>Registros</th>
                  <th>Mensaje</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {latestAutomationRun.resultados.map((item) => (
                  <tr key={`${item.fecha}-${item.queryCode}`}>
                    <td>{formatFullDate(item.fecha)}</td>
                    <td>{item.queryCode}</td>
                    <td>{item.consulta}</td>
                    <td>{item.estado}</td>
                    <td>{formatNumber(item.registros)}</td>
                    <td>{item.mensaje}</td>
                    <td>{item.downloadId ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel wide omie-compact-detail">
        <PanelTitle icon={<Check size={18} />} title="Conexion MIBGAS" subtitle={status?.connection.environment ?? "Sin entorno"} />
        <div className="technical-kpis">
          <div className={`technical-kpi ${status?.connection.status === "OK" ? "good" : status?.connection.status === "ERROR" ? "danger" : "neutral"}`}>
            <span>Estado</span>
            <strong>{status?.connection.status ?? "Sin comprobar"}</strong>
            <small>{status?.connection.lastSuccessfulConnection ? formatDateTime(status.connection.lastSuccessfulConnection) : "Sin comprobacion"}</small>
          </div>
          <div className="technical-kpi neutral">
            <span>Agente</span>
            <strong>{status?.connection.agentCode ?? "-"}</strong>
            <small>{status?.connection.agentDescription ?? "Sin descripcion"}</small>
          </div>
          <div className="technical-kpi neutral">
            <span>Catalogo</span>
            <strong>{formatNumber(status?.counts.directory ?? directory.length)}</strong>
            <small>{formatNumber(status?.counts.configurations ?? 0)} configuraciones</small>
          </div>
          <div className="technical-kpi neutral">
            <span>Persistido</span>
            <strong>{formatNumber(status?.counts.netPositions ?? 0)}</strong>
            <small>{formatNumber(status?.counts.transactions ?? 0)} transacciones</small>
          </div>
        </div>
        {status?.connection.lastError && <div className="status-message error">{status.connection.lastError}</div>}
      </div>

      <TechnicalDataTable
        columns={historyColumns}
        exportFileName="mibgas-market-descargas"
        getDuplicateKey={(row) => row.id}
        getGroupLabel={() => ""}
        getRowId={(row) => row.id}
        getRowQuality={buildMibgasDownloadQuality}
        hasNext={false}
        kpis={[]}
        loading={loading}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        page={0}
        pageSize={Math.max(downloads.length, 1)}
        rows={downloads}
        showModeSelector={false}
        showPagination={false}
        title="Historico de descargas MIBGAS"
      />

      {detail && (
        <MibgasDownloadDetailDialog
          detail={detail}
          loading={loading}
          onClose={() => setDetail(undefined)}
          onRedownload={redownload}
        />
      )}
    </div>
  );
}

function buildMibgasDownloadHistoryColumns(
  onShowDetail: (row: MibgasPrivateDownloadRow) => void,
  onRedownload: (row: MibgasPrivateDownloadRow) => void
): Array<TechnicalColumn<MibgasPrivateDownloadRow>> {
  return [
    {
      id: "createdAt",
      label: "Descarga",
      width: 132,
      type: "date",
      filter: "text",
      sticky: true,
      value: (row) => row.createdAt,
      render: (row) => formatDateTime(row.createdAt)
    },
    { id: "queryKind", label: "Modulo", width: 132, filter: "select", value: (row) => row.queryKind, render: (row) => formatQueryKind(row.queryKind) },
    { id: "queryCode", label: "Codigo", width: 76, filter: "text", value: (row) => row.queryCode ?? "", render: (row) => row.queryCode ?? "-" },
    { id: "queryTitle", label: "Consulta", width: 180, filter: "text", value: (row) => row.queryTitle ?? "", render: (row) => row.queryTitle ?? "-" },
    {
      id: "sessionDate",
      label: "Dia gas",
      width: 96,
      type: "date",
      filter: "text",
      value: (row) => row.sessionDate ?? "",
      render: (row) => (row.sessionDate ? formatFullDate(row.sessionDate) : "-")
    },
    { id: "environment", label: "Entorno", width: 76, filter: "select", value: (row) => row.environment },
    { id: "status", label: "Estado", width: 96, filter: "select", value: (row) => row.status, render: (row) => <LoadStatusBadge status={row.status as any} /> },
    {
      id: "records",
      label: "Registros",
      width: 80,
      align: "right",
      type: "number",
      filter: "number",
      value: (row) => row.records,
      render: (row) => formatNumber(row.records)
    },
    {
      id: "durationMs",
      label: "Duracion",
      width: 86,
      align: "right",
      type: "number",
      filter: "number",
      value: (row) => row.durationMs ?? null,
      render: (row) => formatDurationMs(row.durationMs)
    },
    { id: "executedBy", label: "Usuario", width: 92, filter: "text", visibility: "advanced", value: (row) => row.executedBy },
    { id: "errorMessage", label: "Error", width: 180, filter: "text", visibility: "advanced", value: (row) => row.errorMessage ?? "" },
    {
      id: "rawXmlAvailable",
      label: "XML",
      width: 48,
      filter: "select",
      visibility: "advanced",
      value: (row) => (row.rawXmlAvailable ? "Si" : "No"),
      render: (row) => (row.rawXmlAvailable ? "Si" : "No")
    },
    {
      id: "rawJsonAvailable",
      label: "JSON",
      width: 52,
      filter: "select",
      visibility: "advanced",
      value: (row) => (row.rawJsonAvailable ? "Si" : "No"),
      render: (row) => (row.rawJsonAvailable ? "Si" : "No")
    },
    {
      id: "actions",
      label: "Acciones",
      width: 82,
      filter: "text",
      visibility: "advanced",
      value: () => "",
      render: (row) => (
        <div className="row-actions omie-row-actions">
          <button className="secondary-button icon-only" onClick={() => onShowDetail(row)} title="Ver detalle" type="button">
            <Eye size={15} />
          </button>
          <button className="secondary-button icon-only" onClick={() => onRedownload(row)} title="Redescargar" type="button">
            <RotateCw size={15} />
          </button>
        </div>
      )
    }
  ];
}

function MibgasDownloadDetailDialog({
  detail,
  loading,
  onClose,
  onRedownload
}: {
  detail: MibgasPrivateDownloadDetail;
  loading: boolean;
  onClose: () => void;
  onRedownload: (row: MibgasPrivateDownloadRow) => void;
}) {
  const hasError = Boolean(detail.errorMessage);
  const controlSummary = {
    id: detail.id,
    environment: detail.environment,
    queryKind: detail.queryKind,
    queryCode: detail.queryCode,
    queryTitle: detail.queryTitle,
    sessionDate: detail.sessionDate,
    status: detail.status,
    records: detail.records,
    durationMs: detail.durationMs,
    publishedAt: detail.publishedAt,
    executedBy: detail.executedBy,
    contentHash: detail.contentHash,
    rawXmlAvailable: detail.rawXmlAvailable,
    rawJsonAvailable: detail.rawJsonAvailable,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt
  };

  return (
    <div className="ops-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="ops-modal omie-detail-modal" role="dialog" aria-modal="true" aria-label="Detalle de descarga MIBGAS" onMouseDown={(event) => event.stopPropagation()}>
        <div className="ops-modal-head">
          <div>
            <strong>Detalle de descarga MIBGAS</strong>
            <span>{`${formatQueryKind(detail.queryKind)} / ${detail.queryCode ?? "-"} / ${detail.environment}`}</span>
          </div>
          <button onClick={onClose} type="button">Cerrar</button>
        </div>
        <div className="ops-modal-body">
          <div className={`omie-detail-hero ${hasError ? "has-error" : ""}`}>
            <div className="omie-detail-title">
              <span>{detail.queryKind}</span>
              <h2>{detail.queryTitle ?? detail.queryCode ?? "Consulta MIBGAS"}</h2>
              <p>{detail.sessionDate ? `Dia gas ${formatFullDate(detail.sessionDate)}` : "Consulta sin dia gas"}</p>
            </div>
            <div className="omie-detail-status">
              <LoadStatusBadge status={detail.status as any} />
              <strong>{formatNumber(detail.records)}</strong>
              <small>registros</small>
            </div>
          </div>

          <div className="omie-detail-summary-grid">
            <div>
              <span>Entorno</span>
              <strong>{detail.environment}</strong>
              <small>{detail.executedBy}</small>
            </div>
            <div>
              <span>Descarga</span>
              <strong>{formatDateTime(detail.createdAt)}</strong>
              <small>{detail.fileName ?? "Sin fichero"}</small>
            </div>
            <div>
              <span>Duracion</span>
              <strong>{formatDurationMs(detail.durationMs)}</strong>
              <small>{detail.publishedAt ? formatDateTime(detail.publishedAt) : "Sin publicacion"}</small>
            </div>
            <div>
              <span>Identificador</span>
              <strong>{detail.id.slice(0, 8)}</strong>
              <small>{detail.id}</small>
            </div>
          </div>

          <div className="omie-detail-action-bar">
            <button className="secondary-button" disabled={loading || !detail.sessionDate || !detail.queryCode} onClick={() => onRedownload(detail)} type="button">
              <Download size={16} />
              Redescargar
            </button>
          </div>

          {hasError && (
            <div className="omie-detail-error">
              <strong>Error registrado</strong>
              <span>{detail.errorMessage}</span>
            </div>
          )}

          <div className="omie-detail-grid">
            <div className="omie-detail-section">
              <div>
                <strong>Parametros</strong>
                <span>Datos usados en la consulta MIBGAS</span>
              </div>
              <pre>{JSON.stringify(detail.parametersJson, null, 2)}</pre>
            </div>
            <div className="omie-detail-section">
              <div>
                <strong>Control</strong>
                <span>Estado interno normalizado</span>
              </div>
              <pre>{JSON.stringify(controlSummary, null, 2)}</pre>
            </div>
            <div className="omie-detail-section wide">
              <div>
                <strong>JSON / RAW</strong>
                <span>Payload tecnico almacenado para auditoria</span>
              </div>
              <pre>{JSON.stringify(detail.rawJson, null, 2)}</pre>
            </div>
            <div className="omie-detail-section wide">
              <div>
                <strong>XML</strong>
                <span>Respuesta SOAP extraida de MIBGAS</span>
              </div>
              <pre>{detail.rawXml ?? "Sin XML almacenado"}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function buildMibgasDownloadQuality(row: MibgasPrivateDownloadRow): RowQuality {
  return {
    tone: row.status === "ERROR" ? "danger" : row.status === "PROCESADO" ? "ok" : "warning",
    labels: row.errorMessage ? [row.errorMessage] : []
  };
}

function buildMarketQueryOptions(directory: MibgasDirectoryEntry[]) {
  const candidates = directory.length > 0 ? directory : QUERY_OPTIONS_FALLBACK;
  const marketQueries = candidates
    .filter((row) => isEnabledQueryCode(row.queryCode))
    .sort((left, right) => queryPriority(left) - queryPriority(right) || left.queryCode.localeCompare(right.queryCode, "es", { numeric: true }));
  return marketQueries.length > 0 ? marketQueries : QUERY_OPTIONS_FALLBACK;
}

function isEnabledQueryCode(value: string): value is (typeof ENABLED_QUERY_CODES)[number] {
  return (ENABLED_QUERY_CODES as readonly string[]).includes(value);
}

function isNetPositionQuery(row?: MibgasDirectoryEntry) {
  return row?.queryCode === "3144";
}

function queryPriority(row: MibgasDirectoryEntry) {
  if (row.queryCode === "3144") {
    return 0;
  }
  if (row.queryCode === "3140") {
    return 1;
  }
  return 2;
}

function formatQueryKind(value: MibgasPrivateQueryKind) {
  if (value === "POSICIONES_PERIODO") {
    return "Posicion neta";
  }
  if (value === "TRANSACCIONES") {
    return "Transacciones";
  }
  if (value === "ANOTACIONES") {
    return "Anotaciones";
  }
  if (value === "DIRECTORIO") {
    return "Directorio";
  }
  if (value === "CONFIGURACION") {
    return "Configuracion";
  }
  return "Datos usuario";
}

function defaultAutomationConfig(): MibgasPrivateAutomationConfig {
  return {
    active: false,
    daysBack: 1,
    daysForward: 3,
    sessions: ["06:00", "12:00", "18:00"],
    lastRunKey: null,
    lastRunAt: null,
    lastRunAtUtc: null
  };
}

function AutomationTimeSelect({ disabled, value, onChange }: { disabled: boolean; value: string; onChange: (value: string) => void }) {
  const [hour = "00", minute = "00"] = normalizeAutomationTimeValue(value).split(":");

  return (
    <div className="omie-automation-time-select" aria-label="Hora local Madrid en formato 24 horas">
      <select disabled={disabled} value={hour} onChange={(event) => onChange(`${event.target.value}:${minute}`)}>
        {AUTOMATION_HOUR_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option} h
          </option>
        ))}
      </select>
      <select disabled={disabled} value={minute} onChange={(event) => onChange(`${hour}:${event.target.value}`)}>
        {AUTOMATION_MINUTE_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option} min
          </option>
        ))}
      </select>
    </div>
  );
}

function normalizeAutomationTimeValue(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return "00:00";
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isSafeInteger(hour) || !Number.isSafeInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return "00:00";
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatAutomationLocalDateTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  return match ? `${match[3]}/${match[2]} ${match[4]}:${match[5]}` : value;
}
