import type { PricingSettlementVersion } from "./pricing-base.types";
import { SETTLEMENT_CODES, isSettlementCode } from "../common/settlements";

export const LIQUIDATION_MATURITY_ORDER: PricingSettlementVersion[] = [
  "A1",
  "C1",
  "A2",
  "C2",
  "A3",
  "C3",
  "A4",
  "C4",
  "A5",
  "C5"
];

export const PRICING_VERSION_PRIORITY: PricingSettlementVersion[] = [...LIQUIDATION_MATURITY_ORDER].reverse();

if (LIQUIDATION_MATURITY_ORDER.join("|") !== SETTLEMENT_CODES.join("|")) {
  throw new Error("El orden comun de liquidaciones no coincide con SETTLEMENT_CODES.");
}

export type VersionedValue<TValue> = {
  fecha: string;
  version: PricingSettlementVersion;
  value: TValue;
};

export function get_latest_available_version<TValue>(values: Array<VersionedValue<TValue>>, fecha: string) {
  const candidates = values.filter((item) => item.fecha === fecha);
  return selectLatestAvailableVersion(candidates);
}

export function selectLatestAvailableVersion<TValue>(values: Array<Pick<VersionedValue<TValue>, "version" | "value">>) {
  for (const version of PRICING_VERSION_PRIORITY) {
    const match = values.find((item) => item.version === version);
    if (match) {
      return { value: match.value, version };
    }
  }
  return { value: null, version: null };
}

export function isPricingSettlementVersion(value: unknown): value is PricingSettlementVersion {
  return typeof value === "string" && isSettlementCode(value);
}
