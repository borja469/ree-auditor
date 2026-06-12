import { BadRequestException, Controller, Get, Post, Query, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { ReeLossesQueryDto } from "./dto/ree-losses-query.dto";
import { ReeLossesService } from "./ree-losses.service";

@Controller("ree-losses")
export class ReeLossesController {
  constructor(private readonly reeLossesService: ReeLossesService) {}

  @Post("import")
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: memoryStorage(),
      limits: {
        fileSize: 250 * 1024 * 1024,
        files: 100
      }
    })
  )
  importKFactors(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files?.length) {
      throw new BadRequestException("Debe adjuntarse al menos un fichero multipart.");
    }

    return this.reeLossesService.importKFactorFiles(files);
  }

  @Get("imports")
  imports(@Query("skip") skip?: string, @Query("take") take?: string) {
    return this.reeLossesService.listImports({ skip, take });
  }

  @Get("filters")
  filters() {
    return this.reeLossesService.filterOptions();
  }

  @Get("analytics-summary")
  analyticsSummary() {
    return this.reeLossesService.analyticsSummary();
  }

  @Get("report")
  report(@Query() query: ReeLossesQueryDto) {
    return this.reeLossesService.report(query);
  }
}
