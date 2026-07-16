import type { GuaranteeCalculatorResponse, GuaranteeCalculatorRow, MeffGuaranteePrice, OmieGuaranteeDayData } from "./types/guarantee-calculation.types";

export const GUARANTEE_IVA_RATE = 0.21;

export function calculateGuaranteeDateRange(referenceDate: string) {
  const reference = parseDateKey(referenceDate);
  const monday = startOfIsoWeek(reference);
  const isEarlyWeek = reference.getUTCDay() === 1 || reference.getUTCDay() === 2;
  const start = isEarlyWeek ? addDays(monday, -7) : monday;
  const end = addDays(monday, isEarlyWeek ? 2 : 9);
  return {
    referenceDate: formatDateKey(reference),
    startDate: formatDateKey(start),
    endDate: formatDateKey(end)
  };
}

export function buildGuaranteeRows(params: {
  referenceDate: string;
  omieDays: Map<string, OmieGuaranteeDayData>;
  meffPrices: Map<string, MeffGuaranteePrice>;
  depositedGuarantees?: Map<string, number>;
  prepaidPayments?: Map<string, number>;
  ivaRate?: number;
}): GuaranteeCalculatorResponse {
  const range = calculateGuaranteeDateRange(params.referenceDate);
  const ivaRate = params.ivaRate ?? GUARANTEE_IVA_RATE;
  const dates = enumerateDateKeys(range.startDate, range.endDate);
  let accumulated = 0;
  let accumulatedPrepaid = 0;
  const rows: GuaranteeCalculatorRow[] = [];

  for (const date of dates) {
    const real = params.omieDays.get(date);
    const previousWeekDate = formatDateKey(addDays(parseDateKey(date), -7));
    const previousWeek = params.omieDays.get(previousWeekDate);
    const warnings: string[] = [];
    const realVolume = finiteOrNull(real?.volume);
    const realCost = finiteOrNull(real?.costWithoutTax);
    const volume =
      realVolume !== null
        ? realVolume
        : finiteOrNull(previousWeek?.volume);
    const volumeSource = realVolume !== null ? "REAL" : volume !== null ? "PREVIOUS_WEEK" : "MISSING";
    const volumeSourceDate = volumeSource === "PREVIOUS_WEEK" ? previousWeekDate : null;

    if (volumeSource === "PREVIOUS_WEEK") {
      warnings.push(`Volumen sustituido por ${formatSpanishDateKey(previousWeekDate)}.`);
    }
    if (volumeSource === "MISSING") {
      warnings.push("Sin volumen real ni volumen de la semana anterior.");
    }

    const omiePrice = realCost !== null && realVolume !== null && realVolume !== 0 ? roundPrice(realCost / realVolume) : null;
    const meff = params.meffPrices.get(date) ?? { price: null, publicationDate: null, code: null };
    const price = omiePrice ?? finiteOrNull(meff.price);
    const priceSource = omiePrice !== null ? "OMIE" : price !== null ? "MEFF" : "MISSING";
    if (priceSource === "MEFF") {
      warnings.push(`Precio MEFF ${meff.code ?? ""}${meff.publicationDate ? ` publicado ${formatSpanishDateKey(meff.publicationDate)}` : ""}.`.trim());
    }
    if (priceSource === "MISSING") {
      warnings.push("Sin precio OMIE ni precio MEFF aplicable.");
    }

    const realInvoicing = realCost === null ? null : roundEuro(realCost * (1 + ivaRate));
    const estimatedInvoicing = realInvoicing === null && volume !== null && price !== null ? roundEuro(volume * price * (1 + ivaRate)) : null;
    const invoicingAmount = realInvoicing ?? estimatedInvoicing;
    const invoicingSource = realInvoicing !== null ? "REAL" : estimatedInvoicing !== null ? "ESTIMATED" : "MISSING";
    if (invoicingSource === "ESTIMATED") {
      warnings.push("Importe estimado con volumen y precio efectivos.");
    }
    if (invoicingSource === "MISSING") {
      warnings.push("Importe no calculable.");
    } else if (invoicingAmount !== null) {
      accumulated = roundEuro(accumulated + invoicingAmount);
    }
    const depositedGuarantee = params.depositedGuarantees?.get(date) ?? null;
    const prepaidPayment = params.prepaidPayments?.get(date) ?? null;
    if (prepaidPayment !== null) {
      accumulatedPrepaid = roundEuro(accumulatedPrepaid + prepaidPayment);
    }
    const effectiveAccumulated = roundEuro(Math.max(0, accumulated - accumulatedPrepaid));

    rows.push({
      date,
      displayDate: formatSpanishDateKey(date),
      weekday: weekdayName(date),
      volume: volume === null ? null : roundEnergy(volume),
      volumeSource,
      volumeSourceDate,
      price,
      priceSource,
      pricePublicationDate: priceSource === "MEFF" ? meff.publicationDate : null,
      meffCode: priceSource === "MEFF" ? meff.code : null,
      invoicingAmount,
      invoicingSource,
      accumulatedInvoicing: accumulated,
      depositedGuarantee,
      prepaidPayment,
      availableGuarantee: depositedGuarantee === null ? null : roundEuro(depositedGuarantee - effectiveAccumulated),
      warnings
    });
  }

  return {
    ...range,
    rows,
    summary: {
      totalVolume: roundEnergy(sum(rows.map((row) => row.volume ?? 0))),
      totalInvoicing: roundEuro(sum(rows.map((row) => row.invoicingAmount ?? 0))),
      daysWithRealVolume: rows.filter((row) => row.volumeSource === "REAL").length,
      daysWithSubstitutedVolume: rows.filter((row) => row.volumeSource === "PREVIOUS_WEEK").length,
      daysWithOmiePrice: rows.filter((row) => row.priceSource === "OMIE").length,
      daysWithMeffPrice: rows.filter((row) => row.priceSource === "MEFF").length,
      daysWithMissingData: rows.filter((row) => row.volumeSource === "MISSING" || row.priceSource === "MISSING" || row.invoicingSource === "MISSING").length
    }
  };
}

export function enumerateDateKeys(startDate: string, endDate: string) {
  const dates: string[] = [];
  for (let cursor = parseDateKey(startDate), end = parseDateKey(endDate); cursor <= end; cursor = addDays(cursor, 1)) {
    dates.push(formatDateKey(cursor));
  }
  return dates;
}

export function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error("Fecha invalida. Use YYYY-MM-DD.");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("Fecha invalida.");
  }
  return date;
}

export function formatDateKey(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export function formatSpanishDateKey(value: string) {
  const date = parseDateKey(value);
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

export function weekdayName(value: string) {
  const date = parseDateKey(value);
  return ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"][date.getUTCDay()] ?? "";
}

export function addDays(value: Date, days: number) {
  const next = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfIsoWeek(value: Date) {
  const day = value.getUTCDay() || 7;
  return addDays(value, 1 - day);
}

function finiteOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function roundEnergy(value: number) {
  return Number(value.toFixed(6));
}

function roundPrice(value: number) {
  return Number(value.toFixed(6));
}

function roundEuro(value: number) {
  return Number(value.toFixed(2));
}
