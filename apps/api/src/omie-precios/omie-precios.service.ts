import { BadGatewayException, Injectable } from "@nestjs/common";
import { OmieDownloadEstado, OmieTipoPrecio, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { normalizeOmieEnergiaSesion } from "../omie-siom2/omie-energia";
import { OmieSiom2ClientService } from "../omie-siom2/omie-siom2-client.service";
import type {
  OmieConsultaEncolumnadaColumna,
  OmieConsultaEncolumnadaFila,
  OmieConsultaEncolumnadaResult
} from "../omie-siom2/omie-siom2.types";
import { PrismaService } from "../prisma/prisma.service";

const DEFAULT_VERSION = 1;
const OMIE_PRECIO_MD_CODIGO = "5202";
const OMIE_PRECIO_MI_CODIGO = "5603";
const OMIE_PRECIO_XBID_CODIGO = "4125";
const OMIE_PRECIO_RESOLUCION = "PT15M";
const OMIE_MD_QUARTER_HOURLY_START = "2025-10-01";
const DIAGNOSTICO_MI_SESIONES = ["01", "02", "03", "04", "05", "06", "07"];

type SyncOptions = {
  force?: boolean;
};

type PriceDownloadKey = {
  tipoPrecio: OmieTipoPrecio;
  fechaPrograma: Date;
  sesion: string | null;
  version: number;
};

type PrecioPeriodo = {
  periodo: number;
  clave: string;
  precioEurMWh: number;
};

export type OmiePrecioConsolidadoPeriodo = {
  fecha: string;
  periodo: number;
  clave: string;
  precioMd: number | null;
  precioMi1: number | null;
  precioMi2: number | null;
  precioMi3: number | null;
  precioXbid: number | null;
};

export type OmiePreciosResponse = {
  fecha: string;
  resolucion: typeof OMIE_PRECIO_RESOLUCION;
  ultimaDescarga: string | null;
  periodos: OmiePrecioConsolidadoPeriodo[];
  estadisticas: Record<string, { min: number | null; max: number | null; media: number | null; registros: number }>;
};

export type OmiePrecioSyncResponse = {
  message: string;
  download: OmiePriceDownloadRow;
  precios: OmiePreciosResponse;
};

export type OmiePriceDownloadRow = {
  id: string;
  tipoPrecio: OmieTipoPrecio;
  fechaPrograma: string;
  sesion: string | null;
  version: number;
  fechaDescarga: string;
  estado: OmieDownloadEstado;
  registros: number;
  hashContenido: string | null;
  mensajeError: string | null;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class OmiePreciosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly omieSiom2ClientService: OmieSiom2ClientService
  ) {}

  async sincronizarMercadoDiario(fecha: string, options: SyncOptions = {}): Promise<OmiePrecioSyncResponse> {
    return this.sincronizar({
      tipoPrecio: OmieTipoPrecio.MD,
      fecha,
      sesion: null,
      options
    });
  }

  async sincronizarMercadoIntradiario(fecha: string, sesion: string, options: SyncOptions = {}): Promise<OmiePrecioSyncResponse> {
    return this.sincronizar({
      tipoPrecio: OmieTipoPrecio.MI,
      fecha,
      sesion: normalizeOmieEnergiaSesion(sesion),
      options
    });
  }

  async sincronizarXbid(fecha: string, options: SyncOptions = {}): Promise<OmiePrecioSyncResponse> {
    return this.sincronizar({
      tipoPrecio: OmieTipoPrecio.XBID,
      fecha,
      sesion: null,
      options
    });
  }

  async obtenerPrecios(fecha: string): Promise<OmiePreciosResponse> {
    const fechaPrograma = parseDateOnly(fecha);
    const [rows, downloads] = await Promise.all([
      this.prisma.omiePrice.findMany({
        where: { fechaPrograma },
        orderBy: [{ tipoPrecio: "asc" }, { sesion: "asc" }, { periodo: "asc" }]
      }),
      this.prisma.omiePriceDownload.findMany({
        where: { fechaPrograma, estado: OmieDownloadEstado.PROCESADO },
        orderBy: { fechaDescarga: "desc" }
      })
    ]);

    const md = buildPriceMap(rows, OmieTipoPrecio.MD, null);
    const mi1 = buildPriceMap(rows, OmieTipoPrecio.MI, "01");
    const mi2 = buildPriceMap(rows, OmieTipoPrecio.MI, "02");
    const mi3 = buildPriceMap(rows, OmieTipoPrecio.MI, "03");
    const xbid = buildPriceMap(rows, OmieTipoPrecio.XBID, null);
    const formattedFecha = formatSpanishDate(fechaPrograma);
    const periodos = Array.from({ length: 96 }, (_, index) => {
      const periodo = index + 1;
      return {
        fecha: formattedFecha,
        periodo,
        clave: buildClave(fecha, periodo),
        precioMd: md.get(periodo) ?? null,
        precioMi1: mi1.get(periodo) ?? null,
        precioMi2: mi2.get(periodo) ?? null,
        precioMi3: mi3.get(periodo) ?? null,
        precioXbid: xbid.get(periodo) ?? null
      };
    });

    return {
      fecha,
      resolucion: OMIE_PRECIO_RESOLUCION,
      ultimaDescarga: downloads[0]?.fechaDescarga.toISOString() ?? null,
      periodos,
      estadisticas: {
        precioMd: summarizePrices(periodos.map((periodo) => periodo.precioMd)),
        precioMi1: summarizePrices(periodos.map((periodo) => periodo.precioMi1)),
        precioMi2: summarizePrices(periodos.map((periodo) => periodo.precioMi2)),
        precioMi3: summarizePrices(periodos.map((periodo) => periodo.precioMi3)),
        precioXbid: summarizePrices(periodos.map((periodo) => periodo.precioXbid))
      }
    };
  }

  async diagnosticar(fecha = formatDateOnly(new Date()), sesion = "01") {
    const fechaNormalizada = formatDateOnly(parseDateOnly(fecha));
    const sesionNormalizada = normalizeOmieEnergiaSesion(sesion);
    const md = await this.diagnosticarConsulta(OMIE_PRECIO_MD_CODIGO, {
      FechaCasacion: fechaNormalizada
    });
    const miSesiones = [];
    for (const candidata of DIAGNOSTICO_MI_SESIONES) {
      miSesiones.push(
        await this.diagnosticarConsulta(OMIE_PRECIO_MI_CODIGO, {
          Fecha: fechaNormalizada,
          Sesion: candidata
        })
      );
    }
    const xbid = await this.diagnosticarConsulta(OMIE_PRECIO_XBID_CODIGO, {
      Fecha: fechaNormalizada,
      Zona: "ES"
    });

    return {
      fecha: fechaNormalizada,
      sesion: sesionNormalizada,
      consultas: {
        mercadoDiario: md,
        mercadosIntradiarios: miSesiones,
        mercadoContinuo: xbid
      },
      sesionesDisponibles: miSesiones.filter((item) => item.numeroRegistros > 0).map((item) => item.parametrosUsados.Sesion)
    };
  }

  private async sincronizar(params: {
    tipoPrecio: OmieTipoPrecio;
    fecha: string;
    sesion: string | null;
    options: SyncOptions;
  }): Promise<OmiePrecioSyncResponse> {
    const fechaPrograma = parseDateOnly(params.fecha);
    const key: PriceDownloadKey = {
      tipoPrecio: params.tipoPrecio,
      fechaPrograma,
      sesion: params.sesion,
      version: DEFAULT_VERSION
    };

    const existingProcessed = await this.findLatestDownload(key, OmieDownloadEstado.PROCESADO);
    if (existingProcessed && !params.options.force) {
      return {
        message: "Ya existe descarga procesada",
        download: serializePriceDownload(existingProcessed),
        precios: await this.obtenerPrecios(params.fecha)
      };
    }

    const download = await this.prepareDownload(key);

    try {
      const result = await this.ejecutarConsulta(key);
      const fechaDescarga = new Date();
      const periodos = mapPrecioPeriodos(params.fecha, key.tipoPrecio, result);
      const hashContenido = createHash("sha256").update(result.xml || JSON.stringify(result.filas ?? [])).digest("hex");

      const processedDownload = await this.prisma.$transaction(async (tx) => {
        await tx.omiePrice.deleteMany({ where: buildPriceWhere(key) });
        if (periodos.length > 0) {
          await tx.omiePrice.createMany({
            data: periodos.map((periodo) => ({
              tipoPrecio: key.tipoPrecio,
              fechaPrograma: key.fechaPrograma,
              sesion: key.sesion,
              periodo: periodo.periodo,
              clave: periodo.clave,
              precioEurMWh: new Prisma.Decimal(periodo.precioEurMWh.toFixed(6)),
              fechaDescarga,
              downloadId: download.id
            }))
          });
        }

        return tx.omiePriceDownload.update({
          where: { id: download.id },
          data: {
            estado: OmieDownloadEstado.PROCESADO,
            registros: periodos.length,
            hashContenido,
            mensajeError: null,
            fechaDescarga
          }
        });
      });

      return {
        message: "Descarga procesada",
        download: serializePriceDownload(processedDownload),
        precios: await this.obtenerPrecios(params.fecha)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.omiePriceDownload.update({
        where: { id: download.id },
        data: {
          estado: OmieDownloadEstado.ERROR,
          mensajeError: message.slice(0, 4000)
        }
      });
      throw new BadGatewayException(message || "Error sincronizando precios OMIE.");
    }
  }

  private async ejecutarConsulta(key: PriceDownloadKey): Promise<OmieConsultaEncolumnadaResult> {
    if (key.tipoPrecio === OmieTipoPrecio.MD) {
      return this.omieSiom2ClientService.ejecutarConsultaEncolumnada(OMIE_PRECIO_MD_CODIGO, {
        FechaCasacion: formatDateOnly(key.fechaPrograma)
      });
    }
    if (key.tipoPrecio === OmieTipoPrecio.MI) {
      return this.omieSiom2ClientService.ejecutarConsultaEncolumnada(OMIE_PRECIO_MI_CODIGO, {
        Fecha: formatDateOnly(key.fechaPrograma),
        Sesion: key.sesion ?? "01"
      });
    }
    return this.omieSiom2ClientService.ejecutarConsultaEncolumnada(OMIE_PRECIO_XBID_CODIGO, {
      Fecha: formatDateOnly(key.fechaPrograma),
      Zona: "ES"
    });
  }

  private async diagnosticarConsulta(codigoConsulta: string, parametros: Record<string, string>) {
    const result = await this.omieSiom2ClientService.ejecutarConsultaEncolumnada(codigoConsulta, parametros);
    return {
      codigoConsulta,
      parametrosUsados: parametros,
      estructuraXml: {
        serviceName: result.serviceName,
        statusCode: result.statusCode,
        bytes: result.xml.length,
        etiquetasDetectadas: extractXmlTagNames(result.xml).slice(0, 80)
      },
      estructuraJson: summarizeJsonStructure(result.json),
      columnasEncontradas: result.columnas ?? [],
      primerasFilas: (result.filas ?? []).slice(0, 5),
      numeroRegistros: result.filas?.length ?? 0,
      resolucionDetectada: detectResolution(result.filas ?? [], result.columnas ?? [])
    };
  }

  private async prepareDownload(key: PriceDownloadKey) {
    const current = await this.findLatestDownload(key);
    const fechaDescarga = new Date();
    if (current) {
      return this.prisma.omiePriceDownload.update({
        where: { id: current.id },
        data: {
          estado: OmieDownloadEstado.DESCARGANDO,
          fechaDescarga,
          registros: 0,
          hashContenido: null,
          mensajeError: null
        }
      });
    }

    return this.prisma.omiePriceDownload.create({
      data: {
        ...key,
        fechaDescarga,
        estado: OmieDownloadEstado.DESCARGANDO
      }
    });
  }

  private async findLatestDownload(key: PriceDownloadKey, estado?: OmieDownloadEstado) {
    return this.prisma.omiePriceDownload.findFirst({
      where: {
        ...buildDownloadWhere(key),
        estado
      },
      orderBy: { updatedAt: "desc" }
    });
  }
}

function buildDownloadWhere(key: PriceDownloadKey): Prisma.OmiePriceDownloadWhereInput {
  return {
    tipoPrecio: key.tipoPrecio,
    fechaPrograma: key.fechaPrograma,
    sesion: key.sesion,
    version: key.version
  };
}

function buildPriceWhere(key: PriceDownloadKey): Prisma.OmiePriceWhereInput {
  return {
    tipoPrecio: key.tipoPrecio,
    fechaPrograma: key.fechaPrograma,
    sesion: key.sesion
  };
}

function mapPrecioPeriodos(fecha: string, tipoPrecio: OmieTipoPrecio, result: OmieConsultaEncolumnadaResult): PrecioPeriodo[] {
  const filas = result.filas ?? [];
  if (filas.length === 0) {
    return [];
  }

  const direct = mapDirectPriceRows(fecha, filas);
  const pivot = mapPivotPriceRows(fecha, filas);
  const periodos = direct.length > 0 ? direct : pivot;
  if (periodos.length === 0) {
    if (filas.some(hasPriceColumn)) {
      return [];
    }
    const columnas = result.columnas?.map((column) => column.nombre).join(", ") || Object.keys(filas[0] ?? {}).join(", ");
    throw new Error(`No se ha podido identificar el campo de precio para ${tipoPrecio}. Columnas recibidas: ${columnas}`);
  }

  const unique = new Map<number, PrecioPeriodo>();
  for (const periodo of periodos) {
    unique.set(periodo.periodo, periodo);
  }
  const sorted = [...unique.values()].sort((left, right) => left.periodo - right.periodo);
  return shouldExpandHourlyMdPrices(fecha, tipoPrecio, sorted) ? expandHourlyMdPrices(fecha, sorted) : sorted;
}

function mapDirectPriceRows(fecha: string, filas: OmieConsultaEncolumnadaFila[]): PrecioPeriodo[] {
  const periodos: PrecioPeriodo[] = [];
  for (const fila of filas) {
    const periodo = parsePeriodo(readOptionalCell(fila, ["Periodo", "periodo", "period", "Hora", "hora"]));
    const precio = parsePrice(readPriceCell(fila));
    if (periodo !== undefined && precio !== undefined) {
      periodos.push({
        periodo,
        clave: buildClave(fecha, periodo),
        precioEurMWh: precio
      });
    }
  }
  return periodos;
}

function mapPivotPriceRows(fecha: string, filas: OmieConsultaEncolumnadaFila[]): PrecioPeriodo[] {
  const periodos: PrecioPeriodo[] = [];
  for (const fila of filas) {
    for (const [key, value] of Object.entries(fila)) {
      if (!looksLikePriceColumn(key)) {
        continue;
      }
      const periodo = periodFromQuarterColumn(key);
      const precio = parsePrice(value);
      if (periodo !== undefined && precio !== undefined) {
        periodos.push({
          periodo,
          clave: buildClave(fecha, periodo),
          precioEurMWh: precio
        });
      }
    }
  }
  return periodos;
}

function readPriceCell(fila: OmieConsultaEncolumnadaFila) {
  const direct = readOptionalCell(fila, ["PrecioES", "precioES", "Precio", "precio", "Prc", "prc", "Pmp", "pmp", "Price", "price", "PrecioMedio", "precioMedio"]);
  if (direct !== undefined) {
    return direct;
  }
  const entry = Object.entries(fila).find(([key]) => looksLikePriceColumn(key) && !looksLikePortugalPriceColumn(key));
  return entry?.[1];
}

function hasPriceColumn(fila: OmieConsultaEncolumnadaFila) {
  return Object.keys(fila).some((key) => looksLikePriceColumn(key) && !looksLikePortugalPriceColumn(key));
}

function looksLikePriceColumn(key: string) {
  const normalized = normalizeColumnName(key);
  if (normalized.includes("energia") || normalized.includes("energy") || normalized.includes("volumen") || normalized.includes("volume") || normalized === "qty") {
    return false;
  }
  return normalized.includes("precio") || normalized.includes("price") || normalized === "prc" || normalized === "pmp" || /^periodoh\d{2}q[1-4]$/.test(normalized);
}

function looksLikePortugalPriceColumn(key: string) {
  const normalized = normalizeColumnName(key);
  return normalized.includes("preciopt") || normalized.endsWith("pt");
}

function periodFromQuarterColumn(key: string) {
  const match = /h(\d{1,2})q([1-4])/i.exec(key);
  if (!match) {
    return undefined;
  }
  const hour = Number(match[1]);
  const quarter = Number(match[2]);
  const periodo = (hour - 1) * 4 + quarter;
  return Number.isSafeInteger(periodo) && periodo > 0 ? periodo : undefined;
}

function readOptionalCell(fila: OmieConsultaEncolumnadaFila, aliases: string[]) {
  const aliasSet = new Set(aliases.map(normalizeColumnName));
  const entry = Object.entries(fila).find(([key]) => aliasSet.has(normalizeColumnName(key)));
  return entry?.[1]?.trim() || undefined;
}

function parsePeriodo(value?: string) {
  if (!value) {
    return undefined;
  }
  const parsed = Number(normalizeNumberText(value));
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return undefined;
  }
  return parsed;
}

function parsePrice(value?: string) {
  if (!value) {
    return undefined;
  }
  const parsed = Number(normalizeNumberText(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeNumberText(value: string) {
  const compact = value.trim().replace(/\s+/g, "");
  if (compact.includes(",") && compact.includes(".")) {
    return compact.lastIndexOf(",") > compact.lastIndexOf(".") ? compact.replace(/\./g, "").replace(",", ".") : compact.replace(/,/g, "");
  }
  return compact.replace(",", ".");
}

function normalizeColumnName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function buildPriceMap(
  rows: Array<{ tipoPrecio: OmieTipoPrecio; sesion: string | null; periodo: number; precioEurMWh: Prisma.Decimal }>,
  tipoPrecio: OmieTipoPrecio,
  sesion: string | null
) {
  const map = new Map<number, number>();
  for (const row of rows) {
    if (row.tipoPrecio === tipoPrecio && row.sesion === sesion) {
      map.set(row.periodo, Number(row.precioEurMWh.toString()));
    }
  }
  return map;
}

function summarizePrices(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (valid.length === 0) {
    return { min: null, max: null, media: null, registros: 0 };
  }
  const sum = valid.reduce((total, value) => total + value, 0);
  return {
    min: roundPrice(Math.min(...valid)),
    max: roundPrice(Math.max(...valid)),
    media: roundPrice(sum / valid.length),
    registros: valid.length
  };
}

function detectResolution(filas: OmieConsultaEncolumnadaFila[], columnas: OmieConsultaEncolumnadaColumna[]) {
  const periodos = filas.map((fila) => parsePeriodo(readOptionalCell(fila, ["Periodo", "periodo", "Hora", "hora"]))).filter((value): value is number => value !== undefined);
  const maxPeriodo = Math.max(...periodos, 0);
  const hasQuarterColumns = columnas.some((column) => /h\d{1,2}q[1-4]/i.test(column.nombre));
  if (maxPeriodo >= 90 || hasQuarterColumns) {
    return "PT15M";
  }
  if (maxPeriodo >= 20) {
    return "PT1H";
  }
  return "DESCONOCIDA";
}

function extractXmlTagNames(xml: string) {
  const tags = new Set<string>();
  const regex = /<\/?([A-Za-z0-9_:-]+)(?:\s|>|\/)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    tags.add(match[1]);
  }
  return [...tags];
}

function summarizeJsonStructure(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return typeof value;
  }
  if (Array.isArray(value)) {
    return {
      tipo: "array",
      longitud: value.length,
      muestra: value.length > 0 ? summarizeJsonStructure(value[0], depth + 1) : null
    };
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 40)
        .map(([key, nested]) => [key, summarizeJsonStructure(nested, depth + 1)])
    );
  }
  return typeof value;
}

function serializePriceDownload(download: {
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
}): OmiePriceDownloadRow {
  return {
    id: download.id,
    tipoPrecio: download.tipoPrecio,
    fechaPrograma: formatDateOnly(download.fechaPrograma),
    sesion: download.sesion,
    version: download.version,
    fechaDescarga: download.fechaDescarga.toISOString(),
    estado: download.estado,
    registros: download.registros,
    hashContenido: download.hashContenido,
    mensajeError: download.mensajeError,
    createdAt: download.createdAt.toISOString(),
    updatedAt: download.updatedAt.toISOString()
  };
}

function parseDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new Error("La fecha debe tener formato YYYY-MM-DD.");
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
    throw new Error("Fecha no valida.");
  }
  return date;
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatSpanishDate(value: Date) {
  return `${String(value.getUTCDate()).padStart(2, "0")}/${String(value.getUTCMonth() + 1).padStart(2, "0")}/${value.getUTCFullYear()}`;
}

function buildClave(fecha: string, periodo: number) {
  return `${fecha.replace(/-/g, "")}${String(periodo).padStart(2, "0")}`;
}

function roundPrice(value: number) {
  return Number(value.toFixed(6));
}

function shouldExpandHourlyMdPrices(fecha: string, tipoPrecio: OmieTipoPrecio, periodos: PrecioPeriodo[]) {
  return (
    tipoPrecio === OmieTipoPrecio.MD &&
    fecha < OMIE_MD_QUARTER_HOURLY_START &&
    periodos.length === 24 &&
    periodos.every((periodo, index) => periodo.periodo === index + 1)
  );
}

function expandHourlyMdPrices(fecha: string, hourlyPrices: PrecioPeriodo[]) {
  const quarterHourlyPrices: PrecioPeriodo[] = [];
  for (const hourlyPrice of hourlyPrices) {
    const firstQuarter = (hourlyPrice.periodo - 1) * 4 + 1;
    for (let offset = 0; offset < 4; offset += 1) {
      const periodo = firstQuarter + offset;
      quarterHourlyPrices.push({
        periodo,
        clave: buildClave(fecha, periodo),
        precioEurMWh: hourlyPrice.precioEurMWh
      });
    }
  }
  return quarterHourlyPrices;
}
