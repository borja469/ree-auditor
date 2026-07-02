import { Injectable } from "@nestjs/common";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export type AuthTokenPayload = {
  user: string;
  exp: number;
};

const DEFAULT_AUTH_USERNAME = "operaciones";
const DEFAULT_AUTH_PASSWORD = "Opc!0n";
const TOKEN_TTL_SECONDS = 12 * 60 * 60;

@Injectable()
export class AuthService {
  private readonly username = process.env.APP_AUTH_USERNAME?.trim() || DEFAULT_AUTH_USERNAME;
  private readonly password = process.env.APP_AUTH_PASSWORD ?? DEFAULT_AUTH_PASSWORD;
  private readonly tokenSecret = process.env.APP_AUTH_TOKEN_SECRET || randomBytes(32).toString("hex");

  validateCredentials(username: string, password: string) {
    return this.safeEquals(username, this.username) && this.safeEquals(password, this.password);
  }

  issueToken(user: string) {
    const payload: AuthTokenPayload = {
      user,
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
    };
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = this.sign(body);
    return {
      token: `${body}.${signature}`,
      user,
      expiresAt: new Date(payload.exp * 1000).toISOString()
    };
  }

  verifyToken(token: string | undefined) {
    if (!token) {
      return undefined;
    }

    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra !== undefined || !this.safeEquals(signature, this.sign(body))) {
      return undefined;
    }

    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<AuthTokenPayload>;
      if (!payload.user || typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) {
        return undefined;
      }
      return payload as AuthTokenPayload;
    } catch {
      return undefined;
    }
  }

  private sign(body: string) {
    return createHmac("sha256", this.tokenSecret).update(body).digest("base64url");
  }

  private safeEquals(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }
}
