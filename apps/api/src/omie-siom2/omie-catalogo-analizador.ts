import type {
  OmieAreaNegocio,
  OmieCatalogoFuncionalAnalizado,
  OmieConsultaAreaNegocio,
  OmieConsultaCatalogoItem,
  OmieConsultaFuncionalResumen,
  OmieConsultasCatalogo
} from "./omie-siom2.types";

const AREAS: OmieAreaNegocio[] = ["PRECIOS", "OFERTAS", "PROGRAMAS", "LIQUIDACIONES", "MEDIDAS", "DOCUMENTACION", "OTROS"];

const AREA_RULES: Array<{
  area: OmieAreaNegocio;
  keywords: string[];
}> = [
  {
    area: "LIQUIDACIONES",
    keywords: ["liquidacion", "liquidaciones", "garantia", "garantias", "cobro", "pago", "factura", "facturacion", "rentas", "renta"]
  },
  {
    area: "DOCUMENTACION",
    keywords: ["documentacion", "documento", "documentos", "informe", "informes", "certificado", "comunicacion", "comunicaciones"]
  },
  {
    area: "MEDIDAS",
    keywords: ["medida", "medidas", "contador", "contadores", "consumo", "consumos", "energia medida", "energias medidas"]
  },
  {
    area: "PRECIOS",
    keywords: ["precio", "precios", "casacion", "marginal", "umbral", "curva", "curvas"]
  },
  {
    area: "OFERTAS",
    keywords: ["oferta", "ofertas", "ofertante", "uofertante"]
  },
  {
    area: "PROGRAMAS",
    keywords: ["programa", "programas", "phf", "pbf", "pdbc", "pdbf", "pdvd", "p48", "energia programada", "programacion"]
  }
];

const RELATED_RULES = {
  mercadoDiario: ["mercado diario"],
  mercadoIntradiario: ["mercado intradiario", "intradiario"],
  ofertas: ["oferta", "ofertas", "ofertante", "uofertante"],
  programas: ["programa", "programas", "phf", "pbf", "pdbc", "pdbf", "pdvd", "p48", "programacion"],
  precios: ["precio", "precios", "casacion", "marginal", "umbral", "curva", "curvas"],
  liquidaciones: ["liquidacion", "liquidaciones", "garantia", "garantias", "cobro", "pago", "factura", "facturacion", "rentas", "renta"],
  medidas: ["medida", "medidas", "contador", "contadores", "consumo", "consumos"],
  descargaFicheros: ["descarga", "fichero", "ficheros", "anexo", "zip", "xml", "csv"],
  documentacion: ["documentacion", "documento", "documentos", "informe", "informes", "certificado", "comunicacion", "comunicaciones"]
} as const;

export function analizarCatalogoOmie(catalogo: OmieConsultasCatalogo, paths: { sourceCatalogPath: string; analyzedPath: string }): OmieCatalogoFuncionalAnalizado {
  const consultas = catalogo.consultas.map(toConsultaResumen).sort(compareConsultaResumen);
  const clasificacion = catalogo.consultas.map(toClasificacion).sort((left, right) => left.codigo.localeCompare(right.codigo, "es"));
  const categoriasOrdenadas = buildCategoriasOrdenadas(catalogo.consultas);

  return {
    generatedAt: new Date().toISOString(),
    sourceCatalogPath: paths.sourceCatalogPath,
    analyzedPath: paths.analyzedPath,
    resumen: {
      totalConsultas: catalogo.consultas.length,
      totalCategorias: categoriasOrdenadas.length,
      categoriasOrdenadas,
      topCategorias: categoriasOrdenadas.slice(0, 10),
      consultasPorAreaNegocio: buildConsultasPorArea(clasificacion)
    },
    consultasRelacionadas: {
      mercadoDiario: filterRelated(catalogo.consultas, RELATED_RULES.mercadoDiario),
      mercadoIntradiario: filterRelated(catalogo.consultas, RELATED_RULES.mercadoIntradiario),
      ofertas: filterRelated(catalogo.consultas, RELATED_RULES.ofertas),
      programas: filterRelated(catalogo.consultas, RELATED_RULES.programas),
      precios: filterRelated(catalogo.consultas, RELATED_RULES.precios),
      liquidaciones: filterRelated(catalogo.consultas, RELATED_RULES.liquidaciones),
      medidas: filterRelated(catalogo.consultas, RELATED_RULES.medidas),
      descargaFicheros: filterRelated(catalogo.consultas, RELATED_RULES.descargaFicheros),
      documentacion: filterRelated(catalogo.consultas, RELATED_RULES.documentacion)
    },
    consultas,
    clasificacion
  };
}

function toConsultaResumen(consulta: OmieConsultaCatalogoItem): OmieConsultaFuncionalResumen {
  return {
    codigo: consulta.codigo,
    descripcion: consulta.descripcion,
    categoria: consulta.categoria,
    numeroParametros: consulta.parametros.length,
    numeroColumnas: consulta.columnas.length
  };
}

function toClasificacion(consulta: OmieConsultaCatalogoItem): OmieConsultaAreaNegocio {
  return {
    codigo: consulta.codigo,
    descripcion: consulta.descripcion,
    categoria: consulta.categoria,
    areaNegocio: classifyArea(consulta)
  };
}

function buildCategoriasOrdenadas(consultas: OmieConsultaCatalogoItem[]) {
  const counts = new Map<string, number>();
  for (const consulta of consultas) {
    const categoria = consulta.categoria ?? "Sin categoria";
    counts.set(categoria, (counts.get(categoria) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([categoria, count]) => ({ categoria, consultas: count }))
    .sort((left, right) => right.consultas - left.consultas || left.categoria.localeCompare(right.categoria, "es"));
}

function buildConsultasPorArea(clasificacion: OmieConsultaAreaNegocio[]) {
  const counts = Object.fromEntries(AREAS.map((area) => [area, 0])) as Record<OmieAreaNegocio, number>;
  for (const consulta of clasificacion) {
    counts[consulta.areaNegocio] += 1;
  }

  return counts;
}

function filterRelated(consultas: OmieConsultaCatalogoItem[], keywords: readonly string[]) {
  return consultas
    .filter((consulta) => matchesAnyKeyword(searchText(consulta), keywords))
    .map(toConsultaResumen)
    .sort(compareConsultaResumen);
}

function classifyArea(consulta: OmieConsultaCatalogoItem): OmieAreaNegocio {
  const text = searchText(consulta);
  const scores = AREA_RULES.map((rule) => ({
    area: rule.area,
    score: rule.keywords.reduce((score, keyword) => score + (text.includes(normalizeText(keyword)) ? 1 : 0), 0)
  })).filter((score) => score.score > 0);

  if (scores.length === 0) {
    return "OTROS";
  }

  return scores.sort((left, right) => right.score - left.score || areaPriority(left.area) - areaPriority(right.area))[0].area;
}

function areaPriority(area: OmieAreaNegocio) {
  const priority: Record<OmieAreaNegocio, number> = {
    LIQUIDACIONES: 1,
    MEDIDAS: 2,
    PRECIOS: 3,
    OFERTAS: 4,
    PROGRAMAS: 5,
    DOCUMENTACION: 6,
    OTROS: 7
  };

  return priority[area];
}

function matchesAnyKeyword(text: string, keywords: readonly string[]) {
  return keywords.some((keyword) => text.includes(normalizeText(keyword)));
}

function searchText(consulta: OmieConsultaCatalogoItem) {
  return normalizeText([consulta.codigo, consulta.descripcion, consulta.categoria, consulta.tipoConsulta].filter(Boolean).join(" "));
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function compareConsultaResumen(left: OmieConsultaFuncionalResumen, right: OmieConsultaFuncionalResumen) {
  return (left.categoria ?? "").localeCompare(right.categoria ?? "", "es") || left.codigo.localeCompare(right.codigo, "es");
}
