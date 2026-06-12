import { BadGatewayException, Injectable } from "@nestjs/common";
import { OmieDownloadEstado, OmieTipoDocumento, OmieTipoPrecio, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  OMIE_ENERGIA_PHF_CODIGO,
  OMIE_ENERGIA_PVD_CODIGO,
  OMIE_ENERGIA_RESOLUCION,
  OMIE_ENERGIA_STROM_UOFERTANTE,
  OMIE_ENERGIA_UMEDIDA,
  normalizeOmieEnergiaSesion
} from "../omie-siom2/omie-energia";
import { OmieSiom2ClientService } from "../omie-siom2/omie-siom2-client.service";
import type { OmieConsultaEncolumnadaFila, OmieConsultaEncolumnadaResult } from "../omie-siom2/omie-siom2.types";

const DEFAULT_VERSION = 1;

type SyncOptions = {
  force?: boolean;
};

type DownloadKey = {
  tipoDocumento: OmieTipoDocumento;
  fechaPrograma: Date;
  sesion: string | null;
  version: number;
  uOfertante: string;
};

type ProgramaPeriodo = {
  fecha: string;
  periodo: number;
  descripcionPeriodo: string;
  clave: string;
  energiaMWh: number;
};

export type OmieProgramaResponse = {
  fecha: string;
  tipoPrograma: OmieTipoDocumento;
  sesion: string | null;
  uOfertante: string;
  resolucion: typeof OMIE_ENERGIA_RESOLUCION;
  totalEnergiaMWh: number;
  ultimaDescarga: string | null;
  periodos: ProgramaPeriodo[];
};

export type OmieProgramaSyncResponse = {
  message: string;
  download: OmieDownloadControlRow;
  programa: OmieProgramaResponse;
};

export type OmieDownloadControlFilters = {
  fechaDesde?: string;
  fechaHasta?: string;
  tipoDocumento?: OmieTipoDocumento | OmieTipoPrecio;
  estado?: OmieDownloadEstado;
  sesion?: string;
};

export type OmieDownloadControlRow = {
  id: string;
  tipoDocumento: OmieTipoDocumento | OmieTipoPrecio;
  fechaPrograma: string;
  sesion: string | null;
  version: number;
  uOfertante: string | null;
  fechaDescarga: string;
  estado: OmieDownloadEstado;
  registros: number;
  hashContenido: string | null;
  nombreFichero: string | null;
  mensajeError: string | null;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class OmieProgramasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly omieSiom2ClientService: OmieSiom2ClientService
  ) {}

  async sincronizarPvd(fecha: string, options: SyncOptions = {}): Promise<OmieProgramaSyncResponse> {
    return this.sincronizar({
      tipoDocumento: OmieTipoDocumento.PVD,
      fecha,
      sesion: null,
      options
    });
  }

  async sincronizarPhf(fecha: string, sesion: string, options: SyncOptions = {}): Promise<OmieProgramaSyncResponse> {
    return this.sincronizar({
      tipoDocumento: OmieTipoDocumento.PHF,
      fecha,
      sesion: normalizeOmieEnergiaSesion(sesion),
      options
    });
  }

  async obtenerProgramaMercadoDiario(fecha: string): Promise<OmieProgramaResponse> {
    return this.obtenerPrograma({
      tipoDocumento: OmieTipoDocumento.PVD,
      fecha,
      sesion: null
    });
  }

  async obtenerProgramaIntradiario(fecha: string, sesion: string): Promise<OmieProgramaResponse> {
    return this.obtenerPrograma({
      tipoDocumento: OmieTipoDocumento.PHF,
      fecha,
      sesion: normalizeOmieEnergiaSesion(sesion)
    });
  }

  async obtenerProgramaEvolucion(fecha: string) {
    const fechaPrograma = parseDateOnly(fecha);
    const pvd = await this.obtenerProgramaMercadoDiario(fecha);
    const sesiones = await this.prisma.omiePrograma.findMany({
      where: {
        tipoPrograma: OmieTipoDocumento.PHF,
        fechaPrograma,
        version: DEFAULT_VERSION,
        uOfertante: OMIE_ENERGIA_STROM_UOFERTANTE
      },
      orderBy: [{ sesion: "asc" }, { periodo: "asc" }]
    });
    const sesionesDisponibles = [...new Set(sesiones.map((row) => row.sesion).filter((sesion): sesion is string => Boolean(sesion)))];
    const programas = await Promise.all(sesionesDisponibles.map((sesion) => this.obtenerProgramaIntradiario(fecha, sesion)));
    const diferencias = buildDiferencias([pvd, ...programas]);

    return {
      fecha,
      resolucion: OMIE_ENERGIA_RESOLUCION,
      uOfertante: OMIE_ENERGIA_STROM_UOFERTANTE,
      pvd,
      phf: programas,
      sesiones: programas,
      diferencias,
      periodos: buildEvolucionPeriodos(pvd, programas, diferencias)
    };
  }

  async obtenerControlDescargas(filters: OmieDownloadControlFilters = {}): Promise<OmieDownloadControlRow[]> {
    const where: Prisma.OmieDownloadWhereInput = {};
    if (filters.tipoDocumento && isProgramaDocumento(filters.tipoDocumento)) {
      where.tipoDocumento = filters.tipoDocumento;
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

    const shouldQueryProgramas = !filters.tipoDocumento || isProgramaDocumento(filters.tipoDocumento);
    const shouldQueryPrecios = !filters.tipoDocumento || isPrecioDocumento(filters.tipoDocumento);
    const [downloads, priceDownloads] = await Promise.all([
      shouldQueryProgramas
        ? this.prisma.omieDownload.findMany({
            where,
            orderBy: [{ fechaPrograma: "desc" }, { tipoDocumento: "asc" }, { sesion: "asc" }, { updatedAt: "desc" }],
            take: 500
          })
        : Promise.resolve([]),
      shouldQueryPrecios
        ? this.prisma.omiePriceDownload.findMany({
            where: buildPriceDownloadControlWhere(filters),
            orderBy: [{ fechaPrograma: "desc" }, { tipoPrecio: "asc" }, { sesion: "asc" }, { updatedAt: "desc" }],
            take: 500
          })
        : Promise.resolve([])
    ]);

    return [...downloads.map(serializeDownload), ...priceDownloads.map(serializePriceDownload)]
      .sort((left, right) => {
        const byDate = right.fechaPrograma.localeCompare(left.fechaPrograma);
        if (byDate !== 0) {
          return byDate;
        }
        const byType = left.tipoDocumento.localeCompare(right.tipoDocumento);
        if (byType !== 0) {
          return byType;
        }
        return right.updatedAt.localeCompare(left.updatedAt);
      })
      .slice(0, 500);
  }

  private async sincronizar(params: {
    tipoDocumento: OmieTipoDocumento;
    fecha: string;
    sesion: string | null;
    options: SyncOptions;
  }): Promise<OmieProgramaSyncResponse> {
    const fechaPrograma = parseDateOnly(params.fecha);
    const key: DownloadKey = {
      tipoDocumento: params.tipoDocumento,
      fechaPrograma,
      sesion: params.sesion,
      version: DEFAULT_VERSION,
      uOfertante: OMIE_ENERGIA_STROM_UOFERTANTE
    };

    const existingProcessed = await this.findLatestDownload(key, OmieDownloadEstado.PROCESADO);
    if (existingProcessed && !params.options.force) {
      return {
        message: "Ya existe descarga procesada",
        download: serializeDownload(existingProcessed),
        programa: await this.obtenerProgramaByKey(key)
      };
    }

    const download = await this.prepareDownload(key);

    try {
      const result = await this.ejecutarConsulta(key);
      const fechaDescarga = new Date();
      const periodos = mapProgramPeriodos(params.fecha, result);
      const hashContenido = createHash("sha256").update(result.xml || JSON.stringify(result.filas ?? [])).digest("hex");
      const nombreFichero = buildNombreFichero(key);

      const processedDownload = await this.prisma.$transaction(async (tx) => {
        await tx.omiePrograma.deleteMany({ where: buildProgramaWhere(key) });
        if (periodos.length > 0) {
          await tx.omiePrograma.createMany({
            data: periodos.map((periodo) => ({
              tipoPrograma: key.tipoDocumento,
              fechaPrograma: key.fechaPrograma,
              sesion: key.sesion,
              version: key.version,
              uOfertante: key.uOfertante,
              periodo: periodo.periodo,
              descripcionPeriodo: periodo.descripcionPeriodo,
              clave: periodo.clave,
              energiaMWh: new Prisma.Decimal(periodo.energiaMWh.toFixed(6)),
              fechaDescarga,
              downloadId: download.id
            }))
          });
        }

        return tx.omieDownload.update({
          where: { id: download.id },
          data: {
            estado: OmieDownloadEstado.PROCESADO,
            registros: periodos.length,
            hashContenido,
            nombreFichero,
            mensajeError: null,
            fechaDescarga
          }
        });
      });

      return {
        message: "Descarga procesada",
        download: serializeDownload(processedDownload),
        programa: buildProgramaResponseFromPeriodos(key, params.fecha, periodos, processedDownload.fechaDescarga)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.omieDownload.update({
        where: { id: download.id },
        data: {
          estado: OmieDownloadEstado.ERROR,
          mensajeError: message.slice(0, 4000)
        }
      });
      throw new BadGatewayException(message || "Error sincronizando programa OMIE.");
    }
  }

  private async ejecutarConsulta(key: DownloadKey): Promise<OmieConsultaEncolumnadaResult> {
    if (key.tipoDocumento === OmieTipoDocumento.PVD) {
      return this.omieSiom2ClientService.ejecutarConsultaEncolumnada(OMIE_ENERGIA_PVD_CODIGO, {
        UOfertante: key.uOfertante,
        FechaPrograma: formatDateOnly(key.fechaPrograma),
        UMedida: OMIE_ENERGIA_UMEDIDA
      });
    }

    return this.omieSiom2ClientService.ejecutarConsultaEncolumnada(OMIE_ENERGIA_PHF_CODIGO, {
      UOfertante: key.uOfertante,
      Fecha: formatDateOnly(key.fechaPrograma),
      Sesion: key.sesion ?? "01",
      UMedida: OMIE_ENERGIA_UMEDIDA
    });
  }

  private async obtenerPrograma(params: { tipoDocumento: OmieTipoDocumento; fecha: string; sesion: string | null }) {
    return this.obtenerProgramaByKey({
      tipoDocumento: params.tipoDocumento,
      fechaPrograma: parseDateOnly(params.fecha),
      sesion: params.sesion,
      version: DEFAULT_VERSION,
      uOfertante: OMIE_ENERGIA_STROM_UOFERTANTE
    });
  }

  private async obtenerProgramaByKey(key: DownloadKey): Promise<OmieProgramaResponse> {
    const [rows, download] = await Promise.all([
      this.prisma.omiePrograma.findMany({
        where: buildProgramaWhere(key),
        orderBy: { periodo: "asc" }
      }),
      this.findLatestDownload(key, OmieDownloadEstado.PROCESADO)
    ]);

    return buildProgramaResponseFromPeriodos(
      key,
      formatDateOnly(key.fechaPrograma),
      rows.map((row) => ({
        fecha: formatSpanishDate(key.fechaPrograma),
        periodo: row.periodo,
        descripcionPeriodo: row.descripcionPeriodo,
        clave: row.clave,
        energiaMWh: decimalToNumber(row.energiaMWh)
      })),
      download?.fechaDescarga ?? null
    );
  }

  private async prepareDownload(key: DownloadKey) {
    const current = await this.findLatestDownload(key);
    const fechaDescarga = new Date();
    if (current) {
      return this.prisma.omieDownload.update({
        where: { id: current.id },
        data: {
          estado: OmieDownloadEstado.DESCARGANDO,
          fechaDescarga,
          registros: 0,
          hashContenido: null,
          nombreFichero: null,
          mensajeError: null
        }
      });
    }

    return this.prisma.omieDownload.create({
      data: {
        ...key,
        fechaDescarga,
        estado: OmieDownloadEstado.DESCARGANDO
      }
    });
  }

  private async findLatestDownload(key: DownloadKey, estado?: OmieDownloadEstado) {
    return this.prisma.omieDownload.findFirst({
      where: {
        ...buildDownloadWhere(key),
        estado
      },
      orderBy: { updatedAt: "desc" }
    });
  }
}

function buildDownloadWhere(key: DownloadKey): Prisma.OmieDownloadWhereInput {
  return {
    tipoDocumento: key.tipoDocumento,
    fechaPrograma: key.fechaPrograma,
    sesion: key.sesion,
    version: key.version,
    uOfertante: key.uOfertante
  };
}

function buildProgramaWhere(key: DownloadKey): Prisma.OmieProgramaWhereInput {
  return {
    tipoPrograma: key.tipoDocumento,
    fechaPrograma: key.fechaPrograma,
    sesion: key.sesion,
    version: key.version,
    uOfertante: key.uOfertante
  };
}

function buildPriceDownloadControlWhere(filters: OmieDownloadControlFilters): Prisma.OmiePriceDownloadWhereInput {
  const where: Prisma.OmiePriceDownloadWhereInput = {};
  if (filters.tipoDocumento && isPrecioDocumento(filters.tipoDocumento)) {
    where.tipoPrecio = filters.tipoDocumento;
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

function isProgramaDocumento(value: OmieTipoDocumento | OmieTipoPrecio): value is OmieTipoDocumento {
  return value === OmieTipoDocumento.PVD || value === OmieTipoDocumento.PHF;
}

function isPrecioDocumento(value: OmieTipoDocumento | OmieTipoPrecio): value is OmieTipoPrecio {
  return value === OmieTipoPrecio.MD || value === OmieTipoPrecio.MI || value === OmieTipoPrecio.XBID;
}

function mapProgramPeriodos(fecha: string, result: OmieConsultaEncolumnadaResult): ProgramaPeriodo[] {
  return (result.filas ?? [])
    .map((fila, index) => {
      const periodo = parsePeriodo(readRequiredCell(fila, ["Periodo"], index));
      return {
        fecha: formatSpanishDate(parseDateOnly(fecha)),
        periodo,
        descripcionPeriodo: readOptionalCell(fila, ["Descripcion"]) ?? buildDescripcionPeriodo(periodo),
        clave: buildClave(fecha, periodo),
        energiaMWh: parseEnergy(readRequiredCell(fila, ["Energia"], index))
      };
    })
    .sort((left, right) => left.periodo - right.periodo);
}

function readRequiredCell(fila: OmieConsultaEncolumnadaFila, aliases: string[], rowIndex: number) {
  const value = readOptionalCell(fila, aliases);
  if (!value) {
    throw new Error(`La fila OMIE ${rowIndex + 1} no contiene valor para ${aliases.join("/")}.`);
  }
  return value;
}

function readOptionalCell(fila: OmieConsultaEncolumnadaFila, aliases: string[]) {
  const aliasSet = new Set(aliases.map(normalizeColumnName));
  const entry = Object.entries(fila).find(([key]) => aliasSet.has(normalizeColumnName(key)));
  return entry?.[1]?.trim() || undefined;
}

function parsePeriodo(value: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Periodo OMIE no valido: ${value}`);
  }
  return parsed;
}

function parseEnergy(value: string) {
  const normalized = normalizeNumberText(value);
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Energia OMIE no valida: ${value}`);
  }
  return parsed;
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
    .toLowerCase();
}

function buildClave(fecha: string, periodo: number) {
  return `${fecha.replace(/-/g, "")}${String(periodo).padStart(2, "0")}`;
}

function buildDescripcionPeriodo(periodo: number) {
  const hour = Math.floor((periodo - 1) / 4) + 1;
  const quarter = ((periodo - 1) % 4) + 1;
  return `H${String(hour).padStart(2, "0")}Q${quarter}`;
}

function buildNombreFichero(key: DownloadKey) {
  const sessionPart = key.sesion ? `_S${key.sesion}` : "";
  return `${key.tipoDocumento}_${key.uOfertante}_${formatDateOnly(key.fechaPrograma)}${sessionPart}_v${key.version}.xml`;
}

function buildProgramaResponseFromPeriodos(
  key: DownloadKey,
  fecha: string,
  periodos: ProgramaPeriodo[],
  ultimaDescarga: Date | null
): OmieProgramaResponse {
  return {
    fecha,
    tipoPrograma: key.tipoDocumento,
    sesion: key.sesion,
    uOfertante: key.uOfertante,
    resolucion: OMIE_ENERGIA_RESOLUCION,
    totalEnergiaMWh: roundEnergy(periodos.reduce((sum, periodo) => sum + periodo.energiaMWh, 0)),
    ultimaDescarga: ultimaDescarga?.toISOString() ?? null,
    periodos
  };
}

function buildDiferencias(programas: OmieProgramaResponse[]) {
  const diferencias = [];
  for (let index = 1; index < programas.length; index += 1) {
    const desde = programas[index - 1];
    const hasta = programas[index];
    const desdeMap = new Map(desde.periodos.map((periodo) => [periodo.periodo, periodo.energiaMWh]));
    const hastaMap = new Map(hasta.periodos.map((periodo) => [periodo.periodo, periodo.energiaMWh]));
    const periodos = [...new Set([...desdeMap.keys(), ...hastaMap.keys()])].sort((left, right) => left - right);
    diferencias.push({
      desde: desde.sesion ? `PHF-${desde.sesion}` : desde.tipoPrograma,
      hasta: hasta.sesion ? `PHF-${hasta.sesion}` : hasta.tipoPrograma,
      periodos: periodos.map((periodo) => {
        const energiaDesde = desdeMap.get(periodo) ?? null;
        const energiaHasta = hastaMap.get(periodo) ?? null;
        return {
          periodo,
          energiaDesde,
          energiaHasta,
          diferencia: energiaDesde === null || energiaHasta === null ? null : roundEnergy(energiaHasta - energiaDesde)
        };
      })
    });
  }
  return diferencias;
}

function buildEvolucionPeriodos(pvd: OmieProgramaResponse, sesiones: OmieProgramaResponse[], diferencias: ReturnType<typeof buildDiferencias>) {
  const pvdPeriodos = new Map(pvd.periodos.map((periodo) => [periodo.periodo, periodo]));
  const pvdMap = new Map(pvd.periodos.map((periodo) => [periodo.periodo, periodo.energiaMWh]));
  const sessionPeriodos = new Map(sesiones.map((programa) => [programa.sesion ?? "", new Map(programa.periodos.map((periodo) => [periodo.periodo, periodo]))]));
  const sessionMaps = new Map(sesiones.map((programa) => [programa.sesion ?? "", new Map(programa.periodos.map((periodo) => [periodo.periodo, periodo.energiaMWh]))]));
  const diffMaps = new Map(diferencias.map((serie) => [`${serie.desde}->${serie.hasta}`, new Map(serie.periodos.map((periodo) => [periodo.periodo, periodo.diferencia]))]));
  const periodos = new Set<number>(pvdMap.keys());
  for (const map of sessionMaps.values()) {
    for (const periodo of map.keys()) {
      periodos.add(periodo);
    }
  }

  return [...periodos].sort((left, right) => left - right).map((periodo) => {
    const basePeriodo =
      pvdPeriodos.get(periodo) ??
      [...sessionPeriodos.values()].map((map) => map.get(periodo)).find((item): item is ProgramaPeriodo => Boolean(item));
    const pvdEnergia = pvdMap.get(periodo) ?? null;
    return {
      fecha: basePeriodo?.fecha ?? formatSpanishDate(parseDateOnly(pvd.fecha)),
      periodo,
      descripcionPeriodo: basePeriodo?.descripcionPeriodo ?? buildDescripcionPeriodo(periodo),
      clave: basePeriodo?.clave ?? buildClave(pvd.fecha, periodo),
      energiaMWh: pvdEnergia ?? 0,
      pvd: pvdEnergia,
      sesiones: Object.fromEntries([...sessionMaps.entries()].map(([sesion, map]) => [sesion, map.get(periodo) ?? null])),
      diferencias: Object.fromEntries([...diffMaps.entries()].map(([label, map]) => [label, map.get(periodo) ?? null]))
    };
  });
}

function serializeDownload(download: {
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
  return {
    id: download.id,
    tipoDocumento: download.tipoDocumento,
    fechaPrograma: formatDateOnly(download.fechaPrograma),
    sesion: download.sesion,
    version: download.version,
    uOfertante: download.uOfertante,
    fechaDescarga: download.fechaDescarga.toISOString(),
    estado: download.estado,
    registros: download.registros,
    hashContenido: download.hashContenido,
    nombreFichero: download.nombreFichero,
    mensajeError: download.mensajeError,
    createdAt: download.createdAt.toISOString(),
    updatedAt: download.updatedAt.toISOString()
  };
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
}): OmieDownloadControlRow {
  return {
    id: download.id,
    tipoDocumento: download.tipoPrecio,
    fechaPrograma: formatDateOnly(download.fechaPrograma),
    sesion: download.sesion,
    version: download.version,
    uOfertante: null,
    fechaDescarga: download.fechaDescarga.toISOString(),
    estado: download.estado,
    registros: download.registros,
    hashContenido: download.hashContenido,
    nombreFichero: null,
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

function decimalToNumber(value: Prisma.Decimal) {
  return Number(value.toString());
}

function roundEnergy(value: number) {
  return Number(value.toFixed(6));
}
