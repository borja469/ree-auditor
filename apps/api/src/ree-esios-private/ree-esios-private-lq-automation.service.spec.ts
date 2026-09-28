import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { compactRunResults, summarizeCompactResults } from "./ree-esios-private-lq-automation.service";

void describe("ServicioLQ automation compact history", () => {
  void it("keeps all settlements from the first automation run", () => {
    const results = compactRunResults([syncResult(["A1", "C1", "A2"], "IMPORTED")]);
    assert.deepEqual(results.map((item) => item.settlementCode), ["A1", "C1", "A2"]);
    assert.equal(summarizeCompactResults(results).importedFiles, 3);
  });

  void it("reports idempotent second run as skipped, not imported", () => {
    const results = compactRunResults([syncResult(["A1", "C1", "A2"], "SKIPPED")]);
    const summary = summarizeCompactResults(results);
    assert.equal(summary.importedFiles, 0);
    assert.equal(summary.skippedFiles, 3);
    assert.equal(summary.failedItems, 0);
  });

  void it("shows only the new C2 as imported when it appears later", () => {
    const results = compactRunResults([{
      results: [
        ...messages(["A1", "C1", "A2"], "SKIPPED"),
        ...messages(["C2"], "IMPORTED")
      ]
    }]);
    const summary = summarizeCompactResults(results);
    assert.equal(summary.importedFiles, 1);
    assert.equal(summary.skippedFiles, 3);
    assert.deepEqual(results.filter((item) => item.importedFiles > 0).map((item) => item.settlementCode), ["C2"]);
  });
});

function syncResult(settlements: string[], status: "IMPORTED" | "SKIPPED") {
  return { results: messages(settlements, status) };
}

function messages(settlements: string[], status: "IMPORTED" | "SKIPPED") {
  return settlements.map((settlement) => ({
    family: "liqui-empresa",
    settlementCode: settlement,
    settlementType: settlement.startsWith("A") ? "A" : "C",
    settlementNumber: Number(settlement.slice(1, 2)),
    settlementLabel: settlement.startsWith("A") ? "Avance" : "Cierre",
    month: "2024-10",
    requestedPublicationDate: "2024-11-01",
    selectedMessage: {
      messageId: `${settlement}_liquidacion_STROM_202410.1.zip`,
      code: `code-${settlement}`,
      messageDate: "2024-11-01T06:00:00Z"
    },
    downloaded: { totalFiles: 1 },
    selectedFiles: [{ status }]
  }));
}
