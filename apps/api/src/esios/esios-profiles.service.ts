import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { PrismaService } from "../prisma/prisma.service";

const PROFILE_TARIFFS = ["2.0TD", "3.0TD", "3.0TDVE"] as const;
type ProfileTariff = (typeof PROFILE_TARIFFS)[number];
const PROFILE_VALIDATION_DECIMALS = 8;
const PROFILE_VALIDATION_TOLERANCE = new Prisma.Decimal(1).div(new Prisma.Decimal(10).pow(PROFILE_VALIDATION_DECIMALS));
const FINAL_PROFILE_VALIDATION_DECIMALS = 8;

export type EsiosInitialProfileRow = {
  year: number;
  month: number;
  day: number;
  hour: number;
  datetime: Date;
  profile20td: number;
  profile30td: number;
  profile30tdve: number;
  referenceDemandMw: number;
};

export type EsiosProfileCoefficientInput = {
  tariff: ProfileTariff;
  alpha: number;
  beta: number;
  gamma: number;
};

type ParsedWorkbook = {
  totalRows: number;
  rows: EsiosInitialProfileRow[];
  coefficients: EsiosProfileCoefficientInput[];
};

type ParsedReeFinalDemandFile = {
  year: number;
  month: number;
  day: number | null;
  totalRows: number;
  rows: ReeFinalDemandInput[];
};

type ParsedReeFinalProfileFile = {
  year: number;
  month: number;
  totalRows: number;
  rows: ReeFinalProfileInput[];
};

type ReeFinalDemandInput = {
  year: number;
  month: number;
  day: number;
  hour: number;
  datetime: Date;
  dstFlag: number | null;
  demandMw: Prisma.Decimal;
  rawLine: string;
  sourceLine: number;
};

type ReeFinalProfileInput = {
  year: number;
  month: number;
  day: number;
  hour: number;
  datetime: Date;
  dstFlag: number | null;
  profile20td: Prisma.Decimal;
  profile30td: Prisma.Decimal;
  profile30tdve: Prisma.Decimal;
  rawLine: string;
  sourceLine: number;
};

@Injectable()
export class EsiosProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async uploadInitialProfiles(file: Express.Multer.File, year: number, options: { replace?: boolean; uploadedBy?: string } = {}) {
    if (!file?.buffer?.length) {
      throw new BadRequestException("Debe adjuntarse un fichero Excel.");
    }
    validateYear(year);

    const existing = await this.prisma.esiosProfileUpload.findFirst({
      where: { year, status: "IMPORTED" },
      orderBy: { uploadedAt: "desc" }
    });
    if (existing && !options.replace) {
      throw new ConflictException({
        message: `Ya existe una carga de perfiles ESIOS para ${year}. Confirme reemplazo para sobrescribirla.`,
        conflict: {
          year,
          existingUploadId: existing.id,
          existingFileName: existing.fileName,
          existingUploadedAt: existing.uploadedAt
        }
      });
    }

    let parsed: ParsedWorkbook;
    try {
      parsed = this.parseInitialProfilesWorkbook(file, year);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error validando el Excel.";
      await this.prisma.esiosProfileUpload.create({
        data: {
          year,
          fileName: file.originalname,
          uploadedBy: options.uploadedBy,
          status: "FAILED",
          errorMessage: message
        }
      });
      throw new BadRequestException(message);
    }

    return this.prisma.$transaction(async (tx) => {
      if (options.replace) {
        await tx.esiosInitialProfile.deleteMany({ where: { year } });
        await tx.esiosProfileCoefficient.deleteMany({ where: { year } });
      }

      const upload = await tx.esiosProfileUpload.create({
        data: {
          year,
          fileName: file.originalname,
          uploadedBy: options.uploadedBy,
          status: "IMPORTED",
          totalRows: parsed.totalRows,
          validRows: parsed.rows.length
        }
      });

      await this.saveInitialProfiles(year, parsed.rows, upload.id, tx);
      await this.saveProfileCoefficients(year, parsed.coefficients, upload.id, tx);

      return {
        upload: serializeUpload(upload),
        summary: await this.getProfilesSummary(year, tx),
        rowsImported: parsed.rows.length,
        coefficientsImported: parsed.coefficients.length
      };
    });
  }

  parseInitialProfilesWorkbook(file: Pick<Express.Multer.File, "buffer">, year?: number): ParsedWorkbook {
    const workbook = XLSX.read(file.buffer, { type: "buffer", cellDates: true });
    const detectedYear = year ?? detectYear(workbook.SheetNames);
    validateYear(detectedYear);

    const profilesSheet = findSheet(workbook, `Perfiles Iniciales ${detectedYear}`);
    const coefficientsSheet = findSheet(workbook, `Coeficientes ${detectedYear}`);
    if (!profilesSheet) {
      throw new Error(`No existe la hoja "Perfiles Iniciales ${detectedYear}".`);
    }
    if (!coefficientsSheet) {
      throw new Error(`No existe la hoja "Coeficientes ${detectedYear}".`);
    }

    const profileRows = XLSX.utils.sheet_to_json<unknown[]>(profilesSheet, { header: 1, raw: true, blankrows: false });
    const parsedProfiles = parseProfileRows(profileRows, detectedYear);
    const coefficientsRows = XLSX.utils.sheet_to_json<unknown[]>(coefficientsSheet, { header: 1, raw: true, blankrows: false });
    const coefficients = parseCoefficients(coefficientsRows);

    const expectedRows = expectedHourCount(detectedYear);
    if (parsedProfiles.rows.length !== expectedRows) {
      throw new Error(`Numero de horas no valido para ${detectedYear}: ${parsedProfiles.rows.length}. Esperado: ${expectedRows}.`);
    }

    return {
      totalRows: parsedProfiles.totalRows,
      rows: parsedProfiles.rows,
      coefficients
    };
  }

  async saveInitialProfiles(year: number, rows: EsiosInitialProfileRow[], uploadId: string, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    await db.esiosInitialProfile.createMany({
      data: rows.map((row) => ({
        year,
        month: row.month,
        day: row.day,
        hour: row.hour,
        datetime: row.datetime,
        profile20td: row.profile20td,
        profile30td: row.profile30td,
        profile30tdve: row.profile30tdve,
        referenceDemandMw: row.referenceDemandMw,
        uploadId
      }))
    });
  }

  async saveProfileCoefficients(
    year: number,
    coefficients: EsiosProfileCoefficientInput[],
    uploadId?: string | null,
    db: Prisma.TransactionClient | PrismaService = this.prisma
  ) {
    validateYear(year);
    validateCoefficients(coefficients);
    for (const coefficient of coefficients) {
      await db.esiosProfileCoefficient.upsert({
        where: { year_tariff: { year, tariff: coefficient.tariff } },
        update: {
          alpha: coefficient.alpha,
          beta: coefficient.beta,
          gamma: coefficient.gamma,
          uploadId: uploadId ?? undefined
        },
        create: {
          year,
          tariff: coefficient.tariff,
          alpha: coefficient.alpha,
          beta: coefficient.beta,
          gamma: coefficient.gamma,
          uploadId: uploadId ?? undefined
        }
      });
    }
    return this.getProfileCoefficients(year, db);
  }

  async getInitialProfiles(filters: {
    year?: number;
    month?: number;
    tariff?: string;
    fechaDesde?: string;
    fechaHasta?: string;
    skip?: number;
    take?: number;
  }) {
    const where: Prisma.EsiosInitialProfileWhereInput = {};
    if (filters.year) {
      where.year = filters.year;
    }
    if (filters.month) {
      where.month = filters.month;
    }
    if (filters.fechaDesde || filters.fechaHasta) {
      where.datetime = {
        ...(filters.fechaDesde ? { gte: parseDate(filters.fechaDesde, "fecha desde") } : {}),
        ...(filters.fechaHasta ? { lt: addDays(parseDate(filters.fechaHasta, "fecha hasta"), 1) } : {})
      };
    }

    const skip = Math.max(filters.skip ?? 0, 0);
    const take = Math.min(Math.max(filters.take ?? 500, 1), 5000);
    const [rows, total] = await Promise.all([
      this.prisma.esiosInitialProfile.findMany({
        where,
        orderBy: [{ year: "asc" }, { month: "asc" }, { day: "asc" }, { hour: "asc" }],
        skip,
        take
      }),
      this.prisma.esiosInitialProfile.count({ where })
    ]);

    return {
      rows: rows.map(serializeProfileRow),
      total,
      hasNext: skip + rows.length < total,
      filters: {
        ...filters,
        skip,
        take
      }
    };
  }

  async getProfileCoefficients(year: number, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    validateYear(year);
    const rows = await db.esiosProfileCoefficient.findMany({
      where: { year },
      orderBy: { tariff: "asc" }
    });
    return rows.sort((left, right) => PROFILE_TARIFFS.indexOf(left.tariff as ProfileTariff) - PROFILE_TARIFFS.indexOf(right.tariff as ProfileTariff)).map(serializeCoefficient);
  }

  async getProfilesSummary(year: number, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    validateYear(year);
    const [aggregate, count, latestUpload, coefficientCount] = await Promise.all([
      db.esiosInitialProfile.aggregate({
        where: { year },
        _sum: {
          profile20td: true,
          profile30td: true,
          profile30tdve: true,
          referenceDemandMw: true
        }
      }),
      db.esiosInitialProfile.count({ where: { year } }),
      db.esiosProfileUpload.findFirst({
        where: { year },
        orderBy: { uploadedAt: "desc" }
      }),
      db.esiosProfileCoefficient.count({ where: { year } })
    ]);

    return {
      year,
      expectedHours: expectedHourCount(year),
      loadedHours: count,
      loadStatus: latestUpload?.status ?? "SIN_CARGA",
      latestUpload: latestUpload ? serializeUpload(latestUpload) : null,
      sumProfile20td: decimalToNumber(aggregate._sum.profile20td),
      sumProfile30td: decimalToNumber(aggregate._sum.profile30td),
      sumProfile30tdve: decimalToNumber(aggregate._sum.profile30tdve),
      totalReferenceDemandMw: decimalToNumber(aggregate._sum.referenceDemandMw),
      coefficientCount
    };
  }

  async listProfileUploads(query: { year?: number; skip?: number; take?: number }) {
    const where: Prisma.EsiosProfileUploadWhereInput = query.year ? { year: query.year } : {};
    const skip = Math.max(query.skip ?? 0, 0);
    const take = Math.min(Math.max(query.take ?? 50, 1), 500);
    const [uploads, total] = await Promise.all([
      this.prisma.esiosProfileUpload.findMany({ where, orderBy: { uploadedAt: "desc" }, skip, take }),
      this.prisma.esiosProfileUpload.count({ where })
    ]);
    return {
      uploads: uploads.map(serializeUpload),
      total,
      hasNext: skip + uploads.length < total
    };
  }

  async calculateIntermediateProfiles(year: number) {
    validateYear(year);
    const startedAt = new Date();
    const calculationLog = await this.prisma.esiosProfileCalculationLog.create({
      data: {
        year,
        status: "RUNNING",
        startedAt
      }
    });

    try {
      const calculation = await this.buildIntermediateProfiles(year);
      await this.prisma.$transaction(async (tx) => {
        await tx.esiosProfileIntermediateResult.deleteMany({ where: { year } });
        for (const chunk of chunkArray(calculation.rows, 1000)) {
          await tx.esiosProfileIntermediateResult.createMany({
            data: chunk.map((row) => ({
              year: row.year,
              datetime: row.datetime,
              month: row.month,
              day: row.day,
              hour: row.hour,
              tariff: row.tariff,
              initialProfile: row.initialProfile,
              h0: row.h0,
              h1: row.h1,
              hf: row.hf,
              c0: row.c0,
              c1: row.c1,
              cf: row.cf,
              m0: row.m0,
              m1: row.m1,
              intermediateProfile: row.intermediateProfile,
              demandUsedMw: row.demandUsedMw,
              demandSource: row.demandSource,
              referenceDemandMw: row.referenceDemandMw,
              forecastDemandMw: row.forecastDemandMw,
              finalDemandMw: row.finalDemandMw,
              systemDemandMw: row.systemDemandMw
            }))
          });
        }
      }, { timeout: 120000, maxWait: 120000 });

      const finishedAt = new Date();
      await this.prisma.esiosProfileCalculationLog.update({
        where: { id: calculationLog.id },
        data: {
          status: "SUCCESS",
          finishedAt,
          executionTimeMs: finishedAt.getTime() - startedAt.getTime(),
          rowsProcessed: calculation.rows.length,
          errorMessage: null
        }
      });

      return {
        summary: await this.getIntermediateProfilesSummary(year),
        rowsProcessed: calculation.rows.length,
        tariffsProcessed: PROFILE_TARIFFS.length
      };
    } catch (error) {
      const finishedAt = new Date();
      const message = error instanceof Error ? error.message.slice(0, 4000) : String(error);
      await this.prisma.esiosProfileCalculationLog.update({
        where: { id: calculationLog.id },
        data: {
          status: "ERROR",
          finishedAt,
          executionTimeMs: finishedAt.getTime() - startedAt.getTime(),
          errorMessage: message
        }
      });
      throw new BadRequestException(message);
    }
  }

  async getIntermediateProfiles(filters: {
    year?: number;
    month?: number;
    tariff?: string;
    fechaDesde?: string;
    fechaHasta?: string;
    skip?: number;
    take?: number;
  }) {
    const where: Prisma.EsiosProfileIntermediateResultWhereInput = {};
    if (filters.year) {
      where.year = filters.year;
    }
    if (filters.month) {
      where.month = filters.month;
    }
    if (filters.tariff) {
      where.tariff = filters.tariff;
    }
    if (filters.fechaDesde || filters.fechaHasta) {
      where.datetime = {
        ...(filters.fechaDesde ? { gte: parseDate(filters.fechaDesde, "fecha desde") } : {}),
        ...(filters.fechaHasta ? { lt: addDays(parseDate(filters.fechaHasta, "fecha hasta"), 1) } : {})
      };
    }

    const skip = Math.max(filters.skip ?? 0, 0);
    const take = Math.min(Math.max(filters.take ?? 500, 1), 5000);
    const [rows, total] = await Promise.all([
      this.prisma.esiosProfileIntermediateResult.findMany({
        where,
        orderBy: [{ datetime: "asc" }, { tariff: "asc" }],
        skip,
        take
      }),
      this.prisma.esiosProfileIntermediateResult.count({ where })
    ]);
    const finalProfileByKey = await this.getFinalProfileByResultRows(rows);

    return {
      rows: rows.map((row) => serializeIntermediateRow(row, getFinalProfileForTariff(finalProfileByKey.get(buildProfileDateKey(row.year, row.month, row.day, row.hour)) ?? null, row.tariff as ProfileTariff))),
      total,
      hasNext: skip + rows.length < total,
      filters: {
        ...filters,
        skip,
        take
      }
    };
  }

  async getIntermediateProfilesSummary(year: number, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    validateYear(year);
    const [rows, latestCalculation, finalProfileRows] = await Promise.all([
      db.esiosProfileIntermediateResult.findMany({
        where: { year },
        select: {
          year: true,
          datetime: true,
          month: true,
          day: true,
          hour: true,
          tariff: true,
          hf: true,
          cf: true,
          m1: true,
          intermediateProfile: true,
          demandUsedMw: true,
          forecastDemandMw: true,
          finalDemandMw: true,
          referenceDemandMw: true
        }
      }),
      db.esiosProfileCalculationLog.findFirst({
        where: { year },
        orderBy: { startedAt: "desc" }
      }),
      db.esiosReeFinalProfile.findMany({
        where: { year },
        select: { year: true, month: true, day: true, hour: true, profile20td: true, profile30td: true, profile30tdve: true }
      })
    ]);

    const hourRows = new Map<string, (typeof rows)[number]>();
    const finalProfileByKey = new Map(finalProfileRows.map((row) => [buildProfileDateKey(row.year, row.month, row.day, row.hour), row]));
    const hours = new Set<string>();
    const tariffs = new Set<ProfileTariff>();
    const intermediateTotals = new Map<ProfileTariff, Prisma.Decimal>(PROFILE_TARIFFS.map((tariff) => [tariff, new Prisma.Decimal(0)]));
    let totalDemandUsed = new Prisma.Decimal(0);
    let totalForecastDemand = new Prisma.Decimal(0);
    let totalFinalDemand = new Prisma.Decimal(0);
    let hasForecastDemand = false;
    let hasFinalDemand = false;
    let totalReferenceDemand = new Prisma.Decimal(0);
    let validationMatched = 0;
    let validationMismatched = 0;
    let validationPending = 0;
    let profileValidationMatched = 0;
    let profileValidationMismatched = 0;

    for (const row of rows) {
      const datetimeKey = row.datetime.toISOString();
      hours.add(datetimeKey);
      if (!hourRows.has(datetimeKey)) {
        hourRows.set(datetimeKey, row);
      }
      tariffs.add(row.tariff as ProfileTariff);
      intermediateTotals.set(row.tariff as ProfileTariff, (intermediateTotals.get(row.tariff as ProfileTariff) ?? new Prisma.Decimal(0)).plus(row.intermediateProfile));
      const finalProfile = getFinalProfileForTariff(finalProfileByKey.get(buildProfileDateKey(row.year, row.month, row.day, row.hour)) ?? null, row.tariff as ProfileTariff);
      if (finalProfile === null) {
        validationPending += 1;
      } else {
        if (matchesFinalProfileValidation(row.intermediateProfile, finalProfile)) {
          validationMatched += 1;
        } else {
          validationMismatched += 1;
        }
      }
      const profileDifference = calculateProfileValidationDifference(row);
      if (profileDifference.abs().lte(PROFILE_VALIDATION_TOLERANCE)) {
        profileValidationMatched += 1;
      } else {
        profileValidationMismatched += 1;
      }
    }

    for (const row of hourRows.values()) {
      totalDemandUsed = totalDemandUsed.plus(row.demandUsedMw);
      totalReferenceDemand = totalReferenceDemand.plus(row.referenceDemandMw);
      if (row.forecastDemandMw !== null) {
        totalForecastDemand = totalForecastDemand.plus(row.forecastDemandMw);
        hasForecastDemand = true;
      }
      if (row.finalDemandMw !== null) {
        totalFinalDemand = totalFinalDemand.plus(row.finalDemandMw);
        hasFinalDemand = true;
      }
    }

    return {
      year,
      expectedHours: expectedHourCount(year),
      calculatedHours: hours.size,
      calculatedTariffs: tariffs.size,
      status: latestCalculation?.status ?? "SIN_CARGA",
      latestCalculation: latestCalculation ? serializeCalculationLog(latestCalculation) : null,
      sumIntermediateProfiles: Object.fromEntries(PROFILE_TARIFFS.map((tariff) => [tariff, decimalToNumber(intermediateTotals.get(tariff) ?? null)])) as Record<ProfileTariff, number | null>,
      totalDemandUsedMw: decimalToNumber(totalDemandUsed),
      totalForecastDemandMw: hasForecastDemand ? decimalToNumber(totalForecastDemand) : null,
      totalFinalDemandMw: hasFinalDemand ? decimalToNumber(totalFinalDemand) : null,
      totalReferenceDemandMw: decimalToNumber(totalReferenceDemand),
      finalProfileValidation: {
        loadedHours: finalProfileRows.length,
        matchedRows: validationMatched,
        mismatchedRows: validationMismatched,
        pendingRows: validationPending,
        tolerance: Number(new Prisma.Decimal(1).div(new Prisma.Decimal(10).pow(FINAL_PROFILE_VALIDATION_DECIMALS)))
      },
      profileValidation: {
        matchedRows: profileValidationMatched,
        mismatchedRows: profileValidationMismatched,
        tolerance: Number(PROFILE_VALIDATION_TOLERANCE)
      }
    };
  }

  async listProfileCalculationLogs(query: { year?: number; skip?: number; take?: number }) {
    const where: Prisma.EsiosProfileCalculationLogWhereInput = query.year ? { year: query.year } : {};
    const skip = Math.max(query.skip ?? 0, 0);
    const take = Math.min(Math.max(query.take ?? 50, 1), 500);
    const [logs, total] = await Promise.all([
      this.prisma.esiosProfileCalculationLog.findMany({ where, orderBy: { startedAt: "desc" }, skip, take }),
      this.prisma.esiosProfileCalculationLog.count({ where })
    ]);
    return {
      logs: logs.map(serializeCalculationLog),
      total,
      hasNext: skip + logs.length < total
    };
  }

  async uploadReeFinalDemand(file: Express.Multer.File, year: number, month: number, options: { day?: number; replace?: boolean; uploadedBy?: string } = {}) {
    if (!file?.buffer?.length) {
      throw new BadRequestException("Debe adjuntarse un fichero DEMR.");
    }
    validateYear(year);
    validateMonth(month);
    const day = options.day ?? inferDemandDayFromFileName(file.originalname, year, month);
    if (day !== undefined) {
      validateDay(day);
    }

    let parsed: ParsedReeFinalDemandFile;
    try {
      parsed = parseReeFinalDemandFile(file.buffer, year, month, day);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Error validando el fichero DEMR.");
    }

    const periodKey = buildDemandUploadPeriodKey(year, month, day);
    const existing = await this.prisma.esiosReeFinalDemandUpload.findUnique({ where: { periodKey } });
    if (existing && !options.replace) {
      throw new ConflictException({
        message: `Ya existe una carga DEMR para ${periodKey}. Confirme reemplazo para sobrescribirla.`,
        conflict: {
          year,
          month,
          day: parsed.day,
          existingUploadId: existing.id,
          existingFileName: existing.fileName,
          existingUploadedAt: existing.uploadedAt
        }
      });
    }

    const fileHash = createHash("sha256").update(file.buffer).digest("hex");
    return this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.esiosReeFinalDemandUpload.delete({ where: { id: existing.id } });
      }
      await tx.esiosReeFinalDemand.deleteMany({
        where: parsed.day === null ? { year, month } : { year, month, day: parsed.day }
      });
      const upload = await tx.esiosReeFinalDemandUpload.create({
        data: {
          year,
          month,
          day: parsed.day,
          periodKey,
          fileName: file.originalname,
          fileHash,
          uploadedBy: options.uploadedBy,
          status: "IMPORTED",
          totalRows: parsed.totalRows,
          validRows: parsed.rows.length
        }
      });
      await tx.esiosReeFinalDemand.createMany({
        data: parsed.rows.map((row) => ({
          uploadId: upload.id,
          year: row.year,
          month: row.month,
          day: row.day,
          hour: row.hour,
          datetime: row.datetime,
          dstFlag: row.dstFlag,
          demandMw: row.demandMw,
          rawLine: row.rawLine,
          sourceLine: row.sourceLine
        }))
      });

      return {
        upload: serializeReeFinalDemandUpload(upload),
        rowsImported: parsed.rows.length,
        validation: await this.getIntermediateProfilesSummary(year, tx)
      };
    });
  }

  async uploadReeFinalProfiles(file: Express.Multer.File, year: number, month: number, options: { replace?: boolean; uploadedBy?: string } = {}) {
    if (!file?.buffer?.length) {
      throw new BadRequestException("Debe adjuntarse un fichero PERFF.");
    }
    validateYear(year);
    validateMonth(month);

    let parsed: ParsedReeFinalProfileFile;
    try {
      parsed = parseReeFinalProfileFile(file.buffer, year, month);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Error validando el fichero PERFF.");
    }

    const existing = await this.prisma.esiosReeFinalProfileUpload.findUnique({ where: { year_month: { year, month } } });
    if (existing && !options.replace) {
      throw new ConflictException({
        message: `Ya existe una carga PERFF para ${year}-${padNumber(month, 2)}. Confirme reemplazo para sobrescribirla.`,
        conflict: {
          year,
          month,
          existingUploadId: existing.id,
          existingFileName: existing.fileName,
          existingUploadedAt: existing.uploadedAt
        }
      });
    }

    const fileHash = createHash("sha256").update(file.buffer).digest("hex");
    return this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.esiosReeFinalProfileUpload.delete({ where: { id: existing.id } });
      }
      const upload = await tx.esiosReeFinalProfileUpload.create({
        data: {
          year,
          month,
          fileName: file.originalname,
          fileHash,
          uploadedBy: options.uploadedBy,
          status: "IMPORTED",
          totalRows: parsed.totalRows,
          validRows: parsed.rows.length
        }
      });
      await tx.esiosReeFinalProfile.createMany({
        data: parsed.rows.map((row) => ({
          uploadId: upload.id,
          year: row.year,
          month: row.month,
          day: row.day,
          hour: row.hour,
          datetime: row.datetime,
          dstFlag: row.dstFlag,
          profile20td: row.profile20td,
          profile30td: row.profile30td,
          profile30tdve: row.profile30tdve,
          rawLine: row.rawLine,
          sourceLine: row.sourceLine
        }))
      });

      return {
        upload: serializeReeFinalProfileUpload(upload),
        rowsImported: parsed.rows.length,
        validation: await this.getIntermediateProfilesSummary(year, tx)
      };
    });
  }

  async listReeFinalDemandUploads(query: { year?: number; month?: number; day?: number; skip?: number; take?: number }) {
    const where: Prisma.EsiosReeFinalDemandUploadWhereInput = {};
    if (query.year) {
      where.year = query.year;
    }
    if (query.month) {
      where.month = query.month;
    }
    if (query.day) {
      where.day = query.day;
    }
    const skip = Math.max(query.skip ?? 0, 0);
    const take = Math.min(Math.max(query.take ?? 50, 1), 500);
    const [uploads, total] = await Promise.all([
      this.prisma.esiosReeFinalDemandUpload.findMany({ where, orderBy: { uploadedAt: "desc" }, skip, take }),
      this.prisma.esiosReeFinalDemandUpload.count({ where })
    ]);
    return {
      uploads: uploads.map(serializeReeFinalDemandUpload),
      total,
      hasNext: skip + uploads.length < total
    };
  }

  async listReeFinalProfileUploads(query: { year?: number; month?: number; skip?: number; take?: number }) {
    const where: Prisma.EsiosReeFinalProfileUploadWhereInput = {};
    if (query.year) {
      where.year = query.year;
    }
    if (query.month) {
      where.month = query.month;
    }
    const skip = Math.max(query.skip ?? 0, 0);
    const take = Math.min(Math.max(query.take ?? 50, 1), 500);
    const [uploads, total] = await Promise.all([
      this.prisma.esiosReeFinalProfileUpload.findMany({ where, orderBy: { uploadedAt: "desc" }, skip, take }),
      this.prisma.esiosReeFinalProfileUpload.count({ where })
    ]);
    return {
      uploads: uploads.map(serializeReeFinalProfileUpload),
      total,
      hasNext: skip + uploads.length < total
    };
  }

  private async getFinalDemandByResultRows(rows: Array<{ year: number; month: number; day: number; hour: number }>) {
    if (rows.length === 0) {
      return new Map<string, Prisma.Decimal>();
    }
    const years = [...new Set(rows.map((row) => row.year))];
    const months = [...new Set(rows.map((row) => row.month))];
    const finalRows = await this.prisma.esiosReeFinalDemand.findMany({
      where: { year: { in: years }, month: { in: months } },
      select: {
        year: true,
        month: true,
        day: true,
        hour: true,
        demandMw: true,
        upload: {
          select: {
            day: true,
            uploadedAt: true
          }
        }
      }
    });
    return buildFinalDemandMap(finalRows);
  }

  private async getFinalProfileByResultRows(rows: Array<{ year: number; month: number; day: number; hour: number }>) {
    if (rows.length === 0) {
      return new Map<string, { profile20td: Prisma.Decimal; profile30td: Prisma.Decimal; profile30tdve: Prisma.Decimal }>();
    }
    const years = [...new Set(rows.map((row) => row.year))];
    const months = [...new Set(rows.map((row) => row.month))];
    const finalRows = await this.prisma.esiosReeFinalProfile.findMany({
      where: { year: { in: years }, month: { in: months } },
      select: { year: true, month: true, day: true, hour: true, profile20td: true, profile30td: true, profile30tdve: true }
    });
    return new Map(finalRows.map((row) => [buildProfileDateKey(row.year, row.month, row.day, row.hour), row]));
  }

  private async buildIntermediateProfiles(year: number) {
    const [profiles, coefficients, demandFinalRows, demandForecastRows] = await Promise.all([
      this.prisma.esiosInitialProfile.findMany({ where: { year }, orderBy: { datetime: "asc" } }),
      this.prisma.esiosProfileCoefficient.findMany({ where: { year } }),
      this.prisma.esiosReeFinalDemand.findMany({
        where: { year },
        orderBy: [{ year: "asc" }, { month: "asc" }, { day: "asc" }, { hour: "asc" }],
        select: {
          year: true,
          month: true,
          day: true,
          hour: true,
          demandMw: true,
          upload: {
            select: {
              day: true,
              uploadedAt: true
            }
          }
        }
      }),
      this.prisma.esiosIndicatorValue.findMany({
        where: {
          indicatorId: 460,
          datetime: {
            gte: madridLocalDateTimeToUtc(year, 1, 1),
            lt: madridLocalDateTimeToUtc(year + 1, 1, 1)
          }
        },
        orderBy: { datetime: "asc" }
      })
    ]);

    const expectedHours = expectedHourCount(year);
    if (profiles.length !== expectedHours) {
      throw new Error(`No hay ${expectedHours} horas de perfiles iniciales para ${year}.`);
    }
    const coefficientByTariff = new Map(
      coefficients.map((row) => [row.tariff as ProfileTariff, { alpha: row.alpha, beta: row.beta, gamma: row.gamma }])
    );
    validateCoefficients(
      PROFILE_TARIFFS.map((tariff) => {
        const coefficient = coefficientByTariff.get(tariff);
        if (!coefficient) {
          throw new Error(`Falta coeficiente para tarifa ${tariff}.`);
        }
        return {
          tariff,
          alpha: Number(coefficient.alpha),
          beta: Number(coefficient.beta),
          gamma: Number(coefficient.gamma)
        };
      })
    );

    const finalDemandByDatetime = buildFinalDemandMap(demandFinalRows);
    const forecastDemandByDatetime = buildOptionalDecimalMap(demandForecastRows, buildIndicatorDateKey);
    const profileRows = profiles.map((row) => {
      const referenceDemandMw = normalizeReferenceDemandForProfiles(row.referenceDemandMw);
      return {
        year: row.year,
        month: row.month,
        day: row.day,
        hour: row.hour,
        datetime: row.datetime,
        profile20td: row.profile20td,
        profile30td: row.profile30td,
        profile30tdve: row.profile30tdve,
        referenceDemandMw,
        finalDemandMw: finalDemandByDatetime.get(buildProfileDateKey(row.year, row.month, row.day, row.hour)) ?? null,
        forecastDemandMw: forecastDemandByDatetime.get(buildProfileDateKey(row.year, row.month, row.day, row.hour)) ?? null,
        ...resolveDemandSource(
          finalDemandByDatetime.get(buildProfileDateKey(row.year, row.month, row.day, row.hour)) ?? null,
          forecastDemandByDatetime.get(buildProfileDateKey(row.year, row.month, row.day, row.hour)) ?? null,
          referenceDemandMw
        )
      };
    });

    const tariffSources: Record<ProfileTariff, "profile20td" | "profile30td" | "profile30tdve"> = {
      "2.0TD": "profile20td",
      "3.0TD": "profile30td",
      "3.0TDVE": "profile30tdve"
    };

    const results: IntermediateResultInput[] = [];
    for (const tariff of PROFILE_TARIFFS) {
      const coefficient = coefficientByTariff.get(tariff);
      if (!coefficient) {
        throw new Error(`Falta coeficiente para tarifa ${tariff}.`);
      }
      const rows = profileRows.map((row) => ({
        year: row.year,
        month: row.month,
        day: row.day,
        hour: row.hour,
        datetime: row.datetime,
        tariff,
        initialProfile: row[tariffSources[tariff]] as Prisma.Decimal,
        referenceDemandMw: row.referenceDemandMw,
        demandUsedMw: row.demandUsedMw,
        demandSource: row.demandSource,
        finalDemandMw: row.finalDemandMw,
        forecastDemandMw: row.forecastDemandMw,
        alpha: coefficient.alpha,
        beta: coefficient.beta,
        gamma: coefficient.gamma
      }));
      const calculated = calculateTariffIntermediateRows(rows);
      results.push(...calculated.rows);
    }

    return { rows: results };
  }
}

function parseProfileRows(rows: unknown[][], year: number) {
  const headerIndex = rows.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    return normalized.includes("mes") && normalized.includes("dia") && normalized.includes("hora");
  });
  if (headerIndex < 0) {
    throw new Error("No se ha encontrado la cabecera de perfiles iniciales.");
  }
  const mergedHeaders = buildMergedHeaders(rows, headerIndex);
  const columns = {
    month: 0,
    day: 1,
    hour: 2,
    profile20td: 3,
    profile30td: 4,
    profile30tdve: 5,
    referenceDemandMw: 6
  };

  validateProfileHeaders(mergedHeaders, columns);

  const parsed: EsiosInitialProfileRow[] = [];
  let totalRows = 0;
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (isEmptyRow(row)) {
      continue;
    }
    totalRows += 1;
    const sourceLine = index + 1;
    const month = parseIntegerCell(row[columns.month], `Mes fila ${sourceLine}`);
    const day = parseIntegerCell(row[columns.day], `Dia fila ${sourceLine}`);
    const hour = parseIntegerCell(row[columns.hour], `Hora fila ${sourceLine}`);
    if (month < 1 || month > 12) {
      throw new Error(`Mes fuera de rango en fila ${sourceLine}: ${month}.`);
    }
    if (hour < 1 || hour > 25) {
      throw new Error(`Hora fuera de rango en fila ${sourceLine}: ${hour}.`);
    }
    if (hour === 25 && !isDstEndDay(year, month, day)) {
      throw new Error(`Hora 25 solo permitida en el dia de cambio de hora de octubre. Fila ${sourceLine}: ${year}-${month}-${day}.`);
    }
    const datetime = buildProfileDate(year, month, day, hour, sourceLine);
    const profile20td = parseNumberCell(row[columns.profile20td], `Perfil inicial 2.0TD fila ${sourceLine}`);
    const profile30td = parseNumberCell(row[columns.profile30td], `Perfil inicial 3.0TD fila ${sourceLine}`);
    const profile30tdve = parseNumberCell(row[columns.profile30tdve], `Perfil inicial 3.0TDVE fila ${sourceLine}`);
    const referenceDemandMw = parseNumberCell(row[columns.referenceDemandMw], `Demanda de referencia fila ${sourceLine}`);
    if (profile20td < 0 || profile30td < 0 || profile30tdve < 0) {
      throw new Error(`Perfil inicial negativo en fila ${sourceLine}.`);
    }
    if (referenceDemandMw <= 0) {
      throw new Error(`Demanda de referencia no positiva en fila ${sourceLine}.`);
    }
    parsed.push({ year, month, day, hour, datetime, profile20td, profile30td, profile30tdve, referenceDemandMw });
  }
  return { totalRows, rows: parsed };
}

function buildMergedHeaders(rows: unknown[][], headerIndex: number) {
  const first = rows[headerIndex - 1] ?? [];
  const second = rows[headerIndex] ?? [];
  const maxLength = Math.max(first.length, second.length);
  const merged: string[] = [];

  for (let index = 0; index < maxLength; index += 1) {
    const combined = [first[index], second[index]]
      .map((value) => normalizeHeader(value))
      .filter(Boolean)
      .join(" ");
    merged.push(combined);
  }

  return merged;
}

function validateProfileHeaders(headers: string[], columns: Record<"month" | "day" | "hour" | "profile20td" | "profile30td" | "profile30tdve" | "referenceDemandMw", number>) {
  const checks: Array<{ column: keyof typeof columns; patterns: Array<{ any?: string[]; all?: string[] }> }> = [
    { column: "month", patterns: [{ any: ["mes"] }] },
    { column: "day", patterns: [{ any: ["dia"] }] },
    { column: "hour", patterns: [{ any: ["hora"] }] },
    { column: "profile20td", patterns: [{ any: ["p20td0mdh", "perfilinicial20td", "20td"] }] },
    { column: "profile30td", patterns: [{ any: ["p30td0mdh", "perfilinicial30td", "30td"] }] },
    { column: "profile30tdve", patterns: [{ any: ["p30tdve0mdh", "perfilinicial30tdve", "30tdve"] }] },
    { column: "referenceDemandMw", patterns: [{ all: ["demanda", "referencia"], any: ["mw", "megavatios"] }, { all: ["referencia"], any: ["mw"] }] }
  ];

  for (const check of checks) {
    if (!matchesHeader(headers[columns[check.column]] ?? "", check.patterns[0]) && !check.patterns.some((pattern) => matchesHeader(headers[columns[check.column]] ?? "", pattern))) {
      throw new Error(`No se ha podido validar la columna ${describePattern(check.patterns[0])}.`);
    }
  }
}

function parseCoefficients(rows: unknown[][]): EsiosProfileCoefficientInput[] {
  const coefficientsRow = findRowIndex(rows, ["ai", "alpha"]);
  const betaRow = findRowIndex(rows, ["bi", "beta"]);
  const gammaRow = findRowIndex(rows, ["gi", "gamma"]);
  const coefficients = PROFILE_TARIFFS.map((tariff, tariffIndex) => {
    const column = tariffIndex + 1;
    return {
      tariff,
      alpha: parseNumberCell(rows[coefficientsRow]?.[column], `Coeficiente ai ${tariff}`),
      beta: parseNumberCell(rows[betaRow]?.[column], `Coeficiente bi ${tariff}`),
      gamma: parseNumberCell(rows[gammaRow]?.[column], `Coeficiente gi ${tariff}`)
    };
  });
  validateCoefficients(coefficients);
  return coefficients;
}

function parseReeFinalDemandFile(buffer: Buffer, expectedYear: number, expectedMonth: number, expectedDay?: number): ParsedReeFinalDemandFile {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) {
    throw new Error("El fichero DEMR no contiene datos.");
  }
  const header = lines[0].split(";").map(normalizeHeader);
  const required = ["mes", "dia", "hora", "demandamwh"];
  for (const column of required) {
    if (!header.includes(column)) {
      throw new Error(`Falta columna obligatoria DEMR: ${column}.`);
    }
  }
  const yearIndex = header.includes("ano") ? header.indexOf("ano") : header.indexOf("ao");
  if (yearIndex < 0) {
    throw new Error("Falta columna obligatoria DEMR: ano.");
  }
  const indexes = {
    year: yearIndex,
    month: header.indexOf("mes"),
    day: header.indexOf("dia"),
    hour: header.indexOf("hora"),
    dstFlag: header.findIndex((value) => value.includes("verano") || value.includes("invierno")),
    demand: header.indexOf("demandamwh")
  };
  const rows: ReeFinalDemandInput[] = [];
  const seen = new Set<string>();

  for (let index = 1; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const values = rawLine.split(";");
    const sourceLine = index + 1;
    const year = parseIntegerCell(values[indexes.year], `Año DEMR fila ${sourceLine}`);
    const month = parseIntegerCell(values[indexes.month], `Mes DEMR fila ${sourceLine}`);
    const day = parseIntegerCell(values[indexes.day], `Dia DEMR fila ${sourceLine}`);
    const hour = parseIntegerCell(values[indexes.hour], `Hora DEMR fila ${sourceLine}`);
    const dstFlag = indexes.dstFlag >= 0 && values[indexes.dstFlag] !== "" ? parseIntegerCell(values[indexes.dstFlag], `Verano/invierno DEMR fila ${sourceLine}`) : null;
    const demandMw = new Prisma.Decimal(parseNumberCell(values[indexes.demand], `Demanda DEMR fila ${sourceLine}`));

    if (year !== expectedYear || month !== expectedMonth || (expectedDay !== undefined && day !== expectedDay)) {
      const expectedLabel = expectedDay === undefined
        ? `${expectedYear}-${padNumber(expectedMonth, 2)}`
        : `${expectedYear}-${padNumber(expectedMonth, 2)}-${padNumber(expectedDay, 2)}`;
      throw new Error(`El fichero contiene ${year}-${padNumber(month, 2)}-${padNumber(day, 2)} en fila ${sourceLine}, esperado ${expectedLabel}.`);
    }
    if (hour < 1 || hour > 25) {
      throw new Error(`Hora DEMR no valida en fila ${sourceLine}: ${hour}.`);
    }
    if (hour === 25 && !isDstEndDay(year, month, day)) {
      throw new Error(`Hora 25 DEMR solo permitida en el dia de cambio de hora de octubre. Fila ${sourceLine}: ${year}-${month}-${day}.`);
    }
    if (demandMw.lt(0)) {
      throw new Error(`Demanda DEMR negativa en fila ${sourceLine}.`);
    }
    const normalizedHour = normalizeDstStartHour(year, month, day, hour);
    const key = buildProfileDateKey(year, month, day, normalizedHour);
    if (seen.has(key)) {
      throw new Error(`Hora DEMR duplicada en fila ${sourceLine}: ${key}.`);
    }
    seen.add(key);
    rows.push({
      year,
      month,
      day,
      hour: normalizedHour,
      datetime: buildProfileDate(year, month, day, normalizedHour, sourceLine),
      dstFlag,
      demandMw,
      rawLine,
      sourceLine
    });
  }

  const expectedHours = expectedDay !== undefined ? expectedDayHourCount(expectedYear, expectedMonth, expectedDay) : expectedMonthHourCount(expectedYear, expectedMonth);
  if (rows.length !== expectedHours) {
    const expectedLabel = expectedDay === undefined
      ? `${expectedYear}-${padNumber(expectedMonth, 2)}`
      : `${expectedYear}-${padNumber(expectedMonth, 2)}-${padNumber(expectedDay, 2)}`;
    throw new Error(`Numero de horas DEMR no valido para ${expectedLabel}: ${rows.length}. Esperado: ${expectedHours}.`);
  }

  return {
    year: expectedYear,
    month: expectedMonth,
    day: expectedDay ?? null,
    totalRows: lines.length - 1,
    rows
  };
}

function parseReeFinalProfileFile(buffer: Buffer, expectedYear: number, expectedMonth: number): ParsedReeFinalProfileFile {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) {
    throw new Error("El fichero PERFF no contiene datos.");
  }
  const header = lines[0].split(";").map(normalizeHeader);
  const yearIndex = header.includes("ano") ? header.indexOf("ano") : header.indexOf("ao");
  const indexes = {
    year: yearIndex,
    month: header.indexOf("mes"),
    day: header.indexOf("dia"),
    hour: header.indexOf("hora"),
    dstFlag: header.findIndex((value) => value.includes("verano") || value.includes("invierno")),
    profile20td: findHeaderIndex(header, ["coefperfilp20td", "perfilp20td", "p20td"]),
    profile30td: findHeaderIndex(header, ["coefperfilp30td", "perfilp30td", "p30td"]),
    profile30tdve: findHeaderIndex(header, ["coefperfilp30tdve", "perfilp30tdve", "p30tdve"])
  };
  for (const [name, index] of Object.entries(indexes)) {
    if (index < 0 && name !== "dstFlag") {
      throw new Error(`Falta columna obligatoria PERFF: ${name}.`);
    }
  }

  const rows: ReeFinalProfileInput[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const values = rawLine.split(";");
    const sourceLine = index + 1;
    const year = parseIntegerCell(values[indexes.year], `Año PERFF fila ${sourceLine}`);
    const month = parseIntegerCell(values[indexes.month], `Mes PERFF fila ${sourceLine}`);
    const day = parseIntegerCell(values[indexes.day], `Dia PERFF fila ${sourceLine}`);
    const hour = parseIntegerCell(values[indexes.hour], `Hora PERFF fila ${sourceLine}`);
    const dstFlag = indexes.dstFlag >= 0 && values[indexes.dstFlag] !== "" ? parseIntegerCell(values[indexes.dstFlag], `Verano/invierno PERFF fila ${sourceLine}`) : null;
    const profile20td = new Prisma.Decimal(parseNumberCell(values[indexes.profile20td], `Perfil final 2.0TD PERFF fila ${sourceLine}`));
    const profile30td = new Prisma.Decimal(parseNumberCell(values[indexes.profile30td], `Perfil final 3.0TD PERFF fila ${sourceLine}`));
    const profile30tdve = new Prisma.Decimal(parseNumberCell(values[indexes.profile30tdve], `Perfil final 3.0TDVE PERFF fila ${sourceLine}`));

    if (year !== expectedYear || month !== expectedMonth) {
      throw new Error(`El fichero contiene ${year}-${padNumber(month, 2)} en fila ${sourceLine}, esperado ${expectedYear}-${padNumber(expectedMonth, 2)}.`);
    }
    if (hour < 1 || hour > 25) {
      throw new Error(`Hora PERFF no valida en fila ${sourceLine}: ${hour}.`);
    }
    if (hour === 25 && !isDstEndDay(year, month, day)) {
      throw new Error(`Hora 25 PERFF solo permitida en el dia de cambio de hora de octubre. Fila ${sourceLine}: ${year}-${month}-${day}.`);
    }
    if (profile20td.lt(0) || profile30td.lt(0) || profile30tdve.lt(0)) {
      throw new Error(`Perfil final PERFF negativo en fila ${sourceLine}.`);
    }
    const normalizedHour = normalizeDstStartHour(year, month, day, hour);
    const key = buildProfileDateKey(year, month, day, normalizedHour);
    if (seen.has(key)) {
      throw new Error(`Hora PERFF duplicada en fila ${sourceLine}: ${key}.`);
    }
    seen.add(key);
    rows.push({
      year,
      month,
      day,
      hour: normalizedHour,
      datetime: buildProfileDate(year, month, day, normalizedHour, sourceLine),
      dstFlag,
      profile20td,
      profile30td,
      profile30tdve,
      rawLine,
      sourceLine
    });
  }

  const expectedHours = expectedMonthHourCount(expectedYear, expectedMonth);
  if (rows.length !== expectedHours) {
    throw new Error(`Numero de horas PERFF no valido para ${expectedYear}-${padNumber(expectedMonth, 2)}: ${rows.length}. Esperado: ${expectedHours}.`);
  }

  return {
    year: expectedYear,
    month: expectedMonth,
    totalRows: lines.length - 1,
    rows
  };
}

function findHeaderIndex(headers: string[], aliases: string[]) {
  return headers.findIndex((header) => aliases.some((alias) => header.includes(normalizeHeader(alias))));
}

function validateCoefficients(coefficients: EsiosProfileCoefficientInput[]) {
  const byTariff = new Map(coefficients.map((item) => [item.tariff, item]));
  for (const tariff of PROFILE_TARIFFS) {
    const item = byTariff.get(tariff);
    if (!item) {
      throw new Error(`Falta coeficiente para tarifa ${tariff}.`);
    }
    for (const [key, value] of Object.entries({ alpha: item.alpha, beta: item.beta, gamma: item.gamma })) {
      if (!Number.isFinite(value)) {
        throw new Error(`Coeficiente ${key} no numerico para tarifa ${tariff}.`);
      }
    }
  }
}

function findColumn(headers: string[], patterns: Array<{ any?: string[]; all?: string[] }>) {
  const index = headers.findIndex((header) => patterns.some((pattern) => matchesHeader(header, pattern)));
  if (index < 0) {
    throw new Error(`Falta columna obligatoria: ${describePattern(patterns[0])}.`);
  }
  return index;
}

function matchesHeader(header: string, pattern: { any?: string[]; all?: string[] }) {
  const anyMatch = !pattern.any || pattern.any.some((alias) => header.includes(normalizeHeader(alias)));
  const allMatch = !pattern.all || pattern.all.every((term) => header.includes(normalizeHeader(term)));
  return anyMatch && allMatch;
}

function describePattern(pattern?: { any?: string[]; all?: string[] }) {
  if (!pattern) {
    return "columna";
  }
  return [...(pattern.all ?? []), ...(pattern.any ?? [])].join("/");
}

function findRowIndex(rows: unknown[][], aliases: string[]) {
  const index = rows.findIndex((row) => {
    const firstCell = normalizeHeader(row[0]);
    return aliases.some((alias) => firstCell.includes(normalizeHeader(alias)));
  });
  if (index < 0) {
    throw new Error(`No se ha encontrado la fila de ${aliases[0]}.`);
  }
  return index;
}

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeSheetName(value: string) {
  return normalizeHeader(value).replace(/(\d{4})(?=\d{4})/g, "$1 ");
}

function isEmptyRow(row: unknown[]) {
  return row.every((cell) => cell === undefined || cell === null || String(cell).trim() === "");
}

function parseIntegerCell(value: unknown, label: string) {
  const number = parseNumberCell(value, label);
  if (!Number.isInteger(number)) {
    throw new Error(`${label} no es entero: ${String(value ?? "")}.`);
  }
  return number;
}

function parseNumberCell(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") {
    throw new Error(`${label} vacio.`);
  }
  const number = typeof value === "number" ? value : Number(String(value).trim().replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(number)) {
    throw new Error(`${label} no numerico: ${String(value)}.`);
  }
  return number;
}

function buildProfileDate(year: number, month: number, day: number, hour: number, sourceLine: number) {
  const date = hour === 25
    ? new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
    : new Date(Date.UTC(year, month - 1, day, hour - 1, 0, 0, 0));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Fecha invalida en fila ${sourceLine}: ${year}-${month}-${day}.`);
  }
  return date;
}

function buildProfileDateKey(year: number, month: number, day: number, hour: number) {
  return `${year}-${padNumber(month, 2)}-${padNumber(day, 2)}-${padNumber(hour, 2)}`;
}

function buildDemandUploadPeriodKey(year: number, month: number, day?: number | null) {
  return day === undefined || day === null
    ? `${year}-${padNumber(month, 2)}`
    : `${year}-${padNumber(month, 2)}-${padNumber(day, 2)}`;
}

function normalizeDstStartHour(year: number, month: number, day: number, hour: number) {
  if (isDstStartDay(year, month, day) && hour >= 3) {
    return hour - 1;
  }
  return hour;
}

function buildIndicatorDateKey(date: Date) {
  const parts = madridDateParts(date);
  const hour = Number(parts.hour);
  return buildProfileDateKey(Number(parts.year), Number(parts.month), Number(parts.day), hour === 0 ? 1 : hour + 1);
}

function madridDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute")
  };
}

function madridLocalDateTimeToUtc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, millisecond = 0) {
  let candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = madridDateParts(candidate);
    const candidateKey = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      0,
      0
    );
    const targetKey = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const diffMinutes = (targetKey - candidateKey) / 60000;
    if (diffMinutes === 0) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() + diffMinutes * 60000);
  }

  return candidate;
}

function isDstEndDay(year: number, month: number, day: number) {
  if (month !== 10) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== 9 || date.getUTCDay() !== 0) {
    return false;
  }
  return day + 7 > 31;
}

function isDstStartDay(year: number, month: number, day: number) {
  if (month !== 3) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== 2 || date.getUTCDay() !== 0) {
    return false;
  }
  return day + 7 > 31;
}

function expectedMonthHourCount(year: number, month: number) {
  let total = daysInMonth(year, month) * 24;
  for (let day = 1; day <= daysInMonth(year, month); day += 1) {
    if (isDstStartDay(year, month, day)) {
      total -= 1;
    }
    if (isDstEndDay(year, month, day)) {
      total += 1;
    }
  }
  return total;
}

function expectedDayHourCount(year: number, month: number, day: number) {
  if (isDstStartDay(year, month, day)) {
    return 23;
  }
  if (isDstEndDay(year, month, day)) {
    return 25;
  }
  return 24;
}

function expectedHourCount(year: number) {
  return isLeapYear(year) ? 8784 : 8760;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function validateYear(year: number) {
  if (!Number.isSafeInteger(year) || year < 2000 || year > 2100) {
    throw new BadRequestException("Año ESIOS no valido.");
  }
}

function validateMonth(month: number) {
  if (!Number.isSafeInteger(month) || month < 1 || month > 12) {
    throw new BadRequestException("Mes no valido.");
  }
}

function inferDemandDayFromFileName(fileName: string, expectedYear: number, expectedMonth: number) {
  const match = fileName.match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})/);
  if (!match) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year !== expectedYear || month !== expectedMonth) {
    throw new BadRequestException(`El fichero indica ${year}-${padNumber(month, 2)}-${padNumber(day, 2)} en el nombre, esperado ${expectedYear}-${padNumber(expectedMonth, 2)}.`);
  }
  return day;
}

function validateDay(day: number) {
  if (!Number.isSafeInteger(day) || day < 1 || day > 31) {
    throw new BadRequestException("Dia no valido.");
  }
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function detectYear(sheetNames: string[]) {
  const match = sheetNames.join(" ").match(/\b(20\d{2})\b/);
  if (!match) {
    throw new Error("No se ha podido detectar el año del Excel.");
  }
  return Number(match[1]);
}

function findSheet(workbook: XLSX.WorkBook, expectedName: string) {
  const expected = normalizeSheetName(expectedName);
  const exact = workbook.SheetNames.find((name) => normalizeSheetName(name) === expected);
  if (exact) {
    return workbook.Sheets[exact];
  }
  const loose = workbook.SheetNames.find((name) => normalizeSheetName(name).includes(expected) || expected.includes(normalizeSheetName(name)));
  return loose ? workbook.Sheets[loose] : undefined;
}

function parseDate(value: string, label: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`Parametro ${label} no valido.`);
  }
  return date;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function decimalToNumber(value: Prisma.Decimal | null | undefined) {
  return value === null || value === undefined ? null : Number(value);
}

function serializeUpload(upload: {
  id: string;
  year: number;
  fileName: string;
  uploadedAt: Date;
  uploadedBy: string | null;
  status: string;
  errorMessage: string | null;
  totalRows: number;
  validRows: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: upload.id,
    year: upload.year,
    fileName: upload.fileName,
    uploadedAt: upload.uploadedAt.toISOString(),
    uploadedBy: upload.uploadedBy,
    status: upload.status,
    errorMessage: upload.errorMessage,
    totalRows: upload.totalRows,
    validRows: upload.validRows,
    createdAt: upload.createdAt.toISOString(),
    updatedAt: upload.updatedAt.toISOString()
  };
}

function serializeProfileRow(row: {
  id: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  datetime: Date;
  profile20td: Prisma.Decimal;
  profile30td: Prisma.Decimal;
  profile30tdve: Prisma.Decimal;
  referenceDemandMw: Prisma.Decimal;
  uploadId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    year: row.year,
    month: row.month,
    day: row.day,
    hour: row.hour,
    datetime: row.datetime.toISOString(),
    profile20td: Number(row.profile20td),
    profile30td: Number(row.profile30td),
    profile30tdve: Number(row.profile30tdve),
    referenceDemandMw: Number(row.referenceDemandMw),
    uploadId: row.uploadId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function serializeCoefficient(row: {
  id: string;
  year: number;
  tariff: string;
  alpha: Prisma.Decimal;
  beta: Prisma.Decimal;
  gamma: Prisma.Decimal;
  uploadId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    year: row.year,
    tariff: row.tariff,
    alpha: Number(row.alpha),
    beta: Number(row.beta),
    gamma: Number(row.gamma),
    uploadId: row.uploadId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function serializeReeFinalDemandUpload(upload: {
  id: string;
  year: number;
  month: number;
  day: number | null;
  periodKey: string | null;
  fileName: string;
  fileHash: string;
  uploadedAt: Date;
  uploadedBy: string | null;
  status: string;
  errorMessage: string | null;
  totalRows: number;
  validRows: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: upload.id,
    year: upload.year,
    month: upload.month,
    day: upload.day,
    periodKey: upload.periodKey,
    fileName: upload.fileName,
    fileHash: upload.fileHash,
    uploadedAt: upload.uploadedAt.toISOString(),
    uploadedBy: upload.uploadedBy,
    status: upload.status,
    errorMessage: upload.errorMessage,
    totalRows: upload.totalRows,
    validRows: upload.validRows,
    createdAt: upload.createdAt.toISOString(),
    updatedAt: upload.updatedAt.toISOString()
  };
}

function serializeReeFinalProfileUpload(upload: {
  id: string;
  year: number;
  month: number;
  fileName: string;
  fileHash: string;
  uploadedAt: Date;
  uploadedBy: string | null;
  status: string;
  errorMessage: string | null;
  totalRows: number;
  validRows: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: upload.id,
    year: upload.year,
    month: upload.month,
    fileName: upload.fileName,
    fileHash: upload.fileHash,
    uploadedAt: upload.uploadedAt.toISOString(),
    uploadedBy: upload.uploadedBy,
    status: upload.status,
    errorMessage: upload.errorMessage,
    totalRows: upload.totalRows,
    validRows: upload.validRows,
    createdAt: upload.createdAt.toISOString(),
    updatedAt: upload.updatedAt.toISOString()
  };
}

function buildFinalDemandMap(
  rows: Array<{
    year: number;
    month: number;
    day: number;
    hour: number;
    demandMw: Prisma.Decimal;
    upload: {
      day: number | null;
      uploadedAt: Date;
    };
  }>
) {
  const map = new Map<string, { demandMw: Prisma.Decimal; priority: number; uploadedAt: number }>();
  for (const row of rows) {
    const key = buildProfileDateKey(row.year, row.month, row.day, row.hour);
    const priority = row.upload.day === null ? 0 : 1;
    const uploadedAt = row.upload.uploadedAt.getTime();
    const current = map.get(key);
    if (!current || priority > current.priority || (priority === current.priority && uploadedAt >= current.uploadedAt)) {
      map.set(key, { demandMw: row.demandMw, priority, uploadedAt });
    }
  }
  return new Map([...map.entries()].map(([key, value]) => [key, value.demandMw] as const));
}

type IntermediateResultInput = {
  year: number;
  datetime: Date;
  month: number;
  day: number;
  hour: number;
  tariff: ProfileTariff;
  initialProfile: Prisma.Decimal;
  h0: Prisma.Decimal;
  h1: Prisma.Decimal;
  hf: Prisma.Decimal;
  c0: Prisma.Decimal;
  c1: Prisma.Decimal;
  cf: Prisma.Decimal;
  m0: Prisma.Decimal;
  m1: Prisma.Decimal;
  intermediateProfile: Prisma.Decimal;
  demandUsedMw: Prisma.Decimal;
  demandSource: "REE_DEMR" | "FINAL_1335" | "FORECAST_460" | "REFERENCE_REE";
  referenceDemandMw: Prisma.Decimal;
  forecastDemandMw: Prisma.Decimal | null;
  finalDemandMw: Prisma.Decimal | null;
  systemDemandMw: Prisma.Decimal | null;
};

type IntermediateTariffInput = {
  year: number;
  month: number;
  day: number;
  hour: number;
  datetime: Date;
  tariff: ProfileTariff;
  initialProfile: Prisma.Decimal;
  referenceDemandMw: Prisma.Decimal;
  demandUsedMw: Prisma.Decimal;
  demandSource: "REE_DEMR" | "FINAL_1335" | "FORECAST_460" | "REFERENCE_REE";
  forecastDemandMw: Prisma.Decimal | null;
  finalDemandMw: Prisma.Decimal | null;
  alpha: Prisma.Decimal;
  beta: Prisma.Decimal;
  gamma: Prisma.Decimal;
};

type TariffComputationResult = {
  rows: IntermediateResultInput[];
  summary: {
    intermediateProfile: Prisma.Decimal;
  };
};

type TariffDayComputation = {
  key: string;
  rows: IntermediateHourComputation[];
  c0: Prisma.Decimal;
  c1: Prisma.Decimal;
  cf: Prisma.Decimal;
  dayDemand: Prisma.Decimal;
  dayReferenceDemand: Prisma.Decimal;
};

type TariffMonthComputation = {
  key: string;
  days: TariffDayComputation[];
  m0: Prisma.Decimal;
  m1: Prisma.Decimal;
  monthDemand: Prisma.Decimal;
  monthReferenceDemand: Prisma.Decimal;
  monthC1Sum: Prisma.Decimal;
};

type IntermediateHourComputation = IntermediateTariffInput & {
  h0: Prisma.Decimal;
  h1: Prisma.Decimal;
  hf: Prisma.Decimal;
  dayKey: string;
  monthKey: string;
  dayC0: Prisma.Decimal;
  dayC1: Prisma.Decimal;
  dayCf: Prisma.Decimal;
  monthM0: Prisma.Decimal;
  monthM1: Prisma.Decimal;
  intermediateProfile: Prisma.Decimal;
  demandUsedMw: Prisma.Decimal;
  demandSource: "REE_DEMR" | "FINAL_1335" | "FORECAST_460" | "REFERENCE_REE";
  forecastDemandMw: Prisma.Decimal | null;
};

function buildOptionalDecimalMap(
  rows: Array<{ datetime: Date; value: Prisma.Decimal | null }>,
  keyBuilder: (value: Date) => string
) {
  const map = new Map<string, Prisma.Decimal | null>();
  for (const row of rows) {
    const key = keyBuilder(row.datetime);
    map.set(key, row.value);
  }
  return map;
}

function resolveDemandSource(finalDemand: Prisma.Decimal | null, forecastDemand: Prisma.Decimal | null, referenceDemand: Prisma.Decimal) {
  if (finalDemand !== null) {
    return {
      demandUsedMw: finalDemand,
      demandSource: "REE_DEMR" as const
    };
  }
  if (forecastDemand !== null) {
    return {
      demandUsedMw: forecastDemand,
      demandSource: "FORECAST_460" as const
    };
  }
  return {
    demandUsedMw: referenceDemand,
    demandSource: "REFERENCE_REE" as const
  };
}

function calculateTariffIntermediateRows(rows: IntermediateTariffInput[]): TariffComputationResult {
  const dayGroups = new Map<string, TariffDayComputation>();
  const monthGroups = new Map<string, TariffMonthComputation>();

  for (const row of rows) {
    const dayKey = `${row.year}-${padNumber(row.month, 2)}-${padNumber(row.day, 2)}`;
    const monthKey = `${row.year}-${padNumber(row.month, 2)}`;
    const day = dayGroups.get(dayKey) ?? {
      key: dayKey,
      rows: [],
      c0: new Prisma.Decimal(0),
      c1: new Prisma.Decimal(0),
      cf: new Prisma.Decimal(0),
      dayDemand: new Prisma.Decimal(0),
      dayReferenceDemand: new Prisma.Decimal(0)
    };
    const month = monthGroups.get(monthKey) ?? {
      key: monthKey,
      days: [],
      m0: new Prisma.Decimal(0),
      m1: new Prisma.Decimal(0),
      monthDemand: new Prisma.Decimal(0),
      monthReferenceDemand: new Prisma.Decimal(0),
      monthC1Sum: new Prisma.Decimal(0)
    };

    day.rows.push({
      ...row,
      dayKey,
      monthKey,
      h0: new Prisma.Decimal(0),
      h1: new Prisma.Decimal(0),
      hf: new Prisma.Decimal(0),
      dayC0: new Prisma.Decimal(0),
      dayC1: new Prisma.Decimal(0),
      dayCf: new Prisma.Decimal(0),
      monthM0: new Prisma.Decimal(0),
      monthM1: new Prisma.Decimal(0),
      intermediateProfile: new Prisma.Decimal(0)
    });
    day.c0 = day.c0.plus(row.initialProfile);
    day.dayDemand = day.dayDemand.plus(row.demandUsedMw);
    day.dayReferenceDemand = day.dayReferenceDemand.plus(row.referenceDemandMw);

    month.m0 = month.m0.plus(row.initialProfile);
    month.monthDemand = month.monthDemand.plus(row.demandUsedMw);
    month.monthReferenceDemand = month.monthReferenceDemand.plus(row.referenceDemandMw);

    dayGroups.set(dayKey, day);
    monthGroups.set(monthKey, month);
  }

  for (const month of monthGroups.values()) {
    for (const day of dayGroups.values()) {
      if (day.key.startsWith(`${month.key}-`)) {
        month.days.push(day);
      }
    }
  }

  for (const day of dayGroups.values()) {
    if (day.c0.lte(0)) {
      throw new Error(`La suma inicial diaria no es positiva en ${day.key}.`);
    }
    if (day.dayDemand.lte(0) || day.dayReferenceDemand.lte(0)) {
      throw new Error(`La demanda diaria no es positiva en ${day.key}.`);
    }
    const monthGroup = monthGroups.get(day.key.slice(0, 7));
    if (!monthGroup || monthGroup.monthDemand.lte(0) || monthGroup.monthReferenceDemand.lte(0)) {
      throw new Error(`La demanda mensual no es positiva en ${day.key.slice(0, 7)}.`);
    }
    for (const row of day.rows) {
      row.dayC0 = day.c0;
      row.h0 = row.initialProfile.div(day.c0);
      const demandShare = row.demandUsedMw.div(day.dayDemand);
      const referenceShare = row.referenceDemandMw.div(day.dayReferenceDemand);
      const adjustment = new Prisma.Decimal(1).plus(row.alpha.times(demandShare.div(referenceShare).minus(1)));
      row.h1 = row.h0.times(adjustment);
    }
    const dayH1Sum = day.rows.reduce((accumulator, row) => accumulator.plus(row.h1), new Prisma.Decimal(0));
    if (dayH1Sum.lte(0)) {
      throw new Error(`La suma horaria ajustada no es positiva en ${day.key}.`);
    }
    for (const row of day.rows) {
      row.hf = row.h1.div(dayH1Sum);
    }
    const monthGroup2 = monthGroups.get(day.key.slice(0, 7));
    if (!monthGroup2) {
      throw new Error(`No se ha encontrado el mes ${day.key.slice(0, 7)}.`);
    }
    const monthDayShare = day.dayDemand.div(monthGroup2.monthDemand);
    const monthReferenceShare = day.dayReferenceDemand.div(monthGroup2.monthReferenceDemand);
    const dayAdjustment = new Prisma.Decimal(1).plus(day.rows[0].beta.times(monthDayShare.div(monthReferenceShare).minus(1)));
    day.c1 = day.c0.times(dayAdjustment);
    monthGroup2.monthC1Sum = monthGroup2.monthC1Sum.plus(day.c1);
  }

  for (const month of monthGroups.values()) {
    if (month.m0.lte(0)) {
      throw new Error(`La suma inicial mensual no es positiva en ${month.key}.`);
    }
    if (month.monthC1Sum.lte(0)) {
      throw new Error(`La suma diaria ajustada no es positiva en ${month.key}.`);
    }
    const monthAdjustment = new Prisma.Decimal(1).plus(rows[0].gamma.times(month.monthDemand.div(month.monthReferenceDemand).minus(1)));
    month.m1 = month.m0.times(monthAdjustment);
    for (const day of month.days) {
      day.cf = day.c1.div(month.monthC1Sum);
      for (const row of day.rows) {
        row.dayC1 = day.c1;
        row.dayCf = day.cf;
        row.monthM0 = month.m0;
        row.monthM1 = month.m1;
        row.intermediateProfile = row.hf.times(day.cf).times(month.m1);
      }
    }
  }

  const outputRows = rows.map((row) => {
    const dayKey = `${row.year}-${padNumber(row.month, 2)}-${padNumber(row.day, 2)}`;
    const monthKey = `${row.year}-${padNumber(row.month, 2)}`;
    const day = dayGroups.get(dayKey);
    const month = monthGroups.get(monthKey);
    if (!day || !month) {
      throw new Error(`No se ha podido calcular ${dayKey}.`);
    }
    const computed = day.rows.find((item) => item.datetime.toISOString() === row.datetime.toISOString());
    if (!computed) {
      throw new Error(`No se ha podido calcular ${row.datetime.toISOString()}.`);
    }
    return {
      year: row.year,
      datetime: buildProfileDate(row.year, row.month, row.day, row.hour, 0),
      month: row.month,
      day: row.day,
      hour: row.hour,
      tariff: row.tariff,
      initialProfile: row.initialProfile,
      h0: computed.h0,
      h1: computed.h1,
      hf: computed.hf,
      c0: day.c0,
      c1: day.c1,
      cf: day.cf,
      m0: month.m0,
      m1: month.m1,
      intermediateProfile: computed.intermediateProfile,
      demandUsedMw: row.demandUsedMw,
      demandSource: row.demandSource,
      referenceDemandMw: row.referenceDemandMw,
      forecastDemandMw: row.forecastDemandMw,
      finalDemandMw: row.finalDemandMw,
      systemDemandMw: row.demandUsedMw
    };
  });

  return {
    rows: outputRows,
    summary: {
      intermediateProfile: outputRows.reduce((accumulator, row) => accumulator.plus(row.intermediateProfile), new Prisma.Decimal(0))
    }
  };
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function serializeIntermediateRow(row: {
  id: string;
  year: number;
  datetime: Date;
  month: number;
  day: number;
  hour: number;
  tariff: string;
  initialProfile: Prisma.Decimal;
  h0: Prisma.Decimal;
  h1: Prisma.Decimal;
  hf: Prisma.Decimal;
  c0: Prisma.Decimal;
  c1: Prisma.Decimal;
  cf: Prisma.Decimal;
  m0: Prisma.Decimal;
  m1: Prisma.Decimal;
  intermediateProfile: Prisma.Decimal;
  demandUsedMw: Prisma.Decimal;
  demandSource: string;
  referenceDemandMw: Prisma.Decimal;
  forecastDemandMw: Prisma.Decimal | null;
  finalDemandMw: Prisma.Decimal | null;
  systemDemandMw: Prisma.Decimal | null;
  createdAt: Date;
  updatedAt: Date;
}, reeFinalProfile: Prisma.Decimal | null = null) {
  const finalProfileDifference = reeFinalProfile === null ? null : row.intermediateProfile.minus(reeFinalProfile);
  let finalProfileValidationStatus: "VALIDADO" | "DIFERENTE" | "SIN_PERFF" = "SIN_PERFF";
  if (reeFinalProfile !== null) {
    finalProfileValidationStatus = matchesFinalProfileValidation(row.intermediateProfile, reeFinalProfile) ? "VALIDADO" : "DIFERENTE";
  }
  const calculatedIntermediateProfile = row.hf.times(row.cf).times(row.m1);
  const profileValidationDifference = row.intermediateProfile.minus(calculatedIntermediateProfile);
  const profileValidationStatus = matchesProfileValidation(row.intermediateProfile, calculatedIntermediateProfile) ? "VALIDADO" : "DIFERENTE";
  const validationStatus = profileValidationStatus === "DIFERENTE" || finalProfileValidationStatus === "DIFERENTE"
    ? "DIFERENTE"
    : finalProfileValidationStatus === "SIN_PERFF"
      ? "SIN_PERFF"
      : "VALIDADO";
  return {
    id: row.id,
    year: row.year,
    datetime: row.datetime.toISOString(),
    month: row.month,
    day: row.day,
    hour: row.hour,
    tariff: row.tariff as ProfileTariff,
    initialProfile: Number(row.initialProfile),
    h0: Number(row.h0),
    h1: Number(row.h1),
    hf: Number(row.hf),
    c0: Number(row.c0),
    c1: Number(row.c1),
    cf: Number(row.cf),
    m0: Number(row.m0),
    m1: Number(row.m1),
    intermediateProfile: Number(row.intermediateProfile),
    demandUsedMw: Number(row.demandUsedMw),
    demandSource: row.demandSource as "REE_DEMR" | "FINAL_1335" | "FORECAST_460" | "REFERENCE_REE",
    referenceDemandMw: Number(row.referenceDemandMw),
    forecastDemandMw: row.forecastDemandMw === null ? null : Number(row.forecastDemandMw),
    finalDemandMw: row.finalDemandMw === null ? null : Number(row.finalDemandMw),
    systemDemandMw: row.systemDemandMw === null ? null : Number(row.systemDemandMw),
    reeFinalProfile: reeFinalProfile === null ? null : Number(reeFinalProfile),
    finalProfileDifference: finalProfileDifference === null ? null : Number(finalProfileDifference),
    finalProfileValidationStatus,
    calculatedIntermediateProfile: Number(calculatedIntermediateProfile),
    profileValidationDifference: Number(profileValidationDifference),
    profileValidationStatus,
    validationStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function calculateProfileValidationDifference(row: { intermediateProfile: Prisma.Decimal; hf: Prisma.Decimal; cf: Prisma.Decimal; m1: Prisma.Decimal }) {
  return row.intermediateProfile.minus(row.hf.times(row.cf).times(row.m1));
}

function matchesFinalProfileValidation(intermediateProfile: Prisma.Decimal, reeFinalProfile: Prisma.Decimal) {
  return roundDecimal(intermediateProfile, FINAL_PROFILE_VALIDATION_DECIMALS).eq(roundDecimal(reeFinalProfile, FINAL_PROFILE_VALIDATION_DECIMALS));
}

function matchesProfileValidation(intermediateProfile: Prisma.Decimal, calculatedIntermediateProfile: Prisma.Decimal) {
  return roundDecimal(intermediateProfile, PROFILE_VALIDATION_DECIMALS).eq(roundDecimal(calculatedIntermediateProfile, PROFILE_VALIDATION_DECIMALS));
}

function normalizeReferenceDemandForProfiles(referenceDemandMw: Prisma.Decimal) {
  return roundDecimal(referenceDemandMw, 0);
}

function roundDecimal(value: Prisma.Decimal, decimals: number) {
  return new Prisma.Decimal(value.toFixed(decimals));
}

function getFinalProfileForTariff(row: { profile20td: Prisma.Decimal; profile30td: Prisma.Decimal; profile30tdve: Prisma.Decimal } | null, tariff: ProfileTariff) {
  if (!row) {
    return null;
  }
  if (tariff === "2.0TD") {
    return row.profile20td;
  }
  if (tariff === "3.0TD") {
    return row.profile30td;
  }
  return row.profile30tdve;
}

function serializeCalculationLog(row: {
  id: string;
  year: number;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  executionTimeMs: number | null;
  rowsProcessed: number;
  errorMessage: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    year: row.year,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    executionTimeMs: row.executionTimeMs,
    rowsProcessed: row.rowsProcessed,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString()
  };
}

function padNumber(value: number, size: number) {
  return String(value).padStart(size, "0");
}
