import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { PricingHedgesService } from "./pricing-hedges.service";
import type { PricingHedgeOperationInput, PricingHedgeProductFilters } from "./pricing-hedges.types";

@Controller("pricing/hedges")
export class PricingHedgesController {
  constructor(private readonly service: PricingHedgesService) {}

  @Get()
  overview() {
    return this.service.overview();
  }

  @Get("products")
  products(@Query() query: PricingHedgeProductFilters) {
    return this.service.products(query);
  }

  @Post("operations")
  create(@Body() body: PricingHedgeOperationInput) {
    return this.service.create(body);
  }

  @Put("operations/:id")
  update(@Param("id") id: string, @Body() body: PricingHedgeOperationInput) {
    return this.service.update(id, body);
  }

  @Delete("operations/:id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
