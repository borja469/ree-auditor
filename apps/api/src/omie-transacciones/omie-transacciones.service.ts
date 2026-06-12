import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { OmieDownloadEstado, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { OmieSiom2ClientService } from "../omie-siom2/omie-siom2-client.service";
import type { OmieConsultaEncolumnadaColumna, OmieConsultaEncolumnadaFila } from "../omie-siom2/omie-siom2.types";
import { PrismaService } from "../prisma/prisma.service";

const OMIE_TRANSACCIONES_CODIGO = "4121";
const OMIE_TRANSACCIONES_DESCRIPCION = "Historico de Transacciones";
const MAX_LIST_TAKE = 500;
const MAX_ROW_PREVIEW_TAKE = 1000;

type DayExecutionSummary = {
  fecha: string;
  statusCode: number;
  serviceName: string;
  registros: number;
  columnas: string[];
};

type StagingRowInput = {
  downloadId: string;
  diaContrato: Date;
  rowIndex: number;
  rawPayloadJson: Prisma.InputJsonObject;
};

type SyncOptions = {
  force?: boolean;
};

export type OmieTransactionDownloadFilters = {
  fechaDesde?: string;
  fechaHasta?: string;
  estado?: OmieDownloadEstado;
};

export type OmieTransactionColumn = {
  nombre: string;
  tipo?: string;
  descripcion?: string;
  atributos?: Record<string, string>;
};

export type OmieTransactionStructureSummary = {
  codigoConsulta: typeof OMIE_TRANSACCIONES_CODIGO;
  descripcion: typeof OMIE_TRANSACCIONES_DESCRIPCION;
  fechaDesde: string;
  fechaHasta: string;
  diasConsultados: number;
  registrosTotales: number;
  columnasDetectadas: string[];
  columnas: OmieTransactionColumn[];
  dias: DayExecutionSummary[];
  muestraFilas: Prisma.InputJsonObject[];
};

export type OmieTransactionDownloadRow = {
  id: string;
  codigoConsulta: string;
  fechaDesde: string;
  fechaHasta: string;
  fechaDescarga: string;
  estado: OmieDownloadEstado;
  registros: number;
  diasConsultados: number;
  columnas: OmieTransactionColumn[] | null;
  resumenEstructura: Prisma.JsonValue | null;
  hashContenido: string | null;
  nombreFichero: string | null;
  mensajeError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OmieTransactionStagingRow = {
  id: string;
  downloadId: string;
  diaContrato: string;
  rowIndex: number;
  rawPayloadJson: Prisma.JsonValue;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class OmieTransaccionesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly omieSiom2ClientService: OmieSiom2ClientService
  ) {}

  async descargarHistorico(fechaDesde: string, fechaHasta: string, options: SyncOptions = {}) {
    const range = buildDateRange(fechaDesde, fechaHasta);
    const startedAt = new Date();
    const existingProcessed = await this.findLatestDownload(range.fechaDesdeDate, range.fechaHastaDate, OmieDownloadEstado.PROCESADO);
    if (existingProcessed && !options.force) {
      return {
        message: "Ya existe descarga procesada",
        download: serializeTransactionDownload(existingProcessed),
        resumenEstructura: existingProcessed.resumenEstructura
      };
    }

    const current = await this.findLatestDownload(range.fechaDesdeDate, range.fechaHastaDate);
    const download = current
      ? await this.prisma.omieTransactionDownload.update({
          where: { id: current.id },
          data: {
            fechaDescarga: startedAt,
            estado: OmieDownloadEstado.DESCARGANDO,
            registros: 0,
            diasConsultados: range.fechas.length,
            columnas: Prisma.JsonNull,
            resumenEstructura: Prisma.JsonNull,
            hashContenido: null,
            nombreFichero: null,
            mensajeError: null
          }
        })
      : await this.prisma.omieTransactionDownload.create({
          data: {
            codigoConsulta: OMIE_TRANSACCIONES_CODIGO,
            fechaDesde: range.fechaDesdeDate,
            fechaHasta: range.fechaHastaDate,
            fechaDescarga: startedAt,
            estado: OmieDownloadEstado.DESCARGANDO,
            diasConsultados: range.fechas.length
          }
        });

    try {
      const xmlParts: string[] = [];
      const daySummaries: DayExecutionSummary[] = [];
      const columnasPorDia: OmieTransactionColumn[] = [];
      const stagingRows: StagingRowInput[] = [];
      let rowIndex = 1;

      for (const fecha of range.fechas) {
        const result = await this.omieSiom2ClientService.ejecutarConsultaEncolumnada(OMIE_TRANSACCIONES_CODIGO, {
          DiaContrato: fecha
        });
        const filas = result.filas ?? [];
        const columnas = normalizeColumns(result.columnas ?? inferColumnsFromRows(filas));
        columnasPorDia.push(...columnas);
        xmlParts.push(result.xml);
        daySummaries.push({
          fecha,
          statusCode: result.statusCode,
          serviceName: result.serviceName,
          registros: filas.length,
          columnas: columnas.map((column) => column.nombre)
        });

        for (const fila of filas) {
          stagingRows.push({
            downloadId: download.id,
            diaContrato: parseDateOnly(fecha),
            rowIndex,
            rawPayloadJson: buildRawPayload(fecha, fila)
          });
          rowIndex += 1;
        }
      }

      const columnas = mergeColumns(columnasPorDia, stagingRows.map((row) => row.rawPayloadJson));
      const resumenEstructura: OmieTransactionStructureSummary = {
        codigoConsulta: OMIE_TRANSACCIONES_CODIGO,
        descripcion: OMIE_TRANSACCIONES_DESCRIPCION,
        fechaDesde,
        fechaHasta,
        diasConsultados: range.fechas.length,
        registrosTotales: stagingRows.length,
        columnasDetectadas: columnas.map((column) => column.nombre),
        columnas,
        dias: daySummaries,
        muestraFilas: stagingRows.slice(0, 10).map((row) => row.rawPayloadJson)
      };
      const hashContenido = createHash("sha256")
        .update(xmlParts.join("\n") || JSON.stringify(stagingRows.map((row) => row.rawPayloadJson)))
        .digest("hex");
      const fechaDescarga = new Date();
      const nombreFichero = buildNombreFichero(fechaDesde, fechaHasta);

      const processedDownload = await this.prisma.$transaction(async (tx) => {
        await tx.omieTransactionStaging.deleteMany({ where: { downloadId: download.id } });
        await createManyStagingRows(tx, stagingRows);
        return tx.omieTransactionDownload.update({
          where: { id: download.id },
          data: {
            estado: OmieDownloadEstado.PROCESADO,
            registros: stagingRows.length,
            diasConsultados: range.fechas.length,
            columnas: columnas as Prisma.InputJsonValue,
            resumenEstructura: resumenEstructura as unknown as Prisma.InputJsonValue,
            hashContenido,
            nombreFichero,
            mensajeError: null,
            fechaDescarga
          }
        });
      });

      return {
        message: "Descarga historico 4121 procesada",
        download: serializeTransactionDownload(processedDownload),
        resumenEstructura
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.omieTransactionDownload.update({
        where: { id: download.id },
        data: {
          estado: OmieDownloadEstado.ERROR,
          mensajeError: message.slice(0, 4000)
        }
      });
      throw new BadGatewayException(message || "Error descargando historico de transacciones OMIE.");
    }
  }

  async listarHistorico(filters: OmieTransactionDownloadFilters = {}) {
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

    const descargas = await this.prisma.omieTransactionDownload.findMany({
      where,
      orderBy: [{ fechaDescarga: "desc" }, { createdAt: "desc" }],
      take: MAX_LIST_TAKE
    });

    return {
      codigoConsulta: OMIE_TRANSACCIONES_CODIGO,
      descripcion: OMIE_TRANSACCIONES_DESCRIPCION,
      filtros: {
        fechaDesde: filters.fechaDesde ?? null,
        fechaHasta: filters.fechaHasta ?? null,
        estado: filters.estado ?? null
      },
      descargas: descargas.map(serializeTransactionDownload)
    };
  }

  async obtenerFilas(downloadId: string, take = 100) {
    const sanitizedTake = Math.min(Math.max(Math.trunc(take), 1), MAX_ROW_PREVIEW_TAKE);
    const download = await this.prisma.omieTransactionDownload.findUnique({
      where: { id: downloadId }
    });
    if (!download) {
      throw new NotFoundException("Descarga de transacciones no encontrada.");
    }

    const filas = await this.prisma.omieTransactionStaging.findMany({
      where: { downloadId },
      orderBy: { rowIndex: "asc" },
      take: sanitizedTake
    });

    return {
      download: serializeTransactionDownload(download),
      take: sanitizedTake,
      filas: filas.map(serializeTransactionStagingRow)
    };
  }

  private async findLatestDownload(fechaDesde: Date, fechaHasta: Date, estado?: OmieDownloadEstado) {
    return this.prisma.omieTransactionDownload.findFirst({
      where: {
        codigoConsulta: OMIE_TRANSACCIONES_CODIGO,
        fechaDesde,
        fechaHasta,
        estado
      },
      orderBy: { updatedAt: "desc" }
    });
  }

}

async function createManyStagingRows(tx: Prisma.TransactionClient, rows: StagingRowInput[]) {
  const batchSize = 1000;
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    if (batch.length > 0) {
      await tx.omieTransactionStaging.createMany({
        data: batch
      });
    }
  }
}

function buildDateRange(fechaDesde: string, fechaHasta: string) {
  const fechaDesdeDate = parseDateOnly(fechaDesde);
  const fechaHastaDate = parseDateOnly(fechaHasta);
  if (fechaDesdeDate.getTime() > fechaHastaDate.getTime()) {
    throw new BadRequestException("fechaDesde no puede ser posterior a fechaHasta.");
  }

  const fechas: string[] = [];
  const cursor = new Date(fechaDesdeDate);
  while (cursor.getTime() <= fechaHastaDate.getTime()) {
    fechas.push(formatDateOnly(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return { fechaDesdeDate, fechaHastaDate, fechas };
}

function buildRawPayload(fecha: string, fila: OmieConsultaEncolumnadaFila): Prisma.InputJsonObject {
  return {
    ...Object.fromEntries(Object.entries(fila).map(([key, value]) => [key, value])),
    _diaContratoConsulta: fecha
  };
}

function normalizeColumns(columns: OmieConsultaEncolumnadaColumna[]): OmieTransactionColumn[] {
  return columns.map((column) => ({
    nombre: column.nombre,
    tipo: column.tipo,
    descripcion: column.descripcion,
    atributos: column.atributos
  }));
}

function inferColumnsFromRows(rows: OmieConsultaEncolumnadaFila[]): OmieConsultaEncolumnadaColumna[] {
  const names = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      names.add(key);
    }
  }
  return [...names].map((nombre) => ({
    nombre,
    atributos: {}
  }));
}

function mergeColumns(columns: OmieTransactionColumn[], rows: Prisma.InputJsonObject[]): OmieTransactionColumn[] {
  const map = new Map<string, OmieTransactionColumn>();
  for (const column of columns) {
    const key = normalizeColumnName(column.nombre);
    const current = map.get(key);
    map.set(key, {
      nombre: current?.nombre ?? column.nombre,
      tipo: current?.tipo ?? column.tipo,
      descripcion: current?.descripcion ?? column.descripcion,
      atributos: current?.atributos ?? column.atributos
    });
  }
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      const normalized = normalizeColumnName(key);
      if (!map.has(normalized)) {
        map.set(normalized, { nombre: key, atributos: {} });
      }
    }
  }
  return [...map.values()].filter((column) => column.nombre !== "_diaContratoConsulta");
}

function normalizeColumnName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function buildNombreFichero(fechaDesde: string, fechaHasta: string) {
  return `OMIE_4121_TRANSACCIONES_${fechaDesde}_${fechaHasta}.xml`;
}

function serializeTransactionDownload(download: {
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
}): OmieTransactionDownloadRow {
  return {
    id: download.id,
    codigoConsulta: download.codigoConsulta,
    fechaDesde: formatDateOnly(download.fechaDesde),
    fechaHasta: formatDateOnly(download.fechaHasta),
    fechaDescarga: download.fechaDescarga.toISOString(),
    estado: download.estado,
    registros: download.registros,
    diasConsultados: download.diasConsultados,
    columnas: Array.isArray(download.columnas) ? (download.columnas as OmieTransactionColumn[]) : null,
    resumenEstructura: download.resumenEstructura,
    hashContenido: download.hashContenido,
    nombreFichero: download.nombreFichero,
    mensajeError: download.mensajeError,
    createdAt: download.createdAt.toISOString(),
    updatedAt: download.updatedAt.toISOString()
  };
}

function serializeTransactionStagingRow(row: {
  id: string;
  downloadId: string;
  diaContrato: Date;
  rowIndex: number;
  rawPayloadJson: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}): OmieTransactionStagingRow {
  return {
    id: row.id,
    downloadId: row.downloadId,
    diaContrato: formatDateOnly(row.diaContrato),
    rowIndex: row.rowIndex,
    rawPayloadJson: row.rawPayloadJson,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
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
