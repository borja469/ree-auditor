import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { OmieAnalisisService } from "../omie-analisis/omie-analisis.service";
import { PrismaService } from "../prisma/prisma.service";
import { buildCurveMonths, toCurveProduct } from "../pricing-base/meff_forward_curve_service";
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
    const [omieDays, meffPrices, depositedGuarantees] = await Promise.all([
      this.loadOmieDays(addDays(parseDateKey(range.startDate), -7), parseDateKey(range.endDate)),
      this.loadMeffPrices(referenceDate, range.startDate, range.endDate),
      this.loadDepositedGuarantees(range.startDate, range.endDate)
    ]);
    return buildGuaranteeRows({ referenceDate, omieDays, meffPrices, depositedGuarantees });
  }

  async saveDepositedGuarantee(input: { date: string; amount: number | null }): Promise<DepositedGuarantee | { date: string; amount: null; updatedAt: string }> {
    const date = parseDateKey(input.date);
    if (input.amount === null) {
      await this.prisma.omieGuaranteeDeposited.delete({ where: { date } }).catch(() => null);
      return { date: input.date, amount: null, updatedAt: new Date().toISOString() };
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
    return {
      date: formatDateKey(row.date),
      amount: Number(row.amount.toString()),
      updatedAt: row.updatedAt.toISOString()
    };
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
          costWithoutTax: day.costeTotalOmie
        });
      }
    }
    return map;
  }

  private async loadDepositedGuarantees(startDate: string, endDate: string) {
    const rows = await this.prisma.omieGuaranteeDeposited.findMany({
      where: {
        date: {
          gte: parseDateKey(startDate),
          lte: parseDateKey(endDate)
        }
      },
      select: {
        date: true,
        amount: true
      }
    });
    return new Map(rows.map((row) => [formatDateKey(row.date), Number(row.amount.toString())]));
  }

  private async loadMeffPrices(referenceDate: string, startDate: string, endDate: string) {
    const publication = await this.prisma.pricingMeffPrice.findFirst({
      where: {
        fechaPublicacion: {
          lte: parseDateKey(referenceDate)
        }
      },
      orderBy: {
        fechaPublicacion: "desc"
      },
      select: {
        fechaPublicacion: true
      }
    });
    const dates = enumerateDateKeys(startDate, endDate);
    const missingMap = new Map(dates.map((date) => [date, { price: null, publicationDate: null, code: null } satisfies MeffGuaranteePrice]));
    if (!publication) {
      return missingMap;
    }

    const rows = await this.prisma.pricingMeffPrice.findMany({
      where: {
        fechaPublicacion: publication.fechaPublicacion
      },
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
      .filter((product): product is NonNullable<ReturnType<typeof toCurveProduct>> => Boolean(product));
    const months = buildCurveMonths(uniqueMonths(dates), products);
    const byMonth = new Map(months.map((month) => [month.key, month]));
    const publicationDate = formatDateKey(publication.fechaPublicacion);
    return new Map(
      dates.map((date) => {
        const month = byMonth.get(date.slice(0, 7));
        return [
          date,
          {
            price: month?.price ?? null,
            publicationDate: month?.price === null || month?.price === undefined ? null : publicationDate,
            code: month?.sourceProductCode ?? month?.productCode ?? null
          } satisfies MeffGuaranteePrice
        ];
      })
    );
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

function uniqueMonths(dates: string[]) {
  const seen = new Set<string>();
  const months: Array<{ year: number; month: number }> = [];
  for (const date of dates) {
    const key = date.slice(0, 7);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    months.push({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) });
  }
  return months;
}

function nullableSum(values: Array<number | null>) {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return present.length > 0 ? Number(present.reduce((sum, value) => sum + value, 0).toFixed(6)) : null;
}
