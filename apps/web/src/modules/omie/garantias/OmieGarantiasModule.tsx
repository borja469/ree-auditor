import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, FileSpreadsheet } from "lucide-react";
import { InlineLoading } from "../../../GlobalLoadingOverlay";
import { downloadOmieGuaranteeCalculator, getOmieGuaranteeCalculator, saveOmieDepositedGuarantee, type GuaranteeCalculatorResponse, type GuaranteeCalculatorRow } from "../../../api";
import { downloadBlob } from "../../../components/technical-data-table/TechnicalDataTableHelpers";
import { getTodayInputValue } from "../../../app-shell/AppState";
import { formatFixedDecimalNumber, parseEuroInputValue } from "../liquidaciones/OmieLiquidacionesHelpers";

export function OmieGarantiasModule() {
  const [referenceDate, setReferenceDate] = useState(getTodayInputValue);
  const [calculation, setCalculation] = useState<GuaranteeCalculatorResponse>();
  const [depositDrafts, setDepositDrafts] = useState<Record<string, string>>({});
  const savedDeposits = useRef<Record<string, number | null>>({});
  const [savingDepositDates, setSavingDepositDates] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const rangeLabel = useMemo(
    () => (calculation ? `${formatDate(calculation.startDate)} - ${formatDate(calculation.endDate)}` : "Sin calcular"),
    [calculation]
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    getOmieGuaranteeCalculator(referenceDate)
      .then((response) => {
        if (!controller.signal.aborted) {
          setCalculation(response);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "No se pudo calcular la matriz de garantias.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [referenceDate]);

  useEffect(() => {
    if (!calculation) {
      setDepositDrafts({});
      savedDeposits.current = {};
      return;
    }
    setDepositDrafts(
      Object.fromEntries(calculation.rows.map((row) => [row.date, row.depositedGuarantee === null ? "" : formatFixedDecimalNumber(row.depositedGuarantee, 2)]))
    );
    savedDeposits.current = Object.fromEntries(calculation.rows.map((row) => [row.date, row.depositedGuarantee]));
  }, [calculation]);

  async function exportExcel() {
    const blob = await downloadOmieGuaranteeCalculator(referenceDate);
    downloadBlob(`garantias_OMIE_${referenceDate.replace(/-/g, "")}.xlsx`, blob, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }

  function updateDepositDraft(date: string, value: string) {
    setDepositDrafts((current) => ({ ...current, [date]: value }));
  }

  async function saveDeposit(date: string) {
    const draft = depositDrafts[date] ?? "";
    const parsed = parseEuroInputValue(draft);
    if (parsed !== null && parsed < 0) {
      setError("Las garantias depositadas deben ser mayores o iguales que cero.");
      setDepositDrafts((current) => ({ ...current, [date]: savedDeposits.current[date] === null ? "" : formatFixedDecimalNumber(savedDeposits.current[date] ?? 0, 2) }));
      return;
    }
    const previous = savedDeposits.current[date] ?? null;
    if (parsed === previous) {
      setDepositDrafts((current) => ({ ...current, [date]: parsed === null ? "" : formatFixedDecimalNumber(parsed, 2) }));
      return;
    }
    setSavingDepositDates((current) => new Set(current).add(date));
    setError(undefined);
    try {
      const saved = await saveOmieDepositedGuarantee(date, parsed);
      savedDeposits.current[date] = saved.amount;
      setDepositDrafts((current) => ({ ...current, [date]: saved.amount === null ? "" : formatFixedDecimalNumber(saved.amount, 2) }));
      setCalculation((current) => (current ? applyDepositedGuarantee(current, date, saved.amount) : current));
    } catch (err) {
      setDepositDrafts((current) => ({ ...current, [date]: previous === null ? "" : formatFixedDecimalNumber(previous, 2) }));
      setError(err instanceof Error ? err.message : "No se pudieron guardar las garantias depositadas.");
    } finally {
      setSavingDepositDates((current) => {
        const next = new Set(current);
        next.delete(date);
        return next;
      });
    }
  }

  return (
    <section className="content-grid omie-guarantees">
      <div className="panel wide omie-guarantees-header">
        <div>
          <p className="eyebrow">OMIE Garantias</p>
          <h2>Calculadora de garantias</h2>
          <span>Necesidades diarias por volumen comprado, precio final efectivo y facturacion acumulada.</span>
        </div>
        <div className="omie-guarantees-actions">
          <label className="filter-field">
            <span>Fecha referencia</span>
            <input type="date" value={referenceDate} onChange={(event) => setReferenceDate(event.target.value)} />
          </label>
          <button className="primary-button" disabled={!calculation || loading} onClick={exportExcel} type="button">
            <FileSpreadsheet size={16} />
            Excel
          </button>
        </div>
      </div>

      {error && <div className="status-message error">{error}</div>}
      {loading && !calculation && <InlineLoading label="Calculando garantias OMIE" />}

      <div className="technical-kpis omie-guarantees-kpis">
        <div className="technical-kpi"><span>Rango</span><strong>{rangeLabel}</strong><small>dias naturales</small></div>
        <div className="technical-kpi"><span>Volumen total</span><strong>{formatEnergy(calculation?.summary.totalVolume ?? null)}</strong><small>MWh efectivos</small></div>
        <div className="technical-kpi"><span>Facturacion total</span><strong>{formatCurrency(calculation?.summary.totalInvoicing ?? null)}</strong><small>IVA incluido</small></div>
        <div className="technical-kpi warning"><span>Volumen sustituido</span><strong>{calculation?.summary.daysWithSubstitutedVolume ?? 0}</strong><small>dias</small></div>
        <div className="technical-kpi warning"><span>Precio MEFF</span><strong>{calculation?.summary.daysWithMeffPrice ?? 0}</strong><small>dias</small></div>
        <div className={`technical-kpi ${(calculation?.summary.daysWithMissingData ?? 0) > 0 ? "danger" : "good"}`}><span>Pendientes</span><strong>{calculation?.summary.daysWithMissingData ?? 0}</strong><small>dias</small></div>
      </div>

      <div className="panel wide omie-guarantees-table-panel">
        <div className="ops-table-head">
          <strong>Matriz diaria</strong>
          <span>{loading ? "Actualizando..." : `${calculation?.rows.length ?? 0} dias`}</span>
        </div>
        <div className="table-scroll">
          <table className="ree-download-table omie-guarantees-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Día</th>
                <th className="number">Volumen</th>
                <th className="number">Precio</th>
                <th className="number">Importe facturacion</th>
                <th className="number">Fact. acumulada hasta fecha</th>
                <th className="number">Garantías depositadas</th>
                <th className="number">Garantía disponible</th>
              </tr>
            </thead>
            <tbody>
              {(calculation?.rows ?? []).map((row) => (
                <GuaranteeRow
                  depositDraft={depositDrafts[row.date] ?? ""}
                  key={row.date}
                  onDepositBlur={() => void saveDeposit(row.date)}
                  onDepositChange={(value) => updateDepositDraft(row.date, value)}
                  row={row}
                  savingDeposit={savingDepositDates.has(row.date)}
                />
              ))}
              {calculation && calculation.rows.length === 0 && (
                <tr>
                  <td colSpan={8}>Sin datos para la fecha seleccionada.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function GuaranteeRow({
  row,
  depositDraft,
  savingDeposit,
  onDepositChange,
  onDepositBlur
}: {
  row: GuaranteeCalculatorRow;
  depositDraft: string;
  savingDeposit: boolean;
  onDepositChange: (value: string) => void;
  onDepositBlur: () => void;
}) {
  const hasWarnings = row.warnings.length > 0;
  const availableTone = row.availableGuarantee === null || row.availableGuarantee === 0 ? "neutral" : row.availableGuarantee < 0 ? "danger" : "ok";
  return (
    <tr className={hasWarnings ? "warning" : ""}>
      <td>
        <div className="guarantee-date-cell">
          <CalendarDays size={14} />
          <span>{row.displayDate}</span>
          {hasWarnings && <AlertTriangle size={14} />}
        </div>
      </td>
      <td>{row.weekday}</td>
      <td className="number">
        <MetricWithSource value={formatEnergy(row.volume)} source={volumeSourceText(row)} tone={row.volumeSource === "REAL" ? "ok" : row.volumeSource === "PREVIOUS_WEEK" ? "warning" : "danger"} />
      </td>
      <td className="number">
        <MetricWithSource value={formatPrice(row.price)} source={priceSourceText(row)} tone={row.priceSource === "OMIE" ? "ok" : row.priceSource === "MEFF" ? "warning" : "danger"} />
      </td>
      <td className="number">
        <MetricWithSource value={formatCurrency(row.invoicingAmount)} source={invoicingSourceText(row)} tone={row.invoicingSource === "REAL" ? "ok" : row.invoicingSource === "ESTIMATED" ? "warning" : "danger"} />
      </td>
      <td className="number">{formatCurrency(row.accumulatedInvoicing)}</td>
      <td className="number">
        <label className="omie-factura-input-shell guarantee-deposit-input-shell">
          <span className="sr-only">Garantias depositadas {row.displayDate}</span>
          <input
            className="omie-factura-input"
            inputMode="decimal"
            min="0"
            onBlur={onDepositBlur}
            onChange={(event) => onDepositChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
            placeholder="0,00"
            type="text"
            value={depositDraft}
          />
          <span className="omie-factura-suffix">{savingDeposit ? "..." : "€"}</span>
        </label>
      </td>
      <td className={`number guarantee-available ${availableTone}`}>{formatCurrency(row.availableGuarantee)}</td>
    </tr>
  );
}

function MetricWithSource({ value, source, tone }: { value: string; source: string; tone: "ok" | "warning" | "danger" }) {
  return (
    <div className="guarantee-metric">
      <strong>{value}</strong>
      <small className={tone}>{source}</small>
    </div>
  );
}

function volumeSourceText(row: GuaranteeCalculatorRow) {
  if (row.volumeSource === "REAL") {
    return "Real";
  }
  if (row.volumeSource === "PREVIOUS_WEEK") {
    return `Semana anterior: ${row.volumeSourceDate ? formatDate(row.volumeSourceDate) : "-"}`;
  }
  return "Sin dato";
}

function priceSourceText(row: GuaranteeCalculatorRow) {
  if (row.priceSource === "OMIE") {
    return "OMIE";
  }
  if (row.priceSource === "MEFF") {
    return `MEFF${row.pricePublicationDate ? ` · ${formatDate(row.pricePublicationDate)}` : ""}`;
  }
  return "Sin dato";
}

function invoicingSourceText(row: GuaranteeCalculatorRow) {
  if (row.invoicingSource === "REAL") {
    return "Real";
  }
  if (row.invoicingSource === "ESTIMATED") {
    return "Estimado";
  }
  return "No calculable";
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatEnergy(value: number | null) {
  return value === null ? "-" : `${formatNumber(value, 2)} MWh`;
}

function formatPrice(value: number | null) {
  return value === null ? "-" : `${formatNumber(value, 2)} €/MWh`;
}

function formatCurrency(value: number | null) {
  return value === null ? "-" : `${formatNumber(value, 2)} €`;
}

function formatNumber(value: number, decimals: number) {
  return value.toLocaleString("es-ES", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function applyDepositedGuarantee(calculation: GuaranteeCalculatorResponse, date: string, amount: number | null): GuaranteeCalculatorResponse {
  return {
    ...calculation,
    rows: calculation.rows.map((row) =>
      row.date === date
        ? {
            ...row,
            depositedGuarantee: amount,
            availableGuarantee: amount === null ? null : roundCurrency(amount - row.accumulatedInvoicing)
          }
        : row
    )
  };
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
