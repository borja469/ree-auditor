import { Injectable } from "@nestjs/common";
import * as XLSX from "xlsx";
import type { PricingCalculatorManualValueDto } from "./pricing_calculator_manual_values_service";
import type { PricingBaseMeffProfileRow, PricingBaseResponse, PricingBaseRow, PricingProfileTariff } from "./pricing-base.types";

const PERIODS = ["P1", "P2", "P3", "P4", "P5", "P6"] as const;
const MONTHS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] as const;
type Period = (typeof PERIODS)[number];
type BaseTariff = PricingProfileTariff;
type CalculatorConceptKey = (typeof PRICING_CALCULATOR_CONCEPTS)[number]["key"];
type ManualConcept = (typeof PRICING_CALCULATOR_MANUAL_CONCEPTS)[number];

@Injectable()
export class PricingBaseExportService {
  toCsv(rows: PricingBaseRow[]) {
    const headers = pricingBaseHeaders();
    return [headers.join(";"), ...rows.map((row) => headers.map((header) => csvCell(row[header as keyof PricingBaseRow])).join(";"))].join("\n");
  }

  toExcelWorkbook(response: PricingBaseResponse, manualValues: PricingCalculatorManualValueDto[]) {
    const workbook = XLSX.utils.book_new();
    const omieMatrices = buildOmiePeriodMatrices(response.rows);
    const meffMatrices = buildMeffPriceMatrices(response.meffForward.months, omieMatrices);
    const cadRadRows = buildCadRadPeriodSummary(response.rows);
    const lossesRows = buildLossesPeriodSummary(response.rows);
    const manualValueMap = buildManualValueMap(manualValues);

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(buildBaseSheet(response.rows)), "Tabla base");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(buildCalculatorSheet(response, meffMatrices, cadRadRows, lossesRows, manualValueMap)), "Calculador precios");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(buildProfiledTariffsSheet(response, omieMatrices, meffMatrices)), "Perfilado tarifas");

    return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
  }
}

function buildBaseSheet(rows: PricingBaseRow[]) {
  const headers = pricingBaseHeaders();
  return [headers, ...rows.map((row) => headers.map((header) => row[header as keyof PricingBaseRow] ?? ""))];
}

function buildCalculatorSheet(
  response: PricingBaseResponse,
  meffMatrices: ProfiledPeriodMatrix[],
  cadRadRows: CadRadPeriodSummaryRow[],
  lossesRows: LossesPeriodSummaryRow[],
  manualValues: Map<string, number | null>
) {
  const columns = buildPricingCalculatorColumns(meffMatrices);
  const tariffHeader = ["CONCEPTOS", ...columns.map((column, index) => (index === 0 || columns[index - 1]?.tariff !== column.tariff ? column.tariff : ""))];
  const periodHeader = ["", ...columns.map((column) => column.period)];
  const enabledConcepts = new Set<CalculatorConceptKey>(PRICING_CALCULATOR_CONCEPTS.map((concept) => concept.key));
  const coefForward = average(response.meffForward.months.map((month) => (month.price === null || month.previous7DaysPrice === null ? null : month.price - month.previous7DaysPrice)));
  const meffByTariff = new Map(meffMatrices.map((row) => [row.tariff, row]));
  const cadRadByTariff = new Map(cadRadRows.map((row) => [row.tariff, row]));
  const lossesByTariff = new Map(lossesRows.map((row) => [row.tariff, row]));

  return [
    ["Calculador de precios"],
    [`Fecha referencia: ${response.filters.fechaReferencia}`],
    [],
    tariffHeader,
    periodHeader,
    ...PRICING_CALCULATOR_CONCEPTS.map((concept) => [
      concept.label,
      ...columns.map((column) =>
        roundOrBlank(
          calculatePricingCalculatorValue({
            conceptKey: concept.key,
            column,
            enabledConcepts,
            manualValues,
            coefForward,
            meffMatrix: meffByTariff.get(column.tariff),
            cadRadRow: cadRadByTariff.get(column.tariff),
            lossesRow: lossesByTariff.get(column.tariff)
          }),
          2
        )
      )
    ])
  ];
}

function buildProfiledTariffsSheet(response: PricingBaseResponse, omieMatrices: ProfiledPeriodMatrix[], meffMatrices: ProfiledPeriodMatrix[]) {
  const sheet: unknown[][] = [];
  sheet.push(["OMIE perfilado por tarifa"]);
  appendProfiledMatrices(sheet, omieMatrices, "ratio", false);
  sheet.push([]);
  sheet.push([`MEFF perfilado por tarifa${response.meffForward.publicationDate ? ` - publicado ${response.meffForward.publicationDate}` : ""}`]);
  appendMeffPriceSummary(sheet, response);
  appendProfiledMatrices(sheet, meffMatrices, "price", true);
  return sheet;
}

function appendMeffPriceSummary(sheet: unknown[][], response: PricingBaseResponse) {
  const months = response.meffForward.months;
  sheet.push([]);
  sheet.push(["Precio MEFF", ...months.map((month) => month.label), "Promedio"]);
  sheet.push(["Precio MEFF", ...months.map((month) => roundOrBlank(month.price, 2)), roundOrBlank(average(months.map((month) => month.price)), 2)]);
  sheet.push(["Inc. 7 dias %", ...months.map((month) => roundOrBlank(month.change7DaysPct, 2)), roundOrBlank(average(months.map((month) => month.change7DaysPct)), 2)]);
  sheet.push(["Inc. 14 dias %", ...months.map((month) => roundOrBlank(month.change14DaysPct, 2)), roundOrBlank(average(months.map((month) => month.change14DaysPct)), 2)]);
}

function appendProfiledMatrices(sheet: unknown[][], matrices: ProfiledPeriodMatrix[], valueMode: "ratio" | "price", showTotalRow: boolean) {
  for (const matrix of matrices) {
    sheet.push([]);
    sheet.push([matrix.tariff]);
    sheet.push(["Mes", ...PERIODS]);
    for (const month of matrix.months) {
      sheet.push([
        month.label,
        ...PERIODS.map((period) => {
          const cell = matrix.cells.get(`${month.key}|${period}`);
          return roundOrBlank((valueMode === "price" ? cell?.weightedPrice : cell?.value) ?? null, valueMode === "price" ? 2 : 6);
        })
      ]);
    }
    if (showTotalRow) {
      sheet.push(["Total", ...PERIODS.map((period) => roundOrBlank(sumMatrixPeriod(matrix, period, valueMode), valueMode === "price" ? 2 : 6))]);
    }
  }
}

type ProfiledPeriodMatrixCell = {
  value: number | null;
  weightedPrice: number | null;
  averagePrice: number | null;
  sumProduct: number;
  sumProfile: number;
  priceCount: number;
};

type ProfiledPeriodMatrix = {
  tariff: BaseTariff;
  months: Array<{ key: string; label: string }>;
  cells: Map<string, ProfiledPeriodMatrixCell>;
};

type PricingCalculatorColumn = {
  tariff: BaseTariff;
  period: Period;
};

type BasePricingMatrixConfig<Row> = {
  tariff: BaseTariff;
  profile: keyof Row;
  period: keyof Row;
};

const OMIE_MATRIX_CONFIGS: Array<BasePricingMatrixConfig<PricingBaseRow> & { product: keyof PricingBaseRow; price: keyof PricingBaseRow }> = [
  { tariff: "2.0TD", profile: "perfilIntermedio20TD", product: "productoPerfilOmie20TD", price: "precioOmie", period: "periodo20TD" },
  { tariff: "3.0TD", profile: "perfilIntermedio30TD", product: "productoPerfilOmie30TD", price: "precioOmie", period: "periodo30TD" },
  { tariff: "3.0TDVE", profile: "perfilIntermedio30TDVE", product: "productoPerfilOmie30TDVE", price: "precioOmie", period: "periodo30TD" },
  { tariff: "6.1TD", profile: "perfilIntermedio61TD", product: "productoPerfilOmie61TD", price: "precioOmie", period: "periodo6XTD" }
];

const CAD_RAD_MATRIX_CONFIGS: Array<BasePricingMatrixConfig<PricingBaseRow> & { cadProduct: keyof PricingBaseRow; radProduct: keyof PricingBaseRow }> = [
  { tariff: "2.0TD", profile: "perfilIntermedio20TD", cadProduct: "productoPerfilCad20TD", radProduct: "productoPerfilRad20TD", period: "periodo20TD" },
  { tariff: "3.0TD", profile: "perfilIntermedio30TD", cadProduct: "productoPerfilCad30TD", radProduct: "productoPerfilRad30TD", period: "periodo30TD" },
  { tariff: "3.0TDVE", profile: "perfilIntermedio30TDVE", cadProduct: "productoPerfilCad30TDVE", radProduct: "productoPerfilRad30TDVE", period: "periodo30TD" },
  { tariff: "6.1TD", profile: "perfilIntermedio61TD", cadProduct: "productoPerfilCad61TD", radProduct: "productoPerfilRad61TD", period: "periodo6XTD" }
];

const LOSSES_MATRIX_CONFIGS: Array<BasePricingMatrixConfig<PricingBaseRow> & { lossesProduct: keyof PricingBaseRow }> = [
  { tariff: "2.0TD", profile: "perfilIntermedio20TD", lossesProduct: "productoPerfilPerdidas20TD", period: "periodo20TD" },
  { tariff: "3.0TD", profile: "perfilIntermedio30TD", lossesProduct: "productoPerfilPerdidas30TD", period: "periodo30TD" },
  { tariff: "3.0TDVE", profile: "perfilIntermedio30TDVE", lossesProduct: "productoPerfilPerdidas30TDVE", period: "periodo30TD" },
  { tariff: "6.1TD", profile: "perfilIntermedio61TD", lossesProduct: "productoPerfilPerdidas61TD", period: "periodo6XTD" }
];

const MEFF_MATRIX_CONFIGS: Array<BasePricingMatrixConfig<PricingBaseMeffProfileRow> & { product: keyof PricingBaseMeffProfileRow; price: keyof PricingBaseMeffProfileRow }> = [
  { tariff: "2.0TD", profile: "perfilIntermedio20TD", product: "productoPerfilMeff20TD", price: "precioMeff", period: "periodo20TD" },
  { tariff: "3.0TD", profile: "perfilIntermedio30TD", product: "productoPerfilMeff30TD", price: "precioMeff", period: "periodo30TD" },
  { tariff: "3.0TDVE", profile: "perfilIntermedio30TDVE", product: "productoPerfilMeff30TDVE", price: "precioMeff", period: "periodo30TD" },
  { tariff: "6.1TD", profile: "perfilIntermedio61TD", product: "productoPerfilMeff61TD", price: "precioMeff", period: "periodo6XTD" }
];

const PRICING_CALCULATOR_MANUAL_CONCEPTS = ["renta4", "cos", "si3", "ppc", "retribucionOm", "retribucionOs", "aportacionFnee", "desvio", "modificador", "perdidasInc", "atr"] as const;

const PRICING_CALCULATOR_CONCEPTS = [
  { key: "renta4", label: "Renta 4" },
  { key: "coefForward", label: "Coef Forward" },
  { key: "apuntamiento", label: "Apuntamiento" },
  { key: "pool", label: "Pool" },
  { key: "cos", label: "C. Operador del Sistema" },
  { key: "si3", label: "SI3" },
  { key: "ppc", label: "PPC" },
  { key: "retribucionOm", label: "Retribucion OM" },
  { key: "retribucionOs", label: "Retribucion OS" },
  { key: "aportacionFnee", label: "Aportacion FNEE" },
  { key: "desvio", label: "Desvio" },
  { key: "modificador", label: "Modificador" },
  { key: "perdidas", label: "Perdidas" },
  { key: "perdidasInc", label: "Perdidas Inc." },
  { key: "costeFinanciero", label: "Coste financiero" },
  { key: "atr", label: "ATR" },
  { key: "precioFinal", label: "Precio Final" }
] as const;

function buildOmiePeriodMatrices(rows: PricingBaseRow[]): ProfiledPeriodMatrix[] {
  return buildProfiledPeriodMatrices(rows, OMIE_MATRIX_CONFIGS, MONTHS.map((month) => ({ key: month, label: month })), (row) => String(row.mes));
}

function buildMeffPriceMatrices(months: PricingBaseResponse["meffForward"]["months"], omieMatrices: ProfiledPeriodMatrix[]): ProfiledPeriodMatrix[] {
  const omieByTariff = new Map(omieMatrices.map((matrix) => [matrix.tariff, matrix]));
  return MEFF_MATRIX_CONFIGS.map((config) => {
    const cells = new Map<string, ProfiledPeriodMatrixCell>();
    const omieMatrix = omieByTariff.get(config.tariff);
    for (const month of months) {
      for (const period of PERIODS) {
        const omieCell = omieMatrix?.cells.get(`${month.month}|${period}`);
        const periodProfileTotal = sumPeriodProfile(omieMatrix, period);
        const value = calculateMeffProfiledValue(month.price, omieCell, periodProfileTotal);
        cells.set(`${month.key}|${period}`, {
          value,
          weightedPrice: value,
          averagePrice: month.price,
          sumProduct: (month.price ?? 0) * (omieCell?.value ?? 0) * (omieCell?.sumProfile ?? 0),
          sumProfile: periodProfileTotal,
          priceCount: value === null ? 0 : 1
        });
      }
    }
    return { tariff: config.tariff, months: months.map((month) => ({ key: month.key, label: month.label })), cells };
  });
}

function buildProfiledPeriodMatrices<Row extends PricingBaseRow | PricingBaseMeffProfileRow>(
  rows: Row[],
  configs: Array<{ tariff: BaseTariff; profile: keyof Row; product: keyof Row; price: keyof Row; period: keyof Row }>,
  months: Array<{ key: string; label: string }>,
  monthKey: (row: Row) => string
): ProfiledPeriodMatrix[] {
  return configs.map((config) => {
    const groups = new Map<string, { sumProduct: number; sumProfile: number; sumPrice: number; priceCount: number }>();
    for (const row of rows) {
      const profile = numericOrNull(row[config.profile]);
      const product = numericOrNull(row[config.product]);
      const price = numericOrNull(row[config.price]);
      const period = row[config.period];
      if (!PERIODS.includes(period as Period) || profile === null || product === null || price === null) {
        continue;
      }
      const key = `${monthKey(row)}|${period}`;
      const current = groups.get(key) ?? { sumProduct: 0, sumProfile: 0, sumPrice: 0, priceCount: 0 };
      current.sumProduct += product;
      current.sumProfile += profile;
      current.sumPrice += price;
      current.priceCount += 1;
      groups.set(key, current);
    }

    const cells = new Map<string, ProfiledPeriodMatrixCell>();
    for (const [key, group] of groups.entries()) {
      const weightedPrice = group.sumProfile === 0 ? null : group.sumProduct / group.sumProfile;
      const averagePrice = group.priceCount === 0 ? null : group.sumPrice / group.priceCount;
      const value = weightedPrice === null || averagePrice === null || averagePrice === 0 ? null : weightedPrice / averagePrice;
      cells.set(key, { value, weightedPrice, averagePrice, sumProduct: group.sumProduct, sumProfile: group.sumProfile, priceCount: group.priceCount });
    }
    return { tariff: config.tariff, months, cells };
  });
}

type CadRadPeriodCell = { value: number | null; sumCadProduct: number; sumRadProduct: number; sumProfile: number; rowCount: number };
type CadRadPeriodSummaryRow = { tariff: BaseTariff; cells: Map<string, CadRadPeriodCell> };
type LossesPeriodCell = { value: number | null; sumLossesProduct: number; sumProfile: number; rowCount: number };
type LossesPeriodSummaryRow = { tariff: BaseTariff; cells: Map<string, LossesPeriodCell> };

function buildCadRadPeriodSummary(rows: PricingBaseRow[]): CadRadPeriodSummaryRow[] {
  return CAD_RAD_MATRIX_CONFIGS.map((config) => {
    const groups = new Map<string, { sumCadProduct: number; sumRadProduct: number; sumProfile: number; rowCount: number }>();
    for (const row of rows) {
      const profile = numericOrNull(row[config.profile]);
      const cadProduct = numericOrNull(row[config.cadProduct]);
      const radProduct = numericOrNull(row[config.radProduct]);
      const period = row[config.period];
      if (!PERIODS.includes(period as Period) || profile === null || cadProduct === null || radProduct === null) {
        continue;
      }
      const current = groups.get(period as string) ?? { sumCadProduct: 0, sumRadProduct: 0, sumProfile: 0, rowCount: 0 };
      current.sumCadProduct += cadProduct;
      current.sumRadProduct += radProduct;
      current.sumProfile += profile;
      current.rowCount += 1;
      groups.set(period as string, current);
    }
    return {
      tariff: config.tariff,
      cells: new Map(
        [...groups.entries()].map(([period, group]) => [
          period,
          {
            value: group.sumProfile === 0 ? null : (group.sumCadProduct + group.sumRadProduct) / group.sumProfile,
            ...group
          }
        ])
      )
    };
  });
}

function buildLossesPeriodSummary(rows: PricingBaseRow[]): LossesPeriodSummaryRow[] {
  return LOSSES_MATRIX_CONFIGS.map((config) => {
    const groups = new Map<string, { sumLossesProduct: number; sumProfile: number; rowCount: number }>();
    for (const row of rows) {
      const profile = numericOrNull(row[config.profile]);
      const lossesProduct = numericOrNull(row[config.lossesProduct]);
      const period = row[config.period];
      if (!PERIODS.includes(period as Period) || profile === null || lossesProduct === null) {
        continue;
      }
      const current = groups.get(period as string) ?? { sumLossesProduct: 0, sumProfile: 0, rowCount: 0 };
      current.sumLossesProduct += lossesProduct;
      current.sumProfile += profile;
      current.rowCount += 1;
      groups.set(period as string, current);
    }
    return {
      tariff: config.tariff,
      cells: new Map([...groups.entries()].map(([period, group]) => [period, { value: group.sumProfile === 0 ? null : group.sumLossesProduct / group.sumProfile, ...group }]))
    };
  });
}

function buildPricingCalculatorColumns(matrices: ProfiledPeriodMatrix[]): PricingCalculatorColumn[] {
  return matrices.flatMap((matrix) => periodsForTariff(matrix.tariff).map((period) => ({ tariff: matrix.tariff, period })));
}

function periodsForTariff(tariff: BaseTariff): Period[] {
  return tariff === "2.0TD" ? ["P1", "P2", "P3"] : [...PERIODS];
}

function calculatePricingCalculatorValue({
  conceptKey,
  column,
  enabledConcepts,
  manualValues,
  coefForward,
  meffMatrix,
  cadRadRow,
  lossesRow
}: {
  conceptKey: CalculatorConceptKey;
  column: PricingCalculatorColumn;
  enabledConcepts: Set<CalculatorConceptKey>;
  manualValues: Map<string, number | null>;
  coefForward: number | null;
  meffMatrix: ProfiledPeriodMatrix | undefined;
  cadRadRow: CadRadPeriodSummaryRow | undefined;
  lossesRow: LossesPeriodSummaryRow | undefined;
}) {
  const apuntamiento = meffMatrix ? sumMatrixPeriod(meffMatrix, column.period, "price") : null;
  const renta4 = manualNumber(manualValues, "renta4", column);
  const pool = nullableSum([calculatorContribution(apuntamiento, "apuntamiento", enabledConcepts), calculatorContribution(coefForward, "coefForward", enabledConcepts), calculatorContribution(renta4, "renta4", enabledConcepts)]);
  const calculatedCos = cadRadRow?.cells.get(column.period)?.value ?? null;
  const cos = manualOverrideNumber(manualValues, "cos", column, calculatedCos);
  const perdidas = lossesRow?.cells.get(column.period)?.value ?? null;
  const si3 = manualNumber(manualValues, "si3", column);
  const ppc = manualNumber(manualValues, "ppc", column);
  const retribucionOm = manualNumber(manualValues, "retribucionOm", column);
  const retribucionOs = manualNumber(manualValues, "retribucionOs", column);
  const aportacionFnee = manualNumber(manualValues, "aportacionFnee", column);
  const desvio = manualNumber(manualValues, "desvio", column);
  const modificador = manualNumber(manualValues, "modificador", column);
  const perdidasInc = manualNumber(manualValues, "perdidasInc", column);
  const atr = manualNumber(manualValues, "atr", column);
  const perdidasRate = percentageToRate(calculatorContribution(perdidas, "perdidas", enabledConcepts));
  const perdidasIncRate = percentageToRate(calculatorContribution(perdidasInc, "perdidasInc", enabledConcepts));
  const baseCostes = nullableSum([
    calculatorContribution(pool, "pool", enabledConcepts),
    calculatorContribution(cos, "cos", enabledConcepts),
    calculatorContribution(si3, "si3", enabledConcepts),
    calculatorContribution(ppc, "ppc", enabledConcepts),
    calculatorContribution(retribucionOm, "retribucionOm", enabledConcepts),
    calculatorContribution(retribucionOs, "retribucionOs", enabledConcepts),
    calculatorContribution(aportacionFnee, "aportacionFnee", enabledConcepts),
    calculatorContribution(desvio, "desvio", enabledConcepts),
    calculatorContribution(modificador, "modificador", enabledConcepts)
  ]);
  const importeConPerdidas = baseCostes === null || perdidasRate === null ? null : baseCostes * (1 + perdidasRate + (perdidasIncRate ?? 0));
  const costeFinanciero = importeConPerdidas === null ? null : importeConPerdidas * 0.0075;
  const final = nullableSum([importeConPerdidas, calculatorContribution(costeFinanciero, "costeFinanciero", enabledConcepts), calculatorContribution(atr, "atr", enabledConcepts)]);

  switch (conceptKey) {
    case "renta4":
      return renta4;
    case "coefForward":
      return coefForward;
    case "apuntamiento":
      return apuntamiento;
    case "pool":
      return pool;
    case "cos":
      return cos;
    case "si3":
      return si3;
    case "ppc":
      return ppc;
    case "retribucionOm":
      return retribucionOm;
    case "retribucionOs":
      return retribucionOs;
    case "aportacionFnee":
      return aportacionFnee;
    case "desvio":
      return desvio;
    case "modificador":
      return modificador;
    case "perdidas":
      return perdidas;
    case "perdidasInc":
      return perdidasInc;
    case "costeFinanciero":
      return costeFinanciero;
    case "atr":
      return atr;
    case "precioFinal":
      return final;
    default:
      return null;
  }
}

function calculateMeffProfiledValue(meffPrice: number | null, omieCell: ProfiledPeriodMatrixCell | undefined, periodProfileTotal: number) {
  if (meffPrice === null || !omieCell || omieCell.value === null || !Number.isFinite(omieCell.value) || omieCell.sumProfile === 0 || periodProfileTotal === 0) {
    return null;
  }
  return (meffPrice * omieCell.value * omieCell.sumProfile) / periodProfileTotal;
}

function sumPeriodProfile(matrix: ProfiledPeriodMatrix | undefined, period: Period) {
  if (!matrix) {
    return 0;
  }
  return matrix.months.reduce((sum, month) => sum + (matrix.cells.get(`${month.key}|${period}`)?.sumProfile ?? 0), 0);
}

function sumMatrixPeriod(matrix: ProfiledPeriodMatrix, period: Period, valueMode: "ratio" | "price") {
  let total = 0;
  let count = 0;
  for (const month of matrix.months) {
    const cell = matrix.cells.get(`${month.key}|${period}`);
    const value = valueMode === "price" ? cell?.weightedPrice : cell?.value;
    if (typeof value === "number" && Number.isFinite(value)) {
      total += value;
      count += 1;
    }
  }
  return count === 0 ? null : total;
}

function manualNumber(values: Map<string, number | null>, concept: ManualConcept, column: PricingCalculatorColumn) {
  return values.get(calculatorManualKey(concept, column.tariff, column.period)) ?? 0;
}

function manualOverrideNumber(values: Map<string, number | null>, concept: ManualConcept, column: PricingCalculatorColumn, automaticValue: number | null) {
  const key = calculatorManualKey(concept, column.tariff, column.period);
  return values.has(key) ? (values.get(key) ?? null) : automaticValue;
}

function calculatorContribution(value: number | null, concept: CalculatorConceptKey, enabledConcepts: Set<CalculatorConceptKey>) {
  return enabledConcepts.has(concept) ? value : 0;
}

function nullableSum(values: Array<number | null>) {
  if (values.some((value) => value === null || value === undefined || !Number.isFinite(value))) {
    return null;
  }
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function percentageToRate(value: number | null) {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value / 100;
}

function buildManualValueMap(values: PricingCalculatorManualValueDto[]) {
  return new Map(values.map((value) => [calculatorManualKey(value.concepto as ManualConcept, value.tarifa, value.periodo), value.valor]));
}

function calculatorManualKey(concept: ManualConcept, tariff: string, period: string) {
  return `${concept}|${tariff}|${period}`;
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return valid.length === 0 ? null : valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function numericOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundOrBlank(value: number | null, digits: number) {
  return value === null || value === undefined || !Number.isFinite(value) ? "" : Number(value.toFixed(digits));
}

function pricingBaseHeaders() {
  return [
    "fecha",
    "ano",
    "mes",
    "dia",
    "diaSemana",
    "diaSemanaNombre",
    "hora",
    "timestampInicio",
    "timestampFin",
    "cambioHorarioDst",
    "ordenDia365",
    "ordenHora",
    "perfilIntermedio20TD",
    "perfilIntermedio30TD",
    "perfilIntermedio30TDVE",
    "perfilIntermedio61TD",
    "productoPerfilOmie20TD",
    "productoPerfilOmie30TD",
    "productoPerfilOmie30TDVE",
    "productoPerfilOmie61TD",
    "productoPerfilCad20TD",
    "productoPerfilCad30TD",
    "productoPerfilCad30TDVE",
    "productoPerfilCad61TD",
    "productoPerfilRad20TD",
    "productoPerfilRad30TD",
    "productoPerfilRad30TDVE",
    "productoPerfilRad61TD",
    "productoPerfilPerdidas20TD",
    "productoPerfilPerdidas30TD",
    "productoPerfilPerdidas30TDVE",
    "productoPerfilPerdidas61TD",
    "periodo20TD",
    "periodo30TD",
    "periodo6XTD",
    "profileSource20TD",
    "profileSource30TD",
    "profileSource30TDVE",
    "profileSource61TD",
    "precioOmie",
    "precioOmieUnidad",
    "cad",
    "cadVersion",
    "cadStatus",
    "rad",
    "radVersion",
    "radStatus",
    "perdidas",
    "perdidasVersion",
    "perdidasStatus",
    "perfil20TDStatus",
    "perfil30TDStatus",
    "perfil30TDVEStatus",
    "omieStatus"
  ];
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}
