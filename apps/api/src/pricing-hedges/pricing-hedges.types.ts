export type PricingHedgeOperationType = "COMPRA" | "VENTA";

export type PricingHedgeProduct = {
  cod: string;
  label: string;
  tipo: string | null;
  clase: string | null;
  periodo: string | null;
  entrega: string | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  horasBase: number | null;
  horasPunta: number | null;
  latestPrice: number | null;
  latestPriceDate: string | null;
};

export type PricingHedgeOperationInput = {
  contractDate: string;
  operationType: PricingHedgeOperationType;
  productCod: string;
  powerMw: number;
  contractedPrice: number;
  broker?: string | null;
  observations?: string | null;
};

export type PricingHedgeOperation = PricingHedgeOperationInput & {
  id: string;
  product: PricingHedgeProduct | null;
  volumeMwh: number | null;
  createdAt: string;
  updatedAt: string;
};

export type PricingHedgePosition = {
  productCod: string;
  product: PricingHedgeProduct | null;
  productLabel: string;
  tipo: string | null;
  clase: string | null;
  mwComprados: number;
  mwVendidos: number;
  mwCerrados: number;
  mwNetos: number;
  mwhCerrados: number | null;
  mwhNetos: number | null;
  precioMedioCompra: number | null;
  precioMedioVenta: number | null;
  precioMedioPosicionAbierta: number | null;
  precioMercado: number | null;
  fechaPrecioMercado: string | null;
  valorMercado: number | null;
  resultadoLatente: number | null;
  margenRealizado: number | null;
  resultadoTotal: number | null;
  operations: PricingHedgeOperation[];
};

export type PricingHedgesResponse = {
  operations: PricingHedgeOperation[];
  positions: PricingHedgePosition[];
  products: PricingHedgeProduct[];
  summary: {
    openPositions: number;
    openMw: number;
    openMwh: number;
    marketValue: number;
    latentResult: number;
    realizedResult: number;
    totalResult: number;
  };
};
