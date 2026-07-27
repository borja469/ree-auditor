import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { BarChart3, Download, Edit3, Plus, RefreshCw, Save, Search, Trash2, X } from "lucide-react";
import {
  createPricingHedgeOperation,
  deletePricingHedgeOperation,
  getPricingHedgeProducts,
  getPricingHedges,
  updatePricingHedgeOperation,
  type PricingHedgeOperation,
  type PricingHedgeOperationInput,
  type PricingHedgeOperationType,
  type PricingHedgePosition,
  type PricingHedgeProduct,
  type PricingHedgesResponse
} from "../../api";
import { downloadBlob } from "../../components/technical-data-table/TechnicalDataTableHelpers";
import { EChart, PanelTitle, formatDecimalNumber, formatNumber } from "../shared/RestoredModuleCommon";

type Tab = "dashboard" | "operations" | "positions";
type ProductFilterState = {
  clase: "" | "FUTURO" | "SWAP";
  tipo: "" | "BASE" | "PUNTA";
  periodo: "" | "ANUAL" | "DIARIO" | "FIN DE SEMANA" | "MENSUAL" | "SEMANAL" | "TRIMESTRAL";
  entrega: string;
  showExpired: boolean;
};

const EMPTY_RESPONSE: PricingHedgesResponse = {
  operations: [],
  positions: [],
  products: [],
  summary: { openPositions: 0, openMw: 0, openMwh: 0, marketValue: 0, latentResult: 0, realizedResult: 0, totalResult: 0 }
};

export function PricingHedgesModule() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [data, setData] = useState<PricingHedgesResponse>(EMPTY_RESPONSE);
  const [products, setProducts] = useState<PricingHedgeProduct[]>([]);
  const [productCatalogLoaded, setProductCatalogLoaded] = useState(false);
  const [draft, setDraft] = useState<PricingHedgeOperationInput>(() => emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedProductCod, setSelectedProductCod] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [productFilters, setProductFilters] = useState<ProductFilterState>(() => defaultProductFilters());
  const [loading, setLoading] = useState(false);
  const [productsLoading, setProductsLoading] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string }>();

  async function load() {
    setLoading(true);
    setMessage(undefined);
    try {
      const result = await getPricingHedges();
      setData(result);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error consultando coberturas." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const productByCod = useMemo(() => new Map(products.map((product) => [product.cod, product])), [products]);
  const selectableProducts = useMemo(() => filterProducts(products, productFilters), [products, productFilters]);
  const draftProduct = productByCod.get(draft.productCod) ?? null;
  const draftMwh = draftProduct ? calculateMwh(draft.powerMw, draftProduct) : null;
  const visibleOperations = useMemo(() => filterOperations(data.operations, search), [data.operations, search]);
  const selectedPosition = selectedProductCod ? data.positions.find((position) => position.productCod === selectedProductCod) ?? null : null;
  const dashboardChartRows = useMemo(() => buildDashboardChartRows(data.positions), [data.positions]);
  const dashboardChartOption = useMemo(() => buildDashboardChartOption(dashboardChartRows), [dashboardChartRows]);

  async function saveDraft() {
    setLoading(true);
    setMessage(undefined);
    try {
      if (editingId) {
        await updatePricingHedgeOperation(editingId, draft);
        setMessage({ tone: "info", text: "Operacion actualizada." });
      } else {
        await createPricingHedgeOperation(draft);
        setMessage({ tone: "info", text: "Operacion creada." });
      }
      setEditingId(null);
      setDraft(emptyDraft(products[0]?.cod));
      await load();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error guardando operacion." });
    } finally {
      setLoading(false);
    }
  }

  async function removeOperation(id: string) {
    setLoading(true);
    setMessage(undefined);
    try {
      await deletePricingHedgeOperation(id);
      setMessage({ tone: "info", text: "Operacion eliminada logicamente." });
      if (editingId === id) {
        cancelEdit();
      }
      await load();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error eliminando operacion." });
    } finally {
      setLoading(false);
    }
  }

  function editOperation(operation: PricingHedgeOperation) {
    setActiveTab("operations");
    setEditingId(operation.id);
    setDraft({
      contractDate: operation.contractDate,
      operationType: operation.operationType,
      productCod: operation.productCod,
      powerMw: operation.powerMw,
      contractedPrice: operation.contractedPrice,
      broker: operation.broker,
      observations: operation.observations
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft(products[0]?.cod));
  }

  async function ensureProducts() {
    setProductsLoading(true);
    setProductCatalogLoaded(false);
    try {
      const result = await getPricingHedgeProducts({
        clase: productFilters.clase || undefined,
        tipo: productFilters.tipo || undefined,
        periodo: productFilters.periodo || undefined,
        showExpired: productFilters.showExpired
      });
      setProducts(result);
      setProductCatalogLoaded(true);
      setProductFilters((current) => current.entrega && !result.some((product) => product.entrega === current.entrega) ? { ...current, entrega: "" } : current);
      setDraft((current) => current.productCod ? current : { ...current, productCod: result[0]?.cod ?? "" });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando productos MEFF." });
    } finally {
      setProductsLoading(false);
    }
  }

  function changeProductFilters(next: ProductFilterState) {
    const catalogFilterChanged = next.clase !== productFilters.clase
      || next.tipo !== productFilters.tipo
      || next.periodo !== productFilters.periodo
      || next.showExpired !== productFilters.showExpired;
    setProductFilters(next);
    if (catalogFilterChanged) {
      setProducts([]);
      setProductCatalogLoaded(false);
      setDraft((current) => ({ ...current, productCod: "" }));
      setProductFilters({ ...next, entrega: "" });
    }
  }

  function exportOperations() {
    const headers = ["Fecha", "Compra/Venta", "Producto", "MW", "MWh", "Precio", "Broker", "Observaciones"];
    const lines = [headers, ...visibleOperations.map((row) => [
      row.contractDate,
      row.operationType,
      row.product?.label ?? row.productCod,
      row.powerMw,
      row.volumeMwh ?? "",
      row.contractedPrice,
      row.broker ?? "",
      row.observations ?? ""
    ])];
    downloadBlob("pricing-coberturas-operaciones.xls", lines.map((line) => line.map(csvCell).join(";")).join("\n"), "application/vnd.ms-excel;charset=utf-8");
  }

  return (
    <div className="omie-layout omie-layout-a pricing-hedges-module">
      <div className="panel wide omie-control-panel">
        <PanelTitle icon={<BarChart3 size={18} />} title="Coberturas MEFF" subtitle="Posiciones financieras contratadas y valoradas con precios de Pricing MEFF" />
        <div className="pricing-hedges-tabs" role="tablist" aria-label="Vistas de coberturas">
          <button className={activeTab === "dashboard" ? "active" : ""} onClick={() => setActiveTab("dashboard")} type="button">Dashboard</button>
          <button className={activeTab === "operations" ? "active" : ""} onClick={() => setActiveTab("operations")} type="button">Operaciones</button>
          <button className={activeTab === "positions" ? "active" : ""} onClick={() => setActiveTab("positions")} type="button">Posiciones</button>
        </div>
      </div>

      {message && <div className={`status-message ${message.tone}`}>{message.text}</div>}

      {activeTab === "dashboard" && (
        <>
          <div className="pricing-hedges-kpis">
            <Kpi label="Posiciones abiertas" value={formatNumber(data.summary.openPositions)} />
            <Kpi label="MW abiertos" value={formatDecimal(data.summary.openMw, 3)} />
            <Kpi label="MWh abiertos" value={formatDecimal(data.summary.openMwh, 3)} />
            <Kpi label="Resultado Latente" value={`${formatDecimal(data.summary.latentResult, 2)} EUR`} tone={data.summary.latentResult >= 0 ? "good" : "danger"} />
            <Kpi label="Margen Realizado" value={`${formatDecimal(data.summary.realizedResult, 2)} EUR`} tone={data.summary.realizedResult >= 0 ? "good" : "danger"} />
          </div>
          <div className="panel wide pricing-hedges-chart-panel">
            <PanelTitle icon={<BarChart3 size={18} />} title="Evolucion mensual" subtitle="MWh netos y resultado total por mes" />
            <EChart option={dashboardChartOption} height={320} />
          </div>
          <PositionsTable positions={data.positions.filter((position) => Math.abs(position.mwNetos) > 0.000001 || Math.abs(position.margenRealizado ?? 0) > 0.000001)} onSelect={setSelectedProductCod} />
        </>
      )}

      {activeTab === "operations" && (
        <>
          <OperationEditor
            draft={draft}
            draftMwh={draftMwh}
            editing={Boolean(editingId)}
            loading={loading || productsLoading}
            products={products}
            productCatalogLoaded={productCatalogLoaded}
            productsLoading={productsLoading}
            selectableProducts={selectableProducts}
            productFilters={productFilters}
            onCancel={cancelEdit}
            onChange={setDraft}
            onLoadProducts={() => void ensureProducts()}
            onProductFiltersChange={changeProductFilters}
            onSave={() => void saveDraft()}
          />
          <div className="panel wide pricing-meff-panel">
            <div className="pricing-hedges-table-header">
              <PanelTitle icon={<Search size={18} />} title="Operaciones" subtitle={`${formatNumber(visibleOperations.length)} operaciones visibles`} />
              <div className="pricing-hedges-actions">
                <label className="pricing-hedges-search">
                  <Search size={15} />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto, broker u observaciones" />
                </label>
                <button className="secondary-button" onClick={exportOperations} type="button">
                  <Download size={16} />
                  Excel
                </button>
              </div>
            </div>
            <OperationsTable loading={loading} operations={visibleOperations} onEdit={editOperation} onRemove={(id) => void removeOperation(id)} />
          </div>
        </>
      )}

      {activeTab === "positions" && (
        <>
          <PositionsTable positions={data.positions} onSelect={setSelectedProductCod} />
          {selectedPosition && (
            <div className="panel wide pricing-meff-panel">
              <PanelTitle icon={<BarChart3 size={18} />} title={`Detalle ${selectedPosition.productLabel}`} subtitle={`${formatNumber(selectedPosition.operations.length)} operaciones`} />
              <OperationsTable loading={loading} operations={selectedPosition.operations} onEdit={editOperation} onRemove={(id) => void removeOperation(id)} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function OperationEditor({
  draft,
  draftMwh,
  editing,
  loading,
  products,
  productCatalogLoaded,
  productsLoading,
  selectableProducts,
  productFilters,
  onCancel,
  onChange,
  onLoadProducts,
  onProductFiltersChange,
  onSave
}: {
  draft: PricingHedgeOperationInput;
  draftMwh: number | null;
  editing: boolean;
  loading: boolean;
  products: PricingHedgeProduct[];
  productCatalogLoaded: boolean;
  productsLoading: boolean;
  selectableProducts: PricingHedgeProduct[];
  productFilters: ProductFilterState;
  onCancel: () => void;
  onChange: (draft: PricingHedgeOperationInput) => void;
  onLoadProducts: () => void;
  onProductFiltersChange: (filters: ProductFilterState) => void;
  onSave: () => void;
}) {
  const currentProduct = products.find((product) => product.cod === draft.productCod);
  const productOptions = currentProduct && !selectableProducts.some((product) => product.cod === currentProduct.cod)
    ? [currentProduct, ...selectableProducts]
    : selectableProducts;
  const deliveryOptions = useMemo(() => buildDeliveryOptions(products, productFilters), [products, productFilters]);

  useEffect(() => {
    const nextProductCod = selectableProducts[0]?.cod ?? "";
    if (!editing && !selectableProducts.some((product) => product.cod === draft.productCod) && draft.productCod !== nextProductCod) {
      onChange({ ...draft, productCod: nextProductCod });
    }
  }, [draft, editing, onChange, selectableProducts]);

  return (
    <div className="panel wide pricing-hedges-editor">
      <PanelTitle icon={editing ? <Edit3 size={18} /> : <Plus size={18} />} title={editing ? "Editar operacion" : "Alta de operacion"} subtitle="El volumen MWh se calcula automaticamente desde el producto MEFF" />
      <div className="pricing-hedges-form">
        <label className="filter-field">
          <span>Fecha</span>
          <input disabled={loading} type="date" value={draft.contractDate} onChange={(event) => onChange({ ...draft, contractDate: event.target.value })} />
        </label>
        <label className="filter-field">
          <span>Compra/Venta</span>
          <select disabled={loading} value={draft.operationType} onChange={(event) => onChange({ ...draft, operationType: event.target.value as PricingHedgeOperationType })}>
            <option value="COMPRA">Compra</option>
            <option value="VENTA">Venta</option>
          </select>
        </label>
        <label className="filter-field wide">
          <span>Clase</span>
          <select disabled={loading} value={productFilters.clase} onChange={(event) => onProductFiltersChange({ ...productFilters, clase: event.target.value as ProductFilterState["clase"], entrega: "" })}>
            <option value="">Todas</option>
            <option value="FUTURO">Futuro</option>
            <option value="SWAP">Swap</option>
          </select>
        </label>
        <label className="filter-field wide">
          <span>Tipo</span>
          <select disabled={loading} value={productFilters.tipo} onChange={(event) => onProductFiltersChange({ ...productFilters, tipo: event.target.value as ProductFilterState["tipo"], entrega: "" })}>
            <option value="">Todos</option>
            <option value="BASE">Base</option>
            <option value="PUNTA">Punta</option>
          </select>
        </label>
        <label className="filter-field wide">
          <span>Periodo</span>
          <select disabled={loading} value={productFilters.periodo} onChange={(event) => onProductFiltersChange({ ...productFilters, periodo: event.target.value as ProductFilterState["periodo"], entrega: "" })}>
            <option value="">Todos</option>
            <option value="ANUAL">Anual</option>
            <option value="DIARIO">Diario</option>
            <option value="FIN DE SEMANA">Fin de semana</option>
            <option value="MENSUAL">Mensual</option>
            <option value="SEMANAL">Semanal</option>
            <option value="TRIMESTRAL">Trimestral</option>
          </select>
        </label>
        <label className="pricing-hedges-check">
          <input checked={productFilters.showExpired} disabled={loading} onChange={(event) => onProductFiltersChange({ ...productFilters, showExpired: event.target.checked, entrega: "" })} type="checkbox" />
          <span>Mostrar vencidos</span>
        </label>
        <div className="pricing-hedges-load-products">
          <button className="secondary-button" disabled={loading || productsLoading} onClick={onLoadProducts} type="button">
            <RefreshCw size={16} />
            {productsLoading ? "Cargando..." : "Cargar productos"}
          </button>
          <small>{productCatalogLoaded ? `${formatNumber(products.length)} productos cargados desde MEFF` : "Define filtros y pulsa cargar"}</small>
        </div>
        <label className="filter-field wide">
          <span>Entrega</span>
          <select disabled={loading || deliveryOptions.length === 0} value={productFilters.entrega} onChange={(event) => onProductFiltersChange({ ...productFilters, entrega: event.target.value })}>
            <option value="">Todas</option>
            {deliveryOptions.map((entrega) => (
              <option key={entrega} value={entrega}>{entrega}</option>
            ))}
          </select>
        </label>
        <label className="filter-field pricing-hedges-product-field">
          <span>Producto MEFF</span>
          <select disabled={loading || productOptions.length === 0} value={draft.productCod} onChange={(event) => onChange({ ...draft, productCod: event.target.value })}>
            {!draft.productCod && <option value="">Seleccione producto</option>}
            {productOptions.map((product) => (
              <option key={product.cod} value={product.cod}>{productSelectorLabel(product)}</option>
            ))}
          </select>
          <small>{productsLoading ? "Cargando productos MEFF..." : !productCatalogLoaded ? "Pendiente de cargar productos" : selectableProducts.length ? `${formatNumber(selectableProducts.length)} productos disponibles` : "Sin productos para los filtros seleccionados"}</small>
        </label>
        <label className="filter-field">
          <span>MW</span>
          <input disabled={loading} min="0" step="0.001" type="number" value={draft.powerMw || ""} onChange={(event) => onChange({ ...draft, powerMw: Number(event.target.value) })} />
        </label>
        <label className="filter-field">
          <span>MWh</span>
          <input disabled readOnly value={draftMwh === null ? "-" : formatDecimal(draftMwh, 3)} />
        </label>
        <label className="filter-field">
          <span>Precio</span>
          <input disabled={loading} step="0.01" type="number" value={draft.contractedPrice || ""} onChange={(event) => onChange({ ...draft, contractedPrice: Number(event.target.value) })} />
        </label>
        <label className="filter-field">
          <span>Broker</span>
          <input disabled={loading} value={draft.broker ?? ""} onChange={(event) => onChange({ ...draft, broker: event.target.value })} />
        </label>
        <label className="filter-field wide">
          <span>Observaciones</span>
          <input disabled={loading} value={draft.observations ?? ""} onChange={(event) => onChange({ ...draft, observations: event.target.value })} />
        </label>
        <div className="pricing-hedges-form-actions">
          {editing && (
            <button className="secondary-button" disabled={loading} onClick={onCancel} type="button">
              <X size={16} />
              Cancelar
            </button>
          )}
          <button className="primary-button" disabled={loading || !draft.productCod} onClick={onSave} type="button">
            <Save size={16} />
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function PositionsTable({ positions, onSelect }: { positions: PricingHedgePosition[]; onSelect: (productCod: string) => void }) {
  return (
    <div className="panel wide pricing-meff-panel">
      <PanelTitle icon={<BarChart3 size={18} />} title="Posiciones" subtitle={`${formatNumber(positions.length)} productos agrupados`} />
      <div className="pricing-meff-table-scroll">
        <table className="pricing-meff-table pricing-hedges-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Tipo</th>
              <th>Clase</th>
              <th className="number">MWh Cerrados</th>
              <th className="number">MWh Netos</th>
              <th className="number">Precio Medio Compra</th>
              <th className="number">Precio Medio Venta</th>
              <th className="number">Precio Mercado</th>
              <th className="number">Resultado Latente</th>
              <th className="number">Margen Realizado</th>
              <th className="number">Resultado Total</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => (
              <tr key={position.productCod} onDoubleClick={() => onSelect(position.productCod)} title="Doble clic para ver operaciones">
                <td>{position.productLabel}</td>
                <td>{position.product ? productBusinessTipo(position.product) : position.tipo ?? "-"}</td>
                <td>{position.product ? productBusinessClase(position.product) : position.clase ?? "-"}</td>
                <td className="number">{formatNullable(position.mwhCerrados, 3)}</td>
                <td className="number">{formatNullable(position.mwhNetos, 3)}</td>
                <td className="number">{formatNullable(position.precioMedioCompra, 2)}</td>
                <td className="number">{formatNullable(position.precioMedioVenta, 2)}</td>
                <td className="number">{formatNullable(position.precioMercado, 2)}</td>
                <td className={`number ${position.resultadoLatente !== null && position.resultadoLatente < 0 ? "pricing-hedges-negative" : "pricing-hedges-positive"}`}>{formatNullable(position.resultadoLatente, 2)}</td>
                <td className={`number ${position.margenRealizado !== null && position.margenRealizado < 0 ? "pricing-hedges-negative" : "pricing-hedges-positive"}`}>{formatNullable(position.margenRealizado, 2)}</td>
                <td className={`number ${position.resultadoTotal !== null && position.resultadoTotal < 0 ? "pricing-hedges-negative" : "pricing-hedges-positive"}`}>{formatNullable(position.resultadoTotal, 2)}</td>
              </tr>
            ))}
            {!positions.length && (
              <tr>
                <td colSpan={11} className="empty-cell">Sin posiciones para mostrar.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OperationsTable({ loading, operations, onEdit, onRemove }: { loading: boolean; operations: PricingHedgeOperation[]; onEdit: (operation: PricingHedgeOperation) => void; onRemove: (id: string) => void }) {
  return (
    <div className="pricing-meff-table-scroll">
      <table className="pricing-meff-table pricing-hedges-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Compra/Venta</th>
            <th>Producto</th>
            <th className="number">MW</th>
            <th className="number">MWh</th>
            <th className="number">Precio</th>
            <th>Broker</th>
            <th>Observaciones</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {operations.map((operation) => (
            <tr key={operation.id}>
              <td>{formatDate(operation.contractDate)}</td>
              <td>{operation.operationType === "COMPRA" ? "Compra" : "Venta"}</td>
              <td>{operation.product?.label ?? operation.productCod}</td>
              <td className="number">{formatDecimal(operation.powerMw, 3)}</td>
              <td className="number">{formatNullable(operation.volumeMwh, 3)}</td>
              <td className="number">{formatDecimal(operation.contractedPrice, 2)}</td>
              <td>{operation.broker ?? "-"}</td>
              <td>{operation.observations ?? "-"}</td>
              <td>
                <div className="pricing-hedges-row-actions">
                  <button className="secondary-button" disabled={loading} onClick={() => onEdit(operation)} type="button" title="Editar">
                    <Edit3 size={15} />
                  </button>
                  <button className="secondary-button danger-button" disabled={loading} onClick={() => onRemove(operation.id)} type="button" title="Eliminar">
                    <Trash2 size={15} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {!operations.length && (
            <tr>
              <td colSpan={9} className="empty-cell">{loading ? "Cargando..." : "Sin operaciones de cobertura."}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

type DashboardChartRow = {
  monthKey: string;
  label: string;
  mwhNetos: number;
  resultadoTotal: number;
};

function buildDashboardChartRows(positions: PricingHedgePosition[]): DashboardChartRow[] {
  const months = dashboardMonthRange();
  const rows = new Map<string, DashboardChartRow>(months.map((month) => [month.key, { ...month, mwhNetos: 0, resultadoTotal: 0 }]));

  for (const position of positions) {
    const product = position.product;
    if (!product?.fechaInicio || !product.fechaFin) {
      continue;
    }
    const totalMwh = position.mwhNetos ?? 0;
    const totalResult = position.resultadoTotal ?? 0;
    if (Math.abs(totalMwh) < 0.000001 && Math.abs(totalResult) < 0.000001) {
      continue;
    }
    const monthlyHours = splitProductHoursByMonth(product);
    const totalHours = monthlyHours.reduce((sum, row) => sum + row.hours, 0);
    if (totalHours <= 0) {
      continue;
    }
    for (const row of monthlyHours) {
      const target = rows.get(row.monthKey);
      if (!target) {
        continue;
      }
      const weight = row.hours / totalHours;
      target.mwhNetos += totalMwh * weight;
      target.resultadoTotal += totalResult * weight;
    }
  }

  return [...rows.values()];
}

function buildDashboardChartOption(rows: DashboardChartRow[]): EChartsOption {
  return {
    color: ["#2563eb", "#16a34a"],
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => formatDecimal(Number(value), 2)
    },
    legend: {
      top: 0,
      data: ["MWh netos", "Resultado total"]
    },
    grid: {
      left: 56,
      right: 72,
      top: 64,
      bottom: 42
    },
    xAxis: {
      type: "category",
      data: rows.map((row) => row.label),
      axisLabel: { interval: 0, rotate: 35 }
    },
    yAxis: [
      {
        type: "value",
        name: "MWh",
        axisLabel: { formatter: (value: number) => formatNumber(value) }
      },
      {
        type: "value",
        name: "EUR",
        axisLabel: { formatter: (value: number) => formatNumber(value) }
      }
    ],
    series: [
      {
        name: "MWh netos",
        type: "bar",
        data: rows.map((row) => Number(row.mwhNetos.toFixed(3))),
        yAxisIndex: 0,
        barMaxWidth: 28
      },
      {
        name: "Resultado total",
        type: "line",
        data: rows.map((row) => Number(row.resultadoTotal.toFixed(2))),
        yAxisIndex: 1,
        smooth: true,
        symbolSize: 7,
        label: {
          show: true,
          position: "top",
          formatter: formatChartCurrencyLabel
        }
      }
    ]
  };
}

function formatChartCurrencyLabel(params: { value?: unknown }) {
  const value = Array.isArray(params.value) ? params.value.at(-1) : params.value;
  const numericValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : null;
  return numericValue === null || !Number.isFinite(numericValue) ? "" : `${formatDecimal(numericValue, 0)} EUR`;
}

function dashboardMonthRange() {
  const today = new Date();
  const start = new Date(Date.UTC(today.getFullYear(), today.getMonth() - 3, 1));
  return Array.from({ length: 13 }, (_, index) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    const key = monthKey(date.getUTCFullYear(), date.getUTCMonth() + 1);
    return { key, monthKey: key, label: `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCFullYear()).slice(2)}` };
  });
}

function splitProductHoursByMonth(product: PricingHedgeProduct) {
  if (!product.fechaInicio || !product.fechaFin) {
    return [];
  }
  const output: Array<{ monthKey: string; hours: number }> = [];
  for (const month of monthsBetween(product.fechaInicio, product.fechaFin)) {
    const range = monthDateRange(month.year, month.month);
    const start = maxDateText(product.fechaInicio, range.start);
    const end = minDateText(product.fechaFin, range.end);
    const hours = countProductHours(start, end, product);
    if (hours > 0) {
      output.push({ monthKey: monthKey(month.year, month.month), hours });
    }
  }
  return output;
}

function countProductHours(start: string, end: string, product: PricingHedgeProduct) {
  const rows = buildMadridHourlyRows(start, end);
  return isPeakClass(product.tipo)
    ? rows.filter((row) => row.weekday >= 1 && row.weekday <= 5 && row.hour >= 8 && row.hour < 20).length
    : rows.length;
}

function buildMadridHourlyRows(start: string, end: string) {
  const dates = new Set(enumerateDateTexts(start, end));
  const startDate = parseDateText(start);
  const endDate = parseDateText(end);
  const utcStart = Date.UTC(startDate.year, startDate.month - 1, startDate.day) - 48 * 60 * 60 * 1000;
  const utcEnd = Date.UTC(endDate.year, endDate.month - 1, endDate.day) + 72 * 60 * 60 * 1000;
  const rows: Array<{ date: string; weekday: number; hour: number }> = [];
  for (let instant = utcStart; instant < utcEnd; instant += 60 * 60 * 1000) {
    const parts = madridParts(new Date(instant));
    if (dates.has(parts.date)) {
      rows.push(parts);
    }
  }
  return rows;
}

const MADRID_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23"
});

const MADRID_WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Madrid",
  weekday: "short"
});

function madridParts(date: Date) {
  const parts = MADRID_DATE_FORMATTER.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "0";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(MADRID_WEEKDAY_FORMATTER.format(date));
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    weekday,
    hour: Number(read("hour"))
  };
}

function monthsBetween(start: string, end: string) {
  const first = parseDateText(start);
  const last = parseDateText(end);
  const cursor = new Date(Date.UTC(first.year, first.month - 1, 1));
  const lastTime = Date.UTC(last.year, last.month - 1, 1);
  const output: Array<{ year: number; month: number }> = [];
  while (cursor.getTime() <= lastTime) {
    output.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return output;
}

function monthDateRange(year: number, month: number) {
  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
  };
}

function enumerateDateTexts(start: string, end: string) {
  const cursor = parseDateObject(start);
  const endDate = parseDateObject(end);
  const output: string[] = [];
  while (cursor.getTime() <= endDate.getTime()) {
    output.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return output;
}

function parseDateText(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function parseDateObject(value: string) {
  const date = parseDateText(value);
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

function minDateText(left: string, right: string) {
  return left <= right ? left : right;
}

function maxDateText(left: string, right: string) {
  return left >= right ? left : right;
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "good" | "danger" }) {
  return (
    <div className={`technical-kpi ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function emptyDraft(productCod = ""): PricingHedgeOperationInput {
  return {
    contractDate: todayInputValue(),
    operationType: "COMPRA",
    productCod,
    powerMw: 0,
    contractedPrice: 0,
    broker: "",
    observations: ""
  };
}

function defaultProductFilters(): ProductFilterState {
  return { clase: "", tipo: "", periodo: "", entrega: "", showExpired: false };
}

function filterProducts(products: PricingHedgeProduct[], filters: ProductFilterState) {
  const today = todayInputValue();
  return products.filter((product) => {
    if (filters.tipo && productBusinessTipo(product) !== filters.tipo) {
      return false;
    }
    if (filters.clase && productBusinessClase(product) !== filters.clase) {
      return false;
    }
    if (filters.periodo && productBusinessPeriodo(product) !== filters.periodo) {
      return false;
    }
    if (!filters.showExpired && product.fechaFin && product.fechaFin < today) {
      return false;
    }
    if (filters.entrega && product.entrega !== filters.entrega) {
      return false;
    }
    return true;
  });
}

function buildDeliveryOptions(products: PricingHedgeProduct[], filters: ProductFilterState) {
  const baseFilters = { ...filters, entrega: "" };
  return [...new Set(filterProducts(products, baseFilters).map((product) => product.entrega).filter((entrega): entrega is string => Boolean(entrega)))]
    .sort(compareDeliveryLabels);
}

function productSelectorLabel(product: PricingHedgeProduct) {
  const range = product.fechaInicio && product.fechaFin ? `${formatDate(product.fechaInicio)} - ${formatDate(product.fechaFin)}` : "sin periodo inferido";
  return `${product.entrega ?? product.label} - ${product.cod} - ${productBusinessTipo(product)} - ${productBusinessClase(product)} - ${productBusinessPeriodo(product)} - ${range}`;
}

function productBusinessTipo(product: PricingHedgeProduct) {
  const normalized = normalizeText(product.tipo);
  if (normalized.includes("base")) {
    return "BASE";
  }
  if (normalized.includes("punta") || normalized.includes("peak")) {
    return "PUNTA";
  }
  return product.tipo?.toUpperCase() ?? "-";
}

function productBusinessClase(product: PricingHedgeProduct) {
  const normalized = normalizeText(product.clase);
  if (normalized.includes("futuro") || normalized.includes("future")) {
    return "FUTURO";
  }
  if (normalized.includes("swap")) {
    return "SWAP";
  }
  return product.clase?.toUpperCase() ?? "-";
}

function productBusinessPeriodo(product: PricingHedgeProduct) {
  const normalized = normalizeText(product.periodo);
  if (normalized.includes("anual") || normalized.includes("year")) {
    return "ANUAL";
  }
  if (normalized.includes("diario") || normalized.includes("daily")) {
    return "DIARIO";
  }
  if (normalized.includes("fin") || normalized.includes("weekend")) {
    return "FIN DE SEMANA";
  }
  if (normalized.includes("mensual") || normalized.includes("month")) {
    return "MENSUAL";
  }
  if (normalized.includes("semanal") || normalized.includes("week")) {
    return "SEMANAL";
  }
  if (normalized.includes("trimestral") || normalized.includes("quarter")) {
    return "TRIMESTRAL";
  }
  return product.periodo?.toUpperCase() ?? "-";
}

function compareDeliveryLabels(left: string, right: string) {
  const leftKey = deliverySortKey(left);
  const rightKey = deliverySortKey(right);
  return leftKey.localeCompare(rightKey, "es", { numeric: true, sensitivity: "base" });
}

function deliverySortKey(value: string) {
  const normalized = normalizeText(value);
  const quarter = normalized.match(/^q([1-4])[-\s/]?(\d{2,4})$/);
  if (quarter) {
    return `${normalizeDeliveryYear(quarter[2])}-${Number(quarter[1]) * 3}-q${quarter[1]}`;
  }
  const year = normalized.match(/^(?:cal)?[-\s/]?(\d{2,4})$/);
  if (year) {
    return `${normalizeDeliveryYear(year[1])}-12-cal`;
  }
  const month = normalized.match(/^(ene|jan|feb|mar|abr|apr|may|jun|jul|ago|aug|sep|oct|nov|dic|dec)[-\s/]?(\d{2,4})$/);
  if (month) {
    return `${normalizeDeliveryYear(month[2])}-${MONTH_ORDER[month[1]] ?? 0}-${month[1]}`;
  }
  return normalized;
}

function normalizeDeliveryYear(value: string) {
  const year = Number(value);
  return value.length === 2 ? 2000 + year : year;
}

const MONTH_ORDER: Record<string, number> = {
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

function calculateMwh(powerMw: number, product: PricingHedgeProduct) {
  const hours = isPeakClass(product.tipo) ? product.horasPunta : product.horasBase;
  return hours === null ? null : powerMw * hours;
}

function isPeakClass(value: string | null) {
  const normalized = normalizeText(value);
  return normalized.includes("punta") || normalized.includes("peak");
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function filterOperations(operations: PricingHedgeOperation[], search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) {
    return operations;
  }
  return operations.filter((operation) => [operation.product?.label, operation.productCod, operation.broker, operation.observations].some((value) => (value ?? "").toLowerCase().includes(needle)));
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatDecimal(value: number, decimals: number) {
  return Number.isFinite(value) ? formatDecimalNumber(value, decimals) : "-";
}

function formatNullable(value: number | null, decimals: number) {
  return value === null || value === undefined ? "-" : formatDecimal(value, decimals);
}

function todayInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
