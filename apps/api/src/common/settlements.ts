export type SettlementType = "A" | "C";
export type SettlementNumber = 1 | 2 | 3 | 4 | 5;
export type SettlementCode = "A1" | "C1" | "A2" | "C2" | "A3" | "C3" | "A4" | "C4" | "A5" | "C5";

export type SettlementIdentity = {
  settlementType: SettlementType;
  settlementNumber: SettlementNumber;
  settlementCode: SettlementCode;
};

export const SETTLEMENT_CODES: SettlementCode[] = ["A1", "C1", "A2", "C2", "A3", "C3", "A4", "C4", "A5", "C5"];

const SETTLEMENT_CODE_PATTERN = /^([AC])([1-5])$/i;
const SETTLEMENT_CODE_SEARCH_PATTERN = /(?:^|[_\-\s.])([AC][1-5])(?:[_\-\s.]|$)/i;

export function parseSettlementCode(value: string): SettlementIdentity {
  const normalized = value.trim().toUpperCase();
  const match = SETTLEMENT_CODE_PATTERN.exec(normalized);
  if (!match) {
    throw new Error(`Codigo de liquidacion no valido: ${value}. Debe ser A1-A5 o C1-C5.`);
  }

  return {
    settlementType: match[1] as SettlementType,
    settlementNumber: Number(match[2]) as SettlementNumber,
    settlementCode: normalized as SettlementCode
  };
}

export function parseOptionalSettlementCode(value: string | null | undefined): SettlementIdentity | null {
  if (!value) {
    return null;
  }
  try {
    return parseSettlementCode(value);
  } catch {
    return null;
  }
}

export function findSettlementCode(value: string): SettlementIdentity | null {
  const match = SETTLEMENT_CODE_SEARCH_PATTERN.exec(value);
  return match ? parseSettlementCode(match[1]) : null;
}

export function buildSettlementCode(settlementType: SettlementType, settlementNumber: number): SettlementCode {
  if ((settlementType !== "A" && settlementType !== "C") || !Number.isInteger(settlementNumber) || settlementNumber < 1 || settlementNumber > 5) {
    throw new Error(`Liquidacion no valida: ${settlementType}${settlementNumber}. Debe ser A1-A5 o C1-C5.`);
  }
  return `${settlementType}${settlementNumber}` as SettlementCode;
}

export function settlementRank(value: string): number {
  const parsed = parseOptionalSettlementCode(value) ?? findSettlementCode(value);
  if (!parsed) {
    return -1;
  }
  return (parsed.settlementNumber - 1) * 2 + (parsed.settlementType === "C" ? 1 : 0);
}

export function compareSettlements(left: string, right: string): number {
  const leftRank = settlementRank(left);
  const rightRank = settlementRank(right);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  return left.localeCompare(right, "es", { numeric: true, sensitivity: "base" });
}

export function latestSettlementCode(values: string[]): SettlementCode | null {
  const parsed = values
    .map((value) => parseOptionalSettlementCode(value))
    .filter((value): value is SettlementIdentity => Boolean(value))
    .sort((left, right) => compareSettlements(left.settlementCode, right.settlementCode));
  return parsed.at(-1)?.settlementCode ?? null;
}

export function isSettlementCode(value: string | null | undefined): value is SettlementCode {
  return Boolean(value && parseOptionalSettlementCode(value));
}
