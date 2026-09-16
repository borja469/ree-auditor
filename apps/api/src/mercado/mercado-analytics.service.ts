import { BadRequestException, Injectable } from "@nestjs/common";
import { MercadoDatasetService } from "./mercado-dataset.service";
import { MercadoIndicatorMappingService } from "./mercado-indicator-mapping.service";

const BASE_ANALYTICS_VARIABLES = [
  "precioOmie",
  "demandaPrevista",
  "eolica",
  "solarPrevista",
  "fotovoltaica",
  "termosolar",
  "nuclear",
  "hidraulicaUGH",
  "hidraulicaNoUGH",
  "bombeo",
  "intercambios"
] as const;

const DERIVED_ANALYTICS_VARIABLES = [
  "huecoTermico",
  "demandaResidual",
  "coberturaRenovablePct",
  "eolicaSobreDemandaPct",
  "solarSobreDemandaPct",
  "hidraulicaSobreDemandaPct",
  "nuclearSobreDemandaPct",
  "rampaDemanda",
  "rampaEolica",
  "rampaSolar",
  "rampaHuecoTermico",
  "rampaPrecioOmie"
] as const;

const ANALYTICS_VARIABLES = [...BASE_ANALYTICS_VARIABLES, ...DERIVED_ANALYTICS_VARIABLES] as const;

type AnalyticsVariable = (typeof ANALYTICS_VARIABLES)[number];
type BaseAnalyticsVariable = (typeof BASE_ANALYTICS_VARIABLES)[number];
type DerivedAnalyticsVariable = (typeof DERIVED_ANALYTICS_VARIABLES)[number];
type DerivedInputVariable = BaseAnalyticsVariable | DerivedAnalyticsVariable;

type AnalyticsOptions = {
  fechaDesde?: string;
  fechaHasta?: string;
  geoId?: number;
  lowerPercentile?: number;
  upperPercentile?: number;
};

type DatasetRow = Record<BaseAnalyticsVariable, number | null> & {
  timestampUtc: string;
  datetimeLocal: string;
  date: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  weekday: number;
  season: "winter" | "spring" | "summer" | "autumn";
  isWeekend: boolean;
  missingVariables: string[];
  dataQualityStatus: "complete" | "partial" | "empty";
};

type AnalyticsRow = DatasetRow &
  Record<DerivedAnalyticsVariable, number | null> & {
    esFinDeSemana: boolean;
    tipoDia: "laborable" | "sabado" | "domingo";
    estacion: DatasetRow["season"];
  };

type DatasetResponse = {
  filters: {
    fechaDesde: string;
    fechaHasta: string;
    geoId: number | null;
  };
  mapping: Record<string, unknown>;
  totalRows: number;
  returnedRows: number;
  rows: DatasetRow[];
};

type VariableStats = {
  variable: AnalyticsVariable;
  observations: number;
  coveragePct: number;
  mean: number | null;
  median: number | null;
  stdDev: number | null;
  min: number | null;
  max: number | null;
  percentiles: Record<"p1" | "p5" | "p10" | "p25" | "p50" | "p75" | "p90" | "p95" | "p99", number | null>;
  coefficientOfVariation: number | null;
};

type GroupMeanRow = {
  key: string | number;
  label: string;
  rows: number;
  means: Partial<Record<AnalyticsVariable, number | null>>;
};

type DerivedVariableReport = {
  variable: DerivedAnalyticsVariable;
  status: "calculable" | "partial" | "absent" | "not_calculable";
  observations: number;
  coveragePct: number;
  inputs: DerivedInputVariable[];
  missingInputs: DerivedInputVariable[];
  mainMissingReason: string | null;
};

@Injectable()
export class MercadoAnalyticsService {
  constructor(
    private readonly mercadoDatasetService: MercadoDatasetService,
    private readonly mercadoIndicatorMappingService: MercadoIndicatorMappingService
  ) {}

  async analyze(options: AnalyticsOptions) {
    const percentileBounds = normalizePercentileBounds(options.lowerPercentile, options.upperPercentile);
    const [dataset, mappings] = await Promise.all([
      this.mercadoDatasetService.buildHourlyDataset({
        fechaDesde: options.fechaDesde,
        fechaHasta: options.fechaHasta,
        geoId: options.geoId
      }) as Promise<DatasetResponse>,
      this.mercadoIndicatorMappingService.resolveMappings()
    ]);

    const rows = enrichAnalyticsRows(dataset.rows);
    const derivedVariables = buildDerivedVariablesReport(rows);
    const statistics = Object.fromEntries(ANALYTICS_VARIABLES.map((variable) => [variable, calculateStats(variable, rows)]));
    const correlations = buildCorrelations(rows);
    const timeAnalysis = buildTimeAnalysis(rows);
    const outliers = buildOutlierReport(rows, statistics as Record<AnalyticsVariable, VariableStats>, percentileBounds);
    const quality = buildQualityReport(dataset, rows, mappings, outliers, derivedVariables);

    return {
      datasetSummary: {
        fechaDesde: dataset.filters.fechaDesde,
        fechaHasta: dataset.filters.fechaHasta,
        geoId: dataset.filters.geoId,
        rows: rows.length,
        variables: ANALYTICS_VARIABLES.length,
        baseVariables: BASE_ANALYTICS_VARIABLES.length,
        derivedVariables: DERIVED_ANALYTICS_VARIABLES.length,
        completeRows: rows.filter((row) => row.dataQualityStatus === "complete").length,
        partialRows: rows.filter((row) => row.dataQualityStatus === "partial").length,
        emptyRows: rows.filter((row) => row.dataQualityStatus === "empty").length,
        percentileBounds
      },
      derivedVariables,
      statistics,
      correlations,
      timeAnalysis,
      chartData: buildChartData(rows, statistics as Record<AnalyticsVariable, VariableStats>),
      outliers,
      quality,
      qualityReport: quality
    };
  }
}

function enrichAnalyticsRows(rows: DatasetRow[]): AnalyticsRow[] {
  const ordered = [...rows].sort((left, right) => left.timestampUtc.localeCompare(right.timestampUtc));
  const enriched: AnalyticsRow[] = ordered.map((row): AnalyticsRow => {
    const solar = solarGeneration(row);
    const hidraulica = sumNullable(row.hidraulicaUGH, row.hidraulicaNoUGH);
    const huecoTermico = subtractIfPresent(row.demandaPrevista, row.eolica, solar, row.nuclear, row.hidraulicaUGH, row.hidraulicaNoUGH);
    const demandaResidual = subtractIfPresent(row.demandaPrevista, row.eolica, solar);
    const renovable = sumNullable(row.eolica, solar, row.hidraulicaUGH, row.hidraulicaNoUGH);

    return {
      ...row,
      huecoTermico,
      demandaResidual,
      coberturaRenovablePct: ratioPct(renovable, row.demandaPrevista),
      eolicaSobreDemandaPct: ratioPct(row.eolica, row.demandaPrevista),
      solarSobreDemandaPct: ratioPct(solar, row.demandaPrevista),
      hidraulicaSobreDemandaPct: ratioPct(hidraulica, row.demandaPrevista),
      nuclearSobreDemandaPct: ratioPct(row.nuclear, row.demandaPrevista),
      rampaDemanda: null,
      rampaEolica: null,
      rampaSolar: null,
      rampaHuecoTermico: null,
      rampaPrecioOmie: null,
      esFinDeSemana: row.isWeekend,
      tipoDia: row.weekday === 6 ? "sabado" : row.weekday === 0 ? "domingo" : "laborable",
      estacion: row.season
    };
  });

  for (let index = 1; index < enriched.length; index += 1) {
    const previous = enriched[index - 1];
    const current = enriched[index];
    current.rampaDemanda = difference(current.demandaPrevista, previous.demandaPrevista);
    current.rampaEolica = difference(current.eolica, previous.eolica);
    current.rampaSolar = difference(solarGeneration(current), solarGeneration(previous));
    current.rampaHuecoTermico = difference(current.huecoTermico, previous.huecoTermico);
    current.rampaPrecioOmie = difference(current.precioOmie, previous.precioOmie);
  }

  return enriched;
}

function buildDerivedVariablesReport(rows: AnalyticsRow[]): DerivedVariableReport[] {
  const definitions: Record<DerivedAnalyticsVariable, DerivedInputVariable[]> = {
    huecoTermico: ["demandaPrevista", "eolica", "solarPrevista", "nuclear", "hidraulicaUGH", "hidraulicaNoUGH"],
    demandaResidual: ["demandaPrevista", "eolica", "solarPrevista"],
    coberturaRenovablePct: ["demandaPrevista", "eolica", "solarPrevista", "hidraulicaUGH", "hidraulicaNoUGH"],
    eolicaSobreDemandaPct: ["demandaPrevista", "eolica"],
    solarSobreDemandaPct: ["demandaPrevista", "solarPrevista"],
    hidraulicaSobreDemandaPct: ["demandaPrevista", "hidraulicaUGH", "hidraulicaNoUGH"],
    nuclearSobreDemandaPct: ["demandaPrevista", "nuclear"],
    rampaDemanda: ["demandaPrevista"],
    rampaEolica: ["eolica"],
    rampaSolar: ["solarPrevista"],
    rampaHuecoTermico: ["huecoTermico"],
    rampaPrecioOmie: ["precioOmie"]
  };

  return DERIVED_ANALYTICS_VARIABLES.map((variable) => {
    const observations = rows.filter((row) => row[variable] !== null && Number.isFinite(row[variable])).length;
    const missingInputs = definitions[variable].filter((input) => rows.every((row) => row[input as AnalyticsVariable] === null));
    const coveragePct = rows.length === 0 ? 100 : roundPct((observations / rows.length) * 100);
    return {
      variable,
      status: derivedStatus(rows.length, observations, missingInputs),
      observations,
      coveragePct,
      inputs: definitions[variable],
      missingInputs,
      mainMissingReason: missingInputs.length > 0 ? `Inputs sin cobertura: ${missingInputs.join(", ")}` : observations === 0 ? "Sin filas calculables con todos los inputs requeridos." : null
    };
  });
}

function calculateStats(variable: AnalyticsVariable, rows: AnalyticsRow[]): VariableStats {
  const values = sortedNumbers(rows.map((row) => row[variable]));
  const observations = values.length;
  const meanValue = mean(values);
  const stdDevValue = stdDev(values, meanValue);
  return {
    variable,
    observations,
    coveragePct: rows.length === 0 ? 100 : roundPct((observations / rows.length) * 100),
    mean: roundNullable(meanValue),
    median: roundNullable(percentile(values, 50)),
    stdDev: roundNullable(stdDevValue),
    min: roundNullable(values[0] ?? null),
    max: roundNullable(values.at(-1) ?? null),
    percentiles: {
      p1: roundNullable(percentile(values, 1)),
      p5: roundNullable(percentile(values, 5)),
      p10: roundNullable(percentile(values, 10)),
      p25: roundNullable(percentile(values, 25)),
      p50: roundNullable(percentile(values, 50)),
      p75: roundNullable(percentile(values, 75)),
      p90: roundNullable(percentile(values, 90)),
      p95: roundNullable(percentile(values, 95)),
      p99: roundNullable(percentile(values, 99))
    },
    coefficientOfVariation: meanValue === null || stdDevValue === null || meanValue === 0 ? null : round(stdDevValue / Math.abs(meanValue))
  };
}

function buildCorrelations(rows: AnalyticsRow[]) {
  const priceVariable: AnalyticsVariable = "precioOmie";
  const byVariable = ANALYTICS_VARIABLES.filter((variable) => variable !== priceVariable).map((variable) => {
    const pairs = pairedValues(rows, priceVariable, variable);
    return {
      variable,
      observations: pairs.length,
      pearson: roundNullable(pearson(pairs)),
      spearman: roundNullable(spearman(pairs))
    };
  });

  const matrix = ANALYTICS_VARIABLES.map((left) => ({
    variable: left,
    correlations: Object.fromEntries(
      ANALYTICS_VARIABLES.map((right) => {
        const pairs = pairedValues(rows, left, right);
        return [right, { pearson: roundNullable(pearson(pairs)), spearman: roundNullable(spearman(pairs)), observations: pairs.length }];
      })
    )
  }));

  return {
    target: priceVariable,
    withPrecioOmie: byVariable.sort((left, right) => Math.abs(right.pearson ?? 0) - Math.abs(left.pearson ?? 0)),
    matrix
  };
}

function buildTimeAnalysis(rows: AnalyticsRow[]) {
  return {
    byHour: groupedMeans(rows, (row) => row.hour, (key) => `${String(key).padStart(2, "0")}:00`),
    byWeekday: groupedMeans(rows, (row) => row.weekday, weekdayLabel),
    byMonth: groupedMeans(rows, (row) => row.month, (key) => monthLabel(Number(key))),
    bySeason: groupedMeans(rows, (row) => row.season, (key) => seasonLabel(String(key))),
    byDayType: groupedMeans(rows, (row) => row.tipoDia, (key) => tipoDiaLabel(String(key)))
  };
}

function groupedMeans(rows: AnalyticsRow[], keyGetter: (row: AnalyticsRow) => string | number, labelGetter: (key: string | number) => string): GroupMeanRow[] {
  const groups = new Map<string | number, AnalyticsRow[]>();
  for (const row of rows) {
    const key = keyGetter(row);
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right), undefined, { numeric: true }))
    .map(([key, groupRows]) => ({
      key,
      label: labelGetter(key),
      rows: groupRows.length,
      means: Object.fromEntries(ANALYTICS_VARIABLES.map((variable) => [variable, roundNullable(mean(sortedNumbers(groupRows.map((row) => row[variable]))))]))
    }));
}

function buildChartData(rows: AnalyticsRow[], statistics: Record<AnalyticsVariable, VariableStats>) {
  return {
    timeSeries: rows.map((row) => ({
      timestampUtc: row.timestampUtc,
      datetimeLocal: row.datetimeLocal,
      calendar: {
        esFinDeSemana: row.esFinDeSemana,
        tipoDia: row.tipoDia,
        estacion: row.estacion,
        mes: row.month,
        hora: row.hour,
        festivoNacional: null
      },
      values: Object.fromEntries(ANALYTICS_VARIABLES.map((variable) => [variable, row[variable]]))
    })),
    scatterPlots: Object.fromEntries(
      ANALYTICS_VARIABLES.filter((variable) => variable !== "precioOmie").map((variable) => [
        variable,
        pairedRows(rows, "precioOmie", variable).map((row) => ({
          x: row[variable],
          y: row.precioOmie,
          timestampUtc: row.timestampUtc,
          hour: row.hour,
          month: row.month,
          season: row.season,
          tipoDia: row.tipoDia
        }))
      ])
    ),
    heatmaps: {
      precioOmieHourMonth: buildHeatmap(rows, "precioOmie", (row) => row.month, (row) => row.hour),
      huecoTermicoHourMonth: buildHeatmap(rows, "huecoTermico", (row) => row.month, (row) => row.hour)
    },
    boxplots: Object.fromEntries(ANALYTICS_VARIABLES.map((variable) => [variable, buildBoxplot(statistics[variable])])),
    histograms: Object.fromEntries(ANALYTICS_VARIABLES.map((variable) => [variable, buildHistogram(sortedNumbers(rows.map((row) => row[variable])))]))
  };
}

function buildOutlierReport(rows: AnalyticsRow[], statistics: Record<AnalyticsVariable, VariableStats>, bounds: { lowerPercentile: number; upperPercentile: number }) {
  const byVariable = Object.fromEntries(
    ANALYTICS_VARIABLES.map((variable) => {
      const values = sortedNumbers(rows.map((row) => row[variable]));
      const low = percentile(values, bounds.lowerPercentile);
      const high = percentile(values, bounds.upperPercentile);
      const std = statistics[variable].stdDev;
      const avg = statistics[variable].mean;
      const matches = rows
        .filter((row) => {
          const value = row[variable];
          if (value === null || low === null || high === null) {
            return false;
          }
          const zExtreme = avg !== null && std !== null && std > 0 ? Math.abs((value - avg) / std) >= 3 : false;
          return value < low || value > high || zExtreme;
        })
        .slice(0, 250)
        .map((row) => ({
          timestampUtc: row.timestampUtc,
          datetimeLocal: row.datetimeLocal,
          value: row[variable],
          low: roundNullable(low),
          high: roundNullable(high)
        }));
      return [variable, { lowerThreshold: roundNullable(low), upperThreshold: roundNullable(high), count: matches.length, examples: matches }];
    })
  );

  const incompleteHours = rows
    .filter((row) => row.dataQualityStatus !== "complete")
    .slice(0, 500)
    .map((row) => ({
      timestampUtc: row.timestampUtc,
      datetimeLocal: row.datetimeLocal,
      status: row.dataQualityStatus,
      missingVariables: row.missingVariables
    }));

  const daily = groupedDaily(rows);
  const dailyPrices = sortedNumbers(daily.map((day) => day.means.precioOmie ?? null));
  const dailyLow = percentile(dailyPrices, bounds.lowerPercentile);
  const dailyHigh = percentile(dailyPrices, bounds.upperPercentile);
  const anomalousDays = daily
    .filter((day) => {
      const price = day.means.precioOmie ?? null;
      return price !== null && dailyLow !== null && dailyHigh !== null && (price < dailyLow || price > dailyHigh || day.completePct < 80);
    })
    .slice(0, 250)
    .map((day) => ({
      date: day.date,
      rows: day.rows,
      completePct: day.completePct,
      precioOmieMean: day.means.precioOmie,
      reason: day.completePct < 80 ? "Cobertura diaria baja" : "Precio medio diario fuera de percentiles configurados"
    }));

  return {
    percentileBounds: bounds,
    byVariable,
    incompleteHours,
    anomalousDays
  };
}

function buildQualityReport(
  dataset: DatasetResponse,
  rows: AnalyticsRow[],
  mappings: Array<{ variable: string; status: string; confidence: number; warnings: string[] }>,
  outliers: ReturnType<typeof buildOutlierReport>,
  derivedVariables: DerivedVariableReport[]
) {
  const totalCells = rows.length * ANALYTICS_VARIABLES.length;
  const missingCells = dataset.rows.reduce((sum, row) => sum + row.missingVariables.length, 0);
  const derivedMissingCells = rows.reduce((sum, row) => sum + DERIVED_ANALYTICS_VARIABLES.filter((variable) => row[variable] === null).length, 0);
  const incompleteRows = rows.filter((row) => row.dataQualityStatus !== "complete").length;
  const ambiguousMappings = mappings.filter((mapping) => mapping.status === "ambiguous").map((mapping) => mapping.variable);
  const notCalculableDerived = derivedVariables.filter((variable) => variable.status === "not_calculable" || variable.status === "absent");
  const warnings = [
    ...(incompleteRows > 0 ? [`${incompleteRows} horas con datos incompletos.`] : []),
    ...(ambiguousMappings.length > 0 ? [`Mapping ambiguo pendiente: ${ambiguousMappings.join(", ")}.`] : []),
    ...(notCalculableDerived.length > 0 ? [`Variables derivadas no calculables: ${notCalculableDerived.map((variable) => variable.variable).join(", ")}.`] : []),
    ...Object.entries(outliers.byVariable)
      .filter(([, report]) => report.count > 0)
      .map(([variable, report]) => `${variable}: ${report.count} valores extremos detectados.`)
      .slice(0, 8)
  ];
  return {
    coveragePct: totalCells === 0 ? 100 : roundPct(((totalCells - missingCells - derivedMissingCells) / totalCells) * 100),
    baseCoveragePct: dataset.rows.length * BASE_ANALYTICS_VARIABLES.length === 0 ? 100 : roundPct(((dataset.rows.length * BASE_ANALYTICS_VARIABLES.length - missingCells) / (dataset.rows.length * BASE_ANALYTICS_VARIABLES.length)) * 100),
    derivedCoveragePct: rows.length * DERIVED_ANALYTICS_VARIABLES.length === 0 ? 100 : roundPct(((rows.length * DERIVED_ANALYTICS_VARIABLES.length - derivedMissingCells) / (rows.length * DERIVED_ANALYTICS_VARIABLES.length)) * 100),
    incompleteRows,
    missingCells,
    baseMissingCells: missingCells,
    derivedMissingCells,
    ambiguousMappings,
    derivedVariables,
    warnings
  };
}

function pairedRows(rows: AnalyticsRow[], left: AnalyticsVariable, right: AnalyticsVariable) {
  return rows.filter((row) => row[left] !== null && row[right] !== null);
}

function pairedValues(rows: AnalyticsRow[], left: AnalyticsVariable, right: AnalyticsVariable) {
  return pairedRows(rows, left, right).map((row) => [row[left] as number, row[right] as number] as const);
}

function pearson(pairs: ReadonlyArray<readonly [number, number]>) {
  if (pairs.length < 2) {
    return null;
  }
  const xs = pairs.map(([x]) => x);
  const ys = pairs.map(([, y]) => y);
  const xMean = mean(xs);
  const yMean = mean(ys);
  if (xMean === null || yMean === null) {
    return null;
  }
  let numerator = 0;
  let xDenominator = 0;
  let yDenominator = 0;
  for (const [x, y] of pairs) {
    const xd = x - xMean;
    const yd = y - yMean;
    numerator += xd * yd;
    xDenominator += xd * xd;
    yDenominator += yd * yd;
  }
  const denominator = Math.sqrt(xDenominator * yDenominator);
  return denominator === 0 ? null : numerator / denominator;
}

function spearman(pairs: ReadonlyArray<readonly [number, number]>) {
  if (pairs.length < 2) {
    return null;
  }
  const xRanks = rankValues(pairs.map(([x]) => x));
  const yRanks = rankValues(pairs.map(([, y]) => y));
  return pearson(xRanks.map((rank, index) => [rank, yRanks[index]] as const));
}

function rankValues(values: number[]) {
  const sorted = values.map((value, index) => ({ value, index })).sort((left, right) => left.value - right.value);
  const ranks = Array<number>(values.length);
  for (let index = 0; index < sorted.length; ) {
    let end = index + 1;
    while (end < sorted.length && sorted[end].value === sorted[index].value) {
      end += 1;
    }
    const rank = (index + end + 1) / 2;
    for (let cursor = index; cursor < end; cursor += 1) {
      ranks[sorted[cursor].index] = rank;
    }
    index = end;
  }
  return ranks;
}

function buildHeatmap(rows: AnalyticsRow[], variable: AnalyticsVariable, xGetter: (row: AnalyticsRow) => number, yGetter: (row: AnalyticsRow) => number) {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const value = row[variable];
    if (value === null) {
      continue;
    }
    const key = `${xGetter(row)}|${yGetter(row)}`;
    const current = groups.get(key) ?? [];
    current.push(value);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([key, values]) => {
    const [x, y] = key.split("|").map(Number);
    return { x, y, value: roundNullable(mean(values)), observations: values.length };
  });
}

function buildBoxplot(stats: VariableStats) {
  return {
    min: stats.min,
    q1: stats.percentiles.p25,
    median: stats.median,
    q3: stats.percentiles.p75,
    max: stats.max
  };
}

function buildHistogram(values: number[], bins = 20) {
  if (values.length === 0) {
    return [];
  }
  const min = values[0];
  const max = values.at(-1) ?? min;
  if (min === max) {
    return [{ from: round(min), to: round(max), count: values.length }];
  }
  const width = (max - min) / bins;
  const buckets = Array.from({ length: bins }, (_, index) => ({ from: min + index * width, to: min + (index + 1) * width, count: 0 }));
  for (const value of values) {
    const index = Math.min(Math.floor((value - min) / width), bins - 1);
    buckets[index].count += 1;
  }
  return buckets.map((bucket) => ({ from: round(bucket.from), to: round(bucket.to), count: bucket.count }));
}

function groupedDaily(rows: AnalyticsRow[]) {
  const groups = new Map<string, AnalyticsRow[]>();
  for (const row of rows) {
    const current = groups.get(row.date) ?? [];
    current.push(row);
    groups.set(row.date, current);
  }
  return [...groups.entries()].map(([date, dayRows]) => ({
    date,
    rows: dayRows.length,
    completePct: roundPct((dayRows.filter((row) => row.dataQualityStatus === "complete").length / dayRows.length) * 100),
    means: Object.fromEntries(ANALYTICS_VARIABLES.map((variable) => [variable, roundNullable(mean(sortedNumbers(dayRows.map((row) => row[variable]))))])) as Partial<Record<AnalyticsVariable, number | null>>
  }));
}

function normalizePercentileBounds(lowerPercentile?: number, upperPercentile?: number) {
  const lower = lowerPercentile ?? 1;
  const upper = upperPercentile ?? 99;
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower < 0 || upper > 100 || lower >= upper) {
    throw new BadRequestException("Los percentiles de anomalias deben cumplir 0 <= lowerPercentile < upperPercentile <= 100.");
  }
  return { lowerPercentile: lower, upperPercentile: upper };
}

function allPresent(...values: Array<number | null | undefined>) {
  return values.every((value) => value !== null && value !== undefined && Number.isFinite(value));
}

function sumNullable(...values: Array<number | null | undefined>) {
  if (!allPresent(...values)) {
    return null;
  }
  let sum = 0;
  for (const value of values) {
    sum += Number(value);
  }
  return sum;
}

function solarGeneration(row: Pick<DatasetRow, "solarPrevista" | "fotovoltaica" | "termosolar">) {
  if (allPresent(row.solarPrevista)) {
    return Number(row.solarPrevista);
  }
  if (!allPresent(row.fotovoltaica)) {
    return null;
  }
  return round(Number(row.fotovoltaica) + (allPresent(row.termosolar) ? Number(row.termosolar) : 0));
}

function subtractIfPresent(base: number | null, ...subtractors: Array<number | null>) {
  if (!allPresent(base, ...subtractors)) {
    return null;
  }
  let total = 0;
  for (const value of subtractors) {
    total += Number(value);
  }
  return round(Number(base) - total);
}

function ratioPct(numerator: number | null | undefined, denominator: number | null | undefined) {
  if (numerator === null || numerator === undefined || denominator === null || denominator === undefined || denominator === 0) {
    return null;
  }
  return round((numerator / denominator) * 100);
}

function difference(current: number | null | undefined, previous: number | null | undefined) {
  return current === null || current === undefined || previous === null || previous === undefined ? null : round(current - previous);
}

function derivedStatus(rows: number, observations: number, missingInputs: DerivedInputVariable[]): DerivedVariableReport["status"] {
  if (missingInputs.length > 0) {
    return "not_calculable";
  }
  if (observations === 0) {
    return "absent";
  }
  if (observations < rows) {
    return "partial";
  }
  return "calculable";
}

function sortedNumbers(values: Array<number | null | undefined>) {
  return values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value)).sort((left, right) => left - right);
}

function mean(values: number[]) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[], meanValue: number | null) {
  if (values.length < 2 || meanValue === null) {
    return null;
  }
  const variance = values.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function percentile(sortedValues: number[], pct: number) {
  if (sortedValues.length === 0) {
    return null;
  }
  const position = (pct / 100) * (sortedValues.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return sortedValues[lower];
  }
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function round(value: number) {
  return Math.round(value * 1000000) / 1000000;
}

function roundNullable(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? null : round(value);
}

function roundPct(value: number) {
  return Math.round(value * 100) / 100;
}

function weekdayLabel(key: string | number) {
  return ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"][Number(key)] ?? String(key);
}

function monthLabel(month: number) {
  return ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"][month] ?? String(month);
}

function seasonLabel(season: string) {
  return {
    winter: "Invierno",
    spring: "Primavera",
    summer: "Verano",
    autumn: "Otono"
  }[season] ?? season;
}

function tipoDiaLabel(tipoDia: string) {
  return {
    laborable: "Laborable",
    sabado: "Sabado",
    domingo: "Domingo"
  }[tipoDia] ?? tipoDia;
}
