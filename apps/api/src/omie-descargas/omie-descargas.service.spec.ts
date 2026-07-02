import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAutomationDownloadDates } from "./omie-descargas.service";

void describe("omie descargas automatizacion", () => {
  void it("incluye manana mas los dias hacia atras configurados", () => {
    const referenceDate = new Date("2026-07-01T10:00:00.000Z");

    assert.deepEqual(buildAutomationDownloadDates(3, referenceDate), [
      "2026-07-02",
      "2026-07-01",
      "2026-06-30",
      "2026-06-29"
    ]);
  });
});
