import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { mirContractToPrisma, serializeMirContract } from "../entities/mir-contract.entity";
import type { MirContract, MirContractQuery } from "../interfaces/mir-api.interfaces";

@Injectable()
export class MirContractRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertMany(contracts: MirContract[]) {
    if (contracts.length === 0) {
      return { created: 0, updated: 0 };
    }
    const ids = [...new Set(contracts.map((contract) => contract.mirContractId))];
    const existing = await this.prisma.mirContract.findMany({
      where: { mirContractId: { in: ids } },
      select: { mirContractId: true }
    });
    const existingIds = new Set(existing.map((row) => row.mirContractId));
    for (const contract of contracts) {
      const data = mirContractToPrisma(contract);
      await this.prisma.mirContract.upsert({
        where: { mirContractId: contract.mirContractId },
        create: data,
        update: data
      });
    }
    return {
      created: contracts.filter((contract) => !existingIds.has(contract.mirContractId)).length,
      updated: contracts.filter((contract) => existingIds.has(contract.mirContractId)).length
    };
  }

  async findMany(query: MirContractQuery) {
    const where = buildWhere(query);
    const skip = Math.max(query.skip ?? 0, 0);
    const take = Math.min(Math.max(query.take ?? 100, 1), 1000);
    const [rows, total, summary] = await Promise.all([
      this.prisma.mirContract.findMany({
        where,
        orderBy: [{ synchronizedAt: "desc" }, { policyCode: "asc" }],
        skip,
        take
      }),
      this.prisma.mirContract.count({ where }),
      this.getSummary(where)
    ]);
    const valuationByContract = query.referenceDate ? await this.getPortfolioValuationByContract(rows.map((row) => row.id), query.referenceDate) : new Map<string, PortfolioValuationSummary>();
    return {
      rows: rows.map((row) => serializeMirContract({
        ...row,
        totalConsumptionKwh: valuationByContract.get(row.id)?.totalConsumptionKwh ?? null,
        totalElevatedConsumptionKwh: valuationByContract.get(row.id)?.totalElevatedConsumptionKwh ?? null,
        totalEstimatedSaleAmountEur: valuationByContract.get(row.id)?.totalEstimatedSaleAmountEur ?? null,
        totalEstimatedSaleAmountBcEur: valuationByContract.get(row.id)?.totalEstimatedSaleAmountBcEur ?? null,
        totalEstimatedMeffSaleAmountEur: valuationByContract.get(row.id)?.totalEstimatedMeffSaleAmountEur ?? null,
        salePriceStatus: valuationByContract.get(row.id)?.salePriceStatus ?? null,
        meffValuationStatus: valuationByContract.get(row.id)?.meffValuationStatus ?? null
      })),
      total,
      hasNext: skip + rows.length < total,
      skip,
      take,
      summary
    };
  }

  private async getPortfolioValuationByContract(contractIds: string[], referenceDate: string) {
    if (contractIds.length === 0) {
      return new Map<string, PortfolioValuationSummary>();
    }
    const reference = parseDate(referenceDate);
    const [monthlyRows, forecastRows] = await Promise.all([
      this.prisma.pricingPortfolioMonthlyConsumption.groupBy({
        by: ["contractId"],
        where: {
          contractId: { in: contractIds },
          referenceDate: reference
        },
        _sum: { consumptionKwh: true, elevatedConsumptionKwh: true }
      }),
      this.prisma.pricingPortfolioForecast.findMany({
        where: { contractId: { in: contractIds }, referenceDate: reference },
        select: { contractId: true, estimatedSaleAmount: true, estimatedSaleAmountBc: true, estimatedMeffSaleAmount: true, salePriceStatus: true, meffValuationStatus: true }
      })
    ]);
    const result = new Map<string, PortfolioValuationSummary>();
    for (const row of monthlyRows) {
      result.set(row.contractId, {
        totalConsumptionKwh: decimalToNumber(row._sum.consumptionKwh),
        totalElevatedConsumptionKwh: decimalToNumber(row._sum.elevatedConsumptionKwh),
        totalEstimatedSaleAmountEur: null,
        totalEstimatedSaleAmountBcEur: null,
        totalEstimatedMeffSaleAmountEur: null,
        salePriceStatus: null,
        meffValuationStatus: null
      });
    }
    for (const row of forecastRows) {
      const current = result.get(row.contractId) ?? emptyPortfolioValuationSummary();
      current.totalEstimatedSaleAmountEur = decimalToNumber(row.estimatedSaleAmount);
      current.totalEstimatedSaleAmountBcEur = decimalToNumber(row.estimatedSaleAmountBc);
      current.totalEstimatedMeffSaleAmountEur = decimalToNumber(row.estimatedMeffSaleAmount);
      current.salePriceStatus = row.salePriceStatus;
      current.meffValuationStatus = row.meffValuationStatus;
      result.set(row.contractId, current);
    }
    return result;
  }

  async findById(id: string) {
    const numericId = Number(id);
    const clauses: Prisma.MirContractWhereInput[] = [
      ...(isUuid(id) ? [{ id }] : []),
      ...(Number.isSafeInteger(numericId) ? [{ mirContractId: numericId }] : [])
    ];
    if (clauses.length === 0) {
      throw new NotFoundException("Poliza MIR no encontrada.");
    }
    const row = await this.prisma.mirContract.findFirst({ where: { OR: clauses } });
    if (!row) {
      throw new NotFoundException("Poliza MIR no encontrada.");
    }
    return serializeMirContract(row);
  }

  async deleteAll() {
    const result = await this.prisma.mirContract.deleteMany();
    return { deleted: result.count };
  }

  async getSummary(where: Prisma.MirContractWhereInput = {}) {
    const [total, consumption, tariffs, priceLists, latest] = await Promise.all([
      this.prisma.mirContract.count({ where }),
      this.prisma.mirContract.aggregate({ where, _sum: { annualConsumption: true } }),
      this.prisma.mirContract.findMany({ distinct: ["tariffName"], where: { AND: [where, { tariffName: { not: null } }] }, select: { tariffName: true } }),
      this.prisma.mirContract.findMany({ distinct: ["priceListName"], where: { AND: [where, { priceListName: { not: null } }] }, select: { priceListName: true } }),
      this.prisma.mirContract.findFirst({ where, orderBy: { synchronizedAt: "desc" }, select: { synchronizedAt: true } })
    ]);
    return {
      totalContracts: total,
      annualConsumptionTotal: decimalToNumber(consumption._sum.annualConsumption),
      distinctTariffs: tariffs.length,
      distinctPriceLists: priceLists.length,
      lastSynchronizedAt: latest?.synchronizedAt.toISOString() ?? null
    };
  }
}

function buildWhere(query: MirContractQuery): Prisma.MirContractWhereInput {
  const and: Prisma.MirContractWhereInput[] = [
    buildTextFilter("policyCode", query.policy, query.policies),
    buildTextFilter("commercialName", query.commercial, query.commercials),
    buildTextFilter("tariffName", query.tariff, query.tariffs),
    buildTextFilter("priceListName", query.priceList, query.priceLists)
  ].filter((filter) => Object.keys(filter).length > 0);
  const where: Prisma.MirContractWhereInput = {};
  if (and.length > 0) {
    where.AND = and;
  }
  if (query.contractEndDateFrom || query.contractEndDateTo) {
    where.contractEndDate = {
      ...(query.contractEndDateFrom ? { gte: parseDate(query.contractEndDateFrom) } : {}),
      ...(query.contractEndDateTo ? { lte: parseDate(query.contractEndDateTo) } : {})
    };
  }
  if (query.minAnnualConsumption !== undefined || query.maxAnnualConsumption !== undefined) {
    where.annualConsumption = {
      ...(query.minAnnualConsumption !== undefined ? { gte: new Prisma.Decimal(query.minAnnualConsumption) } : {}),
      ...(query.maxAnnualConsumption !== undefined ? { lte: new Prisma.Decimal(query.maxAnnualConsumption) } : {})
    };
  }
  return where;
}

export function buildMirContractWhere(query: MirContractQuery): Prisma.MirContractWhereInput {
  return buildWhere(query);
}

function buildTextFilter(
  field: "policyCode" | "commercialName" | "tariffName" | "priceListName",
  single?: string,
  multiple?: string[]
): Prisma.MirContractWhereInput {
  const values = multiple?.length ? multiple : single ? [single] : [];
  if (values.length === 0) {
    return {};
  }
  return {
    OR: values.map((value) => ({
      [field]: { contains: value, mode: "insensitive" }
    }))
  };
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function decimalToNumber(value: Prisma.Decimal | null | undefined) {
  return value === null || value === undefined ? null : Number(value.toString());
}

type PortfolioValuationSummary = {
  totalConsumptionKwh: number | null;
  totalElevatedConsumptionKwh: number | null;
  totalEstimatedSaleAmountEur: number | null;
  totalEstimatedSaleAmountBcEur: number | null;
  totalEstimatedMeffSaleAmountEur: number | null;
  salePriceStatus: string | null;
  meffValuationStatus: string | null;
};

function emptyPortfolioValuationSummary(): PortfolioValuationSummary {
  return {
    totalConsumptionKwh: null,
    totalElevatedConsumptionKwh: null,
    totalEstimatedSaleAmountEur: null,
    totalEstimatedSaleAmountBcEur: null,
    totalEstimatedMeffSaleAmountEur: null,
    salePriceStatus: null,
    meffValuationStatus: null
  };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
