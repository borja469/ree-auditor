import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { normalizeOmieEnergiaSesion } from "./omie-energia";
import { OmieSiom2ClientService } from "./omie-siom2-client.service";

@Controller("omie")
export class OmieSiom2Controller {
  constructor(private readonly omieSiom2ClientService: OmieSiom2ClientService) {}

  @Get("test")
  async testConnection() {
    return this.omieSiom2ClientService.testConnection();
  }

  @Get("test-json")
  async testConnectionJson() {
    return this.omieSiom2ClientService.testConnectionJson();
  }

  @Get("datos-usuario")
  async consultaDatosUsuario() {
    return this.omieSiom2ClientService.consultaDatosUsuario();
  }

  @Get("fecha-hora")
  async consultaFechaHora() {
    return this.omieSiom2ClientService.consultaFechaHora();
  }

  @Get("mercados")
  async consultaMercados() {
    return this.omieSiom2ClientService.consultaMercados();
  }

  @Get("directorio-consultas")
  async consultaDirectorioConsultas() {
    return this.omieSiom2ClientService.consultaDirectorioConsultas();
  }

  @Get("configuracion-consulta/:codigo")
  async consultaConfiguracionConsulta(@Param("codigo") codigoConsulta: string) {
    return this.omieSiom2ClientService.consultaConfiguracionConsulta(codigoConsulta);
  }

  @Post("consultas/:codigo/encolumnada")
  async ejecutarConsultaEncolumnada(@Param("codigo") codigoConsulta: string, @Body() body: unknown) {
    return this.omieSiom2ClientService.ejecutarConsultaEncolumnada(codigoConsulta, parseParametrosBody(body));
  }

  @Get("energia/pvd")
  async obtenerEnergiaPvd(@Query("fecha") fecha?: string) {
    return this.omieSiom2ClientService.obtenerEnergiaPvd(parseFechaQuery(fecha));
  }

  @Get("energia/phf")
  async obtenerEnergiaPhf(@Query("fecha") fecha?: string, @Query("sesion") sesion?: string) {
    return this.omieSiom2ClientService.obtenerEnergiaPhf(parseFechaQuery(fecha), parseSesionQuery(sesion));
  }

  @Get("energia/evolucion")
  async obtenerEnergiaEvolucion(@Query("fecha") fecha?: string) {
    return this.omieSiom2ClientService.obtenerEnergiaEvolucion(parseFechaQuery(fecha));
  }

  @Get("catalogo-consultas")
  async obtenerCatalogoConsultas(@Query("regenerar") regenerar?: string) {
    return this.omieSiom2ClientService.obtenerCatalogoConsultas({ regenerar: parseBooleanQuery(regenerar) });
  }

  @Get("catalogo-consultas/:codigo")
  async obtenerConsultaCatalogo(@Param("codigo") codigoConsulta: string, @Query("regenerar") regenerar?: string) {
    const consulta = await this.omieSiom2ClientService.obtenerConsultaCatalogo(codigoConsulta, { regenerar: parseBooleanQuery(regenerar) });
    if (!consulta) {
      throw new NotFoundException(`Consulta OMIE no encontrada en catalogo: ${codigoConsulta}`);
    }

    return consulta;
  }

  @Get("catalogo-resumen")
  async obtenerResumenCatalogoConsultas() {
    return this.omieSiom2ClientService.obtenerResumenCatalogoConsultas();
  }

  @Get("catalogo-prioridades")
  async obtenerPrioridadesCatalogoConsultas() {
    return this.omieSiom2ClientService.obtenerPrioridadesCatalogoConsultas();
  }

  @Get("prioridades/precios-programas")
  async obtenerPrioridadesPreciosProgramas() {
    return this.omieSiom2ClientService.obtenerPrioridadesPreciosProgramas();
  }

  @Get("precios/informe")
  async generarInformePreciosMercado(@Query("fecha") fecha?: string) {
    return this.omieSiom2ClientService.generarInformePreciosMercado(fecha?.trim() || undefined);
  }

  @Get("cuartohorario/candidatas")
  async obtenerCandidatasCuartohorario() {
    return this.omieSiom2ClientService.obtenerCandidatasCuartohorario();
  }

  @Get("descargas/candidatas")
  async obtenerCandidatasDescargas() {
    return this.omieSiom2ClientService.obtenerCandidatasDescargas();
  }

  @Get("descargas/pdbc-candidatas")
  async obtenerCandidatasPdbc() {
    return this.omieSiom2ClientService.obtenerCandidatasPdbcYProbar();
  }

  @Get("diagnostico/energia")
  async diagnosticoEnergia() {
    return this.omieSiom2ClientService.diagnosticarEnergia();
  }

  @Get("certificate-info")
  async getCertificateInfo() {
    return this.omieSiom2ClientService.getCertificateInfo();
  }
}

function parseBooleanQuery(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "si";
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

function parseParametrosBody(body: unknown): Record<string, string> {
  if (body === undefined || body === null) {
    return {};
  }
  if (!isRecord(body)) {
    throw new BadRequestException("El body debe ser un objeto JSON.");
  }

  const parametros = body.parametros;
  if (parametros === undefined || parametros === null) {
    return {};
  }
  if (!isRecord(parametros)) {
    throw new BadRequestException("body.parametros debe ser un objeto JSON.");
  }

  return Object.fromEntries(
    Object.entries(parametros).map(([key, value]) => {
      if (value === undefined || value === null) {
        throw new BadRequestException(`El parametro ${key} no puede ser null.`);
      }

      return [key, String(value)];
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
