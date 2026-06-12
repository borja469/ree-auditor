import { useMemo } from "react";
import { BarChart3, Search, TrendingUp } from "lucide-react";
import { TechnicalDataTable } from "../../../components/technical-data-table/TechnicalDataTable";
import type { RowQuality, TechnicalColumn } from "../../../components/technical-data-table/TechnicalDataTableTypes";
import { stringifyCellValue } from "../../../components/technical-data-table/TechnicalDataTableHelpers";
import { selectOmieTransactionDownloadId } from "../../../app-shell/AppState";
import type { OmieDownloadEstado, OmieTransactionDownloadFilters, OmieTransactionDownloadRow, OmieTransactionStagingRow } from "../../../api";
import { formatDateTime } from "../../ree-losses/ReeLossesHelpers";
import { LoadStatusBadge, PanelTitle, formatFullDate, formatNumber } from "../../shared/RestoredModuleCommon";
type OmieTransaccionesProps = {
  filters: OmieTransactionDownloadFilters;
  downloads: OmieTransactionDownloadRow[];
  rows: OmieTransactionStagingRow[];
  selectedDownloadId?: string;
  loading: boolean;
  onFiltersChange: (value: OmieTransactionDownloadFilters) => void;
  onRefresh: () => Promise<void> | void;
  onGoToDownloads: () => void;
};

const OMIE_TRANSACTION_ESTADOS: OmieDownloadEstado[] = ["PENDIENTE", "DESCARGANDO", "DESCARGADO", "PROCESADO", "ERROR"];

export function OmieTransaccionesModule({
  filters,
  downloads,
  rows,
  selectedDownloadId,
  loading,
  onFiltersChange,
  onRefresh,
  onGoToDownloads
}: OmieTransaccionesProps) {
  const selectedId = selectOmieTransactionDownloadId(downloads, selectedDownloadId, { keepPreferredEvenIfEmpty: true });
  const selectedDownload = useMemo(
    () => downloads.find((download) => download.id === selectedId) ?? downloads[0],
    [downloads, selectedId]
  );
  const historyColumns = useMemo<Array<TechnicalColumn<OmieTransactionDownloadRow>>>(() => buildOmieTransactionHistoryColumns(), []);
  const rawColumns = useMemo<Array<TechnicalColumn<OmieTransactionStagingRow>>>(
    () => buildOmieTransactionRawColumns(selectedDownload, rows),
    [rows, selectedDownload]
  );
  const rawSummary = useMemo(() => buildOmieTransactionSummary(selectedDownload), [selectedDownload]);

  return (
    <>
      <section className="content-grid omie-grid">
        <div className="panel wide omie-control-panel">
          <PanelTitle icon={<BarChart3 size={18} />} title="OMIE Transacciones" subtitle="Consulta 4121 RAW" />
          <div className="omie-toolbar compact">
            <label className="filter-field">
              <span>Fecha desde</span>
              <input
                disabled={loading}
                type="date"
                value={filters.fechaDesde ?? ""}
                onChange={(event) => onFiltersChange({ ...filters, fechaDesde: event.target.value })}
              />
            </label>
            <label className="filter-field">
              <span>Fecha hasta</span>
              <input
                disabled={loading}
                type="date"
                value={filters.fechaHasta ?? ""}
                onChange={(event) => onFiltersChange({ ...filters, fechaHasta: event.target.value })}
              />
            </label>
            <label className="filter-field">
              <span>Estado</span>
              <select
                disabled={loading}
                value={filters.estado ?? ""}
                onChange={(event) =>
                  onFiltersChange({
                    ...filters,
                    estado: event.target.value as OmieTransactionDownloadFilters["estado"]
                  })
                }
              >
                <option value="">Todos</option>
                {OMIE_TRANSACTION_ESTADOS.map((estado) => (
                  <option key={estado} value={estado}>
                    {estado}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary-button" disabled={loading} onClick={onRefresh} type="button">
              <Search size={16} />
              Consultar
            </button>
          </div>
        </div>
      </section>

      {!downloads.length && !loading && (
        <section className="content-grid">
          <div className="panel wide">
            <div className="empty-state">
              <strong>OMIE Transacciones</strong>
              <div>No hay historico para los filtros seleccionados.</div>
              <button className="secondary-button" onClick={onGoToDownloads} type="button">
                Ir a descargas
              </button>
            </div>
          </div>
        </section>
      )}

      {selectedDownload && (
        <section className="content-grid">
          <div className="panel wide">
            <PanelTitle
              icon={<TrendingUp size={18} />}
              title="Descarga seleccionada"
              subtitle={`${selectedDownload.codigoConsulta} Â· ${selectedDownload.registros.toLocaleString("es-ES")} registros Â· ${selectedDownload.diasConsultados.toLocaleString("es-ES")} dias`}
            />
            <div className="technical-kpis">
              <div className="technical-kpi neutral">
                <span>Estado</span>
                <strong>
                  <LoadStatusBadge status={selectedDownload.estado} />
                </strong>
                <small>{selectedDownload.id}</small>
              </div>
              <div className="technical-kpi neutral">
                <span>Descarga</span>
                <strong>{formatDateTime(selectedDownload.fechaDescarga)}</strong>
                <small>{selectedDownload.nombreFichero ?? "Sin fichero"}</small>
              </div>
              <div className="technical-kpi neutral">
                <span>Periodo</span>
                <strong>
                  {formatFullDate(selectedDownload.fechaDesde)} - {formatFullDate(selectedDownload.fechaHasta)}
                </strong>
                <small>{selectedDownload.resumenEstructura?.columnasDetectadas.length ?? 0} columnas detectadas</small>
              </div>
            </div>
            <div className="empty-state" style={{ marginTop: 16 }}>
              <strong>Resumen estructural</strong>
              <div>
                {rawSummary
                  ? `${rawSummary.registrosTotales} registros totales Â· ${rawSummary.diasConsultados} dias consultados Â· ${rawSummary.muestraFilas} filas de muestra`
                  : "Sin resumen estructural disponible"}
              </div>
            </div>
          </div>
        </section>
      )}

      <TechnicalDataTable
        columns={historyColumns}
        exportFileName="omie-transacciones-historico"
        getDuplicateKey={(row) => row.id}
        getGroupLabel={() => ""}
        getRowId={(row) => row.id}
        getRowQuality={(row) => buildOmieTransactionHistoryQuality(row, selectedId)}
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
        title="Historico de descargas OMIE"
      />

      <TechnicalDataTable
        columns={rawColumns}
        exportFileName={`omie-transacciones-raw-${selectedDownload?.id ?? "sin-seleccion"}`}
        getDuplicateKey={(row) => `${row.downloadId}|${row.rowIndex}`}
        getGroupLabel={() => ""}
        getRowId={(row) => row.id}
        getRowQuality={(row) => buildOmieTransactionRawQuality(row, selectedDownload)}
        hasNext={false}
        kpis={[]}
        loading={loading}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        page={0}
        pageSize={Math.max(rows.length, 1)}
        rows={rows}
        showModeSelector={false}
        showPagination={false}
      title="Filas RAW 4121"
      />
    </>
  );
}

function buildOmieTransactionHistoryColumns(): Array<TechnicalColumn<OmieTransactionDownloadRow>> {
  return [
    {
      id: "id",
      label: "Id",
      width: 120,
      sticky: true,
      filter: "text",
      value: (row) => row.id
    },
    {
      id: "fechaDescarga",
      label: "Descarga",
      width: 150,
      type: "date",
      filter: "text",
      value: (row) => row.fechaDescarga,
      render: (row) => formatDateTime(row.fechaDescarga)
    },
    {
      id: "estado",
      label: "Estado",
      width: 120,
      filter: "select",
      value: (row) => row.estado,
      render: (row) => <LoadStatusBadge status={row.estado} />
    },
    {
      id: "fechaDesde",
      label: "Desde",
      width: 112,
      type: "date",
      filter: "text",
      value: (row) => row.fechaDesde,
      render: (row) => formatFullDate(row.fechaDesde)
    },
    {
      id: "fechaHasta",
      label: "Hasta",
      width: 112,
      type: "date",
      filter: "text",
      value: (row) => row.fechaHasta,
      render: (row) => formatFullDate(row.fechaHasta)
    },
    {
      id: "registros",
      label: "Registros",
      width: 102,
      align: "right",
      type: "number",
      filter: "number",
      value: (row) => row.registros,
      render: (row) => formatNumber(row.registros)
    },
    {
      id: "diasConsultados",
      label: "Dias",
      width: 82,
      align: "right",
      type: "number",
      filter: "number",
      value: (row) => row.diasConsultados,
      render: (row) => formatNumber(row.diasConsultados)
    },
    {
      id: "nombreFichero",
      label: "Fichero",
      width: 180,
      filter: "text",
      visibility: "advanced",
      value: (row) => row.nombreFichero ?? ""
    },
    {
      id: "hashContenido",
      label: "Hash",
      width: 170,
      filter: "text",
      visibility: "advanced",
      value: (row) => row.hashContenido ?? ""
    },
    {
      id: "mensajeError",
      label: "Mensaje",
      width: 220,
      filter: "text",
      visibility: "advanced",
      value: (row) => row.mensajeError ?? ""
    },
    {
      id: "createdAt",
      label: "Creado",
      width: 150,
      type: "date",
      filter: "text",
      visibility: "advanced",
      value: (row) => row.createdAt,
      render: (row) => formatDateTime(row.createdAt)
    },
    {
      id: "updatedAt",
      label: "Actualizado",
      width: 150,
      type: "date",
      filter: "text",
      visibility: "advanced",
      value: (row) => row.updatedAt,
      render: (row) => formatDateTime(row.updatedAt)
    }
  ];
}

function buildOmieTransactionRawColumns(download: OmieTransactionDownloadRow | undefined, rows: OmieTransactionStagingRow[]): Array<TechnicalColumn<OmieTransactionStagingRow>> {
  const detectedColumns = download?.resumenEstructura?.columnasDetectadas ?? [];
  const fallbackColumns = download?.columnas?.map((column) => column.nombre) ?? [];
  const payloadKeys = [
    ...new Set([
      ...detectedColumns,
      ...fallbackColumns,
      ...rows.flatMap((row) => Object.keys(row.rawPayloadJson ?? {}))
    ])
  ];

  return [
    {
      id: "rowIndex",
      label: "Fila",
      width: 78,
      sticky: true,
      align: "right",
      type: "number",
      filter: "number",
      value: (row) => row.rowIndex,
      render: (row) => formatNumber(row.rowIndex)
    },
    {
      id: "diaContrato",
      label: "Dia contrato",
      width: 120,
      type: "date",
      filter: "text",
      value: (row) => row.diaContrato,
      render: (row) => formatFullDate(row.diaContrato)
    },
    ...payloadKeys.map((key): TechnicalColumn<OmieTransactionStagingRow> => ({
      id: `raw:${key}`,
      label: key,
      width: 150,
      filter: "text",
      visibility: "advanced",
      value: (row) => readOmieTransactionRawValue(row.rawPayloadJson[key]),
      render: (row) => formatTransactionRawValue(row.rawPayloadJson[key])
    })),
    {
      id: "createdAt",
      label: "Creado",
      width: 150,
      type: "date",
      filter: "text",
      visibility: "advanced",
      value: (row) => row.createdAt,
      render: (row) => formatDateTime(row.createdAt)
    },
    {
      id: "updatedAt",
      label: "Actualizado",
      width: 150,
      type: "date",
      filter: "text",
      visibility: "advanced",
      value: (row) => row.updatedAt,
      render: (row) => formatDateTime(row.updatedAt)
    }
  ];
}

function buildOmieTransactionSummary(download?: OmieTransactionDownloadRow) {
  if (!download?.resumenEstructura) {
    return undefined;
  }

  return {
    fechaDesde: formatFullDate(download.resumenEstructura.fechaDesde),
    fechaHasta: formatFullDate(download.resumenEstructura.fechaHasta),
    registrosTotales: formatNumber(download.resumenEstructura.registrosTotales),
    diasConsultados: formatNumber(download.resumenEstructura.diasConsultados),
    columnasDetectadas: formatNumber(download.resumenEstructura.columnasDetectadas.length),
    muestraFilas: formatNumber(download.resumenEstructura.muestraFilas.length)
  };
}

function buildOmieTransactionHistoryQuality(row: OmieTransactionDownloadRow, selectedId?: string): RowQuality {
  const labels = row.mensajeError ? [row.mensajeError] : [];
  if (row.id === selectedId) {
    labels.unshift("Seleccionada");
  }
  return {
    tone: row.estado === "ERROR" ? "danger" : row.id === selectedId ? "ok" : "warning",
    labels
  };
}

function buildOmieTransactionRawQuality(row: OmieTransactionStagingRow, selected?: OmieTransactionDownloadRow): RowQuality {
  return {
    tone: selected ? "ok" : "warning",
    labels: row.rawPayloadJson && Object.keys(row.rawPayloadJson).length > 0 ? [] : ["Payload vacio"]
  };
}

function readOmieTransactionRawValue(value: unknown): string | number | null | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return JSON.stringify(value);
}

function formatTransactionRawValue(value: unknown) {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "string" || typeof value === "number") {
    return stringifyCellValue(value) || "-";
  }
  if (typeof value === "boolean") {
    return value ? "Si" : "No";
  }
  return JSON.stringify(value);
}
