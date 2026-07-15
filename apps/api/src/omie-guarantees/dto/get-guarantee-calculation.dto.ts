import { BadRequestException } from "@nestjs/common";

export class GetGuaranteeCalculationDto {
  referenceDate?: string;
}

export function parseReferenceDate(value: string | undefined) {
  const referenceDate = value ?? localDateKey(new Date());
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(referenceDate);
  if (!match) {
    throw new BadRequestException("referenceDate debe tener formato YYYY-MM-DD.");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new BadRequestException("referenceDate no es una fecha valida.");
  }
  return referenceDate;
}

function localDateKey(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
