import type { PricingCalendarHour } from "./pricing-base.types";
import { resolveTariffPeriod } from "../ree-losses/period-engine";
import type { PeriodContext } from "../ree-losses/ree-losses.types";

export type PricingRegulatoryPeriodContext = PeriodContext;

export function resolvePricingPeriod(
  tariff: "2.0TD" | "3.0TD" | "6.1TD",
  row: Pick<PricingCalendarHour, "fecha" | "hora">,
  periodContext: PricingRegulatoryPeriodContext
) {
  const regulatoryHour = pricingHourToRegulatoryHour(row.hora);
  if (regulatoryHour === null) {
    return "";
  }

  return (
    resolveTariffPeriod({
      tarifa: tariff,
      fecha: new Date(`${row.fecha}T00:00:00.000Z`),
      hora: regulatoryHour,
      cuartohora: 1,
      rules: periodContext.rules,
      holidays: periodContext.holidays
    })?.periodo ?? ""
  );
}

export function pricingHourToRegulatoryHour(hour: number) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return null;
  }
  return hour + 1;
}
