import { BadRequestException, Controller, Get, Param, Query } from "@nestjs/common";
import { OmieDownloadEstado } from "@prisma/client";
import { OmieTransaccionesService } from "./omie-transacciones.service";

@Controller("omie/transacciones")
export class OmieTransaccionesController {
  constructor(private readonly omieTransaccionesService: OmieTransaccionesService) {}

  @Get("historico")
  async listarHistorico(@Query("fechaDesde") fechaDesde?: string, @Query("fechaHasta") fechaHasta?: string, @Query("estado") estado?: string) {
    return this.omieTransaccionesService.listarHistorico({
      fechaDesde: fechaDesde ? parseFechaQuery(fechaDesde, "fechaDesde") : undefined,
      fechaHasta: fechaHasta ? parseFechaQuery(fechaHasta, "fechaHasta") : undefined,
      estado: parseEstado(estado)
    });
  }

  @Get("historico/:downloadId/filas")
  async obtenerFilas(@Param("downloadId") downloadId: string, @Query("take") take?: string) {
    return this.omieTransaccionesService.obtenerFilas(downloadId, parseTake(take));
  }

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

function parseTake(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new BadRequestException("El parametro take debe ser un entero positivo.");
  }
  return parsed;
}
