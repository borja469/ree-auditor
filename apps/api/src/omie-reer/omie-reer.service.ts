import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { OmieDownloadEstado, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { OmieSiom2ClientService } from "../omie-siom2/omie-siom2-client.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  buildOmieReerConsumFileName,
  buildOmieReerConsumUrl,
  parseOmieReerConsumText,
  parseOmieReerConsumXls,
  parseOmieReerOfficialXml
} from "./omie-reer.parser";

export const OMIE_REER_PUBLIC_CODIGO = "INT_REER_CONSUM_EV_H";
export const OMIE_REER_OFFICIAL_CODIGO = "9230";
export const OMIE_REER_OFFICIAL_DEFAULT_AGENT = "STROM";
export const OMIE_REER_OFFICIAL_DEFAULT_VERSION = 1;

export type OmieReerPublicDownloadRow = {
  id: string;
  fecha: string;
  versionCarga: number;
  estado: OmieDownloadEstado;
  registros: number;
  ficheroOrigen: string;
  urlOrigen: string;
  hashFichero: string;
  fechaPublicacion: string | null;
  fechaCarga: string;
  mensajeError: string | null;
};

export type OmieReerPublicSyncResponse = {
  message: string;
  download: OmieReerPublicDownloadRow;
};

export type OmieReerOfficialDownloadRow = {
  id: string;
  fecha: string;
  version: number;
  agente: string;
  codigoDocumento: string;
  estado: OmieDownloadEstado;
  registros: number;
  ficheroOrigen: string;
  hashFichero: string;
  fechaDescarga: string;
  fechaCarga: string;
  mensajeError: string | null;
  contenidoXml: string | null;
};

export type OmieReerOfficialSyncResponse = {
  message: string;
  download: OmieReerOfficialDownloadRow;
};

@Injectable()
export class OmieReerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly omieSiom2Client: OmieSiom2ClientService
  ) {}

  buildPublicUrl(fecha: Date, extension: "TXT" | "XLS" = "TXT") {
    return buildOmieReerConsumUrl(fecha, extension);
  }

  async sincronizarPublico(fechaIso: string, options: { force?: boolean; preferXls?: boolean } = {}): Promise<OmieReerPublicSyncResponse> {
    const fecha = parseDateOnly(fechaIso);
    const latest = await this.getLatestPublicRows(fecha);
    if (latest.length > 0 && !options.force) {
      return {
        message: "Ya existe REER publico procesado",
        download: serializePublicDownload(latest)
      };
    }

    const fetched = await this.fetchPublicFile(fecha, options.preferXls ? ["XLS", "TXT"] : ["TXT", "XLS"]);
    const hash = createHash("sha256").update(fetched.buffer).digest("hex");
    const parsed = fetched.extension === "XLS" ? parseOmieReerConsumXls(fetched.buffer) : parseOmieReerConsumText(decodeText(fetched.buffer));
    if (parsed.rows.length === 0) {
      throw new NotFoundException("El fichero REER publico no contiene registros validos.");
    }

    const existingSameHash = latest.find((row) => row.hashFichero === hash);
    if (existingSameHash && !options.force) {
      return {
        message: "Ya existe REER publico con el mismo hash",
        download: serializePublicDownload(latest)
      };
    }

    const versionCarga = latest.length > 0 ? Math.max(...latest.map((row) => row.versionCarga)) + 1 : 1;
    const fechaCarga = new Date();
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.omieReerConsumResult.createMany({
        data: parsed.rows.map((row) => ({
          fecha: row.fecha,
          periodo: row.periodo,
          periodoEtiqueta: row.periodoEtiqueta,
          precioPublicadoEurMwh: row.precioPublicadoEurMwh,
          volumenEconomicoEur: row.volumenEconomicoEur,
          energiaNacionalMwh: row.energiaNacionalMwh,
          coeficienteDerivadoEurMwh: row.coeficienteDerivadoEurMwh,
          ficheroOrigen: fetched.fileName,
          urlOrigen: fetched.url,
          hashFichero: hash,
          fechaPublicacion: parsed.fechaPublicacion,
          fechaCarga,
          versionCarga
        })),
        skipDuplicates: true
      });
      return tx.omieReerConsumResult.findMany({
        where: { fecha, versionCarga },
        orderBy: { periodo: "asc" }
      });
    });

    return {
      message: "REER publico procesado",
      download: serializePublicDownload(rows)
    };
  }

  async importarPublicoDesdeBuffer(input: { fileName: string; buffer: Buffer; urlOrigen?: string }) {
    const fecha = parseDateFromPublicFileName(input.fileName);
    const extension = input.fileName.toUpperCase().endsWith(".XLS") ? "XLS" : "TXT";
    const hash = createHash("sha256").update(input.buffer).digest("hex");
    const parsed = extension === "XLS" ? parseOmieReerConsumXls(input.buffer) : parseOmieReerConsumText(decodeText(input.buffer));
    const latest = await this.getLatestPublicRows(fecha);
    const versionCarga = latest.length > 0 && latest.some((row) => row.hashFichero === hash) ? Math.max(...latest.map((row) => row.versionCarga)) : latest.length > 0 ? Math.max(...latest.map((row) => row.versionCarga)) + 1 : 1;
    await this.prisma.omieReerConsumResult.createMany({
      data: parsed.rows.map((row) => ({
        fecha: row.fecha,
        periodo: row.periodo,
        periodoEtiqueta: row.periodoEtiqueta,
        precioPublicadoEurMwh: row.precioPublicadoEurMwh,
        volumenEconomicoEur: row.volumenEconomicoEur,
        energiaNacionalMwh: row.energiaNacionalMwh,
        coeficienteDerivadoEurMwh: row.coeficienteDerivadoEurMwh,
        ficheroOrigen: input.fileName,
        urlOrigen: input.urlOrigen ?? "",
        hashFichero: hash,
        fechaPublicacion: parsed.fechaPublicacion,
        versionCarga
      })),
      skipDuplicates: true
    });
    return { fecha: formatDateOnly(fecha), versionCarga, registros: parsed.rows.length, hashFichero: hash };
  }

  async importarOficial9230DesdeBuffer(input: { fileName: string; buffer: Buffer }) {
    const content = decodeText(input.buffer);
    const hash = createHash("sha256").update(input.buffer).digest("hex");
    const rows = parseOmieReerOfficialXml(content, input.fileName);
    if (rows.length === 0) {
      throw new BadRequestException("El XML 9230 no contiene anotaciones REER.");
    }
    const fecha = rows[0].fecha;
    const version = rows[0].version;
    const agente = OMIE_REER_OFFICIAL_DEFAULT_AGENT;
    const fechaDescarga = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.omieReerOfficialAnnotation.deleteMany({
        where: { fecha, version, agente, codigoDocumento: OMIE_REER_OFFICIAL_CODIGO }
      });
      await tx.omieReerOfficialAnnotation.createMany({
        data: [
          buildOfficialHeaderData({
            fecha,
            version,
            agente,
            estado: OmieDownloadEstado.PROCESADO,
            registros: rows.length,
            ficheroOrigen: input.fileName,
            hashFichero: hash,
            contenidoXml: content,
            fechaDescarga,
            mensajeError: null
          }),
          ...rows.map((row) => ({
            ...row,
            agente,
            codigoDocumento: OMIE_REER_OFFICIAL_CODIGO,
            ficheroOrigen: input.fileName,
            hashFichero: hash,
            contenidoXml: content,
            estado: OmieDownloadEstado.PROCESADO,
            registros: rows.length,
            fechaDescarga
          }))
        ],
        skipDuplicates: true
      });
    });
    return { registros: rows.length, hashFichero: hash };
  }

  async sincronizarOficial9230(
    fechaIso: string,
    options: { force?: boolean; version?: number; agente?: string } = {}
  ): Promise<OmieReerOfficialSyncResponse> {
    const fecha = parseDateOnly(fechaIso);
    const version = normalizeVersion(options.version);
    const agente = normalizeAgente(options.agente);
    const latest = await this.getOfficialControlRow(fecha, version, agente);
    if (latest && latest.estado === OmieDownloadEstado.PROCESADO && !options.force) {
      return {
        message: "Ya existe REER oficial 9230 procesado",
        download: latest
      };
    }

    const fechaDescarga = new Date();
    try {
      const downloaded = await this.omieSiom2Client.descargarXmlConsulta(OMIE_REER_OFFICIAL_CODIGO, {
        Fecha: fechaIso,
        Version: String(version),
        Agente: agente
      });
      const contenidoXml = await readFile(downloaded.outputPath, "utf8");
      const buffer = Buffer.from(contenidoXml, "utf8");
      const hash = createHash("sha256").update(buffer).digest("hex");
      const rows = parseOmieReerOfficialXml(contenidoXml, downloaded.fileName);
      if (rows.length === 0) {
        return {
          message: "REER oficial 9230 sin datos para la fecha/version/agente",
          download: await this.persistOfficialDownloadHeader({
            fecha,
            version,
            agente,
            estado: OmieDownloadEstado.SIN_DATOS,
            registros: 0,
            ficheroOrigen: downloaded.fileName,
            hashFichero: hash,
            contenidoXml,
            fechaDescarga,
            mensajeError: "El XML 9230 no contiene anotaciones REER."
          })
        };
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.omieReerOfficialAnnotation.deleteMany({
          where: { fecha, version, agente, codigoDocumento: OMIE_REER_OFFICIAL_CODIGO }
        });
        await tx.omieReerOfficialAnnotation.createMany({
          data: [
            buildOfficialHeaderData({
              fecha,
              version,
              agente,
              estado: OmieDownloadEstado.PROCESADO,
              registros: rows.length,
              ficheroOrigen: downloaded.fileName,
              hashFichero: hash,
              contenidoXml,
              fechaDescarga,
              mensajeError: null
            }),
            ...rows.map((row) => ({
              ...row,
              agente,
              codigoDocumento: OMIE_REER_OFFICIAL_CODIGO,
              ficheroOrigen: downloaded.fileName,
              hashFichero: hash,
              contenidoXml,
              estado: OmieDownloadEstado.PROCESADO,
              registros: rows.length,
              fechaDescarga
            }))
          ],
          skipDuplicates: true
        });
      });

      return {
        message: "REER oficial 9230 procesado",
        download: await this.getOfficialControlRowOrThrow(fecha, version, agente)
      };
    } catch (error) {
      if (isOfficialNoDataError(error)) {
        return {
          message: "REER oficial 9230 sin datos para la fecha/version/agente",
          download: await this.persistOfficialDownloadHeader({
            fecha,
            version,
            agente,
            estado: OmieDownloadEstado.SIN_DATOS,
            registros: 0,
            ficheroOrigen: `9230_${formatDateCompact(fecha)}.${version}.xml`,
            hashFichero: createHash("sha256").update(`${fechaIso}:${version}:${agente}:SIN_DATOS`).digest("hex"),
            contenidoXml: null,
            fechaDescarga,
            mensajeError: error instanceof Error ? error.message : String(error)
          })
        };
      }
      return {
        message: "Error descargando REER oficial 9230",
        download: await this.persistOfficialDownloadHeader({
          fecha,
          version,
          agente,
          estado: OmieDownloadEstado.ERROR,
          registros: 0,
          ficheroOrigen: `9230_${formatDateCompact(fecha)}.${version}.xml`,
          hashFichero: createHash("sha256").update(`${fechaIso}:${version}:${agente}:ERROR:${String(error)}`).digest("hex"),
          contenidoXml: null,
          fechaDescarga,
          mensajeError: error instanceof Error ? error.message : String(error)
        })
      };
    }
  }

  async getLatestPublicRows(fecha: Date) {
    const latest = await this.prisma.omieReerConsumResult.findFirst({
      where: { fecha },
      orderBy: { versionCarga: "desc" },
      select: { versionCarga: true }
    });
    if (!latest) {
      return [];
    }
    return this.prisma.omieReerConsumResult.findMany({
      where: { fecha, versionCarga: latest.versionCarga },
      orderBy: { periodo: "asc" }
    });
  }

  async getLatestOfficialRows(fecha: Date) {
    const latest = await this.prisma.omieReerOfficialAnnotation.findFirst({
      where: {
        fecha,
        periodo: 0,
        codigoDocumento: OMIE_REER_OFFICIAL_CODIGO,
        estado: OmieDownloadEstado.PROCESADO
      },
      orderBy: { version: "desc" },
      select: { version: true, agente: true }
    });
    if (!latest) {
      return [];
    }
    return this.prisma.omieReerOfficialAnnotation.findMany({
      where: {
        fecha,
        version: latest.version,
        agente: latest.agente,
        codigoDocumento: OMIE_REER_OFFICIAL_CODIGO,
        periodo: { gt: 0 },
        estado: OmieDownloadEstado.PROCESADO
      },
      orderBy: { periodo: "asc" }
    });
  }

  async getOfficialControlRows(filters: { fechaDesde?: string; fechaHasta?: string; estado?: OmieDownloadEstado } = {}) {
    const where: Prisma.OmieReerOfficialAnnotationWhereInput = {
      periodo: 0,
      codigoDocumento: OMIE_REER_OFFICIAL_CODIGO
    };
    if (filters.estado) {
      where.estado = filters.estado;
    }
    if (filters.fechaDesde || filters.fechaHasta) {
      where.fecha = {
        gte: filters.fechaDesde ? parseDateOnly(filters.fechaDesde) : undefined,
        lte: filters.fechaHasta ? parseDateOnly(filters.fechaHasta) : undefined
      };
    }
    const rows = await this.prisma.omieReerOfficialAnnotation.findMany({
      where,
      orderBy: [{ fecha: "desc" }, { version: "desc" }, { agente: "asc" }, { fechaDescarga: "desc" }],
      take: 300
    });
    return rows.map(serializeOfficialDownload);
  }

  async getPublicControlRows(filters: { fechaDesde?: string; fechaHasta?: string; estado?: OmieDownloadEstado } = {}) {
    const where: Prisma.OmieReerConsumResultWhereInput = {};
    if (filters.fechaDesde || filters.fechaHasta) {
      where.fecha = {
        gte: filters.fechaDesde ? parseDateOnly(filters.fechaDesde) : undefined,
        lte: filters.fechaHasta ? parseDateOnly(filters.fechaHasta) : undefined
      };
    }
    const grouped = await this.prisma.omieReerConsumResult.groupBy({
      by: ["fecha", "versionCarga", "ficheroOrigen", "urlOrigen", "hashFichero", "fechaPublicacion", "fechaCarga"],
      where,
      _count: { _all: true },
      orderBy: [{ fecha: "desc" }, { versionCarga: "desc" }],
      take: 300
    });
    return grouped
      .map((row) => ({
        id: `reer-public:${formatDateOnly(row.fecha)}:${row.versionCarga}`,
        fecha: formatDateOnly(row.fecha),
        versionCarga: row.versionCarga,
        estado: OmieDownloadEstado.PROCESADO,
        registros: row._count._all,
        ficheroOrigen: row.ficheroOrigen,
        urlOrigen: row.urlOrigen,
        hashFichero: row.hashFichero,
        fechaPublicacion: row.fechaPublicacion?.toISOString() ?? null,
        fechaCarga: row.fechaCarga.toISOString(),
        mensajeError: null
      }))
      .filter((row) => !filters.estado || row.estado === filters.estado);
  }

  private async fetchPublicFile(fecha: Date, extensions: Array<"TXT" | "XLS">) {
    let lastError: Error | null = null;
    for (const extension of extensions) {
      const url = buildOmieReerConsumUrl(fecha, extension);
      const fileName = buildOmieReerConsumFileName(fecha, extension);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const buffer = await fetchBuffer(url);
          return { url, fileName, extension, buffer };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          await delay(250 * attempt);
        }
      }
    }
    throw new NotFoundException(lastError?.message ?? "No se ha publicado el fichero REER para la fecha indicada.");
  }

  private async getOfficialControlRow(fecha: Date, version: number, agente: string) {
    const row = await this.prisma.omieReerOfficialAnnotation.findFirst({
      where: {
        fecha,
        version,
        agente,
        periodo: 0,
        codigoDocumento: OMIE_REER_OFFICIAL_CODIGO
      },
      orderBy: { fechaDescarga: "desc" }
    });
    return row ? serializeOfficialDownload(row) : null;
  }

  private async getOfficialControlRowOrThrow(fecha: Date, version: number, agente: string) {
    const row = await this.getOfficialControlRow(fecha, version, agente);
    if (!row) {
      throw new NotFoundException("No se ha podido recuperar el registro de control REER oficial 9230.");
    }
    return row;
  }

  private async persistOfficialDownloadHeader(input: OfficialHeaderInput) {
    await this.prisma.$transaction(async (tx) => {
      await tx.omieReerOfficialAnnotation.deleteMany({
        where: {
          fecha: input.fecha,
          version: input.version,
          agente: input.agente,
          codigoDocumento: OMIE_REER_OFFICIAL_CODIGO
        }
      });
      await tx.omieReerOfficialAnnotation.create({
        data: buildOfficialHeaderData(input)
      });
    });
    return this.getOfficialControlRowOrThrow(input.fecha, input.version, input.agente);
  }
}

type OfficialHeaderInput = {
  fecha: Date;
  version: number;
  agente: string;
  estado: OmieDownloadEstado;
  registros: number;
  ficheroOrigen: string;
  hashFichero: string;
  contenidoXml: string | null;
  fechaDescarga: Date;
  mensajeError: string | null;
};

function serializePublicDownload(rows: Array<{ fecha: Date; versionCarga: number; ficheroOrigen: string; urlOrigen: string; hashFichero: string; fechaPublicacion: Date | null; fechaCarga: Date }>): OmieReerPublicDownloadRow {
  const first = rows[0];
  if (!first) {
    throw new NotFoundException("No hay filas REER publicas para serializar.");
  }
  return {
    id: `reer-public:${formatDateOnly(first.fecha)}:${first.versionCarga}`,
    fecha: formatDateOnly(first.fecha),
    versionCarga: first.versionCarga,
    estado: OmieDownloadEstado.PROCESADO,
    registros: rows.length,
    ficheroOrigen: first.ficheroOrigen,
    urlOrigen: first.urlOrigen,
    hashFichero: first.hashFichero,
    fechaPublicacion: first.fechaPublicacion?.toISOString() ?? null,
    fechaCarga: first.fechaCarga.toISOString(),
    mensajeError: null
  };
}

function serializeOfficialDownload(row: {
  id: string;
  fecha: Date;
  version: number;
  agente: string;
  codigoDocumento: string;
  estado: OmieDownloadEstado;
  registros: number;
  ficheroOrigen: string;
  hashFichero: string;
  contenidoXml: string | null;
  fechaDescarga: Date;
  fechaCarga: Date;
  mensajeError: string | null;
}): OmieReerOfficialDownloadRow {
  return {
    id: `reer-official:${formatDateOnly(row.fecha)}:${row.version}:${row.agente}`,
    fecha: formatDateOnly(row.fecha),
    version: row.version,
    agente: row.agente,
    codigoDocumento: row.codigoDocumento,
    estado: row.estado,
    registros: row.registros,
    ficheroOrigen: row.ficheroOrigen,
    hashFichero: row.hashFichero,
    fechaDescarga: row.fechaDescarga.toISOString(),
    fechaCarga: row.fechaCarga.toISOString(),
    mensajeError: row.mensajeError,
    contenidoXml: row.contenidoXml
  };
}

function buildOfficialHeaderData(input: OfficialHeaderInput): Prisma.OmieReerOfficialAnnotationCreateManyInput {
  return {
    fecha: input.fecha,
    periodo: 0,
    version: input.version,
    agente: input.agente,
    codigoDocumento: OMIE_REER_OFFICIAL_CODIGO,
    ecreerMwh: new Prisma.Decimal(0),
    epreerEurMwh: new Prisma.Decimal(0),
    eopreerEur: new Prisma.Decimal(0),
    sImp: null,
    sEne: null,
    seg: "S.REER",
    cta: "C.REER",
    cMag: "ECREER",
    cPrc: "EPREER",
    cCpto: "EOPREER",
    ses: null,
    ficheroOrigen: input.ficheroOrigen,
    hashFichero: input.hashFichero,
    contenidoXml: input.contenidoXml,
    estado: input.estado,
    registros: input.registros,
    mensajeError: input.mensajeError,
    fechaDescarga: input.fechaDescarga
  };
}

function fetchBuffer(url: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const request = httpsRequest(url, { method: "GET", timeout: 30000 }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const statusCode = response.statusCode ?? 0;
        const buffer = Buffer.concat(chunks);
        if (statusCode < 200 || statusCode >= 300 || buffer.toString("utf8", 0, 80).includes("404 Not Found")) {
          reject(new Error(`Fichero REER no disponible (${statusCode}) en ${url}`));
          return;
        }
        resolve(buffer);
      });
    });
    request
      .on("timeout", () => {
        request.destroy(new Error(`Timeout descargando ${url}`));
      })
      .on("error", reject)
      .end();
  });
}

function decodeText(buffer: Buffer) {
  return buffer.toString("utf8");
}

function parseDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException("La fecha debe tener formato YYYY-MM-DD.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatDateOnly(date) !== value) {
    throw new BadRequestException("La fecha no es valida.");
  }
  return date;
}

function parseDateFromPublicFileName(fileName: string) {
  const match = /INT_REER_CONSUM_EV_H_(\d{2})_(\d{2})_(\d{4})_/i.exec(fileName);
  if (!match) {
    throw new BadRequestException("Nombre de fichero REER publico no valido.");
  }
  return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
}

function normalizeVersion(value: number | undefined) {
  const version = value ?? OMIE_REER_OFFICIAL_DEFAULT_VERSION;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new BadRequestException("La version REER oficial debe ser un entero positivo.");
  }
  return version;
}

function normalizeAgente(value: string | undefined) {
  const agente = value?.trim() || OMIE_REER_OFFICIAL_DEFAULT_AGENT;
  if (!/^[A-Z0-9_-]{2,30}$/i.test(agente)) {
    throw new BadRequestException("El agente REER oficial no tiene un formato valido.");
  }
  return agente.toUpperCase();
}

function isOfficialNoDataError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("no existe la consulta")) {
    return false;
  }
  return (
    message.includes("no devolvio un xml descargable") ||
    message.includes("no devolvió un xml descargable") ||
    message.includes("sin datos") ||
    message.includes("no contiene anotaciones") ||
    message.includes("version inexistente") ||
    message.includes("versión inexistente") ||
    message.includes("documento no disponible")
  );
}

function formatDateCompact(value: Date) {
  return `${String(value.getUTCDate()).padStart(2, "0")}${String(value.getUTCMonth() + 1).padStart(2, "0")}${value.getUTCFullYear()}`;
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
