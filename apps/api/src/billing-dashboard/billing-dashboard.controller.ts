import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { BillingDashboardCostsService } from "./billing-dashboard-costs.service";
import { BillingDashboardRegulatedPricesService } from "./billing-dashboard-regulated-prices.service";
import { BillingDashboardService } from "./billing-dashboard.service";
import { GisceConfigInput } from "./gisce-client.service";

@Controller("billing-dashboard")
export class BillingDashboardController {
  constructor(
    private readonly service: BillingDashboardService,
    private readonly costs: BillingDashboardCostsService,
    private readonly regulatedPrices: BillingDashboardRegulatedPricesService
  ) {}

  @Get("gisce/invoice-fields")
  metadata() {
    return this.service.metadata();
  }

  @Get("gisce/diagnostic")
  diagnostic() {
    return this.service.diagnostic();
  }

  @Get("gisce/config")
  gisceConfig() {
    return this.service.gisceConfig();
  }

  @Post("gisce/test-connection")
  testGisceConnection() {
    return this.service.testGisceConnection();
  }

  @Put("gisce/config")
  saveGisceConfig(@Body() body: GisceConfigInput) {
    return this.service.saveGisceConfig(body);
  }

  @Get("invoices")
  listInvoices(@Query() query: Record<string, unknown>) {
    return this.service.listInvoices(query);
  }

  @Get("invoicing-modes")
  listInvoicingModes() {
    return this.service.listInvoicingModes();
  }

  @Get("tariffs")
  listTariffs() {
    return this.service.listTariffs();
  }

  @Get("operational-balance")
  operationalBalance(@Query() query: Record<string, unknown>) {
    return this.service.operationalBalance(typeof query.year === "string" ? query.year : undefined, query);
  }

  @Get("invoices/:id")
  invoiceDetail(@Param("id") id: string) {
    return this.service.invoiceDetail(id);
  }

  @Get("invoices/:id/curve")
  invoiceCurve(@Param("id") id: string, @Query() query: Record<string, unknown>) {
    return this.service.invoiceCurve(id, query);
  }

  @Post("invoices/:id/calculate-costs")
  calculateCosts(@Param("id") id: string) {
    return this.costs.calculateCosts(id);
  }

  @Post("invoices/:id/calculate-margin")
  calculateMargin(@Param("id") id: string, @Body() body: { mode?: "PENDING_ONLY" | "RECALCULATE" }) {
    return this.service.calculateInvoiceMargin(id, body.mode);
  }

  @Post("invoices/:id/calculate-costs-and-margin")
  calculateCostsAndMargin(@Param("id") id: string, @Body() body: { mode?: "PENDING_ONLY" | "RECALCULATE" }) {
    return this.service.calculateInvoiceCostsAndMargin(id, body.mode);
  }

  @Get("invoices/:id/costs")
  invoiceCosts(@Param("id") id: string, @Query() query: Record<string, unknown>) {
    return this.costs.getCosts(id, typeof query.runId === "string" ? query.runId : undefined);
  }

  @Get("invoices/:id/costs/intervals")
  invoiceCostIntervals(@Param("id") id: string, @Query() query: Record<string, unknown>) {
    return this.costs.listIntervals(id, query);
  }

  @Get("invoices/:id/costs/runs")
  invoiceCostRuns(@Param("id") id: string) {
    return this.costs.listRuns(id);
  }

  @Get("invoices/:id/costs/runs/:runId/export")
  async exportInvoiceCostRun(@Param("id") id: string, @Param("runId") runId: string, @Res() response: Response) {
    const workbook = await this.costs.exportCostsWorkbook(id, runId);
    response.setHeader("Content-Type", workbook.contentType);
    response.setHeader("Content-Disposition", `attachment; filename="${workbook.fileName}"`);
    response.setHeader("Content-Length", String(workbook.content.length));
    return response.status(200).send(workbook.content);
  }

  @Get("regulated-prices/versions")
  regulatedPriceVersions(@Query() query: Record<string, unknown>) {
    return this.regulatedPrices.listVersions(query);
  }

  @Post("regulated-prices/versions")
  createRegulatedPriceVersion(@Body() body: Record<string, unknown>) {
    return this.regulatedPrices.createVersion(body);
  }

  @Get("regulated-prices/versions/:id")
  regulatedPriceVersion(@Param("id") id: string) {
    return this.regulatedPrices.getVersion(id);
  }

  @Put("regulated-prices/versions/:id")
  updateRegulatedPriceVersion(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.regulatedPrices.updateVersion(id, body);
  }

  @Delete("regulated-prices/versions/:id")
  deleteRegulatedPriceVersion(@Param("id") id: string) {
    return this.regulatedPrices.deleteVersion(id);
  }

  @Get("imports")
  listImports(@Query() query: Record<string, unknown>) {
    return this.service.listImportBatches(query);
  }

  @Get("jobs")
  listJobs(@Query() query: Record<string, unknown>) {
    return this.service.listJobs(query);
  }

  @Post("jobs/imports")
  startImportJob(@Body() body: { dateFrom?: string; dateTo?: string }, @Headers("x-user") user?: string) {
    return this.service.startImportJob(String(body.dateFrom ?? ""), String(body.dateTo ?? ""), user);
  }

  @Post("jobs/process-pending")
  startProcessPendingJob(@Body() body: { limit?: number }, @Headers("x-user") user?: string) {
    return this.service.startProcessPendingJob(Number(body.limit ?? 5), user);
  }

  @Post("jobs/calculate-margins")
  startCalculateMarginsJob(@Body() body: { dateFrom?: string; dateTo?: string; mode?: "PENDING_ONLY" | "RECALCULATE" }, @Headers("x-user") user?: string) {
    return this.service.startCalculateMarginsJob(String(body.dateFrom ?? ""), String(body.dateTo ?? ""), body.mode, user);
  }

  @Post("jobs/full-recalculation")
  startFullRecalculationJob(@Body() body: { dateFrom?: string; dateTo?: string; mode?: "PENDING_ONLY" | "RECALCULATE" }, @Headers("x-user") user?: string) {
    return this.service.startFullRecalculationJob(String(body.dateFrom ?? ""), String(body.dateTo ?? ""), body.mode, user);
  }

  @Post("imports")
  importInvoices(@Body() body: { dateFrom?: string; dateTo?: string }) {
    return this.service.importInvoices(String(body.dateFrom ?? ""), String(body.dateTo ?? ""));
  }

  @Delete("invoices")
  deleteInvoicesByInvoiceDate(@Body() body: { dateFrom?: string; dateTo?: string }) {
    return this.service.deleteInvoicesByInvoiceDate(String(body.dateFrom ?? ""), String(body.dateTo ?? ""));
  }

  @Post("invoices/delete-range")
  deleteInvoicesByInvoiceDatePost(@Body() body: { dateFrom?: string; dateTo?: string }) {
    return this.service.deleteInvoicesByInvoiceDate(String(body.dateFrom ?? ""), String(body.dateTo ?? ""));
  }

  @Post("invoices/:id/process")
  processInvoice(@Param("id") id: string) {
    return this.service.processInvoice(id);
  }

  @Post("process-pending")
  processPending(@Body() body: { limit?: number }) {
    return this.service.processPending(Number(body.limit ?? 50));
  }
}
