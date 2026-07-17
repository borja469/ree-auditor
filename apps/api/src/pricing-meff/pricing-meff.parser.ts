import { BadRequestException } from "@nestjs/common";
import * as XLSX from "xlsx";
import type { ParsedPricingMeffRow, PricingMeffImportError } from "./pricing-meff.types";

type RawRow = Record<string, unknown>;

const HEADER_ALIASES = {
  fechaPublicacion: ["fechapublicacion", "fechadepublicacion", "fpublicacion", "fecha"],
  cod: ["cod", "codigo", "code"],
  tipo: ["tipo", "type"],
  clase: ["clase", "class"],
  periodo: ["periodo", "período", "period"],
  entrega: ["entrega", "delivery"],
  multiplicador: ["multiplicador", "multiplier"],
  precio: ["precio", "price", "preciocierre", "preciodecierre", "cierre"]
} as const;

export function parsePricingMeffWorkbook(buffer: Buffer): { rows: ParsedPricingMeffRow[]; errors: PricingMeffImportError[] } {
  const htmlRows = parseHtmlTableRows(buffer);
  const rawRows = htmlRows.length ? htmlRows : parseWorkbookRows(buffer);
  if (rawRows.length === 0) {
    throw new BadRequestException("El fichero MEFF no contiene filas de datos.");
  }

  const headerMap = buildHeaderMap(Object.keys(rawRows[0] ?? {}));
  validateHeaderMap(headerMap);

  const rows: ParsedPricingMeffRow[] = [];
  const errors: PricingMeffImportError[] = [];
  rawRows.forEach((raw, index) => {
    const rowNumber = index + 2;
    if (isEmptyRow(raw)) {
      return;
    }

    const parsed = parseRow(raw, headerMap, rowNumber);
    if ("error" in parsed) {
      errors.push(parsed.error);
      return;
    }
    rows.push(parsed.row);
  });

  return { rows, errors };
}

function parseWorkbookRows(buffer: Buffer) {
  const workbook = readWorkbook(buffer);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new BadRequestException("El fichero MEFF no contiene hojas legibles.");
  }

  return XLSX.utils.sheet_to_json<RawRow>(workbook.Sheets[sheetName], { defval: null, raw: true });
}

function readWorkbook(buffer: Buffer) {
  try {
    return XLSX.read(buffer, { type: "buffer", cellDates: false, raw: false });
  } catch (error) {
    throw new BadRequestException(`No se pudo leer el fichero MEFF como Excel/HTML: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseHtmlTableRows(buffer: Buffer): RawRow[] {
  const utf8 = buffer.toString("utf8");
  const html = utf8.includes("\uFFFD") ? buffer.toString("latin1") : utf8;
  if (!/<table[\s>]/i.test(html)) {
    return [];
  }

  const tableMatch = /<table[\s\S]*?<\/table>/i.exec(html);
  const table = tableMatch?.[0] ?? html;
  const rawRows = [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)]
    .map((match) => [...match[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => cleanHtmlCell(cell[1])))
    .filter((row) => row.some((cell) => cell.trim()));
  if (rawRows.length < 2) {
    return [];
  }

  const headers = rawRows[0];
  return rawRows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header || `Columna ${index + 1}`, row[index] ?? null])));
}

function cleanHtmlCell(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'");
}

function buildHeaderMap(headers: string[]) {
  const normalized = new Map(headers.map((header) => [normalizeHeader(header), header]));
  return {
    fechaPublicacion: findHeader(normalized, HEADER_ALIASES.fechaPublicacion),
    cod: findHeader(normalized, HEADER_ALIASES.cod),
    tipo: findHeader(normalized, HEADER_ALIASES.tipo),
    clase: findHeader(normalized, HEADER_ALIASES.clase),
    periodo: findHeader(normalized, HEADER_ALIASES.periodo),
    entrega: findHeader(normalized, HEADER_ALIASES.entrega),
    multiplicador: findHeader(normalized, HEADER_ALIASES.multiplicador),
    precio: findHeader(normalized, HEADER_ALIASES.precio)
  };
}

function validateHeaderMap(headerMap: ReturnType<typeof buildHeaderMap>) {
  const missing = [
    !headerMap.fechaPublicacion ? "FechaPublicacion" : "",
    !headerMap.cod ? "Cod" : "",
    !headerMap.precio ? "Precio" : ""
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new BadRequestException(`Faltan columnas obligatorias en el fichero MEFF: ${missing.join(", ")}.`);
  }
}

function parseRow(raw: RawRow, headerMap: ReturnType<typeof buildHeaderMap>, rowNumber: number): { row: ParsedPricingMeffRow } | { error: PricingMeffImportError } {
  const fechaPublicacion = parseDateValue(readField(raw, headerMap.fechaPublicacion));
  const cod = readText(raw, headerMap.cod);
  const precio = parseDecimalValue(readField(raw, headerMap.precio));

  if (!fechaPublicacion) {
    return { error: { row: rowNumber, message: "FechaPublicacion no es una fecha valida." } };
  }
  if (!cod) {
    return { error: { row: rowNumber, message: "Cod no informado." } };
  }
  if (precio === null) {
    return { error: { row: rowNumber, message: "Precio no es numerico." } };
  }

  return {
    row: {
      fechaPublicacion,
      cod,
      tipo: readText(raw, headerMap.tipo),
      clase: readText(raw, headerMap.clase),
      periodo: readText(raw, headerMap.periodo),
      entrega: readText(raw, headerMap.entrega),
      multiplicador: readText(raw, headerMap.multiplicador),
      precio,
      rawPayloadJson: normalizeRawPayload(raw)
    }
  };
}

function findHeader(normalizedHeaders: Map<string, string>, aliases: readonly string[]) {
  for (const alias of aliases) {
    const found = normalizedHeaders.get(normalizeHeader(alias));
    if (found) {
      return found;
    }
  }
  return undefined;
}

function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function isEmptyRow(row: RawRow) {
  return Object.values(row).every((value) => value === null || value === undefined || String(value).trim() === "");
}

function readField(row: RawRow, header?: string) {
  return header ? row[header] : null;
}

function readText(row: RawRow, header?: string) {
  const value = readField(row, header);
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text || null;
}

function parseDateValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toUtcDateOnly(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)) : null;
  }

  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }

  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(text);
  if (dmy) {
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const date = new Date(Date.UTC(year, Number(dmy[2]) - 1, Number(dmy[1])));
    return isValidDate(date) ? date : null;
  }

  const ymd = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(text);
  if (ymd) {
    const date = new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])));
    return isValidDate(date) ? date : null;
  }

  const parsed = new Date(text);
  return isValidDate(parsed) ? toUtcDateOnly(parsed) : null;
}

function parseDecimalValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : text.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRawPayload(row: RawRow) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]));
}

function toUtcDateOnly(value: Date) {
  return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
}

function isValidDate(value: Date) {
  return !Number.isNaN(value.getTime());
}
