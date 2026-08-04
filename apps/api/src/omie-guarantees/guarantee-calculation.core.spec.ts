import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCurveMonths, toCurveProduct } from "../pricing-base/meff_forward_curve_service";
import { buildGuaranteeRows, calculateGuaranteeDateRange } from "./guarantee-calculation.core";
import { buildDailySwapPriceMap, OmieGuaranteesService, toDailySwapProduct } from "./omie-guarantees.service";
import type { MeffGuaranteePrice, OmieGuaranteeDayData } from "./types/guarantee-calculation.types";

void describe("calculateGuaranteeDateRange", () => {
  void it("usa el lunes anterior si la referencia es lunes", () => {
    assert.deepEqual(calculateGuaranteeDateRange("2026-06-29"), {
      referenceDate: "2026-06-29",
      startDate: "2026-06-22",
      endDate: "2026-07-01"
    });
  });

  void it("usa el lunes anterior si la referencia es martes", () => {
    assert.deepEqual(calculateGuaranteeDateRange("2026-06-30"), {
      referenceDate: "2026-06-30",
      startDate: "2026-06-22",
      endDate: "2026-07-01"
    });
  });

  void it("usa el lunes de la misma semana si la referencia es miercoles", () => {
    assert.equal(calculateGuaranteeDateRange("2026-07-15").startDate, "2026-07-13");
    assert.equal(calculateGuaranteeDateRange("2026-07-15").endDate, "2026-07-22");
  });

  void it("usa el lunes de la misma semana si la referencia es viernes", () => {
    assert.equal(calculateGuaranteeDateRange("2026-07-17").startDate, "2026-07-13");
  });

  void it("usa el lunes de la misma semana si la referencia es domingo", () => {
    assert.equal(calculateGuaranteeDateRange("2026-07-19").startDate, "2026-07-13");
  });

  void it("soporta cambio de mes", () => {
    assert.deepEqual(calculateGuaranteeDateRange("2026-08-03"), {
      referenceDate: "2026-08-03",
      startDate: "2026-07-27",
      endDate: "2026-08-05"
    });
  });

  void it("soporta cambio de ano", () => {
    assert.deepEqual(calculateGuaranteeDateRange("2027-01-01"), {
      referenceDate: "2027-01-01",
      startDate: "2026-12-28",
      endDate: "2027-01-06"
    });
  });
});

void describe("buildGuaranteeRows", () => {
  void it("suma MD + IDAS + XBID ya agregado y calcula precio medio ponderado por coste / volumen", () => {
    const response = buildGuaranteeRows({
      referenceDate: "2026-07-15",
      omieDays: days([
        { date: "2026-07-13", volume: 10, costWithoutTax: 500 }
      ]),
      meffPrices: meff([])
    });
    const row = response.rows[0];
    assert.equal(row.volume, 10);
    assert.equal(row.price, 50);
    assert.equal(row.invoicingAmount, 605);
    assert.equal(row.invoicingSource, "REAL");
  });

  void it("usa volumen real antes que sustitucion", () => {
    const row = buildGuaranteeRows({
      referenceDate: "2026-07-15",
      omieDays: days([
        { date: "2026-07-06", volume: 99, costWithoutTax: 990 },
        { date: "2026-07-13", volume: 10, costWithoutTax: 500 }
      ]),
      meffPrices: meff([])
    }).rows[0];
    assert.equal(row.volumeSource, "REAL");
    assert.equal(row.volume, 10);
  });

  void it("usa volumen de fecha menos siete dias sin sustitucion recursiva", () => {
    const row = buildGuaranteeRows({
      referenceDate: "2026-07-15",
      omieDays: days([
        { date: "2026-07-06", volume: 20, costWithoutTax: 1000 }
      ]),
      meffPrices: meff([{ date: "2026-07-13", price: 60, publicationDate: "2026-07-10", code: "Jul-26" }])
    }).rows[0];
    assert.equal(row.volumeSource, "PREVIOUS_WEEK");
    assert.equal(row.volumeSourceDate, "2026-07-06");
    assert.equal(row.volume, 20);
    assert.equal(row.invoicingSource, "ESTIMATED");
    assert.equal(row.invoicingAmount, 1452);
  });

  void it("usa el ultimo volumen disponible del mismo dia de la semana si no hay real ni semana anterior", () => {
    const row = buildGuaranteeRows({
      referenceDate: "2026-07-15",
      omieDays: days([
        { date: "2026-06-22", volume: 11, costWithoutTax: 550 },
        { date: "2026-06-29", volume: 22, costWithoutTax: 1100 },
        { date: "2026-07-01", volume: 99, costWithoutTax: 4950 },
        { date: "2026-07-06", volume: null, costWithoutTax: null }
      ]),
      meffPrices: meff([{ date: "2026-07-13", price: 60, publicationDate: "2026-07-10", code: "Jul-26" }])
    }).rows[0];
    assert.equal(row.volumeSource, "SAME_WEEKDAY");
    assert.equal(row.volumeSourceDate, "2026-06-29");
    assert.equal(row.volume, 22);
    assert.equal(row.invoicingSource, "ESTIMATED");
    assert.equal(row.invoicingAmount, 1597.2);
  });

  void it("marca ausencia de volumen real y sustitutivo", () => {
    const row = buildGuaranteeRows({
      referenceDate: "2026-07-15",
      omieDays: days([]),
      meffPrices: meff([{ date: "2026-07-13", price: 60, publicationDate: "2026-07-10", code: "Jul-26" }])
    }).rows[0];
    assert.equal(row.volumeSource, "MISSING");
    assert.equal(row.invoicingSource, "MISSING");
    assert.ok(row.warnings.some((warning) => warning.includes("Sin volumen")));
  });

  void it("usa precio OMIE real antes que MEFF", () => {
    const row = buildGuaranteeRows({
      referenceDate: "2026-07-15",
      omieDays: days([{ date: "2026-07-13", volume: 10, costWithoutTax: 500 }]),
      meffPrices: meff([{ date: "2026-07-13", price: 60, publicationDate: "2026-07-10", code: "Jul-26" }])
    }).rows[0];
    assert.equal(row.priceSource, "OMIE");
    assert.equal(row.price, 50);
  });

  void it("usa precio MEFF si no hay precio OMIE", () => {
    const row = buildGuaranteeRows({
      referenceDate: "2026-07-15",
      omieDays: days([{ date: "2026-07-13", volume: 10, costWithoutTax: null }]),
      meffPrices: meff([{ date: "2026-07-13", price: 61.25, publicationDate: "2026-07-14", code: "Jul-26" }])
    }).rows[0];
    assert.equal(row.priceSource, "MEFF");
    assert.equal(row.pricePublicationDate, "2026-07-14");
    assert.equal(row.meffCode, "Jul-26");
    assert.equal(row.invoicingSource, "ESTIMATED");
  });

  void it("mantiene acumulado anterior si una fila no tiene importe calculable", () => {
    const response = buildGuaranteeRows({
      referenceDate: "2026-07-15",
      omieDays: days([{ date: "2026-07-13", volume: 10, costWithoutTax: 100 }]),
      meffPrices: meff([])
    });
    assert.equal(response.rows[0].accumulatedInvoicing, 121);
    assert.equal(response.rows[1].invoicingSource, "MISSING");
    assert.equal(response.rows[1].accumulatedInvoicing, 121);
  });

  void it("calcula garantia disponible con depositadas menos facturacion acumulada de la matriz", () => {
    const response = buildGuaranteeRows({
      referenceDate: "2026-07-15",
      omieDays: days([
        { date: "2026-07-13", volume: 10, costWithoutTax: 100 },
        { date: "2026-07-14", volume: 10, costWithoutTax: 200 }
      ]),
      meffPrices: meff([]),
      depositedGuarantees: new Map([
        ["2026-07-13", 150],
        ["2026-07-14", 300]
      ])
    });
    assert.equal(response.rows[0].availableGuarantee, 29);
    assert.equal(response.rows[1].availableGuarantee, -63);
  });

  void it("resta pagos anticipados acumulados a la facturacion acumulada para la garantia disponible", () => {
    const response = buildGuaranteeRows({
      referenceDate: "2026-07-15",
      omieDays: days([
        { date: "2026-07-13", volume: 10, costWithoutTax: 100 },
        { date: "2026-07-14", volume: 10, costWithoutTax: 200 }
      ]),
      meffPrices: meff([]),
      depositedGuarantees: new Map([
        ["2026-07-13", 150],
        ["2026-07-14", 300]
      ]),
      prepaidPayments: new Map([["2026-07-13", 50]])
    });
    assert.equal(response.rows[0].prepaidPayment, 50);
    assert.equal(response.rows[0].availableGuarantee, 79);
    assert.equal(response.rows[1].availableGuarantee, -13);
  });
});

void describe("MEFF helpers", () => {
  void it("selecciona producto mensual BASE Futuro para el mes de entrega", () => {
    const product = toCurveProduct({
      cod: "M Jul-26",
      tipo: "Futuro",
      clase: "Base",
      periodo: "Mensual",
      entrega: "Jul-26",
      precio: 72.35
    });
    const [month] = buildCurveMonths([{ year: 2026, month: 7 }], product ? [product] : []);
    assert.equal(month.price, 72.35);
    assert.equal(month.sourceProductCode, "M Jul-26");
  });

  void it("reconstruye mes desde producto trimestral cuando no hay mensual", () => {
    const product = toCurveProduct({
      cod: "Q3-26",
      tipo: "Futuro",
      clase: "Base",
      periodo: "Trimestral",
      entrega: "Q3-26",
      precio: 70
    });
    const [month] = buildCurveMonths([{ year: 2026, month: 7 }], product ? [product] : []);
    assert.equal(month.price, 70);
    assert.equal(month.origin, "Trimestral");
  });

  void it("mantiene el precio MEFF como precio unitario sin aplicar multiplicador", () => {
    const product = toCurveProduct({
      cod: "FMBCMJUL26",
      tipo: "Futuro",
      clase: "Base",
      periodo: "Mensual",
      entrega: "jul-26",
      precio: 91.43
    });
    assert.equal(product?.price, 91.43);
  });

  void it("selecciona swap diario BASE para garantias", () => {
    const product = toDailySwapProduct({
      cod: "D 15/07/2026",
      tipo: "Swap",
      clase: "Base",
      periodo: "Diario",
      entrega: "15/07/2026",
      precio: 63.4
    });
    assert.deepEqual(product, { date: "2026-07-15", code: "D 15/07/2026", price: 63.4 });
  });

  void it("lee entregas diarias MEFF con formato 29-jun-26", () => {
    const product = toDailySwapProduct({
      cod: "SMBCD29JUN26",
      tipo: "Base",
      clase: "Swap",
      periodo: "Diario",
      entrega: "29-jun-26",
      precio: 76.49
    });
    assert.deepEqual(product, { date: "2026-06-29", code: "SMBCD29JUN26", price: 76.49 });
  });

  void it("ignora futuros mensuales en garantias aunque exista precio", () => {
    const prices = buildDailySwapPriceMap(
      ["2026-07-15"],
      [
        {
          fechaPublicacion: new Date(Date.UTC(2026, 5, 24)),
          cod: "M Jul-26",
          tipo: "Futuro",
          clase: "Base",
          periodo: "Mensual",
          entrega: "Jul-26",
          precio: 72.35
        }
      ]
    );
    assert.deepEqual(prices.get("2026-07-15"), { price: null, publicationDate: null, code: null });
  });

  void it("elige la publicacion mas reciente disponible para cada swap diario", () => {
    const prices = buildDailySwapPriceMap(
      ["2026-06-29"],
      [
        {
          fechaPublicacion: new Date(Date.UTC(2026, 5, 25)),
          cod: "SMBCD29JUN26",
          tipo: "Base",
          clase: "Swap",
          periodo: "Diario",
          entrega: "29-jun-26",
          precio: 76.15
        },
        {
          fechaPublicacion: new Date(Date.UTC(2026, 5, 24)),
          cod: "SMBCD29JUN26",
          tipo: "Base",
          clase: "Swap",
          periodo: "Diario",
          entrega: "29-jun-26",
          precio: 76.49
        }
      ]
    );
    assert.deepEqual(prices.get("2026-06-29"), { price: 76.15, publicationDate: "2026-06-25", code: "SMBCD29JUN26" });
  });

  void it("usa siempre BASE y descarta PUNTA aunque punta sea la publicacion mas reciente", () => {
    const prices = buildDailySwapPriceMap(
      ["2026-06-29"],
      [
        {
          fechaPublicacion: new Date(Date.UTC(2026, 5, 29)),
          cod: "SMPCD29JUN26",
          tipo: "Punta",
          clase: "Swap",
          periodo: "Diario",
          entrega: "29-jun-26",
          precio: 48.85
        },
        {
          fechaPublicacion: new Date(Date.UTC(2026, 5, 29)),
          cod: "SMBCD29JUN26",
          tipo: "Base",
          clase: "Swap",
          periodo: "Diario",
          entrega: "29-jun-26",
          precio: 83.51
        },
        {
          fechaPublicacion: new Date(Date.UTC(2026, 5, 24)),
          cod: "SMBCD29JUN26",
          tipo: "Base",
          clase: "Swap",
          periodo: "Diario",
          entrega: "29-jun-26",
          precio: 76.49
        }
      ]
    );
    assert.deepEqual(prices.get("2026-06-29"), { price: 83.51, publicationDate: "2026-06-29", code: "SMBCD29JUN26" });
  });
});

void describe("OmieGuaranteesService", () => {
  void it("usa base imponible sin IVA como coste OMIE real para garantias", async () => {
    const service = new OmieGuaranteesService({} as never, {
      obtenerComprobacionLiquidaciones: async () => ({
        detalleDiario: [
          {
            fechaIso: "2026-08-03",
            energiaMd: 79.15,
            energiaIda1: 62.45,
            energiaIda2: 12.725,
            energiaIda3: 5.1,
            energiaXbid: null,
            netoFactura: 27418.47,
            netoBaseImponible: 22659.89
          }
        ]
      })
    } as never);

    const days = await (service as unknown as { loadOmieDays: (start: Date, end: Date) => Promise<Map<string, OmieGuaranteeDayData>> }).loadOmieDays(
      new Date(Date.UTC(2026, 7, 3)),
      new Date(Date.UTC(2026, 7, 3))
    );

    assert.deepEqual(days.get("2026-08-03"), {
      date: "2026-08-03",
      volume: 159.425,
      costWithoutTax: 22659.89
    });
  });
});

function days(rows: OmieGuaranteeDayData[]) {
  return new Map(rows.map((row) => [row.date, row]));
}

function meff(rows: Array<{ date: string } & MeffGuaranteePrice>) {
  return new Map(rows.map((row) => [row.date, { price: row.price, publicationDate: row.publicationDate, code: row.code }]));
}
