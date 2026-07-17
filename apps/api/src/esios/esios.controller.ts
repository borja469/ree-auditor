import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Put, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { attachUploadedFileBuffer, cleanupUploadedFile, uploadDiskStorage, uploadLimits } from "../common/upload-storage";
import { EsiosApiService } from "./esios-api.service";
import {
  EsiosProfilesService,
  type EsiosProfileCoefficientInput
} from "./esios-profiles.service";
import { EsiosSchedulerService, type EsiosSeriesAutomationConfigInput } from "./esios-scheduler.service";
import { ESIOS_DEFAULT_INDICATOR_ID, type EsiosConfigInput } from "./esios.types";

@Controller("esios")
export class EsiosController {
  constructor(
    private readonly esiosApiService: EsiosApiService,
    private readonly esiosProfilesService: EsiosProfilesService,
    private readonly esiosSchedulerService: EsiosSchedulerService
  ) {}

  @Get("config")
  getConfig() {
    return this.esiosApiService.getConfig();
  }

  @Put("config")
  updateConfig(@Body() body: EsiosConfigInput) {
    return this.esiosApiService.updateConfig({
      apiUrl: body.apiUrl,
      apiToken: body.apiToken,
      timeoutSeconds: parseOptionalInteger(body.timeoutSeconds),
      retries: parseOptionalInteger(body.retries),
      active: typeof body.active === "boolean" ? body.active : undefined
    });
  }

  @Post("test-connection")
  testConnection() {
    return this.esiosApiService.testConnection();
  }

  @Get("indicators")
  getIndicators() {
    return this.esiosApiService.getIndicators();
  }

  @Post("indicators/sync")
  syncIndicators() {
    return this.esiosApiService.syncIndicators();
  }

  @Get("indicators/:indicatorId")
  getIndicator(@Param("indicatorId") indicatorId: string) {
    return this.esiosApiService.getIndicator(parseIndicatorId(indicatorId));
  }

  @Get("indicators/:indicatorId/values")
  getIndicatorValues(
    @Param("indicatorId") indicatorId: string,
    @Query("fechaDesde") fechaDesde?: string,
    @Query("fechaHasta") fechaHasta?: string,
    @Query("year") year?: string,
    @Query("month") month?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string
  ) {
    return this.esiosApiService.getIndicatorValues(parseIndicatorId(indicatorId), {
      fechaDesde,
      fechaHasta,
      year: parseOptionalInteger(year),
      month: parseOptionalInteger(month),
      skip: parseOptionalInteger(skip),
      take: parseOptionalInteger(take)
    });
  }

  @Post("indicators/:indicatorId/download")
  downloadIndicator(@Param("indicatorId") indicatorId: string, @Body() body: { startDate?: string; endDate?: string }) {
    if (!body.startDate || !body.endDate) {
      throw new BadRequestException("Fecha inicio y fecha fin son obligatorias.");
    }
    return this.esiosApiService.downloadIndicator(parseIndicatorId(indicatorId), body.startDate, body.endDate);
  }

  @Get("demanda-prevista")
  getDemandForecast(
    @Query("fechaDesde") fechaDesde?: string,
    @Query("fechaHasta") fechaHasta?: string,
    @Query("year") year?: string,
    @Query("month") month?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string
  ) {
    return this.esiosApiService.getDemandForecast({
      fechaDesde,
      fechaHasta,
      year: parseOptionalInteger(year),
      month: parseOptionalInteger(month),
      skip: parseOptionalInteger(skip),
      take: parseOptionalInteger(take)
    });
  }

  @Post("demanda-prevista/download")
  downloadDemandForecast(@Body() body: { startDate?: string; endDate?: string }) {
    if (!body.startDate || !body.endDate) {
      throw new BadRequestException("Fecha inicio y fecha fin son obligatorias.");
    }
    return this.esiosApiService.downloadIndicator(ESIOS_DEFAULT_INDICATOR_ID, body.startDate, body.endDate);
  }

  @Get("download-logs")
  getDownloadLogs(@Query("indicatorId") indicatorId?: string, @Query("skip") skip?: string, @Query("take") take?: string) {
    return this.esiosApiService.getDownloadLogs({
      indicatorId: parseOptionalInteger(indicatorId),
      skip: parseOptionalInteger(skip),
      take: parseOptionalInteger(take)
    });
  }

  @Get("series-automation")
  getSeriesAutomation() {
    return this.esiosSchedulerService.obtenerAutomatizacionSeries();
  }

  @Put("series-automation")
  saveSeriesAutomation(@Body() body: EsiosSeriesAutomationConfigInput) {
    return this.esiosSchedulerService.guardarAutomatizacionSeries({
      active: typeof body.active === "boolean" ? body.active : undefined,
      scheduleTime: typeof body.scheduleTime === "string" ? body.scheduleTime : undefined,
      daysBack: body.daysBack === undefined ? undefined : parseRequiredInteger(body.daysBack, "Dias atras"),
      daysForward: body.daysForward === undefined ? undefined : parseRequiredInteger(body.daysForward, "Dias adelante"),
      selectedIndicatorIds: Array.isArray(body.selectedIndicatorIds) ? body.selectedIndicatorIds.map((item) => parseRequiredInteger(item, "Indicador")) : undefined
    });
  }

  @Post("series-automation/run")
  runSeriesAutomation() {
    return this.esiosSchedulerService.ejecutarAutomatizacionSeries("00:00");
  }

  @Post("profiles/upload")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: uploadDiskStorage,
      limits: uploadLimits({ fileSizeMb: 100 })
    })
  )
  async uploadProfiles(
    @UploadedFile() file: Express.Multer.File,
    @Query("year") year: string,
    @Query("replace") replace?: string,
    @Headers("x-user") uploadedBy?: string
  ) {
    try {
      await attachUploadedFileBuffer(file);
      return await this.esiosProfilesService.uploadInitialProfiles(file, parseRequiredInteger(year, "Año"), {
        replace: parseBooleanQuery(replace),
        uploadedBy
      });
    } finally {
      await cleanupUploadedFile(file);
    }
  }

  @Post("profiles/final-demand/upload")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: uploadDiskStorage,
      limits: uploadLimits({ fileSizeMb: 20 })
    })
  )
  async uploadFinalDemand(
    @UploadedFile() file: Express.Multer.File,
    @Query("year") year: string,
    @Query("month") month: string,
    @Query("day") day?: string,
    @Query("replace") replace?: string,
    @Headers("x-user") uploadedBy?: string
  ) {
    try {
      await attachUploadedFileBuffer(file);
      return await this.esiosProfilesService.uploadReeFinalDemand(file, parseRequiredInteger(year, "Año"), parseRequiredInteger(month, "Mes"), {
        day: parseOptionalInteger(day),
        replace: parseBooleanQuery(replace),
        uploadedBy
      });
    } finally {
      await cleanupUploadedFile(file);
    }
  }

  @Get("profiles/final-demand/uploads")
  listFinalDemandUploads(@Query("year") year?: string, @Query("month") month?: string, @Query("day") day?: string, @Query("skip") skip?: string, @Query("take") take?: string) {
    return this.esiosProfilesService.listReeFinalDemandUploads({
      year: parseOptionalInteger(year),
      month: parseOptionalInteger(month),
      day: parseOptionalInteger(day),
      skip: parseOptionalInteger(skip),
      take: parseOptionalInteger(take)
    });
  }

  @Post("profiles/final-profiles/upload")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: uploadDiskStorage,
      limits: uploadLimits({ fileSizeMb: 20 })
    })
  )
  async uploadFinalProfiles(
    @UploadedFile() file: Express.Multer.File,
    @Query("year") year: string,
    @Query("month") month: string,
    @Query("replace") replace?: string,
    @Headers("x-user") uploadedBy?: string
  ) {
    try {
      await attachUploadedFileBuffer(file);
      return await this.esiosProfilesService.uploadReeFinalProfiles(file, parseRequiredInteger(year, "AÃ±o"), parseRequiredInteger(month, "Mes"), {
        replace: parseBooleanQuery(replace),
        uploadedBy
      });
    } finally {
      await cleanupUploadedFile(file);
    }
  }

  @Get("profiles/final-profiles/uploads")
  listFinalProfileUploads(@Query("year") year?: string, @Query("month") month?: string, @Query("skip") skip?: string, @Query("take") take?: string) {
    return this.esiosProfilesService.listReeFinalProfileUploads({
      year: parseOptionalInteger(year),
      month: parseOptionalInteger(month),
      skip: parseOptionalInteger(skip),
      take: parseOptionalInteger(take)
    });
  }

  @Get("profiles/initial")
  getInitialProfiles(
    @Query("year") year?: string,
    @Query("month") month?: string,
    @Query("tariff") tariff?: string,
    @Query("fechaDesde") fechaDesde?: string,
    @Query("fechaHasta") fechaHasta?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string
  ) {
    return this.esiosProfilesService.getInitialProfiles({
      year: parseOptionalInteger(year),
      month: parseOptionalInteger(month),
      tariff,
      fechaDesde,
      fechaHasta,
      skip: parseOptionalInteger(skip),
      take: parseOptionalInteger(take)
    });
  }

  @Get("profiles/summary/:year")
  getProfilesSummary(@Param("year") year: string) {
    return this.esiosProfilesService.getProfilesSummary(parseRequiredInteger(year, "Año"));
  }

  @Get("profiles/coefficients/:year")
  getProfileCoefficients(@Param("year") year: string) {
    return this.esiosProfilesService.getProfileCoefficients(parseRequiredInteger(year, "Año"));
  }

  @Put("profiles/coefficients/:year")
  saveProfileCoefficients(@Param("year") year: string, @Body() body: { coefficients?: EsiosProfileCoefficientInput[] }) {
    if (!Array.isArray(body.coefficients)) {
      throw new BadRequestException("Coeficientes no validos.");
    }
    return this.esiosProfilesService.saveProfileCoefficients(parseRequiredInteger(year, "Año"), body.coefficients);
  }

  @Get("profiles/uploads")
  listProfileUploads(@Query("year") year?: string, @Query("skip") skip?: string, @Query("take") take?: string) {
    return this.esiosProfilesService.listProfileUploads({
      year: parseOptionalInteger(year),
      skip: parseOptionalInteger(skip),
      take: parseOptionalInteger(take)
    });
  }

  @Post("profiles/intermediate/:year/calculate")
  calculateIntermediateProfiles(@Param("year") year: string) {
    return this.esiosProfilesService.calculateIntermediateProfiles(parseRequiredInteger(year, "AÃ±o"));
  }

  @Get("profiles/intermediate")
  getIntermediateProfiles(
    @Query("year") year?: string,
    @Query("month") month?: string,
    @Query("tariff") tariff?: string,
    @Query("fechaDesde") fechaDesde?: string,
    @Query("fechaHasta") fechaHasta?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string
  ) {
    return this.esiosProfilesService.getIntermediateProfiles({
      year: parseOptionalInteger(year),
      month: parseOptionalInteger(month),
      tariff,
      fechaDesde,
      fechaHasta,
      skip: parseOptionalInteger(skip),
      take: parseOptionalInteger(take)
    });
  }

  @Get("profiles/intermediate/summary/:year")
  getIntermediateProfilesSummary(@Param("year") year: string) {
    return this.esiosProfilesService.getIntermediateProfilesSummary(parseRequiredInteger(year, "AÃ±o"));
  }

  @Get("profiles/intermediate/logs")
  listProfileCalculationLogs(@Query("year") year?: string, @Query("skip") skip?: string, @Query("take") take?: string) {
    return this.esiosProfilesService.listProfileCalculationLogs({
      year: parseOptionalInteger(year),
      skip: parseOptionalInteger(skip),
      take: parseOptionalInteger(take)
    });
  }
}

function parseIndicatorId(value: string) {
  const indicatorId = Number(value);
  if (!Number.isSafeInteger(indicatorId) || indicatorId <= 0) {
    throw new BadRequestException("Indicador ESIOS no valido.");
  }
  return indicatorId;
}

function parseOptionalInteger(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new BadRequestException("Parametro numerico no valido.");
  }
  return number;
}

function parseRequiredInteger(value: unknown, label: string) {
  const parsed = parseOptionalInteger(value);
  if (parsed === undefined) {
    throw new BadRequestException(`${label} obligatorio.`);
  }
  return parsed;
}

function parseBooleanQuery(value: unknown) {
  return value === true || value === "true" || value === "1" || value === "yes";
}
