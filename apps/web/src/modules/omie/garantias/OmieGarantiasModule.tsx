import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, Info, FileSpreadsheet, Minus, Plus } from "lucide-react";
import { InlineLoading } from "../../../GlobalLoadingOverlay";
import { downloadOmieGuaranteeCalculator, getOmieGuaranteeCalculator, saveOmieDepositedGuarantee, saveOmiePrepaidPayment, type GuaranteeCalculatorResponse, type GuaranteeCalculatorRow } from "../../../api";
import { downloadBlob } from "../../../components/technical-data-table/TechnicalDataTableHelpers";
import { getTodayInputValue } from "../../../app-shell/AppState";
import { formatFixedDecimalNumber, parseEuroInputValue } from "../liquidaciones/OmieLiquidacionesHelpers";

export function OmieGarantiasModule() {
  const [referenceDate, setReferenceDate] = useState(getTodayInputValue);
  const [calculation, setCalculation] = useState<GuaranteeCalculatorResponse>();
  const [adjustments, setAdjustments] = useState<Record<string, GuaranteeRowAdjustment>>({});
  const [depositDrafts, setDepositDrafts] = useState<Record<string, string>>({});
  const [prepaidDrafts, setPrepaidDrafts] = useState<Record<string, string>>({});
  const savedDeposits = useRef<Record<string, number | null>>({});
  const savedPrepaids = useRef<Record<string, number | null>>({});
  const [savingDepositDates, setSavingDepositDates] = useState<Set<string>>(() => new Set());
  const [savingPrepaidDates, setSavingPrepaidDates] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const visibleCalculation = useMemo(() => (calculation ? applyRowAdjustments(calculation, adjustments) : undefined), [calculation, adjustments]);

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
    setAdjustments({});
  }, [referenceDate]);

  useEffect(() => {
    if (!calculation) {
      setDepositDrafts({});
      setPrepaidDrafts({});
      savedDeposits.current = {};
      savedPrepaids.current = {};
      return;
    }
    setDepositDrafts(
      Object.fromEntries(calculation.rows.map((row) => [row.date, row.depositedGuarantee === null ? "" : formatFixedDecimalNumber(row.depositedGuarantee, 2)]))
    );
    setPrepaidDrafts(
      Object.fromEntries(calculation.rows.map((row) => [row.date, row.prepaidPayment === null ? "" : formatFixedDecimalNumber(row.prepaidPayment, 2)]))
    );
    savedDeposits.current = Object.fromEntries(calculation.rows.map((row) => [row.date, row.depositedGuarantee]));
    savedPrepaids.current = Object.fromEntries(calculation.rows.map((row) => [row.date, row.prepaidPayment]));
  }, [calculation]);

  async function exportExcel() {
    const blob = await downloadOmieGuaranteeCalculator(referenceDate);
    downloadBlob(`garantias_OMIE_${referenceDate.replace(/-/g, "")}.xlsx`, blob, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }

  function updateDepositDraft(date: string, value: string) {
    setDepositDrafts((current) => ({ ...current, [date]: value }));
  }

  function updatePrepaidDraft(date: string, value: string) {
    setPrepaidDrafts((current) => ({ ...current, [date]: value }));
  }

  function stepAdjustment(date: string, field: keyof GuaranteeRowAdjustment, step: number) {
    setAdjustments((current) => {
      const currentRow = current[date] ?? emptyAdjustment;
      const nextRow = { ...currentRow, [field]: (currentRow[field] ?? 0) + step };
      if (nextRow.volumeDelta === 0 && nextRow.priceDelta === 0) {
        const rest = { ...current };
        delete rest[date];
        return rest;
      }
      return { ...current, [date]: nextRow };
    });
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

  async function savePrepaid(date: string) {
    const draft = prepaidDrafts[date] ?? "";
    const parsed = parseEuroInputValue(draft);
    if (parsed !== null && parsed < 0) {
      setError("El pago anticipado debe ser mayor o igual que cero.");
      setPrepaidDrafts((current) => ({ ...current, [date]: savedPrepaids.current[date] === null ? "" : formatFixedDecimalNumber(savedPrepaids.current[date] ?? 0, 2) }));
      return;
    }
    const previous = savedPrepaids.current[date] ?? null;
    if (parsed === previous) {
      setPrepaidDrafts((current) => ({ ...current, [date]: parsed === null ? "" : formatFixedDecimalNumber(parsed, 2) }));
      return;
    }
    setSavingPrepaidDates((current) => new Set(current).add(date));
    setError(undefined);
    try {
      const saved = await saveOmiePrepaidPayment(date, parsed);
      savedPrepaids.current[date] = saved.prepaidPayment;
      setPrepaidDrafts((current) => ({ ...current, [date]: saved.prepaidPayment === null ? "" : formatFixedDecimalNumber(saved.prepaidPayment, 2) }));
      setCalculation((current) => (current ? applyPrepaidPayment(current, date, saved.prepaidPayment) : current));
    } catch (err) {
      setPrepaidDrafts((current) => ({ ...current, [date]: previous === null ? "" : formatFixedDecimalNumber(previous, 2) }));
      setError(err instanceof Error ? err.message : "No se pudo guardar el pago anticipado.");
    } finally {
      setSavingPrepaidDates((current) => {
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

      <div className="panel wide omie-guarantees-table-panel">
        <div className="ops-table-head">
          <strong>Matriz diaria</strong>
          <span>{loading ? "Actualizando..." : `${visibleCalculation?.rows.length ?? 0} dias`}</span>
        </div>
        <div className="table-scroll">
          <table className="ree-download-table omie-guarantees-table">
            <colgroup>
              <col className="guarantee-col-date" />
              <col className="guarantee-col-day" />
              <col className="guarantee-col-volume" />
              <col className="guarantee-col-price" />
              <col className="guarantee-col-amount" />
              <col className="guarantee-col-accumulated" />
              <col className="guarantee-col-deposited" />
              <col className="guarantee-col-prepaid" />
              <col className="guarantee-col-available" />
            </colgroup>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Dia</th>
                <th className="number">Volumen (MWh)</th>
                <th className="number">Precio (EUR/MWh)</th>
                <th className="number">Importe (EUR)</th>
                <th className="number">Fact. acum. (EUR)</th>
                <th className="number">Garantias (EUR)</th>
                <th className="number">Pago ant. (EUR)</th>
                <th className="number">Disponible (EUR)</th>
              </tr>
            </thead>
            <tbody>
              {(visibleCalculation?.rows ?? []).map((row) => (
                <GuaranteeRow
                  adjustment={adjustments[row.date] ?? emptyAdjustment}
                  depositDraft={depositDrafts[row.date] ?? ""}
                  key={row.date}
                  onDepositBlur={() => void saveDeposit(row.date)}
                  onDepositChange={(value) => updateDepositDraft(row.date, value)}
                  onPriceStep={(step) => stepAdjustment(row.date, "priceDelta", step)}
                  onPrepaidBlur={() => void savePrepaid(row.date)}
                  onPrepaidChange={(value) => updatePrepaidDraft(row.date, value)}
                  onVolumeStep={(step) => stepAdjustment(row.date, "volumeDelta", step)}
                  prepaidDraft={prepaidDrafts[row.date] ?? ""}
                  row={row}
                  savingDeposit={savingDepositDates.has(row.date)}
                  savingPrepaid={savingPrepaidDates.has(row.date)}
                />
              ))}
              {visibleCalculation && visibleCalculation.rows.length === 0 && (
                <tr>
                  <td colSpan={9}>Sin datos para la fecha seleccionada.</td>
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
  adjustment,
  depositDraft,
  prepaidDraft,
  savingDeposit,
  savingPrepaid,
  onDepositChange,
  onDepositBlur,
  onPrepaidChange,
  onPrepaidBlur,
  onVolumeStep,
  onPriceStep
}: {
  row: GuaranteeCalculatorRow;
  adjustment: GuaranteeRowAdjustment;
  depositDraft: string;
  prepaidDraft: string;
  savingDeposit: boolean;
  savingPrepaid: boolean;
  onDepositChange: (value: string) => void;
  onDepositBlur: () => void;
  onPrepaidChange: (value: string) => void;
  onPrepaidBlur: () => void;
  onVolumeStep: (step: number) => void;
  onPriceStep: (step: number) => void;
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
        <MetricStepper
          disabled={row.volume === null}
          onStep={onVolumeStep}
          source={volumeSourceText(row, adjustment.volumeDelta)}
          tone={row.volumeSource === "REAL" ? "ok" : row.volumeSource === "PREVIOUS_WEEK" ? "warning" : "danger"}
          value={formatEnergy(row.volume)}
        />
      </td>
      <td className="number">
        <MetricStepper
          disabled={row.price === null}
          onStep={onPriceStep}
          source={priceSourceText(row, adjustment.priceDelta)}
          tone={row.priceSource === "OMIE" ? "ok" : row.priceSource === "MEFF" ? "warning" : "danger"}
          value={formatPrice(row.price)}
        />
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
          {savingDeposit && <span className="omie-factura-suffix">...</span>}
        </label>
      </td>
      <td className="number">
        <label className="omie-factura-input-shell guarantee-deposit-input-shell">
          <span className="sr-only">Pago anticipado {row.displayDate}</span>
          <input
            className="omie-factura-input"
            inputMode="decimal"
            min="0"
            onBlur={onPrepaidBlur}
            onChange={(event) => onPrepaidChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
            placeholder="0,00"
            type="text"
            value={prepaidDraft}
          />
          {savingPrepaid && <span className="omie-factura-suffix">...</span>}
        </label>
      </td>
      <td className={`number guarantee-available ${availableTone}`}>{formatCurrency(row.availableGuarantee)}</td>
    </tr>
  );
}

function MetricStepper({
  value,
  source,
  tone,
  disabled,
  onStep
}: {
  value: string;
  source: string;
  tone: "ok" | "warning" | "danger";
  disabled: boolean;
  onStep: (step: number) => void;
}) {
  return (
    <div className="guarantee-stepper-cell">
      <MetricWithSource value={value} source={source} tone={tone} />
      <div className="guarantee-stepper-actions">
        <button aria-label="Restar 1" disabled={disabled} onClick={() => onStep(-1)} title="Restar 1" type="button">
          <Minus size={13} />
        </button>
        <button aria-label="Sumar 1" disabled={disabled} onClick={() => onStep(1)} title="Sumar 1" type="button">
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}

function MetricWithSource({ value, source, tone }: { value: string; source: string; tone: "ok" | "warning" | "danger" }) {
  const tooltipId = useId();
  return (
    <div className="guarantee-metric">
      <strong>{value}</strong>
      <span className={`guarantee-source-info ${tone}`}>
        <button aria-describedby={tooltipId} aria-label={source} type="button">
          <Info size={13} />
        </button>
        <span className="guarantee-source-tooltip" id={tooltipId} role="tooltip">
          {source}
        </span>
      </span>
    </div>
  );
}

function volumeSourceText(row: GuaranteeCalculatorRow, delta = 0) {
  const suffix = delta === 0 ? "" : ` | Ajuste ${formatSignedNumber(delta, 0)} MWh`;
  if (row.volumeSource === "REAL") {
    return `Real${suffix}`;
  }
  if (row.volumeSource === "PREVIOUS_WEEK") {
    return `Semana anterior: ${row.volumeSourceDate ? formatDate(row.volumeSourceDate) : "-"}${suffix}`;
  }
  return `Sin dato${suffix}`;
}

function priceSourceText(row: GuaranteeCalculatorRow, delta = 0) {
  const suffix = delta === 0 ? "" : ` | Ajuste ${formatSignedNumber(delta, 0)} EUR/MWh`;
  if (row.priceSource === "OMIE") {
    return `Precio OMIE${suffix}`;
  }
  if (row.priceSource === "MEFF") {
    return `Precio MEFF${row.pricePublicationDate ? ` · Publicacion ${formatDate(row.pricePublicationDate)}` : ""}${suffix}`;
  }
  return `Sin dato${suffix}`;
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
  return value === null ? "-" : formatNumber(value, 2);
}

function formatPrice(value: number | null) {
  return value === null ? "-" : formatNumber(value, 2);
}

function formatCurrency(value: number | null) {
  return value === null ? "-" : formatNumber(value, 2);
}

function formatNumber(value: number, decimals: number) {
  return value.toLocaleString("es-ES", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatSignedNumber(value: number, decimals: number) {
  return `${value > 0 ? "+" : ""}${formatNumber(value, decimals)}`;
}

function applyDepositedGuarantee(calculation: GuaranteeCalculatorResponse, date: string, amount: number | null): GuaranteeCalculatorResponse {
  return {
    ...calculation,
    rows: calculation.rows.map((row) =>
      row.date === date
        ? {
            ...row,
            depositedGuarantee: amount
          }
        : row
    )
  };
}

function applyPrepaidPayment(calculation: GuaranteeCalculatorResponse, date: string, amount: number | null): GuaranteeCalculatorResponse {
  return {
    ...calculation,
    rows: calculation.rows.map((row) =>
      row.date === date
        ? {
            ...row,
            prepaidPayment: amount
          }
        : row
    )
  };
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

type GuaranteeRowAdjustment = {
  volumeDelta: number;
  priceDelta: number;
};

const emptyAdjustment: GuaranteeRowAdjustment = { volumeDelta: 0, priceDelta: 0 };
const GUARANTEE_IVA_RATE = 0.21;

function applyRowAdjustments(calculation: GuaranteeCalculatorResponse, adjustments: Record<string, GuaranteeRowAdjustment>): GuaranteeCalculatorResponse {
  let accumulated = 0;
  let accumulatedPrepaid = 0;
  const rows = calculation.rows.map((row) => {
    const adjustment = adjustments[row.date] ?? emptyAdjustment;
    const volume = row.volume === null ? null : roundEnergy(Math.max(0, row.volume + adjustment.volumeDelta));
    const price = row.price === null ? null : roundPrice(Math.max(0, row.price + adjustment.priceDelta));
    const hasAdjustment = adjustment.volumeDelta !== 0 || adjustment.priceDelta !== 0;
    const invoicingAmount = hasAdjustment && volume !== null && price !== null ? roundCurrency(volume * price * (1 + GUARANTEE_IVA_RATE)) : row.invoicingAmount;
    if (invoicingAmount !== null) {
      accumulated = roundCurrency(accumulated + invoicingAmount);
    }
    if (row.prepaidPayment !== null) {
      accumulatedPrepaid = roundCurrency(accumulatedPrepaid + row.prepaidPayment);
    }
    const effectiveAccumulated = roundCurrency(Math.max(0, accumulated - accumulatedPrepaid));
    return {
      ...row,
      volume,
      price,
      invoicingAmount,
      accumulatedInvoicing: accumulated,
      availableGuarantee: row.depositedGuarantee === null ? null : roundCurrency(row.depositedGuarantee - effectiveAccumulated)
    };
  });
  return {
    ...calculation,
    rows,
    summary: {
      ...calculation.summary,
      totalVolume: roundEnergy(rows.reduce((sum, row) => sum + (row.volume ?? 0), 0)),
      totalInvoicing: roundCurrency(rows.reduce((sum, row) => sum + (row.invoicingAmount ?? 0), 0))
    }
  };
}

function roundEnergy(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function roundPrice(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
