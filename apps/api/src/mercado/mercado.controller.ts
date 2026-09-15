import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { MercadoAnalyticsService } from "./mercado-analytics.service";
import { MercadoDatasetService } from "./mercado-dataset.service";
import { MercadoDatasetValidatorService } from "./mercado-dataset-validator.service";
import { MercadoIndicatorMappingService } from "./mercado-indicator-mapping.service";

@Controller("mercado")
export class MercadoController {
  constructor(
    private readonly mercadoAnalyticsService: MercadoAnalyticsService,
    private readonly mercadoDatasetService: MercadoDatasetService,
    private readonly mercadoDatasetValidatorService: MercadoDatasetValidatorService,
    private readonly mercadoIndicatorMappingService: MercadoIndicatorMappingService
  ) {}

  @Get("indicator-mapping")
  getIndicatorMapping() {
    return this.mercadoIndicatorMappingService.resolveMappings();
  }

  @Post("indicator-mapping/refresh")
  refreshIndicatorMapping() {
    this.mercadoIndicatorMappingService.invalidateCache();
    return this.mercadoIndicatorMappingService.resolveMappings();
  }

  @Post("indicator-mapping/confirm")
  confirmIndicatorMapping(@Body() body: { variable?: string; indicatorId?: unknown; geoId?: unknown; geoKey?: unknown }) {
    return this.mercadoIndicatorMappingService.confirmMapping(body);
  }

  @Get("dataset")
  getDataset(
    @Query("fechaDesde") fechaDesde?: string,
    @Query("fechaHasta") fechaHasta?: string,
    @Query("geoId") geoId?: string,
    @Query("take") take?: string
  ) {
    return this.mercadoDatasetService.buildHourlyDataset({
      fechaDesde,
      fechaHasta,
      geoId: parseOptionalInteger(geoId),
      take: parseOptionalInteger(take)
    });
  }

  @Get("analytics")
  getAnalytics(
    @Query("fechaDesde") fechaDesde?: string,
    @Query("fechaHasta") fechaHasta?: string,
    @Query("geoId") geoId?: string,
    @Query("lowerPercentile") lowerPercentile?: string,
    @Query("upperPercentile") upperPercentile?: string
  ) {
    return this.mercadoAnalyticsService.analyze({
      fechaDesde,
      fechaHasta,
      geoId: parseOptionalInteger(geoId),
      lowerPercentile: parseOptionalNumber(lowerPercentile),
      upperPercentile: parseOptionalNumber(upperPercentile)
    });
  }

  @Get("coverage-diagnostics")
  getCoverageDiagnostics(@Query("fechaDesde") fechaDesde?: string, @Query("fechaHasta") fechaHasta?: string, @Query("geoId") geoId?: string) {
    return this.mercadoDatasetService.diagnoseCoverage({
      fechaDesde,
      fechaHasta,
      geoId: parseOptionalInteger(geoId)
    });
  }

  @Get("dataset/validation")
  validateDataset(@Query("fechaDesde") fechaDesde?: string, @Query("fechaHasta") fechaHasta?: string, @Query("geoId") geoId?: string) {
    return this.mercadoDatasetValidatorService.validateDataset({
      fechaDesde,
      fechaHasta,
      geoId: parseOptionalInteger(geoId)
    });
  }
}

function parseOptionalInteger(value: string | undefined) {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseOptionalNumber(value: string | undefined) {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
