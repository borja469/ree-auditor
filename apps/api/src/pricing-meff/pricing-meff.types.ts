export type PricingMeffImportError = {
  row: number;
  message: string;
};

export type PricingMeffImportResponse = {
  inserted: number;
  updated: number;
  errors: PricingMeffImportError[];
};

export type ParsedPricingMeffRow = {
  fechaPublicacion: Date;
  cod: string;
  tipo: string | null;
  clase: string | null;
  periodo: string | null;
  entrega: string | null;
  multiplicador: string | null;
  precio: number | null;
  rawPayloadJson: Record<string, unknown>;
};

export type PricingMeffQuery = {
  fechaPublicacionDesde?: string;
  fechaPublicacionHasta?: string;
  tipo?: string[];
  periodo?: string[];
  entrega?: string[];
  multiplicador?: string[];
  skip: number;
  take: number;
};

export type PricingMeffComparison = {
  precio: number | null;
  porcentaje: number | null;
};

export type PricingMeffRow = {
  id: string;
  fechaPublicacion: string;
  cod: string;
  tipo: string | null;
  clase: string | null;
  periodo: string | null;
  entrega: string | null;
  multiplicador: string | null;
  precio: number | null;
  precio7Dias: PricingMeffComparison;
  precio14Dias: PricingMeffComparison;
};

export type PricingMeffResponse = {
  total: number;
  rows: PricingMeffRow[];
  filterOptions: {
    tipos: string[];
    periodos: string[];
    entregas: string[];
    multiplicadores: string[];
  };
};
