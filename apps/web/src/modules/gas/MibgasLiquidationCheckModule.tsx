import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, ChevronDown, Clipboard, Download, FileDown, FileSpreadsheet, Search } from "lucide-react";
import { InlineLoading } from "../../GlobalLoadingOverlay";
import { getMibgasPrivateLiquidationCheck, type MibgasPrivateLiquidationCheckResponse, type MibgasPrivateLiquidationCheckRow } from "../../api";

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

type MibgasWeeklyGroup = {
  key: string;
  rows: MibgasPrivateLiquidationCheckRow[];
  summary: MibgasWeeklySummary;
};

type MibgasWeeklySummary = MibgasPrivateLiquidationCheckResponse["totals"] & {
  key: string;
  weekLabel: string;
  startDateLabel: string;
  endDateLabel: string;
};

type MibgasAnnualSummaryCell = {
  totalVolume: string | null;
  weightedPrice: string | null;
  totalAmount: string | null;
  grossVolume: string | null;
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
  const [annualChecks, setAnnualChecks] = useState<Array<MibgasPrivateLiquidationCheckResponse | null>>([]);
  const [annualLoading, setAnnualLoading] = useState(false);
  const columnsMenuRef = useRef<HTMLDivElement | null>(null);
  const rows = useMemo(() => [...(comprobacion?.rows ?? [])].sort((left, right) => left.gasDay.localeCompare(right.gasDay)), [comprobacion]);
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
  const weeklyGroups = useMemo(() => buildMibgasWeeklyGroups(rows), [rows]);
  const annualSummary = useMemo(() => buildMibgasAnnualSummary(annualChecks), [annualChecks]);

  useEffect(() => {
    let cancelled = false;
    const numericYear = Number(year);
    if (!Number.isFinite(numericYear) || numericYear < 2000 || numericYear > 2100) {
      setAnnualChecks([]);
      return undefined;
    }

    setAnnualLoading(true);
    Promise.allSettled(MONTH_OPTIONS.map((option) => getMibgasPrivateLiquidationCheck(numericYear, option.value)))
      .then((results) => {
        if (cancelled) {
          return;
        }
        setAnnualChecks(results.map((result) => (result.status === "fulfilled" ? result.value : null)));
      })
      .finally(() => {
        if (!cancelled) {
          setAnnualLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [year]);

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
          <MibgasAnnualSummaryTable loading={annualLoading} month={month} summary={annualSummary} year={year} />

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
                <button className="secondary-button" disabled={loading || rows.length === 0} onClick={() => exportRows(comprobacion, weeklyGroups, activeColumns, "csv")} type="button">
                  <Download size={16} />
                  CSV
                </button>
                <button className="secondary-button" disabled={loading || rows.length === 0} onClick={() => exportRows(comprobacion, weeklyGroups, activeColumns, "xls")} type="button">
                  <FileDown size={16} />
                  Excel
                </button>
                <button className="secondary-button" disabled={loading || rows.length === 0} onClick={() => copyRows(weeklyGroups, activeColumns)} type="button">
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
                  {weeklyGroups.flatMap((group) => [
                    ...group.rows.map((row) => (
                      <tr key={row.gasDay}>
                        {activeColumns.map((column) => (
                          <td className={column.align ?? "left"} key={column.id}>
                            {column.render(row)}
                          </td>
                        ))}
                      </tr>
                    )),
                    <tr className="omie-liquidation-week-row ok" key={`week-${group.key}`}>
                      <td colSpan={activeColumns.length}>
                        <div className="omie-week-summary">
                          <div className="omie-week-summary-heading">
                            <strong>{group.summary.weekLabel}</strong>
                            <span>
                              {group.summary.startDateLabel} - {group.summary.endDateLabel}
                            </span>
                          </div>
                          <div className="omie-week-summary-values">
                            <span>Volumen Bid: {formatGasVolume(group.summary.bidVolume)}</span>
                            <span>Volumen ASK: {formatGasVolume(group.summary.askVolume)}</span>
                            <span>Volumen neto: {formatGasVolume(group.summary.totalVolume)}</span>
                            <span>Precio ponderado: {formatGasPrice(group.summary.weightedPrice)}</span>
                            <span>Importe total: {formatEuroAmount(group.summary.totalAmount)}</span>
                            <span>Transacciones: {group.summary.transactionCount.toLocaleString("es-ES")}</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ])}
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

function MibgasAnnualSummaryTable({
  year,
  month,
  summary,
  loading
}: {
  year: string;
  month: string;
  summary: MibgasAnnualSummaryCell[];
  loading: boolean;
}) {
  const total = useMemo(() => buildMibgasAnnualSummaryTotal(summary), [summary]);
  const rows: Array<{ id: keyof Pick<MibgasAnnualSummaryCell, "totalVolume" | "weightedPrice" | "totalAmount">; label: string }> = [
    { id: "totalVolume", label: "Volumen total" },
    { id: "weightedPrice", label: "Precio ponderado" },
    { id: "totalAmount", label: "Coste total" }
  ];

  return (
    <section className="panel wide omie-annual-summary-panel">
      <div className="technical-data-head">
        <MibgasLiquidationPanelTitle
          icon={<BarChart3 size={18} />}
          title={`Resumen anual ${year || "-"}`}
          subtitle={loading ? "Cargando meses" : "Meses del año seleccionado"}
        />
      </div>
      <div className="table-scroll omie-annual-summary-scroll">
        <table className="omie-liquidation-table omie-annual-summary-table">
          <thead>
            <tr>
              <th>Metrica</th>
              {MONTH_OPTIONS.map((monthOption) => (
                <th className={monthOption.value === month ? "selected-month" : ""} key={monthOption.value}>
                  {monthOption.label.slice(0, 3)}
                </th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.label}</th>
                {summary.map((cell, index) => (
                  <td className={`right ${MONTH_OPTIONS[index].value === month ? "selected-month" : ""}`} key={`${row.id}-${MONTH_OPTIONS[index].value}`}>
                    {formatMibgasAnnualSummaryValue(row.id, cell[row.id])}
                  </td>
                ))}
                <td className="omie-annual-summary-total right">{formatMibgasAnnualSummaryValue(row.id, total[row.id])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <InlineLoading label="Cargando resumen anual MIBGAS" />}
      </div>
    </section>
  );
}

function buildMibgasAnnualSummary(checks: Array<MibgasPrivateLiquidationCheckResponse | null>): MibgasAnnualSummaryCell[] {
  return MONTH_OPTIONS.map((_, index) => {
    const check = checks[index];
    if (!check) {
      return emptyAnnualSummaryCell();
    }

    const totals = check.totals;
    return {
      totalVolume: totals.totalVolume,
      weightedPrice: totals.weightedPrice,
      totalAmount: totals.totalAmount,
      grossVolume: formatNumericString(Math.abs(numberOrNull(totals.bidVolume) ?? 0) + Math.abs(numberOrNull(totals.askVolume) ?? 0))
    };
  });
}

function buildMibgasAnnualSummaryTotal(summary: MibgasAnnualSummaryCell[]): MibgasAnnualSummaryCell {
  const totalVolume = sumNullableNumberStrings(summary.map((cell) => cell.totalVolume));
  const totalAmount = sumNullableNumberStrings(summary.map((cell) => cell.totalAmount));
  const grossVolume = sumNullableNumberStrings(summary.map((cell) => cell.grossVolume));
  const weightedAmount = summary.reduce((sum, cell) => {
    const price = numberOrNull(cell.weightedPrice);
    const volume = numberOrNull(cell.grossVolume);
    return price === null || volume === null ? sum : sum + price * volume;
  }, 0);
  const weightedPrice = grossVolume === null || grossVolume === 0 ? null : weightedAmount / grossVolume;

  return {
    totalVolume: totalVolume === null ? null : formatNumericString(totalVolume),
    weightedPrice: weightedPrice === null ? null : formatNumericString(weightedPrice),
    totalAmount: totalAmount === null ? null : formatNumericString(totalAmount),
    grossVolume: grossVolume === null ? null : formatNumericString(grossVolume)
  };
}

function emptyAnnualSummaryCell(): MibgasAnnualSummaryCell {
  return {
    totalVolume: null,
    weightedPrice: null,
    totalAmount: null,
    grossVolume: null
  };
}

function formatMibgasAnnualSummaryValue(metric: keyof Pick<MibgasAnnualSummaryCell, "totalVolume" | "weightedPrice" | "totalAmount">, value: string | null) {
  if (metric === "totalVolume") {
    return formatGasVolume(value);
  }
  if (metric === "weightedPrice") {
    return formatGasPrice(value);
  }
  return formatEuroAmount(value);
}

function buildMibgasWeeklyGroups(rows: MibgasPrivateLiquidationCheckRow[]): MibgasWeeklyGroup[] {
  const groups = new Map<string, MibgasPrivateLiquidationCheckRow[]>();

  for (const row of rows) {
    const week = getIsoWeekInfo(row.gasDay);
    const current = groups.get(week.key);
    if (current) {
      current.push(row);
    } else {
      groups.set(week.key, [row]);
    }
  }

  return [...groups.entries()].map(([key, groupRows]) => ({
    key,
    rows: groupRows,
    summary: buildMibgasWeeklySummary(key, groupRows)
  }));
}

function buildMibgasWeeklySummary(key: string, rows: MibgasPrivateLiquidationCheckRow[]): MibgasWeeklySummary {
  const startRow = rows[0];
  const endRow = rows[rows.length - 1];
  const totals = buildMibgasTotals(rows);
  const weekInfo = getIsoWeekInfo(startRow?.gasDay ?? key);
  return {
    key,
    weekLabel: weekInfo.label,
    startDateLabel: startRow ? formatFullDate(startRow.gasDay) : "-",
    endDateLabel: endRow ? formatFullDate(endRow.gasDay) : "-",
    ...totals
  };
}

function buildMibgasTotals(rows: MibgasPrivateLiquidationCheckRow[]): MibgasPrivateLiquidationCheckResponse["totals"] {
  const bidVolume = sumNumberStrings(rows.map((row) => row.bidVolume));
  const askVolume = sumNumberStrings(rows.map((row) => row.askVolume));
  const totalVolume = sumNumberStrings(rows.map((row) => row.totalVolume));
  const weightedBase = rows.reduce((sum, row) => {
    const price = numberOrNull(row.weightedPrice);
    const grossVolume = Math.abs(numberOrNull(row.bidVolume) ?? 0) + Math.abs(numberOrNull(row.askVolume) ?? 0);
    return price === null ? sum : sum + grossVolume;
  }, 0);
  const weightedAmount = rows.reduce((sum, row) => {
    const price = numberOrNull(row.weightedPrice);
    const grossVolume = Math.abs(numberOrNull(row.bidVolume) ?? 0) + Math.abs(numberOrNull(row.askVolume) ?? 0);
    return price === null ? sum : sum + grossVolume * price;
  }, 0);
  const weightedPrice = weightedBase === 0 ? null : weightedAmount / weightedBase;
  const totalAmount = weightedPrice === null ? null : totalVolume * weightedPrice;
  return {
    bidVolume: formatNumericString(bidVolume),
    askVolume: formatNumericString(askVolume),
    totalVolume: formatNumericString(totalVolume),
    weightedPrice: weightedPrice === null ? null : formatNumericString(weightedPrice),
    totalAmount: totalAmount === null ? null : formatNumericString(totalAmount),
    transactionCount: rows.reduce((sum, row) => sum + row.transactionCount, 0)
  };
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

function exportRows(comprobacion: MibgasPrivateLiquidationCheckResponse, weeklyGroups: MibgasWeeklyGroup[], columns: Column[], format: "csv" | "xls") {
  const sections = buildMibgasExportSections(comprobacion, weeklyGroups, columns);
  const fileName = `mibgas-comprobacion-liquidaciones-${comprobacion.month}.${format}`;
  if (format === "xls") {
    const html = sections
      .map(
        (section) =>
          `<h2>${escapeHtml(section.title)}</h2><table>${section.rows.map((line, index) => `<tr>${line.map((cell) => `<${index === 0 ? "th" : "td"}>${escapeHtml(cell)}</${index === 0 ? "th" : "td"}>`).join("")}</tr>`).join("")}</table>`
      )
      .join("<br/>");
    downloadBlob(fileName, html, "application/vnd.ms-excel;charset=utf-8");
    return;
  }
  const csv = sections
    .flatMap((section) => [[section.title], ...section.rows, []])
    .map((line) => line.map(csvCell).join(";"))
    .join("\n");
  downloadBlob(fileName, csv, "text/csv;charset=utf-8");
}

async function copyRows(weeklyGroups: MibgasWeeklyGroup[], columns: Column[]) {
  const rows = weeklyGroups.flatMap((group) => group.rows);
  const weeklyRows = weeklyGroups.map((group) => formatWeeklySummaryRow(group.summary));
  const text = [
    "Detalle diario",
    columns.map((column) => column.label).join("\t"),
    ...rows.map((row) => columns.map((column) => column.render(row)).join("\t")),
    "",
    "Resumen semanal",
    weeklySummaryHeaders().join("\t"),
    ...weeklyRows.map((row) => row.join("\t"))
  ].join("\n");
  await navigator.clipboard?.writeText(text);
}

function buildMibgasExportSections(comprobacion: MibgasPrivateLiquidationCheckResponse, weeklyGroups: MibgasWeeklyGroup[], columns: Column[]) {
  const rows = weeklyGroups.flatMap((group) => group.rows);
  return [
    {
      title: "Resumen mensual",
      rows: [
        ["Concepto", "Valor"],
        ["Volumen Bid", formatGasVolume(comprobacion.totals.bidVolume)],
        ["Volumen ASK", formatGasVolume(comprobacion.totals.askVolume)],
        ["Volumen neto", formatGasVolume(comprobacion.totals.totalVolume)],
        ["Precio ponderado", formatGasPrice(comprobacion.totals.weightedPrice)],
        ["Importe total", formatEuroAmount(comprobacion.totals.totalAmount)],
        ["Transacciones", comprobacion.totals.transactionCount.toLocaleString("es-ES")]
      ]
    },
    {
      title: "Detalle diario",
      rows: [
        columns.map((column) => column.label),
        ...rows.map((row) => columns.map((column) => column.render(row)))
      ]
    },
    {
      title: "Resumen semanal",
      rows: [
        weeklySummaryHeaders(),
        ...weeklyGroups.map((group) => formatWeeklySummaryRow(group.summary))
      ]
    }
  ];
}

function weeklySummaryHeaders() {
  return ["Semana", "Periodo", "Volumen Bid", "Volumen ASK", "Volumen neto", "Precio ponderado", "Importe total", "Transacciones"];
}

function formatWeeklySummaryRow(summary: MibgasWeeklySummary) {
  return [
    summary.weekLabel,
    `${summary.startDateLabel} - ${summary.endDateLabel}`,
    formatGasVolume(summary.bidVolume),
    formatGasVolume(summary.askVolume),
    formatGasVolume(summary.totalVolume),
    formatGasPrice(summary.weightedPrice),
    formatEuroAmount(summary.totalAmount),
    summary.transactionCount.toLocaleString("es-ES")
  ];
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

function getIsoWeekInfo(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return { key: value, label: "SEMANA" };
  }

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return {
    key: `${date.getUTCFullYear()}-W${pad2(week)}`,
    label: `SEMANA ${week}`
  };
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

function sumNumberStrings(values: string[]) {
  return values.reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function sumNullableNumberStrings(values: Array<string | null>) {
  const present = values
    .map((value) => (value === null ? null : Number(value)))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  return present.length === 0 ? null : present.reduce((sum, value) => sum + value, 0);
}

function formatNumericString(value: number) {
  return value.toFixed(8).replace(/\.?0+$/, "");
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}
