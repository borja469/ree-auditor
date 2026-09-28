import type { ReeSettlementType, ReeVersion } from "./api";

export type ReeSettlementDefinition = {
  code: ReeVersion;
  settlementCode: ReeVersion;
  settlementType: ReeSettlementType;
  settlementNumber: 1 | 2 | 3 | 4 | 5;
  label: "Avance" | "Cierre";
  rank: number;
};

export const REE_SETTLEMENTS: ReeSettlementDefinition[] = [
  { code: "A1", settlementCode: "A1", settlementType: "A", settlementNumber: 1, label: "Avance", rank: 0 },
  { code: "C1", settlementCode: "C1", settlementType: "C", settlementNumber: 1, label: "Cierre", rank: 1 },
  { code: "A2", settlementCode: "A2", settlementType: "A", settlementNumber: 2, label: "Avance", rank: 2 },
  { code: "C2", settlementCode: "C2", settlementType: "C", settlementNumber: 2, label: "Cierre", rank: 3 },
  { code: "A3", settlementCode: "A3", settlementType: "A", settlementNumber: 3, label: "Avance", rank: 4 },
  { code: "C3", settlementCode: "C3", settlementType: "C", settlementNumber: 3, label: "Cierre", rank: 5 },
  { code: "A4", settlementCode: "A4", settlementType: "A", settlementNumber: 4, label: "Avance", rank: 6 },
  { code: "C4", settlementCode: "C4", settlementType: "C", settlementNumber: 4, label: "Cierre", rank: 7 },
  { code: "A5", settlementCode: "A5", settlementType: "A", settlementNumber: 5, label: "Avance", rank: 8 },
  { code: "C5", settlementCode: "C5", settlementType: "C", settlementNumber: 5, label: "Cierre", rank: 9 }
];

export const REE_SETTLEMENT_CODES: ReeVersion[] = REE_SETTLEMENTS.map((settlement) => settlement.code);

const SETTLEMENT_BY_CODE = new Map<string, ReeSettlementDefinition>(REE_SETTLEMENTS.map((settlement) => [settlement.code, settlement]));

export function settlementDefinition(code: string | undefined | null) {
  return code ? SETTLEMENT_BY_CODE.get(code) : undefined;
}

export function settlementLabel(code: string): "Avance" | "Cierre" {
  return settlementDefinition(code)?.label ?? "Cierre";
}

export function settlementType(code: string): ReeSettlementType {
  return settlementDefinition(code)?.settlementType ?? "C";
}

export function settlementNumber(code: string) {
  return settlementDefinition(code)?.settlementNumber;
}

export function settlementRank(code: string) {
  return settlementDefinition(code)?.rank ?? Number.MAX_SAFE_INTEGER;
}

export function settlementQueryFields(code: string | undefined | null) {
  const settlement = settlementDefinition(code);
  return {
    version: settlement?.settlementCode,
    settlementType: settlement?.settlementType,
    settlementNumber: settlement?.settlementNumber
  };
}

export function sortSettlements<T extends string>(values: T[]) {
  return [...values].sort((left, right) => settlementRank(left) - settlementRank(right));
}
