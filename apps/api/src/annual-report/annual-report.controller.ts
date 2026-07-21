import { BadRequestException, Body, Controller, Get, Put, Query } from "@nestjs/common";
import { AnnualReportRetributionType } from "@prisma/client";
import { AnnualReportService } from "./annual-report.service";

@Controller("annual-report")
export class AnnualReportController {
  constructor(private readonly annualReportService: AnnualReportService) {}

  @Get()
  report(@Query("year") year?: string) {
    return this.annualReportService.report(parseYear(year));
  }

  @Get("years")
  years() {
    return this.annualReportService.availableYears();
  }

  @Put("retribution-price")
  saveRetributionPrice(@Body() body: unknown) {
    return this.annualReportService.saveRetributionPrice(parseRetributionPriceBody(body));
  }
}

function parseYear(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 2000 || parsed > 2100) {
    throw new BadRequestException("El parametro year debe ser un ano valido.");
  }
  return parsed;
}

function parseRetributionPriceBody(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new BadRequestException("Cuerpo de peticion no valido.");
  }
  const record = body as Record<string, unknown>;
  const year = Number(record.year);
  const month = Number(record.month);
  const type = String(record.type);
  const price = record.price === null || record.price === "" || record.price === undefined ? null : Number(record.price);
  if (!Number.isSafeInteger(year) || year < 2000 || year > 2100) {
    throw new BadRequestException("El parametro year debe ser un ano valido.");
  }
  if (!Number.isSafeInteger(month) || month < 1 || month > 12) {
    throw new BadRequestException("El parametro month debe ser un mes valido.");
  }
  if (type !== AnnualReportRetributionType.OS && type !== AnnualReportRetributionType.OM && type !== AnnualReportRetributionType.REMIT) {
    throw new BadRequestException("El tipo de retribucion debe ser OS, OM o REMIT.");
  }
  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    throw new BadRequestException("El precio debe ser un numero mayor o igual que cero.");
  }
  return { year, month, type, price };
}
