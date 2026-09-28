import type { PricingSettlementVersion } from "./pricing-base.types";
import { SETTLEMENT_CODES, isSettlementCode } from "../common/settlements";

export const PRICING_VERSION_PRIORITY: PricingSettlementVersion[] = [...SETTLEMENT_CODES].reverse() as PricingSettlementVersion[];

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
