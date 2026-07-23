import { BadRequestException } from "@nestjs/common";
import type { MirContractQuery } from "../interfaces/mir-api.interfaces";

const DEFAULT_TAKE = 100;
const MAX_TAKE = 1000;

export function parseMirContractQuery(query: Record<string, unknown>): MirContractQuery {
  const skip = parseInteger(query.skip, "skip", 0);
  const take = Math.min(parseInteger(query.take, "take", DEFAULT_TAKE), MAX_TAKE);
  return {
    policy: parseText(query.policy ?? query.poliza),
    policies: parseTextList(query.policies ?? query.polizas),
    commercial: parseText(query.commercial ?? query.comercial),
    commercials: parseTextList(query.commercials ?? query.comerciales),
    tariff: parseText(query.tariff ?? query.tarifa),
    tariffs: parseTextList(query.tariffs ?? query.tarifas),
    priceList: parseText(query.priceList ?? query.listaPrecios),
    priceLists: parseTextList(query.priceLists ?? query.listasPrecios),
    contractEndDateFrom: parseDateText(query.contractEndDateFrom ?? query.fechaFinDesde),
    contractEndDateTo: parseDateText(query.contractEndDateTo ?? query.fechaFinHasta ?? query.fechaFin),
    minAnnualConsumption: parseNumber(query.minAnnualConsumption ?? query.consumoMinimo, "consumo minimo"),
    maxAnnualConsumption: parseNumber(query.maxAnnualConsumption ?? query.consumoMaximo, "consumo maximo"),
    referenceDate: parseDateText(query.referenceDate ?? query.fechaReferencia),
    skip,
    take
  };
}

function parseText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseTextList(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const values = value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? [...new Set(values)] : undefined;
}

function parseDateText(value: unknown) {
  const text = parseText(value);
  if (!text) {
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new BadRequestException("Las fechas deben tener formato YYYY-MM-DD.");
  }
  return text;
}

function parseNumber(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const number = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(number)) {
    throw new BadRequestException(`${label} debe ser numerico.`);
  }
  return number;
}

function parseInteger(value: unknown, label: string, fallback: number) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new BadRequestException(`${label} debe ser un entero positivo.`);
  }
  return number;
}
