import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OmieSoapBuilder, OmieSoapBuilderError, OMIE_BUSINESS_NAMESPACE, OMIE_SOAP11_NAMESPACE } from "./omie-soap-builder";

void describe("OmieSoapBuilder", () => {
  const builder = new OmieSoapBuilder();

  void it("builds a SOAP 1.1 envelope without XML payload", () => {
    const xml = builder.buildEnvelope("ServicioConsultaDatosUsuario");

    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(xml, new RegExp(`<soapenv:Envelope xmlns:soapenv="${escapeRegExp(OMIE_SOAP11_NAMESPACE)}">`));
    assert.match(xml, /<soapenv:Header\/>/);
    assert.match(xml, /<soapenv:Body>/);
    assert.match(xml, new RegExp(`<ServicioConsultaDatosUsuario xmlns="${escapeRegExp(OMIE_BUSINESS_NAMESPACE)}"></ServicioConsultaDatosUsuario>`));
    assert.match(xml, /<\/soapenv:Body>/);
    assert.match(xml, /<\/soapenv:Envelope>$/);
  });

  void it("builds a SOAP 1.1 envelope with XML payload inside the service node", () => {
    const xml = builder.buildEnvelope("ServicioConsultaDatosUsuario", "<IdUsuario>123</IdUsuario>");

    assert.match(xml, new RegExp(`<ServicioConsultaDatosUsuario xmlns="${escapeRegExp(OMIE_BUSINESS_NAMESPACE)}">`));
    assert.match(xml, /<IdUsuario>123<\/IdUsuario>/);
    assert.match(xml, /<\/ServicioConsultaDatosUsuario>/);
  });

  void it("does not escape the provided XML payload", () => {
    const payload = '<Filtro><Mercado codigo="ES"/></Filtro>';
    const xml = builder.buildEnvelope("ServicioConsultaDatosUsuario", payload);

    assert.match(xml, /<Filtro><Mercado codigo="ES"\/><\/Filtro>/);
  });

  void it("rejects service names that cannot be XML element names", () => {
    assert.throws(() => builder.buildEnvelope("Servicio Consulta Datos Usuario"), OmieSoapBuilderError);
    assert.throws(() => builder.buildEnvelope("1ServicioConsultaDatosUsuario"), OmieSoapBuilderError);
  });
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
