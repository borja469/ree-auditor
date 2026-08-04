import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { OmieAnalisisService } from "../omie-analisis/omie-analisis.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  addDays,
  buildGuaranteeRows,
  calculateGuaranteeDateRange,
  enumerateDateKeys,
  formatDateKey,
  formatSpanishDateKey,
  parseDateKey
} from "./guarantee-calculation.core";
import type { DepositedGuarantee, GuaranteeCalculatorResponse, MeffGuaranteePrice, OmieGuaranteeDayData } from "./types/guarantee-calculation.types";

@Injectable()
export class OmieGuaranteesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly omieAnalisisService: OmieAnalisisService
  ) {}

  async calculate(referenceDate: string): Promise<GuaranteeCalculatorResponse> {
    const range = calculateGuaranteeDateRange(referenceDate);
    const omieHistoryStart = await this.findOmieHistoryStart(addDays(parseDateKey(range.startDate), -7));
    const [omieDays, meffPrices, guaranteeAdjustments] = await Promise.all([
      this.loadOmieDays(omieHistoryStart, parseDateKey(range.endDate)),
      this.loadMeffPrices(range.startDate, range.endDate),
      this.loadGuaranteeAdjustments(range.startDate, range.endDate)
    ]);
    return buildGuaranteeRows({ referenceDate, omieDays, meffPrices, depositedGuarantees: guaranteeAdjustments.depositedGuarantees, prepaidPayments: guaranteeAdjustments.prepaidPayments });
  }

  async saveDepositedGuarantee(input: { date: string; amount: number | null }): Promise<DepositedGuarantee> {
    const date = parseDateKey(input.date);
    if (input.amount === null) {
      const existing = await this.prisma.omieGuaranteeDeposited.findUnique({ where: { date }, select: { prepaidPayment: true } });
      if (!existing?.prepaidPayment) {
        await this.prisma.omieGuaranteeDeposited.delete({ where: { date } }).catch(() => null);
        return { date: input.date, amount: null, prepaidPayment: null, updatedAt: new Date().toISOString() };
      }
      const updated = await this.prisma.omieGuaranteeDeposited.update({
        where: { date },
        data: { amount: null }
      });
      return adjustmentDto(updated);
    }
    const row = await this.prisma.omieGuaranteeDeposited.upsert({
      where: { date },
      create: {
        date,
        amount: new Prisma.Decimal(input.amount.toFixed(2))
      },
      update: {
        amount: new Prisma.Decimal(input.amount.toFixed(2))
      }
    });
    return adjustmentDto(row);
  }

  async savePrepaidPayment(input: { date: string; amount: number | null }): Promise<DepositedGuarantee> {
    const date = parseDateKey(input.date);
    if (input.amount === null) {
      const existing = await this.prisma.omieGuaranteeDeposited.findUnique({ where: { date }, select: { amount: true } });
      if (!existing?.amount) {
        await this.prisma.omieGuaranteeDeposited.delete({ where: { date } }).catch(() => null);
        return { date: input.date, amount: null, prepaidPayment: null, updatedAt: new Date().toISOString() };
      }
      const updated = await this.prisma.omieGuaranteeDeposited.update({
        where: { date },
        data: { prepaidPayment: null }
      });
      return adjustmentDto(updated);
    }
    const row = await this.prisma.omieGuaranteeDeposited.upsert({
      where: { date },
      create: {
        date,
        prepaidPayment: new Prisma.Decimal(input.amount.toFixed(2))
      },
      update: {
        prepaidPayment: new Prisma.Decimal(input.amount.toFixed(2))
      }
    });
    return adjustmentDto(row);
  }

  async export(referenceDate: string) {
    const calculation = await this.calculate(referenceDate);
    const workbook = XLSX.utils.book_new();
    const metaRows = [
      ["Fecha de referencia", formatSpanishDateKey(calculation.referenceDate)],
      ["Fecha inicial", formatSpanishDateKey(calculation.startDate)],
      ["Fecha final", formatSpanishDateKey(calculation.endDate)],
      ["Volumen total MWh", calculation.summary.totalVolume],
      ["Facturacion total EUR", calculation.summary.totalInvoicing],
      ["Dias volumen real", calculation.summary.daysWithRealVolume],
      ["Dias volumen sustituido", calculation.summary.daysWithSubstitutedVolume],
      ["Dias precio OMIE", calculation.summary.daysWithOmiePrice],
      ["Dias precio MEFF", calculation.summary.daysWithMeffPrice],
      ["Dias con datos pendientes", calculation.summary.daysWithMissingData]
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(metaRows), "Resumen");
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        calculation.rows.map((row) => ({
          Fecha: row.displayDate,
          Dia: row.weekday,
          Volumen: row.volume,
          "Origen volumen": row.volumeSource,
          "Fecha origen volumen": row.volumeSourceDate ? formatSpanishDateKey(row.volumeSourceDate) : "",
          Precio: row.price,
          "Origen precio": row.priceSource,
          "Publicacion MEFF": row.pricePublicationDate ? formatSpanishDateKey(row.pricePublicationDate) : "",
          "Codigo MEFF": row.meffCode ?? "",
          "Importe facturacion": row.invoicingAmount,
          "Tipo importe": row.invoicingSource,
          "Fact. acumulada": row.accumulatedInvoicing,
          "Garantias depositadas": row.depositedGuarantee,
          "Pago anticipado": row.prepaidPayment,
          "Garantia disponible": row.availableGuarantee,
          Advertencias: row.warnings.join(" | ")
        }))
      ),
      "Matriz"
    );
    return {
      fileName: `garantias_OMIE_${referenceDate.replace(/-/g, "")}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      content: XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer
    };
  }

  private async loadOmieDays(start: Date, end: Date) {
    const months = enumerateMonthKeys(formatDateKey(start), formatDateKey(end));
    const monthly = await Promise.all(months.map((month) => this.omieAnalisisService.obtenerComprobacionLiquidaciones(month.year, month.month)));
    const map = new Map<string, OmieGuaranteeDayData>();
    for (const response of monthly) {
      for (const day of response.detalleDiario) {
        if (day.fechaIso < formatDateKey(start) || day.fechaIso > formatDateKey(end)) {
          continue;
        }
        const volume = nullableSum([day.energiaMd, day.energiaIda1, day.energiaIda2, day.energiaIda3, day.energiaXbid]);
        map.set(day.fechaIso, {
          date: day.fechaIso,
          volume,
          costWithoutTax: day.netoBaseImponible
        });
      }
    }
    return map;
  }

  private async findOmieHistoryStart(fallback: Date) {
    const [programs, transactions] = await Promise.all([
      this.prisma.omiePrograma.aggregate({
        _min: {
          fechaPrograma: true
        }
      }),
      this.prisma.omieTransactionStaging.aggregate({
        _min: {
          diaContrato: true
        }
      })
    ]);
    const dates = [programs._min.fechaPrograma, transactions._min.diaContrato].filter((date): date is Date => date instanceof Date);
    return dates.length === 0 ? fallback : new Date(Math.min(...dates.map((date) => date.getTime())));
  }

  private async loadGuaranteeAdjustments(startDate: string, endDate: string) {
    const rows = await this.prisma.omieGuaranteeDeposited.findMany({
      where: {
        date: {
          gte: parseDateKey(startDate),
          lte: parseDateKey(endDate)
        }
      },
      select: {
        date: true,
        amount: true,
        prepaidPayment: true
      }
    });
    return {
      depositedGuarantees: new Map(rows.flatMap((row) => (row.amount === null ? [] : [[formatDateKey(row.date), Number(row.amount.toString())]]))),
      prepaidPayments: new Map(rows.flatMap((row) => (row.prepaidPayment === null ? [] : [[formatDateKey(row.date), Number(row.prepaidPayment.toString())]])))
    };
  }

  private async loadMeffPrices(startDate: string, endDate: string) {
    const dates = enumerateDateKeys(startDate, endDate);
    const missingMap = new Map(dates.map((date) => [date, { price: null, publicationDate: null, code: null } satisfies MeffGuaranteePrice]));
    const rows = await this.prisma.pricingMeffPrice.findMany({
      orderBy: {
        fechaPublicacion: "desc"
      },
      select: {
        fechaPublicacion: true,
        cod: true,
        tipo: true,
        clase: true,
        periodo: true,
        entrega: true,
        precio: true
      }
    });
    return rows.length === 0 ? missingMap : buildDailySwapPriceMap(dates, rows);
  }
}

function enumerateMonthKeys(startDate: string, endDate: string) {
  const start = parseDateKey(`${startDate.slice(0, 7)}-01`);
  const end = parseDateKey(`${endDate.slice(0, 7)}-01`);
  const months: Array<{ year: number; month: number }> = [];
  for (let cursor = start; cursor <= end; cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))) {
    months.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
  }
  return months;
}

function nullableSum(values: Array<number | null>) {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return present.length > 0 ? Number(present.reduce((sum, value) => sum + value, 0).toFixed(6)) : null;
}

function adjustmentDto(row: { date: Date; amount: Prisma.Decimal | null; prepaidPayment: Prisma.Decimal | null; updatedAt: Date }): DepositedGuarantee {
  return {
    date: formatDateKey(row.date),
    amount: row.amount === null ? null : Number(row.amount.toString()),
    prepaidPayment: row.prepaidPayment === null ? null : Number(row.prepaidPayment.toString()),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function buildDailySwapPriceMap(
  dates: string[],
  rows: Array<{
    fechaPublicacion: Date;
    cod: string;
    tipo: string | null;
    clase: string | null;
    periodo: string | null;
    entrega: string | null;
    precio: Prisma.Decimal | number | null;
  }>
) {
  const byDate = new Map<string, MeffGuaranteePrice>();
  for (const row of rows) {
    const product = toDailySwapProduct(row);
    if (!product || byDate.has(product.date)) {
      continue;
    }
    byDate.set(product.date, {
      price: product.price,
      publicationDate: formatDateKey(row.fechaPublicacion),
      code: product.code
    });
  }
  return new Map(dates.map((date) => [date, byDate.get(date) ?? ({ price: null, publicationDate: null, code: null } satisfies MeffGuaranteePrice)]));
}

export function toDailySwapProduct(row: {
  cod: string;
  tipo: string | null;
  clase: string | null;
  periodo: string | null;
  entrega: string | null;
  precio: Prisma.Decimal | number | null;
}) {
  const price = row.precio === null ? null : Number(row.precio);
  if (price === null || !Number.isFinite(price)) {
    return null;
  }
  const values = [row.cod, row.entrega, row.periodo, row.tipo, row.clase].filter((value): value is string => Boolean(value));
  if (!isBaseDailySwap(values)) {
    return null;
  }
  const date = parseDeliveryDate(values);
  return date ? { date, code: row.cod, price } : null;
}

function isBaseDailySwap(values: string[]) {
  const normalized = values.map(normalizeText);
  return (
    normalized.some((value) => /\bbase\b/.test(value)) &&
    normalized.some((value) => /\bswaps?\b/.test(value)) &&
    normalized.some((value) => /\b(?:diario|daily|day|dia)\b/.test(value))
  );
}

function parseDeliveryDate(values: string[]) {
  for (const value of values) {
    const normalized = normalizeText(value);
    const iso = /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/.exec(normalized);
    if (iso) {
      return normalizeDateParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    }
    const spanish = /\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/.exec(normalized);
    if (spanish) {
      return normalizeDateParts(normalizeYear(spanish[3]), Number(spanish[2]), Number(spanish[1]));
    }
    const monthText = /\b(\d{1,2})[-/\s]*([a-z]{3,})[-/\s]*(\d{2,4})\b/.exec(normalized);
    if (monthText) {
      const month = MONTH_ALIASES.get(monthText[2].slice(0, 4)) ?? MONTH_ALIASES.get(monthText[2].slice(0, 3));
      if (month) {
        return normalizeDateParts(normalizeYear(monthText[3]), month, Number(monthText[1]));
      }
    }
  }
  return null;
}

const MONTH_ALIASES = new Map<string, number>([
  ["jan", 1],
  ["ene", 1],
  ["feb", 2],
  ["mar", 3],
  ["apr", 4],
  ["abr", 4],
  ["may", 5],
  ["jun", 6],
  ["jul", 7],
  ["aug", 8],
  ["ago", 8],
  ["sep", 9],
  ["sept", 9],
  ["oct", 10],
  ["nov", 11],
  ["dec", 12],
  ["dic", 12]
]);

function normalizeDateParts(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return formatDateKey(date);
}

function normalizeYear(value: string) {
  const year = Number(value);
  return year < 100 ? 2000 + year : year;
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Ã±/g, "n")
    .trim()
    .toLowerCase();
}
