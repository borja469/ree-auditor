import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { MedperFileType, Prisma, ReeFileType, ReeImportStatus, ReeSettlementVersion } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { ListRecordsDto } from "./dto/list-records.dto";
import { LiquidationAnalysisQueryDto } from "./dto/liquidation-analysis-query.dto";
import { MedperQueryDto } from "./dto/medper-query.dto";
import { SettlementQueryDto } from "./dto/settlement-query.dto";
import { extractSourceFiles, SourceFile } from "./parsers/archive.parser";
import {
  MedperFileMetadata,
  MedperParseIssue,
  parseMedperFileMetadata,
  parseMedperRecords,
  ParsedMedperqhRecord
} from "./parsers/medper.parser";
import {
  detectDelimiter,
  parseA1ReganecuRecords,
  parseReeFileMetadata,
  ParsedA1Record,
  ParseIssue,
  ReeFileMetadata
} from "./parsers/reganecu.parser";

type ImportResultStatus = "IMPORTED" | "FAILED" | "DUPLICATE";
type ImportableFile = Pick<Express.Multer.File, "originalname" | "buffer" | "size">;

const FILE_SELECT = {
  id: true,
  fileName: true,
  containerFileName: true,
  fileHash: true,
  tipoArchivo: true,
  version: true,
  fechaLiquidacion: true,
  sujetoEic: true,
  encoding: true,
  delimiter: true,
  status: true,
  errorMessage: true,
  importedAt: true,
  totalRecords: true,
  validRecords: true,
  invalidRecords: true,
  duplicatedRecords: true
} satisfies Prisma.ReeFileSelect;

const MEDPER_FILE_SELECT = {
  id: true,
  fileName: true,
  containerFileName: true,
  fileHash: true,
  tipoArchivo: true,
  version: true,
  fechaInicio: true,
  fechaFin: true,
  sujetoEic: true,
  encoding: true,
  delimiter: true,
  status: true,
  errorMessage: true,
  importedAt: true,
  totalRecords: true,
  validRecords: true,
  invalidRecords: true,
  duplicatedRecords: true
} satisfies Prisma.MedperFileSelect;

const MEDPER_QH_RECORD_SELECT = {
  id: true,
  fileId: true,
  tipoArchivo: true,
  version: true,
  fechaInicio: true,
  fechaFin: true,
  sujetoEic: true,
  fecha: true,
  timestamp: true,
  hora: true,
  cuartoHora: true,
  codigoUnidad: true,
  peaje: true,
  programaEnergiaMwh: true,
  perdidasMwh: true,
  bcMwh: true,
  pfMwh: true,
  bcPfDifferenceMwh: true,
  negativeEnergy: true,
  bcPfInconsistent: true,
  validationErrors: true,
  rawPayloadJson: true,
  sourceLineNumber: true,
  recordHash: true,
  createdAt: true
} satisfies Prisma.MedperqhRecordSelect;

const REE_FILE_ACTION_SELECT = {
  ...FILE_SELECT,
  originalContent: true
} satisfies Prisma.ReeFileSelect;

const MEDPER_FILE_ACTION_SELECT = {
  ...MEDPER_FILE_SELECT,
  originalContent: true
} satisfies Prisma.MedperFileSelect;

type ReeFileSummary = Prisma.ReeFileGetPayload<{ select: typeof FILE_SELECT }>;
type MedperFileSummary = Prisma.MedperFileGetPayload<{ select: typeof MEDPER_FILE_SELECT }>;
type ReeFileAction = Prisma.ReeFileGetPayload<{ select: typeof REE_FILE_ACTION_SELECT }>;
type MedperFileAction = Prisma.MedperFileGetPayload<{ select: typeof MEDPER_FILE_ACTION_SELECT }>;
type SettlementFilterOptions = {
  versions: string[];
  months: string[];
  brps: string[];
  subjects: string[];
  segments: string[];
  priceCodes: string[];
  settlementCodes: string[];
  eicUprs: string[];
  latestMonth: string | null;
};
type MedperFilterOptions = {
  versions: string[];
  months: string[];
  brps: string[];
  subjects: string[];
  qhPeajes: string[];
  qhUnits: string[];
  latestMonth: string | null;
};
type LiquidationAnalysisFilterOptions = {
  versions: string[];
  months: string[];
  latestVersionByMonth: Array<{ month: string; version: string }>;
  latestMonth: string | null;
};
type MonthOptionRow = {
  month: string | null;
};
type DistinctTextOptionRow = {
  value: string | null;
};
type MonthVersionOptionRow = {
  month: string | null;
  version: string | null;
};
type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};
type MonthlyConsumptionAggregateRow = {
  month: string;
  version: string;
  pfMwh: { toString(): string } | string | number | null;
  perdidasMwh: { toString(): string } | string | number | null;
};
type SummaryGroup = {
  fechaLiquidacion: Date;
  version: ReeSettlementVersion;
  segmento: string | null;
  records: number;
  sums: {
    energiaMwh: string;
    importeEur: string;
    importeCalculadoEur: string;
  };
};
type QhSummaryAccumulator = {
  fechaLiquidacion: Date;
  version: ReeSettlementVersion;
  segmento: string | null;
  records: number;
  importeEur: number;
  importeCalculadoEur: number;
  hourlyEnergy: Map<string, { sum: number; count: number }>;
};

type ImportResult = {
  fileName: string;
  status: ImportResultStatus;
  file?: ReeFileSummary | MedperFileSummary;
  recordsImported: number;
  validRecords: number;
  invalidRecords: number;
  duplicatedRecords: number;
  errors: Array<{
    sourceFileName: string;
    lineNumber: number;
    message: string;
  }>;
};
type ImportUploadOptions = {
  overwrite?: boolean;
  auditUser?: string;
};
type ImportConflict = {
  fileName: string;
  tipoArchivo: string;
  fecha: string;
  version: string;
  existingFileId: string;
  existingFileName: string;
  existingImportedAt: Date;
};
type ImportSourcePlan = {
  sourceFiles: SourceFile[];
  initialResults: ImportResult[];
};
type DbClient = PrismaService | Prisma.TransactionClient;
type ImportFileActionTarget =
  | {
      kind: "reganecu";
      file: ReeFileAction;
    }
  | {
      kind: "medper";
      file: MedperFileAction;
    };
type ImportIssueRow = {
  sourceFileName: string;
  lineNumber: number;
  message: string;
  rawLine?: string | null;
};

const PAGE_SIZE_DEFAULT = 100;
const PAGE_SIZE_MAX = 1000;
const INSERT_BATCH_SIZE = 5000;
const BC_PF_TOLERANCE_MWH = 0.001;
const PRISMA_POOL_RETRIES = 3;
const FILTER_OPTIONS_CACHE_MS = 60000;

@Injectable()
export class ImportsService {
  private settlementFilterOptionsCache?: CacheEntry<SettlementFilterOptions>;
  private medperFilterOptionsCache?: CacheEntry<MedperFilterOptions>;
  private liquidationAnalysisFilterOptionsCache?: CacheEntry<LiquidationAnalysisFilterOptions>;

  constructor(private readonly prisma: PrismaService) {}

  async listFiles(query: ListRecordsDto) {
    return runWithPrismaRetry(() =>
      this.prisma.reeFile.findMany({
        orderBy: {
          importedAt: "desc"
        },
        select: FILE_SELECT,
        skip: query.skip,
        take: clampTake(query.take)
      })
    );
  }

  async getFile(id: string) {
    const file = await this.prisma.reeFile.findUnique({
      where: {
        id
      },
      select: {
        ...FILE_SELECT,
        _count: {
          select: {
            reganecuRecords: true,
            reganecuQhRecords: true
          }
        }
      }
    });

    if (!file) {
      throw new BadRequestException(`No existe el fichero REE ${id}.`);
    }

    return file;
  }

  async getImportFileDetail(id: string) {
    const target = await this.findImportFileForAction(id);
    const [recordCounts, errors, preview] = await Promise.all([
      this.getImportRecordCounts(target),
      this.collectImportIssues(target, 100),
      this.getImportRecordPreview(target)
    ]);

    return {
      kind: target.kind,
      file: stripOriginalContent(target.file),
      recordCounts,
      errors,
      preview
    };
  }

  async getImportErrorsCsv(id: string) {
    const target = await this.findImportFileForAction(id);
    const errors = await this.collectImportIssues(target);
    const file = stripOriginalContent(target.file);
    const rows = errors.map((error) => [
      target.kind,
      file.tipoArchivo,
      file.version,
      getImportFilePeriod(file),
      file.fileName,
      error.sourceFileName,
      error.lineNumber,
      error.message,
      error.rawLine ?? ""
    ]);

    return {
      fileName: `${safeDownloadBaseName(file.fileName)}-errores.csv`,
      content: buildSemicolonCsv(
        ["origen", "tipo_fichero", "version", "periodo", "archivo", "archivo_origen", "linea", "mensaje", "contenido"],
        rows
      )
    };
  }

  async getImportFileLogs(id: string) {
    const target = await this.findImportFileForAction(id);
    const [recordCounts, errors] = await Promise.all([this.getImportRecordCounts(target), this.collectImportIssues(target, 100)]);
    const file = stripOriginalContent(target.file);
    const lines = [
      `Fichero: ${file.fileName}`,
      `Origen: ${target.kind}`,
      `Tipo: ${file.tipoArchivo}`,
      `Version: ${file.version}`,
      `Periodo: ${getImportFilePeriod(file)}`,
      `Estado: ${file.status}`,
      `Fecha carga: ${file.importedAt.toISOString()}`,
      `Registros declarados: ${file.totalRecords}`,
      `Validos: ${file.validRecords}`,
      `Invalidos: ${file.invalidRecords}`,
      `Duplicados: ${file.duplicatedRecords}`,
      `Registros persistidos: ${recordCounts.total}`,
      `Contenido original: ${target.file.originalContent ? "disponible" : "no disponible"}`,
      file.errorMessage ? `Mensaje almacenado: ${file.errorMessage}` : "Mensaje almacenado: -",
      errors.length > 0 ? `Errores detectados: ${errors.length}${errors.length === 100 ? " o mas" : ""}` : "Errores detectados: 0",
      ...errors.slice(0, 100).map((error) => `Linea ${error.lineNumber} (${error.sourceFileName}): ${error.message}`)
    ];

    return {
      kind: target.kind,
      file,
      recordCounts,
      errors,
      lines,
      text: lines.join("\n")
    };
  }

  async reprocessImportFile(id: string, options: ImportUploadOptions = {}) {
    const target = await this.findImportFileForAction(id);
    if (!target.file.originalContent) {
      throw new BadRequestException(`No existe contenido original para reprocesar ${target.file.fileName}.`);
    }

    const buffer = Buffer.from(target.file.originalContent);
    const upload = {
      originalname: target.file.fileName,
      buffer,
      size: buffer.byteLength
    } as Express.Multer.File;

    return target.kind === "reganecu"
      ? this.importReganecuFiles([upload], { ...options, overwrite: true })
      : this.importMedperFiles([upload], { ...options, overwrite: true });
  }

  async deleteImportFile(id: string) {
    const target = await this.findImportFileForAction(id);
    const file = stripOriginalContent(target.file);

    if (target.kind === "reganecu") {
      await this.prisma.reeFile.delete({
        where: {
          id
        }
      });
    } else {
      await this.prisma.medperFile.delete({
        where: {
          id
        }
      });
    }

    this.clearFilterOptionsCache();
    return {
      kind: target.kind,
      deletedFileId: id,
      deletedFileName: file.fileName,
      deletedRecords: file.totalRecords
    };
  }

  async importReganecuFiles(files: Express.Multer.File[], options: ImportUploadOptions = {}) {
    if (files.length === 0) {
      throw new BadRequestException("Debe adjuntarse al menos un fichero multipart.");
    }

    const plan = buildSourcePlan(files);
    await this.validateReeUploadConflicts(plan.sourceFiles, options.overwrite);

    const results: ImportResult[] = [...plan.initialResults];
    for (const sourceFile of plan.sourceFiles) {
      results.push(await this.importSourceFile(sourceFile, options));
    }

    this.clearFilterOptionsCache();
    return buildImportResponse(results, files.length);
  }

  async settlementFilterOptions(): Promise<SettlementFilterOptions> {
    const cached = readCache(this.settlementFilterOptionsCache);
    if (cached) {
      return cached;
    }

    const [versions, months, brps, subjects, segments, priceCodes, settlementCodes, eicUprs] = await Promise.all([
      this.getReganecuVersionOptions(),
      this.getReganecuMonthOptions(),
      this.getReganecuBrpOptions(),
      this.getReganecuSubjectOptions(),
      this.getReganecuSegmentOptions(),
      this.getReganecuPriceCodeOptions(),
      this.getReganecuSettlementCodeOptions(),
      this.getReganecuEicUprOptions()
    ]);

    const options = {
      versions,
      months,
      brps,
      subjects,
      segments,
      priceCodes,
      settlementCodes,
      eicUprs,
      latestMonth: months[0] ?? null
    };

    this.settlementFilterOptionsCache = writeCache(options);
    return options;
  }

  async listMedperFiles(query: ListRecordsDto) {
    return runWithPrismaRetry(() =>
      this.prisma.medperFile.findMany({
        where: {
          tipoArchivo: MedperFileType.MEDPERQH
        },
        orderBy: {
          importedAt: "desc"
        },
        select: MEDPER_FILE_SELECT,
        skip: query.skip,
        take: clampTake(query.take)
      })
    );
  }

  async medperFilterOptions() {
    const cached = readCache(this.medperFilterOptionsCache);
    if (cached) {
      return cached;
    }

    const [versions, monthRows, brps, subjects, qhPeajes, qhUnits] = await Promise.all([
      this.getMedperVersionOptions(),
      this.getMedperMonthOptions(),
      this.getMedperBrpOptions(),
      this.getMedperSubjectOptions(),
      this.getMedperQhPeajeOptions(),
      this.getMedperQhUnitOptions()
    ]);

    const monthKeys = normalizeMonthOptionRows(monthRows);

    const options = {
      versions,
      months: monthKeys,
      brps,
      subjects,
      qhPeajes,
      qhUnits,
      latestMonth: monthKeys[0] ?? null
    } satisfies MedperFilterOptions;

    this.medperFilterOptionsCache = writeCache(options);
    return options;
  }

  async liquidationAnalysisFilterOptions() {
    const cached = readCache(this.liquidationAnalysisFilterOptionsCache);
    if (cached) {
      return cached;
    }

    const [versions, months, latestVersionByMonth] = await Promise.all([
      this.getLiquidationAnalysisVersionOptions(),
      this.getLiquidationAnalysisMonthOptions(),
      this.getLiquidationAnalysisLatestVersionByMonth()
    ]);

    const options = {
      versions,
      months,
      latestVersionByMonth,
      latestMonth: months[0] ?? null
    } satisfies LiquidationAnalysisFilterOptions;

    this.liquidationAnalysisFilterOptionsCache = writeCache(options);
    return options;
  }

  private async getReganecuMonthOptions() {
    return runWithPrismaRetry(() =>
      this.prisma.$queryRaw<MonthOptionRow[]>`
        SELECT month
        FROM (
          SELECT to_char(COALESCE(fecha, fecha_liquidacion), 'YYYY-MM') AS month
          FROM reganecu_records
          UNION
          SELECT to_char(COALESCE(fecha, fecha_liquidacion), 'YYYY-MM') AS month
          FROM reganecu_qh_records
          UNION
          SELECT to_char(fecha_liquidacion, 'YYYY-MM') AS month
          FROM ree_files
          WHERE status = 'IMPORTED'
        ) month_options
        WHERE month IS NOT NULL
        GROUP BY month
        ORDER BY month DESC
      `
    ).then(normalizeMonthOptionRows);
  }

  private async getMedperMonthOptions() {
    return runWithPrismaRetry(() =>
      this.prisma.$queryRaw<MonthOptionRow[]>`
        SELECT to_char(fecha, 'YYYY-MM') AS month
        FROM medperqh_records
        WHERE fecha IS NOT NULL
        GROUP BY to_char(fecha, 'YYYY-MM')
        ORDER BY month DESC
      `
    );
  }

  private async getReganecuVersionOptions() {
    return runWithPrismaRetry(() =>
      this.prisma.$queryRaw<DistinctTextOptionRow[]>`
        SELECT DISTINCT value
        FROM (
          SELECT version::text AS value FROM reganecu_records
          UNION
          SELECT version::text AS value FROM reganecu_qh_records
          UNION
          SELECT version::text AS value FROM ree_files WHERE status = 'IMPORTED'
        ) distinct_options
        WHERE value IS NOT NULL AND btrim(value) <> ''
        ORDER BY value
      `
    ).then(normalizeTextOptionRows);
  }

  private async getReganecuBrpOptions() {
    return runWithPrismaRetry(() =>
      this.prisma.$queryRaw<DistinctTextOptionRow[]>`
        SELECT DISTINCT value
        FROM (
          SELECT brp AS value FROM reganecu_records
          UNION
          SELECT codigo_agente_vendedor AS value FROM reganecu_records
          UNION
          SELECT eic_titular AS value FROM reganecu_records
          UNION
          SELECT brp AS value FROM reganecu_qh_records
          UNION
          SELECT codigo_agente_vendedor AS value FROM reganecu_qh_records
          UNION
          SELECT eic_titular AS value FROM reganecu_qh_records
        ) distinct_options
        WHERE value IS NOT NULL AND btrim(value) <> ''
        ORDER BY value
      `
    ).then(normalizeTextOptionRows);
  }

  private async getReganecuSubjectOptions() {
    return runWithPrismaRetry(() =>
      this.prisma.$queryRaw<DistinctTextOptionRow[]>`
        SELECT DISTINCT value
        FROM (
          SELECT sujeto_eic AS value FROM reganecu_records
          UNION
          SELECT sujeto_eic AS value FROM reganecu_qh_records
          UNION
          SELECT sujeto_eic AS value FROM ree_files WHERE status = 'IMPORTED'
        ) distinct_options
        WHERE value IS NOT NULL AND btrim(value) <> ''
        ORDER BY value
      `
    ).then(normalizeTextOptionRows);
  }

  private async getReganecuSegmentOptions() {
    return runWithPrismaRetry(() =>
      this.prisma.$queryRaw<DistinctTextOptionRow[]>`
        SELECT DISTINCT value
        FROM (
          SELECT segmento AS value FROM reganecu_records
          UNION
          SELECT segmento AS value FROM reganecu_qh_records
        ) distinct_options
        WHERE value IS NOT NULL AND btrim(value) <> ''
        ORDER BY value
      `
    ).then(normalizeTextOptionRows);
  }

  private async getReganecuPriceCodeOptions() {
    return runWithPrismaRetry(() =>
      this.prisma.$queryRaw<DistinctTextOptionRow[]>`
        SELECT DISTINCT value
        FROM (
          SELECT codigo_precio AS value FROM reganecu_records
          UNION
          SELECT codigo_precio AS value FROM reganecu_qh_records
        ) distinct_options
        WHERE value IS NOT NULL AND btrim(value) <> ''
        ORDER BY value
      `
    ).then(normalizeTextOptionRows);
  }

  private async getReganecuSettlementCodeOptions() {
    return runWithPrismaRetry(() =>
      this.prisma.$queryRaw<DistinctTextOptionRow[]>`
        SELECT DISTINCT value
        FROM (
          SELECT codigo_apunte AS value FROM reganecu_records
          UNION
          SELECT codigo_apunte AS value FROM reganecu_qh_records
        ) distinct_options
        WHERE value IS NOT NULL AND btrim(value) <> ''
        ORDER BY value
      `
    ).then(normalizeTextOptionRows);
  }

  private async getReganecuEicUprOptions() {
    return runWithPrismaRetry(() =>
      this.prisma.$queryRaw<DistinctTextOptionRow[]>`
        SELECT DISTINCT value
        FROM (
          SELECT eic_upr AS value FROM reganecu_records
          UNION
          SELECT eic_upr AS value FROM reganecu_qh_records
        ) distinct_options
        WHERE value IS NOT NULL AND btrim(value) <> ''
        ORDER BY value
      `
    ).then(normalizeTextOptionRows);
  }

  private async getMedperVersionOptions() {
    return runWithPrismaRetry(() =>
      this.prisma.$queryRaw<DistinctTextOptionRow[]>`
        SELECT DISTINCT value
        FROM (
          SELECT version AS value FROM medperqh_records
          UNION
          SELECT version AS value FROM medper_files WHERE status = 'IMPORTED' AND tipo_archivo = 'MEDPERQH'
        ) distinct_options
        WHERE value IS NOT NULL AND btrim(value) <> ''
        ORDER BY value
      `
    ).then((rows) => sortMedperVersions(normalizeTextOptionRows(rows)));
  }

  private async getMedperBrpOptions() {
    return runWithPrismaRetry(() =>
      this.prisma.$queryRaw<DistinctTextOptionRow[]>`
        SELECT DISTINCT value
        FROM (
          SELECT codigo_unidad AS value FROM medperqh_records
          UNION
          SELECT sujeto_eic AS value FROM medperqh_records
        ) distinct_options
        WHERE value IS NOT NULL AND btrim(value) <> ''
        ORDER BY value
      `
    ).then(normalizeTextOptionRows);
  }

  private async getMedperSubjectOptions() {
    return runWithPrismaRetry(() =>
      this.prisma.$queryRaw<DistinctTextOptionRow[]>`
        SELECT DISTINCT value
        FROM (
          SELECT sujeto_eic AS value FROM medperqh_records
          UNION
          SELECT sujeto_eic AS value FROM medper_files WHERE status = 'IMPORTED' AND tipo_archivo = 'MEDPERQH'
        ) distinct_options
        WHERE value IS NOT NULL AND btrim(value) <> ''
        ORDER BY value
      `
    ).then(normalizeTextOptionRows);
  }

  private async getMedperQhPeajeOptions() {
    return runWithPrismaRetry(() =>
      this.prisma.$queryRaw<DistinctTextOptionRow[]>`
        SELECT DISTINCT peaje AS value
        FROM medperqh_records
        WHERE peaje IS NOT NULL AND btrim(peaje) <> ''
        ORDER BY peaje
      `
    ).then(normalizeTextOptionRows);
  }

  private async getMedperQhUnitOptions() {
    return runWithPrismaRetry(() =>
      this.prisma.$queryRaw<DistinctTextOptionRow[]>`
        SELECT DISTINCT codigo_unidad AS value
        FROM medperqh_records
        WHERE codigo_unidad IS NOT NULL AND btrim(codigo_unidad) <> ''
        ORDER BY codigo_unidad
      `
    ).then(normalizeTextOptionRows);
  }

  private async getLiquidationAnalysisVersionOptions() {
    return runWithPrismaRetry(() =>
      this.prisma.$queryRaw<DistinctTextOptionRow[]>`
        SELECT DISTINCT upper(btrim(value)) AS value
        FROM (
          SELECT version::text AS value FROM reganecu_records
          UNION
          SELECT version::text AS value FROM reganecu_qh_records
          UNION
          SELECT version AS value FROM medperqh_records
        ) distinct_options
        WHERE value IS NOT NULL
          AND btrim(value) <> ''
          AND upper(btrim(value)) ~ '^C[1-5]$'
        ORDER BY value
      `
    ).then(normalizeTextOptionRows);
  }

  private async getLiquidationAnalysisMonthOptions() {
    return runWithPrismaRetry(() =>
      this.prisma.$queryRaw<MonthOptionRow[]>`
        SELECT month
        FROM (
          SELECT to_char(fecha, 'YYYY-MM') AS month FROM medperqh_records
          UNION
          SELECT to_char(fecha, 'YYYY-MM') AS month FROM reganecu_records
          UNION
          SELECT to_char(fecha, 'YYYY-MM') AS month FROM reganecu_qh_records
        ) month_options
        WHERE month IS NOT NULL
        GROUP BY month
        ORDER BY month DESC
      `
    ).then(normalizeMonthOptionRows);
  }

  private async getLiquidationAnalysisLatestVersionByMonth() {
    const rows = await runWithPrismaRetry(() =>
      this.prisma.$queryRaw<MonthVersionOptionRow[]>`
        SELECT month, version
        FROM (
          SELECT to_char(fecha, 'YYYY-MM') AS month, version::text AS version FROM medperqh_records
          UNION
          SELECT to_char(COALESCE(fecha, fecha_liquidacion), 'YYYY-MM') AS month, version::text AS version FROM reganecu_records
          UNION
          SELECT to_char(COALESCE(fecha, fecha_liquidacion), 'YYYY-MM') AS month, version::text AS version FROM reganecu_qh_records
        ) version_options
        WHERE month IS NOT NULL
          AND version IS NOT NULL
          AND upper(btrim(version)) ~ '^C[1-5]$'
        GROUP BY month, version
      `
    );

    const byMonth = new Map<string, string[]>();
    for (const row of rows) {
      const month = row.month?.trim();
      const version = row.version?.trim().toUpperCase();
      if (!month || !version) {
        continue;
      }
      byMonth.set(month, [...(byMonth.get(month) ?? []), version]);
    }

    return [...byMonth.entries()]
      .map(([month, versions]) => ({
        month,
        version: latestSortedVersion(versions)
      }))
      .sort((left, right) => right.month.localeCompare(left.month));
  }

  private clearFilterOptionsCache() {
    this.settlementFilterOptionsCache = undefined;
    this.medperFilterOptionsCache = undefined;
    this.liquidationAnalysisFilterOptionsCache = undefined;
  }

  async importMedperFiles(files: Express.Multer.File[], options: ImportUploadOptions = {}) {
    if (files.length === 0) {
      throw new BadRequestException("Debe adjuntarse al menos un fichero multipart.");
    }

    const plan = buildSourcePlan(files);
    await this.validateMedperUploadConflicts(plan.sourceFiles, options.overwrite);

    const results: ImportResult[] = [...plan.initialResults];
    for (const sourceFile of plan.sourceFiles) {
      results.push(await this.importMedperSourceFile(sourceFile, options));
    }

    this.clearFilterOptionsCache();
    return buildImportResponse(results, files.length);
  }

  private async validateReeUploadConflicts(sourceFiles: SourceFile[], overwrite = false) {
    const candidates = sourceFiles.flatMap((sourceFile) => {
      try {
        const metadata = parseReeFileMetadata(sourceFile.name);
        return [{ sourceFile, metadata }];
      } catch {
        return [];
      }
    });
    validateIncomingDuplicateKeys(
      candidates.map(({ sourceFile, metadata }) => ({
        fileName: sourceFile.name,
        key: importKey(metadata.tipoArchivo, dateKey(metadata.fechaLiquidacion), metadata.version)
      }))
    );

    if (overwrite) {
      return;
    }

    const conflicts: ImportConflict[] = [];
    for (const { sourceFile, metadata } of candidates) {
      const existingFile = await this.findExistingReeImport(metadata);
      if (existingFile) {
        conflicts.push(buildReeImportConflict(sourceFile.name, metadata, existingFile));
      }
    }

    throwIfImportConflicts(conflicts);
  }

  private async validateMedperUploadConflicts(sourceFiles: SourceFile[], overwrite = false) {
    const candidates = sourceFiles.flatMap((sourceFile) => {
      try {
        const metadata = parseMedperFileMetadata(sourceFile.name);
        return [{ sourceFile, metadata }];
      } catch {
        return [];
      }
    });
    validateIncomingDuplicateKeys(
      candidates.map(({ sourceFile, metadata }) => ({
        fileName: sourceFile.name,
        key: importKey(metadata.tipoArchivo, dateKey(metadata.fechaInicio), metadata.version)
      }))
    );

    if (overwrite) {
      return;
    }

    const conflicts: ImportConflict[] = [];
    for (const { sourceFile, metadata } of candidates) {
      const existingFile = await this.findExistingMedperImport(metadata);
      if (existingFile) {
        conflicts.push(buildMedperImportConflict(sourceFile.name, metadata, existingFile));
      }
    }

    throwIfImportConflicts(conflicts);
  }

  private findExistingReeImport(metadata: ReeFileMetadata, db: DbClient = this.prisma) {
    return db.reeFile.findFirst({
      where: buildReeImportConflictWhere(metadata),
      orderBy: {
        importedAt: "desc"
      },
      select: FILE_SELECT
    });
  }

  private findExistingMedperImport(metadata: MedperFileMetadata, db: DbClient = this.prisma) {
    return db.medperFile.findFirst({
      where: buildMedperImportConflictWhere(metadata),
      orderBy: {
        importedAt: "desc"
      },
      select: MEDPER_FILE_SELECT
    });
  }

  private async findImportFileForAction(id: string): Promise<ImportFileActionTarget> {
    const reeFile = await this.prisma.reeFile.findUnique({
      where: {
        id
      },
      select: REE_FILE_ACTION_SELECT
    });

    if (reeFile) {
      return {
        kind: "reganecu",
        file: reeFile
      };
    }

    const medperFile = await this.prisma.medperFile.findUnique({
      where: {
        id
      },
      select: MEDPER_FILE_ACTION_SELECT
    });

    if (medperFile) {
      return {
        kind: "medper",
        file: medperFile
      };
    }

    throw new BadRequestException(`No existe la carga historica ${id}.`);
  }

  private async getImportRecordCounts(target: ImportFileActionTarget) {
    if (target.kind === "reganecu") {
      const [reganecu, reganecuQh] = await Promise.all([
        this.prisma.reganecuRecord.count({
          where: {
            fileId: target.file.id
          }
        }),
        this.prisma.reganecuQhRecord.count({
          where: {
            fileId: target.file.id
          }
        })
      ]);

      return {
        total: reganecu + reganecuQh,
        reganecu,
        reganecuQh,
        medperup: 0,
        medperqh: 0
      };
    }

    const [medperup, medperqh] = await Promise.all([
      this.prisma.medperupRecord.count({
        where: {
          fileId: target.file.id
        }
      }),
      this.prisma.medperqhRecord.count({
        where: {
          fileId: target.file.id
        }
      })
    ]);

    return {
      total: medperup + medperqh,
      reganecu: 0,
      reganecuQh: 0,
      medperup,
      medperqh
    };
  }

  private async getImportRecordPreview(target: ImportFileActionTarget) {
    if (target.kind === "reganecu" && target.file.tipoArchivo === ReeFileType.REGANECU) {
      const rows = await this.prisma.reganecuRecord.findMany({
        where: {
          fileId: target.file.id
        },
        orderBy: {
          sourceLineNumber: "asc"
        },
        take: 20,
        select: {
          sourceLineNumber: true,
          fecha: true,
          hora: true,
          segmento: true,
          codigoUpr: true,
          eicUpr: true,
          codigoPrecio: true,
          codigoApunte: true,
          energiaMwh: true,
          precioEurMwh: true,
          importeEur: true
        }
      });

      return rows.map((row) => ({
        linea: row.sourceLineNumber,
        fecha: row.fecha ? dateKey(row.fecha) : null,
        hora: row.hora,
        segmento: row.segmento,
        codigoUpr: row.codigoUpr,
        eicUpr: row.eicUpr,
        codigoPrecio: row.codigoPrecio,
        codigoApunte: row.codigoApunte,
        energiaMwh: decimalToText(row.energiaMwh),
        precioEurMwh: decimalToText(row.precioEurMwh),
        importeEur: decimalToText(row.importeEur)
      }));
    }

    if (target.kind === "reganecu") {
      const rows = await this.prisma.reganecuQhRecord.findMany({
        where: {
          fileId: target.file.id
        },
        orderBy: {
          sourceLineNumber: "asc"
        },
        take: 20,
        select: {
          sourceLineNumber: true,
          fecha: true,
          hora: true,
          campoHora25: true,
          segmento: true,
          codigoUpr: true,
          eicUpr: true,
          codigoPrecio: true,
          codigoApunte: true,
          energiaMwh: true,
          precioEurMwh: true,
          importeEur: true
        }
      });

      return rows.map((row) => ({
        linea: row.sourceLineNumber,
        fecha: row.fecha ? dateKey(row.fecha) : null,
        hora: row.hora,
        campoHora25: row.campoHora25,
        segmento: row.segmento,
        codigoUpr: row.codigoUpr,
        eicUpr: row.eicUpr,
        codigoPrecio: row.codigoPrecio,
        codigoApunte: row.codigoApunte,
        energiaMwh: decimalToText(row.energiaMwh),
        precioEurMwh: decimalToText(row.precioEurMwh),
        importeEur: decimalToText(row.importeEur)
      }));
    }

    const rows = await this.prisma.medperqhRecord.findMany({
      where: {
        fileId: target.file.id
      },
      orderBy: {
        sourceLineNumber: "asc"
      },
      take: 20,
      select: {
        sourceLineNumber: true,
        fecha: true,
        hora: true,
        cuartoHora: true,
        codigoUnidad: true,
        peaje: true,
        programaEnergiaMwh: true,
        perdidasMwh: true,
        bcMwh: true,
        pfMwh: true
      }
    });

    return rows.map((row) => ({
      linea: row.sourceLineNumber,
      fecha: dateKey(row.fecha),
      hora: row.hora,
      cuartoHora: row.cuartoHora,
      codigoUnidad: row.codigoUnidad,
      peaje: row.peaje,
      programaEnergiaMwh: decimalToText(row.programaEnergiaMwh),
      perdidasMwh: decimalToText(row.perdidasMwh),
      bcMwh: decimalToText(row.bcMwh),
      pfMwh: decimalToText(row.pfMwh)
    }));
  }

  private async collectImportIssues(target: ImportFileActionTarget, limit = Number.MAX_SAFE_INTEGER): Promise<ImportIssueRow[]> {
    const storedErrors = parseStoredImportErrors(target.file.errorMessage);
    if (!target.file.originalContent) {
      return storedErrors.slice(0, limit);
    }

    const sourceFiles = extractSourceFiles(target.file.fileName, Buffer.from(target.file.originalContent));
    const issues: ImportIssueRow[] = [];
    for (const sourceFile of sourceFiles) {
      if (target.kind === "reganecu") {
        this.collectReeSourceIssues(sourceFile, issues, limit);
      } else {
        this.collectMedperSourceIssues(sourceFile, issues, limit);
      }

      if (issues.length >= limit) {
        break;
      }
    }

    return issues.length > 0 ? issues.slice(0, limit) : storedErrors.slice(0, limit);
  }

  private collectReeSourceIssues(sourceFile: SourceFile, issues: ImportIssueRow[], limit: number) {
    let metadata: ReeFileMetadata;
    try {
      metadata = parseReeFileMetadata(sourceFile.name);
    } catch (error) {
      issues.push({
        sourceFileName: sourceFile.name,
        lineNumber: 0,
        message: error instanceof Error ? error.message : "Nombre de fichero no valido."
      });
      return;
    }

    const delimiter = detectDelimiter(sourceFile.content);
    for (const result of parseA1ReganecuRecords({
      sourceFileName: sourceFile.name,
      content: sourceFile.content,
      delimiter,
      metadata
    })) {
      if (result.error) {
        issues.push(toImportIssueRow(result.error));
      } else if (result.record?.validationErrors.length) {
        issues.push({
          sourceFileName: sourceFile.name,
          lineNumber: result.record.sourceLineNumber,
          message: result.record.validationErrors.join(", "),
          rawLine: result.record.rawLine
        });
      }

      if (issues.length >= limit) {
        return;
      }
    }
  }

  private collectMedperSourceIssues(sourceFile: SourceFile, issues: ImportIssueRow[], limit: number) {
    let metadata: MedperFileMetadata;
    try {
      metadata = parseMedperFileMetadata(sourceFile.name);
    } catch (error) {
      issues.push({
        sourceFileName: sourceFile.name,
        lineNumber: 0,
        message: error instanceof Error ? error.message : "Nombre de fichero MEDPER no valido."
      });
      return;
    }

    const delimiter = detectDelimiter(sourceFile.content);
    for (const result of parseMedperRecords({
      sourceFileName: sourceFile.name,
      content: sourceFile.content,
      delimiter,
      metadata
    })) {
      if (result.error) {
        issues.push(toImportIssueRow(result.error));
      } else if (result.record?.validationErrors.length) {
        issues.push({
          sourceFileName: sourceFile.name,
          lineNumber: result.record.sourceLineNumber,
          message: result.record.validationErrors.join(", "),
          rawLine: result.record.rawLine
        });
      }

      if (issues.length >= limit) {
        return;
      }
    }
  }

  private async writeOverwriteAudit(
    db: DbClient,
    user: string | undefined,
    tipoArchivo: ReeFileType | MedperFileType,
    fecha: Date,
    version: string,
    replacedFiles: Array<ReeFileSummary | MedperFileSummary>,
    newFile: ReeFileSummary | MedperFileSummary
  ) {
    if (replacedFiles.length === 0) {
      return;
    }

    await db.importOverwriteAudit.createMany({
      data: replacedFiles.map((replacedFile) => ({
        usuario: user?.trim() || "web",
        tipoArchivo: String(tipoArchivo).toLowerCase(),
        fecha,
        version,
        replacedFileId: replacedFile.id,
        replacedFileName: replacedFile.fileName,
        replacedImportedAt: replacedFile.importedAt,
        newFileId: newFile.id,
        newFileName: newFile.fileName
      }))
    });
  }

  async listReganecu(query: SettlementQueryDto) {
    return runWithPrismaRetry(() =>
      this.prisma.reganecuRecord.findMany({
        where: buildReganecuWhere(query),
        orderBy: [{ fecha: "asc" }, { hora: "asc" }, { codigoApunte: "asc" }],
        skip: query.skip,
        take: clampTake(query.take),
        include: {
          file: {
            select: FILE_SELECT
          }
        }
      })
    );
  }

  async getReganecuRecord(id: string) {
    const record = await this.prisma.reganecuRecord.findUnique({
      where: {
        id
      },
      include: {
        file: {
          select: FILE_SELECT
        }
      }
    });

    if (!record) {
      throw new BadRequestException(`No existe el registro REGANECU ${id}.`);
    }

    return record;
  }

  async listReganecuQh(query: SettlementQueryDto) {
    return runWithPrismaRetry(() =>
      this.prisma.reganecuQhRecord.findMany({
        where: buildReganecuQhWhere(query),
        orderBy: [{ fecha: "asc" }, { hora: "asc" }, { codigoApunte: "asc" }],
        skip: query.skip,
        take: clampTake(query.take),
        include: {
          file: {
            select: FILE_SELECT
          }
        }
      })
    );
  }

  async listMedperqh(query: MedperQueryDto) {
    const take = clampTake(query.take);
    const rows = await runWithPrismaRetry(() =>
      this.prisma.medperqhRecord.findMany({
        where: buildMedperqhWhere(query),
        orderBy: [{ timestamp: "asc" }, { codigoUnidad: "asc" }],
        select: {
          ...MEDPER_QH_RECORD_SELECT,
          file: {
            select: MEDPER_FILE_SELECT
          }
        },
        take: Math.max((query.skip + take) * 4, take)
      })
    );

    return normalizeMedperqhRows(rows).slice(query.skip, query.skip + take);
  }

  async getMedperqhRecord(id: string) {
    const record = await this.prisma.medperqhRecord.findUnique({
      where: {
        id
      },
      select: {
        ...MEDPER_QH_RECORD_SELECT,
        file: {
          select: MEDPER_FILE_SELECT
        }
      }
    });

    if (!record) {
      throw new BadRequestException(`No existe el registro MEDPERQH ${id}.`);
    }

    return record;
  }

  async getReganecuQhRecord(id: string) {
    const record = await this.prisma.reganecuQhRecord.findUnique({
      where: {
        id
      },
      include: {
        file: {
          select: FILE_SELECT
        }
      }
    });

    if (!record) {
      throw new BadRequestException(`No existe el registro REGANECUQH ${id}.`);
    }

    return record;
  }

  async settlementSummary(query: SettlementQueryDto) {
    const hourly = await runWithPrismaRetry(() =>
      this.prisma.reganecuRecord.groupBy({
        by: ["fechaLiquidacion", "version", "segmento"] as const,
        where: buildReganecuWhere(query),
        orderBy: [{ fechaLiquidacion: "asc" }, { version: "asc" }, { segmento: "asc" }],
        _count: {
          _all: true
        },
        _sum: {
          energiaMwh: true,
          importeEur: true,
          importeCalculadoEur: true
        }
      })
    );
    const qh = await this.summarizeReganecuQh(query);
    const files = await runWithPrismaRetry(() =>
      this.prisma.reeFile.findMany({
        where: buildFileWhere(query),
        select: FILE_SELECT,
        orderBy: {
          importedAt: "desc"
        },
        take: 50
      })
    );
    const qhCompleteness = await this.findMissingQhIntervals(query);
    const inconsistentHourlyRecords = await this.countInconsistentHourly(query);
    const inconsistentQhRecords = await this.countInconsistentQh(query);

    return {
      files,
      hourly: hourly.map(formatGroup),
      qh,
      validation: {
        missingQhIntervals: qhCompleteness,
        inconsistentHourlyRecords,
        inconsistentQhRecords
      }
    };
  }

  async settlementHourly(query: SettlementQueryDto) {
    return this.listReganecu(query);
  }

  async settlementQh(query: SettlementQueryDto) {
    return this.listReganecuQh(query);
  }

  async medperSummary(query: MedperQueryDto) {
    const files = await runWithPrismaRetry(() =>
      this.prisma.medperFile.findMany({
        where: buildMedperFileWhere(query),
        select: MEDPER_FILE_SELECT,
        orderBy: {
          importedAt: "desc"
        },
        take: 50
      })
    );
    const qhRecords = await runWithPrismaRetry(() =>
      this.prisma.medperqhRecord.findMany({
        where: buildMedperqhWhere(query),
        orderBy: [{ timestamp: "asc" }, { codigoUnidad: "asc" }],
        select: MEDPER_QH_RECORD_SELECT
      })
    );

    const qh = normalizeMedperqhRows(qhRecords);

    return {
      files,
      qh: sortMedperSummaryGroups(summarizeMedperqhGroups(qh)),
      monthly: summarizeMedperMonthlyConsumption(qh),
      validation: {
        missingQh: findMissingNormalizedMedperqhIntervals(qh),
        negativeQhRecords: qh.filter((row) => row.negativeEnergy).length,
        inconsistentBcPfRecords: qh.filter((row) => row.bcPfInconsistent).length,
        byVersion: buildMedperValidationByVersion(qh)
      }
    };
  }

  async medperCurves(query: MedperQueryDto) {
    const qhRecords = await runWithPrismaRetry(() =>
      this.prisma.medperqhRecord.findMany({
        where: buildMedperqhWhere(query),
        orderBy: [{ timestamp: "asc" }, { codigoUnidad: "asc" }],
        select: MEDPER_QH_RECORD_SELECT,
        take: 20000
      })
    );

    const qh = summarizeMedperqhByTimestamp(normalizeMedperqhRows(qhRecords));

    return {
      qh
    };
  }

  async medperMonthlyConsumption() {
    const latestRecord = await runWithPrismaRetry(() =>
      this.prisma.medperqhRecord.findFirst({
        orderBy: [{ timestamp: "desc" }],
        select: {
          timestamp: true
        }
      })
    );

    if (!latestRecord) {
      return [];
    }

    const latestMonthKey = toMonthKey(latestRecord.timestamp);
    const startDate = buildMonthRangeFromKey(latestMonthKey, 35).gte;

    const rows = await runWithPrismaRetry(() =>
      this.prisma.$queryRaw<MonthlyConsumptionAggregateRow[]>`
        WITH normalized_rows AS (
          SELECT
            to_char("timestamp", 'YYYY-MM') AS month,
            version,
            upper(
              COALESCE(
                NULLIF(raw_payload_json ->> 'concepto', ''),
                NULLIF(raw_payload_json ->> 'programaEnergiaMwh', '')
              )
            ) AS concept,
            COALESCE(perdidas_mwh, pf_mwh, bc_mwh, programa_energia_mwh) AS concept_value,
            pf_mwh,
            perdidas_mwh
          FROM medperqh_records
          WHERE "timestamp" >= ${startDate}
            AND "timestamp" <= ${latestRecord.timestamp}
        )
        SELECT
          month,
          version,
          SUM(CASE WHEN concept = 'MED_CLE' THEN concept_value WHEN concept IS NULL THEN pf_mwh ELSE NULL END) AS "pfMwh",
          SUM(CASE WHEN concept = 'PER_CLE' THEN concept_value WHEN concept IS NULL THEN perdidas_mwh ELSE NULL END) AS "perdidasMwh"
        FROM normalized_rows
        GROUP BY month, version
        ORDER BY month ASC, version ASC
      `
    );

    const grouped = new Map<string, { pf: MetricAccumulator; losses: MetricAccumulator }>();
    const monthKeys = buildMonthWindow(latestMonthKey, 36);
    const versions = sortMedperVersions([...new Set(rows.map((row) => row.version))]);

    for (const monthKey of monthKeys) {
      for (const version of versions) {
        grouped.set(monthVersionKey(monthKey, version), { pf: emptyMetric(), losses: emptyMetric() });
      }
    }

    for (const row of rows) {
      const bucket = grouped.get(monthVersionKey(row.month, row.version));
      if (!bucket) {
        continue;
      }

      addMetric(bucket.pf, decimalToOptionalNumber(row.pfMwh));
      addMetric(bucket.losses, decimalToOptionalNumber(row.perdidasMwh));
    }

  return monthKeys.flatMap((month) =>
    versions.map((version) => {
      const bucket = grouped.get(monthVersionKey(month, version));
      const hasData = Boolean(bucket?.pf.hasValue || bucket?.losses.hasValue);
      const pfValue = hasData ? metricValue(bucket?.pf ?? emptyMetric()) : undefined;
      const lossesValue = hasData ? metricValue(bucket?.losses ?? emptyMetric()) : undefined;
      const bcValue = hasData ? (pfValue ?? 0) + (lossesValue ?? 0) : undefined;
      return {
        month,
        version,
        pfMwh: formatOptionalMwh(pfValue),
        perdidasMwh: formatOptionalMwh(lossesValue),
        bcMwh: formatOptionalMwh(bcValue),
        consumoMwh: formatOptionalMwh(bcValue),
        hasData
      };
    })
  );
}

  async medperLosses(query: MedperQueryDto) {
    const records = await runWithPrismaRetry(() =>
      this.prisma.medperqhRecord.findMany({
        where: buildMedperqhWhere(query),
        orderBy: [{ fecha: "asc" }, { timestamp: "asc" }, { codigoUnidad: "asc" }],
        select: MEDPER_QH_RECORD_SELECT
      })
    );

    return summarizeMedperqhByDate(normalizeMedperqhRows(records));
  }

  async medperConciliation(query: MedperQueryDto) {
    const medperRecords = await runWithPrismaRetry(() =>
      this.prisma.medperqhRecord.findMany({
        where: buildMedperqhWhere(query),
        orderBy: [{ fecha: "asc" }, { codigoUnidad: "asc" }, { timestamp: "asc" }],
        select: MEDPER_QH_RECORD_SELECT
      })
    );
    const reganecuHourly = await runWithPrismaRetry(() =>
      this.prisma.reganecuRecord.groupBy({
        by: ["fecha", "codigoUpr"] as const,
        where: buildReganecuWhereFromMedperQuery(query),
        _sum: {
          energiaMwh: true,
          importeEur: true
        }
      })
    );
    const reganecuQh = await runWithPrismaRetry(() =>
      this.prisma.reganecuQhRecord.groupBy({
        by: ["fecha", "codigoUpr"] as const,
        where: buildReganecuQhWhereFromMedperQuery(query),
        _sum: {
          energiaMwh: true,
          importeEur: true
        }
      })
    );

    const medper = summarizeMedperqhByDateAndUnit(normalizeMedperqhRows(medperRecords));
    const hourlyMap = new Map(reganecuHourly.map((row) => [conciliationKey(row.fecha, row.codigoUpr), row]));
    const qhMap = new Map(reganecuQh.map((row) => [conciliationKey(row.fecha, row.codigoUpr), row]));

    return medper.slice(0, 500).map((row) => {
      const key = conciliationKey(row.fecha, row.codigoUnidad);
      const hourlyMatch = hourlyMap.get(key);
      const qhMatch = qhMap.get(key);
      const bc = numberFromString(row.bcMwh) ?? 0;
      const pf = numberFromString(row.pfMwh) ?? 0;
      const hourlyEnergy = decimalToNumber(hourlyMatch?._sum.energiaMwh);
      const qhEnergy = decimalToNumber(qhMatch?._sum.energiaMwh);

      return {
        fecha: row.fecha,
        codigoUnidad: row.codigoUnidad,
        records: row.records,
        programaEnergiaMwh: row.programaEnergiaMwh,
        perdidasMwh: row.perdidasMwh,
        bcMwh: row.bcMwh,
        pfMwh: row.pfMwh,
        reganecuEnergiaMwh: hourlyMatch?._sum.energiaMwh,
        reganecuQhEnergiaMwh: qhMatch?._sum.energiaMwh,
        reganecuImporteEur: hourlyMatch?._sum.importeEur,
        reganecuQhImporteEur: qhMatch?._sum.importeEur,
        diferenciaBcReganecuMwh: formatSummaryDecimal(bc - hourlyEnergy),
        diferenciaPfReganecuMwh: formatSummaryDecimal(pf - hourlyEnergy),
        diferenciaBcReganecuQhMwh: formatSummaryDecimal(bc - qhEnergy),
        diferenciaPfReganecuQhMwh: formatSummaryDecimal(pf - qhEnergy)
      };
    });
  }

  async liquidationAnalysisReport(query: LiquidationAnalysisQueryDto) {
    const [medperRecords, dsvQh, bs3Qh, rad3Qh, cadHourly, pc3Hourly] = await Promise.all([
      runWithPrismaRetry(() =>
        this.prisma.medperqhRecord.findMany({
          where: buildLiquidationAnalysisMedperWhere(query),
          orderBy: [{ fecha: "asc" }, { codigoUnidad: "asc" }, { timestamp: "asc" }],
          select: MEDPER_QH_RECORD_SELECT
        })
      ),
      runWithPrismaRetry(() =>
        this.prisma.reganecuQhRecord.groupBy({
          by: ["fecha", "fechaLiquidacion", "codigoUpr"] as const,
          where: buildLiquidationAnalysisReganecuQhWhere(query, "DSV"),
          orderBy: [{ fecha: "asc" }, { fechaLiquidacion: "asc" }, { codigoUpr: "asc" }],
          _count: {
            _all: true
          },
          _sum: {
            energiaMwh: true,
            importeEur: true
          }
        })
      ),
      runWithPrismaRetry(() =>
        this.prisma.reganecuQhRecord.groupBy({
          by: ["fecha", "fechaLiquidacion", "codigoUpr"] as const,
          where: buildLiquidationAnalysisReganecuQhWhere(query, "BS3"),
          orderBy: [{ fecha: "asc" }, { fechaLiquidacion: "asc" }, { codigoUpr: "asc" }],
          _count: {
            _all: true
          },
          _sum: {
            energiaMwh: true,
            importeEur: true
          }
        })
      ),
      runWithPrismaRetry(() =>
        this.prisma.reganecuQhRecord.groupBy({
          by: ["fecha", "fechaLiquidacion", "codigoUpr"] as const,
          where: buildLiquidationAnalysisReganecuQhWhere(query, "RAD3"),
          orderBy: [{ fecha: "asc" }, { fechaLiquidacion: "asc" }, { codigoUpr: "asc" }],
          _count: {
            _all: true
          },
          _sum: {
            energiaMwh: true,
            importeEur: true
          }
        })
      ),
      runWithPrismaRetry(() =>
        this.prisma.reganecuRecord.groupBy({
          by: ["fecha", "fechaLiquidacion", "codigoUpr"] as const,
          where: buildLiquidationAnalysisReganecuWhere(query, "CAD"),
          orderBy: [{ fecha: "asc" }, { fechaLiquidacion: "asc" }, { codigoUpr: "asc" }],
          _count: {
            _all: true
          },
          _sum: {
            importeEur: true
          }
        })
      ),
      runWithPrismaRetry(() =>
        this.prisma.reganecuRecord.groupBy({
          by: ["fecha", "fechaLiquidacion", "codigoUpr"] as const,
          where: buildLiquidationAnalysisReganecuWhere(query, "PC3"),
          orderBy: [{ fecha: "asc" }, { fechaLiquidacion: "asc" }, { codigoUpr: "asc" }],
          _count: {
            _all: true
          },
          _sum: {
            importeEur: true
          }
        })
      )
    ]);

    const rows = new Map<string, ReturnType<typeof emptyLiquidationAnalysisRow>>();

    for (const row of summarizeMedperqhByDateAndUnit(normalizeMedperqhRows(medperRecords))) {
      const key = dateKey(row.fecha);
      const target = rows.get(key) ?? emptyLiquidationAnalysisRow(row.fecha, query.version);
      target.medidasRecords += row.records;
      target.medida = (target.medida ?? 0) + Math.abs(numberFromString(row.bcMwh) ?? 0);
      rows.set(key, target);
    }

    for (const row of dsvQh) {
      const rowDate = row.fecha ?? row.fechaLiquidacion;
      const key = dateKey(rowDate);
      const target = rows.get(key) ?? emptyLiquidationAnalysisRow(rowDate, query.version);
      target.reganecuQhRecords += row._count._all;
      target.dsv += decimalToNumber(row._sum.energiaMwh);
      target.costeDsv -= decimalToNumber(row._sum.importeEur);
      rows.set(key, target);
    }

    for (const row of bs3Qh) {
      const rowDate = row.fecha ?? row.fechaLiquidacion;
      const key = dateKey(rowDate);
      const target = rows.get(key) ?? emptyLiquidationAnalysisRow(rowDate, query.version);
      target.reganecuQhRecords += row._count._all;
      target.costeBs3 -= decimalToNumber(row._sum.importeEur);
      rows.set(key, target);
    }

    for (const row of rad3Qh) {
      const rowDate = row.fecha ?? row.fechaLiquidacion;
      const key = dateKey(rowDate);
      const target = rows.get(key) ?? emptyLiquidationAnalysisRow(rowDate, query.version);
      target.reganecuQhRecords += row._count._all;
      target.costeRad3 -= decimalToNumber(row._sum.importeEur);
      rows.set(key, target);
    }

    for (const row of cadHourly) {
      const rowDate = row.fecha ?? row.fechaLiquidacion;
      const key = dateKey(rowDate);
      const target = rows.get(key) ?? emptyLiquidationAnalysisRow(rowDate, query.version);
      target.reganecuRecords += row._count._all;
      target.costeCad -= decimalToNumber(row._sum.importeEur);
      rows.set(key, target);
    }

    for (const row of pc3Hourly) {
      const rowDate = row.fecha ?? row.fechaLiquidacion;
      const key = dateKey(rowDate);
      const target = rows.get(key) ?? emptyLiquidationAnalysisRow(rowDate, query.version);
      target.reganecuRecords += row._count._all;
      target.costePc3 -= decimalToNumber(row._sum.importeEur);
      rows.set(key, target);
    }

    return [...rows.values()]
      .map(formatLiquidationAnalysisRow)
      .sort((left, right) => left.fecha.localeCompare(right.fecha));
  }

  async compareVersions(query: SettlementQueryDto) {
    const [hourly, qh] = await this.prisma.$transaction([
      this.prisma.reganecuRecord.groupBy({
        by: ["version", "fechaLiquidacion", "segmento", "codigoPrecio", "codigoApunte"] as const,
        where: buildReganecuWhere(query),
        orderBy: [
          { fechaLiquidacion: "asc" },
          { version: "asc" },
          { segmento: "asc" },
          { codigoPrecio: "asc" },
          { codigoApunte: "asc" }
        ],
        _count: {
          _all: true
        },
        _sum: {
          energiaMwh: true,
          importeEur: true
        }
      }),
      this.prisma.reganecuQhRecord.groupBy({
        by: ["version", "fechaLiquidacion", "segmento", "codigoPrecio", "codigoApunte"] as const,
        where: buildReganecuQhWhere(query),
        orderBy: [
          { fechaLiquidacion: "asc" },
          { version: "asc" },
          { segmento: "asc" },
          { codigoPrecio: "asc" },
          { codigoApunte: "asc" }
        ],
        _count: {
          _all: true
        },
        _sum: {
          energiaMwh: true,
          importeEur: true
        }
      })
    ]);

    return {
      hourly: hourly.map(formatComparisonGroup),
      qh: qh.map(formatComparisonGroup)
    };
  }

  private async importSourceFile(sourceFile: SourceFile, options: ImportUploadOptions = {}): Promise<ImportResult> {
    let metadata: ReeFileMetadata;
    try {
      metadata = parseReeFileMetadata(sourceFile.name);
    } catch (error) {
      return {
        fileName: sourceFile.name,
        status: "FAILED",
        recordsImported: 0,
        validRecords: 0,
        invalidRecords: 1,
        duplicatedRecords: 0,
        errors: [
          {
            sourceFileName: sourceFile.name,
            lineNumber: 0,
            message: error instanceof Error ? error.message : "Nombre de fichero no valido."
          }
        ]
      };
    }

    const fileHash = createHash("sha256").update(sourceFile.buffer).digest("hex");
    const delimiter = detectDelimiter(sourceFile.content);
    const importFile = async (db: DbClient, replacedFiles: ReeFileSummary[] = []) => {
      const file = await db.reeFile.create({
        data: {
          fileName: sourceFile.name,
          containerFileName: sourceFile.containerName,
          fileHash,
          tipoArchivo: metadata.tipoArchivo,
          version: metadata.version,
          fechaLiquidacion: metadata.fechaLiquidacion,
          sujetoEic: metadata.sujetoEic,
          encoding: sourceFile.encoding,
          delimiter,
          originalContent: toPrismaBytes(sourceFile.buffer)
        },
        select: FILE_SELECT
      });

      const importStats = await this.persistParsedRecords(db, file.id, metadata, sourceFile, delimiter);
      const status = importStats.recordsImported === 0 && importStats.invalidRecords > 0 ? ReeImportStatus.FAILED : ReeImportStatus.IMPORTED;
      const updatedFile = await db.reeFile.update({
        where: {
          id: file.id
        },
        data: {
          status,
          totalRecords: importStats.totalRecords,
          validRecords: importStats.validRecords,
          invalidRecords: importStats.invalidRecords,
          duplicatedRecords: importStats.duplicatedRecords,
          errorMessage: importStats.errors.slice(0, 20).map(formatIssue).join(" | ") || null
        },
        select: FILE_SELECT
      });

      await this.writeOverwriteAudit(db, options.auditUser, metadata.tipoArchivo, metadata.fechaLiquidacion, metadata.version, replacedFiles, updatedFile);

      return buildImportResult(sourceFile.name, updatedFile, importStats);
    };

    try {
      if (options.overwrite) {
        return await this.prisma.$transaction(async (tx) => {
          const replacedFiles = await tx.reeFile.findMany({
            where: buildReeImportConflictWhere(metadata),
            select: FILE_SELECT
          });
          if (replacedFiles.length > 0) {
            await tx.reeFile.deleteMany({
              where: {
                id: {
                  in: replacedFiles.map((file) => file.id)
                }
              }
            });
          }

          return importFile(tx, replacedFiles);
        }, transactionOptions());
      }

      return await importFile(this.prisma);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const existingFile = await this.findExistingReeImport(metadata);
        if (existingFile) {
          throwImportConflicts([buildReeImportConflict(sourceFile.name, metadata, existingFile)]);
        }
      }
      throw error;
    }
  }

  private async importMedperSourceFile(sourceFile: SourceFile, options: ImportUploadOptions = {}): Promise<ImportResult> {
    let metadata: MedperFileMetadata;
    try {
      metadata = parseMedperFileMetadata(sourceFile.name);
    } catch (error) {
      return {
        fileName: sourceFile.name,
        status: "FAILED",
        recordsImported: 0,
        validRecords: 0,
        invalidRecords: 1,
        duplicatedRecords: 0,
        errors: [
          {
            sourceFileName: sourceFile.name,
            lineNumber: 0,
            message: error instanceof Error ? error.message : "Nombre de fichero MEDPER no valido."
          }
        ]
      };
    }

    const fileHash = createHash("sha256").update(sourceFile.buffer).digest("hex");
    const delimiter = detectDelimiter(sourceFile.content);
    const importFile = async (db: DbClient, replacedFiles: MedperFileSummary[] = []) => {
      const file = await db.medperFile.create({
        data: {
          fileName: sourceFile.name,
          containerFileName: sourceFile.containerName,
          fileHash,
          tipoArchivo: metadata.tipoArchivo,
          version: metadata.version,
          fechaInicio: metadata.fechaInicio,
          fechaFin: metadata.fechaFin,
          sujetoEic: metadata.sujetoEic,
          encoding: sourceFile.encoding,
          delimiter,
          originalContent: toPrismaBytes(sourceFile.buffer)
        },
        select: MEDPER_FILE_SELECT
      });

      const importStats = await this.persistParsedMedperRecords(db, file.id, metadata, sourceFile, delimiter);
      const status = importStats.recordsImported === 0 && importStats.invalidRecords > 0 ? ReeImportStatus.FAILED : ReeImportStatus.IMPORTED;
      const updatedFile = await db.medperFile.update({
        where: {
          id: file.id
        },
        data: {
          status,
          totalRecords: importStats.totalRecords,
          validRecords: importStats.validRecords,
          invalidRecords: importStats.invalidRecords,
          duplicatedRecords: importStats.duplicatedRecords,
          errorMessage: importStats.errors.slice(0, 20).map(formatMedperIssue).join(" | ") || null
        },
        select: MEDPER_FILE_SELECT
      });

      await this.writeOverwriteAudit(db, options.auditUser, metadata.tipoArchivo, metadata.fechaInicio, metadata.version, replacedFiles, updatedFile);

      return buildImportResult(sourceFile.name, updatedFile, importStats);
    };

    try {
      if (options.overwrite) {
        return await this.prisma.$transaction(async (tx) => {
          const replacedFiles = await tx.medperFile.findMany({
            where: buildMedperImportConflictWhere(metadata),
            select: MEDPER_FILE_SELECT
          });
          if (replacedFiles.length > 0) {
            await tx.medperFile.deleteMany({
              where: {
                id: {
                  in: replacedFiles.map((file) => file.id)
                }
              }
            });
          }

          return importFile(tx, replacedFiles);
        }, transactionOptions());
      }

      return await importFile(this.prisma);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const existingFile = await this.findExistingMedperImport(metadata);
        if (existingFile) {
          throwImportConflicts([buildMedperImportConflict(sourceFile.name, metadata, existingFile)]);
        }
      }
      throw error;
    }
  }

  private async persistParsedRecords(
    db: DbClient,
    fileId: string,
    metadata: ReeFileMetadata,
    sourceFile: SourceFile,
    delimiter: string
  ) {
    let totalRecords = 0;
    let validRecords = 0;
    let invalidRecords = 0;
    let recordsImported = 0;
    let duplicatedRecords = 0;
    const errors: ParseIssue[] = [];
    let batch: ParsedA1Record[] = [];

    const flush = async () => {
      if (batch.length === 0) {
        return;
      }

      const result =
        metadata.tipoArchivo === ReeFileType.REGANECU
          ? await db.reganecuRecord.createMany({
              data: batch.map((record) => toHourlyRow(fileId, metadata, record)),
              skipDuplicates: true
            })
          : await db.reganecuQhRecord.createMany({
              data: batch.map((record) => toQhRow(fileId, metadata, record)),
              skipDuplicates: true
            });

      recordsImported += result.count;
      duplicatedRecords += batch.length - result.count;
      batch = [];
    };

    for (const result of parseA1ReganecuRecords({
      sourceFileName: sourceFile.name,
      content: sourceFile.content,
      delimiter,
      metadata
    })) {
      totalRecords += 1;

      if (result.error) {
        invalidRecords += 1;
        errors.push(result.error);
        continue;
      }

      const record = result.record;
      if (!record) {
        continue;
      }

      if (record.validationErrors.length > 0) {
        invalidRecords += 1;
        errors.push({
          sourceFileName: sourceFile.name,
          lineNumber: record.sourceLineNumber,
          message: record.validationErrors.join(", "),
          rawLine: record.rawLine
        });
        continue;
      } else {
        validRecords += 1;
      }

      batch.push(record);
      if (batch.length >= INSERT_BATCH_SIZE) {
        await flush();
      }
    }

    await flush();

    return {
      totalRecords,
      validRecords,
      invalidRecords,
      recordsImported,
      duplicatedRecords,
      errors
    };
  }

  private async persistParsedMedperRecords(
    db: DbClient,
    fileId: string,
    metadata: MedperFileMetadata,
    sourceFile: SourceFile,
    delimiter: string
  ) {
    let totalRecords = 0;
    let validRecords = 0;
    let invalidRecords = 0;
    let recordsImported = 0;
    let duplicatedRecords = 0;
    const errors: MedperParseIssue[] = [];
    let batch: ParsedMedperqhRecord[] = [];

    const flush = async () => {
      if (batch.length === 0) {
        return;
      }

      const result = await db.medperqhRecord.createMany({
        data: batch.map((record) => toMedperqhRow(fileId, metadata, record)),
        skipDuplicates: true
      });

      recordsImported += result.count;
      duplicatedRecords += batch.length - result.count;
      batch = [];
    };

    for (const result of parseMedperRecords({
      sourceFileName: sourceFile.name,
      content: sourceFile.content,
      delimiter,
      metadata
    })) {
      if (result.error) {
        totalRecords += 1;
        invalidRecords += 1;
        errors.push(result.error);
        continue;
      }

      const record = result.record;
      if (!record) {
        continue;
      }

      totalRecords += 1;
      if (record.validationErrors.length > 0) {
        invalidRecords += 1;
        errors.push({
          sourceFileName: sourceFile.name,
          lineNumber: record.sourceLineNumber,
          message: record.validationErrors.join(", "),
          rawLine: record.rawLine
        });
        continue;
      } else {
        validRecords += 1;
      }

      batch.push(record as ParsedMedperqhRecord);
      if (batch.length >= INSERT_BATCH_SIZE) {
        await flush();
      }
    }

    await flush();

    return {
      totalRecords,
      validRecords,
      invalidRecords,
      recordsImported,
      duplicatedRecords,
      errors
    };
  }

  private async countInconsistentHourly(query: SettlementQueryDto) {
    return this.prisma.reganecuRecord.count({
      where: {
        ...buildReganecuWhere(query),
        OR: [
          {
            importeConsistente: false
          },
          {
            precioAnomalo: true
          }
        ]
      }
    });
  }

  private async countInconsistentQh(query: SettlementQueryDto) {
    return this.prisma.reganecuQhRecord.count({
      where: {
        ...buildReganecuQhWhere(query),
        OR: [
          {
            importeConsistente: false
          },
          {
            precioAnomalo: true
          }
        ]
      }
    });
  }

  private async summarizeReganecuQh(query: SettlementQueryDto): Promise<SummaryGroup[]> {
    const records = await this.prisma.reganecuQhRecord.findMany({
      where: buildReganecuQhWhere(query),
      orderBy: [{ fechaLiquidacion: "asc" }, { version: "asc" }, { segmento: "asc" }, { fecha: "asc" }, { hora: "asc" }],
      select: {
        id: true,
        fechaLiquidacion: true,
        version: true,
        segmento: true,
        fecha: true,
        hora: true,
        brp: true,
        codigoUpr: true,
        eicUpr: true,
        cuenta: true,
        codigoMagnitud: true,
        codigoPrecio: true,
        codigoApunte: true,
        tipoOferta: true,
        tipoUpr: true,
        energiaMwh: true,
        importeEur: true,
        importeCalculadoEur: true,
        rawPayloadJson: true
      }
    });

    const groups = new Map<string, QhSummaryAccumulator>();

    for (const record of records) {
      const groupKey = summaryGroupKey(record.fechaLiquidacion, record.version, record.segmento);
      let group = groups.get(groupKey);
      if (!group) {
        group = {
          fechaLiquidacion: record.fechaLiquidacion,
          version: record.version,
          segmento: record.segmento,
          records: 0,
          importeEur: 0,
          importeCalculadoEur: 0,
          hourlyEnergy: new Map()
        };
        groups.set(groupKey, group);
      }

      group.records += 1;
      group.importeEur += decimalToNumber(record.importeEur);
      group.importeCalculadoEur += decimalToNumber(record.importeCalculadoEur);

      const energy = decimalToNumber(record.energiaMwh);
      const quarterHour =
        record.hora ??
        parseIntegerText(readRawPayloadText(record.rawPayloadJson, "hora")) ??
        quarterHourFromDateText(readRawPayloadText(record.rawPayloadJson, "fecha"));
      const recordDate = record.fecha ?? parseRecordDateText(readRawPayloadText(record.rawPayloadJson, "fecha"));
      const hourlyKey = [
        toIsoDate(recordDate ?? record.fechaLiquidacion),
        quarterHour ? Math.floor((quarterHour - 1) / 4) + 1 : record.id,
        record.brp ?? "",
        record.eicUpr ?? "",
        record.codigoUpr ?? "",
        record.cuenta ?? "",
        record.codigoMagnitud ?? "",
        record.codigoPrecio ?? "",
        record.codigoApunte ?? "",
        record.tipoOferta ?? "",
        record.tipoUpr ?? ""
      ].join("|");
      const hourlyEnergy = group.hourlyEnergy.get(hourlyKey) ?? { sum: 0, count: 0 };
      hourlyEnergy.sum += energy;
      hourlyEnergy.count += 1;
      group.hourlyEnergy.set(hourlyKey, hourlyEnergy);
    }

    return [...groups.values()].map((group) => ({
      fechaLiquidacion: group.fechaLiquidacion,
      version: group.version,
      segmento: group.segmento,
      records: group.records,
      sums: {
        energiaMwh: formatSummaryDecimal(sumHourlyAverageEnergy(group.hourlyEnergy)),
        importeEur: formatSummaryDecimal(group.importeEur),
        importeCalculadoEur: formatSummaryDecimal(group.importeCalculadoEur)
      }
    }));
  }

  private async findMissingQhIntervals(query: SettlementQueryDto) {
    const groups = await this.prisma.reganecuQhRecord.groupBy({
      by: ["fecha", "version", "sujetoEic", "eicUpr"],
      where: buildReganecuQhWhere(query),
      _count: {
        _all: true
      }
    });

    return groups
      .filter((group) => group._count._all < 96)
      .slice(0, 100)
      .map((group) => ({
        fecha: group.fecha,
        version: group.version,
        sujetoEic: group.sujetoEic,
        eicUpr: group.eicUpr,
        intervals: group._count._all,
        missing: Math.max(96 - group._count._all, 0)
      }));
  }

  private async findMissingMedperqhIntervals(query: MedperQueryDto) {
    const groups = await this.prisma.medperqhRecord.groupBy({
      by: ["fecha", "version", "sujetoEic", "codigoUnidad"],
      where: buildMedperqhWhere(query),
      _count: {
        _all: true
      }
    });

    return groups
      .filter((group) => group._count._all < 96)
      .slice(0, 100)
      .map((group) => ({
        fecha: group.fecha,
        version: group.version,
        sujetoEic: group.sujetoEic,
        codigoUnidad: group.codigoUnidad,
        intervals: group._count._all,
        missing: Math.max(96 - group._count._all, 0)
      }));
  }
}

function toHourlyRow(
  fileId: string,
  metadata: ReeFileMetadata,
  record: ParsedA1Record
): Prisma.ReganecuRecordCreateManyInput {
  return {
    ...toCommonRow(fileId, metadata, record),
    sesion: record.sesion
  };
}

function toQhRow(
  fileId: string,
  metadata: ReeFileMetadata,
  record: ParsedA1Record
): Prisma.ReganecuQhRecordCreateManyInput {
  return {
    ...toCommonRow(fileId, metadata, record),
    campoHora25: record.campoHora25
  };
}

function toCommonRow(fileId: string, metadata: ReeFileMetadata, record: ParsedA1Record) {
  return {
    fileId,
    tipoArchivo: metadata.tipoArchivo,
    version: metadata.version,
    fechaLiquidacion: metadata.fechaLiquidacion,
    sujetoEic: metadata.sujetoEic,
    brp: record.brp,
    fecha: record.fecha,
    hora: record.hora,
    codigoUpr: record.codigoUpr,
    energiaMwh: record.energiaMwh,
    precioEurMwh: record.precioEurMwh,
    importeEur: record.importeEur,
    codigoAgenteVendedor: record.codigoAgenteVendedor,
    segmento: record.segmento,
    facturacion: record.facturacion,
    eicUpr: record.eicUpr,
    cuenta: record.cuenta,
    signoImporte: record.signoImporte,
    signoMagnitud: record.signoMagnitud,
    eicTitular: record.eicTitular,
    codigoMagnitud: record.codigoMagnitud,
    codigoPrecio: record.codigoPrecio,
    codigoApunte: record.codigoApunte,
    tipoOferta: record.tipoOferta,
    tipoUpr: record.tipoUpr,
    energiaContratoBilateralMwh: record.energiaContratoBilateralMwh,
    importeCalculadoEur: record.importeCalculadoEur,
    importeDiferenciaEur: record.importeDiferenciaEur,
    importeConsistente: record.importeConsistente,
    precioAnomalo: record.precioAnomalo,
    validationErrors: record.validationErrors,
    rawPayloadJson: record.rawPayloadJson,
    rawLine: record.rawLine,
    sourceLineNumber: record.sourceLineNumber,
    recordHash: record.recordHash
  };
}

function toMedperqhRow(
  fileId: string,
  metadata: MedperFileMetadata,
  record: ParsedMedperqhRecord
): Prisma.MedperqhRecordCreateManyInput {
  return {
    fileId,
    tipoArchivo: metadata.tipoArchivo,
    version: metadata.version,
    fechaInicio: metadata.fechaInicio,
    fechaFin: metadata.fechaFin,
    sujetoEic: metadata.sujetoEic,
    fecha: record.fecha,
    timestamp: record.timestamp,
    hora: record.hora,
    cuartoHora: record.cuartoHora,
    codigoUnidad: record.codigoUnidad,
    peaje: record.peaje,
    programaEnergiaMwh: record.programaEnergiaMwh,
    perdidasMwh: record.perdidasMwh,
    bcMwh: record.bcMwh,
    pfMwh: record.pfMwh,
    bcPfDifferenceMwh: record.bcPfDifferenceMwh,
    negativeEnergy: record.negativeEnergy,
    bcPfInconsistent: record.bcPfInconsistent,
    validationErrors: record.validationErrors,
    rawPayloadJson: record.rawPayloadJson,
    rawLine: record.rawLine,
    sourceLineNumber: record.sourceLineNumber,
    recordHash: record.recordHash
  };
}

function buildSourcePlan(files: ImportableFile[]): ImportSourcePlan {
  const plan: ImportSourcePlan = {
    sourceFiles: [],
    initialResults: []
  };

  for (const upload of files) {
    const sourceFiles = extractSourceFiles(upload.originalname, upload.buffer);
    if (sourceFiles.length === 0) {
      plan.initialResults.push({
        fileName: upload.originalname,
        status: "FAILED",
        recordsImported: 0,
        validRecords: 0,
        invalidRecords: 1,
        duplicatedRecords: 0,
        errors: [
          {
            sourceFileName: upload.originalname,
            lineNumber: 0,
            message: "El fichero no contiene entradas importables."
          }
        ]
      });
      continue;
    }

    plan.sourceFiles.push(...sourceFiles);
  }

  return plan;
}

function validateIncomingDuplicateKeys(files: Array<{ fileName: string; key: string }>) {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];

  for (const file of files) {
    const firstFileName = seen.get(file.key);
    if (firstFileName) {
      duplicates.push(`${firstFileName} / ${file.fileName}`);
      continue;
    }
    seen.set(file.key, file.fileName);
  }

  if (duplicates.length > 0) {
    throw new BadRequestException(
      `La selección contiene más de un fichero con el mismo tipo, fecha y versión: ${duplicates.join(", ")}.`
    );
  }
}

function importKey(tipoArchivo: ReeFileType | MedperFileType, fecha: string, version: string) {
  return [String(tipoArchivo).toLowerCase(), fecha, version.toUpperCase()].join("|");
}

function buildReeImportConflictWhere(metadata: ReeFileMetadata): Prisma.ReeFileWhereInput {
  return {
    tipoArchivo: metadata.tipoArchivo,
    fechaLiquidacion: normalizeDateOnly(metadata.fechaLiquidacion),
    version: metadata.version
  };
}

function buildMedperImportConflictWhere(metadata: MedperFileMetadata): Prisma.MedperFileWhereInput {
  return {
    tipoArchivo: metadata.tipoArchivo,
    fechaInicio: normalizeDateOnly(metadata.fechaInicio),
    version: metadata.version
  };
}

function buildReeImportConflict(fileName: string, metadata: ReeFileMetadata, existingFile: ReeFileSummary): ImportConflict {
  return {
    fileName,
    tipoArchivo: String(metadata.tipoArchivo).toLowerCase(),
    fecha: dateKey(metadata.fechaLiquidacion),
    version: metadata.version,
    existingFileId: existingFile.id,
    existingFileName: existingFile.fileName,
    existingImportedAt: existingFile.importedAt
  };
}

function buildMedperImportConflict(fileName: string, metadata: MedperFileMetadata, existingFile: MedperFileSummary): ImportConflict {
  return {
    fileName,
    tipoArchivo: String(metadata.tipoArchivo).toLowerCase(),
    fecha: dateKey(metadata.fechaInicio),
    version: metadata.version,
    existingFileId: existingFile.id,
    existingFileName: existingFile.fileName,
    existingImportedAt: existingFile.importedAt
  };
}

function throwIfImportConflicts(conflicts: ImportConflict[]) {
  if (conflicts.length > 0) {
    throwImportConflicts(conflicts);
  }
}

function throwImportConflicts(conflicts: ImportConflict[]): never {
  const first = conflicts[0];
  const message =
    conflicts.length === 1
      ? `Ya existe una carga para ${first.tipoArchivo} con fecha ${first.fecha} y versión ${first.version}.`
      : `Ya existen ${conflicts.length} cargas previas para el mismo tipo, fecha y versión.`;

  throw new ConflictException({
    code: "IMPORT_DUPLICATE_CONFLICT",
    message,
    conflicts
  });
}

function buildImportResult(
  fileName: string,
  file: ReeFileSummary | MedperFileSummary,
  importStats: {
    recordsImported: number;
    validRecords: number;
    invalidRecords: number;
    duplicatedRecords: number;
    errors: Array<ParseIssue | MedperParseIssue>;
  }
): ImportResult {
  return {
    fileName,
    status: file.status === ReeImportStatus.FAILED ? "FAILED" : "IMPORTED",
    file,
    recordsImported: importStats.recordsImported,
    validRecords: importStats.validRecords,
    invalidRecords: importStats.invalidRecords,
    duplicatedRecords: importStats.duplicatedRecords,
    errors: importStats.errors.slice(0, 100).map((error) => ({
      sourceFileName: error.sourceFileName,
      lineNumber: error.lineNumber,
      message: error.message
    }))
  };
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

function transactionOptions() {
  return {
    maxWait: 10000,
    timeout: 120000
  };
}

function normalizeDateOnly(value: Date) {
  return parseRecordDateText(dateKey(value)) ?? value;
}

function buildImportResponse(results: ImportResult[], uploadedFiles: number) {
  return {
    summary: {
      uploadedFiles,
      sourceFiles: results.length,
      importedFiles: results.filter((result) => result.status === "IMPORTED").length,
      failedFiles: results.filter((result) => result.status === "FAILED").length,
      duplicatedFiles: results.filter((result) => result.status === "DUPLICATE").length,
      recordsImported: results.reduce((sum, result) => sum + result.recordsImported, 0),
      validRecords: results.reduce((sum, result) => sum + result.validRecords, 0),
      invalidRecords: results.reduce((sum, result) => sum + result.invalidRecords, 0),
      duplicatedRecords: results.reduce((sum, result) => sum + result.duplicatedRecords, 0)
    },
    results,
    files: results.map((result) => result.file).filter(Boolean)
  };
}

function stripOriginalContent(file: ReeFileAction): ReeFileSummary;
function stripOriginalContent(file: MedperFileAction): MedperFileSummary;
function stripOriginalContent(file: ReeFileAction | MedperFileAction): ReeFileSummary | MedperFileSummary;
function stripOriginalContent(file: ReeFileAction | MedperFileAction) {
  const { originalContent, ...rest } = file;
  void originalContent;
  return rest;
}

function toImportIssueRow(error: ParseIssue | MedperParseIssue): ImportIssueRow {
  return {
    sourceFileName: error.sourceFileName,
    lineNumber: error.lineNumber,
    message: error.message,
    rawLine: error.rawLine ?? null
  };
}

function getImportFilePeriod(file: ReeFileSummary | MedperFileSummary) {
  if ("fechaLiquidacion" in file) {
    return dateKey(file.fechaLiquidacion);
  }

  return `${dateKey(file.fechaInicio)} - ${dateKey(file.fechaFin)}`;
}

function parseStoredImportErrors(errorMessage: string | null | undefined): ImportIssueRow[] {
  if (!errorMessage) {
    return [];
  }

  return errorMessage
    .split(" | ")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const match = /^(.+?):(\d+)\s+(.+)$/.exec(chunk);
      if (!match) {
        return {
          sourceFileName: "",
          lineNumber: 0,
          message: chunk
        };
      }

      return {
        sourceFileName: match[1],
        lineNumber: Number(match[2]),
        message: match[3]
      };
    });
}

function buildSemicolonCsv(headers: string[], rows: unknown[][]) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\n");
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function safeDownloadBaseName(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "carga";
}

function decimalToText(value: { toString(): string } | null | undefined) {
  return value === null || value === undefined ? null : value.toString();
}

type MetricAccumulator = {
  sum: number;
  hasValue: boolean;
};

type NormalizedMedperqhRow = Record<string, unknown> & {
  id: string;
  version: string;
  sujetoEic: string;
  fecha: Date;
  timestamp: Date;
  hora: number;
  cuartoHora: number;
  codigoUnidad: string;
  peaje: string | null;
  programaEnergiaMwh: string | null;
  perdidasMwh: string | null;
  bcMwh: string | null;
  pfMwh: string | null;
  bcPfDifferenceMwh: string | null;
  negativeEnergy: boolean;
  bcPfInconsistent: boolean;
};

function normalizeMedperqhRows(rows: any[]): NormalizedMedperqhRow[] {
  const groups = new Map<
    string,
    {
      row: NormalizedMedperqhRow;
      programa: MetricAccumulator;
      pf: MetricAccumulator;
      losses: MetricAccumulator;
      bc: MetricAccumulator;
    }
  >();

  for (const row of rows) {
    const key = [
      row.version,
      dateKey(row.fecha),
      timestampKey(row.timestamp),
      row.hora,
      row.cuartoHora,
      row.sujetoEic,
      row.codigoUnidad,
      row.peaje ?? ""
    ].join("|");
    let group = groups.get(key);
    if (!group) {
      group = {
        row: {
          ...row,
          programaEnergiaMwh: null,
          perdidasMwh: null,
          bcMwh: null,
          pfMwh: null,
          bcPfDifferenceMwh: null,
          negativeEnergy: false,
          bcPfInconsistent: false
        },
        programa: emptyMetric(),
        pf: emptyMetric(),
        losses: emptyMetric(),
        bc: emptyMetric()
      };
      groups.set(key, group);
    }

    const concept = normalizeMedperConcept(
      readRawPayloadText(row.rawPayloadJson, "concepto") ?? readRawPayloadText(row.rawPayloadJson, "programaEnergiaMwh")
    );
    if (concept === "MED_CLE") {
      addMetric(group.pf, conceptRowValue(row));
    } else if (concept === "PER_CLE") {
      addMetric(group.losses, conceptRowValue(row));
    } else {
      addMetric(group.programa, decimalToOptionalNumber(row.programaEnergiaMwh));
      addMetric(group.losses, decimalToOptionalNumber(row.perdidasMwh));
      addMetric(group.bc, decimalToOptionalNumber(row.bcMwh));
      addMetric(group.pf, decimalToOptionalNumber(row.pfMwh));
    }

    group.row.negativeEnergy =
      group.row.negativeEnergy ||
      isNegative(decimalToOptionalNumber(row.programaEnergiaMwh)) ||
      isNegative(decimalToOptionalNumber(row.perdidasMwh)) ||
      isNegative(decimalToOptionalNumber(row.bcMwh)) ||
      isNegative(decimalToOptionalNumber(row.pfMwh));
  }

  return [...groups.values()]
    .map(({ row, programa, pf, losses, bc }) => {
      const programaValue = metricValue(programa);
      const pfValue = metricValue(pf);
      const lossesValue = metricValue(losses);
      const directBcValue = metricValue(bc);
      const bcValue = directBcValue ?? sumIfAny(pfValue, lossesValue);
      const differenceValue = bcValue !== undefined && pfValue !== undefined ? roundTo(bcValue - pfValue, 6) : lossesValue;
      const bcPfInconsistent =
        bcValue !== undefined &&
        pfValue !== undefined &&
        lossesValue !== undefined &&
        Math.abs(bcValue - pfValue - lossesValue) > BC_PF_TOLERANCE_MWH;

      return {
        ...row,
        programaEnergiaMwh: formatOptionalMwh(programaValue),
        pfMwh: formatOptionalMwh(pfValue),
        perdidasMwh: formatOptionalMwh(lossesValue),
        bcMwh: formatOptionalMwh(bcValue),
        bcPfDifferenceMwh: formatOptionalMwh(differenceValue),
        bcPfInconsistent
      };
    })
    .sort(sortNormalizedMedperqhRows);
}

function summarizeMedperqhGroups(rows: NormalizedMedperqhRow[]) {
  const groups = new Map<
    string,
    {
      version: string;
      codigoUnidad: string;
      records: number;
      programa: MetricAccumulator;
      pf: MetricAccumulator;
      losses: MetricAccumulator;
      bc: MetricAccumulator;
    }
  >();

  for (const row of rows) {
    const key = [row.version, row.codigoUnidad].join("|");
    let group = groups.get(key);
    if (!group) {
      group = {
        version: row.version,
        codigoUnidad: row.codigoUnidad,
        records: 0,
        programa: emptyMetric(),
        pf: emptyMetric(),
        losses: emptyMetric(),
        bc: emptyMetric()
      };
      groups.set(key, group);
    }

    group.records += 1;
    addMetric(group.programa, numberFromString(row.programaEnergiaMwh));
    addMetric(group.pf, numberFromString(row.pfMwh));
    addMetric(group.losses, numberFromString(row.perdidasMwh));
    addMetric(group.bc, numberFromString(row.bcMwh));
  }

  return [...groups.values()].map(formatMedperqhAccumulatorGroup);
}

function summarizeMedperqhByTimestamp(rows: NormalizedMedperqhRow[]) {
  const groups = new Map<
    string,
    {
      timestamp: Date;
      programa: MetricAccumulator;
      pf: MetricAccumulator;
      losses: MetricAccumulator;
      bc: MetricAccumulator;
    }
  >();

  for (const row of rows) {
    const key = timestampKey(row.timestamp);
    let group = groups.get(key);
    if (!group) {
      group = {
        timestamp: row.timestamp,
        programa: emptyMetric(),
        pf: emptyMetric(),
        losses: emptyMetric(),
        bc: emptyMetric()
      };
      groups.set(key, group);
    }
    addMetric(group.programa, numberFromString(row.programaEnergiaMwh));
    addMetric(group.pf, numberFromString(row.pfMwh));
    addMetric(group.losses, numberFromString(row.perdidasMwh));
    addMetric(group.bc, numberFromString(row.bcMwh));
  }

  return [...groups.values()].map((group) => ({
    timestamp: group.timestamp,
    programaEnergiaMwh: formatOptionalMwh(metricValue(group.programa)),
    perdidasMwh: formatOptionalMwh(metricValue(group.losses)),
    bcMwh: formatOptionalMwh(metricValue(group.bc)),
    pfMwh: formatOptionalMwh(metricValue(group.pf))
  }));
}

function summarizeMedperqhByDate(rows: NormalizedMedperqhRow[]) {
  const groups = new Map<
    string,
    {
      fecha: Date;
      records: number;
      pf: MetricAccumulator;
      losses: MetricAccumulator;
      bc: MetricAccumulator;
    }
  >();

  for (const row of rows) {
    const key = dateKey(row.fecha);
    let group = groups.get(key);
    if (!group) {
      group = { fecha: row.fecha, records: 0, pf: emptyMetric(), losses: emptyMetric(), bc: emptyMetric() };
      groups.set(key, group);
    }
    group.records += 1;
    addMetric(group.pf, numberFromString(row.pfMwh));
    addMetric(group.losses, numberFromString(row.perdidasMwh));
    addMetric(group.bc, numberFromString(row.bcMwh));
  }

  return [...groups.values()].map((group) => ({
    fecha: group.fecha,
    records: group.records,
    perdidasMwh: formatOptionalMwh(metricValue(group.losses)),
    bcMwh: formatOptionalMwh(metricValue(group.bc)),
    pfMwh: formatOptionalMwh(metricValue(group.pf))
  }));
}

function summarizeMedperqhByDateAndUnit(rows: NormalizedMedperqhRow[]) {
  const groups = new Map<
    string,
    {
      fecha: Date;
      codigoUnidad: string;
      records: number;
      programa: MetricAccumulator;
      pf: MetricAccumulator;
      losses: MetricAccumulator;
      bc: MetricAccumulator;
    }
  >();

  for (const row of rows) {
    const key = [dateKey(row.fecha), row.codigoUnidad].join("|");
    let group = groups.get(key);
    if (!group) {
      group = {
        fecha: row.fecha,
        codigoUnidad: row.codigoUnidad,
        records: 0,
        programa: emptyMetric(),
        pf: emptyMetric(),
        losses: emptyMetric(),
        bc: emptyMetric()
      };
      groups.set(key, group);
    }
    group.records += 1;
    addMetric(group.programa, numberFromString(row.programaEnergiaMwh));
    addMetric(group.pf, numberFromString(row.pfMwh));
    addMetric(group.losses, numberFromString(row.perdidasMwh));
    addMetric(group.bc, numberFromString(row.bcMwh));
  }

  return [...groups.values()].map((group) => ({
    fecha: group.fecha,
    codigoUnidad: group.codigoUnidad,
    records: group.records,
    programaEnergiaMwh: formatOptionalMwh(metricValue(group.programa)),
    perdidasMwh: formatOptionalMwh(metricValue(group.losses)),
    bcMwh: formatOptionalMwh(metricValue(group.bc)),
    pfMwh: formatOptionalMwh(metricValue(group.pf))
  }));
}

function summarizeMedperMonthlyConsumption(rows: NormalizedMedperqhRow[]) {
  const versionOrder = sortMedperVersions([...new Set(rows.map((row) => row.version))]);
  const latestMonthKey = rows.reduce<string | undefined>((latest, row) => {
    const monthKey = toMonthKey(row.timestamp);
    return !latest || monthKey > latest ? monthKey : latest;
  }, undefined);

  if (!latestMonthKey || versionOrder.length === 0) {
    return [];
  }

  const monthKeys = buildMonthWindow(latestMonthKey, 36);
  const buckets = new Map<string, { pf: MetricAccumulator; losses: MetricAccumulator }>();

  for (const monthKey of monthKeys) {
    for (const version of versionOrder) {
      buckets.set(monthVersionKey(monthKey, version), { pf: emptyMetric(), losses: emptyMetric() });
    }
  }

  for (const row of rows) {
    const monthKey = toMonthKey(row.timestamp);
    const bucket = buckets.get(monthVersionKey(monthKey, row.version));
    if (!bucket) {
      continue;
    }

    addMetric(bucket.pf, numberFromString(row.pfMwh));
    addMetric(bucket.losses, numberFromString(row.perdidasMwh));
  }

  return monthKeys.flatMap((month) =>
    versionOrder.map((version) => {
      const bucket = buckets.get(monthVersionKey(month, version)) ?? { pf: emptyMetric(), losses: emptyMetric() };
      const pfValue = metricValue(bucket.pf) ?? 0;
      const lossesValue = metricValue(bucket.losses) ?? 0;
      const totalValue = pfValue + lossesValue;

      return {
        month,
        version,
        pfMwh: formatOptionalMwh(pfValue),
        perdidasMwh: formatOptionalMwh(lossesValue),
        bcMwh: formatOptionalMwh(totalValue),
        consumoMwh: formatOptionalMwh(totalValue)
      };
    })
  );
}

function findMissingNormalizedMedperqhIntervals(rows: NormalizedMedperqhRow[]) {
  const groups = new Map<
    string,
    {
      fecha: Date;
      version: string;
      sujetoEic: string;
      codigoUnidad: string;
      intervals: Set<string>;
    }
  >();

  for (const row of rows) {
    const key = [dateKey(row.fecha), row.version, row.sujetoEic, row.codigoUnidad].join("|");
    let group = groups.get(key);
    if (!group) {
      group = {
        fecha: row.fecha,
        version: row.version,
        sujetoEic: row.sujetoEic,
        codigoUnidad: row.codigoUnidad,
        intervals: new Set<string>()
      };
      groups.set(key, group);
    }
    group.intervals.add(`${row.hora}-${row.cuartoHora}`);
  }

  return [...groups.values()]
    .filter((group) => group.intervals.size < 96)
    .slice(0, 100)
    .map((group) => ({
      fecha: group.fecha,
      version: group.version,
      sujetoEic: group.sujetoEic,
      codigoUnidad: group.codigoUnidad,
      intervals: group.intervals.size,
      missing: Math.max(96 - group.intervals.size, 0)
    }));
}

function formatMedperqhAccumulatorGroup(group: {
  version: string;
  codigoUnidad: string;
  records: number;
  programa: MetricAccumulator;
  pf: MetricAccumulator;
  losses: MetricAccumulator;
  bc: MetricAccumulator;
}) {
  return {
    version: group.version,
    codigoUnidad: group.codigoUnidad,
    records: group.records,
    programaEnergiaMwh: formatOptionalMwh(metricValue(group.programa)),
    perdidasMwh: formatOptionalMwh(metricValue(group.losses)),
    bcMwh: formatOptionalMwh(metricValue(group.bc)),
    pfMwh: formatOptionalMwh(metricValue(group.pf))
  };
}

function emptyLiquidationAnalysisRow(fecha: Date | null, version: ReeSettlementVersion) {
  return {
    fecha: dateKey(fecha),
    version,
    medidasRecords: 0,
    reganecuRecords: 0,
    reganecuQhRecords: 0,
    medida: undefined as number | undefined,
    dsv: 0,
    costeDsv: 0,
    costeCad: 0,
    costePc3: 0,
    costeBs3: 0,
    costeRad3: 0
  };
}

function formatLiquidationAnalysisRow(row: ReturnType<typeof emptyLiquidationAnalysisRow>) {
  const programa = row.medida === undefined ? undefined : row.medida + row.dsv;
  const dsvAbs = Math.abs(row.dsv);

  return {
    fecha: row.fecha,
    diaSemana: weekdayNumber(row.fecha),
    version: row.version,
    medidasRecords: row.medidasRecords,
    reganecuRecords: row.reganecuRecords,
    reganecuQhRecords: row.reganecuQhRecords,
    medidaMwh: formatOptionalMwh(row.medida),
    programaMwh: formatOptionalMwh(programa),
    dsvMwh: formatOptionalMwh(row.dsv),
    dsvPct: formatOptionalRatio(safeRatio(row.dsv, row.medida)),
    dsvAbsMwh: formatOptionalMwh(dsvAbs),
    dsvAbsPct: formatOptionalRatio(safeRatio(dsvAbs, row.medida)),
    costeDsvEur: formatOptionalMwh(row.costeDsv),
    precioDsvEurMwh: formatOptionalRatio(safeRatio(row.costeDsv, row.dsv)),
    costeCadEur: formatOptionalMwh(row.costeCad),
    precioCadEurMwh: formatOptionalRatio(safeRatio(row.costeCad, row.medida)),
    costePc3Eur: formatOptionalMwh(row.costePc3),
    precioPc3EurMwh: formatOptionalRatio(safeRatio(row.costePc3, row.medida)),
    costeBs3Eur: formatOptionalMwh(row.costeBs3),
    precioBs3EurMwh: formatOptionalRatio(safeRatio(row.costeBs3, row.medida)),
    costeRad3Eur: formatOptionalMwh(row.costeRad3),
    precioRad3EurMwh: formatOptionalRatio(safeRatio(row.costeRad3, row.medida))
  };
}

function weekdayNumber(isoDate: string) {
  const date = parseRecordDateText(isoDate);
  if (!date) {
    return null;
  }

  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

function conceptRowValue(row: any) {
  return (
    decimalToOptionalNumber(row.medidaMwh) ??
    decimalToOptionalNumber(row.perdidasMwh) ??
    decimalToOptionalNumber(row.pfMwh) ??
    decimalToOptionalNumber(row.bcMwh)
  );
}

function emptyMetric(): MetricAccumulator {
  return {
    sum: 0,
    hasValue: false
  };
}

function addMetric(metric: MetricAccumulator, value: number | undefined) {
  if (value === undefined) {
    return;
  }
  metric.sum += value;
  metric.hasValue = true;
}

function metricValue(metric: MetricAccumulator) {
  return metric.hasValue ? metric.sum : undefined;
}

function sumIfAny(...values: Array<number | undefined>) {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : undefined;
}

function decimalToOptionalNumber(value: { toString(): string } | string | number | null | undefined) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const numeric = Number(value.toString());
  return Number.isFinite(numeric) ? numeric : undefined;
}

function numberFromString(value: string | null | undefined) {
  return value === null || value === undefined ? undefined : decimalToOptionalNumber(value);
}

function isNegative(value: number | undefined) {
  return value !== undefined && value > 0;
}

function normalizeMedperConcept(value?: string | null) {
  return value?.trim().toUpperCase() || undefined;
}

function formatOptionalMwh(value: number | undefined) {
  return value === undefined ? null : formatSummaryDecimal(value);
}

function formatOptionalRatio(value: number | undefined) {
  return value === undefined ? null : formatSummaryDecimal(value);
}

function safeRatio(numerator: number | undefined, denominator: number | undefined) {
  if (numerator === undefined || denominator === undefined || denominator === 0) {
    return undefined;
  }

  return numerator / denominator;
}

function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function dateKey(value: Date | null | undefined) {
  return value ? toIsoDate(value) : "";
}

function timestampKey(value: Date | null | undefined) {
  return value?.toISOString() ?? "";
}

function sortNormalizedMedperqhRows(left: NormalizedMedperqhRow, right: NormalizedMedperqhRow) {
  return (
    left.timestamp.getTime() - right.timestamp.getTime() ||
    left.codigoUnidad.localeCompare(right.codigoUnidad) ||
    (left.peaje ?? "").localeCompare(right.peaje ?? "")
  );
}

function buildFileWhere(query: SettlementQueryDto): Prisma.ReeFileWhereInput {
  const dateRange = buildQueryDateRange(query);

  return {
    fechaLiquidacion: dateRange,
    version: query.version,
    sujetoEic: query.sujeto?.toUpperCase()
  };
}

function buildReganecuWhere(query: SettlementQueryDto): Prisma.ReganecuRecordWhereInput {
  return buildRecordWhere(query);
}

function buildReganecuQhWhere(query: SettlementQueryDto): Prisma.ReganecuQhRecordWhereInput {
  return buildRecordWhere(query);
}

function buildRecordWhere(query: SettlementQueryDto) {
  const andFilters: Array<Prisma.ReganecuRecordWhereInput & Prisma.ReganecuQhRecordWhereInput> = [];
  const dateRange = buildQueryDateRange(query);

  if (dateRange) {
    andFilters.push({
      OR: [
        {
          fecha: dateRange
        },
        {
          fecha: null,
          fechaLiquidacion: dateRange
        }
      ]
    });
  }

  if (query.brp) {
    const brp = query.brp.toUpperCase();
    andFilters.push({
      OR: [
        {
          brp
        },
        {
          codigoAgenteVendedor: brp
        },
        {
          eicTitular: brp
        }
      ]
    });
  }

  return {
    version: query.version,
    sujetoEic: query.sujeto?.toUpperCase(),
    segmento: query.segmento,
    codigoApunte: query.codigoApunte,
    codigoPrecio: query.codigoPrecio,
    eicUpr: query.eicUpr?.toUpperCase(),
    AND: andFilters.length > 0 ? andFilters : undefined
  };
}

function buildMedperValidationByVersion(qh: NormalizedMedperqhRow[]) {
  const versions = sortMedperVersions([...new Set(qh.map((row) => row.version))]);
  return versions.map((version) => ({
    version,
    missingQh: findMissingNormalizedMedperqhIntervals(qh.filter((row) => row.version === version)).length,
    negativeQhRecords: qh.filter((row) => row.version === version && row.negativeEnergy).length,
    inconsistentBcPfRecords: qh.filter((row) => row.version === version && row.bcPfInconsistent).length
  }));
}

function buildMedperFileWhere(query: MedperQueryDto): Prisma.MedperFileWhereInput {
  const dateRange = buildQueryDateRange(query);
  const dateFilters: Prisma.MedperFileWhereInput[] = [];
  if (dateRange?.lt) {
    dateFilters.push({
      fechaInicio: {
        lt: dateRange.lt
      }
    });
  }
  if (dateRange?.gte) {
    dateFilters.push({
      fechaFin: {
        gte: dateRange.gte
      }
    });
  }

  return {
    tipoArchivo: MedperFileType.MEDPERQH,
    version: query.version?.toUpperCase(),
    sujetoEic: query.sujeto?.toUpperCase(),
    AND: dateFilters.length > 0 ? dateFilters : undefined
  };
}

function buildMedperqhWhere(query: MedperQueryDto): Prisma.MedperqhRecordWhereInput {
  const andFilters: Prisma.MedperqhRecordWhereInput[] = [];
  const dateRange = buildQueryDateRange(query);

  if (dateRange) {
    andFilters.push({
      fecha: dateRange
    });
  }

  if (query.brp) {
    const brp = query.brp.toUpperCase();
    andFilters.push({
      OR: [
        {
          codigoUnidad: brp
        },
        {
          sujetoEic: brp
        }
      ]
    });
  }

  return {
    version: query.version?.toUpperCase(),
    sujetoEic: query.sujeto?.toUpperCase(),
    peaje: query.peaje ?? query.tarifa,
    codigoUnidad: query.codigoUnidad?.toUpperCase() ?? query.upr?.toUpperCase(),
    AND: andFilters.length > 0 ? andFilters : undefined
  };
}

function buildLiquidationAnalysisMedperWhere(query: LiquidationAnalysisQueryDto): Prisma.MedperqhRecordWhereInput {
  return {
    version: query.version,
    fecha: parseQueryMonthRange(query.fecha)
  };
}

function buildLiquidationAnalysisReganecuWhere(
  query: LiquidationAnalysisQueryDto,
  segmento: string
): Prisma.ReganecuRecordWhereInput {
  const dateRange = parseQueryMonthRange(query.fecha);

  return {
    version: query.version,
    segmento,
    OR: [{ fecha: dateRange }, { fecha: null, fechaLiquidacion: dateRange }]
  };
}

function buildLiquidationAnalysisReganecuQhWhere(
  query: LiquidationAnalysisQueryDto,
  segmento: string
): Prisma.ReganecuQhRecordWhereInput {
  const dateRange = parseQueryMonthRange(query.fecha);

  return {
    version: query.version,
    segmento,
    OR: [{ fecha: dateRange }, { fecha: null, fechaLiquidacion: dateRange }]
  };
}

function buildReganecuWhereFromMedperQuery(query: MedperQueryDto): Prisma.ReganecuRecordWhereInput {
  const dateRange = buildQueryDateRange(query);
  const andFilters: Prisma.ReganecuRecordWhereInput[] = [];

  if (dateRange) {
    andFilters.push({
      fecha: dateRange
    });
  }

  return {
    sujetoEic: query.sujeto?.toUpperCase(),
    codigoUpr: query.upr?.toUpperCase(),
    brp: query.brp?.toUpperCase(),
    AND: andFilters.length > 0 ? andFilters : undefined
  };
}

function buildReganecuQhWhereFromMedperQuery(query: MedperQueryDto): Prisma.ReganecuQhRecordWhereInput {
  const dateRange = buildQueryDateRange(query);
  const andFilters: Prisma.ReganecuQhRecordWhereInput[] = [];

  if (dateRange) {
    andFilters.push({
      fecha: dateRange
    });
  }

  return {
    sujetoEic: query.sujeto?.toUpperCase(),
    codigoUpr: query.upr?.toUpperCase(),
    brp: query.brp?.toUpperCase(),
    AND: andFilters.length > 0 ? andFilters : undefined
  };
}

function buildQueryDateRange(query: { fecha?: string; fechaInicio?: string; fechaFin?: string }) {
  if (query.fechaInicio || query.fechaFin) {
    return parseQueryDateRange(query.fechaInicio, query.fechaFin);
  }

  return query.fecha ? parseQueryMonthRange(query.fecha) : undefined;
}

function parseQueryDateRange(fechaInicio?: string, fechaFin?: string) {
  const start = fechaInicio ? parseQueryDateOnly(fechaInicio) : undefined;
  const end = fechaFin ? parseQueryDateOnly(fechaFin) : undefined;
  if (!start && !end) {
    return undefined;
  }

  const range: { gte?: Date; lt?: Date } = {};
  if (start) {
    range.gte = start;
  }
  if (end) {
    range.lt = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + 1));
  }

  return range;
}

function parseQueryDateOnly(value: string) {
  const compactDate = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (compactDate) {
    return new Date(Date.UTC(Number(compactDate[1]), Number(compactDate[2]) - 1, Number(compactDate[3])));
  }

  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (isoDate) {
    return new Date(Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])));
  }

  return undefined;
}

function parseQueryMonthRange(value: string) {
  const compactDate = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (compactDate) {
    return buildMonthRange(Number(compactDate[1]), Number(compactDate[2]));
  }

  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month) {
    return buildMonthRange(Number(month[1]), Number(month[2]));
  }

  const isoDate = /^(\d{4})-(\d{2})-\d{2}$/.exec(value);
  if (isoDate) {
    return buildMonthRange(Number(isoDate[1]), Number(isoDate[2]));
  }

  return undefined;
}

function buildMonthRange(year: number, month: number) {
  return {
    gte: new Date(Date.UTC(year, month - 1, 1)),
    lt: new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1))
  };
}

function toMonthKey(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildMonthWindow(latestMonthKey: string, count: number) {
  const parsed = /^(\d{4})-(\d{2})$/.exec(latestMonthKey);
  if (!parsed) {
    return [];
  }

  const year = Number(parsed[1]);
  const month = Number(parsed[2]);
  const months: string[] = [];

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    months.push(toMonthKey(date));
  }

  return months;
}

function monthVersionKey(month: string, version: string) {
  return `${month}|${version}`;
}

function buildMonthRangeFromKey(monthKey: string, offsetMonths: number) {
  const parsed = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!parsed) {
    const now = new Date();
    return {
      gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offsetMonths, 1)),
      lt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    };
  }

  const year = Number(parsed[1]);
  const month = Number(parsed[2]);
  return {
    gte: new Date(Date.UTC(year, month - 1 - offsetMonths, 1)),
    lt: new Date(Date.UTC(year, month, 1))
  };
}

function sortMedperVersions(values: string[]) {
  return [...values].sort((left, right) => {
    const leftMatch = /^([A-Z]+)(\d+)$/.exec(left);
    const rightMatch = /^([A-Z]+)(\d+)$/.exec(right);
    const leftPrefix = leftMatch?.[1] ?? left;
    const rightPrefix = rightMatch?.[1] ?? right;
    const prefixCompare = leftPrefix.localeCompare(rightPrefix);
    if (prefixCompare !== 0) {
      return prefixCompare;
    }

    const leftNumber = Number(leftMatch?.[2] ?? Number.NaN);
    const rightNumber = Number(rightMatch?.[2] ?? Number.NaN);
    if (Number.isNaN(leftNumber) || Number.isNaN(rightNumber)) {
      return left.localeCompare(right);
    }

    return leftNumber - rightNumber;
  });
}

function latestSortedVersion(values: string[]) {
  const sorted = sortMedperVersions([...new Set(values)]);
  return sorted[sorted.length - 1] ?? values[0] ?? "";
}

function normalizeMonthOptionRows(rows: MonthOptionRow[]) {
  return [...new Set(rows.map((row) => row.month).filter(isNonEmptyString))].sort((left, right) => right.localeCompare(left));
}

function normalizeTextOptionRows(rows: DistinctTextOptionRow[]) {
  return [...new Set(rows.map((row) => row.value?.trim()).filter(isNonEmptyString))].sort((left, right) =>
    left.localeCompare(right, "es", { numeric: true, sensitivity: "base" })
  );
}

function readCache<T>(entry?: CacheEntry<T>) {
  return entry && entry.expiresAt > Date.now() ? entry.value : undefined;
}

function writeCache<T>(value: T): CacheEntry<T> {
  return {
    value,
    expiresAt: Date.now() + FILTER_OPTIONS_CACHE_MS
  };
}

function sortMedperSummaryGroups<T extends { version: string }>(groups: T[]) {
  const order = new Map(sortMedperVersions([...new Set(groups.map((group) => group.version))]).map((version, index) => [version, index]));
  return [...groups].sort((left, right) => (order.get(left.version) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.version) ?? Number.MAX_SAFE_INTEGER));
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function clampTake(value?: number) {
  return Math.min(Math.max(value ?? PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);
}

function summaryGroupKey(fechaLiquidacion: Date, version: ReeSettlementVersion, segmento: string | null) {
  return [toIsoDate(fechaLiquidacion), version, segmento ?? ""].join("|");
}

function sumHourlyAverageEnergy(hourlyEnergy: Map<string, { sum: number; count: number }>) {
  return [...hourlyEnergy.values()].reduce(
    (total, hour) => total + (hour.count > 0 ? hour.sum / hour.count : 0),
    0
  );
}

function decimalToNumber(value: { toString(): string } | null | undefined) {
  const numeric = Number(value?.toString() ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatSummaryDecimal(value: number) {
  const rounded = Math.abs(value) < 0.0000005 ? 0 : value;
  return rounded.toFixed(6).replace(/\.?0+$/, "");
}

function readRawPayloadText(payload: unknown, field: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const value = (payload as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseIntegerText(value?: string) {
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
}

function quarterHourFromDateText(value?: string) {
  const parsed = parseRecordDateTime(value);
  if (parsed?.hour === undefined || parsed.minute === undefined || parsed.minute % 15 !== 0) {
    return undefined;
  }

  return parsed.hour * 4 + parsed.minute / 15 + 1;
}

function parseRecordDateText(value?: string) {
  return parseRecordDateTime(value)?.date;
}

function parseRecordDateTime(value?: string) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  const compact = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?$/.exec(trimmed);
  if (compact) {
    return buildRecordDateTime(
      Number(compact[1]),
      Number(compact[2]),
      Number(compact[3]),
      compact[4] === undefined ? undefined : Number(compact[4]),
      compact[5] === undefined ? undefined : Number(compact[5])
    );
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z)?)?$/.exec(trimmed);
  if (iso) {
    return buildRecordDateTime(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      iso[4] === undefined ? undefined : Number(iso[4]),
      iso[5] === undefined ? undefined : Number(iso[5])
    );
  }

  const european = /^(\d{2})[/-](\d{2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?$/.exec(trimmed);
  if (european) {
    return buildRecordDateTime(
      Number(european[3]),
      Number(european[2]),
      Number(european[1]),
      european[4] === undefined ? undefined : Number(european[4]),
      european[5] === undefined ? undefined : Number(european[5])
    );
  }

  return undefined;
}

function buildRecordDateTime(year: number, month: number, day: number, hour?: number, minute?: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }

  if (hour === undefined && minute === undefined) {
    return { date };
  }

  if (hour === undefined || minute === undefined || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return undefined;
  }

  return { date, hour, minute };
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatGroup(group: any) {
  return {
    ...group,
    records: group._count._all,
    sums: group._sum
  };
}

function formatComparisonGroup(group: any) {
  return {
    ...group,
    records: group._count._all,
    energiaMwh: group._sum.energiaMwh,
    importeEur: group._sum.importeEur
  };
}

function conciliationKey(date: Date | null, code: string | null) {
  return [date ? toIsoDate(date) : "", code ?? ""].join("|");
}

function formatIssue(error: ParseIssue) {
  return `${error.sourceFileName}:${error.lineNumber} ${error.message}`;
}

function formatMedperIssue(error: MedperParseIssue) {
  return `${error.sourceFileName}:${error.lineNumber} ${error.message}`;
}

async function runWithPrismaRetry<T>(operation: () => Promise<T>, retries = PRISMA_POOL_RETRIES): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isPrismaPoolTimeout(error) || attempt === retries) {
        throw error;
      }

      await wait(150 * (attempt + 1));
    }
  }

  throw lastError;
}

function isPrismaPoolTimeout(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2024";
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toPrismaBytes(buffer: Buffer): Uint8Array<ArrayBuffer> {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  const bytes = new Uint8Array(arrayBuffer);
  bytes.set(buffer);
  return bytes;
}
