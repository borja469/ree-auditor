import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  buildSettlementCode,
  compareSettlements,
  parseSettlementCode,
  settlementRank,
  SETTLEMENT_CODES
} from "./settlements";

void describe("settlement identity utility", () => {
  void it("parses valid settlement codes", () => {
    assert.deepEqual(parseSettlementCode("A1"), {
      settlementType: "A",
      settlementNumber: 1,
      settlementCode: "A1"
    });
    assert.deepEqual(parseSettlementCode("C1"), {
      settlementType: "C",
      settlementNumber: 1,
      settlementCode: "C1"
    });
    assert.deepEqual(parseSettlementCode("A5"), {
      settlementType: "A",
      settlementNumber: 5,
      settlementCode: "A5"
    });
    assert.deepEqual(parseSettlementCode("c5"), {
      settlementType: "C",
      settlementNumber: 5,
      settlementCode: "C5"
    });
  });

  void it("rejects invalid settlement codes", () => {
    for (const value of ["A0", "A6", "C0", "C6", "texto"]) {
      assert.throws(() => parseSettlementCode(value), /Codigo de liquidacion no valido/);
    }
  });

  void it("builds and ranks settlement codes in official order", () => {
    assert.equal(buildSettlementCode("A", 2), "A2");
    assert.deepEqual([...SETTLEMENT_CODES].sort(compareSettlements), [
      "A1",
      "C1",
      "A2",
      "C2",
      "A3",
      "C3",
      "A4",
      "C4",
      "A5",
      "C5"
    ]);
    assert.equal(settlementRank("A1"), 0);
    assert.equal(settlementRank("C1"), 1);
    assert.equal(settlementRank("A5"), 8);
    assert.equal(settlementRank("C5"), 9);
  });
});
