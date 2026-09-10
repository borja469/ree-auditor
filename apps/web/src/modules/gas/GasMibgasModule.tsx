import { useEffect, useMemo, useRef, useState } from "react";
import type { EChartsOption } from "echarts";
import { BarChart3, Check, ChevronDown, Download, History, RefreshCw, RotateCcw, X } from "lucide-react";
import {
  getGasMibgasHistory,
  getGasMibgasPrices,
  getGasMibgasProducts,
  getGasMibgasStatus,
  getGasMibgasSyncRuns,
  syncGasMibgas,
  syncGasMibgasHistory,
  type GasMibgasFilters,
  type GasMibgasHistoryFilters,
  type GasMibgasPriceRow,
  type GasMibgasPricesResponse,
  type GasMibgasProduct,
  type GasMibgasStatus,
  type GasMibgasSyncHistoryResponse,
  type GasMibgasSyncResponse,
  type GasMibgasSyncRun
} from "../../api";
import { EChart, PanelTitle, formatDecimalNumber, formatNumber } from "../shared/RestoredModuleCommon";

const DEFAULT_PAGE_SIZE = 30;
const CHART_PAGE_SIZE = 10_000;
const PAGE_SIZE_OPTIONS = [30, 50, 100] as const;
const SPOT_PRODUCT = "GDAES_D+1";
const CURRENT_YEAR = new Date().getFullYear();
const EMPTY_FILTER_OPTIONS: GasMibgasPricesResponse["filterOptions"] = {
  products: [],
  placesOfDelivery: [],
  areas: []
};

type SortKey = "tradingDay" | "product" | "placeOfDelivery" | "area" | "firstDayDelivery" | "lastDayDelivery" | "priceEurMwh";
type SortState = { key: SortKey; direction: "asc" | "desc" };
type Message = { tone: "success" | "error" | "info"; text: string };
type ForwardChartState = { product: string; contractKey: string };
type ForwardContract = GasMibgasProduct & { key: string; label: string };

export function GasMibgasModule() {
  const [tableFilters, setTableFilters] = useState<GasMibgasFilters>(() => defaultFilters());
  const [rows, setRows] = useState<GasMibgasPriceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [filterOptions, setFilterOptions] = useState(EMPTY_FILTER_OPTIONS);
  const [products, setProducts] = useState<GasMibgasProduct[]>([]);
  const [status, setStatus] = useState<GasMibgasStatus>();
  const [syncRuns, setSyncRuns] = useState<GasMibgasSyncRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyResult, setHistoryResult] = useState<GasMibgasSyncHistoryResponse>();
  const [message, setMessage] = useState<Message>();
  const [sort, setSort] = useState<SortState>({ key: "tradingDay", direction: "desc" });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [dailyChartState] = useState({ product: SPOT_PRODUCT });
  const [dailyChartRows, setDailyChartRows] = useState<GasMibgasPriceRow[]>([]);
  const [forwardChartState, setForwardChartState] = useState<ForwardChartState>({ product: "", contractKey: "" });
  const [forwardRows, setForwardRows] = useState<GasMibgasPriceRow[]>([]);
  const [forwardLoading, setForwardLoading] = useState(false);

  async function load(nextFilters = tableFilters, nextPage = page, nextPageSize = pageSize) {
    setLoading(true);
    setMessage(undefined);
    try {
      const normalized = normalizeFilters(nextFilters);
      const dailyChartFilters = buildDailyChartFilters(normalized, dailyChartState.product);
      const [prices, dailyPrices, nextProducts, nextStatus, nextRuns] = await Promise.all([
        getGasMibgasPrices({ ...normalized, skip: nextPage * nextPageSize, take: nextPageSize }),
        getGasMibgasPrices({ ...dailyChartFilters, skip: 0, take: CHART_PAGE_SIZE }),
        getGasMibgasProducts(),
        getGasMibgasStatus(),
        getGasMibgasSyncRuns({ take: 5 })
      ]);
      setRows(prices.rows);
      setTotal(prices.total);
      setDailyChartRows(dailyPrices.rows);
      setFilterOptions(prices.filterOptions);
      setProducts(nextProducts);
      setStatus(nextStatus);
      setSyncRuns(nextRuns.rows);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error consultando MIBGAS." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const handle = window.setTimeout(() => void load(tableFilters, page, pageSize), 250);
    return () => window.clearTimeout(handle);
  }, [tableFilters, page, pageSize]);

  const forwardProductOptions = useMemo(() => buildForwardProductOptions(products), [products]);
  const forwardContracts = useMemo(() => buildForwardContracts(products, forwardChartState.product), [products, forwardChartState.product]);
  const selectedForwardContract = useMemo(() => forwardContracts.find((contract) => contract.key === forwardChartState.contractKey), [forwardContracts, forwardChartState.contractKey]);

  useEffect(() => {
    if (!forwardProductOptions.length) {
      return;
    }
    setForwardChartState((current) => {
      const product = forwardProductOptions.includes(current.product) ? current.product : defaultForwardProduct(forwardProductOptions);
      const contracts = buildForwardContracts(products, product);
      const contractKey = contracts.some((contract) => contract.key === current.contractKey) ? current.contractKey : chooseDefaultForwardContract(contracts)?.key ?? "";
      return product === current.product && contractKey === current.contractKey ? current : { product, contractKey };
    });
  }, [forwardProductOptions, products]);

  useEffect(() => {
    if (!selectedForwardContract) {
      setForwardRows([]);
      return;
    }
    let cancelled = false;
    setForwardLoading(true);
    getGasMibgasHistory(contractToHistoryFilters(selectedForwardContract))
      .then((result) => {
        if (!cancelled) {
          setForwardRows(result.rows);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setForwardRows([]);
          setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error consultando historico forward MIBGAS." });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setForwardLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedForwardContract]);

  async function runSync() {
    if (syncing) {
      return;
    }
    setSyncing(true);
    setMessage(undefined);
    try {
      const result = await syncGasMibgas();
      setMessage(syncMessage(result));
      setPage(0);
      await load(tableFilters, 0, pageSize);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error actualizando MIBGAS." });
    } finally {
      setSyncing(false);
    }
  }

  async function runHistoryImport(fromYear: number, toYear: number) {
    if (syncing) {
      return;
    }
    setSyncing(true);
    setMessage(undefined);
    setHistoryResult(undefined);
    try {
      const result = await syncGasMibgasHistory(fromYear, toYear);
      setHistoryResult(result);
      setMessage({
        tone: result.errors ? "info" : "success",
        text: `Historico MIBGAS: ${formatNumber(result.success)} anos correctos, ${formatNumber(result.errors)} con error.`
      });
      setPage(0);
      await load(tableFilters, 0, pageSize);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error importando historico MIBGAS." });
    } finally {
      setSyncing(false);
    }
  }

  function updateFilters(updater: (current: GasMibgasFilters) => GasMibgasFilters) {
    setPage(0);
    setTableFilters((current) => updater(current));
  }

  const sortedRows = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const dailyChartOption = useMemo(() => buildMibgasDailyChartOption(dailyChartRows), [dailyChartRows]);
  const forwardChartOption = useMemo(() => buildMibgasForwardChartOption(forwardRows, selectedForwardContract), [forwardRows, selectedForwardContract]);
  const pageCount = Math.max(Math.ceil(total / pageSize), 1);
  const fromRow = total === 0 ? 0 : page * pageSize + 1;
  const toRow = Math.min((page + 1) * pageSize, total);
  const latestRun = status?.latestRun;
  const latestSuccess = status?.latestSuccess;

  return (
    <div className="omie-layout omie-layout-a gas-mibgas-module">
      <div className="panel wide omie-control-panel gas-mibgas-header">
        <div className="gas-mibgas-header-main">
          <PanelTitle icon={<BarChart3 size={18} />} title="MIBGAS" subtitle="Precios diarios de productos de gas" />
          <div className="gas-mibgas-actions">
            <button className="primary-button" disabled={syncing} onClick={() => void runSync()} type="button">
              <RefreshCw size={16} />
              {syncing ? "Actualizando..." : "Actualizar MIBGAS"}
            </button>
            <button className="secondary-button" disabled={syncing} onClick={() => setHistoryModalOpen(true)} type="button">
              <History size={16} />
              Importar historico
            </button>
          </div>
        </div>
        <div className="gas-mibgas-status-line">
          <StatusItem label="Ultima sincronizacion" value={formatDateTime(latestRun?.finishedAt ?? latestRun?.startedAt)} />
          <StatusItem label="Emision MIBGAS" value={formatDateTime(latestSuccess?.sourceEmissionDatetime)} />
          <StatusItem label="Estado" value={latestRun?.status ?? "Sin sincronizar"} tone={statusTone(latestRun?.status)} />
          <StatusItem label="Registros" value={formatNumber(status?.totalRows ?? 0)} />
          <StatusItem label="Trading day max." value={formatDate(status?.latestTradingDay)} />
          <StatusItem label="Precios NULL" value={formatNumber(status?.nullPrices ?? 0)} />
        </div>
      </div>

      {message && <div className={`status-message ${message.tone}`}>{message.text}</div>}

      <div className="panel wide omie-control-panel">
        <div className="omie-toolbar compact gas-mibgas-toolbar">
          <MultiSelectFilter disabled={loading || syncing} label="Producto" options={filterOptions.products} value={tableFilters.product ?? []} onChange={(value) => updateFilters((current) => ({ ...current, product: value }))} />
          <MultiSelectFilter disabled={loading || syncing} label="Entrega" options={filterOptions.placesOfDelivery} value={tableFilters.placeOfDelivery ?? []} onChange={(value) => updateFilters((current) => ({ ...current, placeOfDelivery: value }))} />
          <MultiSelectFilter disabled={loading || syncing} label="Area" options={filterOptions.areas} value={tableFilters.area ?? []} onChange={(value) => updateFilters((current) => ({ ...current, area: value }))} />
          <label className="filter-field">
            <span>Trading desde</span>
            <input disabled={loading || syncing} type="date" value={tableFilters.tradingDayFrom ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, tradingDayFrom: event.target.value || undefined }))} />
          </label>
          <label className="filter-field">
            <span>Trading hasta</span>
            <input disabled={loading || syncing} type="date" value={tableFilters.tradingDayTo ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, tradingDayTo: event.target.value || undefined }))} />
          </label>
          <label className="filter-field">
            <span>Entrega desde</span>
            <input disabled={loading || syncing} type="date" value={tableFilters.deliveryFrom ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, deliveryFrom: event.target.value || undefined }))} />
          </label>
          <label className="filter-field">
            <span>Entrega hasta</span>
            <input disabled={loading || syncing} type="date" value={tableFilters.deliveryTo ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, deliveryTo: event.target.value || undefined }))} />
          </label>
          <button className="secondary-button" disabled={loading || syncing} onClick={() => updateFilters(() => defaultFilters())} type="button">
            <RotateCcw size={16} />
            Limpiar
          </button>
        </div>
      </div>

      <div className="gas-mibgas-chart-grid">
        <div className="panel pricing-meff-panel">
          <PanelTitle icon={<BarChart3 size={18} />} title="Evolucion diaria GDAES_D+1" subtitle="Precio diario por fecha de entrega" />
          <div className="gas-mibgas-chart" aria-label="Grafico de evolucion diaria GDAES_D+1 por fecha de entrega">
            {dailyChartRows.some((row) => row.priceEurMwh !== null) ? <EChart height={360} option={dailyChartOption as EChartsOption} /> : <div className="empty-state">{loading ? "Cargando precios..." : "Sin precios GDAES_D+1 con valor para graficar."}</div>}
          </div>
        </div>
        <div className="panel pricing-meff-panel">
          <div className="gas-mibgas-forward-head">
            <PanelTitle icon={<BarChart3 size={18} />} title={`Historico ${forwardChartState.product || "producto"} ${selectedForwardContract?.label ?? ""}`.trim()} subtitle="Cotizacion por trading day" />
            <div className="gas-mibgas-forward-selectors">
              <label className="filter-field">
                <span>Producto</span>
                <select
                  disabled={loading || syncing || forwardLoading || !forwardProductOptions.length}
                  value={forwardChartState.product}
                  onChange={(event) => {
                    const product = event.target.value;
                    const contract = chooseDefaultForwardContract(buildForwardContracts(products, product));
                    setForwardChartState({ product, contractKey: contract?.key ?? "" });
                  }}
                >
                  {forwardProductOptions.map((product) => (
                    <option key={product} value={product}>{product}</option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Contrato</span>
                <select
                  disabled={loading || syncing || forwardLoading || !forwardContracts.length}
                  value={forwardChartState.contractKey}
                  onChange={(event) => setForwardChartState((current) => ({ ...current, contractKey: event.target.value }))}
                >
                  {forwardContracts.map((contract) => (
                    <option key={contract.key} value={contract.key}>{contract.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="gas-mibgas-chart" aria-label="Grafico historico de contrato forward MIBGAS por trading day">
            {forwardRows.some((row) => row.priceEurMwh !== null) ? <EChart height={360} option={forwardChartOption as EChartsOption} /> : <div className="empty-state">{forwardLoading ? "Cargando historico..." : "Sin precios con valor para el contrato seleccionado."}</div>}
          </div>
        </div>
      </div>

      <div className="panel wide pricing-meff-panel">
        <PanelTitle icon={<Download size={18} />} title="Precios MIBGAS" subtitle={`${formatNumber(toRow)} de ${formatNumber(total)} registros.`} />
        <div className="pricing-meff-table-scroll">
          <table className="pricing-meff-table gas-mibgas-table">
            <thead>
              <tr>
                <SortableHeader label="Trading day" sortKey="tradingDay" sort={sort} onSort={setSort} />
                <SortableHeader label="Producto" sortKey="product" sort={sort} onSort={setSort} />
                <SortableHeader label="Entrega" sortKey="placeOfDelivery" sort={sort} onSort={setSort} />
                <SortableHeader label="Area" sortKey="area" sort={sort} onSort={setSort} />
                <SortableHeader label="Inicio entrega" sortKey="firstDayDelivery" sort={sort} onSort={setSort} />
                <SortableHeader label="Fin entrega" sortKey="lastDayDelivery" sort={sort} onSort={setSort} />
                <th>Periodo</th>
                <SortableHeader className="number" label="Precio EUR/MWh" sortKey="priceEurMwh" sort={sort} onSort={setSort} />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.tradingDay)}</td>
                  <td title={productDescription(row.product, products)}>{row.product}</td>
                  <td>{row.placeOfDelivery}</td>
                  <td>{row.area}</td>
                  <td>{formatDate(row.firstDayDelivery)}</td>
                  <td>{formatDate(row.lastDayDelivery)}</td>
                  <td title={deliveryTitle(row)}>{row.deliveryPeriodLabel ?? "-"}</td>
                  <td className="number">{formatPrice(row.priceEurMwh)}</td>
                </tr>
              ))}
              {!sortedRows.length && (
                <tr>
                  <td colSpan={8} className="empty-cell">{loading ? "Cargando..." : "Sin registros MIBGAS para los filtros seleccionados."}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="gas-mibgas-pagination">
          <button className="secondary-button" disabled={loading || syncing || page === 0} onClick={() => setPage((current) => Math.max(current - 1, 0))} type="button">
            Anterior
          </button>
          <span>Pagina {formatNumber(total === 0 ? 0 : page + 1)} de {formatNumber(total === 0 ? 0 : pageCount)}</span>
          <button className="secondary-button" disabled={loading || syncing || page + 1 >= pageCount} onClick={() => setPage((current) => current + 1)} type="button">
            Siguiente
          </button>
          <label>
            Filas
            <select
              disabled={loading || syncing}
              value={pageSize}
              onChange={(event) => {
                setPage(0);
                setPageSize(Number(event.target.value));
              }}
            >
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <small>{fromRow}-{toRow}</small>
        </div>
      </div>

      <div className="panel wide pricing-meff-panel gas-mibgas-sync-panel">
        <PanelTitle icon={<History size={18} />} title="Ultimas sincronizaciones" subtitle="Auditoria de importaciones MIBGAS" />
        <div className="pricing-meff-table-scroll">
          <table className="pricing-meff-table gas-mibgas-runs-table">
            <thead>
              <tr>
                <th>Inicio</th>
                <th>Ano</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th className="number">Leidas</th>
                <th className="number">Insertadas</th>
                <th className="number">Actualizadas</th>
                <th className="number">Sin cambios</th>
                <th className="number">NULL</th>
                <th>Mensaje</th>
              </tr>
            </thead>
            <tbody>
              {syncRuns.map((run) => (
                <tr key={run.id}>
                  <td>{formatDateTime(run.startedAt)}</td>
                  <td>{run.year}</td>
                  <td>{run.runType}</td>
                  <td><span className={`gas-mibgas-run-status ${statusTone(run.status)}`}>{run.status}</span></td>
                  <td className="number">{formatNumber(run.rowsRead)}</td>
                  <td className="number">{formatNumber(run.insertedRows)}</td>
                  <td className="number">{formatNumber(run.updatedRows)}</td>
                  <td className="number">{formatNumber(run.unchangedRows)}</td>
                  <td className="number">{formatNumber(run.nullPriceRows)}</td>
                  <td title={run.errorMessage ?? ""}>{run.errorMessage ?? "-"}</td>
                </tr>
              ))}
              {!syncRuns.length && (
                <tr>
                  <td colSpan={10} className="empty-cell">Sin sincronizaciones registradas.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {historyModalOpen && (
        <HistoryImportModal
          disabled={syncing}
          result={historyResult}
          onClose={() => setHistoryModalOpen(false)}
          onSubmit={runHistoryImport}
        />
      )}
    </div>
  );
}

function StatusItem({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`gas-mibgas-status-item ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HistoryImportModal({
  disabled,
  onClose,
  onSubmit,
  result
}: {
  disabled: boolean;
  onClose: () => void;
  onSubmit: (fromYear: number, toYear: number) => Promise<void>;
  result?: GasMibgasSyncHistoryResponse;
}) {
  const [fromYear, setFromYear] = useState(String(Math.max(CURRENT_YEAR - 4, 2015)));
  const [toYear, setToYear] = useState(String(CURRENT_YEAR));
  const [error, setError] = useState<string>();

  async function submit() {
    const validation = validateYearRange(fromYear, toYear);
    if (validation.error) {
      setError(validation.error);
      return;
    }
    setError(undefined);
    await onSubmit(validation.fromYear, validation.toYear);
  }

  return (
    <div className="ops-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="ops-modal gas-mibgas-history-modal" role="dialog" aria-modal="true" aria-label="Importar historico MIBGAS" onMouseDown={(event) => event.stopPropagation()}>
        <div className="ops-modal-head">
          <strong>Importar historico MIBGAS</strong>
          <button aria-label="Cerrar" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>
        <div className="ops-modal-body">
          <div className="omie-toolbar compact gas-mibgas-history-form">
            <label className="filter-field">
              <span>Desde ano</span>
              <input disabled={disabled} inputMode="numeric" value={fromYear} onChange={(event) => setFromYear(event.target.value)} />
            </label>
            <label className="filter-field">
              <span>Hasta ano</span>
              <input disabled={disabled} inputMode="numeric" value={toYear} onChange={(event) => setToYear(event.target.value)} />
            </label>
            <button className="primary-button" disabled={disabled} onClick={() => void submit()} type="button">
              <RefreshCw size={16} />
              {disabled ? "Importando..." : "Importar"}
            </button>
          </div>
          {error && <div className="status-message error">{error}</div>}
          {result && (
            <div className="gas-mibgas-history-result">
              {result.results.map((item) => (
                <div className={`gas-mibgas-history-year ${statusTone(item.status)}`} key={item.year}>
                  <strong>{item.year}</strong>
                  <span>{item.status}</span>
                  <small>{item.status === "SUCCESS" ? `${formatNumber(item.inserted)} nuevos, ${formatNumber(item.updated)} actualizados, ${formatNumber(item.unchanged)} sin cambios` : item.errorMessage ?? "Error"}</small>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MultiSelectFilter({
  disabled,
  label,
  onChange,
  options,
  value
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string[] | undefined) => void;
  options: string[];
  value: string[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const normalizedOptions = useMemo(() => [...new Set(options.filter(Boolean))].sort((left, right) => left.localeCompare(right, "es", { numeric: true, sensitivity: "base" })), [options]);
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
      <button aria-expanded={open} aria-haspopup="listbox" className="searchable-select-trigger" disabled={disabled} onClick={() => setOpen((current) => !current)} type="button">
        <span className={selectedValues.length ? "" : "placeholder"}>{displayValue}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="searchable-select-popover pricing-multi-select-popover">
          <input autoFocus className="searchable-select-search" onChange={(event) => setSearch(event.target.value)} placeholder={`Buscar ${label.toLowerCase()}`} value={search} />
          <div className="searchable-select-options" role="listbox" aria-multiselectable="true">
            <button className={`searchable-select-option pricing-multi-select-option ${selectedValues.length ? "" : "active"}`} onClick={() => onChange(undefined)} role="option" type="button">
              <span>Todos</span>
            </button>
            {filteredOptions.map((option) => {
              const selected = selectedValues.includes(option);
              return (
                <button aria-selected={selected} className={`searchable-select-option pricing-multi-select-option ${selected ? "active" : ""}`} key={option} onClick={() => toggleOption(option)} role="option" type="button">
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

function SortableHeader({ className, label, onSort, sort, sortKey }: { className?: string; label: string; onSort: (sort: SortState) => void; sort: SortState; sortKey: SortKey }) {
  const active = sort.key === sortKey;
  return (
    <th className={className}>
      <button className="gas-mibgas-sort-button" onClick={() => onSort({ key: sortKey, direction: active && sort.direction === "asc" ? "desc" : "asc" })} type="button">
        {label}
        <span>{active ? (sort.direction === "asc" ? "ASC" : "DESC") : ""}</span>
      </button>
    </th>
  );
}

function defaultFilters(): GasMibgasFilters {
  return {};
}

function normalizeFilters(filters: GasMibgasFilters): GasMibgasFilters {
  return {
    tradingDayFrom: filters.tradingDayFrom || undefined,
    tradingDayTo: filters.tradingDayTo || undefined,
    deliveryFrom: filters.deliveryFrom || undefined,
    deliveryTo: filters.deliveryTo || undefined,
    product: normalizeSelection(filters.product),
    placeOfDelivery: normalizeSelection(filters.placeOfDelivery),
    area: normalizeSelection(filters.area)
  };
}

function normalizeSelection(value: string[] | undefined) {
  const normalized = value?.map((item) => item.trim()).filter(Boolean);
  return normalized?.length ? [...new Set(normalized)] : undefined;
}

function sortRows(rows: GasMibgasPriceRow[], sort: SortState) {
  return [...rows].sort((left, right) => {
    const direction = sort.direction === "asc" ? 1 : -1;
    return compareRowValue(left, right, sort.key) * direction;
  });
}

function compareRowValue(left: GasMibgasPriceRow, right: GasMibgasPriceRow, key: SortKey) {
  if (key === "priceEurMwh") {
    return (left.priceEurMwh ?? Number.NEGATIVE_INFINITY) - (right.priceEurMwh ?? Number.NEGATIVE_INFINITY);
  }
  return String(left[key] ?? "").localeCompare(String(right[key] ?? ""), "es", { numeric: true, sensitivity: "base" });
}

function buildDailyChartFilters(filters: GasMibgasFilters, product: string): GasMibgasFilters {
  return {
    tradingDayFrom: filters.tradingDayFrom,
    tradingDayTo: filters.tradingDayTo,
    deliveryFrom: filters.deliveryFrom,
    deliveryTo: filters.deliveryTo,
    placeOfDelivery: filters.placeOfDelivery,
    area: filters.area,
    product: [product]
  };
}

function buildMibgasDailyChartOption(rows: GasMibgasPriceRow[]) {
  const filtered = rows.filter((row) => row.product === SPOT_PRODUCT && row.priceEurMwh !== null);
  const byDeliveryDate = new Map<string, GasMibgasPriceRow>();
  for (const row of filtered) {
    const existing = byDeliveryDate.get(row.firstDayDelivery);
    if (!existing || row.tradingDay.localeCompare(existing.tradingDay) > 0) {
      byDeliveryDate.set(row.firstDayDelivery, row);
    }
  }
  const points = [...byDeliveryDate.values()].sort((left, right) => left.firstDayDelivery.localeCompare(right.firstDayDelivery));
  return {
    color: ["#17445c"],
    tooltip: {
      trigger: "axis",
      formatter: (items: Array<{ dataIndex: number }>) => {
        const point = points[items[0]?.dataIndex ?? 0];
        if (!point) {
          return "";
        }
        return [
          `<strong>Entrega ${formatDate(point.firstDayDelivery)}</strong>`,
          `Trading day: ${formatDate(point.tradingDay)}`,
          `Precio: ${formatPrice(point.priceEurMwh)} EUR/MWh`
        ].join("<br/>");
      }
    },
    grid: { left: 56, right: 24, top: 28, bottom: 48 },
    legend: { bottom: 0 },
    xAxis: {
      type: "category",
      name: "Fecha entrega",
      data: points.map((row) => formatDate(row.firstDayDelivery)),
      axisLabel: { hideOverlap: true }
    },
    yAxis: {
      type: "value",
      name: "EUR/MWh",
      axisLabel: { formatter: (value: number) => formatDecimalNumber(value, 0) }
    },
    series: [{
      type: "line",
      name: SPOT_PRODUCT,
      showSymbol: false,
      smooth: false,
      connectNulls: false,
      data: points.map((row) => row.priceEurMwh)
    }]
  };
}

function buildMibgasForwardChartOption(rows: GasMibgasPriceRow[], contract?: ForwardContract) {
  const points = [...rows].sort((left, right) => left.tradingDay.localeCompare(right.tradingDay));
  return {
    color: ["#256f68"],
    tooltip: {
      trigger: "axis",
      formatter: (items: Array<{ dataIndex: number }>) => {
        const point = points[items[0]?.dataIndex ?? 0];
        if (!point) {
          return "";
        }
        const label = contract?.label ?? point.deliveryPeriodLabel ?? deliveryTitle(point);
        return [
          `<strong>Trading day: ${formatDate(point.tradingDay)}</strong>`,
          `Producto: ${point.product}`,
          `Contrato: ${label}`,
          `Entrega: ${deliveryTitle(point)}`,
          `Punto: ${point.placeOfDelivery}`,
          `Area: ${point.area}`,
          `Precio: ${formatPrice(point.priceEurMwh)} EUR/MWh`
        ].join("<br/>");
      }
    },
    grid: { left: 56, right: 24, top: 28, bottom: 48 },
    legend: { bottom: 0 },
    xAxis: {
      type: "category",
      name: "Trading day",
      data: points.map((row) => formatDate(row.tradingDay)),
      axisLabel: { hideOverlap: true }
    },
    yAxis: {
      type: "value",
      name: "EUR/MWh",
      axisLabel: { formatter: (value: number) => formatDecimalNumber(value, 0) }
    },
    series: [{
      type: "line",
      name: contract ? `${contract.product} ${contract.label}` : "Historico forward",
      showSymbol: points.length <= 45,
      smooth: false,
      connectNulls: false,
      data: points.map((row) => row.priceEurMwh)
    }]
  };
}

function buildForwardProductOptions(products: GasMibgasProduct[]) {
  return [...new Set(products.map((item) => item.product).filter((product) => product && product !== SPOT_PRODUCT))]
    .sort((left, right) => left.localeCompare(right, "es", { numeric: true, sensitivity: "base" }));
}

function defaultForwardProduct(options: string[]) {
  return options.includes("GMAES") ? "GMAES" : options[0] ?? "";
}

function buildForwardContracts(products: GasMibgasProduct[], product: string): ForwardContract[] {
  const rows = products
    .filter((item) => item.product === product && item.product !== SPOT_PRODUCT)
    .sort((left, right) => {
      const deliveryCompare = left.firstDayDelivery.localeCompare(right.firstDayDelivery);
      if (deliveryCompare !== 0) {
        return deliveryCompare;
      }
      return `${left.placeOfDelivery}${left.area}${left.lastDayDelivery}`.localeCompare(`${right.placeOfDelivery}${right.area}${right.lastDayDelivery}`, "es", { numeric: true, sensitivity: "base" });
    });
  const labelCounts = rows.reduce((counts, item) => {
    const label = baseContractLabel(item);
    counts.set(label, (counts.get(label) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  return rows.map((item) => ({
      ...item,
      key: contractKey(item),
      label: contractLabel(item, labelCounts)
    }));
}

function chooseDefaultForwardContract(contracts: ForwardContract[]) {
  if (!contracts.length) {
    return undefined;
  }
  const today = new Date().toISOString().slice(0, 10);
  return contracts.find((contract) => contract.firstDayDelivery >= today) ?? contracts[contracts.length - 1];
}

function contractToHistoryFilters(contract: ForwardContract): GasMibgasHistoryFilters {
  return {
    product: contract.product,
    placeOfDelivery: contract.placeOfDelivery,
    area: contract.area,
    firstDayDelivery: contract.firstDayDelivery,
    lastDayDelivery: contract.lastDayDelivery
  };
}

function contractKey(contract: GasMibgasProduct) {
  return [contract.product, contract.placeOfDelivery, contract.area, contract.firstDayDelivery, contract.lastDayDelivery].join("|");
}

function contractLabel(contract: GasMibgasProduct, labelCounts = new Map<string, number>()) {
  const base = baseContractLabel(contract);
  return (labelCounts.get(base) ?? 0) > 1 ? `${base} · ${contract.placeOfDelivery}/${contract.area}` : base;
}

function baseContractLabel(contract: GasMibgasProduct) {
  return contract.deliveryPeriodLabel ?? deliveryTitle(contract);
}

function validateYearRange(fromText: string, toText: string): { fromYear: number; toYear: number; error?: undefined } | { fromYear: 0; toYear: 0; error: string } {
  const fromYear = Number(fromText);
  const toYear = Number(toText);
  if (!Number.isInteger(fromYear) || !Number.isInteger(toYear)) {
    return { fromYear: 0, toYear: 0, error: "Los anos deben ser enteros." };
  }
  if (fromYear > toYear) {
    return { fromYear: 0, toYear: 0, error: "Desde ano no puede ser posterior a Hasta ano." };
  }
  if (fromYear < 2015 || toYear - fromYear > 15) {
    return { fromYear: 0, toYear: 0, error: "Rango no razonable para importacion historica." };
  }
  if (toYear > CURRENT_YEAR) {
    return { fromYear: 0, toYear: 0, error: "No se permiten anos futuros." };
  }
  return { fromYear, toYear };
}

function syncMessage(result: GasMibgasSyncResponse): Message {
  if (result.status === "ERROR") {
    return { tone: "error", text: result.errorMessage ?? "La sincronizacion MIBGAS ha fallado." };
  }
  return {
    tone: result.status === "PARTIAL" ? "info" : "success",
    text: `MIBGAS ${result.year}: ${formatNumber(result.inserted)} insertados, ${formatNumber(result.updated)} actualizados, ${formatNumber(result.unchanged)} sin cambios, ${formatNumber(result.nullPrices)} NULL.`
  };
}

function productDescription(product: string, products: GasMibgasProduct[]) {
  const related = products.filter((item) => item.product === product).slice(0, 4);
  return related.length ? related.map((item) => `${item.placeOfDelivery}/${item.area} ${item.deliveryPeriodLabel ?? ""}`.trim()).join(" | ") : product;
}

function deliveryTitle(row: Pick<GasMibgasPriceRow, "firstDayDelivery" | "lastDayDelivery">) {
  return `${formatDate(row.firstDayDelivery)} - ${formatDate(row.lastDayDelivery)}`;
}

function statusTone(status?: string) {
  if (status === "SUCCESS") {
    return "success";
  }
  if (status === "ERROR") {
    return "error";
  }
  if (status === "PARTIAL") {
    return "info";
  }
  return "";
}

function formatDate(value?: string | null) {
  if (!value) {
    return "-";
  }
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatPrice(value: number | null) {
  return value === null || value === undefined || !Number.isFinite(value) ? "-" : formatDecimalNumber(value, 2);
}
