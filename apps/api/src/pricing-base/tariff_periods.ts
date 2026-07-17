import type { PricingCalendarHour, PricingPeriodTariff } from "./pricing-base.types";

const FIXED_NATIONAL_HOLIDAYS = new Set(["01-01", "01-06", "05-01", "08-15", "10-12", "11-01", "12-06", "12-08", "12-25"]);

export function periodo20TD(row: Pick<PricingCalendarHour, "fecha" | "mes" | "diaSemana" | "hora">) {
  if (isWeekendOrNationalHoliday(row)) {
    return "P3";
  }
  if ((row.hora >= 10 && row.hora < 14) || (row.hora >= 18 && row.hora < 22)) {
    return "P1";
  }
  if ((row.hora >= 8 && row.hora < 10) || (row.hora >= 14 && row.hora < 18) || (row.hora >= 22 && row.hora < 24)) {
    return "P2";
  }
  return "P3";
}

export function periodo30TD(row: Pick<PricingCalendarHour, "fecha" | "mes" | "diaSemana" | "hora">) {
  if (isWeekendOrNationalHoliday(row)) {
    return "P6";
  }
  if (row.hora < 8) {
    return "P6";
  }
  const dayType = monthType30(row.mes);
  if (dayType === "high") {
    return row.hora >= 18 && row.hora < 22 ? "P1" : row.hora >= 8 && row.hora < 24 ? "P2" : "P6";
  }
  if (dayType === "mid") {
    return row.hora >= 18 && row.hora < 22 ? "P3" : row.hora >= 8 && row.hora < 24 ? "P4" : "P6";
  }
  return row.hora >= 8 && row.hora < 24 ? "P5" : "P6";
}

export function periodo6XTD(row: Pick<PricingCalendarHour, "fecha" | "mes" | "diaSemana" | "hora">) {
  if (isWeekendOrNationalHoliday(row) || row.hora < 8) {
    return "P6";
  }
  const season = monthSeason6X(row.mes);
  if (row.hora >= 18 && row.hora < 22) {
    return season.peak;
  }
  if (row.hora >= 8 && row.hora < 24) {
    return season.shoulder;
  }
  return "P6";
}

export function pricingPeriodForTariff(tariff: PricingPeriodTariff, row: Pick<PricingCalendarHour, "fecha" | "mes" | "diaSemana" | "hora">) {
  if (tariff === "2.0TD") {
    return periodo20TD(row);
  }
  if (tariff === "3.0TD") {
    return periodo30TD(row);
  }
  return periodo6XTD(row);
}

export function isWeekendOrNationalHoliday(row: Pick<PricingCalendarHour, "fecha" | "diaSemana">) {
  return row.diaSemana === 0 || row.diaSemana === 6 || isNationalHoliday(row.fecha);
}

export function isNationalHoliday(fecha: string) {
  const monthDay = fecha.slice(5);
  if (FIXED_NATIONAL_HOLIDAYS.has(monthDay)) {
    return true;
  }
  const easter = easterSunday(Number(fecha.slice(0, 4)));
  const goodFriday = addUtcDays(easter, -2).toISOString().slice(0, 10);
  return fecha === goodFriday;
}

function monthType30(month: number) {
  if ([1, 2, 7, 12].includes(month)) {
    return "high";
  }
  if ([3, 6, 8, 11].includes(month)) {
    return "mid";
  }
  return "low";
}

function monthSeason6X(month: number): { peak: string; shoulder: string } {
  if ([1, 2, 7, 12].includes(month)) {
    return { peak: "P1", shoulder: "P2" };
  }
  if ([3, 11].includes(month)) {
    return { peak: "P2", shoulder: "P3" };
  }
  if ([6, 8, 9].includes(month)) {
    return { peak: "P3", shoulder: "P4" };
  }
  return { peak: "P4", shoulder: "P5" };
}

function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
