import { beginLoading, withGlobalLoading } from "./loading";

export type ReeFileType = "REGANECU" | "REGANECUQH";
export type ReeVersion = "A1" | "C1" | "C2" | "C3" | "C4" | "C5";
export type MedperFileType = "MEDPERQH";
export type ReeKFactorFileType = "KESTIMQH" | "KREALQH";
export type OmieTipoDocumento = "PVD" | "PHF";
export type OmieTipoPrecio = "MD" | "MI" | "XBID";
export type OmieDownloadModulo = "Programas" | "Precios" | "Transacciones";
export type OmieDownloadCodigo = "5302" | "5608" | "5202" | "5603" | "4125" | "4121";
export type OmieDownloadDocumentType = OmieTipoDocumento | OmieTipoPrecio | "TRANSACCIONES";
export type OmieDownloadEstado = "PENDIENTE" | "DESCARGANDO" | "DESCARGADO" | "PROCESADO" | "ERROR";

export type ReeFile = {
  id: string;
  fileName: string;
  containerFileName?: string | null;
  fileHash: string;
  tipoArchivo: ReeFileType;
  version: ReeVersion;
  fechaLiquidacion: string;
  sujetoEic: string;
  encoding: string;
  delimiter: string;
  status: "IMPORTED" | "FAILED" | "DUPLICATED";
  errorMessage?: string | null;
  importedAt: string;
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  duplicatedRecords: number;
};

export type ImportResponse = {
  summary: {
    uploadedFiles: number;
    sourceFiles: number;
    importedFiles: number;
    failedFiles: number;
    duplicatedFiles: number;
    recordsImported: number;
    validRecords: number;
    invalidRecords: number;
    duplicatedRecords: number;
  };
  results: Array<{
    fileName: string;
    status: "IMPORTED" | "FAILED" | "DUPLICATE";
    file?: ReeFile;
    recordsImported: number;
    validRecords: number;
    invalidRecords: number;
    duplicatedRecords: number;
    errors: Array<{
      sourceFileName: string;
      lineNumber: number;
      message: string;
    }>;
  }>;
  files: ReeFile[];
};

export type MedperFile = {
  id: string;
  fileName: string;
  containerFileName?: string | null;
  fileHash: string;
  tipoArchivo: MedperFileType;
  version: string;
  fechaInicio: string;
  fechaFin: string;
  sujetoEic: string;
  encoding: string;
  delimiter: string;
  status: "IMPORTED" | "FAILED" | "DUPLICATED";
  errorMessage?: string | null;
  importedAt: string;
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  duplicatedRecords: number;
};

export type MedperImportResponse = Omit<ImportResponse, "results" | "files"> & {
  results: Array<{
    fileName: string;
    status: "IMPORTED" | "FAILED" | "DUPLICATE";
    file?: MedperFile;
    recordsImported: number;
    validRecords: number;
    invalidRecords: number;
    duplicatedRecords: number;
    errors: Array<{
      sourceFileName: string;
      lineNumber: number;
      message: string;
    }>;
  }>;
  files: MedperFile[];
};

export type ReeLossesImportResponse = Omit<ImportResponse, "files"> & {
  results: Array<{
    id?: string;
    fileName: string;
    status: "IMPORTED" | "FAILED";
    tipoArchivo?: ReeKFactorFileType | null;
    version?: ReeVersion | null;
    fechaInicio?: string | null;
    fechaFin?: string | null;
    importedAt?: string;
    recordsImported: number;
    validRecords: number;
    invalidRecords: number;
    duplicatedRecords: number;
    errors: Array<{
      sourceFileName: string;
      lineNumber: number;
      message: string;
    }>;
  }>;
};

export type ReeLossesImportFile = {
  id: string;
  fileName: string;
  containerFileName?: string | null;
  fileHash?: string | null;
  tipoArchivo: ReeKFactorFileType | null;
  version: ReeVersion | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  status: "IMPORTED" | "FAILED" | "DUPLICATED";
  errorMessage?: string | null;
  importedAt: string;
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  duplicatedRecords: number;
};

export type ReeDownloadCenterSummaryRow = {
  month: string;
  module: "REGANECU" | "MEDPER" | "K REE";
  status: "correct" | "error" | "pending" | "incomplete" | "duplicated" | "warning";
  label: string | null;
  loads: number;
  records: number;
  latestLoad: string | null;
};

export type ImportHistoryKind = "reganecu" | "medper";
export type ImportHistoryIssue = {
  sourceFileName: string;
  lineNumber: number;
  message: string;
  rawLine?: string | null;
};
export type ImportHistoryRecordCounts = {
  total: number;
  reganecu: number;
  reganecuQh: number;
  medperup: number;
  medperqh: number;
};
export type ImportHistoryPreviewRow = Record<string, string | number | boolean | null | undefined>;
export type ImportHistoryDetail = {
  kind: ImportHistoryKind;
  file: ReeFile | MedperFile;
  recordCounts: ImportHistoryRecordCounts;
  errors: ImportHistoryIssue[];
  preview: ImportHistoryPreviewRow[];
};
export type ImportHistoryLogs = {
  kind: ImportHistoryKind;
  file: ReeFile | MedperFile;
  recordCounts: ImportHistoryRecordCounts;
  errors: ImportHistoryIssue[];
  lines: string[];
  text: string;
};
export type DeleteImportFileResponse = {
  kind: ImportHistoryKind;
  deletedFileId: string;
  deletedFileName: string;
  deletedRecords: number;
};

export type OmieProgramaPeriodo = {
  fecha: string;
  periodo: number;
  descripcionPeriodo: string;
  clave: string;
  energiaMWh: number;
};

export type OmieProgramaResponse = {
  fecha: string;
  tipoPrograma: OmieTipoDocumento;
  sesion: string | null;
  uOfertante: string;
  resolucion: "PT15M";
  totalEnergiaMWh: number;
  ultimaDescarga: string | null;
  periodos: OmieProgramaPeriodo[];
};

export type OmieProgramaSyncResponse = {
  message?: string;
  download: OmieDownloadControlRow;
  programa: OmieProgramaResponse;
};

export type OmieProgramaEvolucionPeriodo = OmieProgramaPeriodo & {
  pvd: number | null;
  sesiones: Record<string, number | null>;
  diferencias: Record<string, number | null>;
};

export type OmieProgramaEvolucionResponse = {
  fecha: string;
  resolucion: "PT15M";
  uOfertante: string;
  pvd: OmieProgramaResponse | null;
  phf: OmieProgramaResponse[];
  sesiones?: OmieProgramaResponse[];
  diferencias?: Array<{
    desde: string;
    hasta: string;
    periodos: Array<{
      periodo: number;
      energiaDesde: number | null;
      energiaHasta: number | null;
      diferencia: number | null;
    }>;
  }>;
  periodos: OmieProgramaEvolucionPeriodo[];
};

export type OmieDownloadControlRow = {
  id: string;
  origen: "programas" | "precios" | "transacciones";
  modulo: OmieDownloadModulo;
  consulta: string;
  codigoOmie: OmieDownloadCodigo;
  descripcion: string;
  tipoDocumento: OmieDownloadDocumentType;
  fechaPrograma: string;
  fechaHasta: string | null;
  sesion: string | null;
  version: number | null;
  uOfertante: string | null;
  fechaDescarga: string | null;
  estado: OmieDownloadEstado;
  registros: number;
  hashContenido: string | null;
  nombreFichero: string | null;
  mensajeError: string | null;
  parametrosUtilizados: Record<string, string | number | null>;
  tiempoEjecucionMs: number | null;
  rawXmlDisponible: boolean;
  rawJsonDisponible: boolean;
  logDisponible: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OmieDownloadControlFilters = {
  fechaDesde?: string;
  fechaHasta?: string;
  modulo?: OmieDownloadModulo | "";
  codigoOmie?: OmieDownloadCodigo | "";
  tipoDocumento?: OmieDownloadDocumentType | "";
  estado?: OmieDownloadEstado | "";
  sesion?: string;
};

export type OmieDownloadDetail = OmieDownloadControlRow & {
  rawXml: string | null;
  rawJson: OmieTransactionJsonValue | null;
  log: string[];
};

export type OmieDownloadExecuteRequest = {
  codigoOmie: OmieDownloadCodigo;
  fecha?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  sesion?: string;
};

export type OmieDownloadExecuteResponse = {
  message: string;
  download: OmieDownloadDetail;
  result: unknown;
};

export type OmieDailyBulkDownloadItem = {
  codigoOmie: OmieDownloadCodigo;
  modulo: OmieDownloadModulo;
  consulta: string;
  sesion: string | null;
  estado: "PROCESADO" | "SIN_DATOS" | "ERROR" | "OMITIDO";
  registros: number;
  mensaje: string;
  downloadId: string | null;
};

export type OmieDailyBulkDownloadResponse = {
  fecha: string;
  force: boolean;
  totalConsultas: number;
  totalConsultasEjecutadas: number;
  procesadas: number;
  sinDatos: number;
  errores: number;
  omitidas: number;
  tiempoTotalMs: number;
  resultados: OmieDailyBulkDownloadItem[];
};

export type OmieAutomationConfig = {
  active: boolean;
  daysBack: number;
  sessions: [string, string, string];
  lastRunKey: string | null;
  lastRunAt: string | null;
  lastRunAtUtc?: string | null;
};

export type OmieAutomationRunResponse = {
  session: string;
  startedAt: string;
  finishedAt: string;
  force: true;
  daysBack: number;
  dates: string[];
  totalConsultas: number;
  totalConsultasEjecutadas: number;
  procesadas: number;
  sinDatos: number;
  errores: number;
  omitidas: number;
  tiempoTotalMs: number;
  resultados: OmieDailyBulkDownloadResponse[];
};

export type OmiePrecioPeriodo = {
  fecha: string;
  periodo: number;
  clave: string;
  precioMd: number | null;
  precioMi1: number | null;
  precioMi2: number | null;
  precioMi3: number | null;
  precioXbid: number | null;
};

export type OmiePrecioEstadistica = {
  min: number | null;
  max: number | null;
  media: number | null;
  registros: number;
};

export type OmiePreciosResponse = {
  fecha: string;
  resolucion: "PT15M";
  ultimaDescarga: string | null;
  periodos: OmiePrecioPeriodo[];
  estadisticas: Record<"precioMd" | "precioMi1" | "precioMi2" | "precioMi3" | "precioXbid", OmiePrecioEstadistica>;
};

export type OmieAnalisisMensualPeriodo = {
  fecha: string;
  periodo: number;
  clave: string;
  precioMd: number | null;
  precioIda1: number | null;
  precioIda2: number | null;
  precioIda3: number | null;
  precioXbid: number | null;
  programaMd: number | null;
  programaIda1: number | null;
  programaIda2: number | null;
  programaIda3: number | null;
  volIda1: number | null;
  volIda2: number | null;
  volIda3: number | null;
  volXbid: number | null;
  profitIda1: number | null;
  profitIda2: number | null;
  profitIda3: number | null;
  profitXbidEurMWh: number | null;
  profitXbid: number | null;
  sumaProfit: number | null;
  pciMdIda1: number | null;
  pciIda1Ida2: number | null;
  pciIda2Ida3: number | null;
  pciIda3Xbid: number | null;
  profitMdIda1: number | null;
  profitIda1Ida2: number | null;
  profitIda2Ida3: number | null;
  profitIda3XbidEurMWh: number | null;
  profitIda3Xbid: number | null;
  profitTotal: number | null;
};

export type OmieAnalisisMensualResponse = {
  mes: string;
  year: number;
  month: number;
  fechaDesde: string;
  fechaHasta: string;
  resolucion: "PT15M";
  totalFilas: number;
  kpis: {
    sumaProfit: number | null;
    volumenTotal: number | null;
    profitTotal: number | null;
    pciTotal: number | null;
    energiaTotal: number | null;
    profitMedioEurMWh: number | null;
  };
  periodos: OmieAnalisisMensualPeriodo[];
};

export type OmieComprobacionLiquidacionMercado = "MD" | "IDA1" | "IDA2" | "IDA3" | "XBID" | "TOTAL";

export type OmieComprobacionLiquidacionResumen = {
  mercado: OmieComprobacionLiquidacionMercado;
  energiaMWh: number | null;
  importeEur: number | null;
};

export type OmieComprobacionLiquidacionHoraria = {
  fecha: string;
  fechaIso: string;
  hora: number;
  mdMWh: number | null;
  pmd: number | null;
  costeMd: number | null;
  ida1MWh: number | null;
  pida1: number | null;
  costeIda1: number | null;
  ida2MWh: number | null;
  pida2: number | null;
  costeIda2: number | null;
  ida3MWh: number | null;
  pida3: number | null;
  costeIda3: number | null;
  xbidMWh: number | null;
  pxbid: number | null;
  costeXbid: number | null;
};

export type OmieComprobacionLiquidacionDiaria = {
  fecha: string;
  fechaIso: string;
  dia: string;
  energiaMd: number | null;
  costeMd: number | null;
  energiaIda1: number | null;
  costeIda1: number | null;
  energiaIda2: number | null;
  costeIda2: number | null;
  energiaIda3: number | null;
  costeIda3: number | null;
  energiaXbid: number | null;
  costeXbid: number | null;
  costeTotalOmie: number | null;
  facturaCompra: number | null;
  facturaVenta: number | null;
  horas: OmieComprobacionLiquidacionHoraria[];
};

export type OmieComprobacionCuadre = {
  calculado: number | null;
  liquidado: number | null;
  diferencia: number | null;
  estado: "ok" | "warning" | "danger" | "pending";
};

export type OmieComprobacionLiquidacionesResponse = {
  mes: string;
  year: number;
  month: number;
  fechaDesde: string;
  fechaHasta: string;
  resolucion: "PT15M";
  resumenMensual: OmieComprobacionLiquidacionResumen[];
  detalleDiario: OmieComprobacionLiquidacionDiaria[];
  cuadroEconomico: OmieComprobacionCuadre;
  cuadroEnergetico: OmieComprobacionCuadre;
};

export type OmieLiquidationInvoiceResponse = {
  fecha: string;
  fechaIso: string;
  facturaCompra: number | null;
  facturaVenta: number | null;
  updatedAt: string;
};

export type OmiePriceDownloadRow = {
  id: string;
  tipoPrecio: OmieTipoPrecio;
  fechaPrograma: string;
  sesion: string | null;
  version: number;
  fechaDescarga: string;
  estado: OmieDownloadEstado;
  registros: number;
  hashContenido: string | null;
  mensajeError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OmiePrecioSyncResponse = {
  message: string;
  download: OmiePriceDownloadRow;
  precios: OmiePreciosResponse;
};

export type OmiePreciosDiagnosticoResponse = {
  fecha: string;
  sesion: string;
  sesionesDisponibles: string[];
  consultas: Record<string, unknown>;
};

export type OmieTransactionJsonValue =
  | string
  | number
  | boolean
  | null
  | OmieTransactionJsonValue[]
  | { [key: string]: OmieTransactionJsonValue };

export type OmieTransactionColumn = {
  nombre: string;
  tipo?: string;
  descripcion?: string;
  atributos?: Record<string, string>;
};

export type OmieTransactionStructureSummary = {
  codigoConsulta: "4121";
  descripcion: string;
  fechaDesde: string;
  fechaHasta: string;
  diasConsultados: number;
  registrosTotales: number;
  columnasDetectadas: string[];
  columnas: OmieTransactionColumn[];
  dias: Array<{
    fecha: string;
    statusCode: number;
    serviceName: string;
    registros: number;
    columnas: string[];
  }>;
  muestraFilas: Array<Record<string, OmieTransactionJsonValue>>;
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
  resumenEstructura: OmieTransactionStructureSummary | null;
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
  rawPayloadJson: Record<string, OmieTransactionJsonValue>;
  createdAt: string;
  updatedAt: string;
};

export type OmieTransactionDownloadFilters = {
  fechaDesde?: string;
  fechaHasta?: string;
  estado?: OmieDownloadEstado | "";
};

export type OmieTransactionHistoricoResponse = {
  codigoConsulta: "4121";
  descripcion: string;
  filtros: {
    fechaDesde: string | null;
    fechaHasta: string | null;
    estado: OmieDownloadEstado | null;
  };
  descargas: OmieTransactionDownloadRow[];
};

export type OmieTransactionDownloadResponse = {
  message: string;
  download: OmieTransactionDownloadRow;
  resumenEstructura: OmieTransactionStructureSummary;
};

export type OmieTransactionStagingRowsResponse = {
  download: OmieTransactionDownloadRow;
  take: number;
  filas: OmieTransactionStagingRow[];
};

export type EsiosConfig = {
  apiUrl: string;
  tokenConfigured: boolean;
  timeoutSeconds: number;
  retries: number;
  active: boolean;
};

export type EsiosConnectionResult = {
  status: "ok" | "invalid_token" | "network_error" | "api_error" | "inactive";
  message: string;
  statusCode?: number;
};

export type EsiosIndicator = {
  id: string;
  indicatorId: number;
  name: string | null;
  description: string | null;
  shortName: string | null;
  unit: string | null;
  frequency: string | null;
  active: boolean;
  hasData?: boolean;
  latestDownload?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EsiosIndicatorValue = {
  id: string;
  indicatorId: number;
  datetime: string;
  datetimeUtc: string | null;
  value: number | null;
  geoId: number | null;
  geoName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EsiosValuesFilters = {
  fechaDesde?: string;
  fechaHasta?: string;
  year?: number | string;
  month?: number | string;
  skip?: number;
  take?: number;
};

export type EsiosValuesResponse = {
  indicator: EsiosIndicator | null;
  filters: {
    startDate: string;
    endDate: string;
    skip: number;
    take: number;
  };
  total: number;
  hasNext: boolean;
  kpis: {
    firstRecord: string | null;
    lastRecord: string | null;
    totalRecords: number;
    average: number | null;
    maximum: number | null;
    minimum: number | null;
    latestDownload: string | null;
  };
  rows: EsiosIndicatorValue[];
};

export type EsiosDownloadSummary = {
  indicatorId: number;
  startDate: string;
  endDate: string;
  downloadedRecords: number;
  insertedRecords: number;
  updatedRecords: number;
  executionTimeMs: number;
  status: "SUCCESS" | "ERROR";
  errorMessage: string | null;
};

export type EsiosDownloadLog = {
  id: string;
  indicatorId: number | null;
  indicatorName: string | null;
  startDate: string | null;
  endDate: string | null;
  downloadedRecords: number;
  insertedRecords: number;
  updatedRecords: number;
  executionTimeMs: number;
  status: string;
  errorMessage: string | null;
  createdAt: string;
};

export type EsiosDownloadLogsResponse = {
  total: number;
  hasNext: boolean;
  logs: EsiosDownloadLog[];
};

export type EsiosSyncIndicatorsResponse = {
  downloadedRecords: number;
  savedRecords: number;
  indicators: EsiosIndicator[];
};

export type EsiosProfileTariff = "2.0TD" | "3.0TD" | "3.0TDVE";

export type EsiosInitialProfile = {
  id: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  datetime: string;
  profile20td: number;
  profile30td: number;
  profile30tdve: number;
  referenceDemandMw: number;
  uploadId: string;
  createdAt: string;
  updatedAt: string;
};

export type EsiosProfileCoefficient = {
  id?: string;
  year?: number;
  tariff: EsiosProfileTariff;
  alpha: number;
  beta: number;
  gamma: number;
  uploadId?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type EsiosProfileUpload = {
  id: string;
  year: number;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string | null;
  status: string;
  errorMessage: string | null;
  totalRows: number;
  validRows: number;
  createdAt: string;
  updatedAt: string;
};

export type EsiosProfilesFilters = {
  year?: number | string;
  month?: number | string;
  tariff?: EsiosProfileTariff | "";
  fechaDesde?: string;
  fechaHasta?: string;
  skip?: number;
  take?: number;
};

export type EsiosInitialProfilesResponse = {
  rows: EsiosInitialProfile[];
  total: number;
  hasNext: boolean;
  filters: EsiosProfilesFilters;
};

export type EsiosProfilesSummary = {
  year: number;
  expectedHours: number;
  loadedHours: number;
  loadStatus: string;
  latestUpload: EsiosProfileUpload | null;
  sumProfile20td: number | null;
  sumProfile30td: number | null;
  sumProfile30tdve: number | null;
  totalReferenceDemandMw: number | null;
  coefficientCount: number;
};

export type EsiosProfileIntermediateRow = {
  id: string;
  year: number;
  datetime: string;
  month: number;
  day: number;
  hour: number;
  tariff: EsiosProfileTariff;
  initialProfile: number;
  h0: number;
  h1: number;
  hf: number;
  c0: number;
  c1: number;
  cf: number;
  m0: number;
  m1: number;
  intermediateProfile: number;
  demandUsedMw: number;
  demandSource: "REE_DEMR" | "FINAL_1335" | "FORECAST_460" | "REFERENCE_REE";
  referenceDemandMw: number;
  forecastDemandMw: number | null;
  finalDemandMw: number | null;
  systemDemandMw?: number | null;
  reeFinalProfile: number | null;
  finalProfileDifference: number | null;
  finalProfileValidationStatus: "VALIDADO" | "DIFERENTE" | "SIN_PERFF";
  calculatedIntermediateProfile: number;
  profileValidationDifference: number;
  profileValidationStatus: "VALIDADO" | "DIFERENTE";
  validationStatus: "VALIDADO" | "DIFERENTE" | "SIN_PERFF";
  createdAt: string;
  updatedAt: string;
};

export type EsiosProfileIntermediateLog = {
  id: string;
  year: number;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  executionTimeMs: number | null;
  rowsProcessed: number;
  errorMessage: string | null;
  createdAt: string;
};

export type EsiosProfileIntermediateSummary = {
  year: number;
  expectedHours: number;
  calculatedHours: number;
  calculatedTariffs: number;
  status: string;
  latestCalculation: EsiosProfileIntermediateLog | null;
  sumIntermediateProfiles: Record<EsiosProfileTariff, number | null>;
  totalDemandUsedMw: number | null;
  totalForecastDemandMw: number | null;
  totalFinalDemandMw: number | null;
  totalReferenceDemandMw: number | null;
  finalDemandValidation?: {
    loadedHours: number;
    matchedHours: number;
    mismatchedHours: number;
    pendingHours: number;
    toleranceMw: number;
  };
  finalProfileValidation?: {
    loadedHours: number;
    matchedRows: number;
    mismatchedRows: number;
    pendingRows: number;
    tolerance: number;
  };
  profileValidation?: {
    matchedRows: number;
    mismatchedRows: number;
    tolerance: number;
  };
};

export type EsiosProfileIntermediatesResponse = {
  rows: EsiosProfileIntermediateRow[];
  total: number;
  hasNext: boolean;
  filters: EsiosProfilesFilters & { year: number };
};

export type EsiosProfileCalculationLogsResponse = {
  total: number;
  hasNext: boolean;
  logs: EsiosProfileIntermediateLog[];
};

export type EsiosProfilesUploadsResponse = {
  uploads: EsiosProfileUpload[];
  total: number;
  hasNext: boolean;
};

export type EsiosProfilesUploadResponse = {
  upload: EsiosProfileUpload;
  summary: EsiosProfilesSummary;
  rowsImported: number;
  coefficientsImported: number;
};

export type EsiosReeFinalDemandUpload = {
  id: string;
  year: number;
  month: number;
  day: number | null;
  periodKey: string | null;
  fileName: string;
  fileHash: string;
  uploadedAt: string;
  uploadedBy: string | null;
  status: string;
  errorMessage: string | null;
  totalRows: number;
  validRows: number;
  createdAt: string;
  updatedAt: string;
};

export type EsiosReeFinalDemandUploadsResponse = {
  uploads: EsiosReeFinalDemandUpload[];
  total: number;
  hasNext: boolean;
};

export type EsiosReeFinalDemandUploadResponse = {
  upload: EsiosReeFinalDemandUpload;
  rowsImported: number;
  validation: EsiosProfileIntermediateSummary;
};

export type EsiosReeFinalProfileUpload = {
  id: string;
  year: number;
  month: number;
  fileName: string;
  fileHash: string;
  uploadedAt: string;
  uploadedBy: string | null;
  status: string;
  errorMessage: string | null;
  totalRows: number;
  validRows: number;
  createdAt: string;
  updatedAt: string;
};

export type EsiosReeFinalProfileUploadsResponse = {
  uploads: EsiosReeFinalProfileUpload[];
  total: number;
  hasNext: boolean;
};

export type EsiosReeFinalProfileUploadResponse = {
  upload: EsiosReeFinalProfileUpload;
  rowsImported: number;
  validation: EsiosProfileIntermediateSummary;
};

export type UploadOptions = {
  overwrite?: boolean;
};

export type UploadConflict = {
  fileName: string;
  tipoArchivo: string;
  fecha: string;
  version: string;
  existingFileId: string;
  existingFileName: string;
  existingImportedAt: string;
};

export class UploadConflictError extends Error {
  conflicts: UploadConflict[];

  constructor(message: string, conflicts: UploadConflict[]) {
    super(message);
    this.name = "UploadConflictError";
    this.conflicts = conflicts;
  }
}

export type A1Record = {
  id: string;
  fileId: string;
  tipoArchivo: ReeFileType;
  version: ReeVersion;
  fechaLiquidacion: string;
  sujetoEic: string;
  brp?: string | null;
  fecha?: string | null;
  hora?: number | null;
  codigoUpr?: string | null;
  energiaMwh?: string | null;
  precioEurMwh?: string | null;
  importeEur?: string | null;
  codigoAgenteVendedor?: string | null;
  segmento?: string | null;
  facturacion?: string | null;
  eicUpr?: string | null;
  cuenta?: string | null;
  signoImporte?: string | null;
  signoMagnitud?: string | null;
  eicTitular?: string | null;
  codigoMagnitud?: string | null;
  codigoPrecio?: string | null;
  codigoApunte?: string | null;
  tipoOferta?: string | null;
  tipoUpr?: string | null;
  energiaContratoBilateralMwh?: string | null;
  sesion?: string | null;
  campoHora25?: string | null;
  importeCalculadoEur?: string | null;
  importeDiferenciaEur?: string | null;
  importeConsistente: boolean;
  precioAnomalo: boolean;
  validationErrors?: string[] | null;
  rawPayloadJson?: Record<string, string | null>;
  sourceLineNumber: number;
  file?: ReeFile;
};

export type Filters = {
  fecha?: string;
  fechaInicio?: string;
  fechaFin?: string;
  version?: ReeVersion;
  brp?: string;
  sujeto?: string;
  segmento?: string;
  codigoApunte?: string;
  codigoPrecio?: string;
  eicUpr?: string;
  skip?: number;
  take?: number;
};

export type MedperFilters = {
  fecha?: string;
  fechaInicio?: string;
  fechaFin?: string;
  version?: string;
  brp?: string;
  sujeto?: string;
  tarifa?: string;
  peaje?: string;
  upr?: string;
  codigoUnidad?: string;
  skip?: number;
  take?: number;
};

export type MedperFilterOptions = {
  versions: string[];
  months: string[];
  brps: string[];
  subjects: string[];
  qhPeajes: string[];
  qhUnits: string[];
  latestMonth: string | null;
};

export type SettlementFilterOptions = {
  versions: ReeVersion[];
  months: string[];
  brps: string[];
  subjects: string[];
  segments: string[];
  priceCodes: string[];
  settlementCodes: string[];
  eicUprs: string[];
  latestMonth: string | null;
};

export type SettlementSummary = {
  files: ReeFile[];
  hourly: SettlementGroup[];
  qh: SettlementGroup[];
  validation: {
    missingQhIntervals: Array<{
      fecha?: string | null;
      version: ReeVersion;
      sujetoEic: string;
      eicUpr?: string | null;
      intervals: number;
      missing: number;
    }>;
    inconsistentHourlyRecords: number;
    inconsistentQhRecords: number;
  };
};

export type SettlementGroup = {
  fechaLiquidacion: string;
  version: ReeVersion;
  segmento?: string | null;
  records: number;
  sums: {
    energiaMwh?: string | null;
    importeEur?: string | null;
    importeCalculadoEur?: string | null;
  };
};

export type CompareGroup = {
  version: ReeVersion;
  fechaLiquidacion: string;
  segmento?: string | null;
  codigoPrecio?: string | null;
  codigoApunte?: string | null;
  records: number;
  energiaMwh?: string | null;
  importeEur?: string | null;
};

export type CompareResponse = {
  hourly: CompareGroup[];
  qh: CompareGroup[];
};

export type MedperqhRecord = {
  id: string;
  fileId: string;
  tipoArchivo: MedperFileType;
  version: string;
  fechaInicio: string;
  fechaFin: string;
  sujetoEic: string;
  fecha: string;
  timestamp: string;
  hora: number;
  cuartoHora: number;
  codigoUnidad: string;
  peaje?: string | null;
  programaEnergiaMwh?: string | null;
  perdidasMwh?: string | null;
  bcMwh?: string | null;
  pfMwh?: string | null;
  bcPfDifferenceMwh?: string | null;
  negativeEnergy: boolean;
  bcPfInconsistent: boolean;
  validationErrors?: string[] | null;
  rawPayloadJson?: Record<string, string | null>;
  sourceLineNumber: number;
  file?: MedperFile;
};

export type MedperSummary = {
  files: MedperFile[];
  monthly: Array<{
    month: string;
    version: string;
    pfMwh?: string | null;
    perdidasMwh?: string | null;
    consumoMwh?: string | null;
  }>;
  qh: Array<{
    version: string;
    codigoUnidad: string;
    records: number;
    programaEnergiaMwh?: string | null;
    perdidasMwh?: string | null;
    bcMwh?: string | null;
    pfMwh?: string | null;
  }>;
  validation: {
    missingQh: Array<{
      fecha?: string | null;
      version: string;
      sujetoEic: string;
      codigoUnidad: string;
      intervals: number;
      missing: number;
    }>;
    negativeQhRecords: number;
    inconsistentBcPfRecords: number;
    byVersion: Array<{
      version: string;
      missingQh: number;
      negativeQhRecords: number;
      inconsistentBcPfRecords: number;
    }>;
  };
};

export type MedperCurves = {
  qh: Array<{
    timestamp: string;
    programaEnergiaMwh?: string | null;
    perdidasMwh?: string | null;
    bcMwh?: string | null;
    pfMwh?: string | null;
  }>;
};

export type MedperMonthlyConsumptionRow = {
  month: string;
  version: string;
  pfMwh?: string | null;
  perdidasMwh?: string | null;
  bcMwh?: string | null;
  consumoMwh?: string | null;
  hasData?: boolean;
};

export type MedperLossRow = {
  fecha: string;
  records: number;
  perdidasMwh?: string | null;
  bcMwh?: string | null;
  pfMwh?: string | null;
};

export type MedperConciliationRow = {
  fecha: string;
  codigoUnidad: string;
  records: number;
  programaEnergiaMwh?: string | null;
  perdidasMwh?: string | null;
  bcMwh?: string | null;
  pfMwh?: string | null;
  reganecuEnergiaMwh?: string | null;
  reganecuQhEnergiaMwh?: string | null;
  reganecuImporteEur?: string | null;
  reganecuQhImporteEur?: string | null;
  diferenciaBcReganecuMwh?: string | null;
  diferenciaPfReganecuMwh?: string | null;
  diferenciaBcReganecuQhMwh?: string | null;
  diferenciaPfReganecuQhMwh?: string | null;
};

export type LiquidationAnalysisFilters = {
  version?: ReeVersion;
  fecha?: string;
};

export type LiquidationAnalysisFilterOptions = {
  versions: ReeVersion[];
  months: string[];
  latestVersionByMonth: Array<{ month: string; version: ReeVersion }>;
  latestMonth: string | null;
};

export type LiquidationAnalysisRow = {
  fecha: string;
  diaSemana: number | null;
  version: ReeVersion;
  medidasRecords: number;
  reganecuRecords: number;
  reganecuQhRecords: number;
  medidaMwh?: string | null;
  programaMwh?: string | null;
  dsvMwh?: string | null;
  dsvPct?: string | null;
  dsvAbsMwh?: string | null;
  dsvAbsPct?: string | null;
  costeDsvEur?: string | null;
  precioDsvEurMwh?: string | null;
  costeCadEur?: string | null;
  precioCadEurMwh?: string | null;
  costePc3Eur?: string | null;
  precioPc3EurMwh?: string | null;
  costeBs3Eur?: string | null;
  precioBs3EurMwh?: string | null;
  costeRad3Eur?: string | null;
  precioRad3EurMwh?: string | null;
};

export type ReeLossesFilters = {
  mes?: string;
  fechaInicio?: string;
  fechaFin?: string;
  version?: ReeVersion;
  tarifa?: string;
  periodo?: string;
};

export type ReeLossesFilterOptions = {
  versions: ReeVersion[];
  months: string[];
  tarifas: string[];
  periodos: string[];
  latestMonth: string | null;
};

export type ReeLossesKpis = {
  perdidaMedia: number | null;
  perdidaMaxima: number | null;
  perdidaMinima: number | null;
  desviacionMediaVsBoe: number | null;
  diasAnomalos: number;
  registrosIncompletos: number;
  huecosDetectados: number;
  archivosProcesados: number;
  versionActivaUtilizada: string | null;
};

export type ReeLossesRow = {
  id: string;
  fecha: string;
  hora: number;
  cuartohora: number;
  tarifa: string;
  periodo: string;
  perdidaBoe: number | null;
  factorKAplicado: number;
  perdidaFinal: number | null;
  diferenciaVsBoe: number | null;
  diferenciaPct: number | null;
  tipoFicheroUtilizado: ReeKFactorFileType;
  version: ReeVersion;
  versionBoe: string | null;
  kestimValorK: number | null;
  krealValorK: number | null;
  anomalies: string[];
};

export type ReeLossesReport = {
  filters: ReeLossesFilters & {
    fechaInicio: string | null;
    fechaFin: string | null;
  };
  kpis: ReeLossesKpis;
  rows: ReeLossesRow[];
  anomalies: string[];
  gaps: {
    totalMissing: number;
    days: Array<{
      fecha: string;
      version: ReeVersion;
      tarifa: string;
      expected: number;
      present: number;
      missing: number;
    }>;
  };
};

export type ReeLossesAnnualSummaryRow = {
  mes: string;
  version: ReeVersion;
  tarifa: string;
  periodo: string;
  perdidaBoe: number | null;
  perdidaFinal: number | null;
  diferenciaVsBoe: number | null;
  diferenciaPct: number | null;
  records: number;
};

export type ReeLossesHeatmapSummaryRow = {
  fecha: string;
  hora: number;
  perdidaFinal: number | null;
};

export type ReeLossesVersionComparisonRow = {
  label: "BOE" | ReeVersion;
  value: number | null;
  records: number;
};

export type ReeLossesAnalyticsSummary = {
  latestMonth: string | null;
  latestVersion: ReeVersion | null;
  months: string[];
  latestVersionByMonth: Array<{ mes: string; version: ReeVersion }>;
  annualPeriodRows: ReeLossesAnnualSummaryRow[];
  heatmapRows: ReeLossesHeatmapSummaryRow[];
  versionComparison: ReeLossesVersionComparisonRow[];
};

const API_URL = resolveApiUrl();
const REQUEST_TIMEOUT_MS = 60000;
const AUTH_STORAGE_KEY = "ree-auditor-auth";

export type AuthSession = {
  token: string;
  user: string;
  expiresAt: string;
};

function resolveApiUrl() {
  const configured = import.meta.env.VITE_API_URL?.trim();
  if (configured && configured !== "auto") {
    return configured;
  }

  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:3000`;
  }

  return "http://localhost:3000";
}

export async function listImports(query: Pick<Filters, "skip" | "take"> = {}): Promise<ReeFile[]> {
  return getJson(`/imports${toQuery(query)}`);
}

export async function getReeDownloadCenterSummary(): Promise<ReeDownloadCenterSummaryRow[]> {
  return getJson(`/imports/download-center-summary`);
}

export async function login(username: string, password: string): Promise<AuthSession> {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!response.ok) {
    throw new Error(await readError(response, "No se pudo iniciar sesion."));
  }

  const session = (await response.json()) as AuthSession;
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  window.localStorage.setItem("ree-auditor-user", session.user);
  return session;
}

export function logout() {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
  window.localStorage.removeItem("ree-auditor-user");
}

export function getStoredAuthSession() {
  const text = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!text) {
    return undefined;
  }

  const session = parseJson(text) as Partial<AuthSession> | undefined;
  if (!session?.token || !session.user || !session.expiresAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    logout();
    return undefined;
  }

  return session as AuthSession;
}

export async function getImportFileDetail(id: string): Promise<ImportHistoryDetail> {
  return getJson(`/imports/${encodeURIComponent(id)}/detail`);
}

export async function getImportFileLogs(id: string): Promise<ImportHistoryLogs> {
  return getJson(`/imports/${encodeURIComponent(id)}/logs`);
}

export async function getImportFileErrorsCsv(id: string): Promise<string> {
  return withGlobalLoading(async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS * 2);
    try {
      const response = await fetch(`${API_URL}/imports/${encodeURIComponent(id)}/errors`, {
        signal: controller.signal,
        headers: authHeaders()
      });
      if (!response.ok) {
        handleUnauthorized(response);
        throw new Error(await readError(response, "Error descargando errores."));
      }

      return response.text();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Tiempo de espera agotado descargando errores.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }, { label: "Descargando errores" });
}

export async function reprocessImportFile(id: string): Promise<ImportResponse | MedperImportResponse> {
  return sendJson(`/imports/${encodeURIComponent(id)}/reprocess`, "POST", "Reprocesando carga", REQUEST_TIMEOUT_MS * 4);
}

export async function deleteImportFile(id: string): Promise<DeleteImportFileResponse> {
  return sendJson(`/imports/${encodeURIComponent(id)}`, "DELETE", "Eliminando carga");
}

export async function uploadReganecuFiles(
  files: File[],
  onProgress?: (progress: number) => void,
  options: UploadOptions = {}
): Promise<ImportResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file, file.name);
  }

  return sendMultipart(`${API_URL}/imports/reganecu${toQuery({ overwrite: options.overwrite ? "true" : undefined })}`, formData, onProgress);
}

export async function uploadMedperFiles(
  files: File[],
  onProgress?: (progress: number) => void,
  options: UploadOptions = {}
): Promise<MedperImportResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file, file.name);
  }

  return sendMultipart<MedperImportResponse>(`${API_URL}/imports/medper${toQuery({ overwrite: options.overwrite ? "true" : undefined })}`, formData, onProgress);
}

export async function uploadReeLossesFiles(files: File[], onProgress?: (progress: number) => void): Promise<ReeLossesImportResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file, file.name);
  }

  return sendMultipart<ReeLossesImportResponse>(`${API_URL}/ree-losses/import`, formData, onProgress);
}

export async function listReganecu(filters: Filters): Promise<A1Record[]> {
  return getJson(`/reganecu${toQuery(filters)}`);
}

export async function listReganecuQh(filters: Filters): Promise<A1Record[]> {
  return getJson(`/reganecu-qh${toQuery(filters)}`);
}

export async function getSettlementSummary(filters: Filters): Promise<SettlementSummary> {
  return getJson(`/settlements/summary${toQuery(filters)}`);
}

export async function getSettlementFilterOptions(): Promise<SettlementFilterOptions> {
  return getJson(`/settlements/filters`);
}

export async function compareVersions(filters: Filters): Promise<CompareResponse> {
  return getJson(`/settlements/compare-versions${toQuery(filters)}`);
}

export async function listMedperFiles(query: Pick<MedperFilters, "skip" | "take"> = {}): Promise<MedperFile[]> {
  return getJson(`/medper/files${toQuery(query)}`);
}

export async function getMedperFilterOptions(filters: MedperFilters = {}): Promise<MedperFilterOptions> {
  return getJson(`/medper/filters${toQuery(filters)}`);
}

export async function getMedperSummary(filters: MedperFilters): Promise<MedperSummary> {
  return getJson(`/medper/summary${toQuery(filters)}`);
}

export async function listMedperqh(filters: MedperFilters): Promise<MedperqhRecord[]> {
  return getJson(`/medper/qh${toQuery(filters)}`);
}

export async function getMedperCurves(filters: MedperFilters): Promise<MedperCurves> {
  return getJson(`/medper/curves${toQuery(filters)}`);
}

export async function getMedperMonthlyConsumption(): Promise<MedperMonthlyConsumptionRow[]> {
  return getJson(`/medper/monthly-consumption`);
}

export async function getMedperLosses(filters: MedperFilters): Promise<MedperLossRow[]> {
  return getJson(`/medper/losses${toQuery(filters)}`);
}

export async function getMedperConciliation(filters: MedperFilters): Promise<MedperConciliationRow[]> {
  return getJson(`/medper/conciliation${toQuery(filters)}`);
}

export async function getLiquidationAnalysisFilterOptions(): Promise<LiquidationAnalysisFilterOptions> {
  return getJson(`/liquidation-analysis/filters`);
}

export async function getLiquidationAnalysisReport(filters: LiquidationAnalysisFilters): Promise<LiquidationAnalysisRow[]> {
  return getJson(`/liquidation-analysis/report${toQuery(filters)}`);
}

export async function getReeLossesFilterOptions(): Promise<ReeLossesFilterOptions> {
  return getJson(`/ree-losses/filters`);
}

export async function getReeLossesAnalyticsSummary(): Promise<ReeLossesAnalyticsSummary> {
  return getJson(`/ree-losses/analytics-summary`);
}

export async function listReeLossesImports(query: { skip?: number; take?: number } = {}): Promise<ReeLossesImportFile[]> {
  return getJson(`/ree-losses/imports${toQuery(query)}`);
}

export async function getReeLossesReport(filters: ReeLossesFilters): Promise<ReeLossesReport> {
  return getJson(`/ree-losses/report${toQuery(filters)}`);
}

export async function getOmieProgramaMercadoDiario(fecha: string): Promise<OmieProgramaResponse> {
  return getJson(`/omie/programas/mercado-diario${toQuery({ fecha })}`);
}

export async function getOmieProgramaIntradiario(fecha: string, sesion: string): Promise<OmieProgramaResponse> {
  return getJson(`/omie/programas/intradiario${toQuery({ fecha, sesion })}`);
}

export async function getOmieProgramasEvolucion(fecha: string): Promise<OmieProgramaEvolucionResponse> {
  return getJson(`/omie/programas/evolucion${toQuery({ fecha })}`);
}

export async function getOmieDescargasControl(filters: OmieDownloadControlFilters = {}): Promise<OmieDownloadControlRow[]> {
  return getJson(`/omie/descargas/control${toQuery(filters)}`);
}

export async function getOmieDescargaDetalle(id: string): Promise<OmieDownloadDetail> {
  return getJson(`/omie/descargas/control/${encodeURIComponent(id)}/detalle`);
}

export async function executeOmieDescarga(request: OmieDownloadExecuteRequest, force = false): Promise<OmieDownloadExecuteResponse> {
  return sendJson(
    `/omie/descargas/ejecutar${force ? "?force=true" : ""}`,
    "POST",
    force ? "Redescargando consulta OMIE" : "Descargando consulta OMIE",
    REQUEST_TIMEOUT_MS * 6,
    request
  );
}

export async function executeOmieDescargaDiaria(fecha: string, force = false): Promise<OmieDailyBulkDownloadResponse> {
  return sendJson(
    `/omie/descargas/ejecutar-dia${force ? "?force=true" : ""}`,
    "POST",
    force ? "Redescargando día OMIE" : "Descargando día OMIE",
    REQUEST_TIMEOUT_MS * 20,
    { fecha }
  );
}

export async function getOmieAutomationConfig(): Promise<OmieAutomationConfig> {
  return getJson(`/omie/descargas/automatizacion`);
}

export async function saveOmieAutomationConfig(config: Partial<OmieAutomationConfig>): Promise<OmieAutomationConfig> {
  return sendJson(`/omie/descargas/automatizacion`, "PUT", "Guardando automatismo OMIE", REQUEST_TIMEOUT_MS, config);
}

export async function executeOmieAutomation(daysBack: number): Promise<OmieAutomationRunResponse> {
  return sendJson(`/omie/descargas/automatizacion/ejecutar`, "POST", "Ejecutando automatismo OMIE", REQUEST_TIMEOUT_MS * 20, {
    session: "00:00",
    daysBack
  });
}

export async function reprocessOmieDescarga(id: string): Promise<OmieDownloadExecuteResponse> {
  return sendJson(`/omie/descargas/control/${encodeURIComponent(id)}/reprocesar`, "POST", "Reprocesando descarga OMIE", REQUEST_TIMEOUT_MS * 6);
}

export async function redownloadOmieDescarga(id: string): Promise<OmieDownloadExecuteResponse> {
  return sendJson(`/omie/descargas/control/${encodeURIComponent(id)}/redescargar`, "POST", "Redescargando OMIE", REQUEST_TIMEOUT_MS * 6);
}

export async function getOmiePrecios(fecha: string): Promise<OmiePreciosResponse> {
  return getJson(`/omie/precios${toQuery({ fecha })}`);
}

export async function getOmieAnalisisMensual(year: number | string, month: number | string): Promise<OmieAnalisisMensualResponse> {
  return getJson(`/omie/analisis/mensual${toQuery({ year, month })}`);
}

export async function getOmieComprobacionLiquidaciones(year: number | string, month: number | string): Promise<OmieComprobacionLiquidacionesResponse> {
  return getJson(`/omie/analisis/comprobacion-liquidaciones${toQuery({ year, month })}`);
}

export async function saveOmieLiquidationInvoice(fecha: string, facturaCompra: number | null, facturaVenta: number | null): Promise<OmieLiquidationInvoiceResponse> {
  return sendJson(`/omie/analisis/comprobacion-liquidaciones/factura`, "POST", "Guardando factura OMIE", REQUEST_TIMEOUT_MS, {
    fecha,
    facturaCompra,
    facturaVenta
  });
}

export async function getOmieTransactionsHistorico(filters: OmieTransactionDownloadFilters = {}): Promise<OmieTransactionHistoricoResponse> {
  return getJson(`/omie/transacciones/historico${toQuery(filters)}`);
}

export async function getOmieTransactionStagingRows(downloadId: string, take = 100): Promise<OmieTransactionStagingRowsResponse> {
  return getJson(`/omie/transacciones/historico/${encodeURIComponent(downloadId)}/filas${toQuery({ take })}`);
}

export async function getEsiosConfig(): Promise<EsiosConfig> {
  return getJson(`/esios/config`);
}

export async function saveEsiosConfig(config: Partial<EsiosConfig> & { apiToken?: string }): Promise<EsiosConfig> {
  return sendJson(`/esios/config`, "PUT", "Guardando configuracion ESIOS", REQUEST_TIMEOUT_MS, config);
}

export async function testEsiosConnection(): Promise<EsiosConnectionResult> {
  return sendJson(`/esios/test-connection`, "POST", "Probando conexion ESIOS", REQUEST_TIMEOUT_MS * 2);
}

export async function getEsiosIndicators(): Promise<EsiosIndicator[]> {
  return getJson(`/esios/indicators`);
}

export async function getEsiosIndicatorValues(indicatorId: number, filters: EsiosValuesFilters = {}): Promise<EsiosValuesResponse> {
  return getJson(`/esios/indicators/${encodeURIComponent(indicatorId)}/values${toQuery(filters)}`);
}

export async function syncEsiosIndicators(): Promise<EsiosSyncIndicatorsResponse> {
  return sendJson(`/esios/indicators/sync`, "POST", "Sincronizando catalogo ESIOS", REQUEST_TIMEOUT_MS * 4);
}

export async function getEsiosDemandForecast(filters: EsiosValuesFilters = {}): Promise<EsiosValuesResponse> {
  return getJson(`/esios/demanda-prevista${toQuery(filters)}`);
}

export async function downloadEsiosDemandForecast(startDate: string, endDate: string): Promise<EsiosDownloadSummary> {
  return downloadEsiosIndicator(460, startDate, endDate);
}

export async function downloadEsiosIndicator(indicatorId: number, startDate: string, endDate: string): Promise<EsiosDownloadSummary> {
  return sendJson(
    `/esios/indicators/${encodeURIComponent(indicatorId)}/download`,
    "POST",
    "Descargando ESIOS",
    REQUEST_TIMEOUT_MS * 6,
    { startDate, endDate }
  );
}

export async function getEsiosDownloadLogs(query: { indicatorId?: number; skip?: number; take?: number } = {}): Promise<EsiosDownloadLogsResponse> {
  return getJson(`/esios/download-logs${toQuery(query)}`);
}

export async function getEsiosInitialProfiles(filters: EsiosProfilesFilters = {}): Promise<EsiosInitialProfilesResponse> {
  return getJson(`/esios/profiles/initial${toQuery(filters)}`);
}

export async function getEsiosProfilesSummary(year: number | string): Promise<EsiosProfilesSummary> {
  return getJson(`/esios/profiles/summary/${encodeURIComponent(year)}`);
}

export async function getEsiosProfileCoefficients(year: number | string): Promise<EsiosProfileCoefficient[]> {
  return getJson(`/esios/profiles/coefficients/${encodeURIComponent(year)}`);
}

export async function saveEsiosProfileCoefficients(year: number | string, coefficients: EsiosProfileCoefficient[]): Promise<EsiosProfileCoefficient[]> {
  return sendJson(`/esios/profiles/coefficients/${encodeURIComponent(year)}`, "PUT", "Guardando coeficientes ESIOS", REQUEST_TIMEOUT_MS, { coefficients });
}

export async function getEsiosProfileUploads(query: { year?: number | string; skip?: number; take?: number } = {}): Promise<EsiosProfilesUploadsResponse> {
  return getJson(`/esios/profiles/uploads${toQuery(query)}`);
}

export async function calculateEsiosIntermediateProfiles(year: number | string): Promise<{ summary: EsiosProfileIntermediateSummary; rowsProcessed: number; tariffsProcessed: number }> {
  return sendJson<{ summary: EsiosProfileIntermediateSummary; rowsProcessed: number; tariffsProcessed: number }>(
    `/esios/profiles/intermediate/${encodeURIComponent(year)}/calculate`,
    "POST",
    "Calculando perfiles intermedios",
    REQUEST_TIMEOUT_MS * 8
  );
}

export async function getEsiosIntermediateProfiles(filters: EsiosProfilesFilters = {}): Promise<EsiosProfileIntermediatesResponse> {
  return getJson(`/esios/profiles/intermediate${toQuery(filters)}`);
}

export async function getEsiosIntermediateProfilesSummary(year: number | string): Promise<EsiosProfileIntermediateSummary> {
  return getJson(`/esios/profiles/intermediate/summary/${encodeURIComponent(year)}`);
}

export async function getEsiosProfileCalculationLogs(query: { year?: number | string; skip?: number; take?: number } = {}): Promise<EsiosProfileCalculationLogsResponse> {
  return getJson(`/esios/profiles/intermediate/logs${toQuery(query)}`);
}

export async function uploadEsiosProfiles(file: File, year: number | string, replace = false, onProgress?: (progress: number) => void): Promise<EsiosProfilesUploadResponse> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  return sendMultipart<EsiosProfilesUploadResponse>(`${API_URL}/esios/profiles/upload${toQuery({ year, replace: replace ? "true" : undefined })}`, formData, onProgress);
}

export async function getEsiosReeFinalDemandUploads(query: { year?: number | string; month?: number | string; day?: number | string; skip?: number; take?: number } = {}): Promise<EsiosReeFinalDemandUploadsResponse> {
  return getJson(`/esios/profiles/final-demand/uploads${toQuery(query)}`);
}

export async function uploadEsiosReeFinalDemand(
  file: File,
  year: number | string,
  month: number | string,
  replace = false,
  onProgress?: (progress: number) => void,
  day?: number | string
): Promise<EsiosReeFinalDemandUploadResponse> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  return sendMultipart<EsiosReeFinalDemandUploadResponse>(`${API_URL}/esios/profiles/final-demand/upload${toQuery({ year, month, day, replace: replace ? "true" : undefined })}`, formData, onProgress);
}

export async function getEsiosReeFinalProfileUploads(query: { year?: number | string; month?: number | string; skip?: number; take?: number } = {}): Promise<EsiosReeFinalProfileUploadsResponse> {
  return getJson(`/esios/profiles/final-profiles/uploads${toQuery(query)}`);
}

export async function uploadEsiosReeFinalProfiles(
  file: File,
  year: number | string,
  month: number | string,
  replace = false,
  onProgress?: (progress: number) => void
): Promise<EsiosReeFinalProfileUploadResponse> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  return sendMultipart<EsiosReeFinalProfileUploadResponse>(`${API_URL}/esios/profiles/final-profiles/upload${toQuery({ year, month, replace: replace ? "true" : undefined })}`, formData, onProgress);
}

async function getJson<T>(path: string): Promise<T> {
  return withGlobalLoading(async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_URL}${path}`, { signal: controller.signal, headers: authHeaders() });
      if (!response.ok) {
        handleUnauthorized(response);
        throw new Error(await readError(response, "Error consultando la API."));
      }

      return response.json();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Tiempo de espera agotado consultando la API.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }, { label: "Cargando datos" });
}

async function sendJson<T>(path: string, method: "POST" | "PUT" | "DELETE", label: string, timeoutMs = REQUEST_TIMEOUT_MS, body?: unknown): Promise<T> {
  return withGlobalLoading(async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${API_URL}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          ...authHeaders(),
          "X-User": getAuditUser(),
          ...(body === undefined ? {} : { "Content-Type": "application/json" })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      if (!response.ok) {
        handleUnauthorized(response);
        throw new Error(await readError(response, "Error procesando la acción."));
      }

      return response.json();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Tiempo de espera agotado procesando la acción.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }, { label });
}

function sendMultipart<TResponse = ImportResponse>(
  url: string,
  body: FormData,
  onProgress?: (progress: number) => void
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    const stopLoading = beginLoading({ label: "Importando ficheros", timeoutMs: REQUEST_TIMEOUT_MS * 4 });
    let settled = false;
    const request = new XMLHttpRequest();
    request.timeout = REQUEST_TIMEOUT_MS * 4;
    request.open("POST", url);
    const authHeader = authHeaders().Authorization;
    if (authHeader) {
      request.setRequestHeader("Authorization", authHeader);
    }
    request.setRequestHeader("X-User", getAuditUser());
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      stopLoading();
      callback();
    };
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onload = () => {
      const payload = parseJson(request.responseText);
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(100);
        finish(() => resolve(payload as TResponse));
        return;
      }

      if (request.status === 409 && isUploadConflictPayload(payload)) {
        finish(() => reject(new UploadConflictError(readErrorPayload(payload) ?? "Ya existe una carga previa.", payload.conflicts)));
        return;
      }

      if (request.status === 401) {
        logout();
        window.dispatchEvent(new Event("ree-auditor-auth-expired"));
      }
      finish(() => reject(new Error(readErrorPayload(payload) ?? (request.responseText || "No se pudo importar."))));
    };
    request.onerror = () => finish(() => reject(new Error("No se pudo conectar con la API.")));
    request.ontimeout = () => finish(() => reject(new Error("Tiempo de espera agotado importando ficheros.")));
    request.onabort = () => finish(() => reject(new Error("Importación cancelada.")));
    request.send(body);
  });
}

function isUploadConflictPayload(payload: unknown): payload is { conflicts: UploadConflict[] } {
  return (
    !!payload &&
    typeof payload === "object" &&
    "conflicts" in payload &&
    Array.isArray((payload as { conflicts?: unknown }).conflicts)
  );
}

function getAuditUser() {
  return window.localStorage.getItem("ree-auditor-user")?.trim() || "web";
}

function authHeaders(): Record<string, string> {
  const session = getStoredAuthSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}

function handleUnauthorized(response: Response) {
  if (response.status === 401) {
    logout();
    window.dispatchEvent(new Event("ree-auditor-auth-expired"));
  }
}

function toQuery(filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }

  const text = params.toString();
  return text ? `?${text}` : "";
}

async function readError(response: Response, fallback: string) {
  const text = await response.text();
  const payload = parseJson(text);
  return readErrorPayload(payload) ?? (text || fallback);
}

function parseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readErrorPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const message = "message" in payload ? (payload as { message?: unknown }).message : undefined;
  if (Array.isArray(message)) {
    return message.join(" ");
  }

  return typeof message === "string" ? message : undefined;
}
