import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  detectDelimiter,
  parseKFactorFileMetadata,
  parseKFactorRecords,
  ReeKFactorMetadata,
  ReeKFactorParseIssue
} from "./parsers/ree-k-factor.parser";
import { extractSourceFiles, SourceFile } from "./parsers/source-file.parser";
import { ReeLossesRegulatoryEngine } from "./regulatory-engine.service";
import { ImportableFile, ImportResult, NormalizedKFactorInput, PeriodContext } from "./ree-losses.types";

type ImportSourcePlan = {
  sourceFiles: SourceFile[];
  initialResults: ImportResult[];
};

const INSERT_BATCH_SIZE = 5000;

@Injectable()
export class ReeKFactorImporter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regulatoryEngine: ReeLossesRegulatoryEngine
  ) {}

  async importKFactorFiles(files: Express.Multer.File[]) {
    if (files.length === 0) {
      throw new BadRequestException("Debe adjuntarse al menos un fichero multipart.");
    }

    await this.regulatoryEngine.ensureReferenceData();
    const plan = buildSourcePlan(files);
    const context = await this.regulatoryEngine.buildPeriodContext();
    const results: ImportResult[] = [...plan.initialResults];

    for (let index = 0; index < plan.initialResults.length; index += 1) {
      results[index] = await this.persistImportResult(plan.initialResults[index]);
    }

    for (const sourceFile of plan.sourceFiles) {
      results.push(await this.importSourceFile(sourceFile, context));
    }

    return buildImportResponse(results, files.length);
  }

  private async importSourceFile(sourceFile: SourceFile, context: PeriodContext): Promise<ImportResult> {
    const metadataResult = safeParseMetadata(sourceFile);
    if (!metadataResult.ok) {
      return this.persistImportResult(failedImportResult(sourceFile.name, metadataResult.message), sourceFile);
    }

    const delimiter = detectDelimiter(sourceFile.content);
    const errors: ReeKFactorParseIssue[] = [];
    const rows: NormalizedKFactorInput[] = [];
    for (const result of parseKFactorRecords({
      sourceFileName: sourceFile.name,
      content: sourceFile.content,
      delimiter,
      metadata: metadataResult.metadata
    })) {
      if (result.error) {
        errors.push(result.error);
        continue;
      }
      if (result.record) {
        rows.push(...this.regulatoryEngine.expandParsedRecord(result.record, metadataResult.metadata, context, errors, sourceFile.name));
      }
    }

    if (rows.length === 0 && errors.length > 0 && errors.every((error) => error.message === "valor_k_invalido")) {
      return this.persistImportResult(
        noKValuesImportResult(sourceFile.name, metadataResult.metadata.version, metadataResult.metadata.tipoArchivo, errors.length),
        sourceFile,
        metadataResult.metadata
      );
    }

    validateTemporalConsistency(rows, errors, sourceFile.name);

    const duplicateKeys = countDuplicateKeys(rows.map(kFactorIdentityKey));
    let imported = 0;
    for (const batch of chunk(rows, INSERT_BATCH_SIZE)) {
      const result = await this.prisma.reeKFactor.createMany({
        data: batch.map((row) => ({
          fecha: normalizeDateOnly(row.fecha),
          hora: row.hora,
          cuartohora: row.cuartohora,
          version: row.version,
          tipoArchivo: row.tipoArchivo,
          tarifa: row.tarifa,
          periodo: row.periodo,
          valorK: row.valorK.toFixed(10)
        }))
      });
      imported += result.count;
    }

    return this.persistImportResult({
      fileName: sourceFile.name,
      status: errors.length > 0 && imported === 0 ? "FAILED" : "IMPORTED",
      tipoArchivo: metadataResult.metadata.tipoArchivo,
      version: metadataResult.metadata.version,
      fechaInicio: toIsoDate(metadataResult.metadata.fechaInicio),
      fechaFin: toIsoDate(metadataResult.metadata.fechaFin),
      recordsImported: imported,
      validRecords: rows.length,
      invalidRecords: errors.length,
      duplicatedRecords: duplicateKeys,
      errors: errors.slice(0, 100).map((error) => ({
        sourceFileName: error.sourceFileName,
        lineNumber: error.lineNumber,
          message: error.message
        }))
    }, sourceFile, metadataResult.metadata);
  }

  private async persistImportResult(result: ImportResult, sourceFile?: SourceFile, metadata?: ReeKFactorMetadata): Promise<ImportResult> {
    const created = await this.prisma.reeKFactorImport.create({
      data: {
        fileName: result.fileName,
        containerFileName: sourceFile?.containerName,
        fileHash: sourceFile ? createHash("sha256").update(sourceFile.buffer).digest("hex") : undefined,
        tipoArchivo: metadata?.tipoArchivo ?? result.tipoArchivo ?? undefined,
        version: metadata?.version ?? result.version ?? undefined,
        fechaInicio: metadata?.fechaInicio ? normalizeDateOnly(metadata.fechaInicio) : result.fechaInicio ? new Date(`${result.fechaInicio}T00:00:00.000Z`) : undefined,
        fechaFin: metadata?.fechaFin ? normalizeDateOnly(metadata.fechaFin) : result.fechaFin ? new Date(`${result.fechaFin}T00:00:00.000Z`) : undefined,
        status: result.status === "IMPORTED" ? "IMPORTED" : "FAILED",
        errorMessage: result.errors.map((error) => `${error.sourceFileName}:${error.lineNumber} ${error.message}`).slice(0, 8).join("\n") || undefined,
        totalRecords: result.validRecords + result.invalidRecords,
        validRecords: result.validRecords,
        invalidRecords: result.invalidRecords,
        duplicatedRecords: result.duplicatedRecords
      }
    });

    return {
      ...result,
      id: created.id,
      tipoArchivo: created.tipoArchivo,
      version: created.version,
      fechaInicio: created.fechaInicio ? toIsoDate(created.fechaInicio) : null,
      fechaFin: created.fechaFin ? toIsoDate(created.fechaFin) : null,
      importedAt: created.importedAt.toISOString()
    };
  }
}

function safeParseMetadata(sourceFile: SourceFile) {
  try {
    return {
      ok: true as const,
      metadata: parseKFactorFileMetadata(sourceFile.name, sourceFile.content)
    };
  } catch (error) {
    if (sourceFile.containerName) {
      try {
        return {
          ok: true as const,
          metadata: parseKFactorFileMetadata(sourceFile.containerName, sourceFile.content)
        };
      } catch {
        return {
          ok: false as const,
          message:
            error instanceof Error
              ? `${error.message}. Tampoco se pudo detectar desde el contenedor ${sourceFile.containerName}.`
              : `No se pudo detectar el fichero K desde ${sourceFile.name} ni desde ${sourceFile.containerName}.`
        };
      }
    }

    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "No se pudo detectar el fichero K."
    };
  }
}

function validateTemporalConsistency(rows: NormalizedKFactorInput[], errors: ReeKFactorParseIssue[], sourceFileName: string) {
  const sorted = [...rows].sort(
    (left, right) =>
      left.fecha.getTime() - right.fecha.getTime() ||
      left.hora - right.hora ||
      left.cuartohora - right.cuartohora ||
      left.tarifa.localeCompare(right.tarifa) ||
      left.periodo.localeCompare(right.periodo) ||
      left.version.localeCompare(right.version)
  );

  for (const row of sorted) {
    if (Number.isNaN(row.fecha.getTime())) {
      errors.push({ sourceFileName, lineNumber: 0, message: "fecha_invalida" });
    }
    if (row.hora < 1 || row.hora > 25 || row.cuartohora < 1 || row.cuartohora > 4) {
      errors.push({ sourceFileName, lineNumber: 0, message: "cuartohora_fuera_de_rango" });
    }
    if (!/^P[1-6]$/.test(row.periodo)) {
      errors.push({ sourceFileName, lineNumber: 0, message: "periodo_invalido" });
    }
  }
}

function buildSourcePlan(files: ImportableFile[]): ImportSourcePlan {
  const plan: ImportSourcePlan = {
    sourceFiles: [],
    initialResults: []
  };

  for (const upload of files) {
    const sourceFiles = extractSourceFiles(upload.originalname, upload.buffer);
    if (sourceFiles.length === 0) {
      plan.initialResults.push(failedImportResult(upload.originalname, "El fichero no contiene entradas importables."));
      continue;
    }

    plan.sourceFiles.push(...sourceFiles);
  }

  return plan;
}

function failedImportResult(fileName: string, message: string): ImportResult {
  return {
    fileName,
    status: "FAILED",
    recordsImported: 0,
    validRecords: 0,
    invalidRecords: 1,
    duplicatedRecords: 0,
    errors: [
      {
        sourceFileName: fileName,
        lineNumber: 0,
        message
      }
    ]
  };
}

function noKValuesImportResult(fileName: string, version: string, tipoArchivo: string, invalidRecords: number): ImportResult {
  return {
    fileName,
    status: "FAILED",
    recordsImported: 0,
    validRecords: 0,
    invalidRecords,
    duplicatedRecords: 0,
    errors: [
      {
        sourceFileName: fileName,
        lineNumber: 0,
        message: `Fichero ${tipoArchivo} ${version} detectado, pero sin ningun valor K informado. No se guarda en ree_k_factor; carga el KESTIMQH equivalente si KREALQH viene vacio.`
      }
    ]
  };
}

function buildImportResponse(results: ImportResult[], uploadedFiles: number) {
  return {
    summary: {
      uploadedFiles,
      sourceFiles: results.length,
      importedFiles: results.filter((result) => result.status === "IMPORTED").length,
      failedFiles: results.filter((result) => result.status === "FAILED").length,
      duplicatedFiles: 0,
      recordsImported: results.reduce((sum, result) => sum + result.recordsImported, 0),
      validRecords: results.reduce((sum, result) => sum + result.validRecords, 0),
      invalidRecords: results.reduce((sum, result) => sum + result.invalidRecords, 0),
      duplicatedRecords: results.reduce((sum, result) => sum + result.duplicatedRecords, 0)
    },
    results
  };
}

function countDuplicateKeys(keys: string[]) {
  const counts = new Map<string, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].reduce((sum, count) => sum + Math.max(count - 1, 0), 0);
}

function kFactorIdentityKey(row: { fecha: Date; hora: number; cuartohora: number; version: string; tarifa: string; periodo: string }) {
  return [toIsoDate(row.fecha), row.hora, row.cuartohora, row.version, row.tarifa, row.periodo].join("|");
}

function normalizeDateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function chunk<T>(values: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}
