import { createHash } from "node:crypto";
import path from "node:path";
import { ReeFileType, ReeSettlementVersion } from "@prisma/client";

export interface ReeFileMetadata {
  version: ReeSettlementVersion;
  tipoArchivo: ReeFileType;
  fechaLiquidacion: Date;
  sujetoEic: string;
}

export interface ParseIssue {
  sourceFileName: string;
  lineNumber: number;
  message: string;
  rawLine?: string;
}

export interface ParsedA1Record {
  sourceLineNumber: number;
  rawLine: string;
  recordHash: string;
  rawPayloadJson: Record<string, string | null>;
  fecha?: Date;
  hora?: number;
  codigoUpr?: string;
  energiaMwh?: string;
  precioEurMwh?: string;
  importeEur?: string;
  codigoAgenteVendedor?: string;
  segmento?: string;
  facturacion?: string;
  eicUpr?: string;
  cuenta?: string;
  signoImporte?: string;
  signoMagnitud?: string;
  eicTitular?: string;
  codigoMagnitud?: string;
  codigoPrecio?: string;
  codigoApunte?: string;
  tipoOferta?: string;
  tipoUpr?: string;
  energiaContratoBilateralMwh?: string;
  sesion?: string;
  campoHora25?: string;
  brp?: string;
  importeCalculadoEur?: string;
  importeDiferenciaEur?: string;
  importeConsistente: boolean;
  precioAnomalo: boolean;
  validationErrors: string[];
}

export interface ParsedRecordResult {
  record?: ParsedA1Record;
  error?: ParseIssue;
}

const FILE_NAME_PATTERN = /^(C[1-5])_?(reganecuQH|reganecu)_?(\d{8})_([A-Z0-9]+)/i;
const IMPORTE_TOLERANCE = 0.01;
const PRICE_ANOMALY_THRESHOLD_EUR_MWH = 10000;

const POSITIONAL_FIELDS = [
  "fecha",
  "hora",
  "codigoUpr",
  "energiaMwh",
  "reservado1",
  "precioEurMwh",
  "reservado2",
  "importeEur",
  "reservado3",
  "codigoAgenteVendedor",
  "segmento",
  "facturacion",
  "eicUpr",
  "cuenta",
  "signoImporte",
  "signoMagnitud",
  "eicTitular",
  "codigoMagnitud",
  "codigoPrecio",
  "codigoApunte",
  "tipoOferta",
  "tipoUpr",
  "energiaContratoBilateralMwh",
  "sesion"
] as const;

const HEADER_ALIASES: Record<(typeof POSITIONAL_FIELDS)[number], string[]> = {
  fecha: ["fecha", "dia", "date"],
  hora: ["hora", "periodo", "cuarto", "cuarto_horario", "intervalo", "qh"],
  codigoUpr: ["codigo_upr", "cod_upr", "upr", "codigo_de_la_upr"],
  energiaMwh: ["energia_mwh", "energia", "magnitud", "energia_mwh_"],
  reservado1: ["reservado_1", "reservado1"],
  precioEurMwh: ["precio_eur_mwh", "precio", "precio_eur_mwh_"],
  reservado2: ["reservado_2", "reservado2"],
  importeEur: ["importe_eur", "importe", "anotacion", "importe_eur_"],
  reservado3: ["reservado_3", "reservado3"],
  codigoAgenteVendedor: ["codigo_agente_vendedor", "agente_vendedor", "cod_agente_vendedor"],
  segmento: ["segmento", "segment"],
  facturacion: ["facturacion", "facturacion_a1"],
  eicUpr: ["eic_upr", "eic_de_la_upr"],
  cuenta: ["cuenta"],
  signoImporte: ["signo_importe", "signo_del_importe"],
  signoMagnitud: ["signo_magnitud", "signo_de_la_magnitud"],
  eicTitular: ["eic_titular", "titular"],
  codigoMagnitud: ["codigo_magnitud", "codigo_de_la_magnitud"],
  codigoPrecio: ["codigo_precio", "codigo_del_precio"],
  codigoApunte: ["codigo_apunte", "codigo_anotacion", "codigo_del_apunte"],
  tipoOferta: ["tipo_oferta"],
  tipoUpr: ["tipo_upr"],
  energiaContratoBilateralMwh: [
    "energia_contrato_bilateral_mwh",
    "energia_de_contrato_bilateral_mwh",
    "energia_contrato_bilateral"
  ],
  sesion: ["sesion", "campo_hora_25", "hora_25"]
};

export function parseReeFileMetadata(fileName: string): ReeFileMetadata {
  const normalizedName = path.basename(fileName).replace(/\.(txt|csv|dat)$/i, "");
  const match = FILE_NAME_PATTERN.exec(normalizedName);

  if (!match) {
    throw new Error(
      `Nombre de fichero no reconocido. Debe seguir el patron C1-C5 + reganecu/reganecuQH + fecha YYYYMMDD + sujeto EIC: ${fileName}`
    );
  }

  return {
    version: match[1].toUpperCase() as ReeSettlementVersion,
    tipoArchivo: match[2].toLowerCase() === "reganecuqh" ? ReeFileType.REGANECUQH : ReeFileType.REGANECU,
    fechaLiquidacion: parseCompactDate(match[3]),
    sujetoEic: match[4].toUpperCase()
  };
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

export function* parseA1ReganecuRecords({
  sourceFileName,
  content,
  delimiter,
  metadata
}: {
  sourceFileName: string;
  content: string;
  delimiter: string;
  metadata: ReeFileMetadata;
}): Generator<ParsedRecordResult> {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  let header: string[] | undefined;
  let seenDataLine = false;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const lineNumber = index + 1;

    if (!rawLine.trim()) {
      continue;
    }

    const values = splitDelimitedLine(rawLine, delimiter);
    if (!seenDataLine) {
      const detectedHeader = readHeader(values);
      if (detectedHeader) {
        header = detectedHeader;
        seenDataLine = true;
        continue;
      }

      if (values.length < 10) {
        continue;
      }
    }

    if (isIgnorableTailLine(values)) {
      continue;
    }

    seenDataLine = true;
    const parsed = parseRecordLine({
      sourceFileName,
      lineNumber,
      rawLine,
      values,
      header,
      metadata
    });

    yield parsed;
  }
}

export function splitDelimitedLine(line: string, delimiter: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === "\"" && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      quoted = !quoted;
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

function parseRecordLine({
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
  metadata: ReeFileMetadata;
}): ParsedRecordResult {
  if (values.length < 10) {
    return {
      error: {
        sourceFileName,
        lineNumber,
        message: `Estructura incompleta: ${values.length} campos.`,
        rawLine
      }
    };
  }

  const payload = buildPayload(values, header);
  const validationErrors: string[] = [];
  const parsedFecha = parseDateTime(readValue(payload, "fecha"));
  const fecha = parsedFecha?.date;
  const parsedHora = parseInteger(readValue(payload, "hora"));
  const hora =
    parsedHora ??
    (metadata.tipoArchivo === ReeFileType.REGANECUQH ? quarterHourFromTimestamp(parsedFecha) : undefined);
  const rawEnergia = parseDecimal(readValue(payload, "energiaMwh"));
  const rawPrecio = parseDecimal(readValue(payload, "precioEurMwh"));
  const rawImporte = parseDecimal(readValue(payload, "importeEur"));
  const rawEnergiaContratoBilateral = parseDecimal(readValue(payload, "energiaContratoBilateralMwh"));
  const signoImporte = readText(payload, "signoImporte");
  const signoMagnitud = readText(payload, "signoMagnitud");
  const energia = applySign(rawEnergia, signoMagnitud);
  const importe = applySign(rawImporte, signoImporte);
  const energiaContratoBilateral = applySign(rawEnergiaContratoBilateral, signoMagnitud);
  const importeCalculado =
    energia !== undefined && rawPrecio !== undefined ? roundNumber(energia * rawPrecio, 6) : undefined;
  const importeDiferencia =
    importe !== undefined && importeCalculado !== undefined ? roundNumber(importe - importeCalculado, 6) : undefined;
  const importeConsistente = importeDiferencia === undefined || Math.abs(importeDiferencia) <= IMPORTE_TOLERANCE;
  const precioAnomalo = rawPrecio !== undefined && Math.abs(rawPrecio) > PRICE_ANOMALY_THRESHOLD_EUR_MWH;

  if (!fecha) {
    validationErrors.push("fecha_invalida");
  }

  if ((metadata.tipoArchivo === ReeFileType.REGANECUQH && hora === undefined) || (hora !== undefined && !isValidHour(metadata.tipoArchivo, hora))) {
    validationErrors.push("hora_invalida");
  }

  const codigoUpr = readText(payload, "codigoUpr");
  const eicUpr = readText(payload, "eicUpr");
  if (!codigoUpr && !eicUpr) {
    validationErrors.push("upr_no_informada");
  }

  const recordHash = createHash("sha256")
    .update(
      [
        metadata.tipoArchivo,
        metadata.version,
        metadata.sujetoEic,
        toIsoDate(fecha),
        hora ?? "",
        codigoUpr ?? "",
        eicUpr ?? "",
        readText(payload, "segmento") ?? "",
        readText(payload, "codigoMagnitud") ?? "",
        readText(payload, "codigoPrecio") ?? "",
        readText(payload, "codigoApunte") ?? "",
        formatDecimal(energia),
        formatDecimal(rawPrecio),
        formatDecimal(importe)
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
      hora,
      codigoUpr,
      energiaMwh: formatDecimal(energia),
      precioEurMwh: formatDecimal(rawPrecio),
      importeEur: formatDecimal(importe),
      codigoAgenteVendedor: readText(payload, "codigoAgenteVendedor"),
      segmento: readText(payload, "segmento"),
      facturacion: readText(payload, "facturacion"),
      eicUpr,
      cuenta: readText(payload, "cuenta"),
      signoImporte,
      signoMagnitud,
      eicTitular: readText(payload, "eicTitular"),
      codigoMagnitud: readText(payload, "codigoMagnitud"),
      codigoPrecio: readText(payload, "codigoPrecio"),
      codigoApunte: readText(payload, "codigoApunte"),
      tipoOferta: readText(payload, "tipoOferta"),
      tipoUpr: readText(payload, "tipoUpr"),
      energiaContratoBilateralMwh: formatDecimal(energiaContratoBilateral),
      sesion: metadata.tipoArchivo === ReeFileType.REGANECU ? readText(payload, "sesion") : undefined,
      campoHora25: metadata.tipoArchivo === ReeFileType.REGANECUQH ? readText(payload, "sesion") : undefined,
      brp: readText(payload, "eicTitular") ?? readText(payload, "codigoAgenteVendedor"),
      importeCalculadoEur: formatDecimal(importeCalculado),
      importeDiferenciaEur: formatDecimal(importeDiferencia),
      importeConsistente,
      precioAnomalo,
      validationErrors
    }
  };
}

function readHeader(values: string[]) {
  const normalized = values.map(normalizeHeader);
  const matches = normalized.filter((field) =>
    Object.values(HEADER_ALIASES).some((aliases) => aliases.includes(field))
  );
  return matches.length >= 3 ? normalized : undefined;
}

function buildPayload(values: string[], header?: string[]) {
  const payload = new Map<(typeof POSITIONAL_FIELDS)[number], string | undefined>();

  for (let index = 0; index < POSITIONAL_FIELDS.length; index += 1) {
    payload.set(POSITIONAL_FIELDS[index], values[index]);
  }

  if (!header) {
    return payload;
  }

  for (let index = 0; index < header.length; index += 1) {
    const field = findFieldByHeader(header[index]);
    if (field) {
      payload.set(field, values[index]);
    }
  }

  return payload;
}

function findFieldByHeader(header: string) {
  return POSITIONAL_FIELDS.find((field) => HEADER_ALIASES[field].includes(header));
}

function readValue(payload: Map<(typeof POSITIONAL_FIELDS)[number], string | undefined>, field: (typeof POSITIONAL_FIELDS)[number]) {
  const value = payload.get(field);
  return value?.trim() ? value.trim() : undefined;
}

function readText(payload: Map<(typeof POSITIONAL_FIELDS)[number], string | undefined>, field: (typeof POSITIONAL_FIELDS)[number]) {
  return readValue(payload, field);
}

function isIgnorableTailLine(values: string[]) {
  if (values.length !== 1) {
    return false;
  }

  const token = values[0]?.trim().toUpperCase();
  return token === "*" || token === "***" || token === "FIN" || token === "END" || token === "EOF" || token.startsWith("TOTAL");
}

function payloadToJson(payload: Map<(typeof POSITIONAL_FIELDS)[number], string | undefined>) {
  return POSITIONAL_FIELDS.reduce<Record<string, string | null>>((json, field) => {
    const value = payload.get(field);
    json[field] = value?.trim() ? value.trim() : null;
    return json;
  }, {});
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

function parseDateTime(value?: string) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  const compact = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?$/.exec(trimmed);
  if (compact) {
    return buildDateTime({
      year: Number(compact[1]),
      month: Number(compact[2]),
      day: Number(compact[3]),
      hour: compact[4] === undefined ? undefined : Number(compact[4]),
      minute: compact[5] === undefined ? undefined : Number(compact[5]),
      second: compact[6] === undefined ? undefined : Number(compact[6])
    });
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(trimmed);
  if (iso) {
    return buildDateTime({
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3]),
      hour: iso[4] === undefined ? undefined : Number(iso[4]),
      minute: iso[5] === undefined ? undefined : Number(iso[5]),
      second: iso[6] === undefined ? undefined : Number(iso[6])
    });
  }

  const european = /^(\d{2})[/-](\d{2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(trimmed);
  if (european) {
    return buildDateTime({
      year: Number(european[3]),
      month: Number(european[2]),
      day: Number(european[1]),
      hour: european[4] === undefined ? undefined : Number(european[4]),
      minute: european[5] === undefined ? undefined : Number(european[5]),
      second: european[6] === undefined ? undefined : Number(european[6])
    });
  }

  return undefined;
}

function buildDateTime({
  year,
  month,
  day,
  hour,
  minute,
  second
}: {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
}) {
  const date = buildUtcDate(year, month, day);
  if (!date) {
    return undefined;
  }

  if (hour === undefined && minute === undefined && second === undefined) {
    return { date };
  }

  if (
    hour === undefined ||
    minute === undefined ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    (second !== undefined && (second < 0 || second > 59))
  ) {
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

function quarterHourFromTimestamp(parsed?: { date: Date; hour?: number; minute?: number }) {
  if (parsed?.hour === undefined || parsed.minute === undefined || parsed.minute % 15 !== 0) {
    return undefined;
  }

  return parsed.hour * 4 + parsed.minute / 15 + 1;
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

function applySign(value: number | undefined, sign?: string) {
  if (value === undefined) {
    return undefined;
  }

  return value * signMultiplier(sign);
}

function signMultiplier(sign?: string) {
  const normalized = sign?.trim().toUpperCase();
  if (!normalized) {
    return 1;
  }

  return normalized.includes("-") || normalized === "N" || normalized === "NEGATIVO" || normalized === "-1" ? -1 : 1;
}

function isValidHour(tipoArchivo: ReeFileType, hour: number) {
  return tipoArchivo === ReeFileType.REGANECUQH ? hour >= 1 && hour <= 100 : hour >= 1 && hour <= 25;
}

function roundNumber(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatDecimal(value?: number) {
  return value === undefined || Number.isNaN(value) ? undefined : value.toFixed(6);
}

function toIsoDate(value?: Date) {
  return value?.toISOString().slice(0, 10) ?? "";
}
