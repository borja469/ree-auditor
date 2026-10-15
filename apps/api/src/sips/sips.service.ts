import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { normalizeConsumption, parseSipsCsv, publicPs, readSipsCsv, SipsCsvError, SipsKind } from "./sips-csv";
import { validateCups } from "./cups-validation";

type Result = { status: string; count: number; errorCode?: string };
const PATHS = {
  PS: "/api-oauth2/verticales/v1/SIPS/consulta/v1/SIPS2026_PS_ELECTRICIDAD.csv",
  CONSUMPTION: "/api-oauth2/verticales/v1/SIPS/consulta/v1/SIPS2026_CONSUMOS_ELECTRICIDAD.csv"
};
const ERROR_TEXT: Record<string, string> = {
  NO_RESULTS: "No hay resultados para este CUPS.", INVALID_CSV: "La CNMC devolvió un CSV no válido.", CUPS_MISMATCH: "La CNMC devolvió datos de otro CUPS.",
  AUTH: "Las credenciales CNMC no son válidas.", PERMISSION: "La cuenta CNMC no tiene permisos para esta consulta.",
  NOT_FOUND: "El fichero solicitado no está disponible.", TIMEOUT: "La CNMC no respondió a tiempo.", CONNECTION: "No se pudo conectar con la CNMC.",
  SERVICE: "El servicio CNMC no está disponible.", CONFIG: "Configure las credenciales CNMC antes de consultar."
};

class SipsRemoteError extends Error {
  constructor(readonly code: string) { super(ERROR_TEXT[code] ?? ERROR_TEXT.SERVICE); }
}

@Injectable()
export class SipsService {
  private token?: { value: string; expiresAt: number };
  private pendingToken?: Promise<string>;
  private active = new Map<string, Promise<unknown>>();
  private lastStarted = new Map<string, number>();

  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService) {}

  capabilities(user: string) {
    return { admin: this.auth.isAdminUser(user), holder: this.holderAllowed(user) };
  }

  validateCups(value: string) { return validateCups(value); }

  async config(user: string) {
    this.requireAdmin(user);
    const config = await this.prisma.sipsConfig.findUnique({ where: { id: 1 } });
    return {
      environment: config?.environment ?? "production", keyConfigured: !!config?.consumerKeyEncrypted,
      secretConfigured: !!config?.consumerSecretEncrypted, connectionStatus: config?.connectionStatus ?? "UNTESTED",
      lastConnectionTest: config?.lastConnectionTest ?? null
    };
  }

  async saveConfig(user: string, input: { environment?: unknown; consumerKey?: unknown; consumerSecret?: unknown }) {
    this.requireAdmin(user);
    if (input.environment !== "production" && input.environment !== "preproduction") throw new BadRequestException("Entorno CNMC no válido.");
    if (input.consumerKey !== undefined && (typeof input.consumerKey !== "string" || input.consumerKey.length > 1000)) throw new BadRequestException("Consumer Key no válida.");
    if (input.consumerSecret !== undefined && (typeof input.consumerSecret !== "string" || input.consumerSecret.length > 1000)) throw new BadRequestException("Consumer Secret no válida.");
    if (input.environment === "preproduction" && !process.env.CNMC_PREPROD_BASE_URL) throw new BadRequestException("Configure CNMC_PREPROD_BASE_URL en el servidor.");
    const existing = await this.prisma.sipsConfig.findUnique({ where: { id: 1 } });
    const consumerKey = typeof input.consumerKey === "string" && input.consumerKey ? input.consumerKey.trim() : existing?.consumerKeyEncrypted ? decrypt(existing.consumerKeyEncrypted) : "";
    const consumerSecret = typeof input.consumerSecret === "string" && input.consumerSecret ? input.consumerSecret : existing?.consumerSecretEncrypted ? decrypt(existing.consumerSecretEncrypted) : "";
    if (consumerKey && consumerSecret && consumerKey === consumerSecret) throw new BadRequestException("Consumer Key y Consumer Secret deben ser diferentes.");
    const data = {
      environment: input.environment,
      ...(input.consumerKey ? { consumerKeyEncrypted: encrypt(consumerKey) } : {}),
      ...(input.consumerSecret ? { consumerSecretEncrypted: encrypt(input.consumerSecret) } : {}),
      connectionStatus: "UNTESTED",
      lastConnectionTest: null
    };
    await this.prisma.sipsConfig.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    this.token = undefined;
    return this.config(user);
  }

  async testConnection(user: string) {
    this.requireAdmin(user);
    let status = "OK";
    try { await this.obtainToken(true); }
    catch (error) { status = errorCode(error); }
    const config = await this.prisma.sipsConfig.findUnique({ where: { id: 1 } });
    if (config) await this.prisma.sipsConfig.update({ where: { id: 1 }, data: { connectionStatus: status, lastConnectionTest: new Date() } });
    return { status, message: status === "OK" ? "Conexión correcta." : ERROR_TEXT[status] ?? ERROR_TEXT.SERVICE, testedAt: new Date().toISOString() };
  }

  async history(pageInput?: string) {
    const requestedPage = Number(pageInput ?? "1");
    if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || requestedPage > 1_000_000) throw new BadRequestException("Página de historial no válida.");
    const pageSize = 20;
    const counts = await this.prisma.$queryRaw<Array<{ total: bigint }>>`SELECT COUNT(DISTINCT cups)::bigint AS total FROM sips_queries`;
    const total = Number(counts[0]?.total ?? 0);
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
    const groups = await this.prisma.sipsQuery.groupBy({
      by: ["cups"], _max: { queriedAt: true },
      orderBy: [{ _max: { queriedAt: "desc" } }, { cups: "asc" }],
      skip: (page - 1) * pageSize, take: pageSize
    });
    const cups = groups.map((group) => group.cups);
    if (!cups.length) return { items: [], page, pageSize, total };
    const queries = await this.prisma.sipsQuery.findMany({
      where: { cups: { in: cups } }, distinct: ["cups", "kind"], orderBy: [{ queriedAt: "desc" }, { id: "desc" }],
      select: { cups: true, kind: true, status: true, errorCode: true }
    });
    const latest = new Map<string, { cups: string; lastQuery: Date; psStatus?: string; psErrorCode?: string | null; consumptionStatus?: string; consumptionErrorCode?: string | null }>();
    for (const group of groups) latest.set(group.cups, { cups: group.cups, lastQuery: group._max.queriedAt! });
    for (const query of queries) {
      const entry = latest.get(query.cups)!;
      if (query.kind === "PS" && !entry.psStatus) { entry.psStatus = query.status; entry.psErrorCode = query.errorCode; }
      if (query.kind === "CONSUMPTION" && !entry.consumptionStatus) { entry.consumptionStatus = query.status; entry.consumptionErrorCode = query.errorCode; }
    }
    const points = await this.prisma.sipsPs.findMany({ where: { cups: { in: cups } }, select: { cups: true, distributor: true, tariff: true } });
    const byCups = new Map(points.map((point) => [point.cups, point]));
    return { items: cups.map((value) => {
      const entry = latest.get(value)!;
      return { ...entry, distributor: byCups.get(value)?.distributor ?? "", tariff: byCups.get(value)?.tariff ?? "" };
    }), page, pageSize, total };
  }

  async stored(cupsInput: string, user: string) {
    const cups = validCups(cupsInput);
    const [ps, consumptions, queries] = await Promise.all([
      this.prisma.sipsPs.findUnique({ where: { cups } }),
      this.prisma.sipsConsumption.findMany({ where: { cups }, orderBy: { dateTo: "desc" } }),
      this.prisma.sipsQuery.findMany({ where: { cups }, orderBy: { queriedAt: "desc" }, take: 20, select: { kind: true, status: true, queriedAt: true, recordCount: true, errorCode: true } })
    ]);
    return {
      cups, ps: ps ? { ...ps.normalized as object, fields: this.holderAllowed(user) ? JSON.parse(decrypt(ps.rawEncrypted)) : ps.normalized } : null,
      consumptions: consumptions.map((item) => ({ ...item.normalized as object, raw: item.raw })),
      queries: queries.map((query) => ({ ...query, message: query.errorCode ? ERROR_TEXT[query.errorCode] ?? ERROR_TEXT.SERVICE : "" }))
    };
  }

  async consult(cupsInput: string, user: string) {
    const cups = validCups(cupsInput);
    const existing = this.active.get(cups);
    if (existing) return existing;
    if (this.active.size >= 4) throw new BadRequestException("Hay demasiadas consultas en curso. Inténtelo en unos segundos.");
    const last = this.lastStarted.get(cups) ?? 0;
    if (Date.now() - last < 10000) throw new BadRequestException("Espere unos segundos antes de repetir la consulta.");
    this.lastStarted.set(cups, Date.now());
    const task = (async () => {
      const [ps, consumption] = await Promise.all([this.consultKind(cups, "PS", user), this.consultKind(cups, "CONSUMPTION", user)]);
      await this.pruneSnapshots().catch(() => undefined);
      return { results: { ps, consumption }, data: await this.stored(cups, user) };
    })();
    this.active.set(cups, task);
    try { return await task; } finally { this.active.delete(cups); }
  }

  private async consultKind(cups: string, kind: SipsKind, user: string): Promise<Result> {
    try {
      const csv = await this.requestCsv(cups, kind);
      const rows = parseSipsCsv(csv, kind, cups);
      const hash = createHash("sha256").update(csv).digest("hex");
      const referenceDate = kind === "PS" ? rows[0].fechaUltimaLectura || rows[0].fechaAltaSuministro : rows.map((row) => row.fechaFinMesConsumo).sort().at(-1);
      await this.prisma.$transaction(async (tx) => {
        if (kind === "PS") {
          const row = rows[0];
          await tx.sipsPs.upsert({
            where: { cups }, create: { cups, distributor: row.nombreEmpresaDistribuidora, tariff: row.codigoTarifaATREnVigor, normalized: publicPs(row), rawEncrypted: encrypt(JSON.stringify(row)), contentHash: hash, referenceDate: dateOrNull(referenceDate) },
            update: { distributor: row.nombreEmpresaDistribuidora, tariff: row.codigoTarifaATREnVigor, normalized: publicPs(row), rawEncrypted: encrypt(JSON.stringify(row)), contentHash: hash, referenceDate: dateOrNull(referenceDate) }
          });
        } else {
          for (const row of rows) {
            const normalized = normalizeConsumption(row);
            const rowHash = createHash("sha256").update(JSON.stringify(row)).digest("hex");
            const values = { tariff: row.codigoTarifaATR, normalized, raw: row, contentHash: rowHash };
            await tx.sipsConsumption.upsert({ where: { cups_dateFrom_dateTo: { cups, dateFrom: new Date(row.fechaInicioMesConsumo), dateTo: new Date(row.fechaFinMesConsumo) } },
              create: { cups, dateFrom: new Date(row.fechaInicioMesConsumo), dateTo: new Date(row.fechaFinMesConsumo), ...values }, update: values });
          }
        }
        await tx.sipsQuery.create({ data: { cups, kind, status: "OK", recordCount: rows.length, referenceDate: dateOrNull(referenceDate), contentHash: hash, snapshotEncrypted: encrypt(csv), requestedBy: user } });
      });
      return { status: "OK", count: rows.length };
    } catch (error) {
      const code = errorCode(error);
      await this.prisma.sipsQuery.create({ data: { cups, kind, status: code === "NO_RESULTS" ? "NO_RESULTS" : "ERROR", errorCode: code, requestedBy: user } });
      return { status: code === "NO_RESULTS" ? "NO_RESULTS" : "ERROR", count: 0, errorCode: code };
    }
  }

  private async requestCsv(cups: string, kind: SipsKind) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.obtainToken(attempt > 0);
      const config = await this.prisma.sipsConfig.findUnique({ where: { id: 1 } });
      const url = new URL(PATHS[kind], baseUrl(config?.environment));
      url.searchParams.set("cups", cups);
      const response = await safeFetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "*/*" } });
      if (response.status === 401 && attempt === 0) { this.token = undefined; continue; }
      if (response.status === 401) throw new SipsRemoteError("AUTH");
      if (response.status === 403) throw new SipsRemoteError("PERMISSION");
      if (response.status === 404) throw new SipsRemoteError("NOT_FOUND");
      if (!response.ok) throw new SipsRemoteError("SERVICE");
      const text = await readSipsCsv(response);
      if (text.length > 10_000_000) throw new SipsRemoteError("INVALID_CSV");
      return text;
    }
    throw new SipsRemoteError("AUTH");
  }

  private async obtainToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt > Date.now()) return this.token.value;
    if (this.pendingToken) return this.pendingToken;
    this.pendingToken = (async () => {
      const config = await this.prisma.sipsConfig.findUnique({ where: { id: 1 } });
      if (!config?.consumerKeyEncrypted || !config.consumerSecretEncrypted) throw new SipsRemoteError("CONFIG");
      const key = decrypt(config.consumerKeyEncrypted);
      const secret = decrypt(config.consumerSecretEncrypted);
      const url = new URL("/oauth2/token", baseUrl(config.environment));
      const response = await safeFetch(url, {
        method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", scope: "read" })
      });
      if (response.status === 401 || response.status === 400) throw new SipsRemoteError("AUTH");
      if (response.status === 403) throw new SipsRemoteError("PERMISSION");
      if (!response.ok) throw new SipsRemoteError("SERVICE");
      const body = await response.json() as { access_token?: unknown; token_type?: unknown; expires_in?: unknown };
      if (typeof body.access_token !== "string" || !body.access_token || String(body.token_type).toLowerCase() !== "bearer") throw new SipsRemoteError("AUTH");
      const ttl = Number(body.expires_in);
      if (!Number.isFinite(ttl) || ttl <= 0) throw new SipsRemoteError("AUTH");
      this.token = { value: body.access_token, expiresAt: Date.now() + Math.max(1, ttl - 60) * 1000 };
      return body.access_token;
    })();
    try { return await this.pendingToken; } finally { this.pendingToken = undefined; }
  }

  private requireAdmin(user: string) { if (!this.auth.isAdminUser(user)) throw new ForbiddenException("Acceso reservado a administradores."); }
  private holderAllowed(user: string) { return (process.env.SIPS_HOLDER_USERS ?? "").split(",").map((value) => value.trim()).includes(user); }
  private async pruneSnapshots() {
    const configured = Number(process.env.SIPS_SNAPSHOT_RETENTION_DAYS ?? 365);
    const days = Number.isFinite(configured) ? Math.max(30, configured) : 365;
    await this.prisma.sipsQuery.updateMany({ where: { queriedAt: { lt: new Date(Date.now() - days * 86400000) }, snapshotEncrypted: { not: null } }, data: { snapshotEncrypted: null } });
  }
}

export function validCups(value: string) {
  const result = validateCups(value);
  if (!result.valid) throw new BadRequestException({ code: result.code, message: result.code === "CUPS_FORMATO_INVALIDO" ? "El CUPS no tiene la estructura correcta." : "Los caracteres de control no son correctos." });
  return result.cups;
}
function dateOrNull(value?: string) { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value) : null; }
function errorCode(error: unknown) { return error instanceof SipsCsvError || error instanceof SipsRemoteError ? error.code : "SERVICE"; }
function baseUrl(environment?: string) {
  if (environment !== "preproduction") return "https://api.cnmc.gob.es";
  const url = process.env.CNMC_PREPROD_BASE_URL;
  if (!url || !/^https:\/\//i.test(url)) throw new SipsRemoteError("CONFIG");
  return url;
}
async function safeFetch(url: URL, init: RequestInit) {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(20000) }); }
  catch (error) { throw new SipsRemoteError(error instanceof Error && error.name === "TimeoutError" ? "TIMEOUT" : "CONNECTION"); }
}
function encryptionKey() {
  const secret = process.env.CNMC_CONFIG_ENCRYPTION_KEY?.trim() || process.env.APP_AUTH_TOKEN_SECRET?.trim();
  if (!secret) throw new SipsRemoteError("CONFIG");
  return createHash("sha256").update(secret).digest();
}
function encrypt(value: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${data.toString("base64url")}`;
}
function decrypt(value: string) {
  try {
    const [version, iv, tag, data] = value.split(":");
    if (version !== "v1" || !iv || !tag || !data) throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([cipher.update(Buffer.from(data, "base64url")), cipher.final()]).toString("utf8");
  } catch { throw new SipsRemoteError("CONFIG"); }
}
