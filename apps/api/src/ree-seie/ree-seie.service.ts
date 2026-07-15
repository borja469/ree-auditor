import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { Prisma, ReeFileType, ReeImportStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { PrismaService } from "../prisma/prisma.service";
import { extractSourceFiles, SourceFile } from "../imports/parsers/archive.parser";
import { ReeSeieQueryDto } from "./dto/ree-seie-query.dto";
import {
  detectSeieDelimiter,
  parseReeSeieMetadata,
  parseReeSeieRecords,
  ParsedReeSeieRecord,
  ReeSeieMetadata,
  ReeSeieParseIssue
} from "./parsers/ree-seie.parser";

type ImportableFile = Pick<Express.Multer.File, "originalname" | "buffer" | "size">;
type ImportResultStatus = "IMPORTED" | "FAILED" | "DUPLICATE";
type DbClient = PrismaService | Prisma.TransactionClient;

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
} satisfies Prisma.ReeSeieFileSelect;

const PAGE_SIZE_DEFAULT = 100;
const PAGE_SIZE_MAX = 1000;
const INSERT_BATCH_SIZE = 5000;

@Injectable()
export class ReeSeieService {
  constructor(private readonly prisma: PrismaService) {}

  async listFiles(query: Partial<Pick<ReeSeieQueryDto, "skip" | "take">> = {}) {
    return this.prisma.reeSeieFile.findMany({
      orderBy: {
        importedAt: "desc"
      },
      select: FILE_SELECT,
      skip: query.skip ?? 0,
      take: clampTake(query.take)
    });
  }

  async importFiles(files: Express.Multer.File[], options: { overwrite?: boolean; auditUser?: string } = {}) {
    if (files.length === 0) {
      throw new BadRequestException("Debe adjuntarse al menos un fichero multipart.");
    }

    const plan = buildSourcePlan(files);
    await this.validateUploadConflicts(plan.sourceFiles, options.overwrite);
    const results: ImportResult[] = [...plan.initialResults];
    for (const sourceFile of plan.sourceFiles) {
      results.push(await this.importSourceFile(sourceFile, options));
    }

    return buildImportResponse(results, files.length);
  }

  async filterOptions() {
    const [versions, months, codigos, unidades, tipos, sentidos, segmentos, archivos] = await Promise.all([
      this.prisma.$queryRaw<Array<{ value: string | null }>>`
        SELECT DISTINCT version AS value FROM ree_seie_records WHERE version IS NOT NULL ORDER BY value
      `,
      this.prisma.$queryRaw<Array<{ value: string | null }>>`
        SELECT DISTINCT to_char(fecha, 'YYYY-MM') AS value FROM ree_seie_records WHERE fecha IS NOT NULL ORDER BY value DESC
      `,
      this.distinctText("codigo"),
      this.distinctText("unidad"),
      this.distinctText("tipo"),
      this.distinctText("sentido"),
      this.distinctText("segmento"),
      this.distinctText("filename")
    ]);

    return {
      versions: normalizeOptions(versions),
      months: normalizeOptions(months),
      codigos,
      unidades,
      tipos,
      sentidos,
      segmentos,
      archivos,
      latestMonth: normalizeOptions(months)[0] ?? null
    };
  }

  async listRecords(query: ReeSeieQueryDto) {
    return this.prisma.reeSeieRecord.findMany({
      where: buildWhere(query),
      orderBy: [{ fecha: "asc" }, { hora: "asc" }, { codigo: "asc" }, { unidad: "asc" }],
      skip: query.skip,
      take: clampTake(query.take),
      include: {
        file: {
          select: FILE_SELECT
        }
      }
    });
  }

  async summary(query: ReeSeieQueryDto) {
    const [files, records] = await Promise.all([
      this.prisma.reeSeieFile.findMany({
        where: {
          fechaLiquidacion: buildDateRange(query),
          version: query.version
        },
        select: FILE_SELECT,
        orderBy: {
          importedAt: "desc"
        },
        take: 50
      }),
      this.prisma.reeSeieRecord.groupBy({
        by: ["fechaLiquidacion", "version", "segmento", "tipo"] as const,
        where: buildWhere(query),
        _count: {
          _all: true
        },
        _sum: {
          magnitud: true,
          energia: true
        },
        orderBy: [{ fechaLiquidacion: "asc" }, { version: "asc" }, { segmento: "asc" }]
      }),
    ]);
    const invalidRecords = files.reduce((sum, file) => sum + file.invalidRecords, 0);

    return {
      files,
      groups: records.map((row) => ({
        fechaLiquidacion: row.fechaLiquidacion,
        version: row.version,
        segmento: row.segmento,
        tipo: row.tipo,
        records: row._count._all,
        magnitud: decimalToText(row._sum.magnitud),
        energia: decimalToText(row._sum.energia)
      })),
      validation: {
        invalidRecords
      }
    };
  }

  async export(query: ReeSeieQueryDto) {
    const rows = await this.prisma.reeSeieRecord.findMany({
      where: buildWhere(query),
      orderBy: [{ fecha: "asc" }, { hora: "asc" }, { codigo: "asc" }, { unidad: "asc" }],
      take: 50000
    });
    const exportRows = rows.map((row) => ({
      Fecha: dateKey(row.fecha),
      Hora: row.hora ?? "",
      Codigo: row.codigo ?? "",
      Unidad: row.unidad ?? "",
      Tipo: row.tipo ?? "",
      Sentido: row.sentido ?? "",
      Segmento: row.segmento ?? "",
      Magnitud: decimalToText(row.magnitud),
      Precio: decimalToText(row.precio),
      Energia: decimalToText(row.energia),
      Archivo: row.filename
    }));

    if (query.format === "xlsx") {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exportRows), "SEIE");
      return {
        fileName: "ree-seie.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        content: XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer
      };
    }

    return {
      fileName: "ree-seie.csv",
      contentType: "text/csv; charset=utf-8",
      content: buildCsv(exportRows)
    };
  }

  async downloadCenterSummary() {
    return this.prisma.$queryRaw<
      Array<{
        month: string;
        module: "SEIE";
        status: string;
        label: string | null;
        loads: bigint | number;
        records: bigint | number | null;
        latestLoad: Date | null;
      }>
    >`
      SELECT
        to_char(fecha_liquidacion, 'YYYY-MM') AS month,
        'SEIE'::text AS module,
        CASE
          WHEN count(*) FILTER (WHERE status = 'IMPORTED') > 0 THEN 'correct'
          WHEN count(*) FILTER (WHERE status = 'DUPLICATED') > 0 THEN 'duplicated'
          WHEN count(*) FILTER (WHERE status = 'FAILED') > 0 THEN 'error'
          ELSE 'pending'
        END AS status,
        CASE
          WHEN max(NULLIF(regexp_replace(version, '[^0-9]', '', 'g'), '')::int) FILTER (WHERE status = 'IMPORTED') IS NOT NULL
            THEN 'Completo (C' || max(NULLIF(regexp_replace(version, '[^0-9]', '', 'g'), '')::int) FILTER (WHERE status = 'IMPORTED') || ')'
          ELSE NULL
        END AS label,
        count(*) AS loads,
        coalesce(sum(total_records), 0) AS records,
        max(imported_at) AS "latestLoad"
      FROM ree_seie_files
      GROUP BY to_char(fecha_liquidacion, 'YYYY-MM')
      ORDER BY 1 DESC
    `.then((rows) =>
      rows.map((row) => ({
        month: row.month,
        module: row.module,
        status: row.status,
        label: row.label,
        loads: Number(row.loads),
        records: Number(row.records ?? 0),
        latestLoad: row.latestLoad?.toISOString() ?? null
      }))
    );
  }

  private async distinctText(field: "codigo" | "unidad" | "tipo" | "sentido" | "segmento" | "filename") {
    const tableField = {
      codigo: "codigo",
      unidad: "unidad",
      tipo: "tipo",
      sentido: "sentido",
      segmento: "segmento",
      filename: "filename"
    }[field];
    const rows = await this.prisma.$queryRaw<Array<{ value: string | null }>>(
      Prisma.sql`SELECT DISTINCT ${Prisma.raw(tableField)} AS value FROM ree_seie_records WHERE ${Prisma.raw(tableField)} IS NOT NULL AND btrim(${Prisma.raw(tableField)}) <> '' ORDER BY value LIMIT 500`
    );
    return normalizeOptions(rows);
  }

  private async validateUploadConflicts(sourceFiles: SourceFile[], overwrite = false) {
    const conflicts = [];
    for (const sourceFile of sourceFiles) {
      const fileHash = createHash("sha256").update(sourceFile.buffer).digest("hex");
      const existing = await this.prisma.reeSeieFile.findUnique({
        where: {
          fileHash
        },
        select: FILE_SELECT
      });
      if (existing) {
        conflicts.push({
          fileName: sourceFile.name,
          tipoArchivo: "SEIE",
          fecha: dateKey(existing.fechaLiquidacion),
          version: existing.version,
          existingFileId: existing.id,
          existingFileName: existing.fileName,
          existingImportedAt: existing.importedAt
        });
      }
    }

    if (conflicts.length > 0 && !overwrite) {
      throw new ConflictException({
        message: "Ya existe una carga SEIE con el mismo hash.",
        conflicts
      });
    }
  }

  private async importSourceFile(sourceFile: SourceFile, options: { overwrite?: boolean; auditUser?: string } = {}): Promise<ImportResult> {
    let metadata: ReeSeieMetadata;
    try {
      metadata = parseReeSeieMetadata(sourceFile.content, sourceFile.name);
    } catch (error) {
      return failedImport(sourceFile.name, error instanceof Error ? error.message : "Fichero SEIE no valido.");
    }

    const fileHash = createHash("sha256").update(sourceFile.buffer).digest("hex");
    const delimiter = detectSeieDelimiter(sourceFile.content);
    const importFile = async (db: DbClient) => {
      if (options.overwrite) {
        await db.reeSeieFile.deleteMany({
          where: {
            fileHash
          }
        });
      }

      const file = await db.reeSeieFile.create({
        data: {
          fileName: sourceFile.name,
          containerFileName: sourceFile.containerName,
          fileHash,
          tipoArchivo: ReeFileType.SEIE,
          version: metadata.version,
          fechaLiquidacion: metadata.fechaLiquidacion,
          sujetoEic: metadata.sujetoEic,
          encoding: sourceFile.encoding,
          delimiter,
          originalContent: toPrismaBytes(sourceFile.buffer)
        },
        select: FILE_SELECT
      });

      const stats = await this.persistParsedRecords(db, file.id, sourceFile, metadata, delimiter, fileHash);
      const status = stats.recordsImported === 0 && stats.invalidRecords > 0 ? ReeImportStatus.FAILED : ReeImportStatus.IMPORTED;
      const updatedFile = await db.reeSeieFile.update({
        where: {
          id: file.id
        },
        data: {
          status,
          totalRecords: stats.totalRecords,
          validRecords: stats.validRecords,
          invalidRecords: stats.invalidRecords,
          duplicatedRecords: stats.duplicatedRecords,
          errorMessage: stats.errors.slice(0, 20).map(formatIssue).join(" | ") || null
        },
        select: FILE_SELECT
      });

      return buildImportResult(sourceFile.name, updatedFile, stats);
    };

    try {
      return options.overwrite ? await this.prisma.$transaction(importFile) : await importFile(this.prisma);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException({
          message: "Ya existe una carga SEIE con el mismo hash.",
          conflicts: [
            {
              fileName: sourceFile.name,
              tipoArchivo: "SEIE",
              fecha: dateKey(metadata.fechaLiquidacion),
              version: metadata.version,
              existingFileId: "",
              existingFileName: sourceFile.name,
              existingImportedAt: new Date()
            }
          ]
        });
      }
      throw error;
    }
  }

  private async persistParsedRecords(
    db: DbClient,
    fileId: string,
    sourceFile: SourceFile,
    metadata: ReeSeieMetadata,
    delimiter: string,
    fileHash: string
  ) {
    let totalRecords = 0;
    let validRecords = 0;
    let invalidRecords = 0;
    let recordsImported = 0;
    let duplicatedRecords = 0;
    const errors: ReeSeieParseIssue[] = [];
    let batch: ParsedReeSeieRecord[] = [];

    const flush = async () => {
      if (batch.length === 0) {
        return;
      }
      const result = await db.reeSeieRecord.createMany({
        data: batch.map((record) => toRecordRow(fileId, sourceFile.name, fileHash, metadata, record)),
        skipDuplicates: true
      });
      recordsImported += result.count;
      duplicatedRecords += batch.length - result.count;
      batch = [];
    };

    for (const result of parseReeSeieRecords({ sourceFileName: sourceFile.name, content: sourceFile.content, delimiter, metadata })) {
      totalRecords += 1;
      if (result.error) {
        invalidRecords += 1;
        errors.push(result.error);
        continue;
      }
      if (!result.record) {
        continue;
      }
      if (result.record.validationErrors.length > 0) {
        invalidRecords += 1;
        errors.push({
          sourceFileName: sourceFile.name,
          lineNumber: result.record.sourceLineNumber,
          message: result.record.validationErrors.join(", "),
          rawLine: result.record.rawLine
        });
        continue;
      }
      validRecords += 1;
      batch.push(result.record);
      if (batch.length >= INSERT_BATCH_SIZE) {
        await flush();
      }
    }

    await flush();
    return { totalRecords, validRecords, invalidRecords, recordsImported, duplicatedRecords, errors };
  }
}

type ImportResult = {
  fileName: string;
  status: ImportResultStatus;
  file?: Prisma.ReeSeieFileGetPayload<{ select: typeof FILE_SELECT }>;
  recordsImported: number;
  validRecords: number;
  invalidRecords: number;
  duplicatedRecords: number;
  errors: Array<{ sourceFileName: string; lineNumber: number; message: string }>;
};

function toRecordRow(fileId: string, filename: string, fileHash: string, metadata: ReeSeieMetadata, record: ParsedReeSeieRecord): Prisma.ReeSeieRecordCreateManyInput {
  return {
    fileId,
    uploadId: fileId,
    filename,
    hash: fileHash,
    version: metadata.version,
    fechaLiquidacion: metadata.fechaLiquidacion,
    sujetoEic: metadata.sujetoEic,
    fecha: record.fecha,
    hora: record.hora,
    codigo: record.codigo,
    magnitud: record.magnitud,
    precio: record.precio,
    energia: record.energia,
    unidad: record.unidad,
    tipo: record.tipo,
    sentido: record.sentido,
    segmento: record.segmento,
    campo01Fecha: record.fields.campo01Fecha,
    campo02Hora: record.fields.campo02Hora,
    campo03Codigo: record.fields.campo03Codigo,
    campo04Magnitud: record.fields.campo04Magnitud,
    campo05Reservado1: record.fields.campo05Reservado1,
    campo06Precio: record.fields.campo06Precio,
    campo07Reservado2: record.fields.campo07Reservado2,
    campo08Energia: record.fields.campo08Energia,
    campo09Reservado3: record.fields.campo09Reservado3,
    campo10Reservado4: record.fields.campo10Reservado4,
    campo11Tipo: record.fields.campo11Tipo,
    campo12Sentido: record.fields.campo12Sentido,
    campo13Unidad: record.fields.campo13Unidad,
    campo14Segmento: record.fields.campo14Segmento,
    campo15SignoImporte: record.fields.campo15SignoImporte,
    campo16SignoMagnitud: record.fields.campo16SignoMagnitud,
    campo17SujetoEic: record.fields.campo17SujetoEic,
    campo18CodigoPrecio: record.fields.campo18CodigoPrecio,
    campo19CodigoUnidad2: record.fields.campo19CodigoUnidad2,
    campo20CodigoUnidad3: record.fields.campo20CodigoUnidad3,
    campo21Clase: record.fields.campo21Clase,
    campo22Valor1: record.fields.campo22Valor1,
    campo23Valor2: record.fields.campo23Valor2,
    campo24Valor3: record.fields.campo24Valor3,
    validationErrors: record.validationErrors.length > 0 ? record.validationErrors : Prisma.JsonNull,
    rawPayloadJson: record.rawPayloadJson,
    rawLine: record.rawLine,
    sourceLineNumber: record.sourceLineNumber,
    recordHash: record.recordHash
  };
}

function buildSourcePlan(files: ImportableFile[]) {
  const sourceFiles: SourceFile[] = [];
  const initialResults: ImportResult[] = [];
  for (const file of files) {
    try {
      sourceFiles.push(...extractSourceFiles(file.originalname, file.buffer));
    } catch (error) {
      initialResults.push(failedImport(file.originalname, error instanceof Error ? error.message : "No se pudo leer el fichero."));
    }
  }
  return { sourceFiles, initialResults };
}

function failedImport(fileName: string, message: string): ImportResult {
  return {
    fileName,
    status: "FAILED",
    recordsImported: 0,
    validRecords: 0,
    invalidRecords: 1,
    duplicatedRecords: 0,
    errors: [{ sourceFileName: fileName, lineNumber: 0, message }]
  };
}

function buildImportResult(
  fileName: string,
  file: Prisma.ReeSeieFileGetPayload<{ select: typeof FILE_SELECT }>,
  stats: { recordsImported: number; validRecords: number; invalidRecords: number; duplicatedRecords: number; errors: ReeSeieParseIssue[] }
): ImportResult {
  return {
    fileName,
    status: file.status === "DUPLICATED" ? "DUPLICATE" : file.status,
    file,
    recordsImported: stats.recordsImported,
    validRecords: stats.validRecords,
    invalidRecords: stats.invalidRecords,
    duplicatedRecords: stats.duplicatedRecords,
    errors: stats.errors.map(({ sourceFileName, lineNumber, message }) => ({ sourceFileName, lineNumber, message }))
  };
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

function buildWhere(query: ReeSeieQueryDto): Prisma.ReeSeieRecordWhereInput {
  const andFilters: Prisma.ReeSeieRecordWhereInput[] = [];
  const dateRange = buildDateRange(query);
  const unidades = splitTextList(query.unidad).map((value) => value.toUpperCase());
  if (dateRange) {
    andFilters.push({ fecha: dateRange });
  }
  if (query.archivo) {
    andFilters.push({ filename: { contains: query.archivo, mode: "insensitive" } });
  }
  return {
    codigo: query.codigo?.toUpperCase(),
    unidad: unidades.length > 1 ? { in: unidades } : unidades[0],
    tipo: query.tipo,
    sentido: query.sentido,
    segmento: query.segmento,
    hora: query.hora,
    version: query.version,
    AND: andFilters.length > 0 ? andFilters : undefined
  };
}

function splitTextList(value?: string) {
  return value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean) ?? [];
}

function buildDateRange(query: { fecha?: string; fechaInicio?: string; fechaFin?: string }) {
  if (query.fechaInicio || query.fechaFin) {
    const range: { gte?: Date; lt?: Date } = {};
    const start = query.fechaInicio ? parseDateOnly(query.fechaInicio) : undefined;
    const end = query.fechaFin ? parseDateOnly(query.fechaFin) : undefined;
    if (start) {
      range.gte = start;
    }
    if (end) {
      range.lt = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + 1));
    }
    return range.gte || range.lt ? range : undefined;
  }
  if (!query.fecha) {
    return undefined;
  }
  const month = /^(\d{4})-(\d{2})$/.exec(query.fecha);
  if (month) {
    return {
      gte: new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1)),
      lt: new Date(Date.UTC(Number(month[2]) === 12 ? Number(month[1]) + 1 : Number(month[1]), Number(month[2]) === 12 ? 0 : Number(month[2]), 1))
    };
  }
  const date = parseDateOnly(query.fecha);
  return date ? { gte: date, lt: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)) } : undefined;
}

function parseDateOnly(value: string) {
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

function normalizeOptions(rows: Array<{ value: string | null }>) {
  return [...new Set(rows.map((row) => row.value).filter((value): value is string => Boolean(value)))];
}

function formatIssue(error: ReeSeieParseIssue) {
  return `${error.sourceFileName}:${error.lineNumber} ${error.message}`;
}

function buildCsv<T extends object>(rows: T[]) {
  if (rows.length === 0) {
    return "";
  }
  const headers = Object.keys(rows[0]);
  return [headers.join(";"), ...rows.map((row) => headers.map((header) => csvCell(row[header as keyof T])).join(";"))].join("\n");
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

function decimalToText(value: { toString(): string } | string | number | null | undefined) {
  return value === null || value === undefined ? null : value.toString();
}

function dateKey(value: Date | null | undefined) {
  return value?.toISOString().slice(0, 10) ?? "";
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

function clampTake(value?: number) {
  return Math.min(Math.max(value ?? PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);
}

function toPrismaBytes(buffer: Buffer): Uint8Array<ArrayBuffer> {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  const bytes = new Uint8Array(arrayBuffer);
  bytes.set(buffer);
  return bytes;
}
