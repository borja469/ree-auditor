import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Query } from "@nestjs/common";
import { BillingDashboardService } from "./billing-dashboard.service";
import { GisceConfigInput } from "./gisce-client.service";

@Controller("billing-dashboard")
export class BillingDashboardController {
  constructor(private readonly service: BillingDashboardService) {}

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

  @Get("invoices/:id")
  invoiceDetail(@Param("id") id: string) {
    return this.service.invoiceDetail(id);
  }

  @Get("invoices/:id/curve")
  invoiceCurve(@Param("id") id: string, @Query() query: Record<string, unknown>) {
    return this.service.invoiceCurve(id, query);
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
