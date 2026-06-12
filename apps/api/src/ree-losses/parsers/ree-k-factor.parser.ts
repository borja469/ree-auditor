import { createHash } from "node:crypto";
import path from "node:path";
import { ReeKFactorFileType, ReeSettlementVersion } from "@prisma/client";

export interface ReeKFactorMetadata {
  version: ReeSettlementVersion;
  tipoArchivo: ReeKFactorFileType;
  fechaInicio: Date;
  fechaFin: Date;
}

export interface ReeKFactorParseIssue {
  sourceFileName: string;
  lineNumber: number;
  message: string;
  rawLine?: string;
}

export interface ParsedReeKFactorRecord {
  sourceLineNumber: number;
  rawLine: string;
  recordHash: string;
  rawPayloadJson: Record<string, string | null>;
  fecha: Date;
  hora: number;
  cuartohora: number;
  tarifa?: string;
  periodo?: string;
  valorK: number;
}

export interface ParsedReeKFactorResult {
  record?: ParsedReeKFactorRecord;
  error?: ReeKFactorParseIssue;
}

const FILE_NAME_PATTERNS = [
  {
    regex: /((?:A1|C[1-5]))[_\-. ]*(kestimqh|krealqh)[_\-. ]*(\d{8})[_\-. ]*(\d{8})/i,
    groups: { version: 1, type: 2, start: 3, end: 4 }
  },
  {
    regex: /(kestimqh|krealqh)[_\-. ]*((?:A1|C[1-5]))[_\-. ]*(\d{8})[_\-. ]*(\d{8})/i,
    groups: { type: 1, version: 2, start: 3, end: 4 }
  }
];
const K_FACTOR_VERSIONS = ["A1", "C1", "C2", "C3", "C4", "C5"] as const;

const K_FACTOR_FIELDS = ["fecha", "hora", "cuartohora", "tarifa", "periodo", "valorK"] as const;
type KFactorField = (typeof K_FACTOR_FIELDS)[number];

const K_FACTOR_HEADER_ALIASES: Record<KFactorField, string[]> = {
  fecha: ["fecha", "dia", "date", "timestamp", "fecha_hora", "datetime"],
  hora: ["hora", "h", "periodo_hora", "hour"],
  cuartohora: ["cuartohora", "cuarto_hora", "cuarto", "qh", "periodo_qh", "quarter"],
  tarifa: ["tarifa", "peaje", "tipo_tarifa", "atr", "tipo_peaje"],
  periodo: ["periodo", "periodo_tarifario", "periodo_boe", "p"],
  valorK: ["k", "valor_k", "factor_k", "kestimqh", "krealqh", "coeficiente", "factor", "valor"]
};

const POSITIONAL_CANDIDATES: KFactorField[][] = [
  ["fecha", "hora", "cuartohora", "tarifa", "periodo", "valorK"],
  ["fecha", "hora", "cuartohora", "periodo", "tarifa", "valorK"],
  ["tarifa", "fecha", "hora", "cuartohora", "periodo", "valorK"],
  ["tarifa", "periodo", "fecha", "hora", "cuartohora", "valorK"],
  ["fecha", "hora", "cuartohora", "valorK", "tarifa", "periodo"],
  ["fecha", "hora", "cuartohora", "periodo", "valorK"],
  ["fecha", "hora", "cuartohora", "valorK"]
];

export function parseKFactorFileMetadata(fileName: string, content: string): ReeKFactorMetadata {
  const normalizedName = path.basename(fileName).replace(/\.(txt|csv|dat|zip)$/i, "");
  const patternMatch = FILE_NAME_PATTERNS.map((pattern) => ({
    pattern,
    match: pattern.regex.exec(normalizedName)
  })).find((candidate) => candidate.match);

  if (patternMatch?.match) {
    const { match, pattern } = patternMatch;
    return {
      version: parseVersion(match[pattern.groups.version]),
      tipoArchivo: parseKFactorType(match[pattern.groups.type]),
      fechaInicio: parseCompactDate(match[pattern.groups.start]),
      fechaFin: parseCompactDate(match[pattern.groups.end])
    };
  }

  const contentMetadata = parseContentMetadata(content);
  if (contentMetadata) {
    return contentMetadata;
  }

  throw new Error(
    `Nombre de fichero K no reconocido. Debe incluir version A1 o C1-C5, Kestimqh/Krealqh y rango YYYYMMDD_YYYYMMDD: ${fileName}`
  );
}

export function detectDelimiter(content: string) {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 20);
  const candidates = [";", "|", "\t", ","];
  const scored = candidates.map((delimiter) => ({
    delimiter,
    score: lines.reduce((sum, line) => sum + splitDelimitedLine(line, delimiter).length, 0)
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score > lines.length ? scored[0].delimiter : ";";
}

export function* parseKFactorRecords({
  sourceFileName,
  content,
  delimiter,
  metadata
}: {
  sourceFileName: string;
  content: string;
  delimiter: string;
  metadata: ReeKFactorMetadata;
}): Generator<ParsedReeKFactorResult> {
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
      const detectedHeader = readHeader(values, K_FACTOR_HEADER_ALIASES);
      if (detectedHeader) {
        header = detectedHeader;
        seenDataLine = true;
        continue;
      }

      if (isPreambleLine(values)) {
        continue;
      }
    }

    if (isIgnorableTailLine(values)) {
      continue;
    }

    seenDataLine = true;
    yield parseKFactorLine({ sourceFileName, lineNumber, rawLine, values, header, metadata });
  }
}

export function splitDelimitedLine(line: string, delimiter: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === delimiter && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function parseKFactorLine({
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
  metadata: ReeKFactorMetadata;
}): ParsedReeKFactorResult {
  const payload = header
    ? buildPayloadFromHeader(values, header, K_FACTOR_FIELDS, K_FACTOR_HEADER_ALIASES)
    : buildBestPositionalPayload(values);
  const validationErrors: string[] = [];
  const fechaParts = parseDateTime(readPayload(payload, "fecha"));
  const rawHora = parseInteger(readPayload(payload, "hora"));
  const rawCuartohora = parseInteger(readPayload(payload, "cuartohora"));
  const time = normalizeQuarterHour(rawHora, rawCuartohora, fechaParts);
  const tarifa = normalizeTarifa(readPayload(payload, "tarifa"));
  const periodo = normalizePeriodo(readPayload(payload, "periodo"));
  const valorK = parseDecimal(readPayload(payload, "valorK"));

  if (!fechaParts?.date) {
    validationErrors.push("fecha_invalida");
  }
  if (!time) {
    validationErrors.push("hora_o_cuartohora_invalida");
  }
  if (valorK === undefined) {
    validationErrors.push("valor_k_invalido");
  }
  if (tarifa && !isSupportedTarifaShape(tarifa)) {
    validationErrors.push("tarifa_invalida");
  }
  if (periodo && !/^P[1-6]$/.test(periodo)) {
    validationErrors.push("periodo_invalido");
  }

  if (!fechaParts?.date || !time || valorK === undefined) {
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
    .update([metadata.version, metadata.tipoArchivo, toIsoDate(fechaParts.date), time.hora, time.cuartohora, tarifa ?? "", periodo ?? "", valorK].join("|"))
    .digest("hex");

  return {
    record: {
      sourceLineNumber: lineNumber,
      rawLine,
      recordHash,
      rawPayloadJson: payloadToJson(payload),
      fecha: fechaParts.date,
      hora: time.hora,
      cuartohora: time.cuartohora,
      tarifa,
      periodo,
      valorK
    }
  };
}

function parseContentMetadata(content: string): ReeKFactorMetadata | undefined {
  const text = content.split(/\r?\n/).slice(0, 30).join(" ");
  const version = /(?:A1|C[1-5])/i.exec(text)?.[0];
  const type = /(kestimqh|krealqh)/i.exec(text)?.[1];
  const dates = [...text.matchAll(/(\d{8})/g)].map((match) => match[1]);

  if (!version || !type || dates.length < 2) {
    return undefined;
  }

  return {
    version: parseVersion(version),
    tipoArchivo: parseKFactorType(type),
    fechaInicio: parseCompactDate(dates[0]),
    fechaFin: parseCompactDate(dates[1])
  };
}

function readHeader<TField extends string>(values: string[], aliases: Record<TField, string[]>) {
  const normalized = values.map(normalizeHeader);
  const matches = normalized.filter((field) => Object.values<string[]>(aliases).some((items) => items.includes(field)));
  return matches.length >= 3 ? normalized : undefined;
}

function isPreambleLine(values: string[]) {
  if (values.length === 0) {
    return true;
  }

  const joined = values.join(" ").trim().toLowerCase();
  if (!joined || joined === "kestimqh" || joined === "krealqh") {
    return true;
  }

  return !values.some((value) => parseDateTime(value)?.date) || values.length < 4;
}

function isIgnorableTailLine(values: string[]) {
  if (values.length !== 1) {
    return false;
  }

  const token = values[0]?.trim().toUpperCase();
  return token === "*" || token === "***" || token === "FIN" || token === "END" || token === "EOF" || token.startsWith("TOTAL");
}

function buildPayloadFromHeader<TField extends string>(
  values: string[],
  header: string[],
  fields: readonly TField[],
  aliases: Record<TField, string[]>
) {
  const payload = new Map<TField, string | undefined>();

  for (let index = 0; index < fields.length; index += 1) {
    payload.set(fields[index], undefined);
  }

  for (let index = 0; index < header.length; index += 1) {
    const field = fields.find((candidate) => aliases[candidate].includes(header[index]));
    if (field) {
      payload.set(field, values[index]);
    }
  }

  return payload;
}

function buildBestPositionalPayload(values: string[]) {
  const candidates = POSITIONAL_CANDIDATES.map((fields) => {
    const payload = new Map<KFactorField, string | undefined>();
    for (const field of K_FACTOR_FIELDS) {
      payload.set(field, undefined);
    }
    for (let index = 0; index < fields.length; index += 1) {
      payload.set(fields[index], values[index]);
    }

    return {
      payload,
      score: scorePayload(payload)
    };
  });

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.payload ?? new Map<KFactorField, string | undefined>();
}

function scorePayload(payload: Map<KFactorField, string | undefined>) {
  return [
    parseDateTime(readPayload(payload, "fecha"))?.date ? 5 : 0,
    parseDecimal(readPayload(payload, "valorK")) !== undefined ? 5 : 0,
    parseInteger(readPayload(payload, "hora")) !== undefined ? 2 : 0,
    parseInteger(readPayload(payload, "cuartohora")) !== undefined ? 2 : 0,
    normalizeTarifa(readPayload(payload, "tarifa")) ? 1 : 0,
    normalizePeriodo(readPayload(payload, "periodo")) ? 1 : 0
  ].reduce((sum, value) => sum + value, 0);
}

function readPayload(payload: Map<string, string | undefined>, field: string) {
  const value = payload.get(field);
  return value?.trim() ? value.trim() : undefined;
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

function parseKFactorType(value: string) {
  return value.trim().toUpperCase() === "KREALQH" ? ReeKFactorFileType.KREALQH : ReeKFactorFileType.KESTIMQH;
}

function parseVersion(value: string) {
  const version = value.trim().toUpperCase();
  if (!(K_FACTOR_VERSIONS as readonly string[]).includes(version)) {
    throw new Error(`Version K no valida: ${value}`);
  }
  return version as ReeSettlementVersion;
}

function parseCompactDate(value: string) {
  return buildUtcDate(Number(value.slice(0, 4)), Number(value.slice(4, 6)), Number(value.slice(6, 8))) ?? new Date(NaN);
}

function parseDateTime(value?: string) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  const compact = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?$/.exec(trimmed);
  if (compact) {
    return buildDateTimeParts(
      Number(compact[1]),
      Number(compact[2]),
      Number(compact[3]),
      compact[4] === undefined ? undefined : Number(compact[4]),
      compact[5] === undefined ? undefined : Number(compact[5])
    );
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z)?)?$/.exec(trimmed);
  if (iso) {
    return buildDateTimeParts(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      iso[4] === undefined ? undefined : Number(iso[4]),
      iso[5] === undefined ? undefined : Number(iso[5])
    );
  }

  const european = /^(\d{2})[/-](\d{2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?$/.exec(trimmed);
  if (european) {
    return buildDateTimeParts(
      Number(european[3]),
      Number(european[2]),
      Number(european[1]),
      european[4] === undefined ? undefined : Number(european[4]),
      european[5] === undefined ? undefined : Number(european[5])
    );
  }

  return undefined;
}

function buildDateTimeParts(year: number, month: number, day: number, hour?: number, minute?: number) {
  const date = buildUtcDate(year, month, day);
  if (!date) {
    return undefined;
  }

  if (hour === undefined && minute === undefined) {
    return { date };
  }

  if (hour === undefined || minute === undefined || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return undefined;
  }

  return { date, hour, minute };
}

function buildUtcDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : undefined;
}

function normalizeQuarterHour(
  rawHora: number | undefined,
  rawCuartohora: number | undefined,
  fechaParts?: { hour?: number; minute?: number }
) {
  if (rawCuartohora !== undefined && rawCuartohora > 4 && rawCuartohora <= 100) {
    return {
      hora: Math.floor((rawCuartohora - 1) / 4) + 1,
      cuartohora: ((rawCuartohora - 1) % 4) + 1
    };
  }

  if (rawHora !== undefined && rawCuartohora !== undefined) {
    const hora = rawHora === 0 ? 1 : rawHora;
    return hora >= 1 && hora <= 25 && rawCuartohora >= 1 && rawCuartohora <= 4
      ? { hora, cuartohora: rawCuartohora }
      : undefined;
  }

  if (fechaParts?.hour !== undefined && fechaParts.minute !== undefined && fechaParts.minute % 15 === 0) {
    return {
      hora: fechaParts.hour + 1,
      cuartohora: fechaParts.minute / 15 + 1
    };
  }

  return undefined;
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

function normalizeTarifa(value?: string) {
  if (!value) {
    return undefined;
  }

  return value.trim().toUpperCase().replace(/\s+/g, "").replace(/^T/, "");
}

function normalizePeriodo(value?: string) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  return /^[1-6]$/.test(normalized) ? `P${normalized}` : normalized;
}

function isSupportedTarifaShape(value: string) {
  return /^(2\.0TD|3\.0TD|6\.[1-4]TD)$/.test(value);
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}
