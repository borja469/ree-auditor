import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import AdmZip from "adm-zip";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
type SettlementVersion = "A1" | "C1" | "C2" | "C3" | "C4" | "C5";
type ParsedLqMessage = {
  settlement: SettlementVersion;
  family: DownloadFamily;
  owner: string | null;
  month: string;
  fileVersion: number;
};

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
    const parsed = parseLqMessage(selected, "STROM");
    if (parsed) {
      await this.storeDownloadedZip({ publicationDate, message: selected, parsed, owner: "STROM", downloaded });
    }
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
    const parsed = parseLqMessage(selected, normalizedOwner);
    if (parsed) {
      await this.storeDownloadedZip({ publicationDate, message: selected, parsed, owner: normalizedOwner, downloaded });
    }
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

  async monthlyMatrix(from: string, to: string, owner = "STROM") {
    validateDate(from, "from");
    validateDate(to, "to");
    const normalizedOwner = owner.trim().toUpperCase() || "STROM";
    const messages = await this.listRangeMessages(from, to);
    const cells = buildMonthlyMatrix(messages, normalizedOwner);
    return {
      source: "REE_ESIOS",
      service: "ServicioLQ",
      from,
      to,
      owner: normalizedOwner,
      months: [...new Set(cells.map((cell) => cell.month))].sort((left, right) => right.localeCompare(left)),
      settlements: ["A1", "C1", "C2", "C3", "C4", "C5"] satisfies SettlementVersion[],
      cells
    };
  }

  async syncZipCatalogRange(from: string, to: string, owner = "STROM") {
    validateDate(from, "from");
    validateDate(to, "to");
    const normalizedOwner = owner.trim().toUpperCase() || "STROM";
    const messages = await this.listRangeMessages(from, to);
    const candidates = messages
      .map((message) => ({ message, parsed: parseLqMessage(message, normalizedOwner) }))
      .filter((item): item is { message: ReeEsiosMessageMetadata; parsed: ParsedLqMessage } => Boolean(item.parsed));
    const results = [];

    for (const candidate of candidates.sort((left, right) => compareMonthlyCandidates(left, right))) {
      const downloaded = await this.downloadZip(candidate.message);
      results.push(await this.storeDownloadedZip({
        publicationDate: publicationDateOf(candidate.message),
        message: candidate.message,
        parsed: candidate.parsed,
        owner: normalizedOwner,
        downloaded
      }));
    }

    return {
      source: "REE_ESIOS",
      service: "ServicioLQ",
      storage: "LOCAL",
      from,
      to,
      owner: normalizedOwner,
      count: results.length,
      downloaded: results.filter((result) => result.status === "DOWNLOADED").length,
      updated: results.filter((result) => result.status === "UPDATED").length,
      skipped: results.filter((result) => result.status === "SKIPPED").length,
      results
    };
  }

  private async storeDownloadedZip(input: {
    publicationDate: string;
    message: ReeEsiosMessageMetadata;
    parsed: ParsedLqMessage;
    owner: string;
    downloaded: { reeZipName: string; payload: Buffer; payloadBytes: number; sha256: string };
  }) {
    const catalogOwner = catalogOwnerFor(input.parsed, input.owner);
    const existing = await this.prisma.reeEsiosLqZipFile.findUnique({
      where: {
        ree_esios_lq_zip_latest_unique: {
          month: input.parsed.month,
          settlement: input.parsed.settlement,
          family: input.parsed.family,
          owner: catalogOwner
        }
      }
    });

    if (existing && !isNewerCatalogMessage(existing, input.message, input.parsed.fileVersion)) {
      return {
        status: "SKIPPED",
        reason: "already_latest",
        month: input.parsed.month,
        settlement: input.parsed.settlement,
        family: input.parsed.family,
        owner: catalogOwner,
        messageId: input.message.messageId,
        code: input.message.code
      };
    }

    const filePath = await writeCatalogZip({
      month: input.parsed.month,
      settlement: input.parsed.settlement,
      zipName: input.downloaded.reeZipName,
      payload: input.downloaded.payload
    });

    const record = await this.prisma.reeEsiosLqZipFile.upsert({
      where: {
        ree_esios_lq_zip_latest_unique: {
          month: input.parsed.month,
          settlement: input.parsed.settlement,
          family: input.parsed.family,
          owner: catalogOwner
        }
      },
      create: {
        month: input.parsed.month,
        settlement: input.parsed.settlement,
        family: input.parsed.family,
        owner: catalogOwner,
        messageId: input.message.messageId,
        code: input.message.code,
        messageType: input.message.messageType,
        messageOwner: input.message.owner,
        publicationDate: new Date(`${input.publicationDate}T00:00:00.000Z`),
        messageDate: parseOptionalDate(input.message.messageDate),
        fileVersion: input.parsed.fileVersion,
        zipName: input.downloaded.reeZipName,
        filePath,
        sha256: input.downloaded.sha256,
        bytes: input.downloaded.payloadBytes,
        downloadedAt: new Date()
      },
      update: {
        messageId: input.message.messageId,
        code: input.message.code,
        messageType: input.message.messageType,
        messageOwner: input.message.owner,
        publicationDate: new Date(`${input.publicationDate}T00:00:00.000Z`),
        messageDate: parseOptionalDate(input.message.messageDate),
        fileVersion: input.parsed.fileVersion,
        zipName: input.downloaded.reeZipName,
        filePath,
        sha256: input.downloaded.sha256,
        bytes: input.downloaded.payloadBytes,
        downloadedAt: new Date()
      }
    });

    if (existing?.filePath && existing.filePath !== filePath) {
      await rm(existing.filePath, { force: true }).catch(() => undefined);
    }

    return {
      status: existing ? "UPDATED" : "DOWNLOADED",
      month: record.month,
      settlement: record.settlement,
      family: record.family,
      owner: record.owner,
      messageId: record.messageId,
      code: record.code,
      zipName: record.zipName,
      bytes: record.bytes,
      sha256: record.sha256,
      publicationDate: formatDateOnly(record.publicationDate),
      downloadedAt: record.downloadedAt.toISOString()
    };
  }

  async zipCatalogMatrix(monthsBack = 15, owner = "STROM", allHistory = false) {
    const normalizedOwner = owner.trim().toUpperCase() || "STROM";
    const requestedMonths = allHistory ? null : buildRollingMonths(Math.max(0, Math.min(60, Math.trunc(monthsBack))));
    const records = await this.prisma.reeEsiosLqZipFile.findMany({
      where: {
        ...(requestedMonths ? { month: { in: requestedMonths } } : {}),
        OR: [
          { family: "liquicomun", owner: "REE" },
          { family: "liqui-empresa", owner: normalizedOwner }
        ]
      },
      orderBy: [
        { month: "desc" },
        { settlement: "asc" },
        { family: "asc" }
      ]
    });
    const cells = buildMonthlyMatrixFromCatalog(records);
    const months = requestedMonths ?? [...new Set(records.map((record) => record.month))].sort((left, right) => right.localeCompare(left));
    return {
      source: "REE_ESIOS",
      service: "ServicioLQ",
      storage: "LOCAL",
      from: months.at(-1) ?? "",
      to: months[0] ?? "",
      owner: normalizedOwner,
      months,
      settlements: ["A1", "C1", "C2", "C3", "C4", "C5"] satisfies SettlementVersion[],
      cells
    };
  }

  async downloadCatalogMonthlyPairArchive(input: {
    month: string;
    settlement: string;
    owner?: string;
    liquicomun?: boolean;
    liquiEmpresa?: boolean;
  }) {
    validateMonth(input.month);
    const settlement = normalizeSettlement(input.settlement);
    const normalizedOwner = input.owner?.trim().toUpperCase() || "STROM";
    const includeLiquicomun = input.liquicomun !== false;
    const includeLiquiEmpresa = input.liquiEmpresa !== false;
    const records = await this.prisma.reeEsiosLqZipFile.findMany({
      where: {
        month: input.month,
        settlement,
        OR: [
          ...(includeLiquicomun ? [{ family: "liquicomun", owner: "REE" }] : []),
          ...(includeLiquiEmpresa ? [{ family: "liqui-empresa", owner: normalizedOwner }] : [])
        ]
      }
    });
    const archive = new AdmZip();
    const downloaded = [];
    const missing = [];

    for (const record of records) {
      try {
        archive.addFile(record.zipName, await readFile(record.filePath));
        downloaded.push({
          family: record.family,
          messageId: record.messageId,
          code: record.code,
          zipName: record.zipName,
          payloadBytes: record.bytes,
          sha256: record.sha256
        });
      } catch {
        missing.push(record.family);
      }
    }

    if (includeLiquicomun && !records.some((record) => record.family === "liquicomun")) {
      missing.push("liquicomun");
    }
    if (includeLiquiEmpresa && !records.some((record) => record.family === "liqui-empresa")) {
      missing.push(`liquidacion_${normalizedOwner}`);
    }
    if (downloaded.length === 0) {
      throw new NotFoundException(`No se encontraron ZIPs locales ${settlement} ${input.month}. Actualiza los ZIPs locales desde Centro de cargas.`);
    }

    const fileName = `REE_ESIOS_LQ_${settlement}_${input.month.replace("-", "")}_${normalizedOwner}.zip`;
    return {
      fileName,
      contentType: "application/zip",
      buffer: archive.toBuffer(),
      metadata: {
        source: "REE_ESIOS",
        service: "ServicioLQ",
        storage: "LOCAL",
        month: input.month,
        settlement,
        owner: normalizedOwner,
        missing,
        downloaded
      }
    };
  }

  async downloadMonthlyPair(input: {
    from: string;
    to: string;
    month: string;
    settlement: string;
    owner?: string;
    liquicomun?: boolean;
    liquiEmpresa?: boolean;
  }) {
    validateDate(input.from, "from");
    validateDate(input.to, "to");
    validateMonth(input.month);
    const settlement = normalizeSettlement(input.settlement);
    const normalizedOwner = input.owner?.trim().toUpperCase() || "STROM";
    const includeLiquicomun = input.liquicomun !== false;
    const includeLiquiEmpresa = input.liquiEmpresa !== false;
    const messages = await this.listRangeMessages(input.from, input.to);
    const pair = selectMonthlyPair(messages, input.month, settlement, normalizedOwner);
    const results: LqDownloadResult[] = [];
    const missing: string[] = [];

    if (includeLiquicomun) {
      if (pair.liquicomun) {
        results.push(await this.processLiquicomunMessage(pair.liquicomun.publicationDate, pair.liquicomun.message));
      } else {
        missing.push("liquicomun");
      }
    }
    if (includeLiquiEmpresa) {
      if (pair.liquiEmpresa) {
        results.push(await this.processLiquiEmpresaMessage(pair.liquiEmpresa.publicationDate, normalizedOwner, pair.liquiEmpresa.message));
      } else {
        missing.push(`liquidacion_${normalizedOwner}`);
      }
    }

    if (results.length === 0) {
      throw new NotFoundException(`No se encontraron ficheros ${settlement} ${input.month} publicados entre ${input.from} y ${input.to}.`);
    }

    return {
      source: "REE_ESIOS",
      service: "ServicioLQ",
      from: input.from,
      to: input.to,
      month: input.month,
      settlement,
      owner: normalizedOwner,
      missing,
      count: results.length,
      results
    };
  }

  async downloadMonthlyPairArchive(input: {
    from: string;
    to: string;
    month: string;
    settlement: string;
    owner?: string;
    liquicomun?: boolean;
    liquiEmpresa?: boolean;
  }) {
    validateDate(input.from, "from");
    validateDate(input.to, "to");
    validateMonth(input.month);
    const settlement = normalizeSettlement(input.settlement);
    const normalizedOwner = input.owner?.trim().toUpperCase() || "STROM";
    const includeLiquicomun = input.liquicomun !== false;
    const includeLiquiEmpresa = input.liquiEmpresa !== false;
    const messages = await this.listRangeMessages(input.from, input.to);
    const pair = selectMonthlyPair(messages, input.month, settlement, normalizedOwner);
    const archive = new AdmZip();
    const downloaded: Array<{ family: DownloadFamily; messageId: string; code: string; zipName: string; payloadBytes: number; sha256: string }> = [];
    const missing: string[] = [];

    if (includeLiquicomun) {
      if (pair.liquicomun) {
        const file = await this.downloadZip(pair.liquicomun.message);
        archive.addFile(file.reeZipName, file.payload);
        downloaded.push({
          family: "liquicomun",
          messageId: pair.liquicomun.message.messageId,
          code: pair.liquicomun.message.code,
          zipName: file.reeZipName,
          payloadBytes: file.payloadBytes,
          sha256: file.sha256
        });
      } else {
        missing.push("liquicomun");
      }
    }
    if (includeLiquiEmpresa) {
      if (pair.liquiEmpresa) {
        const file = await this.downloadZip(pair.liquiEmpresa.message);
        archive.addFile(file.reeZipName, file.payload);
        downloaded.push({
          family: "liqui-empresa",
          messageId: pair.liquiEmpresa.message.messageId,
          code: pair.liquiEmpresa.message.code,
          zipName: file.reeZipName,
          payloadBytes: file.payloadBytes,
          sha256: file.sha256
        });
      } else {
        missing.push(`liquidacion_${normalizedOwner}`);
      }
    }

    if (downloaded.length === 0) {
      throw new NotFoundException(`No se encontraron ZIPs ${settlement} ${input.month} publicados entre ${input.from} y ${input.to}.`);
    }

    const fileName = `REE_ESIOS_LQ_${settlement}_${input.month.replace("-", "")}_${normalizedOwner}.zip`;
    return {
      fileName,
      contentType: "application/zip",
      buffer: archive.toBuffer(),
      metadata: {
        source: "REE_ESIOS",
        service: "ServicioLQ",
        from: input.from,
        to: input.to,
        month: input.month,
        settlement,
        owner: normalizedOwner,
        missing,
        downloaded
      }
    };
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

  private async listRangeMessages(from: string, to: string) {
    const start = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`);
    if (start.getTime() > end.getTime()) {
      throw new BadRequestException("from no puede ser posterior a to.");
    }
    const days = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (days > 500) {
      throw new BadRequestException("El rango de publicaciones no puede superar 500 dias.");
    }

    const messages: ReeEsiosMessageMetadata[] = [];
    for (let cursor = start; cursor.getTime() <= end.getTime(); cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)) {
      const publicationDate = cursor.toISOString().slice(0, 10);
      messages.push(...(await this.listPublicationMessages(publicationDate)));
    }
    return messages;
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

function buildMonthlyMatrix(messages: ReeEsiosMessageMetadata[], owner: string) {
  const map = new Map<string, ReturnType<typeof emptyMatrixCell>>();
  for (const message of messages) {
    const parsed = parseLqMessage(message, owner);
    if (!parsed) {
      continue;
    }
    const key = `${parsed.month}-${parsed.settlement}`;
    const cell = map.get(key) ?? emptyMatrixCell(parsed.month, parsed.settlement);
    const summary = {
      code: message.code,
      messageId: message.messageId,
      messageType: message.messageType,
      owner: message.owner,
      publicationDate: message.messageDate?.slice(0, 10) ?? null,
      messageDate: message.messageDate,
      fileVersion: parsed.fileVersion
    };
    if (parsed.family === "liquicomun") {
      cell.liquicomun = pickLatestSummary(cell.liquicomun, summary);
    } else {
      cell.liquiEmpresa = pickLatestSummary(cell.liquiEmpresa, summary);
    }
    map.set(key, cell);
  }
  return [...map.values()].sort((left, right) => right.month.localeCompare(left.month) || settlementRank(left.settlement) - settlementRank(right.settlement));
}

function emptyMatrixCell(month: string, settlement: SettlementVersion) {
  return {
    month,
    settlement,
    liquicomun: null as LqMessageSummary | null,
    liquiEmpresa: null as LqMessageSummary | null
  };
}

type LqMessageSummary = {
  code: string;
  messageId: string;
  messageType: string | null;
  owner: string | null;
  publicationDate: string | null;
  messageDate: string | null;
  fileVersion: number;
};

function pickLatestSummary(current: LqMessageSummary | null, next: LqMessageSummary) {
  if (!current) {
    return next;
  }
  const comparison = next.fileVersion - current.fileVersion || (next.messageDate ?? "").localeCompare(current.messageDate ?? "");
  return comparison > 0 ? next : current;
}

function selectMonthlyPair(messages: ReeEsiosMessageMetadata[], month: string, settlement: SettlementVersion, owner: string) {
  const matches = messages
    .map((message) => ({ message, parsed: parseLqMessage(message, owner) }))
    .filter((item): item is { message: ReeEsiosMessageMetadata; parsed: NonNullable<ReturnType<typeof parseLqMessage>> } => {
      if (!item.parsed) {
        return false;
      }
      return item.parsed.month === month && item.parsed.settlement === settlement;
    });
  const liquicomun = matches
    .filter((item) => item.parsed.family === "liquicomun")
    .sort(compareMonthlyCandidates)
    .at(0);
  const liquiEmpresa = matches
    .filter((item) => item.parsed.family === "liqui-empresa")
    .sort(compareMonthlyCandidates)
    .at(0);
  return {
    liquicomun: liquicomun ? { publicationDate: publicationDateOf(liquicomun.message), message: liquicomun.message } : null,
    liquiEmpresa: liquiEmpresa ? { publicationDate: publicationDateOf(liquiEmpresa.message), message: liquiEmpresa.message } : null
  };
}

function compareMonthlyCandidates(
  left: { message: ReeEsiosMessageMetadata; parsed: { fileVersion: number } },
  right: { message: ReeEsiosMessageMetadata; parsed: { fileVersion: number } }
) {
  return right.parsed.fileVersion - left.parsed.fileVersion || (right.message.messageDate ?? "").localeCompare(left.message.messageDate ?? "");
}

function parseLqMessage(message: ReeEsiosMessageMetadata, owner: string): ParsedLqMessage | null {
  const id = message.messageId.trim();
  const pattern = /^(A1|C[1-5])_(liquicomun|liquidacion(?:_([A-Z0-9]+))?)_(\d{6})(?:\.(\d+))?\.zip$/i;
  const match = pattern.exec(id);
  if (!match) {
    return null;
  }
  const settlement = match[1].toUpperCase() as SettlementVersion;
  const rawFamily = match[2].toLowerCase();
  const messageOwner = match[3]?.toUpperCase() ?? null;
  const family: DownloadFamily = rawFamily.startsWith("liquicomun") ? "liquicomun" : "liqui-empresa";
  if (family === "liqui-empresa" && settlement === "A1") {
    return null;
  }
  if (family === "liqui-empresa" && messageOwner !== owner.toUpperCase()) {
    return null;
  }
  return {
    settlement,
    family,
    owner: messageOwner,
    month: `${match[4].slice(0, 4)}-${match[4].slice(4, 6)}`,
    fileVersion: Number(match[5] ?? 0)
  };
}

function buildMonthlyMatrixFromCatalog(records: Array<{
  month: string;
  settlement: string;
  family: string;
  code: string;
  messageId: string;
  messageType: string | null;
  messageOwner: string | null;
  publicationDate: Date;
  messageDate: Date | null;
  fileVersion: number;
}>) {
  const map = new Map<string, ReturnType<typeof emptyMatrixCell>>();
  for (const record of records) {
    const settlement = normalizeSettlement(record.settlement);
    const key = `${record.month}-${settlement}`;
    const cell = map.get(key) ?? emptyMatrixCell(record.month, settlement);
    const summary = {
      code: record.code,
      messageId: record.messageId,
      messageType: record.messageType,
      owner: record.messageOwner,
      publicationDate: formatDateOnly(record.publicationDate),
      messageDate: record.messageDate?.toISOString() ?? null,
      fileVersion: record.fileVersion
    };
    if (record.family === "liquicomun") {
      cell.liquicomun = pickLatestSummary(cell.liquicomun, summary);
    } else if (record.family === "liqui-empresa") {
      cell.liquiEmpresa = pickLatestSummary(cell.liquiEmpresa, summary);
    }
    map.set(key, cell);
  }
  return [...map.values()].sort((left, right) => right.month.localeCompare(left.month) || settlementRank(left.settlement) - settlementRank(right.settlement));
}

function catalogOwnerFor(parsed: ParsedLqMessage, owner: string) {
  return parsed.family === "liquicomun" ? "REE" : owner.toUpperCase();
}

function isNewerCatalogMessage(
  current: { fileVersion: number; messageDate: Date | null; messageId: string },
  message: ReeEsiosMessageMetadata,
  fileVersion: number
) {
  if (fileVersion !== current.fileVersion) {
    return fileVersion > current.fileVersion;
  }
  const nextTime = parseOptionalDate(message.messageDate)?.getTime() ?? 0;
  const currentTime = current.messageDate?.getTime() ?? 0;
  if (nextTime !== currentTime) {
    return nextTime > currentTime;
  }
  return message.messageId !== current.messageId;
}

async function writeCatalogZip(input: { month: string; settlement: SettlementVersion; zipName: string; payload: Buffer }) {
  const dir = join(lqZipRoot(), input.month, input.settlement);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, safeFileName(input.zipName));
  await writeFile(filePath, input.payload);
  return filePath;
}

function lqZipRoot() {
  return join(process.env.DATA_DIR ?? join(process.cwd(), "data"), "ree-esios-lq-zips");
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "_");
}

function parseOptionalDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function buildRollingMonths(monthsBack: number) {
  const now = new Date();
  const months: string[] = [];
  for (let offset = 0; offset <= monthsBack; offset += 1) {
    const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() - offset, 1));
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

function publicationDateOf(message: ReeEsiosMessageMetadata) {
  const date = message.messageDate?.slice(0, 10);
  if (!date) {
    throw new BadGatewayException(`El mensaje ${message.messageId} no informa fecha de publicacion.`);
  }
  return date;
}

function normalizeSettlement(value: string): SettlementVersion {
  const normalized = value.trim().toUpperCase();
  if (!/^(?:A1|C[1-5])$/.test(normalized)) {
    throw new BadRequestException("settlement debe ser A1 o C1-C5.");
  }
  return normalized as SettlementVersion;
}

function validateMonth(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) {
    throw new BadRequestException("month debe tener formato YYYY-MM.");
  }
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
