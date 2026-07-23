import { useCallback, useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { ArrowLeft, BarChart3, Clipboard, Database, FileDown, RefreshCw, RotateCcw, Save, Settings, Trash2 } from "lucide-react";
import {
  calculatePricingPortfolioForecast,
  deleteMirContracts,
  getMirConfig,
  getMirContracts,
  getPricingPortfolioMonthlyConsumption,
  getPricingPortfolioMonthlySummary,
  getPricingPortfolioMonthlyValuation,
  getPricingPortfolioSalePrices,
  saveMirConfig,
  savePricingPortfolioSalePrices,
  syncMirContracts,
  type MirConfig,
  type MirConfigInput,
  type MirContract,
  type MirContractFilters,
  type MirContractsSummary,
  type PricingPortfolioMonthlyConsumptionRow,
  type PricingPortfolioMonthlySummaryResponse,
  type PricingPortfolioMonthlyValuationRow,
  type PricingPortfolioSalePriceMatrixRow
} from "../../api";
import { TechnicalDataTable } from "../../components/technical-data-table/TechnicalDataTable";
import { downloadBlob } from "../../components/technical-data-table/TechnicalDataTableHelpers";
import type { TechnicalColumn } from "../../components/technical-data-table/TechnicalDataTableTypes";
import { EChart, PanelTitle, formatCurrency, formatEnergy, formatFullDateTime, formatNumber } from "../shared/RestoredModuleCommon";

const DEFAULT_PAGE_SIZE = 100;
const FILTER_OPTION_PAGE_SIZE = 1000;
const SALE_PRICE_TARIFFS = ["3.0TD", "2.0TD", "6.1TD"] as const;
const SALE_PRICE_COLUMNS = [
  ...["P1", "P2", "P3", "P4", "P5", "P6"].map((period) => ({ tariff: "3.0TD", period })),
  ...["P1", "P2", "P3"].map((period) => ({ tariff: "2.0TD", period })),
  ...["P1", "P2", "P3", "P4", "P5", "P6"].map((period) => ({ tariff: "6.1TD", period }))
];
type MultiFilterKey = "policies" | "commercials" | "tariffs" | "priceLists";
type MirFilterOptions = Record<MultiFilterKey, string[]>;

export function MirPortfolioModule() {
  const [filters, setFilters] = useState<MirContractFilters>({});
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [rows, setRows] = useState<MirContract[]>([]);
  const [summary, setSummary] = useState<MirContractsSummary>(() => emptySummary());
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [calculatingForecast, setCalculatingForecast] = useState(false);
  const [referenceDate, setReferenceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saleSurchargeDraft, setSaleSurchargeDraft] = useState<Record<string, string>>({});
  const [selectedContract, setSelectedContract] = useState<MirContract | null>(null);
  const [monthlyRows, setMonthlyRows] = useState<PricingPortfolioMonthlyConsumptionRow[]>([]);
  const [monthlyValuationRows, setMonthlyValuationRows] = useState<PricingPortfolioMonthlyValuationRow[]>([]);
  const [monthlySummary, setMonthlySummary] = useState<PricingPortfolioMonthlySummaryResponse | null>(null);
  const [salePriceRows, setSalePriceRows] = useState<PricingPortfolioSalePriceMatrixRow[]>([]);
  const [salePriceDraft, setSalePriceDraft] = useState<Record<string, string>>({});
  const [newSalePriceYear, setNewSalePriceYear] = useState(() => String(new Date().getFullYear() + 1));
  const [newSalePriceMonth, setNewSalePriceMonth] = useState("1");
  const [savingSalePrices, setSavingSalePrices] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [config, setConfig] = useState<MirConfig>(() => emptyConfig());
  const [configDraft, setConfigDraft] = useState<MirConfigInput>(() => emptyConfigDraft());
  const [activeTab, setActiveTab] = useState<"contracts" | "salePrices">("contracts");
  const [detailTab, setDetailTab] = useState<"summary" | "consumption" | "valuation">("summary");
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string }>();
  const [filterOptions, setFilterOptions] = useState<MirFilterOptions>(() => emptyFilterOptions());

  const load = useCallback(async (nextFilters = filters, nextPage = page, nextPageSize = pageSize) => {
    setLoading(true);
    setMessage(undefined);
    try {
      const result = await getMirContracts({
        ...normalizeFilters(nextFilters),
        referenceDate,
        skip: nextPage * nextPageSize,
        take: nextPageSize
      });
      setRows(result.rows);
      setSummary(result.summary);
      setHasNext(result.hasNext);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error consultando cartera Fijo." });
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize, referenceDate]);

  useEffect(() => {
    const handle = window.setTimeout(() => void load(filters, page, pageSize), 250);
    return () => window.clearTimeout(handle);
  }, [filters, page, pageSize, load]);

  useEffect(() => {
    void loadConfig();
    void loadFilterOptions();
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => void loadMonthlySummary(), 250);
    return () => window.clearTimeout(handle);
  }, [filters, referenceDate]);

  useEffect(() => {
    void loadSalePrices();
  }, []);

  async function loadConfig() {
    try {
      const result = await getMirConfig();
      setConfig(result);
      setConfigDraft({
        apiUrl: result.apiUrl ?? "",
        contractsPath: result.contractsPath,
        username: result.username ?? "",
        password: "",
        timeoutMs: result.timeoutMs,
        retries: result.retries
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando configuración Fijo." });
    }
  }

  async function saveConfig() {
    setSavingConfig(true);
    setMessage(undefined);
    try {
      const result = await saveMirConfig({
        apiUrl: configDraft.apiUrl || null,
        contractsPath: configDraft.contractsPath || "/contracts",
        username: configDraft.username || null,
        password: configDraft.password === "" ? undefined : configDraft.password,
        timeoutMs: Number(configDraft.timeoutMs) || 60000,
        retries: Number(configDraft.retries) || 0
      });
      setConfig(result);
      setConfigDraft((current) => ({ ...current, password: "" }));
      setMessage({ tone: "success", text: "Configuración Fijo guardada." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error guardando configuración Fijo." });
    } finally {
      setSavingConfig(false);
    }
  }

  async function loadMonthlySummary() {
    try {
      const result = await getPricingPortfolioMonthlySummary(referenceDate, normalizeFilters(filters));
      setMonthlySummary(result);
    } catch {
      setMonthlySummary(null);
    }
  }

  async function loadFilterOptions() {
    try {
      const values = emptyFilterOptions();
      let skip = 0;
      let hasNextPage = true;
      while (hasNextPage) {
        const result = await getMirContracts({ skip, take: FILTER_OPTION_PAGE_SIZE });
        for (const row of result.rows) {
          addOption(values.policies, row.policyCode);
          addOption(values.commercials, row.commercialName);
          addOption(values.tariffs, row.tariffName);
          addOption(values.priceLists, row.priceListName);
        }
        hasNextPage = result.hasNext;
        skip += result.rows.length;
        if (result.rows.length === 0) {
          break;
        }
      }
      setFilterOptions({
        policies: values.policies.sort((left, right) => left.localeCompare(right, "es", { numeric: true })),
        commercials: values.commercials.sort((left, right) => left.localeCompare(right, "es", { numeric: true })),
        tariffs: values.tariffs.sort((left, right) => left.localeCompare(right, "es", { numeric: true })),
        priceLists: values.priceLists.sort((left, right) => left.localeCompare(right, "es", { numeric: true }))
      });
    } catch {
      setFilterOptions(emptyFilterOptions());
    }
  }

  async function loadSalePrices() {
    try {
      const result = await getPricingPortfolioSalePrices();
      setSalePriceRows(result.matrix);
      setSalePriceDraft(buildSalePriceDraft(result.matrix));
      setSaleSurchargeDraft(buildSaleSurchargeDraft(result.matrix));
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando precios de venta." });
    }
  }

  async function saveSalePrices() {
    setSavingSalePrices(true);
    setMessage(undefined);
    try {
      const rows = Object.entries(salePriceDraft).map(([key, value]) => {
        const [year, month, tariff, period] = key.split("|");
        return {
          year: Number(year),
          month: Number(month),
          tariff,
          period,
          priceEurMwh: parseEditableNumber(value)
        };
      });
      const surcharges = Object.entries(saleSurchargeDraft).map(([key, value]) => {
        const [year, month, tariff] = key.split("|");
        return {
          year: Number(year),
          month: Number(month),
          tariff,
          surchargeEurMwh: parseEditableNumber(value)
        };
      });
      const result = await savePricingPortfolioSalePrices(rows, surcharges);
      setMessage({ tone: "success", text: `Precios de venta guardados: ${formatNumber(result.updated)}. Recargos guardados: ${formatNumber(result.surchargesUpdated ?? 0)}.` });
      await loadSalePrices();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error guardando precios de venta." });
    } finally {
      setSavingSalePrices(false);
    }
  }

  function addSalePriceMonth() {
    setMessage(undefined);
    const year = Number(newSalePriceYear);
    const month = Number(newSalePriceMonth);
    if (!Number.isSafeInteger(year) || year < 2000 || year > 2100 || !Number.isSafeInteger(month) || month < 1 || month > 12) {
      setMessage({ tone: "error", text: "Informa un año y mes válidos." });
      return;
    }
    const exists = salePriceRows.some((row) => row.year === year && row.month === month);
    if (exists) {
      setMessage({ tone: "info", text: "Ese mes ya existe en la tabla." });
      return;
    }
    const row: PricingPortfolioSalePriceMatrixRow = {
      year,
      month,
      prices: Object.fromEntries(SALE_PRICE_COLUMNS.map((column) => [`${column.tariff}|${column.period}`, null])),
      surcharges: Object.fromEntries(SALE_PRICE_TARIFFS.map((tariff) => [tariff, null]))
    };
    setSalePriceRows((current) => [...current, row].sort((left, right) => left.year - right.year || left.month - right.month));
    setSalePriceDraft((current) => ({
      ...current,
      ...buildSalePriceDraft([row])
    }));
    setSaleSurchargeDraft((current) => ({
      ...current,
      ...buildSaleSurchargeDraft([row])
    }));
  }

  async function runSync() {
    setSyncing(true);
    setMessage(undefined);
    try {
      const result = await syncMirContracts();
      setMessage({
        tone: result.errors ? "info" : "success",
        text: `Pólizas recibidas: ${formatNumber(result.received)}. Nuevas: ${formatNumber(result.created)}. Actualizadas: ${formatNumber(result.updated)}. Errores: ${formatNumber(result.errors)}.`
      });
      setPage(0);
      await load(filters, 0, pageSize);
      await loadFilterOptions();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error sincronizando cartera Fijo." });
    } finally {
      setSyncing(false);
    }
  }

  async function clearContracts() {
    const confirmed = window.confirm("Esto eliminará todos los registros de Cartera Fijo guardados localmente. La configuración no se elimina. ¿Continuar?");
    if (!confirmed) {
      return;
    }
    setDeleting(true);
    setMessage(undefined);
    try {
      const result = await deleteMirContracts();
      setRows([]);
      setSummary(emptySummary());
      setPage(0);
      setHasNext(false);
      setMessage({ tone: "success", text: `Registros Fijo eliminados: ${formatNumber(result.deleted)}.` });
      await load(filters, 0, pageSize);
      await loadFilterOptions();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error eliminando cartera Fijo." });
    } finally {
      setDeleting(false);
    }
  }

  async function calculateForecast() {
    setCalculatingForecast(true);
    setMessage(undefined);
    try {
      const result = await calculatePricingPortfolioForecast(referenceDate);
      setMessage({
        tone: result.errors ? "info" : "success",
        text: `Previsión calculada: ${formatNumber(result.calculated)} contratos, ${formatNumber(result.expired)} expiradas, ${formatNumber(result.errors)} incidencias.`
      });
      if (selectedContract) {
        await loadMonthlyConsumption(selectedContract);
      }
      await loadMonthlySummary();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error calculando previsión de cartera." });
    } finally {
      setCalculatingForecast(false);
    }
  }

  async function loadMonthlyConsumption(contract: MirContract) {
    setSelectedContract(contract);
    setMessage(undefined);
    try {
      const [consumption, valuation] = await Promise.all([
        getPricingPortfolioMonthlyConsumption(contract.id, referenceDate),
        getPricingPortfolioMonthlyValuation(contract.id, referenceDate)
      ]);
      setMonthlyRows(consumption.rows);
      setMonthlyValuationRows(valuation.rows);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error consultando detalle mensual." });
      setMonthlyRows([]);
      setMonthlyValuationRows([]);
    }
  }

  const disabled = loading || syncing || savingConfig || deleting || calculatingForecast || savingSalePrices;

  const columns = useMemo<Array<TechnicalColumn<MirContract>>>(() => [
    { id: "policyCode", label: "Nº póliza", width: 130, sticky: true, filter: "text", type: "text", value: (row) => row.policyCode },
    { id: "commercialName", label: "Comercial", width: 300, filter: "text", type: "text", value: (row) => row.commercialName },
    { id: "tariffName", label: "Tarifa", width: 110, filter: "select", type: "text", value: (row) => row.tariffName },
    { id: "priceListName", label: "Lista de precios", width: 300, filter: "text", type: "text", value: (row) => row.priceListName },
    {
      id: "priceListPeriod",
      label: "Año/Mes precio",
      width: 135,
      filter: "text",
      type: "text",
      value: (row) => row.priceListPeriod,
      render: (row) => row.priceListPeriod ?? "-",
      cellTone: (row) => row.priceListParseStatus === "OK" ? "neutral" : "bad"
    },
    {
      id: "annualConsumption",
      label: "Consumo anual",
      width: 150,
      align: "right",
      filter: "number",
      type: "number",
      numericTone: "neutral",
      value: (row) => row.annualConsumption,
      render: (row) => formatEnergy(row.annualConsumption)
    },
    {
      id: "contractEndDate",
      label: "Fecha fin contrato",
      width: 155,
      filter: "text",
      type: "date",
      value: (row) => row.contractEndDate,
      render: (row) => formatDate(row.contractEndDate)
    },
    {
      id: "totalElevatedConsumptionKwh",
      label: "Consumo elevado",
      width: 165,
      align: "right",
      filter: "number",
      type: "number",
      numericTone: "neutral",
      value: (row) => row.totalElevatedConsumptionKwh,
      render: (row) => formatEnergy(row.totalElevatedConsumptionKwh)
    },
    {
      id: "totalEstimatedSaleAmountBcEur",
      label: "Venta estimada",
      width: 155,
      align: "right",
      filter: "number",
      type: "number",
      numericTone: "neutral",
      value: (row) => row.totalEstimatedSaleAmountBcEur,
      render: (row) => formatCurrency(row.totalEstimatedSaleAmountBcEur)
    },
    {
      id: "averageSalePriceEurMwh",
      label: "Precio Venta",
      width: 145,
      align: "right",
      filter: "number",
      type: "number",
      numericTone: "neutral",
      value: (row) => row.averageSalePriceEurMwh,
      render: (row) => formatEurMwh(row.averageSalePriceEurMwh)
    },
    {
      id: "totalEstimatedMeffSaleAmountEur",
      label: "Compra ref.",
      width: 155,
      align: "right",
      filter: "number",
      type: "number",
      numericTone: "neutral",
      value: (row) => row.totalEstimatedMeffSaleAmountEur,
      render: (row) => formatCurrency(row.totalEstimatedMeffSaleAmountEur)
    },
    {
      id: "averageMeffPriceEurMwh",
      label: "Precio compra",
      width: 145,
      align: "right",
      filter: "number",
      type: "number",
      numericTone: "neutral",
      value: (row) => row.averageMeffPriceEurMwh,
      render: (row) => formatEurMwh(row.averageMeffPriceEurMwh)
    },
    {
      id: "meffSpreadEur",
      label: "Dif. venta-compra",
      width: 160,
      align: "right",
      filter: "number",
      type: "number",
      numericTone: "neutral",
      value: (row) => row.meffSpreadEur,
      render: (row) => formatCurrency(row.meffSpreadEur),
      cellTone: (row) => row.meffSpreadEur === null ? "neutral" : row.meffSpreadEur >= 0 ? "good" : "bad"
    },
    {
      id: "meffSpreadEurMwh",
      label: "Dif. EUR/MWh BC",
      width: 160,
      align: "right",
      filter: "number",
      type: "number",
      numericTone: "neutral",
      value: (row) => row.meffSpreadEurMwh,
      render: (row) => formatEurMwh(row.meffSpreadEurMwh),
      cellTone: (row) => row.meffSpreadEurMwh === null ? "neutral" : row.meffSpreadEurMwh >= 0 ? "good" : "bad"
    },
    {
      id: "meffValuationStatus",
      label: "Origen compra",
      width: 155,
      filter: "select",
      type: "text",
      value: (row) => row.meffValuationStatus,
      render: (row) => formatPurchaseStatus(row.meffValuationStatus),
      cellTone: (row) => !row.meffValuationStatus || row.meffValuationStatus === "OK" || row.meffValuationStatus === "OK_OMIE" || row.meffValuationStatus === "OK_MIXTO" ? "good" : "bad"
    },
    {
      id: "salePriceStatus",
      label: "Estado precio",
      width: 155,
      filter: "select",
      type: "text",
      value: (row) => row.salePriceStatus,
      render: (row) => row.salePriceStatus ?? "-",
      cellTone: (row) => !row.salePriceStatus || row.salePriceStatus === "OK" ? "good" : "bad"
    },
    {
      id: "synchronizedAt",
      label: "Última sincronización",
      width: 190,
      filter: "text",
      type: "date",
      value: (row) => row.synchronizedAt,
      render: (row) => formatFullDateTime(row.synchronizedAt)
    },
    {
      id: "syncStatus",
      label: "Estado",
      width: 130,
      filter: "select",
      type: "text",
      value: (row) => row.syncStatus,
      cellTone: (row) => row.syncStatus === "OK" ? "good" : "neutral"
    }
  ], []);

  const normalizedFilters = normalizeFilters(filters);
  const monthlyPivotRows = useMemo(() => buildMonthlyPivotRows(monthlyRows), [monthlyRows]);
  const monthlyValuationByKey = useMemo(() => new Map(monthlyValuationRows.map((row) => [`${row.year}-${row.month}`, row])), [monthlyValuationRows]);
  const salePriceGroups = useMemo(() => salePriceTariffGroups(), []);
  const visiblePeriods = useMemo(() => periodsForTariff(selectedContract?.tariffName ?? null, monthlyRows), [selectedContract, monthlyRows]);
  const economicChartOption = useMemo<EChartsOption>(() => buildMonthlyEconomicChartOption(monthlySummary), [monthlySummary]);
  const summaryChartOption = useMemo<EChartsOption>(() => buildMonthlySummaryChartOption(monthlySummary), [monthlySummary]);
  const monthlyDetailTotals = useMemo(() => ({
    totalConsumption: monthlyPivotRows.reduce((sum, row) => sum + row.total, 0),
    totalElevatedConsumption: monthlyPivotRows.reduce((sum, row) => sum + row.totalElevated, 0),
    totalSaleAmountPf: monthlyPivotRows.reduce((sum, row) => sum + row.totalSaleAmountPf, 0),
    totalSaleAmountBc: monthlyPivotRows.reduce((sum, row) => sum + row.totalSaleAmountBc, 0),
    totalMeffSaleAmount: monthlyValuationRows.reduce((sum, row) => sum + (row.estimatedMeffSaleEur ?? 0), 0),
    totalMeffSpread: monthlyPivotRows.reduce((sum, row) => {
      const valuation = monthlyValuationByKey.get(`${row.year}-${row.month}`);
      return sum + (valuation?.estimatedMeffSaleEur === null || valuation?.estimatedMeffSaleEur === undefined ? 0 : row.totalSaleAmountBc - valuation.estimatedMeffSaleEur);
    }, 0)
  }), [monthlyPivotRows, monthlyValuationByKey, monthlyValuationRows]);
  const monthlyDetailPrice = monthlyDetailTotals.totalConsumption > 0
    ? monthlyDetailTotals.totalSaleAmountPf / (monthlyDetailTotals.totalConsumption / 1000)
    : null;
  const monthlyDetailMeffPrice = monthlyDetailTotals.totalElevatedConsumption > 0
    ? monthlyDetailTotals.totalMeffSaleAmount / (monthlyDetailTotals.totalElevatedConsumption / 1000)
    : null;
  const monthlyDetailMeffSpreadPrice = monthlyDetailTotals.totalElevatedConsumption > 0
    ? monthlyDetailTotals.totalMeffSpread / (monthlyDetailTotals.totalElevatedConsumption / 1000)
    : null;

  function closeMonthlyDetail() {
    setSelectedContract(null);
    setMonthlyRows([]);
    setMonthlyValuationRows([]);
    setDetailTab("summary");
  }

  function buildMonthlyDetailExportTable() {
    if (detailTab === "consumption") {
      return buildMonthlyConsumptionExportTable();
    }
    if (detailTab === "valuation") {
      return buildMonthlyValuationExportTable();
    }
    return buildMonthlySummaryExportTable();
  }

  function buildMonthlySummaryExportTable() {
    const headers = ["Año", "Mes", "Consumo contador", "Consumo BC", "Pérdidas", "% pérdidas", "Venta BC", "Compra ref.", "Pérdida/ganancia", "Dif. EUR/MWh BC", "Precio venta aplicado", "Precio compra"];
    const body = monthlyPivotRows.map((row) => {
      const valuation = monthlyValuationByKey.get(`${row.year}-${row.month}`);
      const meffSpread = calculateMeffSpread(row.totalSaleAmountBc, valuation?.estimatedMeffSaleEur ?? null);
      return [
        row.year,
        String(row.month).padStart(2, "0"),
        row.total,
        row.totalElevated,
        row.totalLosses,
        row.lossPercentage ?? "",
        row.totalSaleAmountBc,
        valuation?.estimatedMeffSaleEur ?? "",
        meffSpread ?? "",
        calculateMeffSpreadPrice(row.totalSaleAmountBc, valuation?.estimatedMeffSaleEur ?? null, valuation?.consumptionBcKwh ?? null) ?? "",
        row.total > 0 ? row.totalSaleAmountPf / (row.total / 1000) : "",
        valuation?.meffPriceEurMwh ?? ""
      ];
    });
    if (monthlyPivotRows.length > 0) {
      body.push([
        "Total previsto",
        "",
        monthlyDetailTotals.totalConsumption,
        monthlyDetailTotals.totalElevatedConsumption,
        monthlyPivotRows.reduce((sum, row) => sum + row.totalLosses, 0),
        weightedAverage(monthlyPivotRows.map((row) => ({ value: row.lossPercentage, weight: row.total }))) ?? "",
        monthlyDetailTotals.totalSaleAmountBc,
        monthlyDetailTotals.totalMeffSaleAmount,
        monthlyDetailTotals.totalMeffSpread,
        monthlyDetailMeffSpreadPrice ?? "",
        monthlyDetailPrice ?? "",
        monthlyDetailMeffPrice ?? ""
      ]);
    }
    return { headers, body };
  }

  function buildMonthlyConsumptionExportTable() {
    const headers = ["Año", "Mes"];
    for (const period of visiblePeriods) {
      headers.push(`${period} contador`, `${period} elevado`);
    }
    headers.push("Total contador", "Total elevado", "Pérdidas", "% pérdidas", "K medio", "Origen K");

    const body = monthlyPivotRows.map((row) => {
      const line: Array<string | number> = [row.year, String(row.month).padStart(2, "0")];
      for (const period of visiblePeriods) {
        line.push(
          row.periods[period]?.base ?? "",
          row.periods[period]?.elevated ?? ""
        );
      }
      line.push(
        row.total,
        row.totalElevated,
        row.totalLosses,
        row.lossPercentage ?? "",
        row.kFactor ?? "",
        row.kSourceLabel
      );
      return line;
    });

    if (monthlyPivotRows.length > 0) {
      const total: Array<string | number> = ["Total previsto", ""];
      for (const period of visiblePeriods) {
        total.push(
          monthlyPivotRows.reduce((sum, row) => sum + (row.periods[period]?.base ?? 0), 0),
          monthlyPivotRows.reduce((sum, row) => sum + (row.periods[period]?.elevated ?? 0), 0)
        );
      }
      total.push(
        monthlyPivotRows.reduce((sum, row) => sum + row.total, 0),
        monthlyPivotRows.reduce((sum, row) => sum + row.totalElevated, 0),
        monthlyPivotRows.reduce((sum, row) => sum + row.totalLosses, 0),
        weightedAverage(monthlyPivotRows.map((row) => ({ value: row.lossPercentage, weight: row.total }))) ?? "",
        weightedAverage(monthlyPivotRows.map((row) => ({ value: row.kFactor, weight: row.total }))) ?? "",
        ""
      );
      body.push(total);
    }

    return { headers, body };
  }

  function buildMonthlyValuationExportTable() {
    const headers = ["Año", "Mes"];
    for (const period of visiblePeriods) {
      headers.push(`${period} precio base`, `${period} recargo`, `${period} precio aplicado`, `${period} importe PF`, `${period} importe BC`);
    }
    headers.push("Venta PF", "Venta BC", "Compra consumo BC", "Precio compra", "Compra ref.", "Pérdida/ganancia", "Dif. EUR/MWh BC", "Publicación/origen", "Producto/origen", "Origen precio", "Estado compra");
    const body = monthlyPivotRows.map((row) => {
      const valuation = monthlyValuationByKey.get(`${row.year}-${row.month}`);
      const line: Array<string | number> = [row.year, String(row.month).padStart(2, "0")];
      for (const period of visiblePeriods) {
        line.push(
          row.periods[period]?.salePrice ?? "",
          row.periods[period]?.saleSurcharge ?? "",
          row.periods[period]?.appliedSalePrice ?? "",
          row.periods[period]?.saleAmountPf ?? "",
          row.periods[period]?.saleAmountBc ?? ""
        );
      }
      line.push(
        row.totalSaleAmountPf,
        row.totalSaleAmountBc,
        valuation?.consumptionBcKwh ?? "",
        valuation?.meffPriceEurMwh ?? "",
        valuation?.estimatedMeffSaleEur ?? "",
        calculateMeffSpread(row.totalSaleAmountBc, valuation?.estimatedMeffSaleEur ?? null) ?? "",
        calculateMeffSpreadPrice(row.totalSaleAmountBc, valuation?.estimatedMeffSaleEur ?? null, valuation?.consumptionBcKwh ?? null) ?? "",
        valuation?.meffPublicationDate ?? "",
        valuation?.meffProductCode ?? "",
        valuation?.meffPriceOrigin ?? "",
        valuation?.status ?? ""
      );
      return line;
    });
    if (monthlyPivotRows.length > 0) {
      const total: Array<string | number> = ["Total previsto", ""];
      for (const period of visiblePeriods) {
        total.push(
          "",
          "",
          "",
          monthlyPivotRows.reduce((sum, row) => sum + (row.periods[period]?.saleAmountPf ?? 0), 0),
          monthlyPivotRows.reduce((sum, row) => sum + (row.periods[period]?.saleAmountBc ?? 0), 0)
        );
      }
      total.push(
        monthlyDetailTotals.totalSaleAmountPf,
        monthlyDetailTotals.totalSaleAmountBc,
        monthlyValuationRows.reduce((sum, row) => sum + (row.consumptionBcKwh ?? 0), 0),
        monthlyDetailMeffPrice ?? "",
        monthlyDetailTotals.totalMeffSaleAmount,
        monthlyDetailTotals.totalMeffSpread,
        monthlyDetailMeffSpreadPrice ?? "",
        "",
        "",
        "",
        ""
      );
      body.push(total);
    }
    return { headers, body };
  }

  async function copyMonthlyDetail() {
    const table = buildMonthlyDetailExportTable();
    const text = [table.headers, ...table.body].map((line) => line.join("\t")).join("\n");
    await navigator.clipboard?.writeText(text);
    setMessage({ tone: "success", text: "Detalle copiado al portapapeles." });
  }

  function exportMonthlyDetailToExcel() {
    const table = buildMonthlyDetailExportTable();
    const html = `<table>${[table.headers, ...table.body]
      .map((line, index) => `<tr>${line.map((cell) => `<${index === 0 ? "th" : "td"}>${escapeHtml(String(cell ?? ""))}</${index === 0 ? "th" : "td"}>`).join("")}</tr>`)
      .join("")}</table>`;
    downloadBlob(`consumo-previsto-${selectedContract?.policyCode ?? "poliza"}.xls`, html, "application/vnd.ms-excel;charset=utf-8");
  }

  function renderMonthlyDetailTable() {
    if (detailTab === "consumption") {
      return renderMonthlyConsumptionTable();
    }
    if (detailTab === "valuation") {
      return renderMonthlyValuationTable();
    }
    return renderMonthlySummaryTable();
  }

  function renderMonthlySummaryTable() {
    return (
      <div className="pricing-meff-table-scroll">
        <table className="pricing-meff-table">
          <thead>
            <tr>
              <th>Año</th>
              <th>Mes</th>
              <th>Consumo contador</th>
              <th>Consumo BC</th>
              <th>Pérdidas</th>
              <th>% pérdidas</th>
              <th>Venta BC</th>
              <th>Compra ref.</th>
              <th>Pérdida/ganancia</th>
              <th>Dif. EUR/MWh BC</th>
              <th>Precio venta aplicado</th>
              <th>Precio compra</th>
            </tr>
          </thead>
          <tbody>
            {monthlyPivotRows.map((row) => {
              const valuation = monthlyValuationByKey.get(`${row.year}-${row.month}`);
              return (
                <tr key={`${row.year}-${row.month}`}>
                  <td>{row.year}</td>
                  <td>{String(row.month).padStart(2, "0")}</td>
                  <td className="number">{formatEnergy(row.total)}</td>
                  <td className="number">{formatEnergy(row.totalElevated)}</td>
                  <td className="number">{formatEnergy(row.totalLosses)}</td>
                  <td className="number">{formatPercent(row.lossPercentage)}</td>
                  <td className="number">{formatCurrency(row.totalSaleAmountBc)}</td>
                  <td className="number">{formatCurrency(valuation?.estimatedMeffSaleEur ?? null)}</td>
                  <td className="number">{formatCurrency(calculateMeffSpread(row.totalSaleAmountBc, valuation?.estimatedMeffSaleEur ?? null))}</td>
                  <td className="number">{formatEurMwh(calculateMeffSpreadPrice(row.totalSaleAmountBc, valuation?.estimatedMeffSaleEur ?? null, valuation?.consumptionBcKwh ?? null))}</td>
                  <td className="number">{formatEurMwh(row.total > 0 ? row.totalSaleAmountPf / (row.total / 1000) : null)}</td>
                  <td className="number">{formatEurMwh(valuation?.meffPriceEurMwh ?? null)}</td>
                </tr>
              );
            })}
            {monthlyPivotRows.length > 0 && (
              <tr>
                <td colSpan={2}><strong>Total previsto</strong></td>
                <td className="number"><strong>{formatEnergy(monthlyDetailTotals.totalConsumption)}</strong></td>
                <td className="number"><strong>{formatEnergy(monthlyDetailTotals.totalElevatedConsumption)}</strong></td>
                <td className="number"><strong>{formatEnergy(monthlyPivotRows.reduce((sum, row) => sum + row.totalLosses, 0))}</strong></td>
                <td className="number"><strong>{formatPercent(weightedAverage(monthlyPivotRows.map((row) => ({ value: row.lossPercentage, weight: row.total }))))}</strong></td>
                <td className="number"><strong>{formatCurrency(monthlyDetailTotals.totalSaleAmountBc)}</strong></td>
                <td className="number"><strong>{formatCurrency(monthlyDetailTotals.totalMeffSaleAmount)}</strong></td>
                <td className="number"><strong>{formatCurrency(monthlyDetailTotals.totalMeffSpread)}</strong></td>
                <td className="number"><strong>{formatEurMwh(monthlyDetailMeffSpreadPrice)}</strong></td>
                <td className="number"><strong>{formatEurMwh(monthlyDetailPrice)}</strong></td>
                <td className="number"><strong>{formatEurMwh(monthlyDetailMeffPrice)}</strong></td>
              </tr>
            )}
            {monthlyPivotRows.length === 0 && (
              <tr>
                <td className="empty-cell" colSpan={12}>Sin previsión calculada para esta póliza.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  function renderMonthlyConsumptionTable() {
    return (
      <div className="pricing-meff-table-scroll">
        <table className="pricing-meff-table">
          <thead>
            <tr>
              <th>Año</th>
              <th>Mes</th>
              {visiblePeriods.flatMap((period) => [
                <th key={`${period}-base`}>{period} contador</th>,
                <th key={`${period}-elevated`}>{period} BC</th>
              ])}
              <th>Total contador</th>
              <th>Total BC</th>
              <th>Pérdidas</th>
              <th>% pérdidas</th>
              <th>K medio</th>
              <th>Origen K</th>
            </tr>
          </thead>
          <tbody>
            {monthlyPivotRows.map((row) => (
              <tr key={`${row.year}-${row.month}`}>
                <td>{row.year}</td>
                <td>{String(row.month).padStart(2, "0")}</td>
                {visiblePeriods.flatMap((period) => [
                  <td className="number" key={`${period}-base`}>{formatEnergy(row.periods[period]?.base ?? null)}</td>,
                  <td className="number" key={`${period}-elevated`}>{formatEnergy(row.periods[period]?.elevated ?? null)}</td>
                ])}
                <td className="number">{formatEnergy(row.total)}</td>
                <td className="number">{formatEnergy(row.totalElevated)}</td>
                <td className="number">{formatEnergy(row.totalLosses)}</td>
                <td className="number">{formatPercent(row.lossPercentage)}</td>
                <td className="number">{formatDecimal(row.kFactor, 6)}</td>
                <td>{row.kSourceLabel}</td>
              </tr>
            ))}
            {monthlyPivotRows.length > 0 && (
              <tr>
                <td colSpan={2}><strong>Total previsto</strong></td>
                {visiblePeriods.flatMap((period) => [
                  <td className="number" key={`${period}-base`}><strong>{formatEnergy(monthlyPivotRows.reduce((sum, row) => sum + (row.periods[period]?.base ?? 0), 0))}</strong></td>,
                  <td className="number" key={`${period}-elevated`}><strong>{formatEnergy(monthlyPivotRows.reduce((sum, row) => sum + (row.periods[period]?.elevated ?? 0), 0))}</strong></td>
                ])}
                <td className="number"><strong>{formatEnergy(monthlyDetailTotals.totalConsumption)}</strong></td>
                <td className="number"><strong>{formatEnergy(monthlyDetailTotals.totalElevatedConsumption)}</strong></td>
                <td className="number"><strong>{formatEnergy(monthlyPivotRows.reduce((sum, row) => sum + row.totalLosses, 0))}</strong></td>
                <td className="number"><strong>{formatPercent(weightedAverage(monthlyPivotRows.map((row) => ({ value: row.lossPercentage, weight: row.total }))))}</strong></td>
                <td className="number"><strong>{formatDecimal(weightedAverage(monthlyPivotRows.map((row) => ({ value: row.kFactor, weight: row.total }))), 6)}</strong></td>
                <td></td>
              </tr>
            )}
            {monthlyPivotRows.length === 0 && (
              <tr>
                <td className="empty-cell" colSpan={(visiblePeriods.length * 2) + 8}>Sin previsión calculada para esta póliza.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  function renderMonthlyValuationTable() {
    return (
      <div className="pricing-meff-table-scroll">
        <table className="pricing-meff-table">
          <thead>
            <tr>
              <th>Año</th>
              <th>Mes</th>
              {visiblePeriods.flatMap((period) => [
                <th key={`${period}-base-price`}>{period} base</th>,
                <th key={`${period}-surcharge`}>{period} recargo</th>,
                <th key={`${period}-applied-price`}>{period} aplicado</th>,
                <th key={`${period}-amount-pf`}>{period} venta PF</th>,
                <th key={`${period}-amount-bc`}>{period} venta BC</th>
              ])}
              <th>Venta PF</th>
              <th>Venta BC</th>
              <th>MEFF consumo BC</th>
              <th>Precio compra</th>
              <th>Compra ref.</th>
              <th>Pérdida/ganancia</th>
              <th>Dif. EUR/MWh BC</th>
              <th>MEFF publicacion</th>
              <th>MEFF producto</th>
              <th>Origen precio</th>
              <th>Estado compra</th>
            </tr>
          </thead>
          <tbody>
            {monthlyPivotRows.map((row) => {
              const valuation = monthlyValuationByKey.get(`${row.year}-${row.month}`);
              return (
                <tr key={`${row.year}-${row.month}`}>
                  <td>{row.year}</td>
                  <td>{String(row.month).padStart(2, "0")}</td>
                  {visiblePeriods.flatMap((period) => [
                    <td className="number" key={`${period}-base-price`}>{formatEurMwh(row.periods[period]?.salePrice ?? null)}</td>,
                    <td className="number" key={`${period}-surcharge`}>{formatEurMwh(row.periods[period]?.saleSurcharge ?? null)}</td>,
                    <td className="number" key={`${period}-applied-price`}>{formatEurMwh(row.periods[period]?.appliedSalePrice ?? null)}</td>,
                    <td className="number" key={`${period}-amount-pf`}>{formatCurrency(row.periods[period]?.saleAmountPf ?? null)}</td>,
                    <td className="number" key={`${period}-amount-bc`}>{formatCurrency(row.periods[period]?.saleAmountBc ?? null)}</td>
                  ])}
                  <td className="number">{formatCurrency(row.totalSaleAmountPf)}</td>
                  <td className="number">{formatCurrency(row.totalSaleAmountBc)}</td>
                  <td className="number">{formatEnergy(valuation?.consumptionBcKwh ?? null)}</td>
                  <td className="number">{formatEurMwh(valuation?.meffPriceEurMwh ?? null)}</td>
                  <td className="number">{formatCurrency(valuation?.estimatedMeffSaleEur ?? null)}</td>
                  <td className="number">{formatCurrency(calculateMeffSpread(row.totalSaleAmountBc, valuation?.estimatedMeffSaleEur ?? null))}</td>
                  <td className="number">{formatEurMwh(calculateMeffSpreadPrice(row.totalSaleAmountBc, valuation?.estimatedMeffSaleEur ?? null, valuation?.consumptionBcKwh ?? null))}</td>
                  <td>{formatDate(valuation?.meffPublicationDate ?? null)}</td>
                  <td>{valuation?.meffProductCode ?? "-"}</td>
                  <td>{formatPurchaseOrigin(valuation?.meffPriceOrigin ?? null)}</td>
                  <td>{formatPurchaseStatus(valuation?.status ?? null)}</td>
                </tr>
              );
            })}
            {monthlyPivotRows.length > 0 && (
              <tr>
                <td colSpan={2}><strong>Total previsto</strong></td>
                {visiblePeriods.flatMap((period) => [
                  <td className="number" key={`${period}-base-price`}></td>,
                  <td className="number" key={`${period}-surcharge`}></td>,
                  <td className="number" key={`${period}-applied-price`}></td>,
                  <td className="number" key={`${period}-amount-pf`}><strong>{formatCurrency(monthlyPivotRows.reduce((sum, row) => sum + (row.periods[period]?.saleAmountPf ?? 0), 0))}</strong></td>,
                  <td className="number" key={`${period}-amount-bc`}><strong>{formatCurrency(monthlyPivotRows.reduce((sum, row) => sum + (row.periods[period]?.saleAmountBc ?? 0), 0))}</strong></td>
                ])}
                <td className="number"><strong>{formatCurrency(monthlyDetailTotals.totalSaleAmountPf)}</strong></td>
                <td className="number"><strong>{formatCurrency(monthlyDetailTotals.totalSaleAmountBc)}</strong></td>
                <td className="number"><strong>{formatEnergy(monthlyValuationRows.reduce((sum, row) => sum + (row.consumptionBcKwh ?? 0), 0))}</strong></td>
                <td className="number"><strong>{formatEurMwh(monthlyDetailMeffPrice)}</strong></td>
                <td className="number"><strong>{formatCurrency(monthlyDetailTotals.totalMeffSaleAmount)}</strong></td>
                <td className="number"><strong>{formatCurrency(monthlyDetailTotals.totalMeffSpread)}</strong></td>
                <td className="number"><strong>{formatEurMwh(monthlyDetailMeffSpreadPrice)}</strong></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
            )}
            {monthlyPivotRows.length === 0 && (
              <tr>
                <td className="empty-cell" colSpan={(visiblePeriods.length * 5) + 13}>Sin previsión calculada para esta póliza.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  if (selectedContract) {
    return (
      <div className="omie-layout omie-layout-a">
        <div className="panel wide omie-control-panel">
          <PanelTitle
            icon={<Database size={18} />}
            title="Detalle consumo previsto"
            subtitle={`${selectedContract.commercialName ?? "-"} · ${selectedContract.tariffName ?? "-"} · desde ${formatDate(referenceDate)}`}
          />
          <div className="omie-toolbar compact">
            <button className="secondary-button" onClick={closeMonthlyDetail} type="button">
              <ArrowLeft size={16} />
              Volver
            </button>
            <button className="secondary-button" disabled={monthlyPivotRows.length === 0} onClick={() => void copyMonthlyDetail()} type="button">
              <Clipboard size={16} />
              Copiar
            </button>
            <button className="secondary-button" disabled={monthlyPivotRows.length === 0} onClick={exportMonthlyDetailToExcel} type="button">
              <FileDown size={16} />
              Excel
            </button>
          </div>
        </div>

        {message && <div className={`status-message ${message.tone}`}>{message.text}</div>}

        <div className="panel wide pricing-meff-panel">
          <div className="technical-kpis">
            <div className="technical-kpi neutral">
              <span>Consumo total Contador</span>
              <strong>{formatEnergy(monthlyDetailTotals.totalConsumption)}</strong>
            </div>
            <div className="technical-kpi neutral">
              <span>Venta BC</span>
              <strong>{formatCurrency(monthlyDetailTotals.totalSaleAmountBc)}</strong>
            </div>
            <div className="technical-kpi neutral">
              <span>Compra ref.</span>
              <strong>{formatCurrency(monthlyDetailTotals.totalMeffSaleAmount)}</strong>
            </div>
            <div className="technical-kpi neutral">
              <span>Dif. venta-compra</span>
              <strong>{formatCurrency(monthlyDetailTotals.totalMeffSpread)}</strong>
              <small>{formatEurMwh(monthlyDetailMeffSpreadPrice)}</small>
            </div>
            <div className="technical-kpi neutral">
              <span>Precio venta aplicado</span>
              <strong>{formatEurMwh(monthlyDetailPrice)}</strong>
              <small>Venta PF / Consumo PF</small>
            </div>
            <div className="technical-kpi neutral">
              <span>Precio compra</span>
              <strong>{formatEurMwh(monthlyDetailMeffPrice)}</strong>
              <small>Compra ref. / Consumo BC</small>
            </div>
          </div>
          <div className="technical-mode" aria-label="Detalle de consumo previsto">
            <button aria-pressed={detailTab === "summary"} className={detailTab === "summary" ? "active" : ""} onClick={() => setDetailTab("summary")} type="button">
              Resumen
            </button>
            <button aria-pressed={detailTab === "consumption"} className={detailTab === "consumption" ? "active" : ""} onClick={() => setDetailTab("consumption")} type="button">
              Consumo
            </button>
            <button aria-pressed={detailTab === "valuation"} className={detailTab === "valuation" ? "active" : ""} onClick={() => setDetailTab("valuation")} type="button">
              Valoración
            </button>
          </div>
          {renderMonthlyDetailTable()}
        </div>
      </div>
    );
  }

  return (
    <div className="omie-layout omie-layout-a">
      <div className="panel wide omie-control-panel">
        <PanelTitle icon={<Database size={18} />} title="Cartera Fijo" subtitle="Pólizas sincronizadas de contratos fijos" />
        <div className="technical-meta-line mir-status-line">
          <span>Última sincronización: {summary.lastSynchronizedAt ? formatFullDateTime(summary.lastSynchronizedAt) : "Sin sincronizar"}</span>
          <span>Total pólizas: {formatNumber(summary.totalContracts)}</span>
          <span><Settings size={14} /> Configuración: {config.apiUrl ? "URL informada" : "Sin URL"}</span>
          <span>Autorización Basic: {config.passwordConfigured && config.username ? "configurada" : "pendiente"}</span>
        </div>
        <div className="omie-toolbar compact mir-action-toolbar" aria-label="Acciones principales de Cartera Fijo">
          <button className="primary-button" disabled={disabled} onClick={() => void runSync()} type="button">
            <RefreshCw size={16} />
            Sincronizar
          </button>
          <label className="filter-field">
            <span>Fecha referencia</span>
            <input disabled={disabled} type="date" value={referenceDate} onChange={(event) => setReferenceDate(event.target.value)} />
          </label>
          <button className="primary-button" disabled={disabled} onClick={() => void calculateForecast()} type="button">
            <RefreshCw size={16} />
            Calcular previsión
          </button>
          <button className="secondary-button danger-button" disabled={disabled} onClick={() => void clearContracts()} type="button">
            <Trash2 size={16} />
            Eliminar todo
          </button>
        </div>
        <div className="omie-toolbar compact mir-filter-toolbar" aria-label="Filtros generales de Cartera Fijo">
          <MultiSelectFilter
            disabled={disabled}
            label="Poliza"
            options={filterOptions.policies}
            value={splitMultiFilter(filters.policies)}
            onChange={(value) => updateMultiFilter(setFilters, setPage, "policies", value)}
          />
          <MultiSelectFilter
            disabled={disabled}
            label="Comercial"
            options={filterOptions.commercials}
            value={splitMultiFilter(filters.commercials)}
            onChange={(value) => updateMultiFilter(setFilters, setPage, "commercials", value)}
          />
          <MultiSelectFilter
            disabled={disabled}
            label="Tarifa"
            options={filterOptions.tariffs}
            value={splitMultiFilter(filters.tariffs)}
            onChange={(value) => updateMultiFilter(setFilters, setPage, "tariffs", value)}
          />
          <MultiSelectFilter
            disabled={disabled}
            label="Lista precios"
            options={filterOptions.priceLists}
            value={splitMultiFilter(filters.priceLists)}
            onChange={(value) => updateMultiFilter(setFilters, setPage, "priceLists", value)}
          />
          <label className="filter-field">
            <span>Fecha fin hasta</span>
            <input disabled={disabled} type="date" value={filters.contractEndDateTo ?? ""} onChange={(event) => updateFilter(setFilters, setPage, "contractEndDateTo", event.target.value)} />
          </label>
          <label className="filter-field short">
            <span>Consumo min</span>
            <input disabled={disabled} type="number" value={filters.minAnnualConsumption ?? ""} onChange={(event) => updateFilter(setFilters, setPage, "minAnnualConsumption", event.target.value)} />
          </label>
          <label className="filter-field short">
            <span>Consumo max</span>
            <input disabled={disabled} type="number" value={filters.maxAnnualConsumption ?? ""} onChange={(event) => updateFilter(setFilters, setPage, "maxAnnualConsumption", event.target.value)} />
          </label>
          <button className="secondary-button" disabled={disabled} onClick={() => { setFilters({}); setPage(0); }} type="button">
            <RotateCcw size={16} />
            Limpiar
          </button>
        </div>
        <details className="mir-config-details" open={!config.apiUrl || !config.passwordConfigured}>
          <summary>Configuración técnica Fijo</summary>
          <div className="omie-toolbar compact mir-config-toolbar">
            <label className="filter-field wide">
              <span>URL Fijo</span>
              <input
                disabled={disabled}
                placeholder="https://fijo/api"
                value={configDraft.apiUrl ?? ""}
                onChange={(event) => setConfigDraft((current) => ({ ...current, apiUrl: event.target.value }))}
              />
            </label>
            <label className="filter-field">
              <span>Ruta pólizas</span>
              <input
                disabled={disabled}
                placeholder="/contracts"
                value={configDraft.contractsPath ?? ""}
                onChange={(event) => setConfigDraft((current) => ({ ...current, contractsPath: event.target.value }))}
              />
            </label>
            <label className="filter-field">
              <span>Usuario</span>
              <input
                disabled={disabled}
                value={configDraft.username ?? ""}
                onChange={(event) => setConfigDraft((current) => ({ ...current, username: event.target.value }))}
              />
            </label>
            <label className="filter-field">
              <span>Contraseña</span>
              <input
                disabled={disabled}
                placeholder={config.passwordConfigured ? "Configurada" : ""}
                type="password"
                value={configDraft.password ?? ""}
                onChange={(event) => setConfigDraft((current) => ({ ...current, password: event.target.value }))}
              />
            </label>
            <label className="filter-field short">
              <span>Timeout ms</span>
              <input
                disabled={disabled}
                min={1000}
                type="number"
                value={configDraft.timeoutMs ?? 60000}
                onChange={(event) => setConfigDraft((current) => ({ ...current, timeoutMs: Number(event.target.value) }))}
              />
            </label>
            <label className="filter-field short">
              <span>Reintentos</span>
              <input
                disabled={disabled}
                min={0}
                type="number"
                value={configDraft.retries ?? 3}
                onChange={(event) => setConfigDraft((current) => ({ ...current, retries: Number(event.target.value) }))}
              />
            </label>
            <button className="secondary-button" disabled={disabled} onClick={() => void saveConfig()} type="button">
              <Save size={16} />
              Guardar
            </button>
          </div>
        </details>
      </div>

      {message && <div className={`status-message ${message.tone}`}>{message.text}</div>}

      <div className="panel wide omie-secondary-chart">
        <PanelTitle
          icon={<BarChart3 size={18} />}
          title="Venta estimada vs compra"
          subtitle={monthlySummary ? `${formatDate(monthlySummary.fechaDesde)} - ${formatDate(monthlySummary.fechaHasta)} · venta BC ${formatCurrency(monthlySummary.totalEstimatedSaleAmountBcEur)} · compra ref. ${formatCurrency(monthlySummary.totalEstimatedMeffSaleEur)} · pérdida/ganancia ${formatCurrency(monthlySummary.totalMeffSpreadEur)} · dif. ${formatEurMwh(monthlySummary.totalMeffSpreadEurMwh)}` : "Sin previsión calculada"}
        />
        <div className="technical-kpis">
          <div className="technical-kpi neutral">
            <span>Total pólizas</span>
            <strong>{formatNumber(summary.totalContracts)}</strong>
          </div>
          <div className="technical-kpi neutral">
            <span>Consumo elevado en MWh</span>
            <strong>{formatMwh(monthlySummary?.totalElevatedConsumptionKwh ?? null)}</strong>
          </div>
          <div className={`technical-kpi ${signedKpiTone(monthlySummary?.totalMeffSpreadEur ?? null)}`}>
            <span>Pérdida/ganancia</span>
            <strong>{formatCurrency(monthlySummary?.totalMeffSpreadEur ?? null)}</strong>
          </div>
          <div className="technical-kpi neutral">
            <span>Precio venta aplicado</span>
            <strong>{formatEurMwh(monthlySummary?.averageSalePriceEurMwh ?? null)}</strong>
          </div>
          <div className="technical-kpi neutral">
            <span>Precio compra</span>
            <strong>{formatEurMwh(monthlySummary?.averageMeffPriceEurMwh ?? null)}</strong>
          </div>
          <div className={`technical-kpi ${signedKpiTone(monthlySummary?.totalMeffSpreadEurMwh ?? null)}`}>
            <span>Dif EUR/MWh BC</span>
            <strong>{formatEurMwh(monthlySummary?.totalMeffSpreadEurMwh ?? null)}</strong>
          </div>
        </div>
        <EChart option={economicChartOption} height={300} />
      </div>

      <div className="panel wide omie-secondary-chart">
        <PanelTitle
          icon={<BarChart3 size={18} />}
          title="Consumo previsto cartera"
          subtitle={monthlySummary ? `${formatDate(monthlySummary.fechaDesde)} - ${formatDate(monthlySummary.fechaHasta)} · elevado ${formatEnergy(monthlySummary.totalElevatedConsumptionKwh)} · dif. ${formatEurMwh(monthlySummary.totalMeffSpreadEurMwh)}` : "Sin previsión calculada"}
        />
        <EChart option={summaryChartOption} height={300} />
      </div>

      <div className="panel wide pricing-meff-panel">
        <div className="technical-mode" aria-label="Vistas de Cartera Fijo">
          <button aria-pressed={activeTab === "contracts"} className={activeTab === "contracts" ? "active" : ""} onClick={() => setActiveTab("contracts")} type="button">
            Pólizas
          </button>
          <button aria-pressed={activeTab === "salePrices"} className={activeTab === "salePrices" ? "active" : ""} onClick={() => setActiveTab("salePrices")} type="button">
            Precios venta estimados
          </button>
        </div>
      </div>

      {activeTab === "contracts" && (
        <TechnicalDataTable
          title="Pólizas Fijo"
          rows={rows}
          columns={columns}
          kpis={[]}
          page={page}
          pageSize={pageSize}
          hasNext={hasNext}
          loading={disabled}
          onRowDoubleClick={(row) => void loadMonthlyConsumption(row)}
          onPageChange={setPage}
          onPageSizeChange={(value) => { setPageSize(value); setPage(0); }}
          getRowId={(row) => row.id}
          getRowQuality={(row) => row.validationErrors.length ? { tone: "warning", labels: row.validationErrors } : { tone: "ok", labels: [] }}
          getGroupLabel={() => ""}
          getDuplicateKey={(row) => String(row.mirContractId)}
          exportFileName="cartera-fijo"
          loadExportRows={async () => {
            const exportRows: MirContract[] = [];
            let skip = 0;
            const take = 1000;
            let hasNextPage = true;
            while (hasNextPage) {
              const result = await getMirContracts({ ...normalizedFilters, referenceDate, skip, take });
              exportRows.push(...result.rows);
              hasNextPage = result.hasNext;
              skip += result.rows.length;
              if (result.rows.length === 0) {
                break;
              }
            }
            return exportRows;
          }}
          getTotalsRow={(visibleRows) => ({
            policyCode: "Total",
            annualConsumption: formatEnergy(visibleRows.reduce((sum, row) => sum + (row.annualConsumption ?? 0), 0)),
            totalElevatedConsumptionKwh: formatEnergy(visibleRows.reduce((sum, row) => sum + (row.totalElevatedConsumptionKwh ?? 0), 0)),
            totalEstimatedSaleAmountBcEur: formatCurrency(visibleRows.reduce((sum, row) => sum + (row.totalEstimatedSaleAmountBcEur ?? 0), 0)),
            totalEstimatedMeffSaleAmountEur: formatCurrency(visibleRows.reduce((sum, row) => sum + (row.totalEstimatedMeffSaleAmountEur ?? 0), 0)),
            meffSpreadEur: formatCurrency(visibleRows.reduce((sum, row) => sum + (row.meffSpreadEur ?? 0), 0))
          })}
          showModeSelector={false}
        />
      )}

      {activeTab === "salePrices" && (
        <div className="panel wide pricing-calculator-panel">
          <div className="pricing-calculator-header">
            <PanelTitle
              icon={<Database size={18} />}
              title="Precios venta estimados"
              subtitle="Matriz editable EUR/MWh por año, mes, tarifa, recargo y periodo"
            />
            <div className="omie-toolbar compact">
              <label className="filter-field short">
                <span>Año</span>
                <input
                  disabled={disabled}
                  type="number"
                  value={newSalePriceYear}
                  onChange={(event) => setNewSalePriceYear(event.target.value)}
                />
              </label>
              <label className="filter-field short">
                <span>Mes</span>
                <input
                  disabled={disabled}
                  max={12}
                  min={1}
                  type="number"
                  value={newSalePriceMonth}
                  onChange={(event) => setNewSalePriceMonth(event.target.value)}
                />
              </label>
              <button className="secondary-button" disabled={disabled} onClick={addSalePriceMonth} type="button">
                Añadir mes
              </button>
              <button className="primary-button" disabled={disabled} onClick={() => void saveSalePrices()} type="button">
                <Save size={16} />
                Guardar precios
              </button>
            </div>
          </div>
          <div className="pricing-calculator-scroll">
            <table className="pricing-calculator-table mir-sale-prices-table">
              <thead>
                <tr>
                  <th className="pricing-calculator-sticky" rowSpan={2}>AÑO/MES</th>
                  {salePriceGroups.map((group, index) => (
                    <th
                      className={`pricing-calculator-tariff-head ${index > 0 ? "pricing-calculator-tariff-start" : ""} ${index < salePriceGroups.length - 1 ? "pricing-calculator-tariff-end" : ""}`}
                      colSpan={group.colSpan}
                      key={group.tariff}
                    >
                      {group.tariff}
                    </th>
                  ))}
                </tr>
                <tr>
                  {SALE_PRICE_TARIFFS.flatMap((tariff) => [
                    <th className="pricing-calculator-period-head pricing-calculator-tariff-start" key={`${tariff}-surcharge`}>Recargo</th>,
                    ...SALE_PRICE_COLUMNS.filter((column) => column.tariff === tariff).map((column) => (
                      <th className={`pricing-calculator-period-head ${salePriceTariffBoundaryClass(column)}`} key={salePriceColumnKey(column)}>{column.period}</th>
                    ))
                  ])}
                </tr>
              </thead>
              <tbody>
                {salePriceRows.map((row) => (
                  <tr className="pricing-calculator-row pricing-calculator-row--manual" key={`${row.year}-${row.month}`}>
                    <th className="pricing-calculator-sticky">
                      <span>{row.year}-{String(row.month).padStart(2, "0")}</span>
                    </th>
                    {SALE_PRICE_TARIFFS.flatMap((tariff) => {
                      const surchargeKey = saleSurchargeKey(row.year, row.month, tariff);
                      return [
                        <td className="pricing-calculator-manual-cell pricing-calculator-tariff-start" key={surchargeKey}>
                          <input
                            disabled={disabled}
                            inputMode="decimal"
                            title={`${row.year}-${String(row.month).padStart(2, "0")} ${tariff} recargo EUR/MWh`}
                            value={saleSurchargeDraft[surchargeKey] ?? ""}
                            onChange={(event) => setSaleSurchargeDraft((current) => ({ ...current, [surchargeKey]: event.target.value }))}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.currentTarget.blur();
                              }
                            }}
                          />
                        </td>,
                        ...SALE_PRICE_COLUMNS.filter((column) => column.tariff === tariff).map((column) => {
                          const key = salePriceKey(row.year, row.month, column.tariff, column.period);
                          return (
                            <td className={`pricing-calculator-manual-cell ${salePriceTariffBoundaryClass(column)}`} key={key}>
                              <input
                                disabled={disabled}
                                inputMode="decimal"
                                title={`${row.year}-${String(row.month).padStart(2, "0")} ${column.tariff} ${column.period} EUR/MWh`}
                                value={salePriceDraft[key] ?? ""}
                                onChange={(event) => setSalePriceDraft((current) => ({ ...current, [key]: event.target.value }))}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.currentTarget.blur();
                                  }
                                }}
                              />
                            </td>
                          );
                        })
                      ];
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function updateFilter(
  setFilters: (callback: (current: MirContractFilters) => MirContractFilters) => void,
  setPage: (page: number) => void,
  key: keyof MirContractFilters,
  value: string
) {
  setPage(0);
  setFilters((current) => ({ ...current, [key]: value || undefined }));
}

function updateMultiFilter(
  setFilters: (callback: (current: MirContractFilters) => MirContractFilters) => void,
  setPage: (page: number) => void,
  key: MultiFilterKey,
  values: string[]
) {
  setPage(0);
  setFilters((current) => ({ ...current, [key]: joinMultiFilter(values) || undefined }));
}

function normalizeFilters(filters: MirContractFilters): MirContractFilters {
  return {
    policy: filters.policy || undefined,
    policies: filters.policies || undefined,
    commercial: filters.commercial || undefined,
    commercials: filters.commercials || undefined,
    tariff: filters.tariff || undefined,
    tariffs: filters.tariffs || undefined,
    priceList: filters.priceList || undefined,
    priceLists: filters.priceLists || undefined,
    contractEndDateFrom: filters.contractEndDateFrom || undefined,
    contractEndDateTo: filters.contractEndDateTo || undefined,
    minAnnualConsumption: filters.minAnnualConsumption === "" ? undefined : filters.minAnnualConsumption,
    maxAnnualConsumption: filters.maxAnnualConsumption === "" ? undefined : filters.maxAnnualConsumption
  };
}

function emptySummary(): MirContractsSummary {
  return {
    totalContracts: 0,
    annualConsumptionTotal: null,
    distinctTariffs: 0,
    distinctPriceLists: 0,
    lastSynchronizedAt: null
  };
}

function emptyConfig(): MirConfig {
  return {
    apiUrl: null,
    contractsPath: "/contracts",
    username: null,
    passwordConfigured: false,
    timeoutMs: 60000,
    retries: 3,
    updatedAt: null
  };
}

function emptyConfigDraft(): MirConfigInput {
  return {
    apiUrl: "",
    contractsPath: "/contracts",
    username: "",
    password: "",
    timeoutMs: 60000,
    retries: 3
  };
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function buildSalePriceDraft(rows: PricingPortfolioSalePriceMatrixRow[]) {
  const draft: Record<string, string> = {};
  for (const row of rows) {
    for (const column of SALE_PRICE_COLUMNS) {
      const key = salePriceKey(row.year, row.month, column.tariff, column.period);
      const value = row.prices[`${column.tariff}|${column.period}`];
      draft[key] = value === null ? "" : String(value).replace(".", ",");
    }
  }
  return draft;
}

function buildSaleSurchargeDraft(rows: PricingPortfolioSalePriceMatrixRow[]) {
  const draft: Record<string, string> = {};
  for (const row of rows) {
    for (const tariff of SALE_PRICE_TARIFFS) {
      const key = saleSurchargeKey(row.year, row.month, tariff);
      const value = row.surcharges[tariff];
      draft[key] = value === null ? "" : String(value).replace(".", ",");
    }
  }
  return draft;
}

function salePriceKey(year: number, month: number, tariff: string, period: string) {
  return `${year}|${month}|${tariff}|${period}`;
}

function saleSurchargeKey(year: number, month: number, tariff: string) {
  return `${year}|${month}|${tariff}`;
}

function salePriceColumnKey(column: { tariff: string; period: string }) {
  return `${column.tariff}-${column.period}`;
}

function salePriceTariffGroups() {
  const groups: Array<{ tariff: string; colSpan: number }> = [];
  for (const tariff of SALE_PRICE_TARIFFS) {
    groups.push({ tariff, colSpan: SALE_PRICE_COLUMNS.filter((column) => column.tariff === tariff).length + 1 });
  }
  return groups;
}

function salePriceTariffBoundaryClass(column: { tariff: string; period: string }) {
  const index = SALE_PRICE_COLUMNS.findIndex((item) => item.tariff === column.tariff && item.period === column.period);
  const previous = index > 0 ? SALE_PRICE_COLUMNS[index - 1] : undefined;
  const next = index >= 0 && index < SALE_PRICE_COLUMNS.length - 1 ? SALE_PRICE_COLUMNS[index + 1] : undefined;
  return [
    previous && previous.tariff !== column.tariff ? "pricing-calculator-tariff-start" : "",
    next && next.tariff !== column.tariff ? "pricing-calculator-tariff-end" : ""
  ].filter(Boolean).join(" ");
}

function parseEditableNumber(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized.replace(",", "."));
  if (!Number.isFinite(parsed)) {
    throw new Error("Hay precios con formato no numérico.");
  }
  return parsed;
}

function periodsForTariff(tariff: string | null, rows: PricingPortfolioMonthlyConsumptionRow[]) {
  if (tariff === "2.0TD") {
    return ["P1", "P2", "P3"];
  }
  const fromRows = [...new Set(rows.map((row) => row.tariffPeriod))].sort();
  return fromRows.length ? fromRows : ["P1", "P2", "P3", "P4", "P5", "P6"];
}

function buildMonthlyPivotRows(rows: PricingPortfolioMonthlyConsumptionRow[]) {
  const byMonth = new Map<string, {
    year: number;
    month: number;
    periods: Record<string, { base: number; elevated: number; losses: number; saleAmountPf: number; saleAmountBc: number; salePrice: number | null; saleSurcharge: number | null; appliedSalePrice: number | null }>;
    total: number;
    totalElevated: number;
    totalLosses: number;
    totalSaleAmountPf: number;
    totalSaleAmountBc: number;
    lossWeightedSum: number;
    lossWeight: number;
    kWeightedSum: number;
    kWeight: number;
    kVersions: Set<string>;
    kSourceMonths: Set<string>;
    lossModes: Set<string>;
  }>();
  for (const row of rows) {
    const key = `${row.year}-${row.month}`;
    const current = byMonth.get(key) ?? {
      year: row.year,
      month: row.month,
      periods: {},
      total: 0,
      totalElevated: 0,
      totalLosses: 0,
      totalSaleAmountPf: 0,
      totalSaleAmountBc: 0,
      lossWeightedSum: 0,
      lossWeight: 0,
      kWeightedSum: 0,
      kWeight: 0,
      kVersions: new Set<string>(),
      kSourceMonths: new Set<string>(),
      lossModes: new Set<string>()
    };
    const base = row.consumptionKwh ?? 0;
    const elevated = row.elevatedConsumptionKwh ?? base;
    const losses = row.lossesKwh ?? Math.max(0, elevated - base);
    const saleAmountPf = row.estimatedSaleAmountEur ?? 0;
    const saleAmountBc = row.estimatedSaleAmountBcEur ?? 0;
    const period = current.periods[row.tariffPeriod] ?? {
      base: 0,
      elevated: 0,
      losses: 0,
      saleAmountPf: 0,
      saleAmountBc: 0,
      salePrice: row.salePriceEurMwh,
      saleSurcharge: row.saleSurchargeEurMwh,
      appliedSalePrice: row.appliedSalePriceEurMwh ?? row.salePriceEurMwh
    };
    period.base += base;
    period.elevated += elevated;
    period.losses += losses;
    period.saleAmountPf += saleAmountPf;
    period.saleAmountBc += saleAmountBc;
    period.salePrice = period.salePrice ?? row.salePriceEurMwh;
    period.saleSurcharge = period.saleSurcharge ?? row.saleSurchargeEurMwh;
    period.appliedSalePrice = period.appliedSalePrice ?? row.appliedSalePriceEurMwh ?? row.salePriceEurMwh;
    current.periods[row.tariffPeriod] = period;
    current.total += base;
    current.totalElevated += elevated;
    current.totalLosses += losses;
    current.totalSaleAmountPf += saleAmountPf;
    current.totalSaleAmountBc += saleAmountBc;
    if (row.lossPercentage !== null) {
      current.lossWeightedSum += row.lossPercentage * base;
      current.lossWeight += base;
    }
    if (row.kFactor !== null) {
      current.kWeightedSum += row.kFactor * base;
      current.kWeight += base;
    }
    if (row.kFactorVersion) {
      current.kVersions.add(row.kFactorVersion);
    }
    if (row.kFactorSourceMonth) {
      current.kSourceMonths.add(row.kFactorSourceMonth);
    }
    if (row.lossMode) {
      current.lossModes.add(row.lossMode);
    }
    byMonth.set(key, current);
  }
  return [...byMonth.values()]
    .map((row) => ({
      ...row,
      lossPercentage: row.lossWeight > 0 ? row.lossWeightedSum / row.lossWeight : null,
      kFactor: row.kWeight > 0 ? row.kWeightedSum / row.kWeight : null,
      kSourceLabel: buildKSourceLabel(row.lossModes, row.kVersions, row.kSourceMonths)
    }))
    .sort((left, right) => left.year - right.year || left.month - right.month);
}

function buildKSourceLabel(lossModes: Set<string>, versions: Set<string>, sourceMonths: Set<string>) {
  const mode = [...lossModes].sort().join(", ");
  if (!mode) {
    return "-";
  }
  const versionLabel = [...versions].sort().join(", ");
  const monthLabel = [...sourceMonths].sort().join(", ");
  return [mode, versionLabel, monthLabel].filter(Boolean).join(" · ");
}

function weightedAverage(rows: Array<{ value: number | null; weight: number }>) {
  const valid = rows.filter((row) => row.value !== null && row.weight > 0);
  const weight = valid.reduce((sum, row) => sum + row.weight, 0);
  return weight > 0 ? valid.reduce((sum, row) => sum + (row.value ?? 0) * row.weight, 0) / weight : null;
}

function formatPercent(value: number | null) {
  return value === null ? "-" : `${formatNumber(value)} %`;
}

function formatDecimal(value: number | null, decimals: number) {
  return value === null ? "-" : value.toLocaleString("es-ES", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatEurMwh(value: number | null) {
  return value === null ? "-" : `${formatNumber(value)} EUR/MWh`;
}

function formatMwh(valueKwh: number | null) {
  return valueKwh === null ? "-" : `${formatNumber(valueKwh / 1000)} MWh`;
}

function formatPurchaseStatus(value: string | null) {
  if (value === "OK_OMIE") return "OMIE real";
  if (value === "OK_MIXTO") return "OMIE/MEFF";
  if (value === "OK") return "MEFF";
  if (value === "SIN_MEFF") return "Sin precio";
  if (value === "SIN_CONSUMO_BC") return "Sin consumo BC";
  return value ?? "-";
}

function formatPurchaseOrigin(value: string | null) {
  if (value === "OMIE_REAL") return "OMIE real";
  return value ?? "-";
}

function formatChartNumberLabel(value: unknown, decimals = 0) {
  const numeric = Array.isArray(value) ? Number(value[1]) : Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString("es-ES", { maximumFractionDigits: decimals }) : "";
}

function signedKpiTone(value: number | null) {
  if (value === null) {
    return "neutral";
  }
  return value < 0 ? "danger signed" : "good signed";
}

function calculateMeffSpread(saleAmountBc: number, meffAmount: number | null) {
  return meffAmount === null ? null : saleAmountBc - meffAmount;
}

function calculateMeffSpreadPrice(saleAmountBc: number, meffAmount: number | null, consumptionBcKwh: number | null) {
  const spread = calculateMeffSpread(saleAmountBc, meffAmount);
  return spread === null || !consumptionBcKwh || consumptionBcKwh <= 0 ? null : spread / (consumptionBcKwh / 1000);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[char] ?? char);
}

function buildMonthlyEconomicChartOption(summary: PricingPortfolioMonthlySummaryResponse | null): EChartsOption {
  const rows = summary?.months ?? [];
  return {
    grid: { left: 64, right: 82, top: 54, bottom: 42 },
    legend: {
      top: 0,
      textStyle: { color: "#475569" }
    },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const items = Array.isArray(params) ? params : [params];
        const firstItem = items[0] as { axisValueLabel?: string; name?: string } | undefined;
        const title = firstItem?.axisValueLabel ?? firstItem?.name ?? "";
        const lines = items.map((item) => {
          const value = Array.isArray(item.value) ? item.value[1] : item.value;
          const numeric = typeof value === "number" ? value : Number(value);
          const marker = typeof item.marker === "string" ? item.marker : "";
          const suffix = item.seriesName === "Precio venta aplicado" || item.seriesName === "Precio compra" ? " EUR/MWh" : " EUR";
          return `${marker}${item.seriesName}: ${Number.isFinite(numeric) ? formatNumber(numeric) : "-"}${suffix}`;
        });
        return [title, ...lines].join("<br/>");
      }
    },
    xAxis: {
      type: "category",
      data: rows.map((row) => row.label),
      axisLabel: { color: "#64748b" },
      axisLine: { lineStyle: { color: "#cbd5e1" } },
      axisTick: { show: false }
    },
    yAxis: [
      {
        type: "value",
        name: "EUR",
        nameTextStyle: { color: "#64748b" },
        axisLabel: {
          color: "#64748b",
          formatter: (value: number) => formatNumber(value)
        },
        splitLine: { lineStyle: { color: "#e2e8f0" } }
      },
      {
        type: "value",
        name: "EUR/MWh",
        nameTextStyle: { color: "#7c3aed" },
        axisLabel: {
          color: "#7c3aed",
          formatter: (value: number) => formatNumber(value)
        },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: "Venta estimada",
        type: "bar",
        yAxisIndex: 0,
        data: rows.map((row) => Number(row.estimatedSaleAmountBcEur.toFixed(2))),
        barMaxWidth: 24,
        itemStyle: { color: "#2563eb", borderRadius: [4, 4, 0, 0] },
        emphasis: { itemStyle: { color: "#1d4ed8" } }
      },
      {
        name: "Compra ref.",
        type: "bar",
        yAxisIndex: 0,
        data: rows.map((row) => Number(row.estimatedMeffSaleEur.toFixed(2))),
        barMaxWidth: 24,
        itemStyle: { color: "#ea580c", borderRadius: [4, 4, 0, 0] },
        emphasis: { itemStyle: { color: "#c2410c" } }
      },
      {
        name: "Pérdida/ganancia",
        type: "bar",
        yAxisIndex: 0,
        data: rows.map((row) => Number(row.meffSpreadEur.toFixed(2))),
        barMaxWidth: 24,
        itemStyle: {
          color: (params: { value?: unknown }) => Number(params.value) < 0 ? "#dc2626" : "#16a34a",
          borderRadius: [4, 4, 0, 0]
        },
        label: {
          show: true,
          position: "top",
          distance: 6,
          color: "#1f2937",
          fontSize: 11,
          fontWeight: 800,
          formatter: (params: { value?: unknown }) => `${formatChartNumberLabel(params.value)} EUR`
        },
        emphasis: { itemStyle: { color: "#15803d" } }
      },
      {
        name: "Precio venta aplicado",
        type: "line",
        yAxisIndex: 1,
        data: rows.map((row) => row.averageSalePriceEurMwh === null ? null : Number(row.averageSalePriceEurMwh.toFixed(3))),
        connectNulls: false,
        smooth: true,
        symbolSize: 7,
        lineStyle: { color: "#7c3aed", width: 3 },
        itemStyle: { color: "#7c3aed" }
      },
      {
        name: "Precio compra",
        type: "line",
        yAxisIndex: 1,
        data: rows.map((row) => row.averageMeffPriceEurMwh === null ? null : Number(row.averageMeffPriceEurMwh.toFixed(3))),
        connectNulls: false,
        smooth: true,
        symbolSize: 7,
        lineStyle: { color: "#0f766e", width: 3 },
        itemStyle: { color: "#0f766e" }
      }
    ]
  };
}

function MultiSelectFilter({
  disabled,
  label,
  options,
  value,
  onChange
}: {
  disabled: boolean;
  label: string;
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const selected = new Set(value);
  const filteredOptions = options.filter((option) => option.toLowerCase().includes(search.trim().toLowerCase()));
  const text = value.length === 0 ? "Todas" : value.length === 1 ? value[0] : `${value.length} seleccionadas`;

  function toggle(option: string) {
    const next = selected.has(option) ? value.filter((item) => item !== option) : [...value, option];
    onChange(next);
  }

  return (
    <details className="mir-multi-filter filter-field">
      <summary aria-disabled={disabled}>
        <span>{label}</span>
        <strong title={text}>{text}</strong>
      </summary>
      <div className="mir-multi-filter-menu">
        <input
          disabled={disabled}
          placeholder="Buscar..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="mir-multi-filter-actions">
          <button disabled={disabled || value.length === 0} onClick={() => onChange([])} type="button">Todas</button>
          <button disabled={disabled || filteredOptions.length === 0} onClick={() => onChange(filteredOptions)} type="button">Seleccionar visibles</button>
        </div>
        <div className="mir-multi-filter-options">
          {filteredOptions.map((option) => (
            <label key={option}>
              <input
                checked={selected.has(option)}
                disabled={disabled}
                type="checkbox"
                onChange={() => toggle(option)}
              />
              <span title={option}>{option}</span>
            </label>
          ))}
          {filteredOptions.length === 0 && <div className="mir-multi-filter-empty">Sin opciones</div>}
        </div>
      </div>
    </details>
  );
}

function emptyFilterOptions(): MirFilterOptions {
  return {
    policies: [],
    commercials: [],
    tariffs: [],
    priceLists: []
  };
}

function addOption(options: string[], value: string | null | undefined) {
  const text = value?.trim();
  if (text && !options.includes(text)) {
    options.push(text);
  }
}

function splitMultiFilter(value?: string) {
  return value?.split("|").map((item) => item.trim()).filter(Boolean) ?? [];
}

function joinMultiFilter(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].join("|");
}

function buildMonthlySummaryChartOption(summary: PricingPortfolioMonthlySummaryResponse | null): EChartsOption {
  const rows = summary?.months ?? [];
  const max = Math.max(...rows.map((row) => row.elevatedConsumptionKwh), 0);
  const divisor = max >= 1000 ? 1000 : 1;
  const unit = divisor === 1000 ? "MWh" : "kWh";
  return {
    grid: { left: 56, right: 88, top: 54, bottom: 42 },
    legend: {
      top: 0,
      textStyle: { color: "#475569" }
    },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const items = Array.isArray(params) ? params : [params];
        const firstItem = items[0] as { axisValueLabel?: string; name?: string } | undefined;
        const title = firstItem?.axisValueLabel ?? firstItem?.name ?? "";
        const lines = items.map((item) => {
          const value = Array.isArray(item.value) ? item.value[1] : item.value;
          const numeric = typeof value === "number" ? value : Number(value);
          const marker = typeof item.marker === "string" ? item.marker : "";
          const suffix = item.seriesName === "Dif. EUR/MWh BC" ? " EUR/MWh" : ` ${unit}`;
          return `${marker}${item.seriesName}: ${Number.isFinite(numeric) ? formatNumber(numeric) : "-"}${suffix}`;
        });
        return [title, ...lines].join("<br/>");
      }
    },
    xAxis: {
      type: "category",
      data: rows.map((row) => row.label),
      axisLabel: { color: "#64748b" },
      axisLine: { lineStyle: { color: "#cbd5e1" } },
      axisTick: { show: false }
    },
    yAxis: [
      {
        type: "value",
        name: unit,
        nameTextStyle: { color: "#64748b" },
        axisLabel: {
          color: "#64748b",
          formatter: (value: number) => formatNumber(value)
        },
        splitLine: { lineStyle: { color: "#e2e8f0" } }
      },
      {
        type: "value",
        name: "EUR/MWh",
        nameTextStyle: { color: "#7c3aed" },
        axisLabel: {
          color: "#7c3aed",
          formatter: (value: number) => formatNumber(value)
        },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: "Elevado a pérdidas",
        type: "bar",
        yAxisIndex: 0,
        data: rows.map((row) => Number((row.elevatedConsumptionKwh / divisor).toFixed(3))),
        barMaxWidth: 28,
        itemStyle: { color: "#2563eb", borderRadius: [4, 4, 0, 0] },
        emphasis: { itemStyle: { color: "#1d4ed8" } }
      },
      {
        name: "Dif. EUR/MWh BC",
        type: "line",
        yAxisIndex: 1,
        data: rows.map((row) => row.meffSpreadEurMwh === null ? null : Number(row.meffSpreadEurMwh.toFixed(3))),
        connectNulls: false,
        smooth: true,
        symbolSize: 7,
        lineStyle: { color: "#16a34a", width: 3 },
        itemStyle: {
          color: (params: { value?: unknown }) => Number(params.value) < 0 ? "#dc2626" : "#16a34a"
        },
        label: {
          show: true,
          position: "top",
          distance: 8,
          color: "#1f2937",
          fontSize: 11,
          fontWeight: 800,
          formatter: (params: { value?: unknown }) => `${formatChartNumberLabel(params.value, 2)} EUR/MWh`
        }
      }
    ]
  };
}
