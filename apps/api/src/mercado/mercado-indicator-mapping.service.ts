import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export const MERCADO_ESIOS_VARIABLES = [
  "demandaPrevista",
  "eolica",
  "fotovoltaica",
  "termosolar",
  "nuclear",
  "hidraulicaUGH",
  "hidraulicaNoUGH",
  "bombeo",
  "intercambios"
] as const;

export type MercadoEsiosVariable = (typeof MERCADO_ESIOS_VARIABLES)[number];

export type MercadoIndicatorFunctionalCategory =
  | "demanda"
  | "prevision"
  | "generacion_programada_pbf"
  | "generacion_programada_pvp"
  | "generacion_programada_p48"
  | "generacion_programada_phf"
  | "generacion_real"
  | "generacion_tiempo_real"
  | "potencia_instalada"
  | "potencia_disponible"
  | "intercambio_capacidad"
  | "precio"
  | "perfil"
  | "balance"
  | "desconocida";

export type MercadoIndicatorScoreBreakdown = {
  base: number;
  category: number;
  preferred: number;
  strongPreferred: number;
  unit: number;
  frequency: number;
  data: number;
  geography: number;
  penalties: number;
  total: number;
};

type IndicatorCandidate = {
  variable: MercadoEsiosVariable;
  indicatorId: number;
  nombre: string | null;
  description: string | null;
  unit: string | null;
  frequency: string | null;
  functionalCategory: MercadoIndicatorFunctionalCategory;
  geoId: number | null;
  geoKey: number | null;
  geoName: string | null;
  records: number;
  confidence: number;
  scoreBreakdown: MercadoIndicatorScoreBreakdown;
  ambiguityReason: string | null;
  status: "candidate";
  warnings: string[];
};

type CandidateIndicator = {
  indicatorId: number;
  name: string | null;
  description: string | null;
  shortName: string | null;
  unit: string | null;
  frequency: string | null;
  searchableText: string;
  functionalCategory: MercadoIndicatorFunctionalCategory;
};

type IndicatorGeography = {
  geoId: number | null;
  geoKey: number;
  geoName: string | null;
  records: number;
};

export type MercadoResolvedIndicatorMapping = {
  variable: MercadoEsiosVariable | "precioOmie";
  indicatorId: number | null;
  nombre: string | null;
  geoId: number | null;
  geoKey: number | null;
  confidence: number;
  functionalCategory: MercadoIndicatorFunctionalCategory | null;
  scoreBreakdown: MercadoIndicatorScoreBreakdown | null;
  ambiguityReason: string | null;
  status: "external" | "confirmed" | "auto" | "ambiguous" | "not_found";
  warnings: string[];
  alternatives: Array<Omit<IndicatorCandidate, "variable" | "status">>;
};

type ConfirmMappingInput = {
  variable?: string;
  indicatorId?: unknown;
  geoId?: unknown;
  geoKey?: unknown;
};

type IndicatorRule = {
  allowedCategories: MercadoIndicatorFunctionalCategory[];
  requiredAny: string[][];
  preferred: string[];
  strongPreferred: string[];
  weakExcluded: string[];
  excluded: string[];
  units: string[];
  frequencies: string[];
  expectedGeoTerms: string[];
  minimumConfidence: number;
  automaticGap: number;
};

type CachedMappings = {
  expiresAt: number;
  value: MercadoResolvedIndicatorMapping[];
};

const MAPPING_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CANDIDATE_IDS_FOR_GEO_QUERY = 250;

const VARIABLE_RULES: Record<
  MercadoEsiosVariable,
  IndicatorRule
> = {
  demandaPrevista: {
    allowedCategories: ["demanda"],
    requiredAny: [["demanda"], ["prevista", "programada", "prevision"]],
    preferred: ["demanda prevista", "demanda programada", "prevision demanda", "sistema electrico nacional"],
    strongPreferred: ["demanda prevista peninsular", "demanda prevista"],
    weakExcluded: ["pbf comercializadores", "pbf consumo", "pvp comercializadores", "p48", "phf"],
    excluded: ["real", "final", "perfil", "cierre", "facturada"],
    units: ["mw", "mwh"],
    frequencies: ["hour", "hora", "h"],
    expectedGeoTerms: ["peninsula", "espana", "sistema electrico nacional"],
    minimumConfidence: 68,
    automaticGap: 8
  },
  eolica: {
    allowedCategories: ["prevision"],
    requiredAny: [["eolica", "eolico"], ["prevista", "programada", "prevision", "generacion"]],
    preferred: ["eolica prevista", "generacion eolica", "produccion eolica"],
    strongPreferred: ["prevision eolica"],
    weakExcluded: ["potencia instalada", "tiempo real", "t.real", "correccion", "energia vendida", "programa bilateral", "phf"],
    excluded: ["demanda", "precio"],
    units: ["mw", "mwh"],
    frequencies: ["hour", "hora", "h"],
    expectedGeoTerms: ["peninsula", "espana"],
    minimumConfidence: 58,
    automaticGap: 4
  },
  fotovoltaica: {
    allowedCategories: ["generacion_real", "prevision", "generacion_programada_pbf"],
    requiredAny: [["fotovoltaica", "solar fotovoltaica"]],
    preferred: ["solar fotovoltaica", "fotovoltaica prevista", "generacion fotovoltaica"],
    strongPreferred: ["solar fotovoltaica", "prevision solar fotovoltaica"],
    weakExcluded: ["potencia instalada", "tiempo real", "t.real", "correccion", "programa bilateral", "phf", "pvp", "p48", "programada pbf"],
    excluded: ["termosolar", "solar termica", "demanda", "precio"],
    units: ["mw", "mwh"],
    frequencies: ["hour", "hora", "h"],
    expectedGeoTerms: ["peninsula", "espana"],
    minimumConfidence: 45,
    automaticGap: 4
  },
  termosolar: {
    allowedCategories: ["generacion_real", "generacion_programada_pbf"],
    requiredAny: [["termosolar", "solar termica"]],
    preferred: ["solar termica", "termosolar prevista", "generacion termosolar"],
    strongPreferred: ["solar termica"],
    weakExcluded: ["potencia instalada", "tiempo real", "t.real", "correccion", "programa bilateral", "phf", "pvp", "p48", "programada pbf"],
    excluded: ["fotovoltaica", "demanda", "precio"],
    units: ["mw", "mwh"],
    frequencies: ["hour", "hora", "h"],
    expectedGeoTerms: ["peninsula", "espana"],
    minimumConfidence: 45,
    automaticGap: 4
  },
  nuclear: {
    allowedCategories: ["generacion_tiempo_real", "generacion_real", "generacion_programada_pbf"],
    requiredAny: [["nuclear"]],
    preferred: ["generacion nuclear", "produccion nuclear", "nuclear"],
    strongPreferred: ["generacion t.real nuclear", "generacion medida nuclear"],
    weakExcluded: ["potencia instalada", "potencia disponible", "programa bilateral", "phf", "pvp", "p48"],
    excluded: ["demanda", "precio"],
    units: ["mw", "mwh"],
    frequencies: ["hour", "hora", "h"],
    expectedGeoTerms: ["peninsula", "espana"],
    minimumConfidence: 45,
    automaticGap: 4
  },
  hidraulicaUGH: {
    allowedCategories: ["generacion_programada_pbf"],
    requiredAny: [["hidraulica"], ["ugh", "unidad de gestion hidraulica"]],
    preferred: ["hidraulica ugh", "generacion hidraulica ugh"],
    strongPreferred: ["generacion programada pbf hidraulica ugh"],
    weakExcluded: ["potencia instalada", "programa bilateral", "phf", "pvp", "p48"],
    excluded: ["no ugh", "non ugh", "demanda", "precio"],
    units: ["mw", "mwh"],
    frequencies: ["hour", "hora", "h"],
    expectedGeoTerms: ["peninsula", "espana"],
    minimumConfidence: 60,
    automaticGap: 6
  },
  hidraulicaNoUGH: {
    allowedCategories: ["generacion_programada_pbf"],
    requiredAny: [["hidraulica"], ["no ugh", "non ugh", "no unidad de gestion hidraulica"]],
    preferred: ["hidraulica no ugh", "generacion hidraulica no ugh"],
    strongPreferred: ["generacion programada pbf hidraulica no ugh"],
    weakExcluded: ["potencia instalada", "programa bilateral", "phf", "pvp", "p48"],
    excluded: ["demanda", "precio"],
    units: ["mw", "mwh"],
    frequencies: ["hour", "hora", "h"],
    expectedGeoTerms: ["peninsula", "espana"],
    minimumConfidence: 60,
    automaticGap: 6
  },
  bombeo: {
    allowedCategories: ["generacion_programada_pbf"],
    requiredAny: [["bombeo"]],
    preferred: ["consumo bombeo", "bombeo consumo"],
    strongPreferred: ["generacion programada pbf consumo bombeo"],
    weakExcluded: ["turbinacion bombeo", "potencia instalada", "programa bilateral", "phf", "pvp", "p48"],
    excluded: ["precio"],
    units: ["mw", "mwh"],
    frequencies: ["hour", "hora", "h"],
    expectedGeoTerms: ["peninsula", "espana"],
    minimumConfidence: 60,
    automaticGap: 6
  },
  intercambios: {
    allowedCategories: ["generacion_tiempo_real"],
    requiredAny: [["intercambio", "intercambios", "saldo"], ["internacional", "francia", "portugal", "marruecos", "andorra"]],
    preferred: ["intercambios internacionales", "saldo intercambios"],
    strongPreferred: ["generacion t.real intercambios", "saldo intercambios internacionales", "intercambios internacionales"],
    weakExcluded: ["ntc", "atc", "autorizada", "prevista", "disponible"],
    excluded: ["precio", "demanda", "capacidad de intercambio"],
    units: ["mw", "mwh"],
    frequencies: ["hour", "hora", "h"],
    expectedGeoTerms: ["peninsula", "espana"],
    minimumConfidence: 45,
    automaticGap: 4
  }
};

@Injectable()
export class MercadoIndicatorMappingService {
  private readonly logger = new Logger(MercadoIndicatorMappingService.name);
  private cache?: CachedMappings;
  private inFlight?: Promise<MercadoResolvedIndicatorMapping[]>;

  constructor(private readonly prisma: PrismaService) {}

  async resolveMappings() {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return cloneMappings(this.cache.value);
    }
    if (this.inFlight) {
      return cloneMappings(await this.inFlight);
    }

    this.inFlight = this.computeMappings()
      .then((value) => {
        this.cache = {
          value,
          expiresAt: Date.now() + MAPPING_CACHE_TTL_MS
        };
        return value;
      })
      .finally(() => {
        this.inFlight = undefined;
      });

    return cloneMappings(await this.inFlight);
  }

  invalidateCache() {
    this.cache = undefined;
    this.inFlight = undefined;
  }

  private async computeMappings() {
    const [indicators, confirmations] = await Promise.all([
      this.prisma.esiosIndicator.findMany({
        where: { active: true },
        select: {
          indicatorId: true,
          name: true,
          description: true,
          shortName: true,
          unit: true,
          frequency: true
        },
        orderBy: [{ indicatorId: "asc" }]
      }),
      this.prisma.mercadoIndicatorMappingConfirmation.findMany()
    ]);

    const confirmationByVariable = new Map(confirmations.map((confirmation) => [confirmation.variable, confirmation]));
    const candidateIndicators = indicators.map((indicator) => {
      const searchableText = normalizeText([indicator.name, indicator.shortName, indicator.description, indicator.unit, indicator.frequency].filter(Boolean).join(" "));
      return {
        indicatorId: indicator.indicatorId,
        name: indicator.name,
        description: indicator.description,
        shortName: indicator.shortName,
        unit: indicator.unit,
        frequency: indicator.frequency,
        searchableText,
        functionalCategory: classifyMercadoIndicator(searchableText)
      };
    });
    const candidateIds = selectCandidateIndicatorIds(candidateIndicators);
    const geoByIndicator = await this.loadGeographies(candidateIds);

    const resolved: MercadoResolvedIndicatorMapping[] = [
      {
        variable: "precioOmie",
        indicatorId: null,
        nombre: "Precio OMIE MD",
        geoId: null,
        geoKey: null,
        confidence: 100,
        functionalCategory: "precio",
        scoreBreakdown: {
          base: 100,
          category: 0,
          preferred: 0,
          strongPreferred: 0,
          unit: 0,
          frequency: 0,
          data: 0,
          geography: 0,
          penalties: 0,
          total: 100
        },
        ambiguityReason: null,
        status: "external",
        warnings: ["Variable obtenida desde OmiePrice, no desde el catalogo ESIOS."],
        alternatives: []
      }
    ];

    for (const variable of MERCADO_ESIOS_VARIABLES) {
      const candidates = this.rankCandidates(variable, candidateIndicators, geoByIndicator);
      const confirmation = confirmationByVariable.get(variable);
      if (confirmation) {
        const confirmedIndicator = candidateIndicators.find((indicator) => indicator.indicatorId === confirmation.indicatorId);
        const selectedCandidate = candidates.find(
          (candidate) =>
            candidate.indicatorId === confirmation.indicatorId &&
            (confirmation.geoKey === null || candidate.geoKey === confirmation.geoKey) &&
            (confirmation.geoId === null || candidate.geoId === confirmation.geoId)
        );
        resolved.push({
          variable,
          indicatorId: confirmation.indicatorId,
          nombre: confirmedIndicator?.name ?? confirmedIndicator?.shortName ?? null,
          geoId: confirmation.geoId,
          geoKey: confirmation.geoKey,
          confidence: Math.max(selectedCandidate?.confidence ?? 0, 95),
          functionalCategory: selectedCandidate?.functionalCategory ?? confirmedIndicator?.functionalCategory ?? null,
          scoreBreakdown: selectedCandidate?.scoreBreakdown ?? null,
          ambiguityReason: selectedCandidate ? null : "La confirmacion manual no coincide con ningun candidato permitido por la clasificacion funcional actual.",
          status: "confirmed",
          warnings: selectedCandidate ? [] : ["Mapping confirmado no aparece entre los candidatos principales del catalogo actual."],
          alternatives: candidates.slice(0, 5).map(stripCandidateVariable)
        });
        continue;
      }

      const selected = candidates[0];
      if (!selected) {
        resolved.push({
          variable,
          indicatorId: null,
          nombre: null,
          geoId: null,
          geoKey: null,
          confidence: 0,
          functionalCategory: null,
          scoreBreakdown: null,
          ambiguityReason: buildNoCandidateReason(variable, candidateIndicators),
          status: "not_found",
          warnings: ["No se ha encontrado ningun candidato razonable en el catalogo ESIOS."],
          alternatives: []
        });
        continue;
      }

      const second = candidates[1];
      const rule = VARIABLE_RULES[variable];
      const hasAutomaticGap = !second || selected.confidence - second.confidence >= rule.automaticGap;
      const isAuto = selected.confidence >= rule.minimumConfidence && hasAutomaticGap;
      resolved.push({
        variable,
        indicatorId: selected.indicatorId,
        nombre: selected.nombre,
        geoId: selected.geoId,
        geoKey: selected.geoKey,
        confidence: selected.confidence,
        functionalCategory: selected.functionalCategory,
        scoreBreakdown: selected.scoreBreakdown,
        ambiguityReason: isAuto ? null : buildAmbiguityReason(variable, selected, second),
        status: isAuto ? "auto" : "ambiguous",
        warnings: isAuto ? selected.warnings : ["Mapping ambiguo: requiere confirmacion manual.", buildAmbiguityReason(variable, selected, second), ...selected.warnings],
        alternatives: candidates.slice(1, 6).map(stripCandidateVariable)
      });
    }

    this.logger.debug(`Mercado mapping resuelto: ${resolved.length} variables, cache TTL ${MAPPING_CACHE_TTL_MS}ms.`);
    return resolved;
  }

  async confirmMapping(input: ConfirmMappingInput) {
    const variable = assertVariable(input.variable);
    const indicatorId = assertInteger(input.indicatorId, "indicatorId");
    const geoId = optionalInteger(input.geoId);
    const geoKey = optionalInteger(input.geoKey);

    const indicator = await this.prisma.esiosIndicator.findUnique({ where: { indicatorId } });
    if (!indicator) {
      throw new BadRequestException(`El indicador ESIOS ${indicatorId} no existe.`);
    }

    const confirmed = await this.prisma.mercadoIndicatorMappingConfirmation.upsert({
      where: { variable },
      create: {
        variable,
        indicatorId,
        geoId,
        geoKey
      },
      update: {
        indicatorId,
        geoId,
        geoKey
      }
    });

    this.invalidateCache();
    const mappings = await this.resolveMappings();
    return {
      confirmed,
      mapping: mappings.find((mapping) => mapping.variable === variable) ?? null
    };
  }

  async resolveDatasetMapping() {
    const mappings = await this.resolveMappings();
    return Object.fromEntries(mappings.map((mapping) => [mapping.variable, mapping]));
  }

  private rankCandidates(
    variable: MercadoEsiosVariable,
    indicators: CandidateIndicator[],
    geoByIndicator: Map<number, IndicatorGeography[]>
  ): IndicatorCandidate[] {
    return rankMercadoIndicatorCandidates(variable, indicators, geoByIndicator);
  }

  private async loadGeographies(indicatorIds: number[]) {
    if (indicatorIds.length === 0) {
      return new Map<number, Array<{ geoId: number | null; geoKey: number; geoName: string | null; records: number }>>();
    }
    const rows = await this.prisma.esiosIndicatorValue.groupBy({
      by: ["indicatorId", "geoId", "geoKey", "geoName"],
      where: { indicatorId: { in: indicatorIds.slice(0, MAX_CANDIDATE_IDS_FOR_GEO_QUERY) } },
      _count: { _all: true }
    });
    const byIndicator = new Map<number, IndicatorGeography[]>();
    for (const row of rows) {
      const current = byIndicator.get(row.indicatorId) ?? [];
      current.push({
        geoId: row.geoId,
        geoKey: row.geoKey,
        geoName: row.geoName,
        records: row._count._all
      });
      byIndicator.set(row.indicatorId, current);
    }
    return byIndicator;
  }
}

export function rankMercadoIndicatorCandidates(
  variable: MercadoEsiosVariable,
  indicators: CandidateIndicator[],
  geoByIndicator: Map<number, IndicatorGeography[]>
): IndicatorCandidate[] {
  const rule = VARIABLE_RULES[variable];
  const candidates: IndicatorCandidate[] = [];

  for (const indicator of indicators) {
    const text = indicator.searchableText;
    if (!rule.allowedCategories.includes(indicator.functionalCategory)) {
      continue;
    }
    if (!rule.requiredAny.every((group) => group.some((term) => text.includes(normalizeText(term))))) {
      continue;
    }
    if (rule.excluded.some((term) => text.includes(normalizeText(term)))) {
      continue;
    }

    const geographies = geoByIndicator.get(indicator.indicatorId) ?? [];
    const selectedGeo = selectBestGeography(geographies, rule.expectedGeoTerms);
    const warnings: string[] = [];
    if (geographies.length === 0) {
      warnings.push("Indicador sin datos descargados para inferir geografia.");
    }
    if (geographies.length > 1 && !selectedGeo.geoName) {
      warnings.push("Varias geografias disponibles sin una preferencia clara.");
    }

    const preferredScore = countMatches(text, rule.preferred) * 10;
    const strongPreferredScore = countMatches(text, rule.strongPreferred) * 24;
    const weakExclusionPenalty = countMatches(text, rule.weakExcluded) * 18;
    const unitScore = rule.units.some((unit) => normalizeText(indicator.unit ?? "").includes(unit)) ? 8 : 0;
    const frequencyScore = rule.frequencies.some((frequency) => normalizeText(indicator.frequency ?? "").includes(frequency)) ? 6 : 0;
    const dataScore = Math.min(16, Math.log10((selectedGeo.records ?? 0) + 1) * 5);
    const geoScore = selectedGeo.matched ? 10 : 0;
    const baseScore = 35;
    const categoryScore = 20;
    const rawScore = baseScore + categoryScore + preferredScore + strongPreferredScore + unitScore + frequencyScore + dataScore + geoScore - weakExclusionPenalty;
    const confidence = Math.max(0, Math.min(100, Math.round(rawScore)));
    const scoreBreakdown: MercadoIndicatorScoreBreakdown = {
      base: baseScore,
      category: categoryScore,
      preferred: preferredScore,
      strongPreferred: strongPreferredScore,
      unit: unitScore,
      frequency: frequencyScore,
      data: Number(dataScore.toFixed(2)),
      geography: geoScore,
      penalties: -weakExclusionPenalty,
      total: confidence
    };

    candidates.push({
      variable,
      indicatorId: indicator.indicatorId,
      nombre: indicator.name ?? indicator.shortName,
      description: indicator.description,
      unit: indicator.unit,
      frequency: indicator.frequency,
      functionalCategory: indicator.functionalCategory,
      geoId: selectedGeo.geoId,
      geoKey: selectedGeo.geoKey,
      geoName: selectedGeo.geoName,
      records: selectedGeo.records,
      confidence,
      scoreBreakdown,
      ambiguityReason: null,
      status: "candidate",
      warnings
    });
  }

  return candidates.sort((left, right) => right.confidence - left.confidence || right.records - left.records || left.indicatorId - right.indicatorId);
}

function stripCandidateVariable(candidate: IndicatorCandidate) {
  const { variable: _variable, status: _status, ...rest } = candidate;
  return rest;
}

function selectCandidateIndicatorIds(indicators: CandidateIndicator[]) {
  const ids = new Set<number>();
  for (const variable of MERCADO_ESIOS_VARIABLES) {
    const rule = VARIABLE_RULES[variable];
    for (const indicator of indicators) {
      const text = indicator.searchableText;
      if (
        rule.allowedCategories.includes(indicator.functionalCategory) &&
        rule.requiredAny.every((group) => group.some((term) => text.includes(normalizeText(term)))) &&
        !rule.excluded.some((term) => text.includes(normalizeText(term)))
      ) {
        ids.add(indicator.indicatorId);
      }
    }
  }
  return [...ids].slice(0, MAX_CANDIDATE_IDS_FOR_GEO_QUERY);
}

export function classifyMercadoIndicator(textInput: string): MercadoIndicatorFunctionalCategory {
  const text = normalizeText(textInput);
  if (includesAny(text, ["precio", "price"])) {
    return "precio";
  }
  if (includesAny(text, ["perfil", "perfiles"])) {
    return "perfil";
  }
  if (includesAny(text, ["potencia instalada", "capacidad instalada"])) {
    return "potencia_instalada";
  }
  if (includesAny(text, ["potencia disponible", "disponibilidad"])) {
    return "potencia_disponible";
  }
  if (includesAny(text, ["capacidad de intercambio", "ntc", "atc", "capacidad autorizada"])) {
    return "intercambio_capacidad";
  }
  if (includesAny(text, ["p48"])) {
    return "generacion_programada_p48";
  }
  if (includesAny(text, ["phf"])) {
    return "generacion_programada_phf";
  }
  if (includesAny(text, ["pvp"])) {
    return "generacion_programada_pvp";
  }
  if (includesAny(text, ["pbf"])) {
    return "generacion_programada_pbf";
  }
  if (includesAny(text, ["t.real", "tiempo real", "telemedida", "medida en tiempo real"])) {
    return "generacion_tiempo_real";
  }
  if (includesAny(text, ["solar fotovoltaica", "solar termica", "nuclear", "hidraulica ugh", "hidraulica no ugh"])) {
    return "generacion_real";
  }
  if (includesAny(text, ["demanda"])) {
    return "demanda";
  }
  if (includesAny(text, ["prevision", "prevista", "previsto"])) {
    return "prevision";
  }
  if (includesAny(text, ["balance", "desvio", "regulacion", "reserva"])) {
    return "balance";
  }
  return "desconocida";
}

function buildAmbiguityReason(variable: MercadoEsiosVariable, selected: IndicatorCandidate, second?: IndicatorCandidate) {
  const rule = VARIABLE_RULES[variable];
  if (selected.confidence < rule.minimumConfidence) {
    return `Confianza ${selected.confidence}% inferior al minimo automatico ${rule.minimumConfidence}% para ${variable}.`;
  }
  if (second) {
    const gap = selected.confidence - second.confidence;
    if (gap < rule.automaticGap) {
      return `Candidato cercano ${second.indicatorId} (${second.functionalCategory}, ${second.confidence}%). Diferencia ${gap} puntos, inferior al margen automatico ${rule.automaticGap}.`;
    }
  }
  return `El candidato pertenece a ${selected.functionalCategory}, pero no alcanza seguridad suficiente para confirmar automaticamente.`;
}

function buildNoCandidateReason(variable: MercadoEsiosVariable, indicators: CandidateIndicator[]) {
  const rule = VARIABLE_RULES[variable];
  const categories = new Set(indicators.map((indicator) => indicator.functionalCategory));
  const missingCategories = rule.allowedCategories.filter((category) => !categories.has(category));
  if (missingCategories.length === rule.allowedCategories.length) {
    return `No hay indicadores activos clasificados en las categorias esperadas: ${rule.allowedCategories.join(", ")}.`;
  }
  return `Hay indicadores en categorias compatibles, pero ninguno cumple los terminos obligatorios de ${variable}.`;
}

function selectBestGeography(geographies: Array<{ geoId: number | null; geoKey: number; geoName: string | null; records: number }>, expectedTerms: string[]) {
  if (geographies.length === 0) {
    return { geoId: null, geoKey: null, geoName: null, records: 0, matched: false };
  }
  const ranked = geographies
    .map((geo) => {
      const text = normalizeText(geo.geoName ?? "");
      const matched = expectedTerms.some((term) => text.includes(normalizeText(term)));
      return { ...geo, matched, score: (matched ? 1000000 : 0) + geo.records };
    })
    .sort((left, right) => right.score - left.score);
  return ranked[0];
}

function countMatches(text: string, terms: string[]) {
  return terms.filter((term) => text.includes(normalizeText(term))).length;
}

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(normalizeText(term)));
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeMercadoIndicatorText(value: string) {
  return normalizeText(value);
}

function assertVariable(value: string | undefined): MercadoEsiosVariable {
  if (!value || !MERCADO_ESIOS_VARIABLES.includes(value as MercadoEsiosVariable)) {
    throw new BadRequestException(`Variable Mercado no valida: ${value ?? ""}.`);
  }
  return value as MercadoEsiosVariable;
}

function assertInteger(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new BadRequestException(`${field} debe ser un entero.`);
  }
  return parsed;
}

function optionalInteger(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new BadRequestException("geoId/geoKey deben ser enteros si se informan.");
  }
  return parsed;
}

function cloneMappings(value: MercadoResolvedIndicatorMapping[]) {
  return value.map((mapping) => ({
    ...mapping,
    scoreBreakdown: mapping.scoreBreakdown ? { ...mapping.scoreBreakdown } : null,
    warnings: [...mapping.warnings],
    alternatives: mapping.alternatives.map((alternative) => ({
      ...alternative,
      scoreBreakdown: { ...alternative.scoreBreakdown },
      warnings: [...alternative.warnings]
    }))
  }));
}
