import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clipboard,
  Database,
  Download,
  FileDown,
  FileClock,
  FileSpreadsheet,
  Maximize2,
  Minimize2,
  RefreshCw,
  RotateCcw,
  Search,
  TrendingUp,
  Trash2,
  UploadCloud,
  X
} from "lucide-react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import { InlineLoading } from "../../GlobalLoadingOverlay";
import { withGlobalLoading } from "../../loading";
import {
  createTechnicalDataTableAdapter,
  type TechnicalDataTableAdapterColumn
} from "../../technical-module-v2/adapters/technicalDataTableAdapter";
import { TechnicalDataRow } from "../../components/technical-data-table/TechnicalDataTable";
import {
  buildTechnicalColumnsSignature,
  buildTechnicalPresetHiddenColumns,
  buildTechnicalQuality,
  copyTechnicalRows,
  exportTechnicalRows,
  filterTechnicalRows,
  formatCompleteness,
  stickyCellStyle,
  stringifyCellValue,
  technicalCellClass,
  technicalColumnVisibility,
  technicalNumericToneClass,
  downloadBlob
} from "../../components/technical-data-table/TechnicalDataTableHelpers";
import type { RowQuality, TechnicalColumn, TechnicalDataMode, TechnicalEntry, TechnicalKpi, TechnicalSortDirection, TechnicalTotalsRow } from "../../components/technical-data-table/TechnicalDataTableTypes";
import type { ImportHistoryDetail, ImportHistoryLogs, ImportResponse, MedperCurves, MedperFile, MedperFilterOptions, MedperFilters, MedperImportResponse, MedperMonthlyConsumptionRow, MedperSummary, MedperqhRecord, ReeVersion } from "../../api";
import { deleteImportFile, getImportFileDetail, getImportFileErrorsCsv, getImportFileLogs, reprocessImportFile } from "../../api";
import type { ImportHistoryFile, ImportHistoryMode, LoadSortKey, LoadStatus, MedidasView, Message } from "../../app-shell/AppShellTypes";
import type { MedperFilterBandProps, MedperViewPanelProps } from "./MedperTypes";
import {
  buildMedperMonthlyOperationalSummary,
  buildMedperqhKpis,
  formatDate,
  formatDateTime,
  formatMonthKeyLabel,
  formatNumber,
  formatRatio,
  medperqhQuality,
  normalizeNumericValue,
  parseDateTimeValue
} from "./MedperHelpers";

const SUMMARY_VERSIONS: ReeVersion[] = ["C3", "C4", "C5"];
const VERSION_PALETTE = ["#64748b", "#2563eb", "#16a34a", "#7c3aed", "#f97316", "#0f766e"];
const PAGE_SIZE_OPTIONS = [25, 50, 100, 500] as const;
const SEARCHABLE_SELECT_THRESHOLD = 24;
function FilterSelect({
  label,
  value,
  options,
  onChange,
  placeholder = "Todos",
  disabled = false,
  loading = false
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const normalizedOptions = useMemo(() => {
    const seen = new Set<string>();
    return [...options, value]
      .map((option) => option.trim())
      .filter((option) => {
        if (!option || seen.has(option)) {
          return false;
        }
        seen.add(option);
        return true;
      });
  }, [options, value]);
  const filteredOptions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return normalizedSearch
      ? normalizedOptions.filter((option) => option.toLowerCase().includes(normalizedSearch)).slice(0, 200)
      : normalizedOptions.slice(0, 200);
  }, [normalizedOptions, search]);
  const searchable = normalizedOptions.length > SEARCHABLE_SELECT_THRESHOLD;
  const controlDisabled = disabled || loading;
  const displayValue = loading ? "Cargando..." : value || placeholder;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  useEffect(() => {
    if (controlDisabled) {
      setOpen(false);
    }
  }, [controlDisabled]);

  if (!searchable) {
    return (
      <label className="filter-field">
        <span>{label}</span>
        <select disabled={controlDisabled} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{loading ? "Cargando..." : placeholder}</option>
          {normalizedOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className={`filter-field filter-select-field ${open ? "open" : ""}`} ref={containerRef}>
      <span>{label}</span>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="searchable-select-trigger"
        disabled={controlDisabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          }
          if (event.key === "ArrowDown") {
            setOpen(true);
          }
        }}
        type="button"
      >
        <span className={value ? "" : "placeholder"}>{displayValue}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="searchable-select-popover">
          <input
            autoFocus
            className="searchable-select-search"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder={`Buscar ${label.toLowerCase()}`}
            value={search}
          />
          <div className="searchable-select-options" role="listbox">
            <button
              className={`searchable-select-option ${value ? "" : "active"}`}
              onClick={() => {
                onChange("");
                setOpen(false);
                setSearch("");
              }}
              role="option"
              type="button"
            >
              {placeholder}
            </button>
            {filteredOptions.map((option) => (
              <button
                aria-selected={value === option}
                className={`searchable-select-option ${value === option ? "active" : ""}`}
                key={option}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                  setSearch("");
                }}
                role="option"
                type="button"
              >
                {option}
              </button>
            ))}
            {filteredOptions.length === 0 && <div className="searchable-select-empty">Sin resultados</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export function MedperFilterBand({
  view,
  filters,
  options,
  onChange,
  onApply,
  disabled = false
}: {
  view: MedidasView;
  filters: MedperFilters;
  options?: MedperFilterOptions;
  onChange: (key: keyof MedperFilters, value: string) => void;
  onApply: () => void;
  disabled?: boolean;
}) {
  if (view === "history" || view === "summary") {
    return null;
  }

  const loadingOptions = !options;
  const versions = options?.versions ?? [];
  const months = options?.months ?? [];
  const qhPeajes = options?.qhPeajes ?? [];
  const qhUnits = options?.qhUnits ?? [];

  return (
    <section className="filter-band medper-filter-band">
      <FilterSelect disabled={disabled} loading={loadingOptions} label="Versión" value={filters.version ?? ""} options={versions} onChange={(value) => onChange("version", value)} />
      <FilterSelect disabled={disabled} loading={loadingOptions} label="Mes" value={filters.fecha ?? ""} options={months} onChange={(value) => onChange("fecha", value)} />
      {(view === "qh" || view === "graphs") && (
        <>
          <FilterSelect disabled={disabled} loading={loadingOptions} label="Código unidad" value={filters.codigoUnidad ?? ""} options={qhUnits} onChange={(value) => onChange("codigoUnidad", value)} />
          <FilterSelect disabled={disabled} loading={loadingOptions} label="Peaje" value={filters.peaje ?? ""} options={qhPeajes} onChange={(value) => onChange("peaje", value)} />
        </>
      )}
      <button className="secondary-button" disabled={disabled} onClick={onApply} type="button">
        <Search size={16} />
        Filtrar
      </button>
    </section>
  );
}


export function MedperViewPanel({
  activeView,
  files,
  latestImport,
  summary,
  monthlyConsumption,
  qhRows,
  curves,
  qhGraphFilters,
  filterOptions,
  selectedMonth,
  qhPage,
  qhPageSize,
  qhHasNext,
  loading,
  onQhPageChange,
  onQhPageSizeChange,
  loadQhExportRows,
  onQhGraphFilterChange,
  onQhGraphApply,
  onRefreshHistory
}: {
  activeView: MedidasView;
  files: MedperFile[];
  latestImport?: MedperImportResponse;
  summary?: MedperSummary;
  monthlyConsumption: MedperMonthlyConsumptionRow[];
  qhRows: MedperqhRecord[];
  curves?: MedperCurves;
  qhGraphFilters: MedperFilters;
  filterOptions?: MedperFilterOptions;
  selectedMonth: string | null;
  qhPage: number;
  qhPageSize: number;
  qhHasNext: boolean;
  loading: boolean;
  onQhPageChange: (page: number) => void;
  onQhPageSizeChange: (pageSize: number) => void;
  loadQhExportRows: () => Promise<MedperqhRecord[]>;
  onQhGraphFilterChange: (key: keyof MedperFilters, value: string) => void;
  onQhGraphApply: () => void;
  onRefreshHistory: () => Promise<void> | void;
}) {
  return (
    <>
      {activeView === "history" && <MedperHistoryView files={files} latestImport={latestImport} onRefresh={onRefreshHistory} />}
      {activeView === "summary" && <MedperSummaryMetricsView summary={summary} monthlyConsumption={monthlyConsumption} selectedMonth={selectedMonth} />}
      {activeView === "qh" && (
        <MedperQhView
          rows={qhRows}
          page={qhPage}
          pageSize={qhPageSize}
          hasNext={qhHasNext}
          loading={loading}
          onPageChange={onQhPageChange}
          onPageSizeChange={onQhPageSizeChange}
          loadExportRows={loadQhExportRows}
        />
      )}
      {activeView === "graphs" && (
        <MedperGraphsView
          curves={curves}
          qhFilters={qhGraphFilters}
          options={filterOptions}
          loading={loading}
          onQhFilterChange={onQhGraphFilterChange}
          onQhApply={onQhGraphApply}
        />
      )}
    </>
  );
}

function MedperHistoryView({
  files,
  latestImport,
  onRefresh
}: {
  files: MedperFile[];
  latestImport?: MedperImportResponse;
  onRefresh?: () => Promise<void> | void;
}) {
  const latestErrors =
    latestImport?.results
      .flatMap((result) =>
        result.errors.map((error) => ({
          fileName: result.fileName,
          detail: `${error.sourceFileName}:${error.lineNumber} ${error.message}`
        }))
      )
      .slice(0, 8) ?? [];
  return (
    <>
      <ImportHistoryDashboardView files={files} latestImport={latestImport} mode="medper" onRefresh={onRefresh} />
      {latestErrors.length > 0 && (
        <section className="content-grid">
          <div className="panel wide">
            <PanelTitle icon={<AlertTriangle size={18} />} title="Errores ultima carga MEDPER" />
            <div className="error-list">
              {latestErrors.map((error, index) => (
                <div key={`${error.fileName}-${index}`}>
                  <strong>{error.fileName}</strong>
                  <span>{error.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function MedperSummaryMetricsView(props: {
  summary?: MedperSummary;
  monthlyConsumption: MedperMonthlyConsumptionRow[];
  selectedMonth: string | null;
}) {
  const rows = useMemo(() => buildMedperMonthlyOperationalSummary(props.monthlyConsumption), [props.monthlyConsumption]);
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          pf: acc.pf + row.totalPf,
          bc: acc.bc + row.totalBc,
          danger: acc.danger + (row.tone === "danger" ? 1 : 0),
          warning: acc.warning + (row.tone === "warning" ? 1 : 0),
          missing: acc.missing + row.missingVersions.length
        }),
        { pf: 0, bc: 0, danger: 0, warning: 0, missing: 0 }
      ),
    [rows]
  );
    return (
    <section className="content-grid">
      <div className="panel wide">
        <PanelTitle icon={<Activity size={18} />} title="Resumen mensual de medidas" subtitle="Todo lo cargado · C3 / C4 / C5 · PF / BC" />
        <div className="technical-kpis medper-operational-kpis">
          <div className="technical-kpi neutral">
            <span>Meses</span>
            <strong>{formatNumber(rows.length)}</strong>
            <small>rango disponible</small>
          </div>
          <div className="technical-kpi good">
            <span>Total PF</span>
            <strong>{formatNumber(totals.pf)}</strong>
            <small>MWh</small>
          </div>
          <div className="technical-kpi good">
            <span>Total BC</span>
            <strong>{formatNumber(totals.bc)}</strong>
            <small>MWh</small>
          </div>
            <div className={`technical-kpi ${totals.missing > 0 ? "warning" : "good"}`}>
            <span>Sin carga</span>
            <strong>{formatNumber(totals.missing)}</strong>
            <small>versiones/mes</small>
          </div>
          <div className={`technical-kpi ${totals.danger > 0 ? "danger" : totals.warning > 0 ? "warning" : "good"}`}>
            <span>Anomalias</span>
            <strong>{formatNumber(totals.danger + totals.warning)}</strong>
            <small>{formatNumber(totals.danger)} criticas</small>
          </div>
        </div>
        <div className="table-scroll medper-operational-summary-scroll">
          <table className="medper-summary-table medper-operational-summary-table">
            <thead>
              <tr>
                <th>Mes</th>
                <th>C3 PF</th>
                <th>C3 BC</th>
                <th>C4 PF</th>
                <th>C4 BC</th>
                <th>C5 PF</th>
                <th>C5 BC</th>
                <th>Completado</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8}>Sin medidas cargadas.</td>
                </tr>
              )}
              {rows.map((row) => (
                <tr className={`medper-summary-diff-${row.tone}`} key={row.month}>
                  <th scope="row">
                    <span>{formatMonthKeyLabel(row.month)}</span>
                    {row.missingVersions.length > 0 && <small>Faltan {row.missingVersions.join(", ")}</small>}
                  </th>
                  {SUMMARY_VERSIONS.flatMap((version) => [
                    <td className={row.versions[version].pf === null ? "missing" : ""} key={`${row.month}-${version}-pf`}>{formatNumber(row.versions[version].pf)}</td>,
                    <td className={row.versions[version].bc === null ? "missing" : ""} key={`${row.month}-${version}-bc`}>{formatNumber(row.versions[version].bc)}</td>
                  ])}
                  <td>
                    <span className={`medper-diff-badge ${row.missingVersions.length === 0 ? "good" : "warning"}`}>
                      {row.missingVersions.length === 0 ? "Completado" : `Falta ${row.missingVersions.join(", ")}`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}


function MedperQhView({
  rows,
  page,
  pageSize,
  hasNext,
  loading,
  onPageChange,
  onPageSizeChange,
  loadExportRows
}: {
  rows: MedperqhRecord[];
  page: number;
  pageSize: number;
  hasNext: boolean;
  loading: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  loadExportRows?: () => Promise<MedperqhRecord[]>;
}) {
  const columns = useMemo<Array<TechnicalColumn<MedperqhRecord>>>(
    () => [
      { id: "fecha", label: "Fecha", width: 118, sticky: true, type: "date", filter: "text", value: (row) => row.fecha, render: (row) => formatDate(row.fecha) },
      { id: "hora", label: "Hora", help: "Hora a la que pertenece el cuarto horario.", width: 72, sticky: true, align: "right", type: "number", filter: "number", value: (row) => row.hora },
      { id: "qh", label: "QH", help: "Cuartohorario dentro de la hora: 1, 2, 3 o 4.", width: 68, sticky: true, align: "right", type: "number", filter: "number", value: (row) => row.cuartoHora },
      { id: "codigoUnidad", label: "Código unidad", width: 156, sticky: true, filter: "select", value: (row) => row.codigoUnidad },
      { id: "bc", label: "BC", help: "Balance de consumo: PF + pérdidas.", width: 128, align: "right", type: "number", filter: "number", value: (row) => row.bcMwh },
      { id: "pf", label: "PF", help: "Energía en punto frontera.", width: 128, align: "right", type: "number", filter: "number", value: (row) => row.pfMwh },
      { id: "perdidas", label: "Pérdidas", help: "Pérdidas de red asociadas a la medida.", width: 128, align: "right", type: "number", filter: "number", value: (row) => row.perdidasMwh },
      { id: "peaje", label: "Peaje", width: 98, advanced: true, filter: "select", value: (row) => row.peaje },
      { id: "version", label: "Versión", width: 86, advanced: true, filter: "select", value: (row) => row.version },
      { id: "diferencia", label: "Dif. BC/PF", width: 128, advanced: true, align: "right", type: "number", filter: "number", value: (row) => row.bcPfDifferenceMwh },
      { id: "linea", label: "Línea", width: 86, advanced: true, align: "right", type: "number", filter: "number", value: (row) => row.sourceLineNumber }
    ],
    []
  );

  return (
    <TechnicalDataTableV2
      columns={columns}
      exportFileName="medperqh-filtrado"
      getDuplicateKey={(row) => [row.fecha, row.hora, row.cuartoHora, row.codigoUnidad, row.peaje ?? ""].join("|")}
      getGroupLabel={(row) => `Fecha ${formatDate(row.fecha)} € Hora ${formatNumber(row.hora)}`}
      getRowId={(row) => row.id}
      getRowQuality={medperqhQuality}
      hasNext={hasNext}
      kpis={buildMedperqhKpis(rows)}
      loading={loading}
      loadExportRows={loadExportRows}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      page={page}
      pageSize={pageSize}
      rows={rows}
      title="MEDPERQH cuartohorario"
    />
  );
}

function TechnicalDataTableV2<T extends object>({
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
  loadExportRows,
  showHeaderTitle = true,
  showQuality = true,
  showPagination = true,
  showModeSelector = true
}: {
  title: string;
  rows: T[];
  columns: Array<TechnicalColumn<T>>;
  kpis: TechnicalKpi[];
  page: number;
  pageSize: number;
  hasNext: boolean;
  loading: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  getRowId: (row: T) => string;
  getRowQuality: (row: T) => RowQuality;
  getGroupLabel: (row: T) => string;
  getDuplicateKey: (row: T) => string;
  exportFileName: string;
  loadExportRows?: () => Promise<T[]>;
  showHeaderTitle?: boolean;
  showQuality?: boolean;
  showPagination?: boolean;
  showModeSelector?: boolean;
}) {
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
  const adapterColumns = useMemo<Array<TechnicalDataTableAdapterColumn<T>>>(
    () =>
      columns.map((column) => ({
        id: column.id,
        label: column.label,
        help: column.help,
        width: column.width,
        align: column.align,
        type: column.type,
        sticky: column.sticky,
        visibility: column.visibility,
        advanced: technicalColumnVisibility(column) === "advanced",
        heatmap: column.heatmap,
        heatmapTone: column.heatmapTone,
        numericTone: column.numericTone,
        filter: column.filter,
        defaultHidden: Boolean(column.defaultHidden),
        expectedEmpty: column.expectedEmpty,
        value: column.value,
        render: column.render,
        exportValue: column.exportValue
      })),
    [columns]
  );
  const adapter = useMemo(
    () =>
      createTechnicalDataTableAdapter({
        rows,
        columns: adapterColumns,
        state: {
          mode,
          search,
          filters,
          sort: sort ? { columnId: sort.id, direction: sort.direction } : undefined,
          hiddenColumns: [...hiddenColumns]
        },
        showModeSelector
      }),
    [adapterColumns, filters, hiddenColumns, mode, rows, search, showModeSelector, sort]
  );
  const activeColumnIds = useMemo(() => new Set(adapter.activeColumns.map((column) => column.id)), [adapter.activeColumns]);
  const activeColumns = useMemo(() => columns.filter((column) => activeColumnIds.has(column.id)), [activeColumnIds, columns]);
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
  const selectOptions = adapter.filterOptions;
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
  const visibleRows = adapter.sortedRows;
  const totalsRow = undefined;
  const entries = useMemo(() => {
    const nextEntries: Array<TechnicalEntry<T>> = [];
    let previousGroup = "";
    for (const row of visibleRows) {
      const group = getGroupLabel(row);
      if (group && group !== previousGroup) {
        nextEntries.push({ type: "group", key: `group-${group}-${nextEntries.length}`, label: group });
        previousGroup = group;
      }
      nextEntries.push({ type: "row", key: getRowId(row), row });
    }
    return nextEntries;
  }, [getGroupLabel, getRowId, visibleRows]);
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

  const exportRows = visibleRows;

  async function exportTechnicalDataset(format: "csv" | "xls") {
    const sourceRows = loadExportRows ? await loadExportRows() : rows;
    const sourceAdapter = createTechnicalDataTableAdapter({
      rows: sourceRows,
      columns: adapterColumns,
      state: {
        mode,
        search,
        filters,
        sort: sort ? { columnId: sort.id, direction: sort.direction } : undefined,
        hiddenColumns: [...hiddenColumns]
      },
      showModeSelector
    });
    const rowsToExport = sourceAdapter.sortedRows;
    exportTechnicalRows(`${exportFileName}.${format}`, activeColumns, rowsToExport, format, totalsRow);
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
                B?sica
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
            {visibleRows.length !== rows.length ? ` · ${formatNumber(visibleRows.length)} visibles con filtros` : ""}
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
                  {column.label}
                  {column.help && <span className="column-help">?</span>}
                  {sort?.id === column.id && <small>{sort.direction === "asc" ? "?" : "?"}</small>}
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
                    {(selectOptions[column.id] ?? []).map((option) => (
                      <option key={String(option.value)} value={String(option.value)}>
                        {option.label}
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
                  duplicate={Boolean((duplicateCounts.get(getDuplicateKey(entry.row)) ?? 0) > 1)}
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
            {rows.length > 0 && visibleRows.length === 0 && <div className="empty-state">Sin coincidencias con los filtros actuales.</div>}
            {loading && <InlineLoading label="Actualizando tabla" />}
          </div>
        </div>
      </div>
    </section>
  );
}

function MedperGraphsView({
  curves,
  qhFilters,
  options,
  loading,
  onQhFilterChange,
  onQhApply
}: {
  curves?: MedperCurves;
  qhFilters: MedperFilters;
  options?: MedperFilterOptions;
  loading: boolean;
  onQhFilterChange: (key: keyof MedperFilters, value: string) => void;
  onQhApply: () => void;
}) {
  return (
    <section className="content-grid">
      <OperationalEnergyChartPanel
        title="Curva carga BC/PF"
        icon={<TrendingUp size={18} />}
        rows={curves?.qh ?? []}
        filters={qhFilters}
        options={options}
        loading={loading}
        onFilterChange={onQhFilterChange}
        onApply={onQhApply}
      />
    </section>
  );
}

function OperationalEnergyChartPanel({
  title,
  icon,
  rows,
  filters,
  options,
  loading,
  onFilterChange,
  onApply
}: {
  title: string;
  icon: ReactNode;
  rows: MedperCurves["qh"];
  filters: MedperFilters;
  options?: MedperFilterOptions;
  loading: boolean;
  onFilterChange: (key: keyof MedperFilters, value: string) => void;
  onApply: () => void;
}) {
  const [range, setRange] = useState<EnergyRangePreset>("month");
  const [fullscreen, setFullscreen] = useState(false);
  const points = useMemo(() => buildEnergySeries(rows), [rows]);
  const metrics = useMemo(() => buildEnergyMetrics(points), [points]);
  const totals = useMemo(() => buildEnergyTotals(points), [points]);
  const option = useMemo<EChartsOption>(() => buildEnergyChartOption(points, range), [points, range]);

  useEffect(() => {
    if (!fullscreen) {
      return undefined;
    }

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [fullscreen]);

  const hasData = points.length > 0;

  return (
    <div className={`panel wide energy-chart-panel ${fullscreen ? "fullscreen" : ""}`}>
      <div className="panel-head energy-chart-head">
        <PanelTitle icon={icon} title={title} />
        <div className="panel-actions">
          <div className="energy-range-group" role="tablist" aria-label="Rango temporal">
            {ENERGY_RANGE_OPTIONS.map((item) => (
              <button
                className={`range-button ${range === item.key ? "active" : ""}`}
                disabled={loading}
                key={item.key}
                onClick={() => setRange(item.key)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
          <button className="icon-button chart-icon-button" disabled={loading} onClick={() => setFullscreen((current) => !current)} type="button">
            {fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button className="secondary-button" disabled={loading} onClick={() => setRange("all")} type="button">
            <RotateCcw size={16} />
            Restablecer
          </button>
        </div>
      </div>

      <MedperFilterBand disabled={loading} view="qh" filters={filters} options={options} onChange={onFilterChange} onApply={onApply} />

      <EnergyTotalsSummary totals={totals} />

      <div className="energy-chart-kpis">
        <EnergyKpi label="% pérdida media" value={formatPercentValue(metrics.meanDeviationPct)} meta={metrics.anomalyCount > 0 ? `${formatNumber(metrics.anomalyCount)} anomalías` : "Sin anomalías"} />
        <EnergyKpi label="Pico BC" value={`${formatNumber(metrics.peakBc)} MWh`} meta={metrics.peakBcLabel} />
        <EnergyKpi label="Pico PF" value={`${formatNumber(metrics.peakPf)} MWh`} meta={metrics.peakPfLabel} />
        <EnergyKpi label="Pérdidas medias" value={`${formatNumber(metrics.meanLosses)} MWh`} meta={metrics.meanLossLabel} />
        <EnergyKpi label="Peor % pérdida" value={formatPercentValue(metrics.worstDeviationPct)} meta={metrics.worstDeviationLabel} tone="alert" />
      </div>

      <div className="energy-chart-insight">
        <strong>Análisis automático</strong>
        <span>{metrics.insight}</span>
      </div>

      {hasData ? <EChart option={option} height={fullscreen ? 680 : 480} /> : <div className="empty-state">Sin datos para mostrar.</div>}
    </div>
  );
}

function EnergyKpi({
  label,
  value,
  meta,
  tone = "neutral"
}: {
  label: string;
  value: string;
  meta: string;
  tone?: "neutral" | "alert";
}) {
  return (
    <div className={`energy-kpi ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{meta}</small>
    </div>
  );
}

function EnergyTotalsSummary({ totals }: { totals: EnergyTotals }) {
  return (
    <div className="energy-totals-summary">
      <div>
        <span>PF Total</span>
        <strong>{formatNumber(totals.pfKwh)} kWh</strong>
      </div>
      <div>
        <span>BC Total</span>
        <strong>{formatNumber(totals.bcKwh)} kWh</strong>
      </div>
      <div>
        <span>Diferencia</span>
        <strong>{formatNumber(totals.differenceKwh)} kWh</strong>
      </div>
      <div>
        <span>Diferencia %</span>
        <strong>{formatRatio(totals.differencePct)}</strong>
      </div>
      <div>
        <span>Ratio PF/BC</span>
        <strong>{formatRatio(totals.ratio)}</strong>
      </div>
    </div>
  );
}

function MedperMonthlyConsumptionBars(props: {
  rows: MedperMonthlyConsumptionRow[];
  selectedMonth: string | null;
}) {
  const { rows, selectedMonth } = props;
  const option = useMemo<EChartsOption>(() => {
    const months = [...new Set(rows.map((row) => row.month))];
    const versions = SUMMARY_VERSIONS.filter((version) => rows.some((row) => row.version === version));

    if (months.length === 0 || versions.length === 0) {
      return {
        tooltip: { trigger: "axis" },
        grid: { left: 48, right: 18, top: 54, bottom: 72 },
        xAxis: { type: "category", data: [] },
        yAxis: { type: "value", name: "MWh" },
        series: []
      };
    }

    const byMonthVersion = new Map(rows.map((row) => [`${row.month}|${row.version}`, row] as const));

    return {
      animation: false,
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(255,255,255,0.98)",
        borderColor: "#dbe4ea",
        borderWidth: 1,
        padding: 12,
        textStyle: { color: "#17313f" },
        formatter: (params: any) => {
          const item = Array.isArray(params) ? params[0] : params;
          const data = item?.data;
          if (!data || typeof data !== "object") {
            return "";
          }
          const month = data.month ?? item?.name ?? "-";
          const version = data.version ?? item?.seriesName ?? "-";

          return [
            `<strong>${formatMonthKeyLabel(month)}</strong>`,
            `Versión: ${version}`,
            `PF: ${formatNumber(data.pf)} MWh`,
            `BC: ${formatNumber(data.bc)} MWh`,
            `Pérdidas: ${formatNumber(data.losses)} MWh`
          ].join("<br/>");
        }
      },
      legend: {
        top: 2,
        icon: "roundRect",
        textStyle: { color: "#294553", fontWeight: 700 }
      },
      grid: { left: 58, right: 24, top: 54, bottom: 74, containLabel: true },
      dataZoom: [
        {
          type: "inside",
          filterMode: "none",
          zoomOnMouseWheel: true,
          moveOnMouseWheel: true,
          moveOnMouseMove: true
        },
        {
          type: "slider",
          filterMode: "none",
          bottom: 16,
          height: 24,
          showDetail: false,
          borderColor: "#d7e1e7",
          fillerColor: "rgba(22, 135, 124, 0.18)",
          handleStyle: { color: "#16877c" }
        }
      ],
      xAxis: {
        type: "category",
        data: months,
        axisLabel: {
          hideOverlap: true,
          formatter: (value: string) => formatMonthKeyLabel(value),
          color: "#5a7381"
        },
        axisLine: { lineStyle: { color: "#bccbd4" } },
        axisTick: { show: true },
        splitLine: { show: false }
      },
      yAxis: {
        type: "value",
        name: "MWh",
        axisLabel: { color: "#5a7381", formatter: (value: number) => formatAxisValue(value) },
        splitLine: { lineStyle: { color: "#edf2f5" } }
      },
      series: versions.map((version, index) => ({
        name: version,
        type: "bar",
        barMaxWidth: 20,
        emphasis: { focus: "series" },
        itemStyle: { color: VERSION_PALETTE[index % VERSION_PALETTE.length] },
        data: months.map((month) => {
          const row = byMonthVersion.get(`${month}|${version}`);
          const pf = invertedSignedValue(row?.pfMwh) ?? 0;
          const bc = invertedSignedValue(row?.bcMwh ?? row?.consumoMwh) ?? 0;
          const losses = invertedSignedValue(row?.perdidasMwh) ?? 0;
          const isSelectedMonth = selectedMonth !== null && month === selectedMonth;
          return {
            value: bc,
            pf,
            bc,
            losses,
            month,
            version,
            itemStyle: {
              color: isSelectedMonth ? "#f97316" : VERSION_PALETTE[index % VERSION_PALETTE.length]
            }
          };
        })
      }))
    };
  }, [rows, selectedMonth]);

  return <EChart option={option} height={360} />;
}

type EnergyRangePreset = "day" | "week" | "month" | "last7" | "all";

const ENERGY_RANGE_OPTIONS: Array<{ key: EnergyRangePreset; label: string }> = [
  { key: "day", label: "D?a" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mes" },
  { key: "last7", label: "Últimos 7 días" },
  { key: "all", label: "Todo" }
];

type EnergyPoint = {
  timestampMs: number;
  timestamp: string;
  bc: number | null;
  pf: number | null;
  losses: number | null;
  deviation: number | null;
  deviationPct: number | null;
  lossPct: number | null;
  displayBc: number | null;
  displayPf: number | null;
  displayLosses: number | null;
  displayDeviation: number | null;
  displayDeviationPct: number | null;
};

type EnergyMetrics = {
  meanDeviationPct: number;
  peakBc: number;
  peakBcLabel: string;
  peakPf: number;
  peakPfLabel: string;
  meanLosses: number;
  meanLossLabel: string;
  worstDeviationPct: number;
  worstDeviationLabel: string;
  anomalyCount: number;
  insight: string;
};

type EnergyTotals = {
  pfKwh: number;
  bcKwh: number;
  differenceKwh: number;
  differencePct: number | null;
  ratio: number | null;
};

function buildEnergySeries(rows: MedperCurves["qh"]): EnergyPoint[] {
  return rows
    .map((row) => {
      const bc = positiveMagnitude(row.bcMwh);
      const pf = positiveMagnitude(row.pfMwh);
      const losses = invertedSignedValue(row.perdidasMwh);
      const displayBc = invertedSignedValue(row.bcMwh);
      const displayPf = invertedSignedValue(row.pfMwh);
      const displayLosses = invertedSignedValue(row.perdidasMwh);
      const timestampMs = parseDateTimeValue(row.timestamp)?.getTime() ?? Date.parse(row.timestamp);
      const deviation = bc !== null && pf !== null ? bc - pf : null;
      const deviationPct = bc !== null && pf !== null && Math.abs(bc) >= 0.001 ? ((pf - bc) / Math.abs(bc)) * 100 : null;
      const lossPct = bc !== null && losses !== null && Math.abs(bc) >= 0.001 ? (Math.abs(losses) / Math.abs(bc)) * 100 : null;
      const displayDeviation = displayBc !== null && displayPf !== null ? displayBc - displayPf : null;
      const displayDeviationPct =
        displayBc !== null && displayPf !== null && Math.abs(displayBc) >= 0.001 ? ((displayPf - displayBc) / Math.abs(displayBc)) * 100 : null;

      return {
        timestampMs,
        timestamp: row.timestamp,
        bc,
        pf,
        losses,
        deviation,
        deviationPct,
        lossPct,
        displayBc,
        displayPf,
        displayLosses,
        displayDeviation,
        displayDeviationPct
      };
    })
    .filter((point) => Number.isFinite(point.timestampMs))
    .sort((left, right) => left.timestampMs - right.timestampMs);
}

function buildEnergyMetrics(points: EnergyPoint[]): EnergyMetrics {
  const validPctPoints = points.filter((point): point is EnergyPoint & { deviationPct: number } => point.deviationPct !== null);
  const validBcPoints = points.filter((point): point is EnergyPoint & { bc: number } => point.bc !== null);
  const validPfPoints = points.filter((point): point is EnergyPoint & { pf: number } => point.pf !== null);
  const validLossPoints = points.filter((point): point is EnergyPoint & { losses: number } => point.losses !== null);

  if (points.length === 0 || validPctPoints.length === 0 || validBcPoints.length === 0 || validPfPoints.length === 0 || validLossPoints.length === 0) {
    return {
      meanDeviationPct: 0,
      peakBc: 0,
      peakBcLabel: "-",
      peakPf: 0,
      peakPfLabel: "-",
      meanLosses: 0,
      meanLossLabel: "-",
      worstDeviationPct: 0,
      worstDeviationLabel: "-",
      anomalyCount: 0,
      insight: "Sin datos para analizar."
    };
  }

  const meanDeviationPct = validPctPoints.reduce((sum, point) => sum + Math.abs(point.deviationPct), 0) / validPctPoints.length;
  const peakBcPoint = validBcPoints.reduce((best, point) => (point.bc > best.bc ? point : best), validBcPoints[0]);
  const peakPfPoint = validPfPoints.reduce((best, point) => (point.pf > best.pf ? point : best), validPfPoints[0]);
  const meanLosses = validLossPoints.reduce((sum, point) => sum + point.losses, 0) / validLossPoints.length;
  const worstDeviationPoint = validPctPoints.reduce((best, point) => (Math.abs(point.deviationPct) > Math.abs(best.deviationPct) ? point : best), validPctPoints[0]);
  const anomalyThreshold = Math.max(15, meanDeviationPct * 1.7);
  const anomalyCount = validPctPoints.filter((point) => Math.abs(point.deviationPct) >= anomalyThreshold).length;
  const lift = Math.abs(worstDeviationPoint.deviationPct) - meanDeviationPct;
  const worstDate = formatChartTooltipDate(worstDeviationPoint.timestampMs);
  const liftLabel = formatPercentValue(lift);

  return {
    meanDeviationPct,
    peakBc: peakBcPoint.bc,
    peakBcLabel: formatChartTooltipDate(peakBcPoint.timestampMs),
    peakPf: peakPfPoint.pf,
    peakPfLabel: formatChartTooltipDate(peakPfPoint.timestampMs),
    meanLosses,
    meanLossLabel: `${formatChartTooltipDate(points[0].timestampMs)} - ${formatChartTooltipDate(points[points.length - 1].timestampMs)}`,
    worstDeviationPct: worstDeviationPoint.deviationPct,
    worstDeviationLabel: `${worstDate} € ${liftLabel}`,
    anomalyCount,
    insight:
      worstDeviationPoint.deviationPct === 0
        ? "No se detectan pérdidas relativas relevantes en el rango actual."
        : `El ${worstDate} registr? la mayor pérdida relativa: ${formatPercentValue(Math.abs(worstDeviationPoint.deviationPct))}, ${liftLabel} sobre la media.`
  };
}

function buildEnergyTotals(points: EnergyPoint[]): EnergyTotals {
  const totalPfMwh = points.reduce((sum, point) => sum + (point.displayPf ?? 0), 0);
  const totalBcMwh = points.reduce((sum, point) => sum + (point.displayBc ?? 0), 0);
  const differenceMwh = totalPfMwh - totalBcMwh;
  return {
    pfKwh: totalPfMwh * 1000,
    bcKwh: totalBcMwh * 1000,
    differenceKwh: differenceMwh * 1000,
    differencePct: Math.abs(totalBcMwh) < 0.000001 ? null : Math.abs(differenceMwh) / Math.abs(totalBcMwh),
    ratio: Math.abs(totalBcMwh) < 0.000001 ? null : totalPfMwh / totalBcMwh
  };
}

function buildEnergyChartOption(points: EnergyPoint[], range: EnergyRangePreset): EChartsOption {
  const visible = getEnergyVisibleRange(points, range);
  const visiblePoints = points.filter((point) => point.timestampMs >= visible.start && point.timestampMs <= visible.end);
  const seriesData = visiblePoints.map((point) => ({
    timestampMs: point.timestampMs,
    bc: point.displayBc,
    pf: point.displayPf,
    losses: point.displayLosses,
    deviationPct: point.displayDeviationPct,
    deviation: point.displayDeviation
  }));
  const bandSegments = buildEnergyBandSegments(visiblePoints);
  const weekendBands = buildWeekendBands(points, visible.start, visible.end);
  const nightBands = buildNightBands(points, visible.start, visible.end);
  const weekSeparators = buildWeekSeparators(visible.start, visible.end);
  const labelFormatter = buildAxisLabelFormatter(visible.end - visible.start);
  const pctRange = getPercentAxisRange(visiblePoints);

  return {
    animation: false,
    legend: {
      top: 2,
      icon: "roundRect",
      textStyle: { color: "#294553", fontWeight: 700 },
      selected: {
        "% pérdida": false
      }
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      backgroundColor: "rgba(255,255,255,0.98)",
      borderColor: "#dbe4ea",
      borderWidth: 1,
      padding: 12,
      textStyle: {
        color: "#17313f"
      },
        formatter: (params: any) => {
          const list = Array.isArray(params) ? params : [];
          const index = list.find((item) => item.seriesName === "BC")?.dataIndex ?? list[0]?.dataIndex ?? 0;
          const point = points[index];
          if (!point) {
            return "";
          }

          return [
            `<strong>${formatChartTooltipDate(point.timestampMs)}</strong>`,
            `BC: ${formatNumber(point.displayBc)} MWh`,
            `PF: ${formatNumber(point.displayPf)} MWh`,
            `Pérdidas: ${formatNumber(point.displayLosses)} MWh`,
            `Diferencia absoluta: ${formatNumber(point.displayDeviation === null ? null : Math.abs(point.displayDeviation))} MWh`,
            `% pérdida: ${formatPercentValue(point.displayDeviationPct)}`
          ].join("<br/>");
        }
      },
    grid: { left: 58, right: 78, top: 54, bottom: 86, containLabel: true },
    dataZoom: [
      {
        type: "inside",
        filterMode: "none",
        startValue: visible.start,
        endValue: visible.end,
        zoomOnMouseWheel: true,
        moveOnMouseWheel: true,
        moveOnMouseMove: true
      },
      {
        type: "slider",
        filterMode: "none",
        bottom: 16,
        height: 26,
        startValue: visible.start,
        endValue: visible.end,
        showDetail: false,
        borderColor: "#d7e1e7",
        fillerColor: "rgba(22, 135, 124, 0.18)",
        handleStyle: { color: "#16877c" }
      }
    ],
    xAxis: {
      type: "time",
      axisLabel: {
        hideOverlap: true,
        formatter: labelFormatter,
        color: "#5a7381"
      },
      axisLine: { lineStyle: { color: "#bccbd4" } },
      axisTick: { show: true },
      splitLine: { show: false }
    },
    yAxis: [
      {
        type: "value",
        name: "MWh",
        axisLabel: { color: "#5a7381", formatter: (value: number) => formatAxisValue(value) },
        splitLine: { lineStyle: { color: "#edf2f5" } }
      },
      {
        type: "value",
        name: "%",
        position: "right",
        min: pctRange.min,
        max: pctRange.max,
        axisLabel: { color: "#5a7381", formatter: (value: number) => `${formatAxisValue(value)}%` },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: "Banda % pérdida",
        type: "custom",
        silent: true,
        z: 1,
        renderItem: (params, api) => {
          const color = deviationBandColor(Number(api.value(6)));
          const startBc = api.coord([api.value(0), api.value(2)]);
          const startPf = api.coord([api.value(0), api.value(3)]);
          const endPf = api.coord([api.value(1), api.value(5)]);
          const endBc = api.coord([api.value(1), api.value(4)]);
          return {
            type: "polygon",
            shape: {
              points: [startBc, startPf, endPf, endBc]
            },
            style: {
              fill: color,
              opacity: 0.18
            }
          };
        },
        data: bandSegments,
        encode: { x: [0, 1], y: [2, 3, 4, 5] }
      },
      {
        name: "BC",
        type: "line",
        showSymbol: false,
        sampling: "lttb",
        connectNulls: false,
        emphasis: { focus: "series" },
        lineStyle: { color: "#2563eb", width: 2.5 },
        itemStyle: { color: "#2563eb" },
        data: seriesData.map((item) => [item.timestampMs, item.bc]),
        markArea: {
          silent: true,
          itemStyle: { borderWidth: 0 },
          data: [...nightBands, ...weekendBands]
        },
        markLine: {
          silent: true,
          symbol: "none",
          data: weekSeparators.map((value) => ({ xAxis: value })),
          lineStyle: { color: "#c6d3db", type: "dashed", width: 1 }
        },
        z: 3
      },
      {
        name: "PF",
        type: "line",
        showSymbol: false,
        sampling: "lttb",
        connectNulls: false,
        emphasis: { focus: "series" },
        lineStyle: { color: "#16a34a", width: 2.5 },
        itemStyle: { color: "#16a34a" },
        data: seriesData.map((item) => [item.timestampMs, item.pf]),
        z: 3
      },
      {
        name: "Pérdidas",
        type: "line",
        showSymbol: false,
        sampling: "lttb",
        connectNulls: false,
        emphasis: { focus: "series" },
        lineStyle: { color: "#f97316", width: 1.4, type: "dashed" },
        itemStyle: { color: "#f97316" },
        data: seriesData.map((item) => [item.timestampMs, item.losses]),
        z: 3
      },
      {
        name: "% pérdida",
        type: "line",
        yAxisIndex: 1,
        showSymbol: false,
        sampling: "lttb",
        connectNulls: false,
        emphasis: { focus: "series" },
        lineStyle: { color: "#7c3aed", width: 1.4, type: "dotted" },
        itemStyle: { color: "#7c3aed" },
        data: seriesData.map((item) => [item.timestampMs, clampPercent(item.deviationPct)]),
        z: 2
      }
    ]
  };
}

function getEnergyVisibleRange(points: EnergyPoint[], range: EnergyRangePreset) {
  if (points.length === 0) {
    const now = Date.now();
    return { start: now - 24 * 60 * 60 * 1000, end: now };
  }

  const end = points[points.length - 1].timestampMs;
  const start = points[0].timestampMs;
  const rangeStart =
    range === "all"
      ? start
      : range === "day"
        ? Math.max(end - 24 * 60 * 60 * 1000, start)
        : range === "last7"
          ? Math.max(end - 7 * 24 * 60 * 60 * 1000, start)
          : range === "week"
            ? Math.max(startOfUtcWeek(end), start)
            : Math.max(end - 30 * 24 * 60 * 60 * 1000, start);
  return { start: rangeStart, end };
}

function buildEnergyBandSegments(points: EnergyPoint[]) {
  const segments: Array<[number, number, number, number, number, number, number]> = [];
  const valid = points.filter(
    (point): point is EnergyPoint & { displayBc: number; displayPf: number } => point.displayBc !== null && point.displayPf !== null
  );
  for (let index = 1; index < valid.length; index += 1) {
    const previous = valid[index - 1];
    const current = valid[index];
    const deviationPct =
      clampPercent((Math.abs(previous.displayDeviationPct ?? 0) + Math.abs(current.displayDeviationPct ?? 0)) / 2) ?? 0;
    segments.push([previous.timestampMs, current.timestampMs, previous.displayBc, previous.displayPf, current.displayBc, current.displayPf, deviationPct]);
  }
  return segments;
}

function buildWeekendBands(points: EnergyPoint[], start: number, end: number) {
  const bands: Array<[Record<string, unknown>, Record<string, unknown>]> = [];
  if (points.length === 0) {
    return bands;
  }

  const cursor = new Date(startOfUtcDay(start));
  const limit = end;
  while (cursor.getTime() < limit) {
    const day = cursor.getUTCDay();
    if (day === 6) {
      const weekendStart = cursor.getTime();
      const weekendEnd = Math.min(addUtcDays(weekendStart, 2), limit);
      bands.push([
        { xAxis: weekendStart, itemStyle: { color: "rgba(59, 130, 246, 0.04)" } },
        { xAxis: weekendEnd }
      ]);
      cursor.setUTCDate(cursor.getUTCDate() + 2);
      continue;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return bands;
}

function buildNightBands(points: EnergyPoint[], start: number, end: number) {
  const bands: Array<[Record<string, unknown>, Record<string, unknown>]> = [];
  if (points.length === 0) {
    return bands;
  }

  const cursor = new Date(startOfUtcDay(start));
  const limit = end;
  while (cursor.getTime() < limit) {
    const nightStart = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), 22, 0, 0, 0);
    const nightEnd = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1, 6, 0, 0, 0);
    if (nightEnd > start && nightStart < end) {
      bands.push([
        { xAxis: Math.max(nightStart, start), itemStyle: { color: "rgba(15, 23, 42, 0.03)" } },
        { xAxis: Math.min(nightEnd, end) }
      ]);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return bands;
}

function buildWeekSeparators(start: number, end: number) {
  const separators: number[] = [];
  const cursor = new Date(startOfUtcWeek(start));
  while (cursor.getTime() < end) {
    separators.push(cursor.getTime());
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return separators;
}

function startOfUtcDay(value: number) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0);
}

function startOfUtcWeek(value: number) {
  const date = new Date(startOfUtcDay(value));
  const day = date.getUTCDay();
  const offset = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.getTime();
}

function addUtcDays(value: number, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.getTime();
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function buildAxisLabelFormatter(spanMs: number) {
  if (spanMs <= 2 * 24 * 60 * 60 * 1000) {
    return (value: number) => {
      const date = new Date(value);
      return `${pad2(date.getUTCDate())}/${pad2(date.getUTCMonth() + 1)} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
    };
  }

  if (spanMs <= 45 * 24 * 60 * 60 * 1000) {
    return (value: number) => {
      const date = new Date(value);
      return `${pad2(date.getUTCDate())}/${pad2(date.getUTCMonth() + 1)}`;
    };
  }

  return (value: number) => {
    const date = new Date(value);
    return `${pad2(date.getUTCDate())}/${pad2(date.getUTCMonth() + 1)}/${String(date.getUTCFullYear()).slice(-2)}`;
  };
}

function formatChartTooltipDate(value: number) {
  const date = new Date(value);
  return `${pad2(date.getUTCDate())}/${pad2(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

function deviationBandColor(value: number) {
  if (value <= 5) {
    return "rgba(22, 163, 74, 0.22)";
  }

  if (value <= 15) {
    return "rgba(249, 115, 22, 0.22)";
  }

  return "rgba(220, 38, 38, 0.24)";
}

function positiveMagnitude(value?: string | number | null) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? null : Math.abs(numeric);
}

function invertedSignedValue(value?: string | number | null) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? null : -numeric;
}

function formatAxisValue(value: number) {
  return formatDecimalNumber(value, 0);
}

function EChart({ option, height = 360 }: { option: EChartsOption; height?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chart.setOption(option, true);

    const resize = () => {
      chart.resize();
    };

    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : undefined;
    observer?.observe(ref.current);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      observer?.disconnect();
      chart.dispose();
    };
  }, [option]);

  return <div className="chart-canvas energy-chart-canvas" ref={ref} style={{ height }} />;
}

function formatPercentValue(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return `${value > 0 ? "+" : ""}${formatDecimalNumber(value, 1)}%`;
}

function clampPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(-200, Math.min(200, value));
}

function getPercentAxisRange(points: EnergyPoint[]) {
  const values = points
    .map((point) => point.deviationPct)
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .map((value) => Math.abs(value));

  if (values.length === 0) {
    return { min: -20, max: 20 };
  }

  const sorted = [...values].sort((left, right) => left - right);
  const p95 = percentile(sorted, 0.95);
  const maxAbs = Math.min(200, Math.max(20, p95 * 1.25));
  return { min: -maxAbs, max: maxAbs };
}

function percentile(sortedValues: number[], rank: number) {
  if (sortedValues.length === 0) {
    return 0;
  }
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }

  const index = (sortedValues.length - 1) * rank;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sortedValues[lower];
  }
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function formatDecimalNumber(value: number, decimals = 3) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const fixed = absolute.toFixed(decimals);
  const [integerPart, decimalPart = ""] = fixed.split(".");
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const trimmedDecimals = decimalPart.replace(/0+$/, "");
  return trimmedDecimals ? `${sign}${groupedInteger},${trimmedDecimals}` : `${sign}${groupedInteger}`;
}

function ImportHistoryDashboardView({
  files,
  latestImport,
  mode,
  onRefresh
}: {
  files: ImportHistoryFile[];
  latestImport?: { summary: ImportResponse["summary"] };
  mode: ImportHistoryMode;
  onRefresh?: () => Promise<void> | void;
}) {
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState("");
  const [loadDate, setLoadDate] = useState("");
  const [period, setPeriod] = useState("");
  const [agent, setAgent] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [onlyDuplicates, setOnlyDuplicates] = useState(false);
  const [compact, setCompact] = useState(true);
  const [cardMode, setCardMode] = useState(false);
  const [sortKey, setSortKey] = useState<LoadSortKey>("importedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [tablePage, setTablePage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [actionMessage, setActionMessage] = useState<Message>();
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [actionModal, setActionModal] = useState<{
    title: string;
    content: ReactNode;
  }>();

  const versionOptions = useMemo(() => [...new Set(files.map((file) => file.version))].sort(), [files]);
  const filteredFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const result = files.filter((file) => {
      const filePeriod = getHistoryPeriodKey(file);
      const importedDate = file.importedAt.slice(0, 10);
      const haystack = [file.fileName, file.tipoArchivo, file.version, file.sujetoEic, filePeriod, importedDate].join(" ").toLowerCase();
      if (normalizedQuery && !haystack.includes(normalizedQuery)) {
        return false;
      }
      if (version && file.version !== version) {
        return false;
      }
      if (loadDate && importedDate !== loadDate) {
        return false;
      }
      if (period && filePeriod !== period) {
        return false;
      }
      if (agent && !file.sujetoEic.toLowerCase().includes(agent.toLowerCase())) {
        return false;
      }
      if (onlyErrors && file.invalidRecords === 0 && file.status !== "FAILED") {
        return false;
      }
      if (onlyDuplicates && file.duplicatedRecords === 0 && file.status !== "DUPLICATED") {
        return false;
      }
      return true;
    });

    return result.sort((left, right) => compareLoads(left, right, sortKey, sortDirection));
  }, [agent, files, loadDate, onlyDuplicates, onlyErrors, period, query, sortDirection, sortKey, version]);
  const tablePageSize = compact ? 12 : 8;
  const pagedFiles = filteredFiles.slice(tablePage * tablePageSize, tablePage * tablePageSize + tablePageSize);
  const pageCount = Math.max(Math.ceil(filteredFiles.length / tablePageSize), 1);
  const selectedCount = [...selectedIds].filter((id) => filteredFiles.some((file) => file.id === id)).length;
  const kpis = buildImportHistoryKpis(files, latestImport);
  const chartData = buildImportHistoryCharts(files);
  const hasInvalidsChartSignal = chartData.monthlyInvalids.some((row) => row.value > 0);
  const copy = mode === "reganecu"
    ? {
        eyebrow: "REGANECU · Histórico",
        title: "Consola operativa de cargas REGANECU",
        description: "Supervisión de ficheros horarios y cuartohorarios, calidad de datos y trazabilidad de cargas.",
        importHint: "Arrastra TXT, CSV o ZIP en la zona superior de la aplicación. La validación bloquea duplicados por tipo, fecha y versión.",
        tableTitle: "Cargas REGANECU",
        empty: "Sin cargas REGANECU con los filtros seleccionados.",
        exportName: "cargas-reganecu.csv"
      }
    : {
        eyebrow: "MEDPERQH · Histórico",
        title: "Consola operativa de cargas de medidas",
        description: "Supervisión de ficheros MEDPERQH, calidad de medida y trazabilidad de cargas cuartohorarias.",
        importHint: "Arrastra TXT, CSV o ZIP en la zona superior de la aplicación. La validación bloquea duplicados por tipo, fecha y versión.",
        tableTitle: "Cargas MEDPERQH",
        empty: "Sin cargas MEDPERQH con los filtros seleccionados.",
        exportName: "cargas-medidas.csv"
      };

  useEffect(() => {
    if (tablePage > pageCount - 1) {
      setTablePage(Math.max(pageCount - 1, 0));
    }
  }, [pageCount, tablePage]);

  function toggleSort(nextKey: LoadSortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      setSortDirection(nextKey === "fileName" || nextKey === "status" || nextKey === "type" ? "asc" : "desc");
    }
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function togglePageSelection(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const file of pagedFiles) {
        if (checked) {
          next.add(file.id);
        } else {
          next.delete(file.id);
        }
      }
      return next;
    });
  }

  function resetFilters() {
    setQuery("");
    setVersion("");
    setLoadDate("");
    setPeriod("");
    setAgent("");
    setOnlyErrors(false);
    setOnlyDuplicates(false);
    setTablePage(0);
  }

  async function runHistoryAction(file: ImportHistoryFile, action: () => Promise<void>) {
    setActionBusyId(file.id);
    setActionMessage(undefined);
    try {
      await action();
    } catch (error) {
      setActionMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo completar la acción." });
    } finally {
      setActionBusyId(null);
    }
  }

  function showDetail(file: ImportHistoryFile) {
    void runHistoryAction(file, async () => {
      const detail = await getImportFileDetail(file.id);
      setActionModal({
        title: `Detalle de carga · ${file.fileName}`,
        content: <ImportDetailModalContent detail={detail} />
      });
    });
  }

  function downloadErrors(file: ImportHistoryFile) {
    void runHistoryAction(file, async () => {
      const csv = await getImportFileErrorsCsv(file.id);
      downloadBlob(`${safeExportName(file.fileName)}-errores.csv`, csv, "text/csv;charset=utf-8");
      setActionMessage({ tone: "success", text: `Errores de ${file.fileName} descargados.` });
    });
  }

  function reprocessFile(file: ImportHistoryFile) {
    if (!window.confirm(`Se reprocesara la carga ${file.fileName} y se sobrescribirán los datos anteriores. ¿¿Continuar?`)) {
      return;
    }

    void runHistoryAction(file, async () => {
      const response = await reprocessImportFile(file.id);
      await onRefresh?.();
      setActionMessage({
        tone: response.summary.failedFiles > 0 ? "error" : "success",
        text: `Reprocesado ${file.fileName}: ${response.summary.recordsImported.toLocaleString("es-ES")} registros importados.`
      });
    });
  }

  function deleteFile(file: ImportHistoryFile) {
    if (!window.confirm(`Se eliminara la carga ${file.fileName} y sus registros relacionados. ¿¿Continuar?`)) {
      return;
    }

    void runHistoryAction(file, async () => {
      await deleteImportFile(file.id);
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(file.id);
        return next;
      });
      await onRefresh?.();
      setActionMessage({ tone: "success", text: `Carga ${file.fileName} eliminada.` });
    });
  }

  function showLogs(file: ImportHistoryFile) {
    void runHistoryAction(file, async () => {
      const logs = await getImportFileLogs(file.id);
      setActionModal({
        title: `Logs de carga · ${file.fileName}`,
        content: <ImportLogsModalContent logs={logs} />
      });
    });
  }

  return (
    <section className="ops-dashboard">
      <div className="ops-hero">
        <div>
          <p className="ops-eyebrow">{copy.eyebrow}</p>
          <h2>{copy.title}</h2>
          <span>{copy.description}</span>
        </div>
        <div className="ops-hero-actions">
          <button className="ops-primary-button" onClick={() => exportLoadCsv(copy.exportName, filteredFiles)} type="button">
            <FileDown size={17} />
            Exportar cargas
          </button>
        </div>
      </div>

      <div className="ops-kpi-grid">
        {kpis.map((kpi) => (
          <div className={`ops-kpi-card ${kpi.tone}`} key={kpi.label}>
            <div className="ops-kpi-icon">{kpi.icon}</div>
            <span>{kpi.label}</span>
            <strong>{kpi.value}</strong>
            <small>{kpi.detail}</small>
          </div>
        ))}
      </div>

      <div className="ops-workbench">
        <div className="ops-drop-panel">
          <div className="ops-drop-icon">
            <UploadCloud size={24} />
          </div>
          <div>
            <strong>Importación rápida</strong>
            <span>{copy.importHint}</span>
          </div>
          <div className="ops-progress-track">
            <span style={{ width: `${Math.min(100, Math.max(8, latestImport ? 100 : 18))}%` }} />
          </div>
          <small>{latestImport ? `${latestImport.summary.recordsImported} registros en la Última carga` : "Sin carga reciente en esta sesión"}</small>
        </div>
        <OpsMiniChart title="Evolución cargas" rows={chartData.monthlyLoads} valueLabel="cargas" tone="cyan" />
        {hasInvalidsChartSignal ? <OpsMiniChart title="Inválidos por mes" rows={chartData.monthlyInvalids} valueLabel="incidencias" tone="rose" /> : null}
        <OpsMiniChart title="Volumen por tipo" rows={chartData.byVersion} valueLabel="registros" tone="emerald" />
      </div>

      <div className="ops-filter-bar">
        <label className="ops-search">
          <Search size={16} />
          <input value={query} onChange={(event) => { setQuery(event.target.value); setTablePage(0); }} placeholder="Buscar archivo, agente, periodo..." />
        </label>
        <select value={version} onChange={(event) => { setVersion(event.target.value); setTablePage(0); }}>
          <option value="">Todas las versiones</option>
          {versionOptions.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <input type="date" value={loadDate} onChange={(event) => { setLoadDate(event.target.value); setTablePage(0); }} />
        <input value={period} onChange={(event) => { setPeriod(event.target.value); setTablePage(0); }} placeholder="Periodo YYYY-MM" />
        <input value={agent} onChange={(event) => { setAgent(event.target.value); setTablePage(0); }} placeholder="Agente/distribuidora" />
        <button className={onlyErrors ? "active" : ""} onClick={() => { setOnlyErrors((current) => !current); setTablePage(0); }} type="button">Solo errores</button>
        <button className={onlyDuplicates ? "active" : ""} onClick={() => { setOnlyDuplicates((current) => !current); setTablePage(0); }} type="button">Solo duplicados</button>
        <button onClick={resetFilters} type="button">
          <RotateCcw size={15} />
        </button>
      </div>

      {actionMessage && <div className={`status-message ${actionMessage.tone} ops-action-message`}>{actionMessage.text}</div>}

      <div className="ops-table-panel">
        <div className="ops-table-head">
          <div>
            <strong>{copy.tableTitle}</strong>
            <span>{filteredFiles.length} ficheros filtrados · {selectedCount} seleccionados</span>
          </div>
          <div className="ops-view-toggle">
            <button className={compact ? "active" : ""} onClick={() => setCompact(true)} type="button">Compacto</button>
            <button className={!compact ? "active" : ""} onClick={() => setCompact(false)} type="button">Cómodo</button>
            <button className={cardMode ? "active" : ""} onClick={() => setCardMode((current) => !current)} type="button">Tarjetas</button>
          </div>
        </div>

        {cardMode ? (
          <div className="ops-card-grid">
            {pagedFiles.map((file) => (
              <OpsLoadCard file={file} key={file.id} />
            ))}
            {pagedFiles.length === 0 && <div className="ops-empty">{copy.empty}</div>}
          </div>
        ) : (
          <OpsLoadsTable
            compact={compact}
            files={pagedFiles}
            selectedIds={selectedIds}
            sortDirection={sortDirection}
            sortKey={sortKey}
            onSort={toggleSort}
            onToggleAll={togglePageSelection}
            onToggleRow={toggleSelection}
            actionBusyId={actionBusyId}
            onDetail={showDetail}
            onDownloadErrors={downloadErrors}
            onReprocess={reprocessFile}
            onDelete={deleteFile}
            onLogs={showLogs}
            emptyText={copy.empty}
          />
        )}

        <div className="ops-pagination">
          <span>Página {tablePage + 1} de {pageCount}</span>
          <button disabled={tablePage === 0} onClick={() => setTablePage((current) => Math.max(0, current - 1))} type="button">
            <ChevronLeft size={16} />
          </button>
          <button disabled={tablePage >= pageCount - 1} onClick={() => setTablePage((current) => Math.min(pageCount - 1, current + 1))} type="button">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {actionModal && (
        <ImportActionModal title={actionModal.title} onClose={() => setActionModal(undefined)}>
          {actionModal.content}
        </ImportActionModal>
      )}
    </section>
  );
}

function OpsMiniChart({
  title,
  rows,
  valueLabel,
  tone
}: {
  title: string;
  rows: Array<{ label: string; value: number }>;
  valueLabel: string;
  tone: "cyan" | "emerald" | "rose";
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <div className={`ops-chart-card ${tone}`}>
      <div className="ops-chart-title">
        <strong>{title}</strong>
        <span>{rows.reduce((sum, row) => sum + row.value, 0).toLocaleString("es-ES")} {valueLabel}</span>
      </div>
      <div className="ops-bars">
        {rows.length === 0 && <small>Sin datos</small>}
        {rows.map((row) => (
          <div className="ops-bar-row" key={row.label}>
            <span>{row.label}</span>
            <div><i style={{ width: `${Math.max((row.value / max) * 100, row.value > 0 ? 4 : 0)}%` }} /></div>
            <small>{row.value.toLocaleString("es-ES")}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function OpsLoadsTable({
  files,
  compact,
  emptyText,
  selectedIds,
  sortKey,
  sortDirection,
  onSort,
  onToggleAll,
  onToggleRow,
  actionBusyId,
  onDetail,
  onDownloadErrors,
  onReprocess,
  onDelete,
  onLogs
}: {
  files: ImportHistoryFile[];
  compact: boolean;
  emptyText: string;
  selectedIds: Set<string>;
  sortKey: LoadSortKey;
  sortDirection: "asc" | "desc";
  onSort: (key: LoadSortKey) => void;
  onToggleAll: (checked: boolean) => void;
  onToggleRow: (id: string) => void;
  actionBusyId: string | null;
  onDetail: (file: ImportHistoryFile) => void;
  onDownloadErrors: (file: ImportHistoryFile) => void;
  onReprocess: (file: ImportHistoryFile) => void;
  onDelete: (file: ImportHistoryFile) => void;
  onLogs: (file: ImportHistoryFile) => void;
}) {
  const allSelected = files.length > 0 && files.every((file) => selectedIds.has(file.id));
  const header = [
    { key: "status" as const, label: "Estado" },
    { key: "type" as const, label: "Tipo" },
    { key: "period" as const, label: "Periodo" },
    { key: "fileName" as const, label: "Archivo" },
    { key: "totalRecords" as const, label: "Registros" },
    { key: "validRecords" as const, label: "Válidos" },
    { key: "invalidRecords" as const, label: "Inválidos" },
    { key: "duplicatedRecords" as const, label: "Duplicados" },
    { key: "importedAt" as const, label: "Fecha carga" }
  ];

  return (
    <div className={`ops-load-table ${compact ? "compact" : ""}`}>
      <div className="ops-load-row ops-load-header">
        <span className="ops-select-cell">
          <input checked={allSelected} onChange={(event) => onToggleAll(event.currentTarget.checked)} type="checkbox" />
        </span>
        {header.map((column) => (
          <button className={sortKey === column.key ? "sorted" : ""} key={column.key} onClick={() => onSort(column.key)} type="button">
            {column.label}
            {sortKey === column.key && <small>{sortDirection === "asc" ? "?" : "?"}</small>}
          </button>
        ))}
        <span>Acciones</span>
      </div>
      {files.map((file) => (
        <div className="ops-load-row" key={file.id}>
          <span className="ops-select-cell">
            <input checked={selectedIds.has(file.id)} onChange={() => onToggleRow(file.id)} type="checkbox" />
          </span>
          <span><LoadStatusBadge status={getLoadStatus(file)} /></span>
          <span>{file.version}</span>
          <span>{getHistoryPeriodLabel(file)}</span>
          <span className="ops-file-cell" title={file.fileName}>{file.fileName}</span>
          <span className="ops-number-cell">{file.totalRecords.toLocaleString("es-ES")}</span>
          <span className="ops-number-cell good">{file.validRecords.toLocaleString("es-ES")}</span>
          <span className="ops-number-cell danger">{file.invalidRecords.toLocaleString("es-ES")}</span>
          <span className="ops-number-cell warning">{file.duplicatedRecords.toLocaleString("es-ES")}</span>
          <span>{formatDateTime(file.importedAt)}</span>
          <span className="ops-action-cell">
            <button disabled={actionBusyId === file.id} onClick={() => onDetail(file)} title="Ver detalle" type="button"><Clipboard size={15} /></button>
            <button disabled={actionBusyId === file.id} onClick={() => onDownloadErrors(file)} title="Descargar errores" type="button"><FileDown size={15} /></button>
            <button disabled={actionBusyId === file.id} onClick={() => onReprocess(file)} title="Reprocesar" type="button"><RefreshCw size={15} /></button>
            <button disabled={actionBusyId === file.id} onClick={() => onDelete(file)} title="Eliminar" type="button"><Trash2 size={15} /></button>
            <button disabled={actionBusyId === file.id} onClick={() => onLogs(file)} title="Ver logs" type="button"><FileClock size={15} /></button>
            <button disabled title="Comparar: endpoint pendiente" type="button"><FileSpreadsheet size={15} /></button>
          </span>
        </div>
      ))}
      {files.length === 0 && <div className="ops-empty">{emptyText}</div>}
    </div>
  );
}

function ImportActionModal({
  title,
  children,
  onClose
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="ops-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="ops-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="ops-modal-head">
          <strong>{title}</strong>
          <button onClick={onClose} title="Cerrar" type="button">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ImportDetailModalContent({ detail }: { detail: ImportHistoryDetail }) {
  const file = detail.file;
  const previewColumns = detail.preview[0] ? Object.keys(detail.preview[0]) : [];

  return (
    <div className="ops-modal-body">
      <div className="ops-detail-grid">
        <Metric label="Estado" value={file.status} />
        <Metric label="Tipo fichero" value={file.tipoArchivo} />
        <Metric label="Versión" value={file.version} />
        <Metric label="Periodo" value={getHistoryPeriodLabel(file)} />
        <Metric label="Registros" value={file.totalRecords.toLocaleString("es-ES")} />
        <Metric label="Persistidos" value={detail.recordCounts.total.toLocaleString("es-ES")} />
        <Metric label="Válidos" value={file.validRecords.toLocaleString("es-ES")} />
        <Metric label="Inválidos" value={file.invalidRecords.toLocaleString("es-ES")} />
        <Metric label="Duplicados" value={file.duplicatedRecords.toLocaleString("es-ES")} />
        <Metric label="Carga" value={formatDateTime(file.importedAt)} />
      </div>

      <div className="ops-modal-section">
        <strong>Errores detectados</strong>
        {detail.errors.length === 0 ? (
          <span>No hay errores almacenados para esta carga.</span>
        ) : (
          <div className="ops-error-preview">
            {detail.errors.slice(0, 8).map((error, index) => (
              <div key={`${error.sourceFileName}-${error.lineNumber}-${index}`}>
                <b>Línea {error.lineNumber}</b>
                <span>{error.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ops-modal-section">
        <strong>Primeros registros</strong>
        {previewColumns.length === 0 ? (
          <span>No hay registros persistidos para previsualizar.</span>
        ) : (
          <div className="ops-preview-table">
            <div className="ops-preview-row header">
              {previewColumns.map((column) => (
                <span key={column}>{column}</span>
              ))}
            </div>
            {detail.preview.map((row, index) => (
              <div className="ops-preview-row" key={index}>
                {previewColumns.map((column) => (
                  <span key={column}>{formatActionValue(row[column])}</span>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ImportLogsModalContent({ logs }: { logs: ImportHistoryLogs }) {
  return (
    <div className="ops-modal-body">
      <pre className="ops-log-box">{logs.text}</pre>
    </div>
  );
}

function OpsLoadCard({ file }: { file: ImportHistoryFile }) {
  return (
    <article className="ops-load-card">
      <div>
        <LoadStatusBadge status={getLoadStatus(file)} />
        <strong>{file.fileName}</strong>
        <span>{file.version} € {file.tipoArchivo} € {getHistoryPeriodLabel(file)} € {file.sujetoEic}</span>
      </div>
      <div className="ops-load-card-metrics">
        <span>{file.totalRecords.toLocaleString("es-ES")} total</span>
        <span className="good">{file.validRecords.toLocaleString("es-ES")} válidos</span>
        <span className="danger">{file.invalidRecords.toLocaleString("es-ES")} inválidos</span>
        <span className="warning">{file.duplicatedRecords.toLocaleString("es-ES")} dup.</span>
      </div>
    </article>
  );
}

function LoadStatusBadge({ status }: { status: LoadStatus }) {
  const label = status === "valid" ? "Validado" : status === "partial" ? "Parcial" : status === "error" ? "Error" : "Procesando";
  return <span className={`ops-status-badge ${status}`}>{label}</span>;
}

function buildImportHistoryKpis(files: ImportHistoryFile[], latestImport?: { summary: ImportResponse["summary"] }) {
  const totals = files.reduce(
    (acc, file) => ({
      records: acc.records + file.totalRecords,
      valid: acc.valid + file.validRecords,
      invalid: acc.invalid + file.invalidRecords,
      duplicated: acc.duplicated + file.duplicatedRecords
    }),
    { records: 0, valid: 0, invalid: 0, duplicated: 0 }
  );
  const latestFile = [...files].sort((left, right) => new Date(right.importedAt).getTime() - new Date(left.importedAt).getTime())[0];
  const sortedPeriods = [...files].map(getHistoryPeriodKey).sort();
  const latestPeriod = sortedPeriods[sortedPeriods.length - 1];

  return [
    { label: "Total registros", value: totals.records.toLocaleString("es-ES"), detail: `${files.length} cargas`, tone: "info", icon: <Database size={18} /> },
    { label: "Válidos", value: totals.valid.toLocaleString("es-ES"), detail: qualityLabel(totals.valid, totals.records), tone: "good", icon: <CheckCircle2 size={18} /> },
    { label: "Inválidos", value: totals.invalid.toLocaleString("es-ES"), detail: qualityLabel(totals.invalid, totals.records), tone: totals.invalid > 0 ? "danger" : "good", icon: <AlertTriangle size={18} /> },
    { label: "Duplicados", value: totals.duplicated.toLocaleString("es-ES"), detail: qualityLabel(totals.duplicated, totals.records), tone: totals.duplicated > 0 ? "warning" : "good", icon: <Clipboard size={18} /> },
    { label: "Última carga", value: latestFile ? formatDateTime(latestFile.importedAt) : "-", detail: latestImport ? `${latestImport.summary.recordsImported} registros importados` : "Sin carga en sesión", tone: "accent", icon: <FileClock size={18} /> },
    { label: "Último periodo", value: latestPeriod ? formatMonthKeyLabel(latestPeriod) : "-", detail: latestFile?.version ?? "Sin periodo", tone: "info", icon: <Activity size={18} /> }
  ];
}

function buildImportHistoryCharts(files: ImportHistoryFile[]) {
  const monthlyLoads = aggregateFiles(files, getHistoryPeriodKey, () => 1).slice(-8);
  const monthlyInvalids = aggregateFiles(files, getHistoryPeriodKey, (file) => file.invalidRecords).slice(-8);
  const byVersion = aggregateFiles(files, (file) => file.version, (file) => file.totalRecords);

  return { monthlyLoads, monthlyInvalids, byVersion };
}

function aggregateFiles(files: ImportHistoryFile[], getKey: (file: ImportHistoryFile) => string, getValue: (file: ImportHistoryFile) => number) {
  const map = new Map<string, number>();
  for (const file of files) {
    const key = getKey(file);
    map.set(key, (map.get(key) ?? 0) + getValue(file));
  }
  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([label, value]) => ({ label, value }));
}

function compareLoads(left: ImportHistoryFile, right: ImportHistoryFile, sortKey: LoadSortKey, direction: "asc" | "desc") {
  const multiplier = direction === "asc" ? 1 : -1;
  const leftValue = getLoadSortValue(left, sortKey);
  const rightValue = getLoadSortValue(right, sortKey);
  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return (leftValue - rightValue) * multiplier;
  }
  return String(leftValue).localeCompare(String(rightValue), "es") * multiplier;
}

function getLoadSortValue(file: ImportHistoryFile, sortKey: LoadSortKey) {
  switch (sortKey) {
    case "status":
      return getLoadStatus(file);
    case "type":
      return file.version;
    case "period":
      return getHistoryPeriodStart(file);
    case "fileName":
      return file.fileName;
    case "totalRecords":
      return file.totalRecords;
    case "validRecords":
      return file.validRecords;
    case "invalidRecords":
      return file.invalidRecords;
    case "duplicatedRecords":
      return file.duplicatedRecords;
    case "importedAt":
      return new Date(file.importedAt).getTime();
  }
}

function getLoadStatus(file: ImportHistoryFile): LoadStatus {
  if (file.status === "FAILED") {
    return "error";
  }
  if (file.status === "DUPLICATED" || file.invalidRecords > 0 || file.duplicatedRecords > 0) {
    return "partial";
  }
  return "valid";
}

function qualityLabel(part: number, total: number) {
  return total > 0 ? `${formatFixedDecimalNumber((part / total) * 100, 2)}% del total` : "Sin registros";
}

function toMonthKeyFromIso(value?: string | null) {
  return value?.slice(0, 7) ?? "";
}

function getHistoryPeriodStart(file: ImportHistoryFile) {
  return "fechaLiquidacion" in file ? file.fechaLiquidacion : file.fechaInicio;
}

function getHistoryPeriodKey(file: ImportHistoryFile) {
  return toMonthKeyFromIso(getHistoryPeriodStart(file));
}

function getHistoryPeriodLabel(file: ImportHistoryFile) {
  if ("fechaLiquidacion" in file) {
    return formatDate(file.fechaLiquidacion);
  }

  return `${formatDate(file.fechaInicio)} - ${formatDate(file.fechaFin)}`;
}

function exportLoadCsv(name: string, files: ImportHistoryFile[]) {
  exportCsv(name, files.map((file) => ({
    estado: getLoadStatus(file),
    tipo: file.version,
    tipoFichero: file.tipoArchivo,
    periodo: getHistoryPeriodLabel(file),
    archivo: file.fileName,
    registros: file.totalRecords,
    validos: file.validRecords,
    invalidos: file.invalidRecords,
    duplicados: file.duplicatedRecords,
    fechaCarga: formatDateTime(file.importedAt)
  })));
}

function PanelTitle({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle?: ReactNode }) {
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

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{typeof value === "number" ? formatNumber(value) : value}</strong>
    </div>
  );
}

function safeExportName(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "carga";
}

function formatActionValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function exportCsv<T extends object>(name: string, rows: T[]) {
  void withGlobalLoading(
    () => {
      if (rows.length === 0) {
        return;
      }
      const headers = Object.keys(flattenRow(rows[0]));
      const lines = [
        headers.join(";"),
        ...rows.map((row) => headers.map((header) => csvCell(flattenRow(row)[header])).join(";"))
      ];
      downloadBlob(name, lines.join("\n"), "text/csv;charset=utf-8");
    },
    { label: "Preparando exportaci?n" }
  );
}

function flattenRow(row: object) {
  return Object.entries(row).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        acc[`${key}.${childKey}`] = childValue;
      }
    } else {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function csvCell(value: unknown) {
  const text = stringifyCellValue(value as string | number | null | undefined);
  return `"${text.replace(/"/g, '""')}"`;
}

function formatFixedDecimalNumber(value: number, decimals = 2) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const fixed = absolute.toFixed(decimals);
  const [integerPart, decimalPart = ""] = fixed.split(".");
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimals > 0 ? `${sign}${groupedInteger},${decimalPart}` : `${sign}${groupedInteger}`;
}
