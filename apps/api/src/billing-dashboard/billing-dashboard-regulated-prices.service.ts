import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RegulatedPriceCode } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const PRICE_CODES = ["RETH", "EFIH", "PC3", "TOLLS_CHARGES", "BONO_SOCIAL", "OTROS", "IMU"] as const;
const TARIFF_PERIODS = ["P1", "P2", "P3", "P4", "P5", "P6"] as const;

type PriceCode = (typeof PRICE_CODES)[number];
type TariffPeriod = (typeof TARIFF_PERIODS)[number];

type RegulatedPricePayload = {
  code?: string;
  name?: string;
  validFrom?: string;
  validTo?: string | null;
  notes?: string | null;
  reth?: { priceEurMwh?: number | null };
  efih?: { priceEurMwh?: number | null };
  socialBonus?: { priceEurMwh?: number | null };
  other?: { priceEurMwh?: number | null };
  imu?: { percentage?: number | null };
  pc3?: Array<PeriodPriceRow>;
  tollsCharges?: Array<TollsChargesRow>;
};

type PeriodPriceRow = {
  tariffCode?: string;
  p1EurMwh?: number | null;
  p2EurMwh?: number | null;
  p3EurMwh?: number | null;
  p4EurMwh?: number | null;
  p5EurMwh?: number | null;
  p6EurMwh?: number | null;
};

type TollsChargesRow = {
  tariffCode?: string;
  powerP1EurKwYear?: number | null;
  powerP2EurKwYear?: number | null;
  powerP3EurKwYear?: number | null;
  powerP4EurKwYear?: number | null;
  powerP5EurKwYear?: number | null;
  powerP6EurKwYear?: number | null;
  energyP1EurMwh?: number | null;
  energyP2EurMwh?: number | null;
  energyP3EurMwh?: number | null;
  energyP4EurMwh?: number | null;
  energyP5EurMwh?: number | null;
  energyP6EurMwh?: number | null;
};

@Injectable()
export class BillingDashboardRegulatedPricesService {
  constructor(private readonly prisma: PrismaService) {}

  async listVersions(query: Record<string, unknown>) {
    const code = parsePriceCode(typeof query.code === "string" ? query.code : undefined, false);
    const rows = await this.prisma.regulatedPriceVersion.findMany({
      where: code ? { code } : {},
      orderBy: [{ code: "asc" }, { validFrom: "desc" }],
      include: regulatedInclude()
    });
    return rows.map(versionDto);
  }

  async getVersion(id: string) {
    const row = await this.prisma.regulatedPriceVersion.findUnique({
      where: { id },
      include: regulatedInclude()
    });
    if (!row) throw new NotFoundException("PRICE_VERSION_NOT_FOUND");
    return versionDto(row);
  }

  async createVersion(body: RegulatedPricePayload) {
    const input = parseVersionPayload(body);
    await this.assertNoOverlap(input.code, input.validFrom, input.validTo, null);
    const row = await this.prisma.$transaction(async (tx) => {
      const version = await tx.regulatedPriceVersion.create({
        data: {
          code: input.code,
          name: input.name,
          validFrom: input.validFrom,
          validTo: input.validTo,
          notes: input.notes
        }
      });
      await this.replaceDetails(tx, version.id, input.code, body);
      return tx.regulatedPriceVersion.findUniqueOrThrow({ where: { id: version.id }, include: regulatedInclude() });
    });
    return versionDto(row);
  }

  async updateVersion(id: string, body: RegulatedPricePayload) {
    const existing = await this.prisma.regulatedPriceVersion.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("PRICE_VERSION_NOT_FOUND");
    await this.assertVersionCanBeEdited(id);
    const input = parseVersionPayload({ ...body, code: existing.code });
    await this.assertNoOverlap(existing.code, input.validFrom, input.validTo, id);
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.regulatedPriceVersion.update({
        where: { id },
        data: {
          name: input.name,
          validFrom: input.validFrom,
          validTo: input.validTo,
          notes: input.notes
        }
      });
      await this.replaceDetails(tx, id, existing.code, body);
      return tx.regulatedPriceVersion.findUniqueOrThrow({ where: { id }, include: regulatedInclude() });
    });
    return versionDto(row);
  }

  async deleteVersion(id: string) {
    const existing = await this.prisma.regulatedPriceVersion.findUnique({
      where: { id },
      select: { id: true }
    });
    if (!existing) throw new NotFoundException("PRICE_VERSION_NOT_FOUND");
    await this.assertVersionCanBeDeleted(id);
    await this.prisma.regulatedPriceVersion.delete({ where: { id } });
    return { deleted: true };
  }

  async resolvePriceVersion(code: PriceCode | RegulatedPriceCode, date: string | Date) {
    const targetDate = parseDate(date, "date");
    const rows = await this.prisma.regulatedPriceVersion.findMany({
      where: {
        code,
        validFrom: { lte: targetDate },
        OR: [{ validTo: null }, { validTo: { gte: targetDate } }]
      },
      include: regulatedInclude()
    });
    if (rows.length === 0) throw new NotFoundException("PRICE_VERSION_NOT_FOUND");
    if (rows.length > 1) throw new BadRequestException("PRICE_VERSION_OVERLAP");
    return rows[0];
  }

  async resolveRethPrice(date: string | Date) {
    const version = await this.resolvePriceVersion("RETH", date);
    if (!version.rethPrice) throw new NotFoundException("RETH_PRICE_NOT_CONFIGURED");
    return {
      versionId: version.id,
      versionName: version.name,
      validFrom: dateOnly(version.validFrom),
      validTo: dateOnly(version.validTo),
      sourceTable: "regulated_reth_prices",
      sourceRowId: version.rethPrice.id,
      priceEurMwh: decimalToNumber(version.rethPrice.priceEurMwh),
      energyBasis: version.rethPrice.energyBasis,
      unit: version.rethPrice.unit
    };
  }

  async resolveEfihPrice(date: string | Date) {
    const version = await this.resolvePriceVersion("EFIH", date);
    if (!version.efihPrice) throw new NotFoundException("EFIH_PRICE_NOT_CONFIGURED");
    return {
      versionId: version.id,
      versionName: version.name,
      validFrom: dateOnly(version.validFrom),
      validTo: dateOnly(version.validTo),
      sourceTable: "regulated_efih_prices",
      sourceRowId: version.efihPrice.id,
      priceEurMwh: decimalToNumber(version.efihPrice.priceEurMwh),
      energyBasis: version.efihPrice.energyBasis,
      unit: version.efihPrice.unit
    };
  }

  async resolveSocialBonusPrice(date: string | Date) {
    const version = await this.resolvePriceVersion("BONO_SOCIAL", date);
    if (!version.socialBonusPrice) throw new NotFoundException("BONO_SOCIAL_PRICE_NOT_CONFIGURED");
    const priceEurMwh = decimalToNumber(version.socialBonusPrice.priceEurMwh);
    if (priceEurMwh === null) throw new NotFoundException("BONO_SOCIAL_PRICE_NOT_CONFIGURED");
    return {
      versionId: version.id,
      versionName: version.name,
      validFrom: dateOnly(version.validFrom),
      validTo: dateOnly(version.validTo),
      sourceTable: "regulated_social_bonus_prices",
      sourceRowId: version.socialBonusPrice.id,
      priceEurMwh,
      energyBasis: version.socialBonusPrice.energyBasis,
      unit: version.socialBonusPrice.unit
    };
  }

  async resolveOtherPrice(date: string | Date) {
    const version = await this.resolvePriceVersion("OTROS", date);
    if (!version.otherPrice) throw new NotFoundException("OTROS_PRICE_NOT_CONFIGURED");
    const priceEurMwh = decimalToNumber(version.otherPrice.priceEurMwh);
    if (priceEurMwh === null) throw new NotFoundException("OTROS_PRICE_NOT_CONFIGURED");
    return {
      versionId: version.id,
      versionName: version.name,
      validFrom: dateOnly(version.validFrom),
      validTo: dateOnly(version.validTo),
      sourceTable: "regulated_other_prices",
      sourceRowId: version.otherPrice.id,
      priceEurMwh,
      energyBasis: version.otherPrice.energyBasis,
      unit: version.otherPrice.unit
    };
  }

  async resolveImuRate(date: string | Date) {
    const version = await this.resolvePriceVersion("IMU", date);
    if (!version.imuRate) throw new NotFoundException("IMU_RATE_NOT_CONFIGURED");
    const percentage = decimalToNumber(version.imuRate.percentage);
    if (percentage === null) throw new NotFoundException("IMU_RATE_NOT_CONFIGURED");
    return {
      versionId: version.id,
      versionName: version.name,
      validFrom: dateOnly(version.validFrom),
      validTo: dateOnly(version.validTo),
      sourceTable: "regulated_imu_rates",
      sourceRowId: version.imuRate.id,
      percentage,
      basis: version.imuRate.basis,
      unit: version.imuRate.unit
    };
  }

  async resolvePc3Price(date: string | Date, tariffCode: string, tariffPeriod: string) {
    const version = await this.resolvePriceVersion("PC3", date);
    const row = version.pc3Prices.find((item) => normalizeTariff(item.tariffCode) === normalizeTariff(tariffCode));
    if (!row) throw new NotFoundException("PC3_TARIFF_NOT_FOUND");
    const value = periodValue(row, tariffPeriod, "EurMwh");
    if (value === null) throw new NotFoundException("PC3_PRICE_NOT_CONFIGURED");
    return {
      versionId: version.id,
      versionName: version.name,
      validFrom: dateOnly(version.validFrom),
      validTo: dateOnly(version.validTo),
      sourceTable: "regulated_pc3_prices",
      sourceRowId: row.id,
      tariffCode: row.tariffCode,
      tariffPeriod: parseTariffPeriod(tariffPeriod),
      priceEurMwh: value,
      energyBasis: row.energyBasis,
      unit: row.unit
    };
  }

  async resolveTollsChargesEnergyPrice(date: string | Date, tariffCode: string, tariffPeriod: string) {
    const version = await this.resolvePriceVersion("TOLLS_CHARGES", date);
    const row = version.tollsChargesPrices.find((item) => normalizeTariff(item.tariffCode) === normalizeTariff(tariffCode));
    if (!row) throw new NotFoundException("TOLLS_CHARGES_TARIFF_NOT_FOUND");
    const period = parseTariffPeriod(tariffPeriod);
    const value = decimalToNumber(row[`energy${period}EurMwh` as keyof typeof row] as Prisma.Decimal | null);
    if (value === null) throw new NotFoundException("TOLLS_CHARGES_ENERGY_PRICE_NOT_CONFIGURED");
    return {
      versionId: version.id,
      versionName: version.name,
      validFrom: dateOnly(version.validFrom),
      validTo: dateOnly(version.validTo),
      sourceTable: "regulated_tolls_charges_prices",
      sourceRowId: row.id,
      tariffCode: row.tariffCode,
      tariffPeriod: period,
      priceEurMwh: value,
      energyBasis: row.energyBasis,
      unit: row.energyUnit
    };
  }

  async resolveTollsChargesPowerPrice(date: string | Date, tariffCode: string, tariffPeriod: string) {
    const version = await this.resolvePriceVersion("TOLLS_CHARGES", date);
    const row = version.tollsChargesPrices.find((item) => normalizeTariff(item.tariffCode) === normalizeTariff(tariffCode));
    if (!row) throw new NotFoundException("TOLLS_CHARGES_TARIFF_NOT_FOUND");
    const period = parseTariffPeriod(tariffPeriod);
    const value = decimalToNumber(row[`power${period}EurKwYear` as keyof typeof row] as Prisma.Decimal | null);
    if (value === null) throw new NotFoundException("TOLLS_CHARGES_POWER_PRICE_NOT_CONFIGURED");
    return {
      versionId: version.id,
      versionName: version.name,
      validFrom: dateOnly(version.validFrom),
      validTo: dateOnly(version.validTo),
      sourceTable: "regulated_tolls_charges_prices",
      sourceRowId: row.id,
      tariffCode: row.tariffCode,
      tariffPeriod: period,
      priceEurKwYear: value,
      basis: row.powerBasis,
      unit: row.powerUnit
    };
  }

  private async assertNoOverlap(code: RegulatedPriceCode, validFrom: Date, validTo: Date | null, excludeId: string | null) {
    const overlaps = await this.prisma.regulatedPriceVersion.findMany({
      where: {
        code,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        validFrom: { lte: validTo ?? new Date("9999-12-31T00:00:00.000Z") },
        OR: [{ validTo: null }, { validTo: { gte: validFrom } }]
      },
      select: { id: true }
    });
    if (overlaps.length > 0) throw new BadRequestException("PRICE_VERSION_OVERLAP");
  }

  private async assertVersionCanBeEdited(id: string) {
    const references = await this.countHistoricalReferences(id);
    if (references > 0) throw new BadRequestException("REGULATED_PRICE_VERSION_IN_USE");
  }

  private async assertVersionCanBeDeleted(id: string) {
    const references = await this.countHistoricalReferences(id);
    if (references > 0) throw new BadRequestException("REGULATED_PRICE_VERSION_IN_USE");
  }

  private async countHistoricalReferences(id: string) {
    return this.prisma.cmInvoiceIntervalCostComponent.count({ where: { regulatedPriceVersionId: id } });
  }

  private async replaceDetails(tx: Prisma.TransactionClient, versionId: string, code: RegulatedPriceCode, body: RegulatedPricePayload) {
    await Promise.all([
      tx.regulatedRethPrice.deleteMany({ where: { versionId } }),
      tx.regulatedEfihPrice.deleteMany({ where: { versionId } }),
      tx.regulatedPc3Price.deleteMany({ where: { versionId } }),
      tx.regulatedTollsChargesPrice.deleteMany({ where: { versionId } }),
      tx.regulatedSocialBonusPrice.deleteMany({ where: { versionId } }),
      tx.regulatedOtherPrice.deleteMany({ where: { versionId } }),
      tx.regulatedImuRate.deleteMany({ where: { versionId } })
    ]);
    if (code === "RETH") {
      await tx.regulatedRethPrice.create({ data: { versionId, priceEurMwh: decimalRequired(body.reth?.priceEurMwh, "priceEurMwh") } });
    } else if (code === "EFIH") {
      await tx.regulatedEfihPrice.create({ data: { versionId, priceEurMwh: decimalRequired(body.efih?.priceEurMwh, "priceEurMwh") } });
    } else if (code === "BONO_SOCIAL") {
      await tx.regulatedSocialBonusPrice.create({ data: { versionId, priceEurMwh: decimalNullable(body.socialBonus?.priceEurMwh) } });
    } else if (code === "OTROS") {
      await tx.regulatedOtherPrice.create({ data: { versionId, priceEurMwh: decimalNullable(body.other?.priceEurMwh) } });
    } else if (code === "IMU") {
      await tx.regulatedImuRate.create({ data: { versionId, percentage: decimalNullable(body.imu?.percentage) } });
    } else if (code === "PC3") {
      await tx.regulatedPc3Price.createMany({ data: parsePc3Rows(body.pc3 ?? []).map((row) => ({ versionId, ...row })) });
    } else if (code === "TOLLS_CHARGES") {
      await tx.regulatedTollsChargesPrice.createMany({ data: parseTollsRows(body.tollsCharges ?? []).map((row) => ({ versionId, ...row })) });
    }
  }
}

function regulatedInclude() {
  return {
    rethPrice: true,
    efihPrice: true,
    socialBonusPrice: true,
    otherPrice: true,
    imuRate: true,
    pc3Prices: { orderBy: { tariffCode: "asc" } },
    tollsChargesPrices: { orderBy: { tariffCode: "asc" } }
  } as const;
}

function parseVersionPayload(body: RegulatedPricePayload) {
  const code = parsePriceCode(body.code, true);
  const validFrom = parseDate(body.validFrom, "validFrom");
  const validTo = body.validTo === null || body.validTo === "" || body.validTo === undefined ? null : parseDate(body.validTo, "validTo");
  if (validTo && validTo < validFrom) throw new BadRequestException("VALID_TO_BEFORE_VALID_FROM");
  return {
    code,
    name: text(body.name) ?? code,
    validFrom,
    validTo,
    notes: text(body.notes)
  };
}

function parsePc3Rows(rows: PeriodPriceRow[]) {
  return rows.map((row) => ({
    tariffCode: tariffCode(row.tariffCode),
    p1EurMwh: decimalNullable(row.p1EurMwh),
    p2EurMwh: decimalNullable(row.p2EurMwh),
    p3EurMwh: decimalNullable(row.p3EurMwh),
    p4EurMwh: decimalNullable(row.p4EurMwh),
    p5EurMwh: decimalNullable(row.p5EurMwh),
    p6EurMwh: decimalNullable(row.p6EurMwh)
  }));
}

function parseTollsRows(rows: TollsChargesRow[]) {
  return rows.map((row) => ({
    tariffCode: tariffCode(row.tariffCode),
    powerP1EurKwYear: decimalNullable(row.powerP1EurKwYear),
    powerP2EurKwYear: decimalNullable(row.powerP2EurKwYear),
    powerP3EurKwYear: decimalNullable(row.powerP3EurKwYear),
    powerP4EurKwYear: decimalNullable(row.powerP4EurKwYear),
    powerP5EurKwYear: decimalNullable(row.powerP5EurKwYear),
    powerP6EurKwYear: decimalNullable(row.powerP6EurKwYear),
    energyP1EurMwh: decimalNullable(row.energyP1EurMwh),
    energyP2EurMwh: decimalNullable(row.energyP2EurMwh),
    energyP3EurMwh: decimalNullable(row.energyP3EurMwh),
    energyP4EurMwh: decimalNullable(row.energyP4EurMwh),
    energyP5EurMwh: decimalNullable(row.energyP5EurMwh),
    energyP6EurMwh: decimalNullable(row.energyP6EurMwh)
  }));
}

function versionDto(row: any) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    validFrom: dateOnly(row.validFrom),
    validTo: dateOnly(row.validTo),
    notes: row.notes,
    status: versionStatus(row.validFrom, row.validTo),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    reth: row.rethPrice
      ? { priceEurMwh: decimalToNumber(row.rethPrice.priceEurMwh), energyBasis: row.rethPrice.energyBasis, unit: row.rethPrice.unit }
      : null,
    efih: row.efihPrice
      ? { priceEurMwh: decimalToNumber(row.efihPrice.priceEurMwh), energyBasis: row.efihPrice.energyBasis, unit: row.efihPrice.unit }
      : null,
    socialBonus: row.socialBonusPrice
      ? { priceEurMwh: decimalToNumber(row.socialBonusPrice.priceEurMwh), energyBasis: row.socialBonusPrice.energyBasis, unit: row.socialBonusPrice.unit }
      : null,
    other: row.otherPrice
      ? { priceEurMwh: decimalToNumber(row.otherPrice.priceEurMwh), energyBasis: row.otherPrice.energyBasis, unit: row.otherPrice.unit }
      : null,
    imu: row.imuRate
      ? { percentage: decimalToNumber(row.imuRate.percentage), basis: row.imuRate.basis, unit: row.imuRate.unit }
      : null,
    pc3: row.pc3Prices.map((item: any) => ({
      tariffCode: item.tariffCode,
      p1EurMwh: decimalToNumber(item.p1EurMwh),
      p2EurMwh: decimalToNumber(item.p2EurMwh),
      p3EurMwh: decimalToNumber(item.p3EurMwh),
      p4EurMwh: decimalToNumber(item.p4EurMwh),
      p5EurMwh: decimalToNumber(item.p5EurMwh),
      p6EurMwh: decimalToNumber(item.p6EurMwh),
      energyBasis: item.energyBasis,
      unit: item.unit
    })),
    tollsCharges: row.tollsChargesPrices.map((item: any) => ({
      tariffCode: item.tariffCode,
      powerP1EurKwYear: decimalToNumber(item.powerP1EurKwYear),
      powerP2EurKwYear: decimalToNumber(item.powerP2EurKwYear),
      powerP3EurKwYear: decimalToNumber(item.powerP3EurKwYear),
      powerP4EurKwYear: decimalToNumber(item.powerP4EurKwYear),
      powerP5EurKwYear: decimalToNumber(item.powerP5EurKwYear),
      powerP6EurKwYear: decimalToNumber(item.powerP6EurKwYear),
      energyP1EurMwh: decimalToNumber(item.energyP1EurMwh),
      energyP2EurMwh: decimalToNumber(item.energyP2EurMwh),
      energyP3EurMwh: decimalToNumber(item.energyP3EurMwh),
      energyP4EurMwh: decimalToNumber(item.energyP4EurMwh),
      energyP5EurMwh: decimalToNumber(item.energyP5EurMwh),
      energyP6EurMwh: decimalToNumber(item.energyP6EurMwh),
      energyBasis: item.energyBasis,
      energyUnit: item.energyUnit,
      powerBasis: item.powerBasis,
      powerUnit: item.powerUnit
    }))
  };
}

function parsePriceCode(value: string | undefined, required: true): RegulatedPriceCode;
function parsePriceCode(value: string | undefined, required: false): RegulatedPriceCode | null;
function parsePriceCode(value: string | undefined, required: boolean) {
  if (!value && !required) return null;
  const normalized = value?.trim().toUpperCase();
  if (!normalized || !PRICE_CODES.includes(normalized as PriceCode)) throw new BadRequestException("INVALID_PRICE_CODE");
  return normalized as RegulatedPriceCode;
}

function parseDate(value: string | Date | undefined, field: string) {
  if (value instanceof Date) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`INVALID_${field.toUpperCase()}`);
  return new Date(`${value}T00:00:00.000Z`);
}

function parseTariffPeriod(value: string): TariffPeriod {
  const normalized = value.trim().toUpperCase();
  if (!TARIFF_PERIODS.includes(normalized as TariffPeriod)) throw new BadRequestException("INVALID_TARIFF_PERIOD");
  return normalized as TariffPeriod;
}

function periodValue(row: Record<string, unknown>, tariffPeriod: string, suffix: "EurMwh") {
  const period = parseTariffPeriod(tariffPeriod);
  return decimalToNumber(row[`${period.toLowerCase()}${suffix}`] as Prisma.Decimal | number | null | undefined);
}

function tariffCode(value: string | undefined) {
  const normalized = text(value)?.toUpperCase();
  if (!normalized) throw new BadRequestException("INVALID_TARIFF_CODE");
  return normalized;
}

function normalizeTariff(value: string) {
  return value.trim().toUpperCase();
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function decimalRequired(value: unknown, field: string) {
  const decimal = decimalNullable(value);
  if (decimal === null) throw new BadRequestException(`INVALID_${field.toUpperCase()}`);
  return decimal;
}

function decimalNullable(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new BadRequestException("INVALID_PRICE");
  return new Prisma.Decimal(number);
}

function decimalToNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? value : Number(value);
}

function dateOnly(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function versionStatus(validFrom: Date, validTo: Date | null) {
  const today = new Date();
  const current = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (validFrom > current) return "FUTURE";
  if (validTo && validTo < current) return "FINISHED";
  return "CURRENT";
}
