import { BadRequestException } from "@nestjs/common";
import type { GasMibgasParsedFile, GasMibgasParseError, ParsedGasMibgasRow } from "./gas-mibgas.types";

const REQUIRED_HEADERS = [
  "Trading day",
  "Product",
  "Place of delivery",
  "Area",
  "First Day Delivery",
  "Last Day Delivery",
  "MIBGAS Daily Price [EUR/MWh]"
] as const;

type RequiredHeader = (typeof REQUIRED_HEADERS)[number];

export class MibgasParser {
  parse(content: Buffer | string, context: { year: number; filename: string }): GasMibgasParsedFile {
    const text = decodeText(content);
    validateTextLooksLikeCsv(text);
    const lines = splitLines(text).filter((line) => line.trim());
    if (lines.length < 2) {
      throw new BadRequestException("El fichero MIBGAS no contiene filas suficientes.");
    }

    const metadata = parseEmissionMetadata(lines[0]);
    const headerIndex = lines.findIndex((line) => normalizeHeaderLine(line).includes("trading day") && normalizeHeaderLine(line).includes("product"));
    if (headerIndex < 0) {
      throw new BadRequestException("El fichero MIBGAS no contiene la cabecera esperada.");
    }

    const headers = parseCsvLine(lines[headerIndex]).map((item) => item.trim()).filter(Boolean);
    validateHeaders(headers);
    const headerMap = new Map(headers.map((header, index) => [header, index]));
    const rows: ParsedGasMibgasRow[] = [];
    const errors: GasMibgasParseError[] = [];

    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim()) {
        continue;
      }
      const values = parseCsvLine(line);
      const parsed = parseRow(values, headerMap, index + 1, context, metadata.sourceEmissionDatetime);
      if ("error" in parsed) {
        errors.push(parsed.error);
      } else {
        rows.push(parsed.row);
      }
    }

    if (rows.length === 0) {
      throw new BadRequestException("El fichero MIBGAS no contiene registros validos.");
    }

    return {
      year: context.year,
      filename: context.filename,
      sourceEmissionDatetime: metadata.sourceEmissionDatetime,
      rows,
      errors
    };
  }
}

export function validateMibgasNaturalKey(rows: ParsedGasMibgasRow[]) {
  const seen = new Set<string>();
  const duplicates: ParsedGasMibgasRow[] = [];
  for (const row of rows) {
    const key = naturalKey(row);
    if (seen.has(key)) {
      duplicates.push(row);
    } else {
      seen.add(key);
    }
  }
  return { totalRows: rows.length, duplicateRows: duplicates.length, duplicates };
}

function parseRow(
  values: string[],
  headerMap: Map<string, number>,
  rowNumber: number,
  context: { year: number; filename: string },
  sourceEmissionDatetime: Date | null
): { row: ParsedGasMibgasRow } | { error: GasMibgasParseError } {
  const raw = Object.fromEntries([...headerMap.entries()].map(([header, index]) => [header, normalizeEmpty(values[index])]));
  const tradingDay = parseDmyDate(read(raw, "Trading day"));
  const product = read(raw, "Product");
  const placeOfDelivery = read(raw, "Place of delivery");
  const area = read(raw, "Area");
  const firstDayDelivery = parseDmyDate(read(raw, "First Day Delivery"));
  const lastDayDelivery = parseDmyDate(read(raw, "Last Day Delivery"));
  const priceEurMwh = parseDecimal(read(raw, "MIBGAS Daily Price [EUR/MWh]"));

  if (!tradingDay) {
    return { error: { row: rowNumber, message: "Trading day no es una fecha valida." } };
  }
  if (!product) {
    return { error: { row: rowNumber, message: "Product no informado." } };
  }
  if (!placeOfDelivery) {
    return { error: { row: rowNumber, message: "Place of delivery no informado." } };
  }
  if (!area) {
    return { error: { row: rowNumber, message: "Area no informada." } };
  }
  if (!firstDayDelivery || !lastDayDelivery) {
    return { error: { row: rowNumber, message: "Periodo de entrega no valido." } };
  }
  if (priceEurMwh === undefined) {
    return { error: { row: rowNumber, message: "MIBGAS Daily Price no es numerico." } };
  }

  return {
    row: {
      tradingDay,
      product,
      placeOfDelivery,
      area,
      firstDayDelivery,
      lastDayDelivery,
      priceEurMwh,
      sourceYear: context.year,
      sourceFilename: context.filename,
      sourceEmissionDatetime,
      deliveryPeriodLabel: buildDeliveryPeriodLabel(firstDayDelivery, lastDayDelivery),
      rawPayloadJson: raw
    }
  };
}

function decodeText(content: Buffer | string) {
  if (typeof content === "string") {
    return content.replace(/^\uFEFF/, "");
  }
  const utf8 = content.toString("utf8").replace(/^\uFEFF/, "");
  return utf8.includes("\uFFFD") ? content.toString("latin1").replace(/^\uFEFF/, "") : utf8;
}

function validateTextLooksLikeCsv(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new BadRequestException("El fichero MIBGAS esta vacio.");
  }
  if (/^\s*<(?:!doctype\s+html|html|head|body)\b/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) {
    throw new BadRequestException("MIBGAS devolvio HTML en lugar de CSV.");
  }
}

function splitLines(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function parseEmissionMetadata(line: string) {
  const match = /Fecha\s+Emisi[oó]n\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2}):(\d{2})/i.exec(line);
  if (!match) {
    return { sourceEmissionDatetime: null };
  }
  return {
    sourceEmissionDatetime: madridLocalDateTimeToUtc(Number(match[3]), Number(match[2]), Number(match[1]), Number(match[4]), Number(match[5]))
  };
}

function validateHeaders(headers: string[]) {
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new BadRequestException(`Faltan columnas obligatorias en el fichero MIBGAS: ${missing.join(", ")}.`);
  }
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === ";" && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

function normalizeHeaderLine(line: string) {
  return line.trim().toLowerCase();
}

function normalizeEmpty(value: string | undefined) {
  const text = (value ?? "").trim();
  return text || null;
}

function read(row: Record<string, string | null>, header: RequiredHeader) {
  return row[header]?.trim() || null;
}

function parseDmyDate(value: string | null) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value ?? "");
  if (!match) {
    return null;
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

function parseDecimal(value: string | null) {
  if (value === null) {
    return null;
  }
  const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? normalized : undefined;
}

function buildDeliveryPeriodLabel(start: Date, end: Date) {
  if (start.getTime() === end.getTime()) {
    return start.toISOString().slice(0, 10);
  }
  if (start.getUTCDate() === 1 && isLastDayOfMonth(end) && start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth()) {
    return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (start.getUTCDate() === 1 && isLastDayOfQuarter(start, end)) {
    return `${start.getUTCFullYear()}-Q${Math.floor(start.getUTCMonth() / 3) + 1}`;
  }
  if (start.getUTCMonth() === 0 && start.getUTCDate() === 1 && end.getUTCMonth() === 11 && end.getUTCDate() === 31 && start.getUTCFullYear() === end.getUTCFullYear()) {
    return String(start.getUTCFullYear());
  }
  return `${start.toISOString().slice(0, 10)} / ${end.toISOString().slice(0, 10)}`;
}

function isLastDayOfMonth(date: Date) {
  const nextDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
  return nextDay.getUTCDate() === 1;
}

function isLastDayOfQuarter(start: Date, end: Date) {
  const quarterEndMonth = Math.floor(start.getUTCMonth() / 3) * 3 + 2;
  return start.getUTCMonth() % 3 === 0 && end.getUTCMonth() === quarterEndMonth && isLastDayOfMonth(end) && start.getUTCFullYear() === end.getUTCFullYear();
}

function naturalKey(row: ParsedGasMibgasRow) {
  return [
    row.tradingDay.toISOString().slice(0, 10),
    row.product,
    row.placeOfDelivery,
    row.area,
    row.firstDayDelivery.toISOString().slice(0, 10),
    row.lastDayDelivery.toISOString().slice(0, 10)
  ].join("|");
}

function madridLocalDateTimeToUtc(year: number, month: number, day: number, hour: number, minute: number) {
  const guessUtc = Date.UTC(year, month - 1, day, hour, minute);
  const madridAsUtc = partsAsUtc(new Date(guessUtc));
  const offsetMs = madridAsUtc - guessUtc;
  return new Date(guessUtc - offsetMs);
}

function partsAsUtc(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
}
