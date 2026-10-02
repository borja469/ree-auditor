export function resolvePeriodTariff(tariff: string) {
  if (tariff === "2.0TD" || tariff === "3.0TD") return tariff;
  return "6.1TD";
}
