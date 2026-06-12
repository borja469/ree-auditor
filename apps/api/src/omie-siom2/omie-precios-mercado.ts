import type {
  OmiePrecioMercadoCandidata,
  OmiePreciosProgramasConsulta,
  OmiePreciosProgramasReport
} from "./omie-siom2.types";

const KEYWORDS = [
  { label: "Precio", patterns: ["precio"], weight: 50 },
  { label: "Mercado Diario", patterns: ["mercado diario"], weight: 28 },
  { label: "Mercado Intradiario", patterns: ["mercado intradiario"], weight: 28 },
  { label: "Casacion", patterns: ["casacion", "casaci"], weight: 30 },
  { label: "Precio marginal", patterns: ["precio marginal", "marginal"], weight: 35 },
  { label: "Energia negociada", patterns: ["energia negociada", "energia", "energias", "negociada"], weight: 26 }
] as const;

export function identificarConsultasPreciosMercado(preciosProgramas: OmiePreciosProgramasReport) {
  const candidatas = preciosProgramas.consultas
    .filter((consulta) => consulta.areaNegocio === "PRECIOS")
    .map(toCandidata)
    .filter((consulta) => consulta.coincidencias.includes("Precio"))
    .sort(compareCandidatas);

  return {
    mercadoDiario: candidatas.filter((consulta) => matchesMercado(consulta, "mercado diario")),
    mercadoIntradiario: candidatas.filter((consulta) => matchesMercado(consulta, "mercado intradiario"))
  };
}

function toCandidata(consulta: OmiePreciosProgramasConsulta): OmiePrecioMercadoCandidata {
  const text = searchText(consulta);
  const coincidencias = KEYWORDS.filter((keyword) => keyword.patterns.some((pattern) => text.includes(pattern))).map((keyword) => keyword.label);

  return {
    codigo: consulta.codigo,
    descripcion: consulta.descripcion,
    categoria: consulta.categoria,
    parametrosRequeridos: consulta.parametros,
    columnasDisponibles: consulta.columnas,
    coincidencias,
    relevancia: scoreConsulta(consulta, coincidencias),
    ejecutableSoloFecha: isExecutableSoloFecha(consulta)
  };
}

function scoreConsulta(consulta: OmiePreciosProgramasConsulta, coincidencias: string[]) {
  const keywordScore = KEYWORDS.filter((keyword) => coincidencias.includes(keyword.label)).reduce((score, keyword) => score + keyword.weight, 0);
  const exactPriceEnergyScore = matchesAny(searchText(consulta), ["precios y energias", "precioes", "preciopt"]) ? 50 : 0;
  const executableScore = isExecutableSoloFecha(consulta) ? 20 : 0;
  const richnessScore = Math.min(consulta.columnas.length, 20);

  return keywordScore + exactPriceEnergyScore + executableScore + richnessScore - consulta.parametros.length;
}

function isExecutableSoloFecha(consulta: OmiePreciosProgramasConsulta) {
  return consulta.parametros.length === 1 && normalizeText(consulta.parametros[0].tipo) === "fec" && Boolean(consulta.parametros[0].nombre?.trim());
}

function matchesMercado(consulta: OmiePrecioMercadoCandidata, mercado: "mercado diario" | "mercado intradiario") {
  return normalizeText([consulta.descripcion, consulta.categoria].filter(Boolean).join(" ")).includes(mercado);
}

function compareCandidatas(left: OmiePrecioMercadoCandidata, right: OmiePrecioMercadoCandidata) {
  return right.relevancia - left.relevancia || left.codigo.localeCompare(right.codigo, "es");
}

function searchText(consulta: OmiePreciosProgramasConsulta) {
  return normalizeText(
    [
      consulta.codigo,
      consulta.descripcion,
      consulta.categoria,
      ...consulta.parametros.flatMap((parametro) => [parametro.nombre, parametro.descripcion, parametro.tipo]),
      ...consulta.columnas.flatMap((columna) => [columna.nombre, columna.descripcion, columna.tipo])
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
