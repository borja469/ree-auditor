import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { OmieDownloadEstado, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { PrismaService } from "../prisma/prisma.service";
import {
  buildOmieReerConsumFileName,
  buildOmieReerConsumUrl,
  parseOmieReerConsumText,
  parseOmieReerConsumXls,
  parseOmieReerOfficialXml
} from "./omie-reer.parser";

export const OMIE_REER_PUBLIC_CODIGO = "INT_REER_CONSUM_EV_H";

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

@Injectable()
export class OmieReerService {
  constructor(private readonly prisma: PrismaService) {}

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
    await this.prisma.omieReerOfficialAnnotation.createMany({
      data: rows.map((row) => ({
        ...row,
        ficheroOrigen: input.fileName,
        hashFichero: hash
      })),
      skipDuplicates: true
    });
    return { registros: rows.length, hashFichero: hash };
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
      where: { fecha },
      orderBy: { version: "desc" },
      select: { version: true }
    });
    if (!latest) {
      return [];
    }
    return this.prisma.omieReerOfficialAnnotation.findMany({
      where: { fecha, version: latest.version },
      orderBy: { periodo: "asc" }
    });
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
}

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

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
