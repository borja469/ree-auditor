import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, ChevronDown, ChevronRight, CheckCircle2, Clipboard, Download, FileDown, FileSpreadsheet, Info, Search } from "lucide-react";
import { InlineLoading } from "../../../GlobalLoadingOverlay";
import { saveOmieLiquidationInvoice, type OmieComprobacionLiquidacionHoraria, type OmieComprobacionLiquidacionDiaria, type OmieComprobacionLiquidacionesResponse, type OmieReerEstado } from "../../../api";
import { type TechnicalSortDirection } from "../../../technical-module-v2";
import type { TechnicalDataTableAdapterColumn } from "../../../technical-module-v2/adapters/technicalDataTableAdapter";
import {
  buildOmieLiquidationValidationKpis,
  buildOmieLiquidationWeeklyGroups,
  buildOmieEconomicCheckFromInvoices,
  copyTechnicalRows,
  exportOmieLiquidationCheck,
  formatEuroAmount,
  formatFixedDecimalNumber,
  formatOmieEnergy,
  formatOmiePrice,
  parseEuroInputValue,
  stringifyCellValue,
  withOmieEconomicCheckFromInvoices
} from "./OmieLiquidacionesHelpers";
import type {
  OmieFacturaDraftMap,
  OmieLiquidationValidationRow,
  OmieLiquidationWeeklyGroup
} from "./OmieLiquidacionesTypes";

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

export function OmieLiquidacionesModule({
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
  comprobacion?: OmieComprobacionLiquidacionesResponse;
  loading: boolean;
  onYearChange: (value: string) => void;
  onMonthChange: (value: string) => void;
  onRefresh: () => Promise<void> | void;
  onGoToDownloads: () => void;
}) {
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());
  const [sortDirection, setSortDirection] = useState<TechnicalSortDirection>("asc");
  const [facturaDrafts, setFacturaDrafts] = useState<OmieFacturaDraftMap>({});
  const [openMismatchInfoDate, setOpenMismatchInfoDate] = useState<string | null>(null);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => new Set());
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [resultMode, setResultMode] = useState<"prevision" | "conciliada">("prevision");
  const facturaHydrationKey = useMemo(() => `${year}-${month}`, [month, year]);
  const hydratedFacturaKey = useRef<string | null>(null);
  const savedFacturaValues = useRef<Record<string, { facturaCompra: number | null; facturaVenta: number | null }>>({});
  const initializedColumnsPreset = useRef(false);
  const columnsMenuRef = useRef<HTMLDivElement | null>(null);
  const detalleDiarioBase = useMemo(() => [...(comprobacion?.detalleDiario ?? [])].sort((left, right) => left.fechaIso.localeCompare(right.fechaIso)), [comprobacion]);
  const detalleDiario = useMemo(
    () =>
      detalleDiarioBase.map((row) => {
        const conceptosCompra =
          resultMode === "conciliada"
            ? row.reer.reerOficial ?? row.reer.reerEstimadoDerivado ?? row.conceptosCompra
            : row.reer.reerEstimadoDerivado ?? row.conceptosCompra;
        const compraBaseImponible =
          resultMode === "conciliada"
            ? row.compraTotalConciliada ?? row.compraTotalPrevista ?? row.compraBaseImponible
            : row.compraTotalPrevista ?? row.compraBaseImponible;
        const ivaCompra = calculateDisplayIva(compraBaseImponible);
        const compraFactura = nullableEuroSum([compraBaseImponible, ivaCompra]);
        return {
          ...row,
          conceptosCompra,
          compraBaseImponible,
          ivaCompra,
          compraFactura,
          netoFactura: calculateDisplayNetoFactura(compraFactura, row.ventaFactura)
        };
      }),
    [detalleDiarioBase, resultMode]
  );
  const weeklyGroups = useMemo(() => buildOmieLiquidationWeeklyGroups(detalleDiario, facturaDrafts), [detalleDiario, facturaDrafts]);
  const orderedGroups = useMemo(
    () => (sortDirection === "asc" ? weeklyGroups : [...weeklyGroups].reverse().map((group) => ({ ...group, rows: [...group.rows].reverse() }))),
    [sortDirection, weeklyGroups]
  );
  const validationKpis = useMemo(() => buildOmieLiquidationValidationKpis(weeklyGroups), [weeklyGroups]);
  const liquidationRows = useMemo(() => weeklyGroups.flatMap((group) => group.rows), [weeklyGroups]);
  const economicCheck = useMemo(
    () => (comprobacion ? buildOmieEconomicCheckFromInvoices(comprobacion.cuadroEconomico, liquidationRows) : undefined),
    [comprobacion, liquidationRows]
  );
  const comprobacionForExport = useMemo(
    () => (comprobacion ? withOmieEconomicCheckFromInvoices(comprobacion, liquidationRows) : undefined),
    [comprobacion, liquidationRows]
  );
  const columns = useMemo<Array<TechnicalDataTableAdapterColumn<OmieLiquidationValidationRow>>>(
    () => [
      {
        id: "fecha",
        label: "Fecha",
        width: 116,
        sticky: true,
        visibility: "basic",
        value: (row) => row.fecha,
        render: (row) => (
          <button className="row-toggle-button" onClick={() => toggleDay(row.fechaIso)} type="button">
            {expandedDays.has(row.fechaIso) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            {row.fecha}
          </button>
        )
      },
      { id: "dia", label: "Día", width: 92, visibility: "basic", value: (row) => row.dia },
      { id: "energiaMd", label: "Energía MD", width: 116, align: "right", type: "number", visibility: "basic", value: (row) => row.energiaMd, render: (row) => formatOmieEnergy(row.energiaMd) },
      { id: "costeMd", label: "Coste MD", width: 116, align: "right", type: "number", visibility: "basic", value: (row) => row.costeMd, render: (row) => formatEuroAmount(row.costeMd) },
      { id: "energiaIda1", label: "Energía IDA1", width: 124, align: "right", type: "number", visibility: "basic", value: (row) => row.energiaIda1, render: (row) => formatOmieEnergy(row.energiaIda1) },
      { id: "costeIda1", label: "Coste IDA1", width: 118, align: "right", type: "number", visibility: "basic", value: (row) => row.costeIda1, render: (row) => formatEuroAmount(row.costeIda1) },
      { id: "energiaIda2", label: "Energía IDA2", width: 124, align: "right", type: "number", visibility: "basic", value: (row) => row.energiaIda2, render: (row) => formatOmieEnergy(row.energiaIda2) },
      { id: "costeIda2", label: "Coste IDA2", width: 118, align: "right", type: "number", visibility: "basic", value: (row) => row.costeIda2, render: (row) => formatEuroAmount(row.costeIda2) },
      { id: "energiaIda3", label: "Energía IDA3", width: 124, align: "right", type: "number", visibility: "basic", value: (row) => row.energiaIda3, render: (row) => formatOmieEnergy(row.energiaIda3) },
      { id: "costeIda3", label: "Coste IDA3", width: 118, align: "right", type: "number", visibility: "basic", value: (row) => row.costeIda3, render: (row) => formatEuroAmount(row.costeIda3) },
      { id: "energiaXbid", label: "Energía XBID", width: 126, align: "right", type: "number", visibility: "basic", value: (row) => row.energiaXbid, render: (row) => formatOmieEnergy(row.energiaXbid) },
      { id: "costeXbid", label: "Coste XBID", width: 120, align: "right", type: "number", visibility: "basic", value: (row) => row.costeXbid, render: (row) => formatEuroAmount(row.costeXbid) },
      { id: "compraMercados", label: "Compra mercados", width: 144, align: "right", type: "number", visibility: "basic", value: (row) => row.compraMercados, render: (row) => formatEuroAmount(row.compraMercados) },
      { id: "ventaMercados", label: "Venta mercados", width: 140, align: "right", type: "number", visibility: "basic", value: (row) => row.ventaMercados, render: (row) => formatEuroAmount(row.ventaMercados) },
      { id: "reerEstimado", label: "REER estimado", width: 134, align: "right", type: "number", visibility: "basic", value: (row) => row.reer.reerEstimadoDerivado, render: (row) => formatEuroAmount(row.reer.reerEstimadoDerivado) },
      { id: "reerOficial", label: "REER oficial", width: 128, align: "right", type: "number", visibility: "basic", value: (row) => row.reer.reerOficial, render: (row) => formatEuroAmount(row.reer.reerOficial) },
      { id: "ajusteReer", label: "Ajuste REER", width: 126, align: "right", type: "number", visibility: "basic", value: (row) => row.reer.ajusteReerConciliacion, render: (row) => formatEuroAmount(row.reer.ajusteReerConciliacion) },
      { id: "conceptosCompra", label: "Conceptos compra", width: 154, align: "right", type: "number", visibility: "basic", value: (row) => row.conceptosCompra, render: (row) => formatEuroAmount(row.conceptosCompra) },
      { id: "conceptosVenta", label: "Conceptos venta", width: 146, align: "right", type: "number", visibility: "basic", value: (row) => row.conceptosVenta, render: (row) => formatEuroAmount(row.conceptosVenta) },
      { id: "compraBaseImponible", label: "Base compra", width: 132, align: "right", type: "number", visibility: "basic", value: (row) => row.compraBaseImponible, render: (row) => formatEuroAmount(row.compraBaseImponible) },
      { id: "ivaCompra", label: "IVA compra", width: 120, align: "right", type: "number", visibility: "basic", value: (row) => row.ivaCompra, render: (row) => formatEuroAmount(row.ivaCompra) },
      { id: "compraFactura", label: "Compra factura", width: 146, align: "right", type: "number", visibility: "basic", value: (row) => row.compraFactura, render: (row) => formatEuroAmount(row.compraFactura) },
      { id: "ventaBaseImponible", label: "Base venta", width: 124, align: "right", type: "number", visibility: "basic", value: (row) => row.ventaBaseImponible, render: (row) => formatEuroAmount(row.ventaBaseImponible) },
      { id: "ivaVenta", label: "IVA venta", width: 114, align: "right", type: "number", visibility: "basic", value: (row) => row.ivaVenta, render: (row) => formatEuroAmount(row.ivaVenta) },
      { id: "ventaFactura", label: "Venta factura", width: 138, align: "right", type: "number", visibility: "basic", value: (row) => row.ventaFactura, render: (row) => formatEuroAmount(row.ventaFactura) },
      { id: "netoFactura", label: "Neto factura", width: 132, align: "right", type: "number", visibility: "basic", value: (row) => row.netoFactura, render: (row) => formatEuroAmount(row.netoFactura) },
      { id: "netoAnalitico", label: "Neto analítico", width: 136, align: "right", type: "number", visibility: "basic", value: (row) => row.netoAnalitico, render: (row) => formatEuroAmount(row.netoAnalitico) },
      { id: "estadoReer", label: "Estado", width: 160, visibility: "basic", value: (row) => row.reer.estadoReer, render: (row) => formatReerEstado(row.reer.estadoReer) },
      {
        id: "facturaCompra",
        label: "Factura Compra",
        width: 150,
        align: "right",
        type: "number",
        visibility: "basic",
        value: (row) => row.facturaCompra,
        render: (row) => (
          <label className="omie-factura-input-shell">
            <span className="sr-only">Factura Compra {row.fecha}</span>
            <input className="omie-factura-input" inputMode="decimal" onChange={(event) => updateFacturaValue(row.fechaIso, "facturaCompra", event.target.value)} placeholder="0,00" type="text" value={facturaDrafts[row.fechaIso]?.facturaCompra ?? ""} />
            <span className="omie-factura-suffix">€</span>
          </label>
        )
      },
      {
        id: "facturaVenta",
        label: "Factura Venta",
        width: 144,
        align: "right",
        type: "number",
        visibility: "basic",
        value: (row) => row.facturaVenta,
        render: (row) => (
          <label className="omie-factura-input-shell">
            <span className="sr-only">Factura Venta {row.fecha}</span>
            <input className="omie-factura-input" inputMode="decimal" onChange={(event) => updateFacturaValue(row.fechaIso, "facturaVenta", event.target.value)} placeholder="0,00" type="text" value={facturaDrafts[row.fechaIso]?.facturaVenta ?? ""} />
            <span className="omie-factura-suffix">€</span>
          </label>
        )
      },
      {
        id: "descuadre",
        label: "Descuadre",
        width: 132,
        align: "right",
        type: "number",
        visibility: "basic",
        value: (row) => row.descuadre,
        render: (row) => (
          <div className={`omie-descuadre-cell ${row.descuadreTone}`}>
            <span>{formatEuroAmount(row.descuadre)}</span>
            <button aria-expanded={openMismatchInfoDate === row.fechaIso} className="omie-info-button" onClick={() => setOpenMismatchInfoDate((current) => (current === row.fechaIso ? null : row.fechaIso))} title="Detalle del cálculo" type="button">
              <Info size={14} />
            </button>
            {openMismatchInfoDate === row.fechaIso && <OmieMismatchTooltip row={row} />}
          </div>
        )
      }
    ],
    [expandedDays, facturaDrafts, openMismatchInfoDate]
  );
  const effectiveHiddenColumns = initializedColumnsPreset.current ? hiddenColumns : new Set<string>();
  const activeColumns = useMemo(() => columns.filter((column) => !effectiveHiddenColumns.has(column.id)), [columns, effectiveHiddenColumns]);

  useEffect(() => {
    if (initializedColumnsPreset.current) {
      return;
    }
    setHiddenColumns(new Set());
    initializedColumnsPreset.current = true;
  }, []);

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

  useEffect(() => {
    if (!comprobacion) {
      setFacturaDrafts({});
      hydratedFacturaKey.current = null;
      savedFacturaValues.current = {};
      return;
    }

    const drafts = Object.fromEntries(
      comprobacion.detalleDiario.map((row) => [
        row.fechaIso,
        {
          facturaCompra: row.facturaCompra === null ? "" : formatFixedDecimalNumber(row.facturaCompra, 2),
          facturaVenta: row.facturaVenta === null ? "" : formatFixedDecimalNumber(row.facturaVenta, 2)
        }
      ])
    );
    setFacturaDrafts(drafts);
    savedFacturaValues.current = Object.fromEntries(
      comprobacion.detalleDiario.map((row) => [
        row.fechaIso,
        {
          facturaCompra: row.facturaCompra,
          facturaVenta: row.facturaVenta
        }
      ])
    );
    hydratedFacturaKey.current = facturaHydrationKey;
  }, [comprobacion, facturaHydrationKey]);

  useEffect(() => {
    if (!comprobacion || hydratedFacturaKey.current !== facturaHydrationKey) {
      return;
    }

    const timeout = window.setTimeout(() => {
      for (const row of comprobacion.detalleDiario) {
        const draft = facturaDrafts[row.fechaIso] ?? {};
        const facturaCompra = parseEuroInputValue(draft.facturaCompra);
        const facturaVenta = parseEuroInputValue(draft.facturaVenta);
        const saved = savedFacturaValues.current[row.fechaIso] ?? { facturaCompra: row.facturaCompra, facturaVenta: row.facturaVenta };
        if (facturaCompra === saved.facturaCompra && facturaVenta === saved.facturaVenta) {
          continue;
        }

        void saveOmieLiquidationInvoice(row.fechaIso, facturaCompra, facturaVenta)
          .then((savedInvoice) => {
            savedFacturaValues.current[savedInvoice.fechaIso] = {
              facturaCompra: savedInvoice.facturaCompra,
              facturaVenta: savedInvoice.facturaVenta
            };
          })
          .catch((error) => {
            console.error("No se pudo guardar la factura OMIE", error);
          });
      }
    }, 550);

    return () => window.clearTimeout(timeout);
  }, [comprobacion, facturaDrafts, facturaHydrationKey]);

  useEffect(() => {
    setOpenMismatchInfoDate(null);
  }, [facturaHydrationKey, sortDirection]);

  function toggleDay(fechaIso: string) {
    setExpandedDays((current) => {
      const next = new Set(current);
      if (next.has(fechaIso)) {
        next.delete(fechaIso);
      } else {
        next.add(fechaIso);
      }
      return next;
    });
  }

  function updateFacturaValue(fechaIso: string, field: keyof OmieFacturaDraftMap[string], value: string) {
    setFacturaDrafts((current) => ({
      ...current,
      [fechaIso]: {
        ...current[fechaIso],
        [field]: value
      }
    }));
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

  return (
    <div className="omie-layout omie-layout-b">
      <div className="omie-control-row">
        <div className="panel wide omie-control-panel">
          <OmieLiquidationPanelTitle icon={<BarChart3 size={18} />} title="Comprobación Liquidaciones OMIE" subtitle="MD · IDA1 · IDA2 · IDA3 · XBID" />
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
            <label className="filter-field">
              <span>Modo</span>
              <select disabled={loading} value={resultMode} onChange={(event) => setResultMode(event.target.value as "prevision" | "conciliada")}>
                <option value="prevision">Prevision operativa</option>
                <option value="conciliada">Liquidacion conciliada</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      {loading && !comprobacion && (
        <div className="panel wide">
            <InlineLoading label="Cargando comprobación de liquidaciones OMIE" />
        </div>
      )}

      {!loading && !comprobacion && <OmieNoDownloadedData onGoToDownloads={onGoToDownloads} />}

      {comprobacion && (
        <>
          <div className="omie-summary-grid omie-liquidation-grid">
            <div className="panel omie-liquidation-panel">
              <OmieLiquidationPanelTitle icon={<FileSpreadsheet size={18} />} title="Resumen mensual" />
              <div className="table-scroll">
                <table className="omie-monthly-table">
                  <thead>
                    <tr>
                      <th>Mercado</th>
                      <th>Energía (MWh)</th>
                      <th>Importe (€)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comprobacion.resumenMensual.map((row) => (
                      <tr className={row.mercado === "TOTAL" ? "total-row" : ""} key={row.mercado}>
                        <th scope="row">{row.mercado}</th>
                        <td>{formatOmieEnergy(row.energiaMWh)}</td>
                        <td>{formatEuroAmount(row.importeEur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel omie-liquidation-panel">
              <OmieLiquidationPanelTitle icon={<CheckCircle2 size={18} />} title="Cuadres" />
              <div className="omie-liquidation-checks">
                <OmieLiquidationCheckCard
                  title="Cuadre económico"
                  calculatedLabel="Importe calculado"
                  liquidatedLabel="Importe liquidado"
                  differenceLabel="Diferencia"
                  formatValue={formatEuroAmount}
                  check={economicCheck ?? comprobacion.cuadroEconomico}
                />
                <OmieLiquidationCheckCard
                  title="Cuadre energético"
                  calculatedLabel="Energía calculada"
                  liquidatedLabel="Energía liquidada"
                  differenceLabel="Desviación"
                  formatValue={(value) => `${formatOmieEnergy(value)} MWh`}
                  check={comprobacion.cuadroEnergetico}
                />
              </div>
            </div>
          </div>

          <section className="panel wide omie-liquidation-panel omie-detail-table-panel">
            <div className="technical-data-head">
              <OmieLiquidationPanelTitle icon={<FileSpreadsheet size={18} />} title="Detalle diario" subtitle={`${detalleDiario.length.toLocaleString("es-ES")} días`} />
              <div className="technical-toolbar" role="toolbar" aria-label="Acciones de comprobación de liquidaciones OMIE">
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
                <button className="secondary-button" disabled={loading || !comprobacionForExport} onClick={() => comprobacionForExport && exportOmieLiquidationCheck(comprobacionForExport, weeklyGroups, activeColumns, "csv")} type="button">
                  <Download size={16} />
                  CSV
                </button>
                <button className="secondary-button" disabled={loading || !comprobacionForExport} onClick={() => comprobacionForExport && exportOmieLiquidationCheck(comprobacionForExport, weeklyGroups, activeColumns, "xls")} type="button">
                  <FileDown size={16} />
                  Excel
                </button>
                <button className="secondary-button" disabled={loading} onClick={() => copyTechnicalRows(activeColumns, liquidationRows, undefined)} type="button">
                  <Clipboard size={16} />
                  Copiar
                </button>
              </div>
            </div>

            <div className="technical-kpis">
              <div className="technical-kpi neutral">
                <span>Modo seleccionado</span>
                <strong>{resultMode === "conciliada" ? "Liquidacion conciliada" : "Prevision operativa"}</strong>
                <small>{resultMode === "conciliada" ? "Usa REER oficial si existe" : "Usa coeficiente publico derivado"}</small>
              </div>
              <div className="technical-kpi neutral">
                <span>REER estimado</span>
                <strong>{formatEuroAmount(comprobacion.totalesReer.reerEstimadoDerivado)}</strong>
                <small>Coeficiente derivado publico</small>
              </div>
              <div className="technical-kpi neutral">
                <span>REER oficial</span>
                <strong>{formatEuroAmount(comprobacion.totalesReer.reerOficial)}</strong>
                <small>Ajuste: {formatEuroAmount(comprobacion.totalesReer.ajusteReerConciliacion)}</small>
              </div>
              {validationKpis.map((kpi) => (
                <div className={`technical-kpi ${kpi.tone ?? "neutral"}`} key={kpi.label}>
                  <span>{kpi.label}</span>
                  <strong>{kpi.value}</strong>
                  {kpi.meta && <small>{kpi.meta}</small>}
                </div>
              ))}
            </div>

            <div className="table-scroll">
              <table className="omie-liquidation-table">
                <thead>
                  <tr>
                    {activeColumns.map((column) => (
                      <th className={column.align ?? (column.type === "number" ? "right" : "left")} key={column.id}>
                        {column.id === "fecha" ? (
                          <button className="table-sort-button" onClick={() => setSortDirection((current) => (current === "asc" ? "desc" : "asc"))} type="button">
                            Fecha {sortDirection === "asc" ? "↑" : "↓"}
                          </button>
                        ) : (
                          column.label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orderedGroups.flatMap((group) => [
                    ...group.rows.flatMap((row) => [
                      <tr className="omie-liquidation-day-row" key={row.fechaIso}>
                        {activeColumns.map((column, index) => {
                          const content: ReactNode = column.render
                            ? column.render(row) as ReactNode
                            : column.type === "number"
                              ? formatNumber(column.value(row))
                              : stringifyCellValue(column.value(row)) || "-";
                          const className = column.align ?? (column.type === "number" ? "right" : "left");
                          return index === 0 ? (
                            <th className={className} key={column.id} scope="row">
                              {content}
                            </th>
                          ) : (
                            <td className={className} key={column.id}>
                              {content}
                            </td>
                          );
                        })}
                      </tr>,
                      expandedDays.has(row.fechaIso) ? (
                        <tr className="omie-liquidation-hour-row" key={`${row.fechaIso}-horas`}>
                          <td colSpan={activeColumns.length}>
                            <OmieLiquidationHourlyTable rows={row.horas} />
                            <OmieReerPeriodTable row={row} />
                          </td>
                        </tr>
                      ) : null
                    ]),
                    <tr className={`omie-liquidation-week-row ${group.summary.descuadreTone}`} key={`week-${group.key}`}>
                      <td colSpan={activeColumns.length}>
                        <div className="omie-week-summary">
                          <div className="omie-week-summary-heading">
                            <strong>{group.summary.weekLabel}</strong>
                            <span>
                              {group.summary.startDateLabel} - {group.summary.endDateLabel}
                            </span>
                          </div>
                          <div className="omie-week-summary-values">
                            <span>Base compra: {formatEuroAmount(group.summary.compraBaseImponible)}</span>
                            <span>IVA compra: {formatEuroAmount(group.summary.ivaCompra)}</span>
                            <span>Compra factura: {formatEuroAmount(group.summary.compraFactura)}</span>
                            <span>Base venta: {formatEuroAmount(group.summary.ventaBaseImponible)}</span>
                            <span>IVA venta: {formatEuroAmount(group.summary.ivaVenta)}</span>
                            <span>Venta factura: {formatEuroAmount(group.summary.ventaFactura)}</span>
                            <span>Neto factura: {formatEuroAmount(group.summary.netoFactura)}</span>
                            <span>Factura Compra: {formatEuroAmount(group.summary.facturaCompra)}</span>
                            <span>Factura Venta: {formatEuroAmount(group.summary.facturaVenta)}</span>
                            <span>Descuadre: {formatEuroAmount(group.summary.descuadre)}</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ])}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function OmieLiquidationPanelTitle({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle?: ReactNode }) {
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

function OmieLiquidationCheckCard({
  title,
  calculatedLabel,
  liquidatedLabel,
  differenceLabel,
  formatValue,
  check
}: {
  title: string;
  calculatedLabel: string;
  liquidatedLabel: string;
  differenceLabel: string;
  formatValue: (value: number | null | undefined) => string;
  check: OmieComprobacionLiquidacionesResponse["cuadroEconomico"];
}) {
  return (
    <section className={`omie-liquidation-check ${check.estado}`}>
      <h3>{title}</h3>
      <dl>
        <div>
          <dt>{calculatedLabel}</dt>
          <dd>{formatValue(check.calculado)}</dd>
        </div>
        <div>
          <dt>{liquidatedLabel}</dt>
          <dd>{formatValue(check.liquidado)}</dd>
        </div>
        <div>
          <dt>{differenceLabel}</dt>
          <dd>{formatValue(check.diferencia)}</dd>
        </div>
      </dl>
    </section>
  );
}

function OmieLiquidationHourlyTable({ rows }: { rows: OmieComprobacionLiquidacionHoraria[] }) {
  return (
    <div className="table-scroll omie-liquidation-hourly-shell">
      <table className="omie-liquidation-hourly-table">
        <thead>
          <tr>
            <th>Hora</th>
            <th>MD MWh</th>
            <th>PMD</th>
            <th>Coste MD</th>
            <th>IDA1 MWh</th>
            <th>PIDA1</th>
            <th>Coste IDA1</th>
            <th>IDA2 MWh</th>
            <th>PIDA2</th>
            <th>Coste IDA2</th>
            <th>IDA3 MWh</th>
            <th>PIDA3</th>
            <th>Coste IDA3</th>
            <th>XBID MWh</th>
            <th>PXBID</th>
            <th>Coste XBID</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.fechaIso}-${row.hora}`}>
              <th scope="row">{row.hora}</th>
              <td>{formatOmieEnergy(row.mdMWh)}</td>
              <td>{formatOmiePrice(row.pmd)}</td>
              <td>{formatEuroAmount(row.costeMd)}</td>
              <td>{formatOmieEnergy(row.ida1MWh)}</td>
              <td>{formatOmiePrice(row.pida1)}</td>
              <td>{formatEuroAmount(row.costeIda1)}</td>
              <td>{formatOmieEnergy(row.ida2MWh)}</td>
              <td>{formatOmiePrice(row.pida2)}</td>
              <td>{formatEuroAmount(row.costeIda2)}</td>
              <td>{formatOmieEnergy(row.ida3MWh)}</td>
              <td>{formatOmiePrice(row.pida3)}</td>
              <td>{formatEuroAmount(row.costeIda3)}</td>
              <td>{formatOmieEnergy(row.xbidMWh)}</td>
              <td>{formatOmiePrice(row.pxbid)}</td>
              <td>{formatEuroAmount(row.costeXbid)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OmieReerPeriodTable({ row }: { row: OmieComprobacionLiquidacionDiaria }) {
  return (
    <div className="table-scroll omie-liquidation-hourly-shell">
      <div className="omie-week-summary-heading" title={`${row.reer.tooltip} ${row.reer.limitacionExclusiones}`}>
        <strong>REER</strong>
        <span>
          {formatReerEstado(row.reer.estadoReer)} · Estimado {formatEuroAmount(row.reer.reerEstimadoDerivado)} · Oficial {formatEuroAmount(row.reer.reerOficial)} · Ajuste {formatEuroAmount(row.reer.ajusteReerConciliacion)}
        </span>
      </div>
      <table className="omie-liquidation-hourly-table">
        <thead>
          <tr>
            <th>Periodo</th>
            <th>Energía neta</th>
            <th>Energía REER calc.</th>
            <th>Energía REER oficial</th>
            <th>Precio público</th>
            <th>Coef. derivado</th>
            <th>Precio XML</th>
            <th>Importe estimado</th>
            <th>Importe oficial</th>
            <th>Diferencia</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {row.reer.periodos.map((periodo) => (
            <tr key={`${row.fechaIso}-reer-${periodo.periodo}`}>
              <th scope="row">{periodo.periodoEtiqueta}</th>
              <td>{formatOmieEnergy(periodo.energiaNetaAgente)}</td>
              <td>{formatOmieEnergy(periodo.energiaReerCalculada)}</td>
              <td>{formatOmieEnergy(periodo.energiaReerOficial)}</td>
              <td>{formatOmiePrice(periodo.precioPublico)}</td>
              <td>{formatCoefficient(periodo.coeficienteDerivado)}</td>
              <td>{formatOmiePrice(periodo.precioXml)}</td>
              <td>{formatEuroAmount(periodo.importeEstimadoDerivado)}</td>
              <td>{formatEuroAmount(periodo.importeOficial)}</td>
              <td>{formatEuroAmount(periodo.diferencia)}</td>
              <td>{formatReerEstado(periodo.estado)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OmieMismatchTooltip({ row }: { row: OmieLiquidationValidationRow }) {
  return (
    <div className="omie-mismatch-tooltip" role="dialog">
      <strong>{row.fecha}</strong>
      <span>Compra mercados: {formatEuroAmount(row.compraMercados)}</span>
      <span>Venta mercados: {formatEuroAmount(row.ventaMercados)}</span>
      <span>REER estimado: {formatEuroAmount(row.reer.reerEstimadoDerivado)}</span>
      <span>REER oficial: {formatEuroAmount(row.reer.reerOficial)}</span>
      <span>Ajuste REER: {formatEuroAmount(row.reer.ajusteReerConciliacion)}</span>
      <span>Conceptos compra: {formatEuroAmount(row.conceptosCompra)}</span>
      <span>Conceptos venta: {formatEuroAmount(row.conceptosVenta)}</span>
      <span>Base compra: {formatEuroAmount(row.compraBaseImponible)}</span>
      <span>IVA compra: {formatEuroAmount(row.ivaCompra)}</span>
      <span>Compra factura: {formatEuroAmount(row.compraFactura)}</span>
      <span>Base venta: {formatEuroAmount(row.ventaBaseImponible)}</span>
      <span>IVA venta: {formatEuroAmount(row.ivaVenta)}</span>
      <span>Venta factura: {formatEuroAmount(row.ventaFactura)}</span>
      <span>Neto factura: {formatEuroAmount(row.netoFactura)}</span>
      <span>Neto base: {formatEuroAmount(row.netoBaseImponible)}</span>
      <span>Neto analítico: {formatEuroAmount(row.netoAnalitico)}</span>
      <span>Factura Compra: {formatEuroAmount(row.facturaCompra)}</span>
      <span>Factura Venta: {formatEuroAmount(row.facturaVenta)}</span>
      <span>Descuadre: {formatEuroAmount(row.descuadre)}</span>
    </div>
  );
}

function formatReerEstado(value: OmieReerEstado) {
  const labels: Record<OmieReerEstado, string> = {
    SIN_DATOS_REER: "Sin datos REER",
    ESTIMADO_PUBLICO: "Estimado publico",
    ESTIMADO_CON_DIFERENCIA: "Estimado con diferencia",
    CONCILIADO_OFICIAL: "Conciliado oficial",
    DIFERENCIA_OFICIAL: "Diferencia oficial"
  };
  return labels[value] ?? value;
}

function formatCoefficient(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? "-" : formatFixedDecimalNumber(value, 6);
}

function formatNumber(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : formatFixedDecimalNumber(numeric, 2);
}

function calculateDisplayNetoFactura(compraFactura: number | null, ventaFactura: number | null) {
  if (compraFactura === null || ventaFactura === null || !Number.isFinite(compraFactura) || !Number.isFinite(ventaFactura)) {
    return null;
  }
  return Math.round((compraFactura - ventaFactura + Number.EPSILON) * 100) / 100;
}

function calculateDisplayIva(baseImponible: number | null) {
  if (baseImponible === null || !Number.isFinite(baseImponible)) {
    return null;
  }
  return Math.round((baseImponible * 0.21 + Number.EPSILON) * 100) / 100;
}

function nullableEuroSum(values: Array<number | null | undefined>) {
  const present = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  if (present.length === 0) {
    return null;
  }
  return Math.round((present.reduce((sum, value) => sum + value, 0) + Number.EPSILON) * 100) / 100;
}

function normalizeNumericValue(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}
