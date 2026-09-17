import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Query } from "@nestjs/common";
import { ForecastPredictionsQueryDto } from "./dto/forecast-predictions-query.dto";
import { PredictForecastDto } from "./dto/predict-forecast.dto";
import { PredictForecastRangeDto } from "./dto/predict-forecast-range.dto";
import { TrainForecastDto } from "./dto/train-forecast.dto";
import { ForecastService } from "./forecast.service";

@Controller("mercado/forecast")
export class ForecastController {
  constructor(private readonly forecastService: ForecastService) {}

  @Get("models")
  getModels() {
    return this.forecastService.getModels();
  }

  @Get("models/compare")
  compareModels(@Query("ids") ids?: string) {
    return this.forecastService.compareModels((ids ?? "").split(","));
  }

  @Get("models/:id")
  getModel(@Param("id") id: string) {
    return this.forecastService.getModel(id);
  }

  @Post("models/:id/activate")
  activateModel(@Param("id") id: string) {
    return this.forecastService.activateModel(id);
  }

  @Post("predict")
  predict(@Body() body: PredictForecastDto, @Headers("x-user") usuario?: string) {
    return this.forecastService.predict(body, usuario);
  }

  @Post("predict/range")
  predictRange(@Body() body: PredictForecastRangeDto, @Headers("x-user") usuario?: string) {
    return this.forecastService.predictRange(body, usuario);
  }

  @Get("predictions")
  listPredictions(@Query() query: ForecastPredictionsQueryDto) {
    return this.forecastService.listPredictions(query);
  }

  @Get("predictions/official")
  listOfficialPredictions(@Query() query: ForecastPredictionsQueryDto) {
    return this.forecastService.listOfficialPredictions(query);
  }

  @Post("predictions/:id/validate")
  validatePrediction(@Param("id") id: string, @Body() body: { comment?: string }, @Headers("x-user") usuario?: string) {
    return this.forecastService.validatePrediction(id, body, usuario);
  }

  @Post("predictions/:id/reject")
  rejectPrediction(@Param("id") id: string, @Body() body: { comment?: string }, @Headers("x-user") usuario?: string) {
    return this.forecastService.rejectPrediction(id, body, usuario);
  }

  @Delete("predictions/:id")
  deletePrediction(@Param("id") id: string) {
    return this.forecastService.deletePrediction(id);
  }

  @Get("train/jobs")
  listTrainingJobs(@Query() query: { take?: number; status?: string; modelo?: string }) {
    return this.forecastService.listTrainingJobs(query);
  }

  @Get("training-automation")
  getTrainingAutomationConfig() {
    return this.forecastService.getTrainingAutomationConfig();
  }

  @Put("training-automation")
  saveTrainingAutomationConfig(@Body() body: { active?: boolean; scheduleTime?: string; trainingStartDate?: string; modelo?: string; useActiveModelType?: boolean; geoId?: number | null }) {
    return this.forecastService.saveTrainingAutomationConfig(body);
  }

  @Post("training-automation/run")
  runTrainingAutomation(@Headers("x-user") usuario?: string) {
    return this.forecastService.runTrainingAutomation(usuario);
  }

  @Get("train/jobs/:id")
  getTrainingJob(@Param("id") id: string) {
    return this.forecastService.getTrainingJob(id);
  }

  @Post("train/jobs")
  createTrainingJob(@Body() body: TrainForecastDto, @Headers("x-user") usuario?: string) {
    return this.forecastService.createTrainingJob(body, usuario);
  }

  @Post("train")
  train(@Body() body: TrainForecastDto, @Headers("x-user") usuario?: string) {
    return this.forecastService.train(body, usuario);
  }
}
