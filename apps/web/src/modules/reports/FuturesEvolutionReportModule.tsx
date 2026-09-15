import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, CalendarDays, LineChart, Zap } from "lucide-react";
import {
  getGasMibgasHistory,
  getGasMibgasProducts,
  getPricingMeff,
  getPricingMeffHistory,
  type GasMibgasHistoryFilters,
  type GasMibgasProduct,
  type PricingMeffRow
} from "../../api";
import { EChart, PanelTitle, formatDecimalNumber, formatFullDate } from "../shared/RestoredModuleCommon";

type MarketKey = "power" | "gas";
type ContractFamily = "month" | "quarter" | "year";
type Trend = "up" | "down" | "flat" | "none";
type Message = { tone: "error" | "info"; text: string };
type FeaturedContractSlot = "currentMonth" | "nextMonth" | "nextQuarter" | "nextYear";

type FuturesContract = {
  id: string;
  market: MarketKey;
  family: ContractFamily;
  sortKey: number;
  code: string;
  title: string;
  subtitle: string;
  unit: "EUR/MWh";
  meffCod?: string;
  meffRow?: PricingMeffRow;
  gasFilters?: GasMibgasHistoryFilters;
};

type HistoryPoint = {
  date: string;
  price: number | null;
};

type ContractHistory = {
  points: HistoryPoint[];
  latestPrice: number | null;
  latestDate: string | null;
  previousPrice: number | null;
};

type FeaturedContract = {
  slot: FeaturedContractSlot;
  label: string;
  contract: FuturesContract;
};

const MARKET_OPTIONS: Array<{ key: MarketKey; label: string; source: string }> = [
  { key: "power", label: "Electricidad", source: "MEFF" },
  { key: "gas", label: "Gas Natural", source: "MIBGAS" }
];
const FAMILY_LABELS: Record<ContractFamily, string> = {
  month: "Proximo Mes",
  quarter: "Proximo Trimestre",
  year: "Proximo Ano"
};
const FEATURED_LABELS: Record<FeaturedContractSlot, string> = {
  currentMonth: "Mes Actual",
  nextMonth: "Proximo Mes",
  nextQuarter: "Proximo Trimestre",
  nextYear: "Proximo Ano"
};
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TODAY_KEY = new Date().toISOString().slice(0, 10);
const MAX_SOURCE_ROWS = 10_000;
const DEFAULT_POWER_TYPE = "Futuro";
const DEFAULT_POWER_CLASS = "Base";

export function FuturesEvolutionReportModule() {
  const [market, setMarket] = useState<MarketKey>("power");
  const [powerFilters, setPowerFilters] = useState({ contractType: DEFAULT_POWER_TYPE, productClass: DEFAULT_POWER_CLASS });
  const [powerFilterOptions, setPowerFilterOptions] = useState({ contractTypes: [] as string[], productClasses: [] as string[] });
  const [meffRows, setMeffRows] = useState<PricingMeffRow[]>([]);
  const [gasProducts, setGasProducts] = useState<GasMibgasProduct[]>([]);
  const [anchorId, setAnchorId] = useState<string>("");
  const [viewedId, setViewedId] = useState<string>("");
  const [historyCache, setHistoryCache] = useState<Record<string, ContractHistory>>({});
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [message, setMessage] = useState<Message>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage(undefined);
    setAnchorId("");
    setViewedId("");
    setHistoryCache({});

    const load = market === "power"
      ? getPricingMeff({
          take: MAX_SOURCE_ROWS,
          tipo: powerFilters.productClass ? [powerFilters.productClass] : undefined,
          clase: powerFilters.contractType ? [powerFilters.contractType] : undefined
        })
      : getGasMibgasProducts();
    void load
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (market === "power") {
          const powerResult = result as Awaited<ReturnType<typeof getPricingMeff>>;
          setMeffRows(powerResult.rows);
          setPowerFilterOptions({
            contractTypes: mergeOption(powerResult.filterOptions.clases, powerFilters.contractType),
            productClasses: mergeOption(powerResult.filterOptions.tipos, powerFilters.productClass)
          });
          setGasProducts([]);
        } else {
          setGasProducts(result as GasMibgasProduct[]);
          setMeffRows([]);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando contratos de futuros." });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [market, powerFilters.contractType, powerFilters.productClass]);

  const contracts = useMemo(() => {
    const rows = market === "power" ? buildPowerContracts(meffRows) : buildGasContracts(gasProducts);
    return rows.sort(compareContracts);
  }, [gasProducts, market, meffRows]);

  const nextDefaults = useMemo(() => buildNextDefaultContracts(contracts), [contracts]);

  useEffect(() => {
    const defaultId = nextDefaults.find((item) => item.slot === "nextYear")?.contract.id ?? nextDefaults[0]?.contract.id ?? contracts[0]?.id ?? "";
    setAnchorId((current) => {
      if (current && contracts.some((contract) => contract.id === current)) {
        return current;
      }
      return defaultId;
    });
    setViewedId((current) => {
      if (current && contracts.some((contract) => contract.id === current)) {
        return current;
      }
      return defaultId;
    });
  }, [contracts, nextDefaults]);

  const anchor = useMemo(() => contracts.find((contract) => contract.id === anchorId) ?? nextDefaults.find((item) => item.slot === "nextYear")?.contract ?? nextDefaults[0]?.contract ?? contracts[0], [anchorId, contracts, nextDefaults]);
  const selected = useMemo(() => contracts.find((contract) => contract.id === viewedId) ?? anchor, [anchor, contracts, viewedId]);
  const followingContracts = useMemo(() => {
    if (!anchor) {
      return [];
    }
    return contracts.filter((contract) => contract.family === anchor.family && contract.sortKey > anchor.sortKey);
  }, [anchor, contracts]);
  const displayedContracts = useMemo(() => uniqueContracts([...nextDefaults.map((item) => item.contract), ...(anchor ? [anchor] : []), ...(selected ? [selected] : []), ...followingContracts.slice(0, 36)]), [anchor, followingContracts, nextDefaults, selected]);
  const selectedHistory = selected ? historyCache[selected.id] : undefined;
  const stats = useMemo(() => buildStats(selectedHistory?.points ?? []), [selectedHistory]);
  const chartOption = useMemo(() => buildFuturesChartOption(selected, selectedHistory?.points ?? []), [selected, selectedHistory]);

  useEffect(() => {
    const missing = displayedContracts.filter((contract) => !historyCache[contract.id]);
    if (!missing.length) {
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    void Promise.all(missing.map((contract) => loadContractHistory(contract).then((history) => [contract.id, history] as const)))
      .then((items) => {
        if (!cancelled) {
          setHistoryCache((current) => ({ ...current, ...Object.fromEntries(items) }));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando historicos de contratos." });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [displayedContracts, historyCache]);

  function selectAnchor(contractId: string) {
    setAnchorId(contractId);
    setViewedId(contractId);
  }

  return (
    <div className="omie-layout futures-report-module">
      <section className="panel wide futures-report-header">
        <div>
          <PanelTitle icon={<LineChart size={18} />} title="Informe de futuros" subtitle="Evolucion historica de contratos MEFF y MIBGAS" />
        </div>
        <div className="futures-market-switch" role="tablist" aria-label="Mercado">
          {MARKET_OPTIONS.map((item) => (
            <button
              aria-selected={market === item.key}
              className={market === item.key ? "active" : ""}
              key={item.key}
              onClick={() => setMarket(item.key)}
              role="tab"
              type="button"
            >
              <span>{item.label}</span>
              <small>{item.source}</small>
            </button>
          ))}
        </div>
      </section>

      {market === "power" && (
        <section className="panel wide futures-report-filters">
          <div className="omie-toolbar compact">
            <label className="filter-field">
              <span>Tipo</span>
              <select
                disabled={loading}
                value={powerFilters.contractType}
                onChange={(event) => setPowerFilters((current) => ({ ...current, contractType: event.target.value }))}
              >
                {powerFilterOptions.contractTypes.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Clase</span>
              <select
                disabled={loading}
                value={powerFilters.productClass}
                onChange={(event) => setPowerFilters((current) => ({ ...current, productClass: event.target.value }))}
              >
                {powerFilterOptions.productClasses.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          </div>
        </section>
      )}

      {message && <div className={`status-message ${message.tone}`}>{message.text}</div>}

      <section className="futures-report-grid">
        <aside className="panel futures-contract-panel">
          <PanelTitle icon={<CalendarDays size={18} />} title="Proximos contratos" subtitle={loading ? "Cargando..." : `${nextDefaults.length} contratos`} />
          <div className="futures-contract-list">
            {nextDefaults.map((item) => (
              <ContractButton
                contract={item.contract}
                history={historyCache[item.contract.id]}
                key={item.slot}
                labelOverride={item.label}
                selected={anchor?.id === item.contract.id}
                onSelect={selectAnchor}
              />
            ))}
            {!nextDefaults.length && <div className="empty-state">{loading ? "Cargando contratos..." : "Sin contratos disponibles."}</div>}
          </div>
        </aside>

        <main className="panel futures-chart-panel">
          <div className="futures-chart-head">
            <PanelTitle icon={market === "power" ? <Zap size={18} /> : <BarChart3 size={18} />} title={selected ? selected.title : "Sin contrato"} subtitle={selected?.subtitle} />
            <span className="futures-source-badge">{market === "power" ? "MEFF" : "MIBGAS"}</span>
          </div>
          <div className="futures-stat-grid">
            <StatBox label="Ultimo precio" value={formatUnitPrice(selectedHistory?.latestPrice)} />
            <StatBox label="Variacion diaria" value={formatSignedPrice(stats.dailyVariation)} tone={toneFromVariation(stats.dailyVariation)} />
            <StatBox label="Maximo" value={formatUnitPrice(stats.max)} />
            <StatBox label="Minimo" value={formatUnitPrice(stats.min)} />
          </div>
          <div className="futures-chart-surface">
            {selected && selectedHistory?.points.some((point) => point.price !== null) ? (
              <EChart height={430} option={chartOption as EChartsOption} />
            ) : (
              <div className="empty-state">{historyLoading ? "Cargando historico..." : "Sin historico con precio para el contrato seleccionado."}</div>
            )}
          </div>
        </main>

        <aside className="panel futures-contract-panel">
          <PanelTitle icon={<ArrowRight size={18} />} title="Contratos siguientes" subtitle={anchor ? familyTitle(anchor.family) : undefined} />
          <div className="futures-contract-list next">
            {followingContracts.map((contract) => (
              <ContractButton
                contract={contract}
                history={historyCache[contract.id]}
                key={contract.id}
                compact
                selected={selected?.id === contract.id}
                onSelect={setViewedId}
              />
            ))}
            {anchor && followingContracts.length === 0 && <div className="empty-state">Sin contratos posteriores de la misma familia.</div>}
          </div>
        </aside>
      </section>
    </div>
  );
}

function ContractButton({
  contract,
  compact = false,
  history,
  labelOverride,
  selected,
  onSelect
}: {
  contract: FuturesContract;
  compact?: boolean;
  history?: ContractHistory;
  labelOverride?: string;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const trend = trendFromHistory(history);
  return (
    <button className={`futures-contract-card ${selected ? "selected" : ""}`} onClick={() => onSelect(contract.id)} type="button">
      {!compact && <span className="futures-contract-meta">{labelOverride ?? FAMILY_LABELS[contract.family]}</span>}
      <span className="futures-contract-main">
        <strong>{contract.code}</strong>
        <span>{formatUnitPrice(history?.latestPrice)}</span>
      </span>
      <span className={`futures-trend ${trend}`}>
        <TrendIcon trend={trend} />
        {trendLabel(trend)}
      </span>
      <span className="futures-contract-date">{formatCompactDate(history?.latestDate)}</span>
    </button>
  );
}

function TrendIcon({ trend }: { trend: Trend }) {
  if (trend === "up") {
    return <ArrowUpRight size={15} />;
  }
  if (trend === "down") {
    return <ArrowDownRight size={15} />;
  }
  return <ArrowRight size={15} />;
}

function StatBox({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`futures-stat ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

async function loadContractHistory(contract: FuturesContract): Promise<ContractHistory> {
  if (contract.market === "power" && contract.meffCod) {
    const result = await getPricingMeffHistory(contract.meffCod);
    return toContractHistory(result.rows.map((row) => ({ date: row.fechaPublicacion, price: row.precio })));
  }
  if (contract.gasFilters) {
    const result = await getGasMibgasHistory(contract.gasFilters);
    return toContractHistory(result.rows.map((row) => ({ date: row.tradingDay, price: row.priceEurMwh })));
  }
  return toContractHistory([]);
}

function toContractHistory(points: HistoryPoint[]): ContractHistory {
  const sorted = [...points].sort((left, right) => left.date.localeCompare(right.date));
  const priced = sorted.filter((point) => point.price !== null && Number.isFinite(point.price));
  return {
    points: sorted,
    latestPrice: priced[priced.length - 1]?.price ?? null,
    latestDate: priced[priced.length - 1]?.date ?? null,
    previousPrice: priced[priced.length - 2]?.price ?? null
  };
}

function buildPowerContracts(rows: PricingMeffRow[]): FuturesContract[] {
  return rows.reduce<FuturesContract[]>((contracts, row) => {
    if (!isOneMwPerHourPowerContract(row)) {
      return contracts;
    }
    const family = classifyPowerFamily(row);
    const delivery = row.entrega ?? row.cod;
    if (!family) {
      return contracts;
    }
    const sortKey = deliverySortKey(delivery, family);
    if (!Number.isFinite(sortKey)) {
      return contracts;
    }
    const code = friendlyDeliveryCode(delivery, family);
    contracts.push({
        id: `power|${row.cod}`,
        market: "power" as const,
        family,
        sortKey,
        code,
        title: `Power Spain Base Load - ${code}`,
        subtitle: [row.tipo, row.clase, row.periodo].filter(Boolean).join(" - "),
        unit: "EUR/MWh" as const,
        meffCod: row.cod,
        meffRow: row
    });
    return contracts;
  }, []);
}

function isOneMwPerHourPowerContract(row: PricingMeffRow) {
  return row.cod.trim().toUpperCase().startsWith("FT");
}

function buildGasContracts(products: GasMibgasProduct[]): FuturesContract[] {
  return products.reduce<FuturesContract[]>((contracts, product) => {
    const family = classifyGasFamily(product);
    if (!family) {
      return contracts;
    }
    const sortKey = dateToSortKey(product.firstDayDelivery);
    if (!Number.isFinite(sortKey)) {
      return contracts;
    }
    const code = gasContractCode(product, family);
    contracts.push({
        id: `gas|${[product.product, product.placeOfDelivery, product.area, product.firstDayDelivery, product.lastDayDelivery].join("|")}`,
        market: "gas" as const,
        family,
        sortKey,
        code,
        title: `MIBGAS ${product.placeOfDelivery} - ${code}`,
        subtitle: [product.product, product.area].filter(Boolean).join(" - "),
        unit: "EUR/MWh" as const,
        gasFilters: {
          product: product.product,
          placeOfDelivery: product.placeOfDelivery,
          area: product.area,
          firstDayDelivery: product.firstDayDelivery,
          lastDayDelivery: product.lastDayDelivery
        }
    });
    return contracts;
  }, []);
}

function buildNextDefaultContracts(contracts: FuturesContract[]): FeaturedContract[] {
  const currentMonthKey = dateToSortKey(TODAY_KEY);
  const monthContracts = contracts.filter((contract) => contract.family === "month");
  const quarterContracts = contracts.filter((contract) => contract.family === "quarter");
  const yearContracts = contracts.filter((contract) => contract.family === "year");
  return [
    toFeaturedContract("currentMonth", monthContracts.find((contract) => contract.sortKey === currentMonthKey)),
    toFeaturedContract("nextMonth", monthContracts.find((contract) => contract.sortKey > currentMonthKey)),
    toFeaturedContract("nextQuarter", quarterContracts.find((contract) => contract.sortKey > currentMonthKey)),
    toFeaturedContract("nextYear", yearContracts.find((contract) => contract.sortKey > currentMonthKey))
  ].filter((item): item is FeaturedContract => Boolean(item));
}

function toFeaturedContract(slot: FeaturedContractSlot, contract: FuturesContract | undefined): FeaturedContract | undefined {
  return contract ? { slot, label: FEATURED_LABELS[slot], contract } : undefined;
}

function buildFuturesChartOption(contract: FuturesContract | undefined, rows: HistoryPoint[]) {
  const points = rows.filter((row) => row.price !== null && Number.isFinite(row.price)).sort((left, right) => left.date.localeCompare(right.date));
  return {
    color: ["#17445c"],
    tooltip: {
      trigger: "axis",
      confine: true,
      formatter: (items: Array<{ dataIndex: number }>) => {
        const point = points[items[0]?.dataIndex ?? 0];
        if (!point || !contract) {
          return "";
        }
        return [
          `Fecha: ${formatFullDate(point.date)}`,
          `Contrato: ${contract.code}`,
          `Precio: ${formatUnitPrice(point.price)}`
        ].join("<br/>");
      }
    },
    grid: { left: 64, right: 28, top: 28, bottom: points.length > 1 ? 70 : 36 },
    dataZoom: points.length > 18 ? [
      { type: "inside", filterMode: "none" },
      { type: "slider", height: 22, bottom: 18, filterMode: "none" }
    ] : undefined,
    xAxis: {
      type: "category",
      name: "Trading day",
      data: points.map((point) => formatFullDate(point.date)),
      axisLabel: { hideOverlap: true }
    },
    yAxis: {
      type: "value",
      name: "EUR/MWh",
      scale: true,
      axisLabel: { formatter: (value: number) => formatDecimalNumber(value, 0) }
    },
    series: [{
      type: "line",
      name: contract?.code ?? "Contrato",
      showSymbol: points.length <= 45,
      smooth: false,
      connectNulls: false,
      data: points.map((point) => point.price)
    }]
  };
}

function buildStats(points: HistoryPoint[]) {
  const prices = points.filter((point) => point.price !== null && Number.isFinite(point.price));
  const values = prices.map((point) => point.price as number);
  const latest = values[values.length - 1];
  const previous = values[values.length - 2];
  return {
    dailyVariation: latest === undefined || previous === undefined ? null : latest - previous,
    max: values.length ? Math.max(...values) : null,
    min: values.length ? Math.min(...values) : null
  };
}

function classifyPowerFamily(row: PricingMeffRow): ContractFamily | undefined {
  const text = `${row.periodo ?? ""} ${row.entrega ?? ""} ${row.cod}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (text.includes("trimestral") || /\bq[1-4][-\s/]?\d{2,4}\b/.test(text)) {
    return "quarter";
  }
  if (text.includes("anual") || /\b(?:yr|cal|year)[-\s/]?\d{2,4}\b/.test(text)) {
    return "year";
  }
  if (text.includes("mensual") || monthDeliveryMatch(text)) {
    return "month";
  }
  return undefined;
}

function classifyGasFamily(product: GasMibgasProduct): ContractFamily | undefined {
  const start = parseDate(product.firstDayDelivery);
  const end = parseDate(product.lastDayDelivery);
  if (!start || !end) {
    return undefined;
  }
  const months = monthSpan(start, end);
  if (months === 1) {
    return "month";
  }
  if (months === 3 && start.getUTCMonth() % 3 === 0) {
    return "quarter";
  }
  if (months === 12 && start.getUTCMonth() === 0) {
    return "year";
  }
  const text = `${product.product} ${product.deliveryPeriodLabel ?? ""}`.toLowerCase();
  if (/\bq[1-4]/.test(text)) {
    return "quarter";
  }
  if (/\b(?:yr|cal|year)/.test(text)) {
    return "year";
  }
  return undefined;
}

function friendlyDeliveryCode(value: string, family: ContractFamily) {
  const text = value.trim();
  const date = parseDate(text);
  if (date) {
    return codeFromDate(date, family);
  }
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const quarter = normalized.match(/\bq([1-4])[-\s/]?(\d{2,4})\b/i);
  if (quarter) {
    return `Q${quarter[1]}-${shortYear(quarter[2])}`;
  }
  const month = monthDeliveryMatch(normalized);
  if (month) {
    return `${MONTH_LABELS[month.month - 1]}-${shortYear(month.year)}`;
  }
  const year = normalized.match(/\b(?:yr|cal|year)?[-\s/]?(\d{2,4})\b$/i);
  if (year && family === "year") {
    return `YR-${shortYear(year[1])}`;
  }
  return text;
}

function gasContractCode(product: GasMibgasProduct, family: ContractFamily) {
  const label = product.deliveryPeriodLabel?.trim();
  if (label && /(?:q[1-4]|yr|cal|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|ene|abr|ago|dic)/i.test(label)) {
    return friendlyDeliveryCode(label, family);
  }
  const start = parseDate(product.firstDayDelivery);
  return start ? codeFromDate(start, family) : label || product.product;
}

function codeFromDate(date: Date, family: ContractFamily) {
  const year = String(date.getUTCFullYear()).slice(-2);
  if (family === "quarter") {
    return `Q${Math.floor(date.getUTCMonth() / 3) + 1}-${year}`;
  }
  if (family === "year") {
    return `YR-${year}`;
  }
  return `${MONTH_LABELS[date.getUTCMonth()]}-${year}`;
}

function deliverySortKey(value: string, family: ContractFamily) {
  const date = parseDate(value);
  if (date) {
    return dateToSortKey(value);
  }
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const quarter = normalized.match(/\bq([1-4])[-\s/]?(\d{2,4})\b/);
  if (quarter) {
    return sortYear(quarter[2]) * 100 + (Number(quarter[1]) - 1) * 3 + 1;
  }
  const month = monthDeliveryMatch(normalized);
  if (month) {
    return sortYear(month.year) * 100 + month.month;
  }
  const year = normalized.match(/\b(?:yr|cal|year)?[-\s/]?(\d{2,4})\b$/);
  if (year && family === "year") {
    return sortYear(year[1]) * 100 + 1;
  }
  return Number.POSITIVE_INFINITY;
}

function monthDeliveryMatch(value: string) {
  const match = value.toLowerCase().match(/\b(ene|jan|feb|mar|abr|apr|may|jun|jul|ago|aug|sep|oct|nov|dic|dec)[-\s/]?(\d{2,4})\b/);
  if (!match) {
    return undefined;
  }
  return { month: monthNumber(match[1]), year: match[2] };
}

function monthNumber(value: string) {
  const months: Record<string, number> = {
    ene: 1,
    jan: 1,
    feb: 2,
    mar: 3,
    abr: 4,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    ago: 8,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dic: 12,
    dec: 12
  };
  return months[value] ?? 99;
}

function sortYear(value: string) {
  const numeric = Number(value);
  return value.length === 2 ? 2000 + numeric : numeric;
}

function shortYear(value: string) {
  return String(sortYear(value)).slice(-2);
}

function dateToSortKey(value: string) {
  const parsed = parseDate(value);
  return parsed ? parsed.getUTCFullYear() * 100 + parsed.getUTCMonth() + 1 : Number.POSITIVE_INFINITY;
}

function parseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : undefined;
}

function monthSpan(start: Date, end: Date) {
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1;
}

function compareContracts(left: FuturesContract, right: FuturesContract) {
  return familyOrder(left.family) - familyOrder(right.family) || left.sortKey - right.sortKey || left.code.localeCompare(right.code, "es", { numeric: true, sensitivity: "base" });
}

function familyOrder(family: ContractFamily) {
  return family === "month" ? 1 : family === "quarter" ? 2 : 3;
}

function uniqueContracts(contracts: FuturesContract[]) {
  const seen = new Set<string>();
  return contracts.filter((contract) => {
    if (seen.has(contract.id)) {
      return false;
    }
    seen.add(contract.id);
    return true;
  });
}

function mergeOption(options: string[], selected: string) {
  return [...new Set([selected, ...options].filter(Boolean))].sort((left, right) => left.localeCompare(right, "es", { numeric: true, sensitivity: "base" }));
}

function trendFromHistory(history?: ContractHistory): Trend {
  if (!history || history.latestPrice === null || history.previousPrice === null) {
    return "none";
  }
  const diff = history.latestPrice - history.previousPrice;
  if (Math.abs(diff) < 0.000001) {
    return "flat";
  }
  return diff > 0 ? "up" : "down";
}

function trendLabel(trend: Trend) {
  if (trend === "up") {
    return "Sube";
  }
  if (trend === "down") {
    return "Baja";
  }
  if (trend === "flat") {
    return "Igual";
  }
  return "S/D";
}

function toneFromVariation(value: number | null) {
  if (value === null || Math.abs(value) < 0.000001) {
    return "";
  }
  return value > 0 ? "up" : "down";
}

function familyTitle(family: ContractFamily) {
  return family === "month" ? "Meses posteriores" : family === "quarter" ? "Trimestres posteriores" : "Anos posteriores";
}

function formatUnitPrice(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? "-" : `${formatDecimalNumber(value, 2)} EUR/MWh`;
}

function formatSignedPrice(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatDecimalNumber(value, 2)} EUR/MWh`;
}

function formatCompactDate(value: string | null | undefined) {
  return value ? formatFullDate(value) : "";
}
