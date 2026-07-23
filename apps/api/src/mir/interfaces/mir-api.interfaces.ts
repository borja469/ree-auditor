export type MirApiContractItem = Record<string, unknown>;

export type MirApiContractsResponse = {
  items?: MirApiContractItem[];
  results?: MirApiContractItem[];
  data?: MirApiContractItem[] | { items?: MirApiContractItem[] };
  next?: string | null;
  next_url?: string | null;
  total?: number;
  count?: number;
  total_count?: number;
  n_items?: number;
  limit?: number;
  offset?: number;
};

export type MirContract = {
  mirContractId: number;
  policyId: number | null;
  policyCode: string | null;
  commercialId: number | null;
  commercialName: string | null;
  annualConsumption: string | null;
  contractEndDate: Date | null;
  tariffId: number | null;
  tariffName: string | null;
  priceListId: number | null;
  priceListName: string | null;
  synchronizedAt: Date;
  validationErrors: string[];
  rawPayloadJson: MirApiContractItem;
};

export type MirContractQuery = {
  policy?: string;
  policies?: string[];
  commercial?: string;
  commercials?: string[];
  tariff?: string;
  tariffs?: string[];
  priceList?: string;
  priceLists?: string[];
  contractEndDateFrom?: string;
  contractEndDateTo?: string;
  minAnnualConsumption?: number;
  maxAnnualConsumption?: number;
  referenceDate?: string;
  skip?: number;
  take?: number;
};

export type MirSyncSummary = {
  received: number;
  created: number;
  updated: number;
  errors: number;
  synchronizedAt: string;
  errorDetails: Array<{
    row: number;
    message: string;
  }>;
};

export type MirConfigDto = {
  apiUrl: string | null;
  contractsPath: string;
  username: string | null;
  passwordConfigured: boolean;
  timeoutMs: number;
  retries: number;
  updatedAt: string | null;
};

export type MirConfigInput = {
  apiUrl?: string | null;
  contractsPath?: string | null;
  username?: string | null;
  password?: string | null;
  timeoutMs?: number | null;
  retries?: number | null;
};
