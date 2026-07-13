import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type MeffForwardCurveOrigin = "Mensual" | "Trimestral" | "Anual" | "Calculado";

export type MeffForwardCurveMonth = {
  year: number;
  month: number;
  key: string;
  label: string;
  price: number | null;
  origin: MeffForwardCurveOrigin | null;
  productCode: string | null;
  sourceProductCode: string | null;
  previous7DaysPrice: number | null;
  previous14DaysPrice: number | null;
  change7DaysPct: number | null;
  change14DaysPct: number | null;
};

export type MeffForwardCurve = {
  publicationDate: string | null;
  months: MeffForwardCurveMonth[];
};

type ProductKind = "monthly" | "quarterly" | "annual";

type ParsedProduct = {
  kind: ProductKind;
  year: number;
  month?: number;
  quarter?: number;
};

type CurveProduct = ParsedProduct & {
  code: string;
  price: number;
  productClass: "BASE";
  instrumentType: "Futuro";
};

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"] as const;
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

@Injectable()
export class MeffForwardCurveService {
  constructor(private readonly prisma: PrismaService) {}

  async buildNextTwelveMonths(referenceDate: string): Promise<MeffForwardCurve> {
    const latest = await this.prisma.pricingMeffPrice.findFirst({
      orderBy: { fechaPublicacion: "desc" },
      select: { fechaPublicacion: true }
    });
    const targetMonths = nextTwelveMonths(referenceDate);
    if (!latest) {
      return { publicationDate: null, months: targetMonths.map((month) => emptyMonth(month.year, month.month)) };
    }

    const rows = await this.prisma.pricingMeffPrice.findMany({
      where: { fechaPublicacion: latest.fechaPublicacion },
      select: {
        cod: true,
        tipo: true,
        clase: true,
        periodo: true,
        entrega: true,
        precio: true
      }
    });
    const products = rows
      .map((row) => toCurveProduct(row))
      .filter((product): product is CurveProduct => Boolean(product));
    const months = buildCurveMonths(targetMonths, products);
    const date7 = shiftDate(latest.fechaPublicacion, -7);
    const date14 = shiftDate(latest.fechaPublicacion, -14);
    const comparisons = await this.loadComparisons([date7, date14], months.map((month) => month.sourceProductCode).filter((code): code is string => Boolean(code)));
    return {
      publicationDate: latest.fechaPublicacion.toISOString().slice(0, 10),
      months: months.map((month) => addComparisons(month, comparisons, date7, date14))
    };
  }

  private async loadComparisons(dates: Date[], codes: string[]) {
    const uniqueCodes = [...new Set(codes)];
    if (uniqueCodes.length === 0) {
      return new Map<string, number | null>();
    }
    const comparisons = new Map<string, number | null>();
    await Promise.all(
      dates.map(async (date) => {
        const publication = await this.prisma.pricingMeffPrice.findFirst({
          where: { fechaPublicacion: { lte: date } },
          orderBy: { fechaPublicacion: "desc" },
          select: { fechaPublicacion: true }
        });
        const targetKey = date.toISOString().slice(0, 10);
        if (!publication) {
          return;
        }
        const rows = await this.prisma.pricingMeffPrice.findMany({
          where: {
            cod: { in: uniqueCodes },
            fechaPublicacion: publication.fechaPublicacion
          },
          select: {
            cod: true,
            precio: true
          }
        });
        for (const row of rows) {
          comparisons.set(`${row.cod}|${targetKey}`, row.precio === null ? null : Number(row.precio));
        }
      })
    );
    return comparisons;
  }
}

export function buildCurveMonths(targetMonths: Array<{ year: number; month: number }>, products: CurveProduct[]): MeffForwardCurveMonth[] {
  const monthly = new Map<string, CurveProduct>();
  const quarterly = new Map<string, CurveProduct>();
  const annual = new Map<number, CurveProduct>();
  for (const product of products) {
    if (product.kind === "monthly" && product.month) {
      monthly.set(monthKey(product.year, product.month), product);
    }
    if (product.kind === "quarterly" && product.quarter) {
      quarterly.set(`${product.year}|${product.quarter}`, product);
    }
    if (product.kind === "annual") {
      annual.set(product.year, product);
    }
  }

  const byKey = new Map<string, MeffForwardCurveMonth>();
  for (const target of targetMonths) {
    const product = monthly.get(monthKey(target.year, target.month));
    if (product) {
      byKey.set(monthKey(target.year, target.month), monthFromProduct(target.year, target.month, product.price, "Mensual", product.code, product.code));
    }
  }

  for (const [quarterKey, product] of quarterly.entries()) {
    const [yearText, quarterText] = quarterKey.split("|");
    const year = Number(yearText);
    const quarter = Number(quarterText);
    const months = quarterMonths(quarter).filter((month) => targetMonths.some((target) => target.year === year && target.month === month));
    if (months.length === 0) {
      continue;
    }
    const directMonthly = months
      .map((month) => byKey.get(monthKey(year, month)))
      .filter((month): month is MeffForwardCurveMonth => month?.origin === "Mensual" && month.price !== null);
    const missing = months.filter((month) => !byKey.has(monthKey(year, month)));
    if (missing.length === 0) {
      continue;
    }
    const remaining = product.price * 3 - directMonthly.reduce((sum, month) => sum + (month.price ?? 0), 0);
    const calculatedPrice = directMonthly.length === 0 ? product.price : remaining / missing.length;
    for (const month of missing) {
      byKey.set(
        monthKey(year, month),
        monthFromProduct(year, month, calculatedPrice, directMonthly.length === 0 ? "Trimestral" : "Calculado", product.code, product.code)
      );
    }
  }

  for (const target of targetMonths) {
    const key = monthKey(target.year, target.month);
    if (byKey.has(key)) {
      continue;
    }
    const product = annual.get(target.year);
    byKey.set(key, product ? monthFromProduct(target.year, target.month, product.price, "Anual", product.code, product.code) : emptyMonth(target.year, target.month));
  }

  return targetMonths.map((target) => byKey.get(monthKey(target.year, target.month)) ?? emptyMonth(target.year, target.month));
}

export function toCurveProduct(row: { cod: string; tipo: string | null; clase: string | null; periodo: string | null; entrega: string | null; precio: Prisma.Decimal | number | null }): CurveProduct | null {
  const price = row.precio === null ? null : Number(row.precio);
  if (price === null || !Number.isFinite(price)) {
    return null;
  }
  const values = [row.cod, row.entrega, row.periodo, row.tipo, row.clase].filter((value): value is string => Boolean(value));
  if (!isBaseFutureProduct(values)) {
    return null;
  }
  const parsed = parseProduct(values);
  return parsed ? { ...parsed, code: row.cod, price, productClass: "BASE", instrumentType: "Futuro" } : null;
}

function isBaseFutureProduct(values: string[]) {
  const normalized = values.map(normalizeText);
  return normalized.some((value) => /\bbase\b/.test(value)) && normalized.some((value) => /\bfut(?:uro|uros|ure|ures)?\b/.test(value));
}

function parseProduct(values: string[]): ParsedProduct | null {
  for (const value of values) {
    const text = normalizeText(value);
    const quarterly = /\bq\s*([1-4])\s*[-/]?\s*(\d{2,4})\b/i.exec(text);
    if (quarterly) {
      return { kind: "quarterly", quarter: Number(quarterly[1]), year: normalizeYear(quarterly[2]) };
    }

    const annual = /\b(?:cal|year|yr|ano)\s*[-/]?\s*(\d{2,4})\b/i.exec(text);
    if (annual) {
      return { kind: "annual", year: normalizeYear(annual[1]) };
    }

    const monthly = /\bm?\s*([a-z]{3,})\s*[-/]?\s*(\d{2,4})\b/i.exec(text);
    if (monthly) {
      const month = MONTH_ALIASES.get(monthly[1].slice(0, 4)) ?? MONTH_ALIASES.get(monthly[1].slice(0, 3));
      if (month) {
        return { kind: "monthly", month, year: normalizeYear(monthly[2]) };
      }
    }
  }
  return null;
}

function nextTwelveMonths(referenceDate: string) {
  const [year, month] = referenceDate.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month, 1));
  return Array.from({ length: 12 }, () => {
    const value = { year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 };
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    return value;
  });
}

function monthFromProduct(year: number, month: number, price: number, origin: MeffForwardCurveOrigin, productCode: string, sourceProductCode: string): MeffForwardCurveMonth {
  return {
    year,
    month,
    key: monthKey(year, month),
    label: monthLabel(year, month),
    price,
    origin,
    productCode,
    sourceProductCode,
    previous7DaysPrice: null,
    previous14DaysPrice: null,
    change7DaysPct: null,
    change14DaysPct: null
  };
}

function emptyMonth(year: number, month: number): MeffForwardCurveMonth {
  return {
    year,
    month,
    key: monthKey(year, month),
    label: monthLabel(year, month),
    price: null,
    origin: null,
    productCode: null,
    sourceProductCode: null,
    previous7DaysPrice: null,
    previous14DaysPrice: null,
    change7DaysPct: null,
    change14DaysPct: null
  };
}

function addComparisons(month: MeffForwardCurveMonth, comparisons: Map<string, number | null>, date7: Date, date14: Date): MeffForwardCurveMonth {
  if (!month.sourceProductCode || month.price === null) {
    return month;
  }
  const previous7DaysPrice = comparisons.get(`${month.sourceProductCode}|${date7.toISOString().slice(0, 10)}`) ?? null;
  const previous14DaysPrice = comparisons.get(`${month.sourceProductCode}|${date14.toISOString().slice(0, 10)}`) ?? null;
  return {
    ...month,
    previous7DaysPrice,
    previous14DaysPrice,
    change7DaysPct: percentageChange(month.price, previous7DaysPrice),
    change14DaysPct: percentageChange(month.price, previous14DaysPrice)
  };
}

function percentageChange(current: number | null, previous: number | null) {
  return current === null || previous === null || previous === 0 ? null : ((current - previous) / previous) * 100;
}

function shiftDate(date: Date, days: number) {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function quarterMonths(quarter: number) {
  const first = (quarter - 1) * 3 + 1;
  return [first, first + 1, first + 2];
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthLabel(year: number, month: number) {
  return `${MONTH_LABELS[month - 1]}-${String(year).slice(2)}`;
}

function normalizeYear(value: string) {
  const year = Number(value);
  return year < 100 ? 2000 + year : year;
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/g, "n")
    .trim()
    .toLowerCase();
}
