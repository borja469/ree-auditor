import { useMemo } from "react";
import { BarChart3, Download, Eye, FileDown, RotateCw, Search, TrendingUp } from "lucide-react";
import { TechnicalDataTable } from "../../../components/technical-data-table/TechnicalDataTable";
import type { RowQuality, TechnicalColumn } from "../../../components/technical-data-table/TechnicalDataTableTypes";
import { normalizeOmieSesionInput } from "../../../app-shell/AppState";
import type { OmieDailyBulkDownloadResponse, OmieDownloadCodigo, OmieDownloadControlFilters, OmieDownloadControlRow, OmieDownloadDetail, OmieDownloadDocumentType, OmieDownloadEstado, OmieDownloadExecuteRequest, OmieDownloadModulo } from "../../../api";
import { formatDateTime } from "../../ree-losses/ReeLossesHelpers";
import { LoadStatusBadge, PanelTitle, formatFullDate, formatNumber } from "../../shared/RestoredModuleCommon";
type OmieDownloadControlProps = {
  descargas: OmieDownloadControlRow[];
  filters: OmieDownloadControlFilters;
  draft: OmieDownloadExecuteRequest;
  detail?: OmieDownloadDetail;
  latestDailyBulkDownload?: OmieDailyBulkDownloadResponse;
  loading: boolean;
  onFiltersChange: (value: OmieDownloadControlFilters) => void;
  onDraftChange: (value: OmieDownloadExecuteRequest) => void;
  onApply: () => void;
  onDownload: () => void;
  onForceDownload: () => void;
  onDownloadDay: () => void;
  onForceDownloadDay: () => void;
  onShowDetail: (row: OmieDownloadControlRow) => void;
  onCloseDetail: () => void;
  onReprocess: (row: OmieDownloadControlRow) => void;
  onRedownload: (row: OmieDownloadControlRow) => void;
};

export function OmieDescargasControlModule({
  descargas,
  filters,
  draft,
  detail,
  latestDailyBulkDownload,
  loading,
  onFiltersChange,
  onDraftChange,
  onApply,
  onDownload,
  onForceDownload,
  onDownloadDay,
  onForceDownloadDay,
  onShowDetail,
  onCloseDetail,
  onReprocess,
  onRedownload
}: OmieDownloadControlProps) {
  const selectedDetail = detail;
  const historyColumns = useMemo(() => buildOmieDownloadHistoryColumns(onShowDetail, onReprocess, onRedownload), [onReprocess, onRedownload, onShowDetail]);
  const selectedMode = draft.codigoOmie;
  const requiresSesion = selectedMode === "5608" || selectedMode === "5603";
  const requiresRange = selectedMode === "4121";
  const draftFecha = draft.fecha ?? "";
  const draftFechaDesde = draft.fechaDesde ?? "";
  const draftFechaHasta = draft.fechaHasta ?? "";
  const draftSesion = draft.sesion ?? "";

  function updateDraft(patch: Partial<OmieDownloadExecuteRequest>) {
    onDraftChange({ ...draft, ...patch });
  }

  return (
    <div className="omie-layout omie-layout-c">
      <div className="omie-command-grid omie-download-command-grid">
        <div className="panel omie-control-panel">
          <PanelTitle icon={<BarChart3 size={18} />} title="OMIE Descargas" subtitle="Control 5302 / 5608 / 5202 / 5603 / 4125 / 4121" />
          <div className="omie-toolbar">
            <label className="filter-field">
              <span>Fecha desde</span>
              <input disabled={loading} type="date" value={filters.fechaDesde ?? ""} onChange={(event) => onFiltersChange({ ...filters, fechaDesde: event.target.value || undefined })} />
            </label>
            <label className="filter-field">
              <span>Fecha hasta</span>
              <input disabled={loading} type="date" value={filters.fechaHasta ?? ""} onChange={(event) => onFiltersChange({ ...filters, fechaHasta: event.target.value || undefined })} />
            </label>
            <label className="filter-field">
              <span>Módulo</span>
              <select disabled={loading} value={filters.modulo ?? ""} onChange={(event) => onFiltersChange({ ...filters, modulo: (event.target.value || undefined) as OmieDownloadModulo | undefined })}>
                <option value="">Todos</option>
                <option value="Programas">Programas</option>
                <option value="Precios">Precios</option>
                <option value="Transacciones">Transacciones</option>
              </select>
            </label>
            <label className="filter-field">
              <span>Código</span>
              <select disabled={loading} value={filters.codigoOmie ?? ""} onChange={(event) => onFiltersChange({ ...filters, codigoOmie: (event.target.value || undefined) as OmieDownloadCodigo | undefined })}>
                <option value="">Todos</option>
                <option value="5302">5302</option>
                <option value="5608">5608</option>
                <option value="5202">5202</option>
                <option value="5603">5603</option>
                <option value="4125">4125</option>
                <option value="4121">4121</option>
              </select>
            </label>
            <label className="filter-field">
              <span>Tipo</span>
              <select disabled={loading} value={filters.tipoDocumento ?? ""} onChange={(event) => onFiltersChange({ ...filters, tipoDocumento: (event.target.value || undefined) as OmieDownloadDocumentType | undefined })}>
                <option value="">Todos</option>
                <option value="PVD">PVD</option>
                <option value="PHF">PHF</option>
                <option value="MD">MD</option>
                <option value="MI">MI</option>
                <option value="XBID">XBID</option>
                <option value="TRANSACCIONES">TRANSACCIONES</option>
              </select>
            </label>
            <label className="filter-field">
              <span>Estado</span>
              <select disabled={loading} value={filters.estado ?? ""} onChange={(event) => onFiltersChange({ ...filters, estado: (event.target.value || undefined) as OmieDownloadEstado | undefined })}>
                <option value="">Todos</option>
                <option value="PENDIENTE">PENDIENTE</option>
                <option value="DESCARGANDO">DESCARGANDO</option>
                <option value="DESCARGADO">DESCARGADO</option>
                <option value="PROCESADO">PROCESADO</option>
                <option value="ERROR">ERROR</option>
              </select>
            </label>
            <label className="filter-field">
              <span>Sesión</span>
              <input disabled={loading} inputMode="numeric" maxLength={2} value={filters.sesion ?? ""} onChange={(event) => onFiltersChange({ ...filters, sesion: normalizeOmieSesionInput(event.target.value) })} />
            </label>
            <button className="secondary-button" disabled={loading} onClick={onApply} type="button">
              <Search size={16} />
              Aplicar
            </button>
          </div>
        </div>
        <div className="panel omie-operational-panel">
          <PanelTitle icon={<BarChart3 size={18} />} title="Nueva descarga" subtitle="Edición del borrador actual" />
          <div className="omie-toolbar compact">
            <label className="filter-field">
              <span>Código OMIE</span>
              <select disabled={loading} value={draft.codigoOmie} onChange={(event) => updateDraft({ codigoOmie: event.target.value as OmieDownloadCodigo })}>
                <option value="5302">5302 - PVD</option>
                <option value="5608">5608 - PHF</option>
                <option value="5202">5202 - Mercado Diario</option>
                <option value="5603">5603 - Intradiario</option>
                <option value="4125">4125 - XBID</option>
                <option value="4121">4121 - Transacciones</option>
              </select>
            </label>
            {!requiresRange && (
              <label className="filter-field">
                <span>Fecha</span>
                <input disabled={loading} type="date" value={draftFecha} onChange={(event) => updateDraft({ fecha: event.target.value })} />
              </label>
            )}
            {requiresRange && (
              <>
                <label className="filter-field">
                  <span>Fecha desde</span>
                  <input disabled={loading} type="date" value={draftFechaDesde} onChange={(event) => updateDraft({ fechaDesde: event.target.value })} />
                </label>
                <label className="filter-field">
                  <span>Fecha hasta</span>
                  <input disabled={loading} type="date" value={draftFechaHasta} onChange={(event) => updateDraft({ fechaHasta: event.target.value })} />
                </label>
              </>
            )}
            {requiresSesion && (
              <label className="filter-field">
                <span>Sesión</span>
                <input disabled={loading} inputMode="numeric" maxLength={2} value={draftSesion} onChange={(event) => updateDraft({ sesion: normalizeOmieSesionInput(event.target.value) })} />
              </label>
            )}
          </div>
          <div className="omie-toolbar compact" style={{ marginTop: 12 }}>
            <button className="secondary-button" disabled={loading} onClick={onDownload} type="button">
              <Download size={16} />
              Descargar
            </button>
            <button className="secondary-button" disabled={loading} onClick={onForceDownload} type="button">
              <Download size={16} />
              Descargar forzada
            </button>
            <button className="secondary-button" disabled={loading} onClick={onDownloadDay} type="button">
              <FileDown size={16} />
              Descargar día
            </button>
            <button className="secondary-button" disabled={loading} onClick={onForceDownloadDay} type="button">
              <FileDown size={16} />
              Descargar día forzada
            </button>
          </div>
        </div>
      </div>

      {selectedDetail ? (
        <div className="panel wide omie-compact-detail">
          <PanelTitle
            icon={<TrendingUp size={18} />}
            title="Detalle de descarga"
            subtitle={`${selectedDetail.modulo} · ${selectedDetail.consulta} · ${selectedDetail.codigoOmie}`}
          />
          <div className="technical-toolbar omie-detail-actions" style={{ marginBottom: 12 }}>
            <button className="secondary-button" disabled={loading} onClick={onCloseDetail} type="button">
              Cerrar detalle
            </button>
            <button className="secondary-button" disabled={loading} onClick={() => onReprocess(selectedDetail)} type="button">
              Reprocesar
            </button>
            <button className="secondary-button" disabled={loading} onClick={() => onRedownload(selectedDetail)} type="button">
              Redescargar
            </button>
          </div>
          <div className="technical-kpis">
            <div className="technical-kpi neutral">
              <span>Estado</span>
              <strong>
                <LoadStatusBadge status={selectedDetail.estado} />
              </strong>
              <small>{selectedDetail.id}</small>
            </div>
            <div className="technical-kpi neutral">
              <span>Periodo</span>
              <strong>
                {formatFullDate(selectedDetail.fechaPrograma)}
                {selectedDetail.fechaHasta ? ` - ${formatFullDate(selectedDetail.fechaHasta)}` : ""}
              </strong>
              <small>{selectedDetail.sesion ?? "Sin sesión"}</small>
            </div>
            <div className="technical-kpi neutral">
              <span>Duración</span>
              <strong>{formatDurationMs(selectedDetail.tiempoEjecucionMs)}</strong>
              <small>{selectedDetail.registros.toLocaleString("es-ES")} registros</small>
            </div>
          </div>
          <div className="omie-download-detail-grid">
            <div className="empty-state">
              <strong>Errores</strong>
              <div>{selectedDetail.mensajeError ?? "Sin errores"}</div>
            </div>
            <div className="empty-state">
              <strong>Resumen</strong>
              <div>{selectedDetail.descripcion}</div>
            </div>
          </div>
          <div className="omie-detail-grid">
            <div className="panel">
              <strong>Parametros utilizados</strong>
              <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{JSON.stringify(selectedDetail.parametrosUtilizados, null, 2)}</pre>
            </div>
            <div className="panel">
              <strong>JSON / RAW</strong>
              <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{JSON.stringify(selectedDetail.rawJson, null, 2)}</pre>
            </div>
            <div className="panel">
              <strong>Log</strong>
              <ul>
                {selectedDetail.log.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : (
        <div className="panel wide omie-compact-detail">
          <div className="empty-state">
            <strong>Detalle de descarga</strong>
            <div>Selecciona una descarga en el histórico para ver detalle, log y raw JSON.</div>
          </div>
        </div>
      )}

      {latestDailyBulkDownload && (
        <div className="panel wide omie-compact-detail">
          <PanelTitle icon={<TrendingUp size={18} />} title="Descarga diaria" subtitle={`${latestDailyBulkDownload.fecha} · ${latestDailyBulkDownload.force ? "forzada" : "normal"}`} />
          <div className="technical-kpis">
            <div className="technical-kpi neutral">
              <span>Consultas</span>
              <strong>{latestDailyBulkDownload.totalConsultasEjecutadas.toLocaleString("es-ES")}</strong>
              <small>de {latestDailyBulkDownload.totalConsultas.toLocaleString("es-ES")}</small>
            </div>
            <div className="technical-kpi neutral">
              <span>Procesadas</span>
              <strong>{latestDailyBulkDownload.procesadas.toLocaleString("es-ES")}</strong>
              <small>{latestDailyBulkDownload.sinDatos.toLocaleString("es-ES")} sin datos</small>
            </div>
            <div className="technical-kpi neutral">
              <span>Errores</span>
              <strong>{latestDailyBulkDownload.errores.toLocaleString("es-ES")}</strong>
              <small>{formatDurationMs(latestDailyBulkDownload.tiempoTotalMs)}</small>
            </div>
          </div>
          <div>
            <table className="omie-download-results-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Módulo</th>
                  <th>Consulta</th>
                  <th>Estado</th>
                  <th>Registros</th>
                  <th>Mensaje</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {latestDailyBulkDownload.resultados.map((item) => (
                  <tr key={`${item.codigoOmie}-${item.consulta}-${item.sesion ?? ""}`}>
                    <td>{item.codigoOmie}</td>
                    <td>{item.modulo}</td>
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

      <TechnicalDataTable
        columns={historyColumns}
        exportFileName="omie-descargas-control"
        getDuplicateKey={(row) => row.id}
        getGroupLabel={() => ""}
        getRowId={(row) => row.id}
        getRowQuality={buildOmieDownloadControlQuality}
        hasNext={false}
        kpis={[]}
        loading={loading}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        page={0}
        pageSize={Math.max(descargas.length, 1)}
        rows={descargas}
        showModeSelector={false}
        showPagination={false}
        title="Histórico de descargas OMIE"
      />
    </div>
  );
}

function buildOmieDownloadHistoryColumns(
  onShowDetail: (row: OmieDownloadControlRow) => void,
  onReprocess: (row: OmieDownloadControlRow) => void,
  onRedownload: (row: OmieDownloadControlRow) => void
): Array<TechnicalColumn<OmieDownloadControlRow>> {
  return [
    {
      id: "fechaDescarga",
      label: "Descarga",
      width: 132,
      type: "date",
      filter: "text",
      sticky: true,
      value: (row) => row.fechaDescarga ?? "",
      render: (row) => formatDateTime(row.fechaDescarga)
    },
    { id: "modulo", label: "Módulo", width: 100, filter: "select", value: (row) => row.modulo },
    { id: "consulta", label: "Consulta", width: 118, filter: "text", value: (row) => row.consulta },
    {
      id: "codigoOmie",
      label: "Código",
      width: 72,
      type: "text",
      filter: "select",
      value: (row) => row.codigoOmie
    },
    { id: "tipoDocumento", label: "Tipo", width: 88, filter: "select", value: (row) => row.tipoDocumento },
    {
      id: "fechaPrograma",
      label: "Fecha",
      width: 96,
      type: "date",
      filter: "text",
      value: (row) => row.fechaPrograma,
      render: (row) => formatFullDate(row.fechaPrograma)
    },
    {
      id: "fechaHasta",
      label: "Hasta",
      width: 96,
      type: "date",
      filter: "text",
      value: (row) => row.fechaHasta ?? "",
      render: (row) => (row.fechaHasta ? formatFullDate(row.fechaHasta) : "-")
    },
    { id: "sesion", label: "Sesión", width: 66, align: "right", filter: "select", value: (row) => row.sesion ?? "", render: (row) => row.sesion ?? "-" },
    { id: "estado", label: "Estado", width: 92, filter: "select", value: (row) => row.estado, render: (row) => <LoadStatusBadge status={row.estado} /> },
    {
      id: "registros",
      label: "Registros",
      width: 76,
      align: "right",
      type: "number",
      filter: "number",
      value: (row) => row.registros,
      render: (row) => formatNumber(row.registros)
    },
    {
      id: "tiempoEjecucionMs",
      label: "Duración",
      width: 86,
      align: "right",
      type: "number",
      filter: "number",
      value: (row) => row.tiempoEjecucionMs ?? null,
      render: (row) => formatDurationMs(row.tiempoEjecucionMs)
    },
    {
      id: "mensajeError",
      label: "Error",
      width: 180,
      filter: "text",
      visibility: "advanced",
      value: (row) => row.mensajeError ?? ""
    },
    {
      id: "rawXmlDisponible",
      label: "XML",
      width: 46,
      filter: "select",
      visibility: "advanced",
      value: (row) => (row.rawXmlDisponible ? "Sí" : "No"),
      render: (row) => (row.rawXmlDisponible ? "Sí" : "No")
    },
    {
      id: "rawJsonDisponible",
      label: "JSON",
      width: 50,
      filter: "select",
      visibility: "advanced",
      value: (row) => (row.rawJsonDisponible ? "Sí" : "No"),
      render: (row) => (row.rawJsonDisponible ? "Sí" : "No")
    },
    {
      id: "logDisponible",
      label: "Log",
      width: 46,
      filter: "select",
      visibility: "advanced",
      value: (row) => (row.logDisponible ? "Sí" : "No"),
      render: (row) => (row.logDisponible ? "Sí" : "No")
    },
    {
      id: "acciones",
      label: "Acciones",
      width: 104,
      filter: "text",
      visibility: "advanced",
      value: () => "",
      render: (row) => (
        <div className="row-actions omie-row-actions">
          <button className="secondary-button icon-only" onClick={() => onShowDetail(row)} title="Ver detalle" type="button">
            <Eye size={15} />
          </button>
          <button className="secondary-button icon-only" onClick={() => onReprocess(row)} title="Reprocesar" type="button">
            <RotateCw size={15} />
          </button>
          <button className="secondary-button icon-only" onClick={() => onRedownload(row)} title="Redescargar" type="button">
            <Download size={15} />
          </button>
        </div>
      )
    }
  ];
}

function buildOmieDownloadControlQuality(row: OmieDownloadControlRow): RowQuality {
  return {
    tone: row.estado === "ERROR" ? "danger" : row.estado === "PROCESADO" ? "ok" : "warning",
    labels: row.mensajeError ? [row.mensajeError] : []
  };
}

export function normalizeOmieDownloadRequest(draft: any) {
  if (!draft || typeof draft !== "object") {
    return null;
  }

  const codigoOmie = typeof draft.codigoOmie === "string" ? draft.codigoOmie.trim() : "";
  if (!["5302", "5608", "5202", "5603", "4125", "4121"].includes(codigoOmie)) {
    return null;
  }

  const fecha = normalizeDownloadDate(draft.fecha);
  const fechaDesde = normalizeDownloadDate(draft.fechaDesde);
  const fechaHasta = normalizeDownloadDate(draft.fechaHasta);
  const sesion = typeof draft.sesion === "string" && draft.sesion.trim() ? normalizeOmieSesionInput(draft.sesion) : undefined;

  if (codigoOmie === "5608" || codigoOmie === "5603") {
    if (!fecha || !sesion) {
      return null;
    }
    return { codigoOmie: codigoOmie as OmieDownloadCodigo, fecha, sesion } satisfies OmieDownloadExecuteRequest;
  }

  if (codigoOmie === "4121") {
    const resolvedDesde = fechaDesde ?? fecha;
    const resolvedHasta = fechaHasta ?? fecha ?? fechaDesde;
    if (!resolvedDesde || !resolvedHasta) {
      return null;
    }
    return {
      codigoOmie: codigoOmie as OmieDownloadCodigo,
      fecha: resolvedDesde,
      fechaDesde: resolvedDesde,
      fechaHasta: resolvedHasta
    } satisfies OmieDownloadExecuteRequest;
  }

  if (!fecha) {
    return null;
  }

  return { codigoOmie: codigoOmie as OmieDownloadCodigo, fecha } satisfies OmieDownloadExecuteRequest;
}

export function getOmieDailyBulkDate(draft: any) {
  return normalizeDownloadDate(draft?.fecha ?? draft?.fechaDesde ?? draft?.fechaHasta) ?? "";
}

export function formatDurationMs(ms: number | null | undefined) {
  const totalMs = typeof ms === "number" && Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  if (totalMs < 1000) {
    return `${totalMs} ms`;
  }
  const totalSeconds = Math.floor(totalMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

function normalizeDownloadDate(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return undefined;
  }
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : trimmed;
}
