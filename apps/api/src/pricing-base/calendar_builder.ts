import type { PricingCalendarHour } from "./pricing-base.types";

const TIME_ZONE = "Europe/Madrid";
const DAY_NAMES = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"] as const;

const localFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  weekday: "short"
});

export function buildPricingCalendar(fechaReferencia: string, incluirFechaReferencia: boolean): PricingCalendarHour[] {
  const endDate = addLocalDays(parseDateOnly(fechaReferencia), incluirFechaReferencia ? 0 : -1);
  const startDate = addLocalDays(endDate, -364);
  return buildPricingCalendarRange(formatDateOnly(startDate), formatDateOnly(endDate));
}

export function buildPricingCalendarRange(fechaInicio: string, fechaFin: string): PricingCalendarHour[] {
  const startDate = parseDateOnly(fechaInicio);
  const endDate = parseDateOnly(fechaFin);
  const dates = enumerateDateStrings(startDate, endDate);
  const dateSet = new Set(dates);
  const rows: PricingCalendarHour[] = [];
  const utcScanStart = Date.UTC(startDate.year, startDate.month - 1, startDate.day) - 48 * 60 * 60 * 1000;
  const utcScanEnd = Date.UTC(endDate.year, endDate.month - 1, endDate.day) + 72 * 60 * 60 * 1000;
  const hoursByDate = new Map<string, number>();

  for (let instant = utcScanStart; instant < utcScanEnd; instant += 60 * 60 * 1000) {
    const start = new Date(instant);
    const local = getMadridParts(start);
    if (!dateSet.has(local.date)) {
      continue;
    }
    hoursByDate.set(local.date, (hoursByDate.get(local.date) ?? 0) + 1);
    rows.push({
      fecha: local.date,
      ano: local.year,
      mes: local.month,
      dia: local.day,
      diaSemana: madridWeekday(start),
      diaSemanaNombre: DAY_NAMES[madridWeekday(start)],
      hora: local.hour,
      timestampInicio: start.toISOString(),
      timestampFin: new Date(instant + 60 * 60 * 1000).toISOString(),
      cambioHorarioDst: "none",
      ordenDia365: dates.indexOf(local.date) + 1,
      ordenHora: 0
    });
  }

  const hourOrderByDate = new Map<string, number>();
  return rows
    .sort((left, right) => left.timestampInicio.localeCompare(right.timestampInicio))
    .map((row) => {
      const order = (hourOrderByDate.get(row.fecha) ?? 0) + 1;
      hourOrderByDate.set(row.fecha, order);
      const hours = hoursByDate.get(row.fecha) ?? 24;
      return {
        ...row,
        cambioHorarioDst: hours === 23 ? "spring_forward_23h" : hours === 25 ? "fall_back_25h" : "none",
        ordenHora: order
      };
    });
}

export function expectedMadridHours(fechaInicio: string, fechaFin: string) {
  return buildPricingCalendar(fechaFin, true).filter((row) => row.fecha >= fechaInicio && row.fecha <= fechaFin).length;
}

export function parseDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new Error("La fecha debe tener formato YYYY-MM-DD.");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("Fecha no valida.");
  }
  return { year, month, day };
}

export function addLocalDays(date: { year: number; month: number; day: number }, days: number) {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day));
  next.setUTCDate(next.getUTCDate() + days);
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

export function formatDateOnly(date: { year: number; month: number; day: number }) {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

export function enumerateDateStrings(start: { year: number; month: number; day: number }, end: { year: number; month: number; day: number }) {
  const output: string[] = [];
  const cursor = new Date(Date.UTC(start.year, start.month - 1, start.day));
  const endTime = Date.UTC(end.year, end.month - 1, end.day);
  while (cursor.getTime() <= endTime) {
    output.push(formatDateOnly({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1, day: cursor.getUTCDate() }));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return output;
}

export function getMadridParts(date: Date) {
  const parts = localFormatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "0";
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour: Number(read("hour"))
  };
}

function madridWeekday(date: Date) {
  const value = weekdayFormatter.format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
