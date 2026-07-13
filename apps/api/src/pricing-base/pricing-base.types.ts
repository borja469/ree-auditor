export type PricingBaseStatus = "ok" | "partial" | "missing";
export type PricingSettlementVersion = "C1" | "C2" | "C3" | "C4" | "C5";

export type PricingProfileTariff = "2.0TD" | "3.0TD" | "3.0TDVE";
export type PricingPeriodTariff = "2.0TD" | "3.0TD" | "6.XTD";

export type PricingBaseQuery = {
  fechaReferencia: string;
  incluirFechaReferencia: boolean;
  zonaHoraria: "Europe/Madrid";
  fechaDesde?: string;
  fechaHasta?: string;
  tarifa?: PricingPeriodTariff | "";
  periodo?: "" | "P1" | "P2" | "P3" | "P4" | "P5" | "P6";
  skip: number;
  take: number;
};

export type PricingCalendarHour = {
  fecha: string;
  ano: number;
  mes: number;
  dia: number;
  diaSemana: number;
  diaSemanaNombre: string;
  hora: number;
  timestampInicio: string;
  timestampFin: string;
  cambioHorarioDst: "none" | "spring_forward_23h" | "fall_back_25h";
  ordenDia365: number;
  ordenHora: number;
};

export type QuarterHourInput = Record<string, unknown>;

export type HourlyAverageRow = {
  fecha: string;
  hora: number;
  timestampInicio: string;
  valorPromedioHorario: number | null;
  numCuartos: number;
  status: PricingBaseStatus;
};

export type PricingBaseRow = PricingCalendarHour & {
  perfilIntermedio20TD: number | null;
  perfilIntermedio30TD: number | null;
  perfilIntermedio30TDVE: number | null;
  productoPerfilOmie20TD: number | null;
  productoPerfilOmie30TD: number | null;
  productoPerfilOmie30TDVE: number | null;
  productoPerfilCad20TD: number | null;
  productoPerfilCad30TD: number | null;
  productoPerfilCad30TDVE: number | null;
  productoPerfilRad20TD: number | null;
  productoPerfilRad30TD: number | null;
  productoPerfilRad30TDVE: number | null;
  productoPerfilPerdidas20TD: number | null;
  productoPerfilPerdidas30TD: number | null;
  productoPerfilPerdidas30TDVE: number | null;
  periodo20TD: string;
  periodo30TD: string;
  periodo6XTD: string;
  precioOmie: number | null;
  precioOmieUnidad: "EUR/MWh";
  cad: number | null;
  cadVersion: PricingSettlementVersion | null;
  cadStatus: Extract<PricingBaseStatus, "ok" | "missing">;
  rad: number | null;
  radVersion: PricingSettlementVersion | null;
  radStatus: PricingBaseStatus;
  perdidas: number | null;
  perdidasVersion: PricingSettlementVersion | null;
  perdidasStatus: PricingBaseStatus;
  perfil20TDStatus: PricingBaseStatus;
  perfil30TDStatus: PricingBaseStatus;
  perfil30TDVEStatus: PricingBaseStatus;
  omieStatus: PricingBaseStatus;
};

export type PricingBaseMeffCurveMonth = {
  year: number;
  month: number;
  key: string;
  label: string;
  price: number | null;
  origin: "Mensual" | "Trimestral" | "Anual" | "Calculado" | null;
  productCode: string | null;
  sourceProductCode: string | null;
  previous7DaysPrice: number | null;
  previous14DaysPrice: number | null;
  change7DaysPct: number | null;
  change14DaysPct: number | null;
};

export type PricingBaseMeffProfileRow = PricingCalendarHour & {
  curvaMes: string;
  curvaMesLabel: string;
  precioMeff: number | null;
  precioMeffOrigen: PricingBaseMeffCurveMonth["origin"];
  precioMeffProducto: string | null;
  precioMeffProductoOrigen: string | null;
  perfilIntermedio20TD: number | null;
  perfilIntermedio30TD: number | null;
  perfilIntermedio30TDVE: number | null;
  productoPerfilMeff20TD: number | null;
  productoPerfilMeff30TD: number | null;
  productoPerfilMeff30TDVE: number | null;
  periodo20TD: string;
  periodo30TD: string;
  periodo6XTD: string;
  perfil20TDStatus: PricingBaseStatus;
  perfil30TDStatus: PricingBaseStatus;
  perfil30TDVEStatus: PricingBaseStatus;
  meffStatus: PricingBaseStatus;
};

export type PricingBaseValidation = {
  name: string;
  status: "ok" | "warning" | "error";
  message: string;
};

export type PricingBaseResponse = {
  filters: PricingBaseQuery;
  range: {
    fechaInicio: string;
    fechaFin: string;
    diasNaturales: number;
    expectedHours: number;
    totalRows: number;
  };
  total: number;
  hasNext: boolean;
  rows: PricingBaseRow[];
  meffForward: {
    publicationDate: string | null;
    months: PricingBaseMeffCurveMonth[];
    rows: PricingBaseMeffProfileRow[];
  };
  validations: PricingBaseValidation[];
  sourceData: {
    profiles: "esios_profile_intermediate_results";
    omie: "omie_prices";
    timezone: "Europe/Madrid";
  };
};
