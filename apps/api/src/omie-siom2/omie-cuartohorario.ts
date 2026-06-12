import type { OmieConsultaCatalogoItem, OmieConsultasCatalogo, OmieCuartohorarioCandidata } from "./omie-siom2.types";

type ScoredCuartohorarioCandidata = OmieCuartohorarioCandidata & {
  relevancia: number;
  qhColumns: number;
};

const QH_COLUMN_PATTERN = /^(?:periodo)?H(?:0[1-9]|1[0-9]|2[0-4])Q[1-4]$/i;

const QH_COMPACT_TERMS = [
  "cuartohoraria",
  "cuartohorario",
  "cuartohora",
  "quarterhour",
  "mtu15",
  "ptu15",
  "15minutos",
  "programascuartohorarios",
  "precioscuartohorarios",
  "casacioncuartohoraria"
];

const QH_PHRASE_TERMS = [
  "cuarto horario",
  "quarter hour",
  "mtu 15",
  "ptu 15",
  "15 minutos",
  "programas cuarto horarios",
  "precios cuarto horarios",
  "casacion cuarto horaria"
];

export function identificarConsultasCuartohorarias(catalogo: OmieConsultasCatalogo): OmieCuartohorarioCandidata[] {
  return catalogo.consultas
    .map(toScoredCandidata)
    .filter((consulta) => consulta.relevancia > 0)
    .sort(compareCandidatas)
    .map(({ relevancia: _relevancia, qhColumns: _qhColumns, ...consulta }) => consulta);
}

function toScoredCandidata(consulta: OmieConsultaCatalogoItem): ScoredCuartohorarioCandidata {
  const text = searchText(consulta);
  const phraseText = text.replace(/[-_/]+/g, " ");
  const compactText = phraseText.replace(/[^a-z0-9]+/g, "");
  const qhColumns = countQuarterHourColumns(consulta);
  const hasDirectQhTerm = hasQhToken(phraseText) || matchesAny(phraseText, QH_PHRASE_TERMS) || QH_COMPACT_TERMS.some((term) => compactText.includes(term));
  const hasGoLive15 = phraseText.includes("go live 15");
  const hasNinetySixPeriods = hasNinetySixPeriodParameter(consulta);
  const isCuartohorarioCandidate = qhColumns > 0 || hasDirectQhTerm || hasGoLive15 || hasNinetySixPeriods;

  return {
    codigo: consulta.codigo,
    descripcion: consulta.descripcion,
    categoria: consulta.categoria,
    parametros: consulta.parametros,
    numeroColumnas: consulta.columnas.length,
    qhColumns,
    relevancia: isCuartohorarioCandidate
      ? scoreConsulta({
          qhColumns,
          hasDirectQhTerm,
          hasGoLive15,
          hasNinetySixPeriods,
          hasPriceSignal: phraseText.includes("precio"),
          hasProgramSignal: matchesAny(phraseText, ["programa", "pbf", "pbc", "pvd", "phf"]),
          hasCasacionSignal: matchesAny(phraseText, ["casacion", "casaci"]),
          isHistoricalUntilGoLive15: phraseText.includes("hasta go live 15")
        })
      : 0
  };
}

function scoreConsulta(input: {
  qhColumns: number;
  hasDirectQhTerm: boolean;
  hasGoLive15: boolean;
  hasNinetySixPeriods: boolean;
  hasPriceSignal: boolean;
  hasProgramSignal: boolean;
  hasCasacionSignal: boolean;
  isHistoricalUntilGoLive15: boolean;
}) {
  const qhColumnScore = input.qhColumns >= 96 ? 100 : input.qhColumns > 0 ? 70 : 0;
  const directQhScore = input.hasDirectQhTerm ? 60 : 0;
  const ninetySixScore = input.hasNinetySixPeriods ? 45 : 0;
  const goLiveScore = input.hasGoLive15 ? 25 : 0;
  const priceScore = input.hasPriceSignal ? 30 : 0;
  const programScore = input.hasProgramSignal ? 10 : 0;
  const casacionScore = input.hasCasacionSignal ? 8 : 0;
  const historicalPenalty = input.isHistoricalUntilGoLive15 ? 20 : 0;

  return qhColumnScore + directQhScore + ninetySixScore + goLiveScore + priceScore + programScore + casacionScore - historicalPenalty;
}

function countQuarterHourColumns(consulta: OmieConsultaCatalogoItem) {
  return consulta.columnas.filter((columna) => QH_COLUMN_PATTERN.test(columna.nombre ?? "") || QH_COLUMN_PATTERN.test(columna.descripcion ?? "")).length;
}

function hasNinetySixPeriodParameter(consulta: OmieConsultaCatalogoItem) {
  return consulta.parametros.some((parametro) => {
    const parametroText = normalizeText([parametro.nombre, parametro.descripcion].filter(Boolean).join(" "));
    if (!matchesAny(parametroText, ["periodo", "hora", "ptu", "mtu"])) {
      return false;
    }

    return parametro.selecciones.some((seleccion) => String(seleccion.codigo) === "96" || String(seleccion.descripcion) === "96");
  });
}

function searchText(consulta: OmieConsultaCatalogoItem) {
  return normalizeText(
    [
      consulta.codigo,
      consulta.descripcion,
      consulta.categoria,
      consulta.tipoConsulta,
      ...consulta.parametros.flatMap((parametro) => [
        parametro.tipo,
        parametro.nombre,
        parametro.descripcion,
        ...parametro.selecciones.flatMap((seleccion) => [seleccion.codigo, seleccion.descripcion])
      ]),
      ...consulta.columnas.flatMap((columna) => [columna.tipo, columna.nombre, columna.descripcion, columna.etiquetaXml])
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

function hasQhToken(text: string) {
  return /(^|[^a-z0-9])qh([^a-z0-9]|$)/.test(text);
}

function matchesAny(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern));
}

function compareCandidatas(left: ScoredCuartohorarioCandidata, right: ScoredCuartohorarioCandidata) {
  return (
    right.relevancia - left.relevancia ||
    right.qhColumns - left.qhColumns ||
    right.numeroColumnas - left.numeroColumnas ||
    left.codigo.localeCompare(right.codigo, "es")
  );
}
