export type GuaranteeVolumeSource = "REAL" | "PREVIOUS_WEEK" | "MISSING";
export type GuaranteePriceSource = "OMIE" | "MEFF" | "MISSING";
export type GuaranteeInvoicingSource = "REAL" | "ESTIMATED" | "MISSING";

export type GuaranteeCalculatorRow = {
  date: string;
  displayDate: string;
  weekday: string;
  volume: number | null;
  volumeSource: GuaranteeVolumeSource;
  volumeSourceDate: string | null;
  price: number | null;
  priceSource: GuaranteePriceSource;
  pricePublicationDate: string | null;
  meffCode: string | null;
  invoicingAmount: number | null;
  invoicingSource: GuaranteeInvoicingSource;
  accumulatedInvoicing: number;
  depositedGuarantee: number | null;
  prepaidPayment: number | null;
  availableGuarantee: number | null;
  warnings: string[];
};

export type GuaranteeCalculatorResponse = {
  referenceDate: string;
  startDate: string;
  endDate: string;
  rows: GuaranteeCalculatorRow[];
  summary: {
    totalVolume: number;
    totalInvoicing: number;
    daysWithRealVolume: number;
    daysWithSubstitutedVolume: number;
    daysWithOmiePrice: number;
    daysWithMeffPrice: number;
    daysWithMissingData: number;
  };
};

export type OmieGuaranteeDayData = {
  date: string;
  volume: number | null;
  costWithoutTax: number | null;
};

export type MeffGuaranteePrice = {
  price: number | null;
  publicationDate: string | null;
  code: string | null;
};

export type DepositedGuarantee = {
  date: string;
  amount: number | null;
  prepaidPayment: number | null;
  updatedAt: string;
};
