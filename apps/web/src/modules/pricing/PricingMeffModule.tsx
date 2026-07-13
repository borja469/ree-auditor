import { useEffect, useMemo, useRef, useState } from "react";
import { Calculator, Check, ChevronDown, FileUp, RotateCcw } from "lucide-react";
import { getPricingMeff, uploadPricingMeffFile, type PricingMeffFilters, type PricingMeffImportResponse, type PricingMeffRow } from "../../api";
import { PanelTitle, formatDecimalNumber, formatNumber } from "../shared/RestoredModuleCommon";

const PAGE_SIZE = 500;
const EMPTY_FILTER_OPTIONS = {
  tipos: [] as string[],
  clases: [] as string[],
  periodos: [] as string[],
  entregas: [] as string[],
  multiplicadores: [] as string[]
};

export function PricingMeffModule() {
  const [filters, setFilters] = useState<PricingMeffFilters>(() => defaultFilters());
  const [rows, setRows] = useState<PricingMeffRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string }>();
  const [lastImport, setLastImport] = useState<PricingMeffImportResponse>();
  const [filterOptions, setFilterOptions] = useState(EMPTY_FILTER_OPTIONS);

  async function load(nextFilters = filters) {
    setLoading(true);
    setMessage(undefined);
    try {
      const result = await getPricingMeff({ ...normalizeFilters(nextFilters), skip: 0, take: PAGE_SIZE });
      setRows(result.rows);
      setTotal(result.total);
      setFilterOptions(result.filterOptions);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error consultando precios MEFF." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const handle = window.setTimeout(() => void load(filters), 250);
    return () => window.clearTimeout(handle);
  }, [filters]);

  async function uploadFile(file: File | undefined) {
    if (!file) {
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setMessage(undefined);
    setLastImport(undefined);
    try {
      const result = await uploadPricingMeffFile(file, setUploadProgress);
      setLastImport(result);
      setMessage({ tone: result.errors.length ? "info" : "info", text: `MEFF importado: ${formatNumber(result.inserted)} insertados, ${formatNumber(result.updated)} actualizados, ${formatNumber(result.errors.length)} errores.` });
      await load(filters);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error importando fichero MEFF." });
    } finally {
      setUploading(false);
    }
  }

  const visibleRows = useMemo(() => rows, [rows]);

  return (
    <div className="omie-layout omie-layout-a">
      <div className="panel wide omie-control-panel">
        <PanelTitle icon={<Calculator size={18} />} title="Pricing MEFF" subtitle="Precios de cierre de derivados de energia" />
        <div className="omie-toolbar compact">
          <label className="filter-field">
            <span>Fecha publicacion</span>
            <input disabled={loading || uploading} type="date" value={filters.fechaPublicacion ?? ""} onChange={(event) => setFilters((current) => ({ ...current, fechaPublicacion: event.target.value || undefined }))} />
          </label>
          <MultiSelectFilter
            disabled={loading || uploading}
            label="Tipo"
            options={filterOptions.tipos}
            value={filters.tipo ?? []}
            onChange={(value) => setFilters((current) => ({ ...current, tipo: value }))}
          />
          <MultiSelectFilter
            disabled={loading || uploading}
            label="Clase"
            options={filterOptions.clases}
            value={filters.clase ?? []}
            onChange={(value) => setFilters((current) => ({ ...current, clase: value }))}
          />
          <MultiSelectFilter
            disabled={loading || uploading}
            label="Periodo"
            options={filterOptions.periodos}
            value={filters.periodo ?? []}
            onChange={(value) => setFilters((current) => ({ ...current, periodo: value }))}
          />
          <MultiSelectFilter
            disabled={loading || uploading}
            label="Entrega"
            options={filterOptions.entregas}
            value={filters.entrega ?? []}
            onChange={(value) => setFilters((current) => ({ ...current, entrega: value }))}
          />
          <MultiSelectFilter
            disabled={loading || uploading}
            label="Multiplicador"
            options={filterOptions.multiplicadores}
            value={filters.multiplicador ?? []}
            onChange={(value) => setFilters((current) => ({ ...current, multiplicador: value }))}
          />
          <button className="secondary-button" disabled={loading || uploading} onClick={() => setFilters(defaultFilters())} type="button">
            <RotateCcw size={16} />
            Limpiar
          </button>
          <label className="secondary-button pricing-upload-button">
            <FileUp size={16} />
            Importar XLS
            <input disabled={uploading} onChange={(event) => void uploadFile(event.target.files?.[0])} type="file" accept=".xls,.xlsx,.html,.htm" />
          </label>
        </div>
      </div>

      {message && <div className={`status-message ${message.tone}`}>{message.text}</div>}

      {uploading && (
        <div className="panel wide">
          <div className="pricing-upload-progress">
            <span>Importando MEFF</span>
            <strong>{uploadProgress}%</strong>
          </div>
        </div>
      )}

      {lastImport?.errors.length ? (
        <div className="panel wide">
          <PanelTitle icon={<FileUp size={18} />} title="Errores de importacion" subtitle={`${formatNumber(lastImport.errors.length)} filas con errores`} />
          <div className="pricing-error-list">
            {lastImport.errors.slice(0, 20).map((error) => (
              <div key={`${error.row}-${error.message}`}>
                <strong>Fila {error.row}</strong>
                <span>{error.message}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="panel wide pricing-meff-panel">
        <PanelTitle icon={<Calculator size={18} />} title="Precios MEFF" subtitle={`${formatNumber(total)} registros. Mostrando ${formatNumber(visibleRows.length)}.`} />
        <div className="pricing-meff-table-scroll">
          <table className="pricing-meff-table">
            <thead>
              <tr>
                <th>Fecha publicacion</th>
                <th>Tipo</th>
                <th>Clase</th>
                <th>Periodo</th>
                <th>Entrega</th>
                <th>Precio</th>
                <th>Hace 7 dias</th>
                <th>Hace 14 dias</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.fechaPublicacion)}</td>
                  <td>{row.tipo ?? "-"}</td>
                  <td>{row.clase ?? "-"}</td>
                  <td>{row.periodo ?? "-"}</td>
                  <td>{row.entrega ?? "-"}</td>
                  <td className="number">{formatPrice(row.precio)}</td>
                  <td className="number">{formatComparison(row.precio7Dias)}</td>
                  <td className="number">{formatComparison(row.precio14Dias)}</td>
                </tr>
              ))}
              {!visibleRows.length && (
                <tr>
                  <td colSpan={8} className="empty-cell">{loading ? "Cargando..." : "Sin registros MEFF para los filtros seleccionados."}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function defaultFilters(): PricingMeffFilters {
  return {};
}

function normalizeFilters(filters: PricingMeffFilters): PricingMeffFilters {
  return {
    fechaPublicacion: filters.fechaPublicacion || undefined,
    tipo: normalizeSelection(filters.tipo),
    clase: normalizeSelection(filters.clase),
    periodo: normalizeSelection(filters.periodo),
    entrega: normalizeSelection(filters.entrega),
    multiplicador: normalizeSelection(filters.multiplicador)
  };
}

function MultiSelectFilter({
  label,
  options,
  value,
  onChange,
  disabled
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (value: string[] | undefined) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const normalizedOptions = useMemo(() => [...new Set(options.filter(Boolean))].sort((left, right) => left.localeCompare(right, "es")), [options]);
  const selectedValues = useMemo(() => value.filter((item) => normalizedOptions.includes(item)), [normalizedOptions, value]);
  const filteredOptions = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es");
    return needle ? normalizedOptions.filter((option) => option.toLocaleLowerCase("es").includes(needle)) : normalizedOptions;
  }, [normalizedOptions, search]);
  const displayValue = selectedValues.length === 0 ? "Todos" : selectedValues.length <= 2 ? selectedValues.join(", ") : `${selectedValues.length} seleccionados`;

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  function toggleOption(option: string) {
    const next = selectedValues.includes(option) ? selectedValues.filter((item) => item !== option) : [...selectedValues, option];
    onChange(next.length ? next : undefined);
  }

  return (
    <div className={`filter-field filter-select-field ${open ? "open" : ""}`} ref={containerRef}>
      <span>{label}</span>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="searchable-select-trigger"
        disabled={disabled}
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
        <span className={selectedValues.length ? "" : "placeholder"}>{displayValue}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="searchable-select-popover pricing-multi-select-popover">
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
          <div className="searchable-select-options" role="listbox" aria-multiselectable="true">
            <button
              className={`searchable-select-option pricing-multi-select-option ${selectedValues.length ? "" : "active"}`}
              onClick={() => onChange(undefined)}
              role="option"
              type="button"
            >
              <span>Todos</span>
            </button>
            {filteredOptions.map((option) => {
              const selected = selectedValues.includes(option);
              return (
                <button
                  aria-selected={selected}
                  className={`searchable-select-option pricing-multi-select-option ${selected ? "active" : ""}`}
                  key={option}
                  onClick={() => toggleOption(option)}
                  role="option"
                  type="button"
                >
                  <span>{option}</span>
                  {selected && <Check size={14} />}
                </button>
              );
            })}
            {filteredOptions.length === 0 && <div className="searchable-select-empty">Sin resultados</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function normalizeSelection(value: string[] | undefined) {
  const normalized = value?.map((item) => item.trim()).filter(Boolean);
  return normalized?.length ? [...new Set(normalized)] : undefined;
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatPrice(value: number | null) {
  return value === null || value === undefined || !Number.isFinite(value) ? "-" : formatDecimalNumber(value, 2);
}

function formatComparison(value: { precio: number | null; porcentaje: number | null }) {
  if (value.precio === null || value.porcentaje === null) {
    return "-";
  }
  const sign = value.porcentaje >= 0 ? "+" : "";
  const toneClass = value.porcentaje >= 0 ? "pricing-meff-increase-positive" : "pricing-meff-increase-negative";
  return (
    <>
      {formatPrice(value.precio)} <span className={toneClass}>({sign}{formatDecimalNumber(value.porcentaje, 2)}%)</span>
    </>
  );
}
