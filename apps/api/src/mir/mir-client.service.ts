import { BadGatewayException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { MirApiContractItem, MirApiContractsResponse } from "./interfaces/mir-api.interfaces";

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_RETRIES = 3;
const DEFAULT_PAGE_SIZE = 90;
const DEFAULT_MAX_PAGES = 1000;

type MirClientConfig = {
  apiUrl: string;
  contractsPath: string;
  username: string | null;
  password: string | null;
  timeoutMs: number;
  retries: number;
  pageSize: number;
  maxPages: number;
};

@Injectable()
export class MirClientService {
  private readonly logger = new Logger(MirClientService.name);

  constructor(private readonly prisma: PrismaService) {}

  async fetchContracts(): Promise<MirApiContractItem[]> {
    const config = await this.getConfig();
    const items: MirApiContractItem[] = [];
    let nextPath: string | null = config.contractsPath;
    let offset = readOffset(nextPath);
    const limit = readLimit(nextPath) ?? config.pageSize;
    let page = 0;
    const pageSignatures = new Set<string>();
    while (nextPath) {
      page += 1;
      if (page > config.maxPages) {
        throw new BadGatewayException(`Paginacion MIR detenida: se han superado ${config.maxPages} paginas.`);
      }
      const payload = await this.requestJson<MirApiContractsResponse>(nextPath, config);
      const pageItems = extractItems(payload);
      this.logger.log(`MIR ERP pagina ${page}: ${pageItems.length} polizas recibidas.`);
      const signature = pageSignature(pageItems);
      if (signature && pageSignatures.has(signature)) {
        this.logger.warn("MIR ERP devolvio una pagina repetida. Se detiene la paginacion para evitar duplicados.");
        break;
      }
      if (signature) {
        pageSignatures.add(signature);
      }
      items.push(...pageItems);
      const explicitNext = normalizeNextPath(payload.next ?? payload.next_url ?? null, config.apiUrl);
      if (explicitNext) {
        nextPath = explicitNext;
        offset = readOffset(nextPath);
        continue;
      }
      const effectiveLimit = extractLimit(payload) ?? limit;
      const total = extractTotal(payload);
      if (total !== null && items.length >= total) {
        nextPath = null;
        continue;
      }
      if (pageItems.length < effectiveLimit || pageItems.length === 0) {
        nextPath = null;
        continue;
      }
      offset = extractOffset(payload) ?? offset;
      offset += pageItems.length;
      nextPath = withLimitOffset(config.contractsPath, effectiveLimit, offset);
    }
    return items;
  }

  private async getConfig(): Promise<MirClientConfig> {
    const dbConfig = await this.getOrCreateConfig();
    const apiUrl = dbConfig.apiUrl?.trim() || process.env.MIR_API_URL?.trim();
    if (!apiUrl) {
      throw new BadGatewayException("URL MIR no configurada.");
    }
    return {
      apiUrl: apiUrl.replace(/\/+$/, ""),
      contractsPath: dbConfig.contractsPath?.trim() || process.env.MIR_CONTRACTS_PATH?.trim() || "/contracts",
      username: dbConfig.username?.trim() || process.env.MIR_API_USERNAME?.trim() || null,
      password: dbConfig.password?.trim() || process.env.MIR_API_PASSWORD?.trim() || null,
      timeoutMs: dbConfig.timeoutMs || numberEnv("MIR_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
      retries: dbConfig.retries ?? numberEnv("MIR_RETRIES", DEFAULT_RETRIES),
      pageSize: numberEnv("MIR_PAGE_SIZE", DEFAULT_PAGE_SIZE),
      maxPages: numberEnv("MIR_MAX_PAGES", DEFAULT_MAX_PAGES)
    };
  }

  private async getOrCreateConfig() {
    const current = await this.prisma.mirConfig.findUnique({ where: { id: 1 } });
    if (current) {
      return current;
    }
    return this.prisma.mirConfig.create({
      data: {
        id: 1,
        apiUrl: process.env.MIR_API_URL?.trim() || null,
        contractsPath: process.env.MIR_CONTRACTS_PATH?.trim() || "/contracts",
        username: process.env.MIR_API_USERNAME?.trim() || null,
        password: process.env.MIR_API_PASSWORD?.trim() || null,
        timeoutMs: numberEnv("MIR_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
        retries: numberEnv("MIR_RETRIES", DEFAULT_RETRIES)
      }
    });
  }

  private async requestJson<T>(pathOrUrl: string, config: MirClientConfig): Promise<T> {
    const attempts = Math.max(config.retries, 0) + 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(config.timeoutMs, 1000));
      try {
        const response = await fetch(buildUrl(config.apiUrl, pathOrUrl), {
          signal: controller.signal,
          headers: await this.authHeaders(config)
        });
        const text = await response.text();
        if (!response.ok) {
          throw new MirHttpError(extractErrorMessage(text) ?? `Error API MIR ${response.status}.`, response.status);
        }
        return (text ? JSON.parse(text) : {}) as T;
      } catch (error) {
        lastError = error;
        if (error instanceof MirHttpError && (error.statusCode === 401 || error.statusCode === 403 || error.statusCode < 500)) {
          throw new BadGatewayException(error.message);
        }
        if (attempt === attempts - 1) {
          throw new BadGatewayException(normalizeRequestError(error).message || "Error conectando con MIR ERP.");
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new BadGatewayException(normalizeRequestError(lastError).message || "Error conectando con MIR ERP.");
  }

  private async authHeaders(config: MirClientConfig) {
    return {
      Accept: "application/json",
      ...(config.username && config.password ? { Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}` } : {})
    };
  }
}

function extractItems(payload: MirApiContractsResponse): MirApiContractItem[] {
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && typeof payload.data === "object" && Array.isArray(payload.data.items)) return payload.data.items;
  return [];
}

function buildUrl(baseUrl: string, pathOrUrl: string) {
  return /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${baseUrl}/${pathOrUrl.replace(/^\/+/, "")}`;
}

function normalizeNextPath(value: string | null, baseUrl: string) {
  if (!value) return null;
  return value.startsWith(baseUrl) ? value.slice(baseUrl.length) || null : value;
}

function extractTotal(payload: MirApiContractsResponse) {
  const total = payload.total ?? payload.count ?? payload.total_count ?? payload.n_items;
  return typeof total === "number" && Number.isFinite(total) ? total : null;
}

function extractLimit(payload: MirApiContractsResponse) {
  return typeof payload.limit === "number" && Number.isSafeInteger(payload.limit) && payload.limit > 0 ? payload.limit : null;
}

function extractOffset(payload: MirApiContractsResponse) {
  return typeof payload.offset === "number" && Number.isSafeInteger(payload.offset) && payload.offset >= 0 ? payload.offset : null;
}

function readLimit(pathOrUrl: string) {
  return readQueryInteger(pathOrUrl, "limit");
}

function readOffset(pathOrUrl: string) {
  return readQueryInteger(pathOrUrl, "offset") ?? 0;
}

function readQueryInteger(pathOrUrl: string, key: string) {
  try {
    const url = new URL(pathOrUrl, "http://local");
    const value = Number(url.searchParams.get(key));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function withLimitOffset(pathOrUrl: string, limit: number, offset: number) {
  const absolute = /^https?:\/\//i.test(pathOrUrl);
  const url = new URL(pathOrUrl, "http://local");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  return absolute ? url.toString() : `${url.pathname}${url.search}`;
}

function pageSignature(items: MirApiContractItem[]) {
  if (!items.length) {
    return "";
  }
  return items.map((item) => String(item.id ?? "")).join("|");
}

function extractErrorMessage(text: string) {
  try {
    const payload = JSON.parse(text) as { message?: unknown; error?: unknown; detail?: unknown };
    return toText(payload.message) ?? toText(payload.error) ?? toText(payload.detail);
  } catch {
    return text.trim() || undefined;
  }
}

function normalizeRequestError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return new Error("Tiempo de espera agotado conectando con MIR ERP.");
  }
  return error instanceof Error ? error : new Error(String(error));
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function toText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

class MirHttpError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}
