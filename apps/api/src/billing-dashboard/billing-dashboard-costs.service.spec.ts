const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const XLSX = require("xlsx");
const { BillingDashboardCostsService, buildBillingAuditWorkbook, buildMadridQuarterKeys, calculateCostComponent, costComponentNature } = require("./billing-dashboard-costs.service");
const { buildPricingCalendarRange } = require("../pricing-base/calendar_builder");
const { buildHolidaySet, buildPeriodRuleMap, buildTariffPeriodSeedRows } = require("../ree-losses/period-engine");

void describe("Billing dashboard costs phase 2", () => {
  void it("calcula siempre sobre BC y convierte kWh a MWh sin redondeo intermedio", () => {
    const result = calculateCostComponent("OMIE_MD", "BC", 125.5, {
      priceEurMwh: 40,
      sourceTable: "omie_prices",
      sourceRowId: "00000000-0000-0000-0000-000000000001",
      sourceVersion: null,
      sourceResolutionMinutes: 15
    });
    assert.equal(result.energyBasis, "BC");
    assert.equal(result.energyKwh, 125.5);
    assert.equal(result.energyMwh, 0.1255);
    assert.equal(result.costEur, 5.02);
  });

  void it("genera XLSX de auditoria con tipos numericos, 0 vs vacio, IMU porcentaje y potencia solo en resumen", () => {
    const buffer = buildBillingAuditWorkbook({
      invoice: {
        invoiceNumber: "FE26024358",
        cups: "ES0000000000000000AA",
        polissaNumber: "P-1",
        tariffCode: "3.0TD",
        invoiceDate: "2026-09-30",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        curveSummary: { expectedIntervals: 2, f1Intervals: 1, p1Intervals: 0, f5dIntervals: 0, p5dIntervals: 0, profiledIntervals: 1, missingIntervals: 0 }
      },
      run: {
        id: "run-1",
        invoiceId: "invoice-1",
        status: "WARNING",
        startedAt: "2026-09-30T10:00:00.000Z",
        completedAt: "2026-09-30T10:01:00.000Z",
        calculationVersion: "PHASE2_ENERGY_COSTS_V5_POWER_TERM",
        totalOmieEur: 0,
        totalLiquidationsEur: 0,
        totalRegulatedEur: 110,
        totalConfiguredEur: 10,
        totalTollsChargesEur: 100,
        totalTollsChargesPowerEur: 100,
        totalDerivedEur: 0,
        totalCostEur: 110,
        intervalsCount: 2,
        okIntervalsCount: 1,
        warningIntervalsCount: 1,
        errorIntervalsCount: 0,
        incidentsCount: 1,
        message: null
      },
      curveRows: [
        {
          id: "curve-1",
          datetime: new Date("2026-09-07T00:00:00.000Z"),
          tariffPeriod: "P1",
          consumptionSource: "F1",
          profileType: null,
          consumptionPfKwh: 1.25,
          consumptionBcKwh: 1.5,
          lossPercentage: 12.3,
          lossVersion: "C1",
          validationStatus: "OK",
          validationMessage: null,
          intervalCost: {
            totalCostEur: 10,
            incidentCodes: [],
            components: [
              { componentCode: "OMIE_MD", energyBasis: "BC", energyKwh: 1.5, energyMwh: 0.0015, priceEurMwh: 0, baseAmountEur: null, percentage: null, costEur: 0, sourceTable: "omie_prices", sourceRowId: "00000000-0000-0000-0000-000000000001", sourceVersion: null, regulatedPriceVersionId: null, regulatedPriceVersionName: null, sourceValidFrom: null, sourceValidTo: null, sourceTariffCode: null, sourceTariffPeriod: null, sourceResolutionMinutes: 15, status: "OK", incidentCode: null },
              { componentCode: "IMU", energyBasis: "ECONOMIC_AMOUNT", energyKwh: null, energyMwh: null, priceEurMwh: null, baseAmountEur: 9.85221675, percentage: 1.5, costEur: 0.14778325, sourceTable: "regulated_imu_rates", sourceRowId: "00000000-0000-0000-0000-000000000002", sourceVersion: null, regulatedPriceVersionId: "00000000-0000-0000-0000-000000000003", regulatedPriceVersionName: "IMU 2026", sourceValidFrom: "2026-01-01", sourceValidTo: null, sourceTariffCode: null, sourceTariffPeriod: null, sourceResolutionMinutes: null, status: "OK", incidentCode: null }
            ]
          }
        },
        {
          id: "curve-2",
          datetime: new Date("2026-09-07T00:15:00.000Z"),
          tariffPeriod: "P2",
          consumptionSource: "PROFILE_FINAL",
          profileType: "FINAL",
          consumptionPfKwh: 2,
          consumptionBcKwh: 2.4,
          lossPercentage: 10,
          lossVersion: "C1",
          validationStatus: "OK",
          validationMessage: null,
          intervalCost: {
            totalCostEur: null,
            incidentCodes: ["CAD_NOT_FOUND"],
            components: [
              { componentCode: "CAD", energyBasis: "BC", energyKwh: 2.4, energyMwh: 0.0024, priceEurMwh: null, baseAmountEur: null, percentage: null, costEur: null, sourceTable: null, sourceRowId: null, sourceVersion: null, regulatedPriceVersionId: null, regulatedPriceVersionName: null, sourceValidFrom: null, sourceValidTo: null, sourceTariffCode: null, sourceTariffPeriod: null, sourceResolutionMinutes: null, status: "WARNING", incidentCode: "CAD_NOT_FOUND" }
            ]
          }
        }
      ],
      powerRows: [
        { componentCode: "TOLLS_CHARGES_POWER", calculationBasis: "CONTRACTED_POWER", tariffCode: "3.0TD", tariffPeriod: "P1", contractedPowerKw: 10, startDate: "2026-09-01", endDate: "2026-09-30", billedDays: 30, yearDays: 365, annualPriceEurKwYear: 36.5, costEur: 30, sourceTable: "regulated_tolls_charges_prices", sourceRowId: "00000000-0000-0000-0000-000000000004", regulatedPriceVersionId: "00000000-0000-0000-0000-000000000005", regulatedPriceVersionName: "PYC 2026", sourceValidFrom: "2026-01-01", sourceValidTo: null, status: "OK", incidentCode: null }
      ]
    });
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    assert.deepEqual(workbook.SheetNames, ["Auditoria QH", "Resumen", "Potencia"]);
    const qh = workbook.Sheets["Auditoria QH"];
    assert.equal(qh["D2"].t, "n");
    assert.equal(qh["G2"].v, 1.5);
    assert.equal(qh["H2"].v, 0);
    assert.equal(qh["I3"], undefined);
    assert.equal(qh["R2"].v, 1.5);
    assert.equal(qh["S2"].v, 10);
    assert.match(qh["U3"].v, /CAD_NOT_FOUND/);
    const resumen = workbook.Sheets["Resumen"];
    assert.equal(resumen["B14"].v, 100);
    assert.equal(resumen["B15"].v, 110);
    const potencia = workbook.Sheets["Potencia"];
    assert.equal(potencia["B2"].v, 10);
    assert.equal(potencia["H2"].v, 30);
  });

  void it("distingue precio cero real de precio ausente", () => {
    const zero = calculateCostComponent("OMIE_MD", "BC", 10, {
      priceEurMwh: 0,
      sourceTable: "omie_prices",
      sourceRowId: "00000000-0000-0000-0000-000000000001",
      sourceVersion: null,
      sourceResolutionMinutes: 15
    });
    assert.equal(zero.status, "OK");
    assert.equal(zero.costEur, 0);

    const missing = calculateCostComponent("OMIE_MD", "BC", 10, null);
    assert.equal(missing.status, "WARNING");
    assert.equal(missing.incidentCode, "OMIE_MD_NOT_FOUND");
    assert.equal(missing.costEur, null);
  });

  void it("aplica CAD horario a QH y BS3/RAD3 como QH directo por claves de mercado", () => {
    const instants = [
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-01T00:15:00.000Z"),
      new Date("2026-08-01T00:30:00.000Z"),
      new Date("2026-08-01T00:45:00.000Z")
    ];
    const keys = buildMadridQuarterKeys(instants);
    assert.equal(keys.get(instants[0].toISOString()).hourlyKey, "2026-08-01|1");
    assert.equal(keys.get(instants[3].toISOString()).hourlyKey, "2026-08-01|1");
    assert.equal(keys.get(instants[0].toISOString()).quarterKey, "2026-08-01|1");
    assert.equal(keys.get(instants[3].toISOString()).quarterKey, "2026-08-01|4");
  });

  void it("respeta DST Europe/Madrid con 100 QH en el cambio de octubre", () => {
    const instants = [];
    for (let ms = Date.parse("2026-10-24T22:00:00.000Z"); ms < Date.parse("2026-10-25T23:00:00.000Z"); ms += 15 * 60_000) {
      instants.push(new Date(ms));
    }
    const keys = buildMadridQuarterKeys(instants);
    assert.equal(keys.size, 100);
    assert.equal(keys.get(instants[0].toISOString()).quarterKey, "2026-10-25|1");
    assert.equal(keys.get(instants[99].toISOString()).quarterKey, "2026-10-25|100");
    assert.equal(keys.get(instants[99].toISOString()).hourlyKey, "2026-10-25|25");
  });

  void it("marca INVALID_BC sin sustituir por cero", () => {
    const result = calculateCostComponent("CAD", "BC", null, {
      priceEurMwh: 10,
      sourceTable: "reganecu_records",
      sourceRowId: "00000000-0000-0000-0000-000000000001",
      sourceVersion: "C2",
      sourceResolutionMinutes: 60
    });
    assert.equal(result.status, "WARNING");
    assert.equal(result.incidentCode, "INVALID_BC");
    assert.equal(result.costEur, null);
  });

  void it("no calcula PC3 aunque exista en los origenes de liquidacion", async () => {
    const instant = new Date("2026-08-01T00:00:00.000Z");
    const key = buildMadridQuarterKeys([instant]).get(instant.toISOString());
    const service = new BillingDashboardCostsService({}, regulatedService());
    service.loadOmie = async () => new Map([[key.quarterKey, price("omie_prices", 100, null, 15)]]);
    service.loadHourlyLiquidations = async () => ({
      CAD: new Map([[key.hourlyKey, price("reganecu_records", 10, "A2", 60)]]),
      PC3: new Map([[key.hourlyKey, price("reganecu_records", 999, "A2", 60)]])
    });
    service.loadQhLiquidations = async () => ({
      BS3: new Map([[key.quarterKey, price("reganecu_qh_records", 1, "A2", 15)]]),
      RAD3: new Map([[key.quarterKey, price("reganecu_qh_records", 2, "A2", 15)]])
    });

    const result = await service.buildCostRun([curveInterval(instant, 100, 100)], "2.0TD");
    const components = result.intervalCosts[0].components.map((item) => item.componentCode);
    assert.deepEqual(components, ["OMIE_MD", "CAD", "BS3", "RAD3", "RETH", "EFIH", "BONO_SOCIAL", "OTROS", "PC3_CONFIG", "TOLLS_CHARGES_ENERGY", "IMU"]);
    assert.equal(result.counts.incidents, 0);
    assert.equal(result.totals.totalLiquidationsEur, 1.3);
    assert.ok(Math.abs(result.totals.totalConfiguredEur - 1.9) < 1e-12);
    assert.equal(result.totals.totalTollsChargesEur, 1);
    assert.equal(result.totals.totalDerivedEur, 0.19799999999999998);
    assert.ok(Math.abs(result.totals.totalCostEur - 14.398) < 1e-12);
  });

  void it("PC3 ausente no genera incidencia", async () => {
    const instant = new Date("2026-08-01T00:00:00.000Z");
    const key = buildMadridQuarterKeys([instant]).get(instant.toISOString());
    const service = new BillingDashboardCostsService({}, regulatedService());
    service.loadOmie = async () => new Map([[key.quarterKey, price("omie_prices", 100, null, 15)]]);
    service.loadHourlyLiquidations = async () => ({
      CAD: new Map([[key.hourlyKey, price("reganecu_records", 10, "A2", 60)]])
    });
    service.loadQhLiquidations = async () => ({
      BS3: new Map([[key.quarterKey, price("reganecu_qh_records", 1, "A2", 15)]]),
      RAD3: new Map([[key.quarterKey, price("reganecu_qh_records", 2, "A2", 15)]])
    });

    const result = await service.buildCostRun([curveInterval(instant, 100, 100)], "2.0TD");
    assert.equal(result.counts.incidents, 0);
    assert.equal(result.summary.some((item) => item.componentCode === "PC3"), false);
    assert.equal(component(result, 0, "PC3_CONFIG").priceEurMwh, 0);
    assert.equal(component(result, 0, "PC3_CONFIG").costEur, 0);
  });

  void it("selecciona fallback C1 por QH si A2 no existe y A2 si existe en otro QH del mismo dia", async () => {
    const first = new Date("2026-08-01T00:00:00.000Z");
    const second = new Date("2026-08-01T00:15:00.000Z");
    const keys = buildMadridQuarterKeys([first, second]);
    const firstKey = keys.get(first.toISOString());
    const secondKey = keys.get(second.toISOString());
    const service = new BillingDashboardCostsService({}, regulatedService());
    service.loadOmie = async () => new Map([
      [firstKey.quarterKey, price("omie_prices", 100, null, 15)],
      [secondKey.quarterKey, price("omie_prices", 100, null, 15)]
    ]);
    service.loadHourlyLiquidations = async () => ({
      CAD: new Map([[firstKey.hourlyKey, price("reganecu_records", 10, "A2", 60)]])
    });
    service.loadQhLiquidations = async () => ({
      BS3: new Map([
        [firstKey.quarterKey, price("reganecu_qh_records", 1, "C1", 15)],
        [secondKey.quarterKey, price("reganecu_qh_records", 2, "A2", 15)]
      ]),
      RAD3: new Map([
        [firstKey.quarterKey, price("reganecu_qh_records", 3, "A2", 15)],
        [secondKey.quarterKey, price("reganecu_qh_records", 3, "A2", 15)]
      ])
    });

    const result = await service.buildCostRun([curveInterval(first, 100, 100), curveInterval(second, 100, 100)], "2.0TD");
    assert.equal(component(result, 0, "BS3").sourceVersion, "C1");
    assert.equal(component(result, 1, "BS3").sourceVersion, "A2");
  });

  void it("usa BC para mercado/liquidaciones/RETh/PC3 y PF para EFIh/Peajes energia", async () => {
    const instant = new Date("2026-08-01T00:00:00.000Z");
    const key = buildMadridQuarterKeys([instant]).get(instant.toISOString());
    const service = new BillingDashboardCostsService({}, regulatedService());
    service.loadOmie = async () => new Map([[key.quarterKey, price("omie_prices", 100, null, 15)]]);
    service.loadHourlyLiquidations = async () => ({ CAD: new Map([[key.hourlyKey, price("reganecu_records", 10, "A2", 60)]]) });
    service.loadQhLiquidations = async () => ({
      BS3: new Map([[key.quarterKey, price("reganecu_qh_records", 1, "A2", 15)]]),
      RAD3: new Map([[key.quarterKey, price("reganecu_qh_records", 2, "A2", 15)]])
    });

    const result = await service.buildCostRun([curveInterval(instant, 100, 80)], "2.0TD");
    for (const code of ["OMIE_MD", "CAD", "BS3", "RAD3", "RETH", "PC3_CONFIG"]) {
      assert.equal(component(result, 0, code).energyBasis, "BC");
      assert.equal(component(result, 0, code).energyKwh, 100);
    }
    for (const code of ["EFIH", "TOLLS_CHARGES_ENERGY", "BONO_SOCIAL"]) {
      assert.equal(component(result, 0, code).energyBasis, "PF");
      assert.equal(component(result, 0, code).energyKwh, 80);
    }
    assert.equal(component(result, 0, "OTROS").energyBasis, "BC");
    assert.equal(component(result, 0, "OTROS").energyKwh, 100);
    assert.equal(component(result, 0, "IMU").energyBasis, "ECONOMIC_AMOUNT");
    assert.equal(component(result, 0, "IMU").energyKwh, null);
  });

  void it("resuelve cambio de vigencia por fecha local Europe/Madrid dentro de una factura", async () => {
    const before = new Date("2026-06-30T21:45:00.000Z");
    const after = new Date("2026-06-30T22:00:00.000Z");
    const keys = buildMadridQuarterKeys([before, after]);
    const service = new BillingDashboardCostsService({}, regulatedServiceByDate());
    service.loadOmie = async () => new Map([
      [keys.get(before.toISOString()).quarterKey, price("omie_prices", 0, null, 15)],
      [keys.get(after.toISOString()).quarterKey, price("omie_prices", 0, null, 15)]
    ]);
    service.loadHourlyLiquidations = async () => ({ CAD: new Map([
      [keys.get(before.toISOString()).hourlyKey, price("reganecu_records", 0, "A2", 60)],
      [keys.get(after.toISOString()).hourlyKey, price("reganecu_records", 0, "A2", 60)]
    ]) });
    service.loadQhLiquidations = async () => ({
      BS3: new Map([
        [keys.get(before.toISOString()).quarterKey, price("reganecu_qh_records", 0, "A2", 15)],
        [keys.get(after.toISOString()).quarterKey, price("reganecu_qh_records", 0, "A2", 15)]
      ]),
      RAD3: new Map([
        [keys.get(before.toISOString()).quarterKey, price("reganecu_qh_records", 0, "A2", 15)],
        [keys.get(after.toISOString()).quarterKey, price("reganecu_qh_records", 0, "A2", 15)]
      ])
    });

    const result = await service.buildCostRun([curveInterval(before, 100, 100), curveInterval(after, 100, 100)], "2.0TD");
    assert.equal(component(result, 0, "RETH").regulatedPriceVersionName, "A");
    assert.equal(component(result, 0, "RETH").priceEurMwh, 1);
    assert.equal(component(result, 1, "RETH").regulatedPriceVersionName, "B");
    assert.equal(component(result, 1, "RETH").priceEurMwh, 2);
  });

  void it("calcula Bono Social sobre PF y Otros sobre BC", async () => {
    const instant = new Date("2026-08-01T00:00:00.000Z");
    const key = buildMadridQuarterKeys([instant]).get(instant.toISOString());
    const service = new BillingDashboardCostsService({}, regulatedService());
    service.loadOmie = async () => new Map([[key.quarterKey, price("omie_prices", 0, null, 15)]]);
    service.loadHourlyLiquidations = async () => ({ CAD: new Map([[key.hourlyKey, price("reganecu_records", 0, "A2", 60)]]) });
    service.loadQhLiquidations = async () => ({
      BS3: new Map([[key.quarterKey, price("reganecu_qh_records", 0, "A2", 15)]]),
      RAD3: new Map([[key.quarterKey, price("reganecu_qh_records", 0, "A2", 15)]])
    });

    const result = await service.buildCostRun([curveInterval(instant, 100, 80)], "2.0TD");
    assert.equal(component(result, 0, "BONO_SOCIAL").energyBasis, "PF");
    assert.equal(component(result, 0, "BONO_SOCIAL").costEur, 0.24);
    assert.equal(component(result, 0, "OTROS").energyBasis, "BC");
    assert.equal(component(result, 0, "OTROS").costEur, 0.4);
  });

  void it("calcula IMU sobre base economica completa excluyendo Peajes + Cargos", async () => {
    const instant = new Date("2026-08-01T00:00:00.000Z");
    const key = buildMadridQuarterKeys([instant]).get(instant.toISOString());
    const service = new BillingDashboardCostsService({}, regulatedService());
    service.loadOmie = async () => new Map([[key.quarterKey, price("omie_prices", 100, null, 15)]]);
    service.loadHourlyLiquidations = async () => ({ CAD: new Map([[key.hourlyKey, price("reganecu_records", 10, "A2", 60)]]) });
    service.loadQhLiquidations = async () => ({
      BS3: new Map([[key.quarterKey, price("reganecu_qh_records", 1, "A2", 15)]]),
      RAD3: new Map([[key.quarterKey, price("reganecu_qh_records", 2, "A2", 15)]])
    });

    const result = await service.buildCostRun([curveInterval(instant, 100, 80)], "2.0TD");
    const imu = component(result, 0, "IMU");
    assert.equal(imu.baseAmountEur, 13);
    assert.equal(imu.percentage, 1.5);
    assert.equal(imu.costEur, 0.195);
  });

  void it("interpreta quantity de lineas Potencia como kW contratados", async () => {
    const instant = new Date("2026-01-01T00:00:00.000Z");
    const key = buildMadridQuarterKeys([instant]).get(instant.toISOString());
    const service = new BillingDashboardCostsService({}, regulatedService());
    stubBaseSources(service, key, 0);

    const result = await service.buildCostRun([curveInterval(instant, 0, 0)], "3.0TD", date("2026-01-01"), date("2026-01-30"), [powerLine("P1", 180)]);
    const power = result.powerCosts[0];
    assert.equal(power.contractedPowerKw, 180);
    assert.equal(power.billedDays, 30);
    assert.equal(power.costEur, 180 * 36.5 / 365 * 30);
  });

  void it("calcula termino de potencia con denominador 365 en ano normal", async () => {
    const instant = new Date("2027-01-01T00:00:00.000Z");
    const key = buildMadridQuarterKeys([instant]).get(instant.toISOString());
    const service = new BillingDashboardCostsService({}, regulatedService({ powerPrice: 36.5 }));
    stubBaseSources(service, key, 0);

    const result = await service.buildCostRun([curveInterval(instant, 0, 0)], "3.0TD", date("2027-01-01"), date("2027-01-30"), [powerLine("P1", 10)]);
    assert.equal(result.powerCosts[0].yearDays, 365);
    assert.equal(result.powerCosts[0].costEur, 30);
  });

  void it("calcula termino de potencia con denominador 366 en ano bisiesto", async () => {
    const instant = new Date("2028-01-01T00:00:00.000Z");
    const key = buildMadridQuarterKeys([instant]).get(instant.toISOString());
    const service = new BillingDashboardCostsService({}, regulatedService({ powerPrice: 36.6 }));
    stubBaseSources(service, key, 0);

    const result = await service.buildCostRun([curveInterval(instant, 0, 0)], "3.0TD", date("2028-01-01"), date("2028-01-30"), [powerLine("P1", 10)]);
    assert.equal(result.powerCosts[0].yearDays, 366);
    assert.equal(result.powerCosts[0].costEur, 30);
  });

  void it("divide el termino de potencia si la factura cruza ano", async () => {
    const instant = new Date("2027-12-20T00:00:00.000Z");
    const key = buildMadridQuarterKeys([instant]).get(instant.toISOString());
    const service = new BillingDashboardCostsService({}, regulatedService({ powerPrice: 36.5, leapPowerPrice: 36.6 }));
    stubBaseSources(service, key, 0);

    const result = await service.buildCostRun([curveInterval(instant, 0, 0)], "3.0TD", date("2027-12-20"), date("2028-01-10"), [powerLine("P1", 10)]);
    assert.equal(result.powerCosts.length, 2);
    assert.equal(result.powerCosts[0].billedDays, 12);
    assert.equal(result.powerCosts[0].yearDays, 365);
    assert.equal(result.powerCosts[1].billedDays, 10);
    assert.equal(result.powerCosts[1].yearDays, 366);
    assert.equal(result.powerCosts[0].costEur, 12);
    assert.equal(result.powerCosts[1].costEur, 10);
  });

  void it("divide el termino de potencia por cambio de version de precio", async () => {
    const instant = new Date("2026-06-20T00:00:00.000Z");
    const key = buildMadridQuarterKeys([instant]).get(instant.toISOString());
    const service = new BillingDashboardCostsService({}, regulatedServicePowerByDate());
    stubBaseSources(service, key, 0);

    const result = await service.buildCostRun([curveInterval(instant, 0, 0)], "3.0TD", date("2026-06-20"), date("2026-07-10"), [powerLine("P1", 10)]);
    assert.equal(result.powerCosts.length, 2);
    assert.equal(result.powerCosts[0].regulatedPriceVersionName, "A");
    assert.equal(result.powerCosts[0].billedDays, 11);
    assert.equal(result.powerCosts[1].regulatedPriceVersionName, "B");
    assert.equal(result.powerCosts[1].billedDays, 10);
  });

  void it("el termino de potencia queda fuera de la base IMU", async () => {
    const instant = new Date("2026-08-01T00:00:00.000Z");
    const key = buildMadridQuarterKeys([instant]).get(instant.toISOString());
    const service = new BillingDashboardCostsService({}, regulatedService({ powerPrice: 365 }));
    stubBaseSources(service, key, 100);

    const result = await service.buildCostRun([curveInterval(instant, 100, 80)], "3.0TD", date("2026-08-01"), date("2026-08-10"), [powerLine("P1", 10)]);
    assert.equal(component(result, 0, "IMU").baseAmountEur, 13);
    assert.equal(result.powerCosts[0].costEur, 100);
    assert.equal(result.totals.totalTollsChargesEur, 100.8);
  });

  void it("expone naturaleza funcional explicita para todos los conceptos actuales", () => {
    const expected = {
      OMIE_MD: "ENERGY",
      CAD: "ENERGY",
      BS3: "ENERGY",
      RAD3: "ENERGY",
      RETH: "ENERGY",
      PC3_CONFIG: "ENERGY",
      EFIH: "ENERGY",
      TOLLS_CHARGES_ENERGY: "ENERGY",
      BONO_SOCIAL: "ENERGY",
      OTROS: "ENERGY",
      IMU: "ENERGY",
      TOLLS_CHARGES_POWER: "POWER"
    };
    for (const [componentCode, nature] of Object.entries(expected)) {
      assert.equal(costComponentNature(componentCode), nature);
    }
  });

  void it("mantiene IMU como ENERGY aunque su calculationBasis sea ECONOMIC_AMOUNT", async () => {
    const instant = new Date("2026-08-01T00:00:00.000Z");
    const key = buildMadridQuarterKeys([instant]).get(instant.toISOString());
    const service = new BillingDashboardCostsService({}, regulatedService());
    stubBaseSources(service, key, 100);

    const result = await service.buildCostRun([curveInterval(instant, 100, 80)], "3.0TD", date("2026-08-01"), date("2026-08-01"), [powerLine("P1", 1)]);
    const imuSummary = result.summary.find((item) => item.componentCode === "IMU");
    assert.equal(imuSummary.nature, "ENERGY");
    assert.equal(imuSummary.calculationBasis, "ECONOMIC_AMOUNT");
  });

  void it("calcula IMU con la base disponible y conserva warnings en los componentes ausentes", async () => {
    const instant = new Date("2026-08-01T00:00:00.000Z");
    const key = buildMadridQuarterKeys([instant]).get(instant.toISOString());
    const service = new BillingDashboardCostsService({}, regulatedService());
    service.loadOmie = async () => new Map([[key.quarterKey, price("omie_prices", 100, null, 15)]]);
    service.loadHourlyLiquidations = async () => ({ CAD: new Map([[key.hourlyKey, price("reganecu_records", 10, "A2", 60)]]) });
    service.loadQhLiquidations = async () => ({
      BS3: new Map([[key.quarterKey, price("reganecu_qh_records", 0, "A2", 15)]]),
      RAD3: new Map()
    });

    const result = await service.buildCostRun([curveInterval(instant, 100, 80)], "2.0TD");
    assert.equal(component(result, 0, "BS3").status, "OK");
    assert.equal(component(result, 0, "BS3").costEur, 0);
    assert.equal(component(result, 0, "RAD3").status, "WARNING");
    assert.equal(component(result, 0, "IMU").status, "OK");
    assert.equal(component(result, 0, "IMU").incidentCode, null);
    assert.ok((component(result, 0, "IMU").costEur ?? 0) > 0);
  });

  void it("aplica perdidas a los componentes BC en el historico de precios indexados", async () => {
    const report = await indexedPriceHistoryFixture({ componentScope: "FULL_ENERGY", regulatedContext: null });
    const firstValue = report.tariffs[0].rows[0].values.P1 ?? report.tariffs[0].rows[0].values.P2 ?? report.tariffs[0].rows[0].values.P3 ?? report.tariffs[0].rows[0].values.P4 ?? report.tariffs[0].rows[0].values.P5 ?? report.tariffs[0].rows[0].values.P6;
    assert.equal(firstValue.priceEurMwh, 125);
  });

  void it("permite un historico limitado a OMIE MD e IMU sin arrastrar otras variables", async () => {
    const report = await indexedPriceHistoryFixture({ componentScope: "OMIE_IMU", regulatedContext: imuContext(1.5) });
    const tariff = report.tariffs[0];
    const period = tariff.periods[0];
    const value = tariff.rows[0].values[period];
    const details = tariff.details[`6.1TD|2026-09|${period}`];
    assert.deepEqual(report.componentCodes, ["OMIE_MD", "IMU"]);
    assert.equal(value.priceEurMwh, 126.875);
    assert.deepEqual(details[0].components.map((item) => item.componentCode), ["OMIE_MD", "IMU"]);
  });
});

async function indexedPriceHistoryFixture({ componentScope, regulatedContext }) {
  const calendar = buildPricingCalendarRange("2026-09-01", "2026-09-01");
  const quarterInstants = calendar.flatMap((hour) => {
    const start = new Date(hour.timestampInicio).getTime();
    return [0, 1, 2, 3].map((quarter) => new Date(start + quarter * 15 * 60_000));
  });
  const keys = buildMadridQuarterKeys(quarterInstants);
  const omie = new Map([...keys.values()].map((key) => [key.quarterKey, price("omie_prices", 100, null, 15)]));
  const service = new BillingDashboardCostsService(
    {
      esiosProfileIntermediateResult: { findMany: async () => [] }
    },
    undefined,
    {
      buildPeriodContext: async () => ({
        rules: buildPeriodRuleMap(buildTariffPeriodSeedRows()),
        holidays: buildHolidaySet([])
      })
    },
    {
      loadHourlyLosses: async () => new Map(calendar.map((hour) => [`${hour.fecha}|${hour.hora + 1}`, { value: 20, version: "A1", status: "ok", sourceId: "loss-1" }]))
    }
  );
  service.loadOmie = async () => omie;
  service.loadHourlyLiquidations = async () => ({ CAD: new Map() });
  service.loadQhLiquidations = async () => ({ BS3: new Map(), RAD3: new Map() });
  service.loadRegulatedPriceContext = async () => regulatedContext;

  return service.calculateIndexedPriceHistory({ dateFrom: "2026-09-01", dateTo: "2026-09-01", tariffCode: "6.1TD", componentScope });
}

function imuContext(percentage) {
  return {
    byCode: new Map([
      ["IMU", [
        {
          id: "imu-version",
          code: "IMU",
          name: "IMU 2026",
          validFrom: date("2026-01-01"),
          validTo: null,
          imuRate: {
            id: "imu-rate",
            percentage
          }
        }
      ]]
    ])
  };
}

function price(sourceTable, priceEurMwh, sourceVersion, sourceResolutionMinutes) {
  return {
    priceEurMwh,
    sourceTable,
    sourceRowId: "00000000-0000-0000-0000-000000000001",
    sourceVersion,
    sourceResolutionMinutes
  };
}

function curveInterval(datetime, consumptionBcKwh, consumptionPfKwh = consumptionBcKwh) {
  return {
    id: `curve-${datetime.toISOString()}`,
    invoiceId: "invoice-1",
    datetime,
    tariffPeriod: "P1",
    consumptionPfKwh,
    consumptionBcKwh
  };
}

function component(result, intervalIndex, componentCode) {
  return result.intervalCosts[intervalIndex].components.find((item) => item.componentCode === componentCode);
}

function regulatedSource(componentCode, priceEurMwh, extra = {}) {
  const tables = {
    RETH: "regulated_reth_prices",
    EFIH: "regulated_efih_prices",
    PC3_CONFIG: "regulated_pc3_prices",
    TOLLS_CHARGES_ENERGY: "regulated_tolls_charges_prices",
    BONO_SOCIAL: "regulated_social_bonus_prices",
    OTROS: "regulated_other_prices"
  };
  return {
    versionId: "11111111-1111-1111-1111-111111111111",
    versionName: `${componentCode} 2026`,
    validFrom: "2026-01-01",
    validTo: null,
    sourceTable: tables[componentCode],
    sourceRowId: "22222222-2222-2222-2222-222222222222",
    priceEurMwh,
    ...extra
  };
}

function regulatedService(options) {
  return regulatedServiceWithOptions(options ?? {});
}

function regulatedServiceWithOptions(options) {
  const powerPrice = options.powerPrice ?? 36.5;
  const leapPowerPrice = options.leapPowerPrice ?? powerPrice;
  return {
    resolveRethPrice: async () => regulatedSource("RETH", 5),
    resolveEfihPrice: async () => regulatedSource("EFIH", 7),
    resolveSocialBonusPrice: async () => regulatedSource("BONO_SOCIAL", 3),
    resolveOtherPrice: async () => regulatedSource("OTROS", 4),
    resolvePc3Price: async (_date, tariffCode, tariffPeriod) => regulatedSource("PC3_CONFIG", 0, { tariffCode, tariffPeriod }),
    resolveTollsChargesEnergyPrice: async (_date, tariffCode, tariffPeriod) => regulatedSource("TOLLS_CHARGES_ENERGY", 10, { tariffCode, tariffPeriod }),
    resolveTollsChargesPowerPrice: async (date, tariffCode, tariffPeriod) => ({ ...regulatedSource("TOLLS_CHARGES_POWER", null, { tariffCode, tariffPeriod }), sourceTable: "regulated_tolls_charges_prices", priceEurKwYear: String(date).startsWith("2028") ? leapPowerPrice : powerPrice }),
    resolveImuRate: async () => ({ ...regulatedSource("IMU", null), sourceTable: "regulated_imu_rates", percentage: 1.5 })
  };
}

function regulatedServicePowerByDate() {
  return {
    ...regulatedService(),
    resolveTollsChargesPowerPrice: async (date, tariffCode, tariffPeriod) => {
      const first = date <= "2026-06-30";
      return { ...regulatedSource("TOLLS_CHARGES_POWER", null, { tariffCode, tariffPeriod, versionName: first ? "A" : "B", validFrom: first ? "2026-01-01" : "2026-07-01", validTo: first ? "2026-06-30" : null }), sourceTable: "regulated_tolls_charges_prices", priceEurKwYear: first ? 36.5 : 73 };
    }
  };
}

function stubBaseSources(service, key, omiePrice) {
  service.loadOmie = async () => new Map([[key.quarterKey, price("omie_prices", omiePrice, null, 15)]]);
  service.loadHourlyLiquidations = async () => ({ CAD: new Map([[key.hourlyKey, price("reganecu_records", omiePrice ? 10 : 0, "A2", 60)]]) });
  service.loadQhLiquidations = async () => ({
    BS3: new Map([[key.quarterKey, price("reganecu_qh_records", omiePrice ? 1 : 0, "A2", 15)]]),
    RAD3: new Map([[key.quarterKey, price("reganecu_qh_records", omiePrice ? 2 : 0, "A2", 15)]])
  });
}

function date(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function powerLine(period, quantity) {
  return { accountName: "Tarifas Acceso / Potencia", lineName: period, quantity, priceUnit: null, priceSubtotal: null };
}

function regulatedServiceByDate() {
  const pick = (date) => date <= "2026-06-30" ? { name: "A", price: 1, from: "2026-01-01", to: "2026-06-30" } : { name: "B", price: 2, from: "2026-07-01", to: null };
  return {
    resolveRethPrice: async (date) => {
      const selected = pick(date);
      return regulatedSource("RETH", selected.price, { versionId: selected.name, versionName: selected.name, validFrom: selected.from, validTo: selected.to });
    },
    resolveEfihPrice: async () => regulatedSource("EFIH", 0),
    resolveSocialBonusPrice: async () => regulatedSource("BONO_SOCIAL", 0),
    resolveOtherPrice: async () => regulatedSource("OTROS", 0),
    resolvePc3Price: async (_date, tariffCode, tariffPeriod) => regulatedSource("PC3_CONFIG", 0, { tariffCode, tariffPeriod }),
    resolveTollsChargesEnergyPrice: async (_date, tariffCode, tariffPeriod) => regulatedSource("TOLLS_CHARGES_ENERGY", 0, { tariffCode, tariffPeriod }),
    resolveTollsChargesPowerPrice: async (_date, tariffCode, tariffPeriod) => ({ ...regulatedSource("TOLLS_CHARGES_POWER", null, { tariffCode, tariffPeriod }), sourceTable: "regulated_tolls_charges_prices", priceEurKwYear: 0 }),
    resolveImuRate: async (date) => {
      const selected = pick(date);
      return { ...regulatedSource("IMU", null, { versionId: selected.name, versionName: selected.name, validFrom: selected.from, validTo: selected.to }), sourceTable: "regulated_imu_rates", percentage: 1.5 };
    }
  };
}
