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
  modelo?: string;
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
  solarPrevista: number | null;
  fotovoltaica: number | null;
  termosolar: number | null;
  nuclear: number | null;
  nuclearDisponibleMw: number | null;
  hidraulicaStorageIndex: number | null;
  hidraulicaUGH: number | null;
  hidraulicaNoUGH: number | null;
  bombeo: number | null;
  intercambios: number | null;
  precioGasMibgas?: number | null;
  ntcFranceImportD1?: number | null;
  ntcFranceExportD1?: number | null;
  ntcPortugalImportD1?: number | null;
  ntcPortugalExportD1?: number | null;
  ntcMoroccoImportD1?: number | null;
  ntcMoroccoExportD1?: number | null;
  ccgtDisponibleMw?: number | null;
  hydroDisponibleMw?: number | null;
  pumpingDisponibleMw?: number | null;
};

type EnrichedForecastRow = MercadoBaseRow & {
  festivoNacional: boolean;
  demandaResidual: number | null;
  huecoTermico: number | null;
  huecoTermicoD1: number | null;
  huecoTermicoSobreDemandaPct: number | null;
  huecoSobreCcgtDisponible: number | null;
  huecoSobreDespachableDisponible: number | null;
  margenDespachableMw: number | null;
  coberturaRenovablePct: number | null;
  eolicaSobreDemandaPct: number | null;
  solarSobreDemandaPct: number | null;
  solarPctOfDailyMax: number | null;
  solarDropFromDailyMax: number | null;
  hidraulicaSobreDemandaPct: number | null;
  nuclearSobreDemandaPct: number | null;
  nuclearDisponibleSobreDemandaPct: number | null;
  nuclearPressureLow: number | null;
  hidraulicaStoragePctOfMax: number | null;
  hidraulicaStorageLow: number | null;
  renewablePressurePct: number | null;
  residualDemandLow: number | null;
  solarResidualDemandLow: number | null;
  windPressurePct: number | null;
  solarPressureHigh: number | null;
  precioOmieLag24: number | null;
  precioOmieLag48: number | null;
  precioOmieLag24Night: number | null;
  precioOmieLag48Night: number | null;
  rampaDemanda: number | null;
  rampaEolica: number | null;
  rampaSolar: number | null;
  rampaHuecoTermico: number | null;
  rampaHuecoTermicoD1: number | null;
  eveningThermalGapPressure: number | null;
  eveningSolarExitThermalGap: number | null;
  rampaPrecioOmie: number | null;
  ntcFranceNetD1: number | null;
  ntcPortugalNetD1: number | null;
  ntcMoroccoNetD1: number | null;
  ntcImportTotalD1: number | null;
  ntcExportTotalD1: number | null;
  ntcNetImportD1: number | null;
  ntcNetSobreDemandaPct: number | null;
  exportPressure: number | null;
  importSupport: number | null;
  huecoAjustadoInterconexion: number | null;
  ccgtDisponibleSobreDemandaPct: number | null;
  hydroDisponibleSobreDemandaPct: number | null;
  pumpingDisponibleSobreDemandaPct: number | null;
  thermalAvailabilityPressure: number | null;
  hydroScarcityThermalPressure: number | null;
  hydroSupportRatio: number | null;
  lowStorageHighGap: number | null;
  thermalGapRampPressure: number | null;
  demandRampThermalPressure: number | null;
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
  "huecoTermicoD1",
  "huecoTermicoSobreDemandaPct",
  "huecoSobreCcgtDisponible",
  "huecoSobreDespachableDisponible",
  "margenDespachableMw",
  "coberturaRenovablePct",
  "eolicaSobreDemandaPct",
  "solarSobreDemandaPct",
  "solarPctOfDailyMax",
  "solarDropFromDailyMax",
  "hidraulicaSobreDemandaPct",
  "nuclearSobreDemandaPct",
  "nuclearDisponibleMw",
  "nuclearDisponibleSobreDemandaPct",
  "nuclearPressureLow",
  "hidraulicaStorageIndex",
  "hidraulicaStoragePctOfMax",
  "hidraulicaStorageLow",
  "renewablePressurePct",
  "residualDemandLow",
  "solarResidualDemandLow",
  "windPressurePct",
  "solarPressureHigh",
  "precioOmieLag24",
  "precioOmieLag48",
  "precioOmieLag24Night",
  "precioOmieLag48Night",
  "eolica",
  "solarPrevista",
  "fotovoltaica",
  "termosolar",
  "nuclear",
  "hidraulicaUGH",
  "hidraulicaNoUGH",
  "bombeo",
  "intercambios",
  "precioGasMibgas",
  "ntcFranceImportD1",
  "ntcFranceExportD1",
  "ntcFranceNetD1",
  "ntcPortugalImportD1",
  "ntcPortugalExportD1",
  "ntcPortugalNetD1",
  "ntcMoroccoImportD1",
  "ntcMoroccoExportD1",
  "ntcMoroccoNetD1",
  "ntcImportTotalD1",
  "ntcExportTotalD1",
  "ntcNetImportD1",
  "ntcNetSobreDemandaPct",
  "exportPressure",
  "importSupport",
  "huecoAjustadoInterconexion",
  "ccgtDisponibleMw",
  "ccgtDisponibleSobreDemandaPct",
  "hydroDisponibleMw",
  "hydroDisponibleSobreDemandaPct",
  "pumpingDisponibleMw",
  "pumpingDisponibleSobreDemandaPct",
  "thermalAvailabilityPressure",
  "hydroScarcityThermalPressure",
  "hydroSupportRatio",
  "lowStorageHighGap",
  "rampaDemanda",
  "rampaEolica",
  "rampaSolar",
  "rampaHuecoTermico",
  "rampaHuecoTermicoD1",
  "thermalGapRampPressure",
  "demandRampThermalPressure",
  "eveningThermalGapPressure",
  "eveningSolarExitThermalGap",
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
  "solarPrevista",
  "fotovoltaica",
  "solarSobreDemandaPct",
  "renewablePressurePct",
  "residualDemandLow",
  "solarResidualDemandLow",
  "windPressurePct",
  "solarPressureHigh",
  "nuclearDisponibleMw",
  "nuclearDisponibleSobreDemandaPct",
  "nuclearPressureLow",
  "hidraulicaStorageIndex",
  "hidraulicaStoragePctOfMax",
  "hidraulicaStorageLow",
  "precioGasMibgas",
  "rampaDemanda",
  "rampaEolica",
  "rampaSolar",
  "season_winter",
  "season_spring",
  "season_summer",
  "season_autumn"
]);
const D1_SAFE_FEATURES = new Set([
  "hour",
  "month",
  "weekday",
  "isWeekend",
  "festivoNacional",
  "demandaPrevista",
  "demandaResidual",
  "huecoTermicoD1",
  "huecoTermicoSobreDemandaPct",
  "huecoSobreCcgtDisponible",
  "huecoSobreDespachableDisponible",
  "margenDespachableMw",
  "eolica",
  "eolicaSobreDemandaPct",
  "solarPrevista",
  "solarSobreDemandaPct",
  "solarPctOfDailyMax",
  "solarDropFromDailyMax",
  "solarResidualDemandLow",
  "windPressurePct",
  "solarPressureHigh",
  "precioOmieLag24Night",
  "precioOmieLag48Night",
  "nuclearDisponibleMw",
  "nuclearDisponibleSobreDemandaPct",
  "nuclearPressureLow",
  "hidraulicaStorageIndex",
  "hidraulicaStoragePctOfMax",
  "hidraulicaStorageLow",
  "precioGasMibgas",
  "ntcFranceImportD1",
  "ntcFranceExportD1",
  "ntcFranceNetD1",
  "ntcPortugalImportD1",
  "ntcPortugalExportD1",
  "ntcPortugalNetD1",
  "ntcMoroccoImportD1",
  "ntcMoroccoExportD1",
  "ntcMoroccoNetD1",
  "ntcImportTotalD1",
  "ntcExportTotalD1",
  "ntcNetImportD1",
  "ntcNetSobreDemandaPct",
  "exportPressure",
  "importSupport",
  "huecoAjustadoInterconexion",
  "ccgtDisponibleMw",
  "ccgtDisponibleSobreDemandaPct",
  "hydroDisponibleMw",
  "hydroDisponibleSobreDemandaPct",
  "pumpingDisponibleMw",
  "pumpingDisponibleSobreDemandaPct",
  "thermalAvailabilityPressure",
  "hydroScarcityThermalPressure",
  "hydroSupportRatio",
  "lowStorageHighGap",
  "rampaDemanda",
  "rampaEolica",
  "rampaSolar",
  "rampaHuecoTermicoD1",
  "thermalGapRampPressure",
  "demandRampThermalPressure",
  "eveningThermalGapPressure",
  "eveningSolarExitThermalGap",
  "season_winter",
  "season_spring",
  "season_summer",
  "season_autumn"
]);
const MIN_FEATURE_COVERAGE_PCT = 50;
const MIN_TRAINING_ROWS = 24;
const NUCLEAR_AVAILABLE_LOW_THRESHOLD_MW = 7_000;
const HYDRAULIC_STORAGE_HIGH_REFERENCE = 15_500_000;
const HYDRAULIC_STORAGE_LOW_THRESHOLD = 12_500_000;
const THERMAL_AVAILABILITY_LOW_REFERENCE_MW = 18_000;
const D1_MARKET_FEATURE_INDICATORS = {
  ntcFranceImportD1: 1844,
  ntcFranceExportD1: 1848,
  ntcPortugalImportD1: 1845,
  ntcPortugalExportD1: 1849,
  ntcMoroccoImportD1: 1846,
  ntcMoroccoExportD1: 1850,
  ccgtDisponibleMw: 477,
  hydroDisponibleMw: 472,
  pumpingDisponibleMw: 473
} as const;
type D1MarketFeatureName = keyof typeof D1_MARKET_FEATURE_INDICATORS;
type D1MarketFeatureValues = Partial<Record<D1MarketFeatureName, number>>;

@Injectable()
export class ForecastDatasetBuilderService {
  constructor(
    private readonly mercadoDatasetService: MercadoDatasetService,
    private readonly mercadoIndicatorMappingService: MercadoIndicatorMappingService,
    private readonly prisma?: PrismaService
  ) {}

  async buildTrainingDataset(options: ForecastDatasetOptions): Promise<ForecastDataset> {
    const [dataset, mappings, gasPriceByDate, d1MarketFeaturesByTimestamp] = await Promise.all([
      this.mercadoDatasetService.buildHourlyDataset({
        fechaDesde: options.fechaDesde,
        fechaHasta: options.fechaHasta,
        geoId: options.geoId
      }) as Promise<{ filters: { fechaDesde: string; fechaHasta: string }; totalRows: number; rows: MercadoBaseRow[] }>,
      this.mercadoIndicatorMappingService.resolveMappings(),
      this.loadGasMibgasPrices(options.fechaDesde, options.fechaHasta),
      this.loadD1MarketFeatures(options.fechaDesde, options.fechaHasta)
    ]);

    const enrichedRows = enrichRows(withD1MarketFeatures(withGasPrices(dataset.rows, gasPriceByDate), d1MarketFeaturesByTimestamp));
    const targetRows = enrichedRows.filter((row) => isFiniteNumber(row.precioOmie));
    if (targetRows.length < MIN_TRAINING_ROWS) {
      throw new BadRequestException(`No hay suficientes observaciones con precio OMIE. Minimo requerido: ${MIN_TRAINING_ROWS}.`);
    }

    const featureMatrix = targetRows.map((row) => buildFeatureValues(row));
    const candidates = Object.keys(featureMatrix[0] ?? {});
    const allowedFeatures = featureAllowList(options.modelo);
    const excludedFeatures: ForecastDataset["excludedFeatures"] = [];
    const selectedFeatures: string[] = [];

    for (const feature of candidates) {
      if (TARGET_LEAKAGE_FEATURES.has(feature)) {
        excludedFeatures.push({ variable: feature, reason: "Variable no utilizable en prediccion porque depende del precio OMIE real.", coveragePct: coveragePct(featureMatrix, feature) });
        continue;
      }
      if (!allowedFeatures.has(feature)) {
        excludedFeatures.push({
          variable: feature,
          reason: isD1Model(options.modelo)
            ? "Variable excluida del modelo D+1 porque no esta garantizada antes de la prediccion de manana."
            : "Variable excluida del baseline lineal para evitar colinealidad e inestabilidad numerica.",
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
    const contextFechaDesde = subtractDays(options.fechaDesde, requiredContextDays(options.featureNames));
    const [dataset, gasPriceByDate, d1MarketFeaturesByTimestamp] = await Promise.all([
      this.mercadoDatasetService.buildHourlyDataset({
        fechaDesde: contextFechaDesde,
        fechaHasta: options.fechaHasta,
        geoId: options.geoId
      }) as Promise<{ filters: { fechaDesde: string; fechaHasta: string }; totalRows: number; rows: MercadoBaseRow[] }>,
      this.loadGasMibgasPrices(contextFechaDesde, options.fechaHasta),
      this.loadD1MarketFeatures(contextFechaDesde, options.fechaHasta)
    ]);
    const enrichedRows = enrichRows(withD1MarketFeatures(withGasPrices(dataset.rows, gasPriceByDate), d1MarketFeaturesByTimestamp)).filter((row) => isRequestedDate(row.date, options.fechaDesde, options.fechaHasta));
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

  private async loadD1MarketFeatures(fechaDesde?: string, fechaHasta?: string) {
    if (!this.prisma || !fechaDesde || !fechaHasta) {
      return new Map<string, D1MarketFeatureValues>();
    }
    const start = parseUtcDate(fechaDesde);
    start.setUTCDate(start.getUTCDate() - 1);
    const end = parseUtcDate(fechaHasta);
    end.setUTCDate(end.getUTCDate() + 1);
    end.setUTCHours(23, 59, 59, 999);

    const indicatorEntries = Object.entries(D1_MARKET_FEATURE_INDICATORS) as Array<[D1MarketFeatureName, number]>;
    const rows = await this.prisma.esiosIndicatorValue.findMany({
      where: {
        indicatorId: { in: indicatorEntries.map((entry) => entry[1]) },
        datetime: {
          gte: start,
          lte: end
        },
        value: { not: null }
      },
      select: {
        indicatorId: true,
        datetimeUtc: true,
        datetime: true,
        value: true
      }
    });

    const featureByIndicator = new Map(indicatorEntries.map(([feature, indicatorId]) => [indicatorId, feature]));
    const valuesByTimestamp = new Map<string, D1MarketFeatureValues>();
    for (const row of rows) {
      const feature = featureByIndicator.get(row.indicatorId);
      if (!feature || row.value === null) {
        continue;
      }
      const timestamp = (row.datetimeUtc ?? row.datetime).toISOString();
      const current = valuesByTimestamp.get(timestamp) ?? {};
      current[feature] = round((current[feature] ?? 0) + decimalToNumber(row.value));
      valuesByTimestamp.set(timestamp, current);
    }

    return valuesByTimestamp;
  }
}

function featureAllowList(modelo?: string) {
  return isD1Model(modelo) ? D1_SAFE_FEATURES : LINEAR_BASELINE_FEATURES;
}

function isD1Model(modelo?: string) {
  const normalized = modelo?.trim().toLowerCase();
  return normalized === "randomforestd1" || normalized === "gradientboostingd1";
}

function withGasPrices(rows: MercadoBaseRow[], gasPriceByDate: Map<string, number>): MercadoBaseRow[] {
  return rows.map((row) => ({
    ...row,
    precioGasMibgas: gasPriceByDate.get(row.date) ?? gasPriceByDate.get(row.timestampUtc.slice(0, 10)) ?? null
  }));
}

function withD1MarketFeatures(rows: MercadoBaseRow[], featuresByTimestamp: Map<string, D1MarketFeatureValues>): MercadoBaseRow[] {
  return rows.map((row) => ({
    ...row,
    ...(featuresByTimestamp.get(row.timestampUtc) ?? {})
  }));
}

function parseUtcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function subtractDays(value: string | undefined, days: number) {
  if (!value) {
    return value;
  }
  const date = parseUtcDate(value);
  date.setUTCDate(date.getUTCDate() - days);
  return dateKey(date);
}

function requiredContextDays(featureNames: string[]) {
  return featureNames.some((feature) => feature.includes("Lag48")) ? 2 : 1;
}

function isRequestedDate(date: string, fechaDesde?: string, fechaHasta?: string) {
  return (!fechaDesde || date >= fechaDesde) && (!fechaHasta || date <= fechaHasta);
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function shiftDate(date: string, days: number) {
  const parsed = parseUtcDate(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return dateKey(parsed);
}

function localDateHourKey(date: string, hour: number) {
  return `${date}|${hour}`;
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
  const priceByLocalDateHour = new Map(ordered.map((row) => [localDateHourKey(row.date, row.hour), row.precioOmie]));
  const solarMaxByDate = new Map<string, number>();
  for (const row of ordered) {
    const solar = solarGeneration(row);
    if (!isFiniteNumber(solar)) {
      continue;
    }
    solarMaxByDate.set(row.date, Math.max(solarMaxByDate.get(row.date) ?? 0, solar));
  }
  const enriched = ordered.map((row): EnrichedForecastRow => {
    const solar = solarGeneration(row);
    const solarMax = solarMaxByDate.get(row.date) ?? null;
    const hidraulica = sumNullable(row.hidraulicaUGH, row.hidraulicaNoUGH);
    const renovable = sumNullable(row.eolica, solar, row.hidraulicaUGH, row.hidraulicaNoUGH);
    const forecastRenewable = sumNullable(row.eolica, solar);
    const demandaResidual = subtractIfPresent(row.demandaPrevista, row.eolica, solar);
    const huecoTermicoD1 = subtractIfPresent(row.demandaPrevista, row.eolica, solar, row.nuclearDisponibleMw);
    const solarSobreDemandaPct = ratioPct(solar, row.demandaPrevista);
    const eolicaSobreDemandaPct = ratioPct(row.eolica, row.demandaPrevista);
    const solarResidualDemandLow = solarSobreDemandaPct !== null && solarSobreDemandaPct >= 25 ? positiveGap(demandaResidual, 12_000, 1_000) : 0;
    const solarDropFromDailyMax = subtractIfPresent(solarMax, solar);
    const precioOmieLag24 = priceByLocalDateHour.get(localDateHourKey(shiftDate(row.date, -1), row.hour)) ?? null;
    const precioOmieLag48 = priceByLocalDateHour.get(localDateHourKey(shiftDate(row.date, -2), row.hour)) ?? null;
    const ntcFranceNetD1 = subtractIfPresent(row.ntcFranceImportD1 ?? null, row.ntcFranceExportD1 ?? null);
    const ntcPortugalNetD1 = subtractIfPresent(row.ntcPortugalImportD1 ?? null, row.ntcPortugalExportD1 ?? null);
    const ntcMoroccoNetD1 = subtractIfPresent(row.ntcMoroccoImportD1 ?? null, row.ntcMoroccoExportD1 ?? null);
    const ntcImportTotalD1 = sumNullable(row.ntcFranceImportD1 ?? null, row.ntcPortugalImportD1 ?? null, row.ntcMoroccoImportD1 ?? null);
    const ntcExportTotalD1 = sumNullable(row.ntcFranceExportD1 ?? null, row.ntcPortugalExportD1 ?? null, row.ntcMoroccoExportD1 ?? null);
    const ntcNetImportD1 = subtractIfPresent(ntcImportTotalD1, ntcExportTotalD1);
    const despachableDisponibleMw = sumNullable(row.ccgtDisponibleMw ?? null, row.hydroDisponibleMw ?? null, row.nuclearDisponibleMw);
    const hidraulicaStorageLow = positiveGap(row.hidraulicaStorageIndex, HYDRAULIC_STORAGE_LOW_THRESHOLD, 1_000_000);
    const hidraulicaStorageNormalizado = normalizedRatio(row.hidraulicaStorageIndex, HYDRAULIC_STORAGE_HIGH_REFERENCE);
    return {
      ...row,
      festivoNacional: false,
      huecoTermico: subtractIfPresent(row.demandaPrevista, row.eolica, solar, row.nuclear, row.hidraulicaUGH, row.hidraulicaNoUGH),
      huecoTermicoD1,
      huecoTermicoSobreDemandaPct: ratioPct(huecoTermicoD1, row.demandaPrevista),
      huecoSobreCcgtDisponible: ratio(huecoTermicoD1, row.ccgtDisponibleMw ?? null),
      huecoSobreDespachableDisponible: ratio(huecoTermicoD1, despachableDisponibleMw),
      margenDespachableMw: subtractIfPresent(despachableDisponibleMw, huecoTermicoD1),
      demandaResidual,
      coberturaRenovablePct: ratioPct(renovable, row.demandaPrevista),
      eolicaSobreDemandaPct,
      solarSobreDemandaPct,
      solarPctOfDailyMax: ratioPct(solar, solarMax),
      solarDropFromDailyMax,
      hidraulicaSobreDemandaPct: ratioPct(hidraulica, row.demandaPrevista),
      nuclearSobreDemandaPct: ratioPct(row.nuclear, row.demandaPrevista),
      nuclearDisponibleSobreDemandaPct: ratioPct(row.nuclearDisponibleMw, row.demandaPrevista),
      nuclearPressureLow: positiveGap(row.nuclearDisponibleMw, NUCLEAR_AVAILABLE_LOW_THRESHOLD_MW, 100),
      hidraulicaStoragePctOfMax: ratioPct(row.hidraulicaStorageIndex, HYDRAULIC_STORAGE_HIGH_REFERENCE),
      hidraulicaStorageLow,
      renewablePressurePct: ratioPct(forecastRenewable, row.demandaPrevista),
      residualDemandLow: positiveGap(demandaResidual, 12_000, 1_000),
      solarResidualDemandLow,
      windPressurePct: eolicaSobreDemandaPct,
      solarPressureHigh: positiveExcess(solarSobreDemandaPct, 55),
      precioOmieLag24,
      precioOmieLag48,
      precioOmieLag24Night: nightPriceLag(precioOmieLag24, row.hour),
      precioOmieLag48Night: nightPriceLag(precioOmieLag48, row.hour),
      rampaDemanda: null,
      rampaEolica: null,
      rampaSolar: null,
      rampaHuecoTermico: null,
      rampaHuecoTermicoD1: null,
      eveningThermalGapPressure: eveningThermalGapPressure(huecoTermicoD1, row.hour),
      eveningSolarExitThermalGap: eveningSolarExitThermalGap(huecoTermicoD1, solarDropFromDailyMax, row.hour),
      rampaPrecioOmie: null,
      ntcFranceNetD1,
      ntcPortugalNetD1,
      ntcMoroccoNetD1,
      ntcImportTotalD1,
      ntcExportTotalD1,
      ntcNetImportD1,
      ntcNetSobreDemandaPct: ratioPct(ntcNetImportD1, row.demandaPrevista),
      exportPressure: ratioPct(ntcExportTotalD1, row.demandaPrevista),
      importSupport: ratioPct(ntcImportTotalD1, row.demandaPrevista),
      huecoAjustadoInterconexion: subtractIfPresent(huecoTermicoD1, ntcNetImportD1),
      ccgtDisponibleSobreDemandaPct: ratioPct(row.ccgtDisponibleMw ?? null, row.demandaPrevista),
      hydroDisponibleSobreDemandaPct: ratioPct(row.hydroDisponibleMw ?? null, row.demandaPrevista),
      pumpingDisponibleSobreDemandaPct: ratioPct(row.pumpingDisponibleMw ?? null, row.demandaPrevista),
      thermalAvailabilityPressure: positiveGap(row.ccgtDisponibleMw ?? null, THERMAL_AVAILABILITY_LOW_REFERENCE_MW, 1_000),
      hydroScarcityThermalPressure:
        isFiniteNumber(huecoTermicoD1) && isFiniteNumber(hidraulicaStorageNormalizado) ? round(huecoTermicoD1 * (1 - hidraulicaStorageNormalizado)) : null,
      hydroSupportRatio: ratio(row.hydroDisponibleMw ?? null, isFiniteNumber(huecoTermicoD1) ? Math.max(huecoTermicoD1, 1) : null),
      lowStorageHighGap: multiplyIfPresent(hidraulicaStorageLow, huecoTermicoD1),
      thermalGapRampPressure: null,
      demandRampThermalPressure: null
    };
  });

  for (let index = 1; index < enriched.length; index += 1) {
    const previous = enriched[index - 1];
    const current = enriched[index];
    current.rampaDemanda = difference(current.demandaPrevista, previous.demandaPrevista);
    current.rampaEolica = difference(current.eolica, previous.eolica);
    current.rampaSolar = difference(solarGeneration(current), solarGeneration(previous));
    current.rampaHuecoTermico = difference(current.huecoTermico, previous.huecoTermico);
    current.rampaHuecoTermicoD1 = difference(current.huecoTermicoD1, previous.huecoTermicoD1);
    current.rampaPrecioOmie = difference(current.precioOmie, previous.precioOmie);
    current.thermalGapRampPressure = multiplyIfPresent(current.rampaHuecoTermicoD1, current.huecoTermicoD1);
    current.demandRampThermalPressure = multiplyIfPresent(current.rampaDemanda, current.huecoTermicoD1);
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

function solarGeneration(row: Pick<EnrichedForecastRow, "solarPrevista" | "fotovoltaica" | "termosolar">) {
  if (isFiniteNumber(row.solarPrevista)) {
    return row.solarPrevista;
  }
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

function ratio(numerator: number | null, denominator: number | null, epsilon = 1) {
  if (!isFiniteNumber(numerator) || !isFiniteNumber(denominator) || Math.abs(denominator) < epsilon) {
    return null;
  }
  return round(numerator / denominator);
}

function normalizedRatio(value: number | null, reference: number) {
  if (!isFiniteNumber(value) || !isFiniteNumber(reference) || reference <= 0) {
    return null;
  }
  return round(Math.min(1, Math.max(0, value / reference)));
}

function multiplyIfPresent(left: number | null, right: number | null) {
  if (!isFiniteNumber(left) || !isFiniteNumber(right)) {
    return null;
  }
  return round(left * right);
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

function nightPriceLag(value: number | null, hour: number) {
  if (!isFiniteNumber(value)) {
    return null;
  }
  return hour <= 8 || hour >= 20 ? value : 0;
}

function eveningThermalGapPressure(value: number | null, hour: number) {
  if (!isFiniteNumber(value)) {
    return null;
  }
  return hour >= 17 && hour <= 21 ? value : 0;
}

function eveningSolarExitThermalGap(huecoTermicoD1: number | null, solarDropFromDailyMax: number | null, hour: number) {
  if (!isFiniteNumber(huecoTermicoD1) || !isFiniteNumber(solarDropFromDailyMax)) {
    return null;
  }
  return hour >= 17 && hour <= 21 ? round(huecoTermicoD1 * solarDropFromDailyMax) : 0;
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
