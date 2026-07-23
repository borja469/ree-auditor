import { Injectable, Logger } from "@nestjs/common";
import { MirClientService } from "./mir-client.service";
import { MirContractRepository } from "./repositories/mir-contract.repository";
import type { MirApiContractItem, MirContract, MirSyncSummary } from "./interfaces/mir-api.interfaces";

@Injectable()
export class MirSyncService {
  private readonly logger = new Logger(MirSyncService.name);

  constructor(
    private readonly client: MirClientService,
    private readonly repository: MirContractRepository
  ) {}

  async syncAll(): Promise<MirSyncSummary> {
    const synchronizedAt = new Date();
    const startedAt = Date.now();
    const items = await this.client.fetchContracts();
    const contracts: MirContract[] = [];
    const errorDetails: MirSyncSummary["errorDetails"] = [];
    items.forEach((item, index) => {
      try {
        contracts.push(normalizeContract(item, synchronizedAt));
      } catch (error) {
        errorDetails.push({ row: index + 1, message: error instanceof Error ? error.message : String(error) });
      }
    });
    const result = await this.repository.upsertMany(contracts);
    this.logger.log(`Sincronizacion MIR finalizada: recibidas=${items.length}; nuevas=${result.created}; actualizadas=${result.updated}; errores=${errorDetails.length}; tiempoMs=${Date.now() - startedAt}.`);
    return {
      received: items.length,
      created: result.created,
      updated: result.updated,
      errors: errorDetails.length,
      synchronizedAt: synchronizedAt.toISOString(),
      errorDetails
    };
  }
}

function normalizeContract(item: MirApiContractItem, synchronizedAt: Date): MirContract {
  const validationErrors: string[] = [];
  const mirContractId = toInteger(item.id);
  if (!mirContractId) {
    throw new Error("Poliza MIR sin id de contrato; no se puede garantizar idempotencia.");
  }
  const policy = readObject(item.polissa_id ?? item.policy_id ?? item.policy);
  const commercial = readObject(policy?.comercial_id ?? policy?.commercial_id ?? item.comercial_id ?? item.commercial_id);
  const tariff = readObject(item.tarifa ?? item.tariff);
  const priceList = readObject(item.llista_preu ?? item.price_list ?? item.priceList);
  const annualConsumption = toDecimalText(item.consumo_anual_inicial ?? item.annual_consumption ?? item.annualConsumption);
  const contractEndDate = parseDate(toText(item.data_final) ?? toText(item.contract_end_date) ?? toText(item.contractEndDate));
  pushMissing(validationErrors, "policy_id", policy ? toInteger(policy.id) : null);
  pushMissing(validationErrors, "policy_code", policy ? toText(policy.name) : null);
  pushMissing(validationErrors, "commercial_id", commercial ? toInteger(commercial.id) : null);
  pushMissing(validationErrors, "commercial_name", commercial ? toText(commercial.name) : null);
  pushMissing(validationErrors, "annual_consumption", annualConsumption);
  pushMissing(validationErrors, "contract_end_date", contractEndDate);
  pushMissing(validationErrors, "tariff_id", tariff ? toInteger(tariff.id) : null);
  pushMissing(validationErrors, "tariff_name", tariff ? toText(tariff.name) : null);
  pushMissing(validationErrors, "price_list_id", priceList ? toInteger(priceList.id) : null);
  pushMissing(validationErrors, "price_list_name", priceList ? toText(priceList.name) : null);
  return {
    mirContractId,
    policyId: policy ? toInteger(policy.id) ?? null : null,
    policyCode: policy ? toText(policy.name) : null,
    commercialId: commercial ? toInteger(commercial.id) ?? null : null,
    commercialName: commercial ? toText(commercial.name) : null,
    annualConsumption,
    contractEndDate,
    tariffId: tariff ? toInteger(tariff.id) ?? null : null,
    tariffName: tariff ? toText(tariff.name) : null,
    priceListId: priceList ? toInteger(priceList.id) ?? null : null,
    priceListName: priceList ? toText(priceList.name) : null,
    synchronizedAt,
    validationErrors,
    rawPayloadJson: item
  };
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function pushMissing(errors: string[], field: string, value: unknown) {
  if (value === null || value === undefined || value === "") errors.push(`${field} no informado`);
}

function toText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toInteger(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(number) ? number : undefined;
}

function toDecimalText(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? normalized : null;
}

function parseDate(value: string | null) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
