import { BadRequestException, Body, Controller, Get, Put, Query, Res } from "@nestjs/common";
import { Response } from "express";
import { parseReferenceDate } from "./dto/get-guarantee-calculation.dto";
import { OmieGuaranteesService } from "./omie-guarantees.service";

@Controller("omie/guarantees")
export class OmieGuaranteesController {
  constructor(private readonly service: OmieGuaranteesService) {}

  @Get("calculator")
  calculator(@Query("referenceDate") referenceDate?: string) {
    return this.service.calculate(parseReferenceDate(referenceDate));
  }

  @Get("calculator/export")
  async export(@Query("referenceDate") referenceDate: string | undefined, @Res({ passthrough: true }) response: Response) {
    const file = await this.service.export(parseReferenceDate(referenceDate));
    response.setHeader("Content-Type", file.contentType);
    response.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
    return file.content;
  }

  @Put("deposited")
  saveDeposited(@Body() body: unknown) {
    return this.service.saveDepositedGuarantee(parseDepositedBody(body));
  }

  @Put("prepaid")
  savePrepaid(@Body() body: unknown) {
    return this.service.savePrepaidPayment(parseDepositedBody(body));
  }
}

function parseDepositedBody(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new BadRequestException("El cuerpo de la peticion no es valido.");
  }
  const payload = body as { date?: unknown; amount?: unknown };
  if (typeof payload.date !== "string") {
    throw new BadRequestException("date debe tener formato YYYY-MM-DD.");
  }
  const date = parseReferenceDate(payload.date);
  if (payload.amount === null || payload.amount === undefined || payload.amount === "") {
    return { date, amount: null };
  }
  if (typeof payload.amount !== "number" || !Number.isFinite(payload.amount) || payload.amount < 0) {
    throw new BadRequestException("amount debe ser numerico y mayor o igual que cero.");
  }
  return {
    date,
    amount: Math.round((payload.amount + Number.EPSILON) * 100) / 100
  };
}
