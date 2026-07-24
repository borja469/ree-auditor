import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { parseMirContractQuery } from "./dto/mir-contract-query.dto";
import { PortfolioForecastService } from "./portfolio-forecast.service";
import { PortfolioSalePriceService } from "./portfolio-sale-price.service";

@Controller("pricing/portfolio")
export class PricingPortfolioController {
  constructor(
    private readonly forecastService: PortfolioForecastService,
    private readonly salePriceService: PortfolioSalePriceService
  ) {}

  @Post("forecast")
  recalculateForecast(@Body() body: unknown) {
    const referenceDate = body && typeof body === "object" && "referenceDate" in body ? String((body as { referenceDate?: unknown }).referenceDate ?? "") : "";
    const purchasePointingCoefficient = body && typeof body === "object" && "purchasePointingCoefficient" in body ? (body as { purchasePointingCoefficient?: unknown }).purchasePointingCoefficient : undefined;
    return this.forecastService.recalculatePortfolio(referenceDate, purchasePointingCoefficient);
  }

  @Get("forecast")
  listForecasts(@Query() query: Record<string, unknown>) {
    return this.forecastService.listForecasts(query);
  }

  @Get("forecast/monthly-summary")
  getMonthlySummary(@Query() query: Record<string, unknown>) {
    const referenceDate = typeof query.referenceDate === "string" ? query.referenceDate : "";
    return this.forecastService.getMonthlySummary(referenceDate, parseMirContractQuery(query));
  }

  @Get("sale-prices")
  getSalePrices(@Query() query: Record<string, unknown>) {
    return this.salePriceService.listPrices(query);
  }

  @Post("sale-prices")
  saveSalePrices(@Body() body: unknown) {
    return this.salePriceService.savePrices(body);
  }

  @Get(":contractId/monthly-consumption")
  getMonthlyConsumption(@Param("contractId") contractId: string, @Query("referenceDate") referenceDate?: string) {
    return this.forecastService.getMonthlyConsumption(contractId, referenceDate);
  }

  @Get(":contractId/monthly-valuation")
  getMonthlyValuation(@Param("contractId") contractId: string, @Query("referenceDate") referenceDate?: string) {
    return this.forecastService.getMonthlyValuation(contractId, referenceDate);
  }
}
