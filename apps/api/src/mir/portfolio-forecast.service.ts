import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, ReeKFactorFileType } from "@prisma/client";
import { buildPricingCalendarRange, parseDateOnly } from "../pricing-base/calendar_builder";
import { resolvePricingPeriod } from "../pricing-base/pricing_period_adapter";
import { normalizeTarifa } from "../ree-losses/period-engine";
import { ReeLossesRegulatoryEngine } from "../ree-losses/regulatory-engine.service";
import { PrismaService } from "../prisma/prisma.service";
import { parsePriceListPeriod } from "./entities/mir-contract.entity";
import { buildCurveMonths, toCurveProduct, type MeffForwardCurveMonth } from "../pricing-base/meff_forward_curve_service";
import { PricingHedgesService } from "../pricing-hedges/pricing-hedges.service";
import type { MirContractQuery } from "./interfaces/mir-api.interfaces";
import { buildMirContractWhere } from "./repositories/mir-contract.repository";

type ForecastStatus = "CALCULADO" | "EXPIRADA" | "SIN_PERFIL" | "SIN_PERIODO" | "SIN_CONSUMO" | "TARIFA_NO_SOPORTADA";
type SalePriceStatus = "OK" | "SIN_LISTA_PRECIO" | "LISTA_PRECIO_INVALIDA" | "SIN_PRECIO_PERIODO";
type MeffValuationStatus = "OK" | "SIN_CONSUMO_BC" | "SIN_MEFF";
type PurchaseValuationStatus = MeffValuationStatus | "OK_OMIE";
type ContractRow = Awaited<ReturnType<PortfolioForecastService["loadContracts"]>>[number];
type PeriodContext = Awaited<ReturnType<ReeLossesRegulatoryEngine["buildPeriodContext"]>>;
type BoeLossRow = Awaited<ReturnType<ReeLossesRegulatoryEngine["loadBoeLosses"]>>[number];

const PERIODS = ["P1", "P2", "P3", "P4", "P5", "P6"] as const;
const QUARTER_HOUR_MWH_FACTOR = 0.25;
type PortfolioTariff = "2.0TD" | "3.0TD" | "6.1TD";
type PortfolioProfileSource = "FINAL" | "INTERMEDIATE" | "INITIAL" | "UNIT";
type PortfolioProfileValue = {
  profile20td: number | null;
  profile30td: number | null;
  profile61td: number | null;
};
type HistoricalKEstimate = {
  kFactor: number | null;
  sourceMonth: string | null;
  version: string | null;
  mode: "ESTIMADO_K_HISTORICO" | "BOE_SIN_K";
};
type HistoricalKCurve = {
  byMonth: Map<string, HistoricalKEstimate>;
};
type SalePriceMap = Map<string, number | null>;
type SaleSurchargeMap = Map<string, number | null>;
const SALE_SURCHARGE_TRACE = { mode: "MONTH_TARIFF_TABLE", source: "pricing_portfolio_sale_surcharges" } as const;
type MeffCurve = {
  publicationDate: Date | null;
  months: Map<string, MeffForwardCurveMonth>;
};
type OmieRealMonth = {
  year: number;
  month: number;
  price: number | null;
  amountEur: number | null;
  energyMwh: number | null;
  complete: boolean;
};
type HistoricalKCurveCandidate = {
  yearMonth: string;
  month: number;
  version: string;
  fileType: ReeKFactorFileType;
  values: Map<string, number>;
};
const K_VERSION_PRIORITY = ["C5", "C4", "C3", "C2", "C1"] as const;

@Injectable()
export class PortfolioForecastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regulatoryEngine: ReeLossesRegulatoryEngine,
    private readonly pricingHedgesService: PricingHedgesService
  ) {}

  async recalculatePortfolio(referenceDateText: string, rawPurchasePointingCoefficient: unknown = 1) {
    const referenceDate = parseReferenceDate(referenceDateText);
    const purchasePointingCoefficient = parsePurchasePointingCoefficient(rawPurchasePointingCoefficient);
    const contracts = await this.loadContracts();
    const [periodContext, boeLosses] = await Promise.all([
      this.regulatoryEngine.buildPeriodContext(),
      this.regulatoryEngine.loadBoeLosses()
    ]);
    const forecastWindow = buildForecastWindow(referenceDateText);
    const profileSet = await this.loadPortfolioProfileSet();
    const historicalKCurve = await this.loadHistoricalKCurve();
    const salePrices = await this.loadSalePrices();
    const saleSurcharges = await this.loadSaleSurcharges();
    const forecastMonths = buildForecastMonths(referenceDateText, forecastWindow.end);
    const meffCurve = await this.loadMeffCurve(forecastMonths);
    const omieRealPrices = await this.loadOmieRealMonthlyPrices(forecastMonths);
    const calendar = buildPricingCalendarRange(referenceDateText, forecastWindow.end);
    const profileTotalsByTariff = buildProfileTotalsByTariff(calendar, profileSet);
    const calculatedAt = new Date();
    let calculated = 0;
    let expired = 0;
    let errors = 0;

    for (const contract of contracts) {
      const result = await this.calculateContract(contract, referenceDateText, referenceDate, forecastWindow.end, calendar, profileSet, profileTotalsByTariff, periodContext, boeLosses, historicalKCurve, salePrices, saleSurcharges, meffCurve, omieRealPrices, purchasePointingCoefficient, calculatedAt);
      if (result.status === "CALCULADO") {
        calculated += 1;
      } else if (result.status === "EXPIRADA") {
        expired += 1;
      } else {
        errors += 1;
      }
    }

    return {
      referenceDate: referenceDateText,
      contracts: contracts.length,
      calculated,
      expired,
      errors,
      purchasePointingCoefficient,
      saleSurchargesEurMwh: SALE_SURCHARGE_TRACE,
      calculatedAt: calculatedAt.toISOString()
    };
  }

  async listForecasts(query: Record<string, unknown> = {}) {
    const skip = parseBoundedInteger(query.skip, 0, 0, 1_000_000);
    const take = parseBoundedInteger(query.take, 100, 1, 1000);
    const where: Prisma.PricingPortfolioForecastWhereInput = {
      ...(typeof query.referenceDate === "string" && query.referenceDate ? { referenceDate: parseReferenceDate(query.referenceDate) } : {}),
      ...(typeof query.status === "string" && query.status ? { status: query.status } : {})
    };
    const [rows, total] = await Promise.all([
      this.prisma.pricingPortfolioForecast.findMany({
        where,
        include: { contract: true },
        orderBy: [{ calculatedAt: "desc" }, { contract: { policyCode: "asc" } }],
        skip,
        take
      }),
      this.prisma.pricingPortfolioForecast.count({ where })
    ]);

    return {
      rows: rows.map((row) => ({
        id: row.id,
        contractId: row.contractId,
        policyCode: row.contract.policyCode,
        commercialName: row.contract.commercialName,
        tariffName: row.contract.tariffName,
        priceListName: row.contract.priceListName,
        estimatedSaleAmount: decimalToNumber(row.estimatedSaleAmount),
        estimatedSaleAmountBc: decimalToNumber(row.estimatedSaleAmountBc),
        estimatedMeffSaleAmount: decimalToNumber(row.estimatedMeffSaleAmount),
        saleSurchargesEurMwh: row.saleSurchargesJson,
        salePriceStatus: row.salePriceStatus,
        meffValuationStatus: row.meffValuationStatus,
        referenceDate: row.referenceDate.toISOString().slice(0, 10),
        calculatedUntil: row.calculatedUntil?.toISOString().slice(0, 10) ?? null,
        estimatedConsumption: decimalToNumber(row.estimatedConsumption),
        calculatedAt: row.calculatedAt.toISOString(),
        status: row.status
      })),
      total,
      hasNext: skip + rows.length < total,
      skip,
      take
    };
  }

  async getMonthlyConsumption(contractId: string, referenceDateText?: string) {
    const referenceDate = referenceDateText ? parseReferenceDate(referenceDateText) : undefined;
    const rows = await this.prisma.pricingPortfolioMonthlyConsumption.findMany({
      where: { contractId, ...(referenceDate ? { referenceDate } : {}) },
      orderBy: [{ year: "asc" }, { month: "asc" }, { tariffPeriod: "asc" }]
    });
    return {
      contractId,
      referenceDate: referenceDate?.toISOString().slice(0, 10) ?? null,
      rows: rows.map((row) => ({
        id: row.id,
        referenceDate: row.referenceDate.toISOString().slice(0, 10),
        year: row.year,
        month: row.month,
        tariffPeriod: row.tariffPeriod,
        consumptionKwh: decimalToNumber(row.consumptionKwh),
        elevatedConsumptionKwh: decimalToNumber(row.elevatedConsumptionKwh),
        lossesKwh: decimalToNumber(row.lossesKwh),
        lossPercentage: decimalToNumber(row.lossPercentage),
        lossVersion: row.lossVersion,
        lossMode: row.lossMode,
        boeLossPercentage: decimalToNumber(row.boeLossPercentage),
        kFactor: decimalToNumber(row.kFactor),
        kFactorVersion: row.kFactorVersion,
        kFactorSourceMonth: row.kFactorSourceMonth,
        salePriceYear: row.salePriceYear,
        salePriceMonth: row.salePriceMonth,
        salePriceEurMwh: decimalToNumber(row.salePriceEurMwh),
        saleSurchargeEurMwh: decimalToNumber(row.saleSurchargeEurMwh),
        appliedSalePriceEurMwh: decimalToNumber(row.appliedSalePriceEurMwh),
        estimatedSaleAmountEur: decimalToNumber(row.estimatedSaleAmountEur),
        estimatedSaleAmountBcEur: decimalToNumber(row.estimatedSaleAmountBcEur),
        salePriceStatus: row.salePriceStatus,
        profileWeight: decimalToNumber(row.profileWeight),
        intervals: row.intervals,
        createdAt: row.createdAt.toISOString()
      }))
    };
  }

  async getMonthlyValuation(contractId: string, referenceDateText?: string) {
    const referenceDate = referenceDateText ? parseReferenceDate(referenceDateText) : undefined;
    const rows = await this.prisma.pricingPortfolioMonthlyValuation.findMany({
      where: { contractId, ...(referenceDate ? { referenceDate } : {}) },
      orderBy: [{ year: "asc" }, { month: "asc" }]
    });
    return {
      contractId,
      referenceDate: referenceDate?.toISOString().slice(0, 10) ?? null,
      rows: rows.map((row) => ({
        id: row.id,
        referenceDate: row.referenceDate.toISOString().slice(0, 10),
        year: row.year,
        month: row.month,
        consumptionBcKwh: decimalToNumber(row.consumptionBcKwh),
        meffPriceEurMwh: decimalToNumber(row.meffPriceEurMwh),
        estimatedMeffSaleEur: decimalToNumber(row.estimatedMeffSaleEur),
        meffPublicationDate: row.meffPublicationDate?.toISOString().slice(0, 10) ?? null,
        meffProductCode: row.meffProductCode,
        meffPriceOrigin: row.meffPriceOrigin,
        status: row.status,
        createdAt: row.createdAt.toISOString()
      }))
    };
  }

  async getMonthlySummary(referenceDateText: string, filters: MirContractQuery = {}) {
    const referenceDate = parseReferenceDate(referenceDateText);
    const forecastWindow = buildForecastWindow(referenceDateText);
    const forecastMonths = buildForecastMonths(referenceDateText, forecastWindow.end);
    const contractWhere = buildMirContractWhere(filters);
    const contractFilter = Object.keys(contractWhere).length > 0 ? { contract: contractWhere } : {};
    const rows = await this.prisma.pricingPortfolioMonthlyConsumption.groupBy({
      by: ["year", "month"],
      where: { referenceDate, ...contractFilter },
      _sum: { consumptionKwh: true, elevatedConsumptionKwh: true, lossesKwh: true, estimatedSaleAmountEur: true, estimatedSaleAmountBcEur: true },
      _count: { _all: true },
      orderBy: [{ year: "asc" }, { month: "asc" }]
    });
    const [valuationRows, hedgeResults] = await Promise.all([
      this.prisma.pricingPortfolioMonthlyValuation.groupBy({
        by: ["year", "month"],
        where: { referenceDate, ...contractFilter },
        _sum: { estimatedMeffSaleEur: true },
        _avg: { meffPriceEurMwh: true },
        _count: { _all: true },
        orderBy: [{ year: "asc" }, { month: "asc" }]
      }),
      Promise.all([...new Set(forecastMonths.map((month) => month.year))].map((year) => this.pricingHedgesService.monthlyValues(year)))
    ]);
    const hedgeValuesByKey = new Map<string, { resultadoTotal: number; mwhNetos: number }>();
    for (const [index, year] of [...new Set(forecastMonths.map((month) => month.year))].entries()) {
      const yearResults = hedgeResults[index];
      for (const [month, value] of yearResults.entries()) {
        hedgeValuesByKey.set(monthKey(year, month), value);
      }
    }
    const valuesByKey = new Map(rows.map((row) => [`${row.year}-${row.month}`, row]));
    const valuationByKey = new Map(valuationRows.map((row) => [`${row.year}-${row.month}`, row]));
    const months = forecastMonths.map((month) => {
      const row = valuesByKey.get(`${month.year}-${month.month}`);
      const valuation = valuationByKey.get(`${month.year}-${month.month}`);
      const hedgeValues = hedgeValuesByKey.get(monthKey(month.year, month.month));
      const values = {
        year: month.year,
        month: month.month,
        label: `${pad(month.month)}/${month.year}`,
        consumptionKwh: decimalToNumber(row?._sum.consumptionKwh) ?? 0,
        elevatedConsumptionKwh: decimalToNumber(row?._sum.elevatedConsumptionKwh) ?? 0,
        lossesKwh: decimalToNumber(row?._sum.lossesKwh) ?? 0,
        estimatedSaleAmountEur: decimalToNumber(row?._sum.estimatedSaleAmountEur) ?? 0,
        estimatedSaleAmountBcEur: decimalToNumber(row?._sum.estimatedSaleAmountBcEur) ?? 0,
        estimatedMeffSaleEur: decimalToNumber(valuation?._sum.estimatedMeffSaleEur) ?? 0,
        hedgeResultEur: hedgeValues?.resultadoTotal ?? 0,
        hedgeNetMwh: hedgeValues?.mwhNetos ?? 0,
        averageMeffPriceEurMwh: null as number | null,
        meffSpreadEur: 0,
        meffSpreadWithHedgesEur: 0,
        meffSpreadWithHedgesEurMwh: null as number | null,
        meffSpreadEurMwh: null as number | null,
        rows: row?._count._all ?? 0
      };
      const meffSpreadEur = values.estimatedSaleAmountBcEur - values.estimatedMeffSaleEur;
      const meffSpreadWithHedgesEur = values.estimatedSaleAmountBcEur - values.estimatedMeffSaleEur + values.hedgeResultEur;
      return {
        ...values,
        meffSpreadEur,
        meffSpreadWithHedgesEur,
        meffSpreadEurMwh: values.elevatedConsumptionKwh > 0
          ? meffSpreadEur / (values.elevatedConsumptionKwh / 1000)
          : null,
        meffSpreadWithHedgesEurMwh: values.elevatedConsumptionKwh > 0
          ? meffSpreadWithHedgesEur / (values.elevatedConsumptionKwh / 1000)
          : null,
        averageMeffPriceEurMwh: values.elevatedConsumptionKwh > 0 && values.estimatedMeffSaleEur > 0
          ? values.estimatedMeffSaleEur / (values.elevatedConsumptionKwh / 1000)
          : decimalToNumber(valuation?._avg.meffPriceEurMwh),
        averageSalePriceEurMwh: values.consumptionKwh > 0 && values.estimatedSaleAmountEur > 0
          ? values.estimatedSaleAmountEur / (values.consumptionKwh / 1000)
          : null
      };
    });
    const totalConsumptionKwh = months.reduce((sum, row) => sum + row.consumptionKwh, 0);
    const totalElevatedConsumptionKwh = months.reduce((sum, row) => sum + row.elevatedConsumptionKwh, 0);
    const totalEstimatedSaleAmountEur = months.reduce((sum, row) => sum + row.estimatedSaleAmountEur, 0);
    const totalEstimatedSaleAmountBcEur = months.reduce((sum, row) => sum + row.estimatedSaleAmountBcEur, 0);
    const totalEstimatedMeffSaleEur = months.reduce((sum, row) => sum + row.estimatedMeffSaleEur, 0);
    const totalHedgeResultEur = months.reduce((sum, row) => sum + row.hedgeResultEur, 0);
    const totalHedgeNetMwh = months.reduce((sum, row) => sum + row.hedgeNetMwh, 0);
    const totalMeffSpreadEur = totalEstimatedSaleAmountBcEur - totalEstimatedMeffSaleEur;
    const totalMeffSpreadWithHedgesEur = totalMeffSpreadEur + totalHedgeResultEur;
    return {
      referenceDate: referenceDateText,
      fechaDesde: referenceDateText,
      fechaHasta: forecastWindow.end,
      totalConsumptionKwh,
      totalElevatedConsumptionKwh,
      totalLossesKwh: months.reduce((sum, row) => sum + row.lossesKwh, 0),
      totalEstimatedSaleAmountEur,
      totalEstimatedSaleAmountBcEur,
      totalEstimatedMeffSaleEur,
      totalHedgeResultEur,
      totalHedgeNetMwh,
      totalMeffSpreadEur,
      totalMeffSpreadWithHedgesEur,
      totalMeffSpreadEurMwh: totalElevatedConsumptionKwh > 0
        ? totalMeffSpreadEur / (totalElevatedConsumptionKwh / 1000)
        : null,
      totalMeffSpreadWithHedgesEurMwh: totalElevatedConsumptionKwh > 0
        ? totalMeffSpreadWithHedgesEur / (totalElevatedConsumptionKwh / 1000)
        : null,
      averageMeffPriceEurMwh: totalElevatedConsumptionKwh > 0 && totalEstimatedMeffSaleEur > 0
        ? totalEstimatedMeffSaleEur / (totalElevatedConsumptionKwh / 1000)
        : null,
      averageSalePriceEurMwh: totalConsumptionKwh > 0 && totalEstimatedSaleAmountEur > 0
        ? totalEstimatedSaleAmountEur / (totalConsumptionKwh / 1000)
        : null,
      months
    };
  }

  private loadContracts() {
    return this.prisma.mirContract.findMany({
      orderBy: [{ policyCode: "asc" }],
      select: {
        id: true,
        policyCode: true,
        tariffName: true,
        priceListName: true,
        annualConsumption: true,
        contractEndDate: true
      }
    });
  }

  private async calculateContract(
    contract: ContractRow,
    referenceDateText: string,
    referenceDate: Date,
    forecastEndDateText: string,
    calendar: ReturnType<typeof buildPricingCalendarRange>,
    profileSet: Awaited<ReturnType<PortfolioForecastService["loadPortfolioProfileSet"]>>,
    profileTotalsByTariff: Map<PortfolioTariff, number | null>,
    periodContext: PeriodContext,
    boeLosses: BoeLossRow[],
    historicalKCurve: HistoricalKCurve,
    salePrices: SalePriceMap,
    saleSurcharges: SaleSurchargeMap,
    meffCurve: MeffCurve,
    omieRealPrices: Map<string, OmieRealMonth>,
    purchasePointingCoefficient: number,
    calculatedAt: Date
  ) {
    const annualConsumption = decimalToNumber(contract.annualConsumption);
    const endDateText = contract.contractEndDate?.toISOString().slice(0, 10) ?? null;
    const tariff = normalizePortfolioTariff(contract.tariffName);

    if (!endDateText || contract.contractEndDate!.getTime() < referenceDate.getTime()) {
      return this.saveForecastOnly(contract.id, referenceDate, contract.contractEndDate, 0, calculatedAt, "EXPIRADA");
    }
    if (!tariff) {
      return this.saveForecastOnly(contract.id, referenceDate, contract.contractEndDate, 0, calculatedAt, "TARIFA_NO_SOPORTADA");
    }
    if (annualConsumption === null || annualConsumption < 0) {
      return this.saveForecastOnly(contract.id, referenceDate, contract.contractEndDate, 0, calculatedAt, "SIN_CONSUMO");
    }

    const activeEndDateText = minDateText(endDateText, forecastEndDateText);
    const hourly = this.profileContract(contract, tariff, annualConsumption, calendar, referenceDateText, activeEndDateText, profileSet, profileTotalsByTariff, periodContext, boeLosses, historicalKCurve);
    if (hourly.status !== "CALCULADO") {
      return this.saveForecastOnly(contract.id, referenceDate, contract.contractEndDate, 0, calculatedAt, hourly.status);
    }
    const monthlyRows = this.valueMonthlyRows(this.aggregateMonthly(contract.id, referenceDate, hourly.rows, annualConsumption), contract, tariff, salePrices, saleSurcharges);
    const estimatedConsumption = monthlyRows.reduce((sum, row) => sum + row.consumptionKwh, 0);
    const estimatedSaleAmount = monthlyRows.reduce((sum, row) => sum + (row.estimatedSaleAmountEur ?? 0), 0);
    const estimatedSaleAmountBc = monthlyRows.reduce((sum, row) => sum + (row.estimatedSaleAmountBcEur ?? 0), 0);
    const salePriceStatus = summarizeSalePriceStatus(monthlyRows.map((row) => row.salePriceStatus));
    const meffRows = this.valueMeffMonthlyRows(contract.id, referenceDate, monthlyRows, meffCurve, omieRealPrices, purchasePointingCoefficient);
    const estimatedMeffSaleAmount = meffRows.reduce((sum, row) => sum + (row.estimatedMeffSaleEur ?? 0), 0);
    const meffValuationStatus = summarizeMeffValuationStatus(meffRows.map((row) => row.status));
    await this.persistForecast(contract.id, referenceDate, parseReferenceDate(activeEndDateText), estimatedConsumption, estimatedSaleAmount, estimatedSaleAmountBc, estimatedMeffSaleAmount, salePriceStatus, meffValuationStatus, calculatedAt, "CALCULADO", monthlyRows, meffRows);
    return { status: "CALCULADO" as const };
  }

  private async loadSalePrices(): Promise<SalePriceMap> {
    const rows = await this.prisma.pricingPortfolioSalePrice.findMany({
      select: { year: true, month: true, tariff: true, period: true, priceEurMwh: true }
    });
    return new Map(rows.map((row) => [salePriceKey(row.year, row.month, normalizePortfolioTariff(row.tariff) ?? row.tariff, row.period), decimalToNumber(row.priceEurMwh)]));
  }

  private async loadSaleSurcharges(): Promise<SaleSurchargeMap> {
    const rows = await this.prisma.pricingPortfolioSaleSurcharge.findMany({
      select: { year: true, month: true, tariff: true, surchargeEurMwh: true }
    });
    return new Map(rows.map((row) => [saleSurchargeKey(row.year, row.month, normalizePortfolioTariff(row.tariff) ?? row.tariff), decimalToNumber(row.surchargeEurMwh)]));
  }

  private async loadMeffCurve(targetMonths: Array<{ year: number; month: number }>): Promise<MeffCurve> {
    const latest = await this.prisma.pricingMeffPrice.findFirst({
      orderBy: { fechaPublicacion: "desc" },
      select: { fechaPublicacion: true }
    });
    if (!latest) {
      return { publicationDate: null, months: new Map(targetMonths.map((month) => [monthKey(month.year, month.month), emptyMeffMonth(month.year, month.month)])) };
    }
    const rows = await this.prisma.pricingMeffPrice.findMany({
      where: { fechaPublicacion: latest.fechaPublicacion },
      select: { cod: true, tipo: true, clase: true, periodo: true, entrega: true, precio: true }
    });
    const products = rows.map((row) => toCurveProduct(row)).filter((product): product is NonNullable<ReturnType<typeof toCurveProduct>> => Boolean(product));
    return {
      publicationDate: latest.fechaPublicacion,
      months: new Map(buildCurveMonths(targetMonths, products).map((month) => [month.key, month]))
    };
  }

  private async loadOmieRealMonthlyPrices(targetMonths: Array<{ year: number; month: number }>): Promise<Map<string, OmieRealMonth>> {
    if (targetMonths.length === 0) {
      return new Map();
    }
    const start = new Date(Date.UTC(targetMonths[0].year, targetMonths[0].month - 1, 1));
    const last = targetMonths[targetMonths.length - 1];
    const end = new Date(Date.UTC(last.year, last.month, 1));
    end.setUTCMonth(end.getUTCMonth() + 1);

    const [programRows, priceRows, transactionRows, reerRows] = await Promise.all([
      this.prisma.omiePrograma.findMany({
        where: {
          fechaPrograma: { gte: start, lt: end },
          version: 1,
          uOfertante: "STROC01",
          OR: [
            { tipoPrograma: "PVD", sesion: null },
            { tipoPrograma: "PHF", sesion: { in: ["01", "02", "03"] } }
          ]
        },
        select: { tipoPrograma: true, fechaPrograma: true, sesion: true, periodo: true, energiaMWh: true }
      }),
      this.prisma.omiePrice.findMany({
        where: {
          fechaPrograma: { gte: start, lt: end },
          OR: [
            { tipoPrecio: "MD", sesion: null },
            { tipoPrecio: "MI", sesion: { in: ["01", "02", "03"] } }
          ]
        },
        select: { tipoPrecio: true, fechaPrograma: true, sesion: true, periodo: true, precioEurMWh: true }
      }),
      this.prisma.omieTransactionStaging.findMany({
        where: {
          diaContrato: { gte: start, lt: end },
          download: {
            codigoConsulta: "4121",
            estado: "PROCESADO"
          }
        },
        select: { diaContrato: true, rawPayloadJson: true }
      }),
      this.prisma.omieReerOfficialAnnotation.findMany({
        where: {
          fecha: { gte: start, lt: end },
          periodo: { gt: 0 },
          codigoDocumento: "9230",
          estado: "PROCESADO",
          agente: "STROM"
        },
        select: { fecha: true, version: true, eopreerEur: true, sImp: true }
      })
    ]);

    const programs = new Map<string, number>();
    for (const row of programRows) {
      const market = row.tipoPrograma === "PVD" && row.sesion === null ? "MD" : row.tipoPrograma === "PHF" && row.sesion ? `IDA${Number(row.sesion)}` : null;
      if (market !== "MD" && market !== "IDA1" && market !== "IDA2" && market !== "IDA3") {
        continue;
      }
      const value = decimalToNumber(row.energiaMWh) ?? 0;
      programs.set(buildOmiePortfolioKey(formatDateOnly(row.fechaPrograma), row.periodo, market), market === "MD" ? value : -value);
    }

    const prices = new Map<string, number>();
    for (const row of priceRows) {
      const market = row.tipoPrecio === "MD" && row.sesion === null ? "MD" : row.tipoPrecio === "MI" && row.sesion ? `IDA${Number(row.sesion)}` : null;
      if (market !== "MD" && market !== "IDA1" && market !== "IDA2" && market !== "IDA3") {
        continue;
      }
      prices.set(buildOmiePortfolioKey(formatDateOnly(row.fechaPrograma), row.periodo, market), decimalToNumber(row.precioEurMWh) ?? 0);
    }

    const xbid = buildPortfolioXbidTransactionMap(transactionRows);

    const latestReerVersionByDate = new Map<string, number>();
    for (const row of reerRows) {
      const dateKey = formatDateOnly(row.fecha);
      latestReerVersionByDate.set(dateKey, Math.max(latestReerVersionByDate.get(dateKey) ?? row.version, row.version));
    }
    const reerByMonth = new Map<string, number>();
    for (const row of reerRows) {
      const dateKey = formatDateOnly(row.fecha);
      if (row.version !== latestReerVersionByDate.get(dateKey)) {
        continue;
      }
      const key = monthKey(row.fecha.getUTCFullYear(), row.fecha.getUTCMonth() + 1);
      reerByMonth.set(key, (reerByMonth.get(key) ?? 0) + (decimalToNumber(row.eopreerEur) ?? 0) * officialSign(row.sImp));
    }

    const dayCoverage = new Map<string, Set<string>>();
    const buckets = new Map<string, { amountEur: number; energyMwh: number; days: Set<string> }>();
    for (const [key, programMd] of programs.entries()) {
      if (!key.endsWith("|MD")) {
        continue;
      }
      const [fecha, rawPeriodo] = key.split("|");
      const periodo = Number(rawPeriodo);
      const priceMd = prices.get(buildOmiePortfolioKey(fecha, periodo, "MD"));
      if (priceMd === undefined) {
        continue;
      }
      const programaIda1 = programs.get(buildOmiePortfolioKey(fecha, periodo, "IDA1")) ?? null;
      const programaIda2 = programs.get(buildOmiePortfolioKey(fecha, periodo, "IDA2")) ?? null;
      const programaIda3 = programs.get(buildOmiePortfolioKey(fecha, periodo, "IDA3")) ?? null;
      const volIda1 = nullableDiff(programaIda1, programMd);
      const volIda2 = nullableDiff(programaIda2, programaIda1);
      const volIda3 = nullableDiff(programaIda3, programaIda2);
      const xbidValue = xbid.get(buildOmiePortfolioKey(fecha, periodo, "XBID"));
      const energyMwh = nullableSum([programMd, volIda1, volIda2, volIda3, xbidValue?.volXbid ?? null]);
      const amountEur = nullableSum([
        nullableMultiply(programMd, priceMd),
        nullableMultiply(volIda1, prices.get(buildOmiePortfolioKey(fecha, periodo, "IDA1")) ?? null),
        nullableMultiply(volIda2, prices.get(buildOmiePortfolioKey(fecha, periodo, "IDA2")) ?? null),
        nullableMultiply(volIda3, prices.get(buildOmiePortfolioKey(fecha, periodo, "IDA3")) ?? null),
        nullableMultiply(xbidValue?.volXbid ?? null, xbidValue?.precioXbid ?? null)
      ]);
      if (energyMwh === null || amountEur === null) {
        continue;
      }
      const keyMonth = fecha.slice(0, 7);
      const bucket = buckets.get(keyMonth) ?? { amountEur: 0, energyMwh: 0, days: new Set<string>() };
      bucket.amountEur += amountEur;
      bucket.energyMwh += energyMwh;
      bucket.days.add(fecha);
      buckets.set(keyMonth, bucket);
      const coverage = dayCoverage.get(keyMonth) ?? new Set<string>();
      coverage.add(fecha);
      dayCoverage.set(keyMonth, coverage);
    }

    const result = new Map<string, OmieRealMonth>();
    for (const month of targetMonths) {
      const key = monthKey(month.year, month.month);
      const bucket = buckets.get(key);
      const expectedDays = daysInUtcMonth(month.year, month.month);
      const complete = (dayCoverage.get(key)?.size ?? 0) === expectedDays && !!bucket && Math.abs(bucket.energyMwh) > 0;
      const amountEur = bucket ? bucket.amountEur + (reerByMonth.get(key) ?? 0) : null;
      const price = complete && amountEur !== null && bucket ? amountEur / bucket.energyMwh : null;
      result.set(key, {
        year: month.year,
        month: month.month,
        price,
        amountEur,
        energyMwh: bucket?.energyMwh ?? null,
        complete
      });
    }
    return result;
  }

  private async loadPortfolioProfileSet() {
    const finalYear = await this.findLatestFinalProfileYear();
    if (finalYear !== null) {
      return {
        source: "FINAL" as const,
        year: finalYear,
        profiles: await this.loadFinalProfiles(finalYear)
      };
    }
    const intermediateYear = await this.findLatestIntermediateProfileYear();
    if (intermediateYear !== null) {
      return {
        source: "INTERMEDIATE" as const,
        year: intermediateYear,
        profiles: await this.loadIntermediateProfiles(intermediateYear)
      };
    }
    const initialYear = await this.findLatestInitialProfileYear();
    if (initialYear !== null) {
      return {
        source: "INITIAL" as const,
        year: initialYear,
        profiles: await this.loadInitialProfiles(initialYear)
      };
    }
    return {
      source: "UNIT" as const,
      year: getYearFromDateText(new Date().toISOString().slice(0, 10)),
      profiles: new Map<string, PortfolioProfileValue>()
    };
  }

  private async findLatestFinalProfileYear() {
    const rows = await this.prisma.esiosReeFinalProfile.groupBy({
      by: ["year"],
      _count: { _all: true },
      orderBy: { year: "desc" }
    });
    return rows.find((row) => row._count._all >= 8700)?.year ?? null;
  }

  private async findLatestIntermediateProfileYear() {
    const result = await this.prisma.esiosProfileIntermediateResult.aggregate({ _max: { year: true } });
    return result._max.year ?? null;
  }

  private async findLatestInitialProfileYear() {
    const result = await this.prisma.esiosInitialProfile.aggregate({ _max: { year: true } });
    return result._max.year ?? null;
  }

  private async loadFinalProfiles(year: number) {
    const rows = await this.prisma.esiosReeFinalProfile.findMany({
      where: { year },
      select: { month: true, day: true, hour: true, profile20td: true, profile30td: true, profile30tdve: true }
    });
    const profiles = new Map<string, PortfolioProfileValue>();
    for (const row of rows) {
      profiles.set(profileKey(row.month, row.day, row.hour), {
        profile20td: decimalToNumber(row.profile20td),
        profile30td: decimalToNumber(row.profile30td),
        profile61td: null
      });
    }
    return profiles;
  }

  private async loadIntermediateProfiles(year: number) {
    const rows = await this.prisma.esiosProfileIntermediateResult.findMany({
      where: { year, tariff: { in: ["2.0TD", "3.0TD"] } },
      select: { month: true, day: true, hour: true, tariff: true, intermediateProfile: true }
    });
    const profiles = new Map<string, PortfolioProfileValue>();
    for (const row of rows) {
      const key = profileKey(row.month, row.day, row.hour);
      const current = profiles.get(key) ?? emptyPortfolioProfileValue();
      if (row.tariff === "2.0TD") {
        current.profile20td = decimalToNumber(row.intermediateProfile);
      }
      if (row.tariff === "3.0TD") {
        current.profile30td = decimalToNumber(row.intermediateProfile);
      }
      profiles.set(key, current);
    }
    return profiles;
  }

  private async loadInitialProfiles(year: number) {
    const rows = await this.prisma.esiosInitialProfile.findMany({
      where: { year },
      select: { month: true, day: true, hour: true, profile20td: true, profile30td: true, profile30tdve: true }
    });
    const profiles = new Map<string, PortfolioProfileValue>();
    for (const row of rows) {
      profiles.set(profileKey(row.month, row.day, row.hour), {
        profile20td: decimalToNumber(row.profile20td),
        profile30td: decimalToNumber(row.profile30td),
        profile61td: null
      });
    }
    return profiles;
  }

  private async loadHistoricalKCurve(): Promise<HistoricalKCurve> {
    const latest = await this.prisma.reeKFactor.aggregate({
      where: { version: { in: [...K_VERSION_PRIORITY] } },
      _max: { fecha: true }
    });
    if (!latest._max.fecha) {
      return { byMonth: new Map() };
    }
    const latestMonth = startOfUtcMonth(latest._max.fecha);
    const start = addUtcMonths(latestMonth, -11);
    const endExclusive = addUtcMonths(latestMonth, 1);
    const rows = await this.prisma.reeKFactor.findMany({
      where: {
        fecha: { gte: start, lt: endExclusive },
        version: { in: [...K_VERSION_PRIORITY] }
      },
      select: {
        fecha: true,
        tarifa: true,
        periodo: true,
        version: true,
        tipoArchivo: true,
        valorK: true
      }
    });
    return buildHistoricalKCurve(rows);
  }

  private profileContract(
    contract: ContractRow,
    tariff: PortfolioTariff,
    annualConsumption: number,
    calendar: ReturnType<typeof buildPricingCalendarRange>,
    activeStartDateText: string,
    activeEndDateText: string,
    profileSet: Awaited<ReturnType<PortfolioForecastService["loadPortfolioProfileSet"]>>,
    profileTotalsByTariff: Map<PortfolioTariff, number | null>,
    periodContext: PeriodContext,
    boeLosses: BoeLossRow[],
    historicalKCurve: HistoricalKCurve
  ): { status: ForecastStatus; rows: Array<{ year: number; month: number; period: string; weight: number; consumption: number; elevatedConsumption: number; losses: number; lossPercentage: number | null; lossVersion: string | null; lossMode: string | null; boeLossPercentage: number | null; kFactor: number | null; kFactorVersion: string | null; kFactorSourceMonth: string | null }> } {
    const totalWeight = profileTotalsByTariff.get(tariff) ?? null;
    if (totalWeight === null || totalWeight <= 0) {
      return { status: "SIN_PERFIL", rows: [] };
    }
    const profileRows = calendar.filter((row) => row.fecha >= activeStartDateText && row.fecha <= activeEndDateText).map((row) => {
      const weight = selectPortfolioProfileWeight(row.fecha.slice(5), row.ordenHora, tariff, profileSet);
      const period = resolvePricingPeriod(tariff, row, periodContext);
      const boeLoss = period ? findPortfolioBoeLoss(boeLosses, tariff, period, row.fecha) : null;
      const kEstimate = period ? estimateHistoricalK(historicalKCurve, row.mes, tariff, period) : noHistoricalK();
      return { row, weight, period, boeLoss, kEstimate };
    });
    if (profileRows.some((item) => item.weight === null)) {
      return { status: "SIN_PERFIL", rows: [] };
    }
    if (profileRows.some((item) => !item.period || !PERIODS.includes(item.period as (typeof PERIODS)[number]))) {
      return { status: "SIN_PERIODO", rows: [] };
    }
    return {
      status: "CALCULADO",
      rows: profileRows.map((item) => {
        const normalizedWeight = (item.weight ?? 0) / totalWeight;
        const consumption = normalizedWeight * annualConsumption;
        const boeLossPercentage = item.boeLoss ? decimalToNumber(item.boeLoss.porcentajePerdida) : null;
        const lossPercentage = boeLossPercentage === null ? null : item.kEstimate.kFactor === null ? boeLossPercentage : boeLossPercentage * item.kEstimate.kFactor;
        const lossRate = lossPercentage === null ? null : lossPercentage / 100;
        const elevatedConsumption = lossRate === null ? consumption : consumption * (1 + lossRate);
        return {
          year: item.row.ano,
          month: item.row.mes,
          period: item.period,
          weight: normalizedWeight,
          consumption,
          elevatedConsumption,
          losses: elevatedConsumption - consumption,
          lossPercentage,
          lossVersion: item.kEstimate.version ?? item.boeLoss?.versionBoe ?? null,
          lossMode: item.kEstimate.mode,
          boeLossPercentage,
          kFactor: item.kEstimate.kFactor,
          kFactorVersion: item.kEstimate.version,
          kFactorSourceMonth: item.kEstimate.sourceMonth
        };
      })
    };
  }

  private aggregateMonthly(
    contractId: string,
    referenceDate: Date,
    rows: Array<{ year: number; month: number; period: string; weight: number; consumption: number; elevatedConsumption: number; losses: number; lossPercentage: number | null; lossVersion: string | null; lossMode: string | null; boeLossPercentage: number | null; kFactor: number | null; kFactorVersion: string | null; kFactorSourceMonth: string | null }>,
    annualConsumption: number
  ) {
    const byKey = new Map<string, { contractId: string; referenceDate: Date; year: number; month: number; tariffPeriod: string; consumptionKwh: number; elevatedConsumptionKwh: number; lossesKwh: number; profileWeight: number; lossWeightedSum: number; boeLossWeightedSum: number; kFactorWeightedSum: number; lossWeight: number; kFactorWeight: number; lossVersions: Set<string>; lossModes: Set<string>; kFactorVersions: Set<string>; kFactorSourceMonths: Set<string>; intervals: number }>();
    for (const row of rows) {
      if (row.consumption < -0.000001) {
        throw new BadRequestException("Consumo previsto negativo detectado.");
      }
      const key = `${row.year}|${row.month}|${row.period}`;
      const current = byKey.get(key) ?? { contractId, referenceDate, year: row.year, month: row.month, tariffPeriod: row.period, consumptionKwh: 0, elevatedConsumptionKwh: 0, lossesKwh: 0, profileWeight: 0, lossWeightedSum: 0, boeLossWeightedSum: 0, kFactorWeightedSum: 0, lossWeight: 0, kFactorWeight: 0, lossVersions: new Set<string>(), lossModes: new Set<string>(), kFactorVersions: new Set<string>(), kFactorSourceMonths: new Set<string>(), intervals: 0 };
      current.consumptionKwh += row.consumption;
      current.elevatedConsumptionKwh += row.elevatedConsumption;
      current.lossesKwh += row.losses;
      current.profileWeight += row.weight;
      if (row.lossPercentage !== null) {
        current.lossWeightedSum += row.lossPercentage * row.consumption;
        current.lossWeight += row.consumption;
      }
      if (row.boeLossPercentage !== null) {
        current.boeLossWeightedSum += row.boeLossPercentage * row.consumption;
      }
      if (row.kFactor !== null) {
        current.kFactorWeightedSum += row.kFactor * row.consumption;
        current.kFactorWeight += row.consumption;
      }
      if (row.lossVersion) {
        current.lossVersions.add(row.lossVersion);
      }
      if (row.lossMode) {
        current.lossModes.add(row.lossMode);
      }
      if (row.kFactorVersion) {
        current.kFactorVersions.add(row.kFactorVersion);
      }
      if (row.kFactorSourceMonth) {
        current.kFactorSourceMonths.add(row.kFactorSourceMonth);
      }
      current.intervals += 1;
      byKey.set(key, current);
    }
    return [...byKey.values()]
      .map((row) => ({
        contractId: row.contractId,
        referenceDate: row.referenceDate,
        year: row.year,
        month: row.month,
        tariffPeriod: row.tariffPeriod,
        consumptionKwh: row.consumptionKwh,
        elevatedConsumptionKwh: row.elevatedConsumptionKwh,
        lossesKwh: row.lossesKwh,
        lossPercentage: row.lossWeight > 0 ? row.lossWeightedSum / row.lossWeight : null,
        boeLossPercentage: row.lossWeight > 0 ? row.boeLossWeightedSum / row.lossWeight : null,
        kFactor: row.kFactorWeight > 0 ? row.kFactorWeightedSum / row.kFactorWeight : null,
        lossVersion: [...row.lossVersions].sort().join(", ") || null,
        lossMode: [...row.lossModes].sort().join(", ") || null,
        kFactorVersion: [...row.kFactorVersions].sort().join(", ") || null,
        kFactorSourceMonth: [...row.kFactorSourceMonths].sort().join(", ") || null,
        profileWeight: row.profileWeight,
        intervals: row.intervals
      }))
      .sort((left, right) => left.year - right.year || left.month - right.month || left.tariffPeriod.localeCompare(right.tariffPeriod));
  }

  private valueMonthlyRows(
    rows: Array<{ contractId: string; referenceDate: Date; year: number; month: number; tariffPeriod: string; consumptionKwh: number; elevatedConsumptionKwh: number; lossesKwh: number; lossPercentage: number | null; lossVersion: string | null; lossMode: string | null; boeLossPercentage: number | null; kFactor: number | null; kFactorVersion: string | null; kFactorSourceMonth: string | null; profileWeight: number; intervals: number }>,
    contract: ContractRow,
    tariff: PortfolioTariff,
    salePrices: SalePriceMap,
    saleSurcharges: SaleSurchargeMap
  ) {
    const period = parsePriceListPeriod(contract.priceListName);
    const baseStatus: SalePriceStatus | null = !contract.priceListName ? "SIN_LISTA_PRECIO" : period.status !== "OK" || period.year === null || period.month === null ? "LISTA_PRECIO_INVALIDA" : null;
    return rows.map((row) => {
      const price = baseStatus ? null : salePrices.get(salePriceKey(period.year!, period.month!, tariff, row.tariffPeriod)) ?? null;
      const surcharge = baseStatus ? null : saleSurcharges.get(saleSurchargeKey(period.year!, period.month!, tariff)) ?? 0;
      const appliedPrice = price === null ? null : price + (surcharge ?? 0);
      const status: SalePriceStatus = baseStatus ?? (price === null ? "SIN_PRECIO_PERIODO" : "OK");
      return {
        ...row,
        salePriceYear: period.year,
        salePriceMonth: period.month,
        salePriceEurMwh: price,
        saleSurchargeEurMwh: surcharge,
        appliedSalePriceEurMwh: appliedPrice,
        estimatedSaleAmountEur: appliedPrice === null ? null : (row.consumptionKwh / 1000) * appliedPrice,
        estimatedSaleAmountBcEur: appliedPrice === null ? null : (row.elevatedConsumptionKwh / 1000) * appliedPrice,
        salePriceStatus: status
      };
    });
  }

  private valueMeffMonthlyRows(
    contractId: string,
    referenceDate: Date,
    monthlyRows: Array<{ year: number; month: number; elevatedConsumptionKwh: number }>,
    meffCurve: MeffCurve,
    omieRealPrices: Map<string, OmieRealMonth>,
    purchasePointingCoefficient: number
  ) {
    return this.valueMeffRowsFromGroups(contractId, referenceDate, monthlyRows, meffCurve, omieRealPrices, purchasePointingCoefficient);
  }

  private valueMeffRowsFromGroups(
    contractId: string,
    referenceDate: Date,
    monthlyRows: Array<{ year: number; month: number; elevatedConsumptionKwh: number }>,
    meffCurve?: MeffCurve,
    omieRealPrices: Map<string, OmieRealMonth> = new Map(),
    purchasePointingCoefficient = 1
  ) {
    const byMonth = new Map<string, { year: number; month: number; consumptionBcKwh: number }>();
    for (const row of monthlyRows) {
      const key = monthKey(row.year, row.month);
      const current = byMonth.get(key) ?? { year: row.year, month: row.month, consumptionBcKwh: 0 };
      current.consumptionBcKwh += row.elevatedConsumptionKwh;
      byMonth.set(key, current);
    }
    return [...byMonth.values()]
      .map((row) => {
        const key = monthKey(row.year, row.month);
        const omieMonth = omieRealPrices.get(key) ?? null;
        const curveMonth = meffCurve?.months.get(key) ?? null;
        const useOmie = Boolean(omieMonth?.complete && omieMonth.price !== null);
        const marketPrice = useOmie ? omieMonth!.price : curveMonth?.price ?? null;
        const appliedPrice = marketPrice === null ? null : marketPrice * purchasePointingCoefficient;
        const status: PurchaseValuationStatus = row.consumptionBcKwh <= 0 ? "SIN_CONSUMO_BC" : useOmie ? "OK_OMIE" : marketPrice === null ? "SIN_MEFF" : "OK";
        return {
          contractId,
          referenceDate,
          year: row.year,
          month: row.month,
          consumptionBcKwh: row.consumptionBcKwh,
          meffPriceEurMwh: appliedPrice,
          estimatedMeffSaleEur: appliedPrice === null ? null : (row.consumptionBcKwh / 1000) * appliedPrice,
          meffPublicationDate: useOmie ? new Date(Date.UTC(row.year, row.month - 1, daysInUtcMonth(row.year, row.month))) : meffCurve?.publicationDate ?? null,
          meffProductCode: useOmie ? `OMIE_REAL_${key}` : curveMonth?.sourceProductCode ?? curveMonth?.productCode ?? null,
          meffPriceOrigin: useOmie ? "OMIE_REAL" : curveMonth?.origin ?? null,
          status
        };
      })
      .sort((left, right) => left.year - right.year || left.month - right.month);
  }

  private async saveForecastOnly(contractId: string, referenceDate: Date, calculatedUntil: Date | null, estimatedConsumption: number, calculatedAt: Date, status: ForecastStatus) {
    await this.persistForecast(contractId, referenceDate, calculatedUntil, estimatedConsumption, null, null, null, null, null, calculatedAt, status, [], []);
    return { status };
  }

  private async persistForecast(
    contractId: string,
    referenceDate: Date,
    calculatedUntil: Date | null,
    estimatedConsumption: number,
    estimatedSaleAmount: number | null,
    estimatedSaleAmountBc: number | null,
    estimatedMeffSaleAmount: number | null,
    salePriceStatus: SalePriceStatus | null,
    meffValuationStatus: PurchaseValuationStatus | "OK_MIXTO" | null,
    calculatedAt: Date,
    status: ForecastStatus,
    monthlyRows: Array<{ contractId: string; referenceDate: Date; year: number; month: number; tariffPeriod: string; consumptionKwh: number; elevatedConsumptionKwh: number; lossesKwh: number; lossPercentage: number | null; lossVersion: string | null; lossMode: string | null; boeLossPercentage: number | null; kFactor: number | null; kFactorVersion: string | null; kFactorSourceMonth: string | null; salePriceYear: number | null; salePriceMonth: number | null; salePriceEurMwh: number | null; saleSurchargeEurMwh: number | null; appliedSalePriceEurMwh: number | null; estimatedSaleAmountEur: number | null; estimatedSaleAmountBcEur: number | null; salePriceStatus: SalePriceStatus; profileWeight: number; intervals: number }>,
    meffRows: Array<{ contractId: string; referenceDate: Date; year: number; month: number; consumptionBcKwh: number; meffPriceEurMwh: number | null; estimatedMeffSaleEur: number | null; meffPublicationDate: Date | null; meffProductCode: string | null; meffPriceOrigin: string | null; status: PurchaseValuationStatus }>
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.pricingPortfolioMonthlyConsumption.deleteMany({ where: { contractId, referenceDate } });
      await tx.pricingPortfolioMonthlyValuation.deleteMany({ where: { contractId, referenceDate } });
      if (monthlyRows.length) {
        await tx.pricingPortfolioMonthlyConsumption.createMany({
          data: monthlyRows.map((row) => ({
            contractId: row.contractId,
            referenceDate: row.referenceDate,
            year: row.year,
            month: row.month,
            tariffPeriod: row.tariffPeriod,
            consumptionKwh: new Prisma.Decimal(row.consumptionKwh.toFixed(6)),
            elevatedConsumptionKwh: new Prisma.Decimal(row.elevatedConsumptionKwh.toFixed(6)),
            lossesKwh: new Prisma.Decimal(row.lossesKwh.toFixed(6)),
            lossPercentage: row.lossPercentage === null ? null : new Prisma.Decimal(row.lossPercentage.toFixed(6)),
            lossVersion: row.lossVersion,
            lossMode: row.lossMode,
            boeLossPercentage: row.boeLossPercentage === null ? null : new Prisma.Decimal(row.boeLossPercentage.toFixed(6)),
            kFactor: row.kFactor === null ? null : new Prisma.Decimal(row.kFactor.toFixed(10)),
            kFactorVersion: row.kFactorVersion,
            kFactorSourceMonth: row.kFactorSourceMonth,
            salePriceYear: row.salePriceYear,
            salePriceMonth: row.salePriceMonth,
            salePriceEurMwh: row.salePriceEurMwh === null ? null : new Prisma.Decimal(row.salePriceEurMwh.toFixed(6)),
            saleSurchargeEurMwh: row.saleSurchargeEurMwh === null ? null : new Prisma.Decimal(row.saleSurchargeEurMwh.toFixed(6)),
            appliedSalePriceEurMwh: row.appliedSalePriceEurMwh === null ? null : new Prisma.Decimal(row.appliedSalePriceEurMwh.toFixed(6)),
            estimatedSaleAmountEur: row.estimatedSaleAmountEur === null ? null : new Prisma.Decimal(row.estimatedSaleAmountEur.toFixed(6)),
            estimatedSaleAmountBcEur: row.estimatedSaleAmountBcEur === null ? null : new Prisma.Decimal(row.estimatedSaleAmountBcEur.toFixed(6)),
            salePriceStatus: row.salePriceStatus,
            profileWeight: new Prisma.Decimal(row.profileWeight.toFixed(15)),
            intervals: row.intervals
          }))
        });
      }
      if (meffRows.length) {
        await tx.pricingPortfolioMonthlyValuation.createMany({
          data: meffRows.map((row) => ({
            contractId: row.contractId,
            referenceDate: row.referenceDate,
            year: row.year,
            month: row.month,
            consumptionBcKwh: new Prisma.Decimal(row.consumptionBcKwh.toFixed(6)),
            meffPriceEurMwh: row.meffPriceEurMwh === null ? null : new Prisma.Decimal(row.meffPriceEurMwh.toFixed(6)),
            estimatedMeffSaleEur: row.estimatedMeffSaleEur === null ? null : new Prisma.Decimal(row.estimatedMeffSaleEur.toFixed(6)),
            meffPublicationDate: row.meffPublicationDate,
            meffProductCode: row.meffProductCode,
            meffPriceOrigin: row.meffPriceOrigin,
            status: row.status
          }))
        });
      }
      await tx.pricingPortfolioForecast.upsert({
        where: {
          contractId_referenceDate: {
            contractId,
            referenceDate
          }
        },
        create: {
          contractId,
          referenceDate,
          calculatedUntil,
          estimatedConsumption: new Prisma.Decimal(estimatedConsumption.toFixed(6)),
          estimatedSaleAmount: estimatedSaleAmount === null ? null : new Prisma.Decimal(estimatedSaleAmount.toFixed(6)),
          estimatedSaleAmountBc: estimatedSaleAmountBc === null ? null : new Prisma.Decimal(estimatedSaleAmountBc.toFixed(6)),
          estimatedMeffSaleAmount: estimatedMeffSaleAmount === null ? null : new Prisma.Decimal(estimatedMeffSaleAmount.toFixed(6)),
          saleSurchargesJson: SALE_SURCHARGE_TRACE,
          salePriceStatus,
          meffValuationStatus,
          calculatedAt,
          status
        },
        update: {
          calculatedUntil,
          estimatedConsumption: new Prisma.Decimal(estimatedConsumption.toFixed(6)),
          estimatedSaleAmount: estimatedSaleAmount === null ? null : new Prisma.Decimal(estimatedSaleAmount.toFixed(6)),
          estimatedSaleAmountBc: estimatedSaleAmountBc === null ? null : new Prisma.Decimal(estimatedSaleAmountBc.toFixed(6)),
          estimatedMeffSaleAmount: estimatedMeffSaleAmount === null ? null : new Prisma.Decimal(estimatedMeffSaleAmount.toFixed(6)),
          saleSurchargesJson: SALE_SURCHARGE_TRACE,
          salePriceStatus,
          meffValuationStatus,
          calculatedAt,
          status
        }
      });
    });
  }
}

function normalizePortfolioTariff(value: string | null): PortfolioTariff | null {
  const normalized = normalizeTarifa(value);
  if (normalized === "2.0TD" || normalized === "3.0TD") {
    return normalized;
  }
  return normalized?.startsWith("6.") ? "6.1TD" : null;
}

function parseSaleSurcharges(input: unknown): SaleSurchargeMap {
  if (input === undefined || input === null) {
    return new Map();
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException("Los recargos de venta deben informarse como objeto por tarifa.");
  }
  const result: SaleSurchargeMap = new Map();
  for (const tariff of ["2.0TD", "3.0TD", "6.1TD"] as const) {
    const value = (input as Record<string, unknown>)[tariff];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    const numeric = typeof value === "number" ? value : Number(String(value).replace(",", "."));
    if (!Number.isFinite(numeric)) {
      throw new BadRequestException(`Recargo de venta no numérico para ${tariff}.`);
    }
    result.set(tariff, numeric);
  }
  return result;
}

function selectProfileWeight(profile: PortfolioProfileValue | undefined, tariff: PortfolioTariff) {
  if (tariff === "6.1TD") {
    return 1;
  }
  if (!profile) return null;
  if (tariff === "2.0TD") {
    return profile.profile20td;
  }
  return profile.profile30td;
}

function parseReferenceDate(value: string) {
  try {
    const parsed = parseDateOnly(value);
    return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  } catch (error) {
    throw new BadRequestException(error instanceof Error ? error.message : "Fecha referencia no valida.");
  }
}

function parsePurchasePointingCoefficient(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return 1;
  }
  const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new BadRequestException("El coeficiente de apuntamiento debe estar entre 0,00 y 1,00.");
  }
  return Number(parsed.toFixed(2));
}

function buildForecastWindow(referenceDateText: string) {
  const reference = parseDateOnly(referenceDateText);
  const end = new Date(Date.UTC(reference.year + 1, reference.month - 1, reference.day - 1));
  return {
    start: referenceDateText,
    end: `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`
  };
}

function selectPortfolioProfileWeight(
  targetMonthDay: string,
  orderHour: number,
  tariff: PortfolioTariff,
  profileSet: { source: PortfolioProfileSource; year: number; profiles: Map<string, PortfolioProfileValue> }
) {
  if (profileSet.source === "UNIT" || tariff === "6.1TD") {
    return 1;
  }
  const exact = selectProfileWeight(profileSet.profiles.get(`${targetMonthDay}|${orderHour}`), tariff);
  if (exact !== null) {
    return exact;
  }
  for (const candidateHour of [Math.min(orderHour, 24), orderHour - 1, orderHour + 1, 23, 24]) {
    if (candidateHour < 1 || candidateHour === orderHour) {
      continue;
    }
    const candidate = selectProfileWeight(profileSet.profiles.get(`${targetMonthDay}|${candidateHour}`), tariff);
    if (candidate !== null) {
      return candidate;
    }
  }
  return null;
}

function buildProfileTotalsByTariff(
  calendar: ReturnType<typeof buildPricingCalendarRange>,
  profileSet: { source: PortfolioProfileSource; year: number; profiles: Map<string, PortfolioProfileValue> }
) {
  const result = new Map<PortfolioTariff, number | null>();
  for (const tariff of ["2.0TD", "3.0TD", "6.1TD"] as const) {
    let total = 0;
    for (const row of calendar) {
      const weight = selectPortfolioProfileWeight(row.fecha.slice(5), row.ordenHora, tariff, profileSet);
      if (weight === null) {
        total = Number.NaN;
        break;
      }
      total += weight;
    }
    result.set(tariff, Number.isNaN(total) ? null : total);
  }
  return result;
}

function buildHistoricalKCurve(rows: Array<{ fecha: Date; tarifa: string; periodo: string; version: string; tipoArchivo: ReeKFactorFileType; valorK: Prisma.Decimal | number }>): HistoricalKCurve {
  const grouped = new Map<string, { sum: number; count: number; yearMonth: string; month: number; tariff: string; period: string; version: string; fileType: ReeKFactorFileType }>();
  for (const row of rows) {
    const yearMonth = `${row.fecha.getUTCFullYear()}-${pad(row.fecha.getUTCMonth() + 1)}`;
    const month = row.fecha.getUTCMonth() + 1;
    const key = `${yearMonth}|${row.tarifa}|${row.periodo}|${row.version}|${row.tipoArchivo}`;
    const current = grouped.get(key) ?? { sum: 0, count: 0, yearMonth, month, tariff: row.tarifa, period: row.periodo, version: row.version, fileType: row.tipoArchivo };
    current.sum += decimalToNumber(row.valorK) ?? 0;
    current.count += 1;
    grouped.set(key, current);
  }

  const candidates = new Map<string, HistoricalKCurveCandidate>();
  for (const item of grouped.values()) {
    const key = `${item.yearMonth}|${item.version}|${item.fileType}`;
    const candidate = candidates.get(key) ?? {
      yearMonth: item.yearMonth,
      month: item.month,
      version: item.version,
      fileType: item.fileType,
      values: new Map<string, number>()
    };
    candidate.values.set(kTariffPeriodKey(item.tariff, item.period), item.sum / item.count);
    candidates.set(key, candidate);
  }

  const byMonth = new Map<string, HistoricalKEstimate>();
  const selectedByMonth = new Map<number, HistoricalKCurveCandidate>();
  for (const candidate of candidates.values()) {
    const current = selectedByMonth.get(candidate.month);
    if (!current || compareHistoricalKCurvePriority(candidate, current) < 0) {
      selectedByMonth.set(candidate.month, candidate);
    }
  }

  for (const candidate of selectedByMonth.values()) {
    for (const [tariffPeriod, value] of candidate.values.entries()) {
      const [tariff, period] = tariffPeriod.split("|");
      byMonth.set(kMonthKey(candidate.month, tariff, period), {
        kFactor: value,
        sourceMonth: candidate.yearMonth,
        version: candidate.version,
        mode: "ESTIMADO_K_HISTORICO"
      });
    }
  }

  return { byMonth };
}

function estimateHistoricalK(curve: HistoricalKCurve, month: number, tariff: PortfolioTariff, period: string) {
  return curve.byMonth.get(kMonthKey(month, tariff, period)) ?? noHistoricalK();
}

function noHistoricalK(): HistoricalKEstimate {
  return { kFactor: null, sourceMonth: null, version: null, mode: "BOE_SIN_K" };
}

function salePriceKey(year: number, month: number, tariff: string, period: string) {
  return `${year}|${month}|${tariff}|${period}`;
}

function saleSurchargeKey(year: number, month: number, tariff: string) {
  return `${year}|${month}|${tariff}`;
}

function summarizeSalePriceStatus(statuses: SalePriceStatus[]) {
  if (statuses.length === 0) {
    return null;
  }
  const unique = new Set(statuses);
  if (unique.size === 1 && unique.has("OK")) {
    return "OK" as const;
  }
  for (const status of ["SIN_LISTA_PRECIO", "LISTA_PRECIO_INVALIDA", "SIN_PRECIO_PERIODO"] as const) {
    if (unique.has(status)) {
      return status;
    }
  }
  return "SIN_PRECIO_PERIODO" as const;
}

function summarizeMeffValuationStatus(statuses: PurchaseValuationStatus[]) {
  if (statuses.length === 0) {
    return null;
  }
  const unique = new Set(statuses);
  if (unique.size === 1 && unique.has("OK")) {
    return "OK" as const;
  }
  if (unique.size === 1 && unique.has("OK_OMIE")) {
    return "OK_OMIE" as const;
  }
  if (unique.size === 2 && unique.has("OK") && unique.has("OK_OMIE")) {
    return "OK_MIXTO" as const;
  }
  for (const status of ["SIN_MEFF", "SIN_CONSUMO_BC"] as const) {
    if (unique.has(status)) {
      return status;
    }
  }
  return "SIN_MEFF" as const;
}

function monthKey(year: number, month: number) {
  return `${year}-${pad(month)}`;
}

function buildOmiePortfolioKey(fecha: string, periodo: number, market: string) {
  return `${fecha}|${periodo}|${market}`;
}

function buildPortfolioXbidTransactionMap(rows: Array<{ diaContrato: Date; rawPayloadJson: Prisma.JsonValue }>) {
  const aggregation = new Map<string, { netEnergyMWh: number; priceNumerator: number; totalEnergyMWh: number }>();
  const seenTransactions = new Set<string>();
  for (const row of rows) {
    const payload = asJsonRecord(row.rawPayloadJson);
    if (!payload || !isStromTransaction(payload)) {
      continue;
    }
    const fechaEntrega = parseTransactionDate(readPayloadText(payload, ["fentrega", "fechaEntrega", "fecha_entrega"])) ?? formatDateOnly(row.diaContrato);
    const periodo = readPayloadInteger(payload, ["periodo"]);
    const tipTrans = readPayloadText(payload, ["tipTrans", "TIPTRANS", "tiptrans", "tip_trans"]);
    const qty = readPayloadNumber(payload, ["qty", "volumen", "volume", "cantidad", "energia"]);
    const price = readPayloadNumber(payload, ["prc", "precio", "price"]);
    const sign = transactionSign(tipTrans);
    const transactionKey = buildTransactionDedupeKey(payload, fechaEntrega, periodo, tipTrans, qty, price);
    if (!periodo || qty === null || price === null || sign === null || !transactionKey || seenTransactions.has(transactionKey)) {
      continue;
    }
    seenTransactions.add(transactionKey);
    const absoluteEnergyMWh = Math.abs(qty) * QUARTER_HOUR_MWH_FACTOR;
    const key = buildOmiePortfolioKey(fechaEntrega, periodo, "XBID");
    const current = aggregation.get(key) ?? { netEnergyMWh: 0, priceNumerator: 0, totalEnergyMWh: 0 };
    current.netEnergyMWh += sign * absoluteEnergyMWh;
    current.priceNumerator += price * absoluteEnergyMWh;
    current.totalEnergyMWh += absoluteEnergyMWh;
    aggregation.set(key, current);
  }
  return new Map([...aggregation.entries()].map(([key, value]) => [key, {
    volXbid: value.totalEnergyMWh > 0 ? value.netEnergyMWh : null,
    precioXbid: value.totalEnergyMWh > 0 ? value.priceNumerator / value.totalEnergyMWh : null
  }]));
}

function asJsonRecord(value: Prisma.JsonValue): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isStromTransaction(payload: Record<string, unknown>) {
  const unit = readPayloadText(payload, ["unit", "unidad", "uofertante", "uOfertante"]);
  const agent = readPayloadText(payload, ["agent", "agente"]);
  return normalizeText(unit) === "STROC01" || normalizeText(agent) === "STROM";
}

function transactionSign(value: string | null) {
  const normalized = normalizeText(value);
  if (normalized === "BID") return 1;
  if (normalized === "ASK") return -1;
  return null;
}

function readPayloadText(payload: Record<string, unknown>, names: string[]) {
  const value = readPayloadValue(payload, names);
  if (value === null || value === undefined) return null;
  return String(value).trim() || null;
}

function readPayloadInteger(payload: Record<string, unknown>, names: string[]) {
  const value = readPayloadNumber(payload, names);
  return value === null || !Number.isSafeInteger(value) ? null : value;
}

function readPayloadNumber(payload: Record<string, unknown>, names: string[]) {
  const value = readPayloadValue(payload, names);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const normalized = trimmed.includes(",") ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPayloadValue(payload: Record<string, unknown>, names: string[]) {
  const normalizedNames = new Set(names.map(normalizePayloadKey));
  for (const [key, value] of Object.entries(payload)) {
    if (normalizedNames.has(normalizePayloadKey(key))) return value;
  }
  return null;
}

function normalizePayloadKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function normalizeText(value: string | null) {
  return (value ?? "").trim().toUpperCase();
}

function parseTransactionDate(value: string | null) {
  if (!value) return null;
  const normalized = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function buildTransactionDedupeKey(payload: Record<string, unknown>, fechaEntrega: string, periodo: number | null, tipTrans: string | null, qty: number | null, price: number | null) {
  const idTrans = readPayloadText(payload, ["idtrans", "idTrans", "id_trans"]);
  if (idTrans) return `idtrans:${idTrans}`;
  const idOrdr = readPayloadText(payload, ["idOrdr", "idordr", "id_order"]);
  const contract = readPayloadText(payload, ["contract", "contrato"]);
  return periodo && tipTrans && qty !== null && price !== null ? ["raw", fechaEntrega, periodo, normalizeText(tipTrans), qty, price, idOrdr ?? "", contract ?? ""].join("|") : null;
}

function formatDateOnly(value: Date) {
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

function daysInUtcMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function nullableDiff(left: number | null, right: number | null) {
  return left === null || right === null ? null : left - right;
}

function nullableMultiply(left: number | null, right: number | null) {
  return left === null || right === null ? null : left * right;
}

function nullableSum(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((sum, value) => sum + value, 0);
}

function officialSign(sImp: number | null) {
  return sImp === 2 ? -1 : 1;
}

function emptyMeffMonth(year: number, month: number): MeffForwardCurveMonth {
  return {
    year,
    month,
    key: monthKey(year, month),
    label: monthKey(year, month),
    price: null,
    origin: null,
    productCode: null,
    sourceProductCode: null,
    previous7DaysPrice: null,
    previous14DaysPrice: null,
    change7DaysPct: null,
    change14DaysPct: null
  };
}

function kMonthKey(month: number, tariff: string, period: string) {
  return `${month}|${tariff}|${period}`;
}

function kTariffPeriodKey(tariff: string, period: string) {
  return `${tariff}|${period}`;
}

function versionRank(version: string) {
  const index = K_VERSION_PRIORITY.indexOf(version as (typeof K_VERSION_PRIORITY)[number]);
  return index === -1 ? K_VERSION_PRIORITY.length : index;
}

function compareHistoricalKCurvePriority(
  left: { version: string; fileType: ReeKFactorFileType; yearMonth: string },
  right: { version: string; fileType: ReeKFactorFileType; yearMonth: string }
) {
  return (
    versionRank(left.version) - versionRank(right.version) ||
    kFactorFileTypeRank(right.fileType) - kFactorFileTypeRank(left.fileType) ||
    right.yearMonth.localeCompare(left.yearMonth)
  );
}

function kFactorFileTypeRank(value: ReeKFactorFileType) {
  return value === ReeKFactorFileType.KREALQH ? 2 : 1;
}

function startOfUtcMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function addUtcMonths(value: Date, months: number) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
}

function getYearFromDateText(value: string) {
  return parseDateOnly(value).year;
}

function profileKey(month: number, day: number, hour: number) {
  return `${pad(month)}-${pad(day)}|${hour}`;
}

function emptyPortfolioProfileValue(): PortfolioProfileValue {
  return { profile20td: null, profile30td: null, profile61td: null };
}

function minDateText(left: string, right: string) {
  return left <= right ? left : right;
}

function findPortfolioBoeLoss(losses: BoeLossRow[], tariff: PortfolioTariff, period: string, dateText: string) {
  const date = parseReferenceDate(dateText);
  return losses.find((loss) =>
    loss.tarifa === tariff &&
    loss.periodo === period &&
    normalizeDateOnly(loss.fechaInicio).getTime() <= date.getTime() &&
    normalizeDateOnly(loss.fechaFin).getTime() >= date.getTime()
  ) ?? null;
}

function normalizeDateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function buildForecastMonths(fechaInicio: string, fechaFin: string) {
  const start = parseDateOnly(fechaInicio);
  const end = parseDateOnly(fechaFin);
  const output: Array<{ year: number; month: number }> = [];
  let year = start.year;
  let month = start.month;
  while (year < end.year || (year === end.year && month <= end.month)) {
    output.push({ year, month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return output;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function parseBoundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function decimalToNumber(value: Prisma.Decimal | number | null | undefined) {
  if (typeof value === "number") {
    return value;
  }
  return value === null || value === undefined ? null : Number(value.toString());
}
