import { Injectable } from "@nestjs/common";
import { buildPricingCalendar, buildPricingCalendarRange, enumerateDateStrings, formatDateOnly, addLocalDays, parseDateOnly } from "./calendar_builder";
import { MeffForwardCurveService } from "./meff_forward_curve_service";
import { PricingOmieLoader } from "./omie_loader";
import { PricingProfilesLoader } from "./profiles_loader";
import { PricingRegulatedCostsLoader } from "./regulated_costs_loader";
import { normalizeTarifa } from "../ree-losses/period-engine";
import { ReeLossesRegulatoryEngine } from "../ree-losses/regulatory-engine.service";
import { resolveTariffPeriod } from "../ree-losses/period-engine";
import type { PricingBaseMeffProfileRow, PricingBaseQuery, PricingBaseResponse, PricingBaseRow, PricingBaseValidation } from "./pricing-base.types";

@Injectable()
export class PricingBaseTableService {
  constructor(
    private readonly profilesLoader: PricingProfilesLoader,
    private readonly omieLoader: PricingOmieLoader,
    private readonly regulatedCostsLoader: PricingRegulatedCostsLoader,
    private readonly meffForwardCurveService: MeffForwardCurveService,
    private readonly regulatoryEngine: ReeLossesRegulatoryEngine
  ) {}

  async buildTable(query: PricingBaseQuery): Promise<PricingBaseResponse> {
    const calendar = buildPricingCalendar(query.fechaReferencia, query.incluirFechaReferencia);
    const fechaInicio = calendar[0]?.fecha ?? query.fechaReferencia;
    const fechaFin = calendar[calendar.length - 1]?.fecha ?? query.fechaReferencia;
    const [profiles, omie, regulatedCosts20TD, regulatedCosts30TD, regulatedCosts61TD, meffForward] = await Promise.all([
      this.profilesLoader.loadProfiles(fechaInicio, fechaFin),
      this.omieLoader.loadMercadoDiario(fechaInicio, fechaFin),
      this.regulatedCostsLoader.load(calendar, "2.0TD"),
      this.regulatedCostsLoader.load(calendar, "3.0TD"),
      this.regulatedCostsLoader.load(calendar, "6.XTD"),
      this.meffForwardCurveService.buildNextTwelveMonths(query.fechaReferencia)
    ]);
    const periodContext = await this.regulatoryEngine.buildPeriodContext();
    const allRows = calendar.map<PricingBaseRow>((row) => {
      const profile = { ...defaultProfileValues(), ...(profiles.get(`${row.fecha}|${row.ordenHora}`) ?? {}) };
      const omieValue = omie.get(`${row.fecha}|${row.ordenHora - 1}`) ?? { value: null, status: "missing" as const };
      const regulatedKey = `${row.fecha}|${row.ordenHora}`;
      const cad = regulatedCosts20TD.cad.get(regulatedKey) ?? { value: null, version: null, status: "missing" as const };
      const rad = regulatedCosts20TD.rad.get(regulatedKey) ?? { value: null, version: null, status: "missing" as const };
      const perdidas20TD = regulatedCosts20TD.perdidas.get(regulatedKey) ?? { value: null, version: null, status: "missing" as const };
      const perdidas30TD = regulatedCosts30TD.perdidas.get(regulatedKey) ?? { value: null, version: null, status: "missing" as const };
      const perdidas61TD = regulatedCosts61TD.perdidas.get(regulatedKey) ?? { value: null, version: null, status: "missing" as const };
      return {
        ...row,
        perfilIntermedio20TD: profile.profile20td,
        perfilIntermedio30TD: profile.profile30td,
        perfilIntermedio30TDVE: profile.profile30tdve,
        perfilIntermedio61TD: profile.profile61td,
        productoPerfilOmie20TD: multiplyNullable(profile.profile20td, omieValue.value),
        productoPerfilOmie30TD: multiplyNullable(profile.profile30td, omieValue.value),
        productoPerfilOmie30TDVE: multiplyNullable(profile.profile30tdve, omieValue.value),
        productoPerfilOmie61TD: multiplyNullable(profile.profile61td, omieValue.value),
        productoPerfilCad20TD: multiplyNullable(profile.profile20td, cad.value),
        productoPerfilCad30TD: multiplyNullable(profile.profile30td, cad.value),
        productoPerfilCad30TDVE: multiplyNullable(profile.profile30tdve, cad.value),
        productoPerfilCad61TD: multiplyNullable(profile.profile61td, cad.value),
        productoPerfilRad20TD: multiplyNullable(profile.profile20td, rad.value),
        productoPerfilRad30TD: multiplyNullable(profile.profile30td, rad.value),
        productoPerfilRad30TDVE: multiplyNullable(profile.profile30tdve, rad.value),
        productoPerfilRad61TD: multiplyNullable(profile.profile61td, rad.value),
        productoPerfilPerdidas20TD: multiplyNullable(profile.profile20td, perdidas20TD.value),
        productoPerfilPerdidas30TD: multiplyNullable(profile.profile30td, perdidas30TD.value),
        productoPerfilPerdidas30TDVE: multiplyNullable(profile.profile30tdve, perdidas30TD.value),
        productoPerfilPerdidas61TD: multiplyNullable(profile.profile61td, perdidas61TD.value),
        perdidas20TD: perdidas20TD.value,
        perdidas30TD: perdidas30TD.value,
        perdidas61TD: perdidas61TD.value,
        periodo20TD: resolvePricingPeriod("2.0TD", row, periodContext),
        periodo30TD: resolvePricingPeriod("3.0TD", row, periodContext),
        periodo6XTD: resolvePricingPeriod("6.1TD", row, periodContext),
        profileSource20TD: profile.profile20tdSource,
        profileSource30TD: profile.profile30tdSource,
        profileSource30TDVE: profile.profile30tdveSource,
        profileSource61TD: profile.profile61tdSource,
        precioOmie: omieValue.value,
        precioOmieUnidad: "EUR/MWh",
        cad: cad.value,
        cadVersion: cad.version,
        cadStatus: cad.status === "ok" ? "ok" : "missing",
        rad: rad.value,
        radVersion: rad.version,
        radStatus: rad.status,
        perdidas: perdidas20TD.value,
        perdidasVersion: perdidas20TD.version,
        perdidasStatus: worstStatus([perdidas20TD.status, perdidas30TD.status, perdidas61TD.status]),
        perfil20TDStatus: profile.profile20tdStatus,
        perfil30TDStatus: profile.profile30tdStatus,
        perfil30TDVEStatus: profile.profile30tdveStatus,
        omieStatus: omieValue.status
      };
    });

    const filteredRows = filterRows(allRows, query, periodContext);
    const pageRows = filteredRows.slice(query.skip, query.skip + query.take);
    const meffRows = await this.buildMeffProfileRows(meffForward.months, periodContext);
    return {
      filters: query,
      range: {
        fechaInicio,
        fechaFin,
        diasNaturales: enumerateDateStrings(parseDateOnly(fechaInicio), parseDateOnly(fechaFin)).length,
        expectedHours: calendar.length,
        totalRows: allRows.length
      },
      total: filteredRows.length,
      hasNext: query.skip + pageRows.length < filteredRows.length,
      rows: pageRows,
      meffForward: {
        publicationDate: meffForward.publicationDate,
        months: meffForward.months,
        rows: meffRows
      },
      validations: validatePricingBaseTable(allRows),
      profileSources: [
        { tariff: "2.0TD", profileSource: "REE_PROFILE" },
        { tariff: "3.0TD", profileSource: "REE_PROFILE" },
        { tariff: "3.0TDVE", profileSource: "REE_PROFILE" },
        { tariff: "6.1TD", profileSource: "UNIT_PROFILE" }
      ],
      sourceData: {
        profiles: "esios_profile_intermediate_results",
        omie: "omie_prices",
        timezone: "Europe/Madrid"
      }
    };
  }

  private async buildMeffProfileRows(
    months: PricingBaseResponse["meffForward"]["months"],
    periodContext: Awaited<ReturnType<ReeLossesRegulatoryEngine["buildPeriodContext"]>>
  ): Promise<PricingBaseMeffProfileRow[]> {
    if (months.length === 0) {
      return [];
    }
    const first = months[0];
    const last = months[months.length - 1];
    const fechaInicio = `${first.year}-${String(first.month).padStart(2, "0")}-01`;
    const fechaFin = formatDateOnly(addLocalDays({ year: last.year, month: last.month + 1, day: 1 }, -1));
    const calendar = buildPricingCalendarRange(fechaInicio, fechaFin);
    const profiles = await this.profilesLoader.loadProfiles(fechaInicio, fechaFin);
    const monthByKey = new Map(months.map((month) => [month.key, month]));

    return calendar.map((row) => {
      const profile = { ...defaultProfileValues(), ...(profiles.get(`${row.fecha}|${row.ordenHora}`) ?? {}) };
      const curveMonth = monthByKey.get(`${row.ano}-${String(row.mes).padStart(2, "0")}`);
      const price = curveMonth?.price ?? null;
      const profile20td = profile.profile20td;
      const profile30td = profile.profile30td;
      const profile30tdve = profile.profile30tdve;
      const profile61td = profile.profile61td;
      return {
        ...row,
        curvaMes: curveMonth?.key ?? `${row.ano}-${String(row.mes).padStart(2, "0")}`,
        curvaMesLabel: curveMonth?.label ?? `${row.mes}/${String(row.ano).slice(2)}`,
        precioMeff: price,
        precioMeffOrigen: curveMonth?.origin ?? null,
        precioMeffProducto: curveMonth?.productCode ?? null,
        precioMeffProductoOrigen: curveMonth?.sourceProductCode ?? null,
        perfilIntermedio20TD: profile20td,
        perfilIntermedio30TD: profile30td,
        perfilIntermedio30TDVE: profile30tdve,
        perfilIntermedio61TD: profile61td,
        productoPerfilMeff20TD: multiplyNullable(profile20td, price),
        productoPerfilMeff30TD: multiplyNullable(profile30td, price),
        productoPerfilMeff30TDVE: multiplyNullable(profile30tdve, price),
        productoPerfilMeff61TD: multiplyNullable(profile61td, price),
        periodo20TD: resolvePricingPeriod("2.0TD", row, periodContext),
        periodo30TD: resolvePricingPeriod("3.0TD", row, periodContext),
        periodo6XTD: resolvePricingPeriod("6.1TD", row, periodContext),
        profileSource20TD: profile.profile20tdSource,
        profileSource30TD: profile.profile30tdSource,
        profileSource30TDVE: profile.profile30tdveSource,
        profileSource61TD: profile.profile61tdSource,
        perfil20TDStatus: profile.profile20td === null ? "partial" : profile.profile20tdStatus,
        perfil30TDStatus: profile.profile30td === null ? "partial" : profile.profile30tdStatus,
        perfil30TDVEStatus: profile.profile30tdve === null ? "partial" : profile.profile30tdveStatus,
        meffStatus: price === null ? "missing" : "ok"
      };
    });
  }
}

function resolvePricingPeriod(
  tariff: "2.0TD" | "3.0TD" | "6.1TD",
  row: Pick<PricingBaseRow, "fecha" | "hora">,
  periodContext: Awaited<ReturnType<ReeLossesRegulatoryEngine["buildPeriodContext"]>>
) {
  return (
    resolveTariffPeriod({
      tarifa: tariff,
      fecha: new Date(`${row.fecha}T00:00:00.000Z`),
      hora: row.hora,
      cuartohora: 1,
      rules: periodContext.rules,
      holidays: periodContext.holidays
    })?.periodo ?? ""
  );
}

export function validatePricingBaseTable(rows: PricingBaseRow[]): PricingBaseValidation[] {
  const dates = new Set(rows.map((row) => row.fecha));
  const timestampCounts = new Map<string, number>();
  for (const row of rows) {
    timestampCounts.set(row.timestampInicio, (timestampCounts.get(row.timestampInicio) ?? 0) + 1);
  }
  const duplicateTimestamps = [...timestampCounts.values()].filter((count) => count > 1).length;
  const nullCritical = rows.filter((row) => !row.fecha || row.hora === null || !row.timestampInicio || !row.timestampFin || !row.periodo20TD || !row.periodo30TD || !row.periodo6XTD).length;
  const invalidPeriods = rows.filter((row) => !/^P[1-6]$/.test(row.periodo20TD) || !/^P[1-6]$/.test(row.periodo30TD) || !/^P[1-6]$/.test(row.periodo6XTD)).length;
  const profileMissing = rows.filter((row) => row.perfil20TDStatus === "missing" || row.perfil30TDStatus === "missing" || row.perfil30TDVEStatus === "missing").length;
  const omieMissing = rows.filter((row) => row.omieStatus === "missing").length;
  const cadMissing = rows.filter((row) => row.cadStatus === "missing").length;
  const radMissing = rows.filter((row) => row.radStatus === "missing").length;
  const lossesMissing = rows.filter((row) => row.perdidasStatus === "missing").length;

  return [
    validation("rango_365_dias", dates.size === 365, `Dias naturales: ${dates.size} de 365.`),
    validation("horas_calendario_madrid", rows.length >= 365 * 23 && rows.length <= 365 * 25, `Horas generadas: ${rows.length}.`),
    validation("duplicados_timestamp", duplicateTimestamps === 0, `Timestamps duplicados: ${duplicateTimestamps}.`),
    validation("nulos_columnas_criticas", nullCritical === 0, `Filas con nulos criticos: ${nullCritical}.`),
    validation("coherencia_periodos_tarifarios", invalidPeriods === 0, `Periodos no validos: ${invalidPeriods}.`),
    {
      name: "alineacion_perfiles",
      status: profileMissing === 0 ? "ok" : "warning",
      message: `Filas con algun perfil intermedio ausente: ${profileMissing}.`
    },
    {
      name: "alineacion_omie",
      status: omieMissing === 0 ? "ok" : "warning",
      message: `Filas sin precio OMIE suficiente: ${omieMissing}.`
    },
    {
      name: "alineacion_cad",
      status: cadMissing === 0 ? "ok" : "warning",
      message: `Filas sin CAD: ${cadMissing}.`
    },
    {
      name: "alineacion_rad",
      status: radMissing === 0 ? "ok" : "warning",
      message: `Filas sin RAD suficiente: ${radMissing}.`
    },
    {
      name: "alineacion_perdidas",
      status: lossesMissing === 0 ? "ok" : "warning",
      message: `Filas sin perdidas suficientes: ${lossesMissing}.`
    }
  ];
}

export function defaultPricingBaseQuery(input: Partial<Record<string, unknown>>): PricingBaseQuery {
  const fechaReferencia = typeof input.fechaReferencia === "string" && input.fechaReferencia ? input.fechaReferencia : formatDateOnly(addLocalDays(parseDateOnly(new Date().toISOString().slice(0, 10)), 0));
  return {
    fechaReferencia,
    incluirFechaReferencia: input.incluirFechaReferencia === "false" || input.incluirFechaReferencia === false ? false : true,
    zonaHoraria: "Europe/Madrid",
    fechaDesde: typeof input.fechaDesde === "string" && input.fechaDesde ? input.fechaDesde : undefined,
    fechaHasta: typeof input.fechaHasta === "string" && input.fechaHasta ? input.fechaHasta : undefined,
    tarifa: input.tarifa === "2.0TD" || input.tarifa === "3.0TD" || input.tarifa === "6.XTD" ? input.tarifa : "",
    periodo: isPricingPeriod(input.periodo) ? input.periodo : "",
    skip: parseBoundedInteger(input.skip, 0, 0, 1_000_000),
    take: parseBoundedInteger(input.take, 500, 1, 10_000)
  };
}

function filterRows(rows: PricingBaseRow[], query: PricingBaseQuery, periodContext: Awaited<ReturnType<ReeLossesRegulatoryEngine["buildPeriodContext"]>>) {
  return rows.filter((row) => {
    if (query.fechaDesde && row.fecha < query.fechaDesde) {
      return false;
    }
    if (query.fechaHasta && row.fecha > query.fechaHasta) {
      return false;
    }
    if (query.tarifa && query.periodo) {
      const tariff = normalizeTarifa(query.tarifa) ?? query.tarifa;
      const expectedPeriod = resolveTariffPeriod({
        tarifa: tariff,
        fecha: new Date(`${row.fecha}T00:00:00.000Z`),
        hora: row.hora,
        cuartohora: 1,
        rules: periodContext.rules,
        holidays: periodContext.holidays
      })?.periodo;
      if (expectedPeriod !== query.periodo) {
        return false;
      }
    }
    return true;
  });
}

function validation(name: string, ok: boolean, message: string): PricingBaseValidation {
  return { name, status: ok ? "ok" : "error", message };
}

function parseBoundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function isPricingPeriod(value: unknown): value is NonNullable<PricingBaseQuery["periodo"]> {
  return value === "P1" || value === "P2" || value === "P3" || value === "P4" || value === "P5" || value === "P6";
}

function multiplyNullable(left: number | null, right: number | null) {
  return left === null || right === null ? null : left * right;
}

function defaultProfileValues() {
  return {
    profile20td: null,
    profile30td: null,
    profile30tdve: null,
    profile61td: 1,
    profile20tdStatus: "missing" as const,
    profile30tdStatus: "missing" as const,
    profile30tdveStatus: "missing" as const,
    profile61tdStatus: "ok" as const,
    profile20tdSource: "REE_PROFILE" as const,
    profile30tdSource: "REE_PROFILE" as const,
    profile30tdveSource: "REE_PROFILE" as const,
    profile61tdSource: "UNIT_PROFILE" as const
  };
}

function worstStatus(statuses: Array<"ok" | "partial" | "missing">) {
  if (statuses.includes("missing")) {
    return "missing";
  }
  if (statuses.includes("partial")) {
    return "partial";
  }
  return "ok";
}
