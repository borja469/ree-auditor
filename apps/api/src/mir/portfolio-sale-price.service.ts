import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const TARIFF_PERIODS: Record<string, string[]> = {
  "3.0TD": ["P1", "P2", "P3", "P4", "P5", "P6"],
  "2.0TD": ["P1", "P2", "P3"],
  "6.1TD": ["P1", "P2", "P3", "P4", "P5", "P6"]
};

@Injectable()
export class PortfolioSalePriceService {
  constructor(private readonly prisma: PrismaService) {}

  async listPrices(query: Record<string, unknown> = {}) {
    const yearFrom = parseOptionalInteger(query.yearFrom ?? query.fromYear);
    const yearTo = parseOptionalInteger(query.yearTo ?? query.toYear);
    const yearFilter =
      yearFrom !== null || yearTo !== null
        ? {
            year: {
              ...(yearFrom !== null ? { gte: yearFrom } : {}),
              ...(yearTo !== null ? { lte: yearTo } : {})
            }
          }
        : {};
    const where: Prisma.PricingPortfolioSalePriceWhereInput = {
      ...yearFilter
    };
    const surchargeWhere: Prisma.PricingPortfolioSaleSurchargeWhereInput = {
      ...yearFilter
    };
    const [rows, surcharges] = await Promise.all([
      this.prisma.pricingPortfolioSalePrice.findMany({
        where,
        orderBy: [{ year: "asc" }, { month: "asc" }, { tariff: "asc" }, { period: "asc" }]
      }),
      this.prisma.pricingPortfolioSaleSurcharge.findMany({
        where: surchargeWhere,
        orderBy: [{ year: "asc" }, { month: "asc" }, { tariff: "asc" }]
      })
    ]);
    return {
      rows: rows.map(serializeSalePrice),
      surcharges: surcharges.map(serializeSaleSurcharge),
      matrix: buildSalePriceMatrix(rows.map(serializeSalePrice), surcharges.map(serializeSaleSurcharge))
    };
  }

  async savePrices(body: unknown) {
    const rows = parseSalePriceInput(body);
    const surcharges = parseSaleSurchargeInput(body);
    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        await tx.pricingPortfolioSalePrice.upsert({
          where: {
            year_month_tariff_period: {
              year: row.year,
              month: row.month,
              tariff: row.tariff,
              period: row.period
            }
          },
          create: {
            year: row.year,
            month: row.month,
            tariff: row.tariff,
            period: row.period,
            priceEurMwh: row.priceEurMwh === null ? null : new Prisma.Decimal(row.priceEurMwh.toFixed(6)),
            source: "MANUAL"
          },
          update: {
            priceEurMwh: row.priceEurMwh === null ? null : new Prisma.Decimal(row.priceEurMwh.toFixed(6)),
            source: "MANUAL"
          }
        });
      }
      for (const row of surcharges) {
        await tx.pricingPortfolioSaleSurcharge.upsert({
          where: {
            year_month_tariff: {
              year: row.year,
              month: row.month,
              tariff: row.tariff
            }
          },
          create: {
            year: row.year,
            month: row.month,
            tariff: row.tariff,
            surchargeEurMwh: row.surchargeEurMwh === null ? null : new Prisma.Decimal(row.surchargeEurMwh.toFixed(6)),
            source: "MANUAL"
          },
          update: {
            surchargeEurMwh: row.surchargeEurMwh === null ? null : new Prisma.Decimal(row.surchargeEurMwh.toFixed(6)),
            source: "MANUAL"
          }
        });
      }
    });
    return { updated: rows.length, surchargesUpdated: surcharges.length };
  }
}

function serializeSalePrice(row: {
  id: string;
  year: number;
  month: number;
  tariff: string;
  period: string;
  priceEurMwh: Prisma.Decimal | null;
  source: string;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    year: row.year,
    month: row.month,
    tariff: row.tariff,
    period: row.period,
    priceEurMwh: row.priceEurMwh === null ? null : Number(row.priceEurMwh.toString()),
    source: row.source,
    updatedAt: row.updatedAt.toISOString()
  };
}

function serializeSaleSurcharge(row: {
  id: string;
  year: number;
  month: number;
  tariff: string;
  surchargeEurMwh: Prisma.Decimal | null;
  source: string;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    year: row.year,
    month: row.month,
    tariff: row.tariff,
    surchargeEurMwh: row.surchargeEurMwh === null ? null : Number(row.surchargeEurMwh.toString()),
    source: row.source,
    updatedAt: row.updatedAt.toISOString()
  };
}

function buildSalePriceMatrix(rows: ReturnType<typeof serializeSalePrice>[], surcharges: ReturnType<typeof serializeSaleSurcharge>[]) {
  const byKey = new Map(rows.map((row) => [`${row.year}|${row.month}|${row.tariff}|${row.period}`, row.priceEurMwh]));
  const surchargeByKey = new Map(surcharges.map((row) => [`${row.year}|${row.month}|${row.tariff}`, row.surchargeEurMwh]));
  const years = [...rows.map((row) => row.year), ...surcharges.map((row) => row.year)];
  const minYear = years.length ? Math.min(...years) : new Date().getFullYear();
  const maxYear = Math.max(years.length ? Math.max(...years) : minYear, new Date().getFullYear());
  const output: Array<{ year: number; month: number; prices: Record<string, number | null>; surcharges: Record<string, number | null> }> = [];
  for (let year = minYear; year <= maxYear; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const prices: Record<string, number | null> = {};
      const monthSurcharges: Record<string, number | null> = {};
      for (const [tariff, periods] of Object.entries(TARIFF_PERIODS)) {
        monthSurcharges[tariff] = surchargeByKey.get(`${year}|${month}|${tariff}`) ?? null;
        for (const period of periods) {
          prices[`${tariff}|${period}`] = byKey.get(`${year}|${month}|${tariff}|${period}`) ?? null;
        }
      }
      output.push({ year, month, prices, surcharges: monthSurcharges });
    }
  }
  return output;
}

function parseSalePriceInput(body: unknown) {
  const rows = body && typeof body === "object" && Array.isArray((body as { rows?: unknown }).rows) ? (body as { rows: unknown[] }).rows : null;
  if (!rows) {
    throw new BadRequestException("Debe informar rows.");
  }
  return rows.map((item) => {
    if (!item || typeof item !== "object") {
      throw new BadRequestException("Fila de precio no valida.");
    }
    const row = item as Record<string, unknown>;
    const year = parseRequiredInteger(row.year, "year");
    const month = parseRequiredInteger(row.month, "month");
    const tariff = typeof row.tariff === "string" ? row.tariff.trim() : "";
    const period = typeof row.period === "string" ? row.period.trim().toUpperCase() : "";
    if (month < 1 || month > 12) {
      throw new BadRequestException("month debe estar entre 1 y 12.");
    }
    if (!TARIFF_PERIODS[tariff]?.includes(period)) {
      throw new BadRequestException(`Periodo ${tariff} ${period} no valido.`);
    }
    return {
      year,
      month,
      tariff,
      period,
      priceEurMwh: parseNullableNumber(row.priceEurMwh ?? row.price)
    };
  });
}

function parseSaleSurchargeInput(body: unknown) {
  const rows = body && typeof body === "object" && Array.isArray((body as { surcharges?: unknown }).surcharges) ? (body as { surcharges: unknown[] }).surcharges : [];
  return rows.map((item) => {
    if (!item || typeof item !== "object") {
      throw new BadRequestException("Fila de recargo no valida.");
    }
    const row = item as Record<string, unknown>;
    const year = parseRequiredInteger(row.year, "year");
    const month = parseRequiredInteger(row.month, "month");
    const tariff = typeof row.tariff === "string" ? row.tariff.trim() : "";
    if (month < 1 || month > 12) {
      throw new BadRequestException("month debe estar entre 1 y 12.");
    }
    if (!TARIFF_PERIODS[tariff]) {
      throw new BadRequestException(`Tarifa ${tariff} no valida.`);
    }
    return {
      year,
      month,
      tariff,
      surchargeEurMwh: parseNullableSignedNumber(row.surchargeEurMwh ?? row.surcharge)
    };
  });
}

function parseRequiredInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new BadRequestException(`${label} debe ser entero.`);
  }
  return parsed;
}

function parseOptionalInteger(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new BadRequestException("Filtro de anyo no valido.");
  }
  return parsed;
}

function parseNullableNumber(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new BadRequestException("Precio no valido.");
  }
  return parsed;
}

function parseNullableSignedNumber(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException("Recargo no valido.");
  }
  return parsed;
}
