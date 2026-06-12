import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { OmiePreciosService } from "./omie-precios.service";

@Controller("omie/precios")
export class OmiePreciosController {
  constructor(private readonly omiePreciosService: OmiePreciosService) {}

  @Get()
  async obtenerPrecios(@Query("fecha") fecha?: string) {
    return this.omiePreciosService.obtenerPrecios(parseFechaQuery(fecha));
  }
}

function parseFechaQuery(value: string | undefined) {
  const fecha = value?.trim();
  if (!fecha) {
    throw new BadRequestException("El parametro fecha es obligatorio.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new BadRequestException("El parametro fecha debe tener formato YYYY-MM-DD.");
  }
  const parsed = new Date(`${fecha}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== fecha) {
    throw new BadRequestException("El parametro fecha no es una fecha valida.");
  }
  return fecha;
}
