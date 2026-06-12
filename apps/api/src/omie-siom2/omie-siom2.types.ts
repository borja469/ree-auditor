import type { IncomingHttpHeaders } from "node:http";
import type { OmieXmlJsonObject } from "./omie-xml-response.parser";

export type OmieSiom2HeaderValue = string | number | boolean | undefined;

export type OmieSiom2RequestOptions = {
  url?: string;
  path?: string;
  method?: "GET" | "POST";
  headers?: Record<string, OmieSiom2HeaderValue>;
  body?: string | Buffer;
  soapAction?: string;
  traceLabel?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export type OmieSiom2Response = {
  statusCode: number;
  statusMessage: string;
  headers: IncomingHttpHeaders;
  body: string;
  rawBody: Buffer;
};

export type OmieSiom2RawResponse = {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
  rawBody: Buffer;
};

export type OmieSiom2ParsedServiceResponse = {
  statusCode: number;
  serviceName: string;
  xml: string;
  json: OmieXmlJsonObject;
};

export type OmieSiom2TestJsonResponse = OmieSiom2ParsedServiceResponse;

export type OmieConsultaEncolumnadaColumna = {
  nombre: string;
  tipo?: string;
  descripcion?: string;
  atributos: Record<string, string>;
};

export type OmieConsultaEncolumnadaFila = Record<string, string>;

export type OmieConsultaEncolumnadaTabla = {
  columnas: OmieConsultaEncolumnadaColumna[];
  filas: OmieConsultaEncolumnadaFila[];
};

export type OmieConsultaEncolumnadaResult = OmieSiom2ParsedServiceResponse & Partial<OmieConsultaEncolumnadaTabla>;

export type OmieConsultaCatalogoSeleccion = {
  codigo?: string;
  descripcion?: string;
  atributos: Record<string, string>;
};

export type OmieConsultaCatalogoParametro = {
  tipo: string;
  nombre?: string;
  descripcion?: string;
  longitud?: string;
  comodin?: string;
  selecciones: OmieConsultaCatalogoSeleccion[];
  atributos: Record<string, string>;
};

export type OmieConsultaCatalogoColumna = {
  tipo: string;
  nombre?: string;
  descripcion?: string;
  longitud?: string;
  agregado?: string;
  etiquetaXml?: string;
  atributos: Record<string, string>;
};

export type OmieConsultaCatalogoItem = {
  codigo: string;
  descripcion?: string;
  categoria?: string;
  version?: string;
  tipoConsulta?: string;
  parametros: OmieConsultaCatalogoParametro[];
  columnas: OmieConsultaCatalogoColumna[];
  configuracion: {
    serviceName: string;
    statusCode: number;
    xmlBytes: number;
    error?: {
      name: string;
      message: string;
    };
  };
};

export type OmieConsultasCatalogoResumen = {
  totalConsultas: number;
  totalCategorias: number;
  categorias: string[];
  consultasPorCategoria: Record<string, number>;
  consultasPorTipo: Record<string, number>;
  topCategorias: Array<{
    categoria: string;
    consultas: number;
  }>;
};

export type OmieConsultasCatalogo = {
  generatedAt: string;
  catalogPath: string;
  source: {
    directorio: {
      serviceName: string;
      statusCode: number;
      xmlBytes: number;
    };
    configuracionesConsultadas: number;
    configuracionesConError: number;
  };
  resumen: OmieConsultasCatalogoResumen;
  consultas: OmieConsultaCatalogoItem[];
};

export type OmieAreaNegocio = "PRECIOS" | "OFERTAS" | "PROGRAMAS" | "LIQUIDACIONES" | "MEDIDAS" | "DOCUMENTACION" | "OTROS";
export type OmieAreaNegocioPrioritaria = Extract<OmieAreaNegocio, "PRECIOS" | "PROGRAMAS" | "OFERTAS" | "LIQUIDACIONES">;
export type OmieAreaNegocioPreciosProgramas = Extract<OmieAreaNegocio, "PRECIOS" | "PROGRAMAS">;

export type OmieConsultaFuncionalResumen = {
  codigo: string;
  descripcion?: string;
  categoria?: string;
  numeroParametros: number;
  numeroColumnas: number;
};

export type OmieConsultaAreaNegocio = {
  codigo: string;
  descripcion?: string;
  categoria?: string;
  areaNegocio: OmieAreaNegocio;
};

export type OmieCatalogoFuncionalAnalizado = {
  generatedAt: string;
  sourceCatalogPath: string;
  analyzedPath: string;
  resumen: {
    totalConsultas: number;
    totalCategorias: number;
    categoriasOrdenadas: Array<{
      categoria: string;
      consultas: number;
    }>;
    topCategorias: Array<{
      categoria: string;
      consultas: number;
    }>;
    consultasPorAreaNegocio: Record<OmieAreaNegocio, number>;
  };
  consultasRelacionadas: {
    mercadoDiario: OmieConsultaFuncionalResumen[];
    mercadoIntradiario: OmieConsultaFuncionalResumen[];
    ofertas: OmieConsultaFuncionalResumen[];
    programas: OmieConsultaFuncionalResumen[];
    precios: OmieConsultaFuncionalResumen[];
    liquidaciones: OmieConsultaFuncionalResumen[];
    medidas: OmieConsultaFuncionalResumen[];
    descargaFicheros: OmieConsultaFuncionalResumen[];
    documentacion: OmieConsultaFuncionalResumen[];
  };
  consultas: OmieConsultaFuncionalResumen[];
  clasificacion: OmieConsultaAreaNegocio[];
};

export type OmieConsultaPrioritaria = OmieConsultaFuncionalResumen & {
  areaNegocio: OmieAreaNegocioPrioritaria;
};

export type OmieConsultaPrioritariaRanking = OmieConsultaPrioritaria & {
  posicion: number;
};

export type OmieDescargasCandidata = {
  codigo: string;
  descripcion?: string;
  categoria?: string;
  parametros: OmieConsultaCatalogoParametro[];
  columnas: OmieConsultaCatalogoColumna[];
  score: number;
  palabrasClaveDetectadas: string[];
  motivoSeleccion: string;
};

export type OmieDescargaXmlResultado = {
  codigo: string;
  descripcion?: string;
  serviceName: string;
  statusCode: number;
  fileName: string;
  outputPath: string;
  contentType?: string;
  contentBytes: number;
};

export type OmieDescargasPdbcPrueba = {
  codigo: string;
  descripcion?: string;
  categoria?: string;
  tipoConsulta?: string;
  statusCode: number;
  error?: {
    name: string;
    message: string;
  };
  fileName?: string;
  contentType?: string;
  contentBytes: number;
  primerasEtiquetasXml: string[];
  parametrosUsados: Record<string, string>;
};

export type OmieDescargasPdbcCandidatasReport = {
  generatedAt: string;
  fechaPrueba: string;
  versionPrueba: string;
  agentePrueba: string;
  sourceCatalogPath: string;
  outputPath?: string;
  candidatas: OmieDescargasCandidata[];
  probadas: OmieDescargasPdbcPrueba[];
};

export type OmieCatalogoPrioridades = {
  generatedAt: string;
  sourceAnalyzedPath: string;
  prioridadesPath: string;
  criterios: {
    areasIncluidas: OmieAreaNegocioPrioritaria[];
    ordenRanking: OmieAreaNegocioPrioritaria[];
    desempates: string[];
  };
  resumen: {
    totalConsultasAnalizadas: number;
    totalConsultasPriorizadas: number;
    consultasPorAreaNegocio: Record<OmieAreaNegocioPrioritaria, number>;
  };
  consultas: OmieConsultaPrioritaria[];
  rankingTop20: OmieConsultaPrioritariaRanking[];
};

export type OmiePreciosProgramasObjetivo = "preciosOmie" | "programasHorarios" | "casacion" | "energiaNegociada";

export type OmiePreciosProgramasConsulta = {
  codigo: string;
  descripcion?: string;
  categoria?: string;
  areaNegocio: OmieAreaNegocioPreciosProgramas;
  parametros: OmieConsultaCatalogoParametro[];
  columnas: OmieConsultaCatalogoColumna[];
  numeroParametros: number;
  numeroColumnas: number;
  palabrasClave: string[];
  candidataPara: OmiePreciosProgramasObjetivo[];
  relevancia: number;
};

export type OmiePreciosProgramasReport = {
  generatedAt: string;
  sourcePrioridadesPath: string;
  sourceCatalogPath: string;
  outputPath: string;
  criterios: {
    areasIncluidas: OmieAreaNegocioPreciosProgramas[];
    palabrasClave: string[];
    objetivos: OmiePreciosProgramasObjetivo[];
  };
  resumen: {
    totalConsultas: number;
    consultasPorAreaNegocio: Record<OmieAreaNegocioPreciosProgramas, number>;
    consultasConPalabrasClave: number;
  };
  consultas: OmiePreciosProgramasConsulta[];
  mejoresCandidatas: Record<OmiePreciosProgramasObjetivo, OmiePreciosProgramasConsulta[]>;
};

export type OmiePrecioMercado = "mercadoDiario" | "mercadoIntradiario";

export type OmiePrecioMercadoCandidata = {
  codigo: string;
  descripcion?: string;
  categoria?: string;
  parametrosRequeridos: OmieConsultaCatalogoParametro[];
  columnasDisponibles: OmieConsultaCatalogoColumna[];
  coincidencias: string[];
  relevancia: number;
  ejecutableSoloFecha: boolean;
};

export type OmiePrecioMercadoEjecucion = {
  codigo: string;
  mercado: OmiePrecioMercado;
  statusCode: number;
  numeroFilas: number;
  parametroFecha?: string;
  error?: {
    name: string;
    message: string;
  };
};

export type OmiePreciosMercadoReport = {
  generatedAt: string;
  fechaPrueba: string;
  sourcePreciosProgramasPath: string;
  outputPath: string;
  mercadoDiario: OmiePrecioMercadoCandidata[];
  mercadoIntradiario: OmiePrecioMercadoCandidata[];
  ejecuciones: OmiePrecioMercadoEjecucion[];
};

export type OmieCuartohorarioCandidata = {
  codigo: string;
  descripcion?: string;
  categoria?: string;
  parametros: OmieConsultaCatalogoParametro[];
  numeroColumnas: number;
};

export type OmieDiagnosticoEnergiaParametro = OmieConsultaCatalogoParametro & {
  obligatorio: boolean;
};

export type OmieDiagnosticoEnergiaResultado = {
  codigo: string;
  descripcion?: string;
  parametros: {
    obligatorios: OmieDiagnosticoEnergiaParametro[];
    opcionales: OmieDiagnosticoEnergiaParametro[];
  };
  tipoRespuesta: "Encolumnada" | "Anexo XML" | "Multipart" | "Otro";
  nombreFichero?: string;
  tamaño: number;
  columnas: number;
  filas: number;
  primeraFila?: Record<string, string>;
  estructuraXML: {
    clasificacion: "tabla" | "fichero" | "otro";
    etiquetasDetectadas: string[];
    contentType?: string;
  };
};

export type OmieDiagnosticoEnergiaReport = {
  generatedAt: string;
  sourceCatalogPath: string;
  outputPath: string;
  pruebasPath: string;
  consultas: OmieDiagnosticoEnergiaResultado[];
};

export type OmieSiom2CertificateInfoResult =
  | {
      ok: true;
      nodeVersion: string;
      opensslVersion: string;
      selectedCertificate: {
        subject: string;
        issuer: string;
        serialNumber: string;
        notBefore: string;
        notAfter: string;
        isCa: boolean;
        isSelfSigned: boolean;
        matchesPrivateKey: boolean;
      };
      certificates: Array<{
        index: number;
        subject: string;
        issuer: string;
        serialNumber: string;
        notBefore: string;
        notAfter: string;
        isCa: boolean;
        isSelfSigned: boolean;
        matchesPrivateKey: boolean;
        selectedForTls: boolean;
      }>;
    }
  | {
      ok: false;
      nodeVersion: string;
      opensslVersion: string;
      error: {
        name: string;
        message: string;
        stack: string;
      };
    };

export type OmieSiom2ConnectionConfig = {
  endpoint: string;
  p12Path?: string;
  p12Base64?: string;
  p12Passphrase?: string;
  rejectUnauthorized: boolean;
  dnsServers: string[];
  timeoutMs: number;
};
