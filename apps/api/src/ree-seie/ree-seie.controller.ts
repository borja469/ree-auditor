import { BadRequestException, Controller, Get, Headers, Post, Query, Res, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { attachUploadedFileBuffers, cleanupUploadedFiles, uploadDiskStorage, uploadLimits } from "../common/upload-storage";
import { ReeSeieQueryDto } from "./dto/ree-seie-query.dto";
import { ReeSeieService } from "./ree-seie.service";

@Controller("ree-seie")
export class ReeSeieController {
  constructor(private readonly service: ReeSeieService) {}

  @Get("files")
  listFiles(@Query() query: ReeSeieQueryDto) {
    return this.service.listFiles(query);
  }

  @Get("filters")
  filters() {
    return this.service.filterOptions();
  }

  @Get("summary")
  summary(@Query() query: ReeSeieQueryDto) {
    return this.service.summary(query);
  }

  @Get("records")
  records(@Query() query: ReeSeieQueryDto) {
    return this.service.listRecords(query);
  }

  @Get("download-center-summary")
  downloadCenterSummary() {
    return this.service.downloadCenterSummary();
  }

  @Get("export")
  async export(@Query() query: ReeSeieQueryDto, @Res({ passthrough: true }) response: Response) {
    const download = await this.service.export(query);
    response.setHeader("Content-Type", download.contentType);
    response.setHeader("Content-Disposition", `attachment; filename="${download.fileName}"`);
    return download.content;
  }

  @Post("import")
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: uploadDiskStorage,
      limits: uploadLimits({ fileSizeMb: 250, files: 100 })
    })
  )
  async importSeie(
    @UploadedFiles() files: Express.Multer.File[],
    @Query("overwrite") overwrite?: string,
    @Headers("x-user") user?: string
  ) {
    if (!files?.length) {
      throw new BadRequestException("Debe adjuntarse al menos un fichero multipart.");
    }

    try {
      await attachUploadedFileBuffers(files);
      return await this.service.importFiles(files, {
        overwrite: overwrite === "1" || overwrite?.toLowerCase() === "true",
        auditUser: user?.trim() || "web"
      });
    } finally {
      await cleanupUploadedFiles(files);
    }
  }
}
