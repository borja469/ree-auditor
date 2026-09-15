import { Body, Controller, Get, Headers, Param, Post, Put, Query } from "@nestjs/common";
import { defaultGasMibgasQuery, GasMibgasManualPriceInput, GasMibgasService } from "./gas-mibgas.service";

@Controller("gas/mibgas")
export class GasMibgasController {
  constructor(private readonly service: GasMibgasService) {}

  @Get("prices")
  prices(@Query() query: Record<string, unknown>) {
    return this.service.list(defaultGasMibgasQuery(query));
  }

  @Get("products")
  products() {
    return this.service.products();
  }

  @Get("manual-prices")
  manualPrices(@Query() query: Record<string, unknown>) {
    return this.service.listManualPrices({
      deliveryFrom: typeof query.deliveryFrom === "string" ? query.deliveryFrom : undefined,
      deliveryTo: typeof query.deliveryTo === "string" ? query.deliveryTo : undefined,
      product: Array.isArray(query.product) ? query.product.map(String) : typeof query.product === "string" ? [query.product] : undefined,
      placeOfDelivery: Array.isArray(query.placeOfDelivery) ? query.placeOfDelivery.map(String) : typeof query.placeOfDelivery === "string" ? [query.placeOfDelivery] : undefined,
      area: Array.isArray(query.area) ? query.area.map(String) : typeof query.area === "string" ? [query.area] : undefined,
      skip: Number(query.skip),
      take: Number(query.take)
    });
  }

  @Post("manual-prices")
  saveManualPrice(@Body() body: GasMibgasManualPriceInput, @Headers("x-user") usuario?: string) {
    return this.service.saveManualPrice(body, usuario);
  }

  @Get("history")
  history(@Query() query: Record<string, string | undefined>) {
    return this.service.history({
      product: query.product ?? "",
      placeOfDelivery: query.placeOfDelivery,
      area: query.area,
      firstDayDelivery: query.firstDayDelivery,
      lastDayDelivery: query.lastDayDelivery
    });
  }

  @Get("status")
  status() {
    return this.service.status();
  }

  @Get("sync-runs")
  syncRuns(@Query() query: Record<string, unknown>) {
    return this.service.listSyncRuns({ skip: Number(query.skip), take: Number(query.take) });
  }

  @Get("automation")
  automation() {
    return this.service.getAutomationConfig();
  }

  @Put("automation")
  saveAutomation(@Body() body: { active?: boolean; scheduleTime?: string; syncCurrentYear?: boolean }) {
    return this.service.saveAutomationConfig(body);
  }

  @Post("sync")
  sync(@Body() body: { year?: number }) {
    return this.service.syncYear(Number(body.year ?? new Date().getUTCFullYear()), "MANUAL");
  }

  @Post("sync-history")
  syncHistory(@Body() body: { fromYear?: number; toYear?: number }) {
    return this.service.syncHistory(Number(body.fromYear), Number(body.toYear));
  }

  @Post("automation/run")
  runAutomation() {
    return this.service.executeAutomation();
  }

  @Get("validate-natural-key/:year")
  validateNaturalKey(@Param("year") year: string) {
    return this.service.validateDownloadNaturalKey(Number(year));
  }
}
