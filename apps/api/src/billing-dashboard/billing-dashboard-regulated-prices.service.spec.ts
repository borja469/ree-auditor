const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { BillingDashboardRegulatedPricesService } = require("./billing-dashboard-regulated-prices.service");

void describe("Billing dashboard regulated price tables", () => {
  void it("resuelve fechas inicio/fin inclusivas", async () => {
    const service = serviceWithVersions([version("RETH", "2026-01-01", "2026-12-31", { rethPrice: price(1) })]);
    assert.equal((await service.resolveRethPrice("2026-01-01")).priceEurMwh, 1);
    assert.equal((await service.resolveRethPrice("2026-12-31")).priceEurMwh, 1);
  });

  void it("validTo NULL aplica indefinidamente", async () => {
    const service = serviceWithVersions([version("EFIH", "2026-01-01", null, { efihPrice: price(2) })]);
    assert.equal((await service.resolveEfihPrice("2035-05-01")).priceEurMwh, 2);
  });

  void it("versiones consecutivas sin solapamiento funcionan", async () => {
    const service = serviceWithVersions([
      version("RETH", "2026-01-01", "2026-06-30", { rethPrice: price(1) }),
      version("RETH", "2026-07-01", null, { rethPrice: price(2) })
    ]);
    assert.equal((await service.resolveRethPrice("2026-06-30")).priceEurMwh, 1);
    assert.equal((await service.resolveRethPrice("2026-07-01")).priceEurMwh, 2);
  });

  void it("solapamiento se detecta como PRICE_VERSION_OVERLAP", async () => {
    const service = serviceWithVersions([
      version("RETH", "2026-01-01", "2026-12-31", { rethPrice: price(1) }),
      version("RETH", "2026-07-01", null, { rethPrice: price(2) })
    ]);
    await assert.rejects(() => service.resolvePriceVersion("RETH", "2026-08-01"), /PRICE_VERSION_OVERLAP/);
  });

  void it("mismo dia compartido entre dos versiones se rechaza", async () => {
    const service = serviceWithVersions([
      version("RETH", "2026-01-01", "2026-07-01", { rethPrice: price(1) }),
      version("RETH", "2026-07-01", null, { rethPrice: price(2) })
    ]);
    await assert.rejects(() => service.resolvePriceVersion("RETH", "2026-07-01"), /PRICE_VERSION_OVERLAP/);
  });

  void it("PC3 resuelve tarifa y periodo", async () => {
    const service = serviceWithVersions([version("PC3", "2026-01-01", null, { pc3Prices: [pc3("3.0TD", [1.082, 0.5, 0.333, 0.25, 0.25, 0])] })]);
    assert.equal((await service.resolvePc3Price("2026-05-01", "3.0TD", "P3")).priceEurMwh, 0.333);
  });

  void it("PC3 0 es valido", async () => {
    const service = serviceWithVersions([version("PC3", "2026-01-01", null, { pc3Prices: [pc3("2.0TD", [0.8, 0.133, 0, 0, 0, 0])] })]);
    assert.equal((await service.resolvePc3Price("2026-05-01", "2.0TD", "P3")).priceEurMwh, 0);
  });

  void it("PC3 NULL genera NOT_CONFIGURED", async () => {
    const service = serviceWithVersions([version("PC3", "2026-01-01", null, { pc3Prices: [pc3("3.0TDVE", [null, null, null, null, null, null])] })]);
    await assert.rejects(() => service.resolvePc3Price("2026-05-01", "3.0TDVE", "P1"), /PC3_PRICE_NOT_CONFIGURED/);
  });

  void it("Peajes energia resuelve tarifa y periodo", async () => {
    const service = serviceWithVersions([version("TOLLS_CHARGES", "2026-01-01", null, { tollsChargesPrices: [tolls("6.1TD", [46.274, 26.717, 12.928, 6.678, 2.619, 1.588])] })]);
    assert.equal((await service.resolveTollsChargesEnergyPrice("2026-05-01", "6.1TD", "P4")).priceEurMwh, 6.678);
  });

  void it("RETh resuelve por fecha", async () => {
    const service = serviceWithVersions([version("RETH", "2026-01-01", null, { rethPrice: price(4) })]);
    assert.equal((await service.resolveRethPrice("2026-03-01")).energyBasis, "BC");
  });

  void it("EFIh resuelve por fecha", async () => {
    const service = serviceWithVersions([version("EFIH", "2026-01-01", null, { efihPrice: { ...price(5), energyBasis: "PF" } })]);
    assert.equal((await service.resolveEfihPrice("2026-03-01")).energyBasis, "PF");
  });

  void it("Bono Social resuelve precio PF y acepta cero", async () => {
    const service = serviceWithVersions([version("BONO_SOCIAL", "2026-01-01", null, { socialBonusPrice: { ...price(0), energyBasis: "PF" } })]);
    const resolved = await service.resolveSocialBonusPrice("2026-03-01");
    assert.equal(resolved.energyBasis, "PF");
    assert.equal(resolved.priceEurMwh, 0);
  });

  void it("Otros resuelve precio BC", async () => {
    const service = serviceWithVersions([version("OTROS", "2026-01-01", null, { otherPrice: price(3) })]);
    const resolved = await service.resolveOtherPrice("2026-03-01");
    assert.equal(resolved.energyBasis, "BC");
    assert.equal(resolved.priceEurMwh, 3);
  });

  void it("IMU resuelve porcentaje versionado", async () => {
    const service = serviceWithVersions([version("IMU", "2026-01-01", null, { imuRate: rate(1.5) })]);
    const resolved = await service.resolveImuRate("2026-03-01");
    assert.equal(resolved.percentage, 1.5);
    assert.equal(resolved.basis, "ECONOMIC_AMOUNT");
  });

  void it("Bono Social, Otros e IMU NULL generan NOT_CONFIGURED", async () => {
    await assert.rejects(() => serviceWithVersions([version("BONO_SOCIAL", "2026-01-01", null, { socialBonusPrice: price(null) })]).resolveSocialBonusPrice("2026-03-01"), /BONO_SOCIAL_PRICE_NOT_CONFIGURED/);
    await assert.rejects(() => serviceWithVersions([version("OTROS", "2026-01-01", null, { otherPrice: price(null) })]).resolveOtherPrice("2026-03-01"), /OTROS_PRICE_NOT_CONFIGURED/);
    await assert.rejects(() => serviceWithVersions([version("IMU", "2026-01-01", null, { imuRate: rate(null) })]).resolveImuRate("2026-03-01"), /IMU_RATE_NOT_CONFIGURED/);
  });

  void it("version anterior/futura correcta", async () => {
    const service = serviceWithVersions([
      version("RETH", "2026-01-01", "2026-12-31", { rethPrice: price(1) }),
      version("RETH", "2027-01-01", null, { rethPrice: price(2) })
    ]);
    assert.equal((await service.resolveRethPrice("2026-12-31")).priceEurMwh, 1);
    assert.equal((await service.resolveRethPrice("2027-01-01")).priceEurMwh, 2);
  });

  void it("bloquea editar una version ya referenciada por costes historicos", async () => {
    const service = new BillingDashboardRegulatedPricesService({
      regulatedPriceVersion: {
        findUnique: async () => ({ id: "used", code: "RETH" })
      },
      cmInvoiceIntervalCostComponent: {
        count: async () => 1
      }
    });
    await assert.rejects(() => service.updateVersion("used", { code: "RETH", name: "Cambio", validFrom: "2026-01-01", reth: { priceEurMwh: 2 } }), /REGULATED_PRICE_VERSION_IN_USE/);
  });
});

function serviceWithVersions(rows) {
  return new BillingDashboardRegulatedPricesService({
    regulatedPriceVersion: {
      findMany: async ({ where }) => rows.filter((row) => row.code === where.code && row.validFrom <= where.validFrom.lte && (row.validTo === null || row.validTo >= where.OR[1].validTo.gte))
    }
  });
}

function version(code, validFrom, validTo, extra) {
  return {
    id: `${code}-${validFrom}`,
    code,
    name: code,
    validFrom: date(validFrom),
    validTo: validTo ? date(validTo) : null,
    notes: null,
    createdAt: date(validFrom),
    updatedAt: date(validFrom),
    rethPrice: null,
    efihPrice: null,
    socialBonusPrice: null,
    otherPrice: null,
    imuRate: null,
    pc3Prices: [],
    tollsChargesPrices: [],
    ...extra
  };
}

function rate(value) {
  return { id: "detail-id", percentage: value, basis: "ECONOMIC_AMOUNT", unit: "PERCENT" };
}

function price(value) {
  return { id: "detail-id", priceEurMwh: value, energyBasis: "BC", unit: "EUR_MWH" };
}

function pc3(tariffCode, values) {
  return {
    id: `pc3-${tariffCode}`,
    tariffCode,
    p1EurMwh: values[0],
    p2EurMwh: values[1],
    p3EurMwh: values[2],
    p4EurMwh: values[3],
    p5EurMwh: values[4],
    p6EurMwh: values[5],
    energyBasis: "BC",
    unit: "EUR_MWH"
  };
}

function tolls(tariffCode, energyValues) {
  return {
    id: `tolls-${tariffCode}`,
    tariffCode,
    energyP1EurMwh: energyValues[0],
    energyP2EurMwh: energyValues[1],
    energyP3EurMwh: energyValues[2],
    energyP4EurMwh: energyValues[3],
    energyP5EurMwh: energyValues[4],
    energyP6EurMwh: energyValues[5],
    energyBasis: "PF",
    energyUnit: "EUR_MWH",
    powerBasis: "CONTRACTED_POWER",
    powerUnit: "EUR_KW_YEAR"
  };
}

function date(value) {
  return new Date(`${value}T00:00:00.000Z`);
}
