import type { OmieConsultaEncolumnadaFila, OmieConsultaEncolumnadaResult } from "./omie-siom2.types";

export const OMIE_ENERGIA_PVD_CODIGO = "5302";
export const OMIE_ENERGIA_PHF_CODIGO = "5608";
export const OMIE_ENERGIA_STROM_UOFERTANTE = "STROC01";
export const OMIE_ENERGIA_UMEDIDA = "E";
export const OMIE_ENERGIA_RESOLUCION = "PT15M" as const;
export const OMIE_ENERGIA_DEFAULT_PHF_SESIONES = ["01", "02", "03", "04", "05", "06"] as const;

export type OmieEnergiaPeriodo = {
  periodo: number;
  energia: number;
};

export type OmieEnergiaPvdResponse = {
  fecha: string;
  resolucion: typeof OMIE_ENERGIA_RESOLUCION;
  periodos: OmieEnergiaPeriodo[];
};

export type OmieEnergiaPhfResponse = OmieEnergiaPvdResponse & {
  sesion: string;
};

export type OmieEnergiaDiferenciaPeriodo = {
  periodo: number;
  energiaDesde: number | null;
  energiaHasta: number | null;
  diferencia: number | null;
};

export type OmieEnergiaDiferenciaSerie = {
  desde: string;
  hasta: string;
  periodos: OmieEnergiaDiferenciaPeriodo[];
};

export type OmieEnergiaEvolucionPeriodo = {
  periodo: number;
  pvd: number | null;
  sesiones: Record<string, number | null>;
  diferencias: Record<string, number | null>;
};

export type OmieEnergiaEvolucionResponse = {
  fecha: string;
  resolucion: typeof OMIE_ENERGIA_RESOLUCION;
  pvd: OmieEnergiaPvdResponse;
  sesiones: OmieEnergiaPhfResponse[];
  diferencias: OmieEnergiaDiferenciaSerie[];
  periodos: OmieEnergiaEvolucionPeriodo[];
};

export function buildOmieEnergiaPvdResponse(fecha: string, result: OmieConsultaEncolumnadaResult): OmieEnergiaPvdResponse {
  return {
    fecha,
    resolucion: OMIE_ENERGIA_RESOLUCION,
    periodos: extractOmieEnergiaPeriodos(result)
  };
}

export function buildOmieEnergiaPhfResponse(fecha: string, sesion: string, result: OmieConsultaEncolumnadaResult): OmieEnergiaPhfResponse {
  return {
    fecha,
    sesion: normalizeOmieEnergiaSesion(sesion),
    resolucion: OMIE_ENERGIA_RESOLUCION,
    periodos: extractOmieEnergiaPeriodos(result)
  };
}

export function buildOmieEnergiaEvolucionResponse(
  fecha: string,
  pvd: OmieEnergiaPvdResponse,
  sesiones: OmieEnergiaPhfResponse[]
): OmieEnergiaEvolucionResponse {
  const sesionesOrdenadas = [...sesiones].sort((left, right) => Number(left.sesion) - Number(right.sesion));
  const series = [
    { label: "PVD", periodos: pvd.periodos },
    ...sesionesOrdenadas.map((sesion) => ({
      label: sesion.sesion,
      periodos: sesion.periodos
    }))
  ];
  const diferencias: OmieEnergiaDiferenciaSerie[] = [];

  for (let index = 1; index < series.length; index += 1) {
    const desde = series[index - 1];
    const hasta = series[index];
    diferencias.push(buildDiferenciaSerie(desde.label, hasta.label, desde.periodos, hasta.periodos));
  }

  return {
    fecha,
    resolucion: OMIE_ENERGIA_RESOLUCION,
    pvd,
    sesiones: sesionesOrdenadas,
    diferencias,
    periodos: buildEvolucionPeriodos(pvd, sesionesOrdenadas, diferencias)
  };
}

export function parseOmieEnergiaSesionList(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [...OMIE_ENERGIA_DEFAULT_PHF_SESIONES];
  }

  const sesiones = value
    .split(/[,\s;]+/)
    .map((sesion) => sesion.trim())
    .filter(Boolean)
    .map(normalizeOmieEnergiaSesion);

  return [...new Set(sesiones)].sort((left, right) => Number(left) - Number(right));
}

export function normalizeOmieEnergiaSesion(value: string): string {
  const trimmed = value.trim();
  if (!/^\d{1,2}$/.test(trimmed)) {
    throw new OmieEnergiaTransformError(`Sesion OMIE no valida: ${value}`);
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new OmieEnergiaTransformError(`Sesion OMIE no valida: ${value}`);
  }

  return String(parsed).padStart(2, "0");
}

function extractOmieEnergiaPeriodos(result: Pick<OmieConsultaEncolumnadaResult, "filas">): OmieEnergiaPeriodo[] {
  return (result.filas ?? [])
    .map((fila, index) => ({
      periodo: parsePeriodo(readRequiredCell(fila, ["Periodo"], index)),
      energia: parseNumber(readRequiredCell(fila, ["Energia"], index))
    }))
    .sort((left, right) => left.periodo - right.periodo);
}

function buildDiferenciaSerie(
  desde: string,
  hasta: string,
  periodosDesde: OmieEnergiaPeriodo[],
  periodosHasta: OmieEnergiaPeriodo[]
): OmieEnergiaDiferenciaSerie {
  const desdeMap = toPeriodoMap(periodosDesde);
  const hastaMap = toPeriodoMap(periodosHasta);

  return {
    desde,
    hasta,
    periodos: sortedPeriodoUnion(desdeMap, hastaMap).map((periodo) => {
      const energiaDesde = desdeMap.get(periodo) ?? null;
      const energiaHasta = hastaMap.get(periodo) ?? null;

      return {
        periodo,
        energiaDesde,
        energiaHasta,
        diferencia: energiaDesde === null || energiaHasta === null ? null : roundEnergy(energiaHasta - energiaDesde)
      };
    })
  };
}

function buildEvolucionPeriodos(
  pvd: OmieEnergiaPvdResponse,
  sesiones: OmieEnergiaPhfResponse[],
  diferencias: OmieEnergiaDiferenciaSerie[]
): OmieEnergiaEvolucionPeriodo[] {
  const pvdMap = toPeriodoMap(pvd.periodos);
  const sesionesMap = new Map(sesiones.map((sesion) => [sesion.sesion, toPeriodoMap(sesion.periodos)]));
  const diferenciasMap = new Map(
    diferencias.map((diferencia) => [
      `${diferencia.desde}->${diferencia.hasta}`,
      new Map(diferencia.periodos.map((periodo) => [periodo.periodo, periodo.diferencia]))
    ])
  );
  const periodos = new Set<number>(pvdMap.keys());

  for (const map of sesionesMap.values()) {
    for (const periodo of map.keys()) {
      periodos.add(periodo);
    }
  }

  return [...periodos]
    .sort((left, right) => left - right)
    .map((periodo) => ({
      periodo,
      pvd: pvdMap.get(periodo) ?? null,
      sesiones: Object.fromEntries([...sesionesMap.entries()].map(([sesion, map]) => [sesion, map.get(periodo) ?? null])),
      diferencias: Object.fromEntries([...diferenciasMap.entries()].map(([label, map]) => [label, map.get(periodo) ?? null]))
    }));
}

function readRequiredCell(fila: OmieConsultaEncolumnadaFila, aliases: string[], rowIndex: number) {
  const aliasSet = new Set(aliases.map(normalizeColumnName));
  const entry = Object.entries(fila).find(([key]) => aliasSet.has(normalizeColumnName(key)));
  const value = entry?.[1]?.trim();

  if (!value) {
    throw new OmieEnergiaTransformError(`La fila OMIE ${rowIndex + 1} no contiene valor para ${aliases.join("/")}.`);
  }

  return value;
}

function parsePeriodo(value: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new OmieEnergiaTransformError(`Periodo OMIE no valido: ${value}`);
  }

  return parsed;
}

function parseNumber(value: string) {
  const normalized = normalizeNumberText(value);
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new OmieEnergiaTransformError(`Valor de energia OMIE no valido: ${value}`);
  }

  return parsed;
}

function normalizeNumberText(value: string) {
  const compact = value.trim().replace(/\s+/g, "");
  if (compact.includes(",") && compact.includes(".")) {
    return compact.lastIndexOf(",") > compact.lastIndexOf(".") ? compact.replace(/\./g, "").replace(",", ".") : compact.replace(/,/g, "");
  }

  return compact.replace(",", ".");
}

function normalizeColumnName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function toPeriodoMap(periodos: OmieEnergiaPeriodo[]) {
  return new Map(periodos.map((periodo) => [periodo.periodo, periodo.energia]));
}

function sortedPeriodoUnion(left: Map<number, number>, right: Map<number, number>) {
  return [...new Set([...left.keys(), ...right.keys()])].sort((a, b) => a - b);
}

function roundEnergy(value: number) {
  return Number(value.toFixed(10));
}

export class OmieEnergiaTransformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OmieEnergiaTransformError";
  }
}
