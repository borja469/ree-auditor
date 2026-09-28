import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseLqMessage } from "./ree-esios-private-lq.service";
import { SETTLEMENT_CODES } from "../common/settlements";
import type { ReeEsiosMessageMetadata } from "./types/ree-esios-private.types";

void describe("ServicioLQ settlement parsing", () => {
  for (const code of ["A1", "A2", "A5", "C1", "C5"] as const) {
    void it(`recognizes ${code} liqui-empresa`, () => {
      const parsed = parseLqMessage(message(`${code}_liquidacion_STROM_202410.1.zip`), "STROM");
      assert.equal(parsed?.settlement, code);
      assert.equal(parsed?.family, "liqui-empresa");
      assert.equal(parsed?.owner, "STROM");
      assert.equal(parsed?.month, "2024-10");
      assert.equal(parsed?.fileVersion, 1);
    });
  }

  for (const code of ["A1", "A2", "A5", "C1", "C5"] as const) {
    void it(`recognizes ${code} liquicomun`, () => {
      const parsed = parseLqMessage(message(`${code}_liquicomun_202410.1.zip`), "STROM");
      assert.equal(parsed?.settlement, code);
      assert.equal(parsed?.family, "liquicomun");
      assert.equal(parsed?.owner, null);
      assert.equal(parsed?.month, "2024-10");
      assert.equal(parsed?.fileVersion, 1);
    });
  }

  void it("does not discard liqui-empresa advances", () => {
    assert.equal(parseLqMessage(message("A2_liquidacion_STROM_202410.3.zip"), "STROM")?.settlement, "A2");
  });

  void it("keeps owner filtering for liqui-empresa", () => {
    assert.equal(parseLqMessage(message("A2_liquidacion_OTHER_202410.3.zip"), "STROM"), null);
  });

  void it("uses the official A1-C5 settlement order", () => {
    assert.deepEqual(SETTLEMENT_CODES, ["A1", "C1", "A2", "C2", "A3", "C3", "A4", "C4", "A5", "C5"]);
  });

  void it("allows A1 and C1 for the same month", () => {
    const advance = parseLqMessage(message("A1_liquidacion_STROM_202410.1.zip"), "STROM");
    const close = parseLqMessage(message("C1_liquidacion_STROM_202410.1.zip"), "STROM");
    assert.equal(advance?.month, close?.month);
    assert.notEqual(advance?.settlement, close?.settlement);
  });

  void it("allows A2 and C2 for the same month", () => {
    const advance = parseLqMessage(message("A2_liquidacion_STROM_202410.1.zip"), "STROM");
    const close = parseLqMessage(message("C2_liquidacion_STROM_202410.1.zip"), "STROM");
    assert.equal(advance?.month, close?.month);
    assert.notEqual(advance?.settlement, close?.settlement);
  });
});

function message(messageId: string): ReeEsiosMessageMetadata {
  return {
    code: `code-${messageId}`,
    messageId,
    version: null,
    status: "OK",
    messageType: null,
    owner: "REE",
    applicationStart: null,
    applicationEnd: null,
    messageDate: "2024-11-01T06:00:00Z",
    applicationDate: null,
    filename: messageId
  };
}
