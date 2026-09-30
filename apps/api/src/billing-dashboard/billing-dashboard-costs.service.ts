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
  ReeSettlementVersion
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { getMadridParts } from "../pricing-base/calendar_builder";
import type { PricingSettlementVersion } from "../pricing-base/pricing-base.types";
import { LIQUIDATION_MATURITY_ORDER, selectLatestAvailableVersion } from "../pricing-base/version_selector";
import { BillingDashboardRegulatedPricesService } from "./billing-dashboard-regulated-prices.service";

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

@Injectable()
export class BillingDashboardCostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regulatedPrices?: BillingDashboardRegulatedPricesService
  ) {}

  async calculateCosts(invoiceId: string) {
    const invoice = await this.prisma.cmInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
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
    });
    if (!invoice) throw new NotFoundException("Factura no encontrada.");
    if (invoice.curve.length === 0) throw new BadRequestException("La factura no tiene curva normalizada de Fase 1.");

    const run = await this.prisma.cmInvoiceCostRun.create({
      data: {
        invoiceId,
        status: CmInvoiceCostRunStatus.PROCESSING,
        calculationVersion: CALCULATION_VERSION
      }
    });

    try {
      const result = await this.buildCostRun(invoice.curve, invoice.tariffCode, invoice.periodStart, invoice.periodEnd, invoice.lines);
      await this.persistCostRun(run.id, invoiceId, result);
      return this.getCosts(invoiceId, run.id);
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
    const componentSummary = summarizeComponents(components.map(componentRow), powerComponents.map(powerComponentRow));
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
      liquidationVersions: summarizeLiquidationVersions(components.map(componentRow))
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
          expectedIntervals: true,
          f1Intervals: true,
          p1Intervals: true,
          f5dIntervals: true,
          p5dIntervals: true,
          profiledIntervals: true,
          missingIntervals: true,
          curve: {
            orderBy: { datetime: "asc" },
            select: {
              id: true,
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
    const costsByCurveId = new Map(intervalCosts.filter((item) => item.curveIntervalId).map((item) => [item.curveIntervalId!, item]));
    const costsByDatetime = new Map(intervalCosts.map((item) => [item.datetime.toISOString(), item]));
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
        intervalCost: auditIntervalCostRow(costsByCurveId.get(curve.id) ?? costsByDatetime.get(curve.datetime.toISOString()) ?? null)
      })),
      powerRows: powerComponents.map(powerComponentRow)
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

  private async buildCostRun(curve: CurveIntervalForCosts[], invoiceTariffCode?: string | null, periodStart?: Date | null, periodEnd?: Date | null, lines: InvoiceLineForCosts[] = []) {
    const timeKeys = buildMadridQuarterKeys(curve.map((row) => row.datetime));
    const dateRange = buildDateRange([...timeKeys.values()].map((item) => item.fecha));
    const tariffCode = normalizeTariffCode(invoiceTariffCode);
    const [omie, hourly, qh] = await Promise.all([
      this.loadOmie(dateRange.start, dateRange.end),
      this.loadHourlyLiquidations(dateRange.start, dateRange.end),
      this.loadQhLiquidations(dateRange.start, dateRange.end)
    ]);

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
        ...(await this.buildRegulatedComponents(key, interval.tariffPeriod, tariffCode, bcKwh, pfKwh))
      ];
      results.push(await this.buildImuComponent(key, results));
      const incidentCodes = results.map((item) => item.incidentCode).filter((item): item is string => Boolean(item));
      const omieCost = results.find((item) => item.componentCode === "OMIE_MD")?.costEur ?? 0;
      const liquidationsCost = results.filter((item) => LIQUIDATION_COMPONENTS.includes(item.componentCode as LiquidationComponent)).reduce((sum, item) => sum + (item.costEur ?? 0), 0);
      const configuredCost = results.filter((item) => CONFIGURED_COMPONENTS.includes(item.componentCode as (typeof CONFIGURED_COMPONENTS)[number])).reduce((sum, item) => sum + (item.costEur ?? 0), 0);
      const tollsChargesCost = results.filter((item) => TOLLS_CHARGES_COMPONENTS.includes(item.componentCode as (typeof TOLLS_CHARGES_COMPONENTS)[number])).reduce((sum, item) => sum + (item.costEur ?? 0), 0);
      const derivedCost = results.filter((item) => DERIVED_COMPONENTS.includes(item.componentCode as (typeof DERIVED_COMPONENTS)[number])).reduce((sum, item) => sum + (item.costEur ?? 0), 0);
      const regulatedCost = configuredCost + tollsChargesCost + derivedCost;
      const totalCost = omieCost + liquidationsCost + regulatedCost;
      const status = incidentCodes.length > 0 ? "WARNING" : "OK";
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
    const powerCosts = await this.buildPowerCostComponents(invoiceTariffCode, periodStart, periodEnd, lines);
    const totalOmie = sumComponents(allComponents, "OMIE_MD");
    const totalLiquidations = LIQUIDATION_COMPONENTS.reduce((sum, component) => sum + sumComponents(allComponents, component), 0);
    const totalConfigured = CONFIGURED_COMPONENTS.reduce((sum, component) => sum + sumComponents(allComponents, component), 0);
    const totalTollsChargesEnergy = sumComponents(allComponents, "TOLLS_CHARGES_ENERGY");
    const totalTollsChargesPower = powerCosts.reduce((sum, item) => sum + (item.costEur ?? 0), 0);
    const totalTollsCharges = totalTollsChargesEnergy + totalTollsChargesPower;
    const totalDerived = DERIVED_COMPONENTS.reduce((sum, component) => sum + sumComponents(allComponents, component), 0);
    const totalRegulated = totalConfigured + totalTollsCharges + totalDerived;
    const incidentsCount = allComponents.filter((item) => item.incidentCode).length + powerCosts.filter((item) => item.incidentCode).length;
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

  private async buildPowerCostComponents(invoiceTariffCode?: string | null, periodStart?: Date | null, periodEnd?: Date | null, lines: InvoiceLineForCosts[] = []): Promise<PowerCostComponentResult[]> {
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
      results.push(...await this.buildPowerCostPeriodSegments(tariffCode, tariffPeriod, contractedPowerKw, start, end));
    }
    return results;
  }

  private async buildPowerCostPeriodSegments(tariffCode: string, tariffPeriod: string, contractedPowerKw: number, start: string, end: string) {
    const rows: PowerCostComponentResult[] = [];
    let current: PowerCostComponentResult | null = null;
    for (const date of enumerateDatesInclusive(start, end)) {
      const source = await this.resolveTollsChargesPowerSource(date, tariffCode, tariffPeriod);
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

  private async resolveTollsChargesPowerSource(date: string, tariffCode: string, tariffPeriod: string): Promise<PowerPriceSource> {
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

  private async buildRegulatedComponents(key: TimeKey, tariffPeriod: string, tariffCode: string | null, bcKwh: number | null, pfKwh: number | null) {
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
    results.push(calculateCostComponent("RETH", "BC", bcKwh, await this.resolveRegulatedSource("RETH", () => this.regulatedPrices!.resolveRethPrice(key.fecha))));
    results.push(calculateCostComponent("EFIH", "PF", pfKwh, await this.resolveRegulatedSource("EFIH", () => this.regulatedPrices!.resolveEfihPrice(key.fecha))));
    results.push(calculateCostComponent("BONO_SOCIAL", "PF", pfKwh, await this.resolveRegulatedSource("BONO_SOCIAL", () => this.regulatedPrices!.resolveSocialBonusPrice(key.fecha))));
    results.push(calculateCostComponent("OTROS", "BC", bcKwh, await this.resolveRegulatedSource("OTROS", () => this.regulatedPrices!.resolveOtherPrice(key.fecha))));
    if (!tariffCode) {
      results.push(unresolved("PC3_CONFIG", "TARIFF_CODE_NOT_RESOLVED", "BC", bcKwh, null));
      results.push(unresolved("TOLLS_CHARGES_ENERGY", "TARIFF_CODE_NOT_RESOLVED", "PF", pfKwh, null));
    } else if (!isTariffPeriod(tariffPeriod)) {
      results.push(unresolved("PC3_CONFIG", "TARIFF_PERIOD_NOT_RESOLVED", "BC", bcKwh, null));
      results.push(unresolved("TOLLS_CHARGES_ENERGY", "TARIFF_PERIOD_NOT_RESOLVED", "PF", pfKwh, null));
    } else {
      results.push(calculateCostComponent("PC3_CONFIG", "BC", bcKwh, await this.resolveRegulatedSource("PC3_CONFIG", () => this.regulatedPrices!.resolvePc3Price(key.fecha, tariffCode, tariffPeriod))));
      results.push(calculateCostComponent("TOLLS_CHARGES_ENERGY", "PF", pfKwh, await this.resolveRegulatedSource("TOLLS_CHARGES_ENERGY", () => this.regulatedPrices!.resolveTollsChargesEnergyPrice(key.fecha, tariffCode, tariffPeriod))));
    }
    return results;
  }

  private async buildImuComponent(key: TimeKey, components: CostComponentResult[]) {
    const source = await this.resolveImuSource(key.fecha);
    if (source.sourceErrorCode) {
      return unresolved("IMU", source.sourceErrorCode, "ECONOMIC_AMOUNT", null, source);
    }
    const baseRows = IMU_BASE_COMPONENTS.map((componentCode) => components.find((item) => item.componentCode === componentCode));
    const missing = baseRows.filter((item) => !item || item.status !== "OK" || item.costEur === null);
    const baseAmountEur = baseRows.reduce((sum, item) => sum + (item?.status === "OK" && item.costEur !== null ? item.costEur : 0), 0);
    if (missing.length > 0) {
      return {
        ...unresolved("IMU", "IMU_BASE_INCOMPLETE", "ECONOMIC_AMOUNT", null, source),
        baseAmountEur,
        percentage: source.percentage ?? null
      };
    }
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

  private async resolveRegulatedSource(componentCode: CostComponent, resolver: () => Promise<any>): Promise<SourcePrice | null> {
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

  private async resolveImuSource(date: string): Promise<SourcePrice> {
    if (!this.regulatedPrices) {
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
        regulatedPriceVersionId: null,
        regulatedPriceVersionName: null,
        sourceValidFrom: null,
        sourceValidTo: null,
        sourceErrorCode: regulatedIncidentCode("IMU", error)
      };
    }
  }

  private async persistCostRun(runId: string, invoiceId: string, result: Awaited<ReturnType<BillingDashboardCostsService["buildCostRun"]>>) {
    await this.prisma.$transaction(async (tx) => {
      if (result.intervalCosts.length > 0) {
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
