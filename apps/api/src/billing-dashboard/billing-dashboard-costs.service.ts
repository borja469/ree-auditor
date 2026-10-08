import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import * as XLSX from "xlsx";
import {
  CmInvoiceCostComponentCode,
  CmInvoiceCostEnergyBasis,
  CmInvoiceCostRunStatus,
  CmInvoiceIntervalCostStatus,
  OmieTipoPrecio,
  Prisma,
  RegulatedPriceCode,
  ReeSettlementVersion
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { buildPricingCalendarRange, getMadridParts } from "../pricing-base/calendar_builder";
import { resolvePricingPeriod } from "../pricing-base/pricing_period_adapter";
import type { PricingCalendarHour, PricingSettlementVersion } from "../pricing-base/pricing-base.types";
import { LIQUIDATION_MATURITY_ORDER, selectLatestAvailableVersion } from "../pricing-base/version_selector";
import { RegulatedLossesService, type RegulatedLossHourlyValue } from "../ree-losses/regulated-losses.service";
import { ReeLossesRegulatoryEngine } from "../ree-losses/regulatory-engine.service";
import { BillingDashboardRegulatedPricesService } from "./billing-dashboard-regulated-prices.service";
import { resolvePeriodTariff } from "./billing-dashboard-tariff-period";

const CALCULATION_VERSION = "PHASE2_ENERGY_COSTS_V5_POWER_TERM";
const COST_COMPONENTS = ["OMIE_MD", "CAD", "BS3", "RAD3", "RETH", "PC3_CONFIG", "EFIH", "TOLLS_CHARGES_ENERGY", "TOLLS_CHARGES_POWER", "BONO_SOCIAL", "OTROS", "IMU"] as const;
const HISTORICAL_COST_COMPONENTS = ["OMIE_MD", "CAD", "PC3", "BS3", "RAD3", "RETH", "PC3_CONFIG", "EFIH", "TOLLS_CHARGES_ENERGY", "TOLLS_CHARGES_POWER", "BONO_SOCIAL", "OTROS", "IMU"] as const;
const LIQUIDATION_COMPONENTS = ["CAD", "BS3", "RAD3"] as const;
const CONFIGURED_COMPONENTS = ["RETH", "PC3_CONFIG", "EFIH", "BONO_SOCIAL", "OTROS"] as const;
const TOLLS_CHARGES_COMPONENTS = ["TOLLS_CHARGES_ENERGY", "TOLLS_CHARGES_POWER"] as const;
const DERIVED_COMPONENTS = ["IMU"] as const;
const REGULATED_COMPONENTS = [...CONFIGURED_COMPONENTS, ...TOLLS_CHARGES_COMPONENTS, ...DERIVED_COMPONENTS] as const;
const IMU_BASE_COMPONENTS = ["OMIE_MD", "CAD", "BS3", "RAD3", "RETH", "PC3_CONFIG", "EFIH", "BONO_SOCIAL", "OTROS"] as const;
const HOURLY_COMPONENTS = ["CAD"] as const;
const QH_COMPONENTS = ["BS3", "RAD3"] as const;
const COMPONENT_NATURE: Record<CostComponent, CostNature> = {
  OMIE_MD: "ENERGY",
  CAD: "ENERGY",
  PC3: "ENERGY",
  BS3: "ENERGY",
  RAD3: "ENERGY",
  RETH: "ENERGY",
  PC3_CONFIG: "ENERGY",
  EFIH: "ENERGY",
  TOLLS_CHARGES_ENERGY: "ENERGY",
  TOLLS_CHARGES_POWER: "POWER",
  BONO_SOCIAL: "ENERGY",
  OTROS: "ENERGY",
  IMU: "ENERGY"
};
const ENERGY_REPORT_COMPONENTS = COST_COMPONENTS.filter((component) => COMPONENT_NATURE[component] === "ENERGY");
const INDEXED_PRICE_COMPONENT_SCOPES = {
  FULL_ENERGY: ENERGY_REPORT_COMPONENTS,
  OMIE_IMU: ["OMIE_MD", "IMU"] as const
} satisfies Record<string, readonly CostComponent[]>;
type IndexedPriceComponentScope = keyof typeof INDEXED_PRICE_COMPONENT_SCOPES;
const INDEXED_INITIAL_PROFILE_WEIGHTED_TARIFFS = ["2.0TD", "3.0TD", "3.0TDVE"] as const;
const INDEXED_PRICE_HISTORY_CACHE_VERSION = "WEIGHTED_INITIAL_PROFILE_LOSSES_V1";

export type CostComponent = (typeof HISTORICAL_COST_COMPONENTS)[number];
export type CostNature = "ENERGY" | "POWER";
type LiquidationComponent = (typeof LIQUIDATION_COMPONENTS)[number];
type ComponentStatus = "OK" | "WARNING" | "ERROR";

type CurveIntervalForCosts = {
  id: string;
  invoiceId: string;
  datetime: Date;
  tariffPeriod: string;
  consumptionPfKwh: Prisma.Decimal | null;
  consumptionBcKwh: Prisma.Decimal | null;
};

type InvoiceLineForCosts = {
  accountName: string | null;
  lineName: string | null;
  quantity: Prisma.Decimal | null;
  priceUnit: Prisma.Decimal | null;
  priceSubtotal: Prisma.Decimal | null;
};

type TimeKey = {
  iso: string;
  fecha: string;
  hourlyKey: string;
  quarterKey: string;
  hourOrder: number;
  quarterOrder: number;
};

type SourcePrice = {
  priceEurMwh: number | null;
  sourceTable: string | null;
  sourceRowId: string | null;
  sourceVersion: PricingSettlementVersion | null;
  sourceResolutionMinutes: number;
  regulatedPriceVersionId?: string | null;
  regulatedPriceVersionName?: string | null;
  sourceValidFrom?: string | null;
  sourceValidTo?: string | null;
  sourceTariffCode?: string | null;
  sourceTariffPeriod?: string | null;
  sourceErrorCode?: string | null;
  percentage?: number | null;
};

type SourceCandidate = SourcePrice & {
  version: PricingSettlementVersion;
};

type CostComponentResult = {
  componentCode: CostComponent;
  energyBasis: "BC" | "PF" | "ECONOMIC_AMOUNT";
  energyKwh: number | null;
  energyMwh: number | null;
  priceEurMwh: number | null;
  baseAmountEur: number | null;
  percentage: number | null;
  costEur: number | null;
  sourceTable: string | null;
  sourceRowId: string | null;
  sourceVersion: PricingSettlementVersion | null;
  regulatedPriceVersionId: string | null;
  regulatedPriceVersionName: string | null;
  sourceValidFrom: string | null;
  sourceValidTo: string | null;
  sourceTariffCode: string | null;
  sourceTariffPeriod: string | null;
  sourceResolutionMinutes: number | null;
  status: ComponentStatus;
  incidentCode: string | null;
};

type ComponentSummary = {
  componentCode: CostComponent;
  nature: CostNature;
  calculationBasis: "BC" | "PF" | "ECONOMIC_AMOUNT" | "CONTRACTED_POWER" | null;
  costEur: number;
  weightedPriceEurMwh: number | null;
  intervals: number;
  incidents: number;
  versions: string[];
};

type PowerPriceSource = {
  annualPriceEurKwYear: number | null;
  sourceTable: string | null;
  sourceRowId: string | null;
  regulatedPriceVersionId: string | null;
  regulatedPriceVersionName: string | null;
  sourceValidFrom: string | null;
  sourceValidTo: string | null;
  sourceTariffCode: string | null;
  sourceTariffPeriod: string | null;
  sourceErrorCode?: string | null;
};

type PowerCostComponentResult = {
  componentCode: "TOLLS_CHARGES_POWER";
  calculationBasis: "CONTRACTED_POWER";
  tariffCode: string | null;
  tariffPeriod: string | null;
  contractedPowerKw: number | null;
  startDate: string;
  endDate: string;
  billedDays: number;
  yearDays: number | null;
  annualPriceEurKwYear: number | null;
  costEur: number | null;
  sourceTable: string | null;
  sourceRowId: string | null;
  regulatedPriceVersionId: string | null;
  regulatedPriceVersionName: string | null;
  sourceValidFrom: string | null;
  sourceValidTo: string | null;
  status: ComponentStatus;
  incidentCode: string | null;
};

type RegulatedVersionRow = Prisma.RegulatedPriceVersionGetPayload<{ include: ReturnType<typeof regulatedPriceContextInclude> }>;
type RegulatedPriceContext = { byCode: Map<RegulatedPriceCode, RegulatedVersionRow[]> };
export type BillingCostRunSharedContext = {
  omie: Map<string, SourcePrice>;
  hourly: ReturnType<typeof groupLiquidations>;
  qh: ReturnType<typeof groupLiquidations>;
  regulatedContext: RegulatedPriceContext | null;
};
export type BillingCostPersistenceMode = "DETAIL" | "SUMMARY_ONLY";
type IndexedPriceAccumulator = { total: number; hours: number; weightedTotal: number; weightTotal: number; weighted: boolean; incidents: Set<string> };
type IndexedPriceHourDetail = {
  date: string;
  hour: number;
  period: string;
  totalEurMwh: number;
  initialProfile: number | null;
  weightedProduct: number | null;
  incidents: string[];
  components: Array<{
    componentCode: CostComponent;
    label: string;
    priceEurMwh: number | null;
    percentage: number | null;
    costEur: number | null;
    status: ComponentStatus;
    incidentCode: string | null;
  }>;
};

@Injectable()
export class BillingDashboardCostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regulatedPrices?: BillingDashboardRegulatedPricesService,
    private readonly regulatoryEngine?: ReeLossesRegulatoryEngine,
    private readonly regulatedLosses?: RegulatedLossesService
  ) {}

  async calculateCosts(invoiceId: string, sharedContext?: BillingCostRunSharedContext | null, persistenceMode: BillingCostPersistenceMode = "DETAIL") {
    if (!billingJobProfilingEnabled()) return this.calculateCostsInternal(invoiceId, undefined, sharedContext, persistenceMode);
    const phases: Record<string, number> = {};
    const started = Date.now();
    const { result, profile } = await this.prisma.profileQueries(() => this.calculateCostsInternal(invoiceId, phases, sharedContext, persistenceMode));
    const totalMs = Date.now() - started;
    console.log(JSON.stringify({
      scope: "billing-costs",
      invoiceId,
      totalMs,
      phases,
      sql: profile
    }));
    return result;
  }

  async buildSharedCostContext(fechaInicio: string, fechaFin: string): Promise<BillingCostRunSharedContext> {
    const [omie, hourly, qh, regulatedContext] = await Promise.all([
      this.loadOmie(fechaInicio, fechaFin),
      this.loadHourlyLiquidations(fechaInicio, fechaFin),
      this.loadQhLiquidations(fechaInicio, fechaFin),
      this.loadRegulatedPriceContext(fechaInicio, fechaFin)
    ]);
    return { omie, hourly, qh, regulatedContext };
  }

  private async calculateCostsInternal(invoiceId: string, phases?: Record<string, number>, sharedContext?: BillingCostRunSharedContext | null, persistenceMode: BillingCostPersistenceMode = "DETAIL") {
    const invoice = await timePhase(phases, "loadInvoiceMs", () => this.prisma.cmInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        economicSign: true,
        periodStart: true,
        periodEnd: true,
        tariffCode: true,
        lines: {
          select: {
            accountName: true,
            lineName: true,
            quantity: true,
            priceUnit: true,
            priceSubtotal: true
          }
        },
        curve: {
          orderBy: { datetime: "asc" },
          select: {
            id: true,
            invoiceId: true,
            datetime: true,
            tariffPeriod: true,
            consumptionPfKwh: true,
            consumptionBcKwh: true
          }
        }
      }
    }));
    if (!invoice) throw new NotFoundException("Factura no encontrada.");
    if (invoice.curve.length === 0) throw new BadRequestException("La factura no tiene curva normalizada de Fase 1.");

    const run = await timePhase(phases, "createRunMs", () =>
      this.prisma.cmInvoiceCostRun.create({
        data: {
          invoiceId,
          status: CmInvoiceCostRunStatus.PROCESSING,
          calculationVersion: CALCULATION_VERSION
        }
      })
    );

    try {
      const result = await timePhase(phases, "buildCostRunMs", () => this.buildCostRun(invoice.curve, invoice.tariffCode, invoice.periodStart, invoice.periodEnd, invoice.lines, sharedContext, invoice.economicSign));
      await timePhase(phases, "persistCostRunMs", () => this.persistCostRun(run.id, invoiceId, result, persistenceMode));
      const updatedRun = await timePhase(phases, "loadPersistedRunMs", () => this.prisma.cmInvoiceCostRun.findUnique({ where: { id: run.id } }));
      if (!updatedRun) return timePhase(phases, "getCostsMs", () => this.getCosts(invoiceId, run.id));
      return costsResponseFromCalculatedResult(updatedRun, result);
    } catch (error) {
      await this.prisma.cmInvoiceCostRun.update({
        where: { id: run.id },
        data: {
          status: CmInvoiceCostRunStatus.ERROR,
          completedAt: new Date(),
          message: error instanceof Error ? error.message : String(error)
        }
      });
      throw error;
    }
  }

  async getCosts(invoiceId: string, runId?: string) {
    const run = await this.findCostRun(invoiceId, runId);
    if (!run) {
      return {
        status: "NOT_CALCULATED",
        latestRun: null,
        componentSummary: [],
        totals: null,
        liquidationVersions: []
      };
    }
    const components = await this.prisma.cmInvoiceIntervalCostComponent.findMany({
      where: { intervalCost: { costRunId: run.id } },
      orderBy: [{ componentCode: "asc" }]
    });
    const powerComponents = await this.prisma.cmInvoicePowerCostComponent.findMany({
      where: { costRunId: run.id },
      orderBy: [{ tariffPeriod: "asc" }, { startDate: "asc" }]
    });
    const storedSummary = parseStoredComponentSummary(run.summaryJson);
    const componentSummary = components.length > 0
      ? summarizeComponents(components.map(componentRow), powerComponents.map(powerComponentRow))
      : storedSummary;
    return {
      status: run.status === "COMPLETED" && run.incidentsCount === 0 ? "COSTS_READY" : run.status,
      latestRun: costRunRow(run),
      componentSummary,
        totals: {
          omieEur: decimalToNumber(run.totalOmieEur),
          liquidationsEur: decimalToNumber(run.totalLiquidationsEur),
          regulatedEur: decimalToNumber(run.totalRegulatedEur),
          configuredEnergyEur: decimalToNumber(run.totalConfiguredEur),
          tollsChargesEur: decimalToNumber(run.totalTollsChargesEur),
          tollsChargesPowerEur: decimalToNumber(run.totalTollsChargesPowerEur),
          derivedEur: decimalToNumber(run.totalDerivedEur),
          totalCostEur: decimalToNumber(run.totalCostEur)
        },
      powerDetails: powerComponents.map(powerComponentRow),
      liquidationVersions: components.length > 0
        ? summarizeLiquidationVersions(components.map(componentRow))
        : summarizeLiquidationVersionsFromSummary(componentSummary)
    };
  }

  async listRuns(invoiceId: string) {
    const runs = await this.prisma.cmInvoiceCostRun.findMany({
      where: { invoiceId },
      orderBy: { startedAt: "desc" },
      take: 50
    });
    return runs.map(costRunRow);
  }

  async indexedPriceHistory(query: Record<string, unknown>) {
    const { dateFrom, dateTo, scopeKey, componentCodes } = parseIndexedPriceHistoryQuery(query);
    const snapshot = await this.prisma.cmIndexedPriceHistorySnapshot.findUnique({
      where: {
        dateFrom_dateTo_calculationVersion_scopeKey: {
          dateFrom: new Date(`${dateFrom}T00:00:00.000Z`),
          dateTo: new Date(`${dateTo}T00:00:00.000Z`),
          calculationVersion: CALCULATION_VERSION,
          scopeKey
        }
      }
    });
    if (!snapshot) {
      return {
        dateFrom,
        dateTo,
        calculationVersion: CALCULATION_VERSION,
        calculatedAt: null,
        fromCache: true,
        componentCodes,
        tariffs: []
      };
    }
    return {
      ...(snapshot.resultJson as Record<string, unknown>),
      calculationVersion: snapshot.calculationVersion,
      calculatedAt: snapshot.calculatedAt,
      fromCache: true
    };
  }

  async recalculateIndexedPriceHistory(query: Record<string, unknown>) {
    const { dateFrom, dateTo, scopeKey } = parseIndexedPriceHistoryQuery(query);
    const report = await this.calculateIndexedPriceHistory(query);
    const snapshot = await this.prisma.cmIndexedPriceHistorySnapshot.upsert({
      where: {
        dateFrom_dateTo_calculationVersion_scopeKey: {
          dateFrom: new Date(`${dateFrom}T00:00:00.000Z`),
          dateTo: new Date(`${dateTo}T00:00:00.000Z`),
          calculationVersion: CALCULATION_VERSION,
          scopeKey
        }
      },
      create: {
        dateFrom: new Date(`${dateFrom}T00:00:00.000Z`),
        dateTo: new Date(`${dateTo}T00:00:00.000Z`),
        calculationVersion: CALCULATION_VERSION,
        scopeKey,
        resultJson: report as Prisma.InputJsonValue,
        calculatedAt: new Date()
      },
      update: {
        resultJson: report as Prisma.InputJsonValue,
        calculatedAt: new Date()
      }
    });
    return {
      ...report,
      calculationVersion: snapshot.calculationVersion,
      calculatedAt: snapshot.calculatedAt,
      fromCache: false
    };
  }

  private async calculateIndexedPriceHistory(query: Record<string, unknown>) {
    const dateFrom = isoDate(query.dateFrom);
    const dateTo = isoDate(query.dateTo);
    if (!dateFrom || !dateTo) throw new BadRequestException("Fecha desde y fecha hasta son obligatorias.");
    if (dateFrom > dateTo) throw new BadRequestException("Fecha desde no puede ser posterior a fecha hasta.");
    if (enumerateDatesInclusive(dateFrom, dateTo).length > 1830) throw new BadRequestException("El rango maximo permitido es de 5 anos.");

    const requestedTariff = normalizeTariffCode(text(query.tariffCode));
    const { componentCodes } = parseIndexedPriceHistoryQuery(query);
    const tariffs = requestedTariff ? [requestedTariff] : await this.listIndexedPriceTariffs(dateFrom, dateTo);
    if (tariffs.length === 0) return { dateFrom, dateTo, componentCodes, tariffs: [] };

    const periodContext = await this.regulatoryEngine?.buildPeriodContext();
    if (!periodContext) throw new BadRequestException("No se pudo cargar el calendario tarifario.");

    const calendar = buildPricingCalendarRange(dateFrom, dateTo);
    const quarterInstants = calendar.flatMap((hour) => quarterInstantsForHour(hour.timestampInicio));
    const timeKeys = buildMadridQuarterKeys(quarterInstants);
    const [omie, hourly, qh, regulatedContext, initialProfiles] = await Promise.all([
      this.loadOmie(dateFrom, dateTo),
      this.loadHourlyLiquidations(dateFrom, dateTo),
      this.loadQhLiquidations(dateFrom, dateTo),
      this.loadRegulatedPriceContext(dateFrom, dateTo),
      this.loadIndexedInitialProfiles(calendar)
    ]);

    const responseTariffs = [];
    for (const tariffCode of tariffs) {
      const losses = await this.loadIndexedLosses(calendar, tariffCode);
      const monthMap = new Map<string, Map<string, IndexedPriceAccumulator>>();
      const detailsByKey = new Map<string, IndexedPriceHourDetail[]>();
      const periodTariff = resolvePeriodTariff(tariffCode);
      for (const hour of calendar) {
        const tariffPeriod = resolvePricingPeriod(periodTariff, { fecha: hour.fecha, hora: hour.hora }, periodContext);
        if (!isTariffPeriod(tariffPeriod)) continue;
        const quarterComponents = quarterInstantsForHour(hour.timestampInicio)
          .map((instant) => timeKeys.get(instant.toISOString()))
          .filter((key): key is TimeKey => Boolean(key))
          .map((key) => this.buildIndexedQuarterComponents(key, tariffCode, tariffPeriod, omie, hourly, qh, regulatedContext, losses.get(key.hourlyKey) ?? null, componentCodes));
        if (quarterComponents.length === 0) continue;

        const hourComponents = aggregateIndexedHourComponents(quarterComponents, componentCodes);
        const total = hourComponents.reduce((sum, item) => sum + (item.status === "OK" && item.costEur !== null ? item.costEur : 0), 0);
        const incidents = uniqueStrings(hourComponents.map((item) => item.incidentCode).filter((item): item is string => Boolean(item)));
        const useWeighting = usesInitialProfileWeighting(tariffCode);
        const initialProfile = useWeighting ? initialProfiles.get(indexedInitialProfileKey(tariffCode, hour.fecha, hour.hora)) ?? null : null;
        if (useWeighting && initialProfile === null) incidents.push("INITIAL_PROFILE_NOT_FOUND");
        const month = hour.fecha.slice(0, 7);
        const periodMap = monthMap.get(month) ?? new Map<string, IndexedPriceAccumulator>();
        const accumulator = periodMap.get(tariffPeriod) ?? { total: 0, hours: 0, weightedTotal: 0, weightTotal: 0, weighted: useWeighting, incidents: new Set<string>() };
        accumulator.total += total;
        accumulator.hours += 1;
        accumulator.weighted = accumulator.weighted || useWeighting;
        if (useWeighting && initialProfile !== null) {
          accumulator.weightedTotal += total * initialProfile;
          accumulator.weightTotal += initialProfile;
        }
        for (const incident of incidents) accumulator.incidents.add(incident);
        periodMap.set(tariffPeriod, accumulator);
        monthMap.set(month, periodMap);

        const detailKey = indexedDetailKey(tariffCode, month, tariffPeriod);
        const details = detailsByKey.get(detailKey) ?? [];
        details.push({
          date: hour.fecha,
          hour: hour.hora,
          period: tariffPeriod,
          totalEurMwh: total,
          initialProfile,
          weightedProduct: initialProfile === null ? null : total * initialProfile,
          incidents,
          components: hourComponents.map(indexedComponentRow)
        });
        detailsByKey.set(detailKey, details);
      }

      const periods = uniqueStrings([...monthMap.values()].flatMap((periodsForMonth) => [...periodsForMonth.keys()])).sort(compareTariffPeriods);
      const rows = enumerateMonthsInclusive(dateFrom, dateTo).map((month) => {
        const values: Record<string, { priceEurMwh: number | null; hours: number; incidents: string[] }> = {};
        for (const period of periods) {
          const value = monthMap.get(month)?.get(period);
          const incidents = value ? [...value.incidents].sort() : [];
          if (value?.weighted && value.weightTotal <= 0) incidents.push("INITIAL_PROFILE_WEIGHT_ZERO");
          values[period] = value
            ? { priceEurMwh: indexedAveragePrice(value), hours: value.hours, incidents }
            : { priceEurMwh: null, hours: 0, incidents: [] };
        }
        return { month, values };
      });
      responseTariffs.push({
        tariffCode,
        periods,
        rows,
        details: Object.fromEntries([...detailsByKey.entries()].map(([key, value]) => [key, value.sort((left, right) => left.date.localeCompare(right.date) || left.hour - right.hour)]))
      });
    }

    return { dateFrom, dateTo, componentCodes, tariffs: responseTariffs };
  }

  async exportCostsWorkbook(invoiceId: string, runId: string) {
    const [invoice, run] = await Promise.all([
      this.prisma.cmInvoice.findUnique({
        where: { id: invoiceId },
        select: {
          id: true,
          invoiceNumber: true,
          gisceInvoiceId: true,
          cups: true,
          polissaNumber: true,
          tariffCode: true,
          invoiceDate: true,
          periodStart: true,
          periodEnd: true,
          economicSign: true,
          expectedIntervals: true,
          f1Intervals: true,
          p1Intervals: true,
          f5dIntervals: true,
          p5dIntervals: true,
          profiledIntervals: true,
          missingIntervals: true,
          lines: {
            select: {
              accountName: true,
              lineName: true,
              quantity: true,
              priceUnit: true,
              priceSubtotal: true
            }
          },
          curve: {
            orderBy: { datetime: "asc" },
            select: {
              id: true,
              invoiceId: true,
              datetime: true,
              tariffPeriod: true,
              consumptionSource: true,
              profileType: true,
              consumptionPfKwh: true,
              consumptionBcKwh: true,
              lossPercentage: true,
              lossVersion: true,
              validationStatus: true,
              validationMessage: true
            }
          }
        }
      }),
      this.prisma.cmInvoiceCostRun.findFirst({ where: { id: runId, invoiceId } })
    ]);
    if (!invoice) throw new NotFoundException("Factura no encontrada.");
    if (!run) throw new NotFoundException("Run de costes no encontrado para esta factura.");
    if (invoice.curve.length === 0) throw new BadRequestException("La factura no tiene curva normalizada.");

    const [intervalCosts, powerComponents] = await Promise.all([
      this.prisma.cmInvoiceIntervalCost.findMany({
        where: { costRunId: run.id },
        include: { components: true },
        orderBy: { datetime: "asc" }
      }),
      this.prisma.cmInvoicePowerCostComponent.findMany({
        where: { costRunId: run.id },
        orderBy: [{ tariffPeriod: "asc" }, { startDate: "asc" }]
      })
    ]);
    const calculatedDetail = intervalCosts.length === 0
      ? await this.buildCostRun(invoice.curve, invoice.tariffCode, invoice.periodStart, invoice.periodEnd, invoice.lines, null, invoice.economicSign)
      : null;
    const persistedCostsByCurveId = new Map(intervalCosts.filter((item) => item.curveIntervalId).map((item) => [item.curveIntervalId!, auditIntervalCostRow(item)]));
    const persistedCostsByDatetime = new Map(intervalCosts.map((item) => [item.datetime.toISOString(), auditIntervalCostRow(item)]));
    const calculatedCostsByCurveId = new Map(calculatedDetail?.intervalCosts.filter((item) => item.curveIntervalId).map((item) => [item.curveIntervalId, auditCalculatedIntervalCostRow(item)]) ?? []);
    const calculatedCostsByDatetime = new Map(calculatedDetail?.intervalCosts.map((item) => [item.datetime.toISOString(), auditCalculatedIntervalCostRow(item)]) ?? []);
    const fileName = `Factura_${sanitizeFileName(invoice.invoiceNumber ?? String(invoice.gisceInvoiceId))}_Costes_${sanitizeFileName(run.calculationVersion)}.xlsx`;
    const workbook = buildBillingAuditWorkbook({
      invoice: {
        invoiceNumber: invoice.invoiceNumber ?? String(invoice.gisceInvoiceId),
        cups: invoice.cups,
        polissaNumber: invoice.polissaNumber,
        tariffCode: invoice.tariffCode,
        invoiceDate: dateOnly(invoice.invoiceDate),
        periodStart: dateOnly(invoice.periodStart),
        periodEnd: dateOnly(invoice.periodEnd),
        curveSummary: {
          expectedIntervals: invoice.expectedIntervals,
          f1Intervals: invoice.f1Intervals,
          p1Intervals: invoice.p1Intervals,
          f5dIntervals: invoice.f5dIntervals,
          p5dIntervals: invoice.p5dIntervals,
          profiledIntervals: invoice.profiledIntervals,
          missingIntervals: invoice.missingIntervals
        }
      },
      run: costRunRow(run),
      curveRows: invoice.curve.map((curve) => ({
        id: curve.id,
        datetime: curve.datetime,
        tariffPeriod: curve.tariffPeriod,
        consumptionSource: String(curve.consumptionSource),
        profileType: curve.profileType ? String(curve.profileType) : null,
        consumptionPfKwh: decimalToNumber(curve.consumptionPfKwh),
        consumptionBcKwh: decimalToNumber(curve.consumptionBcKwh),
        lossPercentage: decimalToNumber(curve.lossPercentage),
        lossVersion: curve.lossVersion,
        validationStatus: curve.validationStatus,
        validationMessage: curve.validationMessage,
        intervalCost: persistedCostsByCurveId.get(curve.id)
          ?? persistedCostsByDatetime.get(curve.datetime.toISOString())
          ?? calculatedCostsByCurveId.get(curve.id)
          ?? calculatedCostsByDatetime.get(curve.datetime.toISOString())
          ?? null
      })),
      powerRows: powerComponents.length > 0 ? powerComponents.map(powerComponentRow) : calculatedDetail?.powerCosts ?? []
    });
    return { fileName, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", content: workbook };
  }

  async listIntervals(invoiceId: string, query: Record<string, unknown>) {
    const run = await this.findCostRun(invoiceId, text(query.runId));
    if (!run) {
      return { total: 0, page: 1, pageSize: parseInteger(query.take, 50, 1, 500), items: [] };
    }
    const skip = parseInteger(query.skip, 0, 0, 10_000_000);
    const take = parseInteger(query.take, 50, 1, 500);
    const component = isCostComponent(text(query.component)) ? text(query.component) : null;
    const version = isPricingVersion(text(query.version)) ? text(query.version) : null;
    const incident = text(query.incident);
    const status = isIntervalStatus(text(query.status)) ? text(query.status) : null;
    const from = isoDate(query.dateFrom);
    const to = isoDate(query.dateTo);
    const where: Prisma.CmInvoiceIntervalCostWhereInput = {
      costRunId: run.id,
      ...(status ? { status: status as CmInvoiceIntervalCostStatus } : {}),
      ...(from || to ? { datetime: { ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) } } : {}),
      ...(component || version || incident
        ? {
            components: {
              some: {
                ...(component ? { componentCode: component as CmInvoiceCostComponentCode } : {}),
                ...(version ? { sourceVersion: version as ReeSettlementVersion } : {}),
                ...(incident ? { incidentCode: incident } : {})
              }
            }
          }
        : {})
    };
    const [total, rows] = await Promise.all([
      this.prisma.cmInvoiceIntervalCost.count({ where }),
      this.prisma.cmInvoiceIntervalCost.findMany({
        where,
        orderBy: { datetime: "asc" },
        skip,
        take,
        include: { components: { orderBy: { componentCode: "asc" } } }
      })
    ]);
    return {
      total,
      page: Math.floor(skip / take) + 1,
      pageSize: take,
      run: costRunRow(run),
      items: rows.map((row) => ({
        id: row.id,
        datetime: row.datetime.toISOString(),
        tariffPeriod: row.tariffPeriod,
        bcKwh: decimalToNumber(row.bcKwh),
        pfKwh: decimalToNumber(row.pfKwh),
        liquidationsCostEur: decimalToNumber(row.liquidationsCostEur),
        regulatedCostEur: decimalToNumber(row.regulatedCostEur),
        configuredCostEur: decimalToNumber(row.configuredCostEur),
        tollsChargesCostEur: decimalToNumber(row.tollsChargesCostEur),
        derivedCostEur: decimalToNumber(row.derivedCostEur),
        totalCostEur: decimalToNumber(row.totalCostEur),
        status: row.status,
        incidentCodes: Array.isArray(row.incidentCodes) ? row.incidentCodes : [],
        components: row.components.map(componentRow)
      }))
    };
  }

  private async listIndexedPriceTariffs(dateFrom: string, dateTo: string) {
    const [pc3Rows, tollsRows, invoiceRows] = await Promise.all([
      this.prisma.regulatedPc3Price.findMany({
        where: { version: { is: versionIntersectsRange(dateFrom, dateTo, "PC3") } },
        select: { tariffCode: true },
        distinct: ["tariffCode"],
        orderBy: { tariffCode: "asc" }
      }),
      this.prisma.regulatedTollsChargesPrice.findMany({
        where: { version: { is: versionIntersectsRange(dateFrom, dateTo, "TOLLS_CHARGES") } },
        select: { tariffCode: true },
        distinct: ["tariffCode"],
        orderBy: { tariffCode: "asc" }
      }),
      this.prisma.cmInvoice.groupBy({
        by: ["tariffCode"],
        where: { tariffCode: { not: null } },
        orderBy: { tariffCode: "asc" }
      })
    ]);
    return uniqueStrings([
      ...pc3Rows.map((row) => normalizeTariffCode(row.tariffCode)).filter((item): item is string => Boolean(item)),
      ...tollsRows.map((row) => normalizeTariffCode(row.tariffCode)).filter((item): item is string => Boolean(item)),
      ...invoiceRows.map((row) => normalizeTariffCode(row.tariffCode)).filter((item): item is string => Boolean(item))
    ]).sort(compareTariffCodes);
  }

  private async loadIndexedInitialProfiles(calendar: Array<{ timestampInicio: string }>) {
    if (calendar.length === 0) return new Map<string, number>();
    const start = new Date(calendar[0].timestampInicio);
    const end = new Date(new Date(calendar[calendar.length - 1].timestampInicio).getTime() + 60 * 60 * 1000);
    const rows = await this.prisma.esiosProfileIntermediateResult.findMany({
      where: {
        datetime: { gte: start, lt: end },
        tariff: { in: [...INDEXED_INITIAL_PROFILE_WEIGHTED_TARIFFS] }
      },
      select: { year: true, month: true, day: true, hour: true, tariff: true, initialProfile: true }
    });
    const map = new Map<string, number>();
    for (const row of rows) {
      const value = decimalToNumber(row.initialProfile);
      if (value !== null) map.set(indexedInitialProfileKey(row.tariff, localDateFromParts(row.year, row.month, row.day), row.hour), value);
    }
    return map;
  }

  private async loadIndexedLosses(calendar: PricingCalendarHour[], tariffCode: string) {
    if (!this.regulatedLosses || calendar.length === 0) return new Map<string, RegulatedLossHourlyValue>();
    return this.regulatedLosses.loadHourlyLosses(calendar, tariffCode);
  }

  private buildIndexedQuarterComponents(
    key: TimeKey,
    tariffCode: string,
    tariffPeriod: string,
    omie: Map<string, SourcePrice>,
    hourly: ReturnType<typeof groupLiquidations>,
    qh: ReturnType<typeof groupLiquidations>,
    regulatedContext: RegulatedPriceContext | null,
    loss: RegulatedLossHourlyValue | null,
    componentCodes: readonly CostComponent[] = ENERGY_REPORT_COMPONENTS
  ) {
    const pfKwh = 250;
    const lossPercentage = loss?.value ?? null;
    const bcKwh = lossPercentage === null || lossPercentage >= 100 ? null : pfKwh / (1 - lossPercentage / 100);
    const requested = new Set<CostComponent>(componentCodes);
    const results: CostComponentResult[] = [];
    if (requested.has("OMIE_MD") || requested.has("IMU")) results.push(calculateCostComponent("OMIE_MD", "BC", bcKwh, omie.get(key.quarterKey) ?? null));
    if (requested.has("CAD")) results.push(calculateCostComponent("CAD", "BC", bcKwh, hourly.CAD.get(key.hourlyKey) ?? null));
    if (requested.has("BS3")) results.push(calculateCostComponent("BS3", "BC", bcKwh, qh.BS3.get(key.quarterKey) ?? null));
    if (requested.has("RAD3")) results.push(calculateCostComponent("RAD3", "BC", bcKwh, qh.RAD3.get(key.quarterKey) ?? null));
    if (regulatedContext) {
      const regulated = this.buildRegulatedComponents(key, tariffPeriod, tariffCode, bcKwh, pfKwh, regulatedContext);
      results.push(...regulated.filter((item) => requested.has(item.componentCode)));
    }
    if (requested.has("IMU")) {
      results.push(regulatedContext ? this.buildImuComponent(key, results, regulatedContext) : unresolved("IMU", "IMU_VERSION_NOT_FOUND", "ECONOMIC_AMOUNT", null, null));
    }
    return results.filter((item) => requested.has(item.componentCode) && costComponentNature(item.componentCode) === "ENERGY");
  }

  private async buildCostRun(curve: CurveIntervalForCosts[], invoiceTariffCode?: string | null, periodStart?: Date | null, periodEnd?: Date | null, lines: InvoiceLineForCosts[] = [], sharedContext?: BillingCostRunSharedContext | null, economicSign = 1) {
    const timeKeys = buildMadridQuarterKeys(curve.map((row) => row.datetime));
    const dateRange = buildDateRange([...timeKeys.values()].map((item) => item.fecha));
    const tariffCode = normalizeTariffCode(invoiceTariffCode);
    const context = sharedContext ?? await this.buildSharedCostContext(dateRange.start, dateRange.end);
    const { omie, hourly, qh, regulatedContext } = context;

    const intervalCosts = [];
    const allComponents: CostComponentResult[] = [];
    for (const interval of curve) {
      const key = timeKeys.get(interval.datetime.toISOString());
      if (!key) continue;
      const bcKwh = decimalToNumber(interval.consumptionBcKwh);
      const pfKwh = decimalToNumber(interval.consumptionPfKwh);
      const results: CostComponentResult[] = [
        calculateCostComponent("OMIE_MD", "BC", bcKwh, omie.get(key.quarterKey) ?? null),
        calculateCostComponent("CAD", "BC", bcKwh, hourly.CAD.get(key.hourlyKey) ?? null),
        calculateCostComponent("BS3", "BC", bcKwh, qh.BS3.get(key.quarterKey) ?? null),
        calculateCostComponent("RAD3", "BC", bcKwh, qh.RAD3.get(key.quarterKey) ?? null),
        ...(regulatedContext
          ? this.buildRegulatedComponents(key, interval.tariffPeriod, tariffCode, bcKwh, pfKwh, regulatedContext)
          : await this.buildRegulatedComponentsLegacy(key, interval.tariffPeriod, tariffCode, bcKwh, pfKwh))
      ];
      results.push(regulatedContext ? this.buildImuComponent(key, results, regulatedContext) : await this.buildImuComponentLegacy(key, results));
      const incidentCodes = results.map((item) => item.incidentCode).filter((item): item is string => Boolean(item));
      const reportableIncidentCodes = incidentCodes.filter((code) => !isExpectedMissingSettlementIncident(code));
      const omieCost = results.find((item) => item.componentCode === "OMIE_MD")?.costEur ?? 0;
      const liquidationsCost = results.filter((item) => LIQUIDATION_COMPONENTS.includes(item.componentCode as LiquidationComponent)).reduce((sum, item) => sum + (item.costEur ?? 0), 0);
      const configuredCost = results.filter((item) => CONFIGURED_COMPONENTS.includes(item.componentCode as (typeof CONFIGURED_COMPONENTS)[number])).reduce((sum, item) => sum + (item.costEur ?? 0), 0);
      const tollsChargesCost = results.filter((item) => TOLLS_CHARGES_COMPONENTS.includes(item.componentCode as (typeof TOLLS_CHARGES_COMPONENTS)[number])).reduce((sum, item) => sum + (item.costEur ?? 0), 0);
      const derivedCost = results.filter((item) => DERIVED_COMPONENTS.includes(item.componentCode as (typeof DERIVED_COMPONENTS)[number])).reduce((sum, item) => sum + (item.costEur ?? 0), 0);
      const regulatedCost = configuredCost + tollsChargesCost + derivedCost;
      const totalCost = omieCost + liquidationsCost + regulatedCost;
      const status = reportableIncidentCodes.length > 0 ? "WARNING" : "OK";
      intervalCosts.push({
        id: randomUUID(),
        invoiceId: interval.invoiceId,
        curveIntervalId: interval.id,
        datetime: interval.datetime,
        tariffPeriod: interval.tariffPeriod,
        bcKwh,
        pfKwh,
        liquidationsCostEur: liquidationsCost,
        regulatedCostEur: regulatedCost,
        configuredCostEur: configuredCost,
        tollsChargesCostEur: tollsChargesCost,
        derivedCostEur: derivedCost,
        totalCostEur: totalCost,
        status,
        incidentCodes,
        components: results
      });
      allComponents.push(...results);
    }
    const powerCosts = regulatedContext
      ? this.buildPowerCostComponents(invoiceTariffCode, periodStart, periodEnd, lines, regulatedContext)
      : await this.buildPowerCostComponentsLegacy(invoiceTariffCode, periodStart, periodEnd, lines);
    applyEconomicSignToCostResults(intervalCosts, powerCosts, economicSign);
    const totalOmie = sumComponents(allComponents, "OMIE_MD");
    const totalLiquidations = LIQUIDATION_COMPONENTS.reduce((sum, component) => sum + sumComponents(allComponents, component), 0);
    const totalConfigured = CONFIGURED_COMPONENTS.reduce((sum, component) => sum + sumComponents(allComponents, component), 0);
    const totalTollsChargesEnergy = sumComponents(allComponents, "TOLLS_CHARGES_ENERGY");
    const totalTollsChargesPower = powerCosts.reduce((sum, item) => sum + (item.costEur ?? 0), 0);
    const totalTollsCharges = totalTollsChargesEnergy + totalTollsChargesPower;
    const totalDerived = DERIVED_COMPONENTS.reduce((sum, component) => sum + sumComponents(allComponents, component), 0);
    const totalRegulated = totalConfigured + totalTollsCharges + totalDerived;
    const incidentsCount = allComponents.filter((item) => item.incidentCode && !isExpectedMissingSettlementIncident(item.incidentCode)).length
      + powerCosts.filter((item) => item.incidentCode).length;
    return {
      intervalCosts,
      powerCosts,
      summary: summarizeComponents(allComponents, powerCosts),
      totals: {
        totalOmieEur: totalOmie,
        totalLiquidationsEur: totalLiquidations,
        totalRegulatedEur: totalRegulated,
        totalConfiguredEur: totalConfigured,
        totalTollsChargesEur: totalTollsCharges,
        totalTollsChargesPowerEur: totalTollsChargesPower,
        totalDerivedEur: totalDerived,
        totalCostEur: totalOmie + totalLiquidations + totalRegulated
      },
      counts: {
        intervals: intervalCosts.length,
        ok: intervalCosts.filter((item) => item.status === "OK").length,
        warning: intervalCosts.filter((item) => item.status === "WARNING").length,
        error: intervalCosts.filter((item) => item.status === "ERROR").length,
        incidents: incidentsCount
      }
    };
  }

  private buildPowerCostComponents(invoiceTariffCode?: string | null, periodStart?: Date | null, periodEnd?: Date | null, lines: InvoiceLineForCosts[] = [], regulatedContext?: RegulatedPriceContext): PowerCostComponentResult[] {
    const tariffCode = normalizeTariffCode(invoiceTariffCode);
    const start = dateOnly(periodStart);
    const end = dateOnly(periodEnd);
    if (!start || !end) return [];
    if (!tariffCode) return [powerUnresolved("TARIFF_CODE_NOT_RESOLVED", null, null, null, start, end)];
    const powers = normalizeContractedPowerByPeriod(lines);
    if (powers.error) return [powerUnresolved(powers.error, tariffCode, null, null, start, end)];
    if (powers.values.size === 0) return [powerUnresolved("CONTRACTED_POWER_NOT_FOUND", tariffCode, null, null, start, end)];

    const results: PowerCostComponentResult[] = [];
    for (const [tariffPeriod, contractedPowerKw] of [...powers.values.entries()].sort()) {
      if (contractedPowerKw === null || !Number.isFinite(contractedPowerKw)) {
        results.push(powerUnresolved("INVALID_CONTRACTED_POWER", tariffCode, tariffPeriod, contractedPowerKw, start, end));
        continue;
      }
      results.push(...this.buildPowerCostPeriodSegments(tariffCode, tariffPeriod, contractedPowerKw, start, end, regulatedContext));
    }
    return results;
  }

  private async buildPowerCostComponentsLegacy(invoiceTariffCode?: string | null, periodStart?: Date | null, periodEnd?: Date | null, lines: InvoiceLineForCosts[] = []): Promise<PowerCostComponentResult[]> {
    const tariffCode = normalizeTariffCode(invoiceTariffCode);
    const start = dateOnly(periodStart);
    const end = dateOnly(periodEnd);
    if (!start || !end) return [];
    if (!tariffCode) return [powerUnresolved("TARIFF_CODE_NOT_RESOLVED", null, null, null, start, end)];
    const powers = normalizeContractedPowerByPeriod(lines);
    if (powers.error) return [powerUnresolved(powers.error, tariffCode, null, null, start, end)];
    if (powers.values.size === 0) return [powerUnresolved("CONTRACTED_POWER_NOT_FOUND", tariffCode, null, null, start, end)];
    const results: PowerCostComponentResult[] = [];
    for (const [tariffPeriod, contractedPowerKw] of [...powers.values.entries()].sort()) {
      if (contractedPowerKw === null || !Number.isFinite(contractedPowerKw)) {
        results.push(powerUnresolved("INVALID_CONTRACTED_POWER", tariffCode, tariffPeriod, contractedPowerKw, start, end));
        continue;
      }
      results.push(...await this.buildPowerCostPeriodSegmentsLegacy(tariffCode, tariffPeriod, contractedPowerKw, start, end));
    }
    return results;
  }

  private buildPowerCostPeriodSegments(tariffCode: string, tariffPeriod: string, contractedPowerKw: number, start: string, end: string, regulatedContext?: RegulatedPriceContext) {
    const rows: PowerCostComponentResult[] = [];
    let current: PowerCostComponentResult | null = null;
    for (const date of enumerateDatesInclusive(start, end)) {
      const source = this.resolveTollsChargesPowerSource(date, tariffCode, tariffPeriod, regulatedContext);
      const yearDays = daysInYear(date);
      const status: ComponentStatus = source.sourceErrorCode || source.annualPriceEurKwYear === null ? "WARNING" : "OK";
      const incidentCode = source.sourceErrorCode ?? (source.annualPriceEurKwYear === null ? "TOLLS_CHARGES_POWER_PRICE_NOT_CONFIGURED" : null);
      const segmentKey = [
        status,
        incidentCode ?? "",
        yearDays,
        source.annualPriceEurKwYear ?? "",
        source.regulatedPriceVersionId ?? "",
        source.sourceRowId ?? ""
      ].join("|");
      const currentKey = current
        ? [current.status, current.incidentCode ?? "", current.yearDays ?? "", current.annualPriceEurKwYear ?? "", current.regulatedPriceVersionId ?? "", current.sourceRowId ?? ""].join("|")
        : null;
      const costEur = status === "OK" && source.annualPriceEurKwYear !== null ? contractedPowerKw * source.annualPriceEurKwYear / yearDays : null;
      if (!current || currentKey !== segmentKey || nextDate(current.endDate) !== date) {
        current = {
          componentCode: "TOLLS_CHARGES_POWER",
          calculationBasis: "CONTRACTED_POWER",
          tariffCode,
          tariffPeriod,
          contractedPowerKw,
          startDate: date,
          endDate: date,
          billedDays: 1,
          yearDays,
          annualPriceEurKwYear: source.annualPriceEurKwYear,
          costEur,
          sourceTable: source.sourceTable,
          sourceRowId: source.sourceRowId,
          regulatedPriceVersionId: source.regulatedPriceVersionId,
          regulatedPriceVersionName: source.regulatedPriceVersionName,
          sourceValidFrom: source.sourceValidFrom,
          sourceValidTo: source.sourceValidTo,
          status,
          incidentCode
        };
        rows.push(current);
      } else {
        current.endDate = date;
        current.billedDays += 1;
        current.costEur = current.costEur === null || costEur === null ? null : current.costEur + costEur;
      }
    }
    return rows;
  }

  private async buildPowerCostPeriodSegmentsLegacy(tariffCode: string, tariffPeriod: string, contractedPowerKw: number, start: string, end: string) {
    const rows: PowerCostComponentResult[] = [];
    let current: PowerCostComponentResult | null = null;
    for (const date of enumerateDatesInclusive(start, end)) {
      const source = await this.resolveTollsChargesPowerSourceLegacy(date, tariffCode, tariffPeriod);
      const yearDays = daysInYear(date);
      const status: ComponentStatus = source.sourceErrorCode || source.annualPriceEurKwYear === null ? "WARNING" : "OK";
      const incidentCode = source.sourceErrorCode ?? (source.annualPriceEurKwYear === null ? "TOLLS_CHARGES_POWER_PRICE_NOT_CONFIGURED" : null);
      const dailyCost = status === "OK" ? contractedPowerKw * (source.annualPriceEurKwYear ?? 0) / yearDays : null;
      const canMerge = current
        && current.status === status
        && current.incidentCode === incidentCode
        && current.yearDays === yearDays
        && current.annualPriceEurKwYear === source.annualPriceEurKwYear
        && current.regulatedPriceVersionId === source.regulatedPriceVersionId
        && current.sourceRowId === source.sourceRowId;
      if (canMerge && current) {
        current.endDate = date;
        current.billedDays += 1;
        current.costEur = current.costEur === null || dailyCost === null ? null : current.costEur + dailyCost;
      } else {
        current = {
          componentCode: "TOLLS_CHARGES_POWER",
          calculationBasis: "CONTRACTED_POWER",
          tariffCode,
          tariffPeriod,
          contractedPowerKw,
          startDate: date,
          endDate: date,
          billedDays: 1,
          yearDays,
          annualPriceEurKwYear: source.annualPriceEurKwYear,
          costEur: dailyCost,
          sourceTable: source.sourceTable,
          sourceRowId: source.sourceRowId,
          regulatedPriceVersionId: source.regulatedPriceVersionId,
          regulatedPriceVersionName: source.regulatedPriceVersionName,
          sourceValidFrom: source.sourceValidFrom,
          sourceValidTo: source.sourceValidTo,
          status,
          incidentCode
        };
        rows.push(current);
      }
    }
    return rows;
  }

  private resolveTollsChargesPowerSource(date: string, tariffCode: string, tariffPeriod: string, regulatedContext?: RegulatedPriceContext): PowerPriceSource {
    if (!regulatedContext && !this.regulatedPrices) {
      return {
        annualPriceEurKwYear: null,
        sourceTable: "regulated_tolls_charges_prices",
        sourceRowId: null,
        regulatedPriceVersionId: null,
        regulatedPriceVersionName: null,
        sourceValidFrom: null,
        sourceValidTo: null,
        sourceTariffCode: tariffCode,
        sourceTariffPeriod: tariffPeriod,
        sourceErrorCode: "TOLLS_CHARGES_POWER_VERSION_NOT_FOUND"
      };
    }
    try {
      const row = regulatedContext
        ? resolveTollsChargesPowerPriceFromContext(regulatedContext, date, tariffCode, tariffPeriod)
        : null;
      if (!row) throw new Error("TOLLS_CHARGES_POWER_VERSION_NOT_FOUND");
      return {
        annualPriceEurKwYear: row.priceEurKwYear,
        sourceTable: row.sourceTable,
        sourceRowId: row.sourceRowId,
        regulatedPriceVersionId: row.versionId,
        regulatedPriceVersionName: row.versionName,
        sourceValidFrom: row.validFrom,
        sourceValidTo: row.validTo,
        sourceTariffCode: row.tariffCode,
        sourceTariffPeriod: row.tariffPeriod
      };
    } catch (error) {
      return {
        annualPriceEurKwYear: null,
        sourceTable: "regulated_tolls_charges_prices",
        sourceRowId: null,
        regulatedPriceVersionId: null,
        regulatedPriceVersionName: null,
        sourceValidFrom: null,
        sourceValidTo: null,
        sourceTariffCode: tariffCode,
        sourceTariffPeriod: tariffPeriod,
        sourceErrorCode: regulatedIncidentCode("TOLLS_CHARGES_POWER", error)
      };
    }
  }

  private async resolveTollsChargesPowerSourceLegacy(date: string, tariffCode: string, tariffPeriod: string): Promise<PowerPriceSource> {
    if (!this.regulatedPrices) {
      return {
        annualPriceEurKwYear: null,
        sourceTable: "regulated_tolls_charges_prices",
        sourceRowId: null,
        regulatedPriceVersionId: null,
        regulatedPriceVersionName: null,
        sourceValidFrom: null,
        sourceValidTo: null,
        sourceTariffCode: tariffCode,
        sourceTariffPeriod: tariffPeriod,
        sourceErrorCode: "TOLLS_CHARGES_POWER_VERSION_NOT_FOUND"
      };
    }
    try {
      const row = await this.regulatedPrices.resolveTollsChargesPowerPrice(date, tariffCode, tariffPeriod);
      return {
        annualPriceEurKwYear: row.priceEurKwYear,
        sourceTable: row.sourceTable,
        sourceRowId: row.sourceRowId,
        regulatedPriceVersionId: row.versionId,
        regulatedPriceVersionName: row.versionName,
        sourceValidFrom: row.validFrom,
        sourceValidTo: row.validTo,
        sourceTariffCode: row.tariffCode,
        sourceTariffPeriod: row.tariffPeriod
      };
    } catch (error) {
      const code = regulatedIncidentCode("TOLLS_CHARGES_POWER", error);
      return {
        annualPriceEurKwYear: null,
        sourceTable: "regulated_tolls_charges_prices",
        sourceRowId: null,
        regulatedPriceVersionId: null,
        regulatedPriceVersionName: null,
        sourceValidFrom: null,
        sourceValidTo: null,
        sourceTariffCode: tariffCode,
        sourceTariffPeriod: tariffPeriod,
        sourceErrorCode: code
      };
    }
  }

  private buildRegulatedComponents(key: TimeKey, tariffPeriod: string, tariffCode: string | null, bcKwh: number | null, pfKwh: number | null, regulatedContext: RegulatedPriceContext) {
    if (!regulatedContext) {
      return [
        unresolved("RETH", "RETH_VERSION_NOT_FOUND", "BC", bcKwh, null),
        unresolved("PC3_CONFIG", "PC3_VERSION_NOT_FOUND", "BC", bcKwh, null),
        unresolved("EFIH", "EFIH_VERSION_NOT_FOUND", "PF", pfKwh, null),
        unresolved("TOLLS_CHARGES_ENERGY", "TOLLS_CHARGES_VERSION_NOT_FOUND", "PF", pfKwh, null),
        unresolved("BONO_SOCIAL", "BONO_SOCIAL_VERSION_NOT_FOUND", "PF", pfKwh, null),
        unresolved("OTROS", "OTROS_VERSION_NOT_FOUND", "BC", bcKwh, null)
      ];
    }
    const results: CostComponentResult[] = [];
    results.push(calculateCostComponent("RETH", "BC", bcKwh, this.resolveRegulatedSource("RETH", () => resolveSimpleRegulatedPrice(regulatedContext, "RETH", key.fecha))));
    results.push(calculateCostComponent("EFIH", "PF", pfKwh, this.resolveRegulatedSource("EFIH", () => resolveSimpleRegulatedPrice(regulatedContext, "EFIH", key.fecha))));
    results.push(calculateCostComponent("BONO_SOCIAL", "PF", pfKwh, this.resolveRegulatedSource("BONO_SOCIAL", () => resolveSimpleRegulatedPrice(regulatedContext, "BONO_SOCIAL", key.fecha))));
    results.push(calculateCostComponent("OTROS", "BC", bcKwh, this.resolveRegulatedSource("OTROS", () => resolveSimpleRegulatedPrice(regulatedContext, "OTROS", key.fecha))));
    if (!tariffCode) {
      results.push(unresolved("PC3_CONFIG", "TARIFF_CODE_NOT_RESOLVED", "BC", bcKwh, null));
      results.push(unresolved("TOLLS_CHARGES_ENERGY", "TARIFF_CODE_NOT_RESOLVED", "PF", pfKwh, null));
    } else if (!isTariffPeriod(tariffPeriod)) {
      results.push(unresolved("PC3_CONFIG", "TARIFF_PERIOD_NOT_RESOLVED", "BC", bcKwh, null));
      results.push(unresolved("TOLLS_CHARGES_ENERGY", "TARIFF_PERIOD_NOT_RESOLVED", "PF", pfKwh, null));
    } else {
      results.push(calculateCostComponent("PC3_CONFIG", "BC", bcKwh, this.resolveRegulatedSource("PC3_CONFIG", () => resolvePc3PriceFromContext(regulatedContext, key.fecha, tariffCode, tariffPeriod))));
      results.push(calculateCostComponent("TOLLS_CHARGES_ENERGY", "PF", pfKwh, this.resolveRegulatedSource("TOLLS_CHARGES_ENERGY", () => resolveTollsChargesEnergyPriceFromContext(regulatedContext, key.fecha, tariffCode, tariffPeriod))));
    }
    return results;
  }

  private async buildRegulatedComponentsLegacy(key: TimeKey, tariffPeriod: string, tariffCode: string | null, bcKwh: number | null, pfKwh: number | null) {
    if (!this.regulatedPrices) {
      return [
        unresolved("RETH", "RETH_VERSION_NOT_FOUND", "BC", bcKwh, null),
        unresolved("PC3_CONFIG", "PC3_VERSION_NOT_FOUND", "BC", bcKwh, null),
        unresolved("EFIH", "EFIH_VERSION_NOT_FOUND", "PF", pfKwh, null),
        unresolved("TOLLS_CHARGES_ENERGY", "TOLLS_CHARGES_VERSION_NOT_FOUND", "PF", pfKwh, null),
        unresolved("BONO_SOCIAL", "BONO_SOCIAL_VERSION_NOT_FOUND", "PF", pfKwh, null),
        unresolved("OTROS", "OTROS_VERSION_NOT_FOUND", "BC", bcKwh, null)
      ];
    }
    const results: CostComponentResult[] = [];
    results.push(calculateCostComponent("RETH", "BC", bcKwh, await this.resolveRegulatedSourceLegacy("RETH", () => this.regulatedPrices!.resolveRethPrice(key.fecha))));
    results.push(calculateCostComponent("EFIH", "PF", pfKwh, await this.resolveRegulatedSourceLegacy("EFIH", () => this.regulatedPrices!.resolveEfihPrice(key.fecha))));
    results.push(calculateCostComponent("BONO_SOCIAL", "PF", pfKwh, await this.resolveRegulatedSourceLegacy("BONO_SOCIAL", () => this.regulatedPrices!.resolveSocialBonusPrice(key.fecha))));
    results.push(calculateCostComponent("OTROS", "BC", bcKwh, await this.resolveRegulatedSourceLegacy("OTROS", () => this.regulatedPrices!.resolveOtherPrice(key.fecha))));
    if (!tariffCode) {
      results.push(unresolved("PC3_CONFIG", "TARIFF_CODE_NOT_RESOLVED", "BC", bcKwh, null));
      results.push(unresolved("TOLLS_CHARGES_ENERGY", "TARIFF_CODE_NOT_RESOLVED", "PF", pfKwh, null));
    } else if (!isTariffPeriod(tariffPeriod)) {
      results.push(unresolved("PC3_CONFIG", "TARIFF_PERIOD_NOT_RESOLVED", "BC", bcKwh, null));
      results.push(unresolved("TOLLS_CHARGES_ENERGY", "TARIFF_PERIOD_NOT_RESOLVED", "PF", pfKwh, null));
    } else {
      results.push(calculateCostComponent("PC3_CONFIG", "BC", bcKwh, await this.resolveRegulatedSourceLegacy("PC3_CONFIG", () => this.regulatedPrices!.resolvePc3Price(key.fecha, tariffCode, tariffPeriod))));
      results.push(calculateCostComponent("TOLLS_CHARGES_ENERGY", "PF", pfKwh, await this.resolveRegulatedSourceLegacy("TOLLS_CHARGES_ENERGY", () => this.regulatedPrices!.resolveTollsChargesEnergyPrice(key.fecha, tariffCode, tariffPeriod))));
    }
    return results;
  }

  private buildImuComponent(key: TimeKey, components: CostComponentResult[], regulatedContext: RegulatedPriceContext) {
    const source = this.resolveImuSource(key.fecha, regulatedContext);
    if (source.sourceErrorCode) {
      return unresolved("IMU", source.sourceErrorCode, "ECONOMIC_AMOUNT", null, source);
    }
    const baseRows = IMU_BASE_COMPONENTS.map((componentCode) => components.find((item) => item.componentCode === componentCode));
    const baseAmountEur = baseRows.reduce((sum, item) => sum + (item?.status === "OK" && item.costEur !== null ? item.costEur : 0), 0);
    if (source.percentage === null || source.percentage === undefined || !Number.isFinite(source.percentage)) {
      return unresolved("IMU", "IMU_RATE_NOT_CONFIGURED", "ECONOMIC_AMOUNT", null, source);
    }
    const percentage = source.percentage;
    return {
      componentCode: "IMU",
      energyBasis: "ECONOMIC_AMOUNT",
      energyKwh: null,
      energyMwh: null,
      priceEurMwh: null,
      baseAmountEur,
      percentage,
      costEur: baseAmountEur * (percentage / 100),
      sourceTable: source.sourceTable,
      sourceRowId: source.sourceRowId,
      sourceVersion: null,
      regulatedPriceVersionId: source.regulatedPriceVersionId ?? null,
      regulatedPriceVersionName: source.regulatedPriceVersionName ?? null,
      sourceValidFrom: source.sourceValidFrom ?? null,
      sourceValidTo: source.sourceValidTo ?? null,
      sourceTariffCode: null,
      sourceTariffPeriod: null,
      sourceResolutionMinutes: null,
      status: "OK",
      incidentCode: null
    } satisfies CostComponentResult;
  }

  private async buildImuComponentLegacy(key: TimeKey, components: CostComponentResult[]) {
    const source = await this.resolveImuSourceLegacy(key.fecha);
    if (source.sourceErrorCode) {
      return unresolved("IMU", source.sourceErrorCode, "ECONOMIC_AMOUNT", null, source);
    }
    const baseAmountEur = IMU_BASE_COMPONENTS.reduce((sum, componentCode) => {
      const component = components.find((item) => item.componentCode === componentCode);
      return sum + (component?.status === "OK" && component.costEur !== null ? component.costEur : 0);
    }, 0);
    const percentage = source.percentage ?? null;
    if (percentage === null) return unresolved("IMU", "IMU_RATE_NOT_CONFIGURED", "ECONOMIC_AMOUNT", null, source);
    return {
      componentCode: "IMU",
      energyBasis: "ECONOMIC_AMOUNT",
      energyKwh: null,
      energyMwh: null,
      priceEurMwh: null,
      baseAmountEur,
      percentage,
      costEur: baseAmountEur * (percentage / 100),
      sourceTable: source.sourceTable,
      sourceRowId: source.sourceRowId,
      sourceVersion: null,
      regulatedPriceVersionId: source.regulatedPriceVersionId ?? null,
      regulatedPriceVersionName: source.regulatedPriceVersionName ?? null,
      sourceValidFrom: source.sourceValidFrom ?? null,
      sourceValidTo: source.sourceValidTo ?? null,
      sourceTariffCode: null,
      sourceTariffPeriod: null,
      sourceResolutionMinutes: null,
      status: "OK",
      incidentCode: null
    } satisfies CostComponentResult;
  }

  private resolveRegulatedSource(componentCode: CostComponent, resolver: () => any): SourcePrice | null {
    try {
      const row = resolver();
      return {
        priceEurMwh: row.priceEurMwh,
        sourceTable: row.sourceTable,
        sourceRowId: row.sourceRowId,
        sourceVersion: null,
        sourceResolutionMinutes: 15,
        regulatedPriceVersionId: row.versionId,
        regulatedPriceVersionName: row.versionName,
        sourceValidFrom: row.validFrom,
        sourceValidTo: row.validTo,
        sourceTariffCode: row.tariffCode ?? null,
        sourceTariffPeriod: row.tariffPeriod ?? null
      };
    } catch (error) {
      return {
        priceEurMwh: null,
        sourceTable: nullSourceTable(componentCode),
        sourceRowId: null,
        sourceVersion: null,
        sourceResolutionMinutes: 15,
        regulatedPriceVersionId: null,
        regulatedPriceVersionName: null,
        sourceValidFrom: null,
        sourceValidTo: null,
        sourceTariffCode: null,
        sourceTariffPeriod: null,
        sourceErrorCode: regulatedIncidentCode(componentCode, error)
      };
    }
  }

  private async resolveRegulatedSourceLegacy(componentCode: CostComponent, resolver: () => Promise<any>): Promise<SourcePrice | null> {
    try {
      const row = await resolver();
      return {
        priceEurMwh: row.priceEurMwh,
        sourceTable: row.sourceTable,
        sourceRowId: row.sourceRowId,
        sourceVersion: null,
        sourceResolutionMinutes: 15,
        regulatedPriceVersionId: row.versionId,
        regulatedPriceVersionName: row.versionName,
        sourceValidFrom: row.validFrom,
        sourceValidTo: row.validTo,
        sourceTariffCode: row.tariffCode ?? null,
        sourceTariffPeriod: row.tariffPeriod ?? null
      };
    } catch (error) {
      return {
        priceEurMwh: null,
        sourceTable: nullSourceTable(componentCode),
        sourceRowId: null,
        sourceVersion: null,
        sourceResolutionMinutes: 15,
        sourceErrorCode: regulatedIncidentCode(componentCode, error)
      };
    }
  }

  private resolveImuSource(date: string, regulatedContext?: RegulatedPriceContext): SourcePrice {
    if (!regulatedContext && !this.regulatedPrices) {
      return {
        priceEurMwh: null,
        percentage: null,
        sourceTable: "regulated_imu_rates",
        sourceRowId: null,
        sourceVersion: null,
        sourceResolutionMinutes: 15,
        regulatedPriceVersionId: null,
        regulatedPriceVersionName: null,
        sourceValidFrom: null,
        sourceValidTo: null,
        sourceErrorCode: "IMU_VERSION_NOT_FOUND"
      };
    }
    try {
      const row = regulatedContext ? resolveImuRateFromContext(regulatedContext, date) : null;
      if (!row) throw new Error("IMU_VERSION_NOT_FOUND");
      return {
        priceEurMwh: null,
        percentage: row.percentage,
        sourceTable: row.sourceTable,
        sourceRowId: row.sourceRowId,
        sourceVersion: null,
        sourceResolutionMinutes: 15,
        regulatedPriceVersionId: row.versionId,
        regulatedPriceVersionName: row.versionName,
        sourceValidFrom: row.validFrom,
        sourceValidTo: row.validTo
      };
    } catch (error) {
      return {
        priceEurMwh: null,
        percentage: null,
        sourceTable: "regulated_imu_rates",
        sourceRowId: null,
        sourceVersion: null,
        sourceResolutionMinutes: 15,
        regulatedPriceVersionId: null,
        regulatedPriceVersionName: null,
        sourceValidFrom: null,
        sourceValidTo: null,
        sourceErrorCode: regulatedIncidentCode("IMU", error)
      };
    }
  }

  private async resolveImuSourceLegacy(date: string): Promise<SourcePrice> {
    if (!this.regulatedPrices) {
      return {
        priceEurMwh: null,
        percentage: null,
        sourceTable: "regulated_imu_rates",
        sourceRowId: null,
        sourceVersion: null,
        sourceResolutionMinutes: 15,
        sourceErrorCode: "IMU_VERSION_NOT_FOUND"
      };
    }
    try {
      const row = await this.regulatedPrices.resolveImuRate(date);
      return {
        priceEurMwh: null,
        percentage: row.percentage,
        sourceTable: row.sourceTable,
        sourceRowId: row.sourceRowId,
        sourceVersion: null,
        sourceResolutionMinutes: 15,
        regulatedPriceVersionId: row.versionId,
        regulatedPriceVersionName: row.versionName,
        sourceValidFrom: row.validFrom,
        sourceValidTo: row.validTo
      };
    } catch (error) {
      return {
        priceEurMwh: null,
        percentage: null,
        sourceTable: "regulated_imu_rates",
        sourceRowId: null,
        sourceVersion: null,
        sourceResolutionMinutes: 15,
        sourceErrorCode: regulatedIncidentCode("IMU", error)
      };
    }
  }

  private async loadRegulatedPriceContext(fechaInicio: string, fechaFin: string) {
    if (!this.prisma.regulatedPriceVersion?.findMany) return null;
    const rows = await this.prisma.regulatedPriceVersion.findMany({
      where: {
        code: { in: ["RETH", "EFIH", "PC3", "TOLLS_CHARGES", "BONO_SOCIAL", "OTROS", "IMU"] },
        validFrom: { lte: new Date(`${fechaFin}T00:00:00.000Z`) },
        OR: [{ validTo: null }, { validTo: { gte: new Date(`${fechaInicio}T00:00:00.000Z`) } }]
      },
      include: regulatedPriceContextInclude(),
      orderBy: [{ code: "asc" }, { validFrom: "asc" }]
    });
    const byCode = new Map<RegulatedPriceCode, RegulatedVersionRow[]>();
    for (const row of rows as RegulatedVersionRow[]) {
      const list = byCode.get(row.code) ?? [];
      list.push(row);
      byCode.set(row.code, list);
    }
    return { byCode };
  }

  private async persistCostRun(runId: string, invoiceId: string, result: Awaited<ReturnType<BillingDashboardCostsService["buildCostRun"]>>, persistenceMode: BillingCostPersistenceMode = "DETAIL") {
    await this.prisma.$transaction(async (tx) => {
      if (persistenceMode === "DETAIL" && result.intervalCosts.length > 0) {
        await tx.cmInvoiceIntervalCost.createMany({
          data: result.intervalCosts.map((item) => ({
            id: item.id,
            costRunId: runId,
            invoiceId,
            curveIntervalId: item.curveIntervalId,
            datetime: item.datetime,
            tariffPeriod: item.tariffPeriod,
            bcKwh: decimalOrNull(item.bcKwh),
            pfKwh: decimalOrNull(item.pfKwh),
            liquidationsCostEur: decimalOrNull(item.liquidationsCostEur),
            regulatedCostEur: decimalOrNull(item.regulatedCostEur),
            configuredCostEur: decimalOrNull(item.configuredCostEur),
            tollsChargesCostEur: decimalOrNull(item.tollsChargesCostEur),
            derivedCostEur: decimalOrNull(item.derivedCostEur),
            totalCostEur: decimalOrNull(item.totalCostEur),
            status: item.status as CmInvoiceIntervalCostStatus,
            incidentCodes: item.incidentCodes as Prisma.InputJsonValue
          }))
        });
        await tx.cmInvoiceIntervalCostComponent.createMany({
          data: result.intervalCosts.flatMap((interval) =>
            interval.components.map((component) => ({
              intervalCostId: interval.id,
              componentCode: component.componentCode as CmInvoiceCostComponentCode,
              energyBasis: component.energyBasis as CmInvoiceCostEnergyBasis,
              energyKwh: decimalOrNull(component.energyKwh),
              energyMwh: decimalOrNull(component.energyMwh),
              priceEurMwh: decimalOrNull(component.priceEurMwh),
              baseAmountEur: decimalOrNull(component.baseAmountEur),
              percentage: decimalOrNull(component.percentage),
              costEur: decimalOrNull(component.costEur),
              sourceTable: component.sourceTable,
              sourceRowId: component.sourceRowId,
              sourceVersion: component.sourceVersion as ReeSettlementVersion | null,
              regulatedPriceVersionId: component.regulatedPriceVersionId,
              regulatedPriceVersionName: component.regulatedPriceVersionName,
              sourceValidFrom: component.sourceValidFrom ? new Date(`${component.sourceValidFrom}T00:00:00.000Z`) : null,
              sourceValidTo: component.sourceValidTo ? new Date(`${component.sourceValidTo}T00:00:00.000Z`) : null,
              sourceTariffCode: component.sourceTariffCode,
              sourceTariffPeriod: component.sourceTariffPeriod,
              sourceResolutionMinutes: component.sourceResolutionMinutes,
              status: component.status as CmInvoiceIntervalCostStatus,
              incidentCode: component.incidentCode
            }))
          )
        });
      }
      if (result.powerCosts.length > 0) {
        await tx.cmInvoicePowerCostComponent.createMany({
          data: result.powerCosts.map((item) => ({
            costRunId: runId,
            invoiceId,
            componentCode: item.componentCode as CmInvoiceCostComponentCode,
            calculationBasis: item.calculationBasis as CmInvoiceCostEnergyBasis,
            tariffCode: item.tariffCode,
            tariffPeriod: item.tariffPeriod,
            contractedPowerKw: decimalOrNull(item.contractedPowerKw),
            startDate: new Date(`${item.startDate}T00:00:00.000Z`),
            endDate: new Date(`${item.endDate}T00:00:00.000Z`),
            billedDays: item.billedDays,
            yearDays: item.yearDays,
            annualPriceEurKwYear: decimalOrNull(item.annualPriceEurKwYear),
            costEur: decimalOrNull(item.costEur),
            sourceTable: item.sourceTable,
            sourceRowId: item.sourceRowId,
            regulatedPriceVersionId: item.regulatedPriceVersionId,
            regulatedPriceVersionName: item.regulatedPriceVersionName,
            sourceValidFrom: item.sourceValidFrom ? new Date(`${item.sourceValidFrom}T00:00:00.000Z`) : null,
            sourceValidTo: item.sourceValidTo ? new Date(`${item.sourceValidTo}T00:00:00.000Z`) : null,
            status: item.status as CmInvoiceIntervalCostStatus,
            incidentCode: item.incidentCode
          }))
        });
      }
      await tx.cmInvoiceCostRun.update({
        where: { id: runId },
        data: {
          status: result.counts.incidents > 0 ? CmInvoiceCostRunStatus.WARNING : CmInvoiceCostRunStatus.COMPLETED,
          completedAt: new Date(),
          totalOmieEur: decimalOrNull(result.totals.totalOmieEur),
          totalLiquidationsEur: decimalOrNull(result.totals.totalLiquidationsEur),
          totalRegulatedEur: decimalOrNull(result.totals.totalRegulatedEur),
          totalConfiguredEur: decimalOrNull(result.totals.totalConfiguredEur),
          totalTollsChargesEur: decimalOrNull(result.totals.totalTollsChargesEur),
          totalTollsChargesPowerEur: decimalOrNull(result.totals.totalTollsChargesPowerEur),
          totalDerivedEur: decimalOrNull(result.totals.totalDerivedEur),
          totalCostEur: decimalOrNull(result.totals.totalCostEur),
          intervalsCount: result.counts.intervals,
          okIntervalsCount: result.counts.ok,
          warningIntervalsCount: result.counts.warning,
          errorIntervalsCount: result.counts.error,
          incidentsCount: result.counts.incidents,
          summaryJson: result.summary as unknown as Prisma.InputJsonValue,
          message: result.counts.incidents > 0 ? "Costes calculados con incidencias explicitas." : null
        }
      });
    }, { maxWait: 10_000, timeout: 120_000 });
  }

  private async loadOmie(fechaInicio: string, fechaFin: string) {
    const rows = await this.prisma.omiePrice.findMany({
      where: {
        tipoPrecio: OmieTipoPrecio.MD,
        fechaPrograma: dateRange(fechaInicio, fechaFin)
      },
      select: { id: true, fechaPrograma: true, periodo: true, precioEurMWh: true, downloadId: true },
      orderBy: [{ fechaPrograma: "asc" }, { periodo: "asc" }]
    });
    const map = new Map<string, SourcePrice>();
    for (const row of rows) {
      const fecha = dateOnly(row.fechaPrograma);
      const price = decimalToNumber(row.precioEurMWh);
      if (!fecha || !Number.isSafeInteger(row.periodo) || price === null) continue;
      map.set(`${fecha}|${row.periodo}`, {
        priceEurMwh: price,
        sourceTable: "omie_prices",
        sourceRowId: row.id,
        sourceVersion: null,
        sourceResolutionMinutes: 15
      });
    }
    return map;
  }

  private async loadHourlyLiquidations(fechaInicio: string, fechaFin: string) {
    const rows = await this.prisma.reganecuRecord.findMany({
      where: {
        version: { in: PRISMA_PRICING_VERSIONS },
        OR: HOURLY_COMPONENTS.flatMap((component) => liquidationWhere(component)) as Prisma.ReganecuRecordWhereInput[],
        AND: [{ OR: [{ fecha: dateRange(fechaInicio, fechaFin) }, { fecha: null, fechaLiquidacion: dateRange(fechaInicio, fechaFin) }] }]
      },
      select: { id: true, fecha: true, fechaLiquidacion: true, hora: true, version: true, precioEurMwh: true, segmento: true, codigoPrecio: true, codigoApunte: true }
    });
    return groupLiquidations(rows, 60);
  }

  private async loadQhLiquidations(fechaInicio: string, fechaFin: string) {
    const rows = await this.prisma.reganecuQhRecord.findMany({
      where: {
        version: { in: PRISMA_PRICING_VERSIONS },
        OR: QH_COMPONENTS.flatMap((component) => liquidationWhere(component)) as Prisma.ReganecuQhRecordWhereInput[],
        AND: [{ OR: [{ fecha: dateRange(fechaInicio, fechaFin) }, { fecha: null, fechaLiquidacion: dateRange(fechaInicio, fechaFin) }] }]
      },
      select: { id: true, fecha: true, fechaLiquidacion: true, hora: true, version: true, precioEurMwh: true, segmento: true, codigoPrecio: true, codigoApunte: true }
    });
    return groupLiquidations(rows, 15);
  }

  private async findCostRun(invoiceId: string, runId?: string | null) {
    if (runId) {
      return this.prisma.cmInvoiceCostRun.findFirst({ where: { id: runId, invoiceId } });
    }
    return this.prisma.cmInvoiceCostRun.findFirst({
      where: { invoiceId },
      orderBy: { startedAt: "desc" }
    });
  }
}

export function calculateCostComponent(componentCode: CostComponent, energyBasis: "BC" | "PF", energyKwh: number | null, source: SourcePrice | null): CostComponentResult {
  const notFoundCode = `${componentCode}_NOT_FOUND`;
  if (energyKwh === null || !Number.isFinite(energyKwh)) {
    return unresolved(componentCode, energyBasis === "PF" ? "INVALID_PF" : "INVALID_BC", energyBasis, energyKwh, source);
  }
  if (!source) {
    if (isOptionalSettlementComponent(componentCode)) return optionalSettlementComponent(componentCode, energyBasis, energyKwh);
    return unresolved(componentCode, notFoundCode, energyBasis, energyKwh, null);
  }
  if (source.sourceErrorCode) {
    return unresolved(componentCode, source.sourceErrorCode, energyBasis, energyKwh, source);
  }
  if (source.priceEurMwh === null || !Number.isFinite(source.priceEurMwh)) {
    return unresolved(componentCode, "INVALID_PRICE", energyBasis, energyKwh, source);
  }
  const energyMwh = energyKwh / 1000;
  return {
    componentCode,
    energyBasis,
    energyKwh,
    energyMwh,
    priceEurMwh: source.priceEurMwh,
    baseAmountEur: null,
    percentage: null,
    costEur: energyMwh * source.priceEurMwh,
    sourceTable: source.sourceTable,
    sourceRowId: source.sourceRowId,
    sourceVersion: source.sourceVersion,
    regulatedPriceVersionId: source.regulatedPriceVersionId ?? null,
    regulatedPriceVersionName: source.regulatedPriceVersionName ?? null,
    sourceValidFrom: source.sourceValidFrom ?? null,
    sourceValidTo: source.sourceValidTo ?? null,
    sourceTariffCode: source.sourceTariffCode ?? null,
    sourceTariffPeriod: source.sourceTariffPeriod ?? null,
    sourceResolutionMinutes: source.sourceResolutionMinutes,
    status: "OK",
    incidentCode: null
  };
}

function optionalSettlementComponent(componentCode: Extract<CostComponent, "BS3" | "RAD3">, energyBasis: "BC" | "PF", energyKwh: number): CostComponentResult {
  return {
    componentCode,
    energyBasis,
    energyKwh,
    energyMwh: energyKwh / 1000,
    priceEurMwh: null,
    baseAmountEur: null,
    percentage: null,
    costEur: 0,
    sourceTable: null,
    sourceRowId: null,
    sourceVersion: null,
    regulatedPriceVersionId: null,
    regulatedPriceVersionName: null,
    sourceValidFrom: null,
    sourceValidTo: null,
    sourceTariffCode: null,
    sourceTariffPeriod: null,
    sourceResolutionMinutes: 15,
    status: "OK",
    incidentCode: null
  };
}

function isOptionalSettlementComponent(componentCode: CostComponent): componentCode is Extract<CostComponent, "BS3" | "RAD3"> {
  return componentCode === "BS3" || componentCode === "RAD3";
}

export function buildMadridQuarterKeys(instants: Date[]) {
  const sorted = [...instants].sort((left, right) => left.getTime() - right.getTime());
  const counters = new Map<string, number>();
  const result = new Map<string, TimeKey>();
  for (const instant of sorted) {
    const parts = getMadridParts(instant);
    const quarterOrder = (counters.get(parts.date) ?? 0) + 1;
    counters.set(parts.date, quarterOrder);
    const hourOrder = Math.floor((quarterOrder - 1) / 4) + 1;
    result.set(instant.toISOString(), {
      iso: instant.toISOString(),
      fecha: parts.date,
      hourlyKey: `${parts.date}|${hourOrder}`,
      quarterKey: `${parts.date}|${quarterOrder}`,
      hourOrder,
      quarterOrder
    });
  }
  return result;
}

function groupLiquidations(
  rows: Array<{
    id: string;
    fecha: Date | null;
    fechaLiquidacion: Date;
    hora: number | null;
    version: ReeSettlementVersion;
    precioEurMwh: Prisma.Decimal | null;
    segmento: string | null;
    codigoPrecio: string | null;
    codigoApunte: string | null;
  }>,
  resolutionMinutes: 15 | 60
) {
  const groups: Record<LiquidationComponent, Map<string, SourceCandidate[]>> = {
    CAD: new Map(),
    BS3: new Map(),
    RAD3: new Map()
  };
  for (const row of rows) {
    const component = identifyLiquidationComponent(row);
    if (!component || (resolutionMinutes === 60 && !HOURLY_COMPONENTS.includes(component as (typeof HOURLY_COMPONENTS)[number])) || (resolutionMinutes === 15 && !QH_COMPONENTS.includes(component as (typeof QH_COMPONENTS)[number]))) {
      continue;
    }
    const fecha = dateOnly(row.fecha ?? row.fechaLiquidacion);
    const period = row.hora;
    const price = decimalToNumber(row.precioEurMwh);
    const version = row.version as PricingSettlementVersion;
    if (!fecha || !period || price === null || !isPricingVersion(version)) {
      continue;
    }
    const key = `${fecha}|${period}`;
    const target = groups[component].get(key) ?? [];
    target.push({
      priceEurMwh: price,
      sourceTable: resolutionMinutes === 60 ? "reganecu_records" : "reganecu_qh_records",
      sourceRowId: row.id,
      sourceVersion: version,
      sourceResolutionMinutes: resolutionMinutes,
      version
    });
    groups[component].set(key, target);
  }
  return {
    CAD: selectLatestSource(groups.CAD),
    BS3: selectLatestSource(groups.BS3),
    RAD3: selectLatestSource(groups.RAD3)
  };
}

function selectLatestSource(groups: Map<string, SourceCandidate[]>) {
  const result = new Map<string, SourcePrice>();
  for (const [key, values] of groups.entries()) {
    const latest = selectLatestAvailableVersion(values.map((value) => ({ version: value.version, value })));
    if (latest.value) {
      result.set(key, latest.value);
    }
  }
  return result;
}

function regulatedPriceContextInclude() {
  return {
    rethPrice: true,
    efihPrice: true,
    pc3Prices: true,
    tollsChargesPrices: true,
    socialBonusPrice: true,
    otherPrice: true,
    imuRate: true
  } satisfies Prisma.RegulatedPriceVersionInclude;
}

function resolveVersionFromContext(context: RegulatedPriceContext, code: RegulatedPriceCode, date: string) {
  const target = new Date(`${date}T00:00:00.000Z`).getTime();
  const rows = (context.byCode.get(code) ?? []).filter((row) => {
    const from = row.validFrom.getTime();
    const to = row.validTo ? row.validTo.getTime() : Number.POSITIVE_INFINITY;
    return from <= target && to >= target;
  });
  if (rows.length === 0) throw new Error("PRICE_VERSION_NOT_FOUND");
  if (rows.length > 1) throw new Error("PRICE_VERSION_OVERLAP");
  return rows[0];
}

function resolveSimpleRegulatedPrice(context: RegulatedPriceContext, code: "RETH" | "EFIH" | "BONO_SOCIAL" | "OTROS", date: string) {
  const version = resolveVersionFromContext(context, code, date);
  const detail = code === "RETH" ? version.rethPrice : code === "EFIH" ? version.efihPrice : code === "BONO_SOCIAL" ? version.socialBonusPrice : version.otherPrice;
  if (!detail) throw new Error(`${code}_PRICE_NOT_CONFIGURED`);
  const priceEurMwh = decimalToNumber(detail.priceEurMwh);
  if (priceEurMwh === null) throw new Error(`${code}_PRICE_NOT_CONFIGURED`);
  return {
    versionId: version.id,
    versionName: version.name,
    validFrom: dateOnly(version.validFrom),
    validTo: dateOnly(version.validTo),
    sourceTable: code === "RETH" ? "regulated_reth_prices" : code === "EFIH" ? "regulated_efih_prices" : code === "BONO_SOCIAL" ? "regulated_social_bonus_prices" : "regulated_other_prices",
    sourceRowId: detail.id,
    priceEurMwh,
    tariffCode: null,
    tariffPeriod: null
  };
}

function resolvePc3PriceFromContext(context: RegulatedPriceContext, date: string, tariffCode: string, tariffPeriod: string) {
  const version = resolveVersionFromContext(context, "PC3", date);
  const row = version.pc3Prices.find((item) => normalizeTariffCode(item.tariffCode) === normalizeTariffCode(tariffCode));
  if (!row) throw new Error("PC3_TARIFF_NOT_FOUND");
  const period = parseTariffPeriod(tariffPeriod);
  const value = decimalToNumber(row[`p${period.slice(1)}EurMwh` as keyof typeof row] as Prisma.Decimal | null);
  if (value === null) throw new Error("PC3_PRICE_NOT_CONFIGURED");
  return {
    versionId: version.id,
    versionName: version.name,
    validFrom: dateOnly(version.validFrom),
    validTo: dateOnly(version.validTo),
    sourceTable: "regulated_pc3_prices",
    sourceRowId: row.id,
    tariffCode: row.tariffCode,
    tariffPeriod: period,
    priceEurMwh: value
  };
}

function resolveTollsChargesEnergyPriceFromContext(context: RegulatedPriceContext, date: string, tariffCode: string, tariffPeriod: string) {
  const version = resolveVersionFromContext(context, "TOLLS_CHARGES", date);
  const row = version.tollsChargesPrices.find((item) => normalizeTariffCode(item.tariffCode) === normalizeTariffCode(tariffCode));
  if (!row) throw new Error("TOLLS_CHARGES_TARIFF_NOT_FOUND");
  const period = parseTariffPeriod(tariffPeriod);
  const value = decimalToNumber(row[`energy${period}EurMwh` as keyof typeof row] as Prisma.Decimal | null);
  if (value === null) throw new Error("TOLLS_CHARGES_ENERGY_PRICE_NOT_CONFIGURED");
  return {
    versionId: version.id,
    versionName: version.name,
    validFrom: dateOnly(version.validFrom),
    validTo: dateOnly(version.validTo),
    sourceTable: "regulated_tolls_charges_prices",
    sourceRowId: row.id,
    tariffCode: row.tariffCode,
    tariffPeriod: period,
    priceEurMwh: value
  };
}

function resolveTollsChargesPowerPriceFromContext(context: RegulatedPriceContext, date: string, tariffCode: string, tariffPeriod: string) {
  const version = resolveVersionFromContext(context, "TOLLS_CHARGES", date);
  const row = version.tollsChargesPrices.find((item) => normalizeTariffCode(item.tariffCode) === normalizeTariffCode(tariffCode));
  if (!row) throw new Error("TOLLS_CHARGES_TARIFF_NOT_FOUND");
  const period = parseTariffPeriod(tariffPeriod);
  const value = decimalToNumber(row[`power${period}EurKwYear` as keyof typeof row] as Prisma.Decimal | null);
  if (value === null) throw new Error("TOLLS_CHARGES_POWER_PRICE_NOT_CONFIGURED");
  return {
    versionId: version.id,
    versionName: version.name,
    validFrom: dateOnly(version.validFrom),
    validTo: dateOnly(version.validTo),
    sourceTable: "regulated_tolls_charges_prices",
    sourceRowId: row.id,
    tariffCode: row.tariffCode,
    tariffPeriod: period,
    priceEurKwYear: value
  };
}

function resolveImuRateFromContext(context: RegulatedPriceContext, date: string) {
  const version = resolveVersionFromContext(context, "IMU", date);
  if (!version.imuRate) throw new Error("IMU_RATE_NOT_CONFIGURED");
  const percentage = decimalToNumber(version.imuRate.percentage);
  if (percentage === null) throw new Error("IMU_RATE_NOT_CONFIGURED");
  return {
    versionId: version.id,
    versionName: version.name,
    validFrom: dateOnly(version.validFrom),
    validTo: dateOnly(version.validTo),
    sourceTable: "regulated_imu_rates",
    sourceRowId: version.imuRate.id,
    percentage
  };
}

function identifyLiquidationComponent(row: { segmento: string | null; codigoPrecio: string | null; codigoApunte: string | null }): LiquidationComponent | null {
  const fields = [row.segmento, row.codigoPrecio, row.codigoApunte].map((value) => value?.toUpperCase() ?? "");
  for (const component of LIQUIDATION_COMPONENTS) {
    if (fields.some((value) => value === component || value.includes(component))) {
      return component;
    }
  }
  return null;
}

function liquidationWhere(component: LiquidationComponent): Prisma.ReganecuRecordWhereInput {
  return {
    OR: [
      { segmento: component },
      { codigoPrecio: { in: [component, `P_${component}`, component === "RAD3" ? "P_2RAD3" : `P_${component}`] } },
      { codigoApunte: { contains: component } }
    ]
  };
}

function unresolved(componentCode: CostComponent, incidentCode: string, energyBasis: "BC" | "PF" | "ECONOMIC_AMOUNT", energyKwh: number | null, source: SourcePrice | null): CostComponentResult {
  const energyMwh = energyKwh === null || !Number.isFinite(energyKwh) ? null : energyKwh / 1000;
  return {
    componentCode,
    energyBasis,
    energyKwh,
    energyMwh,
    priceEurMwh: source?.priceEurMwh ?? null,
    baseAmountEur: null,
    percentage: source?.percentage ?? null,
    costEur: null,
    sourceTable: source?.sourceTable ?? null,
    sourceRowId: source?.sourceRowId ?? null,
    sourceVersion: source?.sourceVersion ?? null,
    regulatedPriceVersionId: source?.regulatedPriceVersionId ?? null,
    regulatedPriceVersionName: source?.regulatedPriceVersionName ?? null,
    sourceValidFrom: source?.sourceValidFrom ?? null,
    sourceValidTo: source?.sourceValidTo ?? null,
    sourceTariffCode: source?.sourceTariffCode ?? null,
    sourceTariffPeriod: source?.sourceTariffPeriod ?? null,
    sourceResolutionMinutes: source?.sourceResolutionMinutes ?? null,
    status: "WARNING",
    incidentCode
  };
}

function summarizeComponents(components: CostComponentResult[], powerComponents: PowerCostComponentResult[] = []): ComponentSummary[] {
  const componentCodes = HISTORICAL_COST_COMPONENTS.filter((componentCode) => components.some((item) => item.componentCode === componentCode) || (componentCode === "TOLLS_CHARGES_POWER" && powerComponents.length > 0));
  return componentCodes.map((componentCode) => {
    if (componentCode === "TOLLS_CHARGES_POWER") {
      const cost = powerComponents.filter((item) => item.status === "OK" && item.costEur !== null).reduce((sum, item) => sum + (item.costEur ?? 0), 0);
      return {
        componentCode,
        nature: costComponentNature(componentCode),
        calculationBasis: "CONTRACTED_POWER",
        costEur: cost,
        weightedPriceEurMwh: null,
        intervals: powerComponents.length,
        incidents: powerComponents.filter((item) => item.incidentCode).length,
        versions: [...new Set(powerComponents.map((item) => item.regulatedPriceVersionName).filter((item): item is string => item !== null))].sort()
      };
    }
    const rows = components.filter((item) => item.componentCode === componentCode);
    const ok = rows.filter((item) => item.status === "OK" && item.costEur !== null && item.energyMwh !== null);
    const energy = ok.reduce((sum, item) => sum + (item.energyMwh ?? 0), 0);
    const cost = rows.filter((item) => item.status === "OK" && item.costEur !== null).reduce((sum, item) => sum + (item.costEur ?? 0), 0);
    return {
      componentCode,
      nature: costComponentNature(componentCode),
      calculationBasis: rows[0]?.energyBasis ?? null,
      costEur: cost,
      weightedPriceEurMwh: energy > 0 ? cost / energy : null,
      intervals: rows.length,
      incidents: rows.filter((item) => item.incidentCode).length,
      versions: [...new Set(rows.map((item) => item.sourceVersion ?? item.regulatedPriceVersionName).filter((item): item is string => item !== null))].sort((left, right) => {
        const leftIndex = LIQUIDATION_MATURITY_ORDER.indexOf(left as PricingSettlementVersion);
        const rightIndex = LIQUIDATION_MATURITY_ORDER.indexOf(right as PricingSettlementVersion);
        if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
        return left.localeCompare(right);
      })
    };
  });
}

export function costComponentNature(componentCode: CostComponent): CostNature {
  return COMPONENT_NATURE[componentCode];
}

function summarizeLiquidationVersions(components: CostComponentResult[]) {
  return LIQUIDATION_COMPONENTS.map((componentCode) => ({
    componentCode,
    versions: [...new Set(components.filter((item) => item.componentCode === componentCode).map((item) => item.sourceVersion).filter((item): item is PricingSettlementVersion => item !== null))]
  }));
}

function summarizeLiquidationVersionsFromSummary(summary: ComponentSummary[]) {
  return LIQUIDATION_COMPONENTS.map((componentCode) => ({
    componentCode,
    versions: summary.find((item) => item.componentCode === componentCode)?.versions ?? []
  }));
}

function parseStoredComponentSummary(value: Prisma.JsonValue | null): ComponentSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const componentCode = typeof row.componentCode === "string" && isStoredCostComponent(row.componentCode) ? row.componentCode : null;
    if (!componentCode) return [];
    const nature = row.nature === "POWER" ? "POWER" : "ENERGY";
    const calculationBasis = row.calculationBasis === "BC" || row.calculationBasis === "PF" || row.calculationBasis === "ECONOMIC_AMOUNT" || row.calculationBasis === "CONTRACTED_POWER" ? row.calculationBasis : null;
    return [{
      componentCode,
      nature,
      calculationBasis,
      costEur: numberOrZero(row.costEur),
      weightedPriceEurMwh: numberOrNull(row.weightedPriceEurMwh),
      intervals: integerOrZero(row.intervals),
      incidents: integerOrZero(row.incidents),
      versions: Array.isArray(row.versions) ? row.versions.filter((version): version is string => typeof version === "string") : []
    }];
  });
}

function isStoredCostComponent(value: string): value is CostComponent {
  return (HISTORICAL_COST_COMPONENTS as readonly string[]).includes(value);
}

function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function isExpectedMissingSettlementIncident(code: string) {
  return code === "BS3_NOT_FOUND" || code === "RAD3_NOT_FOUND";
}

function costsResponseFromCalculatedResult(
  run: Parameters<typeof costRunRow>[0],
  result: Awaited<ReturnType<BillingDashboardCostsService["buildCostRun"]>>
) {
  const components = result.intervalCosts.flatMap((interval) => interval.components);
  return {
    status: run.status === "COMPLETED" && run.incidentsCount === 0 ? "COSTS_READY" : run.status,
    latestRun: costRunRow(run),
    componentSummary: result.summary,
    totals: {
      omieEur: decimalToNumber(run.totalOmieEur),
      liquidationsEur: decimalToNumber(run.totalLiquidationsEur),
      regulatedEur: decimalToNumber(run.totalRegulatedEur),
      configuredEnergyEur: decimalToNumber(run.totalConfiguredEur),
      tollsChargesEur: decimalToNumber(run.totalTollsChargesEur),
      tollsChargesPowerEur: decimalToNumber(run.totalTollsChargesPowerEur),
      derivedEur: decimalToNumber(run.totalDerivedEur),
      totalCostEur: decimalToNumber(run.totalCostEur)
    },
    powerDetails: result.powerCosts,
    liquidationVersions: summarizeLiquidationVersions(components)
  };
}

type BillingAuditWorkbookInput = {
  invoice: {
    invoiceNumber: string;
    cups: string;
    polissaNumber: string | null;
    tariffCode: string | null;
    invoiceDate: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    curveSummary: {
      expectedIntervals: number;
      f1Intervals: number;
      p1Intervals: number;
      f5dIntervals: number;
      p5dIntervals: number;
      profiledIntervals: number;
      missingIntervals: number;
    };
  };
  run: ReturnType<typeof costRunRow>;
  curveRows: BillingAuditCurveRow[];
  powerRows: PowerCostComponentResult[];
};

type BillingAuditCurveRow = {
  id: string;
  datetime: Date;
  tariffPeriod: string;
  consumptionSource: string;
  profileType: string | null;
  consumptionPfKwh: number | null;
  consumptionBcKwh: number | null;
  lossPercentage: number | null;
  lossVersion: string | null;
  validationStatus: string | null;
  validationMessage: string | null;
  intervalCost: BillingAuditIntervalCost | null;
};

type BillingAuditIntervalCost = {
  totalCostEur: number | null;
  incidentCodes: string[];
  components: CostComponentResult[];
};

const AUDIT_PRICE_COMPONENTS = [
  "OMIE_MD",
  "CAD",
  "BS3",
  "RAD3",
  "RETH",
  "PC3_CONFIG",
  "EFIH",
  "TOLLS_CHARGES_ENERGY",
  "BONO_SOCIAL",
  "OTROS"
] as const;

const AUDIT_QH_HEADERS = [
  "Fecha/hora",
  "Periodo",
  "Fuente",
  "PF",
  "Perdidas %",
  "Version perdidas",
  "BC",
  "OMIE MD (€/MWh)",
  "CAD (€/MWh)",
  "BS3 (€/MWh)",
  "RAD3 (€/MWh)",
  "RETh (€/MWh)",
  "PC3 (€/MWh)",
  "EFIh (€/MWh)",
  "Peajes + Cargos - Energia (€/MWh)",
  "Bono Social (€/MWh)",
  "Otros (€/MWh)",
  "IMU (%)",
  "Total €",
  "Warnings Curva",
  "Warnings Precio"
];

export function buildBillingAuditWorkbook(input: BillingAuditWorkbookInput) {
  const workbook = XLSX.utils.book_new();
  const qhRows = [
    AUDIT_QH_HEADERS,
    ...input.curveRows.map((row) => {
      const components = new Map(row.intervalCost?.components.map((component) => [component.componentCode, component]) ?? []);
      const warningPriceCodes = [
        ...(row.intervalCost?.incidentCodes ?? []),
        ...(row.intervalCost?.components.map((component) => component.incidentCode).filter((code): code is string => Boolean(code)) ?? [])
      ];
      return [
        madridExcelDate(row.datetime),
        row.tariffPeriod,
        curveSourceLabel(row.consumptionSource, row.profileType),
        row.consumptionPfKwh,
        row.lossPercentage,
        row.lossVersion,
        row.consumptionBcKwh,
        ...AUDIT_PRICE_COMPONENTS.map((componentCode) => components.get(componentCode)?.priceEurMwh ?? null),
        components.get("IMU")?.percentage ?? null,
        row.intervalCost?.totalCostEur ?? null,
        curveWarnings(row).join("; "),
        [...new Set(warningPriceCodes)].join("; ")
      ];
    })
  ];
  const qhSheet = XLSX.utils.aoa_to_sheet(qhRows, { cellDates: true });
  applyAuditSheetLayout(qhSheet, input.curveRows.length, AUDIT_QH_HEADERS.length);
  XLSX.utils.book_append_sheet(workbook, qhSheet, "Auditoria QH");

  const summaryRows = [
    ["Campo", "Valor"],
    ["Factura", input.invoice.invoiceNumber],
    ["CUPS", input.invoice.cups],
    ["Poliza", input.invoice.polissaNumber],
    ["Tarifa", input.invoice.tariffCode],
    ["Fecha factura", input.invoice.invoiceDate],
    ["Periodo consumo", `${input.invoice.periodStart ?? "-"} - ${input.invoice.periodEnd ?? "-"}`],
    ["Run de costes", input.run.id],
    ["CalculationVersion", input.run.calculationVersion],
    ["Estado costes", input.run.status],
    ["PF total", sumNullable(input.curveRows.map((row) => row.consumptionPfKwh))],
    ["BC total", sumNullable(input.curveRows.map((row) => row.consumptionBcKwh))],
    ["Coste QH total", sumNullable(input.curveRows.map((row) => row.intervalCost?.totalCostEur ?? null))],
    ["Peajes + Cargos - Potencia €", input.run.totalTollsChargesPowerEur],
    ["Coste total run €", input.run.totalCostEur],
    [],
    ["Cobertura", "Intervalos", "%"],
    ["F1", input.invoice.curveSummary.f1Intervals, pct(input.invoice.curveSummary.f1Intervals, input.invoice.curveSummary.expectedIntervals)],
    ["TgP1", input.invoice.curveSummary.p1Intervals, pct(input.invoice.curveSummary.p1Intervals, input.invoice.curveSummary.expectedIntervals)],
    ["F5D", input.invoice.curveSummary.f5dIntervals, pct(input.invoice.curveSummary.f5dIntervals, input.invoice.curveSummary.expectedIntervals)],
    ["P5D", input.invoice.curveSummary.p5dIntervals, pct(input.invoice.curveSummary.p5dIntervals, input.invoice.curveSummary.expectedIntervals)],
    ["Perfil", input.invoice.curveSummary.profiledIntervals, pct(input.invoice.curveSummary.profiledIntervals, input.invoice.curveSummary.expectedIntervals)],
    ["Missing", input.invoice.curveSummary.missingIntervals, pct(input.invoice.curveSummary.missingIntervals, input.invoice.curveSummary.expectedIntervals)]
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows, { cellDates: true });
  summarySheet["!cols"] = [{ wch: 34 }, { wch: 56 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumen");

  const powerRows = [
    ["Periodo", "Potencia kW", "Desde", "Hasta", "Dias", "Precio €/kW año", "Version", "Coste €"],
    ...input.powerRows.map((row) => [
      row.tariffPeriod,
      row.contractedPowerKw,
      row.startDate,
      row.endDate,
      row.billedDays,
      row.annualPriceEurKwYear,
      row.regulatedPriceVersionName,
      row.costEur
    ])
  ];
  const powerSheet = XLSX.utils.aoa_to_sheet(powerRows, { cellDates: true });
  powerSheet["!autofilter"] = { ref: `A1:H${Math.max(powerRows.length, 1)}` };
  powerSheet["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 28 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(workbook, powerSheet, "Potencia");

  setWorkbookFormats(workbook);
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

function auditIntervalCostRow(row: {
  totalCostEur: Prisma.Decimal | null;
  incidentCodes: Prisma.JsonValue | null;
  components: Array<Parameters<typeof componentRow>[0]>;
} | null): BillingAuditIntervalCost | null {
  if (!row) return null;
  return {
    totalCostEur: decimalToNumber(row.totalCostEur),
    incidentCodes: Array.isArray(row.incidentCodes) ? row.incidentCodes.filter((item): item is string => typeof item === "string") : [],
    components: row.components.map(componentRow)
  };
}

function auditCalculatedIntervalCostRow(row: {
  totalCostEur: number | null;
  incidentCodes: string[];
  components: CostComponentResult[];
} | null): BillingAuditIntervalCost | null {
  if (!row) return null;
  return {
    totalCostEur: row.totalCostEur,
    incidentCodes: row.incidentCodes,
    components: row.components
  };
}

function applyAuditSheetLayout(sheet: XLSX.WorkSheet, rows: number, columns: number) {
  sheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(columns - 1)}${rows + 1}` };
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 } as unknown as XLSX.WorkSheet["!freeze"];
  sheet["!cols"] = [
    { wch: 19 },
    { wch: 10 },
    { wch: 18 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 14 },
    ...Array.from({ length: 10 }, () => ({ wch: 18 })),
    { wch: 12 },
    { wch: 14 },
    { wch: 32 },
    { wch: 42 }
  ];
}

function setWorkbookFormats(workbook: XLSX.WorkBook) {
  const qhSheet = workbook.Sheets["Auditoria QH"];
  if (qhSheet?.["!ref"]) {
    const range = XLSX.utils.decode_range(qhSheet["!ref"]);
    for (let row = 1; row <= range.e.r; row++) {
      setCellFormat(qhSheet, row, 0, "dd/mm/yyyy hh:mm");
      for (const column of [3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18]) setCellFormat(qhSheet, row, column, "0.000000");
      setCellFormat(qhSheet, row, 17, "0.0000");
    }
  }
  const summarySheet = workbook.Sheets["Resumen"];
  for (const row of [10, 11, 12, 13, 14]) setCellFormat(summarySheet, row, 1, "0.000000");
  for (const row of [17, 18, 19, 20, 21, 22]) setCellFormat(summarySheet, row, 2, "0.00");
  const powerSheet = workbook.Sheets["Potencia"];
  if (powerSheet?.["!ref"]) {
    const range = XLSX.utils.decode_range(powerSheet["!ref"]);
    for (let row = 1; row <= range.e.r; row++) {
      for (const column of [1, 5, 7]) setCellFormat(powerSheet, row, column, "0.000000");
    }
  }
}

function setCellFormat(sheet: XLSX.WorkSheet | undefined, row: number, column: number, format: string) {
  const cell = sheet?.[XLSX.utils.encode_cell({ r: row, c: column })];
  if (cell) cell.z = format;
}

function madridExcelDate(value: Date) {
  const parts = madridDateTimeParts(value);
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
}

const madridDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

function madridDateTimeParts(value: Date) {
  const parts = madridDateTimeFormatter.formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute") };
}

function curveSourceLabel(source: string, profileType: string | null) {
  if (source === "P1") return "TgP1";
  if (source === "PROFILE_FINAL") return "Perfil FINAL";
  if (source === "PROFILE_INTERMEDIATE") return "Perfil INTERMEDIO";
  if (source === "PROFILE_INITIAL") return "Perfil INICIAL";
  if (source === "MISSING") return "Missing";
  if (source === "F1" || source === "F5D" || source === "P5D") return source;
  return profileType ? `Perfil ${profileType}` : source;
}

function curveWarnings(row: BillingAuditCurveRow) {
  const warnings: string[] = [];
  if (row.validationStatus && row.validationStatus !== "OK") warnings.push(row.validationMessage ?? "CURVE_WARNING");
  if (row.consumptionSource === "MISSING") warnings.push("CURVE_INCOMPLETE");
  if (!row.tariffPeriod) warnings.push("PERIOD_NOT_RESOLVED");
  if (row.consumptionPfKwh === null) warnings.push("PF_NOT_CALCULATED");
  if (row.lossPercentage === null) warnings.push("LOSSES_NOT_FOUND");
  if (row.lossVersion === null) warnings.push("LOSS_VERSION_NOT_RESOLVED");
  if (row.consumptionBcKwh === null) warnings.push("BC_NOT_CALCULATED");
  return [...new Set(warnings)];
}

function sumNullable(values: Array<number | null>) {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function pct(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0;
}

function sanitizeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/\s+/g, "_").slice(0, 120) || "factura";
}

function sumComponents(components: CostComponentResult[], componentCode: CostComponent) {
  return components.filter((item) => item.componentCode === componentCode).reduce((sum, item) => sum + (item.costEur ?? 0), 0);
}

function applyEconomicSignToCostResults(
  intervalCosts: Array<{
    liquidationsCostEur: number;
    regulatedCostEur: number;
    configuredCostEur: number;
    tollsChargesCostEur: number;
    derivedCostEur: number;
    totalCostEur: number;
    components: CostComponentResult[];
  }>,
  powerCosts: PowerCostComponentResult[],
  economicSign: number | null | undefined
) {
  const sign = economicSign === -1 ? -1 : 1;
  if (sign === 1) return;
  for (const interval of intervalCosts) {
    interval.liquidationsCostEur *= sign;
    interval.regulatedCostEur *= sign;
    interval.configuredCostEur *= sign;
    interval.tollsChargesCostEur *= sign;
    interval.derivedCostEur *= sign;
    interval.totalCostEur *= sign;
    for (const component of interval.components) {
      if (component.costEur !== null) component.costEur *= sign;
      if (component.baseAmountEur !== null) component.baseAmountEur *= sign;
    }
  }
  for (const component of powerCosts) {
    if (component.costEur !== null) component.costEur *= sign;
  }
}

function normalizeContractedPowerByPeriod(lines: InvoiceLineForCosts[]) {
  const values = new Map<string, number | null>();
  const seen = new Map<string, Set<string>>();
  for (const line of lines.filter(isPowerLine)) {
    const period = normalizePowerPeriod(line.lineName);
    if (!period) continue;
    const quantity = decimalToNumber(line.quantity);
    if (quantity === null) {
      values.set(period, null);
      continue;
    }
    const rounded = quantity.toFixed(6);
    const periodSeen = seen.get(period) ?? new Set<string>();
    periodSeen.add(rounded);
    seen.set(period, periodSeen);
    values.set(period, quantity);
  }
  if ([...seen.values()].some((items) => items.size > 1)) {
    return { values, error: "CONTRACTED_POWER_AMBIGUOUS" as const };
  }
  return { values, error: null };
}

function isPowerLine(line: InvoiceLineForCosts) {
  const text = `${line.accountName ?? ""} ${line.lineName ?? ""}`.toLowerCase();
  return text.includes("potenc");
}

function normalizePowerPeriod(value: string | null) {
  const match = value?.trim().toUpperCase().match(/^P([1-6])$/);
  return match ? `P${match[1]}` : null;
}

function powerUnresolved(incidentCode: string, tariffCode: string | null, tariffPeriod: string | null, contractedPowerKw: number | null, startDate: string, endDate: string): PowerCostComponentResult {
  return {
    componentCode: "TOLLS_CHARGES_POWER",
    calculationBasis: "CONTRACTED_POWER",
    tariffCode,
    tariffPeriod,
    contractedPowerKw,
    startDate,
    endDate,
    billedDays: inclusiveDays(startDate, endDate),
    yearDays: null,
    annualPriceEurKwYear: null,
    costEur: null,
    sourceTable: "regulated_tolls_charges_prices",
    sourceRowId: null,
    regulatedPriceVersionId: null,
    regulatedPriceVersionName: null,
    sourceValidFrom: null,
    sourceValidTo: null,
    status: "WARNING",
    incidentCode
  };
}

function enumerateDatesInclusive(start: string, end: string) {
  const result: string[] = [];
  for (let current = start; current <= end; current = nextDate(current)) result.push(current);
  return result;
}

function parseIndexedPriceHistoryQuery(query: Record<string, unknown>) {
  const dateFrom = isoDate(query.dateFrom);
  const dateTo = isoDate(query.dateTo);
  if (!dateFrom || !dateTo) throw new BadRequestException("Fecha desde y fecha hasta son obligatorias.");
  if (dateFrom > dateTo) throw new BadRequestException("Fecha desde no puede ser posterior a fecha hasta.");
  if (enumerateDatesInclusive(dateFrom, dateTo).length > 1830) throw new BadRequestException("El rango maximo permitido es de 5 anos.");
  const requestedTariff = normalizeTariffCode(text(query.tariffCode));
  const componentScope = parseIndexedPriceComponentScope(query.componentScope);
  const componentCodes = [...INDEXED_PRICE_COMPONENT_SCOPES[componentScope]];
  return {
    dateFrom,
    dateTo,
    componentScope,
    componentCodes,
    scopeKey: `${requestedTariff ? `TARIFF:${requestedTariff}` : "ALL"}|COMPONENTS:${componentScope}|${INDEXED_PRICE_HISTORY_CACHE_VERSION}`
  };
}

function parseIndexedPriceComponentScope(value: unknown): IndexedPriceComponentScope {
  const normalized = text(value)?.toUpperCase();
  return normalized === "OMIE_IMU" ? "OMIE_IMU" : "FULL_ENERGY";
}

function enumerateMonthsInclusive(start: string, end: string) {
  const result: string[] = [];
  const cursor = new Date(`${start.slice(0, 7)}-01T00:00:00.000Z`);
  const endMonth = `${end.slice(0, 7)}-01`;
  while (dateOnly(cursor)! <= endMonth) {
    result.push(dateOnly(cursor)!.slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

function nextDate(date: string) {
  const current = new Date(`${date}T00:00:00.000Z`);
  current.setUTCDate(current.getUTCDate() + 1);
  return dateOnly(current)!;
}

function inclusiveDays(start: string, end: string) {
  return enumerateDatesInclusive(start, end).length;
}

function daysInYear(date: string) {
  const year = Number(date.slice(0, 4));
  return isLeapYear(year) ? 366 : 365;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function normalizeTariffCode(value?: string | null) {
  const normalized = value?.trim().toUpperCase().replace(/\s+/g, "");
  return normalized || null;
}

function isTariffPeriod(value: unknown) {
  return typeof value === "string" && /^P[1-6]$/i.test(value.trim());
}

function parseTariffPeriod(value: string) {
  if (!isTariffPeriod(value)) throw new Error("TARIFF_PERIOD_NOT_RESOLVED");
  return value.trim().toUpperCase() as "P1" | "P2" | "P3" | "P4" | "P5" | "P6";
}

function nullSourceTable(componentCode: CostComponent) {
  if (componentCode === "RETH") return "regulated_reth_prices";
  if (componentCode === "EFIH") return "regulated_efih_prices";
  if (componentCode === "PC3_CONFIG") return "regulated_pc3_prices";
  if (componentCode === "TOLLS_CHARGES_ENERGY") return "regulated_tolls_charges_prices";
  if (componentCode === "TOLLS_CHARGES_POWER") return "regulated_tolls_charges_prices";
  if (componentCode === "BONO_SOCIAL") return "regulated_social_bonus_prices";
  if (componentCode === "OTROS") return "regulated_other_prices";
  if (componentCode === "IMU") return "regulated_imu_rates";
  return null;
}

function regulatedIncidentCode(componentCode: CostComponent, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (componentCode === "RETH") {
    if (message.includes("PRICE_VERSION_NOT_FOUND")) return "RETH_VERSION_NOT_FOUND";
    return "RETH_PRICE_NOT_CONFIGURED";
  }
  if (componentCode === "EFIH") {
    if (message.includes("PRICE_VERSION_NOT_FOUND")) return "EFIH_VERSION_NOT_FOUND";
    return "EFIH_PRICE_NOT_CONFIGURED";
  }
  if (componentCode === "PC3_CONFIG") {
    if (message.includes("PRICE_VERSION_NOT_FOUND")) return "PC3_VERSION_NOT_FOUND";
    if (message.includes("PC3_TARIFF_NOT_FOUND")) return "PC3_TARIFF_NOT_FOUND";
    return "PC3_PRICE_NOT_CONFIGURED";
  }
  if (componentCode === "TOLLS_CHARGES_ENERGY") {
    if (message.includes("PRICE_VERSION_NOT_FOUND")) return "TOLLS_CHARGES_VERSION_NOT_FOUND";
    if (message.includes("TOLLS_CHARGES_TARIFF_NOT_FOUND")) return "TOLLS_CHARGES_TARIFF_NOT_FOUND";
    return "TOLLS_CHARGES_ENERGY_PRICE_NOT_CONFIGURED";
  }
  if (componentCode === "TOLLS_CHARGES_POWER") {
    if (message.includes("PRICE_VERSION_NOT_FOUND")) return "TOLLS_CHARGES_POWER_VERSION_NOT_FOUND";
    if (message.includes("TOLLS_CHARGES_TARIFF_NOT_FOUND")) return "TOLLS_CHARGES_TARIFF_NOT_FOUND";
    return "TOLLS_CHARGES_POWER_PRICE_NOT_CONFIGURED";
  }
  if (componentCode === "BONO_SOCIAL") {
    if (message.includes("PRICE_VERSION_NOT_FOUND")) return "BONO_SOCIAL_VERSION_NOT_FOUND";
    return "BONO_SOCIAL_PRICE_NOT_CONFIGURED";
  }
  if (componentCode === "OTROS") {
    if (message.includes("PRICE_VERSION_NOT_FOUND")) return "OTROS_VERSION_NOT_FOUND";
    return "OTROS_PRICE_NOT_CONFIGURED";
  }
  if (componentCode === "IMU") {
    if (message.includes("PRICE_VERSION_NOT_FOUND")) return "IMU_VERSION_NOT_FOUND";
    return "IMU_RATE_NOT_CONFIGURED";
  }
  return `${componentCode}_NOT_FOUND`;
}

function componentRow(row: {
  componentCode: CmInvoiceCostComponentCode;
  energyBasis: CmInvoiceCostEnergyBasis;
  energyKwh: Prisma.Decimal | null;
  energyMwh: Prisma.Decimal | null;
  priceEurMwh: Prisma.Decimal | null;
  baseAmountEur: Prisma.Decimal | null;
  percentage: Prisma.Decimal | null;
  costEur: Prisma.Decimal | null;
  sourceTable: string | null;
  sourceRowId: string | null;
  sourceVersion: ReeSettlementVersion | null;
  regulatedPriceVersionId: string | null;
  regulatedPriceVersionName: string | null;
  sourceValidFrom: Date | null;
  sourceValidTo: Date | null;
  sourceTariffCode: string | null;
  sourceTariffPeriod: string | null;
  sourceResolutionMinutes: number | null;
  status: CmInvoiceIntervalCostStatus;
  incidentCode: string | null;
}): CostComponentResult {
  return {
    componentCode: row.componentCode as CostComponent,
    energyBasis: row.energyBasis as "BC" | "PF" | "ECONOMIC_AMOUNT",
    energyKwh: decimalToNumber(row.energyKwh),
    energyMwh: decimalToNumber(row.energyMwh),
    priceEurMwh: decimalToNumber(row.priceEurMwh),
    baseAmountEur: decimalToNumber(row.baseAmountEur),
    percentage: decimalToNumber(row.percentage),
    costEur: decimalToNumber(row.costEur),
    sourceTable: row.sourceTable,
    sourceRowId: row.sourceRowId,
    sourceVersion: row.sourceVersion as PricingSettlementVersion | null,
    regulatedPriceVersionId: row.regulatedPriceVersionId,
    regulatedPriceVersionName: row.regulatedPriceVersionName,
    sourceValidFrom: dateOnly(row.sourceValidFrom),
    sourceValidTo: dateOnly(row.sourceValidTo),
    sourceTariffCode: row.sourceTariffCode,
    sourceTariffPeriod: row.sourceTariffPeriod,
    sourceResolutionMinutes: row.sourceResolutionMinutes,
    status: row.status as ComponentStatus,
    incidentCode: row.incidentCode
  };
}

function powerComponentRow(row: {
  componentCode: CmInvoiceCostComponentCode;
  calculationBasis: CmInvoiceCostEnergyBasis;
  tariffCode: string | null;
  tariffPeriod: string | null;
  contractedPowerKw: Prisma.Decimal | null;
  startDate: Date;
  endDate: Date;
  billedDays: number;
  yearDays: number | null;
  annualPriceEurKwYear: Prisma.Decimal | null;
  costEur: Prisma.Decimal | null;
  sourceTable: string | null;
  sourceRowId: string | null;
  regulatedPriceVersionId: string | null;
  regulatedPriceVersionName: string | null;
  sourceValidFrom: Date | null;
  sourceValidTo: Date | null;
  status: CmInvoiceIntervalCostStatus;
  incidentCode: string | null;
}): PowerCostComponentResult {
  return {
    componentCode: row.componentCode as "TOLLS_CHARGES_POWER",
    calculationBasis: row.calculationBasis as "CONTRACTED_POWER",
    tariffCode: row.tariffCode,
    tariffPeriod: row.tariffPeriod,
    contractedPowerKw: decimalToNumber(row.contractedPowerKw),
    startDate: dateOnly(row.startDate)!,
    endDate: dateOnly(row.endDate)!,
    billedDays: row.billedDays,
    yearDays: row.yearDays,
    annualPriceEurKwYear: decimalToNumber(row.annualPriceEurKwYear),
    costEur: decimalToNumber(row.costEur),
    sourceTable: row.sourceTable,
    sourceRowId: row.sourceRowId,
    regulatedPriceVersionId: row.regulatedPriceVersionId,
    regulatedPriceVersionName: row.regulatedPriceVersionName,
    sourceValidFrom: dateOnly(row.sourceValidFrom),
    sourceValidTo: dateOnly(row.sourceValidTo),
    status: row.status as ComponentStatus,
    incidentCode: row.incidentCode
  };
}

function costRunRow(run: {
  id: string;
  invoiceId: string;
  status: CmInvoiceCostRunStatus;
  startedAt: Date;
  completedAt: Date | null;
  calculationVersion: string;
  totalOmieEur: Prisma.Decimal | null;
  totalLiquidationsEur: Prisma.Decimal | null;
  totalRegulatedEur: Prisma.Decimal | null;
  totalConfiguredEur?: Prisma.Decimal | null;
  totalTollsChargesEur?: Prisma.Decimal | null;
  totalTollsChargesPowerEur?: Prisma.Decimal | null;
  totalDerivedEur?: Prisma.Decimal | null;
  totalCostEur: Prisma.Decimal | null;
  intervalsCount: number;
  okIntervalsCount: number;
  warningIntervalsCount: number;
  errorIntervalsCount: number;
  incidentsCount: number;
  message: string | null;
}) {
  return {
    id: run.id,
    invoiceId: run.invoiceId,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    calculationVersion: run.calculationVersion,
    totalOmieEur: decimalToNumber(run.totalOmieEur),
    totalLiquidationsEur: decimalToNumber(run.totalLiquidationsEur),
    totalRegulatedEur: decimalToNumber(run.totalRegulatedEur),
    totalConfiguredEur: decimalToNumber(run.totalConfiguredEur),
    totalTollsChargesEur: decimalToNumber(run.totalTollsChargesEur),
    totalTollsChargesPowerEur: decimalToNumber(run.totalTollsChargesPowerEur),
    totalDerivedEur: decimalToNumber(run.totalDerivedEur),
    totalCostEur: decimalToNumber(run.totalCostEur),
    intervalsCount: run.intervalsCount,
    okIntervalsCount: run.okIntervalsCount,
    warningIntervalsCount: run.warningIntervalsCount,
    errorIntervalsCount: run.errorIntervalsCount,
    incidentsCount: run.incidentsCount,
    message: run.message
  };
}

function quarterInstantsForHour(timestampInicio: string) {
  const start = new Date(timestampInicio).getTime();
  return [0, 1, 2, 3].map((quarter) => new Date(start + quarter * 15 * 60 * 1000));
}

function aggregateIndexedHourComponents(quarters: CostComponentResult[][], componentCodes: readonly CostComponent[] = ENERGY_REPORT_COMPONENTS) {
  const byComponent = new Map<CostComponent, CostComponentResult[]>();
  for (const quarter of quarters) {
    for (const component of quarter) {
      const rows = byComponent.get(component.componentCode) ?? [];
      rows.push(component);
      byComponent.set(component.componentCode, rows);
    }
  }
  return componentCodes.map((componentCode) => {
    const rows = byComponent.get(componentCode) ?? [];
    if (rows.length === 0) return unresolved(componentCode, `${componentCode}_NOT_FOUND`, defaultEnergyBasis(componentCode), null, null);
    const first = rows[0];
    const costEur = rows.some((row) => row.status !== "OK" || row.costEur === null) ? null : rows.reduce((sum, row) => sum + (row.costEur ?? 0), 0);
    return {
      ...first,
      energyKwh: rows.reduce((sum, row) => sum + (row.energyKwh ?? 0), 0) || first.energyKwh,
      energyMwh: rows.reduce((sum, row) => sum + (row.energyMwh ?? 0), 0) || first.energyMwh,
      costEur,
      incidentCode: rows.find((row) => row.incidentCode)?.incidentCode ?? null,
      status: rows.some((row) => row.status !== "OK" || row.incidentCode) ? "WARNING" : "OK"
    } satisfies CostComponentResult;
  });
}

function defaultEnergyBasis(componentCode: CostComponent): "BC" | "PF" | "ECONOMIC_AMOUNT" {
  if (componentCode === "EFIH" || componentCode === "BONO_SOCIAL" || componentCode === "TOLLS_CHARGES_ENERGY") return "PF";
  if (componentCode === "IMU") return "ECONOMIC_AMOUNT";
  return "BC";
}

function indexedComponentRow(component: CostComponentResult) {
  return {
    componentCode: component.componentCode,
    label: indexedComponentLabel(component.componentCode),
    priceEurMwh: component.priceEurMwh,
    percentage: component.percentage,
    costEur: component.costEur,
    status: component.status,
    incidentCode: component.incidentCode
  };
}

function indexedComponentLabel(componentCode: CostComponent) {
  const labels: Record<CostComponent, string> = {
    OMIE_MD: "OMIE MD",
    CAD: "CAD",
    PC3: "PC3 REGANECU",
    BS3: "BS3",
    RAD3: "RAD3",
    RETH: "RETh",
    PC3_CONFIG: "PC3",
    EFIH: "EFIh",
    TOLLS_CHARGES_ENERGY: "Peajes + Cargos Energia",
    TOLLS_CHARGES_POWER: "Peajes + Cargos Potencia",
    BONO_SOCIAL: "Bono Social",
    OTROS: "Otros",
    IMU: "IMU"
  };
  return labels[componentCode] ?? componentCode;
}

function indexedDetailKey(tariffCode: string, date: string, period: string) {
  return `${tariffCode}|${date}|${period}`;
}

function indexedInitialProfileKey(tariffCode: string, localDate: string, localHour: number) {
  return `${normalizeTariffCode(tariffCode) ?? tariffCode}|${localDate}|${localHour}`;
}

function localDateFromParts(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function usesInitialProfileWeighting(tariffCode: string) {
  return (INDEXED_INITIAL_PROFILE_WEIGHTED_TARIFFS as readonly string[]).includes(normalizeTariffCode(tariffCode) ?? tariffCode);
}

function indexedAveragePrice(value: IndexedPriceAccumulator) {
  if (value.weighted) return value.weightTotal > 0 ? value.weightedTotal / value.weightTotal : null;
  return value.hours > 0 ? value.total / value.hours : null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function compareTariffPeriods(left: string, right: string) {
  return Number(left.slice(1)) - Number(right.slice(1));
}

function compareTariffCodes(left: string, right: string) {
  return left.localeCompare(right, "es", { numeric: true, sensitivity: "base" });
}

function versionIntersectsRange(dateFrom: string, dateTo: string, code: RegulatedPriceCode): Prisma.RegulatedPriceVersionWhereInput {
  return {
    code,
    validFrom: { lte: new Date(`${dateTo}T00:00:00.000Z`) },
    OR: [{ validTo: null }, { validTo: { gte: new Date(`${dateFrom}T00:00:00.000Z`) } }]
  };
}

function buildDateRange(values: string[]) {
  const sorted = [...new Set(values)].sort();
  return { start: sorted[0], end: sorted.at(-1) ?? sorted[0] };
}

function dateRange(fechaInicio: string, fechaFin: string) {
  return { gte: new Date(`${fechaInicio}T00:00:00.000Z`), lte: new Date(`${fechaFin}T00:00:00.000Z`) };
}

function dateOnly(value?: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function decimalOrNull(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? null : new Prisma.Decimal(value);
}

function decimalToNumber(value: Prisma.Decimal | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return value === null || value === undefined ? null : Number(value);
}

async function timePhase<T>(phases: Record<string, number> | undefined, key: string, callback: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await callback();
  } finally {
    if (phases) phases[key] = (phases[key] ?? 0) + Date.now() - started;
  }
}

function billingJobProfilingEnabled() {
  return process.env.BILLING_JOB_PROFILE === "true";
}

function parseInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isoDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function isPricingVersion(value: unknown): value is PricingSettlementVersion {
  return typeof value === "string" && LIQUIDATION_MATURITY_ORDER.includes(value as PricingSettlementVersion);
}

function isCostComponent(value: unknown): value is CostComponent {
  return typeof value === "string" && HISTORICAL_COST_COMPONENTS.includes(value as CostComponent);
}

function isIntervalStatus(value: unknown): value is CmInvoiceIntervalCostStatus {
  return value === "OK" || value === "WARNING" || value === "ERROR";
}

const PRISMA_PRICING_VERSIONS = [
  ReeSettlementVersion.A1,
  ReeSettlementVersion.C1,
  ReeSettlementVersion.A2,
  ReeSettlementVersion.C2,
  ReeSettlementVersion.A3,
  ReeSettlementVersion.C3,
  ReeSettlementVersion.A4,
  ReeSettlementVersion.C4,
  ReeSettlementVersion.A5,
  ReeSettlementVersion.C5
];
