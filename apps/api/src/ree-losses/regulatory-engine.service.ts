import { Injectable, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  buildHolidaySet,
  buildNationalHolidaySeedRows,
  buildPeriodRuleMap,
  buildTariffPeriodSeedRows,
  normalizePeriodo,
  normalizeTarifa,
  PENINSULAR_SYSTEM,
  resolveTariffPeriod,
  SUPPORTED_TARIFFS
} from "./period-engine";
import { ParsedReeKFactorRecord, ReeKFactorMetadata, ReeKFactorParseIssue } from "./parsers/ree-k-factor.parser";
import { BoeLoss, NormalizedKFactorInput, PeriodContext, SelectedKFactor } from "./ree-losses.types";

const INSERT_BATCH_SIZE = 5000;
const BOE_INITIAL_VERSION = "BOE_INICIAL";
const BOE_OPEN_END = new Date(Date.UTC(9999, 11, 31));
const INITIAL_BOE_LOSSES = [
  ["2.0TD", "P1", 16.7],
  ["2.0TD", "P2", 16.3],
  ["2.0TD", "P3", 18],
  ["3.0TD", "P1", 16.6],
  ["3.0TD", "P2", 17.5],
  ["3.0TD", "P3", 16.5],
  ["3.0TD", "P4", 16.5],
  ["3.0TD", "P5", 13.8],
  ["3.0TD", "P6", 18],
  ["6.1TD", "P1", 6.7],
  ["6.1TD", "P2", 6.8],
  ["6.1TD", "P3", 6.5],
  ["6.1TD", "P4", 6.5],
  ["6.1TD", "P5", 4.3],
  ["6.1TD", "P6", 7.7],
  ["6.2TD", "P1", 5.2],
  ["6.2TD", "P2", 5.4],
  ["6.2TD", "P3", 4.9],
  ["6.2TD", "P4", 5],
  ["6.2TD", "P5", 3.5],
  ["6.2TD", "P6", 5.4],
  ["6.3TD", "P1", 4.2],
  ["6.3TD", "P2", 4.3],
  ["6.3TD", "P3", 4],
  ["6.3TD", "P4", 4],
  ["6.3TD", "P5", 3],
  ["6.3TD", "P6", 4.4],
  ["6.4TD", "P1", 1.6],
  ["6.4TD", "P2", 1.6],
  ["6.4TD", "P3", 1.6],
  ["6.4TD", "P4", 1.6],
  ["6.4TD", "P5", 1.5],
  ["6.4TD", "P6", 1.7]
] as const;

@Injectable()
export class ReeLossesRegulatoryEngine implements OnModuleInit {
  private referenceDataEnsured?: Promise<void>;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureReferenceData();
  }

  ensureReferenceData() {
    if (!this.referenceDataEnsured) {
      this.referenceDataEnsured = this.seedReferenceData();
    }
    return this.referenceDataEnsured;
  }

  async buildPeriodContext(): Promise<PeriodContext> {
    await this.ensureReferenceData();
    const [rules, holidays] = await Promise.all([
      this.prisma.tarifaPeriodo.findMany({
        where: {
          sistema: PENINSULAR_SYSTEM
        }
      }),
      this.prisma.calendarioFestivo.findMany({
        where: {
          ambito: "NACIONAL"
        }
      })
    ]);

    return {
      rules: buildPeriodRuleMap(rules),
      holidays: buildHolidaySet(holidays)
    };
  }

  async loadBoeLosses(): Promise<BoeLoss[]> {
    await this.ensureReferenceData();
    return this.prisma.perdidaBoe.findMany({
      orderBy: [
        { tarifa: "asc" },
        { periodo: "asc" },
        { fechaInicio: "desc" }
      ]
    });
  }

  expandParsedRecord(
    record: ParsedReeKFactorRecord,
    metadata: ReeKFactorMetadata,
    context: PeriodContext,
    errors: ReeKFactorParseIssue[],
    sourceFileName: string
  ): NormalizedKFactorInput[] {
    const tarifas = record.tarifa ? [normalizeTarifa(record.tarifa)].filter(isNonEmptyString) : [...SUPPORTED_TARIFFS];
    if (tarifas.length === 0) {
      errors.push({
        sourceFileName,
        lineNumber: record.sourceLineNumber,
        message: "tarifa_no_soportada",
        rawLine: record.rawLine
      });
      return [];
    }

    const rows: NormalizedKFactorInput[] = [];
    for (const tarifa of tarifas) {
      const resolved = resolveTariffPeriod({
        tarifa,
        fecha: record.fecha,
        hora: record.hora,
        cuartohora: record.cuartohora,
        rules: context.rules,
        holidays: context.holidays
      });
      const periodo = normalizePeriodo(record.periodo) ?? resolved?.periodo;
      if (!periodo) {
        errors.push({
          sourceFileName,
          lineNumber: record.sourceLineNumber,
          message: `periodo_no_resuelto_${tarifa}`,
          rawLine: record.rawLine
        });
        continue;
      }

      rows.push({
        fecha: record.fecha,
        hora: record.hora,
        cuartohora: record.cuartohora,
        version: metadata.version,
        tipoArchivo: metadata.tipoArchivo,
        tarifa,
        periodo,
        valorK: record.valorK
      });
    }

    return rows;
  }

  calculateLoss(
    row: SelectedKFactor,
    boeLosses: BoeLoss[]
  ): {
    perdidaBoe: number | null;
    perdidaFinal: number | null;
    diferenciaVsBoe: number | null;
    diferenciaPct: number | null;
    versionBoe: string | null;
  } {
    const boe = findBoeLoss(boeLosses, row);
    const perdidaBoe = boe ? decimalToNumber(boe.porcentajePerdida) : null;
    const perdidaFinal = perdidaBoe === null ? null : roundTo(perdidaBoe * row.valorK, 6);
    const diferenciaVsBoe = perdidaFinal === null || perdidaBoe === null ? null : roundTo(perdidaFinal - perdidaBoe, 6);
    const diferenciaPct =
      diferenciaVsBoe === null || perdidaBoe === null || perdidaBoe === 0 ? null : roundTo((diferenciaVsBoe / perdidaBoe) * 100, 6);

    return {
      perdidaBoe,
      perdidaFinal,
      diferenciaVsBoe,
      diferenciaPct,
      versionBoe: boe?.versionBoe ?? null
    };
  }

  resolveExpectedPeriod(row: { tarifa: string; fecha: Date; hora: number; cuartohora: number }, context: PeriodContext) {
    return resolveTariffPeriod({
      tarifa: row.tarifa,
      fecha: row.fecha,
      hora: row.hora,
      cuartohora: row.cuartohora,
      rules: context.rules,
      holidays: context.holidays
    })?.periodo;
  }

  private async seedReferenceData() {
    const [boeCount, periodCount, holidayCount] = await Promise.all([
      this.prisma.perdidaBoe.count(),
      this.prisma.tarifaPeriodo.count({
        where: {
          sistema: PENINSULAR_SYSTEM
        }
      }),
      this.prisma.calendarioFestivo.count({
        where: {
          ambito: "NACIONAL"
        }
      })
    ]);

    if (boeCount === 0) {
      await this.prisma.perdidaBoe.createMany({
        data: INITIAL_BOE_LOSSES.map(([tarifa, periodo, porcentaje]) => ({
          tarifa,
          periodo,
          porcentajePerdida: percentageToDecimal(porcentaje),
          fechaInicio: new Date(Date.UTC(2021, 5, 1)),
          fechaFin: BOE_OPEN_END,
          versionBoe: BOE_INITIAL_VERSION
        })),
        skipDuplicates: true
      });
    }

    if (periodCount === 0) {
      await insertTariffPeriodRules(this.prisma, buildTariffPeriodSeedRows());
    }

    if (holidayCount === 0) {
      await this.prisma.calendarioFestivo.createMany({
        data: buildNationalHolidaySeedRows(),
        skipDuplicates: true
      });
    }
  }
}

function findBoeLoss(losses: BoeLoss[], row: { tarifa: string; periodo: string; fecha: Date }) {
  return losses.find(
    (loss) =>
      loss.tarifa === row.tarifa &&
      loss.periodo === row.periodo &&
      normalizeDateOnly(loss.fechaInicio) <= normalizeDateOnly(row.fecha) &&
      normalizeDateOnly(loss.fechaFin) >= normalizeDateOnly(row.fecha)
  );
}

function normalizeDateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function decimalToNumber(value: Prisma.Decimal | { toString(): string } | string | number | null | undefined) {
  const numeric = Number(value?.toString() ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function percentageToDecimal(value: number) {
  return new Prisma.Decimal(value.toFixed(6));
}

function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function chunk<T>(values: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

async function insertTariffPeriodRules(prisma: PrismaService, rows: ReturnType<typeof buildTariffPeriodSeedRows>) {
  for (const batch of chunk(rows, INSERT_BATCH_SIZE)) {
    await prisma.tarifaPeriodo.createMany({
      data: batch,
      skipDuplicates: true
    });
  }
}
