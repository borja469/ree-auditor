import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Resolver, lookup as dnsLookup } from "node:dns";
import type { LookupAddress, LookupOptions } from "node:dns";
import { Agent, request as httpsRequest } from "node:https";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { URL } from "node:url";
import type {
  OmieCatalogoFuncionalAnalizado,
  OmieCatalogoPrioridades,
  OmieConsultaCatalogoItem,
  OmieConsultaEncolumnadaResult,
  OmieConsultasCatalogo,
  OmieConsultasCatalogoResumen,
  OmieDescargaXmlResultado,
  OmieDescargasCandidata,
  OmieDescargasPdbcCandidatasReport,
  OmieDescargasPdbcPrueba,
  OmieCuartohorarioCandidata,
  OmieDiagnosticoEnergiaReport,
  OmieDiagnosticoEnergiaResultado,
  OmieDiagnosticoEnergiaParametro,
  OmiePrecioMercado,
  OmiePrecioMercadoCandidata,
  OmiePrecioMercadoEjecucion,
  OmiePreciosMercadoReport,
  OmiePreciosProgramasReport,
  OmieSiom2CertificateInfoResult,
  OmieSiom2ConnectionConfig,
  OmieSiom2HeaderValue,
  OmieSiom2ParsedServiceResponse,
  OmieSiom2RawResponse,
  OmieSiom2RequestOptions,
  OmieSiom2Response,
  OmieSiom2TestJsonResponse
} from "./omie-siom2.types";
import { loadOmiePkcs12Identity } from "./certificates/omie-pkcs12-loader";
import { analizarCatalogoOmie } from "./omie-catalogo-analizador";
import { generarPrioridadesCatalogoOmie } from "./omie-catalogo-prioridades";
import { extractOmieConsultaEncolumnada } from "./omie-consulta-encolumnada.parser";
import { identificarConsultasDescargas } from "./omie-descargas";
import { identificarConsultasCuartohorarias } from "./omie-cuartohorario";
import {
  buildOmieEnergiaEvolucionResponse,
  buildOmieEnergiaPhfResponse,
  buildOmieEnergiaPvdResponse,
  OMIE_ENERGIA_PHF_CODIGO,
  OMIE_ENERGIA_PVD_CODIGO,
  OMIE_ENERGIA_STROM_UOFERTANTE,
  OMIE_ENERGIA_UMEDIDA,
  normalizeOmieEnergiaSesion,
  parseOmieEnergiaSesionList
} from "./omie-energia";
import type { OmieEnergiaEvolucionResponse, OmieEnergiaPhfResponse, OmieEnergiaPvdResponse } from "./omie-energia";
import { generarPreciosProgramasOmie } from "./omie-precios-programas";
import { identificarConsultasPreciosMercado } from "./omie-precios-mercado";
import {
  extractOmieConfiguracionConsulta,
  extractOmieDirectorioConsultas,
  type OmieConsultaDirectorioItem
} from "./omie-consultas-catalog.parser";
import { parseOmieXmlResponse } from "./omie-xml-response.parser";
import { OmieXmlSigner } from "./signature/omie-xml-signer";
import { OmieSoapBuilder } from "./soap/omie-soap-builder";

export const OMIE_SIOM2_DEFAULT_ENDPOINT = "https://www.mercado.omie.es/jsiom/webServices/SIOMServiceRouter";
const CONSULTA_DATOS_USUARIO_SERVICE = "ServicioConsultaDatosUsuario";
const CONSULTA_FECHA_HORA_SERVICE = "ServicioConsultaFechaHora";
const CONSULTA_MERCADOS_SERVICE = "ServicioConsultaMercados";
const CONSULTA_DIRECTORIO_CONSULTAS_SERVICE = "ServicioConsultaDirectorioConsultas";
const CONSULTA_CONFIGURACION_CONSULTA_SERVICE = "ServicioConsultaConfiguracionConsulta";
const EJECUCION_CONSULTA_ENCOLUMNADA_SERVICE = "ServicioEjecucionConsultaEncolumnada";
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_DNS_SERVERS = ["1.1.1.1", "8.8.8.8"];
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const DEFAULT_CATALOGO_RELATIVE_PATH = join("data", "omie-catalogo.json");
const DEFAULT_CATALOGO_ANALIZADO_FILENAME = "omie-catalogo-analizado.json";
const DEFAULT_CATALOGO_PRIORIDADES_FILENAME = "omie-catalogo-prioridades.json";
const DEFAULT_PRECIOS_PROGRAMAS_FILENAME = "omie-precios-programas.json";
const DEFAULT_PRECIOS_MERCADO_REPORT_FILENAME = "omie-precios-informe.json";
const DEFAULT_CUARTOHORARIO_FILENAME = "omie-cuartohorario.json";
const DEFAULT_DESCARGAS_PDBC_REPORT_FILENAME = "omie-descargas-pdbc-candidatas.json";
const DEFAULT_DIAGNOSTICO_ENERGIA_REPORT_FILENAME = "omie-diagnostico-energia.json";
const DEFAULT_PRECIOS_MERCADO_TEST_DATE = "2025-03-18";
const CATALOGO_CONFIG_MAX_ATTEMPTS = 2;
const CATALOGO_CONFIG_RETRY_DELAY_MS = 1000;

type OmieRequestTiming = {
  startedAt: number;
  dnsPrimaryStartAt?: number;
  dnsPrimaryEndAt?: number;
  dnsFallbackStartAt?: number;
  dnsFallbackEndAt?: number;
  connectStartAt?: number;
  connectEndAt?: number;
  firstResponseAt?: number;
  responseEndAt?: number;
  errorAt?: number;
  summaryLogged: boolean;
};

@Injectable()
export class OmieSiom2ClientService {
  private readonly logger = new Logger(OmieSiom2ClientService.name);
  private agent?: Agent;

  constructor(
    private readonly soapBuilder: OmieSoapBuilder,
    private readonly xmlSigner: OmieXmlSigner
  ) {}

  async createSignedSoapRequest(serviceName: string, xmlPayload?: string): Promise<string> {
    const config = this.readConfig();
    if (!config.p12Path && !config.p12Base64) {
      throw new OmieSiom2ConnectionError("OMIE SIOM2 PKCS12 certificate is not configured");
    }

    const soapXml = this.soapBuilder.buildEnvelope(serviceName, xmlPayload);
    const p12Buffer = this.loadPkcs12(config);

    return this.xmlSigner.signSoapEnvelope(soapXml, p12Buffer, config.p12Passphrase ?? "");
  }

  async invokeRaw(serviceName: string, xmlPayload?: string): Promise<OmieSiom2RawResponse> {
    const signedSoap = await this.createSignedSoapRequest(serviceName, xmlPayload);
    const response = await this.request({
      method: "POST",
      headers: this.createSoap11Headers(""),
      body: signedSoap,
      traceLabel: describeOmieTrace(serviceName, xmlPayload)
    });

    return {
      statusCode: response.statusCode,
      headers: normalizeResponseHeaders(response.headers),
      body: response.body,
      rawBody: response.rawBody
    };
  }

  async testConnection(): Promise<{ statusCode: number; body: string }> {
    const response = await this.invokeRaw(CONSULTA_DATOS_USUARIO_SERVICE);
    return {
      statusCode: response.statusCode,
      body: response.body
    };
  }

  async testConnectionJson(): Promise<OmieSiom2TestJsonResponse> {
    return this.consultaDatosUsuario();
  }

  async consultaDatosUsuario(): Promise<OmieSiom2ParsedServiceResponse> {
    return this.invokeParsedService(CONSULTA_DATOS_USUARIO_SERVICE);
  }

  async consultaFechaHora(): Promise<OmieSiom2ParsedServiceResponse> {
    return this.invokeParsedService(CONSULTA_FECHA_HORA_SERVICE);
  }

  async consultaMercados(): Promise<OmieSiom2ParsedServiceResponse> {
    return this.invokeParsedService(CONSULTA_MERCADOS_SERVICE);
  }

  async consultaDirectorioConsultas(): Promise<OmieSiom2ParsedServiceResponse> {
    return this.invokeParsedService(CONSULTA_DIRECTORIO_CONSULTAS_SERVICE);
  }

  async consultaConfiguracionConsulta(codigoConsulta: string): Promise<OmieSiom2ParsedServiceResponse> {
    return this.invokeParsedService(CONSULTA_CONFIGURACION_CONSULTA_SERVICE, buildCodConsultaPayload(codigoConsulta));
  }

  async ejecutarConsultaEncolumnada(codigoConsulta: string, parametros: Record<string, string>): Promise<OmieConsultaEncolumnadaResult> {
    const consulta = await this.obtenerConsultaCatalogo(codigoConsulta);
    const response = await this.invokeParsedService(
      EJECUCION_CONSULTA_ENCOLUMNADA_SERVICE,
      buildEjecucionConsultaEncolumnadaPayload(codigoConsulta, parametros, consulta)
    );
    const tabla = extractOmieConsultaEncolumnada(response.xml);

    return {
      ...response,
      ...(tabla ?? {})
    };
  }

  async obtenerEnergiaPvd(fecha: string): Promise<OmieEnergiaPvdResponse> {
    const result = await this.ejecutarConsultaEncolumnada(OMIE_ENERGIA_PVD_CODIGO, {
      UOfertante: OMIE_ENERGIA_STROM_UOFERTANTE,
      FechaPrograma: fecha,
      UMedida: OMIE_ENERGIA_UMEDIDA
    });

    return buildOmieEnergiaPvdResponse(fecha, result);
  }

  async obtenerEnergiaPhf(fecha: string, sesion: string): Promise<OmieEnergiaPhfResponse> {
    const normalizedSesion = normalizeOmieEnergiaSesion(sesion);
    const result = await this.ejecutarConsultaEncolumnada(OMIE_ENERGIA_PHF_CODIGO, {
      UOfertante: OMIE_ENERGIA_STROM_UOFERTANTE,
      Fecha: fecha,
      Sesion: normalizedSesion,
      UMedida: OMIE_ENERGIA_UMEDIDA
    });

    return buildOmieEnergiaPhfResponse(fecha, normalizedSesion, result);
  }

  async obtenerEnergiaEvolucion(fecha: string): Promise<OmieEnergiaEvolucionResponse> {
    const pvd = await this.obtenerEnergiaPvd(fecha);
    const sesiones: OmieEnergiaPhfResponse[] = [];

    for (const sesion of parseOmieEnergiaSesionList(process.env.OMIE_ENERGIA_PHF_SESIONES)) {
      const phf = await this.obtenerEnergiaPhf(fecha, sesion);
      if (phf.periodos.length > 0) {
        sesiones.push(phf);
      }
    }

    return buildOmieEnergiaEvolucionResponse(fecha, pvd, sesiones);
  }

  async generarCatalogoConsultas(): Promise<OmieConsultasCatalogo> {
    const catalogPath = this.resolveCatalogoPath();
    const directorioResponse = await this.consultaDirectorioConsultas();
    const directorio = extractOmieDirectorioConsultas(directorioResponse.xml);
    const consultas: OmieConsultaCatalogoItem[] = [];
    let configuracionesConError = 0;

    this.logger.log(`OMIE SIOM2 catalogo: iniciando generacion para ${directorio.length} consultas.`);
    for (let index = 0; index < directorio.length; index += 1) {
      const consultaDirectorio = directorio[index];
      const consultaCatalogo = await this.enrichConsultaCatalogo(consultaDirectorio);
      if (consultaCatalogo.configuracion.error) {
        configuracionesConError += 1;
      }
      consultas.push(consultaCatalogo);

      const processed = index + 1;
      if (processed % 25 === 0 || processed === directorio.length) {
        this.logger.log(`OMIE SIOM2 catalogo: progreso ${processed}/${directorio.length}.`);
      }
    }

    const catalogo: OmieConsultasCatalogo = {
      generatedAt: new Date().toISOString(),
      catalogPath,
      source: {
        directorio: {
          serviceName: directorioResponse.serviceName,
          statusCode: directorioResponse.statusCode,
          xmlBytes: Buffer.byteLength(directorioResponse.xml, "utf8")
        },
        configuracionesConsultadas: directorio.length,
        configuracionesConError
      },
      resumen: buildCatalogoResumen(consultas),
      consultas
    };

    await writeJsonFile(catalogPath, catalogo);
    this.logger.log(`OMIE SIOM2 catalogo: generado y guardado en ${catalogPath}.`);
    return catalogo;
  }

  async obtenerCatalogoConsultas(options: { regenerar?: boolean } = {}): Promise<OmieConsultasCatalogo> {
    if (options.regenerar) {
      return this.generarCatalogoConsultas();
    }

    const catalogo = await readJsonFile<OmieConsultasCatalogo>(this.resolveCatalogoPath());
    return catalogo ?? this.generarCatalogoConsultas();
  }

  async obtenerConsultaCatalogo(codigoConsulta: string, options: { regenerar?: boolean } = {}) {
    const normalizedCodigo = codigoConsulta.trim();
    const catalogo = await this.obtenerCatalogoConsultas(options);
    return catalogo.consultas.find((consulta) => consulta.codigo === normalizedCodigo);
  }

  async obtenerResumenCatalogoConsultas(): Promise<OmieCatalogoFuncionalAnalizado> {
    const catalogPath = this.resolveCatalogoPath();
    const catalogo = await readJsonFile<OmieConsultasCatalogo>(catalogPath);
    if (!catalogo) {
      throw new OmieSiom2ConnectionError(`No existe el catalogo OMIE en ${catalogPath}. Genera primero /omie/catalogo-consultas?regenerar=true.`);
    }

    const analyzedPath = this.resolveCatalogoAnalizadoPath(catalogPath);
    const analisis = analizarCatalogoOmie(catalogo, {
      sourceCatalogPath: catalogPath,
      analyzedPath
    });
    await writeJsonFile(analyzedPath, analisis);

    return analisis;
  }

  async obtenerPrioridadesCatalogoConsultas(): Promise<OmieCatalogoPrioridades> {
    const catalogPath = this.resolveCatalogoPath();
    const analyzedPath = this.resolveCatalogoAnalizadoPath(catalogPath);
    const analisis = await readJsonFile<OmieCatalogoFuncionalAnalizado>(analyzedPath);
    if (!analisis) {
      throw new OmieSiom2ConnectionError(`No existe el catalogo OMIE analizado en ${analyzedPath}. Genera primero /omie/catalogo-resumen.`);
    }

    const prioridadesPath = this.resolveCatalogoPrioridadesPath(analyzedPath);
    const prioridades = generarPrioridadesCatalogoOmie(analisis, {
      sourceAnalyzedPath: analyzedPath,
      prioridadesPath
    });
    await writeJsonFile(prioridadesPath, prioridades);

    return prioridades;
  }

  async obtenerPrioridadesPreciosProgramas(): Promise<OmiePreciosProgramasReport> {
    const catalogPath = this.resolveCatalogoPath();
    const catalogo = await readJsonFile<OmieConsultasCatalogo>(catalogPath);
    if (!catalogo) {
      throw new OmieSiom2ConnectionError(`No existe el catalogo OMIE en ${catalogPath}.`);
    }

    const analyzedPath = this.resolveCatalogoAnalizadoPath(catalogPath);
    const prioridadesPath = this.resolveCatalogoPrioridadesPath(analyzedPath);
    const prioridades = await readJsonFile<OmieCatalogoPrioridades>(prioridadesPath);
    if (!prioridades) {
      throw new OmieSiom2ConnectionError(`No existe el catalogo OMIE de prioridades en ${prioridadesPath}. Genera primero /omie/catalogo-prioridades.`);
    }

    const outputPath = this.resolvePreciosProgramasPath(catalogPath);
    const report = generarPreciosProgramasOmie(prioridades, catalogo, {
      sourcePrioridadesPath: prioridadesPath,
      sourceCatalogPath: catalogPath,
      outputPath
    });
    await writeJsonFile(outputPath, report);

    return report;
  }

  async generarInformePreciosMercado(fechaPrueba = DEFAULT_PRECIOS_MERCADO_TEST_DATE): Promise<OmiePreciosMercadoReport> {
    const catalogPath = this.resolveCatalogoPath();
    const preciosProgramasPath = this.resolvePreciosProgramasPath(catalogPath);
    const preciosProgramas = await readJsonFile<OmiePreciosProgramasReport>(preciosProgramasPath);
    if (!preciosProgramas) {
      throw new OmieSiom2ConnectionError(`No existe el informe OMIE de precios/programas en ${preciosProgramasPath}. Genera primero /omie/prioridades/precios-programas.`);
    }

    const candidatas = identificarConsultasPreciosMercado(preciosProgramas);
    const outputPath = this.resolvePreciosMercadoReportPath(catalogPath);
    const ejecuciones = await this.ejecutarCandidatasSoloFecha(candidatas, fechaPrueba);
    const report: OmiePreciosMercadoReport = {
      generatedAt: new Date().toISOString(),
      fechaPrueba,
      sourcePreciosProgramasPath: preciosProgramasPath,
      outputPath,
      mercadoDiario: candidatas.mercadoDiario,
      mercadoIntradiario: candidatas.mercadoIntradiario,
      ejecuciones
    };

    await writeJsonFile(outputPath, report);
    return report;
  }

  async obtenerCandidatasCuartohorario(): Promise<OmieCuartohorarioCandidata[]> {
    const catalogPath = this.resolveCatalogoPath();
    const catalogo = await readJsonFile<OmieConsultasCatalogo>(catalogPath);
    if (!catalogo) {
      throw new OmieSiom2ConnectionError(`No existe el catalogo OMIE en ${catalogPath}.`);
    }

    const outputPath = this.resolveCuartohorarioPath(catalogPath);
    const candidatas = identificarConsultasCuartohorarias(catalogo);
    await writeJsonFile(outputPath, candidatas);

    return candidatas;
  }

  async diagnosticarEnergia(): Promise<OmieDiagnosticoEnergiaReport> {
    const catalogPath = this.resolveCatalogoPath();
    const catalogo = await readJsonFile<OmieConsultasCatalogo>(catalogPath);
    if (!catalogo) {
      throw new OmieSiom2ConnectionError(`No existe el catalogo OMIE en ${catalogPath}.`);
    }

    const outputPath = this.resolveDiagnosticoEnergiaPath(catalogPath);
    const pruebasPath = this.resolveDiagnosticoEnergiaPruebasPath(catalogPath);
    const consultasObjetivo = ["5302", "5608", "4121"];
    const consultas: OmieDiagnosticoEnergiaResultado[] = [];

    for (const codigo of consultasObjetivo) {
      const consulta = catalogo.consultas.find((item) => item.codigo === codigo);
      if (!consulta) {
        consultas.push({
          codigo,
          descripcion: undefined,
          parametros: { obligatorios: [], opcionales: [] },
          tipoRespuesta: "Otro",
          tamaño: 0,
          columnas: 0,
          filas: 0,
          estructuraXML: {
            clasificacion: "otro",
            etiquetasDetectadas: []
          }
        });
        continue;
      }

      consultas.push(await this.diagnosticarConsultaEnergia(consulta, pruebasPath));
    }

    const report: OmieDiagnosticoEnergiaReport = {
      generatedAt: new Date().toISOString(),
      sourceCatalogPath: catalogPath,
      outputPath,
      pruebasPath,
      consultas
    };

    await writeJsonFile(outputPath, report);
    return report;
  }

  async obtenerCandidatasDescargas(): Promise<OmieDescargasCandidata[]> {
    const catalogPath = this.resolveCatalogoPath();
    const catalogo = await readJsonFile<OmieConsultasCatalogo>(catalogPath);
    if (!catalogo) {
      throw new OmieSiom2ConnectionError(`No existe el catalogo OMIE en ${catalogPath}.`);
    }

    return identificarConsultasDescargas(catalogo);
  }

  async obtenerCandidatasPdbcYProbar(options: {
    fecha?: string;
    version?: string;
    agente?: string;
    maxPruebas?: number;
  } = {}): Promise<OmieDescargasPdbcCandidatasReport> {
    const fecha = options.fecha ?? "2026-04-15";
    const version = options.version ?? "1";
    const agente = options.agente ?? "STROM";
    const maxPruebas = Math.min(Math.max(options.maxPruebas ?? 5, 1), 5);

    const catalogPath = this.resolveCatalogoPath();
    const catalogo = await readJsonFile<OmieConsultasCatalogo>(catalogPath);
    if (!catalogo) {
      throw new OmieSiom2ConnectionError(`No existe el catalogo OMIE en ${catalogPath}.`);
    }

    const candidatas = identificarConsultasDescargas(catalogo);
    const compatibles = candidatas.filter((consulta) => tieneParametrosPdbcCompatibles(consulta));
    const aProbar = compatibles.slice(0, maxPruebas);
    const probadas: OmieDescargasPdbcPrueba[] = [];

    for (const candidata of aProbar) {
      probadas.push(await this.probarCandidataDescargaPdbc(candidata, { fecha, version, agente }));
    }

    const outputPath = this.resolveDescargasPdbcReportPath(catalogPath);
    const report: OmieDescargasPdbcCandidatasReport = {
      generatedAt: new Date().toISOString(),
      fechaPrueba: fecha,
      versionPrueba: version,
      agentePrueba: agente,
      sourceCatalogPath: catalogPath,
      outputPath,
      candidatas,
      probadas
    };

    await writeJsonFile(outputPath, report);
    return report;
  }

  async descargarXmlConsulta(
    codigoConsulta: string,
    parametros: Record<string, string>,
    outputDir = join(process.cwd(), "data", "omie-downloads")
  ): Promise<OmieDescargaXmlResultado> {
    const consulta = await this.obtenerConsultaCatalogo(codigoConsulta);
    if (!consulta) {
      throw new OmieSiom2ConnectionError(`No existe la consulta OMIE ${codigoConsulta} en el catalogo.`);
    }
    if (consulta.tipoConsulta !== "ANEXO") {
      throw new OmieSiom2ConnectionError(`La consulta ${codigoConsulta} no es de tipo ANEXO y no puede descargarse como XML con este flujo.`);
    }

    const serviceName = "ServicioEjecucionConsultaAnexo";
    const response = await this.invokeRaw(serviceName, buildEjecucionConsultaEncolumnadaPayload(codigoConsulta, parametros, consulta));
    const extracted = extractXmlDownload(response, consulta, codigoConsulta);
    await mkdir(outputDir, { recursive: true });

    const fileName = sanitizeFileName(extracted.fileName ?? `${codigoConsulta}.xml`);
    const outputPath = join(outputDir, fileName);
    await writeFile(outputPath, extracted.content, "utf8");

    return {
      codigo: codigoConsulta,
      descripcion: consulta.descripcion,
      serviceName,
      statusCode: response.statusCode,
      fileName,
      outputPath,
      contentType: extracted.contentType,
      contentBytes: Buffer.byteLength(extracted.content, "utf8")
    };
  }

  async getCertificateInfo(): Promise<OmieSiom2CertificateInfoResult> {
    this.logRuntime("node-forge PKCS12 certificate-info");
    try {
      this.logger.log("OMIE SIOM2 PKCS12 diagnostic: loading certificate bytes for node-forge inspection.");
      const config = this.readConfig();
      const p12Buffer = this.loadPkcs12(config);
      const identity = loadOmiePkcs12Identity(p12Buffer, config.p12Passphrase ?? "");

      this.logPkcs12IdentityDebug(identity);
      return {
        ok: true,
        nodeVersion: process.version,
        opensslVersion: process.versions.openssl ?? "unknown",
        selectedCertificate: identity.selectedCertificate,
        certificates: identity.certificates
      };
    } catch (error) {
      this.logger.error(`OMIE SIOM2 PKCS12 diagnostic: node-forge inspection failed at ${diagnosticErrorPoint(error)}.`);
      return {
        ok: false,
        nodeVersion: process.version,
        opensslVersion: process.versions.openssl ?? "unknown",
        error: serializeError(error)
      };
    }
  }

  async request(options: OmieSiom2RequestOptions = {}): Promise<OmieSiom2Response> {
    const config = this.readConfig();
    const url = this.resolveUrl(config.endpoint, options);
    const host = url.host;
    const traceLabel = options.traceLabel ?? "unknown";
    const body = normalizeBody(options.body);
    const headers = normalizeHeaders(options.headers);
    const startedAt = Date.now();
    const attemptDelaysMs = [0, 2000, 5000];
    let lastError: unknown;

    if (options.soapAction !== undefined) {
      headers.SOAPAction = options.soapAction;
    }
    if (body && headers["Content-Type"] === undefined && headers["content-type"] === undefined) {
      headers["Content-Type"] = "text/xml; charset=utf-8";
    }
    if (body && headers["Content-Length"] === undefined && headers["content-length"] === undefined) {
      headers["Content-Length"] = body.byteLength;
    }

    for (let attempt = 1; attempt <= attemptDelaysMs.length; attempt += 1) {
      if (attempt > 1) {
        const delayMs = attemptDelaysMs[attempt - 1];
        this.logger.warn(`OMIE SIOM2 HTTPS retry: host=${host} attempt=${attempt}/3 error=${serializeError(lastError).name}:${serializeError(lastError).message} delayMs=${delayMs}.`);
        await delay(delayMs);
      }

      this.logger.log(`OMIE SIOM2 HTTPS attempt: query=${traceLabel} host=${host} attempt=${attempt}/3 method=${options.method ?? "POST"}.`);

      try {
        const timing = createRequestTiming();
        this.logger.log(`OMIE timing phase=requestStart query=${traceLabel} host=${host} attempt=${attempt}/3 timestamp=${new Date(timing.startedAt).toISOString()}.`);
        const response = await this.executeRequestOnce(url, {
          agent: this.getAgent(config),
          method: options.method ?? "POST",
          headers,
          lookup: this.createDnsFallbackLookup(config, timing, traceLabel, host, attempt),
          timeout: options.timeoutMs ?? config.timeoutMs
        }, body, options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, timing, traceLabel, host, attempt);

        this.logger.log(`OMIE SIOM2 HTTPS success: query=${traceLabel} host=${host} attempt=${attempt}/3 durationMs=${Date.now() - startedAt}.`);
        return response;
      } catch (error) {
        lastError = error;
        const errorCode = this.getNodeErrorCode(error);
        this.logger.error(
          `OMIE SIOM2 HTTPS diagnostic: request error after https.request: host=${host} attempt=${attempt}/3 code=${errorCode ?? "unknown"} error=${error instanceof Error ? error.name : "NonError"}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined
        );

        if (attempt < attemptDelaysMs.length && this.isRetriableRequestError(error)) {
          continue;
        }

        this.logger.error(`OMIE SIOM2 HTTPS final failure: host=${host} attempts=${attempt}/3 durationMs=${Date.now() - startedAt} code=${errorCode ?? "unknown"}.`);
        throw error;
      }
    }

    throw lastError instanceof Error ? lastError : new OmieSiom2ConnectionError("OMIE SIOM2 request failed.");
  }

  createSoap11Headers(soapAction = "") {
    return {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: soapAction
    };
  }

  private getAgent(config: OmieSiom2ConnectionConfig) {
    if (!this.agent) {
      this.logRuntime("TLS cert/key PEM load");
      this.logger.log("OMIE SIOM2 PKCS12 diagnostic: loading PKCS12 bytes for HTTPS mTLS agent via node-forge.");
      const p12Buffer = this.loadPkcs12(config);
      const identity = loadOmiePkcs12Identity(p12Buffer, config.p12Passphrase ?? "");

      this.logPkcs12IdentityDebug(identity);
      this.logger.log("OMIE SIOM2 PKCS12 diagnostic: creating HTTPS mTLS agent with PEM cert/key extracted by node-forge.");

      this.agent = new Agent({
        keepAlive: true,
        minVersion: "TLSv1.2",
        cert: identity.certificatePem,
        key: identity.privateKeyPem,
        ca: identity.caPem.length > 0 ? identity.caPem : undefined,
        rejectUnauthorized: config.rejectUnauthorized
      });
    }

    return this.agent;
  }

  private loadPkcs12(config: OmieSiom2ConnectionConfig) {
    if (config.p12Base64) {
      this.logger.log("OMIE SIOM2 PKCS12 diagnostic: loadPkcs12 source=OMIE_SIOM2_P12_BASE64.");
      const content = config.p12Base64.replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
      const decoded = Buffer.from(content, "base64");
      if (decoded.byteLength === 0) {
        throw new OmieSiom2ConnectionError("OMIE_SIOM2_P12_BASE64 esta configurado pero no contiene un PKCS12 valido.");
      }
      this.logger.log(`OMIE SIOM2 PKCS12 diagnostic: loadPkcs12 base64 decoded, bytes=${decoded.byteLength}.`);
      return decoded;
    }

    if (config.p12Path) {
      try {
        this.logger.log(`OMIE SIOM2 PKCS12 diagnostic: loadPkcs12 source=OMIE_SIOM2_P12_PATH path=${config.p12Path}.`);
        const p12Buffer = readFileSync(config.p12Path);
        this.logger.log(`OMIE SIOM2 PKCS12 diagnostic: loadPkcs12 file read succeeded, bytes=${p12Buffer.byteLength}.`);
        return p12Buffer;
      } catch (error) {
        this.logger.error(`OMIE SIOM2 PKCS12 diagnostic: loadPkcs12 file read failed: ${serializeError(error).name}: ${serializeError(error).message}`);
        throw new OmieSiom2ConnectionError(
          `No se pudo leer el certificado PKCS12 de OMIE_SIOM2_P12_PATH (${config.p12Path}): ${error instanceof Error ? error.message : "error desconocido"}`
        );
      }
    }

    throw new OmieSiom2ConnectionError("Falta certificado PKCS12. Configura OMIE_SIOM2_P12_PATH u OMIE_SIOM2_P12_BASE64.");
  }

  private readConfig(): OmieSiom2ConnectionConfig {
    return {
      endpoint: nonEmpty(process.env.OMIE_SIOM2_ENDPOINT) ?? OMIE_SIOM2_DEFAULT_ENDPOINT,
      p12Path: nonEmpty(process.env.OMIE_SIOM2_P12_PATH),
      p12Base64: nonEmpty(process.env.OMIE_SIOM2_P12_BASE64),
      p12Passphrase: process.env.OMIE_SIOM2_P12_PASSPHRASE,
      rejectUnauthorized: process.env.OMIE_SIOM2_REJECT_UNAUTHORIZED?.toLowerCase() !== "false",
      dnsServers: parseDnsServers(process.env.OMIE_SIOM2_DNS_SERVERS) ?? DEFAULT_DNS_SERVERS,
      timeoutMs: positiveInteger(process.env.OMIE_SIOM2_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS
    };
  }

  private resolveUrl(endpoint: string, options: OmieSiom2RequestOptions) {
    const url = new URL(options.url ?? options.path ?? endpoint, endpoint);
    if (url.protocol !== "https:") {
      throw new OmieSiom2ConnectionError(`El endpoint SIOM2 debe usar HTTPS: ${url.href}`);
    }
    return url;
  }

  private executeRequestOnce(
    url: URL,
    requestOptions: {
      agent: Agent;
      method: string;
      headers: Record<string, string | number>;
      lookup?: (hostname: string, options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => void;
      timeout: number;
    },
    body: Buffer | undefined,
    maxResponseBytes: number,
    timing: OmieRequestTiming,
    traceLabel: string,
    host: string,
    attempt: number
  ) {
    return new Promise<OmieSiom2Response>((resolve, reject) => {
      const request = httpsRequest(
        url,
        requestOptions,
        (response) => {
          timing.firstResponseAt = Date.now();
          this.logger.log(
            `OMIE timing phase=firstResponse query=${traceLabel} host=${host} attempt=${attempt}/3 elapsedMs=${timing.firstResponseAt - timing.startedAt}.`
          );
          const chunks: Buffer[] = [];
          let bytes = 0;

          response.on("data", (chunk: Buffer) => {
            bytes += chunk.byteLength;
            if (bytes > maxResponseBytes) {
              request.destroy(new OmieSiom2ConnectionError(`Respuesta SIOM2 demasiado grande: supera ${maxResponseBytes} bytes.`));
              return;
            }
            chunks.push(chunk);
          });

          response.on("end", () => {
            timing.responseEndAt = Date.now();
            logOmieTimingSummary(this.logger, timing, traceLabel, host, attempt);
            const rawBody = Buffer.concat(chunks);
            resolve({
              statusCode: response.statusCode ?? 0,
              statusMessage: response.statusMessage ?? "",
              headers: response.headers,
              body: rawBody.toString("utf8"),
              rawBody
            });
          });
        }
      );

      request.on("socket", (socket) => {
        socket.once("lookup", () => {
          timing.connectStartAt = Date.now();
          this.logger.log(`OMIE timing phase=httpsConnectStart query=${traceLabel} host=${host} attempt=${attempt}/3 timestamp=${new Date(timing.connectStartAt).toISOString()}.`);
        });
        socket.once("secureConnect", () => {
          timing.connectEndAt = Date.now();
          timing.connectStartAt ??= timing.connectEndAt;
          this.logger.log(
            `OMIE timing phase=httpsConnectEnd query=${traceLabel} host=${host} attempt=${attempt}/3 durationMs=${phaseDuration(timing.connectStartAt, timing.connectEndAt)}.`
          );
        });
      });
      request.on("timeout", () => {
        const timeoutError = new OmieSiom2ConnectionError(
          `Timeout conectando con SIOM2 tras ${requestOptions.timeout} ms.`
        ) as Error & { code?: string };
        timeoutError.code = "ETIMEDOUT";
        request.destroy(timeoutError);
      });
      request.on("error", (error) => {
        timing.errorAt = Date.now();
        logOmieTimingSummary(this.logger, timing, traceLabel, host, attempt);
        reject(error);
      });

      if (body) {
        request.write(body);
      }
      request.end();
    });
  }

  private isRetriableRequestError(error: unknown) {
    const code = this.getNodeErrorCode(error);
    return code === "EAI_AGAIN" || code === "ENOTFOUND" || code === "ECONNRESET" || code === "ETIMEDOUT";
  }

  private getNodeErrorCode(error: unknown) {
    if (!isNodeError(error)) {
      return undefined;
    }
    return typeof error.code === "string" ? error.code : undefined;
  }

  private createDnsFallbackLookup(config: OmieSiom2ConnectionConfig, timing: OmieRequestTiming, traceLabel: string, host: string, attempt: number) {
    if (config.dnsServers.length === 0) {
      return undefined;
    }

    return (hostname: string, options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => {
      const lookupOptions: LookupOptions = typeof options === "object" && options !== null ? options : {};
      const wantsAll = "all" in lookupOptions && lookupOptions.all === true;

      timing.dnsPrimaryStartAt = Date.now();
      this.logger.log(`OMIE timing phase=dnsPrimaryStart query=${traceLabel} host=${host} attempt=${attempt}/3 timestamp=${new Date(timing.dnsPrimaryStartAt).toISOString()}.`);
      dnsLookup(hostname, lookupOptions, (error, address, family) => {
        timing.dnsPrimaryEndAt = Date.now();
        this.logger.log(
          `OMIE timing phase=dnsPrimaryEnd query=${traceLabel} host=${host} attempt=${attempt}/3 durationMs=${phaseDuration(timing.dnsPrimaryStartAt, timing.dnsPrimaryEndAt)} code=${error ? this.getNodeErrorCode(error) ?? "unknown" : "OK"}.`
        );
        if (!error) {
          callback(null, address, family);
          return;
        }

        const code = this.getNodeErrorCode(error);
        if (code !== "EAI_AGAIN" && code !== "ENOTFOUND") {
          callback(error, "", 0);
          return;
        }

        const resolver = new Resolver();
        resolver.setServers(config.dnsServers);
        timing.dnsFallbackStartAt = Date.now();
        this.logger.warn(`OMIE timing phase=dnsFallbackStart query=${traceLabel} host=${host} attempt=${attempt}/3 servers=${config.dnsServers.join(",")}.`);
        resolver.resolve4(hostname, (fallbackError, addresses) => {
          timing.dnsFallbackEndAt = Date.now();
          this.logger.warn(
            `OMIE timing phase=dnsFallbackEnd query=${traceLabel} host=${host} attempt=${attempt}/3 durationMs=${phaseDuration(timing.dnsFallbackStartAt, timing.dnsFallbackEndAt)} code=${fallbackError instanceof Error ? this.getNodeErrorCode(fallbackError) ?? fallbackError.name : "OK"}.`
          );
          if (fallbackError || addresses.length === 0) {
            this.logger.warn(
              `OMIE SIOM2 DNS fallback failed: host=${hostname} code=${code} servers=${config.dnsServers.join(",")} fallback=${fallbackError instanceof Error ? fallbackError.message : "empty response"}.`
            );
            callback(error, "", 0);
            return;
          }

          this.logger.warn(`OMIE SIOM2 DNS fallback resolved: host=${hostname} code=${code} address=${addresses[0]} servers=${config.dnsServers.join(",")}.`);
          callback(null, wantsAll ? [{ address: addresses[0], family: 4 }] : addresses[0], wantsAll ? undefined : 4);
        });
      });
    };
  }

  private logRuntime(context: string) {
    this.logger.log(`OMIE SIOM2 diagnostic runtime (${context}): node=${process.version}, openssl=${process.versions.openssl ?? "unknown"}.`);
  }

  private logPkcs12IdentityDebug(identity: ReturnType<typeof loadOmiePkcs12Identity>) {
    this.logger.debug(`OMIE SIOM2 PKCS12 diagnostic: certificates found=${identity.certificates.length}.`);
    this.logger.debug(`OMIE SIOM2 PKCS12 diagnostic: TLS certificate selected index=${identity.selectedCertificate.index}.`);
    this.logger.debug(`OMIE SIOM2 PKCS12 diagnostic: TLS subject=${identity.selectedCertificate.subject}.`);
    this.logger.debug(`OMIE SIOM2 PKCS12 diagnostic: TLS issuer=${identity.selectedCertificate.issuer}.`);
    this.logger.debug(`OMIE SIOM2 PKCS12 diagnostic: TLS serial=${identity.selectedCertificate.serialNumber}.`);
  }

  private async invokeParsedService(serviceName: string, xmlPayload?: string): Promise<OmieSiom2ParsedServiceResponse> {
    const response = await this.invokeRaw(serviceName, xmlPayload);
    this.logger.debug(
      `OMIE SIOM2 ${serviceName} response statusCode=${response.statusCode}, xmlBytes=${Buffer.byteLength(response.body, "utf8")}.`
    );

    return {
      serviceName,
      statusCode: response.statusCode,
      xml: response.body,
      json: parseOmieXmlResponse(response.body)
    };
  }

  private async enrichConsultaCatalogo(consultaDirectorio: OmieConsultaDirectorioItem): Promise<OmieConsultaCatalogoItem> {
    try {
      const configuracionResponse = await this.consultaConfiguracionConsultaWithRetry(consultaDirectorio.codigo);
      const configuracion = extractOmieConfiguracionConsulta(configuracionResponse.xml);

      return {
        codigo: configuracion.codigo ?? consultaDirectorio.codigo,
        descripcion: configuracion.descripcion ?? consultaDirectorio.descripcion,
        categoria: configuracion.categoria ?? consultaDirectorio.categoria,
        version: configuracion.version ?? consultaDirectorio.version,
        tipoConsulta: configuracion.tipoConsulta ?? consultaDirectorio.tipoConsulta,
        parametros: configuracion.parametros,
        columnas: configuracion.columnas,
        configuracion: {
          serviceName: configuracionResponse.serviceName,
          statusCode: configuracionResponse.statusCode,
          xmlBytes: Buffer.byteLength(configuracionResponse.xml, "utf8")
        }
      };
    } catch (error) {
      const serialized = serializeError(error);
      this.logger.warn(`OMIE SIOM2 catalogo: error configurando codigo=${consultaDirectorio.codigo}: ${serialized.name}: ${serialized.message}`);

      return {
        codigo: consultaDirectorio.codigo,
        descripcion: consultaDirectorio.descripcion,
        categoria: consultaDirectorio.categoria,
        version: consultaDirectorio.version,
        tipoConsulta: consultaDirectorio.tipoConsulta,
        parametros: [],
        columnas: [],
        configuracion: {
          serviceName: CONSULTA_CONFIGURACION_CONSULTA_SERVICE,
          statusCode: 0,
          xmlBytes: 0,
          error: {
            name: serialized.name,
            message: serialized.message
          }
        }
      };
    }
  }

  private async consultaConfiguracionConsultaWithRetry(codigoConsulta: string) {
    let lastError: unknown;

    for (let attempt = 1; attempt <= CATALOGO_CONFIG_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.consultaConfiguracionConsulta(codigoConsulta);
      } catch (error) {
        lastError = error;
        const serialized = serializeError(error);
        this.logger.warn(
          `OMIE SIOM2 catalogo: intento ${attempt}/${CATALOGO_CONFIG_MAX_ATTEMPTS} fallido para codigo=${codigoConsulta}: ${serialized.name}: ${serialized.message}`
        );

        if (attempt < CATALOGO_CONFIG_MAX_ATTEMPTS) {
          await delay(CATALOGO_CONFIG_RETRY_DELAY_MS);
        }
      }
    }

    throw lastError;
  }

  private resolveCatalogoPath() {
    return nonEmpty(process.env.OMIE_CATALOGO_PATH) ?? join(process.cwd(), DEFAULT_CATALOGO_RELATIVE_PATH);
  }

  private resolveCatalogoAnalizadoPath(catalogPath: string) {
    return nonEmpty(process.env.OMIE_CATALOGO_ANALIZADO_PATH) ?? join(dirname(catalogPath), DEFAULT_CATALOGO_ANALIZADO_FILENAME);
  }

  private resolveCatalogoPrioridadesPath(analyzedPath: string) {
    return nonEmpty(process.env.OMIE_CATALOGO_PRIORIDADES_PATH) ?? join(dirname(analyzedPath), DEFAULT_CATALOGO_PRIORIDADES_FILENAME);
  }

  private resolvePreciosProgramasPath(catalogPath: string) {
    return nonEmpty(process.env.OMIE_PRECIOS_PROGRAMAS_PATH) ?? join(dirname(catalogPath), DEFAULT_PRECIOS_PROGRAMAS_FILENAME);
  }

  private resolvePreciosMercadoReportPath(catalogPath: string) {
    return nonEmpty(process.env.OMIE_PRECIOS_MERCADO_REPORT_PATH) ?? join(dirname(catalogPath), DEFAULT_PRECIOS_MERCADO_REPORT_FILENAME);
  }

  private resolveCuartohorarioPath(catalogPath: string) {
    return nonEmpty(process.env.OMIE_CUARTOHORARIO_PATH) ?? join(dirname(catalogPath), DEFAULT_CUARTOHORARIO_FILENAME);
  }

  private resolveDescargasPdbcReportPath(catalogPath: string) {
    return nonEmpty(process.env.OMIE_DESCARGAS_PDBC_REPORT_PATH) ?? join(dirname(catalogPath), DEFAULT_DESCARGAS_PDBC_REPORT_FILENAME);
  }

  private resolveDiagnosticoEnergiaPath(catalogPath: string) {
    return nonEmpty(process.env.OMIE_DIAGNOSTICO_ENERGIA_PATH) ?? join(dirname(catalogPath), DEFAULT_DIAGNOSTICO_ENERGIA_REPORT_FILENAME);
  }

  private resolveDiagnosticoEnergiaPruebasPath(catalogPath: string) {
    return nonEmpty(process.env.OMIE_DIAGNOSTICO_ENERGIA_PRUEBAS_PATH) ?? join(dirname(catalogPath), "omie-pruebas");
  }

  private async diagnosticarConsultaEnergia(
    consulta: OmieConsultaCatalogoItem,
    pruebasPath: string
  ): Promise<OmieDiagnosticoEnergiaResultado> {
    const parametrosClasificados = clasificarParametrosConsulta(consulta.parametros);
    const parametrosPrueba = construirParametrosPruebaEnergia(consulta.codigo, parametrosClasificados.obligatorios);
    const resultPath = join(pruebasPath, consulta.codigo);
    await mkdir(resultPath, { recursive: true });

    const serviceName = consulta.tipoConsulta === "ANEXO" ? "ServicioEjecucionConsultaAnexo" : "ServicioEjecucionConsultaEncolumnada";
    const xmlPayload = buildEjecucionConsultaEncolumnadaPayload(consulta.codigo, parametrosPrueba, consulta);
    const response = await this.invokeRaw(serviceName, xmlPayload);
    const rawXml = response.body;
    await writeFile(join(resultPath, "respuesta-soap-original.xml"), rawXml, "utf8");
    await writeFile(join(resultPath, "respuesta-xml-original.xml"), rawXml, "utf8");

    const estructura = diagnosticarRespuestaEnergia(response, consulta, rawXml);
    const metadata: OmieDiagnosticoEnergiaResultado = {
      codigo: consulta.codigo,
      descripcion: consulta.descripcion,
      parametros: parametrosClasificados,
      tipoRespuesta: estructura.tipoRespuesta,
      nombreFichero: estructura.nombreFichero,
      tamaño: estructura.tamaño,
      columnas: estructura.columnas,
      filas: estructura.filas,
      primeraFila: estructura.primeraFila,
      estructuraXML: {
        clasificacion: estructura.clasificacion,
        etiquetasDetectadas: estructura.etiquetasDetectadas,
        contentType: estructura.contentType
      }
    };

    await writeJsonFile(join(resultPath, "metadata.json"), metadata);
    return metadata;
  }

  private async probarCandidataDescargaPdbc(
    candidata: OmieDescargasCandidata,
    parametros: { fecha: string; version: string; agente: string }
  ): Promise<OmieDescargasPdbcPrueba> {
    const parametrosUsados = construirParametrosDescargaPdbc(candidata, parametros);
    const consulta = await this.obtenerConsultaCatalogo(candidata.codigo);

    if (!consulta) {
      return {
        codigo: candidata.codigo,
        descripcion: candidata.descripcion,
        categoria: candidata.categoria,
        statusCode: 0,
        contentBytes: 0,
        primerasEtiquetasXml: [],
        parametrosUsados,
        error: {
          name: "ConsultaNoEncontrada",
          message: `No existe la consulta OMIE ${candidata.codigo} en el catalogo.`
        }
      };
    }

    try {
      if (consulta.tipoConsulta === "ANEXO") {
        const result = await this.descargarXmlConsulta(candidata.codigo, parametrosUsados);
        const xml = await readFile(result.outputPath, "utf8");
        return {
          codigo: candidata.codigo,
          descripcion: candidata.descripcion,
          categoria: candidata.categoria,
          tipoConsulta: consulta.tipoConsulta,
          statusCode: result.statusCode,
          fileName: result.fileName,
          contentType: result.contentType,
          contentBytes: result.contentBytes,
          primerasEtiquetasXml: extraerPrimerasEtiquetasXml(xml),
          parametrosUsados
        };
      }

      const response = await this.ejecutarConsultaEncolumnada(candidata.codigo, parametrosUsados);
      const xml = response.xml ?? "";
      return {
        codigo: candidata.codigo,
        descripcion: candidata.descripcion,
        categoria: candidata.categoria,
        tipoConsulta: consulta.tipoConsulta,
        statusCode: response.statusCode,
        contentBytes: Buffer.byteLength(xml, "utf8"),
        primerasEtiquetasXml: extraerPrimerasEtiquetasXml(xml),
        parametrosUsados
      };
    } catch (error) {
      const serialized = serializeError(error);
      return {
        codigo: candidata.codigo,
        descripcion: candidata.descripcion,
        categoria: candidata.categoria,
        tipoConsulta: consulta.tipoConsulta,
        statusCode: 0,
        contentBytes: 0,
        primerasEtiquetasXml: [],
        parametrosUsados,
        error: {
          name: serialized.name,
          message: serialized.message
        }
      };
    }
  }

  private async ejecutarCandidatasSoloFecha(
    candidatas: { mercadoDiario: OmiePrecioMercadoCandidata[]; mercadoIntradiario: OmiePrecioMercadoCandidata[] },
    fechaPrueba: string
  ) {
    const ejecuciones: OmiePrecioMercadoEjecucion[] = [];
    for (const mercado of ["mercadoDiario", "mercadoIntradiario"] as const) {
      for (const candidata of candidatas[mercado].filter((consulta) => consulta.ejecutableSoloFecha)) {
        ejecuciones.push(await this.ejecutarCandidataSoloFecha(mercado, candidata, fechaPrueba));
      }
    }

    return ejecuciones;
  }

  private async ejecutarCandidataSoloFecha(
    mercado: OmiePrecioMercado,
    candidata: OmiePrecioMercadoCandidata,
    fechaPrueba: string
  ): Promise<OmiePrecioMercadoEjecucion> {
    const parametroFecha = candidata.parametrosRequeridos[0]?.nombre;
    if (!parametroFecha) {
      return {
        codigo: candidata.codigo,
        mercado,
        statusCode: 0,
        numeroFilas: 0,
        error: {
          name: "ParametroFechaNoEncontrado",
          message: "La candidata no tiene un parametro de fecha utilizable."
        }
      };
    }

    try {
      const response = await this.ejecutarConsultaEncolumnada(candidata.codigo, { [parametroFecha]: fechaPrueba });
      return {
        codigo: candidata.codigo,
        mercado,
        statusCode: response.statusCode,
        numeroFilas: response.filas?.length ?? 0,
        parametroFecha
      };
    } catch (error) {
      const serialized = serializeError(error);
      return {
        codigo: candidata.codigo,
        mercado,
        statusCode: 0,
        numeroFilas: 0,
        parametroFecha,
        error: {
          name: serialized.name,
          message: serialized.message
        }
      };
    }
  }
}

export class OmieSiom2ConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OmieSiom2ConnectionError";
  }
}

function normalizeBody(body: string | Buffer | undefined) {
  if (body === undefined) {
    return undefined;
  }
  return Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
}

function normalizeHeaders(headers: Record<string, OmieSiom2HeaderValue> | undefined) {
  return Object.fromEntries(
    Object.entries(headers ?? {})
      .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
      .map(([key, value]) => [key, typeof value === "boolean" ? String(value) : value])
  );
}

function normalizeResponseHeaders(headers: OmieSiom2Response["headers"]) {
  return Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined));
}

function diagnosticErrorPoint(error: unknown) {
  const stack = error instanceof Error ? (error.stack ?? "") : "";
  if (stack.includes("pkcs12FromAsn1")) {
    return "node-forge pkcs12FromAsn1";
  }
  if (stack.includes("fromDer")) {
    return "node-forge ASN.1 fromDer";
  }
  return "node-forge PKCS12 inspection";
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? `${error.name}: ${error.message}`
    };
  }

  const message = String(error);
  return {
    name: "NonError",
    message,
    stack: message
  };
}

function describeOmieTrace(serviceName: string, xmlPayload?: string) {
  const codigoConsulta = xmlPayload?.match(/<CodConsulta\s+v="([^"]+)"/)?.[1];
  return codigoConsulta ? `${serviceName}:${codigoConsulta}` : serviceName;
}

function createRequestTiming(): OmieRequestTiming {
  return {
    startedAt: Date.now(),
    summaryLogged: false
  };
}

function phaseDuration(start?: number, end?: number) {
  return start !== undefined && end !== undefined ? end - start : 0;
}

function logOmieTimingSummary(logger: Logger, timing: OmieRequestTiming, traceLabel: string, host: string, attempt: number) {
  if (timing.summaryLogged) {
    return;
  }
  timing.summaryLogged = true;

  const finishedAt = timing.responseEndAt ?? timing.errorAt ?? Date.now();
  const dnsPrimary = phaseDuration(timing.dnsPrimaryStartAt, timing.dnsPrimaryEndAt);
  const dnsFallback = phaseDuration(timing.dnsFallbackStartAt, timing.dnsFallbackEndAt);
  const connect = phaseDuration(timing.connectStartAt, timing.connectEndAt);
  const response = phaseDuration(timing.firstResponseAt, timing.responseEndAt);
  const total = finishedAt - timing.startedAt;

  logger.log(
    `OMIE timing: query=${traceLabel} host=${host} attempt=${attempt}/3 dnsPrimary=${dnsPrimary}ms dnsFallback=${dnsFallback}ms connect=${connect}ms response=${response}ms total=${total}ms`
  );
}

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function positiveInteger(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  return parsed > 0 ? parsed : undefined;
}

function parseDnsServers(value: string | undefined) {
  const servers = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return servers && servers.length > 0 ? servers : undefined;
}

function buildCodConsultaPayload(codigoConsulta: string) {
  const normalized = codigoConsulta.trim();
  if (!normalized) {
    throw new OmieSiom2ConnectionError("codigoConsulta no puede estar vacio.");
  }

  return `<CodConsulta v="${escapeXmlAttribute(normalized)}"/>`;
}

function buildEjecucionConsultaEncolumnadaPayload(
  codigoConsulta: string,
  parametros: Record<string, string>,
  consulta?: OmieConsultaCatalogoItem
) {
  const normalized = codigoConsulta.trim();
  if (!normalized) {
    throw new BadRequestException("codigoConsulta no puede estar vacio.");
  }

  const parametrosXml = buildParametrosEjecucionXml(parametros, consulta);
  return [
    "<MensajeEjecucionConsulta>",
    `  <CodConsulta v="${escapeXmlAttribute(normalized)}"/>`,
    "  <Parametros>",
    ...parametrosXml.map((parametroXml) => `    ${parametroXml}`),
    "  </Parametros>",
    "</MensajeEjecucionConsulta>"
  ].join("\n");
}

function buildParametrosEjecucionXml(parametros: Record<string, string>, consulta?: OmieConsultaCatalogoItem) {
  const consumed = new Set<string>();
  const configured = (consulta?.parametros ?? []).flatMap((parametro) => {
    const nombre = parametro.nombre?.trim();
    if (!nombre) {
      return [];
    }

    const entry = findParametroEntry(parametros, nombre);
    if (!entry) {
      return [];
    }

    consumed.add(entry.key);
    return [
      buildParametroEjecucionXml({
        tipo: parametro.tipo,
        nombre,
        valor: entry.value
      })
    ];
  });

  const extras = Object.entries(parametros)
    .filter(([key]) => !consumed.has(key))
    .map(([key, value]) =>
      buildParametroEjecucionXml({
        tipo: "Fec",
        nombre: key,
        valor: value
      })
    );

  return [...configured, ...extras];
}

function findParametroEntry(parametros: Record<string, string>, nombre: string) {
  if (Object.prototype.hasOwnProperty.call(parametros, nombre)) {
    return {
      key: nombre,
      value: parametros[nombre]
    };
  }

  const normalizedNombre = normalizeParametroName(nombre);
  const entry = Object.entries(parametros).find(([key]) => normalizeParametroName(key) === normalizedNombre);
  return entry
    ? {
        key: entry[0],
        value: entry[1]
      }
    : undefined;
}

function buildParametroEjecucionXml(parametro: { tipo: string; nombre: string; valor: string }) {
  const tipo = normalizeXmlName(parametro.tipo || "Fec", "tipo de parametro");
  const nombre = parametro.nombre.trim();
  if (!nombre) {
    throw new BadRequestException("Los nombres de parametros no pueden estar vacios.");
  }

  return `<${tipo} n="${escapeXmlAttribute(nombre)}" v="${escapeXmlAttribute(parametro.valor)}"/>`;
}

function normalizeXmlName(value: string, label: string) {
  const normalized = value.trim();
  if (!/^[A-Za-z_][A-Za-z0-9._-]*$/.test(normalized)) {
    throw new BadRequestException(`Nombre XML no valido para ${label}: ${value}`);
  }

  return normalized;
}

function normalizeParametroName(value: string) {
  return value.trim().toLowerCase();
}

function escapeXmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildCatalogoResumen(consultas: OmieConsultaCatalogoItem[]): OmieConsultasCatalogoResumen {
  const consultasPorCategoria: Record<string, number> = {};
  const consultasPorTipo: Record<string, number> = {};

  for (const consulta of consultas) {
    const categoria = consulta.categoria ?? "Sin categoria";
    const tipo = consulta.tipoConsulta ?? "Sin tipo";
    consultasPorCategoria[categoria] = (consultasPorCategoria[categoria] ?? 0) + 1;
    consultasPorTipo[tipo] = (consultasPorTipo[tipo] ?? 0) + 1;
  }

  const categorias = Object.keys(consultasPorCategoria).sort((left, right) => left.localeCompare(right, "es"));

  return {
    totalConsultas: consultas.length,
    totalCategorias: categorias.length,
    categorias,
    consultasPorCategoria,
    consultasPorTipo,
    topCategorias: Object.entries(consultasPorCategoria)
      .map(([categoria, count]) => ({ categoria, consultas: count }))
      .sort((left, right) => right.consultas - left.consultas || left.categoria.localeCompare(right.categoria, "es"))
      .slice(0, 10)
  };
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function extractXmlDownload(
  response: OmieSiom2RawResponse,
  consulta: OmieConsultaCatalogoItem,
  codigoConsulta: string
): { fileName?: string; content: string; contentType?: string } {
  const contentType = firstHeaderValue(response.headers["content-type"]);
  const soapFileName = extractFilenameFromSoapBody(response.body);
  const multipart = extractMultipartXmlPart(response.body, contentType);
  if (multipart) {
    return {
      fileName: multipart.fileName ?? soapFileName,
      content: multipart.content,
      contentType: multipart.contentType
    };
  }

  const directXml = extractDirectXmlDocument(response.body);
  if (directXml) {
    return {
      fileName: directXml.fileName ?? soapFileName ?? `${sanitizeFileName(codigoConsulta)}.xml`,
      content: directXml.content,
      contentType
    };
  }

  throw new OmieSiom2ConnectionError(
    `La consulta ${consulta.codigo} no devolvio un XML descargable. Revisa el servicio ${consulta.tipoConsulta}.`
  );
}

function extractMultipartXmlPart(body: string, contentType?: string) {
  const boundary = extractBoundary(contentType);
  if (!boundary) {
    return undefined;
  }

  const marker = `--${boundary}`;
  const segments = body.split(marker).map((segment) => segment.trim()).filter((segment) => segment && segment !== "--");
  for (const segment of segments) {
    const cleanSegment = segment.replace(/^--$/, "").trim();
    const separatorIndex = cleanSegment.indexOf("\r\n\r\n") >= 0 ? cleanSegment.indexOf("\r\n\r\n") : cleanSegment.indexOf("\n\n");
    if (separatorIndex < 0) {
      continue;
    }

    const headersText = cleanSegment.slice(0, separatorIndex);
    const content = cleanSegment.slice(separatorIndex + (cleanSegment.includes("\r\n\r\n") ? 4 : 2)).trim();
    const headers = parsePartHeaders(headersText);
    const partContentType = headers["content-type"] ?? "";
    const disposition = headers["content-disposition"] ?? "";
    const looksXml = /xml/i.test(partContentType) || content.startsWith("<?xml") || content.startsWith("<");
    const isSoapEnvelope = /<soapenv:Envelope|<SOAP-ENV:Envelope/i.test(content);
    if (!looksXml || isSoapEnvelope) {
      continue;
    }

    return {
      fileName: extractFilenameFromDisposition(disposition),
      content,
      contentType: partContentType || contentType
    };
  }

  return undefined;
}

function extractDirectXmlDocument(body: string) {
  const trimmed = body.trim();
  if (!trimmed.startsWith("<?xml") && !/^<([A-Za-z_][\w:.-]*)(\s|>)/.test(trimmed)) {
    return undefined;
  }

  if (/<(?:SOAP-ENV|soapenv):Envelope\b/i.test(trimmed)) {
    return undefined;
  }

  return {
    content: trimmed,
    fileName: undefined as string | undefined
  };
}

function parsePartHeaders(headersText: string) {
  return Object.fromEntries(
    headersText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf(":");
        if (index < 0) {
          return [line.toLowerCase(), ""];
        }
        return [line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim()];
      })
  );
}

function extractBoundary(contentType?: string) {
  if (!contentType) {
    return undefined;
  }

  const match = /boundary="?([^";]+)"?/i.exec(contentType);
  return match?.[1];
}

function extractFilenameFromDisposition(disposition?: string) {
  if (!disposition) {
    return undefined;
  }

  const match = /filename="?([^";]+)"?/i.exec(disposition);
  return match?.[1];
}

function extractFilenameFromSoapBody(body: string) {
  const match = /<[^>]*Nombre\s+v="([^"]+\.(?:xml|XML|zip|ZIP|pdf|PDF|f64|F64))"/.exec(body);
  return match?.[1];
}

function firstHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function sanitizeFileName(value: string) {
  const normalized = value.trim().replace(/[\\/\\?%*:|"<>]/g, "_");
  return normalized || "omie-download.xml";
}

function tieneParametrosPdbcCompatibles(candidata: OmieDescargasCandidata) {
  const nombres = candidata.parametros.map((parametro) => normalizeParametroName(parametro.nombre ?? ""));
  return nombres.includes("fecha") && nombres.includes("version") && nombres.includes("agente");
}

function construirParametrosDescargaPdbc(
  candidata: OmieDescargasCandidata,
  parametros: { fecha: string; version: string; agente: string }
) {
  const mapa = new Map<string, string>([
    ["fecha", parametros.fecha],
    ["version", parametros.version],
    ["agente", parametros.agente]
  ]);

  const resueltos: Record<string, string> = {};
  for (const parametro of candidata.parametros) {
    const nombre = parametro.nombre?.trim();
    if (!nombre) {
      continue;
    }

    const valor =
      mapa.get(normalizeParametroName(nombre)) ??
      (normalizeParametroName(nombre) === "dia" ? parametros.fecha : undefined) ??
      (normalizeParametroName(nombre) === "fechas" ? parametros.fecha : undefined);
    if (valor !== undefined) {
      resueltos[nombre] = valor;
    }
  }

  return resueltos;
}

function extraerPrimerasEtiquetasXml(xml: string) {
  const etiquetas: string[] = [];
  const regex = /<\s*([A-Za-z_][A-Za-z0-9_.:-]*)(?:\s|>|\/)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(xml)) !== null) {
    const etiqueta = match[1];
    if (etiqueta.startsWith("?") || etiqueta.startsWith("!")) {
      continue;
    }
    etiquetas.push(etiqueta);
    if (etiquetas.length >= 8) {
      break;
    }
  }

  return etiquetas;
}

function clasificarParametrosConsulta(parametros: OmieConsultaCatalogoItem["parametros"]) {
  const clasificados = parametros.map((parametro) => ({
    ...parametro,
    obligatorio: true
  }));

  return {
    obligatorios: clasificados as OmieDiagnosticoEnergiaParametro[],
    opcionales: [] as OmieDiagnosticoEnergiaParametro[]
  };
}

function construirParametrosPruebaEnergia(codigoConsulta: string, parametros: OmieDiagnosticoEnergiaParametro[]) {
  const parametrosPrueba: Record<string, string> = {};

  for (const parametro of parametros) {
    const nombre = normalizeParametroName(parametro.nombre ?? "");
    if (nombre.includes("fecha") || nombre.includes("dia")) {
      parametrosPrueba[parametro.nombre ?? "Fecha"] = "2026-04-15";
      continue;
    }
    if (nombre.includes("uofertante") || nombre.includes("unidadofertante")) {
      parametrosPrueba[parametro.nombre ?? "UOfertante"] = "STROC01";
      continue;
    }
    if (nombre.includes("umedida") || nombre.includes("unidaddedmedida") || nombre.includes("unidadmedida")) {
      parametrosPrueba[parametro.nombre ?? "UMedida"] = "P";
      continue;
    }
    if (nombre.includes("ses")) {
      parametrosPrueba[parametro.nombre ?? "Sesion"] = "1";
      continue;
    }
    parametrosPrueba[parametro.nombre ?? codigoConsulta] = parametro.selecciones[0]?.codigo ?? "1";
  }

  return parametrosPrueba;
}

function diagnosticarRespuestaEnergia(
  response: OmieSiom2RawResponse,
  consulta: OmieConsultaCatalogoItem,
  xml: string
): {
  tipoRespuesta: "Encolumnada" | "Anexo XML" | "Multipart" | "Otro";
  clasificacion: "tabla" | "fichero" | "otro";
  etiquetasDetectadas: string[];
  nombreFichero?: string;
  tamaño: number;
  columnas: number;
  filas: number;
  primeraFila?: Record<string, string>;
  contentType?: string;
} {
  const contentType = firstHeaderValue(response.headers["content-type"]);
  const etiquetasDetectadas = extraerPrimerasEtiquetasXml(xml);
  const tabla = extractOmieConsultaEncolumnada(xml);
  if (tabla?.columnas?.length || tabla?.filas?.length) {
    return {
      tipoRespuesta: "Encolumnada",
      clasificacion: "tabla",
      etiquetasDetectadas,
      tamaño: Buffer.byteLength(xml, "utf8"),
      columnas: tabla.columnas?.length ?? 0,
      filas: tabla.filas?.length ?? 0,
      primeraFila: tabla.filas?.[0],
      contentType
    };
  }

  try {
    const extracted = extractXmlDownload(response, consulta, consulta.codigo);
    return {
      tipoRespuesta: /multipart/i.test(contentType ?? "") ? "Multipart" : "Anexo XML",
      clasificacion: "fichero",
      etiquetasDetectadas,
      nombreFichero: extracted.fileName,
      tamaño: Buffer.byteLength(extracted.content, "utf8"),
      columnas: 0,
      filas: 0,
      contentType: extracted.contentType ?? contentType
    };
  } catch {
    return {
      tipoRespuesta: "Otro",
      clasificacion: "otro",
      etiquetasDetectadas,
      tamaño: Buffer.byteLength(xml, "utf8"),
      columnas: 0,
      filas: 0,
      contentType
    };
  }
}
