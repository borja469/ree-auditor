import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import { OmieDownloadEstado, OmieTipoDocumento, OmieTipoPrecio } from "@prisma/client";
import {
  OmieControlCodigo,
  OmieControlModulo,
  OmieAutomationConfigInput,
  OmieControlTipo,
  OmieDescargasService,
  OmieDownloadExecuteRequest
} from "./omie-descargas.service";

@Controller("omie/descargas")
export class OmieDescargasController {
  constructor(private readonly omieDescargasService: OmieDescargasService) {}

  @Get("control")
  async obtenerControlDescargas(
    @Query("fechaDesde") fechaDesde?: string,
    @Query("fechaHasta") fechaHasta?: string,
    @Query("modulo") modulo?: string,
    @Query("codigoOmie") codigoOmie?: string,
    @Query("tipoDocumento") tipoDocumento?: string,
    @Query("estado") estado?: string,
    @Query("sesion") sesion?: string
  ) {
    return this.omieDescargasService.obtenerControlDescargas({
      fechaDesde: fechaDesde ? parseFechaQuery(fechaDesde, "fechaDesde") : undefined,
      fechaHasta: fechaHasta ? parseFechaQuery(fechaHasta, "fechaHasta") : undefined,
      modulo: parseModulo(modulo),
      codigoOmie: parseCodigo(codigoOmie),
      tipoDocumento: parseTipoDocumento(tipoDocumento),
      estado: parseEstado(estado),
      sesion: sesion ? parseSesion(sesion) : undefined
    });
  }

  @Get("control/:id/detalle")
  async obtenerDetalle(@Param("id") id: string) {
    return this.omieDescargasService.obtenerDetalle(id);
  }

  @Post("ejecutar")
  async ejecutarDescarga(@Body() body: unknown, @Query("force") force?: string) {
    return this.omieDescargasService.ejecutarDescarga(parseExecuteBody(body), { force: parseBoolean(force) });
  }

  @Post("ejecutar-dia")
  async ejecutarDescargaDiaria(@Body() body: unknown, @Query("force") force?: string) {
    return this.omieDescargasService.descargarTodoElDia(parseDailyBulkBody(body), { force: parseBoolean(force) });
  }

  @Get("automatizacion")
  async obtenerAutomatizacion() {
    return this.omieDescargasService.obtenerAutomatizacion();
  }

  @Put("automatizacion")
  async guardarAutomatizacion(@Body() body: unknown) {
    return this.omieDescargasService.guardarAutomatizacion(parseAutomationBody(body));
  }

  @Post("automatizacion/ejecutar")
  async ejecutarAutomatizacion(@Body() body: unknown) {
    const request = parseAutomationRunBody(body);
    return this.omieDescargasService.ejecutarAutomatizacion(request.session, request.daysBack);
  }

  @Post("control/:id/reprocesar")
  async reprocesar(@Param("id") id: string) {
    return this.omieDescargasService.reprocesar(id);
  }

  @Post("control/:id/redescargar")
  async redescargar(@Param("id") id: string) {
    return this.omieDescargasService.redescargar(id);
  }
}

function parseExecuteBody(body: unknown): OmieDownloadExecuteRequest {
  if (!isRecord(body)) {
    throw new BadRequestException("El body debe ser un objeto JSON.");
  }
  return {
    codigoOmie: parseRequiredCodigo(readString(body, "codigoOmie")),
    fecha: readOptionalDate(body, "fecha"),
    fechaDesde: readOptionalDate(body, "fechaDesde"),
    fechaHasta: readOptionalDate(body, "fechaHasta"),
    sesion: readString(body, "sesion")
  };
}

function parseDailyBulkBody(body: unknown) {
  if (!isRecord(body)) {
    throw new BadRequestException("El body debe ser un objeto JSON.");
  }
  return {
    fecha: parseFechaQuery(readString(body, "fecha"), "fecha")
  };
}

function parseAutomationBody(body: unknown): OmieAutomationConfigInput {
  if (!isRecord(body)) {
    throw new BadRequestException("El body debe ser un objeto JSON.");
  }
  const sessions = Array.isArray(body.sessions) ? body.sessions.map((item) => String(item)) : undefined;
  return {
    active: typeof body.active === "boolean" ? body.active : undefined,
    daysBack: body.daysBack === undefined ? undefined : parsePositiveInteger(body.daysBack, "daysBack"),
    sessions
  };
}

function parseAutomationRunBody(body: unknown) {
  if (!isRecord(body)) {
    throw new BadRequestException("El body debe ser un objeto JSON.");
  }
  return {
    session: readString(body, "session") ?? "00:00",
    daysBack: body.daysBack === undefined ? undefined : parsePositiveInteger(body.daysBack, "daysBack")
  };
}

function readOptionalDate(body: Record<string, unknown>, key: string) {
  const value = readString(body, key);
  return value ? parseFechaQuery(value, key) : undefined;
}

function readString(body: Record<string, unknown>, key: string) {
  const value = body[key];
  return value === undefined || value === null ? undefined : String(value);
}

function parseFechaQuery(value: string | undefined, fieldName: string) {
  const fecha = value?.trim();
  if (!fecha) {
    throw new BadRequestException(`El parametro ${fieldName} es obligatorio.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new BadRequestException(`El parametro ${fieldName} debe tener formato YYYY-MM-DD.`);
  }
  const parsed = new Date(`${fecha}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== fecha) {
    throw new BadRequestException(`El parametro ${fieldName} no es una fecha valida.`);
  }
  return fecha;
}

function parseModulo(value: string | undefined): OmieControlModulo | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "programas") {
    return "Programas";
  }
  if (normalized === "precios") {
    return "Precios";
  }
  if (normalized === "transacciones") {
    return "Transacciones";
  }
  throw new BadRequestException("modulo debe ser Programas, Precios o Transacciones.");
}

function parseCodigo(value: string | undefined): OmieControlCodigo | undefined {
  return value ? parseRequiredCodigo(value) : undefined;
}

function parseRequiredCodigo(value: string | undefined): OmieControlCodigo {
  const normalized = value?.trim();
  if (normalized === "5302" || normalized === "5608" || normalized === "5202" || normalized === "5603" || normalized === "4125" || normalized === "4121") {
    return normalized;
  }
  throw new BadRequestException("codigoOmie debe ser 5302, 5608, 5202, 5603, 4125 o 4121.");
}

function parseTipoDocumento(value: string | undefined): OmieControlTipo | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toUpperCase();
  if (
    normalized !== OmieTipoDocumento.PVD &&
    normalized !== OmieTipoDocumento.PHF &&
    normalized !== OmieTipoPrecio.MD &&
    normalized !== OmieTipoPrecio.MI &&
    normalized !== OmieTipoPrecio.XBID &&
    normalized !== "TRANSACCIONES"
  ) {
    throw new BadRequestException("tipoDocumento debe ser PVD, PHF, MD, MI, XBID o TRANSACCIONES.");
  }
  return normalized as OmieControlTipo;
}

function parseEstado(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toUpperCase();
  if (!Object.values(OmieDownloadEstado).includes(normalized as OmieDownloadEstado)) {
    throw new BadRequestException("estado de descarga OMIE no valido.");
  }
  return normalized as OmieDownloadEstado;
}

function parseSesion(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 99) {
    throw new BadRequestException("El parametro sesion debe ser un entero positivo entre 1 y 99.");
  }
  return String(parsed).padStart(2, "0");
}

function parseBoolean(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "si";
}

function parsePositiveInteger(value: unknown, fieldName: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new BadRequestException(`${fieldName} debe ser un entero positivo.`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
