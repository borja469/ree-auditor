export type SipsKind = "PS" | "CONSUMPTION";
export type CsvRow = Record<string, string>;

// Cabeceras verificadas con las dos respuestas CNMC de ejemplo.
export const PS_HEADERS = "codigoEmpresaDistribuidora,nombreEmpresaDistribuidora,cups,referenciaCatastralPS,XPS,YPS,HusoPS,BandaPS,PaisPS,codigoProvinciaPS,desProvinciaPS,codigoMunicipioPS,desMunicipioPS,PoblacionPS,desPoblacionPS,codigoPostalPS,tipoViaPS,viaPS,numFincaPS,duplicadorFincaPS,escaleraPS,pisoPS,puertaPS,tipoAclaradorFincaPS,aclaradorFincaPS,fechaAltaSuministro,codigoTarifaATREnVigor,codigoSegmentoCargoEnVigor,codigoTensionV,potenciaMaximaBIEW,potenciaMaximaAPMW,codigoClasificacionPS,tipoControDelPotencia,tipoPerfilConsumo,valorDerechosExtensionW,valorDerechosAccesoW,codigoPropiedadEquipoMedida,codigoPropiedadICP,potenciasContratadasEnWP1,potenciasContratadasEnWP2,potenciasContratadasEnWP3,potenciasContratadasEnWP4,potenciasContratadasEnWP5,potenciasContratadasEnWP6,fechaUltimoMovimientoContrato,fechaUltimoCambioComercializador,cambioComercializadorEnCurso,codigoComercializadorVigente,fechaUltimoCambioAgregadorIndependiente,cambioAgregadorIndependienteEnCurso,codigoAgregadorIndependienteVigente,fechaLimiteDerechosReconocidos,fechaUltimaLectura,suspensionSuminstroImpago,tipoPersona,tipoIdTitular,idTitular,nombreTitular,apellido1Titular,apellido2Titular,PaisTitular,codigoProvinciaTitular,desProvinciaTitular,codigoMunicipioTitular,desMunicipioTitular,PoblacionTitular,desPoblacionTitular,codigoPostalTitular,tipoViaTitular,viaTitular,numFincaTitular,duplicadorFincaTitular,escaleraTitular,pisoTitular,puertaTitular,tipoAclaradorFincaTitular,aclaradorFincaTitular,esViviendaHabitual,codigoLecturaRemota,codigoFasesEquipoMedida,acogimientoAutoconsumo,aplicacionBonoSocial,suministroEsencial,cnae,codigoTipoContrato,codigoPeriodicidadFacturacion,codigoBIE,fechaEmisionBIE,fechaCaducidadBIE,codigoAPM,fechaEmisionAPM,fechaCaducidadAPM,relacionTransformacionIntensidad,codigoModoControlPotencia,potenciaCGPW,codigoDHEquipoDeMedida,codigoAccesibilidadContador,codigoPSContratable,motivoEstadoNoContratable,codigoTensionMedida,codigoClaseExpediente,codigoMotivoExpediente,codigoTipoSuministro".split(",");
export const CONSUMPTION_HEADERS = "cups,fechaInicioMesConsumo,fechaFinMesConsumo,codigoTarifaATR,consumoEnergiaActivaEnWhP1,consumoEnergiaActivaEnWhP2,consumoEnergiaActivaEnWhP3,consumoEnergiaActivaEnWhP4,consumoEnergiaActivaEnWhP5,consumoEnergiaActivaEnWhP6,consumoEnergiaReactivaInductivaEnVArhP1,consumoEnergiaReactivaInductivaEnVArhP2,consumoEnergiaReactivaInductivaEnVArhP3,consumoEnergiaReactivaInductivaEnVArhP4,consumoEnergiaReactivaInductivaEnVArhP5,consumoEnergiaReactivaInductivaEnVArhP6,consumoEnergiaReactivaCapacitivaEnVArhP1,consumoEnergiaReactivaCapacitivaEnVArhP2,consumoEnergiaReactivaCapacitivaEnVArhP3,consumoEnergiaReactivaCapacitivaEnVArhP4,consumoEnergiaReactivaCapacitivaEnVArhP5,consumoEnergiaReactivaCapacitivaEnVArhP6,potenciaDemandadaEnWP1,potenciaDemandadaEnWP2,potenciaDemandadaEnWP3,potenciaDemandadaEnWP4,potenciaDemandadaEnWP5,potenciaDemandadaEnWP6,codigoDHEquipoDeMedida,codigoTipoLectura".split(",");

export class SipsCsvError extends Error {
  constructor(public readonly code: "NO_RESULTS" | "INVALID_CSV" | "CUPS_MISMATCH") { super(code); }
}

export async function readSipsCsv(response: Response): Promise<string> {
  const bytes = await response.arrayBuffer();
  const declaredCharset = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(response.headers.get("content-type") ?? "")?.[1];
  if (declaredCharset) {
    try { return new TextDecoder(declaredCharset, { fatal: true }).decode(bytes); }
    catch { /* La cabecera puede declarar una codificación errónea. */ }
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("windows-1252").decode(bytes); }
}

export function parseSipsCsv(input: string, kind: SipsKind, cups: string): CsvRow[] {
  const csv = input.replace(/^\uFEFF/, "");
  const trimmed = csv.trim();
  if (!trimmed || /no (se (han )?encontrad[oa]|existen|hay) (resultados|datos|registros)|sin resultados|no results/i.test(trimmed) && !trimmed.toLowerCase().startsWith("cups,")) {
    throw new SipsCsvError("NO_RESULTS");
  }
  const matrix = parseCsvMatrix(csv);
  const headers = matrix.shift()?.map((field) => field.trim()) ?? [];
  const expected = kind === "PS" ? PS_HEADERS : CONSUMPTION_HEADERS;
  if (headers.length < expected.length || headers.some((field, index) => !field || headers.indexOf(field) !== index) || expected.some((field) => !headers.includes(field))) {
    throw new SipsCsvError("INVALID_CSV");
  }
  const records = matrix.filter((line) => line.some((value) => value !== ""));
  if (!records.length) throw new SipsCsvError("NO_RESULTS");
  return records.map((line) => {
    if (line.length !== headers.length) throw new SipsCsvError("INVALID_CSV");
    const row = Object.fromEntries(headers.map((header, index) => [header, line[index]]));
    if (row.cups?.toUpperCase() !== cups.toUpperCase()) throw new SipsCsvError("CUPS_MISMATCH");
    if (kind === "CONSUMPTION" && (!validDate(row.fechaInicioMesConsumo) || !validDate(row.fechaFinMesConsumo) || row.fechaInicioMesConsumo > row.fechaFinMesConsumo)) {
      throw new SipsCsvError("INVALID_CSV");
    }
    return row;
  });
}

export function toThousands(value: string | undefined): number | null {
  if (!value) return null;
  const number = Number(value.replace(",", "."));
  return Number.isFinite(number) ? number / 1000 : null;
}

export function normalizeConsumption(row: CsvRow) {
  const magnitudes = {
    active: periods(row, "consumoEnergiaActivaEnWh"),
    inductive: periods(row, "consumoEnergiaReactivaInductivaEnVArh"),
    capacitive: periods(row, "consumoEnergiaReactivaCapacitivaEnVArh"),
    demand: periods(row, "potenciaDemandadaEnW")
  };
  return {
    cups: row.cups, dateFrom: row.fechaInicioMesConsumo, dateTo: row.fechaFinMesConsumo,
    tariff: row.codigoTarifaATR, readingType: row.codigoTipoLectura,
    magnitudes,
    totals: {
      active: sum(magnitudes.active), inductive: sum(magnitudes.inductive), capacitive: sum(magnitudes.capacitive),
      demandMax: Math.max(0, ...magnitudes.demand.filter((value): value is number => value !== null))
    }
  };
}

export const HOLDER_FIELDS = new Set(PS_HEADERS.filter((key) => /Titular$|^tipoPersona$|^tipoIdTitular$|^idTitular$|^PaisTitular$/.test(key)));
export function publicPs(row: CsvRow): CsvRow {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !HOLDER_FIELDS.has(key)));
}

function periods(row: CsvRow, prefix: string) {
  return Array.from({ length: 6 }, (_, index) => toThousands(row[`${prefix}P${index + 1}`]));
}
function sum(values: Array<number | null>) { return values.reduce<number>((total, value) => total + (value ?? 0), 0); }
function validDate(value: string | undefined) { return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)); }

function parseCsvMatrix(csv: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index];
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') { field += '"'; index++; }
      else if (quoted || field === "") quoted = !quoted;
      else throw new SipsCsvError("INVALID_CSV");
    } else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && csv[index + 1] === "\n") index++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (quoted) throw new SipsCsvError("INVALID_CSV");
  row.push(field); rows.push(row);
  return rows;
}
