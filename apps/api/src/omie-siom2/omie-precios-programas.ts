import type {
  OmieAreaNegocio,
  OmieAreaNegocioPreciosProgramas,
  OmieCatalogoPrioridades,
  OmieConsultaCatalogoItem,
  OmieConsultaPrioritaria,
  OmieConsultasCatalogo,
  OmiePreciosProgramasConsulta,
  OmiePreciosProgramasObjetivo,
  OmiePreciosProgramasReport
} from "./omie-siom2.types";

const AREAS_INCLUIDAS: OmieAreaNegocioPreciosProgramas[] = ["PRECIOS", "PROGRAMAS"];
const OBJETIVOS: OmiePreciosProgramasObjetivo[] = ["preciosOmie", "programasHorarios", "casacion", "energiaNegociada"];

const PALABRAS_CLAVE = [
  { label: "Precio", patterns: ["precio"], weight: 45 },
  { label: "Mercado Diario", patterns: ["mercado diario"], weight: 22 },
  { label: "Mercado Intradiario", patterns: ["mercado intradiario"], weight: 22 },
  { label: "Programa", patterns: ["programa", "programas", "programacion"], weight: 32 },
  { label: "Casación", patterns: ["casacion", "casaci"], weight: 34 },
  { label: "Energía", patterns: ["energia", "energ"], weight: 30 }
] as const;

const OBJETIVO_WEIGHTS: Record<OmiePreciosProgramasObjetivo, number> = {
  preciosOmie: 45,
  programasHorarios: 38,
  casacion: 34,
  energiaNegociada: 30
};

export function generarPreciosProgramasOmie(
  prioridades: OmieCatalogoPrioridades,
  catalogo: OmieConsultasCatalogo,
  paths: {
    sourcePrioridadesPath: string;
    sourceCatalogPath: string;
    outputPath: string;
  }
): OmiePreciosProgramasReport {
  const catalogoPorCodigo = new Map(catalogo.consultas.map((consulta) => [consulta.codigo, consulta]));
  const consultas = prioridades.consultas
    .filter(isConsultaPreciosProgramas)
    .map((consulta) => toConsultaPreciosProgramas(consulta, catalogoPorCodigo.get(consulta.codigo)))
    .sort(compareConsultaPreciosProgramas);

  return {
    generatedAt: new Date().toISOString(),
    sourcePrioridadesPath: paths.sourcePrioridadesPath,
    sourceCatalogPath: paths.sourceCatalogPath,
    outputPath: paths.outputPath,
    criterios: {
      areasIncluidas: [...AREAS_INCLUIDAS],
      palabrasClave: PALABRAS_CLAVE.map((keyword) => keyword.label),
      objetivos: [...OBJETIVOS]
    },
    resumen: {
      totalConsultas: consultas.length,
      consultasPorAreaNegocio: buildConsultasPorArea(consultas),
      consultasConPalabrasClave: consultas.filter((consulta) => consulta.palabrasClave.length > 0).length
    },
    consultas,
    mejoresCandidatas: buildMejoresCandidatas(consultas)
  };
}

function toConsultaPreciosProgramas(
  consulta: OmieConsultaPrioritaria & { areaNegocio: OmieAreaNegocioPreciosProgramas },
  catalogoConsulta?: OmieConsultaCatalogoItem
): OmiePreciosProgramasConsulta {
  const parametros = catalogoConsulta?.parametros ?? [];
  const columnas = catalogoConsulta?.columnas ?? [];
  const text = searchText(consulta, catalogoConsulta);
  const palabrasClave = PALABRAS_CLAVE.filter((keyword) => keyword.patterns.some((pattern) => text.includes(pattern))).map((keyword) => keyword.label);
  const candidataPara = classifyObjetivos(text, consulta.areaNegocio, palabrasClave);

  return {
    codigo: consulta.codigo,
    descripcion: catalogoConsulta?.descripcion ?? consulta.descripcion,
    categoria: catalogoConsulta?.categoria ?? consulta.categoria,
    areaNegocio: consulta.areaNegocio,
    parametros,
    columnas,
    numeroParametros: parametros.length || consulta.numeroParametros,
    numeroColumnas: columnas.length || consulta.numeroColumnas,
    palabrasClave,
    candidataPara,
    relevancia: scoreConsulta({
      areaNegocio: consulta.areaNegocio,
      palabrasClave,
      candidataPara,
      numeroParametros: parametros.length || consulta.numeroParametros,
      numeroColumnas: columnas.length || consulta.numeroColumnas
    })
  };
}

function classifyObjetivos(text: string, areaNegocio: OmieAreaNegocioPreciosProgramas, palabrasClave: string[]) {
  const objetivos: OmiePreciosProgramasObjetivo[] = [];

  if (areaNegocio === "PRECIOS" && palabrasClave.includes("Precio")) {
    objetivos.push("preciosOmie");
  }
  if (areaNegocio === "PROGRAMAS" || matchesAny(text, ["programa", "phf", "pbf", "pbc", "pvd", "pibci", "pibca", "horario"])) {
    objetivos.push("programasHorarios");
  }
  if (palabrasClave.includes("Casación")) {
    objetivos.push("casacion");
  }
  if (palabrasClave.includes("Energía") || matchesAny(text, ["energia negociada", "contratacion", "casada"])) {
    objetivos.push("energiaNegociada");
  }

  return objetivos;
}

function scoreConsulta(input: {
  areaNegocio: OmieAreaNegocioPreciosProgramas;
  palabrasClave: string[];
  candidataPara: OmiePreciosProgramasObjetivo[];
  numeroParametros: number;
  numeroColumnas: number;
}) {
  const keywordScore = PALABRAS_CLAVE.filter((keyword) => input.palabrasClave.includes(keyword.label)).reduce((score, keyword) => score + keyword.weight, 0);
  const objectiveScore = input.candidataPara.reduce((score, objetivo) => score + OBJETIVO_WEIGHTS[objetivo], 0);
  const areaScore = input.areaNegocio === "PRECIOS" ? 18 : 16;
  const dataRichnessScore = Math.min(input.numeroColumnas, 40);
  const parameterPenalty = input.numeroParametros * 2;

  return keywordScore + objectiveScore + areaScore + dataRichnessScore - parameterPenalty;
}

function buildConsultasPorArea(consultas: OmiePreciosProgramasConsulta[]) {
  const counts = Object.fromEntries(AREAS_INCLUIDAS.map((area) => [area, 0])) as Record<OmieAreaNegocioPreciosProgramas, number>;

  for (const consulta of consultas) {
    counts[consulta.areaNegocio] += 1;
  }

  return counts;
}

function buildMejoresCandidatas(consultas: OmiePreciosProgramasConsulta[]) {
  return Object.fromEntries(
    OBJETIVOS.map((objetivo) => [objetivo, consultas.filter((consulta) => consulta.candidataPara.includes(objetivo)).slice(0, 15)])
  ) as Record<OmiePreciosProgramasObjetivo, OmiePreciosProgramasConsulta[]>;
}

function compareConsultaPreciosProgramas(left: OmiePreciosProgramasConsulta, right: OmiePreciosProgramasConsulta) {
  return (
    right.relevancia - left.relevancia ||
    areaPriority(left.areaNegocio) - areaPriority(right.areaNegocio) ||
    right.numeroColumnas - left.numeroColumnas ||
    left.numeroParametros - right.numeroParametros ||
    left.codigo.localeCompare(right.codigo, "es")
  );
}

function isConsultaPreciosProgramas(consulta: OmieConsultaPrioritaria): consulta is OmieConsultaPrioritaria & { areaNegocio: OmieAreaNegocioPreciosProgramas } {
  return isAreaPreciosProgramas(consulta.areaNegocio);
}

function isAreaPreciosProgramas(area: OmieAreaNegocio): area is OmieAreaNegocioPreciosProgramas {
  return AREAS_INCLUIDAS.includes(area as OmieAreaNegocioPreciosProgramas);
}

function searchText(consulta: OmieConsultaPrioritaria, catalogoConsulta?: OmieConsultaCatalogoItem) {
  return normalizeText(
    [
      consulta.codigo,
      consulta.descripcion,
      consulta.categoria,
      consulta.areaNegocio,
      catalogoConsulta?.descripcion,
      catalogoConsulta?.categoria,
      ...(catalogoConsulta?.parametros.flatMap((parametro) => [parametro.nombre, parametro.descripcion, parametro.tipo]) ?? []),
      ...(catalogoConsulta?.columnas.flatMap((columna) => [columna.nombre, columna.descripcion, columna.tipo]) ?? [])
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function matchesAny(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern));
}

function areaPriority(area: OmieAreaNegocioPreciosProgramas) {
  return area === "PRECIOS" ? 1 : 2;
}
