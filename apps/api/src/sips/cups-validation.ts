export type CupsValidationCode = "CUPS_FORMATO_INVALIDO" | "CUPS_CONTROL_INVALIDO";
export type CupsValidation = { cups: string; valid: true } | { cups: string; valid: false; code: CupsValidationCode };

const CONTROL_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const CUPS_PATTERN = /^ES\d{16}[A-Z]{2}(?:\d[A-Z])?$/;

export function normalizeCups(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, "").toUpperCase() : "";
}

export function validateCups(value: unknown): CupsValidation {
  const cups = normalizeCups(value);
  if (!CUPS_PATTERN.test(cups)) return { cups, valid: false, code: "CUPS_FORMATO_INVALIDO" };
  const remainder = Number(BigInt(cups.slice(2, 18)) % 529n);
  const controls = CONTROL_LETTERS[Math.floor(remainder / 23)] + CONTROL_LETTERS[remainder % 23];
  if (cups.slice(18, 20) !== controls) return { cups, valid: false, code: "CUPS_CONTROL_INVALIDO" };
  return { cups, valid: true };
}
