import { DOMParser } from "@xmldom/xmldom";
import type { Document as XmlDocument, Element as XmlElement, Node as XmlNode } from "@xmldom/xmldom";

export type OmieXmlJsonValue = string | OmieXmlJsonObject | OmieXmlJsonValue[];

export type OmieXmlJsonObject = {
  $attributes?: Record<string, string>;
  $text?: string;
  [key: string]: OmieXmlJsonValue | Record<string, string> | undefined;
};

export function parseOmieXmlResponse(xml: string): OmieXmlJsonObject {
  const doc = parseXml(xml);
  const root = requireDocumentElement(doc);

  return {
    [root.nodeName]: elementToJson(root)
  };
}

export class OmieXmlResponseParserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OmieXmlResponseParserError";
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
    throw new OmieXmlResponseParserError(`XML OMIE no valido: ${errors.join("; ") || "documento vacio"}`);
  }

  return doc;
}

function requireDocumentElement(doc: XmlDocument) {
  const element = doc.documentElement;
  if (!element) {
    throw new OmieXmlResponseParserError("XML OMIE sin elemento raiz.");
  }

  return element;
}

function elementToJson(element: XmlElement): OmieXmlJsonValue {
  const attributes = attributesToJson(element);
  const childElements = elementChildren(element);
  const text = directTextContent(element);

  if (Object.keys(attributes).length === 0 && childElements.length === 0) {
    return text;
  }

  const json: OmieXmlJsonObject = {};
  if (Object.keys(attributes).length > 0) {
    json.$attributes = attributes;
  }
  if (text) {
    json.$text = text;
  }

  for (const child of childElements) {
    appendChild(json, child.nodeName, elementToJson(child));
  }

  return json;
}

function attributesToJson(element: XmlElement) {
  const attributes: Record<string, string> = {};
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (attribute) {
      attributes[attribute.name] = attribute.value;
    }
  }

  return attributes;
}

function elementChildren(element: XmlElement) {
  const children: XmlElement[] = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (child && isElementNode(child)) {
      children.push(child);
    }
  }

  return children;
}

function directTextContent(element: XmlElement) {
  const chunks: string[] = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (child && isTextNode(child)) {
      const text = child.nodeValue?.trim();
      if (text) {
        chunks.push(text);
      }
    }
  }

  return chunks.join("");
}

function appendChild(json: OmieXmlJsonObject, name: string, value: OmieXmlJsonValue) {
  const current = json[name];
  if (current === undefined) {
    json[name] = value;
    return;
  }

  if (Array.isArray(current)) {
    current.push(value);
    return;
  }

  json[name] = [current as OmieXmlJsonValue, value];
}

function isElementNode(node: XmlNode): node is XmlElement {
  return node.nodeType === 1;
}

function isTextNode(node: XmlNode) {
  return node.nodeType === 3 || node.nodeType === 4;
}
