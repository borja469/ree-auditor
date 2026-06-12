export const PENINSULAR_SYSTEM = "PENINSULAR";
export const SUPPORTED_TARIFFS = ["2.0TD", "3.0TD", "6.1TD", "6.2TD", "6.3TD", "6.4TD"] as const;
export type SupportedTariff = (typeof SUPPORTED_TARIFFS)[number];

export type PeriodRule = {
  tarifa: string;
  temporada: string;
  tipoDia: string;
  hora: number;
  cuartohora: number;
  periodo: string;
  mes: number;
  sistema: string;
};

export type TariffPeriodSeedRow = PeriodRule;

const SIX_PERIOD_SEASONS: Record<number, "alta" | "media-alta" | "media" | "baja"> = {
  1: "alta",
  2: "alta",
  3: "media-alta",
  4: "baja",
  5: "baja",
  6: "media",
  7: "alta",
  8: "media",
  9: "media",
  10: "baja",
  11: "media-alta",
  12: "alta"
};

const NATIONAL_HOLIDAYS = [
  { fecha: "2024-01-01", descripcion: "Ano Nuevo" },
  { fecha: "2024-01-06", descripcion: "Epifania del Senor" },
  { fecha: "2024-03-29", descripcion: "Viernes Santo" },
  { fecha: "2024-05-01", descripcion: "Fiesta del Trabajo" },
  { fecha: "2024-08-15", descripcion: "Asuncion de la Virgen" },
  { fecha: "2024-10-12", descripcion: "Fiesta Nacional de Espana" },
  { fecha: "2024-11-01", descripcion: "Todos los Santos" },
  { fecha: "2024-12-06", descripcion: "Dia de la Constitucion" },
  { fecha: "2024-12-08", descripcion: "Inmaculada Concepcion" },
  { fecha: "2024-12-25", descripcion: "Natividad del Senor" },
  { fecha: "2025-01-01", descripcion: "Ano Nuevo" },
  { fecha: "2025-01-06", descripcion: "Epifania del Senor" },
  { fecha: "2025-04-18", descripcion: "Viernes Santo" },
  { fecha: "2025-05-01", descripcion: "Fiesta del Trabajo" },
  { fecha: "2025-08-15", descripcion: "Asuncion de la Virgen" },
  { fecha: "2025-10-12", descripcion: "Fiesta Nacional de Espana" },
  { fecha: "2025-11-01", descripcion: "Todos los Santos" },
  { fecha: "2025-12-06", descripcion: "Dia de la Constitucion" },
  { fecha: "2025-12-08", descripcion: "Inmaculada Concepcion" },
  { fecha: "2025-12-25", descripcion: "Natividad del Senor" },
  { fecha: "2026-01-01", descripcion: "Ano Nuevo" },
  { fecha: "2026-01-06", descripcion: "Epifania del Senor" },
  { fecha: "2026-04-03", descripcion: "Viernes Santo" },
  { fecha: "2026-05-01", descripcion: "Fiesta del Trabajo" },
  { fecha: "2026-08-15", descripcion: "Asuncion de la Virgen" },
  { fecha: "2026-10-12", descripcion: "Fiesta Nacional de Espana" },
  { fecha: "2026-11-01", descripcion: "Todos los Santos" },
  { fecha: "2026-12-06", descripcion: "Dia de la Constitucion" },
  { fecha: "2026-12-08", descripcion: "Inmaculada Concepcion" },
  { fecha: "2026-12-25", descripcion: "Natividad del Senor" }
] as const;

export function buildTariffPeriodSeedRows(): TariffPeriodSeedRow[] {
  const rows: TariffPeriodSeedRow[] = [];

  for (const tarifa of SUPPORTED_TARIFFS) {
    for (let mes = 1; mes <= 12; mes += 1) {
      for (let hora = 1; hora <= 24; hora += 1) {
        for (let cuartohora = 1; cuartohora <= 4; cuartohora += 1) {
          if (tarifa === "2.0TD") {
            rows.push({
              tarifa,
              temporada: "todo",
              tipoDia: "LABORABLE",
              hora,
              cuartohora,
              periodo: resolveTwoPeriodWorkingDay(hora),
              mes,
              sistema: PENINSULAR_SYSTEM
            });
            rows.push({
              tarifa,
              temporada: "todo",
              tipoDia: "FESTIVO",
              hora,
              cuartohora,
              periodo: "P3",
              mes,
              sistema: PENINSULAR_SYSTEM
            });
            continue;
          }

          const temporada = SIX_PERIOD_SEASONS[mes];
          rows.push({
            tarifa,
            temporada,
            tipoDia: "LABORABLE",
            hora,
            cuartohora,
            periodo: resolveSixPeriodWorkingDay(temporada, hora),
            mes,
            sistema: PENINSULAR_SYSTEM
          });
          rows.push({
            tarifa,
            temporada,
            tipoDia: "FESTIVO",
            hora,
            cuartohora,
            periodo: "P6",
            mes,
            sistema: PENINSULAR_SYSTEM
          });
        }
      }
    }
  }

  return rows;
}

export function buildNationalHolidaySeedRows() {
  return NATIONAL_HOLIDAYS.map((holiday) => ({
    fecha: parseIsoDate(holiday.fecha),
    descripcion: holiday.descripcion,
    ambito: "NACIONAL"
  }));
}

export function buildPeriodRuleMap(rules: PeriodRule[]) {
  return new Map(rules.map((rule) => [periodRuleKey(rule.tarifa, rule.mes, rule.tipoDia, rule.hora, rule.cuartohora), rule]));
}

export function buildHolidaySet(holidays: Array<{ fecha: Date; ambito: string }>) {
  return new Set(holidays.filter((holiday) => holiday.ambito.toUpperCase() === "NACIONAL").map((holiday) => toIsoDate(holiday.fecha)));
}

export function resolveTariffPeriod({
  tarifa,
  fecha,
  hora,
  cuartohora,
  rules,
  holidays
}: {
  tarifa: string;
  fecha: Date;
  hora: number;
  cuartohora: number;
  rules: Map<string, PeriodRule>;
  holidays: Set<string>;
}) {
  const tipoDia = isWeekend(fecha) || holidays.has(toIsoDate(fecha)) ? "FESTIVO" : "LABORABLE";
  const key = periodRuleKey(tarifa, fecha.getUTCMonth() + 1, tipoDia, normalizeHourForRule(hora), cuartohora);
  return rules.get(key);
}

export function expectedQuarterHourCount(fecha: Date) {
  if (isSpringDstDate(fecha)) {
    return 92;
  }
  if (isAutumnDstDate(fecha)) {
    return 100;
  }
  return 96;
}

export function isNonexistentQuarterHour(fecha: Date, hora: number) {
  return isSpringDstDate(fecha) && hora === 3;
}

export function isDuplicatedDstHour(fecha: Date, hora: number) {
  return isAutumnDstDate(fecha) && hora === 3;
}

export function normalizeTarifa(value?: string | null) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toUpperCase().replace(/\s+/g, "").replace(/^T/, "");
  return SUPPORTED_TARIFFS.includes(normalized as SupportedTariff) ? normalized : undefined;
}

export function normalizePeriodo(value?: string | null) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  return /^[1-6]$/.test(normalized) ? `P${normalized}` : normalized;
}

export function eachDate(start: Date, endExclusive: Date) {
  const dates: Date[] = [];
  for (let cursor = new Date(start); cursor < endExclusive; cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1))) {
    dates.push(cursor);
  }
  return dates;
}

export function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function periodRuleKey(tarifa: string, mes: number, tipoDia: string, hora: number, cuartohora: number) {
  return [tarifa, mes, tipoDia, hora, cuartohora, PENINSULAR_SYSTEM].join("|");
}

function resolveTwoPeriodWorkingDay(hora: number) {
  if (hora >= 1 && hora <= 8) {
    return "P3";
  }
  if ((hora >= 11 && hora <= 14) || (hora >= 19 && hora <= 22)) {
    return "P1";
  }
  return "P2";
}

function resolveSixPeriodWorkingDay(temporada: "alta" | "media-alta" | "media" | "baja", hora: number) {
  if (hora >= 1 && hora <= 8) {
    return "P6";
  }

  const peak = (hora >= 11 && hora <= 15) || (hora >= 19 && hora <= 22);
  if (temporada === "alta") {
    return peak ? "P1" : "P2";
  }
  if (temporada === "media-alta") {
    return peak ? "P2" : "P3";
  }
  if (temporada === "media") {
    return peak ? "P3" : "P4";
  }
  return peak ? "P4" : "P5";
}

function normalizeHourForRule(hora: number) {
  return hora === 25 ? 24 : hora;
}

function isWeekend(fecha: Date) {
  const day = fecha.getUTCDay();
  return day === 0 || day === 6;
}

function isSpringDstDate(fecha: Date) {
  return fecha.getUTCMonth() === 2 && fecha.getUTCDate() === lastSunday(fecha.getUTCFullYear(), 2);
}

function isAutumnDstDate(fecha: Date) {
  return fecha.getUTCMonth() === 9 && fecha.getUTCDate() === lastSunday(fecha.getUTCFullYear(), 9);
}

function lastSunday(year: number, zeroBasedMonth: number) {
  const cursor = new Date(Date.UTC(year, zeroBasedMonth + 1, 0));
  return cursor.getUTCDate() - cursor.getUTCDay();
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}
