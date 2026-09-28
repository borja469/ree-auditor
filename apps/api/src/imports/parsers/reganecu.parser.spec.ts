import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { detectDelimiter, parseA1ReganecuRecords, parseReeFileMetadata, type ReeFileMetadata } from "./reganecu.parser";

const CONTENT = [
  "fecha;hora;codigo_upr;energia_mwh;reservado1;precio_eur_mwh;reservado2;importe_eur;reservado3;codigo_agente_vendedor;segmento;facturacion;eic_upr;cuenta;signo_importe;signo_magnitud;eic_titular;codigo_magnitud;codigo_precio;codigo_apunte;tipo_oferta;tipo_upr;energia_contrato_bilateral_mwh;sesion",
  "20241031;1;UP_TEST;10;;50;;500;;18XBRPTEST;S1;A1;18XUPTEST;CTA;+;+;18XTITULAR;MAG;P_TEST;A_TEST;O;GEN;0;S1"
].join("\n");

void describe("REGANECU settlement parsing", () => {
  for (const code of ["A1", "A2", "A5", "C1", "C5"] as const) {
    void it(`parses ${code} REGANECU metadata`, () => {
      const metadata = parseReeFileMetadata(`${code}_reganecu_20241031_18XENERGYSTROMXZ.csv`);
      assert.equal(metadata.version, code);
      assert.equal(metadata.settlementCode, code);
      assert.equal(metadata.settlementType, code[0]);
      assert.equal(metadata.settlementNumber, Number(code[1]));
    });
  }

  void it("allows A1 and C1 for the same date without collapsing identity", () => {
    const a1 = parseReeFileMetadata("A1_reganecu_20241031_18XENERGYSTROMXZ.csv");
    const c1 = parseReeFileMetadata("C1_reganecu_20241031_18XENERGYSTROMXZ.csv");
    const a1Record = firstRecord(a1);
    const c1Record = firstRecord(c1);
    assert.notEqual(a1Record.recordHash, c1Record.recordHash);
  });

  void it("allows C1 and A2 for the same date without collapsing identity", () => {
    const c1 = parseReeFileMetadata("C1_reganecu_20241031_18XENERGYSTROMXZ.csv");
    const a2 = parseReeFileMetadata("A2_reganecu_20241031_18XENERGYSTROMXZ.csv");
    assert.notEqual(firstRecord(c1).recordHash, firstRecord(a2).recordHash);
  });

  void it("is idempotent for the same A1 record hash", () => {
    const metadata = parseReeFileMetadata("A1_reganecu_20241031_18XENERGYSTROMXZ.csv");
    assert.equal(firstRecord(metadata).recordHash, firstRecord(metadata).recordHash);
  });

  void it("is idempotent for the same C1 record hash", () => {
    const metadata = parseReeFileMetadata("C1_reganecu_20241031_18XENERGYSTROMXZ.csv");
    assert.equal(firstRecord(metadata).recordHash, firstRecord(metadata).recordHash);
  });
});

function firstRecord(metadata: ReeFileMetadata) {
  const delimiter = detectDelimiter(CONTENT);
  const result = [...parseA1ReganecuRecords({ sourceFileName: "test.csv", content: CONTENT, delimiter, metadata })].find((item) => item.record);
  assert.ok(result?.record);
  return result.record;
}
