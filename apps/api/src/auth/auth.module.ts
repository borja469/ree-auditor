import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthMiddleware } from "./auth.middleware";
import { AuthService } from "./auth.service";

@Module({
  controllers: [AuthController],
  providers: [AuthMiddleware, AuthService],
  exports: [AuthMiddleware, AuthService]
})
export class AuthModule {}
