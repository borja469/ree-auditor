import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildXbidTransactionMap, OmieAnalisisService, type TransactionMapRow } from "./omie-analisis.service";
import { buildXbidTransactionMap as buildAnnualXbidMap } from "../annual-report/annual-report.service";
import { buildPortfolioXbidTransactionMap } from "../mir/portfolio-forecast.service";

void describe("omie analisis mensual", () => {
  void it("separa cuatro cuartos STRRE01 y los liquida como venta sin alterar STROC01", async () => {
    const date = new Date("2026-10-16T00:00:00.000Z");
    const prisma = {
      omiePrice: { findMany: async () => [1, 2, 3, 4].map((periodo) => ({ tipoPrecio: "MD", fechaPrograma: date, sesion: null, periodo, precioEurMWh: { toString: () => "50" } })) },
      omiePrograma: { findMany: async () => [
        ...[1, 2, 3, 4].map((periodo) => ({ tipoPrograma: "PVD", uOfertante: "STRRE01", fechaPrograma: date, sesion: null, periodo, energiaMWh: { toString: () => "1" } })),
        { tipoPrograma: "PVD", uOfertante: "STROC01", fechaPrograma: date, sesion: null, periodo: 1, energiaMWh: { toString: () => "2" } }
      ] },
      omieDownload: { findMany: async () => [] },
      omieTransactionStaging: { findMany: async () => [] },
      omieLiquidationInvoice: { findMany: async () => [] },
      omieReerOfficialAnnotation: { findMany: async () => [] }
    };
    const service = new OmieAnalisisService(prisma as never);
    const analysis = await service.obtenerAnalisisMensual(2026, 10);
    const rows = analysis.periodos.filter((row) => row.clave.startsWith("20261016") && row.programaVentaMd !== null);
    assert.deepEqual(rows.map((row) => row.periodo), [1, 2, 3, 4]);
    assert.deepEqual(rows.map((row) => row.programaVentaMd), [1, 1, 1, 1]);
    assert.equal(rows[0].programaMd, 2);
    assert.equal(rows[1].programaMd, null);
    const liquidation = await service.obtenerComprobacionLiquidaciones(2026, 10);
    const day = liquidation.detalleDiario.find((row) => row.fechaIso === "2026-10-16");
    assert.equal(day?.ventaMercados, 200);
    assert.equal(day?.resultadoStrre01MdEur, 200);
    assert.equal(day?.reer.periodos.find((item) => item.periodo === 1)?.energiaNetaAgente, 2);
    assert.equal(day?.compraMercados, 100);
    const negativeService = new OmieAnalisisService({
      ...prisma,
      omiePrice: { findMany: async () => [1, 2, 3, 4].map((periodo) => ({ tipoPrecio: "MD", fechaPrograma: date, sesion: null, periodo, precioEurMWh: { toString: () => "-10" } })) },
      omiePrograma: { findMany: async () => [1, 2, 3, 4].map((periodo) => ({ tipoPrograma: "PVD", uOfertante: "STRRE01", fechaPrograma: date, sesion: null, periodo, energiaMWh: { toString: () => "1" } })) }
    } as never);
    const negativeDay = (await negativeService.obtenerComprobacionLiquidaciones(2026, 10)).detalleDiario.find((row) => row.fechaIso === "2026-10-16");
    assert.equal(negativeDay?.resultadoStrre01MdEur, -40);
    assert.equal(negativeDay?.compraMercados, 40);
  });

  void it("excluye XBID de STRRE01 del cálculo de compra STROC01", () => {
    const row = transaction({ idtrans: "sale", qty: "1" });
    (row.rawPayloadJson as Record<string, unknown>).unit = "STRRE01";
    assert.equal(buildXbidTransactionMap([row]).size, 0);
    assert.equal(buildXbidTransactionMap([row], "STRRE01").get("2026-04-01|49|XBID")?.volXbid, 0.25);
  });

  void it("aggregates XBID transactions as signed quarter-hour energy", () => {
    const map = buildXbidTransactionMap([
      transaction({ idtrans: "1140278460", qty: "0.2" }),
      transaction({ idtrans: "1140278461", qty: "1.4" })
    ]);

    const value = map.get("2026-04-01|49|XBID");
    assert.deepEqual(value, {
      precioXbid: -0.2,
      volXbid: 0.4,
      pciIda3Xbid: 0.4,
      volBrutoMWh: 0.4,
      importeEur: -0.08,
      compraEur: 0,
      ventaEur: 0.08,
      operacionesMixtas: false
    });
    assert.equal(roundPrice(-2.1 - value!.precioXbid!), -1.9);
    assert.equal(roundPrice(value!.volXbid! * (-2.1 - value!.precioXbid!)), -0.76);
  });

  void it("liquida compras y ventas XBID mixtas aunque la energía neta sea cero, para ambas unidades", async () => {
    const date = new Date("2026-04-01T00:00:00.000Z");
    const trades = [
      makeTrade("STROC01", "buy", "Bid", 50),
      makeTrade("STROC01", "sell", "Ask", 60),
      makeTrade("STRRE01", "buy", "Bid", 70),
      makeTrade("STRRE01", "sell", "Ask", 90)
    ];
    const prisma = {
      omiePrice: { findMany: async () => [{ tipoPrecio: "MD", fechaPrograma: date, sesion: null, periodo: 49, precioEurMWh: { toString: () => "100" } }] },
      omiePrograma: { findMany: async () => [] },
      omieDownload: { findMany: async () => [] },
      omieTransactionStaging: { findMany: async () => trades },
      omieLiquidationInvoice: { findMany: async () => [] },
      omieReerOfficialAnnotation: { findMany: async () => [] }
    };
    const service = new OmieAnalisisService(prisma as never);
    const row = (await service.obtenerAnalisisMensual(2026, 4)).periodos.find((item) => item.clave === "2026040149");
    assert.ok(row);
    assert.equal(row.volXbid, 0);
    assert.equal(row.xbidDetalle?.compraEur, 50);
    assert.equal(row.xbidDetalle?.ventaEur, 60);
    assert.equal(row.xbidDetalle?.importeEur, -10);
    assert.equal(row.xbidDetalle?.operacionesMixtas, true);
    assert.equal(row.profitXbid, 10);
    assert.equal(row.profitXbidEurMWh, null);
    assert.equal(row.xbidVentaDetalle?.importeEur, -20);
    assert.equal(row.xbidVentaDetalle?.compraEur, 70);
    assert.equal(row.xbidVentaDetalle?.ventaEur, 90);
    const day = (await service.obtenerComprobacionLiquidaciones(2026, 4)).detalleDiario.find((item) => item.fechaIso === "2026-04-01");
    assert.equal(day?.energiaXbid, 0);
    assert.equal(day?.costeXbid, -30);
    assert.equal(day?.compraMercados, 120);
    assert.equal(day?.ventaMercados, 150);
    assert.equal(day?.horas.find((hour) => hour.hora === 13)?.costeXbid, -30);
  });

  void it("informe anual y cartera conservan el importe real y excluyen STRRE01 de STROC01", () => {
    const rows = [
      makeTrade("STROC01", "buy", "Bid", 50),
      makeTrade("STROC01", "sell", "Ask", 60),
      makeTrade("STRRE01", "seller", "Ask", 90)
    ];
    const annual = buildAnnualXbidMap(rows).get("2026-04-01|49|XBID");
    const portfolio = buildPortfolioXbidTransactionMap(rows).get("2026-04-01|49|XBID");
    assert.equal(annual?.volXbid, 0);
    assert.equal(annual?.importeEur, -10);
    assert.equal(portfolio?.volXbid, 0);
    assert.equal(portfolio?.importeEur, -10);
  });

  void it("respeta el signo económico con precios negativos y evita duplicados", () => {
    const rows = [
      makeTrade("STROC01", "negative-buy", "Bid", -20),
      makeTrade("STROC01", "negative-sell", "Ask", -30)
    ];
    const value = buildXbidTransactionMap([...rows, rows[0]]).get("2026-04-01|49|XBID");
    assert.equal(value?.volXbid, 0);
    assert.equal(value?.importeEur, 10);
    assert.equal(value?.compraEur, 30);
    assert.equal(value?.ventaEur, 20);
  });
});

function makeTrade(unit: string, idtrans: string, tipTrans: "Bid" | "Ask", prc: number): TransactionMapRow {
  return {
    diaContrato: new Date("2026-04-01T00:00:00.000Z"),
    rawPayloadJson: { unit, agent: "STROM", idtrans, tipTrans, prc: String(prc), qty: "4", periodo: "49", fentrega: "2026-04-01" }
  };
}

function transaction(overrides: { idtrans: string; qty: string }): TransactionMapRow {
  return {
    diaContrato: new Date(Date.UTC(2026, 3, 1)),
    rawPayloadJson: {
      prc: "-0.20",
      qty: overrides.qty,
      unit: "STROC01",
      agent: "STROM",
      idtrans: overrides.idtrans,
      periodo: "49",
      fentrega: "2026-04-01",
      tipTrans: "Bid"
    }
  };
}

function roundPrice(value: number) {
  return Number(value.toFixed(6));
}
