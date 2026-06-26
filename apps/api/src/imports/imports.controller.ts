import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors
} from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { attachUploadedFileBuffers, cleanupUploadedFiles, uploadDiskStorage, uploadLimits } from "../common/upload-storage";
import { ListRecordsDto } from "./dto/list-records.dto";
import { ImportsService } from "./imports.service";

@Controller("imports")
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Get()
  listFiles(@Query() query: ListRecordsDto) {
    return this.importsService.listFiles(query);
  }

  @Get(":id")
  getFile(@Param("id") id: string) {
    return this.importsService.getFile(id);
  }

  @Get(":id/detail")
  getFileDetail(@Param("id") id: string) {
    return this.importsService.getImportFileDetail(id);
  }

  @Get(":id/errors")
  async downloadErrors(@Param("id") id: string, @Res({ passthrough: true }) response: Response) {
    const download = await this.importsService.getImportErrorsCsv(id);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="${download.fileName}"`);
    return download.content;
  }

  @Get(":id/logs")
  getFileLogs(@Param("id") id: string) {
    return this.importsService.getImportFileLogs(id);
  }

  @Post(":id/reprocess")
  @HttpCode(200)
  reprocessFile(@Param("id") id: string, @Headers("x-user") user?: string) {
    return this.importsService.reprocessImportFile(id, {
      auditUser: user?.trim() || "web"
    });
  }

  @Delete(":id")
  deleteFile(@Param("id") id: string) {
    return this.importsService.deleteImportFile(id);
  }

  @Post("reganecu")
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: uploadDiskStorage,
      limits: uploadLimits({ fileSizeMb: 250, files: 100 })
    })
  )
  async importReganecu(
    @UploadedFiles() files: Express.Multer.File[],
    @Query("overwrite") overwrite?: string,
    @Headers("x-user") user?: string
  ) {
    if (!files?.length) {
      throw new BadRequestException("Debe adjuntarse al menos un fichero multipart.");
    }

    try {
      await attachUploadedFileBuffers(files);
      return await this.importsService.importReganecuFiles(files, {
        overwrite: parseBooleanQuery(overwrite),
        auditUser: user?.trim() || "web"
      });
    } finally {
      await cleanupUploadedFiles(files);
    }
  }

  @Post("medper")
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: uploadDiskStorage,
      limits: uploadLimits({ fileSizeMb: 250, files: 100 })
    })
  )
  async importMedper(
    @UploadedFiles() files: Express.Multer.File[],
    @Query("overwrite") overwrite?: string,
    @Headers("x-user") user?: string
  ) {
    if (!files?.length) {
      throw new BadRequestException("Debe adjuntarse al menos un fichero multipart.");
    }

    try {
      await attachUploadedFileBuffers(files);
      return await this.importsService.importMedperFiles(files, {
        overwrite: parseBooleanQuery(overwrite),
        auditUser: user?.trim() || "web"
      });
    } finally {
      await cleanupUploadedFiles(files);
    }
  }
}

function parseBooleanQuery(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true";
}
