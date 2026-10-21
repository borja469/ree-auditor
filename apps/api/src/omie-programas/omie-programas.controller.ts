import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { normalizeOmieEnergiaSesion, normalizeOmieEnergiaUnidad } from "../omie-siom2/omie-energia";
import { OmieProgramasService } from "./omie-programas.service";

@Controller("omie")
export class OmieProgramasController {
  constructor(private readonly omieProgramasService: OmieProgramasService) {}

  @Get("programas/mercado-diario")
  async obtenerProgramaMercadoDiario(@Query("fecha") fecha?: string, @Query("uOfertante") uOfertante?: string) {
    return this.omieProgramasService.obtenerProgramaMercadoDiario(parseFechaQuery(fecha), parseUnidadQuery(uOfertante));
  }

  @Get("programas/intradiario")
  async obtenerProgramaIntradiario(@Query("fecha") fecha?: string, @Query("sesion") sesion?: string, @Query("uOfertante") uOfertante?: string) {
    return this.omieProgramasService.obtenerProgramaIntradiario(parseFechaQuery(fecha), parseSesionQuery(sesion), parseUnidadQuery(uOfertante));
  }

  @Get("programas/evolucion")
  async obtenerProgramaEvolucion(@Query("fecha") fecha?: string, @Query("uOfertante") uOfertante?: string) {
    return this.omieProgramasService.obtenerProgramaEvolucion(parseFechaQuery(fecha), parseUnidadQuery(uOfertante));
  }

}

function parseUnidadQuery(value: string | undefined) {
  try {
    return normalizeOmieEnergiaUnidad(value);
  } catch {
    throw new BadRequestException("uOfertante debe ser STROC01 o STRRE01.");
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

function parseSesionQuery(value: string | undefined) {
  const sesion = value?.trim();
  if (!sesion) {
    throw new BadRequestException("El parametro sesion es obligatorio.");
  }
  try {
    return normalizeOmieEnergiaSesion(sesion);
  } catch {
    throw new BadRequestException("El parametro sesion debe ser un entero positivo entre 1 y 99.");
  }
}
