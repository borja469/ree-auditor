import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseReeSeieMetadata, parseReeSeieRecords } from "./ree-seie.parser";

void describe("SEIE settlement parsing", () => {
  for (const code of ["A1", "A2", "A5", "C1", "C5"] as const) {
    void it(`parses ${code} SEIE metadata from file name`, () => {
      const metadata = parseReeSeieMetadata(seieContent(), `${code}_SEIErega_20241031_18XENERGYSTROMXZ.csv`);
      assert.equal(metadata.version, code);
      assert.equal(metadata.settlementCode, code);
      assert.equal(metadata.settlementType, code[0]);
      assert.equal(metadata.settlementNumber, Number(code[1]));
    });
  }

  void it("uses official settlement metadata when provided", () => {
    const metadata = parseReeSeieMetadata(seieContent(), "SEIErega_20241031_18XENERGYSTROMXZ.csv", { settlementCode: "A2" });
    assert.equal(metadata.version, "A2");
    assert.equal(metadata.settlementType, "A");
    assert.equal(metadata.settlementNumber, 2);
  });

  void it("does not silently convert missing settlement to C1", () => {
    assert.throws(
      () => parseReeSeieMetadata(seieContent(), "SEIErega_20241031_18XENERGYSTROMXZ.csv"),
      /Liquidacion SEIE no identificable/
    );
  });

  void it("applies independent importe and magnitud signs to positional economic fields", () => {
    const content = [
      "SEIE;2024;10;31",
      [
        "20241031",
        "1",
        "UPR001",
        "1500",
        "",
        "12.5",
        "",
        "42.75",
        "",
        "BRP001",
        "IEAD",
        "VENTA",
        "18XUNIDAD",
        "SENTIDO",
        "1",
        "0",
        "18XSUJETO",
        "CPREC",
        "TIPO_PRECIO",
        "COD_APUNTE",
        "CLASE",
        "VALOR1",
        "VALOR2",
        "VALOR3"
      ].join(";")
    ].join("\n");
    const metadata = parseReeSeieMetadata(content, "A2_SEIErega_20241031_18XENERGYSTROMXZ.csv");
    const [result] = [...parseReeSeieRecords({ sourceFileName: "A2_SEIErega_20241031_18XENERGYSTROMXZ.csv", content, delimiter: ";", metadata })];

    assert.equal(result.error, undefined);
    assert.equal(result.record?.magnitud, "1500.000000");
    assert.equal(result.record?.precio, "12.500000");
    assert.equal(result.record?.energia, "-42.750000");
    assert.equal(result.record?.fields.campo15SignoImporte, "1");
    assert.equal(result.record?.fields.campo16SignoMagnitud, "0");
  });
});

function seieContent() {
  return "SEIE;2024;10;31\n";
}
