import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";

export type OmieReerConsumParsedRow = {
  fecha: Date;
  periodo: number;
  periodoEtiqueta: string;
  precioPublicadoEurMwh: Prisma.Decimal;
  volumenEconomicoEur: Prisma.Decimal;
  energiaNacionalMwh: Prisma.Decimal;
  coeficienteDerivadoEurMwh: Prisma.Decimal;
};

export type OmieReerConsumParsedFile = {
  fechaPublicacion: Date | null;
  rows: OmieReerConsumParsedRow[];
};

export type OmieReerOfficialParsedRow = {
  fecha: Date;
  periodo: number;
  version: number;
  ecreerMwh: Prisma.Decimal;
  epreerEurMwh: Prisma.Decimal;
  eopreerEur: Prisma.Decimal;
  sImp: number | null;
  sEne: number | null;
  seg: string | null;
  cta: string | null;
  cMag: string | null;
  cPrc: string | null;
  cCpto: string | null;
  ses: string | null;
};

const REER_CONSUM_HEADERS = {
  fecha: "fecha",
  periodo: "periodo",
  precio: "precioeurmwh",
  volumen: "volumeneconomicoeur",
  energia: "energiamwh"
};

export function buildOmieReerConsumFileName(fecha: Date, extension = "TXT") {
  const label = formatOmiePublicDateLabel(fecha);
  return `INT_REER_CONSUM_EV_H_${label}_${label}.${extension.toUpperCase()}`;
}

export function buildOmieReerConsumUrl(fecha: Date, extension = "TXT") {
  const year = String(fecha.getUTCFullYear());
  const month = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  return `https://www.omie.es/sites/default/files/dados/AGNO_${year}/MES_${month}/${extension.toUpperCase() === "XLS" ? "XLV" : "TXT"}/${buildOmieReerConsumFileName(fecha, extension)}`;
}

export function parseOmieReerConsumText(content: string): OmieReerConsumParsedFile {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const fechaPublicacion = parseFechaPublicacion(lines[0] ?? "");
  const headerIndex = lines.findIndex((line) => normalizeHeaderLine(line).includes("fecha;periodo;precioeurmwh;volumeneconomicoeur;energiamwh"));
  if (headerIndex < 0) {
    throw new Error("No se ha encontrado la cabecera esperada del fichero REER publico.");
  }

  return {
    fechaPublicacion,
    rows: parseReerConsumRows(lines.slice(headerIndex + 1).map((line) => line.split(";")))
  };
}

export function parseOmieReerConsumXls(buffer: Buffer): OmieReerConsumParsedFile {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("El XLS REER no contiene hojas.");
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: false, blankrows: false });
  const fechaPublicacion = parseFechaPublicacion(String(rows[0]?.join(";") ?? ""));
  const headerIndex = rows.findIndex((row) => normalizeHeaderLine(row.map((cell) => String(cell ?? "")).join(";")).includes("fecha;periodo;precioeurmwh;volumeneconomicoeur;energiamwh"));
  if (headerIndex < 0) {
    throw new Error("No se ha encontrado la cabecera esperada del XLS REER.");
  }
  return {
    fechaPublicacion,
    rows: parseReerConsumRows(rows.slice(headerIndex + 1).map((row) => row.map((cell) => String(cell ?? ""))))
  };
}

export function parseOmieReerOfficialXml(content: string, fallbackFileName: string): OmieReerOfficialParsedRow[] {
  const fecha = parseOfficialFecha(content) ?? parseOfficialFechaFromName(fallbackFileName);
  if (!fecha) {
    throw new Error("No se ha podido determinar la fecha del XML 9230.");
  }
  const version = parseOfficialVersion(fallbackFileName) ?? 1;
  const rows: OmieReerOfficialParsedRow[] = [];
  for (const match of content.matchAll(/<Val>([\s\S]*?)<\/Val>/g)) {
    const attrs = parseValBlock(match[1]);
    if (attrs.CCpto !== "EOPREER" && attrs.CPrc !== "EPREER" && attrs.CMag !== "ECREER") {
      continue;
    }
    const periodo = parseInteger(attrs.Per);
    if (!periodo) {
      continue;
    }
    rows.push({
      fecha,
      periodo,
      version,
      ecreerMwh: decimalFromXml(attrs.Ene ?? "0"),
      epreerEurMwh: decimalFromXml(attrs.Prc ?? "0"),
      eopreerEur: decimalFromXml(attrs.Imp ?? "0"),
      sImp: parseInteger(attrs.SImp),
      sEne: parseInteger(attrs.SEne),
      seg: attrs.Seg ?? null,
      cta: attrs.Cta ?? null,
      cMag: attrs.CMag ?? null,
      cPrc: attrs.CPrc ?? null,
      cCpto: attrs.CCpto ?? null,
      ses: attrs.Ses ?? null
    });
  }
  return rows;
}

function parseReerConsumRows(rows: string[][]): OmieReerConsumParsedRow[] {
  const parsed: OmieReerConsumParsedRow[] = [];
  for (const columns of rows) {
    const first = (columns[0] ?? "").trim();
    if (!first || !/^\d{2}\/\d{2}\/\d{4}$/.test(first)) {
      continue;
    }
    const periodoEtiqueta = (columns[1] ?? "").trim().toUpperCase();
    const periodo = parsePeriodoEtiqueta(periodoEtiqueta);
    if (!periodo) {
      continue;
    }
    const fecha = parseSpanishDate(first);
    const precioPublicadoEurMwh = decimalFromSpanish(columns[2] ?? "0");
    const volumenEconomicoEur = decimalFromSpanish(columns[3] ?? "0");
    const energiaNacionalMwh = decimalFromSpanish(columns[4] ?? "0");
    const coeficienteDerivadoEurMwh = energiaNacionalMwh.isZero()
      ? new Prisma.Decimal(0)
      : volumenEconomicoEur.abs().div(energiaNacionalMwh);

    parsed.push({
      fecha,
      periodo,
      periodoEtiqueta,
      precioPublicadoEurMwh,
      volumenEconomicoEur,
      energiaNacionalMwh,
      coeficienteDerivadoEurMwh
    });
  }
  return parsed;
}

function parsePeriodoEtiqueta(value: string) {
  const quarter = /^H(\d{2})Q([1-4])$/.exec(value);
  if (quarter) {
    const hour = Number(quarter[1]);
    const q = Number(quarter[2]);
    return hour >= 1 && hour <= 25 ? (hour - 1) * 4 + q : null;
  }
  const hourly = /^H?(\d{1,2})$/.exec(value);
  if (hourly) {
    const hour = Number(hourly[1]);
    return hour >= 1 && hour <= 25 ? hour : null;
  }
  return null;
}

function parseFechaPublicacion(value: string) {
  const match = /Fecha Emisi[oó]n\s*:?\s*(\d{2}\/\d{2}\/\d{4})(?:\s*-\s*(\d{2}):(\d{2}))?/i.exec(value);
  if (!match) {
    return null;
  }
  const date = parseSpanishDate(match[1]);
  date.setUTCHours(Number(match[2] ?? 0), Number(match[3] ?? 0), 0, 0);
  return date;
}

function normalizeHeaderLine(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[()/]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function formatOmiePublicDateLabel(fecha: Date) {
  return `${String(fecha.getUTCDate()).padStart(2, "0")}_${String(fecha.getUTCMonth() + 1).padStart(2, "0")}_${fecha.getUTCFullYear()}`;
}

function parseSpanishDate(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) {
    throw new Error(`Fecha no valida: ${value}`);
  }
  return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
}

function decimalFromSpanish(value: string) {
  const normalized = String(value).trim().replace(/\./g, "").replace(",", ".");
  return new Prisma.Decimal(normalized || "0");
}

function decimalFromXml(value: string) {
  return new Prisma.Decimal(String(value).trim().replace(",", ".") || "0");
}

function parseValBlock(value: string) {
  const attrs: Record<string, string> = {};
  for (const match of value.matchAll(/<(\w+)\s+v="([^"]*)"\s*\/>/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function parseOfficialFecha(content: string) {
  const match = /<Sesion\s+fecha="(\d{4})-(\d{2})-(\d{2})"/.exec(content);
  if (!match) {
    return null;
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function parseOfficialFechaFromName(fileName: string) {
  const match = /(\d{4})(\d{2})(\d{2})/.exec(fileName);
  if (!match) {
    return null;
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function parseOfficialVersion(fileName: string) {
  const match = /\.(\d+)\.xml$/i.exec(fileName);
  return match ? Number(match[1]) : null;
}

function parseInteger(value: string | undefined) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
