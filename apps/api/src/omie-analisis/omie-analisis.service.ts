import { Injectable } from "@nestjs/common";
import { OmieDownloadEstado, OmieTipoDocumento, OmieTipoPrecio, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const DEFAULT_VERSION = 1;
const STROM_UOFERTANTE = "STROC01";
const STROM_AGENT = "STROM";
const OMIE_TRANSACCIONES_CODIGO = "4121";
const PERIODS_PER_DAY = 96;
const QUARTER_HOUR_MWH_FACTOR = 0.25;
const OMIE_IVA_RATE = 0.21;

export type OmieAnalisisMensualPeriodo = {
  fecha: string;
  periodo: number;
  clave: string;
  precioMd: number | null;
  precioIda1: number | null;
  precioIda2: number | null;
  precioIda3: number | null;
  precioXbid: number | null;
  programaMd: number | null;
  programaIda1: number | null;
  programaIda2: number | null;
  programaIda3: number | null;
  volIda1: number | null;
  volIda2: number | null;
  volIda3: number | null;
  volXbid: number | null;
  profitIda1: number | null;
  profitIda2: number | null;
  profitIda3: number | null;
  profitXbidEurMWh: number | null;
  profitXbid: number | null;
  sumaProfit: number | null;
  pciMdIda1: number | null;
  pciIda1Ida2: number | null;
  pciIda2Ida3: number | null;
  pciIda3Xbid: number | null;
  profitMdIda1: number | null;
  profitIda1Ida2: number | null;
  profitIda2Ida3: number | null;
  profitIda3XbidEurMWh: number | null;
  profitIda3Xbid: number | null;
  profitTotal: number | null;
};

export type OmieAnalisisMensualResponse = {
  mes: string;
  year: number;
  month: number;
  fechaDesde: string;
  fechaHasta: string;
  resolucion: "PT15M";
  totalFilas: number;
  kpis: {
    sumaProfit: number | null;
    volumenTotal: number | null;
    profitTotal: number | null;
    pciTotal: number | null;
    energiaTotal: number | null;
    profitMedioEurMWh: number | null;
  };
  periodos: OmieAnalisisMensualPeriodo[];
};

export type OmieComprobacionLiquidacionMercado = "MD" | "IDA1" | "IDA2" | "IDA3" | "XBID" | "TOTAL";

export type OmieComprobacionLiquidacionResumen = {
  mercado: OmieComprobacionLiquidacionMercado;
  energiaMWh: number | null;
  importeEur: number | null;
};

export type OmieComprobacionLiquidacionHoraria = {
  fecha: string;
  fechaIso: string;
  hora: number;
  mdMWh: number | null;
  pmd: number | null;
  costeMd: number | null;
  ida1MWh: number | null;
  pida1: number | null;
  costeIda1: number | null;
  ida2MWh: number | null;
  pida2: number | null;
  costeIda2: number | null;
  ida3MWh: number | null;
  pida3: number | null;
  costeIda3: number | null;
  xbidMWh: number | null;
  pxbid: number | null;
  costeXbid: number | null;
};

export type OmieReerEstado = "SIN_DATOS_REER" | "CONCILIADO_OFICIAL" | "DIFERENCIA_OFICIAL";

export type OmieComprobacionReerPeriodo = {
  periodo: number;
  periodoEtiqueta: string;
  energiaNetaAgente: number | null;
  energiaReerCalculada: number | null;
  energiaReerOficial: number | null;
  precioXml: number | null;
  importeOficial: number | null;
  estado: OmieReerEstado;
};

export type OmieComprobacionReerDiario = {
  estadoReer: OmieReerEstado;
  reerOficial: number | null;
  reerAplicado: number | null;
  energiaReerCalculada: number | null;
  energiaReerOficial: number | null;
  diferenciaEnergia: number | null;
  diferenciaImporte: number | null;
  toleranciaPeriodoEur: number;
  toleranciaDiaEur: number;
  fuenteOficial: string | null;
  origenResultado: "Liquidacion oficial SIOM2 (9230)" | "Sin datos REER";
  versionUtilizada: number | null;
  fechaPublicacion: string | null;
  fechaDescarga: string | null;
  tooltip: string;
  limitacionExclusiones: string;
  periodos: OmieComprobacionReerPeriodo[];
};

export type OmieLiquidacionConceptoAdicional = {
  codigo: string;
  descripcion: string;
  importePrevisto: number | null;
  importeOficial: number | null;
  importeAplicado: number | null;
  estado: OmieReerEstado;
  fuenteOficial: string | null;
};

export type OmieComprobacionLiquidacionDiaria = {
  fecha: string;
  fechaIso: string;
  dia: string;
  energiaMd: number | null;
  costeMd: number | null;
  energiaIda1: number | null;
  costeIda1: number | null;
  energiaIda2: number | null;
  costeIda2: number | null;
  energiaIda3: number | null;
  costeIda3: number | null;
  energiaXbid: number | null;
  costeXbid: number | null;
  costeTotalOmie: number | null;
  compraMercados: number | null;
  ventaMercados: number | null;
  conceptosCompra: number | null;
  conceptosVenta: number | null;
  detalleConceptosCompra: OmieLiquidacionConceptoAdicional[];
  detalleConceptosVenta: OmieLiquidacionConceptoAdicional[];
  compraBaseImponible: number | null;
  ventaBaseImponible: number | null;
  ivaCompra: number | null;
  ivaVenta: number | null;
  compraFactura: number | null;
  ventaFactura: number | null;
  netoFactura: number | null;
  netoBaseImponible: number | null;
  netoAnalitico: number | null;
  reer: OmieComprobacionReerDiario;
  compraTotalConciliada: number | null;
  facturaCompra: number | null;
  facturaVenta: number | null;
  horas: OmieComprobacionLiquidacionHoraria[];
};

export type OmieComprobacionCuadreEstado = "ok" | "warning" | "danger" | "pending";

export type OmieComprobacionCuadre = {
  calculado: number | null;
  liquidado: number | null;
  diferencia: number | null;
  estado: OmieComprobacionCuadreEstado;
};

export type OmieComprobacionLiquidacionesResponse = {
  mes: string;
  year: number;
  month: number;
  fechaDesde: string;
  fechaHasta: string;
  resolucion: "PT15M";
  resumenMensual: OmieComprobacionLiquidacionResumen[];
  detalleDiario: OmieComprobacionLiquidacionDiaria[];
  totalesReer: {
    reerOficial: number | null;
  };
  modosResultado: {
    liquidacionConciliadaDisponible: boolean;
  };
  cuadroEconomico: OmieComprobacionCuadre;
  cuadroEnergetico: OmieComprobacionCuadre;
};

export type OmieLiquidationInvoiceResponse = {
  fecha: string;
  fechaIso: string;
  facturaCompra: number | null;
  facturaVenta: number | null;
  updatedAt: string;
};

@Injectable()
export class OmieAnalisisService {
  constructor(private readonly prisma: PrismaService) {}

  async obtenerAnalisisMensual(year: number, month: number): Promise<OmieAnalisisMensualResponse> {
    const range = buildMonthRange(year, month);
    const [priceRows, programRows, transactionRows] = await Promise.all([
      this.prisma.omiePrice.findMany({
        where: {
          OR: [
            { tipoPrecio: OmieTipoPrecio.MD, sesion: null },
            { tipoPrecio: OmieTipoPrecio.MI, sesion: { in: ["01", "02", "03"] } }
          ],
          fechaPrograma: {
            gte: range.start,
            lt: range.end
          }
        },
        select: {
          tipoPrecio: true,
          fechaPrograma: true,
          sesion: true,
          periodo: true,
          precioEurMWh: true
        }
      }),
      this.prisma.omiePrograma.findMany({
        where: {
          fechaPrograma: {
            gte: range.start,
            lt: range.end
          },
          version: DEFAULT_VERSION,
          uOfertante: STROM_UOFERTANTE,
          OR: [
            { tipoPrograma: OmieTipoDocumento.PVD, sesion: null },
            { tipoPrograma: OmieTipoDocumento.PHF, sesion: { in: ["01", "02", "03"] } }
          ]
        },
        select: {
          tipoPrograma: true,
          fechaPrograma: true,
          sesion: true,
          periodo: true,
          energiaMWh: true
        }
      }),
      this.prisma.omieTransactionStaging.findMany({
        where: {
          diaContrato: {
            gte: range.start,
            lt: range.end
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
      })
    ]);

    const prices = buildPriceMap(priceRows);
    const programs = buildProgramMap(programRows);
    const xbidTransactions = buildXbidTransactionMap(transactionRows);
    const periodos: OmieAnalisisMensualPeriodo[] = [];

    for (const date of enumerateDates(range.start, range.end)) {
      const fecha = formatDateOnly(date);
      for (let periodo = 1; periodo <= PERIODS_PER_DAY; periodo += 1) {
        const precioMd = prices.get(buildValueKey(fecha, periodo, "MD")) ?? null;
        const precioIda1 = prices.get(buildValueKey(fecha, periodo, "IDA1")) ?? null;
        const precioIda2 = prices.get(buildValueKey(fecha, periodo, "IDA2")) ?? null;
        const precioIda3 = prices.get(buildValueKey(fecha, periodo, "IDA3")) ?? null;
        const xbid = xbidTransactions.get(buildValueKey(fecha, periodo, "XBID"));
        const precioXbid = xbid?.precioXbid ?? null;
        const programaMd = programs.get(buildValueKey(fecha, periodo, "MD")) ?? null;
        const programaIda1 = programs.get(buildValueKey(fecha, periodo, "IDA1")) ?? null;
        const programaIda2 = programs.get(buildValueKey(fecha, periodo, "IDA2")) ?? null;
        const programaIda3 = programs.get(buildValueKey(fecha, periodo, "IDA3")) ?? null;
        const volIda1 = diff(programaIda1, programaMd);
        const volIda2 = diff(programaIda2, programaIda1);
        const volIda3 = diff(programaIda3, programaIda2);
        const volXbid = xbid?.volXbid ?? null;
        const profitIda1 = profit(volIda1, precioIda1, precioMd);
        const profitIda2 = profit(volIda2, precioIda2, precioMd);
        const profitIda3 = profit(volIda3, precioIda3, precioMd);
        const profitXbidEurMWh = profitSpreadAgainstMd(precioXbid, precioMd);
        const profitXbid = profitFromSpread(volXbid, profitXbidEurMWh);
        const sumaProfit = nullableEuroSum([profitIda1, profitIda2, profitIda3, profitXbid]);

        periodos.push({
          fecha: formatSpanishDate(date),
          periodo,
          clave: buildClave(fecha, periodo),
          precioMd,
          precioIda1,
          precioIda2,
          precioIda3,
          precioXbid,
          programaMd,
          programaIda1,
          programaIda2,
          programaIda3,
          volIda1,
          volIda2,
          volIda3,
          volXbid,
          profitIda1,
          profitIda2,
          profitIda3,
          profitXbidEurMWh,
          profitXbid,
          sumaProfit,
          pciMdIda1: volIda1,
          pciIda1Ida2: volIda2,
          pciIda2Ida3: volIda3,
          pciIda3Xbid: volXbid,
          profitMdIda1: profitIda1,
          profitIda1Ida2: profitIda2,
          profitIda2Ida3: profitIda3,
          profitIda3XbidEurMWh: profitXbidEurMWh,
          profitIda3Xbid: profitXbid,
          profitTotal: sumaProfit
        });
      }
    }

    const sumaProfit = nullableEuroSum(periodos.map((row) => row.sumaProfit));
    const volumenTotal = nullableEnergySum(periodos.flatMap((row) => [row.volIda1, row.volIda2, row.volIda3, row.volXbid]));
    const programaMdTotal = nullableEnergySum(periodos.map((row) => row.programaMd));
    const energiaTotal = nullableEnergySum([programaMdTotal, volumenTotal]);

    return {
      mes: `${year}-${String(month).padStart(2, "0")}`,
      year,
      month,
      fechaDesde: formatDateOnly(range.start),
      fechaHasta: formatDateOnly(range.lastDay),
      resolucion: "PT15M",
      totalFilas: periodos.length,
      kpis: {
        sumaProfit,
        volumenTotal,
        profitTotal: sumaProfit,
        pciTotal: volumenTotal,
        energiaTotal,
        profitMedioEurMWh: sumaProfit === null || energiaTotal === null || energiaTotal === 0 ? null : roundPrice(sumaProfit / energiaTotal)
      },
      periodos
    };
  }

  async obtenerComprobacionLiquidaciones(year: number, month: number): Promise<OmieComprobacionLiquidacionesResponse> {
    const range = buildMonthRange(year, month);
  const [analisis, invoices, officialRows] = await Promise.all([
      this.obtenerAnalisisMensual(year, month),
      this.prisma.omieLiquidationInvoice.findMany({
        where: {
          fecha: {
            gte: range.start,
            lt: range.end
          }
        }
      }),
      this.prisma.omieReerOfficialAnnotation.findMany({
        where: {
          fecha: { gte: range.start, lt: range.end },
          periodo: { gt: 0 },
          codigoDocumento: "9230",
          estado: OmieDownloadEstado.PROCESADO
        },
        orderBy: [{ fecha: "asc" }, { version: "desc" }, { periodo: "asc" }]
      })
    ]);
    return buildComprobacionLiquidaciones(analisis, buildInvoiceMap(invoices), buildLatestReerOfficialMap(officialRows));
  }

  async guardarFacturaLiquidacion(fecha: Date, facturaCompra: number | null, facturaVenta: number | null): Promise<OmieLiquidationInvoiceResponse> {
    if (facturaCompra === null && facturaVenta === null) {
      await this.prisma.omieLiquidationInvoice.delete({ where: { fecha } }).catch(() => null);
      return { fecha: formatSpanishDate(fecha), fechaIso: formatDateOnly(fecha), facturaCompra: null, facturaVenta: null, updatedAt: new Date().toISOString() };
    }

    const invoice = await this.prisma.omieLiquidationInvoice.upsert({
      where: { fecha },
      create: {
        fecha,
        facturaCompra: facturaCompra === null ? null : new Prisma.Decimal(facturaCompra.toFixed(2)),
        facturaVenta: facturaVenta === null ? null : new Prisma.Decimal(facturaVenta.toFixed(2))
      },
      update: {
        facturaCompra: facturaCompra === null ? null : new Prisma.Decimal(facturaCompra.toFixed(2)),
        facturaVenta: facturaVenta === null ? null : new Prisma.Decimal(facturaVenta.toFixed(2))
      }
    });

    return mapInvoiceResponse(invoice);
  }
}

type LiquidacionMarket = Exclude<OmieComprobacionLiquidacionMercado, "TOTAL">;

type LiquidacionMarketAccumulator = {
  energia: number;
  importe: number;
  compra: number;
  venta: number;
  precioNumerator: number;
  precioDenominator: number;
  precioSum: number;
  precioCount: number;
  hasEnergia: boolean;
  hasImporte: boolean;
};

type LiquidacionAccumulatorSet = Record<LiquidacionMarket, LiquidacionMarketAccumulator>;

type LiquidacionDailyDraft = {
  fecha: string;
  fechaIso: string;
  dia: string;
  mercados: LiquidacionAccumulatorSet;
  horas: Map<number, LiquidacionAccumulatorSet>;
  periodos: Map<number, LiquidacionAccumulatorSet>;
};

const LIQUIDACION_MARKETS: LiquidacionMarket[] = ["MD", "IDA1", "IDA2", "IDA3", "XBID"];
type AdditionalLiquidationConceptDefinition = {
  codigo: string;
  descripcion: string;
  ladoEconomico: "compra" | "venta" | "ambos";
  fuenteOficial: string;
};

const ADDITIONAL_LIQUIDATION_CONCEPTS: Record<"REER", AdditionalLiquidationConceptDefinition> = {
  REER: {
    codigo: "REER",
    descripcion: "Reparto del excedente o deficit REER a unidades de adquisicion nacionales",
    ladoEconomico: "compra",
    fuenteOficial: "9230 - Fichero de Anotaciones de liquidaciones por version"
  }
};

const REER_TOLERANCIA_PERIODO_EUR = Number(process.env.OMIE_REER_TOLERANCIA_PERIODO_EUR ?? "0.01");
const REER_TOLERANCIA_DIA_EUR = Number(process.env.OMIE_REER_TOLERANCIA_DIA_EUR ?? "0.05");
const REER_TOOLTIP =
  "El REER de Comprobacion de Liquidaciones se toma exclusivamente de la anotacion oficial SIOM2 9230 cuando esta disponible.";
const REER_EXCLUSIONS_LIMITATION =
  "Regla preparada para adquisicion nacional repartible. Actualmente el calculo usa la unidad convencional configurada y no dispone de metadatos suficientes para excluir bombeo, almacenamiento, unidades genericas, exportacion, porfolios de generacion de compra o servicios auxiliares fuera de esa unidad.";

type OmieLiquidationInvoiceRecord = {
  fecha: Date;
  facturaCompra: Prisma.Decimal | null;
  facturaVenta: Prisma.Decimal | null;
  updatedAt: Date;
};

function buildComprobacionLiquidaciones(
  analisis: OmieAnalisisMensualResponse,
  invoices: Map<string, OmieLiquidationInvoiceRecord>,
  reerOfficialRows: Map<string, ReerOfficialRow[]>
): OmieComprobacionLiquidacionesResponse {
  const monthly = createLiquidacionAccumulatorSet();
  const daily = new Map<string, LiquidacionDailyDraft>();

  for (const row of analisis.periodos) {
    const fechaIso = isoDateFromClave(row.clave);
    const day = getOrCreateDailyLiquidacion(daily, row.fecha, fechaIso);
    const hour = Math.ceil(row.periodo / 4);
    let hourly = day.horas.get(hour);
    if (!hourly) {
      hourly = createLiquidacionAccumulatorSet();
      day.horas.set(hour, hourly);
    }
    let period = day.periodos.get(row.periodo);
    if (!period) {
      period = createLiquidacionAccumulatorSet();
      day.periodos.set(row.periodo, period);
    }

    addLiquidacionRow(monthly, row);
    addLiquidacionRow(day.mercados, row);
    addLiquidacionRow(hourly, row);
    addLiquidacionRow(period, row);
  }

  const resumenMensual = [
    ...LIQUIDACION_MARKETS.map((market) => buildLiquidacionResumenRow(market, monthly[market])),
    {
      mercado: "TOTAL" as const,
      energiaMWh: totalLiquidacionEnergia(monthly),
      importeEur: totalLiquidacionImporte(monthly)
    }
  ];
  const detalleDiario = [...daily.values()]
    .sort((left, right) => left.fechaIso.localeCompare(right.fechaIso))
    .map((day) => buildLiquidacionDailyRow(day, invoices.get(day.fechaIso), reerOfficialRows.get(day.fechaIso) ?? []));
  const energiaCalculada = totalLiquidacionEnergia(monthly);
  const totalesReer = buildTotalesReer(detalleDiario);
  const netoFacturaCalculado = nullableEuroSum(detalleDiario.map((row) => row.netoFactura));

  return {
    mes: analisis.mes,
    year: analisis.year,
    month: analisis.month,
    fechaDesde: analisis.fechaDesde,
    fechaHasta: analisis.fechaHasta,
    resolucion: analisis.resolucion,
    resumenMensual,
    detalleDiario,
    totalesReer,
    modosResultado: {
      liquidacionConciliadaDisponible: detalleDiario.some((row) => row.reer.reerOficial !== null)
    },
    cuadroEconomico: buildCuadre(netoFacturaCalculado, null),
    cuadroEnergetico: buildCuadre(energiaCalculada, null)
  };
}

function getOrCreateDailyLiquidacion(daily: Map<string, LiquidacionDailyDraft>, fecha: string, fechaIso: string) {
  const current = daily.get(fechaIso);
  if (current) {
    return current;
  }
  const next = {
    fecha,
    fechaIso,
    dia: weekdayName(fechaIso),
    mercados: createLiquidacionAccumulatorSet(),
    horas: new Map<number, LiquidacionAccumulatorSet>(),
    periodos: new Map<number, LiquidacionAccumulatorSet>()
  };
  daily.set(fechaIso, next);
  return next;
}

function createLiquidacionAccumulatorSet(): LiquidacionAccumulatorSet {
  return {
    MD: createLiquidacionMarketAccumulator(),
    IDA1: createLiquidacionMarketAccumulator(),
    IDA2: createLiquidacionMarketAccumulator(),
    IDA3: createLiquidacionMarketAccumulator(),
    XBID: createLiquidacionMarketAccumulator()
  };
}

function createLiquidacionMarketAccumulator(): LiquidacionMarketAccumulator {
  return {
    energia: 0,
    importe: 0,
    compra: 0,
    venta: 0,
    precioNumerator: 0,
    precioDenominator: 0,
    precioSum: 0,
    precioCount: 0,
    hasEnergia: false,
    hasImporte: false
  };
}

function addLiquidacionRow(accumulators: LiquidacionAccumulatorSet, row: OmieAnalisisMensualPeriodo) {
  addLiquidacionMarket(accumulators.MD, row.programaMd, row.precioMd);
  addLiquidacionMarket(accumulators.IDA1, row.volIda1, row.precioIda1);
  addLiquidacionMarket(accumulators.IDA2, row.volIda2, row.precioIda2);
  addLiquidacionMarket(accumulators.IDA3, row.volIda3, row.precioIda3);
  addLiquidacionMarket(accumulators.XBID, row.volXbid, row.precioXbid);
}

function addLiquidacionMarket(accumulator: LiquidacionMarketAccumulator, energia: number | null, precio: number | null) {
  if (precio !== null && Number.isFinite(precio)) {
    accumulator.precioSum += precio;
    accumulator.precioCount += 1;
  }
  if (energia === null || !Number.isFinite(energia)) {
    return;
  }

  accumulator.energia += energia;
  accumulator.hasEnergia = true;
  if (precio === null || !Number.isFinite(precio)) {
    return;
  }

  accumulator.importe += energia * precio;
  accumulator.hasImporte = true;
  if (energia * precio >= 0) {
    accumulator.compra += energia * precio;
  } else {
    accumulator.venta += Math.abs(energia * precio);
  }
  accumulator.precioNumerator += precio * Math.abs(energia);
  accumulator.precioDenominator += Math.abs(energia);
}

function buildLiquidacionResumenRow(mercado: LiquidacionMarket, accumulator: LiquidacionMarketAccumulator): OmieComprobacionLiquidacionResumen {
  return {
    mercado,
    energiaMWh: liquidacionEnergia(accumulator),
    importeEur: liquidacionImporte(accumulator)
  };
}

function buildLiquidacionDailyRow(
  day: LiquidacionDailyDraft,
  invoice: OmieLiquidationInvoiceRecord | undefined,
  officialRows: ReerOfficialRow[]
): OmieComprobacionLiquidacionDiaria {
  const compraMercados = totalLiquidacionCompra(day.mercados);
  const ventaMercados = totalLiquidacionVenta(day.mercados);
  const netoAnalitico = totalLiquidacionImporte(day.mercados);
  const reer = buildReerDiario(day, officialRows);
  const detalleConceptosCompra = buildConceptosCompra(reer);
  const detalleConceptosVenta: OmieLiquidacionConceptoAdicional[] = [];
  const conceptosCompra = nullableEuroSum(detalleConceptosCompra.map((concepto) => concepto.importeAplicado));
  const conceptosVenta = nullableEuroSum(detalleConceptosVenta.map((concepto) => concepto.importeAplicado));
  const compraBaseImponible = nullableEuroSum([compraMercados, conceptosCompra]);
  const ventaBaseImponible = nullableEuroSum([ventaMercados, conceptosVenta]);
  const ivaCompra = calculateIva(compraBaseImponible);
  const ivaVenta = calculateIva(ventaBaseImponible);
  const compraFactura = nullableEuroSum([compraBaseImponible, ivaCompra]);
  const ventaFactura = nullableEuroSum([ventaBaseImponible, ivaVenta]);
  const netoFactura = compraFactura === null || ventaFactura === null ? null : roundEuroCent(compraFactura - ventaFactura);
  const netoBaseImponible = compraBaseImponible === null || ventaBaseImponible === null ? null : roundEuroCent(compraBaseImponible - ventaBaseImponible);
  return {
    fecha: day.fecha,
    fechaIso: day.fechaIso,
    dia: day.dia,
    energiaMd: liquidacionEnergia(day.mercados.MD),
    costeMd: liquidacionImporte(day.mercados.MD),
    energiaIda1: liquidacionEnergia(day.mercados.IDA1),
    costeIda1: liquidacionImporte(day.mercados.IDA1),
    energiaIda2: liquidacionEnergia(day.mercados.IDA2),
    costeIda2: liquidacionImporte(day.mercados.IDA2),
    energiaIda3: liquidacionEnergia(day.mercados.IDA3),
    costeIda3: liquidacionImporte(day.mercados.IDA3),
    energiaXbid: liquidacionEnergia(day.mercados.XBID),
    costeXbid: liquidacionImporte(day.mercados.XBID),
    costeTotalOmie: netoAnalitico,
    compraMercados,
    ventaMercados,
    conceptosCompra,
    conceptosVenta,
    detalleConceptosCompra,
    detalleConceptosVenta,
    compraBaseImponible,
    ventaBaseImponible,
    ivaCompra,
    ivaVenta,
    compraFactura,
    ventaFactura,
    netoFactura,
    netoBaseImponible,
    netoAnalitico,
    reer,
    compraTotalConciliada: reer.reerOficial === null ? null : nullableEuroSum([compraMercados, reer.reerOficial]),
    facturaCompra: decimalToNullableNumber(invoice?.facturaCompra),
    facturaVenta: decimalToNullableNumber(invoice?.facturaVenta),
    horas: [...day.horas.entries()]
      .sort(([left], [right]) => left - right)
      .map(([hora, mercados]) => buildLiquidacionHourlyRow(day, hora, mercados))
  };
}

function calculateIva(baseImponible: number | null) {
  return baseImponible === null ? null : roundEuroCent(baseImponible * OMIE_IVA_RATE);
}

function buildConceptosCompra(reer: OmieComprobacionReerDiario): OmieLiquidacionConceptoAdicional[] {
  if (reer.reerOficial === null) {
    return [];
  }
  return [
    {
      codigo: "REER",
      descripcion: ADDITIONAL_LIQUIDATION_CONCEPTS.REER.descripcion,
      importePrevisto: null,
      importeOficial: reer.reerOficial,
      importeAplicado: reer.reerOficial,
      estado: reer.estadoReer,
      fuenteOficial: reer.fuenteOficial
    }
  ];
}

function buildLiquidacionHourlyRow(
  day: Pick<LiquidacionDailyDraft, "fecha" | "fechaIso">,
  hora: number,
  mercados: LiquidacionAccumulatorSet
): OmieComprobacionLiquidacionHoraria {
  return {
    fecha: day.fecha,
    fechaIso: day.fechaIso,
    hora,
    mdMWh: liquidacionEnergia(mercados.MD),
    pmd: liquidacionPrecio(mercados.MD),
    costeMd: liquidacionImporte(mercados.MD),
    ida1MWh: liquidacionEnergia(mercados.IDA1),
    pida1: liquidacionPrecio(mercados.IDA1),
    costeIda1: liquidacionImporte(mercados.IDA1),
    ida2MWh: liquidacionEnergia(mercados.IDA2),
    pida2: liquidacionPrecio(mercados.IDA2),
    costeIda2: liquidacionImporte(mercados.IDA2),
    ida3MWh: liquidacionEnergia(mercados.IDA3),
    pida3: liquidacionPrecio(mercados.IDA3),
    costeIda3: liquidacionImporte(mercados.IDA3),
    xbidMWh: liquidacionEnergia(mercados.XBID),
    pxbid: liquidacionPrecio(mercados.XBID),
    costeXbid: liquidacionImporte(mercados.XBID)
  };
}

type ReerOfficialRow = {
  fecha: Date;
  periodo: number;
  version: number;
  agente: string;
  codigoDocumento: string;
  ecreerMwh: Prisma.Decimal;
  epreerEurMwh: Prisma.Decimal;
  eopreerEur: Prisma.Decimal;
  sImp: number | null;
  ficheroOrigen: string;
  fechaDescarga: Date;
};

function buildReerDiario(day: LiquidacionDailyDraft, officialRows: ReerOfficialRow[]): OmieComprobacionReerDiario {
  const officialMap = new Map(officialRows.map((row) => [row.periodo, row]));
  const periodNumbers = new Set<number>([...day.periodos.keys(), ...officialMap.keys()]);
  const periodos = [...periodNumbers].sort((left, right) => left - right).map((periodo) => buildReerPeriodo(periodo, day.periodos.get(periodo), officialMap.get(periodo)));
  const reerOficial = nullableEuroSum(periodos.map((row) => row.importeOficial));
  const energiaReerCalculada = nullableEnergySum(periodos.map((row) => row.energiaReerCalculada));
  const energiaReerOficial = nullableEnergySum(periodos.map((row) => row.energiaReerOficial));
  const diferenciaEnergia = energiaReerCalculada === null || energiaReerOficial === null ? null : roundEnergy(energiaReerCalculada - energiaReerOficial);
  const estadoReer = estadoReerDiario(officialRows.length > 0, diferenciaEnergia);
  const officialMetadata = officialRows[0];

  return {
    estadoReer,
    reerOficial,
    reerAplicado: reerOficial,
    energiaReerCalculada,
    energiaReerOficial,
    diferenciaEnergia,
    diferenciaImporte: null,
    toleranciaPeriodoEur: REER_TOLERANCIA_PERIODO_EUR,
    toleranciaDiaEur: REER_TOLERANCIA_DIA_EUR,
    fuenteOficial: officialMetadata?.ficheroOrigen ?? null,
    origenResultado:
      officialRows.length > 0
        ? "Liquidacion oficial SIOM2 (9230)"
        : "Sin datos REER",
    versionUtilizada: officialMetadata?.version ?? null,
    fechaPublicacion: null,
    fechaDescarga: officialMetadata?.fechaDescarga?.toISOString() ?? null,
    tooltip: REER_TOOLTIP,
    limitacionExclusiones: REER_EXCLUSIONS_LIMITATION,
    periodos
  };
}

function buildReerPeriodo(periodo: number, mercados: LiquidacionAccumulatorSet | undefined, officialRow: ReerOfficialRow | undefined): OmieComprobacionReerPeriodo {
  const energiaNetaAgente = mercados ? totalLiquidacionEnergia(mercados) : null;
  const energiaReerCalculada = energiaNetaAgente === null ? null : roundEnergy(-energiaNetaAgente);
  const energiaReerOficial = decimalToNullableNumber(officialRow?.ecreerMwh);
  const precioXml = decimalToNullableNumber(officialRow?.epreerEurMwh);
  const importeOficial = officialRow ? decimalToRoundedEuroNumber(officialRow.eopreerEur.mul(officialSign(officialRow.sImp))) : null;

  return {
    periodo,
    periodoEtiqueta: quarterPeriodLabel(periodo),
    energiaNetaAgente,
    energiaReerCalculada,
    energiaReerOficial,
    precioXml,
    importeOficial,
    estado: estadoReerPeriodo(officialRow !== undefined, energiaReerCalculada, energiaReerOficial)
  };
}

function estadoReerPeriodo(hasOfficial: boolean, energiaCalculada: number | null, energiaOficial: number | null): OmieReerEstado {
  if (!hasOfficial) {
    return "SIN_DATOS_REER";
  }
  const energyMismatch = energiaCalculada !== null && energiaOficial !== null && Math.abs(energiaCalculada - energiaOficial) > 0.000001;
  if (energyMismatch) {
    return "DIFERENCIA_OFICIAL";
  }
  return "CONCILIADO_OFICIAL";
}

function estadoReerDiario(hasOfficial: boolean, diferenciaEnergia: number | null): OmieReerEstado {
  if (!hasOfficial) {
    return "SIN_DATOS_REER";
  }
  if (diferenciaEnergia !== null && Math.abs(diferenciaEnergia) > 0.000001) {
    return "DIFERENCIA_OFICIAL";
  }
  return "CONCILIADO_OFICIAL";
}

function buildTotalesReer(rows: OmieComprobacionLiquidacionDiaria[]) {
  const reerOficial = nullableEuroSum(rows.map((row) => row.reer.reerOficial));
  return {
    reerOficial
  };
}

function buildLatestReerOfficialMap(rows: ReerOfficialRow[]) {
  const latestVersionByDate = new Map<string, number>();
  for (const row of rows) {
    if (row.periodo <= 0 || row.codigoDocumento !== "9230") {
      continue;
    }
    const key = formatDateOnly(row.fecha);
    latestVersionByDate.set(key, Math.max(latestVersionByDate.get(key) ?? row.version, row.version));
  }
  const map = new Map<string, ReerOfficialRow[]>();
  for (const row of rows) {
    const key = formatDateOnly(row.fecha);
    if (row.periodo <= 0 || row.codigoDocumento !== "9230" || row.version !== latestVersionByDate.get(key)) {
      continue;
    }
    const current = map.get(key) ?? [];
    current.push(row);
    map.set(key, current);
  }
  return map;
}

function quarterPeriodLabel(periodo: number) {
  const hour = Math.floor((periodo - 1) / 4) + 1;
  const quarter = ((periodo - 1) % 4) + 1;
  return `H${String(hour).padStart(2, "0")}Q${quarter}`;
}

function officialSign(sImp: number | null) {
  return sImp === null || sImp < 0 ? 1 : -1;
}

function liquidacionEnergia(accumulator: LiquidacionMarketAccumulator) {
  return accumulator.hasEnergia ? roundEnergy(accumulator.energia) : null;
}

function liquidacionImporte(accumulator: LiquidacionMarketAccumulator) {
  return accumulator.hasImporte ? roundEuro(accumulator.importe) : null;
}

function liquidacionPrecio(accumulator: LiquidacionMarketAccumulator) {
  if (accumulator.precioDenominator > 0) {
    return roundPrice(accumulator.precioNumerator / accumulator.precioDenominator);
  }
  return accumulator.precioCount > 0 ? roundPrice(accumulator.precioSum / accumulator.precioCount) : null;
}

function totalLiquidacionEnergia(accumulators: LiquidacionAccumulatorSet) {
  return nullableEnergySum(LIQUIDACION_MARKETS.map((market) => liquidacionEnergia(accumulators[market])));
}

function totalLiquidacionImporte(accumulators: LiquidacionAccumulatorSet) {
  return nullableEuroSum(LIQUIDACION_MARKETS.map((market) => liquidacionImporte(accumulators[market])));
}

function liquidacionCompra(accumulator: LiquidacionMarketAccumulator) {
  return accumulator.hasImporte ? roundEuro(accumulator.compra) : null;
}

function liquidacionVenta(accumulator: LiquidacionMarketAccumulator) {
  return accumulator.hasImporte ? roundEuro(accumulator.venta) : null;
}

function totalLiquidacionCompra(accumulators: LiquidacionAccumulatorSet) {
  return nullableEuroSum(LIQUIDACION_MARKETS.map((market) => liquidacionCompra(accumulators[market])));
}

function totalLiquidacionVenta(accumulators: LiquidacionAccumulatorSet) {
  return nullableEuroSum(LIQUIDACION_MARKETS.map((market) => liquidacionVenta(accumulators[market])));
}

function buildCuadre(calculado: number | null, liquidado: number | null): OmieComprobacionCuadre {
  const diferencia = calculado === null || liquidado === null ? null : roundEuro(calculado - liquidado);
  return {
    calculado,
    liquidado,
    diferencia,
    estado: cuadreEstado(diferencia)
  };
}

function cuadreEstado(diferencia: number | null): OmieComprobacionCuadreEstado {
  if (diferencia === null) {
    return "pending";
  }
  const absolute = Math.abs(diferencia);
  if (absolute < 1) {
    return "ok";
  }
  if (absolute < 10) {
    return "warning";
  }
  return "danger";
}

function isoDateFromClave(clave: string) {
  return `${clave.slice(0, 4)}-${clave.slice(4, 6)}-${clave.slice(6, 8)}`;
}

function weekdayName(fechaIso: string) {
  const date = new Date(`${fechaIso}T00:00:00.000Z`);
  return ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"][date.getUTCDay()] ?? "";
}

type PriceMapRow = {
  tipoPrecio: OmieTipoPrecio;
  fechaPrograma: Date;
  sesion: string | null;
  periodo: number;
  precioEurMWh: Prisma.Decimal;
};

type ProgramMapRow = {
  tipoPrograma: OmieTipoDocumento;
  fechaPrograma: Date;
  sesion: string | null;
  periodo: number;
  energiaMWh: Prisma.Decimal;
};

export type TransactionMapRow = {
  diaContrato: Date;
  rawPayloadJson: Prisma.JsonValue;
};

type XbidTransactionValue = {
  precioXbid: number | null;
  volXbid: number | null;
  pciIda3Xbid: number | null;
};

type OperativeSession = "MD" | "IDA1" | "IDA2" | "IDA3" | "XBID";

function buildPriceMap(rows: PriceMapRow[]) {
  const map = new Map<string, number>();
  for (const row of rows) {
    const session = getPriceSession(row.tipoPrecio, row.sesion);
    if (session) {
      map.set(buildValueKey(formatDateOnly(row.fechaPrograma), row.periodo, session), decimalToNumber(row.precioEurMWh));
    }
  }
  return map;
}

function buildProgramMap(rows: ProgramMapRow[]) {
  const map = new Map<string, number>();
  for (const row of rows) {
    const rawValue = decimalToNumber(row.energiaMWh);
    const session = getProgramSession(row.tipoPrograma, row.sesion);
    if (session) {
      map.set(buildValueKey(formatDateOnly(row.fechaPrograma), row.periodo, session), normalizeProgramValue(session, rawValue));
    }
  }
  return map;
}

function getPriceSession(tipoPrecio: OmieTipoPrecio, sesion: string | null): OperativeSession | null {
  if (tipoPrecio === OmieTipoPrecio.MD && sesion === null) {
    return "MD";
  }
  if (tipoPrecio === OmieTipoPrecio.MI && sesion === "01") {
    return "IDA1";
  }
  if (tipoPrecio === OmieTipoPrecio.MI && sesion === "02") {
    return "IDA2";
  }
  if (tipoPrecio === OmieTipoPrecio.MI && sesion === "03") {
    return "IDA3";
  }
  return null;
}

function getProgramSession(tipoPrograma: OmieTipoDocumento, sesion: string | null): OperativeSession | null {
  if (tipoPrograma === OmieTipoDocumento.PVD && sesion === null) {
    return "MD";
  }
  if (tipoPrograma === OmieTipoDocumento.PHF && sesion === "01") {
    return "IDA1";
  }
  if (tipoPrograma === OmieTipoDocumento.PHF && sesion === "02") {
    return "IDA2";
  }
  if (tipoPrograma === OmieTipoDocumento.PHF && sesion === "03") {
    return "IDA3";
  }
  return null;
}

function normalizeProgramValue(session: OperativeSession, value: number) {
  return session === "MD" ? roundEnergy(value) : roundEnergy(-value);
}

function buildValueKey(fecha: string, periodo: number, session: OperativeSession) {
  return `${fecha}|${periodo}|${session}`;
}

function diff(after: number | null, before: number | null) {
  return after === null || before === null ? null : roundEnergy(after - before);
}

function profit(pci: number | null, priceAfter: number | null, priceBefore: number | null) {
  return pci === null || priceAfter === null || priceBefore === null ? null : roundEuro(pci * (priceBefore - priceAfter));
}

function profitSpreadAgainstMd(price: number | null, priceMd: number | null) {
  return price === null || priceMd === null ? null : roundPrice(priceMd - price);
}

function profitFromSpread(pci: number | null, spread: number | null) {
  return pci === null || spread === null ? null : roundEuro(pci * spread);
}

export function buildXbidTransactionMap(rows: TransactionMapRow[]) {
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

    if (!periodo || periodo < 1 || periodo > PERIODS_PER_DAY || qty === null || price === null || sign === null || !transactionKey || seenTransactions.has(transactionKey)) {
      continue;
    }

    seenTransactions.add(transactionKey);
    const absoluteEnergyMWh = Math.abs(qty) * QUARTER_HOUR_MWH_FACTOR;
    const key = buildValueKey(fechaEntrega, periodo, "XBID");
    const current = aggregation.get(key) ?? { netEnergyMWh: 0, priceNumerator: 0, totalEnergyMWh: 0 };
    current.netEnergyMWh += sign * absoluteEnergyMWh;
    current.priceNumerator += price * absoluteEnergyMWh;
    current.totalEnergyMWh += absoluteEnergyMWh;
    aggregation.set(key, current);
  }

  const map = new Map<string, XbidTransactionValue>();
  for (const [key, value] of aggregation) {
    map.set(key, {
      precioXbid: value.totalEnergyMWh > 0 ? roundPrice(value.priceNumerator / value.totalEnergyMWh) : null,
      volXbid: value.totalEnergyMWh > 0 ? roundEnergy(value.netEnergyMWh) : null,
      pciIda3Xbid: value.totalEnergyMWh > 0 ? roundEnergy(value.netEnergyMWh) : null
    });
  }
  return map;
}

function buildTransactionDedupeKey(
  payload: Record<string, unknown>,
  fechaEntrega: string,
  periodo: number | null,
  tipTrans: string | null,
  qty: number | null,
  price: number | null
) {
  const idTrans = readPayloadText(payload, ["idtrans", "idTrans", "id_trans"]);
  if (idTrans) {
    return `idtrans:${idTrans}`;
  }
  const idOrdr = readPayloadText(payload, ["idOrdr", "idordr", "id_order"]);
  const contract = readPayloadText(payload, ["contract", "contrato"]);
  return periodo && tipTrans && qty !== null && price !== null ? ["raw", fechaEntrega, periodo, normalizeText(tipTrans), qty, price, idOrdr ?? "", contract ?? ""].join("|") : null;
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
  if (normalized === "BID") {
    return 1;
  }
  if (normalized === "ASK") {
    return -1;
  }
  return null;
}

function readPayloadText(payload: Record<string, unknown>, names: string[]) {
  const value = readPayloadValue(payload, names);
  if (value === null || value === undefined) {
    return null;
  }
  return String(value).trim() || null;
}

function readPayloadInteger(payload: Record<string, unknown>, names: string[]) {
  const value = readPayloadNumber(payload, names);
  return value === null || !Number.isSafeInteger(value) ? null : value;
}

function readPayloadNumber(payload: Record<string, unknown>, names: string[]) {
  const value = readPayloadValue(payload, names);
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const normalized = trimmed.includes(",") ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPayloadValue(payload: Record<string, unknown>, names: string[]) {
  const normalizedNames = new Set(names.map(normalizePayloadKey));
  for (const [key, value] of Object.entries(payload)) {
    if (normalizedNames.has(normalizePayloadKey(key))) {
      return value;
    }
  }
  return null;
}

function normalizePayloadKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function normalizeText(value: string | null) {
  return (value ?? "").trim().toUpperCase();
}

function parseTransactionDate(value: string | null) {
  if (!value) {
    return null;
  }
  const normalized = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function buildMonthRange(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return { start, end, lastDay };
}

function enumerateDates(start: Date, endExclusive: Date) {
  const dates: Date[] = [];
  for (let current = new Date(start); current < endExclusive; current = new Date(current.getTime() + 24 * 60 * 60 * 1000)) {
    dates.push(current);
  }
  return dates;
}

function decimalToNumber(value: Prisma.Decimal) {
  return Number(value.toString());
}

function decimalToNullableNumber(value: Prisma.Decimal | null | undefined) {
  return value === null || value === undefined ? null : Number(value.toString());
}

function decimalToRoundedEuroNumber(value: Prisma.Decimal) {
  return Number(value.toDecimalPlaces(2).toString());
}

function buildInvoiceMap(invoices: OmieLiquidationInvoiceRecord[]) {
  return new Map(invoices.map((invoice) => [formatDateOnly(invoice.fecha), invoice]));
}

function mapInvoiceResponse(invoice: OmieLiquidationInvoiceRecord): OmieLiquidationInvoiceResponse {
  return {
    fecha: formatSpanishDate(invoice.fecha),
    fechaIso: formatDateOnly(invoice.fecha),
    facturaCompra: decimalToNullableNumber(invoice.facturaCompra),
    facturaVenta: decimalToNullableNumber(invoice.facturaVenta),
    updatedAt: invoice.updatedAt.toISOString()
  };
}

function nullableEnergySum(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return present.length > 0 ? roundEnergy(sum(present)) : null;
}

function nullableEuroSum(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return present.length > 0 ? roundEuro(sum(present)) : null;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function roundPrice(value: number) {
  return Number(value.toFixed(6));
}

function roundEnergy(value: number) {
  return Number(value.toFixed(6));
}

function roundEuro(value: number) {
  return Number(value.toFixed(3));
}

function roundEuroCent(value: number) {
  return Number(value.toFixed(2));
}

function buildClave(fecha: string, periodo: number) {
  return `${fecha.replace(/-/g, "")}${String(periodo).padStart(2, "0")}`;
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatSpanishDate(value: Date) {
  return `${String(value.getUTCDate()).padStart(2, "0")}/${String(value.getUTCMonth() + 1).padStart(2, "0")}/${value.getUTCFullYear()}`;
}
