import { Body, Controller, Post, UnauthorizedException } from "@nestjs/common";
import { IsString } from "class-validator";
import { AuthService } from "./auth.service";

class LoginDto {
  @IsString()
  username!: string;

  @IsString()
  password!: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  login(@Body() body: LoginDto) {
    if (!this.authService.validateCredentials(body.username, body.password)) {
      throw new UnauthorizedException("Usuario o contrasena incorrectos.");
    }

    return this.authService.issueToken(body.username);
  }
}
