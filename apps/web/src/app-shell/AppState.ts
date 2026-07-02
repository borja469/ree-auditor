import type { LiquidationAnalysisFilterOptions, LiquidationAnalysisFilters, OmieDownloadCodigo, OmieDownloadExecuteRequest, OmieTransactionDownloadRow, ReeLossesFilters, ReeLossesImportFile, ReeVersion } from "../api";
import type { Section, SidebarGroupKey } from "./AppShellTypes";

export function hasCompleteLiquidationAnalysisFilters(filters: LiquidationAnalysisFilters) {
  return Boolean(filters.version && filters.fecha);
}

export function resolveLiquidationAnalysisFilters(filters: LiquidationAnalysisFilters, options: LiquidationAnalysisFilterOptions) {
  const fecha = filters.fecha ?? options.latestMonth ?? undefined;
  const version = filters.version ?? getLatestLiquidationAnalysisVersionForMonth(options, fecha);
  return { ...filters, fecha, version };
}

export function getLatestLiquidationAnalysisVersionForMonth(options: LiquidationAnalysisFilterOptions | undefined, month: string | undefined) {
  if (!options || !month) {
    return undefined;
  }
  const monthVersion = options.latestVersionByMonth.find((item) => item.month === month)?.version;
  if (monthVersion) {
    return monthVersion;
  }
  return options.versions[options.versions.length - 1];
}

export function hasAnyReeLossesDateFilter(filters: ReeLossesFilters) {
  return Boolean(filters.mes || filters.fechaInicio || filters.fechaFin);
}

export function monthDateRange(monthKey?: string | null) {
  const parsed = /^(\d{4})-(\d{2})$/.exec(monthKey ?? "");
  if (!parsed) {
    return {};
  }

  const year = Number(parsed[1]);
  const month = Number(parsed[2]);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
  end.setUTCDate(end.getUTCDate() - 1);

  return {
    fechaInicio: start.toISOString().slice(0, 10),
    fechaFin: end.toISOString().slice(0, 10)
  };
}

export function activeSidebarGroupKeys(section: Section): SidebarGroupKey[] {
  if (section === "reeDownloads" || section === "reganecu" || section === "medidas" || section === "reeLosses" || section === "liquidationAnalysis") {
    return ["ree"];
  }
  if (isOmieSection(section)) {
    return ["omie"];
  }
  if (isEsiosSection(section)) {
    return ["esios"];
  }
  return ["ree"];
}

export function activeSidebarItemKeys(section: Section): string[] {
  if (section === "reeDownloads") {
    return [];
  }
  if (section === "reganecu") {
    return ["ree-reganecu-menu"];
  }
  if (section === "medidas") {
    return ["ree-medidas-menu"];
  }
  if (section === "reeLosses") {
    return [];
  }
  if (section === "omieProgramas" || section === "omieTransacciones") {
    return ["omie-programas-menu"];
  }
  if (section === "omieAnalisisMensual" || section === "omieComprobacionLiquidaciones") {
    return ["omie-hoja-control-menu"];
  }
  if (section === "liquidationAnalysis") {
    return ["ree-reganecu-menu"];
  }
  if (isEsiosSection(section)) {
    return ["esios-menu"];
  }
  return [];
}

export function isOmieSection(section: Section) {
  return (
    section === "omieProgramas" ||
    section === "omiePrecios" ||
    section === "omieAnalisisMensual" ||
    section === "omieComprobacionLiquidaciones" ||
    section === "omieTransacciones" ||
    section === "omieDescargas"
  );
}

export function isEsiosSection(section: Section) {
  return (
    section === "esiosIndicadores" ||
    section === "esiosPerfiles" ||
    section === "esiosSeries" ||
    section === "esiosDescargas" ||
    section === "esiosConfiguracion"
  );
}

export function selectOmieTransactionDownloadId(
  downloads: OmieTransactionDownloadRow[],
  preferredId?: string,
  options: { keepPreferredEvenIfEmpty?: boolean } = {}
) {
  const preferred = downloads.find((download) => download.id === preferredId);
  if (preferred && (options.keepPreferredEvenIfEmpty || preferred.registros > 0)) {
    return preferred.id;
  }
  const mostComplete = downloads.reduce<OmieTransactionDownloadRow | undefined>(
    (best, download) => (download.registros > (best?.registros ?? 0) ? download : best),
    undefined
  );
  return mostComplete && mostComplete.registros > 0 ? mostComplete.id : preferred?.id ?? downloads[0]?.id;
}

export function getTodayInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function normalizeOmieSesionInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(-2);
  return digits ? digits.padStart(2, "0") : "01";
}
