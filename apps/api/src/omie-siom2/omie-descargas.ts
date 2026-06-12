import type {
  OmieConsultaCatalogoColumna,
  OmieConsultaCatalogoItem,
  OmieConsultaCatalogoParametro,
  OmieConsultasCatalogo,
  OmieDescargasCandidata
} from "./omie-siom2.types";

type OmieDescargasCandidataInterna = OmieDescargasCandidata & {
  tipoConsulta?: string;
  score: number;
  palabrasClaveDetectadas: string[];
};

const CATEGORY_DESCARGAS = "Liquidaciones. Descarga de Ficheros";
const KEYWORDS = [
  { keyword: "PDBC", weight: 70 },
  { keyword: "PRECIOSPDBC", weight: 90 },
  { keyword: "PRECIO PDBC", weight: 55 },
  { keyword: "PRECIOS PDBC", weight: 55 },
  { keyword: "PROGRAMA PDBC", weight: 35 },
  { keyword: "PROGRAMAS", weight: 15 },
  { keyword: "PRECIOS", weight: 18 },
  { keyword: "XML", weight: 20 },
  { keyword: "FICHERO", weight: 12 },
  { keyword: "FICHEROS", weight: 12 },
  { keyword: "DOCUMENTOS", weight: 12 },
  { keyword: "DESCARGA DE FICHEROS", weight: 18 },
  { keyword: "DESCARGA FICHEROS", weight: 14 },
  { keyword: "MERCADO DIARIO", weight: 10 },
  { keyword: "CASACION", weight: 8 }
];

export function identificarConsultasDescargas(catalogo: OmieConsultasCatalogo): OmieDescargasCandidata[] {
  return catalogo.consultas
    .map((consulta) => buildCandidataDescargas(consulta))
    .filter((consulta): consulta is OmieDescargasCandidataInterna => consulta !== null)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.codigo.localeCompare(b.codigo);
    })
    .map(stripInternalFields);
}

function buildCandidataDescargas(consulta: OmieConsultaCatalogoItem): OmieDescargasCandidataInterna | null {
  const scoreInfo = scoreConsultaDescargas(consulta);
  if (scoreInfo.score <= 0) {
    return null;
  }

  return {
    codigo: consulta.codigo,
    descripcion: consulta.descripcion,
    categoria: consulta.categoria,
    tipoConsulta: consulta.tipoConsulta,
    parametros: consulta.parametros,
    columnas: consulta.columnas,
    score: scoreInfo.score,
    palabrasClaveDetectadas: scoreInfo.palabrasClaveDetectadas,
    motivoSeleccion: scoreInfo.motivoSeleccion
  };
}

function scoreConsultaDescargas(consulta: OmieConsultaCatalogoItem) {
  const textos = collectConsultaTextos(consulta);
  const palabrasClaveDetectadas = new Set<string>();
  let score = 0;

  const categoria = normalizeText(consulta.categoria ?? "");
  const descripcion = normalizeText(consulta.descripcion ?? "");

  if (categoria === normalizeText(CATEGORY_DESCARGAS)) {
    score += 120;
  } else if (categoria.includes("liquidaciones")) {
    score += 25;
  }

  if ((consulta.tipoConsulta ?? "").toUpperCase() === "ANEXO") {
    score += 45;
  }

  for (const entry of KEYWORDS) {
    if (textos.includes(normalizeText(entry.keyword))) {
      score += entry.weight;
      palabrasClaveDetectadas.add(entry.keyword);
    }
  }

  if (descripcion.includes("xml")) {
    score += 15;
  }

  if (textos.includes("xmldisponible")) {
    score += 25;
    palabrasClaveDetectadas.add("XMLDisponible");
  }

  if (textos.includes("nombrefichero")) {
    score += 30;
    palabrasClaveDetectadas.add("NombreFichero");
  }

  if (textos.includes("f64")) {
    score += 20;
    palabrasClaveDetectadas.add("F64");
  }

  if (textos.includes("strom")) {
    score += 20;
    palabrasClaveDetectadas.add("STROM");
  }

  if (consulta.parametros.some((parametro) => isDownloadDateParameter(parametro))) {
    score += 8;
  }
  if (consulta.parametros.some((parametro) => isDownloadVersionParameter(parametro))) {
    score += 8;
  }
  if (consulta.parametros.some((parametro) => isDownloadAgentParameter(parametro))) {
    score += 8;
  }

  if (consulta.columnas.some((columna) => matchesColumnKeyword(columna, "xml"))) {
    score += 10;
    palabrasClaveDetectadas.add("XML en columnas");
  }
  if (consulta.columnas.some((columna) => matchesColumnKeyword(columna, "fichero"))) {
    score += 8;
    palabrasClaveDetectadas.add("Fichero en columnas");
  }

  const motivoSeleccion = buildMotivoSeleccion(consulta, Array.from(palabrasClaveDetectadas), score);

  return {
    score,
    palabrasClaveDetectadas: Array.from(palabrasClaveDetectadas),
    motivoSeleccion
  };
}

function buildMotivoSeleccion(consulta: OmieConsultaCatalogoItem, keywords: string[], score: number) {
  const fragments = [
    consulta.categoria ? `categoria=${consulta.categoria}` : undefined,
    consulta.tipoConsulta ? `tipo=${consulta.tipoConsulta}` : undefined,
    keywords.length > 0 ? `palabras=${keywords.join(", ")}` : undefined,
    `score=${score}`
  ].filter(Boolean);

  return fragments.join(" | ");
}

function collectConsultaTextos(consulta: OmieConsultaCatalogoItem) {
  const textos = [
    consulta.codigo,
    consulta.descripcion ?? "",
    consulta.categoria ?? "",
    consulta.tipoConsulta ?? "",
    ...consulta.parametros.flatMap((parametro) => collectParametroTextos(parametro)),
    ...consulta.columnas.flatMap((columna) => collectColumnaTextos(columna))
  ];

  return normalizeText(textos.join(" "));
}

function collectParametroTextos(parametro: OmieConsultaCatalogoParametro) {
  return [
    parametro.tipo,
    parametro.nombre ?? "",
    parametro.descripcion ?? "",
    parametro.longitud ?? "",
    parametro.comodin ?? "",
    ...parametro.selecciones.flatMap((seleccion) => [seleccion.codigo ?? "", seleccion.descripcion ?? ""]),
    ...Object.values(parametro.atributos ?? {})
  ];
}

function collectColumnaTextos(columna: OmieConsultaCatalogoColumna) {
  return [
    columna.tipo,
    columna.nombre ?? "",
    columna.descripcion ?? "",
    columna.longitud ?? "",
    columna.agregado ?? "",
    columna.etiquetaXml ?? "",
    ...Object.values(columna.atributos ?? {})
  ];
}

function isDownloadDateParameter(parametro: OmieConsultaCatalogoParametro) {
  const nombre = normalizeText(parametro.nombre ?? "");
  const descripcion = normalizeText(parametro.descripcion ?? "");
  return nombre.includes("fecha") || descripcion.includes("fecha") || nombre.includes("dia");
}

function isDownloadVersionParameter(parametro: OmieConsultaCatalogoParametro) {
  const nombre = normalizeText(parametro.nombre ?? "");
  const descripcion = normalizeText(parametro.descripcion ?? "");
  return nombre.includes("version") || descripcion.includes("version");
}

function isDownloadAgentParameter(parametro: OmieConsultaCatalogoParametro) {
  const nombre = normalizeText(parametro.nombre ?? "");
  const descripcion = normalizeText(parametro.descripcion ?? "");
  return nombre.includes("agente") || descripcion.includes("agente");
}

function matchesColumnKeyword(columna: OmieConsultaCatalogoColumna, keyword: string) {
  const normalizedKeyword = normalizeText(keyword);
  return normalizeText(columna.nombre ?? "").includes(normalizedKeyword) || normalizeText(columna.descripcion ?? "").includes(normalizedKeyword);
}

function stripInternalFields(consulta: OmieDescargasCandidataInterna): OmieDescargasCandidata {
  return {
    codigo: consulta.codigo,
    descripcion: consulta.descripcion,
    categoria: consulta.categoria,
    parametros: consulta.parametros,
    columnas: consulta.columnas,
    score: consulta.score,
    palabrasClaveDetectadas: consulta.palabrasClaveDetectadas,
    motivoSeleccion: consulta.motivoSeleccion
  };
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
