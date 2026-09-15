import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { MercadoDatasetService } from "../../mercado/mercado-dataset.service";
import { MercadoIndicatorMappingService } from "../../mercado/mercado-indicator-mapping.service";
import { PrismaService } from "../../prisma/prisma.service";
import { ForecastDataset, ForecastFeatureRow } from "./prediction-model.interface";

type ForecastDatasetOptions = {
  fechaDesde?: string;
  fechaHasta?: string;
  geoId?: number;
};

type MercadoBaseRow = {
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
  precioOmie: number | null;
  demandaPrevista: number | null;
  eolica: number | null;
  fotovoltaica: number | null;
  termosolar: number | null;
  nuclear: number | null;
  nuclearDisponibleMw: number | null;
  hidraulicaUGH: number | null;
  hidraulicaNoUGH: number | null;
  bombeo: number | null;
  intercambios: number | null;
  precioGasMibgas?: number | null;
};

type EnrichedForecastRow = MercadoBaseRow & {
  festivoNacional: boolean;
  demandaResidual: number | null;
  huecoTermico: number | null;
  coberturaRenovablePct: number | null;
  eolicaSobreDemandaPct: number | null;
  solarSobreDemandaPct: number | null;
  hidraulicaSobreDemandaPct: number | null;
  nuclearSobreDemandaPct: number | null;
  nuclearDisponibleSobreDemandaPct: number | null;
  nuclearPressureLow: number | null;
  renewablePressurePct: number | null;
  residualDemandLow: number | null;
  solarPressureHigh: number | null;
  rampaDemanda: number | null;
  rampaEolica: number | null;
  rampaSolar: number | null;
  rampaHuecoTermico: number | null;
  rampaPrecioOmie: number | null;
};

const NUMERIC_FEATURES = [
  "hour",
  "month",
  "weekday",
  "isWeekend",
  "festivoNacional",
  "demandaPrevista",
  "demandaResidual",
  "huecoTermico",
  "coberturaRenovablePct",
  "eolicaSobreDemandaPct",
  "solarSobreDemandaPct",
  "hidraulicaSobreDemandaPct",
  "nuclearSobreDemandaPct",
  "nuclearDisponibleMw",
  "nuclearDisponibleSobreDemandaPct",
  "nuclearPressureLow",
  "renewablePressurePct",
  "residualDemandLow",
  "solarPressureHigh",
  "eolica",
  "fotovoltaica",
  "termosolar",
  "nuclear",
  "hidraulicaUGH",
  "hidraulicaNoUGH",
  "bombeo",
  "intercambios",
  "precioGasMibgas",
  "rampaDemanda",
  "rampaEolica",
  "rampaSolar",
  "rampaHuecoTermico",
  "rampaPrecioOmie"
] as const;

const SEASON_FEATURES = ["season_winter", "season_spring", "season_summer", "season_autumn"] as const;
const TARGET_LEAKAGE_FEATURES = new Set(["rampaPrecioOmie"]);
const LINEAR_BASELINE_FEATURES = new Set([
  "hour",
  "month",
  "weekday",
  "isWeekend",
  "festivoNacional",
  "demandaPrevista",
  "demandaResidual",
  "eolica",
  "eolicaSobreDemandaPct",
  "fotovoltaica",
  "solarSobreDemandaPct",
  "renewablePressurePct",
  "residualDemandLow",
  "solarPressureHigh",
  "nuclearDisponibleMw",
  "nuclearDisponibleSobreDemandaPct",
  "nuclearPressureLow",
  "precioGasMibgas",
  "rampaDemanda",
  "rampaEolica",
  "rampaSolar",
  "season_winter",
  "season_spring",
  "season_summer",
  "season_autumn"
]);
const MIN_FEATURE_COVERAGE_PCT = 50;
const MIN_TRAINING_ROWS = 24;
const NUCLEAR_AVAILABLE_LOW_THRESHOLD_MW = 7_000;

@Injectable()
export class ForecastDatasetBuilderService {
  constructor(
    private readonly mercadoDatasetService: MercadoDatasetService,
    private readonly mercadoIndicatorMappingService: MercadoIndicatorMappingService,
    private readonly prisma?: PrismaService
  ) {}

  async buildTrainingDataset(options: ForecastDatasetOptions): Promise<ForecastDataset> {
    const [dataset, mappings, gasPriceByDate] = await Promise.all([
      this.mercadoDatasetService.buildHourlyDataset({
        fechaDesde: options.fechaDesde,
        fechaHasta: options.fechaHasta,
        geoId: options.geoId
      }) as Promise<{ filters: { fechaDesde: string; fechaHasta: string }; totalRows: number; rows: MercadoBaseRow[] }>,
      this.mercadoIndicatorMappingService.resolveMappings(),
      this.loadGasMibgasPrices(options.fechaDesde, options.fechaHasta)
    ]);

    const enrichedRows = enrichRows(withGasPrices(dataset.rows, gasPriceByDate));
    const targetRows = enrichedRows.filter((row) => isFiniteNumber(row.precioOmie));
    if (targetRows.length < MIN_TRAINING_ROWS) {
      throw new BadRequestException(`No hay suficientes observaciones con precio OMIE. Minimo requerido: ${MIN_TRAINING_ROWS}.`);
    }

    const featureMatrix = targetRows.map((row) => buildFeatureValues(row));
    const candidates = Object.keys(featureMatrix[0] ?? {});
    const excludedFeatures: ForecastDataset["excludedFeatures"] = [];
    const selectedFeatures: string[] = [];

    for (const feature of candidates) {
      if (TARGET_LEAKAGE_FEATURES.has(feature)) {
        excludedFeatures.push({ variable: feature, reason: "Variable no utilizable en prediccion porque depende del precio OMIE real.", coveragePct: coveragePct(featureMatrix, feature) });
        continue;
      }
      if (!LINEAR_BASELINE_FEATURES.has(feature)) {
        excludedFeatures.push({
          variable: feature,
          reason: "Variable excluida del baseline lineal para evitar colinealidad e inestabilidad numerica.",
          coveragePct: coveragePct(featureMatrix, feature)
        });
        continue;
      }
      const coverage = coveragePct(featureMatrix, feature);
      if (coverage < MIN_FEATURE_COVERAGE_PCT) {
        excludedFeatures.push({ variable: feature, reason: "Cobertura insuficiente.", coveragePct: coverage });
        continue;
      }
      const projectedFeatures = [...selectedFeatures, feature];
      const projectedRows = buildCompleteTrainingRows(targetRows, featureMatrix, projectedFeatures);
      if (projectedRows.length < MIN_TRAINING_ROWS) {
        excludedFeatures.push({ variable: feature, reason: "Reduce demasiado las observaciones completas.", coveragePct: coverage });
        continue;
      }
      selectedFeatures.push(feature);
    }

    const rows = buildCompleteTrainingRows(targetRows, featureMatrix, selectedFeatures);
    if (selectedFeatures.length === 0 || rows.length < MIN_TRAINING_ROWS) {
      throw new BadRequestException("No se pudo construir un dataset de entrenamiento con variables explicativas suficientes.");
    }

    return {
      rows,
      featureNames: selectedFeatures,
      excludedFeatures,
      metadata: {
        fechaDesde: dataset.filters.fechaDesde,
        fechaHasta: dataset.filters.fechaHasta,
        totalRows: dataset.totalRows,
        targetRows: targetRows.length,
        trainingRows: rows.length,
        mappingVariables: mappings.length
      }
    };
  }

  async buildPredictionDataset(options: ForecastDatasetOptions & { fecha: string; featureNames: string[] }): Promise<ForecastDataset> {
    return this.buildPredictionRangeDataset({
      fechaDesde: options.fecha,
      fechaHasta: options.fecha,
      geoId: options.geoId,
      featureNames: options.featureNames
    });
  }

  async buildPredictionRangeDataset(options: ForecastDatasetOptions & { featureNames: string[] }): Promise<ForecastDataset> {
    const contextFechaDesde = subtractOneDay(options.fechaDesde);
    const [dataset, gasPriceByDate] = await Promise.all([
      this.mercadoDatasetService.buildHourlyDataset({
        fechaDesde: contextFechaDesde,
        fechaHasta: options.fechaHasta,
        geoId: options.geoId
      }) as Promise<{ filters: { fechaDesde: string; fechaHasta: string }; totalRows: number; rows: MercadoBaseRow[] }>,
      this.loadGasMibgasPrices(contextFechaDesde, options.fechaHasta)
    ]);
    const enrichedRows = enrichRows(withGasPrices(dataset.rows, gasPriceByDate)).filter((row) => isRequestedDate(row.date, options.fechaDesde, options.fechaHasta));
    const featureMatrix = enrichedRows.map((row) => buildFeatureValues(row));
    const featureCoverage = new Map(options.featureNames.map((feature) => [feature, coveragePct(featureMatrix, feature)]));
    const requiredFeatures = options.featureNames.filter((feature) => !TARGET_LEAKAGE_FEATURES.has(feature));
    const missingRequiredFeatures = requiredFeatures.filter((feature) => (featureCoverage.get(feature) ?? 0) === 0);
    if (missingRequiredFeatures.length > 0) {
      throw new BadRequestException(
        `El modelo requiere variables sin cobertura para la fecha solicitada: ${missingRequiredFeatures.join(", ")}. Revisa la carga de datos o entrena una nueva version con variables disponibles.`
      );
    }
    const usableFeatures = requiredFeatures;
    const excludedFeatures = options.featureNames
      .filter((feature) => !usableFeatures.includes(feature))
      .map((feature) => ({
        variable: feature,
        reason: TARGET_LEAKAGE_FEATURES.has(feature) ? "Variable omitida en prediccion porque depende del precio OMIE real." : "Variable sin cobertura para la fecha solicitada.",
        coveragePct: featureCoverage.get(feature) ?? 0
      }));
    if (usableFeatures.length === 0) {
      throw new BadRequestException(`No hay variables del modelo disponibles para la fecha solicitada. Variables requeridas: ${options.featureNames.join(", ")}.`);
    }
    const rows = enrichedRows
      .map((row, index) => {
        const features = Object.fromEntries(usableFeatures.map((feature) => [feature, featureMatrix[index][feature]]));
        return { timestampUtc: row.timestampUtc, date: row.date, datetimeLocal: row.datetimeLocal, target: isFiniteNumber(row.precioOmie) ? row.precioOmie : 0, features };
      })
      .filter((row) => usableFeatures.every((feature) => isFiniteNumber(row.features[feature])))
      .map((row): ForecastFeatureRow => ({
        ...row,
        features: Object.fromEntries(usableFeatures.map((feature) => [feature, row.features[feature] as number]))
      }));

    if (rows.length === 0) {
      const missingFeatures = usableFeatures.filter((feature) => (featureCoverage.get(feature) ?? 0) === 0);
      throw new BadRequestException(
        `No hay filas con las variables disponibles del modelo para la fecha solicitada. Variables sin cobertura: ${missingFeatures.join(", ") || options.featureNames.join(", ")}.`
      );
    }

    return {
      rows,
      featureNames: usableFeatures,
      excludedFeatures,
      metadata: {
        fechaDesde: options.fechaDesde ?? dataset.filters.fechaDesde,
        fechaHasta: options.fechaHasta ?? dataset.filters.fechaHasta,
        totalRows: enrichedRows.length,
        targetRows: enrichedRows.filter((row) => isFiniteNumber(row.precioOmie)).length,
        trainingRows: rows.length,
        mappingVariables: options.featureNames.length
      }
    };
  }

  private async loadGasMibgasPrices(fechaDesde?: string, fechaHasta?: string) {
    if (!this.prisma || !fechaDesde || !fechaHasta) {
      return new Map<string, number>();
    }
    const range = {
      gte: parseUtcDate(fechaDesde),
      lte: parseUtcDate(fechaHasta)
    };
    const [officialRows, manualRows] = await Promise.all([
      this.prisma.gasMibgasPrice.findMany({
        where: {
          firstDayDelivery: range,
          priceEurMwh: { not: null }
        },
        select: {
          firstDayDelivery: true,
          product: true,
          placeOfDelivery: true,
          area: true,
          priceEurMwh: true
        },
        orderBy: [{ firstDayDelivery: "asc" }, { product: "asc" }]
      }),
      this.prisma.gasMibgasManualPriceOverride.findMany({
        where: {
          firstDayDelivery: range
        },
        select: {
          firstDayDelivery: true,
          product: true,
          placeOfDelivery: true,
          area: true,
          priceEurMwh: true
        },
        orderBy: [{ firstDayDelivery: "asc" }, { product: "asc" }]
      })
    ]);

    const grouped = new Map<string, Array<{ score: number; value: number }>>();
    for (const row of officialRows) {
      if (row.priceEurMwh === null) {
        continue;
      }
      const date = dateKey(row.firstDayDelivery);
      const values = grouped.get(date) ?? [];
      values.push({ score: 1_000 + gasProductScore(row), value: decimalToNumber(row.priceEurMwh) });
      grouped.set(date, values);
    }
    for (const row of manualRows) {
      const date = dateKey(row.firstDayDelivery);
      const values = grouped.get(date) ?? [];
      values.push({ score: 500 + gasProductScore(row), value: decimalToNumber(row.priceEurMwh) });
      grouped.set(date, values);
    }

    return new Map(
      [...grouped.entries()].map(([date, values]) => {
        const sorted = [...values].sort((left, right) => right.score - left.score);
        const bestScore = sorted[0]?.score ?? 0;
        const selected = bestScore > 0 ? sorted.filter((item) => item.score === bestScore) : sorted;
        return [date, round(selected.reduce((sum, item) => sum + item.value, 0) / selected.length)];
      })
    );
  }
}

function withGasPrices(rows: MercadoBaseRow[], gasPriceByDate: Map<string, number>): MercadoBaseRow[] {
  return rows.map((row) => ({
    ...row,
    precioGasMibgas: gasPriceByDate.get(row.date) ?? gasPriceByDate.get(row.timestampUtc.slice(0, 10)) ?? null
  }));
}

function parseUtcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function subtractOneDay(value?: string) {
  if (!value) {
    return value;
  }
  const date = parseUtcDate(value);
  date.setUTCDate(date.getUTCDate() - 1);
  return dateKey(date);
}

function isRequestedDate(date: string, fechaDesde?: string, fechaHasta?: string) {
  return (!fechaDesde || date >= fechaDesde) && (!fechaHasta || date <= fechaHasta);
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function gasProductScore(row: { product: string; placeOfDelivery: string; area: string }) {
  const product = row.product.toUpperCase();
  const place = row.placeOfDelivery.toUpperCase();
  const area = row.area.toUpperCase();
  let score = 0;
  if (product === "GDAES_D+1") {
    score += 100;
  } else if (product.startsWith("GDAES")) {
    score += 50;
  }
  if (place === "PVB") {
    score += 10;
  }
  if (area === "ES") {
    score += 5;
  }
  return score;
}

function decimalToNumber(value: Prisma.Decimal) {
  return Number(value.toString());
}

function enrichRows(rows: MercadoBaseRow[]): EnrichedForecastRow[] {
  const ordered = [...rows].sort((left, right) => left.timestampUtc.localeCompare(right.timestampUtc));
  const enriched = ordered.map((row): EnrichedForecastRow => {
    const solar = solarGeneration(row);
    const hidraulica = sumNullable(row.hidraulicaUGH, row.hidraulicaNoUGH);
    const renovable = sumNullable(row.eolica, row.fotovoltaica, row.termosolar, row.hidraulicaUGH, row.hidraulicaNoUGH);
    const forecastRenewable = sumNullable(row.eolica, solar);
    const demandaResidual = subtractIfPresent(row.demandaPrevista, row.eolica, solar);
    const solarSobreDemandaPct = ratioPct(solar, row.demandaPrevista);
    return {
      ...row,
      festivoNacional: false,
      huecoTermico: subtractIfPresent(row.demandaPrevista, row.eolica, row.fotovoltaica, row.termosolar, row.nuclear, row.hidraulicaUGH, row.hidraulicaNoUGH),
      demandaResidual,
      coberturaRenovablePct: ratioPct(renovable, row.demandaPrevista),
      eolicaSobreDemandaPct: ratioPct(row.eolica, row.demandaPrevista),
      solarSobreDemandaPct,
      hidraulicaSobreDemandaPct: ratioPct(hidraulica, row.demandaPrevista),
      nuclearSobreDemandaPct: ratioPct(row.nuclear, row.demandaPrevista),
      nuclearDisponibleSobreDemandaPct: ratioPct(row.nuclearDisponibleMw, row.demandaPrevista),
      nuclearPressureLow: positiveGap(row.nuclearDisponibleMw, NUCLEAR_AVAILABLE_LOW_THRESHOLD_MW, 100),
      renewablePressurePct: ratioPct(forecastRenewable, row.demandaPrevista),
      residualDemandLow: positiveGap(demandaResidual, 12_000, 1_000),
      solarPressureHigh: positiveExcess(solarSobreDemandaPct, 55),
      rampaDemanda: null,
      rampaEolica: null,
      rampaSolar: null,
      rampaHuecoTermico: null,
      rampaPrecioOmie: null
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

function buildFeatureValues(row: EnrichedForecastRow) {
  const features: Record<string, number | null> = {};
  for (const feature of NUMERIC_FEATURES) {
    const value = row[feature] ?? null;
    features[feature] = typeof value === "boolean" ? (value ? 1 : 0) : value;
  }
  for (const feature of SEASON_FEATURES) {
    features[feature] = feature === `season_${row.season}` ? 1 : 0;
  }
  return features;
}

function buildCompleteTrainingRows(rows: EnrichedForecastRow[], featureMatrix: Array<Record<string, number | null>>, featureNames: string[]): ForecastFeatureRow[] {
  return rows
    .map((row, index) => {
      const features = Object.fromEntries(featureNames.map((feature) => [feature, featureMatrix[index][feature]]));
      return { timestampUtc: row.timestampUtc, date: row.date, datetimeLocal: row.datetimeLocal, target: row.precioOmie as number, features };
    })
    .filter((row) => featureNames.every((feature) => isFiniteNumber(row.features[feature])))
    .map((row): ForecastFeatureRow => ({
      ...row,
      features: Object.fromEntries(featureNames.map((feature) => [feature, row.features[feature] as number]))
    }));
}

function coveragePct(rows: Array<Record<string, number | null>>, feature: string) {
  if (rows.length === 0) {
    return 0;
  }
  return round((rows.filter((row) => isFiniteNumber(row[feature])).length / rows.length) * 100);
}

function subtractIfPresent(base: number | null, ...values: Array<number | null>) {
  if (!isFiniteNumber(base) || values.some((value) => !isFiniteNumber(value))) {
    return null;
  }
  return round(values.reduce((result: number, value) => result - (value as number), base));
}

function sumNullable(...values: Array<number | null>) {
  if (values.some((value) => !isFiniteNumber(value))) {
    return null;
  }
  return round(values.reduce((sum: number, value) => sum + (value as number), 0));
}

function solarGeneration(row: Pick<EnrichedForecastRow, "fotovoltaica" | "termosolar">) {
  if (!isFiniteNumber(row.fotovoltaica)) {
    return null;
  }
  return round(row.fotovoltaica + (isFiniteNumber(row.termosolar) ? row.termosolar : 0));
}

function ratioPct(numerator: number | null, denominator: number | null) {
  if (!isFiniteNumber(numerator) || !isFiniteNumber(denominator) || denominator === 0) {
    return null;
  }
  return round((numerator / denominator) * 100);
}

function positiveGap(value: number | null, threshold: number, divisor = 1) {
  if (!isFiniteNumber(value)) {
    return null;
  }
  return round(Math.max(0, threshold - value) / divisor);
}

function positiveExcess(value: number | null, threshold: number) {
  if (!isFiniteNumber(value)) {
    return null;
  }
  return round(Math.max(0, value - threshold));
}

function difference(current: number | null, previous: number | null) {
  if (!isFiniteNumber(current) || !isFiniteNumber(previous)) {
    return null;
  }
  return round(current - previous);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
