import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildXbidTransactionMap, type TransactionMapRow } from "./omie-analisis.service";

void describe("omie analisis mensual", () => {
  void it("aggregates XBID transactions as signed quarter-hour energy", () => {
    const map = buildXbidTransactionMap([
      transaction({ idtrans: "1140278460", qty: "0.2" }),
      transaction({ idtrans: "1140278461", qty: "1.4" })
    ]);

    const value = map.get("2026-04-01|49|XBID");
    assert.deepEqual(value, {
      precioXbid: -0.2,
      volXbid: 0.4,
      pciIda3Xbid: 0.4
    });
    assert.equal(roundPrice(-2.1 - value!.precioXbid!), -1.9);
    assert.equal(roundPrice(value!.volXbid! * (-2.1 - value!.precioXbid!)), -0.76);
  });
});

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
