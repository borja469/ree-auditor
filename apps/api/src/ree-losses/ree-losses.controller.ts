import { BadRequestException, Controller, Get, Post, Query, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import { attachUploadedFileBuffers, cleanupUploadedFiles, uploadDiskStorage, uploadLimits } from "../common/upload-storage";
import { ReeLossesQueryDto } from "./dto/ree-losses-query.dto";
import { ReeLossesService } from "./ree-losses.service";

@Controller("ree-losses")
export class ReeLossesController {
  constructor(private readonly reeLossesService: ReeLossesService) {}

  @Post("import")
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: uploadDiskStorage,
      limits: uploadLimits({ fileSizeMb: 250, files: 100 })
    })
  )
  async importKFactors(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files?.length) {
      throw new BadRequestException("Debe adjuntarse al menos un fichero multipart.");
    }

    try {
      await attachUploadedFileBuffers(files);
      return await this.reeLossesService.importKFactorFiles(files);
    } finally {
      await cleanupUploadedFiles(files);
    }
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
