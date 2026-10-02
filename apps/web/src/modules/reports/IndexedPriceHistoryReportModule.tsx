import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Copy, FileText, X } from "lucide-react";
import { InlineLoading } from "../../GlobalLoadingOverlay";
import { getIndexedPriceHistory, recalculateIndexedPriceHistory, type BillingCostComponentCode, type IndexedPriceHistoryComponent, type IndexedPriceHistoryHourDetail, type IndexedPriceHistoryResponse } from "../../api";
import { PanelTitle } from "../shared/RestoredModuleCommon";

const DEFAULT_MONTHS = 12;

export function IndexedPriceHistoryReportModule() {
  const [filters, setFilters] = useState(() => defaultFilters());
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [report, setReport] = useState<IndexedPriceHistoryResponse>();
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string>();
  const [copiedRow, setCopiedRow] = useState<string>();
  const [selectedCell, setSelectedCell] = useState<{
    tariffCode: string;
    month: string;
    period: string;
    hours: IndexedPriceHistoryHourDetail[];
  } | null>(null);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(undefined);
    getIndexedPriceHistory(monthFiltersToDateRange(appliedFilters))
      .then((response) => {
        if (!ignore) {
          setReport(response);
          setSelectedCell(null);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "No se pudo cargar el historico de precios indexados.");
          setReport(undefined);
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [appliedFilters]);

  const hasData = Boolean(report && report.tariffs.length > 0);
  const actionsDisabled = loading || calculating || !filters.monthFrom || !filters.monthTo;

  async function refreshCalculation() {
    setCalculating(true);
    setError(undefined);
    try {
      const response = await recalculateIndexedPriceHistory(monthFiltersToDateRange(filters));
      setAppliedFilters(filters);
      setReport(response);
      setSelectedCell(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo recalcular el historico de precios indexados.");
    } finally {
      setCalculating(false);
    }
  }

  return (
    <section className="panel wide annual-report-panel indexed-price-history-panel">
      <div className="annual-report-header">
        <PanelTitle icon={<FileText size={18} />} title="Historico Precios Indexados" subtitle="Precio indexado energia por tarifa y periodo tarifario" />
        <div className="indexed-price-history-filters">
          <label>
            <span>Mes desde</span>
            <input type="month" value={filters.monthFrom} disabled={loading} onChange={(event) => setFilters((current) => ({ ...current, monthFrom: event.target.value }))} />
          </label>
          <label>
            <span>Mes hasta</span>
            <input type="month" value={filters.monthTo} disabled={loading} onChange={(event) => setFilters((current) => ({ ...current, monthTo: event.target.value }))} />
          </label>
          <button className="secondary-button compact" disabled={actionsDisabled} onClick={() => setAppliedFilters(filters)} type="button">
            Consultar guardado
          </button>
          <button className="primary-button compact" disabled={actionsDisabled} onClick={() => void refreshCalculation()} type="button">
            {calculating ? "Calculando..." : "Actualizar cálculo"}
          </button>
        </div>
      </div>

      {report?.calculatedAt && <div className="indexed-price-history-meta">Último cálculo: {formatDateTime(report.calculatedAt)}</div>}

      {loading && (
        <div className="annual-report-loading">
          <InlineLoading label="Cargando ultimo calculo guardado" />
        </div>
      )}
      {calculating && (
        <div className="annual-report-loading">
          <InlineLoading label="Calculando y guardando historico de precios" />
        </div>
      )}
      {error && <div className="form-message error">{error}</div>}

      {hasData && report && (
        <div className="annual-report-tables">
          {report.tariffs.map((tariff) => (
            <section className="annual-report-table-section" key={tariff.tariffCode}>
              <h3>Tarifa {tariff.tariffCode}</h3>
              <div className="table-scroll omie-annual-summary-scroll annual-report-table-shell">
                <table className="omie-liquidation-table omie-annual-summary-table annual-report-table indexed-price-history-table">
                  <thead>
                    <tr>
                      <th className="annual-report-sticky-col">Mes</th>
                      {tariff.periods.map((period) => <th key={period}>{period}</th>)}
                      <th>Copiar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tariff.rows.map((row) => {
                      const rowKey = `${tariff.tariffCode}-${row.month}`;
                      return (
                        <tr key={rowKey}>
                          <th className="annual-report-sticky-col" scope="row">{formatMonth(row.month)}</th>
                          {tariff.periods.map((period) => {
                            const value = row.values[period];
                            const detailKey = `${tariff.tariffCode}|${row.month}|${period}`;
                            const hours = tariff.details[detailKey] ?? [];
                            return (
                              <td className={`number ${value?.incidents?.length ? "indexed-price-warning" : ""}`} key={period}>
                                {value?.priceEurMwh === null || value?.priceEurMwh === undefined ? (
                                  ""
                                ) : (
                                  <button
                                    className="indexed-price-cell-button"
                                    onClick={() => setSelectedCell({ tariffCode: tariff.tariffCode, month: row.month, period, hours })}
                                    title={value.incidents.length ? value.incidents.join("; ") : "Ver detalle horario"}
                                    type="button"
                                  >
                                    {formatPrice(value.priceEurMwh)}
                                  </button>
                                )}
                              </td>
                            );
                          })}
                          <td className="number indexed-price-copy-cell">
                            <button
                              className={`icon-button indexed-price-copy-button ${copiedRow === rowKey ? "copied" : ""}`}
                              onClick={() => void copyIndexedPriceRow(tariff.periods.map((period) => row.values[period]?.priceEurMwh ?? null), rowKey, setCopiedRow)}
                              title={copiedRow === rowKey ? "Copiado" : "Copiar precios de la fila"}
                              type="button"
                            >
                              {copiedRow === rowKey ? <Check size={15} /> : <Copy size={15} />}
                              <span>{copiedRow === rowKey ? "Copiado" : "Copiar"}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      {!loading && !error && !hasData && (
        <div className="empty-state compact">
          <CalendarDays size={18} />
          <span>Sin cálculo guardado para el rango seleccionado. Usa Actualizar cálculo para generarlo.</span>
        </div>
      )}

      {selectedCell && <IndexedPriceDetailModal selection={selectedCell} onClose={() => setSelectedCell(null)} />}
    </section>
  );
}

function IndexedPriceDetailModal({ selection, onClose }: { selection: { tariffCode: string; month: string; period: string; hours: IndexedPriceHistoryHourDetail[] }; onClose: () => void }) {
  const componentLabels = useMemo(() => {
    const labels = new Map<BillingCostComponentCode, string>();
    for (const hour of selection.hours) {
      for (const component of hour.components) labels.set(component.componentCode, component.label);
    }
    return [...labels.entries()];
  }, [selection.hours]);

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card indexed-price-detail-modal" role="dialog" aria-modal="true" aria-label="Detalle precio indexado">
        <div className="modal-header">
          <div>
            <h3>{selection.tariffCode} - {formatMonth(selection.month)} - {selection.period}</h3>
            <p>Horas incluidas en el precio medio mensual del periodo.</p>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </div>
        <div className="table-scroll">
          <table className="omie-liquidation-table indexed-price-detail-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Hora</th>
                <th>Periodo</th>
                {componentLabels.map(([code, label]) => <th key={code}>{label}</th>)}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {selection.hours.map((hour) => {
                const components = new Map<BillingCostComponentCode, IndexedPriceHistoryComponent>(hour.components.map((component) => [component.componentCode, component]));
                return (
                  <tr key={`${hour.date}-${hour.hour}-${hour.period}`}>
                    <th scope="row">{formatDate(hour.date)}</th>
                    <td>{String(hour.hour).padStart(2, "0")}:00</td>
                    <td>{hour.period}</td>
                    {componentLabels.map(([code]) => <td className="number" key={code}>{formatNullablePrice(components.get(code)?.costEur ?? null)}</td>)}
                    <td className="number strong">{formatNullablePrice(hour.totalEurMwh)}</td>
                  </tr>
                );
              })}
              {selection.hours.length === 0 && <tr><td colSpan={componentLabels.length + 4}>Sin detalle horario para esta celda.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function defaultFilters() {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - DEFAULT_MONTHS + 1, 1);
  return { monthFrom: toMonthInput(startDate), monthTo: toMonthInput(now) };
}

function monthFiltersToDateRange(filters: { monthFrom: string; monthTo: string }) {
  return {
    dateFrom: `${filters.monthFrom}-01`,
    dateTo: lastDayOfMonth(filters.monthTo)
  };
}

function toMonthInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function lastDayOfMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber, 0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("es-ES");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

function formatMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("es-ES", { month: "short", year: "2-digit" }).replace(".", "");
}

function formatPrice(value: number) {
  return `${value.toLocaleString("es-ES", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €/MWh`;
}

function formatNullablePrice(value: number | null) {
  return value === null || value === undefined || !Number.isFinite(value) ? "" : value.toLocaleString("es-ES", { minimumFractionDigits: 5, maximumFractionDigits: 5 });
}

async function copyIndexedPriceRow(values: Array<number | null>, rowKey: string, setCopiedRow: (value: string | undefined) => void) {
  const text = values.map((value) => value === null || value === undefined || !Number.isFinite(value) ? "" : value.toLocaleString("es-ES", { minimumFractionDigits: 6, maximumFractionDigits: 6 })).join("\t");
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  } else {
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "true");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    document.body.removeChild(input);
  }
  setCopiedRow(rowKey);
  window.setTimeout(() => setCopiedRow(undefined), 1600);
}
