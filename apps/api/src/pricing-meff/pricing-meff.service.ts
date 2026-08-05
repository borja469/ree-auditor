import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { parsePricingMeffWorkbook } from "./pricing-meff.parser";
import type { PricingMeffHistoryPoint, PricingMeffHistoryResponse, PricingMeffQuery, PricingMeffResponse, PricingMeffRow } from "./pricing-meff.types";

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
    const effectiveQuery = await this.withDefaultPublicationDate(query);
    const where = buildWhere(effectiveQuery);
    const [total, rows, tipos, clases, periodos, entregas, multiplicadores] = await Promise.all([
      this.prisma.pricingMeffPrice.count({ where }),
      this.prisma.pricingMeffPrice.findMany({
        where,
        orderBy: [{ periodo: "asc" }, { entrega: "asc" }, { fechaPublicacion: "desc" }, { cod: "asc" }],
        skip: effectiveQuery.skip,
        take: effectiveQuery.take
      }),
      this.prisma.pricingMeffPrice.findMany({ where: buildFilterOptionsWhere(effectiveQuery, "tipo"), distinct: ["tipo"], select: { tipo: true }, orderBy: { tipo: "asc" } }),
      this.prisma.pricingMeffPrice.findMany({ where: buildFilterOptionsWhere(effectiveQuery, "clase"), distinct: ["clase"], select: { clase: true }, orderBy: { clase: "asc" } }),
      this.prisma.pricingMeffPrice.findMany({ where: buildFilterOptionsWhere(effectiveQuery, "periodo"), distinct: ["periodo"], select: { periodo: true }, orderBy: { periodo: "asc" } }),
      this.prisma.pricingMeffPrice.findMany({ where: buildFilterOptionsWhere(effectiveQuery, "entrega"), distinct: ["entrega"], select: { entrega: true }, orderBy: { entrega: "asc" } }),
      this.prisma.pricingMeffPrice.findMany({ where: buildFilterOptionsWhere(effectiveQuery, "multiplicador"), distinct: ["multiplicador"], select: { multiplicador: true }, orderBy: { multiplicador: "asc" } })
    ]);
    const sortedRows = [...rows].sort(comparePricingMeffRows);
    const comparisonRows = await this.loadComparisonRows(sortedRows.map((row) => ({ cod: row.cod, fechaPublicacion: row.fechaPublicacion })));
    return {
      total,
      rows: sortedRows.map((row) => toResponseRow(row, comparisonRows)),
      appliedFilters: {
        fechaPublicacion: effectiveQuery.fechaPublicacion
      },
      filterOptions: {
        tipos: distinctTextValues(tipos.map((row) => row.tipo)),
        clases: distinctTextValues(clases.map((row) => row.clase)),
        periodos: distinctTextValues(periodos.map((row) => row.periodo)),
        entregas: distinctTextValues(entregas.map((row) => row.entrega)),
        multiplicadores: distinctTextValues(multiplicadores.map((row) => row.multiplicador))
      }
    };
  }

  private async withDefaultPublicationDate(query: PricingMeffQuery): Promise<PricingMeffQuery> {
    if (query.fechaPublicacion) {
      return query;
    }

    const latest = await this.prisma.pricingMeffPrice.findFirst({
      orderBy: { fechaPublicacion: "desc" },
      select: { fechaPublicacion: true }
    });

    return {
      ...query,
      fechaPublicacion: latest?.fechaPublicacion.toISOString().slice(0, 10)
    };
  }

  async history(cod: string): Promise<PricingMeffHistoryResponse> {
    const normalizedCod = cod.trim();
    const rows = await this.prisma.pricingMeffPrice.findMany({
      where: {
        cod: {
          equals: normalizedCod,
          mode: "insensitive"
        }
      },
      orderBy: { fechaPublicacion: "asc" }
    });

    return {
      cod: normalizedCod,
      rows: rows.map(toHistoryPoint)
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

type PricingMeffSortableRow = {
  fechaPublicacion: Date;
  cod: string;
  periodo: string | null;
  entrega: string | null;
};

function comparePricingMeffRows(left: PricingMeffSortableRow, right: PricingMeffSortableRow) {
  return (
    comparePeriodLabel(left.periodo, right.periodo) ||
    compareDeliveryLabel(left.entrega, right.entrega) ||
    right.fechaPublicacion.getTime() - left.fechaPublicacion.getTime() ||
    left.cod.localeCompare(right.cod, "es", { numeric: true, sensitivity: "base" })
  );
}

function comparePeriodLabel(left: string | null, right: string | null) {
  const leftOrder = periodSortOrder(left);
  const rightOrder = periodSortOrder(right);
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return textCompare(left, right);
}

function periodSortOrder(value: string | null) {
  const normalized = normalizeSortText(value);
  if (normalized.includes("mensual")) {
    return 1;
  }
  if (normalized.includes("trimestral")) {
    return 2;
  }
  if (normalized.includes("anual")) {
    return 3;
  }
  return 99;
}

function compareDeliveryLabel(left: string | null, right: string | null) {
  const leftKey = deliverySortKey(left);
  const rightKey = deliverySortKey(right);
  if (leftKey !== rightKey) {
    return leftKey - rightKey;
  }
  return textCompare(left, right);
}

function deliverySortKey(value: string | null) {
  const normalized = normalizeSortText(value);
  const monthMatch = normalized.match(/(?:^|[^a-z])([a-z]{3})[-\s/]?(\d{2,4})(?:$|[^0-9])/);
  if (monthMatch) {
    return sortYear(monthMatch[2]) * 100 + monthSortOrder(monthMatch[1]);
  }
  const quarterMatch = normalized.match(/q([1-4])[-\s/]?(\d{2,4})/);
  if (quarterMatch) {
    return sortYear(quarterMatch[2]) * 100 + (Number(quarterMatch[1]) - 1) * 3 + 1;
  }
  const yearMatch = normalized.match(/(?:cal|yr|year)?[-\s/]?(\d{2,4})$/);
  if (yearMatch) {
    return sortYear(yearMatch[1]) * 100;
  }
  return Number.MAX_SAFE_INTEGER;
}

function monthSortOrder(value: string) {
  const months: Record<string, number> = {
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
  return months[value] ?? 99;
}

function sortYear(value: string) {
  const year = Number(value);
  return value.length === 2 ? 2000 + year : year;
}

function normalizeSortText(value: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function textCompare(left: string | null, right: string | null) {
  return (left ?? "").localeCompare(right ?? "", "es", { numeric: true, sensitivity: "base" });
}

export function defaultPricingMeffQuery(input: Partial<Record<string, unknown>>): PricingMeffQuery {
  return {
    fechaPublicacion: stringValue(input.fechaPublicacion) ?? stringValue(input.fechaPublicacionDesde),
    tipo: stringArrayValue(input.tipo),
    clase: stringArrayValue(input.clase),
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
    clase: inValues(query.clase),
    periodo: inValues(query.periodo),
    entrega: inValues(query.entrega),
    multiplicador: inValues(query.multiplicador)
  };
}

function buildFilterOptionsWhere(query: PricingMeffQuery, excludedFilter: "tipo" | "clase" | "periodo" | "entrega" | "multiplicador"): Prisma.PricingMeffPriceWhereInput {
  return {
    ...buildOptionsWhere(query),
    tipo: excludedFilter === "tipo" ? undefined : inValues(query.tipo),
    clase: excludedFilter === "clase" ? undefined : inValues(query.clase),
    periodo: excludedFilter === "periodo" ? undefined : inValues(query.periodo),
    entrega: excludedFilter === "entrega" ? undefined : inValues(query.entrega),
    multiplicador: excludedFilter === "multiplicador" ? undefined : inValues(query.multiplicador)
  };
}

function buildOptionsWhere(query: PricingMeffQuery): Prisma.PricingMeffPriceWhereInput {
  return {
    fechaPublicacion: query.fechaPublicacion ? parseDate(query.fechaPublicacion) : undefined
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

function toHistoryPoint(row: {
  id: string;
  fechaPublicacion: Date;
  cod: string;
  tipo: string | null;
  clase: string | null;
  periodo: string | null;
  entrega: string | null;
  multiplicador: string | null;
  precio: Prisma.Decimal | null;
}): PricingMeffHistoryPoint {
  return {
    id: row.id,
    fechaPublicacion: row.fechaPublicacion.toISOString().slice(0, 10),
    cod: row.cod,
    tipo: row.tipo,
    clase: row.clase,
    periodo: row.periodo,
    entrega: row.entrega,
    multiplicador: row.multiplicador,
    precio: decimalToNumber(row.precio)
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
