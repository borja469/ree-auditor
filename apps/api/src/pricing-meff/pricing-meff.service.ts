import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { parsePricingMeffWorkbook } from "./pricing-meff.parser";
import type { PricingMeffQuery, PricingMeffResponse, PricingMeffRow } from "./pricing-meff.types";

@Injectable()
export class PricingMeffService {
  constructor(private readonly prisma: PrismaService) {}

  async importFile(file: Express.Multer.File) {
    const parsed = parsePricingMeffWorkbook(file.buffer);
    let inserted = 0;
    let updated = 0;

    for (const row of parsed.rows) {
      const where = {
        fechaPublicacion_cod: {
          fechaPublicacion: row.fechaPublicacion,
          cod: row.cod
        }
      };
      const existing = await this.prisma.pricingMeffPrice.findUnique({ where, select: { id: true } });
      await this.prisma.pricingMeffPrice.upsert({
        where,
        create: {
          fechaPublicacion: row.fechaPublicacion,
          cod: row.cod,
          tipo: row.tipo,
          clase: row.clase,
          periodo: row.periodo,
          entrega: row.entrega,
          multiplicador: row.multiplicador,
          precio: row.precio === null ? null : new Prisma.Decimal(row.precio),
          rawPayloadJson: row.rawPayloadJson as Prisma.InputJsonObject
        },
        update: {
          tipo: row.tipo,
          clase: row.clase,
          periodo: row.periodo,
          entrega: row.entrega,
          multiplicador: row.multiplicador,
          precio: row.precio === null ? null : new Prisma.Decimal(row.precio),
          rawPayloadJson: row.rawPayloadJson as Prisma.InputJsonObject
        }
      });
      if (existing) {
        updated += 1;
      } else {
        inserted += 1;
      }
    }

    return {
      inserted,
      updated,
      errors: parsed.errors
    };
  }

  async list(query: PricingMeffQuery): Promise<PricingMeffResponse> {
    const where = buildWhere(query);
    const optionsWhere = buildOptionsWhere(query);
    const [total, rows, tipos, periodos, entregas, multiplicadores] = await Promise.all([
      this.prisma.pricingMeffPrice.count({ where }),
      this.prisma.pricingMeffPrice.findMany({
        where,
        orderBy: [{ fechaPublicacion: "desc" }, { cod: "asc" }],
        skip: query.skip,
        take: query.take
      }),
      this.prisma.pricingMeffPrice.findMany({ where: optionsWhere, distinct: ["tipo"], select: { tipo: true }, orderBy: { tipo: "asc" } }),
      this.prisma.pricingMeffPrice.findMany({ where: optionsWhere, distinct: ["periodo"], select: { periodo: true }, orderBy: { periodo: "asc" } }),
      this.prisma.pricingMeffPrice.findMany({ where: optionsWhere, distinct: ["entrega"], select: { entrega: true }, orderBy: { entrega: "asc" } }),
      this.prisma.pricingMeffPrice.findMany({ where: optionsWhere, distinct: ["multiplicador"], select: { multiplicador: true }, orderBy: { multiplicador: "asc" } })
    ]);
    const comparisonRows = await this.loadComparisonRows(rows.map((row) => ({ cod: row.cod, fechaPublicacion: row.fechaPublicacion })));
    return {
      total,
      rows: rows.map((row) => toResponseRow(row, comparisonRows)),
      filterOptions: {
        tipos: distinctTextValues(tipos.map((row) => row.tipo)),
        periodos: distinctTextValues(periodos.map((row) => row.periodo)),
        entregas: distinctTextValues(entregas.map((row) => row.entrega)),
        multiplicadores: distinctTextValues(multiplicadores.map((row) => row.multiplicador))
      }
    };
  }

  private async loadComparisonRows(rows: Array<{ cod: string; fechaPublicacion: Date }>) {
    if (rows.length === 0) {
      return new Map<string, { precio: number | null }>();
    }
    const targets = new Map<string, Date>();
    for (const row of rows) {
      targets.set(`${row.cod}|${shiftDate(row.fechaPublicacion, -7).toISOString().slice(0, 10)}`, shiftDate(row.fechaPublicacion, -7));
      targets.set(`${row.cod}|${shiftDate(row.fechaPublicacion, -14).toISOString().slice(0, 10)}`, shiftDate(row.fechaPublicacion, -14));
    }

    const found = await this.prisma.pricingMeffPrice.findMany({
      where: {
        OR: [...targets.entries()].map(([key, date]) => ({ cod: key.split("|")[0], fechaPublicacion: date }))
      },
      select: {
        cod: true,
        fechaPublicacion: true,
        precio: true
      }
    });

    return new Map(found.map((row) => [`${row.cod}|${row.fechaPublicacion.toISOString().slice(0, 10)}`, { precio: decimalToNumber(row.precio) }]));
  }
}

export function defaultPricingMeffQuery(input: Partial<Record<string, unknown>>): PricingMeffQuery {
  return {
    fechaPublicacionDesde: stringValue(input.fechaPublicacionDesde),
    fechaPublicacionHasta: stringValue(input.fechaPublicacionHasta),
    tipo: stringArrayValue(input.tipo),
    periodo: stringArrayValue(input.periodo),
    entrega: stringArrayValue(input.entrega),
    multiplicador: stringArrayValue(input.multiplicador),
    skip: parseBoundedInteger(input.skip, 0, 0, 1_000_000),
    take: parseBoundedInteger(input.take, 500, 1, 10_000)
  };
}

function buildWhere(query: PricingMeffQuery): Prisma.PricingMeffPriceWhereInput {
  return {
    ...buildOptionsWhere(query),
    tipo: inValues(query.tipo),
    periodo: inValues(query.periodo),
    entrega: inValues(query.entrega),
    multiplicador: inValues(query.multiplicador)
  };
}

function buildOptionsWhere(query: PricingMeffQuery): Prisma.PricingMeffPriceWhereInput {
  return {
    fechaPublicacion:
      query.fechaPublicacionDesde || query.fechaPublicacionHasta
        ? {
            gte: query.fechaPublicacionDesde ? parseDate(query.fechaPublicacionDesde) : undefined,
            lte: query.fechaPublicacionHasta ? parseDate(query.fechaPublicacionHasta) : undefined
          }
        : undefined
  };
}

function toResponseRow(
  row: {
    id: string;
    fechaPublicacion: Date;
    cod: string;
    tipo: string | null;
    clase: string | null;
    periodo: string | null;
    entrega: string | null;
    multiplicador: string | null;
    precio: Prisma.Decimal | null;
  },
  comparisons: Map<string, { precio: number | null }>
): PricingMeffRow {
  const precio = decimalToNumber(row.precio);
  const date7 = shiftDate(row.fechaPublicacion, -7).toISOString().slice(0, 10);
  const date14 = shiftDate(row.fechaPublicacion, -14).toISOString().slice(0, 10);
  return {
    id: row.id,
    fechaPublicacion: row.fechaPublicacion.toISOString().slice(0, 10),
    cod: row.cod,
    tipo: row.tipo,
    clase: row.clase,
    periodo: row.periodo,
    entrega: row.entrega,
    multiplicador: row.multiplicador,
    precio,
    precio7Dias: buildComparison(precio, comparisons.get(`${row.cod}|${date7}`)?.precio ?? null),
    precio14Dias: buildComparison(precio, comparisons.get(`${row.cod}|${date14}`)?.precio ?? null)
  };
}

function buildComparison(current: number | null, previous: number | null) {
  return {
    precio: previous,
    porcentaje: current === null || previous === null || previous === 0 ? null : ((current - previous) / previous) * 100
  };
}

function shiftDate(date: Date, days: number) {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function inValues(values: string[] | undefined) {
  return values?.length ? { in: values, mode: "insensitive" as const } : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayValue(value: unknown) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const normalized = values.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  return normalized.length ? [...new Set(normalized)] : undefined;
}

function parseBoundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function decimalToNumber(value: Prisma.Decimal | null | undefined) {
  return value === null || value === undefined ? null : Number(value);
}

function distinctTextValues(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right, "es"));
}
