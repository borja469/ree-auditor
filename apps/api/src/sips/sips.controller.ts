import { Body, Controller, Get, Headers, Param, Post, Put, Query } from "@nestjs/common";
import { SipsService } from "./sips.service";

@Controller("sips")
export class SipsController {
  constructor(private readonly service: SipsService) {}

  @Get("capabilities") capabilities(@Headers("x-user") user: string) { return this.service.capabilities(user); }
  @Get("config") config(@Headers("x-user") user: string) { return this.service.config(user); }
  @Put("config") saveConfig(@Headers("x-user") user: string, @Body() body: { environment?: unknown; consumerKey?: unknown; consumerSecret?: unknown }) { return this.service.saveConfig(user, body); }
  @Post("config/test") testConfig(@Headers("x-user") user: string) { return this.service.testConnection(user); }
  @Get("history") history(@Query("page") page?: string) { return this.service.history(page); }
  @Get("validate/:cups") validateCups(@Param("cups") cups: string) { return this.service.validateCups(cups); }
  @Get(":cups") stored(@Param("cups") cups: string, @Headers("x-user") user: string) { return this.service.stored(cups, user); }
  @Post(":cups/consult") consult(@Param("cups") cups: string, @Headers("x-user") user: string) { return this.service.consult(cups, user); }
}
