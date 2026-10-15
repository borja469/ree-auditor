import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { SipsController } from "./sips.controller";
import { SipsService } from "./sips.service";

@Module({ imports: [PrismaModule, AuthModule], controllers: [SipsController], providers: [SipsService] })
export class SipsModule {}
