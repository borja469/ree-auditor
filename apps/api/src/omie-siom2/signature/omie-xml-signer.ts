import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Document as XmlDocument, Element as XmlElement, Node as XmlNode } from "@xmldom/xmldom";
import * as forge from "node-forge";
import { SignedXml } from "xml-crypto";
import { OMIE_SOAP11_NAMESPACE } from "../soap/omie-soap-builder";

export const OMIE_SOAP_SECURITY_NAMESPACE = "http://schemas.xmlsoap.org/soap/security/2000-12";
export const OMIE_XMLDSIG_NAMESPACE = "http://www.w3.org/2000/09/xmldsig#";
export const OMIE_XMLDSIG_RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
export const OMIE_XMLDSIG_SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1";
export const OMIE_XMLDSIG_C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
export const OMIE_SOAP_BODY_ID = "DS-OMEL";

const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";
const SOAP_BODY_XPATH = `/*[local-name(.)='Envelope' and namespace-uri(.)='${OMIE_SOAP11_NAMESPACE}']/*[local-name(.)='Body' and namespace-uri(.)='${OMIE_SOAP11_NAMESPACE}']`;
const SOAP_SECURITY_SIGNATURE_XPATH = `${SOAP_BODY_XPATH}/../*[local-name(.)='Header' and namespace-uri(.)='${OMIE_SOAP11_NAMESPACE}']/*[local-name(.)='Signature' and namespace-uri(.)='${OMIE_SOAP_SECURITY_NAMESPACE}']`;

export class OmieXmlSigner {
  async signSoapEnvelope(soapXml: string, p12Buffer: Buffer, passphrase: string): Promise<string> {
    const { privateKeyPem, certificatePem } = extractPkcs12Identity(p12Buffer, passphrase);
    const doc = parseXml(soapXml);
    const envelope = requireDocumentElement(doc);
    const body = findRequiredSoapChild(envelope, "Body");
    const header = findSoapChild(envelope, "Header") ?? createSoapHeader(doc, envelope, body);

    setOmieBodyId(body);
    appendSoapSecuritySignature(doc, header);

    const signer = new SignedXml({
      privateKey: privateKeyPem,
      publicCert: certificatePem,
      signatureAlgorithm: OMIE_XMLDSIG_RSA_SHA1,
      canonicalizationAlgorithm: OMIE_XMLDSIG_C14N,
      idAttribute: "id",
      getKeyInfoContent: ({ prefix } = {}) => buildX509KeyInfo(stripPemCertificate(certificatePem), prefix)
    });

    signer.addReference({
      xpath: SOAP_BODY_XPATH,
      transforms: [OMIE_XMLDSIG_C14N],
      digestAlgorithm: OMIE_XMLDSIG_SHA1
    });

    signer.computeSignature(serializeXml(doc), {
      prefix: "ds",
      location: {
        reference: SOAP_SECURITY_SIGNATURE_XPATH,
        action: "append"
      }
    });

    return signer.getSignedXml();
  }
}

export class OmieXmlSignerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OmieXmlSignerError";
  }
}

function parseXml(xml: string): XmlDocument {
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") {
        errors.push(message);
      }
    }
  }).parseFromString(xml, "text/xml");

  if (!doc.documentElement || errors.length > 0) {
    throw new OmieXmlSignerError(`SOAP XML no valido: ${errors.join("; ") || "documento vacio"}`);
  }

  return doc;
}

function requireDocumentElement(doc: XmlDocument) {
  const element = doc.documentElement;
  if (!element || element.localName !== "Envelope" || element.namespaceURI !== OMIE_SOAP11_NAMESPACE) {
    throw new OmieXmlSignerError("El SOAP XML debe contener un soapenv:Envelope SOAP 1.1.");
  }

  return element;
}

function findRequiredSoapChild(envelope: XmlElement, localName: "Body" | "Header") {
  const child = findSoapChild(envelope, localName);
  if (!child) {
    throw new OmieXmlSignerError(`El SOAP XML debe contener soapenv:${localName}.`);
  }

  return child;
}

function findSoapChild(envelope: XmlElement, localName: "Body" | "Header") {
  for (let i = 0; i < envelope.childNodes.length; i += 1) {
    const child = envelope.childNodes.item(i);
    if (!child) {
      continue;
    }
    if (isElementNode(child) && child.localName === localName && child.namespaceURI === OMIE_SOAP11_NAMESPACE) {
      return child;
    }
  }

  return undefined;
}

function createSoapHeader(doc: XmlDocument, envelope: XmlElement, body: XmlElement) {
  const prefix = envelope.prefix ? `${envelope.prefix}:` : "";
  const header = doc.createElementNS(OMIE_SOAP11_NAMESPACE, `${prefix}Header`);
  envelope.insertBefore(header, body);
  return header;
}

function setOmieBodyId(body: XmlElement) {
  body.setAttributeNS(XMLNS_NAMESPACE, "xmlns:SOAP-SEC", OMIE_SOAP_SECURITY_NAMESPACE);
  body.setAttributeNS(OMIE_SOAP_SECURITY_NAMESPACE, "SOAP-SEC:id", OMIE_SOAP_BODY_ID);
}

function appendSoapSecuritySignature(doc: XmlDocument, header: XmlElement) {
  const soapSecuritySignature = doc.createElementNS(OMIE_SOAP_SECURITY_NAMESPACE, "SOAP-SEC:Signature");
  soapSecuritySignature.setAttributeNS(XMLNS_NAMESPACE, "xmlns:SOAP-SEC", OMIE_SOAP_SECURITY_NAMESPACE);
  header.appendChild(soapSecuritySignature);
}

function buildX509KeyInfo(certificateBase64: string, prefix?: string | null) {
  const currentPrefix = prefix ? `${prefix}:` : "";
  return [
    `<${currentPrefix}X509Data>`,
    `<${currentPrefix}X509Certificate>${certificateBase64}</${currentPrefix}X509Certificate>`,
    `</${currentPrefix}X509Data>`
  ].join("");
}

function extractPkcs12Identity(p12Buffer: Buffer, passphrase: string) {
  try {
    const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString("binary"));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, passphrase);
    const privateKeyBag = firstBagWithKey(p12, forge.pki.oids.pkcs8ShroudedKeyBag) ?? firstBagWithKey(p12, forge.pki.oids.keyBag);
    const certificateBag = findCertificateBagForKey(p12, privateKeyBag);

    if (!privateKeyBag?.key) {
      throw new OmieXmlSignerError("El PKCS12 no contiene clave privada.");
    }
    if (!certificateBag?.cert) {
      throw new OmieXmlSignerError("El PKCS12 no contiene certificado X509.");
    }

    return {
      privateKeyPem: forge.pki.privateKeyToPem(privateKeyBag.key),
      certificatePem: forge.pki.certificateToPem(certificateBag.cert)
    };
  } catch (error) {
    if (error instanceof OmieXmlSignerError) {
      throw error;
    }

    throw new OmieXmlSignerError(`No se pudo leer el PKCS12 para firmar XMLDSIG: ${error instanceof Error ? error.message : "error desconocido"}`);
  }
}

function firstBagWithKey(p12: forge.pkcs12.Pkcs12Pfx, bagType: string) {
  return bagsByType(p12, bagType).find((bag) => bag.key);
}

function findCertificateBagForKey(p12: forge.pkcs12.Pkcs12Pfx, keyBag: forge.pkcs12.Bag | undefined) {
  const certBags = bagsByType(p12, forge.pki.oids.certBag).filter((bag) => bag.cert);
  const keyLocalKeyId = firstBagAttribute(keyBag, "localKeyId");
  const matchingCertBag = certBags.find((bag) => firstBagAttribute(bag, "localKeyId") === keyLocalKeyId);

  return matchingCertBag ?? certBags[0];
}

function bagsByType(p12: forge.pkcs12.Pkcs12Pfx, bagType: string) {
  return p12.getBags({ bagType })[bagType] ?? [];
}

function firstBagAttribute(bag: forge.pkcs12.Bag | undefined, name: string) {
  const values = bag?.attributes?.[name];
  return Array.isArray(values) ? values[0] : undefined;
}

function stripPemCertificate(certificatePem: string) {
  return certificatePem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/g, "");
}

function serializeXml(doc: XmlDocument) {
  return new XMLSerializer().serializeToString(doc);
}

function isElementNode(node: XmlNode): node is XmlElement {
  return node.nodeType === 1;
}
