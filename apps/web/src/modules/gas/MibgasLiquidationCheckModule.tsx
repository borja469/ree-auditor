import { type ReactNode, useMemo, useRef, useState } from "react";
import { BarChart3, ChevronDown, Clipboard, Download, FileDown, FileSpreadsheet, Search } from "lucide-react";
import { InlineLoading } from "../../GlobalLoadingOverlay";
import type { MibgasPrivateLiquidationCheckResponse, MibgasPrivateLiquidationCheckRow } from "../../api";

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
] as const;

type Column = {
  id: keyof MibgasPrivateLiquidationCheckRow | "gasDayLabel";
  label: string;
  align?: "left" | "right";
  value: (row: MibgasPrivateLiquidationCheckRow) => string | number | null;
  render: (row: MibgasPrivateLiquidationCheckRow) => string;
};

export function MibgasLiquidationCheckModule({
  year,
  month,
  comprobacion,
  loading,
  onYearChange,
  onMonthChange,
  onRefresh,
  onGoToDownloads
}: {
  year: string;
  month: string;
  comprobacion?: MibgasPrivateLiquidationCheckResponse;
  loading: boolean;
  onYearChange: (value: string) => void;
  onMonthChange: (value: string) => void;
  onRefresh: () => Promise<void> | void;
  onGoToDownloads: () => void;
}) {
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => new Set());
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsMenuRef = useRef<HTMLDivElement | null>(null);
  const rows = useMemo(() => comprobacion?.rows ?? [], [comprobacion]);
  const columns = useMemo<Column[]>(
    () => [
      { id: "gasDayLabel", label: "Fecha dia de gas", value: (row) => row.gasDay, render: (row) => formatFullDate(row.gasDay) },
      { id: "bidVolume", label: "Volumen total Bid", align: "right", value: (row) => numberOrNull(row.bidVolume), render: (row) => formatGasVolume(row.bidVolume) },
      { id: "askVolume", label: "Volumen total ASK", align: "right", value: (row) => numberOrNull(row.askVolume), render: (row) => formatGasVolume(row.askVolume) },
      { id: "totalVolume", label: "Volumen total", align: "right", value: (row) => numberOrNull(row.totalVolume), render: (row) => formatGasVolume(row.totalVolume) },
      { id: "weightedPrice", label: "Precio", align: "right", value: (row) => numberOrNull(row.weightedPrice), render: (row) => formatGasPrice(row.weightedPrice) },
      { id: "totalAmount", label: "Importe total", align: "right", value: (row) => numberOrNull(row.totalAmount), render: (row) => formatEuroAmount(row.totalAmount) },
      { id: "transactionCount", label: "Transacciones", align: "right", value: (row) => row.transactionCount, render: (row) => row.transactionCount.toLocaleString("es-ES") }
    ],
    []
  );
  const activeColumns = useMemo(() => columns.filter((column) => !hiddenColumns.has(column.id)), [columns, hiddenColumns]);

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

  return (
    <div className="omie-layout omie-layout-b">
      <div className="omie-control-row">
        <div className="panel wide omie-control-panel">
          <MibgasLiquidationPanelTitle icon={<BarChart3 size={18} />} title="Comprobacion de liquidaciones MIBGAS Market" subtitle="3140 - Transacciones por periodo de entrega" />
          <div className="omie-toolbar">
            <label className="filter-field">
              <span>Mes</span>
              <select disabled={loading} value={month} onChange={(event) => onMonthChange(event.target.value)}>
                {MONTH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Año</span>
              <input disabled={loading} inputMode="numeric" max="2100" min="2000" type="number" value={year} onChange={(event) => onYearChange(event.target.value)} />
            </label>
            <button className="secondary-button" disabled={loading || !year || !month} onClick={onRefresh} type="button">
              <Search size={16} />
              Consultar
            </button>
          </div>
        </div>
      </div>

      {loading && !comprobacion && (
        <div className="panel wide">
          <InlineLoading label="Cargando comprobacion de liquidaciones MIBGAS" />
        </div>
      )}

      {!loading && !comprobacion && <MibgasNoDownloadedData onGoToDownloads={onGoToDownloads} />}

      {comprobacion && (
        <>
          <div className="omie-summary-grid omie-liquidation-grid">
            <div className="panel omie-liquidation-panel">
              <MibgasLiquidationPanelTitle icon={<FileSpreadsheet size={18} />} title="Resumen mensual" />
              <div className="table-scroll">
                <table className="omie-monthly-table">
                  <thead>
                    <tr>
                      <th>Concepto</th>
                      <th>Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">Volumen Bid</th>
                      <td>{formatGasVolume(comprobacion.totals.bidVolume)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Volumen ASK</th>
                      <td>{formatGasVolume(comprobacion.totals.askVolume)}</td>
                    </tr>
                    <tr className="total-row">
                      <th scope="row">Volumen neto</th>
                      <td>{formatGasVolume(comprobacion.totals.totalVolume)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Precio ponderado</th>
                      <td>{formatGasPrice(comprobacion.totals.weightedPrice)}</td>
                    </tr>
                    <tr className="total-row">
                      <th scope="row">Importe total</th>
                      <td>{formatEuroAmount(comprobacion.totals.totalAmount)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel omie-liquidation-panel">
              <MibgasLiquidationPanelTitle icon={<BarChart3 size={18} />} title="Control" />
              <div className="technical-kpis">
                <div className="technical-kpi neutral">
                  <span>Dias gas</span>
                  <strong>{rows.length.toLocaleString("es-ES")}</strong>
                  <small>{comprobacion.month}</small>
                </div>
                <div className="technical-kpi neutral">
                  <span>Transacciones</span>
                  <strong>{comprobacion.totals.transactionCount.toLocaleString("es-ES")}</strong>
                  <small>persistidas en PostgreSQL</small>
                </div>
                <div className={`technical-kpi ${Number(comprobacion.totals.totalVolume) >= 0 ? "good" : "warning"}`}>
                  <span>Signo neto</span>
                  <strong>{Number(comprobacion.totals.totalVolume) >= 0 ? "Comprador" : "Vendedor"}</strong>
                  <small>Bid positivo / ASK negativo</small>
                </div>
              </div>
            </div>
          </div>

          <section className="panel wide omie-liquidation-panel omie-detail-table-panel">
            <div className="technical-data-head">
              <MibgasLiquidationPanelTitle icon={<FileSpreadsheet size={18} />} title="Detalle diario" subtitle={`${rows.length.toLocaleString("es-ES")} dias`} />
              <div className="technical-toolbar" role="toolbar" aria-label="Acciones de comprobacion de liquidaciones MIBGAS">
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
                <button className="secondary-button" disabled={loading || rows.length === 0} onClick={() => exportRows(comprobacion, activeColumns, "csv")} type="button">
                  <Download size={16} />
                  CSV
                </button>
                <button className="secondary-button" disabled={loading || rows.length === 0} onClick={() => exportRows(comprobacion, activeColumns, "xls")} type="button">
                  <FileDown size={16} />
                  Excel
                </button>
                <button className="secondary-button" disabled={loading || rows.length === 0} onClick={() => copyRows(rows, activeColumns)} type="button">
                  <Clipboard size={16} />
                  Copiar
                </button>
              </div>
            </div>

            <div className="table-scroll">
              <table className="omie-liquidation-table">
                <thead>
                  <tr>
                    {activeColumns.map((column) => (
                      <th className={column.align ?? "left"} key={column.id}>
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.gasDay}>
                      {activeColumns.map((column) => (
                        <td className={column.align ?? "left"} key={column.id}>
                          {column.render(row)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={activeColumns.length}>Sin transacciones MIBGAS descargadas para el mes seleccionado.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function MibgasLiquidationPanelTitle({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="omie-panel-title">
      {icon}
      <div>
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
    </div>
  );
}

function MibgasNoDownloadedData({ onGoToDownloads }: { onGoToDownloads: () => void }) {
  return (
    <div className="panel wide omie-empty-state">
      <MibgasLiquidationPanelTitle icon={<FileSpreadsheet size={18} />} title="Sin datos descargados" subtitle="MIBGAS Market" />
      <p>No existen transacciones descargadas para el mes seleccionado.</p>
      <button className="secondary-button" onClick={onGoToDownloads} type="button">
        <Download size={16} />
        Ir a descargas
      </button>
    </div>
  );
}

function exportRows(comprobacion: MibgasPrivateLiquidationCheckResponse, columns: Column[], format: "csv" | "xls") {
  const rows = [
    columns.map((column) => column.label),
    ...comprobacion.rows.map((row) => columns.map((column) => column.render(row)))
  ];
  const fileName = `mibgas-comprobacion-liquidaciones-${comprobacion.month}.${format}`;
  if (format === "xls") {
    const html = `<table>${rows.map((line, index) => `<tr>${line.map((cell) => `<${index === 0 ? "th" : "td"}>${escapeHtml(cell)}</${index === 0 ? "th" : "td"}>`).join("")}</tr>`).join("")}</table>`;
    downloadBlob(fileName, html, "application/vnd.ms-excel;charset=utf-8");
    return;
  }
  downloadBlob(fileName, rows.map((line) => line.map(csvCell).join(";")).join("\n"), "text/csv;charset=utf-8");
}

async function copyRows(rows: MibgasPrivateLiquidationCheckRow[], columns: Column[]) {
  const text = [
    columns.map((column) => column.label).join("\t"),
    ...rows.map((row) => columns.map((column) => column.render(row)).join("\t"))
  ].join("\n");
  await navigator.clipboard?.writeText(text);
}

function downloadBlob(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatFullDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatGasVolume(value: string | null) {
  return value === null ? "-" : `${formatDecimal(value, 3)} MWh`;
}

function formatGasPrice(value: string | null) {
  return value === null ? "-" : `${formatDecimal(value, 4)} €/MWh`;
}

function formatEuroAmount(value: string | null) {
  return value === null ? "-" : `${formatDecimal(value, 2)} €`;
}

function formatDecimal(value: string, maximumFractionDigits: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return parsed.toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits });
}

function numberOrNull(value: string | null) {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
