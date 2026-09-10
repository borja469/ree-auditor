import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { MibgasPrivateDownloadStatus, MibgasPrivateEnvironment, MibgasPrivateQueryKind, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { MibgasPrivateClientService } from "./mibgas-private-client.service";
import { parseMibgasAnnotations, parseMibgasNetPositions, parseMibgasTransactions } from "./mibgas-private.parser";
import type {
  MibgasDirectoryEntry,
  MibgasParsedAnnotation,
  MibgasParsedNetPosition,
  MibgasParsedTransaction,
  MibgasPrivateDownloadDetail,
  MibgasPrivateDownloadRow,
  MibgasQueryConfigurationResult
} from "./mibgas-private.types";

const MAX_DOWNLOAD_ROWS = 500;
const DEFAULT_EXECUTED_BY = "MANUAL";
const AUTOMATION_EXECUTED_BY = "AUTOMATION";
const MIBGAS_AUTOMATION_QUERY_CODES = ["3140", "3144"] as const;

export type MibgasPrivateAutomationConfigDto = {
  active: boolean;
  daysBack: number;
  daysForward: number;
  sessions: [string, string, string];
  lastRunKey: string | null;
  lastRunAt: string | null;
  lastRunAtUtc: string | null;
};

export type MibgasPrivateAutomationConfigInput = {
  active?: boolean;
  daysBack?: number;
  daysForward?: number;
  sessions?: string[];
};

export type MibgasPrivateAutomationRunItem = {
  fecha: string;
  queryCode: "3140" | "3144";
  queryKind: "TRANSACCIONES" | "POSICIONES_PERIODO";
  consulta: string;
  estado: "PROCESADO" | "SIN_DATOS" | "ERROR";
  registros: number;
  mensaje: string;
  downloadId: string | null;
};

export type MibgasPrivateAutomationRunResponse = {
  session: string;
  startedAt: string;
  finishedAt: string;
  force: true;
  daysBack: number;
  daysForward: number;
  dates: string[];
  totalConsultas: number;
  totalConsultasEjecutadas: number;
  procesadas: number;
  sinDatos: number;
  errores: number;
  omitidas: number;
  tiempoTotalMs: number;
  resultados: MibgasPrivateAutomationRunItem[];
};

export type MibgasPrivateLiquidationCheckRow = {
  gasDay: string;
  bidVolume: string;
  askVolume: string;
  totalVolume: string;
  weightedPrice: string | null;
  totalAmount: string | null;
  transactionCount: number;
};

export type MibgasPrivateLiquidationCheckResponse = {
  month: string;
  generatedAt: string;
  rows: MibgasPrivateLiquidationCheckRow[];
  totals: {
    bidVolume: string;
    askVolume: string;
    totalVolume: string;
    weightedPrice: string | null;
    totalAmount: string | null;
    transactionCount: number;
  };
};

@Injectable()
export class MibgasPrivateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: MibgasPrivateClientService
  ) {}

  async status() {
    const config = this.client.readConfig();
    const [stored, latestDownload, latestSuccess, directoryCount, configCount, transactionCount, annotationCount, netPositionCount] = await Promise.all([
      this.prisma.mibgasPrivateConnectionConfig.findUnique({ where: { id: 1 } }),
      this.prisma.mibgasPrivateDownload.findFirst({ orderBy: { createdAt: "desc" } }),
      this.prisma.mibgasPrivateDownload.findFirst({ where: { status: MibgasPrivateDownloadStatus.PROCESADO }, orderBy: { updatedAt: "desc" } }),
      this.prisma.mibgasQueryDirectoryEntry.count({ where: { environment: config.environment } }),
      this.prisma.mibgasQueryConfiguration.count({ where: { environment: config.environment } }),
      this.prisma.mibgasTransaction.count({ where: { environment: config.environment } }),
      this.prisma.mibgasAnnotation.count({ where: { environment: config.environment } }),
      this.prisma.mibgasNetPosition.count({ where: { environment: config.environment } })
    ]);

    return {
      connection: {
        ...this.client.getConnectionSummary(),
        status: stored?.status ?? "SIN_COMPROBAR",
        lastSuccessfulConnection: stored?.lastSuccessfulConnection?.toISOString() ?? null,
        agentCode: stored?.agentCode ?? null,
        agentDescription: stored?.agentDescription ?? null,
        certificateCode: stored?.certificateCode ?? null,
        certificateSubject: stored?.certificateSubject ?? null,
        lastError: stored?.lastError ?? null
      },
      latestDownload: latestDownload ? serializeDownload(latestDownload) : null,
      latestSuccess: latestSuccess ? serializeDownload(latestSuccess) : null,
      counts: {
        directory: directoryCount,
        configurations: configCount,
        transactions: transactionCount,
        annotations: annotationCount,
        netPositions: netPositionCount
      }
    };
  }

  async testConnection() {
    const config = this.client.readConfig();
    const startedAt = Date.now();
    try {
      const [response, certificateInfo] = await Promise.all([this.client.consultaDatosUsuario(), Promise.resolve(this.client.getCertificateInfo())]);
      await this.prisma.mibgasPrivateConnectionConfig.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          environment: config.environment,
          endpoint: config.endpoint,
          timeoutMs: config.timeoutMs,
          status: "OK",
          lastSuccessfulConnection: new Date(),
          agentCode: response.userData.agentCode,
          agentDescription: response.userData.agentDescription,
          certificateCode: response.userData.certificateCode,
          certificateSubject: certificateInfo.selectedCertificate.subject,
          lastError: null
        },
        update: {
          environment: config.environment,
          endpoint: config.endpoint,
          timeoutMs: config.timeoutMs,
          status: "OK",
          lastSuccessfulConnection: new Date(),
          agentCode: response.userData.agentCode,
          agentDescription: response.userData.agentDescription,
          certificateCode: response.userData.certificateCode,
          certificateSubject: certificateInfo.selectedCertificate.subject,
          lastError: null
        }
      });

      return {
        ok: true,
        message: "Conectado correctamente",
        environment: config.environment,
        endpoint: config.endpoint,
        durationMs: Date.now() - startedAt,
        user: response.userData,
        certificate: certificateInfo.selectedCertificate,
        checkedAt: new Date().toISOString()
      };
    } catch (error) {
      const message = errorMessage(error);
      await this.prisma.mibgasPrivateConnectionConfig.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          environment: config.environment,
          endpoint: config.endpoint,
          timeoutMs: config.timeoutMs,
          status: "ERROR",
          lastError: message
        },
        update: {
          environment: config.environment,
          endpoint: config.endpoint,
          timeoutMs: config.timeoutMs,
          status: "ERROR",
          lastError: message
        }
      });
      throw new BadGatewayException(message || "Error probando conexion privada MIBGAS.");
    }
  }

  async refreshDirectory() {
    const config = this.client.readConfig();
    const download = await this.startDownload(MibgasPrivateQueryKind.DIRECTORIO, null, null, {});
    const startedAt = Date.now();
    try {
      const result = await this.client.consultaDirectorioConsultas();
      await this.prisma.$transaction(async (tx) => {
        for (const entry of result.entries) {
          await tx.mibgasQueryDirectoryEntry.upsert({
            where: { environment_queryCode: { environment: config.environment, queryCode: entry.queryCode } },
            create: directoryCreate(config.environment, entry),
            update: directoryUpdate(entry)
          });
        }
      });
      await this.finishDownload(download.id, {
        status: result.entries.length > 0 ? MibgasPrivateDownloadStatus.PROCESADO : MibgasPrivateDownloadStatus.SIN_DATOS,
        records: result.entries.length,
        durationMs: Date.now() - startedAt,
        rawXml: result.xml,
        rawPayloadJson: result.json,
        contentHash: hashText(result.xml)
      });

      return {
        download: serializeDownload(await this.requireDownload(download.id)),
        entries: result.entries,
        total: result.entries.length
      };
    } catch (error) {
      await this.failDownload(download.id, error, Date.now() - startedAt);
      throw new BadGatewayException(errorMessage(error) || "Error consultando directorio MIBGAS.");
    }
  }

  async getDirectory() {
    const environment = this.client.readConfig().environment;
    const rows = await this.prisma.mibgasQueryDirectoryEntry.findMany({
      where: { environment },
      orderBy: [{ section: "asc" }, { queryCode: "asc" }]
    });
    return rows.map((row) => ({
      queryCode: row.queryCode,
      title: row.title,
      section: row.section,
      queryType: row.queryType,
      fetchedAt: row.fetchedAt.toISOString()
    }));
  }

  async refreshQueryConfiguration(queryCode: string) {
    const config = this.client.readConfig();
    const normalizedCode = normalizeQueryCode(queryCode);
    const download = await this.startDownload(MibgasPrivateQueryKind.CONFIGURACION, normalizedCode, null, { CodConsulta: normalizedCode });
    const startedAt = Date.now();
    try {
      const result = await this.client.consultaConfiguracionConsulta(normalizedCode);
      await this.prisma.mibgasQueryConfiguration.upsert({
        where: { environment_queryCode: { environment: config.environment, queryCode: normalizedCode } },
        create: configurationCreate(config.environment, normalizedCode, result.configuration, result.xml),
        update: configurationUpdate(result.configuration, result.xml)
      });
      await this.finishDownload(download.id, {
        status: MibgasPrivateDownloadStatus.PROCESADO,
        records: result.configuration.parameters.length + result.configuration.columns.length,
        durationMs: Date.now() - startedAt,
        rawXml: result.xml,
        rawPayloadJson: result.json,
        contentHash: hashText(result.xml)
      });
      return {
        download: serializeDownload(await this.requireDownload(download.id)),
        configuration: result.configuration
      };
    } catch (error) {
      await this.failDownload(download.id, error, Date.now() - startedAt);
      throw new BadGatewayException(errorMessage(error) || "Error consultando configuracion MIBGAS.");
    }
  }

  async getQueryConfiguration(queryCode: string) {
    const environment = this.client.readConfig().environment;
    const normalizedCode = normalizeQueryCode(queryCode);
    const row = await this.prisma.mibgasQueryConfiguration.findUnique({
      where: { environment_queryCode: { environment, queryCode: normalizedCode } }
    });
    if (!row) {
      return this.refreshQueryConfiguration(normalizedCode);
    }
    return {
      queryCode: row.queryCode,
      title: row.title,
      section: row.section,
      queryType: row.queryType,
      parameters: row.parametersJson,
      columns: row.columnsJson,
      fetchedAt: row.fetchedAt.toISOString()
    };
  }

  async downloadTransactions(sessionDate: string, options: { force?: boolean; queryCode?: string; executedBy?: string } = {}) {
    const query = await this.resolveMarketQuery("TRANSACCIONES", options.queryCode);
    return this.downloadMarketResult(MibgasPrivateQueryKind.TRANSACCIONES, query, sessionDate, options);
  }

  async downloadAnnotations(sessionDate: string, options: { force?: boolean; queryCode?: string; executedBy?: string } = {}) {
    const query = await this.resolveMarketQuery("ANOTACIONES", options.queryCode);
    return this.downloadMarketResult(MibgasPrivateQueryKind.ANOTACIONES, query, sessionDate, options);
  }

  async downloadNetPositions(sessionDate: string, options: { force?: boolean; queryCode?: string; executedBy?: string } = {}) {
    const query = await this.resolveMarketQuery("POSICIONES_PERIODO", options.queryCode ?? "3144");
    return this.downloadMarketResult(MibgasPrivateQueryKind.POSICIONES_PERIODO, query, sessionDate, options);
  }

  async getAutomationConfig(): Promise<MibgasPrivateAutomationConfigDto> {
    const config = await this.getOrCreateAutomationConfig();
    return serializeAutomationConfig(config);
  }

  async saveAutomationConfig(input: MibgasPrivateAutomationConfigInput): Promise<MibgasPrivateAutomationConfigDto> {
    const sessions = normalizeAutomationSessions(input.sessions);
    const data: {
      active?: boolean;
      daysBack?: number;
      daysForward?: number;
      session1?: string;
      session2?: string;
      session3?: string;
    } = {};

    if (typeof input.active === "boolean") {
      data.active = input.active;
    }
    if (input.daysBack !== undefined) {
      data.daysBack = normalizeAutomationDayWindow(input.daysBack, "daysBack");
    }
    if (input.daysForward !== undefined) {
      data.daysForward = normalizeAutomationDayWindow(input.daysForward, "daysForward");
    }
    if (sessions) {
      data.session1 = sessions[0];
      data.session2 = sessions[1];
      data.session3 = sessions[2];
    }

    const config = await this.prisma.mibgasPrivateAutomationConfig.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        active: data.active ?? false,
        daysBack: data.daysBack ?? 1,
        daysForward: data.daysForward ?? 3,
        session1: data.session1 ?? "06:00",
        session2: data.session2 ?? "12:00",
        session3: data.session3 ?? "18:00"
      },
      update: data
    });
    return serializeAutomationConfig(config);
  }

  async executeAutomation(session: string, daysBack?: number, daysForward?: number): Promise<MibgasPrivateAutomationRunResponse> {
    const normalizedSession = normalizeAutomationTime(session);
    const config = await this.getOrCreateAutomationConfig();
    const resolvedDaysBack = normalizeAutomationDayWindow(daysBack ?? config.daysBack, "daysBack");
    const resolvedDaysForward = normalizeAutomationDayWindow(daysForward ?? config.daysForward, "daysForward");
    const startedAt = new Date();
    const dates = buildGasAutomationDates(resolvedDaysBack, resolvedDaysForward, startedAt);
    const resultados: MibgasPrivateAutomationRunItem[] = [];

    for (const fecha of dates) {
      resultados.push(await this.executeAutomationQuery(fecha, "3140"));
      resultados.push(await this.executeAutomationQuery(fecha, "3144"));
    }

    const finishedAt = new Date();
    return {
      session: normalizedSession,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      force: true,
      daysBack: resolvedDaysBack,
      daysForward: resolvedDaysForward,
      dates,
      totalConsultas: dates.length * MIBGAS_AUTOMATION_QUERY_CODES.length,
      totalConsultasEjecutadas: resultados.length,
      procesadas: resultados.filter((item) => item.estado === "PROCESADO").length,
      sinDatos: resultados.filter((item) => item.estado === "SIN_DATOS").length,
      errores: resultados.filter((item) => item.estado === "ERROR").length,
      omitidas: 0,
      tiempoTotalMs: finishedAt.getTime() - startedAt.getTime(),
      resultados
    };
  }

  async markAutomationRun(runKey: string) {
    await this.prisma.mibgasPrivateAutomationConfig.update({
      where: { id: 1 },
      data: {
        lastRunKey: runKey,
        lastRunAt: new Date()
      }
    });
  }

  async listDownloads(filters: { queryKind?: MibgasPrivateQueryKind; status?: MibgasPrivateDownloadStatus; sessionDateFrom?: string; sessionDateTo?: string } = {}) {
    const environment = this.client.readConfig().environment;
    const rows = await this.prisma.mibgasPrivateDownload.findMany({
      where: {
        environment,
        queryKind: filters.queryKind,
        status: filters.status,
        sessionDate: buildDateRange(filters.sessionDateFrom, filters.sessionDateTo)
      },
      orderBy: [{ createdAt: "desc" }],
      take: MAX_DOWNLOAD_ROWS
    });
    return rows.map(serializeDownload);
  }

  async getDownloadDetail(id: string): Promise<MibgasPrivateDownloadDetail> {
    const row = await this.prisma.mibgasPrivateDownload.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException("Descarga privada MIBGAS no encontrada.");
    }
    return {
      ...serializeDownload(row),
      rawXml: row.rawXml,
      rawJson: row.rawPayloadJson
    };
  }

  async listTransactions(filters: { tradingDayFrom?: string; tradingDayTo?: string; buySellIndicator?: string; take?: number } = {}) {
    const take = boundedTake(filters.take);
    const rows = await this.prisma.mibgasTransaction.findMany({
      where: {
        environment: this.client.readConfig().environment,
        tradingDay: buildDateRange(filters.tradingDayFrom, filters.tradingDayTo),
        ...buildTransactionSideWhere(filters.buySellIndicator)
      },
      orderBy: [{ tradingDay: "desc" }, { transactionDatetime: "desc" }],
      take
    });
    return rows.map((row) => ({
      ...row,
      tradingDay: formatDate(row.tradingDay),
      messageDatetime: row.messageDatetime?.toISOString() ?? null,
      transactionDatetime: row.transactionDatetime?.toISOString() ?? null,
      price: decimalToString(row.price),
      quantity: decimalToString(row.quantity),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    }));
  }

  async listAnnotations(filters: { tradingDayFrom?: string; tradingDayTo?: string; take?: number } = {}) {
    const take = boundedTake(filters.take);
    const rows = await this.prisma.mibgasAnnotation.findMany({
      where: { environment: this.client.readConfig().environment, tradingDay: buildDateRange(filters.tradingDayFrom, filters.tradingDayTo) },
      orderBy: [{ tradingDay: "desc" }, { firstGasDay: "desc" }],
      take
    });
    return rows.map((row) => ({
      ...row,
      tradingDay: formatDate(row.tradingDay),
      messageDatetime: row.messageDatetime?.toISOString() ?? null,
      firstGasDay: row.firstGasDay ? formatDate(row.firstGasDay) : null,
      lastGasDay: row.lastGasDay ? formatDate(row.lastGasDay) : null,
      price: decimalToString(row.price),
      quantity: decimalToString(row.quantity),
      delivery: decimalToString(row.delivery),
      amount: decimalToString(row.amount),
      taxAmount: decimalToString(row.taxAmount),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    }));
  }

  async listNetPositions(filters: { tradingDayFrom?: string; tradingDayTo?: string; installation?: string; portfolioId?: string; productId?: string; includeTotals?: boolean; take?: number } = {}) {
    const take = boundedTake(filters.take);
    const rows = await this.prisma.mibgasNetPosition.findMany({
      where: {
        environment: this.client.readConfig().environment,
        tradingDay: buildDateRange(filters.tradingDayFrom, filters.tradingDayTo),
        installation: filters.installation || undefined,
        portfolioId: filters.portfolioId ? { contains: filters.portfolioId, mode: "insensitive" } : undefined,
        productId: filters.productId ? { contains: filters.productId, mode: "insensitive" } : undefined,
        isTotal: filters.includeTotals ? undefined : false
      },
      orderBy: [{ tradingDay: "desc" }, { installation: "asc" }, { portfolioId: "asc" }, { productId: "asc" }],
      take
    });
    return rows.map((row) => ({
      ...row,
      tradingDay: formatDate(row.tradingDay),
      saleQuantity: decimalToString(row.saleQuantity),
      purchaseQuantity: decimalToString(row.purchaseQuantity),
      netQuantity: decimalToString(row.netQuantity),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    }));
  }

  async getLiquidationCheck(year: number, month: number): Promise<MibgasPrivateLiquidationCheckResponse> {
    const environment = this.client.readConfig().environment;
    const monthKey = `${year}-${String(month).padStart(2, "0")}`;
    const from = parseDate(`${monthKey}-01`);
    const to = new Date(from);
    to.setUTCMonth(to.getUTCMonth() + 1);
    const rows = await this.prisma.$queryRaw<
      Array<{
        gas_day: Date;
        bid_volume: Prisma.Decimal | null;
        ask_volume: Prisma.Decimal | null;
        total_volume: Prisma.Decimal | null;
        weighted_price: Prisma.Decimal | null;
        total_amount: Prisma.Decimal | null;
        transaction_count: bigint;
      }>
    >`
      WITH normalized AS (
        SELECT
          trading_day,
          COALESCE(quantity, 0)::numeric AS quantity,
          ABS(COALESCE(quantity, 0)::numeric) AS absolute_quantity,
          price::numeric AS price,
          CASE
            WHEN UPPER(COALESCE(buy_sell_indicator, '')) IN ('B', 'BUY', 'BID', 'C', 'COMPRA') THEN 'BID'
            WHEN UPPER(COALESCE(buy_sell_indicator, '')) IN ('S', 'SELL', 'ASK', 'V', 'VENTA') THEN 'ASK'
            ELSE 'OTHER'
          END AS side
        FROM mibgas_transactions
        WHERE environment = ${environment}::"MibgasPrivateEnvironment"
          AND trading_day >= ${from}
          AND trading_day < ${to}
      ),
      daily AS (
        SELECT
          trading_day AS gas_day,
          SUM(CASE WHEN side = 'BID' THEN absolute_quantity ELSE 0 END) AS bid_volume,
          SUM(CASE WHEN side = 'ASK' THEN absolute_quantity ELSE 0 END) AS ask_volume,
          SUM(CASE WHEN side = 'BID' THEN absolute_quantity WHEN side = 'ASK' THEN -absolute_quantity ELSE quantity END) AS total_volume,
          CASE
            WHEN SUM(CASE WHEN price IS NOT NULL THEN absolute_quantity ELSE 0 END) = 0 THEN NULL
            ELSE SUM(CASE WHEN price IS NOT NULL THEN absolute_quantity * price ELSE 0 END) / SUM(CASE WHEN price IS NOT NULL THEN absolute_quantity ELSE 0 END)
          END AS weighted_price,
          COUNT(*) AS transaction_count
        FROM normalized
        GROUP BY trading_day
      )
      SELECT
        gas_day,
        bid_volume,
        ask_volume,
        total_volume,
        weighted_price,
        CASE WHEN weighted_price IS NULL THEN NULL ELSE total_volume * weighted_price END AS total_amount,
        transaction_count
      FROM daily
      ORDER BY gas_day ASC
    `;
    const serializedRows = rows.map((row) => ({
      gasDay: formatDate(row.gas_day),
      bidVolume: decimalToString(row.bid_volume) ?? "0",
      askVolume: decimalToString(row.ask_volume) ?? "0",
      totalVolume: decimalToString(row.total_volume) ?? "0",
      weightedPrice: decimalToString(row.weighted_price),
      totalAmount: decimalToString(row.total_amount),
      transactionCount: Number(row.transaction_count)
    }));
    return {
      month: monthKey,
      generatedAt: new Date().toISOString(),
      rows: serializedRows,
      totals: buildLiquidationCheckTotals(serializedRows)
    };
  }

  private async downloadMarketResult(
    queryKind: Extract<MibgasPrivateQueryKind, "TRANSACCIONES" | "ANOTACIONES" | "POSICIONES_PERIODO">,
    query: ResolvedMarketQuery,
    sessionDate: string,
    options: { force?: boolean; executedBy?: string } = {}
  ) {
    const fecha = parseDateOnlyString(sessionDate);
    const environment = this.client.readConfig().environment;
    const parameters = buildExecutionParameters(query.parameters, fecha);
    if (!options.force) {
      const existing = await this.prisma.mibgasPrivateDownload.findFirst({
        where: { environment, queryKind, queryCode: query.queryCode, sessionDate: parseDate(fecha), status: MibgasPrivateDownloadStatus.PROCESADO },
        orderBy: { updatedAt: "desc" }
      });
      if (existing) {
        return { message: "Ya existe descarga procesada", download: serializeDownload(existing), records: existing.records };
      }
    }

    const download = await this.startDownload(queryKind, query.queryCode, fecha, parameters, query.title, options.executedBy);
    const startedAt = Date.now();
    let response: Awaited<ReturnType<MibgasPrivateClientService["ejecutarConsultaResultados"]>> | undefined;
    try {
      response =
        query.queryType === "ENCOL"
          ? await this.client.ejecutarConsultaEncolumnada(query.queryCode, parameters, query.parameters)
          : await this.client.ejecutarConsultaResultados(query.queryCode, parameters, query.parameters);
      const contentHash = hashText(response.xml);
      const result =
        queryKind === MibgasPrivateQueryKind.TRANSACCIONES
          ? await this.persistTransactions(download.id, response.xml, contentHash)
          : queryKind === MibgasPrivateQueryKind.POSICIONES_PERIODO
            ? await this.persistNetPositions(download.id, response.xml, contentHash)
            : await this.persistAnnotations(download.id, response.xml, contentHash);
      const status = result.records > 0 ? MibgasPrivateDownloadStatus.PROCESADO : MibgasPrivateDownloadStatus.SIN_DATOS;
      const finished = await this.finishDownload(download.id, {
        status,
        records: result.records,
        durationMs: Date.now() - startedAt,
        rawXml: response.xml,
        rawPayloadJson: response.json,
        contentHash,
        publishedAt: result.publishedAt
      });
      return { message: `${queryKind} MIBGAS procesadas`, download: serializeDownload(finished), records: result.records };
    } catch (error) {
      await this.failDownload(download.id, error, Date.now() - startedAt, response);
      throw new BadGatewayException(errorMessage(error) || `Error descargando ${queryKind} MIBGAS.`);
    }
  }

  private async persistTransactions(downloadId: string, xml: string, contentHash: string) {
    const environment = this.client.readConfig().environment;
    const parsed = parseMibgasTransactions(xml);
    await this.prisma.$transaction(async (tx) => {
      for (const row of parsed.rows) {
        await tx.mibgasTransaction.upsert({
          where: { environment_transactionId: { environment, transactionId: row.transactionId } },
          create: toTransactionCreate(environment, downloadId, row, contentHash),
          update: toTransactionUpdate(downloadId, row, contentHash)
        });
      }
    });
    return {
      records: parsed.rows.length,
      publishedAt: parsed.header.messageDatetime ? parseOptionalDateTime(parsed.header.messageDatetime) : null
    };
  }

  private async persistAnnotations(downloadId: string, xml: string, contentHash: string) {
    const environment = this.client.readConfig().environment;
    const parsed = parseMibgasAnnotations(xml);
    await this.prisma.$transaction(async (tx) => {
      for (const row of parsed.rows) {
        await tx.mibgasAnnotation.upsert({
          where: { environment_annotationId: { environment, annotationId: row.annotationId } },
          create: toAnnotationCreate(environment, downloadId, row, contentHash),
          update: toAnnotationUpdate(downloadId, row, contentHash)
        });
      }
    });
    return {
      records: parsed.rows.length,
      publishedAt: parsed.header.messageDatetime ? parseOptionalDateTime(parsed.header.messageDatetime) : null
    };
  }

  private async persistNetPositions(downloadId: string, xml: string, contentHash: string) {
    const environment = this.client.readConfig().environment;
    const parsed = parseMibgasNetPositions(xml);
    await this.prisma.$transaction(async (tx) => {
      for (const row of parsed.rows) {
        await tx.mibgasNetPosition.upsert({
          where: { environment_rowKey: { environment, rowKey: row.rowKey } },
          create: toNetPositionCreate(environment, downloadId, row, contentHash),
          update: toNetPositionUpdate(downloadId, row, contentHash)
        });
      }
    });
    return {
      records: parsed.rows.length,
      publishedAt: null
    };
  }

  private async resolveMarketQuery(kind: "TRANSACCIONES" | "ANOTACIONES" | "POSICIONES_PERIODO", explicitCode?: string): Promise<ResolvedMarketQuery> {
    const environment = this.client.readConfig().environment;
    if ((await this.prisma.mibgasQueryDirectoryEntry.count({ where: { environment } })) === 0) {
      await this.refreshDirectory();
    }
    const normalizedExplicitCode = explicitCode ? normalizeQueryCode(explicitCode) : undefined;
    const searchTerms =
      kind === "TRANSACCIONES"
        ? ["Transacciones"]
        : kind === "POSICIONES_PERIODO"
          ? ["Posición neta por periodo de entrega", "Posicion neta por periodo de entrega"]
          : ["Anotaciones"];
    const candidates = await this.prisma.mibgasQueryDirectoryEntry.findMany({
      where: {
        environment,
        OR: normalizedExplicitCode
          ? [{ queryCode: normalizedExplicitCode }]
          : searchTerms.flatMap((term) => [
              { title: { contains: term, mode: "insensitive" as const } },
              { section: { contains: term, mode: "insensitive" as const } }
            ])
      },
      orderBy: [{ queryCode: "asc" }]
    });
    const selected = normalizedExplicitCode ? candidates.find((candidate) => candidate.queryCode === normalizedExplicitCode) : candidates[0];
    if (!selected) {
      const available = await this.prisma.mibgasQueryDirectoryEntry.findMany({
        where: { environment },
        orderBy: [{ queryCode: "asc" }],
        take: 12
      });
      const availableText = available.map((entry) => `${entry.queryCode} ${entry.title ?? ""}`.trim()).join("; ");
      throw new BadRequestException(
        `No se encontro consulta MIBGAS ${kind} disponible para el certificado en ${environment}. Consultas disponibles: ${availableText || "sin catalogo"}.`
      );
    }
    const configuration = await this.ensureConfiguration(selected.queryCode);
    return {
      queryCode: selected.queryCode,
      title: selected.title,
      queryType: selected.queryType,
      parameters: configuration.parameters
    };
  }

  private async ensureConfiguration(queryCode: string): Promise<MibgasQueryConfigurationResult> {
    const environment = this.client.readConfig().environment;
    const existing = await this.prisma.mibgasQueryConfiguration.findUnique({ where: { environment_queryCode: { environment, queryCode } } });
    if (existing) {
      return {
        queryCode: existing.queryCode,
        title: existing.title,
        section: existing.section,
        queryType: existing.queryType,
        parameters: existing.parametersJson as unknown as MibgasQueryConfigurationResult["parameters"],
        columns: existing.columnsJson as unknown as MibgasQueryConfigurationResult["columns"],
        rawPayloadJson: existing.rawPayloadJson as Prisma.InputJsonObject
      };
    }
    const result = await this.refreshQueryConfiguration(queryCode);
    return result.configuration;
  }

  private async startDownload(
    queryKind: MibgasPrivateQueryKind,
    queryCode: string | null,
    sessionDate: string | null,
    parameters: Record<string, string>,
    queryTitle?: string | null,
    executedBy = DEFAULT_EXECUTED_BY
  ) {
    const config = this.client.readConfig();
    return this.prisma.mibgasPrivateDownload.create({
      data: {
        environment: config.environment,
        queryKind,
        queryCode,
        queryTitle: queryTitle ?? null,
        sessionDate: sessionDate ? parseDate(sessionDate) : null,
        parametersJson: parameters,
        status: MibgasPrivateDownloadStatus.DESCARGANDO,
        executedBy
      }
    });
  }

  private async finishDownload(id: string, data: {
    status: MibgasPrivateDownloadStatus;
    records: number;
    durationMs: number;
    contentHash?: string | null;
    rawXml?: string | null;
    rawPayloadJson?: Prisma.InputJsonValue | null;
    publishedAt?: Date | null;
  }) {
    return this.prisma.mibgasPrivateDownload.update({
      where: { id },
      data: {
        status: data.status,
        records: data.records,
        durationMs: data.durationMs,
        contentHash: data.contentHash,
        rawXml: data.rawXml,
        rawPayloadJson: data.rawPayloadJson ?? Prisma.JsonNull,
        publishedAt: data.publishedAt,
        errorMessage: null
      }
    });
  }

  private async failDownload(id: string, error: unknown, durationMs: number, response?: { xml: string; json: Prisma.JsonValue }) {
    await this.prisma.mibgasPrivateDownload.update({
      where: { id },
      data: {
        status: MibgasPrivateDownloadStatus.ERROR,
        durationMs,
        errorMessage: errorMessage(error).slice(0, 4000),
        rawXml: response?.xml,
        rawPayloadJson: response?.json ?? undefined,
        contentHash: response?.xml ? hashText(response.xml) : undefined
      }
    });
  }

  private async requireDownload(id: string) {
    const row = await this.prisma.mibgasPrivateDownload.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException("Descarga privada MIBGAS no encontrada.");
    }
    return row;
  }

  private async getOrCreateAutomationConfig() {
    return this.prisma.mibgasPrivateAutomationConfig.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        active: false,
        daysBack: 1,
        daysForward: 3,
        session1: "06:00",
        session2: "12:00",
        session3: "18:00"
      },
      update: {}
    });
  }

  private async executeAutomationQuery(fecha: string, queryCode: "3140" | "3144"): Promise<MibgasPrivateAutomationRunItem> {
    const queryKind = queryCode === "3144" ? MibgasPrivateQueryKind.POSICIONES_PERIODO : MibgasPrivateQueryKind.TRANSACCIONES;
    const consulta = queryCode === "3144" ? "Posicion neta por periodo de entrega" : "Transacciones por periodo de entrega";
    try {
      const response =
        queryCode === "3144"
          ? await this.downloadNetPositions(fecha, { force: true, queryCode, executedBy: AUTOMATION_EXECUTED_BY })
          : await this.downloadTransactions(fecha, { force: true, queryCode, executedBy: AUTOMATION_EXECUTED_BY });
      return {
        fecha,
        queryCode,
        queryKind,
        consulta,
        estado: response.download.status === MibgasPrivateDownloadStatus.SIN_DATOS ? "SIN_DATOS" : response.download.status === MibgasPrivateDownloadStatus.ERROR ? "ERROR" : "PROCESADO",
        registros: response.records,
        mensaje: response.message,
        downloadId: response.download.id
      };
    } catch (error) {
      return {
        fecha,
        queryCode,
        queryKind,
        consulta,
        estado: "ERROR",
        registros: 0,
        mensaje: errorMessage(error),
        downloadId: null
      };
    }
  }
}

type ResolvedMarketQuery = {
  queryCode: string;
  title: string | null;
  queryType: string | null;
  parameters: MibgasQueryConfigurationResult["parameters"];
};

function buildExecutionParameters(parameters: MibgasQueryConfigurationResult["parameters"], sessionDate: string) {
  const values: Record<string, string> = {};
  for (const parameter of parameters) {
    const name = parameter.name?.trim();
    if (!name) {
      continue;
    }
    const normalizedName = name.toLowerCase();
    if (parameter.type === "Fec" || normalizedName.includes("fecha") || normalizedName.startsWith("dgas")) {
      values[name] = sessionDate;
      continue;
    }
    const wildcard = parameter.values.find((value) => value.code === "*")?.code;
    const firstAllowed = parameter.values.find((value) => value.code && value.code !== "*")?.code;
    if (wildcard) {
      values[name] = wildcard;
      continue;
    }
    if (firstAllowed) {
      values[name] = firstAllowed;
    }
  }
  return values;
}

function directoryCreate(environment: MibgasPrivateEnvironment, entry: MibgasDirectoryEntry): Prisma.MibgasQueryDirectoryEntryCreateInput {
  return {
    environment,
    queryCode: entry.queryCode,
    title: entry.title,
    section: entry.section,
    queryType: entry.queryType,
    rawPayloadJson: entry.rawPayloadJson
  };
}

function directoryUpdate(entry: MibgasDirectoryEntry): Prisma.MibgasQueryDirectoryEntryUpdateInput {
  return {
    title: entry.title,
    section: entry.section,
    queryType: entry.queryType,
    fetchedAt: new Date(),
    rawPayloadJson: entry.rawPayloadJson
  };
}

function configurationCreate(environment: MibgasPrivateEnvironment, queryCode: string, config: MibgasQueryConfigurationResult, rawXml: string): Prisma.MibgasQueryConfigurationCreateInput {
  return {
    environment,
    queryCode,
    title: config.title,
    section: config.section,
    queryType: config.queryType,
    parametersJson: config.parameters as unknown as Prisma.InputJsonValue,
    columnsJson: config.columns as unknown as Prisma.InputJsonValue,
    rawXml,
    rawPayloadJson: config.rawPayloadJson
  };
}

function configurationUpdate(config: MibgasQueryConfigurationResult, rawXml: string): Prisma.MibgasQueryConfigurationUpdateInput {
  return {
    title: config.title,
    section: config.section,
    queryType: config.queryType,
    parametersJson: config.parameters as unknown as Prisma.InputJsonValue,
    columnsJson: config.columns as unknown as Prisma.InputJsonValue,
    fetchedAt: new Date(),
    rawXml,
    rawPayloadJson: config.rawPayloadJson
  };
}

function toTransactionCreate(environment: MibgasPrivateEnvironment, downloadId: string, row: MibgasParsedTransaction, contentHash: string): Prisma.MibgasTransactionUncheckedCreateInput {
  return {
    environment,
    downloadId,
    tradingDay: parseRequiredDate(row.tradingDay, "TradingDay"),
    messageId: row.messageId,
    messageVersion: row.messageVersion,
    messageDatetime: parseOptionalDateTime(row.messageDatetime),
    senderId: row.senderId,
    receiverId: row.receiverId,
    contractId: row.contractId,
    messageScope: row.messageScope,
    marketParticipantId: row.marketParticipantId,
    portfolioId: row.portfolioId,
    contractType: row.contractType,
    auctionNumber: row.auctionNumber,
    orderId: row.orderId,
    transactionId: row.transactionId,
    buySellIndicator: row.buySellIndicator,
    price: row.price,
    quantity: row.quantity,
    transactionDatetime: parseOptionalDateTime(row.transactionDatetime),
    rawPayloadJson: row.rawPayloadJson,
    sourceXmlHash: contentHash
  };
}

function toTransactionUpdate(downloadId: string, row: MibgasParsedTransaction, contentHash: string): Prisma.MibgasTransactionUncheckedUpdateInput {
  return {
    downloadId,
    tradingDay: parseRequiredDate(row.tradingDay, "TradingDay"),
    messageId: row.messageId,
    messageVersion: row.messageVersion,
    messageDatetime: parseOptionalDateTime(row.messageDatetime),
    senderId: row.senderId,
    receiverId: row.receiverId,
    contractId: row.contractId,
    messageScope: row.messageScope,
    marketParticipantId: row.marketParticipantId,
    portfolioId: row.portfolioId,
    contractType: row.contractType,
    auctionNumber: row.auctionNumber,
    orderId: row.orderId,
    buySellIndicator: row.buySellIndicator,
    price: row.price,
    quantity: row.quantity,
    transactionDatetime: parseOptionalDateTime(row.transactionDatetime),
    rawPayloadJson: row.rawPayloadJson,
    sourceXmlHash: contentHash
  };
}

function toAnnotationCreate(environment: MibgasPrivateEnvironment, downloadId: string, row: MibgasParsedAnnotation, contentHash: string): Prisma.MibgasAnnotationUncheckedCreateInput {
  return {
    environment,
    downloadId,
    tradingDay: parseRequiredDate(row.tradingDay, "TradingDay"),
    messageId: row.messageId,
    messageVersion: row.messageVersion,
    messageDatetime: parseOptionalDateTime(row.messageDatetime),
    senderId: row.senderId,
    receiverId: row.receiverId,
    contractId: row.contractId,
    messageScope: row.messageScope,
    marketParticipantId: row.marketParticipantId,
    portfolioId: row.portfolioId,
    registryAccountId: row.registryAccountId,
    clearingAccountId: row.clearingAccountId,
    contractType: row.contractType,
    auctionNumber: row.auctionNumber,
    annotationId: row.annotationId,
    annotationType: row.annotationType,
    orderId: row.orderId,
    transactionId: row.transactionId,
    firstGasDay: parseOptionalDate(row.firstGasDay),
    lastGasDay: parseOptionalDate(row.lastGasDay),
    buySellIndicator: row.buySellIndicator,
    price: row.price,
    quantity: row.quantity,
    quantitySign: row.quantitySign,
    delivery: row.delivery,
    amount: row.amount,
    amountSign: row.amountSign,
    taxAmount: row.taxAmount,
    taxAmountSign: row.taxAmountSign,
    rawPayloadJson: row.rawPayloadJson,
    sourceXmlHash: contentHash
  };
}

function toAnnotationUpdate(downloadId: string, row: MibgasParsedAnnotation, contentHash: string): Prisma.MibgasAnnotationUncheckedUpdateInput {
  return {
    downloadId,
    tradingDay: parseRequiredDate(row.tradingDay, "TradingDay"),
    messageId: row.messageId,
    messageVersion: row.messageVersion,
    messageDatetime: parseOptionalDateTime(row.messageDatetime),
    senderId: row.senderId,
    receiverId: row.receiverId,
    contractId: row.contractId,
    messageScope: row.messageScope,
    marketParticipantId: row.marketParticipantId,
    portfolioId: row.portfolioId,
    registryAccountId: row.registryAccountId,
    clearingAccountId: row.clearingAccountId,
    contractType: row.contractType,
    auctionNumber: row.auctionNumber,
    annotationType: row.annotationType,
    orderId: row.orderId,
    transactionId: row.transactionId,
    firstGasDay: parseOptionalDate(row.firstGasDay),
    lastGasDay: parseOptionalDate(row.lastGasDay),
    buySellIndicator: row.buySellIndicator,
    price: row.price,
    quantity: row.quantity,
    quantitySign: row.quantitySign,
    delivery: row.delivery,
    amount: row.amount,
    amountSign: row.amountSign,
    taxAmount: row.taxAmount,
    taxAmountSign: row.taxAmountSign,
    rawPayloadJson: row.rawPayloadJson,
    sourceXmlHash: contentHash
  };
}

function toNetPositionCreate(environment: MibgasPrivateEnvironment, downloadId: string, row: MibgasParsedNetPosition, contentHash: string): Prisma.MibgasNetPositionUncheckedCreateInput {
  return {
    environment,
    downloadId,
    rowKey: row.rowKey,
    tradingDay: parseRequiredDate(row.tradingDay, "dgas"),
    installation: row.installation,
    portfolioId: row.portfolioId,
    productId: row.productId,
    segmentId: row.segmentId,
    saleQuantity: row.saleQuantity,
    purchaseQuantity: row.purchaseQuantity,
    netQuantity: row.netQuantity,
    isTotal: row.isTotal,
    rawPayloadJson: row.rawPayloadJson,
    sourceXmlHash: contentHash
  };
}

function toNetPositionUpdate(downloadId: string, row: MibgasParsedNetPosition, contentHash: string): Prisma.MibgasNetPositionUncheckedUpdateInput {
  return {
    downloadId,
    tradingDay: parseRequiredDate(row.tradingDay, "dgas"),
    installation: row.installation,
    portfolioId: row.portfolioId,
    productId: row.productId,
    segmentId: row.segmentId,
    saleQuantity: row.saleQuantity,
    purchaseQuantity: row.purchaseQuantity,
    netQuantity: row.netQuantity,
    isTotal: row.isTotal,
    rawPayloadJson: row.rawPayloadJson,
    sourceXmlHash: contentHash
  };
}

function serializeDownload(row: {
  id: string;
  environment: MibgasPrivateEnvironment;
  queryKind: MibgasPrivateQueryKind;
  queryCode: string | null;
  queryTitle: string | null;
  sessionDate: Date | null;
  parametersJson: Prisma.JsonValue;
  status: MibgasPrivateDownloadStatus;
  records: number;
  durationMs: number | null;
  publishedAt: Date | null;
  executedBy: string;
  contentHash: string | null;
  fileName: string | null;
  errorMessage: string | null;
  rawXml: string | null;
  rawPayloadJson: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}): MibgasPrivateDownloadRow {
  return {
    id: row.id,
    environment: row.environment,
    queryKind: row.queryKind,
    queryCode: row.queryCode,
    queryTitle: row.queryTitle,
    sessionDate: row.sessionDate ? formatDate(row.sessionDate) : null,
    parametersJson: row.parametersJson,
    status: row.status,
    records: row.records,
    durationMs: row.durationMs,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    executedBy: row.executedBy,
    contentHash: row.contentHash,
    fileName: row.fileName,
    errorMessage: row.errorMessage,
    rawXmlAvailable: Boolean(row.rawXml),
    rawJsonAvailable: row.rawPayloadJson !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function serializeAutomationConfig(config: {
  active: boolean;
  daysBack: number;
  daysForward: number;
  session1: string | null;
  session2: string | null;
  session3: string | null;
  lastRunKey: string | null;
  lastRunAt: Date | null;
}): MibgasPrivateAutomationConfigDto {
  return {
    active: config.active,
    daysBack: config.daysBack,
    daysForward: config.daysForward,
    sessions: [
      normalizeAutomationTime(config.session1 ?? "06:00"),
      normalizeAutomationTime(config.session2 ?? "12:00"),
      normalizeAutomationTime(config.session3 ?? "18:00")
    ],
    lastRunKey: config.lastRunKey,
    lastRunAt: config.lastRunAt ? formatMadridDateTime(config.lastRunAt) : null,
    lastRunAtUtc: config.lastRunAt?.toISOString() ?? null
  };
}

function buildLiquidationCheckTotals(rows: MibgasPrivateLiquidationCheckRow[]): MibgasPrivateLiquidationCheckResponse["totals"] {
  const bidVolume = sumNumberStrings(rows.map((row) => row.bidVolume));
  const askVolume = sumNumberStrings(rows.map((row) => row.askVolume));
  const totalVolume = sumNumberStrings(rows.map((row) => row.totalVolume));
  const weightedBase = rows.reduce((sum, row) => {
    const price = numberOrNull(row.weightedPrice);
    const grossVolume = Math.abs(numberOrNull(row.bidVolume) ?? 0) + Math.abs(numberOrNull(row.askVolume) ?? 0);
    return price === null ? sum : sum + grossVolume;
  }, 0);
  const weightedAmount = rows.reduce((sum, row) => {
    const price = numberOrNull(row.weightedPrice);
    const grossVolume = Math.abs(numberOrNull(row.bidVolume) ?? 0) + Math.abs(numberOrNull(row.askVolume) ?? 0);
    return price === null ? sum : sum + grossVolume * price;
  }, 0);
  const weightedPrice = weightedBase === 0 ? null : weightedAmount / weightedBase;
  const totalAmount = weightedPrice === null ? null : totalVolume * weightedPrice;
  return {
    bidVolume: formatNumericString(bidVolume),
    askVolume: formatNumericString(askVolume),
    totalVolume: formatNumericString(totalVolume),
    weightedPrice: weightedPrice === null ? null : formatNumericString(weightedPrice),
    totalAmount: totalAmount === null ? null : formatNumericString(totalAmount),
    transactionCount: rows.reduce((sum, row) => sum + row.transactionCount, 0)
  };
}

function sumNumberStrings(values: string[]) {
  return values.reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function numberOrNull(value: string | null) {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumericString(value: number) {
  return value.toFixed(8).replace(/\.?0+$/, "");
}

function normalizeAutomationSessions(value: string[] | undefined) {
  if (value === undefined) {
    return undefined;
  }
  const sessions = value.slice(0, 3).map(normalizeAutomationTime);
  while (sessions.length < 3) {
    sessions.push(["06:00", "12:00", "18:00"][sessions.length]);
  }
  return sessions as [string, string, string];
}

function normalizeAutomationTime(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new BadRequestException("Las sesiones automaticas MIBGAS deben tener formato HH:mm.");
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isSafeInteger(hour) || !Number.isSafeInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new BadRequestException("Las sesiones automaticas MIBGAS deben tener una hora valida.");
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeAutomationDayWindow(value: number, fieldName: "daysBack" | "daysForward") {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 31) {
    throw new BadRequestException(`${fieldName} debe estar entre 0 y 31.`);
  }
  return parsed;
}

export function buildGasAutomationDates(daysBack: number, daysForward: number, referenceDate: Date) {
  const todayMadrid = madridDateParts(referenceDate).date;
  const dates: string[] = [];
  const base = new Date(`${todayMadrid}T00:00:00.000Z`);
  for (let offset = -daysBack; offset <= daysForward; offset += 1) {
    const date = new Date(base);
    date.setUTCDate(base.getUTCDate() + offset);
    dates.push(formatDate(date));
  }
  return dates;
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
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`
  };
}

function formatMadridDateTime(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}`;
}

function normalizeQueryCode(value: string) {
  const normalized = value.trim();
  if (!/^\d{1,6}$/.test(normalized)) {
    throw new BadRequestException("codigoConsulta MIBGAS no valido.");
  }
  return normalized;
}

function parseDateOnlyString(value: string) {
  const normalized = value?.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new BadRequestException("La fecha debe tener formato YYYY-MM-DD.");
  }
  return normalized;
}

function parseDate(value: string) {
  const parsed = new Date(`${parseDateOnlyString(value)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException("Fecha no valida.");
  }
  return parsed;
}

function parseRequiredDate(value: string | null, field: string) {
  if (!value) {
    throw new BadRequestException(`MIBGAS no devolvio ${field}.`);
  }
  return parseDate(value);
}

function parseOptionalDate(value: string | null) {
  return value ? parseDate(value) : null;
}

function parseOptionalDateTime(value: string | null) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildDateRange(from?: string, to?: string) {
  if (!from && !to) {
    return undefined;
  }
  return {
    gte: from ? parseDate(from) : undefined,
    lte: to ? parseDate(to) : undefined
  };
}

function buildTransactionSideWhere(value?: string): Prisma.MibgasTransactionWhereInput {
  const trimmed = value?.trim();
  const normalized = trimmed?.toUpperCase();
  if (!normalized) {
    return {};
  }

  const values: string[] =
    ["COMPRA", "BUY", "B", "C"].includes(normalized)
      ? ["Compra", "COMPRA", "BUY", "Buy", "B", "C"]
      : ["VENTA", "SELL", "S", "V"].includes(normalized)
        ? ["Venta", "VENTA", "SELL", "Sell", "S", "V"]
        : [trimmed ?? normalized];

  return { buySellIndicator: { in: values } };
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function decimalToString(value: Prisma.Decimal | null) {
  return value === null ? null : value.toString();
}

function boundedTake(value: number | undefined) {
  const parsed = Number(value ?? 200);
  return Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, 1), 1000) : 200;
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
