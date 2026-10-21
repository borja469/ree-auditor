import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAutomationDownloadDates, buildDailyBulkTasks } from "./omie-descargas.service";

void describe("omie descargas automatizacion", () => {
  void it("incluye PVD y PHF de compra y venta una sola vez por unidad, con precios compartidos", () => {
    const tasks = buildDailyBulkTasks("2026-10-16");
    const programs = tasks.filter((item) => item.modulo === "Programas");
    assert.equal(programs.length, 16);
    for (const unit of ["STROC01", "STRRE01"]) {
      const own = programs.filter((item) => item.uOfertante === unit);
      assert.equal(own.length, 8);
      assert.deepEqual(own.map((item) => item.sesion), [null, "01", "02", "03", "04", "05", "06", "07"]);
      assert.ok(own.every((item) => item.request.uOfertante === unit));
    }
    assert.equal(tasks.filter((item) => item.codigoOmie === "5202").length, 1);
  });

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
