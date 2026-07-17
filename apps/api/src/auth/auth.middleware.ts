import { Injectable, NestMiddleware, UnauthorizedException } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AuthService } from "./auth.service";

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private readonly authService: AuthService) {}

  use(request: Request, _response: Response, next: NextFunction) {
    const header = request.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;
    const payload = this.authService.verifyToken(token);

    if (!payload) {
      throw new UnauthorizedException("Sesion no valida o caducada.");
    }

    request.headers["x-user"] = payload.user;
    next();
  }
}
