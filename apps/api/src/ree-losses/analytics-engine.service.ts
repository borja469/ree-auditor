import { Injectable } from "@nestjs/common";
import { Prisma, ReeKFactor, ReeKFactorFileType, ReeSettlementVersion } from "@prisma/client";
import {
  eachDate,
  expectedQuarterHourCount,
  isDuplicatedDstHour,
  isNonexistentQuarterHour,
  resolveTariffPeriod,
  toIsoDate
} from "./period-engine";
import { ReeLossesRegulatoryEngine } from "./regulatory-engine.service";
import { BoeLoss, DateRange, LossReportRow, PeriodContext, SelectedKFactor } from "./ree-losses.types";

@Injectable()
export class ReeLossesAnalyticsEngine {
  constructor(private readonly regulatoryEngine: ReeLossesRegulatoryEngine) {}

  buildReport({
    kFactors,
    boeLosses,
    context,
    dateRange,
    version,
    tarifa,
    periodo
  }: {
    kFactors: ReeKFactor[];
    boeLosses: BoeLoss[];
    context: PeriodContext;
    dateRange: DateRange;
    version?: ReeSettlementVersion;
    tarifa?: string;
    periodo?: string;
  }) {
    const selectedFactors = selectPriorityKFactors(kFactors);
    const rows = this.buildRowsFromSelectedFactors(selectedFactors, boeLosses, context);
    markAbruptJumps(rows);
    const gaps = detectMissingGaps({
      rows,
      dateRange,
      versions: version ? [version] : (distinct(rows.map((row) => row.version)) as ReeSettlementVersion[]),
      tarifas: tarifa ? [tarifa] : distinct(rows.map((row) => row.tarifa)),
      periodo,
      context
    });
    const kpis = buildKpis(rows, gaps, kFactors);

    return {
      kpis,
      rows,
      anomalies: buildAutomaticAnalysis(rows, gaps),
      gaps
    };
  }

  buildRows(kFactors: ReeKFactor[], boeLosses: BoeLoss[], context: PeriodContext): LossReportRow[] {
    return this.buildRowsFromSelectedFactors(selectPriorityKFactors(kFactors), boeLosses, context);
  }

  private buildRowsFromSelectedFactors(rows: SelectedKFactor[], boeLosses: BoeLoss[], context: PeriodContext): LossReportRow[] {
    return rows.map((row) => {
      const calculated = this.regulatoryEngine.calculateLoss(row, boeLosses);
      const expectedPeriod = this.regulatoryEngine.resolveExpectedPeriod(row, context);
      const anomalies = buildRowAnomalies({
        row,
        perdidaBoe: calculated.perdidaBoe,
        perdidaFinal: calculated.perdidaFinal,
        diferenciaPct: calculated.diferenciaPct,
        expectedPeriod
      });

      return {
        id: row.id,
        fecha: toIsoDate(row.fecha),
        hora: row.hora,
        cuartohora: row.cuartohora,
        tarifa: row.tarifa,
        periodo: row.periodo,
        perdidaBoe: calculated.perdidaBoe,
        factorKAplicado: roundTo(row.valorK, 10),
        perdidaFinal: calculated.perdidaFinal,
        diferenciaVsBoe: calculated.diferenciaVsBoe,
        diferenciaPct: calculated.diferenciaPct,
        tipoFicheroUtilizado: row.tipoArchivo,
        version: row.version,
        versionBoe: calculated.versionBoe,
        kestimValorK: row.kestimValorK,
        krealValorK: row.krealValorK,
        anomalies
      };
    });
  }
}

function selectPriorityKFactors(rows: ReeKFactor[]): SelectedKFactor[] {
  const groups = new Map<string, ReeKFactor[]>();
  for (const row of rows) {
    const key = kFactorIdentityKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.values()]
    .map((group) => {
      const sorted = [...group].sort(compareKFactorPriority);
      const selected = sorted[0];
      const kestim = sorted.find((row) => row.tipoArchivo === ReeKFactorFileType.KESTIMQH);
      const kreal = sorted.find((row) => row.tipoArchivo === ReeKFactorFileType.KREALQH);
      return {
        id: selected.id,
        fecha: selected.fecha,
        hora: selected.hora,
        cuartohora: selected.cuartohora,
        version: selected.version,
        tipoArchivo: selected.tipoArchivo,
        tarifa: selected.tarifa,
        periodo: selected.periodo,
        valorK: decimalToNumber(selected.valorK),
        createdAt: selected.createdAt,
        duplicateCount: group.length,
        kestimValorK: kestim ? decimalToNumber(kestim.valorK) : null,
        krealValorK: kreal ? decimalToNumber(kreal.valorK) : null
      };
    })
    .sort(compareSelectedKFactor);
}

function buildRowAnomalies({
  row,
  perdidaBoe,
  perdidaFinal,
  diferenciaPct,
  expectedPeriod
}: {
  row: SelectedKFactor;
  perdidaBoe: number | null;
  perdidaFinal: number | null;
  diferenciaPct: number | null;
  expectedPeriod?: string;
}) {
  const anomalies: string[] = [];

  if (perdidaBoe === null || perdidaFinal === null) {
    anomalies.push("dato_incompleto");
  }
  if (row.valorK < 0 || (perdidaFinal !== null && perdidaFinal < 0)) {
    anomalies.push("perdida_negativa");
  }
  if (perdidaBoe !== null && perdidaFinal !== null && (perdidaFinal > perdidaBoe * 1.5 || Math.abs(diferenciaPct ?? 0) > 25)) {
    anomalies.push("perdida_extrema");
  }
  if (row.duplicateCount > 1) {
    anomalies.push("duplicado");
  }
  if (expectedPeriod && expectedPeriod !== row.periodo) {
    anomalies.push("periodo_invalido");
  }
  if (isNonexistentQuarterHour(row.fecha, row.hora)) {
    anomalies.push("cuartohora_inexistente_cambio_horario");
  }
  if (isDuplicatedDstHour(row.fecha, row.hora) && row.duplicateCount < 2) {
    anomalies.push("cuartohora_duplicada_no_informada");
  }

  return anomalies;
}

function markAbruptJumps(rows: LossReportRow[]) {
  const groups = new Map<string, LossReportRow[]>();
  for (const row of rows) {
    const key = [row.version, row.tarifa, row.periodo].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  for (const group of groups.values()) {
    const sorted = [...group].sort((left, right) => compareLossRows(left, right));
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1].perdidaFinal;
      const current = sorted[index].perdidaFinal;
      if (previous === null || current === null) {
        continue;
      }

      const jump = Math.abs(current - previous);
      if (jump > Math.max(5, Math.abs(previous) * 0.25)) {
        sorted[index].anomalies.push("salto_brusco");
      }
    }
  }
}

function detectMissingGaps({
  rows,
  dateRange,
  versions,
  tarifas,
  periodo,
  context
}: {
  rows: LossReportRow[];
  dateRange: DateRange;
  versions: ReeSettlementVersion[];
  tarifas: string[];
  periodo?: string;
  context: PeriodContext;
}) {
  if (versions.length === 0 || tarifas.length === 0) {
    return {
      totalMissing: 0,
      days: [] as Array<{ fecha: string; version: string; tarifa: string; expected: number; present: number; missing: number }>
    };
  }

  const presentKeys = new Set(rows.map((row) => [row.fecha, row.version, row.tarifa, row.hora, row.cuartohora, row.periodo].join("|")));
  const rowsByDateVersionTariff = countRowsByDateVersionTariff(rows);
  const days: Array<{ fecha: string; version: string; tarifa: string; expected: number; present: number; missing: number }> = [];

  for (const fecha of eachDate(dateRange.gte, dateRange.lt)) {
    for (const version of versions) {
      for (const tarifa of tarifas) {
        const expectedKeys: string[] = [];
        for (let hora = 1; hora <= 24; hora += 1) {
          for (let cuartohora = 1; cuartohora <= 4; cuartohora += 1) {
            if (isNonexistentQuarterHour(fecha, hora)) {
              continue;
            }
            const rule = resolveTariffPeriod({
              tarifa,
              fecha,
              hora,
              cuartohora,
              rules: context.rules,
              holidays: context.holidays
            });
            if (!rule || (periodo && rule.periodo !== periodo)) {
              continue;
            }
            expectedKeys.push([toIsoDate(fecha), version, tarifa, hora, cuartohora, rule.periodo].join("|"));
          }
        }

        const key = [toIsoDate(fecha), version, tarifa].join("|");
        const present = rowsByDateVersionTariff.get(key) ?? 0;
        const expected =
          periodo || expectedQuarterHourCount(fecha) !== 100
            ? expectedKeys.length
            : expectedQuarterHourCount(fecha);
        const missing =
          periodo || expectedQuarterHourCount(fecha) !== 100
            ? expectedKeys.filter((item) => !presentKeys.has(item)).length
            : Math.max(expected - present, 0);
        if (missing > 0) {
          days.push({
            fecha: toIsoDate(fecha),
            version,
            tarifa,
            expected,
            present,
            missing
          });
        }
      }
    }
  }

  return {
    totalMissing: days.reduce((sum, day) => sum + day.missing, 0),
    days: days.slice(0, 50)
  };
}

function buildKpis(rows: LossReportRow[], gaps: ReturnType<typeof detectMissingGaps>, kFactors: ReeKFactor[]) {
  const finalValues = rows.map((row) => row.perdidaFinal).filter(isNumber);
  const deviationValues = rows.map((row) => row.diferenciaPct).filter(isNumber);
  const anomalousDays = new Set(rows.filter((row) => row.anomalies.length > 0).map((row) => row.fecha));
  const incompleteRows = rows.filter((row) => row.anomalies.includes("dato_incompleto")).length;
  const activeTypes = [...new Set(rows.map((row) => row.tipoFicheroUtilizado))];
  const activeVersions = [...new Set(rows.map((row) => row.version))].sort();

  return {
    perdidaMedia: average(finalValues),
    perdidaMaxima: finalValues.length ? Math.max(...finalValues) : null,
    perdidaMinima: finalValues.length ? Math.min(...finalValues) : null,
    desviacionMediaVsBoe: average(deviationValues),
    diasAnomalos: anomalousDays.size,
    registrosIncompletos: incompleteRows,
    huecosDetectados: gaps.totalMissing,
    archivosProcesados: new Set(kFactors.map((row) => `${row.tipoArchivo}|${row.version}`)).size,
    versionActivaUtilizada: activeTypes.length === 0 ? null : `${activeTypes.includes("KREALQH") ? "KREALQH" : "KESTIMQH"} ${activeVersions.join(", ")}`
  };
}

function buildAutomaticAnalysis(rows: LossReportRow[], gaps: ReturnType<typeof detectMissingGaps>) {
  const messages: string[] = [];
  if (rows.length === 0) {
    return ["No hay datos K para los filtros seleccionados."];
  }

  const worstDay = findWorstDeviationDay(rows);
  if (worstDay) {
    messages.push(
      `El dia ${formatDateLabel(worstDay.fecha)} se detecto una desviacion media de ${formatSignedPercent(worstDay.deviation)} respecto al BOE.`
    );
  }

  const negativeRows = rows.filter((row) => row.anomalies.includes("perdida_negativa")).length;
  if (negativeRows > 0) {
    messages.push(`Se detectaron ${negativeRows} registros con perdidas negativas.`);
  }

  const invalidPeriods = rows.filter((row) => row.anomalies.includes("periodo_invalido")).length;
  if (invalidPeriods > 0) {
    messages.push(`Se detectaron ${invalidPeriods} registros con periodo tarifario distinto al calendario BOE cargado.`);
  }

  if (gaps.totalMissing > 0) {
    messages.push(`Hay ${gaps.totalMissing} cuartohoras no informadas para el calendario esperado.`);
  }

  return messages.length > 0 ? messages : ["No se detectan anomalias relevantes en el rango seleccionado."];
}

function findWorstDeviationDay(rows: LossReportRow[]) {
  const byDay = new Map<string, number[]>();
  for (const row of rows) {
    if (row.diferenciaPct === null) {
      continue;
    }
    byDay.set(row.fecha, [...(byDay.get(row.fecha) ?? []), row.diferenciaPct]);
  }

  return [...byDay.entries()]
    .map(([fecha, values]) => ({ fecha, deviation: average(values) ?? 0 }))
    .sort((left, right) => Math.abs(right.deviation) - Math.abs(left.deviation))[0];
}

function compareKFactorPriority(left: ReeKFactor, right: ReeKFactor) {
  const typeCompare = kFactorTypePriority(right.tipoArchivo) - kFactorTypePriority(left.tipoArchivo);
  if (typeCompare !== 0) {
    return typeCompare;
  }
  return right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id);
}

function compareSelectedKFactor(left: SelectedKFactor, right: SelectedKFactor) {
  return (
    left.fecha.getTime() - right.fecha.getTime() ||
    left.hora - right.hora ||
    left.cuartohora - right.cuartohora ||
    left.tarifa.localeCompare(right.tarifa, "es", { numeric: true }) ||
    left.periodo.localeCompare(right.periodo, "es", { numeric: true }) ||
    left.version.localeCompare(right.version)
  );
}

function compareLossRows(left: LossReportRow, right: LossReportRow) {
  return (
    left.fecha.localeCompare(right.fecha) ||
    left.hora - right.hora ||
    left.cuartohora - right.cuartohora ||
    left.tarifa.localeCompare(right.tarifa, "es", { numeric: true }) ||
    left.periodo.localeCompare(right.periodo, "es", { numeric: true }) ||
    left.version.localeCompare(right.version)
  );
}

function kFactorTypePriority(tipoArchivo: ReeKFactorFileType) {
  return tipoArchivo === ReeKFactorFileType.KREALQH ? 2 : 1;
}

function decimalToNumber(value: Prisma.Decimal | { toString(): string } | string | number | null | undefined) {
  const numeric = Number(value?.toString() ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function average(values: number[]) {
  return values.length === 0 ? null : roundTo(values.reduce((sum, value) => sum + value, 0) / values.length, 6);
}

function countRowsByDateVersionTariff(rows: LossReportRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = [row.fecha, row.version, row.tarifa].join("|");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function kFactorIdentityKey(row: { fecha: Date; hora: number; cuartohora: number; version: string; tarifa: string; periodo: string }) {
  return [toIsoDate(row.fecha), row.hora, row.cuartohora, row.version, row.tarifa, row.periodo].join("|");
}

function distinct<T>(values: T[]) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined))];
}

function isNumber(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function formatDateLabel(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatSignedPercent(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${roundTo(value, 2).toLocaleString("es-ES")}%`;
}
