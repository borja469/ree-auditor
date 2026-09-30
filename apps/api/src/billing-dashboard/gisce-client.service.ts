import { BadGatewayException, BadRequestException, Injectable, Logger } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";

const DEFAULT_BASE_URL = "https://api.opcionenergia.gisce.cloud";
const DEFAULT_TIMEOUT_MS = 60000;
const TOKEN_EXPIRY_MARGIN_MS = 3 * 60 * 1000;
const GISCE_INVOICE_PAGE_LIMIT = 80;
const GISCE_INVOICE_TYPES = ["out_invoice", "out_refund"] as const;
const GISCE_INVOICE_SCHEMA = [
  "number",
  "cups_id.name",
  "polissa_id.name",
  "llista_preu.name",
  "llista_preu.compatible_invoicing_modes.id",
  "llista_preu.compatible_invoicing_modes.name",
  "invoice_line.name",
  "invoice_line.quantity",
  "invoice_line.price_unit",
  "invoice_line.price_subtotal",
  "invoice_line.account_id.name",
  "date_invoice",
  "data_final",
  "data_inici",
  "data_inicial",
  "tarifa_acces_id.name",
  "type"
].join(",");

type GisceConfig = {
  baseUrl: string;
  basicAuth: string | null;
  apiTokenFallback: string | null;
  timeoutMs: number;
  invoiceDateField: string;
  invoiceStartField: string;
  invoiceEndField: string;
};

export type GisceConfigDto = {
  baseUrl: string;
  username: string | null;
  passwordConfigured: boolean;
  timeoutMs: number;
  invoiceDateField: string;
  invoiceStartField: string;
  invoiceEndField: string;
  updatedAt: string | null;
  authSource: "database" | "environment" | "fallback_token" | "missing";
};

export type GisceConfigInput = {
  baseUrl?: string | null;
  username?: string | null;
  password?: string | null;
  timeoutMs?: number | null;
  invoiceDateField?: string | null;
  invoiceStartField?: string | null;
  invoiceEndField?: string | null;
};

export type GisceConnectionTestResult = {
  tokenEndpoint: { ok: boolean; httpStatus: number | null; tokenReceived: boolean; errorType?: string; message?: string };
  fieldsGet?: { ok: boolean; fieldNames: string[]; confirmedFields: Record<string, boolean>; errorType?: string; message?: string };
};

type CachedToken = {
  token: string;
  expiresAtMs: number | null;
  source: "token_endpoint" | "fallback_env";
};

@Injectable()
export class GisceClientService {
  private readonly logger = new Logger(GisceClientService.name);
  private cachedToken: CachedToken | null = null;
  private tokenRequest: Promise<CachedToken> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async getStoredConfig(): Promise<GisceConfigDto> {
    const [config, stored] = await Promise.all([this.readConfig(), this.readStoredConfig()]);
    return {
      baseUrl: config.baseUrl,
      username: stored?.username?.trim() || process.env.GISCE_BASIC_USERNAME?.trim() || null,
      passwordConfigured: Boolean(stored?.passwordEncrypted || process.env.GISCE_BASIC_PASSWORD || process.env.GISCE_BASIC_AUTH),
      timeoutMs: config.timeoutMs,
      invoiceDateField: config.invoiceDateField,
      invoiceStartField: config.invoiceStartField,
      invoiceEndField: config.invoiceEndField,
      updatedAt: stored?.updatedAt?.toISOString() ?? null,
      authSource: stored?.username && stored.passwordEncrypted ? "database" : config.basicAuth ? "environment" : config.apiTokenFallback ? "fallback_token" : "missing"
    };
  }

  async saveStoredConfig(input: GisceConfigInput): Promise<GisceConfigDto> {
    const existing = await this.readStoredConfig();
    const password =
      input.password === undefined
        ? undefined
        : input.password === null || input.password === ""
          ? null
          : encryptSecret(input.password);
    await this.prisma.cmGisceConfig.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        baseUrl: cleanUrl(input.baseUrl) ?? DEFAULT_BASE_URL,
        username: cleanText(input.username),
        passwordEncrypted: password ?? null,
        timeoutMs: cleanTimeout(input.timeoutMs),
        invoiceDateField: cleanField(input.invoiceDateField) ?? "date_invoice",
        invoiceStartField: cleanField(input.invoiceStartField) ?? "data_inici",
        invoiceEndField: cleanField(input.invoiceEndField) ?? "data_final"
      },
      update: {
        baseUrl: cleanUrl(input.baseUrl) ?? existing?.baseUrl ?? DEFAULT_BASE_URL,
        username: input.username === undefined ? existing?.username ?? null : cleanText(input.username),
        ...(password === undefined ? {} : { passwordEncrypted: password }),
        timeoutMs: cleanTimeout(input.timeoutMs ?? existing?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        invoiceDateField: cleanField(input.invoiceDateField) ?? existing?.invoiceDateField ?? "date_invoice",
        invoiceStartField: cleanField(input.invoiceStartField) ?? existing?.invoiceStartField ?? "data_inici",
        invoiceEndField: cleanField(input.invoiceEndField) ?? existing?.invoiceEndField ?? "data_final"
      }
    });
    this.invalidateToken();
    return this.getStoredConfig();
  }

  async testConnection(): Promise<GisceConnectionTestResult> {
    try {
      await this.getToken();
    } catch (error) {
      return {
        tokenEndpoint: {
          ok: false,
          httpStatus: statusFromGisceError(error),
          tokenReceived: false,
          errorType: classifyGisceError(error),
          message: safePublicError(error)
        }
      };
    }

    const result: GisceConnectionTestResult = {
      tokenEndpoint: { ok: true, httpStatus: 200, tokenReceived: true }
    };
    try {
      const payload = await this.invoiceFields();
      const fieldNames = fieldNamesFromPayload(payload);
      const fields = await this.invoiceFieldNames();
      result.fieldsGet = {
        ok: true,
        fieldNames,
        confirmedFields: {
          invoiceDateField: fieldNames.includes(fields.invoiceDateField),
          invoiceStartField: fieldNames.includes(fields.invoiceStartField),
          invoiceEndField: fieldNames.includes(fields.invoiceEndField)
        }
      };
    } catch (error) {
      result.fieldsGet = {
        ok: false,
        fieldNames: [],
        confirmedFields: {},
        errorType: classifyGisceError(error),
        message: safePublicError(error)
      };
    }
    return result;
  }

  async diagnostic() {
    const config = await this.readConfig();
    return {
      baseUrl: config.baseUrl,
      tokenEndpoint: "/token",
      invoiceEndpoint: "/GiscedataFacturacioFactura",
      invoiceFieldsEndpoint: "/GiscedataFacturacioFactura/fields_get",
      invoiceTypes: [...GISCE_INVOICE_TYPES],
      invoiceSchema: GISCE_INVOICE_SCHEMA,
      f1Endpoint: "/TgF1",
      p1Endpoint: "/TgP1",
      f5dEndpoint: "/TgCchfact",
      p5dEndpoint: "/TgCchval",
      invoiceDateField: config.invoiceDateField,
      invoiceStartField: config.invoiceStartField,
      invoiceEndField: config.invoiceEndField,
      tariffFields: ["tarifa_acces_id.name", "tarifa"],
      authConfigured: {
        basic: Boolean(config.basicAuth),
        tokenFallback: Boolean(config.apiTokenFallback)
      },
      tokenFlow: "GET /token with Basic, then Authorization: token <token>"
    };
  }

  async invoiceFields() {
    return this.requestWithToken<unknown>("/GiscedataFacturacioFactura/fields_get", { method: "POST" });
  }

  async searchInvoicesByInvoiceDate(dateFrom: string, dateTo: string) {
    const config = await this.readConfig();
    const filter = [
      [config.invoiceDateField, ">=", dateFrom],
      [config.invoiceDateField, "<=", dateTo],
      ["type", "in", [...GISCE_INVOICE_TYPES]]
    ];
    const result = await this.getPagedList<GisceInvoiceItem>("/GiscedataFacturacioFactura", filter, GISCE_INVOICE_PAGE_LIMIT, GISCE_INVOICE_SCHEMA);
    return {
      ...result,
      items: await this.enrichInvoices(result.items)
    };
  }

  async fetchF1(cups: string, startExclusiveOrEqual: string, endExclusive: string) {
    const result = await this.getPagedList<GisceF1Item>("/TgF1", [
      ["datetime", ">", startExclusiveOrEqual],
      ["datetime", "<", endExclusive],
      ["name", "=", cups]
    ], GISCE_INVOICE_PAGE_LIMIT);
    return result.items;
  }

  async fetchF5d(cups: string, startExclusiveOrEqual: string, endExclusive: string) {
    const result = await this.getPagedList<GisceF5dItem>("/TgCchfact", [
      ["datetime", ">", startExclusiveOrEqual],
      ["datetime", "<", endExclusive],
      ["name", "=", cups]
    ], GISCE_INVOICE_PAGE_LIMIT);
    return result.items;
  }

  async fetchP1(cups: string, startExclusiveOrEqual: string, endExclusive: string) {
    const result = await this.getPagedList<GisceP1Item>("/TgP1", [
      ["datetime", ">", startExclusiveOrEqual],
      ["datetime", "<", endExclusive],
      ["name", "=", cups]
    ], GISCE_INVOICE_PAGE_LIMIT);
    return result.items;
  }

  async fetchP5d(cups: string, startExclusiveOrEqual: string, endExclusive: string) {
    const result = await this.getPagedList<GisceP5dItem>("/TgCchval", [
      ["datetime", ">", startExclusiveOrEqual],
      ["datetime", "<", endExclusive],
      ["name", "=", cups]
    ], GISCE_INVOICE_PAGE_LIMIT);
    return result.items;
  }

  async getToken() {
    return this.fetchToken(await this.readConfig());
  }

  async getValidToken() {
    if (this.cachedToken && !isExpired(this.cachedToken)) {
      return this.cachedToken.token;
    }
    if (!this.tokenRequest) {
      this.tokenRequest = this.readConfig().then((config) => this.fetchToken(config)).finally(() => {
        this.tokenRequest = null;
      });
    }
    const token = await this.tokenRequest;
    this.cachedToken = token;
    return token.token;
  }

  invalidateToken() {
    this.cachedToken = null;
    this.tokenRequest = null;
  }

  async requestWithToken<T>(path: string, options: { method: "GET" | "POST" }, retryOnAuth = true): Promise<T> {
    const token = await this.getValidToken();
    try {
      return await this.requestJson<T>(path, {
        method: options.method,
        headers: { Accept: "application/json", Authorization: `token ${token}` }
      });
    } catch (error) {
      if (retryOnAuth && error instanceof GisceHttpError && isAuthStatus(error.statusCode)) {
        this.invalidateToken();
        const refreshed = await this.getValidToken();
        try {
          return await this.requestJson<T>(path, {
            method: options.method,
            headers: { Accept: "application/json", Authorization: `token ${refreshed}` }
          });
        } catch (retryError) {
          throw normalizeRequestError(retryError);
        }
      }
      throw normalizeRequestError(error);
    }
  }

  private async getList<T>(path: string, filter: unknown[]) {
    const query = new URLSearchParams({ filter: encodeGisceFilter(filter) });
    const payload = await this.requestWithToken<GisceListResponse<T> | T[]>(`${path}?${query.toString()}`, { method: "GET" });
    return Array.isArray(payload) ? payload : Array.isArray(payload.items) ? payload.items : [];
  }

  private async getPagedList<T>(path: string, filter: unknown[], limit: number, schema?: string) {
    const items: T[] = [];
    const seen = new Set<string>();
    let offset = 0;
    let total: number | null = null;
    let pages = 0;
    while (pages < 1000) {
      const query = new URLSearchParams({ filter: encodeGisceFilter(filter), limit: String(limit), offset: String(offset) });
      if (schema) query.set("schema", schema);
      const payload = await this.requestWithToken<GisceListResponse<T> | T[]>(`${path}?${query.toString()}`, { method: "GET" });
      const pageItems = Array.isArray(payload) ? payload : Array.isArray(payload.items) ? payload.items : [];
      pages += 1;
      if (!Array.isArray(payload) && typeof payload.n_items === "number") total = payload.n_items;
      for (const item of pageItems) {
        const key = item && typeof item === "object" && "id" in item ? String((item as { id?: unknown }).id) : JSON.stringify(item);
        if (!seen.has(key)) {
          seen.add(key);
          items.push(item);
        }
      }
      const responseLimit = !Array.isArray(payload) && typeof payload.limit === "number" && payload.limit > 0 ? payload.limit : limit;
      const responseOffset = !Array.isArray(payload) && typeof payload.offset === "number" ? payload.offset : offset;
      if (pageItems.length === 0 || (total !== null && items.length >= total)) break;
      if (pageItems.length < responseLimit && total === null) break;
      offset = responseOffset + responseLimit;
    }
    return { items, pages, total: total ?? items.length };
  }

  private async enrichInvoices(invoices: GisceInvoiceItem[]) {
    if (invoices.length === 0) return invoices;
    const [cups, polissas, tariffs, lines] = await Promise.all([
      this.fetchByIds<GisceNamedItem>("/GiscedataCupsPs", idsFrom(invoices.map((invoice) => gisceMany2oneId(invoice.cups_id)))),
      this.fetchByIds<GisceNamedItem>("/GiscedataPolissa", idsFrom(invoices.map((invoice) => gisceMany2oneId(invoice.polissa_id)))),
      this.fetchByIds<GisceNamedItem>("/GiscedataPolissaTarifa", idsFrom(invoices.map((invoice) => gisceMany2oneId(invoice.tarifa_acces_id)))),
      this.fetchByIds<GisceInvoiceLineItem>("/AccountInvoiceLine", idsFrom(invoices.flatMap((invoice) => invoiceLineIds(invoice.invoice_line))))
    ]);
    const cupsById = mapById(cups);
    const polissaById = mapById(polissas);
    const tariffById = mapById(tariffs);
    const lineById = mapById(lines);
    const accounts = await this.fetchByIds<GisceNamedItem>("/AccountAccount", idsFrom(lines.map((line) => gisceMany2oneId(line.account_id))));
    const accountById = mapById(accounts);

    return invoices.map((invoice) => ({
      ...invoice,
      cups_id: enrichMany2One(invoice.cups_id, cupsById),
      polissa_id: enrichMany2One(invoice.polissa_id, polissaById),
      tarifa_acces_id: enrichMany2One(invoice.tarifa_acces_id, tariffById),
      invoice_line: (invoice.invoice_line ?? []).map((line) => {
        const fullLine = lineById.get(gisceMany2oneId(line) ?? gisceInteger(line.id) ?? -1) ?? line;
        return {
          ...fullLine,
          account_id: enrichMany2One(fullLine.account_id, accountById)
        };
      })
    }));
  }

  private async fetchByIds<T>(path: string, ids: number[]) {
    if (ids.length === 0) return [];
    const rows: T[] = [];
    for (const batch of chunks(ids, 50)) {
      rows.push(...await this.getList<T>(path, [["id", "in", batch]]));
    }
    return rows;
  }

  private async fetchToken(config: GisceConfig): Promise<CachedToken> {
    if (!config.basicAuth) {
      if (config.apiTokenFallback) {
        return { token: config.apiTokenFallback, expiresAtMs: jwtExpiryMs(config.apiTokenFallback), source: "fallback_env" };
      }
      throw new BadGatewayException("GISCE Basic Auth no configurado.");
    }

    let payload: { token?: unknown };
    try {
      payload = await this.requestJson<{ token?: unknown }>("/token", {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Basic ${config.basicAuth}` }
      });
    } catch (error) {
      throw normalizeRequestError(error);
    }
    if (typeof payload.token !== "string" || !payload.token.trim()) {
      throw new BadGatewayException("GISCE authentication failed: token no recibido.");
    }
    this.logger.log("GISCE authentication: token obtained");
    return { token: payload.token.trim(), expiresAtMs: jwtExpiryMs(payload.token.trim()), source: "token_endpoint" };
  }

  async invoiceFieldNames() {
    const config = await this.readConfig();
    return {
      invoiceDateField: config.invoiceDateField,
      invoiceStartField: config.invoiceStartField,
      invoiceEndField: config.invoiceEndField
    };
  }

  private async requestJson<T>(path: string, options: { method: "GET" | "POST"; headers: Record<string, string> }): Promise<T> {
    const config = await this.readConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(config.timeoutMs, 1000));
    try {
      const response = await fetch(buildUrl(config.baseUrl, path), {
        method: options.method,
        signal: controller.signal,
        headers: options.headers
      });
      const text = await response.text();
      if (!response.ok) {
        throw new GisceHttpError(safeHttpMessage(response.status, text), response.status);
      }
      return (text ? JSON.parse(text) : {}) as T;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new BadGatewayException("Tiempo de espera agotado conectando con GISCE.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readStoredConfig() {
    try {
      return await this.prisma.cmGisceConfig.findUnique({ where: { id: 1 } });
    } catch {
      return null;
    }
  }

  private async readConfig(): Promise<GisceConfig> {
    const stored = await this.readStoredConfig();
    const decryptedPassword = stored?.passwordEncrypted ? decryptSecret(stored.passwordEncrypted) : null;
    return {
      baseUrl: (stored?.baseUrl?.trim() || process.env.GISCE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
      basicAuth: stored?.username && decryptedPassword ? Buffer.from(`${stored.username}:${decryptedPassword}`).toString("base64") : readBasicAuth(),
      apiTokenFallback: process.env.GISCE_API_TOKEN?.trim() || null,
      timeoutMs: stored?.timeoutMs ?? numberEnv("GISCE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
      invoiceDateField: stored?.invoiceDateField?.trim() || process.env.GISCE_INVOICE_DATE_FIELD?.trim() || "date_invoice",
      invoiceStartField: stored?.invoiceStartField?.trim() || process.env.GISCE_INVOICE_PERIOD_START_FIELD?.trim() || "data_inici",
      invoiceEndField: stored?.invoiceEndField?.trim() || process.env.GISCE_INVOICE_PERIOD_END_FIELD?.trim() || "data_final"
    };
  }
}

export type GisceMany2One = { id?: number; name?: string } | false | null;

type GisceNamedItem = {
  id?: number;
  name?: string;
  [key: string]: unknown;
};

export type GiscePriceListItem = {
  id?: number;
  name?: string;
  compatible_invoicing_modes?: GisceNamedItem[] | null;
  [key: string]: unknown;
} | false | null;

export type GisceInvoiceLineItem = {
  id?: number;
  account_id?: GisceMany2One;
  name?: string;
  quantity?: number | string | null;
  price_unit?: number | string | null;
  price_subtotal?: number | string | null;
};

export type GisceInvoiceItem = {
  id?: number;
  number?: string;
  cups_id?: GisceMany2One;
  polissa_id?: GisceMany2One;
  invoice_line?: GisceInvoiceLineItem[];
  date_invoice?: string;
  data_factura?: string;
  data_inici?: string;
  data_inicial?: string;
  data_final?: string;
  type?: string;
  tarifa_acces_id?: GisceMany2One;
  tarifa?: string;
  llista_preu?: GiscePriceListItem;
  [key: string]: unknown;
};

export type GisceF1Item = GisceMeasureItem & {
  measure_type?: number | null;
};

export type GisceF5dItem = GisceMeasureItem & {
  ai_fix?: boolean | null;
  ao_fix?: boolean | null;
  bill?: string | null;
};

export type GisceP1Item = GisceMeasureItem & {
  aiquality?: string | number | null;
  aoquality?: string | number | null;
  r1quality?: string | number | null;
  r2quality?: string | number | null;
  r3quality?: string | number | null;
  r4quality?: string | number | null;
  measure_type?: number | null;
  type?: string | null;
};

export type GisceP5dItem = GisceMeasureItem & {
  measure_type?: number | null;
  type?: string | null;
  season?: number | null;
};

export type GisceMeasureItem = {
  id?: number;
  name?: string;
  datetime?: string;
  ai?: number | string | null | false;
  ao?: number | string | null | false;
  r1?: number | string | null | false;
  r2?: number | string | null | false;
  r3?: number | string | null | false;
  r4?: number | string | null | false;
  source?: number | null;
  validated?: boolean | null;
  create_at?: string | null;
  update_at?: string | null;
  [key: string]: unknown;
};

function readBasicAuth() {
  const direct = process.env.GISCE_BASIC_AUTH?.trim();
  if (direct) return direct;
  const username = process.env.GISCE_BASIC_USERNAME?.trim();
  const password = process.env.GISCE_BASIC_PASSWORD ?? "";
  if (!username || !password) return null;
  return Buffer.from(`${username}:${password}`).toString("base64");
}

function encryptSecret(value: string) {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptSecret(value: string) {
  const [version, ivText, tagText, encryptedText] = value.split(":");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) {
    throw new BadGatewayException("Configuracion GISCE cifrada no valida.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new BadGatewayException("No se pudo descifrar la configuracion GISCE.");
  }
}

function encryptionKey() {
  const secret = process.env.GISCE_CONFIG_ENCRYPTION_KEY?.trim() || process.env.APP_AUTH_TOKEN_SECRET?.trim();
  if (!secret) {
    throw new BadRequestException("GISCE_CONFIG_ENCRYPTION_KEY o APP_AUTH_TOKEN_SECRET no configurado para guardar credenciales GISCE.");
  }
  return createHash("sha256").update(secret).digest();
}

function cleanUrl(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().replace(/\/+$/, "") : null;
}

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanField(value: unknown) {
  const text = cleanText(value);
  return text && /^[A-Za-z0-9_.]+$/.test(text) ? text : null;
}

function cleanTimeout(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1000 && parsed <= 300000 ? parsed : DEFAULT_TIMEOUT_MS;
}

function fieldNamesFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];
  const object = payload as { res?: unknown };
  const fields = object.res && typeof object.res === "object" ? object.res : payload;
  return Object.keys(fields as Record<string, unknown>).sort();
}

function statusFromGisceError(error: unknown) {
  return error instanceof GisceHttpError ? error.statusCode : null;
}

function classifyGisceError(error: unknown) {
  if (error instanceof GisceHttpError && isAuthStatus(error.statusCode)) return "AUTHENTICATION_ERROR";
  if (error instanceof GisceHttpError && error.statusCode === 404) return "ENDPOINT_ERROR";
  if (error instanceof GisceHttpError && error.statusCode >= 400) return "GISCE_HTTP_ERROR";
  return "CONNECTION_OR_CONFIGURATION_ERROR";
}

function safePublicError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Basic\s+[A-Za-z0-9+/=_-]+/g, "Basic <hidden>").replace(/token\s+[A-Za-z0-9._-]+/gi, "token <hidden>");
}

function encodeGisceFilter(filter: unknown[]) {
  return `[${filter.map((item) => {
    const [field, operator, value] = item as [string, string, unknown];
    return `('${escapeFilter(field)}','${escapeFilter(operator)}',${operator.toLowerCase() === "in" ? encodeFilterTuple(value) : encodeFilterValue(value)})`;
  }).join(",")}]`;
}

function encodeFilterTuple(value: unknown): string {
  const values = Array.isArray(value) ? value : [value];
  return `(${values.map(encodeFilterValue).join(",")})`;
}

function encodeFilterValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(encodeFilterValue).join(",")}]`;
  }
  if (typeof value === "number") return String(value);
  return `'${escapeFilter(String(value))}'`;
}

function escapeFilter(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function idsFrom(values: Array<number | null>) {
  return [...new Set(values.filter((value): value is number => value !== null))];
}

function chunks<T>(values: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function mapById<T extends { id?: unknown }>(rows: T[]) {
  const map = new Map<number, T>();
  for (const row of rows) {
    const id = gisceInteger(row.id);
    if (id !== null) map.set(id, row);
  }
  return map;
}

function enrichMany2One(value: GisceMany2One | undefined, rows: Map<number, GisceNamedItem>): GisceMany2One {
  const id = gisceMany2oneId(value);
  if (id === null) return value ?? null;
  const row = rows.get(id);
  return {
    ...(value && typeof value === "object" ? value : {}),
    id,
    ...(typeof row?.name === "string" ? { name: row.name } : {})
  };
}

function invoiceLineIds(lines?: GisceInvoiceLineItem[]) {
  return (lines ?? []).map((line) => gisceInteger(line.id) ?? gisceMany2oneId(line));
}

function gisceInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function gisceMany2oneId(value: unknown) {
  return value && typeof value === "object" && "id" in value ? gisceInteger((value as { id?: unknown }).id) : null;
}

function buildUrl(baseUrl: string, pathOrUrl: string) {
  return /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${baseUrl}/${pathOrUrl.replace(/^\/+/, "")}`;
}

function safeHttpMessage(status: number, text: string) {
  if (isAuthStatus(status)) {
    return `GISCE authentication failed: HTTP ${status}`;
  }
  const extracted = extractError(text);
  return extracted ? `Error GISCE ${status}: ${extracted}` : `Error GISCE ${status}.`;
}

function extractError(text: string) {
  try {
    const payload = JSON.parse(text) as { message?: unknown; error?: unknown; detail?: unknown };
    return textValue(payload.message) ?? textValue(payload.error) ?? textValue(payload.detail);
  } catch {
    return text.trim() || undefined;
  }
}

function normalizeRequestError(error: unknown) {
  if (error instanceof BadGatewayException) return error;
  if (error instanceof GisceHttpError) return new BadGatewayException(error.message);
  return new BadGatewayException(error instanceof Error ? error.message : "Error conectando con GISCE.");
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function jwtExpiryMs(token: string) {
  const [, payload] = token.split(".");
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const parsed = JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as { exp?: unknown };
    return typeof parsed.exp === "number" ? parsed.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isExpired(token: CachedToken) {
  return token.expiresAtMs !== null && Date.now() + TOKEN_EXPIRY_MARGIN_MS >= token.expiresAtMs;
}

function isAuthStatus(statusCode: number) {
  return statusCode === 401 || statusCode === 403;
}

class GisceHttpError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

type GisceListResponse<T> = {
  items?: T[];
  limit?: number;
  offset?: number;
  n_items?: number;
};
