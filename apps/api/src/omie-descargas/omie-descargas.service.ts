import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { OmieDownloadEstado, OmieTipoDocumento, OmieTipoPrecio, Prisma } from "@prisma/client";
import { OmiePreciosService } from "../omie-precios/omie-precios.service";
import { OmieProgramasService } from "../omie-programas/omie-programas.service";
import { OMIE_ENERGIA_UMEDIDA, normalizeOmieEnergiaSesion } from "../omie-siom2/omie-energia";
import { OmieTransaccionesService } from "../omie-transacciones/omie-transacciones.service";
import { PrismaService } from "../prisma/prisma.service";

const MAX_CONTROL_ROWS = 500;

export type OmieControlModulo = "Programas" | "Precios" | "Transacciones";
export type OmieControlOrigen = "programas" | "precios" | "transacciones";
export type OmieControlTipo = OmieTipoDocumento | OmieTipoPrecio | "TRANSACCIONES";
export type OmieControlCodigo = "5302" | "5608" | "5202" | "5603" | "4125" | "4121";

export type OmieDownloadControlFilters = {
  fechaDesde?: string;
  fechaHasta?: string;
  modulo?: OmieControlModulo;
  codigoOmie?: OmieControlCodigo;
  tipoDocumento?: OmieControlTipo;
  estado?: OmieDownloadEstado;
  sesion?: string;
};

export type OmieDownloadControlRow = {
  id: string;
  origen: OmieControlOrigen;
  modulo: OmieControlModulo;
  consulta: string;
  codigoOmie: OmieControlCodigo;
  descripcion: string;
  tipoDocumento: OmieControlTipo;
  fechaPrograma: string;
  fechaHasta: string | null;
  sesion: string | null;
  version: number | null;
  uOfertante: string | null;
  fechaDescarga: string;
  estado: OmieDownloadEstado;
  registros: number;
  hashContenido: string | null;
  nombreFichero: string | null;
  mensajeError: string | null;
  parametrosUtilizados: Record<string, string | number | null>;
  tiempoEjecucionMs: number | null;
  rawXmlDisponible: boolean;
  rawJsonDisponible: boolean;
  logDisponible: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OmieDownloadDetail = OmieDownloadControlRow & {
  rawXml: string | null;
  rawJson: Prisma.JsonValue | null;
  log: string[];
};

export type OmieDownloadExecuteRequest = {
  codigoOmie: OmieControlCodigo;
  fecha?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  sesion?: string;
};

export type OmieDownloadDailyBulkRequest = {
  fecha: string;
};

export type OmieDownloadDailyBulkItem = {
  codigoOmie: OmieControlCodigo;
  modulo: OmieControlModulo;
  consulta: string;
  sesion: string | null;
  estado: "PROCESADO" | "SIN_DATOS" | "ERROR" | "OMITIDO";
  registros: number;
  mensaje: string;
  downloadId: string | null;
};

export type OmieDownloadDailyBulkResponse = {
  fecha: string;
  force: boolean;
  totalConsultas: number;
  totalConsultasEjecutadas: number;
  procesadas: number;
  sinDatos: number;
  errores: number;
  omitidas: number;
  tiempoTotalMs: number;
  resultados: OmieDownloadDailyBulkItem[];
};

export type OmieAutomationConfigDto = {
  active: boolean;
  daysBack: number;
  sessions: [string, string, string];
  lastRunKey: string | null;
  lastRunAt: string | null;
};

export type OmieAutomationRunResponse = {
  session: string;
  startedAt: string;
  finishedAt: string;
  force: true;
  daysBack: number;
  dates: string[];
  totalConsultas: number;
  totalConsultasEjecutadas: number;
  procesadas: number;
  sinDatos: number;
  errores: number;
  omitidas: number;
  tiempoTotalMs: number;
  resultados: OmieDownloadDailyBulkResponse[];
};

export type OmieAutomationConfigInput = {
  active?: boolean;
  daysBack?: number;
  sessions?: string[];
};

type SyncOptions = {
  force?: boolean;
};

@Injectable()
export class OmieDescargasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly omieProgramasService: OmieProgramasService,
    private readonly omiePreciosService: OmiePreciosService,
    private readonly omieTransaccionesService: OmieTransaccionesService
  ) {}

  async obtenerControlDescargas(filters: OmieDownloadControlFilters = {}): Promise<OmieDownloadControlRow[]> {
    const shouldQueryProgramas = this.shouldQuery("Programas", filters);
    const shouldQueryPrecios = this.shouldQuery("Precios", filters);
    const shouldQueryTransacciones = this.shouldQuery("Transacciones", filters);

    const [programas, precios, transacciones] = await Promise.all([
      shouldQueryProgramas
        ? this.prisma.omieDownload.findMany({
            where: buildProgramaWhere(filters),
            orderBy: [{ fechaPrograma: "desc" }, { tipoDocumento: "asc" }, { sesion: "asc" }, { updatedAt: "desc" }],
            take: MAX_CONTROL_ROWS
          })
        : Promise.resolve([]),
      shouldQueryPrecios
        ? this.prisma.omiePriceDownload.findMany({
            where: buildPrecioWhere(filters),
            orderBy: [{ fechaPrograma: "desc" }, { tipoPrecio: "asc" }, { sesion: "asc" }, { updatedAt: "desc" }],
            take: MAX_CONTROL_ROWS
          })
        : Promise.resolve([]),
      shouldQueryTransacciones
        ? this.prisma.omieTransactionDownload.findMany({
            where: buildTransaccionWhere(filters),
            orderBy: [{ fechaDescarga: "desc" }, { updatedAt: "desc" }],
            take: MAX_CONTROL_ROWS
          })
        : Promise.resolve([])
    ]);

    return [
      ...programas.map(serializeProgramaDownload),
      ...precios.map(serializePrecioDownload),
      ...transacciones.map(serializeTransaccionDownload)
    ]
      .filter((row) => matchesControlFilters(row, filters))
      .sort(sortControlRows)
      .slice(0, MAX_CONTROL_ROWS);
  }

  async obtenerDetalle(id: string): Promise<OmieDownloadDetail> {
    const programa = await this.prisma.omieDownload.findUnique({ where: { id } });
    if (programa) {
      const row = serializeProgramaDownload(programa);
      return buildDetail(row, {
        rawJson: {
          descarga: row,
          notaXml: "El XML no se persiste en omie_downloads.",
          notaLog: "Log reconstruido desde el registro de control."
        }
      });
    }

    const precio = await this.prisma.omiePriceDownload.findUnique({ where: { id } });
    if (precio) {
      const row = serializePrecioDownload(precio);
      return buildDetail(row, {
        rawJson: {
          descarga: row,
          notaXml: "El XML no se persiste en omie_price_downloads.",
          notaLog: "Log reconstruido desde el registro de control."
        }
      });
    }

    const transaccion = await this.prisma.omieTransactionDownload.findUnique({ where: { id } });
    if (transaccion) {
      const staging = await this.prisma.omieTransactionStaging.findMany({
        where: { downloadId: id },
        orderBy: { rowIndex: "asc" },
        take: 10
      });
      const row = serializeTransaccionDownload(transaccion);
      return buildDetail(row, {
        rawJson: {
          descarga: row,
          resumenEstructura: transaccion.resumenEstructura,
          columnas: transaccion.columnas,
          primerasFilasStaging: staging.map((item) => item.rawPayloadJson)
        }
      });
    }

    throw new NotFoundException("Descarga OMIE no encontrada.");
  }

  async ejecutarDescarga(request: OmieDownloadExecuteRequest, options: SyncOptions = {}) {
    const codigo = parseCodigo(request.codigoOmie);
    const fecha = request.fecha ?? request.fechaDesde;

    if (codigo === "5302") {
      const response = await this.omieProgramasService.sincronizarPvd(requireFecha(fecha), options);
      return this.buildExecutionResponse(response.message, response.download.id, response);
    }
    if (codigo === "5608") {
      const response = await this.omieProgramasService.sincronizarPhf(requireFecha(fecha), requireSesion(request.sesion), options);
      return this.buildExecutionResponse(response.message, response.download.id, response);
    }
    if (codigo === "5202") {
      const response = await this.omiePreciosService.sincronizarMercadoDiario(requireFecha(fecha), options);
      return this.buildExecutionResponse(response.message, response.download.id, response);
    }
    if (codigo === "5603") {
      const response = await this.omiePreciosService.sincronizarMercadoIntradiario(requireFecha(fecha), requireSesion(request.sesion), options);
      return this.buildExecutionResponse(response.message, response.download.id, response);
    }
    if (codigo === "4125") {
      const response = await this.omiePreciosService.sincronizarXbid(requireFecha(fecha), options);
      return this.buildExecutionResponse(response.message, response.download.id, response);
    }

    const fechaDesde = requireFecha(request.fechaDesde ?? request.fecha);
    const fechaHasta = requireFecha(request.fechaHasta ?? request.fechaDesde ?? request.fecha);
    const response = await this.omieTransaccionesService.descargarHistorico(fechaDesde, fechaHasta, options);
    return this.buildExecutionResponse(response.message, response.download.id, response);
  }

  async descargarTodoElDia(request: OmieDownloadDailyBulkRequest, options: SyncOptions = {}): Promise<OmieDownloadDailyBulkResponse> {
    const fecha = requireFecha(request.fecha);
    const startedAt = Date.now();
    const tasks = buildDailyBulkTasks(fecha);
    const resultados: OmieDownloadDailyBulkItem[] = [];

    for (const task of tasks) {
      try {
        const response = await this.ejecutarDescarga(task.request, options);
        const skipped = response.message === "Ya existe descarga procesada" && !options.force;
        resultados.push({
          codigoOmie: task.codigoOmie,
          modulo: task.modulo,
          consulta: task.consulta,
          sesion: task.sesion,
          estado: skipped ? "OMITIDO" : response.download.registros === 0 ? "SIN_DATOS" : "PROCESADO",
          registros: response.download.registros,
          mensaje: skipped ? "Ya existe descarga procesada" : response.message,
          downloadId: response.download.id
        });
      } catch (error) {
        resultados.push({
          codigoOmie: task.codigoOmie,
          modulo: task.modulo,
          consulta: task.consulta,
          sesion: task.sesion,
          estado: "ERROR",
          registros: 0,
          mensaje: error instanceof Error ? error.message : String(error),
          downloadId: null
        });
      }
    }

    return {
      fecha,
      force: Boolean(options.force),
      totalConsultas: tasks.length,
      totalConsultasEjecutadas: resultados.filter((item) => item.estado !== "OMITIDO").length,
      procesadas: resultados.filter((item) => item.estado === "PROCESADO").length,
      sinDatos: resultados.filter((item) => item.estado === "SIN_DATOS").length,
      errores: resultados.filter((item) => item.estado === "ERROR").length,
      omitidas: resultados.filter((item) => item.estado === "OMITIDO").length,
      tiempoTotalMs: Date.now() - startedAt,
      resultados
    };
  }

  async obtenerAutomatizacion(): Promise<OmieAutomationConfigDto> {
    const config = await this.getOrCreateAutomationConfig();
    return serializeAutomationConfig(config);
  }

  async guardarAutomatizacion(input: OmieAutomationConfigInput): Promise<OmieAutomationConfigDto> {
    const sessions = normalizeAutomationSessions(input.sessions);
    const data: {
      active?: boolean;
      daysBack?: number;
      session1?: string;
      session2?: string;
      session3?: string;
    } = {};

    if (typeof input.active === "boolean") {
      data.active = input.active;
    }
    if (input.daysBack !== undefined) {
      data.daysBack = normalizeDaysBack(input.daysBack);
    }
    if (sessions) {
      data.session1 = sessions[0];
      data.session2 = sessions[1];
      data.session3 = sessions[2];
    }

    const config = await this.prisma.omieAutomationConfig.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        active: data.active ?? false,
        daysBack: data.daysBack ?? 3,
        session1: data.session1 ?? "06:00",
        session2: data.session2 ?? "12:00",
        session3: data.session3 ?? "18:00"
      },
      update: data
    });
    return serializeAutomationConfig(config);
  }

  async ejecutarAutomatizacion(session: string, daysBack?: number): Promise<OmieAutomationRunResponse> {
    const normalizedSession = normalizeAutomationTime(session);
    const config = await this.getOrCreateAutomationConfig();
    const resolvedDaysBack = normalizeDaysBack(daysBack ?? config.daysBack);
    const startedAt = new Date();
    const dates = buildRecentDates(resolvedDaysBack, startedAt);
    const resultados: OmieDownloadDailyBulkResponse[] = [];

    for (const fecha of dates) {
      resultados.push(await this.descargarTodoElDia({ fecha }, { force: true }));
    }

    const finishedAt = new Date();
    return {
      session: normalizedSession,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      force: true,
      daysBack: resolvedDaysBack,
      dates,
      totalConsultas: sumAutomation(resultados, "totalConsultas"),
      totalConsultasEjecutadas: sumAutomation(resultados, "totalConsultasEjecutadas"),
      procesadas: sumAutomation(resultados, "procesadas"),
      sinDatos: sumAutomation(resultados, "sinDatos"),
      errores: sumAutomation(resultados, "errores"),
      omitidas: sumAutomation(resultados, "omitidas"),
      tiempoTotalMs: finishedAt.getTime() - startedAt.getTime(),
      resultados
    };
  }

  async markAutomationRun(runKey: string) {
    await this.prisma.omieAutomationConfig.update({
      where: { id: 1 },
      data: {
        lastRunKey: runKey,
        lastRunAt: new Date()
      }
    });
  }

  private async getOrCreateAutomationConfig() {
    return this.prisma.omieAutomationConfig.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        active: false,
        daysBack: 3,
        session1: "06:00",
        session2: "12:00",
        session3: "18:00"
      },
      update: {}
    });
  }

  async reprocesar(id: string) {
    const row = await this.obtenerDetalle(id);
    return this.ejecutarDescarga(buildRequestFromRow(row), { force: false });
  }

  async redescargar(id: string) {
    const row = await this.obtenerDetalle(id);
    return this.ejecutarDescarga(buildRequestFromRow(row), { force: true });
  }

  private shouldQuery(modulo: OmieControlModulo, filters: OmieDownloadControlFilters) {
    if (filters.modulo && filters.modulo !== modulo) {
      return false;
    }
    if (filters.codigoOmie && codigoToModulo(filters.codigoOmie) !== modulo) {
      return false;
    }
    if (filters.tipoDocumento && tipoToModulo(filters.tipoDocumento) !== modulo) {
      return false;
    }
    return true;
  }

  private async buildExecutionResponse(message: string, downloadId: string, result: unknown) {
    return {
      message,
      download: await this.obtenerDetalle(downloadId),
      result
    };
  }
}

function serializeAutomationConfig(config: {
  active: boolean;
  daysBack: number;
  session1: string | null;
  session2: string | null;
  session3: string | null;
  lastRunKey: string | null;
  lastRunAt: Date | null;
}): OmieAutomationConfigDto {
  return {
    active: config.active,
    daysBack: config.daysBack,
    sessions: [
      normalizeAutomationTime(config.session1 ?? "06:00"),
      normalizeAutomationTime(config.session2 ?? "12:00"),
      normalizeAutomationTime(config.session3 ?? "18:00")
    ],
    lastRunKey: config.lastRunKey,
    lastRunAt: config.lastRunAt?.toISOString() ?? null
  };
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
    throw new BadRequestException("Las sesiones automaticas deben tener formato HH:mm.");
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isSafeInteger(hour) || !Number.isSafeInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new BadRequestException("Las sesiones automaticas deben tener una hora valida.");
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeDaysBack(value: number) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 31) {
    throw new BadRequestException("Los dias atras deben estar entre 1 y 31.");
  }
  return parsed;
}

function buildRecentDates(daysBack: number, referenceDate: Date) {
  const todayMadrid = madridDateParts(referenceDate).date;
  const dates: string[] = [];
  const base = new Date(`${todayMadrid}T00:00:00.000Z`);
  for (let offset = 0; offset < daysBack; offset += 1) {
    const date = new Date(base);
    date.setUTCDate(base.getUTCDate() - offset);
    dates.push(formatDateOnly(date));
  }
  return dates;
}

function sumAutomation<K extends "totalConsultas" | "totalConsultasEjecutadas" | "procesadas" | "sinDatos" | "errores" | "omitidas">(
  resultados: OmieDownloadDailyBulkResponse[],
  key: K
) {
  return resultados.reduce((sum, result) => sum + result[key], 0);
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

function buildDailyBulkTasks(fecha: string) {
  const sessions = ["01", "02", "03", "04", "05", "06", "07"];
  return [
    {
      codigoOmie: "5302" as const,
      modulo: "Programas" as const,
      consulta: "PVD",
      sesion: null,
      request: { codigoOmie: "5302" as const, fecha }
    },
    ...sessions.map((sesion) => ({
      codigoOmie: "5608" as const,
      modulo: "Programas" as const,
      consulta: "PHF",
      sesion,
      request: { codigoOmie: "5608" as const, fecha, sesion }
    })),
    {
      codigoOmie: "5202" as const,
      modulo: "Precios" as const,
      consulta: "Mercado Diario",
      sesion: null,
      request: { codigoOmie: "5202" as const, fecha }
    },
    ...sessions.map((sesion) => ({
      codigoOmie: "5603" as const,
      modulo: "Precios" as const,
      consulta: "Intradiario",
      sesion,
      request: { codigoOmie: "5603" as const, fecha, sesion }
    })),
    {
      codigoOmie: "4125" as const,
      modulo: "Precios" as const,
      consulta: "XBID",
      sesion: null,
      request: { codigoOmie: "4125" as const, fecha }
    },
    {
      codigoOmie: "4121" as const,
      modulo: "Transacciones" as const,
      consulta: "Historico",
      sesion: null,
      request: { codigoOmie: "4121" as const, fechaDesde: fecha, fechaHasta: fecha }
    }
  ];
}

function buildProgramaWhere(filters: OmieDownloadControlFilters): Prisma.OmieDownloadWhereInput {
  const where: Prisma.OmieDownloadWhereInput = {};
  const tipoDocumento = getProgramaTipo(filters);
  if (tipoDocumento) {
    where.tipoDocumento = tipoDocumento;
  }
  if (filters.estado) {
    where.estado = filters.estado;
  }
  if (filters.sesion !== undefined) {
    where.sesion = filters.sesion;
  }
  if (filters.fechaDesde || filters.fechaHasta) {
    where.fechaPrograma = {
      gte: filters.fechaDesde ? parseDateOnly(filters.fechaDesde) : undefined,
      lte: filters.fechaHasta ? parseDateOnly(filters.fechaHasta) : undefined
    };
  }
  return where;
}

function buildPrecioWhere(filters: OmieDownloadControlFilters): Prisma.OmiePriceDownloadWhereInput {
  const where: Prisma.OmiePriceDownloadWhereInput = {};
  const tipoPrecio = getPrecioTipo(filters);
  if (tipoPrecio) {
    where.tipoPrecio = tipoPrecio;
  }
  if (filters.estado) {
    where.estado = filters.estado;
  }
  if (filters.sesion !== undefined) {
    where.sesion = filters.sesion;
  }
  if (filters.fechaDesde || filters.fechaHasta) {
    where.fechaPrograma = {
      gte: filters.fechaDesde ? parseDateOnly(filters.fechaDesde) : undefined,
      lte: filters.fechaHasta ? parseDateOnly(filters.fechaHasta) : undefined
    };
  }
  return where;
}

function buildTransaccionWhere(filters: OmieDownloadControlFilters): Prisma.OmieTransactionDownloadWhereInput {
  const where: Prisma.OmieTransactionDownloadWhereInput = {};
  if (filters.estado) {
    where.estado = filters.estado;
  }
  if (filters.fechaDesde) {
    where.fechaHasta = { gte: parseDateOnly(filters.fechaDesde) };
  }
  if (filters.fechaHasta) {
    where.fechaDesde = { lte: parseDateOnly(filters.fechaHasta) };
  }
  return where;
}

function getProgramaTipo(filters: OmieDownloadControlFilters) {
  if (filters.tipoDocumento === OmieTipoDocumento.PVD || filters.codigoOmie === "5302") {
    return OmieTipoDocumento.PVD;
  }
  if (filters.tipoDocumento === OmieTipoDocumento.PHF || filters.codigoOmie === "5608") {
    return OmieTipoDocumento.PHF;
  }
  return undefined;
}

function getPrecioTipo(filters: OmieDownloadControlFilters) {
  if (filters.tipoDocumento === OmieTipoPrecio.MD || filters.codigoOmie === "5202") {
    return OmieTipoPrecio.MD;
  }
  if (filters.tipoDocumento === OmieTipoPrecio.MI || filters.codigoOmie === "5603") {
    return OmieTipoPrecio.MI;
  }
  if (filters.tipoDocumento === OmieTipoPrecio.XBID || filters.codigoOmie === "4125") {
    return OmieTipoPrecio.XBID;
  }
  return undefined;
}

function serializeProgramaDownload(download: {
  id: string;
  tipoDocumento: OmieTipoDocumento;
  fechaPrograma: Date;
  sesion: string | null;
  version: number;
  uOfertante: string;
  fechaDescarga: Date;
  estado: OmieDownloadEstado;
  registros: number;
  hashContenido: string | null;
  nombreFichero: string | null;
  mensajeError: string | null;
  createdAt: Date;
  updatedAt: Date;
}): OmieDownloadControlRow {
  const codigoOmie = download.tipoDocumento === OmieTipoDocumento.PVD ? "5302" : "5608";
  const fechaPrograma = formatDateOnly(download.fechaPrograma);
  return {
    id: download.id,
    origen: "programas",
    modulo: "Programas",
    consulta: download.tipoDocumento,
    codigoOmie,
    descripcion:
      download.tipoDocumento === OmieTipoDocumento.PVD
        ? "Energias PVD por unidad ofertante"
        : "Programa Horario Final de la Casacion Intradiaria",
    tipoDocumento: download.tipoDocumento,
    fechaPrograma,
    fechaHasta: null,
    sesion: download.sesion,
    version: download.version,
    uOfertante: download.uOfertante,
    fechaDescarga: download.fechaDescarga.toISOString(),
    estado: download.estado,
    registros: download.registros,
    hashContenido: download.hashContenido,
    nombreFichero: download.nombreFichero,
    mensajeError: download.mensajeError,
    parametrosUtilizados:
      download.tipoDocumento === OmieTipoDocumento.PVD
        ? { UOfertante: download.uOfertante, FechaPrograma: fechaPrograma, UMedida: OMIE_ENERGIA_UMEDIDA }
        : { UOfertante: download.uOfertante, Fecha: fechaPrograma, Sesion: download.sesion, UMedida: OMIE_ENERGIA_UMEDIDA },
    tiempoEjecucionMs: estimateExecutionTime(download.createdAt, download.updatedAt),
    rawXmlDisponible: false,
    rawJsonDisponible: true,
    logDisponible: true,
    createdAt: download.createdAt.toISOString(),
    updatedAt: download.updatedAt.toISOString()
  };
}

function serializePrecioDownload(download: {
  id: string;
  tipoPrecio: OmieTipoPrecio;
  fechaPrograma: Date;
  sesion: string | null;
  version: number;
  fechaDescarga: Date;
  estado: OmieDownloadEstado;
  registros: number;
  hashContenido: string | null;
  mensajeError: string | null;
  createdAt: Date;
  updatedAt: Date;
}): OmieDownloadControlRow {
  const fechaPrograma = formatDateOnly(download.fechaPrograma);
  const meta = precioMeta(download.tipoPrecio);
  return {
    id: download.id,
    origen: "precios",
    modulo: "Precios",
    consulta: meta.consulta,
    codigoOmie: meta.codigoOmie,
    descripcion: meta.descripcion,
    tipoDocumento: download.tipoPrecio,
    fechaPrograma,
    fechaHasta: null,
    sesion: download.sesion,
    version: download.version,
    uOfertante: null,
    fechaDescarga: download.fechaDescarga.toISOString(),
    estado: download.estado,
    registros: download.registros,
    hashContenido: download.hashContenido,
    nombreFichero: null,
    mensajeError: download.mensajeError,
    parametrosUtilizados: meta.parametros(fechaPrograma, download.sesion),
    tiempoEjecucionMs: estimateExecutionTime(download.createdAt, download.updatedAt),
    rawXmlDisponible: false,
    rawJsonDisponible: true,
    logDisponible: true,
    createdAt: download.createdAt.toISOString(),
    updatedAt: download.updatedAt.toISOString()
  };
}

function serializeTransaccionDownload(download: {
  id: string;
  codigoConsulta: string;
  fechaDesde: Date;
  fechaHasta: Date;
  fechaDescarga: Date;
  estado: OmieDownloadEstado;
  registros: number;
  diasConsultados: number;
  columnas: Prisma.JsonValue | null;
  resumenEstructura: Prisma.JsonValue | null;
  hashContenido: string | null;
  nombreFichero: string | null;
  mensajeError: string | null;
  createdAt: Date;
  updatedAt: Date;
}): OmieDownloadControlRow {
  const fechaPrograma = formatDateOnly(download.fechaDesde);
  const fechaHasta = formatDateOnly(download.fechaHasta);
  return {
    id: download.id,
    origen: "transacciones",
    modulo: "Transacciones",
    consulta: "Historico",
    codigoOmie: "4121",
    descripcion: "Historico de Transacciones",
    tipoDocumento: "TRANSACCIONES",
    fechaPrograma,
    fechaHasta,
    sesion: null,
    version: null,
    uOfertante: null,
    fechaDescarga: download.fechaDescarga.toISOString(),
    estado: download.estado,
    registros: download.registros,
    hashContenido: download.hashContenido,
    nombreFichero: download.nombreFichero,
    mensajeError: download.mensajeError,
    parametrosUtilizados: {
      codigoConsulta: download.codigoConsulta,
      DiaContrato: fechaPrograma === fechaHasta ? fechaPrograma : `${fechaPrograma}..${fechaHasta}`,
      fechaDesde: fechaPrograma,
      fechaHasta,
      diasConsultados: download.diasConsultados
    },
    tiempoEjecucionMs: estimateExecutionTime(download.createdAt, download.updatedAt),
    rawXmlDisponible: false,
    rawJsonDisponible: true,
    logDisponible: true,
    createdAt: download.createdAt.toISOString(),
    updatedAt: download.updatedAt.toISOString()
  };
}

function precioMeta(tipoPrecio: OmieTipoPrecio) {
  if (tipoPrecio === OmieTipoPrecio.MD) {
    return {
      consulta: "Mercado Diario",
      codigoOmie: "5202" as const,
      descripcion: "Precios y Energias resultado de la Casacion",
      parametros: (fecha: string) => ({ FechaCasacion: fecha })
    };
  }
  if (tipoPrecio === OmieTipoPrecio.MI) {
    return {
      consulta: "Intradiario",
      codigoOmie: "5603" as const,
      descripcion: "Precios y Energias Resultado de la Casacion",
      parametros: (fecha: string, sesion: string | null) => ({ Fecha: fecha, Sesion: sesion })
    };
  }
  return {
    consulta: "XBID",
    codigoOmie: "4125" as const,
    descripcion: "Precios y energias del Mercado Continuo",
    parametros: (fecha: string) => ({ Fecha: fecha, Zona: "ES" })
  };
}

function matchesControlFilters(row: OmieDownloadControlRow, filters: OmieDownloadControlFilters) {
  if (filters.modulo && row.modulo !== filters.modulo) {
    return false;
  }
  if (filters.codigoOmie && row.codigoOmie !== filters.codigoOmie) {
    return false;
  }
  if (filters.tipoDocumento && row.tipoDocumento !== filters.tipoDocumento) {
    return false;
  }
  if (filters.sesion !== undefined && row.sesion !== filters.sesion) {
    return false;
  }
  return true;
}

function sortControlRows(left: OmieDownloadControlRow, right: OmieDownloadControlRow) {
  const byDate = right.fechaPrograma.localeCompare(left.fechaPrograma);
  if (byDate !== 0) {
    return byDate;
  }
  const byModule = left.modulo.localeCompare(right.modulo);
  if (byModule !== 0) {
    return byModule;
  }
  const byCode = left.codigoOmie.localeCompare(right.codigoOmie);
  if (byCode !== 0) {
    return byCode;
  }
  return right.updatedAt.localeCompare(left.updatedAt);
}

function buildDetail(row: OmieDownloadControlRow, options: { rawJson: Prisma.JsonValue | null }): OmieDownloadDetail {
  return {
    ...row,
    rawXml: null,
    rawJson: options.rawJson,
    log: buildLog(row)
  };
}

function buildLog(row: OmieDownloadControlRow) {
  return [
    `${row.createdAt} registro creado para ${row.modulo}/${row.consulta} (${row.codigoOmie}).`,
    `${row.fechaDescarga} fecha de descarga registrada.`,
    `${row.updatedAt} estado actual: ${row.estado}; registros: ${row.registros}.`,
    row.mensajeError ? `Error: ${row.mensajeError}` : "Sin error registrado.",
    row.rawXmlDisponible ? "XML disponible." : "XML no persistido para esta descarga.",
    row.rawJsonDisponible ? "JSON de control disponible." : "JSON no disponible."
  ];
}

function buildRequestFromRow(row: OmieDownloadControlRow): OmieDownloadExecuteRequest {
  return {
    codigoOmie: row.codigoOmie,
    fecha: row.fechaPrograma,
    fechaDesde: row.fechaPrograma,
    fechaHasta: row.fechaHasta ?? row.fechaPrograma,
    sesion: row.sesion ?? undefined
  };
}

function codigoToModulo(codigo: OmieControlCodigo): OmieControlModulo {
  if (codigo === "5302" || codigo === "5608") {
    return "Programas";
  }
  if (codigo === "5202" || codigo === "5603" || codigo === "4125") {
    return "Precios";
  }
  return "Transacciones";
}

function tipoToModulo(tipo: OmieControlTipo): OmieControlModulo {
  if (tipo === OmieTipoDocumento.PVD || tipo === OmieTipoDocumento.PHF) {
    return "Programas";
  }
  if (tipo === OmieTipoPrecio.MD || tipo === OmieTipoPrecio.MI || tipo === OmieTipoPrecio.XBID) {
    return "Precios";
  }
  return "Transacciones";
}

function parseCodigo(value: string) {
  if (value === "5302" || value === "5608" || value === "5202" || value === "5603" || value === "4125" || value === "4121") {
    return value;
  }
  throw new BadRequestException("codigoOmie debe ser 5302, 5608, 5202, 5603, 4125 o 4121.");
}

function requireFecha(value: string | undefined) {
  if (!value) {
    throw new BadRequestException("La fecha es obligatoria.");
  }
  return formatDateOnly(parseDateOnly(value));
}

function requireSesion(value: string | undefined) {
  if (!value) {
    throw new BadRequestException("La sesion es obligatoria para esta consulta OMIE.");
  }
  return normalizeOmieEnergiaSesion(value);
}

function estimateExecutionTime(createdAt: Date, updatedAt: Date) {
  const value = updatedAt.getTime() - createdAt.getTime();
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function parseDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new BadRequestException("La fecha debe tener formato YYYY-MM-DD.");
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
    throw new BadRequestException("Fecha no valida.");
  }
  return date;
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}
