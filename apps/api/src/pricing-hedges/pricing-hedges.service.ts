import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { OmieTipoPrecio, Prisma } from "@prisma/client";
import { buildPricingCalendarRange } from "../pricing-base/calendar_builder";
import { PrismaService } from "../prisma/prisma.service";
import type { PricingHedgeOperation, PricingHedgeOperationInput, PricingHedgeOperationType, PricingHedgePosition, PricingHedgeProduct, PricingHedgesResponse } from "./pricing-hedges.types";

@Injectable()
export class PricingHedgesService {
  private productsCache: { expiresAt: number; products: PricingHedgeProduct[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async products(): Promise<PricingHedgeProduct[]> {
    return this.loadProducts();
  }

  async overview(): Promise<PricingHedgesResponse> {
    const operationsRows = await this.prisma.pricingHedgeOperation.findMany({
      where: { deletedAt: null },
      orderBy: [{ contractDate: "desc" }, { createdAt: "desc" }]
    });
    const productCodes = [...new Set(operationsRows.map((row) => row.productCod))];
    const products = productCodes.length ? await this.loadProducts(productCodes) : [];
    const productsByCod = new Map(products.map((product) => [product.cod, product]));
    const operations = operationsRows.map((row) => toOperation(row, productsByCod.get(row.productCod) ?? null));
    const positions = buildPositions(operations);
    return {
      operations,
      positions,
      products,
      summary: {
        openPositions: positions.filter((position) => Math.abs(position.mwNetos) > 0.000001).length,
        openMw: sum(positions.map((position) => Math.abs(position.mwNetos))),
        openMwh: sum(positions.map((position) => Math.abs(position.mwhNetos ?? 0))),
        marketValue: sum(positions.map((position) => Math.abs(position.valorMercado ?? 0))),
        latentResult: sum(positions.map((position) => position.resultadoLatente ?? 0)),
        realizedResult: sum(positions.map((position) => position.margenRealizado ?? 0)),
        totalResult: sum(positions.map((position) => position.resultadoTotal ?? 0))
      }
    };
  }

  async monthlyTotalResults(year: number): Promise<Map<number, number>> {
    const monthlyValues = await this.monthlyValues(year);
    return new Map([...monthlyValues.entries()].map(([month, values]) => [month, values.resultadoTotal]));
  }

  async monthlyNetMwh(year: number): Promise<Map<number, number>> {
    const monthlyValues = await this.monthlyValues(year);
    return new Map([...monthlyValues.entries()].map(([month, values]) => [month, values.mwhNetos]));
  }

  async monthlyValues(year: number): Promise<Map<number, { resultadoTotal: number; mwhNetos: number }>> {
    const { positions } = await this.overview();
    const output = new Map<number, { resultadoTotal: number; mwhNetos: number }>();
    const productRanges = positions
      .map((position) => position.product)
      .filter((product): product is PricingHedgeProduct => Boolean(product?.fechaInicio && product.fechaFin))
      .map((product) => ({ fechaInicio: product.fechaInicio as string, fechaFin: product.fechaFin as string }));
    const countHours = buildProductHoursCounter(productRanges);

    for (const position of positions) {
      const product = position.product;
      const resultadoTotal = position.resultadoTotal ?? null;
      const mwhNetos = position.mwhNetos ?? null;
      if (!product?.fechaInicio || !product.fechaFin || (resultadoTotal === null && mwhNetos === null)) {
        continue;
      }

      const totalHours = productHoursForRange(product, product.fechaInicio, product.fechaFin, countHours);
      if (!totalHours) {
        continue;
      }

      for (let month = 1; month <= 12; month += 1) {
        const range = monthRange(year, month);
        const start = maxDateText(product.fechaInicio, range.fechaInicio);
        const end = minDateText(product.fechaFin, range.fechaFin);
        if (start > end) {
          continue;
        }
        const monthHours = productHoursForRange(product, start, end, countHours);
        if (!monthHours) {
          continue;
        }
        const current = output.get(month) ?? { resultadoTotal: 0, mwhNetos: 0 };
        const weight = monthHours / totalHours;
        current.resultadoTotal += (resultadoTotal ?? 0) * weight;
        current.mwhNetos += (mwhNetos ?? 0) * weight;
        output.set(month, current);
      }
    }

    return output;
  }

  async create(input: PricingHedgeOperationInput): Promise<PricingHedgeOperation> {
    const data = await this.validateInput(input);
    const created = await this.prisma.pricingHedgeOperation.create({
      data: {
        contractDate: parseDate(data.contractDate),
        operationType: data.operationType,
        productCod: data.productCod,
        powerMw: new Prisma.Decimal(data.powerMw.toFixed(6)),
        contractedPrice: new Prisma.Decimal(data.contractedPrice.toFixed(8)),
        broker: optionalText(data.broker),
        observations: optionalText(data.observations)
      }
    });
    const product = (await this.loadProducts([created.productCod]))[0] ?? null;
    return toOperation(created, product);
  }

  async update(id: string, input: PricingHedgeOperationInput): Promise<PricingHedgeOperation> {
    const existing = await this.prisma.pricingHedgeOperation.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!existing) {
      throw new NotFoundException("Operacion de cobertura no encontrada.");
    }
    const data = await this.validateInput(input);
    const updated = await this.prisma.pricingHedgeOperation.update({
      where: { id },
      data: {
        contractDate: parseDate(data.contractDate),
        operationType: data.operationType,
        productCod: data.productCod,
        powerMw: new Prisma.Decimal(data.powerMw.toFixed(6)),
        contractedPrice: new Prisma.Decimal(data.contractedPrice.toFixed(8)),
        broker: optionalText(data.broker),
        observations: optionalText(data.observations)
      }
    });
    const product = (await this.loadProducts([updated.productCod]))[0] ?? null;
    return toOperation(updated, product);
  }

  async remove(id: string) {
    const existing = await this.prisma.pricingHedgeOperation.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!existing) {
      throw new NotFoundException("Operacion de cobertura no encontrada.");
    }
    await this.prisma.pricingHedgeOperation.update({ where: { id }, data: { deletedAt: new Date() } });
    return { deleted: true };
  }

  private async validateInput(input: PricingHedgeOperationInput): Promise<PricingHedgeOperationInput> {
    const operationType = normalizeOperationType(input.operationType);
    const contractDate = requiredDateText(input.contractDate, "Fecha contratacion");
    const productCod = requiredText(input.productCod, "Producto MEFF", 120);
    const powerMw = requiredPositiveNumber(input.powerMw, "Potencia MW");
    const contractedPrice = requiredNumber(input.contractedPrice, "Precio contratado");
    const product = await this.prisma.pricingMeffPrice.findFirst({ where: { cod: productCod }, select: { cod: true } });
    if (!product) {
      throw new BadRequestException("El producto MEFF seleccionado no existe en Pricing > MEFF.");
    }
    return { contractDate, operationType, productCod, powerMw, contractedPrice, broker: optionalText(input.broker), observations: optionalText(input.observations) };
  }

  private async loadProducts(codes?: string[]): Promise<PricingHedgeProduct[]> {
    const normalizedCodes = [...new Set(codes?.map((code) => code.trim()).filter(Boolean) ?? [])].sort();
    const cacheKeyIsFullCatalog = normalizedCodes.length === 0;
    if (cacheKeyIsFullCatalog && this.productsCache && this.productsCache.expiresAt > Date.now()) {
      return this.productsCache.products;
    }
    const latestRows = normalizedCodes.length
      ? await this.prisma.$queryRaw<PricingMeffLatestRow[]>`
          SELECT DISTINCT ON ("cod")
            "id",
            "fecha_publicacion" AS "fechaPublicacion",
            "cod",
            "tipo",
            "clase",
            "periodo",
            "entrega",
            "multiplicador",
            "precio"
          FROM "pricing_meff_prices"
          WHERE "cod" IN (${Prisma.join(normalizedCodes)})
          ORDER BY "cod" ASC, "fecha_publicacion" DESC
        `
      : await this.prisma.$queryRaw<PricingMeffLatestRow[]>`
          SELECT DISTINCT ON ("cod")
            "id",
            "fecha_publicacion" AS "fechaPublicacion",
            "cod",
            "tipo",
            "clase",
            "periodo",
            "entrega",
            "multiplicador",
            "precio"
          FROM "pricing_meff_prices"
          ORDER BY "cod" ASC, "fecha_publicacion" DESC
        `;
    const rowsWithRange = latestRows.map((row) => ({ row, range: inferDeliveryRange(row.cod, row.entrega, row.periodo) }));
    const cascadeRowsWithRange = cacheKeyIsFullCatalog
      ? rowsWithRange
      : (await this.loadLatestProductRows()).map((row) => ({ row, range: inferDeliveryRange(row.cod, row.entrega, row.periodo) }));
    const countHours = buildProductHoursCounter(rowsWithRange.map((item) => item.range).filter((range): range is DeliveryRange => Boolean(range)));
    const cascadePrices = buildCascadePrices(cascadeRowsWithRange);
    const marketPrices = cacheKeyIsFullCatalog ? new Map<string, MarketPrice>() : await this.loadMarketPrices(rowsWithRange, countHours, cascadePrices);
    const products = rowsWithRange.map(({ row, range }) => {
      const hours = range ? countHours(range.fechaInicio, range.fechaFin) : { base: null, peak: null };
      const marketPrice = marketPrices.get(row.cod);
      return {
        cod: row.cod,
        label: productLabel(row),
        tipo: row.tipo,
        clase: row.clase,
        periodo: row.periodo,
        entrega: row.entrega,
        fechaInicio: range?.fechaInicio ?? null,
        fechaFin: range?.fechaFin ?? null,
        horasBase: hours.base,
        horasPunta: hours.peak,
        latestPrice: marketPrice?.price ?? decimalToNumber(row.precio),
        latestPriceDate: marketPrice?.priceDate ?? formatDate(row.fechaPublicacion)
      };
    }).sort((left, right) => left.label.localeCompare(right.label, "es", { numeric: true, sensitivity: "base" }));
    if (cacheKeyIsFullCatalog) {
      this.productsCache = { expiresAt: Date.now() + 60_000, products };
    }
    return products;
  }

  private async loadLatestProductRows(): Promise<PricingMeffLatestRow[]> {
    return this.prisma.$queryRaw<PricingMeffLatestRow[]>`
      SELECT DISTINCT ON ("cod")
        "id",
        "fecha_publicacion" AS "fechaPublicacion",
        "cod",
        "tipo",
        "clase",
        "periodo",
        "entrega",
        "multiplicador",
        "precio"
      FROM "pricing_meff_prices"
      ORDER BY "cod" ASC, "fecha_publicacion" DESC
    `;
  }

  private async loadMarketPrices(
    items: Array<{ row: PricingMeffLatestRow; range: DeliveryRange | null }>,
    countHours: (start: string, end: string) => { base: number | null; peak: number | null },
    cascadePrices: Map<string, CascadeMonthPrice[]>
  ) {
    const rangedItems = items.filter((item): item is { row: PricingMeffLatestRow; range: DeliveryRange } => Boolean(item.range));
    const today = todayInputValue();
    const deliveredItems = rangedItems.filter((item) => item.range.fechaInicio <= today);
    if (!deliveredItems.length) {
      return new Map<string, MarketPrice>();
    }

    const fechaInicio = deliveredItems.map((item) => item.range.fechaInicio).sort()[0];
    const fechaFin = deliveredItems.map((item) => minDateText(item.range.fechaFin, today)).sort().at(-1);
    if (!fechaInicio || !fechaFin) {
      return new Map<string, MarketPrice>();
    }

    const omieRows = await this.prisma.omiePrice.findMany({
      where: {
        tipoPrecio: OmieTipoPrecio.MD,
        sesion: null,
        fechaPrograma: { gte: parseDate(fechaInicio), lte: parseDate(fechaFin) }
      },
      select: { fechaPrograma: true, periodo: true, precioEurMWh: true },
      orderBy: [{ fechaPrograma: "asc" }, { periodo: "asc" }]
    });
    if (!omieRows.length) {
      return new Map<string, MarketPrice>();
    }

    const omieByDate = new Map<string, typeof omieRows>();
    for (const row of omieRows) {
      const date = formatDate(row.fechaPrograma);
      omieByDate.set(date, [...(omieByDate.get(date) ?? []), row]);
    }
    const weekdayByDate = buildWeekdayByDate(fechaInicio, fechaFin);
    const output = new Map<string, MarketPrice>();

    for (const item of deliveredItems) {
      let weightedPrice = 0;
      let weightedHours = 0;
      let latestOmieDate: string | null = null;

      for (const month of monthsInRange(item.range)) {
        const monthRangeValue = monthRange(month.year, month.month);
        const start = maxDateText(item.range.fechaInicio, monthRangeValue.fechaInicio);
        const end = minDateText(item.range.fechaFin, monthRangeValue.fechaFin);
        const hours = countHours(start, end);
        const productHours = isPeakClass(item.row.tipo) ? hours.peak : hours.base;
        if (!productHours) {
          continue;
        }

        const monthIsClosed = monthRangeValue.fechaFin < today;
        const monthPrices: number[] = [];
        let monthLatestOmieDate: string | null = null;
        if (monthIsClosed) {
          for (const date of enumerateDateTexts(start, end)) {
            const dayRows = omieByDate.get(date) ?? [];
            for (const row of dayRows) {
              if (!isOmiePeriodForProduct(row.periodo, weekdayByDate.get(date) ?? null, item.row)) {
                continue;
              }
              monthPrices.push(Number(row.precioEurMWh));
              monthLatestOmieDate = date;
            }
          }
        }

        const expectedPriceRows = productHours * 4;
        const monthPrice = monthIsClosed && monthPrices.length === expectedPriceRows
          ? average(monthPrices)
          : cascadeMonthPrice(item.row, month.year, month.month, cascadePrices);
        if (monthPrice === null) {
          continue;
        }
        weightedPrice += monthPrice * productHours;
        weightedHours += productHours;
        if (monthIsClosed && monthPrices.length === expectedPriceRows) {
          latestOmieDate = monthLatestOmieDate ?? latestOmieDate;
        }
      }

      if (weightedHours > 0) {
        output.set(item.row.cod, { price: weightedPrice / weightedHours, priceDate: latestOmieDate ?? formatDate(item.row.fechaPublicacion) });
      }
    }

    return output;
  }
}

type PricingMeffLatestRow = {
  id: string;
  fechaPublicacion: Date;
  cod: string;
  tipo: string | null;
  clase: string | null;
  periodo: string | null;
  entrega: string | null;
  multiplicador: string | null;
  precio: Prisma.Decimal | string | number | null;
};

type DeliveryRange = {
  fechaInicio: string;
  fechaFin: string;
};

type MarketPrice = {
  price: number;
  priceDate: string;
};

type CascadeMonthPrice = {
  year: number;
  month: number;
  price: number;
};

function buildPositions(operations: PricingHedgeOperation[]): PricingHedgePosition[] {
  const byProduct = new Map<string, PricingHedgeOperation[]>();
  for (const operation of operations) {
    byProduct.set(operation.productCod, [...(byProduct.get(operation.productCod) ?? []), operation]);
  }
  return [...byProduct.entries()].map(([productCod, items]) => {
    const product = items[0]?.product ?? null;
    const buys = items.filter((item) => item.operationType === "COMPRA");
    const sells = items.filter((item) => item.operationType === "VENTA");
    const mwComprados = sum(buys.map((item) => item.powerMw));
    const mwVendidos = sum(sells.map((item) => item.powerMw));
    const mwCerrados = Math.min(mwComprados, mwVendidos);
    const mwNetos = mwComprados - mwVendidos;
    const precioMedioCompra = weightedAverage(buys);
    const precioMedioVenta = weightedAverage(sells);
    const precioMedioPosicionAbierta = mwNetos > 0 ? precioMedioCompra : mwNetos < 0 ? precioMedioVenta : null;
    const hours = hoursForProduct(product);
    const mwhCerrados = hours === null ? null : mwCerrados * hours;
    const mwhNetos = hours === null ? null : mwNetos * hours;
    const precioMercado = product?.latestPrice ?? null;
    const valorMercado = precioMercado === null || mwhNetos === null ? null : precioMercado * Math.abs(mwhNetos);
    const resultadoLatente = precioMercado === null || mwhNetos === null || precioMedioPosicionAbierta === null
      ? null
      : mwNetos >= 0
        ? (precioMercado - precioMedioPosicionAbierta) * Math.abs(mwhNetos)
        : (precioMedioPosicionAbierta - precioMercado) * Math.abs(mwhNetos);
    const margenRealizado = mwhCerrados === null || precioMedioCompra === null || precioMedioVenta === null || mwCerrados === 0
      ? null
      : (precioMedioVenta - precioMedioCompra) * mwhCerrados;
    const resultadoTotal = margenRealizado === null && resultadoLatente === null ? null : (margenRealizado ?? 0) + (resultadoLatente ?? 0);
    return {
      productCod,
      product,
      productLabel: product?.label ?? productCod,
      tipo: product?.tipo ?? null,
      clase: product?.clase ?? null,
      mwComprados,
      mwVendidos,
      mwCerrados,
      mwNetos,
      mwhCerrados,
      mwhNetos,
      precioMedioCompra,
      precioMedioVenta,
      precioMedioPosicionAbierta,
      precioMercado,
      fechaPrecioMercado: product?.latestPriceDate ?? null,
      valorMercado,
      resultadoLatente,
      margenRealizado,
      resultadoTotal,
      operations: items
    };
  }).sort((left, right) => left.productLabel.localeCompare(right.productLabel, "es", { numeric: true, sensitivity: "base" }));
}

function toOperation(row: {
  id: string;
  contractDate: Date;
  operationType: string;
  productCod: string;
  powerMw: Prisma.Decimal | number;
  contractedPrice: Prisma.Decimal | number;
  broker: string | null;
  observations: string | null;
  createdAt: Date;
  updatedAt: Date;
}, product: PricingHedgeProduct | null): PricingHedgeOperation {
  const powerMw = Number(row.powerMw);
  const hours = hoursForProduct(product);
  return {
    id: row.id,
    contractDate: formatDate(row.contractDate),
    operationType: normalizeOperationType(row.operationType),
    productCod: row.productCod,
    powerMw,
    contractedPrice: Number(row.contractedPrice),
    broker: row.broker,
    observations: row.observations,
    product,
    volumeMwh: hours === null ? null : powerMw * hours,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function hoursForProduct(product: PricingHedgeProduct | null) {
  if (!product) {
    return null;
  }
  return isPeakClass(product.tipo) ? product.horasPunta : product.horasBase;
}

function productHoursForRange(
  product: PricingHedgeProduct,
  start: string,
  end: string,
  countHours: (start: string, end: string) => { base: number | null; peak: number | null }
) {
  const hours = countHours(start, end);
  return isPeakClass(product.tipo) ? hours.peak : hours.base;
}

function inferDeliveryRange(cod: string, entrega: string | null, periodo: string | null) {
  const text = [entrega, cod, periodo].filter(Boolean).join(" ");
  const month = parseMonthProduct(text);
  if (month) {
    return monthRange(month.year, month.month);
  }
  const quarter = parseQuarterProduct(text);
  if (quarter) {
    return { fechaInicio: `${quarter.year}-${pad((quarter.quarter - 1) * 3 + 1)}-01`, fechaFin: lastDayOfMonth(quarter.year, quarter.quarter * 3) };
  }
  const year = parseYearProduct(text);
  return year ? { fechaInicio: `${year}-01-01`, fechaFin: `${year}-12-31` } : null;
}

function buildProductHoursCounter(ranges: DeliveryRange[]) {
  if (!ranges.length) {
    return () => ({ base: null, peak: null });
  }
  const fechaInicio = ranges.map((range) => range.fechaInicio).sort()[0];
  const fechaFin = ranges.map((range) => range.fechaFin).sort().at(-1);
  if (!fechaInicio || !fechaFin) {
    return () => ({ base: null, peak: null });
  }

  const rows = buildPricingCalendarRange(fechaInicio, fechaFin);
  const totalsByDate = new Map<string, { base: number; peak: number }>();
  for (const row of rows) {
    const totals = totalsByDate.get(row.fecha) ?? { base: 0, peak: 0 };
    totals.base += 1;
    if (row.diaSemana >= 1 && row.diaSemana <= 5 && row.hora >= 8 && row.hora < 20) {
      totals.peak += 1;
    }
    totalsByDate.set(row.fecha, totals);
  }

  const dates = [...totalsByDate.keys()].sort();
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const basePrefix = [0];
  const peakPrefix = [0];
  for (const date of dates) {
    const totals = totalsByDate.get(date) ?? { base: 0, peak: 0 };
    basePrefix.push(basePrefix[basePrefix.length - 1] + totals.base);
    peakPrefix.push(peakPrefix[peakPrefix.length - 1] + totals.peak);
  }

  return (start: string, end: string) => {
    const startIndex = dateIndex.get(start);
    const endIndex = dateIndex.get(end);
    if (startIndex === undefined || endIndex === undefined || endIndex < startIndex) {
      return { base: null, peak: null };
    }
    return {
      base: basePrefix[endIndex + 1] - basePrefix[startIndex],
      peak: peakPrefix[endIndex + 1] - peakPrefix[startIndex]
    };
  };
}

function buildCascadePrices(items: Array<{ row: PricingMeffLatestRow; range: DeliveryRange | null }>) {
  const groups = new Map<string, Array<{ row: PricingMeffLatestRow; parsed: ParsedDelivery }>>();
  for (const item of items) {
    const price = decimalToNumber(item.row.precio);
    const parsed = parseDeliveryProduct(item.row);
    if (price === null || !parsed) {
      continue;
    }
    const key = productCurveKey(item.row);
    groups.set(key, [...(groups.get(key) ?? []), { row: item.row, parsed }]);
  }

  const output = new Map<string, CascadeMonthPrice[]>();
  for (const [key, products] of groups.entries()) {
    const monthly = new Map<string, CascadeMonthPrice>();
    const quarterly = new Map<string, { row: PricingMeffLatestRow; parsed: Extract<ParsedDelivery, { kind: "quarterly" }> }>();
    const annual = new Map<number, PricingMeffLatestRow>();

    for (const product of products) {
      if (product.parsed.kind === "monthly") {
        monthly.set(monthKey(product.parsed.year, product.parsed.month), { year: product.parsed.year, month: product.parsed.month, price: decimalToNumber(product.row.precio) ?? 0 });
      }
      if (product.parsed.kind === "quarterly") {
        quarterly.set(`${product.parsed.year}|${product.parsed.quarter}`, { row: product.row, parsed: product.parsed });
      }
      if (product.parsed.kind === "annual") {
        annual.set(product.parsed.year, product.row);
      }
    }

    for (const [quarterKey, product] of quarterly.entries()) {
      const [yearText, quarterText] = quarterKey.split("|");
      const year = Number(yearText);
      const quarter = Number(quarterText);
      const months = quarterMonths(quarter);
      const directMonthly = months.map((month) => monthly.get(monthKey(year, month))).filter((month): month is CascadeMonthPrice => Boolean(month));
      const missing = months.filter((month) => !monthly.has(monthKey(year, month)));
      if (!missing.length) {
        continue;
      }
      const quarterPrice = decimalToNumber(product.row.precio);
      if (quarterPrice === null) {
        continue;
      }
      const remaining = quarterPrice * 3 - directMonthly.reduce((total, month) => total + month.price, 0);
      const calculated = directMonthly.length ? remaining / missing.length : quarterPrice;
      for (const month of missing) {
        monthly.set(monthKey(year, month), { year, month, price: calculated });
      }
    }

    for (const [year, row] of annual.entries()) {
      const annualPrice = decimalToNumber(row.precio);
      if (annualPrice === null) {
        continue;
      }
      for (let month = 1; month <= 12; month += 1) {
        const key = monthKey(year, month);
        if (!monthly.has(key)) {
          monthly.set(key, { year, month, price: annualPrice });
        }
      }
    }

    output.set(key, [...monthly.values()].sort((left, right) => left.year - right.year || left.month - right.month));
  }
  return output;
}

function cascadeMonthAverage(
  row: PricingMeffLatestRow,
  range: DeliveryRange,
  cascadePrices: Map<string, CascadeMonthPrice[]>,
  countHours: (start: string, end: string) => { base: number | null; peak: number | null }
) {
  const prices = cascadePrices.get(productCurveKey(row));
  if (!prices?.length) {
    return null;
  }
  let weightedPrice = 0;
  let weightedHours = 0;
  for (const month of monthsInRange(range)) {
    const price = prices.find((item) => item.year === month.year && item.month === month.month)?.price;
    if (price === undefined) {
      return null;
    }
    const monthRangeValue = monthRange(month.year, month.month);
    const start = maxDateText(range.fechaInicio, monthRangeValue.fechaInicio);
    const end = minDateText(range.fechaFin, monthRangeValue.fechaFin);
    const hours = countHours(start, end);
    const productHours = isPeakClass(row.tipo) ? hours.peak : hours.base;
    if (!productHours) {
      continue;
    }
    weightedPrice += price * productHours;
    weightedHours += productHours;
  }
  return weightedHours ? weightedPrice / weightedHours : null;
}

function cascadeMonthPrice(row: PricingMeffLatestRow, year: number, month: number, cascadePrices: Map<string, CascadeMonthPrice[]>) {
  return cascadePrices.get(productCurveKey(row))?.find((item) => item.year === year && item.month === month)?.price ?? null;
}

function parseDeliveryProduct(row: Pick<PricingMeffLatestRow, "cod" | "entrega" | "periodo">): ParsedDelivery | null {
  const text = [row.entrega, row.cod, row.periodo].filter(Boolean).join(" ");
  const month = parseMonthProduct(text);
  if (month) {
    return { kind: "monthly", year: month.year, month: month.month };
  }
  const quarter = parseQuarterProduct(text);
  if (quarter) {
    return { kind: "quarterly", year: quarter.year, quarter: quarter.quarter };
  }
  const year = parseYearProduct(text);
  return year ? { kind: "annual", year } : null;
}

type ParsedDelivery =
  | { kind: "monthly"; year: number; month: number }
  | { kind: "quarterly"; year: number; quarter: number }
  | { kind: "annual"; year: number };

function productCurveKey(row: Pick<PricingMeffLatestRow, "tipo" | "clase">) {
  return `${normalizeText(row.tipo)}|${normalizeText(row.clase)}`;
}

function monthsInRange(range: DeliveryRange) {
  const start = parseDate(range.fechaInicio);
  const end = parseDate(range.fechaFin);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const output: Array<{ year: number; month: number }> = [];
  while (cursor.getTime() <= end.getTime()) {
    output.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return output;
}

function quarterMonths(quarter: number) {
  const first = (quarter - 1) * 3 + 1;
  return [first, first + 1, first + 2];
}

function monthKey(year: number, month: number) {
  return `${year}-${pad(month)}`;
}

function buildWeekdayByDate(fechaInicio: string, fechaFin: string) {
  const rows = buildPricingCalendarRange(fechaInicio, fechaFin);
  const output = new Map<string, number>();
  for (const row of rows) {
    if (!output.has(row.fecha)) {
      output.set(row.fecha, row.diaSemana);
    }
  }
  return output;
}

function isOmiePeriodForProduct(periodo: number, diaSemana: number | null, product: Pick<PricingMeffLatestRow, "tipo">) {
  if (!isPeakClass(product.tipo)) {
    return true;
  }
  if (diaSemana === null || diaSemana < 1 || diaSemana > 5) {
    return false;
  }
  const hour = Math.floor((periodo - 1) / 4);
  return hour >= 8 && hour < 20;
}

function enumerateDateTexts(start: string, end: string) {
  const output: string[] = [];
  const cursor = parseDate(start);
  const endDate = parseDate(end);
  while (cursor.getTime() <= endDate.getTime()) {
    output.push(formatDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return output;
}

function minDateText(left: string, right: string) {
  return left <= right ? left : right;
}

function maxDateText(left: string, right: string) {
  return left >= right ? left : right;
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function parseMonthProduct(value: string) {
  const normalized = normalizeText(value);
  const match = normalized.match(/\b(?:m)?(ene|jan|feb|mar|abr|apr|may|jun|jul|ago|aug|sep|oct|nov|dic|dec)[-\s/]?(\d{2,4})\b/);
  if (!match) {
    return null;
  }
  return { year: normalizeYear(match[2]), month: MONTHS[match[1]] };
}

function parseQuarterProduct(value: string) {
  const match = normalizeText(value).match(/\bq([1-4])[-\s/]?(\d{2,4})\b/);
  return match ? { quarter: Number(match[1]), year: normalizeYear(match[2]) } : null;
}

function parseYearProduct(value: string) {
  const match = normalizeText(value).match(/\b(?:cal|yr|year)?[-\s/]?(\d{2,4})\b/);
  return match ? normalizeYear(match[1]) : null;
}

function monthRange(year: number, month: number) {
  return { fechaInicio: `${year}-${pad(month)}-01`, fechaFin: lastDayOfMonth(year, month) };
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function normalizeYear(value: string) {
  const year = Number(value);
  return value.length === 2 ? 2000 + year : year;
}

const MONTHS: Record<string, number> = {
  ene: 1,
  jan: 1,
  feb: 2,
  mar: 3,
  abr: 4,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dic: 12,
  dec: 12
};

function productLabel(row: { cod: string; clase: string | null; entrega: string | null }) {
  const parts = [row.entrega ?? row.cod, row.clase].filter(Boolean);
  return [...new Set(parts)].join(" ");
}

function weightedAverage(rows: PricingHedgeOperation[]) {
  const mw = sum(rows.map((row) => row.powerMw));
  return mw === 0 ? null : sum(rows.map((row) => row.powerMw * row.contractedPrice)) / mw;
}

function average(values: number[]) {
  return values.length ? sum(values) / values.length : 0;
}

function isPeakClass(value: string | null) {
  return normalizeText(value).includes("punta") || normalizeText(value).includes("peak");
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function normalizeOperationType(value: unknown): PricingHedgeOperationType {
  const normalized = normalizeText(typeof value === "string" ? value : "");
  if (normalized === "compra") {
    return "COMPRA";
  }
  if (normalized === "venta") {
    return "VENTA";
  }
  throw new BadRequestException("Tipo operacion no valido.");
}

function requiredDateText(value: unknown, label: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${label} debe tener formato YYYY-MM-DD.`);
  }
  return value;
}

function requiredText(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${label} es obligatorio.`);
  }
  return value.trim().slice(0, max);
}

function requiredPositiveNumber(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new BadRequestException(`${label} debe ser mayor que cero.`);
  }
  return parsed;
}

function requiredNumber(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException(`${label} no es valido.`);
  }
  return parsed;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function decimalToNumber(value: Prisma.Decimal | string | number | null | undefined) {
  return value === null || value === undefined ? null : Number(value);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
