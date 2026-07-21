import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOmieReerConsumFileName,
  buildOmieReerConsumUrl,
  parseOmieReerConsumText,
  parseOmieReerOfficialXml
} from "./omie-reer.parser";

void describe("OMIE REER public parser", () => {
  it("builds the dynamic public TXT URL from the date", () => {
    const fecha = new Date(Date.UTC(2026, 5, 8));

    assert.equal(buildOmieReerConsumFileName(fecha), "INT_REER_CONSUM_EV_H_08_06_2026_08_06_2026.TXT");
    assert.equal(
      buildOmieReerConsumUrl(fecha),
      "https://www.omie.es/sites/default/files/dados/AGNO_2026/MES_06/TXT/INT_REER_CONSUM_EV_H_08_06_2026_08_06_2026.TXT"
    );
  });

  it("parses semicolon TXT, comma decimals and quarter-hour periods", () => {
    const parsed = parseOmieReerConsumText(
      [
        "Fecha Emision: 09/06/2026 - 10:30",
        "Fecha;Periodo;Precio (EUR/MWh);Volumen economico (EUR);Energia (MWh)",
        "08/06/2026;H01Q1;0,01;-38,61;6299,23",
        "08/06/2026;H24Q4;0,00;0,00;100,00",
        "",
        "Total;;;;"
      ].join("\n")
    );

    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0].periodo, 1);
    assert.equal(parsed.rows[0].periodoEtiqueta, "H01Q1");
    assert.equal(parsed.rows[0].precioPublicadoEurMwh.toString(), "0.01");
    assert.equal(parsed.rows[0].volumenEconomicoEur.toString(), "-38.61");
    assert.equal(parsed.rows[0].energiaNacionalMwh.toString(), "6299.23");
    assert.equal(parsed.rows[0].coeficienteDerivadoEurMwh.toDecimalPlaces(12).toString(), "0.006129320568");
    assert.equal(parsed.rows[1].periodo, 96);
    assert.equal(parsed.rows[1].coeficienteDerivadoEurMwh.toString(), "0");
  });

  it("accepts old hourly labels", () => {
    const parsed = parseOmieReerConsumText(
      [
        "Fecha;Periodo;Precio (EUR/MWh);Volumen economico (EUR);Energia (MWh)",
        "15/04/2026;H01;0,01;-1,00;100,00"
      ].join("\n")
    );

    assert.equal(parsed.rows[0].periodo, 1);
  });

  it("accepts public header variants with hora and currency symbols", () => {
    const parsed = parseOmieReerConsumText(
      [
        "Dia;Hora;Precio EUR/MWh;Volumen Economico EUR;Energia MWh",
        "08/06/2026;H01Q1;0,01;-38,61;6299,23"
      ].join("\n")
    );

    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].periodo, 1);
    assert.equal(parsed.rows[0].coeficienteDerivadoEurMwh.toDecimalPlaces(12).toString(), "0.006129320568");
  });

  it("falls back to positional parsing when the public TXT has no detected header", () => {
    const parsed = parseOmieReerConsumText("08/06/2026;H01Q1;0,01;-38,61;6299,23");

    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].periodoEtiqueta, "H01Q1");
  });
});

void describe("OMIE REER official XML parser", () => {
  it("extracts only REER annotations from 9230 XML", () => {
    const rows = parseOmieReerOfficialXml(
      [
        '<Sesion fecha="2026-06-08">',
        "<Val>",
        '<Per v="1"/><Seg v="S.REER"/><Cta v="C.REER"/><CMag v="ECREER"/><CPrc v="EPREER"/><CCpto v="EOPREER"/><Ses v="777"/>',
        '<Ene v="-1,250"/><Prc v="0,006129320513"/><Imp v="0,01"/><SImp v="-1"/><SEne v="0"/>',
        "</Val>",
        "<Val>",
        '<Per v="1"/><CCpto v="EOTRO"/><Imp v="10"/>',
        "</Val>",
        "</Sesion>"
      ].join(""),
      "ANOTACIONES_LIQ_STROM_20260608.1.xml"
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].periodo, 1);
    assert.equal(rows[0].version, 1);
    assert.equal(rows[0].ecreerMwh.toString(), "-1.25");
    assert.equal(rows[0].epreerEurMwh.toString(), "0.006129320513");
    assert.equal(rows[0].eopreerEur.toString(), "0.01");
    assert.equal(rows[0].sImp, -1);
    assert.equal(rows[0].sEne, 0);
    assert.equal(rows[0].seg, "S.REER");
  });
});
