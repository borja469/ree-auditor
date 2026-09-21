import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import AdmZip from "adm-zip";
import { createHash } from "node:crypto";
import { ImportsService } from "../imports/imports.service";
import { parseMedperFileMetadata } from "../imports/parsers/medper.parser";
import { parseReeFileMetadata } from "../imports/parsers/reganecu.parser";
import { PrismaService } from "../prisma/prisma.service";
import { parseKFactorFileMetadata, parseKFactorRecords, detectDelimiter } from "../ree-losses/parsers/ree-k-factor.parser";
import { ReeLossesService } from "../ree-losses/ree-losses.service";
import { ReeSeieService } from "../ree-seie/ree-seie.service";
import { ReeEsiosPrivateClientService } from "./ree-esios-private-client.service";
import { ReeEsiosPrivateParserService } from "./ree-esios-private-parser.service";
import type { ReeEsiosMessageMetadata } from "./types/ree-esios-private.types";

type DownloadFamily = "liquicomun" | "liqui-empresa";

type LqDownloadResult = {
  source: "REE_ESIOS";
  service: "ServicioLQ";
  family: DownloadFamily;
  requestedPublicationDate: string;
  owner: string | null;
  selectedMessage: ReeEsiosMessageMetadata;
  downloaded: {
    code: string;
    messageId: string;
    messageVersion: number | null;
    zipName: string;
    payloadBytes: number;
    sha256: string;
    totalFiles: number;
  };
  selectedFiles: Array<{
    name: string;
    hash: string;
    size: number;
    status: "IMPORTED" | "SKIPPED" | "FAILED";
    reason?: string;
    validRecords?: number;
  }>;
  importResponse: unknown;
};

@Injectable()
export class ReeEsiosPrivateLqService {
  constructor(
    private readonly client: ReeEsiosPrivateClientService,
    private readonly parser: ReeEsiosPrivateParserService,
    private readonly prisma: PrismaService,
    private readonly importsService: ImportsService,
    private readonly lossesService: ReeLossesService,
    private readonly seieService: ReeSeieService
  ) {}

  async downloadLiquicomun(publicationDate: string): Promise<LqDownloadResult> {
    validateDate(publicationDate, "date");
    const messages = await this.listPublicationMessages(publicationDate);
    const selected = selectBestMessage(messages, "liquicomun");
    if (!selected) {
      throw new NotFoundException(`No se encontro liquicomun publicado el ${publicationDate}.`);
    }

    return this.processLiquicomunMessage(publicationDate, selected);
  }

  private async processLiquicomunMessage(publicationDate: string, selected: ReeEsiosMessageMetadata): Promise<LqDownloadResult> {
    const downloaded = await this.downloadZip(selected);
    const selectedEntries = await this.selectKFactorEntries(downloaded.entries);
    const importableEntries = selectedEntries.filter((entry) => entry.status === "IMPORTED");
    const importResponse = importableEntries.length > 0
      ? await this.lossesService.importKFactorFiles([buildMulterFile(downloaded.reeZipName, buildZip(importableEntries))])
      : {
          summary: {
            uploadedFiles: 0,
            sourceFiles: selectedEntries.length,
            importedFiles: 0,
            failedFiles: 0,
            duplicatedFiles: selectedEntries.filter((entry) => entry.reason === "already_imported").length,
            recordsImported: 0,
            validRecords: 0,
            invalidRecords: 0,
            duplicatedRecords: 0
          },
          results: []
        };

    return buildResult({
      family: "liquicomun",
      requestedPublicationDate: publicationDate,
      owner: null,
      selected,
      downloaded,
      selectedFiles: selectedEntries,
      importResponse
    });
  }

  async downloadLiquiEmpresa(publicationDate: string, owner = "STROM"): Promise<LqDownloadResult> {
    validateDate(publicationDate, "date");
    const normalizedOwner = owner.trim().toUpperCase() || "STROM";
    const messages = await this.listPublicationMessages(publicationDate);
    const selected = selectBestMessage(messages, "liquidacion", normalizedOwner);
    if (!selected) {
      throw new NotFoundException(`No se encontro liquidacion_${normalizedOwner} publicada el ${publicationDate}.`);
    }

    return this.processLiquiEmpresaMessage(publicationDate, normalizedOwner, selected);
  }

  private async processLiquiEmpresaMessage(publicationDate: string, normalizedOwner: string, selected: ReeEsiosMessageMetadata): Promise<LqDownloadResult> {
    const downloaded = await this.downloadZip(selected);
    const reganecuEntries = await this.selectReganecuEntries(downloaded.entries);
    const medperEntries = await this.selectMedperEntries(downloaded.entries);
    const seieEntries = await this.selectSeieEntries(downloaded.entries);

    const importResponse = {
      reganecu: await importSelectedEntries({
        zipName: downloaded.reeZipName,
        entries: reganecuEntries,
        emptyResponse: emptyReeImportResponse(reganecuEntries),
        run: (upload) => this.importsService.importReganecuFiles([upload], { auditUser: "REE_ESIOS" })
      }),
      medper: await importSelectedEntries({
        zipName: downloaded.reeZipName,
        entries: medperEntries,
        emptyResponse: emptyReeImportResponse(medperEntries),
        run: (upload) => this.importsService.importMedperFiles([upload], { auditUser: "REE_ESIOS" })
      }),
      seie: await importSelectedEntries({
        zipName: downloaded.reeZipName,
        entries: seieEntries,
        emptyResponse: emptySeieImportResponse(seieEntries),
        run: (upload) => this.seieService.importFiles([upload], { auditUser: "REE_ESIOS" })
      })
    };

    return buildResult({
      family: "liqui-empresa",
      requestedPublicationDate: publicationDate,
      owner: normalizedOwner,
      selected,
      downloaded,
      selectedFiles: [...reganecuEntries, ...medperEntries, ...seieEntries],
      importResponse
    });
  }

  async syncLiquicomunRange(from: string, to: string) {
    return this.syncRange(from, to, async (date, messages) => {
      const candidates = selectMessages(messages, "liquicomun");
      return Promise.all(candidates.map((message) => this.processLiquicomunMessage(date, message)));
    });
  }

  async syncLiquiEmpresaRange(from: string, to: string, owner = "STROM") {
    const normalizedOwner = owner.trim().toUpperCase() || "STROM";
    return this.syncRange(from, to, async (date, messages) => {
      const candidates = selectMessages(messages, "liquidacion", normalizedOwner);
      return Promise.all(candidates.map((message) => this.processLiquiEmpresaMessage(date, normalizedOwner, message)));
    });
  }

  async listMessages(publicationDate: string) {
    validateDate(publicationDate, "date");
    return {
      source: "REE_ESIOS",
      service: "ServicioLQ",
      publicationDate,
      messages: await this.listPublicationMessages(publicationDate)
    };
  }

  private async syncRange(
    from: string,
    to: string,
    run: (date: string, messages: ReeEsiosMessageMetadata[]) => Promise<LqDownloadResult[]>
  ) {
    validateDate(from, "from");
    validateDate(to, "to");
    const start = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`);
    if (start.getTime() > end.getTime()) {
      throw new BadRequestException("from no puede ser posterior a to.");
    }

    const results = [];
    for (let cursor = start; cursor.getTime() <= end.getTime(); cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)) {
      const date = cursor.toISOString().slice(0, 10);
      try {
        const messages = await this.listPublicationMessages(date);
        const dayResults = await run(date, messages);
        if (dayResults.length === 0) {
          results.push({
            source: "REE_ESIOS",
            service: "ServicioLQ",
            requestedPublicationDate: date,
            status: "SKIPPED",
            errorMessage: "No se encontraron publicaciones candidatas."
          });
        } else {
          results.push(...dayResults);
        }
      } catch (error) {
        results.push({
          source: "REE_ESIOS",
          service: "ServicioLQ",
          requestedPublicationDate: date,
          status: "FAILED",
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return {
      source: "REE_ESIOS",
      service: "ServicioLQ",
      from,
      to,
      count: results.length,
      results
    };
  }

  private async listPublicationMessages(publicationDate: string) {
    const response = await this.client.listMessages({
      startTime: `${publicationDate}T00:00:00Z`,
      endTime: `${publicationDate}T23:59:59Z`,
      intervalType: "Server",
      endpoint: this.client.lqEndpoint()
    });
    return this.parser.parseMessageList(response.body);
  }

  private async downloadZip(message: ReeEsiosMessageMetadata) {
    const response = await this.client.downloadMessage({ code: message.code, endpoint: this.client.lqEndpoint() });
    const payload = this.parser.extractPayloadBuffer(response.body);
    if (!isZip(payload)) {
      throw new BadGatewayException(`El mensaje ${message.messageId} no contiene un ZIP descargable.`);
    }
    const zip = new AdmZip(payload);
    const entries = zip
      .getEntries()
      .filter((entry) => !entry.isDirectory)
      .map((entry) => ({
        name: entry.entryName,
        buffer: entry.getData(),
        size: entry.header.size,
        hash: sha256(entry.getData())
      }));

    return {
      payload,
      entries,
      reeZipName: buildReeZipName(message),
      payloadBytes: payload.byteLength,
      sha256: sha256(payload),
      totalFiles: entries.length
    };
  }

  private async selectKFactorEntries(entries: Array<{ name: string; buffer: Buffer; size: number; hash: string }>) {
    const candidates = entries.filter((entry) => /^(?:A1|C[1-5])_K(?:estimqh|realqh)_\d{8}_\d{8}$/i.test(entry.name));
    const selected = [];
    for (const entry of candidates) {
      const parsed = parseKCandidate(entry);
      if (parsed.validRecords === 0) {
        selected.push({ ...entry, status: "SKIPPED" as const, reason: "empty_k_values", validRecords: 0 });
        continue;
      }
      const existing = await this.prisma.reeKFactorImport.findFirst({
        where: {
          fileHash: entry.hash,
          status: "IMPORTED"
        },
        select: { id: true }
      });
      selected.push({
        ...entry,
        status: existing ? "SKIPPED" as const : "IMPORTED" as const,
        reason: existing ? "already_imported" : undefined,
        validRecords: parsed.validRecords
      });
    }
    return selected;
  }

  private async selectSeieEntries(entries: Array<{ name: string; buffer: Buffer; size: number; hash: string }>) {
    const candidates = entries.filter((entry) => /^C[1-5]_SEIErega_\d{8}_/i.test(entry.name));
    const selected = [];
    for (const entry of candidates) {
      const existing = await this.prisma.reeSeieFile.findUnique({
        where: { fileHash: entry.hash },
        select: { id: true }
      });
      selected.push({
        ...entry,
        status: existing ? "SKIPPED" as const : "IMPORTED" as const,
        reason: existing ? "already_imported" : undefined
      });
    }
    return selected;
  }

  private async selectReganecuEntries(entries: Array<{ name: string; buffer: Buffer; size: number; hash: string }>) {
    const candidates = entries.filter((entry) => /^C[1-5]_?reganecu(?:QH)?_\d{8}_[A-Z0-9]+/i.test(entry.name));
    const selected = [];
    for (const entry of candidates) {
      try {
        const metadata = parseReeFileMetadata(entry.name);
        const existing = await this.prisma.reeFile.findFirst({
          where: {
            tipoArchivo: metadata.tipoArchivo,
            version: metadata.version,
            fechaLiquidacion: metadata.fechaLiquidacion,
            sujetoEic: metadata.sujetoEic,
            status: "IMPORTED"
          },
          select: { id: true }
        });
        selected.push({
          ...entry,
          status: existing ? "SKIPPED" as const : "IMPORTED" as const,
          reason: existing ? "already_imported" : undefined
        });
      } catch (error) {
        selected.push({
          ...entry,
          status: "FAILED" as const,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return selected;
  }

  private async selectMedperEntries(entries: Array<{ name: string; buffer: Buffer; size: number; hash: string }>) {
    const candidates = entries.filter((entry) => /^C[1-5].*(?:medperqh|meperqh)/i.test(entry.name) || /(?:medperqh|meperqh).*C[1-5]/i.test(entry.name));
    const selected = [];
    for (const entry of candidates) {
      try {
        const metadata = parseMedperFileMetadata(entry.name);
        const existing = await this.prisma.medperFile.findFirst({
          where: {
            tipoArchivo: metadata.tipoArchivo,
            version: metadata.version,
            fechaInicio: metadata.fechaInicio,
            fechaFin: metadata.fechaFin,
            sujetoEic: metadata.sujetoEic,
            status: "IMPORTED"
          },
          select: { id: true }
        });
        selected.push({
          ...entry,
          status: existing ? "SKIPPED" as const : "IMPORTED" as const,
          reason: existing ? "already_imported" : undefined
        });
      } catch (error) {
        selected.push({
          ...entry,
          status: "FAILED" as const,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return selected;
  }
}

function buildResult(input: {
  family: DownloadFamily;
  requestedPublicationDate: string;
  owner: string | null;
  selected: ReeEsiosMessageMetadata;
  downloaded: { reeZipName: string; payloadBytes: number; sha256: string; totalFiles: number };
  selectedFiles: Array<{ name: string; hash: string; size: number; status: "IMPORTED" | "SKIPPED" | "FAILED"; reason?: string; validRecords?: number }>;
  importResponse: unknown;
}): LqDownloadResult {
  return {
    source: "REE_ESIOS",
    service: "ServicioLQ",
    family: input.family,
    requestedPublicationDate: input.requestedPublicationDate,
    owner: input.owner,
    selectedMessage: input.selected,
    downloaded: {
      code: input.selected.code,
      messageId: input.selected.messageId,
      messageVersion: input.selected.version,
      zipName: input.downloaded.reeZipName,
      payloadBytes: input.downloaded.payloadBytes,
      sha256: input.downloaded.sha256,
      totalFiles: input.downloaded.totalFiles
    },
    selectedFiles: input.selectedFiles.map((entry) => ({
      name: entry.name,
      hash: entry.hash,
      size: entry.size,
      status: entry.status,
      reason: entry.reason,
      validRecords: entry.validRecords
    })),
    importResponse: input.importResponse
  };
}

function selectBestMessage(messages: ReeEsiosMessageMetadata[], kind: "liquicomun" | "liquidacion", owner = "STROM") {
  return selectMessages(messages, kind, owner).at(0);
}

function selectMessages(messages: ReeEsiosMessageMetadata[], kind: "liquicomun" | "liquidacion", owner = "STROM") {
  const normalizedOwner = owner.toUpperCase();
  const candidates = messages.filter((message) => {
    const id = message.messageId.toLowerCase();
    const type = message.messageType?.toLowerCase() ?? "";
    const matchesFamily = kind === "liquicomun"
      ? id.includes("_liquicomun_") || type.includes("liquicomun")
      : id.includes(`_liquidacion_${normalizedOwner.toLowerCase()}_`);
    if (!matchesFamily) {
      return false;
    }
    const rank = settlementRank(message.messageId);
    return kind === "liquicomun" ? rank >= settlementRank("A1") : rank >= settlementRank("C1");
  });
  return candidates.sort(compareMessages);
}

function compareMessages(left: ReeEsiosMessageMetadata, right: ReeEsiosMessageMetadata) {
  return settlementRank(right.messageId) - settlementRank(left.messageId) ||
    (right.version ?? 0) - (left.version ?? 0) ||
    (right.messageDate ?? "").localeCompare(left.messageDate ?? "");
}

function buildReeZipName(message: ReeEsiosMessageMetadata) {
  const rawName = message.messageId.trim() || message.code;
  const withoutZip = rawName.replace(/\.zip$/i, "");
  const versionSuffix = message.version && !new RegExp(`\\.${message.version}$`, "i").test(withoutZip) ? `.${message.version}` : "";
  return `REE_ESIOS_${withoutZip}${versionSuffix}.zip`;
}

function settlementRank(value: string) {
  const version = /(?:^|_)(A1|C[1-5])(?:_|$)/i.exec(value)?.[1]?.toUpperCase();
  return { A1: 1, C1: 2, C2: 3, C3: 4, C4: 5, C5: 6 }[version as "A1" | "C1" | "C2" | "C3" | "C4" | "C5"] ?? 0;
}

function parseKCandidate(entry: { name: string; buffer: Buffer }) {
  const content = decodeText(entry.buffer);
  const metadata = parseKFactorFileMetadata(entry.name, content);
  const delimiter = detectDelimiter(content);
  let validRecords = 0;
  for (const result of parseKFactorRecords({ sourceFileName: entry.name, content, delimiter, metadata })) {
    if (result.record) {
      validRecords += 1;
    }
  }
  return { validRecords };
}

function buildZip(entries: Array<{ name: string; buffer: Buffer }>) {
  const zip = new AdmZip();
  for (const entry of entries) {
    zip.addFile(entry.name, entry.buffer);
  }
  return zip.toBuffer();
}

async function importSelectedEntries(input: {
  zipName: string;
  entries: Array<{ name: string; buffer: Buffer; status: "IMPORTED" | "SKIPPED" | "FAILED"; reason?: string }>;
  emptyResponse: unknown;
  run: (upload: Express.Multer.File) => Promise<unknown>;
}) {
  const importableEntries = input.entries.filter((entry) => entry.status === "IMPORTED");
  if (importableEntries.length === 0) {
    return input.emptyResponse;
  }

  return input.run(buildMulterFile(input.zipName, buildZip(importableEntries)));
}

function emptyReeImportResponse(entries: Array<{ status: "IMPORTED" | "SKIPPED" | "FAILED"; reason?: string }>) {
  return {
    summary: {
      uploadedFiles: 0,
      sourceFiles: entries.length,
      importedFiles: 0,
      failedFiles: entries.filter((entry) => entry.status === "FAILED").length,
      duplicatedFiles: entries.filter((entry) => entry.reason === "already_imported").length,
      recordsImported: 0,
      validRecords: 0,
      invalidRecords: 0,
      duplicatedRecords: 0
    },
    results: []
  };
}

function emptySeieImportResponse(entries: Array<{ status: "IMPORTED" | "SKIPPED" | "FAILED"; reason?: string }>) {
  return {
    summary: {
      uploadedFiles: 0,
      sourceFiles: entries.length,
      importedFiles: 0,
      failedFiles: entries.filter((entry) => entry.status === "FAILED").length,
      duplicatedFiles: entries.filter((entry) => entry.reason === "already_imported").length,
      recordsImported: 0,
      validRecords: 0,
      invalidRecords: 0,
      duplicatedRecords: 0
    },
    results: [],
    files: []
  };
}

function buildMulterFile(originalname: string, buffer: Buffer): Express.Multer.File {
  return {
    fieldname: "files",
    originalname,
    encoding: "7bit",
    mimetype: "application/zip",
    size: buffer.byteLength,
    buffer
  } as Express.Multer.File;
}

function validateDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${field} debe tener formato YYYY-MM-DD.`);
  }
}

function isZip(buffer: Buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function decodeText(buffer: Buffer) {
  const utf8 = buffer.toString("utf8");
  return utf8.includes("\uFFFD") ? buffer.toString("latin1") : utf8;
}
