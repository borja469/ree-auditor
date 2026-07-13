const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { buildPricingCalendar } = require("./calendar_builder");
const { quarter_hour_to_hourly_average } = require("./quarter_hour_aggregator");
const { periodo20TD, periodo30TD, periodo6XTD } = require("./tariff_periods");
const { PricingBaseTableService, validatePricingBaseTable } = require("./pricing_base_table_service");
const { buildCurveMonths, toCurveProduct } = require("./meff_forward_curve_service");
const { get_latest_available_version } = require("./version_selector");
const { normalizeProfilesByMonthlyWeight } = require("./profiles_loader");

void describe("Pricing base table", () => {
  void it("genera 365 dias naturales con horas reales de Europe/Madrid", () => {
    const rows = buildPricingCalendar("2026-12-31", true);
    assert.equal(new Set(rows.map((row) => row.fecha)).size, 365);
    assert.equal(rows[0].fecha, "2026-01-01");
    assert.equal(rows[rows.length - 1].fecha, "2026-12-31");
    assert.equal(rows.length, 8760);
  });

  void it("respeta dias de cambio horario de 23 y 25 horas", () => {
    const rows = buildPricingCalendar("2026-12-31", true);
    assert.equal(rows.filter((row) => row.fecha === "2026-03-29").length, 23);
    assert.equal(rows.filter((row) => row.fecha === "2026-10-25").length, 25);
    assert.equal(rows.find((row) => row.fecha === "2026-03-29").cambioHorarioDst, "spring_forward_23h");
    assert.equal(rows.find((row) => row.fecha === "2026-10-25").cambioHorarioDst, "fall_back_25h");
  });

  void it("convierte cuartos de hora a promedio horario con estado parcial", () => {
    const rows = quarter_hour_to_hourly_average(
      [
        { datetime: "2026-01-01T00:00:00.000Z", value: 10 },
        { datetime: "2026-01-01T00:15:00.000Z", value: 20 },
        { datetime: "2026-01-01T00:30:00.000Z", value: 30 }
      ],
      "datetime",
      "value"
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].valorPromedioHorario, 20);
    assert.equal(rows[0].numCuartos, 3);
    assert.equal(rows[0].status, "partial");
  });

  void it("asigna periodos 2.0TD", () => {
    assert.equal(periodo20TD(row("2026-01-07", 1, 11)), "P1");
    assert.equal(periodo20TD(row("2026-01-07", 1, 15)), "P2");
    assert.equal(periodo20TD(row("2026-01-10", 6, 11)), "P3");
  });

  void it("asigna periodos 3.0TD", () => {
    assert.equal(periodo30TD(row("2026-01-07", 1, 19, 1)), "P1");
    assert.equal(periodo30TD(row("2026-04-07", 1, 12, 4)), "P5");
    assert.equal(periodo30TD(row("2026-04-11", 6, 12, 4)), "P6");
  });

  void it("asigna periodos 6.XTD", () => {
    assert.equal(periodo6XTD(row("2026-01-07", 1, 19, 1)), "P1");
    assert.equal(periodo6XTD(row("2026-06-07", 0, 19, 6)), "P6");
    assert.equal(periodo6XTD(row("2026-06-08", 1, 12, 6)), "P4");
  });

  void it("carga y une perfiles y OMIE", async () => {
    const service = new PricingBaseTableService(
      {
        loadProfiles: async () =>
          new Map([
            [
              "2026-01-01|1",
              {
                profile20td: 1,
                profile30td: 2,
                profile30tdve: 3,
                profile20tdStatus: "ok",
                profile30tdStatus: "ok",
                profile30tdveStatus: "ok"
              }
            ]
          ])
      },
      { loadMercadoDiario: async () => new Map([["2026-01-01|0", { value: 50, status: "ok" }]]) },
      {
        load: async () => ({
          cad: new Map([["2026-01-01|1", { value: 1.1, version: "C5", status: "ok" }]]),
          rad: new Map([["2026-01-01|1", { value: 2.2, version: "C4", status: "partial" }]]),
          perdidas: new Map([["2026-01-01|1", { value: 3.3, version: "C3", status: "ok" }]])
        })
      },
      {
        buildNextTwelveMonths: async () => ({
          publicationDate: null,
          months: []
        })
      }
    );
    const result = await service.buildTable({
      fechaReferencia: "2026-01-01",
      incluirFechaReferencia: true,
      zonaHoraria: "Europe/Madrid",
      fechaDesde: "2026-01-01",
      fechaHasta: "2026-01-01",
      skip: 0,
      take: 1
    });
    assert.equal(result.rows[0].perfilIntermedio20TD, 1);
    assert.equal(result.rows[0].precioOmie, 50);
    assert.equal(result.rows[0].productoPerfilOmie20TD, 50);
    assert.equal(result.rows[0].productoPerfilOmie30TD, 100);
    assert.equal(result.rows[0].productoPerfilOmie30TDVE, 150);
    assert.equal(result.rows[0].cad, 1.1);
    assert.equal(result.rows[0].productoPerfilCad20TD, 1.1);
    assert.equal(result.rows[0].productoPerfilCad30TD, 2.2);
    assert.equal(round(result.rows[0].productoPerfilCad30TDVE), 3.3);
    assert.equal(result.rows[0].cadVersion, "C5");
    assert.equal(result.rows[0].productoPerfilRad20TD, 2.2);
    assert.equal(result.rows[0].productoPerfilRad30TD, 4.4);
    assert.equal(round(result.rows[0].productoPerfilRad30TDVE), 6.6);
    assert.equal(result.rows[0].radStatus, "partial");
    assert.equal(result.rows[0].productoPerfilPerdidas20TD, 3.3);
    assert.equal(result.rows[0].productoPerfilPerdidas30TD, 6.6);
    assert.equal(round(result.rows[0].productoPerfilPerdidas30TDVE), 9.9);
    assert.equal(result.rows[0].perdidasVersion, "C3");
  });

  void it("mantiene precios MEFF futuros aunque no existan perfiles del ano siguiente", async () => {
    const service = new PricingBaseTableService(
      { loadProfiles: async () => new Map() },
      { loadMercadoDiario: async () => new Map() },
      {
        load: async () => ({
          cad: new Map(),
          rad: new Map(),
          perdidas: new Map()
        })
      },
      {
        buildNextTwelveMonths: async () => ({
          publicationDate: "2026-07-09",
          months: [
            {
              year: 2027,
              month: 1,
              key: "2027-01",
              label: "Ene-27",
              price: 82.95,
              origin: "Mensual",
              productCode: "FMBCMJAN27",
              sourceProductCode: "FMBCMJAN27",
              previous7DaysPrice: null,
              previous14DaysPrice: null,
              change7DaysPct: null,
              change14DaysPct: null
            }
          ]
        })
      }
    );

    const result = await service.buildTable({
      fechaReferencia: "2026-12-31",
      incluirFechaReferencia: true,
      zonaHoraria: "Europe/Madrid",
      skip: 0,
      take: 1
    });
    const row = result.meffForward.rows.find((item) => item.curvaMes === "2027-01" && item.periodo20TD === "P1");
    assert.equal(row.precioMeff, 82.95);
    assert.equal(row.perfilIntermedio20TD, 1);
    assert.equal(row.productoPerfilMeff20TD, 82.95);
    assert.equal(row.perfil20TDStatus, "partial");
  });

  void it("normaliza perfiles intermedios como peso mensual", () => {
    const result = normalizeProfilesByMonthlyWeight(
      [
        profileRow("2026-03-01", 1, "2.0TD", 2),
        profileRow("2026-03-02", 1, "2.0TD", 6),
        profileRow("2026-03-03", 1, "2.0TD", 2),
        profileRow("2026-04-01", 1, "2.0TD", 50)
      ],
      "2026-03-02",
      "2026-03-02"
    );

    assert.equal(result.size, 1);
    assert.equal(result.get("2026-03-02|1").profile20td, 0.6);
    assert.equal(result.get("2026-03-02|1").profile20tdStatus, "ok");
  });

  void it("reconstruye meses MEFF faltantes con prioridad mensual, trimestral y anual", () => {
    const months = [
      { year: 2026, month: 7 },
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
      { year: 2026, month: 10 },
      { year: 2027, month: 1 }
    ];
    const result = buildCurveMonths(months, [
      { kind: "monthly", year: 2026, month: 7, code: "MJul-26", price: 54 },
      { kind: "monthly", year: 2026, month: 8, code: "MAgo-26", price: 55 },
      { kind: "quarterly", year: 2026, quarter: 3, code: "Q3-26", price: 60 },
      { kind: "annual", year: 2027, code: "Cal-27", price: 70 }
    ]);

    assert.equal(result.find((month) => month.key === "2026-07").price, 54);
    assert.equal(result.find((month) => month.key === "2026-07").origin, "Mensual");
    assert.equal(result.find((month) => month.key === "2026-09").price, 71);
    assert.equal(result.find((month) => month.key === "2026-09").origin, "Calculado");
    assert.equal(result.find((month) => month.key === "2027-01").price, 70);
    assert.equal(result.find((month) => month.key === "2027-01").origin, "Anual");
  });

  void it("filtra la curva MEFF a productos BASE de Futuro", () => {
    assert.equal(toCurveProduct({ cod: "MJul-26", tipo: "Futuro", clase: "BASE", periodo: null, entrega: null, precio: 54 })?.price, 54);
    assert.equal(toCurveProduct({ cod: "MJul-26", tipo: "Opcion", clase: "BASE", periodo: null, entrega: null, precio: 54 }), null);
    assert.equal(toCurveProduct({ cod: "MJul-26", tipo: "Futuro", clase: "PEAK", periodo: null, entrega: null, precio: 54 }), null);
  });

  void it("selecciona la version mas moderna disponible C5 a C1", () => {
    const selected = get_latest_available_version(
      [
        { fecha: "2026-01-01", version: "C1", value: 1 },
        { fecha: "2026-01-01", version: "C4", value: 4 },
        { fecha: "2026-01-01", version: "C2", value: 2 }
      ],
      "2026-01-01"
    );
    assert.deepEqual(selected, { value: 4, version: "C4" });
  });

  void it("valida la tabla final", () => {
    const base = buildPricingCalendar("2026-12-31", true).map((row) => ({
      ...row,
      perfilIntermedio20TD: 1,
      perfilIntermedio30TD: 1,
      perfilIntermedio30TDVE: 1,
      productoPerfilOmie20TD: 50,
      productoPerfilOmie30TD: 50,
      productoPerfilOmie30TDVE: 50,
      productoPerfilCad20TD: 1,
      productoPerfilCad30TD: 1,
      productoPerfilCad30TDVE: 1,
      productoPerfilRad20TD: 1,
      productoPerfilRad30TD: 1,
      productoPerfilRad30TDVE: 1,
      productoPerfilPerdidas20TD: 1,
      productoPerfilPerdidas30TD: 1,
      productoPerfilPerdidas30TDVE: 1,
      periodo20TD: "P1",
      periodo30TD: "P2",
      periodo6XTD: "P3",
      precioOmie: 50,
      precioOmieUnidad: "EUR/MWh",
      cad: 1,
      cadVersion: "C5",
      cadStatus: "ok",
      rad: 1,
      radVersion: "C5",
      radStatus: "ok",
      perdidas: 1,
      perdidasVersion: "C5",
      perdidasStatus: "ok",
      perfil20TDStatus: "ok",
      perfil30TDStatus: "ok",
      perfil30TDVEStatus: "ok",
      omieStatus: "ok"
    }));
    assert.equal(validatePricingBaseTable(base).every((item) => item.status === "ok"), true);
  });
});

function row(fecha, diaSemana, hora, mes = 1) {
  return { fecha, diaSemana, hora, mes };
}

function profileRow(fecha, hour, tariff, intermediateProfile) {
  const [year, month, day] = fecha.split("-").map(Number);
  return { year, month, day, hour, tariff, intermediateProfile };
}

function round(value) {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}
