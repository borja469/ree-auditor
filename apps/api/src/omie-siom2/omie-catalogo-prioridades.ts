import type {
  OmieAreaNegocio,
  OmieAreaNegocioPrioritaria,
  OmieCatalogoFuncionalAnalizado,
  OmieCatalogoPrioridades,
  OmieConsultaAreaNegocio,
  OmieConsultaFuncionalResumen,
  OmieConsultaPrioritaria
} from "./omie-siom2.types";

export const OMIE_AREAS_PRIORITARIAS: OmieAreaNegocioPrioritaria[] = ["PRECIOS", "PROGRAMAS", "OFERTAS", "LIQUIDACIONES"];

const AREA_PRIORIDAD: Record<OmieAreaNegocioPrioritaria, number> = {
  PRECIOS: 1,
  PROGRAMAS: 2,
  OFERTAS: 3,
  LIQUIDACIONES: 4
};

export function generarPrioridadesCatalogoOmie(
  analisis: OmieCatalogoFuncionalAnalizado,
  paths: { sourceAnalyzedPath: string; prioridadesPath: string }
): OmieCatalogoPrioridades {
  const resumenPorCodigo = new Map(analisis.consultas.map((consulta) => [consulta.codigo, consulta]));
  const consultas = analisis.clasificacion
    .filter(isConsultaAreaPrioritaria)
    .map((consulta) => toConsultaPrioritaria(consulta, resumenPorCodigo.get(consulta.codigo)))
    .sort(compareConsultaPrioritaria);

  return {
    generatedAt: new Date().toISOString(),
    sourceAnalyzedPath: paths.sourceAnalyzedPath,
    prioridadesPath: paths.prioridadesPath,
    criterios: {
      areasIncluidas: [...OMIE_AREAS_PRIORITARIAS],
      ordenRanking: [...OMIE_AREAS_PRIORITARIAS],
      desempates: ["numeroColumnas desc", "numeroParametros asc", "categoria asc", "codigo asc"]
    },
    resumen: {
      totalConsultasAnalizadas: analisis.resumen.totalConsultas,
      totalConsultasPriorizadas: consultas.length,
      consultasPorAreaNegocio: buildConsultasPorArea(consultas)
    },
    consultas,
    rankingTop20: consultas.slice(0, 20).map((consulta, index) => ({
      posicion: index + 1,
      ...consulta
    }))
  };
}

function toConsultaPrioritaria(
  consulta: {
    codigo: string;
    descripcion?: string;
    categoria?: string;
    areaNegocio: OmieAreaNegocioPrioritaria;
  },
  resumen?: OmieConsultaFuncionalResumen
): OmieConsultaPrioritaria {
  return {
    codigo: consulta.codigo,
    descripcion: resumen?.descripcion ?? consulta.descripcion,
    categoria: resumen?.categoria ?? consulta.categoria,
    areaNegocio: consulta.areaNegocio,
    numeroParametros: resumen?.numeroParametros ?? 0,
    numeroColumnas: resumen?.numeroColumnas ?? 0
  };
}

function buildConsultasPorArea(consultas: OmieConsultaPrioritaria[]) {
  const counts = Object.fromEntries(OMIE_AREAS_PRIORITARIAS.map((area) => [area, 0])) as Record<OmieAreaNegocioPrioritaria, number>;

  for (const consulta of consultas) {
    counts[consulta.areaNegocio] += 1;
  }

  return counts;
}

function compareConsultaPrioritaria(left: OmieConsultaPrioritaria, right: OmieConsultaPrioritaria) {
  return (
    AREA_PRIORIDAD[left.areaNegocio] - AREA_PRIORIDAD[right.areaNegocio] ||
    right.numeroColumnas - left.numeroColumnas ||
    left.numeroParametros - right.numeroParametros ||
    (left.categoria ?? "").localeCompare(right.categoria ?? "", "es") ||
    left.codigo.localeCompare(right.codigo, "es")
  );
}

function isAreaPrioritaria(area: OmieAreaNegocio): area is OmieAreaNegocioPrioritaria {
  return OMIE_AREAS_PRIORITARIAS.includes(area as OmieAreaNegocioPrioritaria);
}

function isConsultaAreaPrioritaria(
  consulta: OmieConsultaAreaNegocio
): consulta is OmieConsultaAreaNegocio & { areaNegocio: OmieAreaNegocioPrioritaria } {
  return isAreaPrioritaria(consulta.areaNegocio);
}
