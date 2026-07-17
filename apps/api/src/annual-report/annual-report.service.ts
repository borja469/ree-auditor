import { BadRequestException, Injectable } from "@nestjs/common";
import { AnnualReportRetributionType, OmieDownloadEstado, OmieTipoDocumento, OmieTipoPrecio, Prisma, ReeSettlementVersion } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const VERSION_PRIORITY: AnnualReportVersion[] = ["C5", "C4", "C3", "C2"];
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
const OMIE_TRANSACCIONES_CODIGO = "4121";
const STROM_UOFERTANTE = "STROC01";
const STROM_AGENT = "STROM";
const QUARTER_HOUR_MWH_FACTOR = 0.25;

type AnnualReportVersion = "C2" | "C3" | "C4" | "C5";
type AnnualMetricKind = "energy" | "currency" | "price" | "text";
type AnnualMetricKey =
  | "programaMwh"
  | "versionUtilizada"
  | "energiaBcMwh"
  | "energiaPfMwh"
  | "perdidasMwh"
  | "importeCadEur"
  | "importeDsvEur"
  | "importePc3Eur"
  | "importeBs3Eur"
  | "importeRad3Eur"
  | "importeIeadEur"
  | "importeIecdEur"
  | "importeIepcEur"
  | "importeTotalEur"
  | "precioReeEurMwh"
  | "importeOmieEur"
  | "precioOmieEurMwh"
  | "precioRetribucionOsEurMwh"
  | "importeRetribucionOsEur"
  | "precioRetribucionOmEurMwh"
  | "importeRetribucionOmEur";

export type AnnualReportMetricRow = {
  key: AnnualMetricKey;
  label: string;
  kind: AnnualMetricKind;
  months: Array<number | string | null>;
  total: number | string | null;
  editable?: {
    type: AnnualReportRetributionType;
  };
};

export type AnnualReportTable = {
  key: "peninsula" | "seie";
  title: string;
  missingMonths: Array<{
    month: number;
    label: string;
    missing: string[];
  }>;
  rows: AnnualReportMetricRow[];
};

export type AnnualReportResponse = {
  year: number;
  availableYears: number[];
  months: string[];
  missingMonths: Array<{
    month: number;
    label: string;
    missing: string[];
  }>;
  rows: AnnualReportMetricRow[];
  tables: AnnualReportTable[];
};

type MedperAnnualRow = {
  month: number;
  version: string;
  bcMwh: Prisma.Decimal | null;
  pfMwh: Prisma.Decimal | null;
  perdidasMwh: Prisma.Decimal | null;
};

type ReganecuAnnualRow = {
  month: number;
  version: ReeSettlementVersion;
  codigoApunte: string | null;
  importeEur: Prisma.Decimal | null;
};

type OmieProgramAnnualRow = {
  month: number;
  market: "MD" | "IDA1" | "IDA2" | "IDA3";
  periodo: number;
  fechaPrograma: Date;
  energiaMWh: Prisma.Decimal;
};

type OmiePriceAnnualRow = {
  market: "MD" | "IDA1" | "IDA2" | "IDA3";
  periodo: number;
  fechaPrograma: Date;
  precioEurMWh: Prisma.Decimal;
};

type OmieTransactionAnnualRow = {
  diaContrato: Date;
  rawPayloadJson: Prisma.JsonValue;
};

type RetributionPriceAnnualRow = {
  month: number;
  type: AnnualReportRetributionType;
  price: Prisma.Decimal;
};

type SeieAnnualRow = {
  month: number;
  version: string;
  segmento: string | null;
  magnitud: Prisma.Decimal | null;
  energia: Prisma.Decimal | null;
};

type MonthValues = {
  programaMwh: number | null;
  versionUtilizada: AnnualReportVersion | null;
  energiaBcMwh: number | null;
  energiaPfMwh: number | null;
  perdidasMwh: number | null;
  importeCadEur: number | null;
  importeDsvEur: number | null;
  importePc3Eur: number | null;
  importeBs3Eur: number | null;
  importeRad3Eur: number | null;
  importeIeadEur: number | null;
  importeIecdEur: number | null;
  importeIepcEur: number | null;
  importeTotalEur: number | null;
  precioReeEurMwh: number | null;
  importeOmieEur: number | null;
  precioOmieEurMwh: number | null;
  precioRetribucionOsEurMwh: number | null;
  importeRetribucionOsEur: number | null;
  precioRetribucionOmEurMwh: number | null;
  importeRetribucionOmEur: number | null;
};

@Injectable()
export class AnnualReportService {
  constructor(private readonly prisma: PrismaService) {}

  async availableYears() {
    const rows = await this.prisma.$queryRaw<Array<{ year: number }>>`
      SELECT year
      FROM (
        SELECT DISTINCT year_value::int AS year
        FROM (
          SELECT EXTRACT(YEAR FROM fecha_liquidacion) AS year_value FROM ree_files WHERE status = 'IMPORTED'
          UNION
          SELECT EXTRACT(YEAR FROM fecha_inicio) AS year_value FROM medper_files WHERE status = 'IMPORTED'
          UNION
          SELECT EXTRACT(YEAR FROM fecha_programa) AS year_value FROM omie_programas
          UNION
          SELECT EXTRACT(YEAR FROM dia_contrato) AS year_value FROM omie_transaction_staging
          UNION
          SELECT EXTRACT(YEAR FROM fecha_liquidacion) AS year_value FROM ree_seie_records
          UNION
          SELECT year AS year_value FROM annual_report_retribution_prices
        ) source_years
        WHERE year_value IS NOT NULL
      ) years
      ORDER BY year DESC
    `;
    return rows.map((row) => Number(row.year)).filter(Number.isSafeInteger);
  }

  async report(year: number): Promise<AnnualReportResponse> {
    validateYear(year);
    const range = buildYearRange(year);
    const [availableYears, medperRows, reganecuRows, programRows, priceRows, transactionRows, retributionRows, seieRows] = await Promise.all([
      this.availableYears(),
      this.loadMedperRows(range.start, range.end),
      this.loadReganecuRows(range.start, range.end),
      this.loadOmieProgramRows(range.start, range.end),
      this.loadOmiePriceRows(range.start, range.end),
      this.loadOmieTransactionRows(range.start, range.end),
      this.loadRetributionPrices(year),
      this.loadSeieRows(range.start, range.end)
    ]);

    const versions = selectVersions(medperRows, reganecuRows);
    const medper = aggregateMedperBySelectedVersion(medperRows, versions);
    const reganecu = aggregateReganecuBySelectedVersion(reganecuRows, versions);
    const omie = aggregateOmie(loadOmieProgramMap(programRows), loadOmiePriceMap(priceRows), buildXbidTransactionMap(transactionRows));
    const retributions = aggregateRetributionPrices(retributionRows);
    const monthValues = MONTHS.map((month) => buildMonthValues(month, versions, medper.get(month), reganecu.get(month), omie.get(month), retributions.get(month)));
    const seieVersions = selectSeieVersions(seieRows);
    const seie = aggregateSeieBySelectedVersion(seieRows, seieVersions);
    const seieProgram = aggregateSeieProgramC2(seieRows);
    const seieMonthValues = MONTHS.map((month) => buildSeieMonthValues(month, seieVersions, seieProgram.get(month), seie.get(month), retributions.get(month)));
    const peninsulaTable = buildAnnualTable("peninsula", "Informe Anual Península", monthValues, buildRows, buildMissingMonth);
    const seieTable = buildAnnualTable("seie", "Informe Anual SEIE", seieMonthValues, buildSeieRows, buildSeieMissingMonth);

    return {
      year,
      availableYears,
      months: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"],
      missingMonths: peninsulaTable.missingMonths,
      rows: peninsulaTable.rows,
      tables: [peninsulaTable, seieTable]
    };
  }

  async saveRetributionPrice(input: { year: number; month: number; type: AnnualReportRetributionType; price: number | null }) {
    validateYear(input.year);
    validateMonth(input.month);
    validateRetributionType(input.type);
    if (input.price !== null && (!Number.isFinite(input.price) || input.price < 0)) {
      throw new BadRequestException("El precio debe ser un numero mayor o igual que cero.");
    }

    if (input.price === null) {
      await this.prisma.annualReportRetributionPrice
        .delete({
          where: {
            year_month_type: {
              year: input.year,
              month: input.month,
              type: input.type
            }
          }
        })
        .catch(() => null);
      return { year: input.year, month: input.month, type: input.type, price: null, updatedAt: new Date().toISOString() };
    }

    const row = await this.prisma.annualReportRetributionPrice.upsert({
      where: {
        year_month_type: {
          year: input.year,
          month: input.month,
          type: input.type
        }
      },
      create: {
        year: input.year,
        month: input.month,
        type: input.type,
        price: new Prisma.Decimal(input.price.toFixed(12))
      },
      update: {
        price: new Prisma.Decimal(input.price.toFixed(12))
      }
    });

    return {
      year: row.year,
      month: row.month,
      type: row.type,
      price: decimalToNullableNumber(row.price),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private loadMedperRows(start: Date, end: Date) {
    return this.prisma.$queryRaw<MedperAnnualRow[]>`
      SELECT
        EXTRACT(MONTH FROM "timestamp")::int AS month,
        version,
        CASE
          WHEN SUM(bc_mwh) IS NOT NULL THEN SUM(bc_mwh)
          WHEN SUM(pf_mwh) IS NOT NULL OR SUM(perdidas_mwh) IS NOT NULL THEN COALESCE(SUM(pf_mwh), 0) + COALESCE(SUM(perdidas_mwh), 0)
          ELSE NULL
        END AS "bcMwh",
        SUM(pf_mwh) AS "pfMwh",
        SUM(perdidas_mwh) AS "perdidasMwh"
      FROM (
        SELECT
          "timestamp",
          version,
          CASE
            WHEN upper(COALESCE(NULLIF(raw_payload_json ->> 'concepto', ''), NULLIF(raw_payload_json ->> 'programaEnergiaMwh', ''))) = 'MED_CLE'
              THEN COALESCE(perdidas_mwh, pf_mwh, bc_mwh, programa_energia_mwh)
            WHEN COALESCE(NULLIF(raw_payload_json ->> 'concepto', ''), NULLIF(raw_payload_json ->> 'programaEnergiaMwh', '')) IS NULL
              THEN pf_mwh
            ELSE NULL
          END AS pf_mwh,
          CASE
            WHEN upper(COALESCE(NULLIF(raw_payload_json ->> 'concepto', ''), NULLIF(raw_payload_json ->> 'programaEnergiaMwh', ''))) = 'PER_CLE'
              THEN COALESCE(perdidas_mwh, pf_mwh, bc_mwh, programa_energia_mwh)
            WHEN COALESCE(NULLIF(raw_payload_json ->> 'concepto', ''), NULLIF(raw_payload_json ->> 'programaEnergiaMwh', '')) IS NULL
              THEN perdidas_mwh
            ELSE NULL
          END AS perdidas_mwh,
          bc_mwh
        FROM medperqh_records
      ) normalized
      WHERE "timestamp" >= ${start}
        AND "timestamp" < ${end}
        AND version IN ('C3', 'C4', 'C5')
      GROUP BY month, version
    `;
  }

  private loadReganecuRows(start: Date, end: Date) {
    return this.prisma.$queryRaw<ReganecuAnnualRow[]>`
      SELECT
        EXTRACT(MONTH FROM month_date)::int AS month,
        version,
        segmento AS "codigoApunte",
        SUM(importe_eur) AS "importeEur"
      FROM (
        SELECT fecha_liquidacion AS month_date, version, segmento, importe_eur
        FROM reganecu_records
        WHERE fecha_liquidacion >= ${start}
          AND fecha_liquidacion < ${end}
          AND version IN ('C2', 'C3', 'C4', 'C5')
          AND segmento IN ('CAD', 'PC3')
        UNION ALL
        SELECT fecha_liquidacion AS month_date, version, segmento, importe_eur
        FROM reganecu_qh_records
        WHERE fecha_liquidacion >= ${start}
          AND fecha_liquidacion < ${end}
          AND version IN ('C2', 'C3', 'C4', 'C5')
          AND segmento IN ('DSV', 'BS3', 'RAD3')
      ) rows
      GROUP BY month, version, segmento
    `;
  }

  private loadOmieProgramRows(start: Date, end: Date) {
    return this.prisma.$queryRaw<OmieProgramAnnualRow[]>`
      SELECT
        EXTRACT(MONTH FROM fecha_programa)::int AS month,
        CASE
          WHEN tipo_programa::text = ${OmieTipoDocumento.PVD} AND sesion IS NULL THEN 'MD'
          WHEN tipo_programa::text = ${OmieTipoDocumento.PHF} AND sesion = '01' THEN 'IDA1'
          WHEN tipo_programa::text = ${OmieTipoDocumento.PHF} AND sesion = '02' THEN 'IDA2'
          WHEN tipo_programa::text = ${OmieTipoDocumento.PHF} AND sesion = '03' THEN 'IDA3'
        END AS market,
        fecha_programa AS "fechaPrograma",
        periodo,
        SUM(energia_mwh) AS "energiaMWh"
      FROM omie_programas
      WHERE fecha_programa >= ${start}
        AND fecha_programa < ${end}
        AND version = 1
        AND u_ofertante = ${STROM_UOFERTANTE}
        AND (
          (tipo_programa::text = ${OmieTipoDocumento.PVD} AND sesion IS NULL) OR
          (tipo_programa::text = ${OmieTipoDocumento.PHF} AND sesion IN ('01', '02', '03'))
        )
      GROUP BY month, market, fecha_programa, periodo
    `;
  }

  private loadOmiePriceRows(start: Date, end: Date) {
    return this.prisma.$queryRaw<OmiePriceAnnualRow[]>`
      SELECT
        CASE
          WHEN tipo_precio::text = ${OmieTipoPrecio.MD} AND sesion IS NULL THEN 'MD'
          WHEN tipo_precio::text = ${OmieTipoPrecio.MI} AND sesion = '01' THEN 'IDA1'
          WHEN tipo_precio::text = ${OmieTipoPrecio.MI} AND sesion = '02' THEN 'IDA2'
          WHEN tipo_precio::text = ${OmieTipoPrecio.MI} AND sesion = '03' THEN 'IDA3'
        END AS market,
        fecha_programa AS "fechaPrograma",
        periodo,
        AVG(precio_eur_mwh) AS "precioEurMWh"
      FROM omie_prices
      WHERE fecha_programa >= ${start}
        AND fecha_programa < ${end}
        AND (
          (tipo_precio::text = ${OmieTipoPrecio.MD} AND sesion IS NULL) OR
          (tipo_precio::text = ${OmieTipoPrecio.MI} AND sesion IN ('01', '02', '03'))
        )
      GROUP BY market, fecha_programa, periodo
    `;
  }

  private loadOmieTransactionRows(start: Date, end: Date) {
    return this.prisma.omieTransactionStaging.findMany({
      where: {
        diaContrato: {
          gte: start,
          lt: end
        },
        download: {
          codigoConsulta: OMIE_TRANSACCIONES_CODIGO,
          estado: OmieDownloadEstado.PROCESADO
        }
      },
      select: {
        diaContrato: true,
        rawPayloadJson: true
      }
    });
  }

  private loadRetributionPrices(year: number) {
    return this.prisma.annualReportRetributionPrice.findMany({
      where: { year },
      select: {
        month: true,
        type: true,
        price: true
      }
    });
  }

  private loadSeieRows(start: Date, end: Date) {
    return this.prisma.$queryRaw<SeieAnnualRow[]>`
      SELECT
        EXTRACT(MONTH FROM fecha_liquidacion)::int AS month,
        version,
        segmento,
        SUM(magnitud) AS magnitud,
        SUM(energia) AS energia
      FROM ree_seie_records
      WHERE fecha_liquidacion >= ${start}
        AND fecha_liquidacion < ${end}
        AND version IN ('C2', 'C3', 'C4', 'C5')
        AND segmento IN ('IEAC', 'IEAD', 'IECD', 'IEPC')
      GROUP BY month, version, segmento
    `;
  }
}

function selectVersions(medperRows: MedperAnnualRow[], reganecuRows: ReganecuAnnualRow[]) {
  const available = new Map<number, Set<AnnualReportVersion>>();
  for (const row of medperRows) {
    addAvailableVersion(available, row.month, row.version);
  }
  for (const row of reganecuRows) {
    addAvailableVersion(available, row.month, row.version);
  }
  return new Map(MONTHS.map((month) => [month, VERSION_PRIORITY.find((version) => available.get(month)?.has(version)) ?? null]));
}

function selectSeieVersions(rows: SeieAnnualRow[]) {
  const available = new Map<number, Set<AnnualReportVersion>>();
  for (const row of rows) {
    addAvailableVersion(available, row.month, row.version);
  }
  return new Map(MONTHS.map((month) => [month, VERSION_PRIORITY.find((version) => available.get(month)?.has(version)) ?? null]));
}

function addAvailableVersion(target: Map<number, Set<AnnualReportVersion>>, month: number, version: string) {
  if (!isAnnualVersion(version)) {
    return;
  }
  const versions = target.get(month) ?? new Set<AnnualReportVersion>();
  versions.add(version);
  target.set(month, versions);
}

function buildAnnualTable(
  key: "peninsula" | "seie",
  title: string,
  values: MonthValues[],
  rowBuilder: (values: MonthValues[]) => AnnualReportMetricRow[],
  missingBuilder: (month: number, values: MonthValues) => { month: number; label: string; missing: string[] }
): AnnualReportTable {
  return {
    key,
    title,
    missingMonths: values.map((monthValues, index) => missingBuilder(index + 1, monthValues)).filter((item) => item.missing.length > 0),
    rows: rowBuilder(values)
  };
}

function aggregateMedperBySelectedVersion(rows: MedperAnnualRow[], versions: Map<number, AnnualReportVersion | null>) {
  const map = new Map<number, Pick<MonthValues, "energiaBcMwh" | "energiaPfMwh" | "perdidasMwh">>();
  for (const row of rows) {
    if (row.version !== versions.get(row.month)) {
      continue;
    }
    map.set(row.month, {
      energiaBcMwh: decimalToNullableNumber(row.bcMwh),
      energiaPfMwh: decimalToNullableNumber(row.pfMwh),
      perdidasMwh: decimalToNullableNumber(row.perdidasMwh)
    });
  }
  return map;
}

function aggregateSeieProgramC2(rows: SeieAnnualRow[]) {
  const map = new Map<number, { primary: number | null; fallback: number | null }>();
  for (const row of rows) {
    if (row.version !== "C2") {
      continue;
    }
    const bucket = map.get(row.month) ?? { primary: null, fallback: null };
    if (row.segmento === "IEAC") bucket.primary = roundEnergy(displayMedperEnergy(decimalToNullableNumber(row.magnitud)));
    if (row.segmento === "IEAD") bucket.fallback = addNullable(bucket.fallback, roundEnergy(displayMedperEnergy(decimalToNullableNumber(row.magnitud))));
    map.set(row.month, bucket);
  }
  return new Map([...map.entries()].map(([month, values]) => [month, values.primary ?? values.fallback]));
}

function aggregateSeieBySelectedVersion(rows: SeieAnnualRow[], versions: Map<number, AnnualReportVersion | null>) {
  const map = new Map<number, Pick<MonthValues, "energiaBcMwh" | "importeIeadEur" | "importeIecdEur" | "importeIepcEur"> & { energiaBcFallbackMwh: number | null }>();
  for (const row of rows) {
    if (row.version !== versions.get(row.month)) {
      continue;
    }
    const bucket = map.get(row.month) ?? { energiaBcMwh: null, energiaBcFallbackMwh: null, importeIeadEur: null, importeIecdEur: null, importeIepcEur: null };
    if (row.segmento === "IEAC") bucket.energiaBcMwh = roundEnergy(displayMedperEnergy(decimalToNullableNumber(row.magnitud)));
    if (row.segmento === "IEAD") bucket.energiaBcFallbackMwh = addNullable(bucket.energiaBcFallbackMwh, roundEnergy(displayMedperEnergy(decimalToNullableNumber(row.magnitud))));
    if (row.segmento === "IEAD") bucket.importeIeadEur = roundEuro(decimalToNullableNumber(row.energia));
    if (row.segmento === "IECD") bucket.importeIecdEur = roundEuro(decimalToNullableNumber(row.energia));
    if (row.segmento === "IEPC") bucket.importeIepcEur = roundEuro(decimalToNullableNumber(row.energia));
    map.set(row.month, bucket);
  }
  return new Map([...map.entries()].map(([month, values]) => [month, { ...values, energiaBcMwh: values.energiaBcMwh ?? values.energiaBcFallbackMwh }]));
}

function aggregateReganecuBySelectedVersion(rows: ReganecuAnnualRow[], versions: Map<number, AnnualReportVersion | null>) {
  const map = new Map<number, Pick<MonthValues, "importeCadEur" | "importeDsvEur" | "importePc3Eur" | "importeBs3Eur" | "importeRad3Eur">>();
  for (const row of rows) {
    if (row.version !== versions.get(row.month)) {
      continue;
    }
    const bucket = map.get(row.month) ?? { importeCadEur: null, importeDsvEur: null, importePc3Eur: null, importeBs3Eur: null, importeRad3Eur: null };
    const rawValue = decimalToNullableNumber(row.importeEur);
    const value = rawValue === null ? null : -rawValue;
    if (row.codigoApunte === "CAD") bucket.importeCadEur = value;
    if (row.codigoApunte === "DSV") bucket.importeDsvEur = value;
    if (row.codigoApunte === "PC3") bucket.importePc3Eur = value;
    if (row.codigoApunte === "BS3") bucket.importeBs3Eur = value;
    if (row.codigoApunte === "RAD3") bucket.importeRad3Eur = value;
    map.set(row.month, bucket);
  }
  return map;
}

function aggregateRetributionPrices(rows: RetributionPriceAnnualRow[]) {
  const map = new Map<number, Pick<MonthValues, "precioRetribucionOsEurMwh" | "precioRetribucionOmEurMwh">>();
  for (const row of rows) {
    const bucket = map.get(row.month) ?? { precioRetribucionOsEurMwh: null, precioRetribucionOmEurMwh: null };
    const price = decimalToNullableNumber(row.price);
    if (row.type === AnnualReportRetributionType.OS) {
      bucket.precioRetribucionOsEurMwh = price;
    }
    if (row.type === AnnualReportRetributionType.OM) {
      bucket.precioRetribucionOmEurMwh = price;
    }
    map.set(row.month, bucket);
  }
  return map;
}

function loadOmieProgramMap(rows: OmieProgramAnnualRow[]) {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.market) {
      continue;
    }
    const value = decimalToNumber(row.energiaMWh);
    map.set(buildOmieKey(formatDateOnly(row.fechaPrograma), row.periodo, row.market), row.market === "MD" ? value : -value);
  }
  return map;
}

function loadOmiePriceMap(rows: OmiePriceAnnualRow[]) {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.market) {
      map.set(buildOmieKey(formatDateOnly(row.fechaPrograma), row.periodo, row.market), decimalToNumber(row.precioEurMWh));
    }
  }
  return map;
}

function aggregateOmie(programs: Map<string, number>, prices: Map<string, number>, xbid: Map<string, { volXbid: number | null; precioXbid: number | null }>) {
  const map = new Map<number, { programaMwh: number | null; importeOmieEur: number | null }>();
  for (const [key, programaMd] of programs) {
    if (!key.endsWith("|MD")) {
      continue;
    }
    const [fecha, rawPeriodo] = key.split("|");
    const periodo = Number(rawPeriodo);
    const month = Number(fecha.slice(5, 7));
    const programaIda1 = programs.get(buildOmieKey(fecha, periodo, "IDA1")) ?? null;
    const programaIda2 = programs.get(buildOmieKey(fecha, periodo, "IDA2")) ?? null;
    const programaIda3 = programs.get(buildOmieKey(fecha, periodo, "IDA3")) ?? null;
    const volIda1 = diff(programaIda1, programaMd);
    const volIda2 = diff(programaIda2, programaIda1);
    const volIda3 = diff(programaIda3, programaIda2);
    const xbidValue = xbid.get(buildOmieKey(fecha, periodo, "XBID"));
    const energiaTotal = nullableSum([programaMd, volIda1, volIda2, volIda3, xbidValue?.volXbid ?? null]);
    const costeTotal = nullableSum([
      multiply(programaMd, prices.get(buildOmieKey(fecha, periodo, "MD")) ?? null),
      multiply(volIda1, prices.get(buildOmieKey(fecha, periodo, "IDA1")) ?? null),
      multiply(volIda2, prices.get(buildOmieKey(fecha, periodo, "IDA2")) ?? null),
      multiply(volIda3, prices.get(buildOmieKey(fecha, periodo, "IDA3")) ?? null),
      multiply(xbidValue?.volXbid ?? null, xbidValue?.precioXbid ?? null)
    ]);
    const bucket = map.get(month) ?? { programaMwh: null, importeOmieEur: null };
    bucket.programaMwh = addNullable(bucket.programaMwh, energiaTotal);
    bucket.importeOmieEur = addNullable(bucket.importeOmieEur, costeTotal);
    map.set(month, bucket);
  }
  return map;
}

function buildXbidTransactionMap(rows: OmieTransactionAnnualRow[]) {
  const aggregation = new Map<string, { netEnergyMWh: number; priceNumerator: number; totalEnergyMWh: number }>();
  const seenTransactions = new Set<string>();
  for (const row of rows) {
    const payload = asJsonRecord(row.rawPayloadJson);
    if (!payload || !isStromTransaction(payload)) {
      continue;
    }
    const fechaEntrega = parseTransactionDate(readPayloadText(payload, ["fentrega", "fechaEntrega", "fecha_entrega"])) ?? formatDateOnly(row.diaContrato);
    const periodo = readPayloadInteger(payload, ["periodo"]);
    const tipTrans = readPayloadText(payload, ["tipTrans", "TIPTRANS", "tiptrans", "tip_trans"]);
    const qty = readPayloadNumber(payload, ["qty", "volumen", "volume", "cantidad", "energia"]);
    const price = readPayloadNumber(payload, ["prc", "precio", "price"]);
    const sign = transactionSign(tipTrans);
    const transactionKey = buildTransactionDedupeKey(payload, fechaEntrega, periodo, tipTrans, qty, price);
    if (!periodo || qty === null || price === null || sign === null || !transactionKey || seenTransactions.has(transactionKey)) {
      continue;
    }
    seenTransactions.add(transactionKey);
    const absoluteEnergyMWh = Math.abs(qty) * QUARTER_HOUR_MWH_FACTOR;
    const key = buildOmieKey(fechaEntrega, periodo, "XBID");
    const current = aggregation.get(key) ?? { netEnergyMWh: 0, priceNumerator: 0, totalEnergyMWh: 0 };
    current.netEnergyMWh += sign * absoluteEnergyMWh;
    current.priceNumerator += price * absoluteEnergyMWh;
    current.totalEnergyMWh += absoluteEnergyMWh;
    aggregation.set(key, current);
  }
  return new Map([...aggregation.entries()].map(([key, value]) => [key, {
    volXbid: value.totalEnergyMWh > 0 ? value.netEnergyMWh : null,
    precioXbid: value.totalEnergyMWh > 0 ? value.priceNumerator / value.totalEnergyMWh : null
  }]));
}

function buildMonthValues(
  month: number,
  versions: Map<number, AnnualReportVersion | null>,
  medper?: Pick<MonthValues, "energiaBcMwh" | "energiaPfMwh" | "perdidasMwh">,
  reganecu?: Pick<MonthValues, "importeCadEur" | "importeDsvEur" | "importePc3Eur" | "importeBs3Eur" | "importeRad3Eur">,
  omie?: { programaMwh: number | null; importeOmieEur: number | null },
  retribution?: Pick<MonthValues, "precioRetribucionOsEurMwh" | "precioRetribucionOmEurMwh">
): MonthValues {
  const importeTotalEur = nullableSum([
    reganecu?.importeCadEur ?? null,
    reganecu?.importeDsvEur ?? null,
    reganecu?.importePc3Eur ?? null,
    reganecu?.importeBs3Eur ?? null,
    reganecu?.importeRad3Eur ?? null
  ]);
  const programaMwh = roundEnergy(omie?.programaMwh ?? null);
  const energiaBcMwh = roundEnergy(displayMedperEnergy(medper?.energiaBcMwh ?? null));
  const precioReeDenominator = energiaBcMwh && energiaBcMwh !== 0 ? energiaBcMwh : programaMwh;
  const precioRetribucionOsEurMwh = roundPrice(retribution?.precioRetribucionOsEurMwh ?? null);
  const precioRetribucionOmEurMwh = roundPrice(retribution?.precioRetribucionOmEurMwh ?? null);
  return {
    programaMwh,
    versionUtilizada: versions.get(month) ?? null,
    energiaBcMwh,
    energiaPfMwh: roundEnergy(displayMedperEnergy(medper?.energiaPfMwh ?? null)),
    perdidasMwh: roundEnergy(displayMedperEnergy(medper?.perdidasMwh ?? null)),
    importeCadEur: roundEuro(reganecu?.importeCadEur ?? null),
    importeDsvEur: roundEuro(reganecu?.importeDsvEur ?? null),
    importePc3Eur: roundEuro(reganecu?.importePc3Eur ?? null),
    importeBs3Eur: roundEuro(reganecu?.importeBs3Eur ?? null),
    importeRad3Eur: roundEuro(reganecu?.importeRad3Eur ?? null),
    importeIeadEur: null,
    importeIecdEur: null,
    importeIepcEur: null,
    importeTotalEur: roundEuro(importeTotalEur),
    precioReeEurMwh: ratio(importeTotalEur, precioReeDenominator),
    importeOmieEur: roundEuro(omie?.importeOmieEur ?? null),
    precioOmieEurMwh: ratio(omie?.importeOmieEur ?? null, programaMwh),
    precioRetribucionOsEurMwh,
    importeRetribucionOsEur: roundEuro(multiply(precioRetribucionOsEurMwh, programaMwh)),
    precioRetribucionOmEurMwh,
    importeRetribucionOmEur: roundEuro(multiply(precioRetribucionOmEurMwh, programaMwh))
  };
}

function buildSeieMonthValues(
  month: number,
  versions: Map<number, AnnualReportVersion | null>,
  programaMwh: number | null | undefined,
  seie?: Pick<MonthValues, "energiaBcMwh" | "importeIeadEur" | "importeIecdEur" | "importeIepcEur">,
  retribution?: Pick<MonthValues, "precioRetribucionOsEurMwh">
): MonthValues {
  const importeTotalEur = nullableSum([seie?.importeIeadEur ?? null, seie?.importeIecdEur ?? null, seie?.importeIepcEur ?? null]);
  const roundedPrograma = roundEnergy(programaMwh ?? null);
  const energiaBcMwh = roundEnergy(seie?.energiaBcMwh ?? null);
  const precioReeDenominator = energiaBcMwh && energiaBcMwh !== 0 ? energiaBcMwh : roundedPrograma;
  const precioRetribucionOsEurMwh = roundPrice(retribution?.precioRetribucionOsEurMwh ?? null);
  return {
    programaMwh: roundedPrograma,
    versionUtilizada: versions.get(month) ?? null,
    energiaBcMwh,
    energiaPfMwh: null,
    perdidasMwh: diff(energiaBcMwh, roundedPrograma),
    importeCadEur: null,
    importeDsvEur: null,
    importePc3Eur: null,
    importeBs3Eur: null,
    importeRad3Eur: null,
    importeIeadEur: roundEuro(seie?.importeIeadEur ?? null),
    importeIecdEur: roundEuro(seie?.importeIecdEur ?? null),
    importeIepcEur: roundEuro(seie?.importeIepcEur ?? null),
    importeTotalEur: roundEuro(importeTotalEur),
    precioReeEurMwh: ratio(importeTotalEur, precioReeDenominator),
    importeOmieEur: null,
    precioOmieEurMwh: null,
    precioRetribucionOsEurMwh,
    importeRetribucionOsEur: roundEuro(multiply(precioRetribucionOsEurMwh, roundedPrograma)),
    precioRetribucionOmEurMwh: null,
    importeRetribucionOmEur: null
  };
}

function buildRows(values: MonthValues[]): AnnualReportMetricRow[] {
  const totalImporteRee = sumPresent(values.map((month) => month.importeTotalEur));
  const totalBc = sumPresent(values.map((month) => month.energiaBcMwh));
  const totalPrograma = sumPresent(values.map((month) => month.programaMwh));
  const totalImporteOmie = sumPresent(values.map((month) => month.importeOmieEur));
  const totalImporteRetribucionOs = sumPresent(values.map((month) => month.importeRetribucionOsEur));
  const totalImporteRetribucionOm = sumPresent(values.map((month) => month.importeRetribucionOmEur));
  const rows: Array<{ key: AnnualMetricKey; label: string; kind: AnnualMetricKind; total?: number | string | null; editable?: { type: AnnualReportRetributionType } }> = [
    { key: "programaMwh", label: "Programa (MWh)", kind: "energy" },
    { key: "versionUtilizada", label: "Version utilizada", kind: "text", total: null },
    { key: "energiaBcMwh", label: "Energia en BC (MWh)", kind: "energy" },
    { key: "energiaPfMwh", label: "Energia en PF (MWh)", kind: "energy" },
    { key: "perdidasMwh", label: "Perdidas (MWh)", kind: "energy" },
    { key: "importeCadEur", label: "Importe CAD (EUR)", kind: "currency" },
    { key: "importeDsvEur", label: "Importe DSV (EUR)", kind: "currency" },
    { key: "importePc3Eur", label: "Importe PC3 (EUR)", kind: "currency" },
    { key: "importeBs3Eur", label: "Importe BS3 (EUR)", kind: "currency" },
    { key: "importeRad3Eur", label: "Importe RAD3 (EUR)", kind: "currency" },
    { key: "importeTotalEur", label: "Importe total REE (EUR)", kind: "currency" },
    { key: "precioReeEurMwh", label: "Precio REE (EUR/MWh)", kind: "price", total: ratio(totalImporteRee, totalBc && totalBc !== 0 ? totalBc : totalPrograma) },
    { key: "importeOmieEur", label: "Importe OMIE (EUR)", kind: "currency" },
    { key: "precioOmieEurMwh", label: "Precio OMIE (EUR/MWh)", kind: "price", total: ratio(totalImporteOmie, totalPrograma) },
    { key: "precioRetribucionOsEurMwh", label: "Precio retribucion OS (EUR/MWh)", kind: "price", total: ratio(totalImporteRetribucionOs, totalPrograma), editable: { type: AnnualReportRetributionType.OS } },
    { key: "importeRetribucionOsEur", label: "Importe retribucion OS (EUR)", kind: "currency" },
    { key: "precioRetribucionOmEurMwh", label: "Precio retribucion OM (EUR/MWh)", kind: "price", total: ratio(totalImporteRetribucionOm, totalPrograma), editable: { type: AnnualReportRetributionType.OM } },
    { key: "importeRetribucionOmEur", label: "Importe retribucion OM (EUR)", kind: "currency" }
  ];
  return rows.map((row) => ({
    ...row,
    months: values.map((month) => month[row.key]),
    total: row.total !== undefined ? row.total : totalByKind(values.map((month) => month[row.key]), row.kind)
  }));
}

function buildSeieRows(values: MonthValues[]): AnnualReportMetricRow[] {
  const totalImporteRee = sumPresent(values.map((month) => month.importeTotalEur));
  const totalBc = sumPresent(values.map((month) => month.energiaBcMwh));
  const totalPrograma = sumPresent(values.map((month) => month.programaMwh));
  const totalImporteRetribucionOs = sumPresent(values.map((month) => month.importeRetribucionOsEur));
  const rows: Array<{ key: AnnualMetricKey; label: string; kind: AnnualMetricKind; total?: number | string | null; editable?: { type: AnnualReportRetributionType } }> = [
    { key: "programaMwh", label: "Programa (MWh)", kind: "energy" },
    { key: "versionUtilizada", label: "Version utilizada", kind: "text", total: null },
    { key: "energiaBcMwh", label: "Energia en BC (MWh)", kind: "energy" },
    { key: "importeIeadEur", label: "Importe IEAD (EUR)", kind: "currency" },
    { key: "importeIecdEur", label: "Importe IECD (EUR)", kind: "currency" },
    { key: "importeIepcEur", label: "Importe IEPC (EUR)", kind: "currency" },
    { key: "importeTotalEur", label: "Importe total REE (EUR)", kind: "currency" },
    { key: "precioReeEurMwh", label: "Precio REE (EUR/MWh)", kind: "price", total: ratio(totalImporteRee, totalBc && totalBc !== 0 ? totalBc : totalPrograma) },
    { key: "precioRetribucionOsEurMwh", label: "Precio retribucion OS (EUR/MWh)", kind: "price", total: ratio(totalImporteRetribucionOs, totalPrograma), editable: { type: AnnualReportRetributionType.OS } },
    { key: "importeRetribucionOsEur", label: "Importe retribucion OS (EUR)", kind: "currency" }
  ];
  return rows.map((row) => ({
    ...row,
    months: values.map((month) => month[row.key]),
    total: row.total !== undefined ? row.total : totalByKind(values.map((month) => month[row.key]), row.kind)
  }));
}

function buildMissingMonth(month: number, values: MonthValues) {
  const missing: string[] = [];
  if (values.programaMwh === null && values.importeOmieEur === null) missing.push("OMIE");
  if (values.versionUtilizada === null) missing.push("Version Medidas/Reganecu");
  if (values.energiaBcMwh === null && values.energiaPfMwh === null && values.perdidasMwh === null) missing.push("Medidas");
  if (values.importeCadEur === null && values.importeDsvEur === null && values.importePc3Eur === null && values.importeBs3Eur === null && values.importeRad3Eur === null) missing.push("Reganecu");
  return { month, label: monthLabel(month), missing };
}

function buildSeieMissingMonth(month: number, values: MonthValues) {
  const missing: string[] = [];
  if (values.programaMwh === null) missing.push("Programa SEIE C2 IEAC");
  if (values.versionUtilizada === null) missing.push("Version SEIE");
  if (values.energiaBcMwh === null) missing.push("Energia BC SEIE IEAC");
  if (values.importeIeadEur === null && values.importeIecdEur === null && values.importeIepcEur === null) missing.push("Liquidaciones SEIE");
  return { month, label: monthLabel(month), missing };
}

function totalByKind(values: Array<number | string | null>, kind: AnnualMetricKind) {
  return kind === "text" || kind === "price" ? null : sumPresent(values);
}

function sumPresent(values: Array<number | string | null>) {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : null;
}

function nullableSum(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : null;
}

function addNullable(left: number | null, right: number | null) {
  if (left === null) return right;
  if (right === null) return left;
  return left + right;
}

function multiply(left: number | null, right: number | null) {
  return left === null || right === null ? null : left * right;
}

function diff(after: number | null, before: number | null) {
  return after === null || before === null ? null : after - before;
}

function ratio(numerator: number | null, denominator: number | null) {
  return numerator === null || denominator === null || denominator === 0 ? null : Number((numerator / denominator).toFixed(24));
}

function roundEnergy(value: number | null) {
  return value === null || !Number.isFinite(value) ? null : Number(value.toFixed(3));
}

function roundEuro(value: number | null) {
  return value === null || !Number.isFinite(value) ? null : Number(value.toFixed(2));
}

function roundPrice(value: number | null) {
  return value === null || !Number.isFinite(value) ? null : Number(value.toFixed(12));
}

function displayMedperEnergy(value: number | null) {
  return value === null || !Number.isFinite(value) ? null : Math.abs(value);
}

function decimalToNumber(value: Prisma.Decimal) {
  return Number(value.toString());
}

function decimalToNullableNumber(value: Prisma.Decimal | null | undefined) {
  return value === null || value === undefined ? null : Number(value.toString());
}

function isAnnualVersion(version: string): version is AnnualReportVersion {
  return VERSION_PRIORITY.includes(version as AnnualReportVersion);
}

function buildYearRange(year: number) {
  return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
}

function buildOmieKey(fecha: string, periodo: number, market: "MD" | "IDA1" | "IDA2" | "IDA3" | "XBID") {
  return `${fecha}|${periodo}|${market}`;
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function monthLabel(month: number) {
  return ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"][month - 1] ?? String(month);
}

function validateYear(year: number) {
  if (!Number.isSafeInteger(year) || year < 2000 || year > 2100) {
    throw new BadRequestException("El parametro year debe ser un ano valido.");
  }
}

function validateMonth(month: number) {
  if (!Number.isSafeInteger(month) || month < 1 || month > 12) {
    throw new BadRequestException("El parametro month debe ser un mes valido.");
  }
}

function validateRetributionType(type: string): asserts type is AnnualReportRetributionType {
  if (type !== AnnualReportRetributionType.OS && type !== AnnualReportRetributionType.OM) {
    throw new BadRequestException("El tipo de retribucion debe ser OS u OM.");
  }
}

function asJsonRecord(value: Prisma.JsonValue): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isStromTransaction(payload: Record<string, unknown>) {
  const unit = readPayloadText(payload, ["unit", "unidad", "uofertante", "uOfertante"]);
  const agent = readPayloadText(payload, ["agent", "agente"]);
  return normalizeText(unit) === normalizeText(STROM_UOFERTANTE) || normalizeText(agent) === normalizeText(STROM_AGENT);
}

function transactionSign(value: string | null) {
  const normalized = normalizeText(value);
  if (normalized === "BID") return 1;
  if (normalized === "ASK") return -1;
  return null;
}

function readPayloadText(payload: Record<string, unknown>, names: string[]) {
  const value = readPayloadValue(payload, names);
  if (value === null || value === undefined) return null;
  return String(value).trim() || null;
}

function readPayloadInteger(payload: Record<string, unknown>, names: string[]) {
  const value = readPayloadNumber(payload, names);
  return value === null || !Number.isSafeInteger(value) ? null : value;
}

function readPayloadNumber(payload: Record<string, unknown>, names: string[]) {
  const value = readPayloadValue(payload, names);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const normalized = trimmed.includes(",") ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPayloadValue(payload: Record<string, unknown>, names: string[]) {
  const normalizedNames = new Set(names.map(normalizePayloadKey));
  for (const [key, value] of Object.entries(payload)) {
    if (normalizedNames.has(normalizePayloadKey(key))) return value;
  }
  return null;
}

function normalizePayloadKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function normalizeText(value: string | null) {
  return (value ?? "").trim().toUpperCase();
}

function parseTransactionDate(value: string | null) {
  if (!value) return null;
  const normalized = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function buildTransactionDedupeKey(payload: Record<string, unknown>, fechaEntrega: string, periodo: number | null, tipTrans: string | null, qty: number | null, price: number | null) {
  const idTrans = readPayloadText(payload, ["idtrans", "idTrans", "id_trans"]);
  if (idTrans) return `idtrans:${idTrans}`;
  const idOrdr = readPayloadText(payload, ["idOrdr", "idordr", "id_order"]);
  const contract = readPayloadText(payload, ["contract", "contrato"]);
  return periodo && tipTrans && qty !== null && price !== null ? ["raw", fechaEntrega, periodo, normalizeText(tipTrans), qty, price, idOrdr ?? "", contract ?? ""].join("|") : null;
}
