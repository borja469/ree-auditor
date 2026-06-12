import { createHash } from "node:crypto";
import path from "node:path";
import { MedperFileType } from "@prisma/client";
import { splitDelimitedLine } from "./reganecu.parser";

export interface MedperFileMetadata {
  version: string;
  tipoArchivo: MedperFileType;
  fechaInicio: Date;
  fechaFin: Date;
  sujetoEic: string;
}

export interface MedperParseIssue {
  sourceFileName: string;
  lineNumber: number;
  message: string;
  rawLine?: string;
}

export interface ParsedMedperqhRecord {
  sourceLineNumber: number;
  rawLine: string;
  recordHash: string;
  rawPayloadJson: Record<string, string | null>;
  fecha: Date;
  timestamp: Date;
  hora: number;
  cuartoHora: number;
  codigoUnidad: string;
  peaje?: string;
  programaEnergiaMwh?: string;
  perdidasMwh?: string;
  bcMwh?: string;
  pfMwh?: string;
  bcPfDifferenceMwh?: string;
  negativeEnergy: boolean;
  bcPfInconsistent: boolean;
  validationErrors: string[];
}

export interface ParsedMedperResult {
  record?: ParsedMedperqhRecord;
  error?: MedperParseIssue;
}

const FILE_NAME_PATTERNS = [
  {
    regex: /([A-Z]\d+)[_\-. ]*(medperqh|meperqh)[_\-. ]*(\d{8})[_\-. ]*(\d{8})[_\-. ]*([A-Z0-9]+)/i,
    groups: {
      version: 1,
      type: 2,
      start: 3,
      end: 4,
      subject: 5
    }
  },
  {
    regex: /(medperqh|meperqh)[_\-. ]*([A-Z]\d+)[_\-. ]*(\d{8})[_\-. ]*(\d{8})[_\-. ]*([A-Z0-9]+)/i,
    groups: {
      type: 1,
      version: 2,
      start: 3,
      end: 4,
      subject: 5
    }
  }
];
const BC_PF_TOLERANCE_MWH = 0.001;

const MEDPERQH_FIELDS = [
  "codigoUnidad",
  "fecha",
  "hora",
  "cuartoHora",
  "peaje",
  "programaEnergiaMwh",
  "perdidasMwh",
  "bcMwh",
  "pfMwh"
] as const;

type MedperqhField = (typeof MEDPERQH_FIELDS)[number];

const MEDPERQH_HEADER_ALIASES: Record<MedperqhField, string[]> = {
  codigoUnidad: ["codigo_unidad", "codigo_upr", "cod_unidad", "unidad", "upr"],
  fecha: ["fecha", "dia", "date"],
  hora: ["hora", "periodo"],
  cuartoHora: ["cuarto_hora", "cuarto", "qh", "periodo_qh"],
  peaje: ["peaje", "tarifa"],
  programaEnergiaMwh: ["programa_energia", "programa_energia_mwh", "programa", "energia_programada"],
  perdidasMwh: ["perdidas", "perdidas_mwh", "perdida"],
  bcMwh: ["bc", "bc_mwh", "balance_cierre"],
  pfMwh: ["pf", "pf_mwh", "punto_frontera"]
};

export function parseMedperFileMetadata(fileName: string): MedperFileMetadata {
  const normalizedName = path.basename(fileName).replace(/\.(txt|csv|dat|zip)$/i, "");
  const patternMatch = FILE_NAME_PATTERNS.map((pattern) => ({
    pattern,
    match: pattern.regex.exec(normalizedName)
  })).find((candidate) => candidate.match);

  if (!patternMatch?.match) {
    throw new Error(
      `Nombre de fichero MEDPER no reconocido. Debe incluir version como C3/A3, medperqh, fecha_inicio YYYYMMDD, fecha_fin YYYYMMDD y sujeto EIC: ${fileName}`
    );
  }

  const { match, pattern } = patternMatch;
  return {
    version: match[pattern.groups.version].toUpperCase(),
    tipoArchivo: MedperFileType.MEDPERQH,
    fechaInicio: parseCompactDate(match[pattern.groups.start]),
    fechaFin: parseCompactDate(match[pattern.groups.end]),
    sujetoEic: match[pattern.groups.subject].toUpperCase()
  };
}

export function* parseMedperRecords({
  sourceFileName,
  content,
  delimiter,
  metadata
}: {
  sourceFileName: string;
  content: string;
  delimiter: string;
  metadata: MedperFileMetadata;
}): Generator<ParsedMedperResult> {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  let header: string[] | undefined;
  let seenDataLine = false;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const lineNumber = index + 1;

    if (!rawLine.trim() || rawLine.trim() === "*") {
      continue;
    }

    const values = splitDelimitedLine(rawLine, delimiter);
    if (!seenDataLine) {
      const detectedHeader = readHeader(values, MEDPERQH_HEADER_ALIASES);
      if (detectedHeader) {
        header = detectedHeader;
        seenDataLine = true;
        continue;
      }

      if (isMedperPreambleLine(values)) {
        continue;
      }

      if (values.length < 5) {
        continue;
      }
    }

    if (isIgnorableTailLine(values)) {
      continue;
    }

    seenDataLine = true;
    yield parseMedperqhLine({ sourceFileName, lineNumber, rawLine, values, header, metadata });
  }
}

function parseMedperqhLine({
  sourceFileName,
  lineNumber,
  rawLine,
  values,
  header,
  metadata
}: {
  sourceFileName: string;
  lineNumber: number;
  rawLine: string;
  values: string[];
  header?: string[];
  metadata: MedperFileMetadata;
}): ParsedMedperResult {
  if (values.length < 7) {
    return {
      error: {
        sourceFileName,
        lineNumber,
        message: `Estructura MEDPERQH incompleta: ${values.length} campos.`,
        rawLine
      }
    };
  }

  const payload = buildPayload(values, header, MEDPERQH_FIELDS, MEDPERQH_HEADER_ALIASES);
  const validationErrors: string[] = [];
  const fecha = parseDate(readPayload(payload, "fecha"));
  const hora = parseInteger(readPayload(payload, "hora"));
  const cuartoHora = parseInteger(readPayload(payload, "cuartoHora"));
  const codigoUnidad = readText(payload, "codigoUnidad");
  const peaje = readText(payload, "peaje");
  const programaEnergia = parseDecimal(readPayload(payload, "programaEnergiaMwh"));
  const perdidas = parseDecimal(readPayload(payload, "perdidasMwh"));
  const bc = parseDecimal(readPayload(payload, "bcMwh"));
  const pf = parseDecimal(readPayload(payload, "pfMwh"));
  const bcPfDifference = bc !== undefined && pf !== undefined ? roundNumber(bc - pf, 6) : undefined;
  const bcPfInconsistent =
    bcPfDifference !== undefined && perdidas !== undefined && Math.abs(Math.abs(bcPfDifference) - Math.abs(perdidas)) > BC_PF_TOLERANCE_MWH;

  if (!fecha) {
    validationErrors.push("fecha_invalida");
  }
  if (hora === undefined || hora < 1 || hora > 25) {
    validationErrors.push("hora_invalida");
  }
  if (cuartoHora === undefined || cuartoHora < 1 || cuartoHora > 4) {
    validationErrors.push("cuarto_hora_invalido");
  }
  if (!codigoUnidad) {
    validationErrors.push("unidad_no_informada");
  }

  const timestamp = fecha && hora !== undefined && cuartoHora !== undefined ? quarterHourTimestamp(fecha, hora, cuartoHora) : undefined;
  if (!timestamp) {
    validationErrors.push("timestamp_invalido");
  }

  const negativeEnergy = [programaEnergia, perdidas, bc, pf].some((value) => value !== undefined && value > 0);

  if (!fecha || !timestamp || hora === undefined || cuartoHora === undefined || !codigoUnidad) {
    return {
      error: {
        sourceFileName,
        lineNumber,
        message: validationErrors.join(", "),
        rawLine
      }
    };
  }

  const recordHash = createHash("sha256")
    .update(
      [
        metadata.version,
        metadata.sujetoEic,
        toIsoDate(fecha),
        hora,
        cuartoHora,
        codigoUnidad,
        peaje ?? "",
        formatDecimal(programaEnergia),
        formatDecimal(perdidas),
        formatDecimal(bc),
        formatDecimal(pf)
      ].join("|")
    )
    .digest("hex");

  return {
    record: {
      sourceLineNumber: lineNumber,
      rawLine,
      recordHash,
      rawPayloadJson: payloadToJson(payload),
      fecha,
      timestamp,
      hora,
      cuartoHora,
      codigoUnidad,
      peaje,
      programaEnergiaMwh: formatDecimal(programaEnergia),
      perdidasMwh: formatDecimal(perdidas),
      bcMwh: formatDecimal(bc),
      pfMwh: formatDecimal(pf),
      bcPfDifferenceMwh: formatDecimal(bcPfDifference),
      negativeEnergy,
      bcPfInconsistent,
      validationErrors
    }
  };
}

function readHeader<TField extends string>(values: string[], aliases: Record<TField, string[]>) {
  const normalized = values.map(normalizeHeader);
  const matches = normalized.filter((field) => Object.values<string[]>(aliases).some((items) => items.includes(field)));
  return matches.length >= 3 ? normalized : undefined;
}

function isMedperPreambleLine(values: string[]) {
  if (values.length === 0) {
    return true;
  }

  const first = values[0]?.trim().toLowerCase();
  if (!first || first === "medperqh" || first === "meperqh") {
    return true;
  }

  return !parseDate(values[1]);
}

function isIgnorableTailLine(values: string[]) {
  if (values.length !== 1) {
    return false;
  }

  const token = values[0]?.trim().toUpperCase();
  return token === "*" || token === "***" || token === "FIN" || token === "END" || token === "EOF" || token.startsWith("TOTAL");
}

function buildPayload<TField extends string>(
  values: string[],
  header: string[] | undefined,
  fields: readonly TField[],
  aliases: Record<TField, string[]>
) {
  const payload = new Map<TField, string | undefined>();

  for (let index = 0; index < fields.length; index += 1) {
    payload.set(fields[index], values[index]);
  }

  if (!header) {
    return payload;
  }

  for (let index = 0; index < header.length; index += 1) {
    const field = fields.find((candidate) => aliases[candidate].includes(header[index]));
    if (field) {
      payload.set(field, values[index]);
    }
  }

  return payload;
}

function readPayload(payload: Map<string, string | undefined>, field: string) {
  const value = payload.get(field);
  return value?.trim() ? value.trim() : undefined;
}

function readText(payload: Map<string, string | undefined>, field: string) {
  return readPayload(payload, field);
}

function payloadToJson(payload: Map<string, string | undefined>) {
  return Object.fromEntries([...payload.entries()].map(([key, value]) => [key, value?.trim() ? value.trim() : null]));
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCompactDate(value: string) {
  return buildUtcDate(Number(value.slice(0, 4)), Number(value.slice(4, 6)), Number(value.slice(6, 8))) ?? new Date(NaN);
}

function parseDate(value?: string) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(trimmed);
  if (compact) {
    return buildUtcDate(Number(compact[1]), Number(compact[2]), Number(compact[3]));
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    return buildUtcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const european = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(trimmed);
  if (european) {
    return buildUtcDate(Number(european[3]), Number(european[2]), Number(european[1]));
  }

  return undefined;
}

function buildUtcDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : undefined;
}

function quarterHourTimestamp(date: Date, hour: number, quarterHour: number) {
  if (hour < 1 || hour > 25 || quarterHour < 1 || quarterHour > 4) {
    return undefined;
  }

  const minutes = (hour - 1) * 60 + (quarterHour - 1) * 15;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, minutes));
}

function parseInteger(value?: string) {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s/g, "");
  return /^-?\d+$/.test(normalized) ? Number(normalized) : undefined;
}

function parseDecimal(value?: string) {
  if (!value) {
    return undefined;
  }

  const compact = value.replace(/\s/g, "");
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  const normalized =
    lastComma >= 0 && lastDot >= 0
      ? lastComma > lastDot
        ? compact.replace(/\./g, "").replace(",", ".")
        : compact.replace(/,/g, "")
      : compact.replace(",", ".");

  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : undefined;
}

function roundNumber(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatDecimal(value?: number) {
  return value === undefined || Number.isNaN(value) ? undefined : value.toFixed(6);
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}
