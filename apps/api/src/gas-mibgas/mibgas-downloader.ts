import { BadGatewayException, BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { GasMibgasDownloadResult } from "./gas-mibgas.types";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES = 2;
const MIN_EXPECTED_BYTES = 100;
const BASE_URL = "https://www.mibgas.es";

type FetchLike = typeof fetch;

@Injectable()
export class MibgasDownloader {
  private readonly logger = new Logger(MibgasDownloader.name);
  private fetchFn: FetchLike = fetch;

  setFetchForTests(fetchFn: FetchLike) {
    this.fetchFn = fetchFn;
  }

  async downloadYear(year: number): Promise<GasMibgasDownloadResult> {
    const normalizedYear = normalizeYear(year);
    const filename = `MIBGAS_Data_${normalizedYear}.csv`;
    const directUrl = `${BASE_URL}/es/file-access/${filename}?path=AGNO_${normalizedYear}%2FXLS`;

    try {
      return await this.downloadCsvUrl(directUrl, normalizedYear, filename);
    } catch (directError) {
      this.logger.warn(`Descarga directa MIBGAS ${normalizedYear} fallida: ${errorMessage(directError)}`);
      const resolvedUrl = await this.resolveCsvUrl(normalizedYear, filename);
      return this.downloadCsvUrl(resolvedUrl, normalizedYear, filename);
    }
  }

  buildDirectUrl(year: number) {
    const normalizedYear = normalizeYear(year);
    return `${BASE_URL}/es/file-access/MIBGAS_Data_${normalizedYear}.csv?path=AGNO_${normalizedYear}%2FXLS`;
  }

  private async resolveCsvUrl(year: number, filename: string) {
    const folderUrl = `${BASE_URL}/es/file-access?path=AGNO_${year}/XLS`;
    const response = await this.fetchWithRetry(folderUrl, { accept: "text/html" });
    const html = await response.text();
    if (!html || !html.includes(filename)) {
      throw new BadGatewayException(`No se encontro ${filename} en la carpeta publica MIBGAS ${year}.`);
    }
    const escaped = escapeRegex(filename);
    const hrefMatch = new RegExp(`<a[^>]+href=["']([^"']*${escaped}[^"']*)["']`, "i").exec(html);
    if (!hrefMatch) {
      throw new BadGatewayException(`No se pudo resolver el enlace de descarga de ${filename}.`);
    }
    return new URL(hrefMatch[1].replace(/&amp;/g, "&"), BASE_URL).toString();
  }

  private async downloadCsvUrl(url: string, year: number, filename: string): Promise<GasMibgasDownloadResult> {
    const response = await this.fetchWithRetry(url, { accept: "text/csv,application/octet-stream,*/*" });
    const contentType = response.headers.get("content-type");
    const arrayBuffer = await response.arrayBuffer();
    const content = Buffer.from(arrayBuffer);
    validateDownloadedBody(content, contentType);
    return {
      year,
      url,
      filename,
      content,
      contentType,
      contentLength: content.length
    };
  }

  private async fetchWithRetry(url: string, options: { accept: string }) {
    let lastError: unknown;
    for (let attempt = 0; attempt <= DEFAULT_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      try {
        const response = await this.fetchFn(url, {
          signal: controller.signal,
          headers: { Accept: options.accept }
        });
        if (!response.ok) {
          throw new MibgasHttpError(`MIBGAS respondio HTTP ${response.status}.`, response.status);
        }
        return response;
      } catch (error) {
        lastError = error;
        if (error instanceof MibgasHttpError && error.statusCode < 500) {
          throw error;
        }
        if (attempt === DEFAULT_RETRIES) {
          throw new BadGatewayException(`Error descargando MIBGAS: ${errorMessage(error)}`);
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new BadGatewayException(`Error descargando MIBGAS: ${errorMessage(lastError)}`);
  }
}

function validateDownloadedBody(content: Buffer, contentType: string | null) {
  if (content.length < MIN_EXPECTED_BYTES) {
    throw new BadGatewayException("MIBGAS devolvio un fichero vacio o demasiado pequeno.");
  }
  const preview = content.subarray(0, Math.min(content.length, 1024)).toString("utf8").trimStart();
  if (/^<(?:!doctype\s+html|html|head|body)\b/i.test(preview) || /<html[\s>]/i.test(preview)) {
    throw new BadGatewayException("MIBGAS devolvio HTML en lugar del CSV esperado.");
  }
  if (contentType && /html/i.test(contentType)) {
    throw new BadGatewayException(`Content-Type MIBGAS no valido: ${contentType}.`);
  }
  if (!preview.includes("Trading day") && !preview.includes("Fecha Emisi")) {
    throw new BadGatewayException("El contenido descargado no parece un CSV MIBGAS valido.");
  }
}

function normalizeYear(year: number) {
  if (!Number.isSafeInteger(year) || year < 2015 || year > 2100) {
    throw new BadRequestException("El ano MIBGAS debe estar entre 2015 y 2100.");
  }
  return year;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

class MibgasHttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}
