import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOmieEnergiaEvolucionResponse,
  buildOmieEnergiaPhfResponse,
  buildOmieEnergiaPvdResponse,
  normalizeOmieEnergiaSesion,
  parseOmieEnergiaSesionList
} from "./omie-energia";
import type { OmieConsultaEncolumnadaResult } from "./omie-siom2.types";

void describe("omie energia", () => {
  void it("normalizes PHF session values", () => {
    assert.equal(normalizeOmieEnergiaSesion("1"), "01");
    assert.equal(normalizeOmieEnergiaSesion("06"), "06");
    assert.deepEqual(parseOmieEnergiaSesionList("3, 1;02 2"), ["01", "02", "03"]);
  });

  void it("maps OMIE rows to quarter-hour energy periods", () => {
    const response = buildOmieEnergiaPvdResponse(
      "2026-04-15",
      result([
        { Periodo: "2", Energia: "1,5" },
        { Periodo: "1", Energia: "1.25" }
      ])
    );

    assert.deepEqual(response, {
      fecha: "2026-04-15",
      resolucion: "PT15M",
      periodos: [
        { periodo: 1, energia: 1.25 },
        { periodo: 2, energia: 1.5 }
      ]
    });
  });

  void it("builds PVD to PHF and PHF to PHF differences", () => {
    const pvd = buildOmieEnergiaPvdResponse(
      "2026-04-15",
      result([
        { Periodo: "1", Energia: "10" },
        { Periodo: "2", Energia: "20" }
      ])
    );
    const phf1 = buildOmieEnergiaPhfResponse(
      "2026-04-15",
      "1",
      result([
        { Periodo: "1", Energia: "15" },
        { Periodo: "2", Energia: "18" }
      ])
    );
    const phf2 = buildOmieEnergiaPhfResponse(
      "2026-04-15",
      "2",
      result([
        { Periodo: "1", Energia: "16" },
        { Periodo: "2", Energia: "18" }
      ])
    );

    const evolucion = buildOmieEnergiaEvolucionResponse("2026-04-15", pvd, [phf2, phf1]);

    assert.deepEqual(
      evolucion.diferencias.map((diferencia) => ({
        desde: diferencia.desde,
        hasta: diferencia.hasta,
        periodos: diferencia.periodos
      })),
      [
        {
          desde: "PVD",
          hasta: "01",
          periodos: [
            { periodo: 1, energiaDesde: 10, energiaHasta: 15, diferencia: 5 },
            { periodo: 2, energiaDesde: 20, energiaHasta: 18, diferencia: -2 }
          ]
        },
        {
          desde: "01",
          hasta: "02",
          periodos: [
            { periodo: 1, energiaDesde: 15, energiaHasta: 16, diferencia: 1 },
            { periodo: 2, energiaDesde: 18, energiaHasta: 18, diferencia: 0 }
          ]
        }
      ]
    );
    assert.deepEqual(evolucion.periodos[0], {
      periodo: 1,
      pvd: 10,
      sesiones: { "01": 15, "02": 16 },
      diferencias: { "PVD->01": 5, "01->02": 1 }
    });
  });
});

function result(filas: Array<Record<string, string>>): OmieConsultaEncolumnadaResult {
  return {
    statusCode: 200,
    serviceName: "ServicioEjecucionConsultaEncolumnada",
    xml: "",
    json: {},
    filas
  };
}
