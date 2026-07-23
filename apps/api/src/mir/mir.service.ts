import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { MirConfigDto, MirConfigInput, MirContractQuery } from "./interfaces/mir-api.interfaces";
import { MirContractRepository } from "./repositories/mir-contract.repository";

@Injectable()
export class MirService {
  constructor(
    private readonly repository: MirContractRepository,
    private readonly prisma: PrismaService
  ) {}

  listContracts(query: MirContractQuery) {
    return this.repository.findMany(query);
  }

  getContract(id: string) {
    return this.repository.findById(id);
  }

  clearContracts() {
    return this.repository.deleteAll();
  }

  async getConfig(): Promise<MirConfigDto> {
    return serializeConfig(await this.getOrCreateConfig());
  }

  async saveConfig(input: MirConfigInput): Promise<MirConfigDto> {
    const current = await this.getOrCreateConfig();
    const apiUrl = normalizeOptionalText(input.apiUrl);
    const contractsPath = normalizeOptionalText(input.contractsPath);
    const username = normalizeOptionalText(input.username);
    const password = input.password;
    const timeoutMs = input.timeoutMs;
    const retries = input.retries;

    if (apiUrl !== undefined && apiUrl !== null && !isValidHttpUrl(apiUrl)) {
      throw new BadRequestException("URL MIR no valida.");
    }
    if (contractsPath !== undefined && contractsPath !== null && !contractsPath.startsWith("/") && !isValidHttpUrl(contractsPath)) {
      throw new BadRequestException("Ruta de polizas MIR no valida.");
    }
    if (timeoutMs !== undefined && timeoutMs !== null && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000)) {
      throw new BadRequestException("Timeout debe estar entre 1000 y 600000 ms.");
    }
    if (retries !== undefined && retries !== null && (!Number.isSafeInteger(retries) || retries < 0 || retries > 10)) {
      throw new BadRequestException("Reintentos debe estar entre 0 y 10.");
    }

    const updated = await this.prisma.mirConfig.update({
      where: { id: current.id },
      data: {
        apiUrl: apiUrl === undefined ? undefined : apiUrl,
        contractsPath: contractsPath === undefined ? undefined : contractsPath ?? "/contracts",
        username: username === undefined ? undefined : username,
        password: password === undefined ? undefined : normalizeOptionalText(password),
        timeoutMs: timeoutMs ?? undefined,
        retries: retries ?? undefined
      }
    });
    return serializeConfig(updated);
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
        timeoutMs: numberEnv("MIR_TIMEOUT_MS", 60000),
        retries: numberEnv("MIR_RETRIES", 3)
      }
    });
  }
}

function serializeConfig(config: {
  apiUrl: string | null;
  contractsPath: string;
  username: string | null;
  password: string | null;
  timeoutMs: number;
  retries: number;
  updatedAt: Date;
}): MirConfigDto {
  return {
    apiUrl: config.apiUrl,
    contractsPath: config.contractsPath,
    username: config.username,
    passwordConfigured: Boolean(config.password),
    timeoutMs: config.timeoutMs,
    retries: config.retries,
    updatedAt: config.updatedAt?.toISOString() ?? null
  };
}

function normalizeOptionalText(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}
