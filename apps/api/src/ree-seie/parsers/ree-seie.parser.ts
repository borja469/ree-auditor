import { createHash } from "node:crypto";
import { splitDelimitedLine } from "../../imports/parsers/reganecu.parser";

export interface ReeSeieMetadata {
  tipoArchivo: "SEIE";
  version: string;
  fechaLiquidacion: Date;
  sujetoEic?: string;
  headerFields: string[];
  headerLineCount: number;
}

export interface ReeSeieParseIssue {
  sourceFileName: string;
  lineNumber: number;
  message: string;
  rawLine?: string;
}

export interface ParsedReeSeieRecord {
  sourceLineNumber: number;
  rawLine: string;
  recordHash: string;
  rawPayloadJson: Record<string, string | null>;
  fecha?: Date;
  hora?: number;
  codigo?: string;
  magnitud?: string;
  precio?: string;
  energia?: string;
  unidad?: string;
  tipo?: string;
  sentido?: string;
  segmento?: string;
  fields: Record<ReeSeieField, string | undefined>;
  validationErrors: string[];
}

export interface ParsedReeSeieResult {
  record?: ParsedReeSeieRecord;
  error?: ReeSeieParseIssue;
}

export const SEIE_POSITIONAL_FIELDS = [
  "campo01Fecha",
  "campo02Hora",
  "campo03Codigo",
  "campo04Magnitud",
  "campo05Reservado1",
  "campo06Precio",
  "campo07Reservado2",
  "campo08Energia",
  "campo09Reservado3",
  "campo10Reservado4",
  "campo11Tipo",
  "campo12Sentido",
  "campo13Unidad",
  "campo14Segmento",
  "campo15SignoImporte",
  "campo16SignoMagnitud",
  "campo17SujetoEic",
  "campo18CodigoPrecio",
  "campo19CodigoUnidad2",
  "campo20CodigoUnidad3",
  "campo21Clase",
  "campo22Valor1",
  "campo23Valor2",
  "campo24Valor3"
] as const;

export type ReeSeieField = (typeof SEIE_POSITIONAL_FIELDS)[number];

const EXPECTED_COLUMNS = SEIE_POSITIONAL_FIELDS.length;
const HEADER_PREFIX = /^SEIE/i;
const VERSION_PATTERN = /(?:^|[_\-\s])(C[1-5])(?:[_\-\s]|$)/i;

export function detectSeieDelimiter(content: string) {
  return content.includes(";") ? ";" : ",";
}

export function parseReeSeieMetadata(content: string, sourceFileName: string): ReeSeieMetadata {
  const nonEmptyLines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const firstLine = nonEmptyLines[0];

  if (!firstLine) {
    throw new Error("El fichero SEIE esta vacio.");
  }

  const values = splitDelimitedLine(firstLine, ";").filter((value, index, array) => value !== "" || index < array.length - 1);
  if (!HEADER_PREFIX.test(values[0] ?? "")) {
    throw new Error(`Cabecera SEIE no reconocida en ${sourceFileName}.`);
  }

  let headerLineCount = 1;
  if (values.length < 4) {
    for (const line of nonEmptyLines.slice(1)) {
      const nextValues = splitDelimitedLine(line, ";").filter((value, index, array) => value !== "" || index < array.length - 1);
      values.push(...nextValues);
      headerLineCount += 1;
      if (values.length >= 7) {
        break;
      }
    }
  }

  const firstRecordDate = readFirstRecordDate(nonEmptyLines.slice(headerLineCount));
  const headerYear = parseInteger(values[1]);
  const headerMonth = parseInteger(values[2]);
  const headerDay = parseInteger(values[3]);
  const headerDate = headerYear && headerMonth && headerDay ? buildUtcDate(headerYear, headerMonth, headerDay) : undefined;
  const fechaLiquidacion = firstRecordDate ?? headerDate;
  if (!fechaLiquidacion) {
    throw new Error(`Fecha de liquidacion SEIE invalida en ${sourceFileName}.`);
  }

  return {
    tipoArchivo: "SEIE",
    version: parseVersionFromName(sourceFileName) ?? "C1",
    fechaLiquidacion,
    headerFields: values,
    headerLineCount
  };
}

export function* parseReeSeieRecords({
  sourceFileName,
  content,
  delimiter,
  metadata
}: {
  sourceFileName: string;
  content: string;
  delimiter: string;
  metadata: ReeSeieMetadata;
}): Generator<ParsedReeSeieResult> {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  let headerLinesConsumed = 0;
  let verticalBuffer: Array<{ value: string; rawLine: string; lineNumber: number }> = [];

  const flushVerticalRecord = function* () {
    if (verticalBuffer.length === 0) {
      return;
    }
    if (verticalBuffer.length !== EXPECTED_COLUMNS) {
      const first = verticalBuffer[0];
      yield {
        error: {
          sourceFileName,
          lineNumber: first.lineNumber,
          message: `Numero de columnas invalido: ${verticalBuffer.length}. Esperadas: ${EXPECTED_COLUMNS}.`,
          rawLine: verticalBuffer.map((item) => item.rawLine).join("\n")
        }
      };
      verticalBuffer = [];
      return;
    }

    const values = verticalBuffer.map((item) => item.value);
    const first = verticalBuffer[0];
    const rawLine = verticalBuffer.map((item) => item.rawLine).join("\n");
    verticalBuffer = [];
    yield parseRecordLine(sourceFileName, first.lineNumber, rawLine, values, metadata);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const lineNumber = index + 1;
    if (!rawLine.trim()) {
      continue;
    }

    const values = trimTrailingEmpty(splitDelimitedLine(rawLine, delimiter));
    if (headerLinesConsumed < metadata.headerLineCount || HEADER_PREFIX.test(values[0] ?? "")) {
      headerLinesConsumed += 1;
      continue;
    }
    if (isIgnorableTailLine(values)) {
      yield* flushVerticalRecord();
      continue;
    }

    if (values.length === 1) {
      verticalBuffer.push({ value: values[0]?.trim() ?? "", rawLine, lineNumber });
      if (verticalBuffer.length === EXPECTED_COLUMNS) {
        yield* flushVerticalRecord();
      }
      continue;
    }

    yield* flushVerticalRecord();
    if (values.length !== EXPECTED_COLUMNS) {
      yield {
        error: {
          sourceFileName,
          lineNumber,
          message: `Numero de columnas invalido: ${values.length}. Esperadas: ${EXPECTED_COLUMNS}.`,
          rawLine
        }
      };
      continue;
    }

    yield parseRecordLine(sourceFileName, lineNumber, rawLine, values, metadata);
  }

  yield* flushVerticalRecord();
}

function parseRecordLine(
  sourceFileName: string,
  lineNumber: number,
  rawLine: string,
  values: string[],
  metadata: ReeSeieMetadata
): ParsedReeSeieResult {
  const fields = SEIE_POSITIONAL_FIELDS.reduce<Record<ReeSeieField, string | undefined>>((payload, field, index) => {
    payload[field] = values[index]?.trim() || undefined;
    return payload;
  }, {} as Record<ReeSeieField, string | undefined>);
  const validationErrors: string[] = [];
  const fecha = parseDate(fields.campo01Fecha);
  const hora = parseInteger(fields.campo02Hora);
  const rawMagnitud = parseDecimal(fields.campo04Magnitud);
  const precio = parseDecimal(fields.campo06Precio);
  const rawEnergia = parseDecimal(fields.campo08Energia);
  const codigo = readText(fields.campo20CodigoUnidad3);
  const unidad = readText(fields.campo13Unidad);
  const tipo = readText(fields.campo19CodigoUnidad2);
  const sentido = readText(fields.campo14Segmento);
  const segmento = readText(fields.campo11Tipo);
  const magnitud = applySeieMagnitudeSign(rawMagnitud, fields.campo16SignoMagnitud);
  const energia = applySeieImportSign(rawEnergia, fields.campo15SignoImporte);

  if (!fecha) {
    validationErrors.push("fecha_invalida");
  }
  if (hora === undefined || hora < 1 || hora > 25) {
    validationErrors.push("hora_invalida");
  }
  if (!readText(fields.campo03Codigo)) {
    validationErrors.push("codigo_upr_no_informado");
  }
  if (!unidad) {
    validationErrors.push("eic_upr_no_informado");
  }
  if (!codigo) {
    validationErrors.push("codigo_apunte_no_informado");
  }
  if (!tipo) {
    validationErrors.push("codigo_precio_no_informado");
  }
  if (!segmento) {
    validationErrors.push("segmento_no_informado");
  }
  if (magnitud === undefined) {
    validationErrors.push("magnitud_invalida");
  }
  if (precio === undefined) {
    validationErrors.push("precio_invalido");
  }
  if (energia === undefined) {
    validationErrors.push("energia_invalida");
  }

  const recordHash = createHash("sha256")
    .update([metadata.version, toIsoDate(fecha), hora ?? "", codigo ?? "", unidad ?? "", tipo ?? "", sentido ?? "", segmento ?? "", values.join("|")].join("|"))
    .digest("hex");

  return {
    record: {
      sourceLineNumber: lineNumber,
      rawLine,
      recordHash,
      rawPayloadJson: payloadToJson(fields),
      fecha,
      hora,
      codigo,
      magnitud: formatDecimal(magnitud),
      precio: formatDecimal(precio),
      energia: formatDecimal(energia),
      unidad,
      tipo,
      sentido,
      segmento,
      fields,
      validationErrors
    }
  };
}

function trimTrailingEmpty(values: string[]) {
  const next = [...values];
  while (next.length > 0 && next[next.length - 1] === "") {
    next.pop();
  }
  return next;
}

function isIgnorableTailLine(values: string[]) {
  if (values.length !== 1) {
    return false;
  }
  const token = values[0]?.trim().toUpperCase();
  return token === "*" || token === "***" || token === "FIN" || token === "END" || token === "EOF" || token.startsWith("TOTAL");
}

function readText(value?: string) {
  return value?.trim() || undefined;
}

function payloadToJson(payload: Record<ReeSeieField, string | undefined>) {
  return SEIE_POSITIONAL_FIELDS.reduce<Record<string, string | null>>((json, field) => {
    json[field] = payload[field] ?? null;
    return json;
  }, {});
}

function parseDate(value?: string) {
  if (!value) {
    return undefined;
  }
  const european = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(value.trim());
  if (european) {
    return buildUtcDate(Number(european[3]), Number(european[2]), Number(european[1]));
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (iso) {
    return buildUtcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  return undefined;
}

function readFirstRecordDate(lines: string[]) {
  for (const line of lines) {
    const values = trimTrailingEmpty(splitDelimitedLine(line, ";"));
    if (isIgnorableTailLine(values)) {
      continue;
    }
    if (values.length >= EXPECTED_COLUMNS) {
      const date = parseDate(values[0]);
      if (date) {
        return date;
      }
    }
  }
  return undefined;
}

function parseVersionFromName(fileName: string) {
  return VERSION_PATTERN.exec(fileName)?.[1]?.toUpperCase();
}

function buildUtcDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : undefined;
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

function formatDecimal(value?: number) {
  return value === undefined || Number.isNaN(value) ? undefined : value.toFixed(6);
}

function applySeieImportSign(value?: number, sign?: string) {
  if (value === undefined) {
    return undefined;
  }
  const normalized = sign?.trim();
  if (normalized === "1") {
    return -value;
  }
  return value;
}

function applySeieMagnitudeSign(value?: number, sign?: string) {
  if (value === undefined) {
    return undefined;
  }
  const normalized = sign?.trim();
  if (normalized === "1") {
    return -value;
  }
  return value;
}

function toIsoDate(value?: Date) {
  return value?.toISOString().slice(0, 10) ?? "";
}
