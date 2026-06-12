import { BadRequestException, Body, Controller, Get, Post, Query } from "@nestjs/common";
import { OmieAnalisisService } from "./omie-analisis.service";

@Controller("omie/analisis")
export class OmieAnalisisController {
  constructor(private readonly omieAnalisisService: OmieAnalisisService) {}

  @Get("mensual")
  async obtenerAnalisisMensual(@Query("year") year?: string, @Query("month") month?: string) {
    return this.omieAnalisisService.obtenerAnalisisMensual(parseYear(year), parseMonth(month));
  }

  @Get("comprobacion-liquidaciones")
  async obtenerComprobacionLiquidaciones(@Query("year") year?: string, @Query("month") month?: string) {
    return this.omieAnalisisService.obtenerComprobacionLiquidaciones(parseYear(year), parseMonth(month));
  }

  @Post("comprobacion-liquidaciones/factura")
  async guardarFacturaLiquidacion(@Body() body: unknown) {
    const parsed = parseInvoiceBody(body);
    return this.omieAnalisisService.guardarFacturaLiquidacion(parsed.fecha, parsed.facturaCompra, parsed.facturaVenta);
  }
}

function parseYear(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 2000 || parsed > 2100) {
    throw new BadRequestException("El parametro year debe ser un año valido.");
  }
  return parsed;
}

function parseMonth(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 12) {
    throw new BadRequestException("El parametro month debe estar entre 1 y 12.");
  }
  return parsed;
}

function parseInvoiceBody(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new BadRequestException("El cuerpo de la peticion no es valido.");
  }

  const payload = body as { fecha?: unknown; facturaCompra?: unknown; facturaVenta?: unknown };
  const fecha = parseDate(payload.fecha);
  return {
    fecha,
    facturaCompra: parseNullableAmount(payload.facturaCompra, "facturaCompra"),
    facturaVenta: parseNullableAmount(payload.facturaVenta, "facturaVenta")
  };
}

function parseDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException("El campo fecha debe tener formato YYYY-MM-DD.");
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new BadRequestException("El campo fecha no es una fecha valida.");
  }
  return date;
}

function parseNullableAmount(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BadRequestException(`El campo ${field} debe ser numerico o null.`);
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
