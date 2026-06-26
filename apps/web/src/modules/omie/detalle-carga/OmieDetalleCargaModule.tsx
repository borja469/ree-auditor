import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, ChevronDown, ChevronRight, Clipboard, Download, FileDown, FileSpreadsheet, Search } from "lucide-react";
import { InlineLoading } from "../../../GlobalLoadingOverlay";
import { createTechnicalDataTableAdapter } from "../../../technical-module-v2/adapters/technicalDataTableAdapter";
import { type TechnicalSortDirection } from "../../../technical-module-v2";
import type { OmieAnalisisMensualPeriodo } from "../../../api";
import {
  buildOmieMonthlyAnalysisDailyColumnRender,
  buildOmieMonthlyAnalysisDailyColumnValue,
  buildOmieMonthlyAnalysisKpis,
  buildOmieMonthlyAnalysisTotalsRow,
  buildOmieMonthlyDailyRowsV2,
  buildTechnicalColumnsSignature,
  buildTechnicalPresetHiddenColumns,
  copyTechnicalRows,
  exportTechnicalRows,
  formatFixedDecimalNumber,
  formatOmieEnergy,
  formatOmiePrice,
  formatOmieProfit,
  formatOmieProfitRate,
  omieMonthlyPeriodEnergyTotal,
  omieMonthlyPeriodProfitRate,
  normalizeNumericValue,
  pad2,
  sortOmieMonthlyAnalysisRows,
  stringifyCellValue,
  technicalNumericToneClass
} from "./OmieDetalleCargaHelpers";
import type {
  OmieDetalleCargaKpi,
  OmieDetalleCargaModuleProps,
  OmieDetalleCargaTechnicalColumn,
  OmieMonthlyAnalysisTableRow
} from "./OmieDetalleCargaTypes";

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

export function OmieDetalleCargaModule({
  year,
  month,
  analisis,
  loading,
  onYearChange,
  onMonthChange,
  onRefresh,
  onGoToDownloads
}: OmieDetalleCargaModuleProps) {
  const rows = analisis?.periodos ?? [];
  const columns = useMemo<Array<OmieDetalleCargaTechnicalColumn<OmieAnalisisMensualPeriodo>>>(
    () => [
      { id: "fecha", label: "Fecha", width: 96, type: "date", filter: "text", sticky: true, value: (row) => row.fecha },
      { id: "periodo", label: "Periodo", width: 70, align: "right", type: "number", filter: "number", sticky: true, visibility: "basic", value: (row) => row.periodo, render: (row) => row.periodo },
      { id: "programaMd", label: "Programa MD", width: 96, align: "right", type: "number", filter: "number", heatmap: false, numericTone: "zero-danger", visibility: "basic", value: (row) => row.programaMd, render: (row) => formatOmieEnergy(row.programaMd), exportValue: (row) => formatOmieEnergy(row.programaMd) },
      { id: "volIda1", label: "Vol. IDA1", width: 82, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.volIda1, render: (row) => formatOmieEnergy(row.volIda1), exportValue: (row) => formatOmieEnergy(row.volIda1) },
      { id: "volIda2", label: "Vol. IDA2", width: 82, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.volIda2, render: (row) => formatOmieEnergy(row.volIda2), exportValue: (row) => formatOmieEnergy(row.volIda2) },
      { id: "volIda3", label: "Vol. IDA3", width: 82, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.volIda3, render: (row) => formatOmieEnergy(row.volIda3), exportValue: (row) => formatOmieEnergy(row.volIda3) },
      { id: "volXbid", label: "Vol. XBID", width: 86, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.volXbid, render: (row) => formatOmieEnergy(row.volXbid), exportValue: (row) => formatOmieEnergy(row.volXbid) },
      { id: "clave", label: "Clave", width: 118, filter: "text", visibility: "advanced", value: (row) => row.clave },
      { id: "precioMd", label: "Precio MD", width: 112, align: "right", type: "number", filter: "number", visibility: "advanced", value: (row) => row.precioMd, render: (row) => formatOmiePrice(row.precioMd), exportValue: (row) => formatOmiePrice(row.precioMd) },
      { id: "precioIda1", label: "Precio IDA1", width: 120, align: "right", type: "number", filter: "number", visibility: "advanced", value: (row) => row.precioIda1, render: (row) => formatOmiePrice(row.precioIda1), exportValue: (row) => formatOmiePrice(row.precioIda1) },
      { id: "precioIda2", label: "Precio IDA2", width: 120, align: "right", type: "number", filter: "number", visibility: "advanced", value: (row) => row.precioIda2, render: (row) => formatOmiePrice(row.precioIda2), exportValue: (row) => formatOmiePrice(row.precioIda2) },
      { id: "precioIda3", label: "Precio IDA3", width: 120, align: "right", type: "number", filter: "number", visibility: "advanced", value: (row) => row.precioIda3, render: (row) => formatOmiePrice(row.precioIda3), exportValue: (row) => formatOmiePrice(row.precioIda3) },
      { id: "precioXbid", label: "Precio XBID", width: 124, align: "right", type: "number", filter: "number", visibility: "advanced", value: (row) => row.precioXbid, render: (row) => formatOmiePrice(row.precioXbid), exportValue: (row) => formatOmiePrice(row.precioXbid) },
      { id: "programaIda1", label: "Programa IDA1", width: 136, align: "right", type: "number", filter: "number", heatmap: false, numericTone: "zero-danger", visibility: "advanced", value: (row) => row.programaIda1, render: (row) => formatOmieEnergy(row.programaIda1), exportValue: (row) => formatOmieEnergy(row.programaIda1) },
      { id: "programaIda2", label: "Programa IDA2", width: 136, align: "right", type: "number", filter: "number", heatmap: false, numericTone: "zero-danger", visibility: "advanced", value: (row) => row.programaIda2, render: (row) => formatOmieEnergy(row.programaIda2), exportValue: (row) => formatOmieEnergy(row.programaIda2) },
      { id: "programaIda3", label: "Programa IDA3", width: 136, align: "right", type: "number", filter: "number", heatmap: false, numericTone: "zero-danger", visibility: "advanced", value: (row) => row.programaIda3, render: (row) => formatOmieEnergy(row.programaIda3), exportValue: (row) => formatOmieEnergy(row.programaIda3) },
      { id: "energiaTotal", label: "Energía total", width: 96, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => omieMonthlyPeriodEnergyTotal(row), render: (row) => formatOmieEnergy(omieMonthlyPeriodEnergyTotal(row)), exportValue: (row) => formatOmieEnergy(omieMonthlyPeriodEnergyTotal(row)) },
      { id: "profitIda1", label: "Profit IDA1", width: 94, align: "right", type: "number", filter: "number", numericTone: "signed", visibility: "basic", value: (row) => row.profitIda1, render: (row) => formatOmieProfit(row.profitIda1), exportValue: (row) => formatOmieProfit(row.profitIda1) },
      { id: "profitIda2", label: "Profit IDA2", width: 94, align: "right", type: "number", filter: "number", numericTone: "signed", visibility: "basic", value: (row) => row.profitIda2, render: (row) => formatOmieProfit(row.profitIda2), exportValue: (row) => formatOmieProfit(row.profitIda2) },
      { id: "profitIda3", label: "Profit IDA3", width: 94, align: "right", type: "number", filter: "number", numericTone: "signed", visibility: "basic", value: (row) => row.profitIda3, render: (row) => formatOmieProfit(row.profitIda3), exportValue: (row) => formatOmieProfit(row.profitIda3) },
      { id: "profitXbid", label: "Profit XBID", width: 98, align: "right", type: "number", filter: "number", numericTone: "signed", visibility: "basic", value: (row) => row.profitXbid, render: (row) => formatOmieProfit(row.profitXbid), exportValue: (row) => formatOmieProfit(row.profitXbid) },
      { id: "sumaProfit", label: "Profit total", width: 98, align: "right", type: "number", filter: "number", numericTone: "signed", visibility: "basic", value: (row) => row.sumaProfit, render: (row) => formatOmieProfit(row.sumaProfit), exportValue: (row) => formatOmieProfit(row.sumaProfit) },
      { id: "profitMedioEurMWh", label: "Profit medio €/MWh", width: 118, align: "right", type: "number", filter: "number", numericTone: "signed", visibility: "basic", value: (row) => omieMonthlyPeriodProfitRate(row), render: (row) => formatOmieProfitRate(omieMonthlyPeriodProfitRate(row)), exportValue: (row) => formatOmieProfitRate(omieMonthlyPeriodProfitRate(row)) },
      { id: "pciMdIda1", label: "PCI MD-IDA1", width: 126, align: "right", type: "number", filter: "number", numericTone: "signed", visibility: "advanced", value: (row) => row.pciMdIda1, render: (row) => formatOmieEnergy(row.pciMdIda1), exportValue: (row) => formatOmieEnergy(row.pciMdIda1) },
      { id: "pciIda1Ida2", label: "PCI IDA1-IDA2", width: 132, align: "right", type: "number", filter: "number", numericTone: "signed", visibility: "advanced", value: (row) => row.pciIda1Ida2, render: (row) => formatOmieEnergy(row.pciIda1Ida2), exportValue: (row) => formatOmieEnergy(row.pciIda1Ida2) },
      { id: "pciIda2Ida3", label: "PCI IDA2-IDA3", width: 132, align: "right", type: "number", filter: "number", numericTone: "signed", visibility: "advanced", value: (row) => row.pciIda2Ida3, render: (row) => formatOmieEnergy(row.pciIda2Ida3), exportValue: (row) => formatOmieEnergy(row.pciIda2Ida3) },
      { id: "pciIda3Xbid", label: "PCI IDA3-XBID", width: 132, align: "right", type: "number", filter: "number", numericTone: "signed", visibility: "advanced", value: (row) => row.pciIda3Xbid, render: (row) => formatOmieEnergy(row.pciIda3Xbid), exportValue: (row) => formatOmieEnergy(row.pciIda3Xbid) },
      { id: "profitXbidEurMWh", label: "Profit unit. XBID", width: 138, align: "right", type: "number", filter: "number", numericTone: "signed", visibility: "advanced", value: (row) => row.profitXbidEurMWh, render: (row) => formatOmieProfitRate(row.profitXbidEurMWh), exportValue: (row) => formatOmieProfitRate(row.profitXbidEurMWh) }
    ],
    []
  );

  return (
    <div className="omie-layout omie-layout-a omie-detail-load-layout">
      <div className="panel wide omie-control-panel">
          <OmieDetalleCargaPanelTitle icon={<BarChart3 size={18} />} title="Detalle de Carga" subtitle="Precios · Programas · Volúmenes · Profit" />
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

      {loading && !analisis && (
        <div className="panel wide">
          <InlineLoading label="Cargando detalle de carga OMIE" />
        </div>
      )}

      {!loading && !analisis && <OmieNoDownloadedData onGoToDownloads={onGoToDownloads} />}

      {analisis && (
        <OmieMonthlyAnalysisDailyTable
          columns={columns}
          exportFileName={`omie-detalle-carga-${analisis.mes}`}
          kpis={buildOmieMonthlyAnalysisKpis(analisis)}
          loading={loading}
          rows={rows}
          title={`Detalle de Carga · ${analisis.totalFilas.toLocaleString("es-ES")} filas`}
        />
      )}
    </div>
  );
}

function OmieMonthlyAnalysisDailyTable({
  title,
  rows,
  columns,
  kpis,
  loading,
  exportFileName
}: {
  title: string;
  rows: OmieAnalisisMensualPeriodo[];
  columns: Array<OmieDetalleCargaTechnicalColumn<OmieAnalisisMensualPeriodo>>;
  kpis: OmieDetalleCargaKpi[];
  loading: boolean;
  exportFileName: string;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ id: string; direction: TechnicalSortDirection } | undefined>({ id: "fecha", direction: "asc" });
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => buildTechnicalPresetHiddenColumns(columns, "basic"));
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());
  const columnsMenuRef = useRef<HTMLDivElement | null>(null);
  const columnsSignatureRef = useRef("");
  const columnsSignature = useMemo(() => buildTechnicalColumnsSignature(columns), [columns]);

  const sortedRows = useMemo(() => sortOmieMonthlyAnalysisRows(rows), [rows]);
  const dailyRows = useMemo(() => buildOmieMonthlyDailyRowsV2(sortedRows), [sortedRows]);
  const dailyColumns = useMemo<Array<OmieDetalleCargaTechnicalColumn<OmieMonthlyAnalysisTableRow>>>(() => {
    const periodosColumn: OmieDetalleCargaTechnicalColumn<OmieMonthlyAnalysisTableRow> = {
      id: "periodos",
      label: "Nº periodos",
      width: 70,
      align: "right",
      type: "number",
      filter: "number",
      visibility: "basic",
      value: (row) => ("rows" in row ? row.periodos : row.periodo),
      render: (row) => ("rows" in row ? row.periodos : `P${pad2(row.periodo)}`),
      exportValue: (row) => ("rows" in row ? row.periodos : row.periodo)
    };

    return columns.flatMap((column) => {
      if (column.id === "periodo") {
        return [];
      }

      const value = (row: OmieMonthlyAnalysisTableRow) => buildOmieMonthlyAnalysisDailyColumnValue(column.id, row);
      const dailyColumn: OmieDetalleCargaTechnicalColumn<OmieMonthlyAnalysisTableRow> = {
        id: column.id,
        label: column.label,
        help: column.help,
        width: column.width,
        align: column.align,
        type: column.type,
        sticky: column.sticky,
        visibility: column.visibility,
        advanced: column.advanced,
        heatmap: column.heatmap,
        heatmapTone: column.heatmapTone,
        numericTone: column.numericTone,
        filter: column.filter,
        defaultHidden: column.defaultHidden,
        value,
        render:
          column.id === "fecha"
            ? (row: OmieMonthlyAnalysisTableRow) =>
                "rows" in row ? (
                  <button className="row-toggle-button" onClick={() => toggleDay(row.fecha)} type="button">
                    {expandedDays.has(row.fecha) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    {row.fecha}
                  </button>
                ) : (
                  row.fecha
                )
            : (row: OmieMonthlyAnalysisTableRow) => buildOmieMonthlyAnalysisDailyColumnRender(column.id, value(row)),
        exportValue: value
      };

      return column.id === "fecha" ? [dailyColumn, periodosColumn] : [dailyColumn];
    });
  }, [columns, expandedDays]);
  const adapterColumns = useMemo<Array<OmieDetalleCargaTechnicalColumn<OmieMonthlyAnalysisTableRow>>>(
    () =>
      dailyColumns.map((column) => ({
        id: column.id,
        label: column.label,
        help: column.help,
        width: column.width,
        align: column.align,
        type: column.type,
        sticky: column.sticky,
        visibility: column.visibility,
        advanced: column.advanced,
        filter: column.filter,
        defaultHidden: Boolean(column.defaultHidden),
        value: column.value,
        render: column.render,
        exportValue: column.exportValue
      })),
    [dailyColumns]
  );
  const dailyAdapter = useMemo(
    () =>
      createTechnicalDataTableAdapter({
        rows: dailyRows,
        columns: adapterColumns,
        state: {
          mode: "basic",
          search,
          filters,
          sort: sort ? { columnId: sort.id, direction: sort.direction } : undefined,
          hiddenColumns: [...hiddenColumns]
        },
        showModeSelector: true
      }),
    [adapterColumns, dailyRows, filters, hiddenColumns, search, sort]
  );
  const activeDailyColumnIds = useMemo(() => new Set(dailyAdapter.activeColumns.map((column) => column.id)), [dailyAdapter.activeColumns]);
  const activeDailyColumns = useMemo(() => dailyColumns.filter((column) => activeDailyColumnIds.has(column.id)), [activeDailyColumnIds, dailyColumns]);
  const activeDetailColumns = useMemo(() => columns.filter((column) => column.id === "fecha" || !hiddenColumns.has(column.id)), [columns, hiddenColumns]);
  const dailySelectOptions = dailyAdapter.filterOptions;
  const filteredDailyRows = dailyAdapter.sortedRows;
  const filteredDetailRows = useMemo(() => filteredDailyRows.flatMap((row) => row.rows), [filteredDailyRows]);

  useEffect(() => {
    if (!columnsSignatureRef.current) {
      columnsSignatureRef.current = columnsSignature;
      return;
    }
    if (columnsSignatureRef.current !== columnsSignature) {
      columnsSignatureRef.current = columnsSignature;
      setHiddenColumns(buildTechnicalPresetHiddenColumns(columns, "basic"));
      return;
    }
    setHiddenColumns((current) => {
      const available = new Set(columns.map((column) => column.id));
      const next = new Set([...current].filter((columnId) => available.has(columnId)));
      return next.size === current.size ? current : next;
    });
  }, [columns, columnsSignature]);

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

  function updateSort(column: OmieDetalleCargaTechnicalColumn<OmieMonthlyAnalysisTableRow>) {
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
  }

  function toggleColumn(columnId: string) {
    setHiddenColumns((current) => {
      const next = new Set(current);
      if (next.has(columnId)) {
        next.delete(columnId);
      } else if (activeDetailColumns.length > 1) {
        next.add(columnId);
      }
      return next;
    });
  }

  function toggleDay(fecha: string) {
    setExpandedDays((current) => {
      const next = new Set(current);
      if (next.has(fecha)) {
        next.delete(fecha);
      } else {
        next.add(fecha);
      }
      return next;
    });
  }

  function renderRowCell(column: OmieDetalleCargaTechnicalColumn<OmieMonthlyAnalysisTableRow>, row: OmieMonthlyAnalysisTableRow, isDetailRow: boolean) {
    const raw = column.value(row);
    const numeric = column.type === "number" ? normalizeNumericValue(raw) : undefined;
    const className = `${column.align ?? (column.type === "number" ? "right" : "left")} ${technicalNumericToneClass(column, numeric)}`;

    let content: ReactNode;
    if (column.id === "fecha") {
      content =
        "rows" in row ? (
          <button className="row-toggle-button" onClick={() => toggleDay(row.fecha)} type="button">
            {expandedDays.has(row.fecha) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            {row.fecha}
          </button>
        ) : (
          row.fecha
        );
    } else if (column.id === "periodos" && !("rows" in row)) {
      content = column.render ? column.render(row) : `P${pad2(row.periodo)}`;
    } else {
      content = column.render ? column.render(row) : column.type === "number" ? formatNumber(raw) : stringifyCellValue(raw) || "-";
    }

    return { className: `${className} ${isDetailRow ? "omie-monthly-analysis-detail-cell" : ""}`, content };
  }

  function exportMonthlyAnalysis(format: "csv" | "xls") {
    exportTechnicalRows(
      `${exportFileName}.${format}`,
      activeDetailColumns,
      filteredDetailRows,
      format,
      buildOmieMonthlyAnalysisTotalsRow(filteredDetailRows)
    );
  }

  return (
    <section className="panel wide omie-liquidation-panel omie-monthly-analysis-panel">
      <div className="technical-data-head">
        <OmieDetalleCargaPanelTitle
          icon={<FileSpreadsheet size={18} />}
          title={title}
          subtitle={`${filteredDailyRows.length.toLocaleString("es-ES")} días · ${filteredDetailRows.length.toLocaleString("es-ES")} periodos`}
        />
        <div className="technical-toolbar" role="toolbar" aria-label="Acciones de Detalle de Carga">
          <label className="technical-search">
            <Search size={15} />
            <input
              aria-label="Buscar en días"
              disabled={loading}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar..."
              value={search}
            />
          </label>
          <div className="column-menu" ref={columnsMenuRef}>
            <button className="secondary-button" disabled={loading} onClick={() => setColumnsOpen((current) => !current)} type="button">
              <ChevronDown size={16} />
              Columnas
            </button>
            {columnsOpen && (
              <div className="column-menu-popover">
                {columns.map((column) => {
                  const hidden = hiddenColumns.has(column.id);
                  const disabledColumn = !hidden && activeDetailColumns.length <= 1;
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
          <button className="secondary-button" disabled={loading || filteredDailyRows.length === 0} onClick={() => setExpandedDays(new Set(filteredDailyRows.map((row) => row.fecha)))} type="button">
            <ChevronDown size={16} />
            Expandir todos
          </button>
          <button className="secondary-button" disabled={loading || expandedDays.size === 0} onClick={() => setExpandedDays(new Set())} type="button">
            <ChevronRight size={16} />
            Contraer todos
          </button>
          <button className="secondary-button" disabled={loading} onClick={() => exportMonthlyAnalysis("csv")} type="button">
            <Download size={16} />
            CSV
          </button>
          <button className="secondary-button" disabled={loading} onClick={() => exportMonthlyAnalysis("xls")} type="button">
            <FileDown size={16} />
            Excel
          </button>
          <button className="secondary-button" disabled={loading} onClick={() => copyTechnicalRows(activeDetailColumns, filteredDetailRows, buildOmieMonthlyAnalysisTotalsRow(filteredDetailRows))} type="button">
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

      <div className="table-scroll">
        <table className="omie-liquidation-table omie-monthly-analysis-table">
          <thead>
            <tr>
              {activeDailyColumns.map((column) => (
                <th key={column.id} style={{ width: column.width }}>
                  <button className="table-sort-button" disabled={loading} onClick={() => updateSort(column)} type="button">
                    {column.label}
                    {sort?.id === column.id && <small>{sort.direction === "asc" ? "↑" : "↓"}</small>}
                  </button>
                </th>
              ))}
            </tr>
            <tr className="omie-monthly-analysis-filter-row">
              {activeDailyColumns.map((column) => (
                <th key={column.id} style={{ width: column.width }}>
                  {column.filter === "number" ? (
                    <div className="range-filter">
                      <input aria-label={`${column.label} mínimo`} disabled={loading} onChange={(event) => updateFilter(`${column.id}:min`, event.target.value)} placeholder="Min" value={filters[`${column.id}:min`] ?? ""} />
                      <input aria-label={`${column.label} máximo`} disabled={loading} onChange={(event) => updateFilter(`${column.id}:max`, event.target.value)} placeholder="Max" value={filters[`${column.id}:max`] ?? ""} />
                    </div>
                  ) : column.filter === "select" ? (
                    <select aria-label={`Filtrar ${column.label}`} disabled={loading} onChange={(event) => updateFilter(column.id, event.target.value)} value={filters[column.id] ?? ""}>
                      <option value="">Todos</option>
                      {(dailySelectOptions[column.id] ?? []).map((option) => (
                        <option key={String(option.value)} value={String(option.value)}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input aria-label={`Filtrar ${column.label}`} disabled={loading} onChange={(event) => updateFilter(column.id, event.target.value)} placeholder="Filtrar" value={filters[column.id] ?? ""} />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredDailyRows.flatMap((day) => [
              <tr className="omie-liquidation-day-row" key={day.fecha}>
                {activeDailyColumns.map((column, index) => {
                  const cell = renderRowCell(column, day, false);
                  return index === 0 ? (
                    <th className={cell.className} key={column.id} scope="row" style={{ width: column.width }}>
                      {cell.content}
                    </th>
                  ) : (
                    <td className={cell.className} key={column.id} style={{ width: column.width }}>
                      {cell.content}
                    </td>
                  );
                })}
              </tr>,
              ...(expandedDays.has(day.fecha)
                ? day.rows.map((row) => (
                    <tr className="omie-liquidation-hour-row omie-monthly-analysis-detail-row" key={row.clave}>
                      {activeDailyColumns.map((column, index) => {
                        const cell = renderRowCell(column, row, true);
                        return index === 0 ? (
                          <th className={cell.className} key={column.id} scope="row" style={{ width: column.width }}>
                            {cell.content}
                          </th>
                        ) : (
                          <td className={cell.className} key={column.id} style={{ width: column.width }}>
                            {cell.content}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                : [])
            ])}
          </tbody>
        </table>
        {filteredDailyRows.length === 0 && <div className="empty-state">Sin coincidencias con los filtros actuales.</div>}
        {loading && <InlineLoading label="Actualizando detalle de carga" />}
      </div>
    </section>
  );
}

function OmieDetalleCargaPanelTitle({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle?: ReactNode }) {
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

function OmieNoDownloadedData({ onGoToDownloads }: { onGoToDownloads: () => void }) {
  return (
    <div className="panel wide">
      <OmieNoDownloadedDataContent onGoToDownloads={onGoToDownloads} />
    </div>
  );
}

function OmieNoDownloadedDataContent({ onGoToDownloads }: { onGoToDownloads: () => void }) {
  return (
    <div className="empty-state omie-empty-with-action">
      <span>No existen datos descargados para los filtros seleccionados. Utilice OMIE &gt; Descargas para realizar la descarga.</span>
      <button className="secondary-button" onClick={onGoToDownloads} type="button">
        <Download size={16} />
        Ir a OMIE &gt; Descargas
      </button>
    </div>
  );
}

function formatNumber(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : formatFixedDecimalNumber(numeric, 2);
}
