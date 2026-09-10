import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import { MibgasPrivateDownloadStatus, MibgasPrivateQueryKind } from "@prisma/client";
import { MibgasPrivateAutomationConfigInput, MibgasPrivateService } from "./mibgas-private.service";

@Controller("mibgas/private")
export class MibgasPrivateController {
  constructor(private readonly service: MibgasPrivateService) {}

  @Get("status")
  status() {
    return this.service.status();
  }

  @Post("test")
  testConnection() {
    return this.service.testConnection();
  }

  @Post("directory/refresh")
  refreshDirectory() {
    return this.service.refreshDirectory();
  }

  @Get("directory")
  directory() {
    return this.service.getDirectory();
  }

  @Get("automation")
  automation() {
    return this.service.getAutomationConfig();
  }

  @Put("automation")
  saveAutomation(@Body() body: unknown) {
    return this.service.saveAutomationConfig(parseAutomationBody(body));
  }

  @Post("automation/run")
  async runAutomation(@Body() body: unknown) {
    const request = parseAutomationRunBody(body);
    const result = await this.service.executeAutomation(request.session, request.daysBack, request.daysForward);
    await this.service.markAutomationRun(`${new Date().toISOString().slice(0, 10)}-${result.session}`);
    return result;
  }

  @Post("queries/:queryCode/configuration/refresh")
  refreshConfiguration(@Param("queryCode") queryCode: string) {
    return this.service.refreshQueryConfiguration(queryCode);
  }

  @Get("queries/:queryCode/configuration")
  configuration(@Param("queryCode") queryCode: string) {
    return this.service.getQueryConfiguration(queryCode);
  }

  @Post("downloads/transactions")
  downloadTransactions(@Body() body: unknown, @Query("force") force?: string) {
    const request = parseDownloadBody(body);
    return this.service.downloadTransactions(request.sessionDate, { force: parseBoolean(force), queryCode: request.queryCode });
  }

  @Post("downloads/annotations")
  downloadAnnotations(@Body() body: unknown, @Query("force") force?: string) {
    const request = parseDownloadBody(body);
    return this.service.downloadAnnotations(request.sessionDate, { force: parseBoolean(force), queryCode: request.queryCode });
  }

  @Post("downloads/net-positions")
  downloadNetPositions(@Body() body: unknown, @Query("force") force?: string) {
    const request = parseDownloadBody(body);
    return this.service.downloadNetPositions(request.sessionDate, { force: parseBoolean(force), queryCode: request.queryCode });
  }

  @Get("downloads")
  downloads(
    @Query("queryKind") queryKind?: string,
    @Query("status") status?: string,
    @Query("sessionDateFrom") sessionDateFrom?: string,
    @Query("sessionDateTo") sessionDateTo?: string
  ) {
    return this.service.listDownloads({
      queryKind: parseQueryKind(queryKind),
      status: parseStatus(status),
      sessionDateFrom: sessionDateFrom ? parseDate(sessionDateFrom, "sessionDateFrom") : undefined,
      sessionDateTo: sessionDateTo ? parseDate(sessionDateTo, "sessionDateTo") : undefined
    });
  }

  @Get("downloads/:id")
  downloadDetail(@Param("id") id: string) {
    return this.service.getDownloadDetail(id);
  }

  @Get("transactions")
  transactions(
    @Query("tradingDayFrom") tradingDayFrom?: string,
    @Query("tradingDayTo") tradingDayTo?: string,
    @Query("buySellIndicator") buySellIndicator?: string,
    @Query("take") take?: string
  ) {
    return this.service.listTransactions({
      tradingDayFrom: tradingDayFrom ? parseDate(tradingDayFrom, "tradingDayFrom") : undefined,
      tradingDayTo: tradingDayTo ? parseDate(tradingDayTo, "tradingDayTo") : undefined,
      buySellIndicator,
      take: parseTake(take)
    });
  }

  @Get("annotations")
  annotations(@Query("tradingDayFrom") tradingDayFrom?: string, @Query("tradingDayTo") tradingDayTo?: string, @Query("take") take?: string) {
    return this.service.listAnnotations({
      tradingDayFrom: tradingDayFrom ? parseDate(tradingDayFrom, "tradingDayFrom") : undefined,
      tradingDayTo: tradingDayTo ? parseDate(tradingDayTo, "tradingDayTo") : undefined,
      take: parseTake(take)
    });
  }

  @Get("net-positions")
  netPositions(
    @Query("tradingDayFrom") tradingDayFrom?: string,
    @Query("tradingDayTo") tradingDayTo?: string,
    @Query("installation") installation?: string,
    @Query("portfolioId") portfolioId?: string,
    @Query("productId") productId?: string,
    @Query("includeTotals") includeTotals?: string,
    @Query("take") take?: string
  ) {
    return this.service.listNetPositions({
      tradingDayFrom: tradingDayFrom ? parseDate(tradingDayFrom, "tradingDayFrom") : undefined,
      tradingDayTo: tradingDayTo ? parseDate(tradingDayTo, "tradingDayTo") : undefined,
      installation,
      portfolioId,
      productId,
      includeTotals: parseBoolean(includeTotals),
      take: parseTake(take)
    });
  }

  @Get("liquidation-check")
  liquidationCheck(@Query("year") year?: string, @Query("month") month?: string) {
    return this.service.getLiquidationCheck(parseYear(year), parseMonth(month));
  }
}

function parseDownloadBody(body: unknown) {
  if (!isRecord(body)) {
    throw new BadRequestException("El body debe ser un objeto JSON.");
  }
  return {
    sessionDate: parseDate(readString(body, "sessionDate") ?? readString(body, "fechaSesion"), "sessionDate"),
    queryCode: readString(body, "queryCode") ?? readString(body, "codigoConsulta")
  };
}

function parseAutomationBody(body: unknown): MibgasPrivateAutomationConfigInput {
  if (!isRecord(body)) {
    throw new BadRequestException("El body debe ser un objeto JSON.");
  }
  const sessions = Array.isArray(body.sessions) ? body.sessions.map((item) => String(item)) : undefined;
  return {
    active: typeof body.active === "boolean" ? body.active : undefined,
    daysBack: body.daysBack === undefined ? undefined : parseNonNegativeInteger(body.daysBack, "daysBack"),
    daysForward: body.daysForward === undefined ? undefined : parseNonNegativeInteger(body.daysForward, "daysForward"),
    sessions
  };
}

function parseAutomationRunBody(body: unknown) {
  if (!isRecord(body)) {
    throw new BadRequestException("El body debe ser un objeto JSON.");
  }
  return {
    session: readString(body, "session") ?? "00:00",
    daysBack: body.daysBack === undefined ? undefined : parseNonNegativeInteger(body.daysBack, "daysBack"),
    daysForward: body.daysForward === undefined ? undefined : parseNonNegativeInteger(body.daysForward, "daysForward")
  };
}

function parseQueryKind(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toUpperCase();
  if (!Object.values(MibgasPrivateQueryKind).includes(normalized as MibgasPrivateQueryKind)) {
    throw new BadRequestException("queryKind MIBGAS no valido.");
  }
  return normalized as MibgasPrivateQueryKind;
}

function parseStatus(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toUpperCase();
  if (!Object.values(MibgasPrivateDownloadStatus).includes(normalized as MibgasPrivateDownloadStatus)) {
    throw new BadRequestException("status MIBGAS no valido.");
  }
  return normalized as MibgasPrivateDownloadStatus;
}

function parseDate(value: string | undefined, field: string) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new BadRequestException(`${field} es obligatorio.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new BadRequestException(`${field} debe tener formato YYYY-MM-DD.`);
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new BadRequestException(`${field} no es una fecha valida.`);
  }
  return normalized;
}

function parseTake(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new BadRequestException("take debe ser un entero positivo.");
  }
  return parsed;
}

function parseNonNegativeInteger(value: unknown, fieldName: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new BadRequestException(`${fieldName} debe ser un entero mayor o igual que cero.`);
  }
  return parsed;
}

function parseYear(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 2000 || parsed > 2100) {
    throw new BadRequestException("year debe ser un anio valido entre 2000 y 2100.");
  }
  return parsed;
}

function parseMonth(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 12) {
    throw new BadRequestException("month debe ser un mes valido entre 1 y 12.");
  }
  return parsed;
}

function parseBoolean(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "si";
}

function readString(body: Record<string, unknown>, key: string) {
  const value = body[key];
  return value === undefined || value === null ? undefined : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
