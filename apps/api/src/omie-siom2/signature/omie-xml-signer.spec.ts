import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "@xmldom/xmldom";
import type { Element as XmlElement, Node as XmlNode } from "@xmldom/xmldom";
import * as forge from "node-forge";
import { OmieSoapBuilder, OMIE_SOAP11_NAMESPACE } from "../soap/omie-soap-builder";
import {
  OMIE_SOAP_BODY_ID,
  OMIE_SOAP_SECURITY_NAMESPACE,
  OMIE_XMLDSIG_C14N,
  OMIE_XMLDSIG_NAMESPACE,
  OMIE_XMLDSIG_RSA_SHA1,
  OMIE_XMLDSIG_SHA1,
  OmieXmlSigner
} from "./omie-xml-signer";

void describe("OmieXmlSigner", () => {
  const passphrase = "test-passphrase";
  const p12Buffer = createTestPkcs12(passphrase);
  const soapBuilder = new OmieSoapBuilder();
  const signer = new OmieXmlSigner();

  void it("creates the OMIE SIOM2 XMLDSIG structure", async () => {
    const soapXml = soapBuilder.buildEnvelope("ServicioConsultaDatosUsuario", "<IdUsuario>123</IdUsuario>");

    const signedXml = await signer.signSoapEnvelope(soapXml, p12Buffer, passphrase);
    const doc = new DOMParser().parseFromString(signedXml, "text/xml");

    assert.match(signedXml, /\bSOAP-SEC:id="DS-OMEL"/);

    const body = requiredElement(doc.getElementsByTagNameNS(OMIE_SOAP11_NAMESPACE, "Body").item(0), "Expected soapenv:Body");
    assert.equal(body.getAttributeNS(OMIE_SOAP_SECURITY_NAMESPACE, "id"), OMIE_SOAP_BODY_ID);

    const soapSecuritySignature = requiredElement(
      doc.getElementsByTagNameNS(OMIE_SOAP_SECURITY_NAMESPACE, "Signature").item(0),
      "Expected SOAP-SEC Signature header"
    );
    assert.equal((soapSecuritySignature.parentNode as XmlElement | null)?.localName, "Header");

    assert.match(signedXml, /<ds:Signature(?:\s|>)/);
    const signature = requiredElement(doc.getElementsByTagNameNS(OMIE_XMLDSIG_NAMESPACE, "Signature").item(0), "Expected ds:Signature");

    const signedInfo = requiredElement(findFirst(signature, "SignedInfo", OMIE_XMLDSIG_NAMESPACE), "Expected ds:SignedInfo");
    assert.equal(
      requiredElement(findFirst(signedInfo, "CanonicalizationMethod", OMIE_XMLDSIG_NAMESPACE), "Expected ds:CanonicalizationMethod").getAttribute("Algorithm"),
      OMIE_XMLDSIG_C14N
    );
    assert.equal(
      requiredElement(findFirst(signedInfo, "SignatureMethod", OMIE_XMLDSIG_NAMESPACE), "Expected ds:SignatureMethod").getAttribute("Algorithm"),
      OMIE_XMLDSIG_RSA_SHA1
    );

    const reference = requiredElement(findFirst(signedInfo, "Reference", OMIE_XMLDSIG_NAMESPACE), "Expected ds:Reference");
    assert.equal(reference.getAttribute("URI"), `#${OMIE_SOAP_BODY_ID}`);
    assert.equal(
      requiredElement(findFirst(reference, "DigestMethod", OMIE_XMLDSIG_NAMESPACE), "Expected ds:DigestMethod").getAttribute("Algorithm"),
      OMIE_XMLDSIG_SHA1
    );
    assert.ok(requiredElement(findFirst(reference, "DigestValue", OMIE_XMLDSIG_NAMESPACE), "Expected ds:DigestValue").textContent?.trim());

    const signatureValue = requiredElement(findFirst(signature, "SignatureValue", OMIE_XMLDSIG_NAMESPACE), "Expected ds:SignatureValue");
    assert.ok(signatureValue.textContent?.trim());

    const keyInfo = requiredElement(findFirst(signature, "KeyInfo", OMIE_XMLDSIG_NAMESPACE), "Expected ds:KeyInfo");
    const x509Certificate = requiredElement(findFirst(keyInfo, "X509Certificate", OMIE_XMLDSIG_NAMESPACE), "Expected ds:X509Certificate");
    assert.ok(x509Certificate.textContent?.trim());
  });
});

function createTestPkcs12(passphrase: string) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date("2026-01-01T00:00:00.000Z");
  cert.validity.notAfter = new Date("2027-01-01T00:00:00.000Z");
  cert.setSubject([{ name: "commonName", value: "OMIE XMLDSIG Test" }]);
  cert.setIssuer([{ name: "commonName", value: "OMIE XMLDSIG Test" }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, passphrase, {
    algorithm: "3des",
    friendlyName: "omie-xml-signer-test",
    generateLocalKeyId: true
  });

  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), "binary");
}

function requiredElement(element: XmlElement | null | undefined, message: string) {
  assert.ok(element, message);
  return element;
}

function findFirst(node: XmlNode, localName: string, namespace: string): XmlElement | undefined {
  for (let i = 0; i < node.childNodes.length; i += 1) {
    const child = node.childNodes.item(i);
    if (!child) {
      continue;
    }
    if (isElementNode(child) && child.localName === localName && child.namespaceURI === namespace) {
      return child;
    }

    const match = findFirst(child, localName, namespace);
    if (match) {
      return match;
    }
  }

  return undefined;
}

function isElementNode(node: XmlNode): node is XmlElement {
  return node.nodeType === 1;
}
