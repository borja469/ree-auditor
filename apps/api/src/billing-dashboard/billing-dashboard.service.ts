import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { CmInvoiceConsumptionSource, CmInvoiceCostRunStatus, CmInvoiceMarginStatus, CmInvoiceProfileType, CmInvoiceProcessingStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { buildPricingCalendarRange, getMadridParts } from "../pricing-base/calendar_builder";
import { resolvePricingPeriod } from "../pricing-base/pricing_period_adapter";
import { RegulatedLossesService } from "../ree-losses/regulated-losses.service";
import { ReeLossesRegulatoryEngine } from "../ree-losses/regulatory-engine.service";
import { normalizePeriodo, normalizeTarifa } from "../ree-losses/period-engine";
import { GisceClientService, GisceConfigInput, GisceF1Item, GisceF5dItem, GisceInvoiceItem, GisceInvoiceLineItem, GisceP1Item, GisceP5dItem } from "./gisce-client.service";
import { BillingDashboardCostsService } from "./billing-dashboard-costs.service";
import { costComponentNature, type CostComponent, type CostNature } from "./billing-dashboard-costs.service";

const ENERGY_ACCOUNT_NAME = "Tarifas Acceso / Energia";
const PROFILE_TARIFF_COLUMNS: Record<string, "profile20td" | "profile30td" | "profile30tdve" | "profile61td"> = {
  "2.0TD": "profile20td",
  "3.0TD": "profile30td",
  "3.0TDVE": "profile30tdve",
  "6.1TD": "profile61td",
  "6.2TD": "profile61td",
  "6.3TD": "profile61td",
  "6.4TD": "profile61td"
};
const PROFILE_SOURCES = new Set<CmInvoiceConsumptionSource>([
  CmInvoiceConsumptionSource.PROFILE_FINAL,
  CmInvoiceConsumptionSource.PROFILE_INTERMEDIATE,
  CmInvoiceConsumptionSource.PROFILE_INITIAL
]);
const NORMALIZED_RESOLUTION_MINUTES = 15;
const ENERGY_RECONCILIATION_TOLERANCE_KWH = 1;
const BILLING_JOB_ACTIVE_STATUSES = ["QUEUED", "RUNNING"];
const BILLING_JOB_PROCESS_BATCH_SIZE = 5;
const BILLING_PROCESS_PENDING_STATUSES = [CmInvoiceProcessingStatus.IMPORTED, CmInvoiceProcessingStatus.WARNING];
const BILLING_MARGIN_JOB_DEFAULT_CONCURRENCY = 4;

type BillingJobType = "IMPORT_INVOICES" | "PROCESS_PENDING" | "CALCULATE_MARGINS";
type MarginJobMode = "PENDING_ONLY" | "RECALCULATE";
const MARGIN_CALCULATION_VERSION = "BILLING_MARGIN_SIMPLE_V1";
const NETWORK_SYSTEM_ADJUSTMENT_CONCEPT = "AJUSTE POR COSTES DEL SISTEMA DE RED ELECTRICA DE ESPANA";
const OPERATIONAL_BALANCE_MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

type OperationalBalanceUnit = "COUNT" | "EUR" | "EUR_MWH" | "KWH";
type OperationalBalanceCell = {
  value: number | null;
  invoiceCount: number;
  calculatedInvoiceCount: number;
  missingInvoiceCount: number;
  warningInvoiceCount: number;
};
export type OperationalBalanceRow = {
  key: string;
  label: string;
  unit: OperationalBalanceUnit;
  level: number;
  months: OperationalBalanceCell[];
  total: OperationalBalanceCell;
  children?: OperationalBalanceRow[];
};
export type OperationalBalanceResponse = {
  year: number;
  availableYears: number[];
  months: string[];
  rows: OperationalBalanceRow[];
};

@Injectable()
export class BillingDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gisce: GisceClientService,
    private readonly regulatoryEngine: ReeLossesRegulatoryEngine,
    private readonly lossesService: RegulatedLossesService,
    private readonly costsService: BillingDashboardCostsService
  ) {}

  metadata() {
    return this.gisce.invoiceFields();
  }

  diagnostic() {
    return this.gisce.diagnostic();
  }

  gisceConfig() {
    return this.gisce.getStoredConfig();
  }

  saveGisceConfig(input: GisceConfigInput) {
    return this.gisce.saveStoredConfig(input);
  }

  testGisceConnection() {
    return this.gisce.testConnection();
  }

  async listInvoices(query: Record<string, unknown>) {
    const skip = parseInteger(query.skip, 0, 0, 1_000_000);
    const take = parseInteger(query.take, 100, 1, 1000);
    const sort = text(query.sort) ?? "invoiceDate";
    const direction = text(query.direction) === "asc" ? "asc" : "desc";
    const where: Prisma.CmInvoiceWhereInput = {
      ...dateRange("invoiceDate", query.invoiceDateFrom, query.invoiceDateTo),
      ...(typeof query.cups === "string" && query.cups.trim() ? { cups: { contains: query.cups.trim(), mode: "insensitive" } } : {}),
      ...(typeof query.invoiceNumber === "string" && query.invoiceNumber.trim() ? { invoiceNumber: { contains: query.invoiceNumber.trim(), mode: "insensitive" } } : {}),
      ...(typeof query.polissa === "string" && query.polissa.trim() ? { polissaNumber: { contains: query.polissa.trim(), mode: "insensitive" } } : {}),
      ...(typeof query.tariff === "string" && query.tariff.trim() ? { tariffCode: { equals: query.tariff.trim(), mode: "insensitive" } } : {}),
      ...(typeof query.priceListName === "string" && query.priceListName.trim() ? { priceListName: { contains: query.priceListName.trim(), mode: "insensitive" } } : {}),
      ...(typeof query.invoicingMode === "string" && query.invoicingMode.trim() ? { compatibleInvoicingModes: { some: { name: { equals: query.invoicingMode.trim(), mode: "insensitive" } } } } : {}),
      ...(typeof query.status === "string" && query.status.trim() ? { processingStatus: query.status.trim() as CmInvoiceProcessingStatus } : {})
    };
    if (typeof query.search === "string" && query.search.trim()) {
      const search = query.search.trim();
      where.OR = [
        { invoiceNumber: { contains: search, mode: "insensitive" } },
        { cups: { contains: search, mode: "insensitive" } },
        { polissaNumber: { contains: search, mode: "insensitive" } }
      ];
    }
    if (typeof query.curveSource === "string" && query.curveSource.trim()) {
      const source = query.curveSource.trim();
      if (source === "F1") where.f1Intervals = { gt: 0 };
      if (source === "F5D") where.f5dIntervals = { gt: 0 };
      if (source === "P1") where.p1Intervals = { gt: 0 };
      if (source === "TgP1") where.p1Intervals = { gt: 0 };
      if (source === "P5D") where.p5dIntervals = { gt: 0 };
      if (source === "PROFILE") where.profiledIntervals = { gt: 0 };
      if (source === "MISSING") where.missingIntervals = { gt: 0 };
    }
    if (query.withIssues === "true") where.reconciliationIssues = { not: Prisma.JsonNull };
    if (query.withIssues === "false") where.reconciliationIssues = { equals: Prisma.JsonNull };
    const orderBy = invoiceOrderBy(sort, direction);
    const economicQuery = isEconomicInvoiceQuery(query, sort);
    const baseRows = await this.prisma.cmInvoice.findMany({
      where,
      orderBy,
      skip: economicQuery ? 0 : skip,
      take: economicQuery ? 5000 : take,
      include: { lines: true }
    });
    let enrichedRows = await this.enrichInvoiceRows(baseRows);
    if (economicQuery) {
      enrichedRows = filterEconomicInvoiceRows(enrichedRows, query);
      sortEconomicInvoiceRows(enrichedRows, sort, direction);
    }
    const total = economicQuery ? enrichedRows.length : await this.prisma.cmInvoice.count({ where });
    const rows = economicQuery ? enrichedRows.slice(skip, skip + take) : enrichedRows;

    return {
      total,
      page: Math.floor(skip / take) + 1,
      pageSize: take,
      hasNext: skip + rows.length < total,
      summary: await this.invoiceSummary(where),
      rows
    };
  }

  async invoiceDetail(id: string) {
    const invoice = await this.prisma.cmInvoice.findUnique({ where: { id }, include: { lines: true, compatibleInvoicingModes: { orderBy: { name: "asc" } }, curve: { orderBy: { datetime: "asc" } } } });
    if (!invoice) throw new NotFoundException("Factura no encontrada.");
    const energyByPeriod = summarizeInvoiceEnergy(invoice.lines);
    const curveByPeriod = summarizeCurveByPeriod(invoice.curve);
    return {
      ...invoiceRow(invoice),
      energyByPeriod,
      compatibleInvoicingModes: invoice.compatibleInvoicingModes.map(invoicingModeRow),
      lines: invoice.lines.map((line) => ({
        id: line.id,
        accountId: line.accountId,
        accountName: line.accountName,
        lineName: line.lineName,
        quantity: decimalToNumber(line.quantity),
        priceUnit: decimalToNumber(line.priceUnit),
        priceSubtotal: decimalToNumber(line.priceSubtotal)
      })),
      curveSummary: summarizeCurve(invoice.curve),
      reconciliation: ["P1", "P2", "P3", "P4", "P5", "P6"].map((period) => {
        const billed = energyByPeriod[period] ?? 0;
        const curve = curveByPeriod[period] ?? 0;
        return { period, invoiceKwh: billed, curveKwh: curve, differenceKwh: round(billed - curve, 6), differencePct: billed ? round(((curve - billed) / billed) * 100, 6) : null };
      }),
      issues: Array.isArray(invoice.reconciliationIssues) ? invoice.reconciliationIssues : [],
      issueCount: issueCount(invoice.reconciliationIssues)
    };
  }

  async invoiceCurve(id: string, query: Record<string, unknown>) {
    const skip = parseInteger(query.skip, 0, 0, 10_000_000);
    const take = parseInteger(query.take, 50, 1, 500);
    const where: Prisma.CmInvoiceConsumptionCurveWhereInput = {
      invoiceId: id,
      ...(typeof query.period === "string" && query.period.trim() ? { tariffPeriod: query.period.trim() } : {}),
      ...(typeof query.source === "string" && query.source.trim()
        ? query.source === "PROFILE"
          ? { consumptionSource: { in: [CmInvoiceConsumptionSource.PROFILE_FINAL, CmInvoiceConsumptionSource.PROFILE_INTERMEDIATE, CmInvoiceConsumptionSource.PROFILE_INITIAL] } }
          : query.source === "TgP1"
            ? { consumptionSource: CmInvoiceConsumptionSource.P1 }
            : { consumptionSource: query.source.trim() as CmInvoiceConsumptionSource }
        : {})
    };
    const [total, rows] = await Promise.all([
      this.prisma.cmInvoiceConsumptionCurve.count({ where }),
      this.prisma.cmInvoiceConsumptionCurve.findMany({ where, orderBy: { datetime: "asc" }, skip, take })
    ]);
    return {
      total,
      page: Math.floor(skip / take) + 1,
      pageSize: take,
      items: rows.map((row) => ({
        id: row.id,
        datetime: row.datetime.toISOString(),
        tariffPeriod: row.tariffPeriod,
        consumptionMeterKwh: decimalToNumber(row.consumptionMeterKwh),
        consumptionSource: row.consumptionSource,
        sourceRawId: row.sourceRawId,
        sourceResolutionMinutes: row.sourceResolutionMinutes,
        profileType: row.profileType,
        profileVersionId: row.profileVersionId,
        profileRowId: row.profileRowId,
        lossVersion: row.lossVersion,
        lossSourceId: row.lossSourceId,
        lossPercentage: decimalToNumber(row.lossPercentage),
        consumptionPfKwh: decimalToNumber(row.consumptionPfKwh),
        consumptionBcKwh: decimalToNumber(row.consumptionBcKwh)
      }))
    };
  }

  async listImportBatches(query: Record<string, unknown>) {
    const take = parseInteger(query.take, 50, 1, 500);
    return this.prisma.cmInvoiceImportBatch.findMany({ orderBy: { startedAt: "desc" }, take });
  }

  async listJobs(query: Record<string, unknown>) {
    const take = parseInteger(query.take, 20, 1, 100);
    const where = typeof query.status === "string" && query.status.trim() ? { status: query.status.trim() } : undefined;
    const jobs = await this.prisma.cmBillingJob.findMany({ where, orderBy: { createdAt: "desc" }, take });
    return jobs.map(billingJobRow);
  }

  async listInvoicingModes() {
    const rows = await this.prisma.cmInvoiceInvoicingMode.groupBy({
      by: ["externalId", "name"],
      orderBy: { name: "asc" }
    });
    return rows.map((row) => ({ id: row.externalId, name: row.name }));
  }

  async listTariffs() {
    const rows = await this.prisma.cmInvoice.groupBy({
      by: ["tariffCode"],
      where: { tariffCode: { not: null } },
      orderBy: { tariffCode: "asc" }
    });
    return rows.map((row) => row.tariffCode).filter((tariff): tariff is string => Boolean(tariff));
  }

  async operationalBalance(yearInput?: number | string, filters: Record<string, unknown> = {}): Promise<OperationalBalanceResponse> {
    const requestedYear = Number(yearInput ?? new Date().getFullYear());
    const year = Number.isFinite(requestedYear) && requestedYear >= 2000 && requestedYear <= 2100 ? Math.trunc(requestedYear) : new Date().getFullYear();
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year, 11, 31));
    const where: Prisma.CmInvoiceWhereInput = {
      invoiceDate: { gte: from, lte: to },
      ...(typeof filters.cups === "string" && filters.cups.trim() ? { cups: { contains: filters.cups.trim(), mode: "insensitive" } } : {}),
      ...(typeof filters.tariff === "string" && filters.tariff.trim() ? { tariffCode: { equals: filters.tariff.trim(), mode: "insensitive" } } : {}),
      ...(typeof filters.invoicingMode === "string" && filters.invoicingMode.trim() ? { compatibleInvoicingModes: { some: { name: { equals: filters.invoicingMode.trim(), mode: "insensitive" } } } } : {})
    };
    const invoices = await this.prisma.cmInvoice.findMany({
      where,
      orderBy: [{ invoiceDate: "asc" }, { invoiceNumber: "asc" }],
      include: { lines: true }
    });
    const invoiceIds = invoices.map((invoice) => invoice.id);
    const [availableYearsRows, curveTotals, costRuns, margins] = await Promise.all([
      this.prisma.$queryRaw<Array<{ year: number }>>`
        SELECT DISTINCT EXTRACT(YEAR FROM invoice_date)::int AS year
        FROM cm_invoices
        WHERE invoice_date IS NOT NULL
        ORDER BY year DESC
      `,
      invoiceIds.length
        ? this.prisma.cmInvoiceConsumptionCurve.groupBy({
            by: ["invoiceId"],
            where: { invoiceId: { in: invoiceIds } },
            _sum: { consumptionPfKwh: true, consumptionBcKwh: true }
          })
        : Promise.resolve([]),
      invoiceIds.length
        ? this.prisma.cmInvoiceCostRun.findMany({
            where: { invoiceId: { in: invoiceIds } },
            orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }]
          })
        : Promise.resolve([]),
      invoiceIds.length
        ? this.prisma.cmInvoiceMarginSnapshot.findMany({
            where: { invoiceId: { in: invoiceIds } },
            orderBy: [{ calculatedAt: "desc" }, { createdAt: "desc" }]
          })
        : Promise.resolve([])
    ]);
    const latestCostRunByInvoice = new Map<string, (typeof costRuns)[number]>();
    for (const run of costRuns) if (!latestCostRunByInvoice.has(run.invoiceId)) latestCostRunByInvoice.set(run.invoiceId, run);
    const costRunIds = [...latestCostRunByInvoice.values()].map((run) => run.id);
    let intervalComponentSums: Array<{ costRunId: string; componentCode: string; costEur: Prisma.Decimal | null }> = [];
    let powerComponentSums: Array<{ costRunId: string; componentCode: string; _sum: { costEur: Prisma.Decimal | null } }> = [];
    if (costRunIds.length) {
      [intervalComponentSums, powerComponentSums] = await Promise.all([
        this.prisma.$queryRaw<Array<{ costRunId: string; componentCode: string; costEur: Prisma.Decimal | null }>>`
            SELECT ic.cost_run_id AS "costRunId", c.component_code::text AS "componentCode", SUM(c.cost_eur) AS "costEur"
            FROM cm_invoice_interval_cost_components c
            JOIN cm_invoice_interval_costs ic ON ic.id = c.interval_cost_id
            WHERE ic.cost_run_id::text IN (${Prisma.join(costRunIds)})
              AND c.status = 'OK'
              AND c.cost_eur IS NOT NULL
            GROUP BY ic.cost_run_id, c.component_code
          `,
        this.prisma.cmInvoicePowerCostComponent.groupBy({
          by: ["costRunId", "componentCode"],
          where: { costRunId: { in: costRunIds }, status: "OK", costEur: { not: null } },
          _sum: { costEur: true }
        })
      ]);
    }
    return buildOperationalBalanceReport({
      year,
      availableYears: availableYearsRows.map((row) => Number(row.year)).filter(Number.isFinite),
      invoices,
      curveTotals,
      costRuns: [...latestCostRunByInvoice.values()],
      margins,
      intervalComponentSums,
      powerComponentSums
    });
  }

  async startImportJob(dateFrom: string, dateTo: string, requestedBy?: string) {
    assertDate(dateFrom, "dateFrom");
    assertDate(dateTo, "dateTo");
    const active = await this.findActiveJob("IMPORT_INVOICES");
    if (active) return billingJobRow(active);
    const job = await this.prisma.cmBillingJob.create({
      data: {
        type: "IMPORT_INVOICES",
        status: "QUEUED",
        requestedBy: text(requestedBy),
        params: { dateFrom, dateTo },
        message: "Importacion GISCE en cola."
      }
    });
    void this.runImportJob(job.id, dateFrom, dateTo);
    return billingJobRow(job);
  }

  async startProcessPendingJob(limit = BILLING_JOB_PROCESS_BATCH_SIZE, requestedBy?: string) {
    const active = await this.findActiveJob("PROCESS_PENDING");
    if (active) return billingJobRow(active);
    const batchSize = Math.min(Math.max(Number(limit) || BILLING_JOB_PROCESS_BATCH_SIZE, 1), 20);
    const totalItems = await this.prisma.cmInvoice.count({ where: { processingStatus: { in: BILLING_PROCESS_PENDING_STATUSES } } });
    const job = await this.prisma.cmBillingJob.create({
      data: {
        type: "PROCESS_PENDING",
        status: "QUEUED",
        requestedBy: text(requestedBy),
        totalItems,
        params: { limit: batchSize },
        message: totalItems ? "Procesamiento de pendientes y warnings en cola." : "No hay facturas importadas o con warning pendientes."
      }
    });
    void this.runProcessPendingJob(job.id, batchSize);
    return billingJobRow(job);
  }

  async startCalculateMarginsJob(dateFrom: string, dateTo: string, mode: MarginJobMode = "PENDING_ONLY", requestedBy?: string) {
    assertDate(dateFrom, "dateFrom");
    assertDate(dateTo, "dateTo");
    const normalizedMode: MarginJobMode = mode === "RECALCULATE" ? "RECALCULATE" : "PENDING_ONLY";
    const active = await this.findActiveJob("CALCULATE_MARGINS");
    if (active) return billingJobRow(active);
    const job = await this.prisma.cmBillingJob.create({
      data: {
        type: "CALCULATE_MARGINS",
        status: "QUEUED",
        requestedBy: text(requestedBy),
        params: { dateFrom, dateTo, mode: normalizedMode },
        message: "Calculo de costes y margenes en cola."
      }
    });
    void this.runCalculateMarginsJob(job.id, dateFrom, dateTo, normalizedMode);
    return billingJobRow(job);
  }

  async calculateInvoiceMargin(invoiceId: string, mode: MarginJobMode = "RECALCULATE") {
    const invoice = await this.prisma.cmInvoice.findUnique({ where: { id: invoiceId }, include: { lines: true } });
    if (!invoice) throw new NotFoundException("Factura no encontrada.");
    const outcome = await this.calculateAndStoreMarginSnapshot(invoice, mode === "PENDING_ONLY" ? "PENDING_ONLY" : "RECALCULATE");
    const snapshot = await this.prisma.cmInvoiceMarginSnapshot.findFirst({
      where: { invoiceId },
      orderBy: [{ calculatedAt: "desc" }, { createdAt: "desc" }]
    });
    return {
      outcome,
      snapshot: snapshot ? marginSnapshotRow(snapshot) : null
    };
  }

  async calculateInvoiceCostsAndMargin(invoiceId: string, mode: MarginJobMode = "RECALCULATE") {
    const costs = await this.costsService.calculateCosts(invoiceId);
    const invoice = await this.prisma.cmInvoice.findUnique({ where: { id: invoiceId }, include: { lines: true } });
    if (!invoice) throw new NotFoundException("Factura no encontrada.");
    const outcome = await this.calculateAndStoreMarginSnapshot(invoice, mode === "PENDING_ONLY" ? "PENDING_ONLY" : "RECALCULATE", costs.latestRun?.id ?? undefined);
    const snapshot = await this.prisma.cmInvoiceMarginSnapshot.findFirst({
      where: { invoiceId, ...(costs.latestRun?.id ? { costRunId: costs.latestRun.id } : {}) },
      orderBy: [{ calculatedAt: "desc" }, { createdAt: "desc" }]
    });
    return {
      costs,
      margin: {
        outcome,
        snapshot: snapshot ? marginSnapshotRow(snapshot) : null
      }
    };
  }

  private async enrichInvoiceRows(invoices: Array<Prisma.CmInvoiceGetPayload<{ include: { lines: true } }>>) {
    const invoiceIds = invoices.map((invoice) => invoice.id);
    const [costRuns, margins, curveTotals] = invoiceIds.length
      ? await Promise.all([
          this.prisma.cmInvoiceCostRun.findMany({
            where: { invoiceId: { in: invoiceIds } },
            orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }]
          }),
          this.prisma.cmInvoiceMarginSnapshot.findMany({
            where: { invoiceId: { in: invoiceIds } },
            orderBy: [{ calculatedAt: "desc" }, { createdAt: "desc" }]
          }),
          this.prisma.cmInvoiceConsumptionCurve.groupBy({
            by: ["invoiceId"],
            where: { invoiceId: { in: invoiceIds } },
            _sum: { consumptionPfKwh: true, consumptionBcKwh: true }
          })
        ])
      : [[], [], []] as const;
    const latestCostRunByInvoice = new Map<string, (typeof costRuns)[number]>();
    for (const run of costRuns) if (!latestCostRunByInvoice.has(run.invoiceId)) latestCostRunByInvoice.set(run.invoiceId, run);
    const latestMarginByInvoice = new Map<string, (typeof margins)[number]>();
    for (const margin of margins) if (!latestMarginByInvoice.has(margin.invoiceId)) latestMarginByInvoice.set(margin.invoiceId, margin);
    const curveTotalsByInvoice = new Map(curveTotals.map((row) => [row.invoiceId, row]));
    return invoices.map((invoice) => {
      const costRun = latestCostRunByInvoice.get(invoice.id) ?? null;
      const margin = latestMarginByInvoice.get(invoice.id) ?? null;
      const curveTotal = curveTotalsByInvoice.get(invoice.id);
      const lineSummary = summarizeInvoiceLineConcepts(invoice.lines);
      const curveIssueCount = issueCount(invoice.reconciliationIssues);
      const costIssueCount = costRun?.incidentsCount ?? 0;
      const marginIssueCount = margin?.marginStatus === CmInvoiceMarginStatus.WARNING ? 1 : 0;
      return {
        ...invoiceRow(invoice),
        energyByPeriod: summarizeInvoiceEnergy(invoice.lines),
        issueCount: curveIssueCount,
        curveIssueCount,
        costIssueCount,
        marginIssueCount,
        totalIssueCount: curveIssueCount + costIssueCount + marginIssueCount,
        pfTotalKwh: decimalToNumber(curveTotal?._sum.consumptionPfKwh),
        bcTotalKwh: decimalToNumber(curveTotal?._sum.consumptionBcKwh),
        curveSummaryText: curveSummaryText(invoice),
        costRunId: costRun?.id ?? null,
        costStatus: costRun?.status ?? null,
        totalCostEur: decimalToNumber(costRun?.totalCostEur),
        associatedRevenueEur: decimalToNumber(margin?.associatedRevenueEur),
        associatedCostEur: decimalToNumber(margin?.associatedCostEur),
        marginEur: decimalToNumber(margin?.marginEur),
        marginEurMwh: decimalToNumber(margin?.marginEurMwh),
        marginStatus: margin?.marginStatus ?? null,
        marginCalculatedAt: margin?.calculatedAt.toISOString() ?? null,
        globalStatus: deriveGlobalStatus(invoice.processingStatus, costRun, margin),
        invoiceAssociatedRevenueEur: lineSummary.associatedRevenueEur
      };
    });
  }

  private async invoiceSummary(where: Prisma.CmInvoiceWhereInput) {
    const [total, ready, withF1, withF5d, withP1, withP5d, withProfile, withIssues] = await Promise.all([
      this.prisma.cmInvoice.count({ where }),
      this.prisma.cmInvoice.count({ where: { ...where, processingStatus: CmInvoiceProcessingStatus.READY } }),
      this.prisma.cmInvoice.count({ where: { ...where, f1Intervals: { gt: 0 } } }),
      this.prisma.cmInvoice.count({ where: { ...where, f5dIntervals: { gt: 0 } } }),
      this.prisma.cmInvoice.count({ where: { ...where, p1Intervals: { gt: 0 } } }),
      this.prisma.cmInvoice.count({ where: { ...where, p5dIntervals: { gt: 0 } } }),
      this.prisma.cmInvoice.count({ where: { ...where, profiledIntervals: { gt: 0 } } }),
      this.prisma.cmInvoice.count({ where: { ...where, reconciliationIssues: { not: Prisma.JsonNull } } })
    ]);
    return { invoices: total, ready, withF1, withF5d, withP1, withP5d, withProfile, withIssues };
  }

  async importInvoices(dateFrom: string, dateTo: string) {
    assertDate(dateFrom, "dateFrom");
    assertDate(dateTo, "dateTo");
    const started = Date.now();
    const batch = await this.prisma.cmInvoiceImportBatch.create({
      data: {
        invoiceDateFrom: parseDateOnly(dateFrom),
        invoiceDateTo: parseDateOnly(dateTo)
      }
    });

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let errors = 0;
    try {
      const result = await this.gisce.searchInvoicesByInvoiceDate(dateFrom, dateTo);
      for (const item of result.items) {
        try {
          const result = await this.upsertInvoice(item, batch.id);
          if (result === "created") created += 1;
          if (result === "updated") updated += 1;
          if (result === "unchanged") unchanged += 1;
        } catch {
          errors += 1;
        }
      }
      return this.prisma.cmInvoiceImportBatch.update({
        where: { id: batch.id },
        data: {
          finishedAt: new Date(),
          executionTimeMs: Date.now() - started,
          giscePages: result.pages,
          totalFound: result.total,
          processedCount: result.items.length,
          createdCount: created,
          updatedCount: updated,
          unchangedCount: unchanged,
          errorCount: errors,
          status: errors ? "WARNING" : "SUCCESS",
          message: errors ? `${errors} facturas no se pudieron importar.` : null
        }
      });
    } catch (error) {
      await this.prisma.cmInvoiceImportBatch.update({
        where: { id: batch.id },
        data: {
          finishedAt: new Date(),
          executionTimeMs: Date.now() - started,
          processedCount: created + updated + unchanged,
          errorCount: 1,
          status: "ERROR",
          message: error instanceof Error ? error.message : String(error)
        }
      });
      throw error;
    }
  }

  async deleteInvoicesByInvoiceDate(dateFrom: string, dateTo: string) {
    assertDate(dateFrom, "dateFrom");
    assertDate(dateTo, "dateTo");
    const from = parseDateOnly(dateFrom);
    const to = parseDateOnly(dateTo);
    if (from.getTime() > to.getTime()) throw new BadRequestException("dateFrom no puede ser posterior a dateTo.");
    const where: Prisma.CmInvoiceWhereInput = {
      invoiceDate: {
        gte: from,
        lte: to
      }
    };
    return this.prisma.$transaction(async (tx) => {
      const invoices = await tx.cmInvoice.findMany({
        where,
        select: { id: true }
      });
      const invoiceIds = invoices.map((invoice) => invoice.id);
      const childWhere = { invoiceId: { in: invoiceIds } };
      const [lines, f1Raw, f5dRaw, p1Raw, p5dRaw, curve] = invoiceIds.length
        ? await Promise.all([
            tx.cmInvoiceLine.deleteMany({ where: childWhere }),
            tx.cmInvoiceCurveF1Raw.deleteMany({ where: childWhere }),
            tx.cmInvoiceCurveF5dRaw.deleteMany({ where: childWhere }),
            tx.cmInvoiceCurveP1Raw.deleteMany({ where: childWhere }),
            tx.cmInvoiceCurveP5dRaw.deleteMany({ where: childWhere }),
            tx.cmInvoiceConsumptionCurve.deleteMany({ where: childWhere })
          ])
        : [{ count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }];
      const deleted = await tx.cmInvoice.deleteMany({ where });
      return {
        invoiceDateFrom: dateFrom,
        invoiceDateTo: dateTo,
        deletedInvoices: deleted.count,
        deletedLines: lines.count,
        deletedF1Raw: f1Raw.count,
        deletedF5dRaw: f5dRaw.count,
        deletedP1Raw: p1Raw.count,
        deletedP5dRaw: p5dRaw.count,
        deletedCurveRows: curve.count
      };
    }, { maxWait: 10_000, timeout: 120_000 });
  }

  async processInvoice(invoiceId: string) {
    const invoice = await this.prisma.cmInvoice.findUnique({ where: { id: invoiceId }, include: { lines: true } });
    if (!invoice) throw new NotFoundException("Factura no encontrada.");
    if (!invoice.periodStart || !invoice.periodEnd || !invoice.tariffCode) {
      await this.markInvoice(invoiceId, "ERROR", "La factura no tiene periodo o tarifa suficiente para construir curva.");
      throw new BadRequestException("La factura no tiene periodo o tarifa suficiente para construir curva.");
    }
    const tariff = normalizeTarifa(invoice.tariffCode);
    if (!tariff) {
      await this.markInvoice(invoiceId, "ERROR", `Tarifa no soportada: ${invoice.tariffCode}.`);
      throw new BadRequestException(`Tarifa no soportada: ${invoice.tariffCode}.`);
    }

    await this.markInvoice(invoiceId, "PROCESSING", null);
    try {
      const issues: CurveIssue[] = [];
      const periodStart = dateOnly(invoice.periodStart)!;
      const periodEnd = dateOnly(invoice.periodEnd)!;
      const calendar = buildInvoiceIntervals(periodStart, periodEnd, tariff);
      const gisceClosingRange = gisceClosingMeasureRange(periodStart, periodEnd);
      const [f1, p1, f5d, p5d] = await Promise.all([
        this.gisce.fetchF1(invoice.cups, gisceClosingRange.startLowerBoundExclusive, gisceClosingRange.endExclusive),
        this.gisce.fetchP1(invoice.cups, gisceClosingRange.startLowerBoundExclusive, gisceClosingRange.endExclusive),
        this.gisce.fetchF5d(invoice.cups, gisceClosingRange.startLowerBoundExclusive, gisceClosingRange.endExclusive),
        this.gisce.fetchP5d(invoice.cups, gisceClosingRange.startLowerBoundExclusive, gisceClosingRange.endExclusive)
      ]);
      const rawIds = await this.storeRawCurves(invoice.id, f1, f5d, p1, p5d);

      const [periodContext, profiles, losses] = await Promise.all([
        this.regulatoryEngine.buildPeriodContext(),
        this.loadProfiles(periodStart, periodEnd, tariff),
        this.lossesService.loadHourlyLosses(buildPricingCalendarRange(periodStart, periodEnd), tariff)
      ]);
      const intervals = calendar.map((interval) => ({
        ...interval,
        tariffPeriod: resolvePricingPeriod(resolvePeriodTariff(tariff), { fecha: interval.fecha, hora: interval.localHour }, periodContext)
      })).filter((interval) => {
        const ok = /^P[1-6]$/.test(interval.tariffPeriod);
        if (!ok) {
          issues.push(intervalIssue(invoice.id, { instant: interval.instant, tariffPeriod: "" }, "PERIOD_NOT_RESOLVED", { tariff }));
        }
        return ok;
      });

      const f1ByInstant = normalizeMeasuresToQuarterHour(f1, rawIds.f1, "F1", "DUPLICATE_F1_INTERVAL", invoice.id, issues, undefined, "MADRID_INTERVAL_END");
      const p1ByInstant = normalizeMeasuresToQuarterHour(p1, rawIds.p1, "P1", "DUPLICATE_P1_INTERVAL", invoice.id, issues, 60, "MADRID_HOUR_END");
      const f5dByInstant = normalizeMeasuresToQuarterHour(f5d, rawIds.f5d, "F5D", "DUPLICATE_F5D_INTERVAL", invoice.id, issues, undefined, "MADRID_INTERVAL_END", 1000);
      const p5dByInstant = normalizeMeasuresToQuarterHour(p5d, rawIds.p5d, "P5D", "DUPLICATE_P5D_INTERVAL", invoice.id, issues, undefined, "MADRID_INTERVAL_END", 1000);
      const energyByPeriod = summarizeInvoiceEnergy(invoice.lines);
      const measuredByPeriod = new Map<string, number>();
      const curve: CurveInterval[] = intervals.map((interval) => {
        const key = interval.instant.toISOString();
        const f1Item = f1ByInstant.get(key);
        const p1Item = f1Item ? undefined : p1ByInstant.get(key);
        const f5dItem = f1Item || p1Item ? undefined : f5dByInstant.get(key);
        const p5dItem = f1Item || p1Item || f5dItem ? undefined : p5dByInstant.get(key);
        const { selected, source } = selectMeasureCandidate(f1Item, p1Item, f5dItem, p5dItem);
        const consumption = selected?.consumption ?? null;
        if (consumption !== null) {
          measuredByPeriod.set(interval.tariffPeriod, (measuredByPeriod.get(interval.tariffPeriod) ?? 0) + consumption);
        }
        return {
          ...interval,
          source,
          consumption,
          raw: selected?.raw ?? null,
          sourceRawId: selected?.sourceRawId ?? null,
          sourceResolutionMinutes: selected?.sourceResolutionMinutes ?? null
        };
      });

      for (const period of ["P1", "P2", "P3", "P4", "P5", "P6"]) {
        const invoiceEnergy = energyByPeriod[period] ?? 0;
        const measuredEnergy = measuredByPeriod.get(period) ?? 0;
        const missing = curve.filter((item) => item.tariffPeriod === period && item.source === CmInvoiceConsumptionSource.MISSING);
        const pending = round(invoiceEnergy - measuredEnergy, 9);
        if (measuredEnergy > invoiceEnergy + ENERGY_RECONCILIATION_TOLERANCE_KWH) {
          issues.push(periodIssue(invoice.id, period, "REAL_ENERGY_EXCEEDS_INVOICE", { invoiceEnergyKwh: invoiceEnergy, measuredEnergyKwh: measuredEnergy, differenceKwh: round(measuredEnergy - invoiceEnergy, 6) }));
          issues.push(periodIssue(invoice.id, period, "PERIOD_RECONCILIATION_ERROR", { invoiceEnergyKwh: invoiceEnergy, measuredEnergyKwh: measuredEnergy }));
          continue;
        }
        if (missing.length === 0) {
          if (Math.abs(pending) > ENERGY_RECONCILIATION_TOLERANCE_KWH) {
            issues.push(periodIssue(invoice.id, period, "PERIOD_RECONCILIATION_ERROR", { invoiceEnergyKwh: invoiceEnergy, measuredEnergyKwh: measuredEnergy, pendingEnergyKwh: pending }));
          }
          continue;
        }
        if (pending <= 0) {
          for (const item of missing) issues.push(intervalIssue(invoice.id, item, "NO_PENDING_ENERGY", { invoiceEnergyKwh: invoiceEnergy, measuredEnergyKwh: measuredEnergy, pendingEnergyKwh: pending }));
          continue;
        }
        const weighted = missing.map((item) => ({ item, profile: profiles.get(item.instant.toISOString()) }));
        for (const entry of weighted) {
          if (!entry.profile) issues.push(intervalIssue(invoice.id, entry.item, "PROFILE_NOT_FOUND", { tariff }));
        }
        const profileWeighted = weighted.filter((entry): entry is { item: CurveInterval; profile: ProfileValue } => Boolean(entry.profile));
        const sum = profileWeighted.reduce((total, entry) => total + entry.profile.value, 0);
        if (profileWeighted.length > 0 && sum <= 0) {
          for (const entry of profileWeighted) issues.push(intervalIssue(invoice.id, entry.item, "PROFILE_VERSION_NOT_RESOLVED", { profileType: entry.profile.type, profileVersionId: entry.profile.versionId }));
          continue;
        }
        for (const entry of profileWeighted) {
          const weight = entry.profile.value / sum;
          entry.item.consumption = round(pending * weight, 9);
          entry.item.source = profileSource(entry.profile.type);
          entry.item.profile = entry.profile;
          entry.item.sourceResolutionMinutes = 60;
        }
      }

      const rows = curve.map((item) => {
        const loss = losses.get(`${item.fecha}|${item.hourOrder}`) ?? { value: null, version: null, sourceId: null };
        const lossPct = loss.value;
        const pf = item.consumption;
        if (pf === null) issues.push(intervalIssue(invoice.id, item, "PF_NOT_CALCULATED", {}));
        if (lossPct === null) {
          issues.push(intervalIssue(invoice.id, item, "LOSSES_NOT_FOUND", {}));
          issues.push(intervalIssue(invoice.id, item, "LOSS_VERSION_NOT_RESOLVED", {}));
        }
        const bc = pf === null || lossPct === null || lossPct >= 100 ? null : pf / (1 - lossPct / 100);
        if (bc === null) issues.push(intervalIssue(invoice.id, item, "BC_NOT_CALCULATED", { lossPct }));
        return {
          invoiceId: invoice.id,
          cups: invoice.cups,
          datetime: item.instant,
          resolutionMinutes: item.resolutionMinutes,
          sourceResolutionMinutes: item.sourceResolutionMinutes,
          tariffPeriod: item.tariffPeriod,
          consumptionMeterKwh: decimalOrNull(item.consumption),
          consumptionPfKwh: decimalOrNull(pf),
          consumptionBcKwh: decimalOrNull(bc),
          lossPercentage: decimalOrNull(lossPct),
          lossVersion: loss.version,
          lossSourceId: loss.sourceId ?? null,
          consumptionSource: item.source,
          profileType: item.profile?.type ?? null,
          profileVersionId: item.profile?.versionId ?? null,
          profileRowId: item.profile?.rowId ?? null,
          sourceRawId: item.sourceRawId,
          validationStatus: issues.some((issue) => issue.datetime === item.instant.toISOString() || issue.period === item.tariffPeriod) ? "WARNING" : "OK"
        };
      });

      const f1Intervals = curve.filter((item) => item.source === CmInvoiceConsumptionSource.F1).length;
      const f5dIntervals = curve.filter((item) => item.source === CmInvoiceConsumptionSource.F5D).length;
      const p1Intervals = curve.filter((item) => item.source === CmInvoiceConsumptionSource.P1).length;
      const p5dIntervals = curve.filter((item) => item.source === CmInvoiceConsumptionSource.P5D).length;
      const profiledIntervals = curve.filter((item) => PROFILE_SOURCES.has(item.source)).length;
      const missingIntervals = curve.filter((item) => item.source === CmInvoiceConsumptionSource.MISSING).length;
      if (missingIntervals > 0) issues.push(periodIssue(invoice.id, null, "CURVE_INCOMPLETE", { missingIntervals }));
      for (const period of ["P1", "P2", "P3", "P4", "P5", "P6"]) {
        const expected = energyByPeriod[period] ?? 0;
        const actual = round(curve.filter((item) => item.tariffPeriod === period).reduce((sum, item) => sum + (item.consumption ?? 0), 0), 6);
        if (Math.abs(expected - actual) > ENERGY_RECONCILIATION_TOLERANCE_KWH) {
          issues.push(periodIssue(invoice.id, period, "PERIOD_RECONCILIATION_ERROR", { invoiceEnergyKwh: expected, curveEnergyKwh: actual, differenceKwh: round(expected - actual, 6) }));
        }
      }

      await this.prisma.cmInvoiceConsumptionCurve.deleteMany({ where: { invoiceId: invoice.id } });
      await this.prisma.cmInvoiceConsumptionCurve.createMany({ data: rows });

      return this.prisma.cmInvoice.update({
        where: { id: invoice.id },
        data: {
          processingStatus: issues.length ? CmInvoiceProcessingStatus.WARNING : CmInvoiceProcessingStatus.READY,
          processingMessage: issues.length ? "Existen incidencias de validacion de curva." : null,
          expectedIntervals: intervals.length,
          f1Intervals,
          f5dIntervals,
          p1Intervals,
          p5dIntervals,
          profiledIntervals,
          missingIntervals,
          reconciliationIssues: issues as unknown as Prisma.InputJsonValue
        }
      });
    } catch (error) {
      await this.markInvoice(invoice.id, "ERROR", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async processPending(limit = 50) {
    const take = Math.min(Math.max(limit, 1), 50);
    const invoices = await this.prisma.cmInvoice.findMany({
      where: { processingStatus: { in: BILLING_PROCESS_PENDING_STATUSES } },
      orderBy: { createdAt: "asc" },
      take
    });
    const results = [];
    for (const invoice of invoices) {
      try {
        results.push(await this.processInvoice(invoice.id));
      } catch (error) {
        results.push({ id: invoice.id, processingStatus: "ERROR", processingMessage: error instanceof Error ? error.message : String(error) });
      }
    }
    const remainingImported = await this.prisma.cmInvoice.count({ where: { processingStatus: CmInvoiceProcessingStatus.IMPORTED } });
    const remainingPending = await this.prisma.cmInvoice.count({ where: { processingStatus: { in: BILLING_PROCESS_PENDING_STATUSES } } });
    return { processed: results.length, remainingImported, remainingPending, results };
  }

  private async findActiveJob(type: BillingJobType) {
    return this.prisma.cmBillingJob.findFirst({
      where: { type, status: { in: BILLING_JOB_ACTIVE_STATUSES } },
      orderBy: { createdAt: "desc" }
    });
  }

  private async runImportJob(jobId: string, dateFrom: string, dateTo: string) {
    await this.prisma.cmBillingJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: new Date(), message: "Importando facturas desde GISCE." }
    });
    try {
      const batch = await this.importInvoices(dateFrom, dateTo);
      await this.prisma.cmBillingJob.update({
        where: { id: jobId },
        data: {
          status: batch.status === "ERROR" ? "ERROR" : "SUCCESS",
          totalItems: batch.totalFound,
          processedItems: batch.processedCount,
          successCount: batch.status === "WARNING" ? 0 : batch.processedCount - batch.errorCount,
          warningCount: batch.status === "WARNING" ? batch.processedCount - batch.errorCount : 0,
          errorCount: batch.errorCount,
          result: batch as unknown as Prisma.InputJsonValue,
          message: batch.message ?? `Importacion finalizada: ${batch.processedCount} facturas procesadas.`,
          finishedAt: new Date()
        }
      });
    } catch (error) {
      await this.failJob(jobId, error);
    }
  }

  private async runProcessPendingJob(jobId: string, batchSize: number) {
    let processedItems = 0;
    let successCount = 0;
    let warningCount = 0;
    let errorCount = 0;
    const queue = await this.prisma.cmInvoice.findMany({
      where: { processingStatus: { in: BILLING_PROCESS_PENDING_STATUSES } },
      orderBy: { createdAt: "asc" },
      select: { id: true, invoiceNumber: true, gisceInvoiceId: true }
    });
    await this.prisma.cmBillingJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: new Date(), totalItems: queue.length, message: "Procesando facturas importadas y warnings." }
    });
    try {
      for (let index = 0; index < queue.length; index += batchSize) {
        const batch = queue.slice(index, index + batchSize);
        const results = [];
        for (const invoice of batch) {
          try {
            results.push(await this.processInvoice(invoice.id));
          } catch (error) {
            results.push({ id: invoice.id, invoiceNumber: invoice.invoiceNumber ?? String(invoice.gisceInvoiceId), processingStatus: "ERROR", processingMessage: error instanceof Error ? error.message : String(error) });
          }
        }
        processedItems += results.length;
        successCount += results.filter((row) => row.processingStatus === CmInvoiceProcessingStatus.READY).length;
        warningCount += results.filter((row) => row.processingStatus === CmInvoiceProcessingStatus.WARNING).length;
        errorCount += results.filter((row) => row.processingStatus === CmInvoiceProcessingStatus.ERROR || row.processingStatus === "ERROR").length;
        const currentItem = results.at(-1);
        const currentLabel = currentItem ? (currentItem.invoiceNumber ?? currentItem.id) : null;
        await this.prisma.cmBillingJob.update({
          where: { id: jobId },
          data: {
            processedItems,
            successCount,
            warningCount,
            errorCount,
            currentItem: currentLabel ? String(currentLabel) : null,
            message: `Facturas procesadas: ${processedItems}. Pendientes en cola: ${Math.max(queue.length - processedItems, 0)}.`
          }
        });
      }
      const remainingPending = await this.prisma.cmInvoice.count({ where: { processingStatus: { in: BILLING_PROCESS_PENDING_STATUSES } } });
      await this.prisma.cmBillingJob.update({
        where: { id: jobId },
        data: {
          status: "SUCCESS",
          processedItems,
          successCount,
          warningCount,
          errorCount,
          result: { processed: processedItems, remainingPending } as Prisma.InputJsonValue,
          message: `Procesamiento finalizado. Procesadas: ${processedItems}. Pendientes o warning actuales: ${remainingPending}.`,
          finishedAt: new Date()
        }
      });
    } catch (error) {
      await this.failJob(jobId, error, { processedItems, successCount, warningCount, errorCount });
    }
  }

  private async runCalculateMarginsJob(jobId: string, dateFrom: string, dateTo: string, mode: MarginJobMode) {
    const from = parseDateOnly(dateFrom);
    const to = parseDateOnly(dateTo);
    const counters = { processedItems: 0, successCount: 0, warningCount: 0, errorCount: 0 };
    const result = { totalFound: 0, processedCount: 0, ok: 0, warnings: 0, errors: 0, withoutCurve: 0, withoutCosts: 0, withoutPf: 0, withoutMappedConcepts: 0 };
    const concurrency = billingMarginJobConcurrency();
    const queue = await this.prisma.cmInvoice.findMany({
      where: { invoiceDate: { gte: from, lte: to } },
      orderBy: [{ invoiceDate: "asc" }, { invoiceNumber: "asc" }],
      include: { lines: true }
    });
    result.totalFound = queue.length;
    await this.prisma.cmBillingJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: new Date(), totalItems: queue.length, message: `Calculando costes y margenes por rango de fecha factura. Concurrencia: ${Math.min(concurrency, Math.max(queue.length, 1))}.` }
    });
    try {
      let cursor = 0;
      const workerCount = Math.min(concurrency, queue.length || 1);
      await Promise.all(Array.from({ length: workerCount }, async () => {
        while (cursor < queue.length) {
          const invoice = queue[cursor++];
          try {
            const outcome = await this.calculateCostsAndStoreMarginSnapshot(invoice, mode);
            counters.processedItems += 1;
            result.processedCount += outcome.processed ? 1 : 0;
            if (outcome.code === "OK") { counters.successCount += 1; result.ok += 1; }
            if (outcome.code === "WARNING") { counters.warningCount += 1; result.warnings += 1; }
            if (outcome.code === "WITHOUT_CURVE") result.withoutCurve += 1;
            if (outcome.code === "WITHOUT_COSTS") result.withoutCosts += 1;
            if (outcome.code === "WITHOUT_PF") result.withoutPf += 1;
            if (outcome.code === "WITHOUT_MAPPED_CONCEPTS") result.withoutMappedConcepts += 1;
          } catch (error) {
            counters.processedItems += 1;
            counters.errorCount += 1;
            result.errors += 1;
          }
          await this.prisma.cmBillingJob.update({
            where: { id: jobId },
            data: {
              ...counters,
              currentItem: invoice.invoiceNumber ?? String(invoice.gisceInvoiceId),
              result: result as unknown as Prisma.InputJsonValue,
              message: `Costes y margenes procesados: ${counters.processedItems} / ${queue.length}.`
            }
          });
        }
      }));
      await this.prisma.cmBillingJob.update({
        where: { id: jobId },
        data: {
          status: counters.errorCount ? "ERROR" : "SUCCESS",
          ...counters,
          result: result as unknown as Prisma.InputJsonValue,
          message: `Calculo de costes y margenes finalizado. OK: ${result.ok}. Warnings: ${result.warnings}. Sin curva: ${result.withoutCurve}. Sin costes: ${result.withoutCosts}.`,
          finishedAt: new Date()
        }
      });
    } catch (error) {
      await this.failJob(jobId, error, counters);
    }
  }

  private async calculateCostsAndStoreMarginSnapshot(invoice: Prisma.CmInvoiceGetPayload<{ include: { lines: true } }>, mode: MarginJobMode) {
    if (invoice.processingStatus !== CmInvoiceProcessingStatus.READY && invoice.processingStatus !== CmInvoiceProcessingStatus.WARNING) return { code: "WITHOUT_CURVE", processed: false };
    if (invoice.expectedIntervals <= 0) return { code: "WITHOUT_CURVE", processed: false };
    const latestCostRun = await this.prisma.cmInvoiceCostRun.findFirst({ where: { invoiceId: invoice.id }, orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }] });
    if (mode === "PENDING_ONLY") {
      if (latestCostRun) {
        const currentSnapshot = await this.prisma.cmInvoiceMarginSnapshot.findUnique({
          where: { invoiceId_costRunId_calculationVersion: { invoiceId: invoice.id, costRunId: latestCostRun.id, calculationVersion: MARGIN_CALCULATION_VERSION } }
        });
        if (currentSnapshot) return { code: currentSnapshot.marginStatus === CmInvoiceMarginStatus.WARNING ? "WARNING" : "OK", processed: false };
        return this.calculateAndStoreMarginSnapshot(invoice, "PENDING_ONLY", latestCostRun.id);
      }
    }
    const costs = await this.costsService.calculateCosts(invoice.id);
    return this.calculateAndStoreMarginSnapshot(invoice, "RECALCULATE", costs.latestRun?.id ?? undefined);
  }

  private async calculateAndStoreMarginSnapshot(invoice: Prisma.CmInvoiceGetPayload<{ include: { lines: true } }>, mode: MarginJobMode, costRunId?: string) {
    if (invoice.processingStatus !== CmInvoiceProcessingStatus.READY && invoice.processingStatus !== CmInvoiceProcessingStatus.WARNING) return { code: "WITHOUT_CURVE", processed: false };
    if (invoice.expectedIntervals <= 0) return { code: "WITHOUT_CURVE", processed: false };
    const costRun = costRunId
      ? await this.prisma.cmInvoiceCostRun.findUnique({ where: { id: costRunId } })
      : await this.prisma.cmInvoiceCostRun.findFirst({ where: { invoiceId: invoice.id }, orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }] });
    if (!costRun) return { code: "WITHOUT_COSTS", processed: false };
    const currentSnapshot = await this.prisma.cmInvoiceMarginSnapshot.findUnique({
      where: { invoiceId_costRunId_calculationVersion: { invoiceId: invoice.id, costRunId: costRun.id, calculationVersion: MARGIN_CALCULATION_VERSION } }
    });
    if (mode === "PENDING_ONLY" && currentSnapshot) return { code: currentSnapshot.marginStatus === CmInvoiceMarginStatus.WARNING ? "WARNING" : "OK", processed: false };
    const margin = await this.buildMarginSnapshot(invoice, costRun);
    if (!margin.hasMappedConcepts) return { code: "WITHOUT_MAPPED_CONCEPTS", processed: false };
    await this.prisma.cmInvoiceMarginSnapshot.upsert({
      where: { invoiceId_costRunId_calculationVersion: { invoiceId: invoice.id, costRunId: costRun.id, calculationVersion: MARGIN_CALCULATION_VERSION } },
      create: {
        invoiceId: invoice.id,
        costRunId: costRun.id,
        calculationVersion: MARGIN_CALCULATION_VERSION,
        marginStatus: margin.status,
        calculatedAt: new Date(),
        associatedRevenueEur: decimalOrNull(margin.associatedRevenueEur),
        associatedCostEur: decimalOrNull(margin.associatedCostEur),
        marginEur: decimalOrNull(margin.marginEur),
        marginEurMwh: decimalOrNull(margin.marginEurMwh),
        pfTotalKwh: decimalOrNull(margin.pfTotalKwh),
        warnings: margin.warnings as unknown as Prisma.InputJsonValue,
        detailsJson: margin.details as unknown as Prisma.InputJsonValue
      },
      update: {
        marginStatus: margin.status,
        calculatedAt: new Date(),
        associatedRevenueEur: decimalOrNull(margin.associatedRevenueEur),
        associatedCostEur: decimalOrNull(margin.associatedCostEur),
        marginEur: decimalOrNull(margin.marginEur),
        marginEurMwh: decimalOrNull(margin.marginEurMwh),
        pfTotalKwh: decimalOrNull(margin.pfTotalKwh),
        warnings: margin.warnings as unknown as Prisma.InputJsonValue,
        detailsJson: margin.details as unknown as Prisma.InputJsonValue
      }
    });
    if (margin.status === CmInvoiceMarginStatus.NOT_AVAILABLE && margin.warnings.includes("PF_NOT_AVAILABLE")) return { code: "WITHOUT_PF", processed: true };
    return { code: margin.status === CmInvoiceMarginStatus.WARNING ? "WARNING" : "OK", processed: true };
  }

  private async buildMarginSnapshot(invoice: Prisma.CmInvoiceGetPayload<{ include: { lines: true } }>, costRun: { id: string; incidentsCount: number; status: CmInvoiceCostRunStatus }) {
    const [components, powerComponents, curve] = await Promise.all([
      this.prisma.cmInvoiceIntervalCostComponent.groupBy({
        by: ["componentCode"],
        where: { intervalCost: { costRunId: costRun.id }, status: "OK", costEur: { not: null } },
        _sum: { costEur: true }
      }),
      this.prisma.cmInvoicePowerCostComponent.groupBy({
        by: ["componentCode"],
        where: { costRunId: costRun.id, status: "OK", costEur: { not: null } },
        _sum: { costEur: true }
      }),
      this.prisma.cmInvoiceConsumptionCurve.aggregate({ where: { invoiceId: invoice.id }, _sum: { consumptionPfKwh: true } })
    ]);
    const costsByNature: Record<CostNature, number> = { ENERGY: 0, POWER: 0 };
    for (const component of components) costsByNature[costComponentNature(component.componentCode as CostComponent)] += Number(component._sum.costEur ?? 0);
    for (const component of powerComponents) costsByNature[costComponentNature(component.componentCode as CostComponent)] += Number(component._sum.costEur ?? 0);
    const lineSummary = summarizeInvoiceLineConcepts(invoice.lines);
    const pfTotalKwh = decimalToNumber(curve._sum.consumptionPfKwh);
    const pfMwh = pfTotalKwh && pfTotalKwh > 0 ? pfTotalKwh / 1000 : null;
    const warnings: string[] = [];
    let associatedRevenueEur = 0;
    let associatedCostEur = 0;
    let marginEur = 0;
    const rows = lineSummary.rows.map((row) => {
      const mapping = marginConceptMapping(row.concept);
      if (!mapping) return { ...row, costEur: null, differenceEur: null, nature: null };
      const costEur = mapping === "ADJUSTMENT" ? 0 : costsByNature[mapping];
      const differenceEur = row.amount - costEur;
      associatedRevenueEur += row.amount;
      associatedCostEur += costEur;
      marginEur += differenceEur;
      return { ...row, costEur, differenceEur, nature: mapping === "ADJUSTMENT" ? "ENERGY" : mapping };
    });
    if (!lineSummary.hasMappedConcepts) warnings.push("NO_ASSOCIATED_CONCEPTS");
    if (!pfMwh) warnings.push("PF_NOT_AVAILABLE");
    if (costRun.incidentsCount > 0 || costRun.status !== CmInvoiceCostRunStatus.COMPLETED) warnings.push("COSTS_WITH_WARNINGS");
    const status = !lineSummary.hasMappedConcepts || !pfMwh
      ? CmInvoiceMarginStatus.NOT_AVAILABLE
      : warnings.includes("COSTS_WITH_WARNINGS")
        ? CmInvoiceMarginStatus.WARNING
        : CmInvoiceMarginStatus.READY;
    return {
      status,
      associatedRevenueEur,
      associatedCostEur,
      marginEur,
      marginEurMwh: pfMwh ? marginEur / pfMwh : null,
      pfTotalKwh,
      warnings,
      hasMappedConcepts: lineSummary.hasMappedConcepts,
      details: { rows, costsByNature, costRunId: costRun.id }
    };
  }

  private async failJob(jobId: string, error: unknown, counters?: { processedItems: number; successCount: number; warningCount?: number; errorCount: number }) {
    await this.prisma.cmBillingJob.update({
      where: { id: jobId },
      data: {
        status: "ERROR",
        ...(counters ?? {}),
        errorCount: counters?.errorCount ?? 1,
        message: error instanceof Error ? error.message : String(error),
        finishedAt: new Date()
      }
    });
  }

  private async upsertInvoice(item: GisceInvoiceItem, batchId: string) {
    const gisceInvoiceId = integer(item.id);
    if (gisceInvoiceId === null) throw new Error("Factura GISCE sin id.");
    const fields = await this.gisce.invoiceFieldNames();
    const current = await this.prisma.cmInvoice.findUnique({ where: { gisceInvoiceId }, include: { lines: true } });
    const priceList = normalizeGiscePriceList(item.llista_preu);
    const normalized = {
      gisceInvoiceId,
      invoiceNumber: text(item.number),
      cupsGisceId: many2oneId(item.cups_id),
      cups: many2oneName(item.cups_id) ?? "",
      polissaId: many2oneId(item.polissa_id),
      polissaNumber: many2oneName(item.polissa_id),
      invoiceDate: parseNullableDate(item[fields.invoiceDateField] ?? item.date_invoice ?? item.data_factura),
      periodStart: parseNullableDate(item[fields.invoiceStartField] ?? item.data_inici ?? item.data_inicial),
      periodEnd: parseNullableDate(item[fields.invoiceEndField] ?? item.data_final),
      tariffCode: normalizeTarifa(many2oneName(item.tarifa_acces_id) ?? text(item.tarifa)) ?? text(many2oneName(item.tarifa_acces_id) ?? item.tarifa),
      priceListId: priceList.priceListId,
      priceListName: priceList.priceListName,
      billedEnergyKwh: decimalOrNull(summarizeGisceInvoiceEnergy(item.invoice_line ?? [])),
      rawPayloadJson: item as Prisma.InputJsonValue,
      importBatchId: batchId
    };
    if (!normalized.cups) throw new Error(`Factura GISCE ${gisceInvoiceId} sin CUPS.`);
    const comparablePayload = {
      gisceInvoiceId: normalized.gisceInvoiceId,
      invoiceNumber: normalized.invoiceNumber,
      cupsGisceId: normalized.cupsGisceId,
      cups: normalized.cups,
      polissaId: normalized.polissaId,
      polissaNumber: normalized.polissaNumber,
      invoiceDate: dateOnly(normalized.invoiceDate),
      periodStart: dateOnly(normalized.periodStart),
      periodEnd: dateOnly(normalized.periodEnd),
      tariffCode: normalized.tariffCode,
      priceListId: normalized.priceListId,
      priceListName: normalized.priceListName,
      billedEnergyKwh: normalized.billedEnergyKwh?.toString() ?? null
    };
    const comparable = JSON.stringify(comparablePayload);
    const previous = current ? JSON.stringify({
      gisceInvoiceId: current.gisceInvoiceId,
      invoiceNumber: current.invoiceNumber,
      cupsGisceId: current.cupsGisceId,
      cups: current.cups,
      polissaId: current.polissaId,
      polissaNumber: current.polissaNumber,
      invoiceDate: dateOnly(current.invoiceDate),
      periodStart: dateOnly(current.periodStart),
      periodEnd: dateOnly(current.periodEnd),
      tariffCode: current.tariffCode,
      priceListId: current.priceListId,
      priceListName: current.priceListName,
      billedEnergyKwh: current.billedEnergyKwh?.toString() ?? null
    }) : null;
    const invoice = await this.prisma.cmInvoice.upsert({
      where: { gisceInvoiceId },
      create: normalized,
      update: comparable === previous
        ? { importBatchId: batchId, rawPayloadJson: item as Prisma.InputJsonValue, priceListId: normalized.priceListId, priceListName: normalized.priceListName }
        : current && onlyCommercialMetadataChanged(comparablePayload, JSON.parse(previous ?? "{}"))
          ? { importBatchId: batchId, rawPayloadJson: item as Prisma.InputJsonValue, priceListId: normalized.priceListId, priceListName: normalized.priceListName }
          : { ...normalized, processingStatus: CmInvoiceProcessingStatus.IMPORTED, processingMessage: null }
    });
    await this.syncInvoiceInvoicingModes(invoice.id, priceList.compatibleInvoicingModes);
    for (const line of item.invoice_line ?? []) await this.upsertLine(invoice.id, line);
    return current ? comparable === previous ? "unchanged" : "updated" : "created";
  }

  private async syncInvoiceInvoicingModes(invoiceId: string, modes: Array<{ externalId: number; name: string }>) {
    await this.prisma.cmInvoiceInvoicingMode.deleteMany({ where: { invoiceId } });
    if (modes.length === 0) return;
    await this.prisma.cmInvoiceInvoicingMode.createMany({
      data: modes.map((mode) => ({ invoiceId, externalId: mode.externalId, name: mode.name })),
      skipDuplicates: true
    });
  }

  private async upsertLine(invoiceId: string, line: GisceInvoiceLineItem) {
    const gisceLineId = integer(line.id);
    if (gisceLineId === null) return;
    await this.prisma.cmInvoiceLine.upsert({
      where: { gisceLineId },
      create: {
        invoiceId,
        gisceLineId,
        accountId: many2oneId(line.account_id),
        accountName: many2oneName(line.account_id),
        lineName: text(line.name),
        quantity: decimalOrNull(numeric(line.quantity)),
        priceUnit: decimalOrNull(numeric(line.price_unit)),
        priceSubtotal: decimalOrNull(numeric(line.price_subtotal)),
        rawPayloadJson: line as Prisma.InputJsonValue
      },
      update: {
        invoiceId,
        accountId: many2oneId(line.account_id),
        accountName: many2oneName(line.account_id),
        lineName: text(line.name),
        quantity: decimalOrNull(numeric(line.quantity)),
        priceUnit: decimalOrNull(numeric(line.price_unit)),
        priceSubtotal: decimalOrNull(numeric(line.price_subtotal)),
        rawPayloadJson: line as Prisma.InputJsonValue
      }
    });
  }

  private async storeRawCurves(invoiceId: string, f1: GisceF1Item[], f5d: GisceF5dItem[], p1: GisceP1Item[], p5d: GisceP5dItem[]) {
    const f1Ids = new Map<number, string>();
    const f5dIds = new Map<number, string>();
    const p1Ids = new Map<number, string>();
    const p5dIds = new Map<number, string>();
    for (const item of f1) {
      const sourceId = integer(item.id);
      const datetime = parseGisceDate(item.datetime);
      if (sourceId === null || !datetime || !item.name) continue;
      const row = await this.prisma.cmInvoiceCurveF1Raw.upsert({
        where: { invoiceId_gisceSourceId: { invoiceId, gisceSourceId: sourceId } },
        create: f1RawData(invoiceId, sourceId, datetime, item),
        update: f1RawData(invoiceId, sourceId, datetime, item),
        select: { id: true }
      });
      f1Ids.set(sourceId, row.id);
    }
    for (const item of f5d) {
      const sourceId = integer(item.id);
      const datetime = parseGisceDate(item.datetime);
      if (sourceId === null || !datetime || !item.name) continue;
      const row = await this.prisma.cmInvoiceCurveF5dRaw.upsert({
        where: { invoiceId_gisceSourceId: { invoiceId, gisceSourceId: sourceId } },
        create: f5dRawData(invoiceId, sourceId, datetime, item),
        update: f5dRawData(invoiceId, sourceId, datetime, item),
        select: { id: true }
      });
      f5dIds.set(sourceId, row.id);
    }
    for (const item of p1) {
      const sourceId = integer(item.id);
      const datetime = parseGisceDate(item.datetime);
      if (sourceId === null || !datetime || !item.name) continue;
      const row = await this.prisma.cmInvoiceCurveP1Raw.upsert({
        where: { invoiceId_gisceSourceId: { invoiceId, gisceSourceId: sourceId } },
        create: p1RawData(invoiceId, sourceId, datetime, item),
        update: p1RawData(invoiceId, sourceId, datetime, item),
        select: { id: true }
      });
      p1Ids.set(sourceId, row.id);
    }
    for (const item of p5d) {
      const sourceId = integer(item.id);
      const datetime = parseGisceDate(item.datetime);
      if (sourceId === null || !datetime || !item.name) continue;
      const row = await this.prisma.cmInvoiceCurveP5dRaw.upsert({
        where: { invoiceId_gisceSourceId: { invoiceId, gisceSourceId: sourceId } },
        create: p5dRawData(invoiceId, sourceId, datetime, item),
        update: p5dRawData(invoiceId, sourceId, datetime, item),
        select: { id: true }
      });
      p5dIds.set(sourceId, row.id);
    }
    return { f1: f1Ids, f5d: f5dIds, p1: p1Ids, p5d: p5dIds };
  }

  private async loadProfiles(periodStart: string, periodEnd: string, tariff: string) {
    const column = PROFILE_TARIFF_COLUMNS[tariff] ?? "profile61td";
    const rows = buildInvoiceIntervals(periodStart, periodEnd, tariff);
    const start = new Date(rows[0]?.instant ?? `${periodStart}T00:00:00.000Z`);
    const end = new Date((rows[rows.length - 1]?.instant.getTime() ?? start.getTime()) + NORMALIZED_RESOLUTION_MINUTES * 60 * 1000);
    const [finalRows, intermediateRows, initialRows] = await Promise.all([
      this.prisma.esiosReeFinalProfile.findMany({
        where: { datetime: { gte: start, lt: end } },
        include: { upload: true },
        orderBy: [{ upload: { uploadedAt: "desc" } }, { uploadId: "desc" }, { id: "desc" }]
      }),
      this.prisma.esiosProfileIntermediateResult.findMany({
        where: { datetime: { gte: start, lt: end }, tariff: tariff === "3.0TDVE" ? "3.0TDVE" : tariff === "2.0TD" ? "2.0TD" : "3.0TD" },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
      }),
      this.prisma.esiosInitialProfile.findMany({
        where: { datetime: { gte: start, lt: end } },
        include: { upload: true },
        orderBy: [{ upload: { uploadedAt: "desc" } }, { uploadId: "desc" }, { id: "desc" }]
      })
    ]);
    const map = new Map<string, ProfileValue>();
    for (const row of finalRows) {
      const value = decimalToNumber(row[column as "profile20td" | "profile30td" | "profile30tdve"]);
      if (value !== null) addHourlyProfileAsQuarterHours(map, row.datetime, { value, type: CmInvoiceProfileType.FINAL, versionId: row.uploadId, rowId: row.id });
    }
    for (const row of intermediateRows) {
      const value = decimalToNumber(row.intermediateProfile);
      if (value !== null) addHourlyProfileAsQuarterHours(map, row.datetime, { value, type: CmInvoiceProfileType.INTERMEDIO, versionId: row.id, rowId: row.id });
    }
    for (const row of initialRows) {
      const value = decimalToNumber(row[column as "profile20td" | "profile30td" | "profile30tdve"]);
      if (value !== null) addHourlyProfileAsQuarterHours(map, row.datetime, { value, type: CmInvoiceProfileType.INICIAL, versionId: row.uploadId, rowId: row.id });
    }
    return map;
  }

  private markInvoice(id: string, status: keyof typeof CmInvoiceProcessingStatus, message: string | null) {
    return this.prisma.cmInvoice.update({ where: { id }, data: { processingStatus: status, processingMessage: message } });
  }
}

type ProfileValue = { value: number; type: CmInvoiceProfileType; versionId: string; rowId: string };
export type CurveIssueCode =
  | "CURVE_INCOMPLETE"
  | "PROFILE_NOT_FOUND"
  | "LOSSES_NOT_FOUND"
  | "REAL_ENERGY_EXCEEDS_INVOICE"
  | "TARIFF_NOT_FOUND"
  | "PERIOD_NOT_RESOLVED"
  | "DUPLICATE_F1_INTERVAL"
  | "DUPLICATE_F5D_INTERVAL"
  | "DUPLICATE_P1_INTERVAL"
  | "DUPLICATE_P5D_INTERVAL"
  | "SOURCE_RESOLUTION_NOT_RESOLVED"
  | "PF_NOT_CALCULATED"
  | "BC_NOT_CALCULATED"
  | "PROFILE_VERSION_NOT_RESOLVED"
  | "LOSS_VERSION_NOT_RESOLVED"
  | "PERIOD_RECONCILIATION_ERROR"
  | "NO_PENDING_ENERGY";
export type CurveIssue = { invoice_id: string; datetime: string | null; period: string | null; code: CurveIssueCode; detail: Record<string, unknown> };
type CurveInterval = ReturnType<typeof buildInvoiceIntervals>[number] & {
  tariffPeriod: string;
  source: CmInvoiceConsumptionSource;
  consumption: number | null;
  raw: GisceF1Item | GisceF5dItem | GisceP1Item | GisceP5dItem | null;
  sourceRawId?: string | null;
  sourceResolutionMinutes?: number | null;
  profile?: ProfileValue | null;
};

export type NormalizedMeasureCandidate = {
  raw: GisceF1Item | GisceF5dItem | GisceP1Item | GisceP5dItem;
  sourceId: number;
  sourceRawId: string | null;
  sourceResolutionMinutes: number;
  consumption: number;
};

function buildInvoiceIntervals(periodStart: string, periodEnd: string, tariff: string) {
  const resolutionMinutes = NORMALIZED_RESOLUTION_MINUTES;
  const rows = buildPricingCalendarRange(periodStart, periodEnd);
  return rows.flatMap((row) => [0, 15, 30, 45].map((minutes, index) => ({
    instant: new Date(new Date(row.timestampInicio).getTime() + minutes * 60_000),
    fecha: row.fecha,
    localHour: row.hora,
    hourOrder: row.ordenHora,
    quarterHour: index + 1,
    resolutionMinutes
  })));
}

function gisceMeasureRange(intervals: ReturnType<typeof buildInvoiceIntervals>) {
  const first = intervals[0]?.instant;
  const last = intervals[intervals.length - 1]?.instant;
  if (!first || !last) {
    throw new BadRequestException("No se pudo construir el calendario esperado de factura.");
  }
  return {
    startLowerBoundExclusive: formatGisceDateTime(new Date(first.getTime() - 1000)),
    endExclusive: formatGisceDateTime(new Date(last.getTime() + NORMALIZED_RESOLUTION_MINUTES * 60_000))
  };
}

function gisceClosingMeasureRange(periodStart: string, periodEnd: string) {
  return {
    startLowerBoundExclusive: `${periodStart} 00:00:00`,
    endExclusive: `${addIsoDays(periodEnd, 1)} 01:00:00`
  };
}

function formatGisceDateTime(value: Date) {
  return value.toISOString().slice(0, 19).replace("T", " ");
}

function invoiceRow(invoice: {
  id: string;
  gisceInvoiceId: number;
  invoiceNumber: string | null;
  cups: string;
  polissaNumber: string | null;
  invoiceDate: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  tariffCode: string | null;
  priceListId?: number | null;
  priceListName?: string | null;
  processingStatus: CmInvoiceProcessingStatus;
  processingMessage: string | null;
  expectedIntervals: number;
  f1Intervals: number;
  f5dIntervals: number;
  p1Intervals: number;
  p5dIntervals: number;
  profiledIntervals: number;
  missingIntervals: number;
  billedEnergyKwh?: Prisma.Decimal | null;
  reconciliationIssues?: Prisma.JsonValue | null;
}) {
  const real = invoice.f1Intervals + invoice.p1Intervals + invoice.f5dIntervals + invoice.p5dIntervals;
  return {
    id: invoice.id,
    gisceInvoiceId: invoice.gisceInvoiceId,
    invoiceNumber: invoice.invoiceNumber,
    cups: invoice.cups,
    polissaNumber: invoice.polissaNumber,
    invoiceDate: dateOnly(invoice.invoiceDate),
    periodStart: dateOnly(invoice.periodStart),
    periodEnd: dateOnly(invoice.periodEnd),
    tariffCode: invoice.tariffCode,
    priceListId: invoice.priceListId ?? null,
    priceListName: invoice.priceListName ?? null,
    processingStatus: invoice.processingStatus,
    processingMessage: invoice.processingMessage,
    billedEnergyKwh: decimalToNumber(invoice.billedEnergyKwh),
    expectedIntervals: invoice.expectedIntervals,
    f1Intervals: invoice.f1Intervals,
    f5dIntervals: invoice.f5dIntervals,
    p1Intervals: invoice.p1Intervals,
    p5dIntervals: invoice.p5dIntervals,
    profiledIntervals: invoice.profiledIntervals,
    missingIntervals: invoice.missingIntervals,
    f1Pct: pct(invoice.f1Intervals, invoice.expectedIntervals),
    f5dPct: pct(invoice.f5dIntervals, invoice.expectedIntervals),
    p1Pct: pct(invoice.p1Intervals, invoice.expectedIntervals),
    p5dPct: pct(invoice.p5dIntervals, invoice.expectedIntervals),
    profilePct: pct(invoice.profiledIntervals, invoice.expectedIntervals),
    realCoveragePct: pct(real, invoice.expectedIntervals)
  };
}

function invoicingModeRow(row: { externalId: number; name: string }) {
  return { id: row.externalId, name: row.name };
}

function billingJobRow(job: {
  id: string;
  type: string;
  status: string;
  requestedBy: string | null;
  params: Prisma.JsonValue | null;
  result: Prisma.JsonValue | null;
  totalItems: number;
  processedItems: number;
  successCount: number;
  warningCount: number;
  errorCount: number;
  currentItem: string | null;
  message: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    requestedBy: job.requestedBy,
    params: job.params,
    result: job.result,
    totalItems: job.totalItems,
    processedItems: job.processedItems,
    successCount: job.successCount,
    warningCount: job.warningCount,
    errorCount: job.errorCount,
    currentItem: job.currentItem,
    message: job.message,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString()
  };
}

function marginSnapshotRow(snapshot: {
  id: string;
  invoiceId: string;
  costRunId: string;
  calculationVersion: string;
  marginStatus: CmInvoiceMarginStatus;
  calculatedAt: Date;
  associatedRevenueEur: Prisma.Decimal | null;
  associatedCostEur: Prisma.Decimal | null;
  marginEur: Prisma.Decimal | null;
  marginEurMwh: Prisma.Decimal | null;
  pfTotalKwh: Prisma.Decimal | null;
  warnings: Prisma.JsonValue | null;
}) {
  return {
    id: snapshot.id,
    invoiceId: snapshot.invoiceId,
    costRunId: snapshot.costRunId,
    calculationVersion: snapshot.calculationVersion,
    marginStatus: snapshot.marginStatus,
    calculatedAt: snapshot.calculatedAt.toISOString(),
    associatedRevenueEur: decimalToNumber(snapshot.associatedRevenueEur),
    associatedCostEur: decimalToNumber(snapshot.associatedCostEur),
    marginEur: decimalToNumber(snapshot.marginEur),
    marginEurMwh: decimalToNumber(snapshot.marginEurMwh),
    pfTotalKwh: decimalToNumber(snapshot.pfTotalKwh),
    warnings: Array.isArray(snapshot.warnings) ? snapshot.warnings : []
  };
}

function summarizeCurveByPeriod(rows: Array<{ tariffPeriod: string; consumptionMeterKwh: Prisma.Decimal | null }>) {
  const output: Record<string, number> = {};
  for (const row of rows) output[row.tariffPeriod] = (output[row.tariffPeriod] ?? 0) + Number(row.consumptionMeterKwh ?? 0);
  return output;
}

function summarizeCurve(rows: Array<{
  consumptionSource: CmInvoiceConsumptionSource;
  consumptionPfKwh: Prisma.Decimal | null;
  consumptionBcKwh: Prisma.Decimal | null;
}>) {
  const expected = rows.length;
  const f1 = rows.filter((row) => row.consumptionSource === CmInvoiceConsumptionSource.F1).length;
  const f5d = rows.filter((row) => row.consumptionSource === CmInvoiceConsumptionSource.F5D).length;
  const p1 = rows.filter((row) => row.consumptionSource === CmInvoiceConsumptionSource.P1).length;
  const p5d = rows.filter((row) => row.consumptionSource === CmInvoiceConsumptionSource.P5D).length;
  const profiled = rows.filter((row) => PROFILE_SOURCES.has(row.consumptionSource)).length;
  const missing = rows.filter((row) => row.consumptionSource === CmInvoiceConsumptionSource.MISSING).length;
  return {
    expectedIntervals: expected,
    f1Intervals: f1,
    f5dIntervals: f5d,
    p1Intervals: p1,
    p5dIntervals: p5d,
    profiledIntervals: profiled,
    missingIntervals: missing,
    realCoveragePct: pct(f1 + p1 + f5d + p5d, expected),
    profilePct: pct(profiled, expected),
    pfTotalKwh: round(rows.reduce((sum, row) => sum + Number(row.consumptionPfKwh ?? 0), 0), 6),
    bcTotalKwh: rows.some((row) => row.consumptionBcKwh === null) ? null : round(rows.reduce((sum, row) => sum + Number(row.consumptionBcKwh ?? 0), 0), 6)
  };
}

function issueCount(value: Prisma.JsonValue | null | undefined) {
  return Array.isArray(value) ? value.length : 0;
}

function pct(value: number, total: number) {
  return total > 0 ? round((value / total) * 100, 2) : 0;
}

function summarizeInvoiceEnergy(lines: Array<{ accountName: string | null; lineName: string | null; quantity: Prisma.Decimal | null; priceUnit?: Prisma.Decimal | null }>) {
  const output: Record<string, number> = {};
  for (const line of lines) {
    if (normalizeText(line.accountName) !== normalizeText(ENERGY_ACCOUNT_NAME)) continue;
    if (Number(line.priceUnit ?? 0) < 0) continue;
    const period = normalizePeriodo(line.lineName);
    if (!period || !/^P[1-6]$/.test(period)) continue;
    output[period] = (output[period] ?? 0) + Number(line.quantity ?? 0);
  }
  return output;
}

function lineConcept(line: { accountName: string | null; lineName: string | null }) {
  if (!line.lineName) return "-";
  if (/^P[1-6]$/i.test(line.lineName) && line.accountName?.includes("/")) return line.accountName.split("/").pop()?.trim() || line.lineName;
  return line.lineName;
}

function summarizeInvoiceLineConcepts(lines: Array<{ accountName: string | null; lineName: string | null; priceSubtotal: Prisma.Decimal | null }>) {
  const groups = new Map<string, { concept: string; amount: number }>();
  let associatedRevenueEur = 0;
  let hasMappedConcepts = false;
  for (const line of lines) {
    const concept = lineConcept(line);
    const amount = Number(line.priceSubtotal ?? 0);
    const current = groups.get(concept) ?? { concept, amount: 0 };
    current.amount += amount;
    groups.set(concept, current);
  }
  for (const row of groups.values()) {
    if (marginConceptMapping(row.concept)) {
      hasMappedConcepts = true;
      associatedRevenueEur += row.amount;
    }
  }
  return { rows: [...groups.values()], associatedRevenueEur, hasMappedConcepts };
}

class OperationalBalanceRowsBuilder {
  private readonly rows = new Map<string, OperationalBalanceRow>();
  private readonly childKeys = new Map<string, Set<string>>();
  private readonly firstSeenOrder = new Map<string, number>();
  private nextOrder = 0;

  ensureRow(key: string, label: string, unit: OperationalBalanceUnit, level: number, parentKey?: string) {
    this.ensure(key, label, unit, level);
    if (parentKey) this.addChild(parentKey, key);
  }

  add(key: string, label: string, unit: OperationalBalanceUnit, level: number, month: number, value: number, meta: Pick<OperationalBalanceCell, "invoiceCount" | "calculatedInvoiceCount" | "warningInvoiceCount">, parentKey?: string) {
    const row = this.ensure(key, label, unit, level);
    this.addToCell(row.months[month], value, meta);
    if (parentKey) this.addChild(parentKey, key);
  }

  markCoverage(key: string, label: string, unit: OperationalBalanceUnit, level: number, month: number, meta: Pick<OperationalBalanceCell, "invoiceCount" | "calculatedInvoiceCount" | "warningInvoiceCount">) {
    const row = this.ensure(key, label, unit, level);
    this.addToCell(row.months[month], 0, meta);
  }

  applyInvoiceUniverse(invoiceCounts: number[], rowKeys: string[]) {
    for (const key of rowKeys) {
      const row = this.rows.get(key);
      if (!row) continue;
      row.months.forEach((cell, index) => {
        if (cell.invoiceCount < invoiceCounts[index]) {
          cell.invoiceCount = invoiceCounts[index];
          cell.missingInvoiceCount = Math.max(cell.invoiceCount - cell.calculatedInvoiceCount, 0);
        }
      });
    }
  }

  toRows(rootOrder: string[]) {
    for (const row of this.rows.values()) {
      row.total = sumOperationalCells(row.months);
    }
    return rootOrder.map((key) => this.buildRow(key)).filter((row): row is OperationalBalanceRow => Boolean(row));
  }

  private ensure(key: string, label: string, unit: OperationalBalanceUnit, level: number) {
    let row = this.rows.get(key);
    if (!row) {
      row = { key, label, unit, level, months: emptyOperationalCells(), total: emptyOperationalCell() };
      this.rows.set(key, row);
      this.firstSeenOrder.set(key, this.nextOrder++);
    } else {
      row.label = row.label === key ? label : row.label;
      row.unit = unit;
      row.level = level;
    }
    return row;
  }

  private addChild(parentKey: string, childKey: string) {
    const children = this.childKeys.get(parentKey) ?? new Set<string>();
    children.add(childKey);
    this.childKeys.set(parentKey, children);
  }

  private buildRow(key: string): OperationalBalanceRow | null {
    const row = this.rows.get(key);
    if (!row) return null;
    const children = [...(this.childKeys.get(key) ?? [])]
      .sort((left, right) => (this.firstSeenOrder.get(left) ?? 0) - (this.firstSeenOrder.get(right) ?? 0))
      .map((childKey) => this.buildRow(childKey))
      .filter((child): child is OperationalBalanceRow => Boolean(child));
    return { ...row, children: children.length ? children : undefined };
  }

  private addToCell(cell: OperationalBalanceCell, value: number, meta: Pick<OperationalBalanceCell, "invoiceCount" | "calculatedInvoiceCount" | "warningInvoiceCount">) {
    cell.value = (cell.value ?? 0) + (Number.isFinite(value) ? value : 0);
    cell.invoiceCount += meta.invoiceCount;
    cell.calculatedInvoiceCount += meta.calculatedInvoiceCount;
    cell.warningInvoiceCount += meta.warningInvoiceCount;
    cell.missingInvoiceCount = Math.max(cell.invoiceCount - cell.calculatedInvoiceCount, 0);
  }
}

function emptyOperationalCell(): OperationalBalanceCell {
  return { value: 0, invoiceCount: 0, calculatedInvoiceCount: 0, missingInvoiceCount: 0, warningInvoiceCount: 0 };
}

function emptyOperationalCells() {
  return Array.from({ length: 12 }, () => emptyOperationalCell());
}

function sumOperationalCells(cells: OperationalBalanceCell[]) {
  return cells.reduce((total, cell) => ({
    value: (total.value ?? 0) + (cell.value ?? 0),
    invoiceCount: total.invoiceCount + cell.invoiceCount,
    calculatedInvoiceCount: total.calculatedInvoiceCount + cell.calculatedInvoiceCount,
    missingInvoiceCount: total.missingInvoiceCount + cell.missingInvoiceCount,
    warningInvoiceCount: total.warningInvoiceCount + cell.warningInvoiceCount
  }), emptyOperationalCell());
}

function coverage(invoiceCount: number, calculatedInvoiceCount: number, warningInvoiceCount: number) {
  return { invoiceCount, calculatedInvoiceCount, warningInvoiceCount };
}

function zeroCoverage() {
  return coverage(0, 0, 0);
}

function invoiceMonth(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const month = date.getUTCMonth();
  return Number.isFinite(month) && month >= 0 && month <= 11 ? month : null;
}

function numericLike(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function decimalOrNullLike(value: Prisma.Decimal | number | string | null | undefined) {
  return (value === null || value === undefined ? null : value) as Prisma.Decimal | null;
}

function costComponentLabel(componentCode: string) {
  const labels: Record<string, string> = {
    OMIE_MD: "OMIE MD",
    CAD: "CAD",
    PC3: "PC3 REGANECU",
    BS3: "BS3",
    RAD3: "RAD3",
    RETH: "RETh",
    PC3_CONFIG: "PC3",
    EFIH: "EFIh",
    TOLLS_CHARGES_ENERGY: "Peajes + Cargos Energia",
    TOLLS_CHARGES_POWER: "Peajes + Cargos Potencia",
    BONO_SOCIAL: "Bono Social",
    OTROS: "Otros",
    IMU: "IMU"
  };
  return labels[componentCode] ?? componentCode;
}

export function buildOperationalBalanceReport(input: {
  year: number;
  availableYears: number[];
  invoices: Array<{
    id: string;
    invoiceDate: Date | string | null;
    billedEnergyKwh?: Prisma.Decimal | number | string | null;
    lines: Array<{ accountName: string | null; lineName: string | null; quantity?: Prisma.Decimal | number | string | null; priceUnit?: Prisma.Decimal | number | string | null; priceSubtotal: Prisma.Decimal | number | string | null }>;
  }>;
  curveTotals: Array<{ invoiceId: string; _sum: { consumptionPfKwh: Prisma.Decimal | number | string | null; consumptionBcKwh: Prisma.Decimal | number | string | null } }>;
  costRuns: Array<{ id: string; invoiceId: string; incidentsCount: number; status: CmInvoiceCostRunStatus | string }>;
  margins: Array<{
    invoiceId: string;
    costRunId: string;
    marginStatus: CmInvoiceMarginStatus | string;
    associatedRevenueEur?: Prisma.Decimal | number | string | null;
    associatedCostEur?: Prisma.Decimal | number | string | null;
    marginEur: Prisma.Decimal | number | string | null;
    detailsJson?: Prisma.JsonValue | null;
  }>;
  intervalComponentSums: Array<{ costRunId: string; componentCode: string; costEur: Prisma.Decimal | number | string | null }>;
  powerComponentSums: Array<{ costRunId: string; componentCode: string; _sum?: { costEur: Prisma.Decimal | number | string | null }; costEur?: Prisma.Decimal | number | string | null }>;
}): OperationalBalanceResponse {
  const rows = new OperationalBalanceRowsBuilder();
  rows.ensureRow("invoice-count", "Numero de facturas", "COUNT", 0);
  rows.ensureRow("billing", "Facturacion", "EUR", 0);
  rows.ensureRow("billed-pf", "Consumo facturado PF", "KWH", 0);
  rows.ensureRow("calculated-pf", "Consumo calculado PF", "KWH", 0);
  rows.ensureRow("calculated-bc", "Consumo calculado BC", "KWH", 0);
  rows.ensureRow("used-revenue", "Ingresos utilizados", "EUR", 0);
  rows.ensureRow("used-revenue:energy", "Energia", "EUR", 1, "used-revenue");
  rows.ensureRow("used-revenue:power", "Potencia", "EUR", 1, "used-revenue");
  rows.ensureRow("costs", "Costes calculados", "EUR", 0);
  rows.ensureRow("costs:energy", "Energia", "EUR", 1, "costs");
  rows.ensureRow("costs:power", "Potencia", "EUR", 1, "costs");
  rows.ensureRow("margin", "Margen EUR", "EUR", 0);
  const invoicesById = new Map(input.invoices.map((invoice) => [invoice.id, invoice]));
  const monthByInvoice = new Map<string, number>();
  const invoiceCounts = Array.from({ length: 12 }, () => 0);
  for (const invoice of input.invoices) {
    const month = invoiceMonth(invoice.invoiceDate);
    if (month === null) continue;
    monthByInvoice.set(invoice.id, month);
    invoiceCounts[month] += 1;
    rows.add("invoice-count", "Numero de facturas", "COUNT", 0, month, 1, coverage(1, 1, 0));
    const lineSummary = summarizeInvoiceLineConcepts(invoice.lines.map((line) => ({
      accountName: line.accountName,
      lineName: line.lineName,
      priceSubtotal: decimalOrNullLike(line.priceSubtotal) as Prisma.Decimal | null
    })));
    rows.add("billing", "Facturacion", "EUR", 0, month, lineSummary.rows.reduce((sum, row) => sum + row.amount, 0), coverage(1, 1, 0));
    for (const line of lineSummary.rows) {
      rows.add(`billing:${invoiceConceptKey(line.concept)}`, line.concept, "EUR", 1, month, line.amount, coverage(1, 1, 0), "billing");
    }
    const billedEnergy = Object.values(summarizeInvoiceEnergy(invoice.lines.map((line) => ({
      accountName: line.accountName,
      lineName: line.lineName,
      quantity: decimalOrNullLike(line.quantity) as Prisma.Decimal | null,
      priceUnit: decimalOrNullLike(line.priceUnit) as Prisma.Decimal | null
    })))).reduce((sum, value) => sum + value, 0);
    const billedEnergyValue = billedEnergy || numericLike(invoice.billedEnergyKwh);
    rows.add("billed-pf", "Consumo facturado PF", "KWH", 0, month, billedEnergyValue ?? 0, coverage(1, billedEnergyValue === null ? 0 : 1, 0));
  }

  const curveTotalsByInvoice = new Map(input.curveTotals.map((row) => [row.invoiceId, row]));
  for (const invoice of input.invoices) {
    const month = monthByInvoice.get(invoice.id);
    if (month === undefined) continue;
    const totals = curveTotalsByInvoice.get(invoice.id);
    const pf = numericLike(totals?._sum.consumptionPfKwh);
    const bc = numericLike(totals?._sum.consumptionBcKwh);
    rows.add("calculated-pf", "Consumo calculado PF", "KWH", 0, month, pf ?? 0, coverage(1, pf === null ? 0 : 1, 0));
    rows.add("calculated-bc", "Consumo calculado BC", "KWH", 0, month, bc ?? 0, coverage(1, bc === null ? 0 : 1, 0));
  }

  const latestMarginByInvoiceAndRun = new Map<string, (typeof input.margins)[number]>();
  for (const margin of input.margins) {
    const key = `${margin.invoiceId}|${margin.costRunId}`;
    if (!latestMarginByInvoiceAndRun.has(key)) latestMarginByInvoiceAndRun.set(key, margin);
  }
  const marginCostRunIds = new Set<string>();
  const costRunById = new Map(input.costRuns.map((run) => [run.id, run]));
  for (const run of input.costRuns) {
    const month = monthByInvoice.get(run.invoiceId);
    if (month === undefined) continue;
    const margin = latestMarginByInvoiceAndRun.get(`${run.invoiceId}|${run.id}`);
    if (!margin) continue;
    marginCostRunIds.add(run.id);
    const revenue = numericLike(margin.associatedRevenueEur);
    const associatedCost = numericLike(margin.associatedCostEur);
    const marginValue = numericLike(margin.marginEur);
    const revenueByNature = marginRevenueByNature(margin.detailsJson);
    const costsByNature = marginCostsByNature(margin.detailsJson);
    rows.add("used-revenue", "Ingresos utilizados", "EUR", 0, month, revenue ?? 0, coverage(1, revenue === null ? 0 : 1, margin.marginStatus === CmInvoiceMarginStatus.WARNING ? 1 : 0));
    if (revenueByNature.ENERGY !== null) rows.add("used-revenue:energy", "Energia", "EUR", 1, month, revenueByNature.ENERGY, coverage(1, 1, 0), "used-revenue");
    if (revenueByNature.POWER !== null) rows.add("used-revenue:power", "Potencia", "EUR", 1, month, revenueByNature.POWER, coverage(1, 1, 0), "used-revenue");
    rows.add("costs", "Costes calculados", "EUR", 0, month, associatedCost ?? 0, coverage(1, associatedCost === null ? 0 : 1, run.incidentsCount > 0 || run.status !== CmInvoiceCostRunStatus.COMPLETED ? 1 : 0));
    if (costsByNature.ENERGY !== null) rows.add("costs:energy", "Energia", "EUR", 1, month, costsByNature.ENERGY, coverage(1, 1, 0), "costs");
    if (costsByNature.POWER !== null) rows.add("costs:power", "Potencia", "EUR", 1, month, costsByNature.POWER, coverage(1, 1, 0), "costs");
    rows.add("margin", "Margen EUR", "EUR", 0, month, marginValue ?? 0, coverage(1, marginValue === null ? 0 : 1, margin.marginStatus === CmInvoiceMarginStatus.WARNING ? 1 : 0));
  }
  for (const component of input.intervalComponentSums) {
    const run = costRunById.get(component.costRunId);
    if (!marginCostRunIds.has(component.costRunId)) continue;
    if (!run) continue;
    const month = monthByInvoice.get(run.invoiceId);
    if (month === undefined) continue;
    const value = numericLike(component.costEur) ?? 0;
    const nature = costComponentNature(component.componentCode as CostComponent);
    const natureKey = nature === "POWER" ? "power" : "energy";
    rows.add(`costs:${natureKey}:${component.componentCode}`, costComponentLabel(component.componentCode), "EUR", 2, month, value, zeroCoverage(), `costs:${natureKey}`);
  }
  for (const component of input.powerComponentSums) {
    const run = costRunById.get(component.costRunId);
    if (!marginCostRunIds.has(component.costRunId)) continue;
    if (!run) continue;
    const month = monthByInvoice.get(run.invoiceId);
    if (month === undefined) continue;
    const value = numericLike(component._sum?.costEur ?? component.costEur) ?? 0;
    const nature = costComponentNature(component.componentCode as CostComponent);
    const natureKey = nature === "POWER" ? "power" : "energy";
    rows.add(`costs:${natureKey}:${component.componentCode}`, costComponentLabel(component.componentCode), "EUR", 2, month, value, zeroCoverage(), `costs:${natureKey}`);
  }

  rows.applyInvoiceUniverse(invoiceCounts, ["billing", "billed-pf", "calculated-pf", "calculated-bc", "used-revenue", "costs", "margin"]);
  const baseRows = rows.toRows([
    "invoice-count",
    "billing",
    "billed-pf",
    "calculated-pf",
    "calculated-bc",
    "used-revenue",
    "costs",
    "margin"
  ]);
  const calculatedPf = baseRows.find((row) => row.key === "calculated-pf");
  const outputRows = insertOperationalRateRows(baseRows, calculatedPf);
  return {
    year: input.year,
    availableYears: input.availableYears.length ? input.availableYears : [input.year],
    months: OPERATIONAL_BALANCE_MONTHS,
    rows: outputRows
  };
}

function insertOperationalRateRows(rows: OperationalBalanceRow[], pfRow: OperationalBalanceRow | undefined) {
  const output: OperationalBalanceRow[] = [];
  for (const row of rows) {
    output.push(row);
    if (row.key === "used-revenue") output.push(toEurMwhRow(row, "used-revenue-eur-mwh", "Ingresos utilizados €/MWh", pfRow));
    if (row.key === "costs") output.push(toEurMwhRow(row, "costs-eur-mwh", "Costes calculados €/MWh", pfRow));
    if (row.key === "margin") output.push(toEurMwhRow(row, "margin-eur-mwh", "Margen €/MWh", pfRow));
  }
  return output;
}

function toEurMwhRow(row: OperationalBalanceRow, key: string, label: string, pfRow: OperationalBalanceRow | undefined): OperationalBalanceRow {
  const months = row.months.map((cell, index) => toEurMwhCell(cell, pfRow?.months[index]));
  return {
    key,
    label,
    unit: "EUR_MWH",
    level: row.level,
    months,
    total: toEurMwhCell(row.total, pfRow?.total),
    children: row.children?.map((child) => toEurMwhRow(child, `${key}:${lastOperationalKeyPart(child.key)}`, child.label, pfRow))
  };
}

function toEurMwhCell(eurCell: OperationalBalanceCell, pfCell: OperationalBalanceCell | undefined): OperationalBalanceCell {
  const pfKwh = pfCell?.value ?? null;
  const eur = eurCell.value ?? null;
  const value = pfKwh && pfKwh > 0 && eur !== null ? eur / (pfKwh / 1000) : null;
  const calculatedInvoiceCount = Math.min(eurCell.calculatedInvoiceCount, pfCell?.calculatedInvoiceCount ?? 0);
  return {
    value,
    invoiceCount: eurCell.invoiceCount,
    calculatedInvoiceCount,
    missingInvoiceCount: Math.max(eurCell.invoiceCount - calculatedInvoiceCount, 0),
    warningInvoiceCount: eurCell.warningInvoiceCount + (pfCell?.warningInvoiceCount ?? 0)
  };
}

function lastOperationalKeyPart(key: string) {
  const parts = key.split(":");
  return parts[parts.length - 1] ?? key;
}

function marginRevenueByNature(detailsJson: Prisma.JsonValue | null | undefined): { ENERGY: number | null; POWER: number | null } {
  const result: { ENERGY: number | null; POWER: number | null } = { ENERGY: null, POWER: null };
  if (!detailsJson || typeof detailsJson !== "object" || Array.isArray(detailsJson)) return result;
  const rows = (detailsJson as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return result;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const nature = (row as { nature?: unknown }).nature;
    if (nature !== "ENERGY" && nature !== "POWER") continue;
    const amount = numericLike((row as { amount?: Prisma.Decimal | number | string | null }).amount);
    if (amount === null) continue;
    result[nature] = (result[nature] ?? 0) + amount;
  }
  return result;
}

function marginCostsByNature(detailsJson: Prisma.JsonValue | null | undefined): { ENERGY: number | null; POWER: number | null } {
  const result: { ENERGY: number | null; POWER: number | null } = { ENERGY: null, POWER: null };
  if (!detailsJson || typeof detailsJson !== "object" || Array.isArray(detailsJson)) return result;
  const costsByNature = (detailsJson as { costsByNature?: unknown }).costsByNature;
  if (!costsByNature || typeof costsByNature !== "object" || Array.isArray(costsByNature)) return result;
  for (const nature of ["ENERGY", "POWER"] as const) {
    const value = numericLike((costsByNature as Record<string, Prisma.Decimal | number | string | null | undefined>)[nature]);
    if (value !== null) result[nature] = value;
  }
  return result;
}

function marginConceptMapping(concept: string): CostNature | "ADJUSTMENT" | null {
  const key = invoiceConceptKey(concept);
  if (key === "ENERGIA") return "ENERGY";
  if (key === "POTENCIA") return "POWER";
  if (key === invoiceConceptKey(NETWORK_SYSTEM_ADJUSTMENT_CONCEPT)) return "ADJUSTMENT";
  return null;
}

function invoiceConceptKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}

function curveSummaryText(invoice: { expectedIntervals: number; f1Intervals: number; p1Intervals: number; f5dIntervals: number; p5dIntervals: number; profiledIntervals: number }) {
  const rows = [
    ["F1", invoice.f1Intervals],
    ["TgP1", invoice.p1Intervals],
    ["F5D", invoice.f5dIntervals],
    ["P5D", invoice.p5dIntervals],
    ["Perfil", invoice.profiledIntervals]
  ] as const;
  const parts = rows.filter(([, count]) => count > 0).map(([label, count]) => `${label} ${pct(count, invoice.expectedIntervals).toLocaleString("es-ES", { maximumFractionDigits: 2 })}%`);
  return parts.length ? parts.join(" · ") : "-";
}

function deriveGlobalStatus(
  curveStatus: CmInvoiceProcessingStatus,
  costRun: { status: CmInvoiceCostRunStatus; incidentsCount: number } | null,
  margin: { marginStatus: CmInvoiceMarginStatus } | null
) {
  if (curveStatus !== CmInvoiceProcessingStatus.READY && curveStatus !== CmInvoiceProcessingStatus.WARNING) return "CURVE_PENDING";
  if (!costRun) return "READY_FOR_COSTS";
  if (costRun.status === CmInvoiceCostRunStatus.ERROR || costRun.incidentsCount > 0 || costRun.status === CmInvoiceCostRunStatus.WARNING) return "COSTS_WARNING";
  if (!margin) return "READY_FOR_MARGIN";
  if (margin.marginStatus === CmInvoiceMarginStatus.WARNING) return "MARGIN_WARNING";
  if (margin.marginStatus === CmInvoiceMarginStatus.READY) return "MARGIN_OK";
  return "READY_FOR_MARGIN";
}

function isEconomicInvoiceQuery(query: Record<string, unknown>, sort: string) {
  return ["pf", "costs", "margin", "marginEurMwh", "globalStatus"].includes(sort)
    || text(query.marginStatus) !== null
    || numeric(query.marginEurMin) !== null
    || numeric(query.marginEurMax) !== null
    || numeric(query.marginEurMwhMin) !== null
    || numeric(query.marginEurMwhMax) !== null
    || text(query.hasAnyIssues) !== null;
}

function filterEconomicInvoiceRows<T extends { marginStatus: string | null; marginEur: number | null; marginEurMwh: number | null; totalIssueCount: number }>(rows: T[], query: Record<string, unknown>) {
  const marginStatus = text(query.marginStatus);
  const minMargin = numeric(query.marginEurMin);
  const maxMargin = numeric(query.marginEurMax);
  const minMarginMwh = numeric(query.marginEurMwhMin);
  const maxMarginMwh = numeric(query.marginEurMwhMax);
  const hasAnyIssues = text(query.hasAnyIssues);
  return rows.filter((row) => {
    if (marginStatus && row.marginStatus !== marginStatus) return false;
    if (minMargin !== null && (row.marginEur === null || row.marginEur < minMargin)) return false;
    if (maxMargin !== null && (row.marginEur === null || row.marginEur > maxMargin)) return false;
    if (minMarginMwh !== null && (row.marginEurMwh === null || row.marginEurMwh < minMarginMwh)) return false;
    if (maxMarginMwh !== null && (row.marginEurMwh === null || row.marginEurMwh > maxMarginMwh)) return false;
    if (hasAnyIssues === "true" && row.totalIssueCount <= 0) return false;
    if (hasAnyIssues === "false" && row.totalIssueCount > 0) return false;
    return true;
  });
}

function sortEconomicInvoiceRows<T extends Record<string, unknown>>(rows: T[], sort: string, direction: "asc" | "desc") {
  const field = sort === "pf" ? "pfTotalKwh" : sort === "costs" ? "totalCostEur" : sort === "margin" ? "marginEur" : sort === "marginEurMwh" ? "marginEurMwh" : sort === "globalStatus" ? "globalStatus" : null;
  if (!field) return;
  const sign = direction === "asc" ? 1 : -1;
  rows.sort((left, right) => {
    const a = left[field];
    const b = right[field];
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;
    if (typeof a === "number" && typeof b === "number") return (a - b) * sign;
    return String(a).localeCompare(String(b)) * sign;
  });
}

function summarizeGisceInvoiceEnergy(lines: GisceInvoiceLineItem[]) {
  return round(Object.values(summarizeInvoiceEnergy(lines.map((line) => ({
    accountName: many2oneName(line.account_id),
    lineName: text(line.name),
    quantity: decimalOrNull(numeric(line.quantity)),
    priceUnit: decimalOrNull(numeric(line.price_unit))
  })))).reduce((sum, value) => sum + value, 0), 6);
}

export function normalizeGiscePriceList(value: GisceInvoiceItem["llista_preu"]) {
  if (!value || typeof value !== "object") return { priceListId: null as number | null, priceListName: null as string | null, compatibleInvoicingModes: [] as Array<{ externalId: number; name: string }> };
  const modes = Array.isArray(value.compatible_invoicing_modes) ? value.compatible_invoicing_modes : [];
  const seen = new Set<number>();
  return {
    priceListId: integer(value.id),
    priceListName: text(value.name),
    compatibleInvoicingModes: modes.map((mode) => {
      const externalId = integer(mode?.id);
      const name = text(mode?.name);
      return externalId !== null && name ? { externalId, name } : null;
    }).filter((mode): mode is { externalId: number; name: string } => {
      if (!mode || seen.has(mode.externalId)) return false;
      seen.add(mode.externalId);
      return true;
    })
  };
}

function onlyCommercialMetadataChanged(next: Record<string, unknown>, previous: Record<string, unknown>) {
  const ignored = new Set(["priceListId", "priceListName"]);
  const keys = new Set([...Object.keys(next), ...Object.keys(previous)]);
  for (const key of keys) {
    if (ignored.has(key)) continue;
    if (JSON.stringify(next[key]) !== JSON.stringify(previous[key])) return false;
  }
  return true;
}

function dateRange(field: "invoiceDate", from: unknown, to: unknown): Prisma.CmInvoiceWhereInput {
  const gte = typeof from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(from) ? parseDateOnly(from) : undefined;
  const lte = typeof to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(to) ? parseDateOnly(to) : undefined;
  return gte || lte ? { [field]: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } } : {};
}

function invoiceOrderBy(sort: string, direction: "asc" | "desc"): Prisma.CmInvoiceOrderByWithRelationInput[] {
  const field =
    sort === "invoiceNumber" ? "invoiceNumber" :
    sort === "cups" ? "cups" :
    sort === "energy" ? "billedEnergyKwh" :
    sort === "status" ? "processingStatus" :
    "invoiceDate";
  return [{ [field]: direction }, { createdAt: "desc" }];
}

export function normalizeMeasuresToQuarterHour<T extends GisceF1Item | GisceF5dItem | GisceP1Item | GisceP5dItem>(
  items: T[],
  rawIds: Map<number, string>,
  sourceName: "F1" | "F5D" | "P1" | "P5D",
  duplicateCode: CurveIssueCode,
  invoiceId: string,
  issues: CurveIssue[],
  fixedResolutionMinutes?: 60,
  timestampMode: "INSTANT_START" | "MADRID_INTERVAL_END" | "MADRID_HOUR_END" = "INSTANT_START",
  valueDivisor = 1
) {
  const resolution = fixedResolutionMinutes ?? inferSourceResolutionMinutes(items);
  const map = new Map<string, NormalizedMeasureCandidate>();
  if (items.length > 0 && resolution === null) {
    issues.push(periodIssue(invoiceId, null, "SOURCE_RESOLUTION_NOT_RESOLVED", { source: sourceName, validTimestamps: validMeasureInstants(items).length }));
    return map;
  }
  if (resolution === null) return map;
  for (const item of items) {
    const instant =
      timestampMode === "MADRID_HOUR_END" || timestampMode === "MADRID_INTERVAL_END"
        ? parseMadridIntervalEndAsUtcStart(item.datetime, timestampMode === "MADRID_HOUR_END" ? 60 : resolution)
        : parseGisceDate(item.datetime);
    const sourceId = gisceSourceId(item);
      const consumption = numeric(item.ai);
    if (!instant || sourceId === null || consumption === null || resolution === null) continue;
    const segments = resolution / NORMALIZED_RESOLUTION_MINUTES;
    for (let index = 0; index < segments; index += 1) {
      const normalizedInstant = new Date(instant.getTime() + index * NORMALIZED_RESOLUTION_MINUTES * 60_000);
      const key = normalizedInstant.toISOString();
      if (map.has(key)) {
        issues.push({ invoice_id: invoiceId, datetime: key, period: null, code: duplicateCode, detail: { keptSourceId: map.get(key)?.sourceId, duplicateSourceId: sourceId, sourceResolutionMinutes: resolution } });
        continue;
      }
      map.set(key, {
        raw: item,
        sourceId,
        sourceRawId: rawIds.get(sourceId) ?? null,
        sourceResolutionMinutes: resolution,
        consumption: round((consumption / valueDivisor) / segments, 9)
      });
    }
  }
  return map;
}

export function inferSourceResolutionMinutes<T extends GisceF1Item | GisceF5dItem | GisceP1Item | GisceP5dItem>(items: T[]) {
  const instants = validMeasureInstants(items);
  if (instants.length === 0) return null;
  if (instants.some((instant) => ![0, 15, 30, 45].includes(instant.getUTCMinutes()))) return null;
  if (instants.some((instant) => instant.getUTCMinutes() !== 0)) return 15;
  const diffs = [];
  for (let index = 1; index < instants.length; index += 1) {
    const minutes = (instants[index].getTime() - instants[index - 1].getTime()) / 60_000;
    if (minutes > 0) diffs.push(minutes);
  }
  if (diffs.some((minutes) => minutes % 15 === 0 && minutes % 60 !== 0)) return 15;
  if (diffs.length > 0 && diffs.every((minutes) => minutes % 60 === 0)) return 60;
  return null;
}

function validMeasureInstants<T extends GisceF1Item | GisceF5dItem | GisceP1Item | GisceP5dItem>(items: T[]) {
  const seen = new Set<number>();
  const instants = [];
  for (const item of items) {
    const instant = parseGisceDate(item.datetime);
    if (!instant) continue;
    const millis = instant.getTime();
    if (seen.has(millis)) continue;
    seen.add(millis);
    instants.push(instant);
  }
  return instants.sort((left, right) => left.getTime() - right.getTime());
}

export function selectMeasureCandidate(
  f1Item: NormalizedMeasureCandidate | undefined,
  p1Item: NormalizedMeasureCandidate | undefined,
  f5dItem: NormalizedMeasureCandidate | undefined,
  p5dItem: NormalizedMeasureCandidate | undefined
) {
  if (f1Item) return { selected: f1Item, source: CmInvoiceConsumptionSource.F1 };
  if (p1Item) return { selected: p1Item, source: CmInvoiceConsumptionSource.P1 };
  if (f5dItem) return { selected: f5dItem, source: CmInvoiceConsumptionSource.F5D };
  if (p5dItem) return { selected: p5dItem, source: CmInvoiceConsumptionSource.P5D };
  return { selected: undefined, source: CmInvoiceConsumptionSource.MISSING };
}

function addHourlyProfileAsQuarterHours(map: Map<string, ProfileValue>, datetime: Date, profile: ProfileValue) {
  const quarterValue = profile.value / 4;
  for (let index = 0; index < 4; index += 1) {
    const key = new Date(datetime.getTime() + index * NORMALIZED_RESOLUTION_MINUTES * 60_000).toISOString();
    if (map.has(key)) {
      continue;
    }
    map.set(key, { ...profile, value: quarterValue });
  }
}

function f1RawData(invoiceId: string, gisceSourceId: number, datetime: Date, item: GisceF1Item) {
  return {
    invoiceId,
    gisceSourceId,
    cups: item.name ?? "",
    datetime,
    ai: decimalOrNull(numeric(item.ai)),
    ao: decimalOrNull(numeric(item.ao)),
    r1: decimalOrNull(numeric(item.r1)),
    r2: decimalOrNull(numeric(item.r2)),
    r3: decimalOrNull(numeric(item.r3)),
    r4: decimalOrNull(numeric(item.r4)),
    measureType: integer(item.measure_type),
    source: integer(item.source),
    validated: typeof item.validated === "boolean" ? item.validated : null,
    gisceCreateAt: parseGisceDate(item.create_at),
    gisceUpdateAt: parseGisceDate(item.update_at),
    rawData: item as Prisma.InputJsonValue
  };
}

function f5dRawData(invoiceId: string, gisceSourceId: number, datetime: Date, item: GisceF5dItem) {
  return {
    invoiceId,
    gisceSourceId,
    cups: item.name ?? "",
    datetime,
    ai: decimalOrNull(numeric(item.ai)),
    ao: decimalOrNull(numeric(item.ao)),
    aiFix: typeof item.ai_fix === "boolean" ? item.ai_fix : null,
    aoFix: typeof item.ao_fix === "boolean" ? item.ao_fix : null,
    bill: text(item.bill),
    r1: decimalOrNull(numeric(item.r1)),
    r2: decimalOrNull(numeric(item.r2)),
    r3: decimalOrNull(numeric(item.r3)),
    r4: decimalOrNull(numeric(item.r4)),
    source: integer(item.source),
    validated: typeof item.validated === "boolean" ? item.validated : null,
    gisceCreateAt: parseGisceDate(item.create_at),
    gisceUpdateAt: parseGisceDate(item.update_at),
    rawData: item as Prisma.InputJsonValue
  };
}

function p1RawData(invoiceId: string, gisceSourceId: number, datetime: Date, item: GisceP1Item) {
  return {
    invoiceId,
    gisceSourceId,
    cups: item.name ?? "",
    datetime,
    ai: decimalOrNull(numeric(item.ai)),
    ao: decimalOrNull(numeric(item.ao)),
    aiQuality: text(item.aiquality),
    aoQuality: text(item.aoquality),
    r1: decimalOrNull(numeric(item.r1)),
    r1Quality: text(item.r1quality),
    r2: decimalOrNull(numeric(item.r2)),
    r2Quality: text(item.r2quality),
    r3: decimalOrNull(numeric(item.r3)),
    r3Quality: text(item.r3quality),
    r4: decimalOrNull(numeric(item.r4)),
    r4Quality: text(item.r4quality),
    measureType: integer(item.measure_type),
    source: integer(item.source),
    type: text(item.type),
    season: integer(item.season),
    validated: typeof item.validated === "boolean" ? item.validated : null,
    gisceCreateAt: parseGisceDate(item.create_at),
    gisceUpdateAt: parseGisceDate(item.update_at),
    rawData: item as Prisma.InputJsonValue
  };
}

function p5dRawData(invoiceId: string, gisceSourceId: number, datetime: Date, item: GisceP5dItem) {
  return {
    invoiceId,
    gisceSourceId,
    cups: item.name ?? "",
    datetime,
    ai: decimalOrNull(numeric(item.ai)),
    ao: decimalOrNull(numeric(item.ao)),
    r1: decimalOrNull(numeric(item.r1)),
    r2: decimalOrNull(numeric(item.r2)),
    r3: decimalOrNull(numeric(item.r3)),
    r4: decimalOrNull(numeric(item.r4)),
    measureType: integer(item.measure_type),
    source: integer(item.source),
    type: text(item.type),
    season: integer(item.season),
    validated: typeof item.validated === "boolean" ? item.validated : null,
    gisceCreateAt: parseGisceDate(item.create_at),
    gisceUpdateAt: parseGisceDate(item.update_at),
    rawData: item as Prisma.InputJsonValue
  };
}

function profileSource(type?: CmInvoiceProfileType) {
  if (type === CmInvoiceProfileType.FINAL) return CmInvoiceConsumptionSource.PROFILE_FINAL;
  if (type === CmInvoiceProfileType.INTERMEDIO) return CmInvoiceConsumptionSource.PROFILE_INTERMEDIATE;
  if (type === CmInvoiceProfileType.INICIAL) return CmInvoiceConsumptionSource.PROFILE_INITIAL;
  return CmInvoiceConsumptionSource.MISSING;
}

function resolvePeriodTariff(tariff: string) {
  if (tariff === "2.0TD" || tariff === "3.0TD") return tariff;
  return "6.1TD";
}

function intervalIssue(invoiceId: string, interval: Pick<CurveInterval, "instant" | "tariffPeriod">, code: CurveIssueCode, detail: Record<string, unknown>): CurveIssue {
  return { invoice_id: invoiceId, datetime: interval.instant.toISOString(), period: interval.tariffPeriod || null, code, detail };
}

function periodIssue(invoiceId: string, period: string | null, code: CurveIssueCode, detail: Record<string, unknown>): CurveIssue {
  return { invoice_id: invoiceId, datetime: null, period, code, detail };
}

function gisceDateKey(value?: string) {
  return parseGisceDate(value)?.toISOString() ?? "";
}

function gisceSourceId(item?: GisceF1Item | GisceF5dItem | GisceP1Item | GisceP5dItem | null) {
  return integer(item?.id);
}

function rawIdFor(map: Map<number, string>, item?: GisceF1Item | GisceF5dItem | GisceP1Item | GisceP5dItem | null) {
  const id = gisceSourceId(item);
  return id === null ? null : map.get(id) ?? null;
}

function parseMadridIntervalEndAsUtcStart(value: string | null | undefined, resolutionMinutes: number) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/.exec(value.trim());
  if (!match) return null;
  let date = `${match[1]}-${match[2]}-${match[3]}`;
  let hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? 0);
  if (hour === 24) {
    date = addIsoDays(date, 1);
    hour = 0;
  }
  const endInstant = madridLocalDateTimeToUtc(date, hour, minute, second);
  return endInstant ? new Date(endInstant.getTime() - resolutionMinutes * 60_000) : null;
}

function madridLocalDateTimeToUtc(date: string, hour: number, minute: number, second: number) {
  const [year, month, day] = date.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const candidates: Date[] = [];
  for (let offsetHours = -4; offsetHours <= 4; offsetHours += 1) {
    const candidate = new Date(guess + offsetHours * 60 * 60_000);
    const local = getMadridParts(candidate);
    if (local.date === date && local.hour === hour && candidate.getUTCMinutes() === minute && candidate.getUTCSeconds() === second) {
      candidates.push(candidate);
    }
  }
  return candidates.sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
}

function parseGisceDate(value?: string | null) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/.exec(value.trim());
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0)));
}

function parseNullableDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? parseDateOnly(value.slice(0, 10)) : null;
}

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateOnly(value?: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function addIsoDays(value: string, days: number) {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date)!;
}

function assertDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${field} debe tener formato YYYY-MM-DD.`);
}

function parseInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function billingMarginJobConcurrency() {
  return parseInteger(process.env.BILLING_MARGIN_JOB_CONCURRENCY, BILLING_MARGIN_JOB_DEFAULT_CONCURRENCY, 1, 6);
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function numeric(value: unknown) {
  if (value === false || value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function decimalOrNull(value: number | null) {
  return value === null ? null : new Prisma.Decimal(value);
}

function decimalToNumber(value: Prisma.Decimal | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return value === null || value === undefined ? null : Number(value);
}

function many2oneId(value: unknown) {
  return value && typeof value === "object" && "id" in value ? integer((value as { id?: unknown }).id) : null;
}

function many2oneName(value: unknown) {
  return value && typeof value === "object" && "name" in value ? text((value as { name?: unknown }).name) : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeText(value?: string | null) {
  return value?.trim().toLocaleLowerCase("es-ES").normalize("NFD").replace(/[\u0300-\u036f]/g, "") ?? "";
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
