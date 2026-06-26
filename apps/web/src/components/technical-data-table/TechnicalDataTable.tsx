import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Clipboard, Download, FileDown, FileSpreadsheet, Search } from "lucide-react";
import { InlineLoading } from "../../GlobalLoadingOverlay";
import {
  buildTechnicalColumnsSignature,
  buildTechnicalPresetHiddenColumns,
  buildTechnicalQuality,
  copyTechnicalRows,
  exportTechnicalRows,
  filterTechnicalRows,
  formatCompleteness,
  formatNumber,
  normalizeNumericValue,
  stickyCellStyle,
  stringifyCellValue,
  technicalCellClass,
  technicalNumericToneClass
} from "./TechnicalDataTableHelpers";
import type {
  RowQuality,
  TechnicalColumn,
  TechnicalDataMode,
  TechnicalDataTableProps,
  TechnicalEntry,
  TechnicalSortDirection
} from "./TechnicalDataTableTypes";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 500] as const;

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <div className="panel-title-copy">
        <h2>{title}</h2>
      </div>
    </div>
  );
}

export function TechnicalDataRow<T extends object>({
  row,
  columns,
  gridTemplateColumns,
  stickyOffsets,
  maxByNumericColumn,
  quality,
  duplicate
}: {
  row: T;
  columns: Array<TechnicalColumn<T>>;
  gridTemplateColumns: string;
  stickyOffsets: Map<string, number>;
  maxByNumericColumn: Map<string, number>;
  quality: RowQuality;
  duplicate: boolean;
}) {
  return (
    <div className={`technical-grid technical-data-row ${quality.tone} ${duplicate ? "duplicate" : ""}`} style={{ gridTemplateColumns }}>
      {columns.map((column) => {
        const raw = column.value(row);
        const numeric = column.type === "number" ? normalizeNumericValue(raw) : undefined;
        const max = maxByNumericColumn.get(column.id) ?? 0;
        const heat = column.heatmap === false || numeric === undefined || max <= 0 ? undefined : Math.min(Math.abs(numeric) / max, 1);
        const heatTone = heat !== undefined && column.heatmapTone === "risk" ? "risk-heat" : "";
        const cellTone = column.cellTone?.(row);
        const style = {
          ...stickyCellStyle(column, stickyOffsets),
          ...(heat !== undefined ? { "--heat": String(0.04 + heat * 0.18) } : {})
        };
        return (
          <div
            className={`${technicalCellClass(column, "data")} ${technicalNumericToneClass(column, numeric)} ${heat !== undefined ? "heat" : ""} ${heatTone} ${cellTone ? `cell-${cellTone}` : ""}`}
            key={column.id}
            style={style}
            title={[stringifyCellValue(raw), ...quality.labels, duplicate ? "Timestamp duplicado en la página" : ""].filter(Boolean).join(" · ")}
          >
            {column.render ? column.render(row) : column.type === "number" ? formatNumber(raw) : stringifyCellValue(raw) || "-"}
          </div>
        );
      })}
    </div>
  );
}

export function TechnicalDataTable<T extends object>({
  title,
  rows,
  columns,
  kpis,
  page,
  pageSize,
  hasNext,
  loading,
  onPageChange,
  onPageSizeChange,
  getRowId,
  getRowQuality,
  getGroupLabel,
  getDuplicateKey,
  exportFileName,
  getTotalsRow,
  loadExportRows,
  showHeaderTitle = true,
  showQuality = true,
  showPagination = true,
  showModeSelector = true
}: TechnicalDataTableProps<T>) {
  const fixedMode: TechnicalDataMode = showModeSelector ? "basic" : "advanced";
  const [mode, setMode] = useState<TechnicalDataMode>(fixedMode);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ id: string; direction: TechnicalSortDirection }>();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => buildTechnicalPresetHiddenColumns(columns, fixedMode));
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const columnsMenuRef = useRef<HTMLDivElement | null>(null);
  const columnsSignatureRef = useRef("");
  const rowHeight = 42;
  const viewportHeight = 560;
  const columnsSignature = useMemo(() => buildTechnicalColumnsSignature(columns), [columns]);
  const activeColumns = useMemo(() => columns.filter((column) => !hiddenColumns.has(column.id)), [columns, hiddenColumns]);
  const gridTemplateColumns = activeColumns.map((column) => `${column.width}px`).join(" ");
  const stickyOffsets = useMemo(() => {
    let left = 0;
    const offsets = new Map<string, number>();
    for (const column of activeColumns) {
      if (column.sticky) {
        offsets.set(column.id, left);
        left += column.width;
      }
    }
    return offsets;
  }, [activeColumns]);
  const selectOptions = useMemo(() => {
    const options = new Map<string, string[]>();
    for (const column of activeColumns) {
      if (column.filter !== "select") {
        continue;
      }
      options.set(
        column.id,
        [...new Set(rows.map((row) => stringifyCellValue(column.value(row))).filter(Boolean))].sort((left, right) =>
          left.localeCompare(right, "es")
        )
      );
    }
    return options;
  }, [activeColumns, rows]);
  const maxByNumericColumn = useMemo(() => {
    const maxValues = new Map<string, number>();
    for (const column of activeColumns) {
      if (column.type !== "number") {
        continue;
      }
      const max = Math.max(...rows.map((row) => Math.abs(normalizeNumericValue(column.value(row)) ?? 0)), 0);
      maxValues.set(column.id, max);
    }
    return maxValues;
  }, [activeColumns, rows]);

  const duplicateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = getDuplicateKey(row);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [getDuplicateKey, rows]);

  const filteredRows = useMemo(() => filterTechnicalRows(rows, activeColumns, filters, search, sort), [activeColumns, filters, rows, search, sort]);

  const totalsRow = useMemo(() => getTotalsRow?.(filteredRows), [filteredRows, getTotalsRow]);

  const entries = useMemo(() => {
    const nextEntries: Array<TechnicalEntry<T>> = [];
    let previousGroup = "";
    for (const row of filteredRows) {
      const group = getGroupLabel(row);
      if (group && group !== previousGroup) {
        nextEntries.push({ type: "group", key: `group-${group}-${nextEntries.length}`, label: group });
        previousGroup = group;
      }
      nextEntries.push({ type: "row", key: getRowId(row), row });
    }
    return nextEntries;
  }, [filteredRows, getGroupLabel, getRowId]);

  const start = Math.max(Math.floor(scrollTop / rowHeight) - 6, 0);
  const visible = Math.ceil(viewportHeight / rowHeight) + 12;
  const visibleEntries = entries.slice(start, start + visible);
  const topSpacer = start * rowHeight;
  const bottomSpacer = Math.max((entries.length - start - visibleEntries.length) * rowHeight, 0);
  const from = rows.length === 0 ? 0 : page * pageSize + 1;
  const to = page * pageSize + rows.length;
  const pageTotalLabel = hasNext ? `más de ${formatNumber(to)}` : formatNumber(to);
  const quality = buildTechnicalQuality(rows, activeColumns, getRowQuality, duplicateCounts);

  function updateSort(column: TechnicalColumn<T>) {
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
    setScrollTop(0);
  }

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

  function applyModePreset(nextMode: TechnicalDataMode) {
    setMode(nextMode);
    setHiddenColumns(buildTechnicalPresetHiddenColumns(columns, nextMode));
    setScrollTop(0);
  }

  useEffect(() => {
    if (!columnsSignatureRef.current) {
      columnsSignatureRef.current = columnsSignature;
      return;
    }
    if (columnsSignatureRef.current !== columnsSignature) {
      columnsSignatureRef.current = columnsSignature;
      setHiddenColumns(buildTechnicalPresetHiddenColumns(columns, showModeSelector ? mode : "advanced"));
      return;
    }
    setHiddenColumns((current) => {
      const available = new Set(columns.map((column) => column.id));
      const next = new Set([...current].filter((columnId) => available.has(columnId)));
      return next.size === current.size ? current : next;
    });
  }, [columns, columnsSignature, mode, showModeSelector]);

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

  const exportRows = filteredRows;
  const resolvedHeaderMeta = useMemo(
    () =>
      new Map(
        activeColumns.map((column) => [
          column.id,
          typeof column.headerMeta === "function" ? column.headerMeta(filteredRows) : column.headerMeta ?? ""
        ])
      ),
    [activeColumns, filteredRows]
  );

  async function exportTechnicalDataset(format: "csv" | "xls") {
    const sourceRows = loadExportRows ? await loadExportRows() : rows;
    const rowsToExport = loadExportRows ? filterTechnicalRows(sourceRows, activeColumns, filters, search, sort) : exportRows;
    exportTechnicalRows(`${exportFileName}.${format}`, activeColumns, rowsToExport, format, getTotalsRow?.(rowsToExport));
  }

  return (
    <section className="panel wide technical-data-panel">
      <div className={`technical-data-head ${showHeaderTitle ? "" : "no-title"}`}>
        {showHeaderTitle && <PanelTitle icon={<FileSpreadsheet size={18} />} title={title} />}
        <div className="technical-toolbar" role="toolbar" aria-label={showHeaderTitle ? `Acciones de ${title}` : "Acciones de tabla"}>
          <label className="technical-search">
            <Search size={15} />
            <input
              aria-label="Buscar en tabla"
              disabled={loading}
              onChange={(event) => {
                setSearch(event.target.value);
                setScrollTop(0);
              }}
              placeholder="Buscar..."
              value={search}
            />
          </label>
          {showModeSelector && (
            <div className="technical-mode" aria-label="Modo de visualización" role="group">
              <button className={mode === "basic" ? "active" : ""} disabled={loading} onClick={() => applyModePreset("basic")} type="button">
                Básica
              </button>
              <button className={mode === "advanced" ? "active" : ""} disabled={loading} onClick={() => applyModePreset("advanced")} type="button">
                Avanzada
              </button>
            </div>
          )}
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
          <button className="secondary-button" disabled={loading} onClick={() => void exportTechnicalDataset("csv")} type="button">
            <Download size={16} />
            CSV
          </button>
          <button className="secondary-button" disabled={loading} onClick={() => void exportTechnicalDataset("xls")} type="button">
            <FileDown size={16} />
            Excel
          </button>
          <button className="secondary-button" disabled={loading} onClick={() => copyTechnicalRows(activeColumns, exportRows, totalsRow)} type="button">
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

      {showQuality && (
        <div className="quality-strip" aria-label="Calidad de datos">
          <span className={quality.completeness >= 98 ? "good" : quality.completeness >= 90 ? "warning" : "danger"}>
            Datos completos: {formatCompleteness(quality.completeness)}
          </span>
          <span className={quality.anomalies > 0 ? "warning" : "good"}>{formatNumber(quality.anomalies)} registros anómalos</span>
          <span className={quality.duplicates > 0 ? "warning" : "good"}>{formatNumber(quality.duplicates)} duplicados en página</span>
          <span className={quality.nulls > 0 ? "warning" : "good"}>{formatNumber(quality.nulls)} valores vacíos</span>
        </div>
      )}

      {showPagination && (
        <div className="technical-pagination">
          <span>
            Mostrando {formatNumber(from)}-{formatNumber(to)} de {pageTotalLabel} registros
            {filteredRows.length !== rows.length ? ` · ${formatNumber(filteredRows.length)} visibles con filtros` : ""}
          </span>
          <label>
            Filas
            <select disabled={loading} value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <button className="pagination-button" disabled={loading || page === 0} onClick={() => onPageChange(page - 1)} title="Página anterior" type="button">
            <ChevronLeft size={16} />
          </button>
          <button className="pagination-button" disabled={loading || !hasNext} onClick={() => onPageChange(page + 1)} title="Página siguiente" type="button">
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      <div className="technical-table-shell">
        <div className={`technical-table ${totalsRow ? "has-total-row" : ""}`} style={{ minWidth: activeColumns.reduce((sum, column) => sum + column.width, 0) }}>
          {totalsRow && (
            <div className="technical-grid technical-total-row" style={{ gridTemplateColumns }}>
              {activeColumns.map((column) => (
                <div className={technicalCellClass(column, "total")} key={column.id} style={stickyCellStyle(column, stickyOffsets)} title={stringifyCellValue(totalsRow[column.id] as string | number | null | undefined)}>
                  {totalsRow[column.id] ?? ""}
                </div>
              ))}
            </div>
          )}
          <div className="technical-grid technical-header-row" style={{ gridTemplateColumns }}>
            {activeColumns.map((column) => (
              <div className={technicalCellClass(column, "header")} key={column.id} style={stickyCellStyle(column, stickyOffsets)}>
                <button disabled={loading} onClick={() => updateSort(column)} title={column.help ?? `Ordenar por ${column.label}`} type="button">
                  {resolvedHeaderMeta.get(column.id) ? <span className="column-header-meta">{resolvedHeaderMeta.get(column.id)}</span> : null}
                  <span className="column-header-label">
                    {column.label}
                    {column.help && <span className="column-help">?</span>}
                    {sort?.id === column.id && <small>{sort.direction === "asc" ? "↑" : "↓"}</small>}
                  </span>
                </button>
              </div>
            ))}
          </div>
          <div className="technical-grid technical-filter-row" style={{ gridTemplateColumns }}>
            {activeColumns.map((column) => (
              <div className={technicalCellClass(column, "filter")} key={column.id} style={stickyCellStyle(column, stickyOffsets)}>
                {column.filter === "number" ? (
                  <div className="range-filter">
                    <input aria-label={`${column.label} mínimo`} disabled={loading} onChange={(event) => updateFilter(`${column.id}:min`, event.target.value)} placeholder="Min" value={filters[`${column.id}:min`] ?? ""} />
                    <input aria-label={`${column.label} máximo`} disabled={loading} onChange={(event) => updateFilter(`${column.id}:max`, event.target.value)} placeholder="Max" value={filters[`${column.id}:max`] ?? ""} />
                  </div>
                ) : column.filter === "select" ? (
                  <select aria-label={`Filtrar ${column.label}`} disabled={loading} onChange={(event) => updateFilter(column.id, event.target.value)} value={filters[column.id] ?? ""}>
                    <option value="">Todos</option>
                    {(selectOptions.get(column.id) ?? []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input aria-label={`Filtrar ${column.label}`} disabled={loading} onChange={(event) => updateFilter(column.id, event.target.value)} placeholder="Filtrar" value={filters[column.id] ?? ""} />
                )}
              </div>
            ))}
          </div>
          <div className="technical-virtual-body" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} style={{ height: viewportHeight }}>
            <div style={{ height: topSpacer }} />
            {visibleEntries.map((entry) =>
              entry.type === "group" ? (
                <div className="technical-group-row" key={entry.key} style={{ height: rowHeight }}>
                  {entry.label}
                </div>
              ) : (
                <TechnicalDataRow
                  columns={activeColumns}
                  duplicate={Boolean(duplicateCounts.get(getDuplicateKey(entry.row)) && (duplicateCounts.get(getDuplicateKey(entry.row)) ?? 0) > 1)}
                  gridTemplateColumns={gridTemplateColumns}
                  maxByNumericColumn={maxByNumericColumn}
                  quality={getRowQuality(entry.row)}
                  row={entry.row}
                  stickyOffsets={stickyOffsets}
                  key={entry.key}
                />
              )
            )}
            <div style={{ height: bottomSpacer }} />
            {rows.length === 0 && <div className="empty-state">Sin registros.</div>}
            {rows.length > 0 && filteredRows.length === 0 && <div className="empty-state">Sin coincidencias con los filtros actuales.</div>}
            {loading && <InlineLoading label="Actualizando tabla" />}
          </div>
        </div>
      </div>
    </section>
  );
}
