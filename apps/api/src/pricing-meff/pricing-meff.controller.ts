import { BadRequestException, Controller, Get, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { attachUploadedFileBuffer, cleanupUploadedFile, uploadDiskStorage, uploadLimits } from "../common/upload-storage";
import { defaultPricingMeffQuery, PricingMeffService } from "./pricing-meff.service";

@Controller("pricing/meff")
export class PricingMeffController {
  constructor(private readonly service: PricingMeffService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    return this.service.list(defaultPricingMeffQuery(query));
  }

  @Post("import")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: uploadDiskStorage,
      limits: uploadLimits({ fileSizeMb: 50, files: 1 })
    })
  )
  async import(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("Debe adjuntarse un fichero MEFF en el campo multipart 'file'.");
    }
    try {
      await attachUploadedFileBuffer(file);
      return await this.service.importFile(file);
    } finally {
      await cleanupUploadedFile(file);
    }
  }
}
