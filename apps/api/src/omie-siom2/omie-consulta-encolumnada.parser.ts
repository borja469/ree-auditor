import { DOMParser } from "@xmldom/xmldom";
import type { Document as XmlDocument, Element as XmlElement, Node as XmlNode } from "@xmldom/xmldom";
import type { OmieConsultaEncolumnadaColumna, OmieConsultaEncolumnadaFila, OmieConsultaEncolumnadaTabla } from "./omie-siom2.types";

const COLUMN_CONTAINER_NAMES = ["Columnas", "Cabeceras"];
const ROW_CONTAINER_NAMES = ["Filas", "Datos", "Resultados"];
const ROW_NAMES = ["Fila", "Registro", "Row"];

export function extractOmieConsultaEncolumnada(xml: string): OmieConsultaEncolumnadaTabla | undefined {
  const payloadRoot = findResultPayloadRoot(xml);
  const filas = extractFilas(payloadRoot);
  const columnas = extractColumnas(payloadRoot, filas);

  if (columnas.length === 0 && filas.length === 0) {
    return undefined;
  }

  return {
    columnas,
    filas
  };
}

function extractColumnas(root: XmlElement, filas: OmieConsultaEncolumnadaFila[]): OmieConsultaEncolumnadaColumna[] {
  const columnasRoot = firstDescendantByLocalNames(root, COLUMN_CONTAINER_NAMES);
  if (columnasRoot) {
    const columnas = directElementChildren(columnasRoot).map((element) => {
      const atributos = attributesToRecord(element);
      const nombre = attr(element, "n") ?? attr(element, "nombre") ?? attr(element, "name") ?? attr(element, "cod") ?? localName(element);

      return {
        nombre,
        tipo: attr(element, "tipo") ?? localName(element),
        descripcion: attr(element, "desc") ?? attr(element, "descripcion"),
        atributos
      };
    });

    if (columnas.length > 0) {
      return columnas;
    }
  }

  const firstRowElement = descendantsByLocalNames(root, ROW_NAMES)[0];
  if (firstRowElement) {
    return directElementChildren(firstRowElement).map((element) => ({
      nombre: attr(element, "n") ?? attr(element, "nombre") ?? attr(element, "name") ?? localName(element),
      tipo: localName(element),
      atributos: {}
    }));
  }

  const firstRow = filas[0];
  return firstRow ? Object.keys(firstRow).map((nombre) => ({ nombre, atributos: {} })) : [];
}

function extractFilas(root: XmlElement): OmieConsultaEncolumnadaFila[] {
  const filasRoot = firstDescendantByLocalNames(root, ROW_CONTAINER_NAMES);
  const rowElements = filasRoot ? directElementChildren(filasRoot).filter(isRowElement) : descendantsByLocalNames(root, ROW_NAMES);

  return rowElements.map(toFila).filter((fila) => Object.keys(fila).length > 0);
}

function toFila(row: XmlElement): OmieConsultaEncolumnadaFila {
  const children = directElementChildren(row);
  if (children.length === 0) {
    return attributesToRecord(row);
  }

  const fila: OmieConsultaEncolumnadaFila = {};
  for (const child of children) {
    const name = attr(child, "n") ?? attr(child, "nombre") ?? attr(child, "name") ?? localName(child);
    const value = attr(child, "v") ?? attr(child, "valor") ?? attr(child, "value") ?? directText(child) ?? "";
    fila[name] = value;
  }

  return fila;
}

function findResultPayloadRoot(xml: string): XmlElement {
  const doc = parseXml(xml);
  const root = requireDocumentElement(doc);
  const returnNode = firstDescendantByLocalName(root, "return");
  const embeddedXml = returnNode?.textContent?.trim();
  if (embeddedXml?.startsWith("<")) {
    const embeddedDoc = parseXml(embeddedXml);
    return requireDocumentElement(embeddedDoc);
  }

  return root;
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
    throw new OmieConsultaEncolumnadaParserError(`XML OMIE no valido: ${errors.join("; ") || "documento vacio"}`);
  }

  return doc;
}

function requireDocumentElement(doc: XmlDocument) {
  if (!doc.documentElement) {
    throw new OmieConsultaEncolumnadaParserError("XML OMIE sin elemento raiz.");
  }

  return doc.documentElement;
}

function firstDescendantByLocalNames(element: XmlElement, names: readonly string[]) {
  for (const name of names) {
    const found = firstDescendantByLocalName(element, name);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function firstDescendantByLocalName(element: XmlElement, name: string): XmlElement | undefined {
  if (localName(element) === name) {
    return element;
  }

  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (child && isElementNode(child)) {
      const found = firstDescendantByLocalName(child, name);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

function descendantsByLocalNames(element: XmlElement, names: readonly string[]) {
  const descendants: XmlElement[] = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (child && isElementNode(child)) {
      if (names.includes(localName(child))) {
        descendants.push(child);
      }
      descendants.push(...descendantsByLocalNames(child, names));
    }
  }

  return descendants;
}

function directElementChildren(parent: XmlElement) {
  const children: XmlElement[] = [];
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const child = parent.childNodes.item(index);
    if (child && isElementNode(child)) {
      children.push(child);
    }
  }

  return children;
}

function isRowElement(element: XmlElement) {
  return ROW_NAMES.includes(localName(element));
}

function attributesToRecord(element: XmlElement) {
  const attributes: Record<string, string> = {};
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (attribute) {
      attributes[attribute.name] = attribute.value;
    }
  }

  return attributes;
}

function attr(element: XmlElement | undefined, name: string) {
  const value = element?.getAttribute(name)?.trim();
  return value ? value : undefined;
}

function directText(element: XmlElement | undefined) {
  const value = element?.textContent?.trim();
  return value ? value : undefined;
}

function localName(element: XmlElement) {
  return element.localName || element.nodeName.split(":").pop() || element.nodeName;
}

function isElementNode(node: XmlNode): node is XmlElement {
  return node.nodeType === 1;
}

export class OmieConsultaEncolumnadaParserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OmieConsultaEncolumnadaParserError";
  }
}
