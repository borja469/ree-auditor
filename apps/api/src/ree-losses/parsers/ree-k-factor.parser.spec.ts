import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { ReeKFactorFileType } from "@prisma/client";
import { parseKFactorFileMetadata } from "./ree-k-factor.parser";
import { compareSettlements, SETTLEMENT_CODES } from "../../common/settlements";

void describe("REE K factor settlement parsing", () => {
  for (const code of ["A1", "C1", "A2", "C2", "A5", "C5"] as const) {
    void it(`parses ${code}`, () => {
      const metadata = parseKFactorFileMetadata(`${code}_Kestimqh_20241001_20241031`, "");
      assert.equal(metadata.version, code);
      assert.equal(metadata.settlementCode, code);
      assert.equal(metadata.settlementType, code[0]);
      assert.equal(metadata.settlementNumber, Number(code[1]));
      assert.equal(metadata.tipoArchivo, ReeKFactorFileType.KESTIMQH);
      assert.equal(metadata.fechaInicio.toISOString().slice(0, 10), "2024-10-01");
      assert.equal(metadata.fechaFin.toISOString().slice(0, 10), "2024-10-31");
    });
  }

  void it("parses metadata when file name is not informative", () => {
    const metadata = parseKFactorFileMetadata("k-factor.csv", "liquidacion=A2 tipo=Krealqh desde=20241001 hasta=20241031");
    assert.equal(metadata.version, "A2");
    assert.equal(metadata.settlementType, "A");
    assert.equal(metadata.settlementNumber, 2);
    assert.equal(metadata.tipoArchivo, ReeKFactorFileType.KREALQH);
  });

  void it("uses official settlement order", () => {
    assert.deepEqual([...SETTLEMENT_CODES].sort(compareSettlements), ["A1", "C1", "A2", "C2", "A3", "C3", "A4", "C4", "A5", "C5"]);
  });
});
