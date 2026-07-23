import { Prisma } from "@prisma/client";
import type { MirContract } from "../interfaces/mir-api.interfaces";

export function serializeMirContract(row: {
  id: string;
  mirContractId: number;
  policyId: number | null;
  policyCode: string | null;
  commercialId: number | null;
  commercialName: string | null;
  annualConsumption: Prisma.Decimal | null;
  contractEndDate: Date | null;
  tariffId: number | null;
  tariffName: string | null;
  priceListId: number | null;
  priceListName: string | null;
  synchronizedAt: Date;
  syncStatus: string;
  validationErrors: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  totalConsumptionKwh?: Prisma.Decimal | number | null;
  totalElevatedConsumptionKwh?: Prisma.Decimal | number | null;
  totalEstimatedSaleAmountEur?: Prisma.Decimal | number | null;
  totalEstimatedSaleAmountBcEur?: Prisma.Decimal | number | null;
  totalEstimatedMeffSaleAmountEur?: Prisma.Decimal | number | null;
  meffValuationStatus?: string | null;
  salePriceStatus?: string | null;
}) {
  const priceListPeriod = parsePriceListPeriod(row.priceListName);
  const annualConsumption = decimalToNumber(row.annualConsumption);
  const totalConsumptionKwh = decimalToNumber(row.totalConsumptionKwh);
  const totalElevatedConsumptionKwh = decimalToNumber(row.totalElevatedConsumptionKwh);
  const totalEstimatedSaleAmountEur = decimalToNumber(row.totalEstimatedSaleAmountEur);
  const totalEstimatedSaleAmountBcEur = decimalToNumber(row.totalEstimatedSaleAmountBcEur);
  const totalEstimatedMeffSaleAmountEur = decimalToNumber(row.totalEstimatedMeffSaleAmountEur);
  const meffSpreadEur = totalEstimatedSaleAmountBcEur !== null && totalEstimatedMeffSaleAmountEur !== null
    ? totalEstimatedSaleAmountBcEur - totalEstimatedMeffSaleAmountEur
    : null;
  return {
    id: row.id,
    mirContractId: row.mirContractId,
    policyId: row.policyId,
    policyCode: row.policyCode,
    commercialId: row.commercialId,
    commercialName: row.commercialName,
    annualConsumption,
    contractEndDate: row.contractEndDate?.toISOString().slice(0, 10) ?? null,
    tariffId: row.tariffId,
    tariffName: row.tariffName,
    priceListId: row.priceListId,
    priceListName: row.priceListName,
    priceListYear: priceListPeriod.year,
    priceListMonth: priceListPeriod.month,
    priceListPeriod: priceListPeriod.period,
    priceListParseStatus: priceListPeriod.status,
    synchronizedAt: row.synchronizedAt.toISOString(),
    syncStatus: row.syncStatus,
    validationErrors: Array.isArray(row.validationErrors) ? row.validationErrors.filter((item): item is string => typeof item === "string") : [],
    totalConsumptionKwh,
    totalElevatedConsumptionKwh,
    totalEstimatedSaleAmountEur,
    totalEstimatedSaleAmountBcEur,
    totalEstimatedMeffSaleAmountEur,
    meffSpreadEur,
    meffSpreadEurMwh: totalElevatedConsumptionKwh && totalElevatedConsumptionKwh > 0 && meffSpreadEur !== null
      ? meffSpreadEur / (totalElevatedConsumptionKwh / 1000)
      : null,
    averageMeffPriceEurMwh: totalElevatedConsumptionKwh && totalElevatedConsumptionKwh > 0 && totalEstimatedMeffSaleAmountEur !== null
      ? totalEstimatedMeffSaleAmountEur / (totalElevatedConsumptionKwh / 1000)
      : null,
    meffValuationStatus: row.meffValuationStatus ?? null,
    averageSalePriceEurMwh: totalConsumptionKwh && totalConsumptionKwh > 0 && totalEstimatedSaleAmountEur !== null
      ? totalEstimatedSaleAmountEur / (totalConsumptionKwh / 1000)
      : null,
    salePriceStatus: row.salePriceStatus ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function mirContractToPrisma(contract: MirContract) {
  return {
    mirContractId: contract.mirContractId,
    policyId: contract.policyId,
    policyCode: contract.policyCode,
    commercialId: contract.commercialId,
    commercialName: contract.commercialName,
    annualConsumption: contract.annualConsumption === null ? null : new Prisma.Decimal(contract.annualConsumption),
    contractEndDate: contract.contractEndDate,
    tariffId: contract.tariffId,
    tariffName: contract.tariffName,
    priceListId: contract.priceListId,
    priceListName: contract.priceListName,
    synchronizedAt: contract.synchronizedAt,
    syncStatus: contract.validationErrors.length ? "INCOMPLETO" : "OK",
    validationErrors: contract.validationErrors.length ? contract.validationErrors : Prisma.JsonNull,
    rawPayloadJson: contract.rawPayloadJson as Prisma.InputJsonValue
  };
}

function decimalToNumber(value: Prisma.Decimal | number | null | undefined) {
  if (typeof value === "number") {
    return value;
  }
  return value === null || value === undefined ? null : Number(value.toString());
}

export function parsePriceListPeriod(priceListName: string | null) {
  if (!priceListName) {
    return { year: null, month: null, period: null, status: "NO_MATCH" as const };
  }
  const matches = [...priceListName.matchAll(/(^|[^0-9])(20[0-9]{2}(0[1-9]|1[0-2]|[1-9]))([^0-9]|$)/g)];
  if (matches.length === 0) {
    return { year: null, month: null, period: null, status: "NO_MATCH" as const };
  }
  const tokens = [...new Set(matches.map((match) => match[2]))];
  if (tokens.length !== 1) {
    return { year: null, month: null, period: null, status: "AMBIGUOUS" as const };
  }
  const token = tokens[0];
  const year = Number(token.slice(0, 4));
  const month = Number(token.slice(4));
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || month < 1 || month > 12) {
    return { year: null, month: null, period: null, status: "INVALID_MONTH" as const };
  }
  return {
    year,
    month,
    period: `${year}-${String(month).padStart(2, "0")}`,
    status: "OK" as const
  };
}
