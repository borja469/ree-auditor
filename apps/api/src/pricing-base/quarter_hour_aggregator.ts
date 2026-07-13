import { getMadridParts } from "./calendar_builder";
import type { HourlyAverageRow, QuarterHourInput } from "./pricing-base.types";

export function quarter_hour_to_hourly_average(data: QuarterHourInput[], datetimeColumn: string, valueColumn: string): HourlyAverageRow[] {
  const groups = new Map<string, { fecha: string; hora: number; timestampInicio: string; values: number[] }>();
  for (const row of data) {
    const rawDatetime = row[datetimeColumn];
    const rawValue = row[valueColumn];
    const date = parseDateValue(rawDatetime);
    const value = parseNumberValue(rawValue);
    if (!date || value === null) {
      continue;
    }
    const parts = getMadridParts(date);
    const hourStart = new Date(date);
    hourStart.setUTCMinutes(0, 0, 0);
    const key = `${parts.date}|${parts.hour}|${hourStart.toISOString()}`;
    const group = groups.get(key) ?? { fecha: parts.date, hora: parts.hour, timestampInicio: hourStart.toISOString(), values: [] };
    group.values.push(value);
    groups.set(key, group);
  }

  return [...groups.values()]
    .sort((left, right) => left.timestampInicio.localeCompare(right.timestampInicio))
    .map((group) => {
      const numCuartos = group.values.length;
      const status = numCuartos >= 4 ? "ok" : numCuartos >= 3 ? "partial" : "missing";
      const valorPromedioHorario = numCuartos >= 3 ? group.values.reduce((sum, value) => sum + value, 0) / numCuartos : null;
      return { ...group, valorPromedioHorario, numCuartos, status };
    });
}

export function hourlyAverageFromValues(fecha: string, hora: number, timestampInicio: string, values: number[]): HourlyAverageRow {
  const numCuartos = values.length;
  const status = numCuartos >= 4 ? "ok" : numCuartos >= 3 ? "partial" : "missing";
  const valorPromedioHorario = numCuartos >= 3 ? values.reduce((sum, value) => sum + value, 0) / numCuartos : null;
  return { fecha, hora, timestampInicio, valorPromedioHorario, numCuartos, status };
}

function parseDateValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function parseNumberValue(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim().replace(/\./g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
