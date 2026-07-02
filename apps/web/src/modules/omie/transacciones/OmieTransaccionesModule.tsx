import { useMemo } from "react";
import { BarChart3, Search } from "lucide-react";
import { TechnicalDataTable } from "../../../components/technical-data-table/TechnicalDataTable";
import type { RowQuality, TechnicalColumn } from "../../../components/technical-data-table/TechnicalDataTableTypes";
import { stringifyCellValue } from "../../../components/technical-data-table/TechnicalDataTableHelpers";
import { selectOmieTransactionDownloadId } from "../../../app-shell/AppState";
import type { OmieDownloadEstado, OmieTransactionDownloadFilters, OmieTransactionDownloadRow, OmieTransactionStagingRow } from "../../../api";
import { formatDateTime } from "../../ree-losses/ReeLossesHelpers";
import { PanelTitle, formatFullDate, formatNumber } from "../../shared/RestoredModuleCommon";
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
  const rawColumns = useMemo<Array<TechnicalColumn<OmieTransactionStagingRow>>>(
    () => buildOmieTransactionRawColumns(selectedDownload, rows),
    [rows, selectedDownload]
  );

  return (
    <div className="omie-layout omie-layout-a omie-transactions-layout">
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

      {!downloads.length && !loading && (
        <div className="panel wide">
          <div className="empty-state">
            <strong>OMIE Transacciones</strong>
            <div>No hay histórico para los filtros seleccionados.</div>
            <button className="secondary-button" onClick={onGoToDownloads} type="button">
              Ir a descargas
            </button>
          </div>
        </div>
      )}

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
    </div>
  );
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
      width: 66,
      sticky: true,
      align: "right",
      type: "number",
      filter: "number",
      value: (row) => row.rowIndex,
      render: (row) => formatNumber(row.rowIndex)
    },
    {
      id: "diaContrato",
      label: "Día contrato",
      width: 108,
      type: "date",
      filter: "text",
      value: (row) => row.diaContrato,
      render: (row) => formatFullDate(row.diaContrato)
    },
    ...payloadKeys.map((key): TechnicalColumn<OmieTransactionStagingRow> => ({
      id: `raw:${key}`,
      label: key,
      width: 118,
      filter: "text",
      visibility: "advanced",
      value: (row) => readOmieTransactionRawValue(row.rawPayloadJson[key]),
      render: (row) => formatTransactionRawValue(row.rawPayloadJson[key])
    })),
    {
      id: "createdAt",
      label: "Creado",
      width: 124,
      type: "date",
      filter: "text",
      visibility: "advanced",
      value: (row) => row.createdAt,
      render: (row) => formatDateTime(row.createdAt)
    },
    {
      id: "updatedAt",
      label: "Actualizado",
      width: 124,
      type: "date",
      filter: "text",
      visibility: "advanced",
      value: (row) => row.updatedAt,
      render: (row) => formatDateTime(row.updatedAt)
    }
  ];
}

function buildOmieTransactionRawQuality(row: OmieTransactionStagingRow, selected?: OmieTransactionDownloadRow): RowQuality {
  return {
    tone: selected ? "ok" : "warning",
    labels: row.rawPayloadJson && Object.keys(row.rawPayloadJson).length > 0 ? [] : ["Payload vacío"]
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
    return value ? "Sí" : "No";
  }
  return JSON.stringify(value);
}
