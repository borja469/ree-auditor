import { BadRequestException, Body, Controller, Get, Header, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { defaultPricingBaseQuery, PricingBaseTableService } from "./pricing_base_table_service";
import { PricingCalculatorManualValuesService } from "./pricing_calculator_manual_values_service";
import { PricingBaseExportService } from "./table_view_export_service";

@Controller("pricing-base")
export class PricingBaseController {
  constructor(
    private readonly tableService: PricingBaseTableService,
    private readonly calculatorManualValuesService: PricingCalculatorManualValuesService,
    private readonly exportService: PricingBaseExportService
  ) {}

  @Get("table")
  getTable(@Query() query: Record<string, unknown>) {
    return this.tableService.buildTable(defaultPricingBaseQuery(query));
  }

  @Get("calculator/manual-values")
  getCalculatorManualValues() {
    return this.calculatorManualValuesService.list();
  }

  @Post("calculator/manual-values")
  saveCalculatorManualValue(@Body() body: unknown) {
    return this.calculatorManualValuesService.save(parseManualValueBody(body));
  }

  @Get("export.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  async exportCsv(@Query() query: Record<string, unknown>) {
    const response = await this.tableService.buildTable(defaultPricingBaseQuery({ ...query, skip: 0, take: 10000 }));
    return this.exportService.toCsv(response.rows);
  }

  @Get("export.xls")
  @Header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  async exportXls(@Query() query: Record<string, unknown>, @Res() response: Response) {
    const tableResponse = await this.tableService.buildTable(defaultPricingBaseQuery({ ...query, skip: 0, take: 10000 }));
    const manualValues = await this.calculatorManualValuesService.list();
    const workbook = this.exportService.toExcelWorkbook(tableResponse, manualValues);
    response.setHeader("Content-Disposition", 'attachment; filename="pricing-base.xlsx"');
    response.setHeader("Content-Length", String(workbook.length));
    return response.status(200).send(workbook);
  }
}

function parseManualValueBody(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new BadRequestException("El cuerpo de la peticion no es valido.");
  }
  const payload = body as { concepto?: unknown; tarifa?: unknown; periodo?: unknown; valor?: unknown };
  return {
    concepto: parseRequiredText(payload.concepto, "concepto", 80),
    tarifa: parseRequiredText(payload.tarifa, "tarifa", 40),
    periodo: parseRequiredText(payload.periodo, "periodo", 10),
    valor: parseNullableNumber(payload.valor, "valor")
  };
}

function parseRequiredText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) {
    throw new BadRequestException(`El campo ${field} no es valido.`);
  }
  return value.trim();
}

function parseNullableNumber(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BadRequestException(`El campo ${field} debe ser numerico o null.`);
  }
  return value;
}
