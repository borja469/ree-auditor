import { DOMParser } from "@xmldom/xmldom";
import type { Document as XmlDocument, Element as XmlElement, Node as XmlNode } from "@xmldom/xmldom";
import type { OmieConsultaCatalogoColumna, OmieConsultaCatalogoParametro } from "./omie-siom2.types";

export type OmieConsultaDirectorioItem = {
  codigo: string;
  descripcion?: string;
  categoria?: string;
  version?: string;
  tipoConsulta?: string;
};

export type OmieConsultaConfiguracionExtract = {
  codigo?: string;
  descripcion?: string;
  categoria?: string;
  version?: string;
  tipoConsulta?: string;
  parametros: OmieConsultaCatalogoParametro[];
  columnas: OmieConsultaCatalogoColumna[];
};

export function extractOmieDirectorioConsultas(xml: string): OmieConsultaDirectorioItem[] {
  const root = findPayloadRoot(xml, "RespuestaDirectorioConsultas");
  const consultas: OmieConsultaDirectorioItem[] = [];

  for (const seccion of directElementChildren(root, "Seccion")) {
    const categoria = attr(seccion, "v");
    for (const consulta of directElementChildren(seccion, "Consultas")) {
      const codigoNode = firstDirectElementChild(consulta, "CodConsulta");
      const codigo = attr(codigoNode, "v") ?? directText(codigoNode);
      if (!codigo) {
        continue;
      }

      consultas.push({
        codigo,
        descripcion: childAttrOrText(consulta, "Titulo", "v"),
        categoria,
        version: extractVersion(consulta),
        tipoConsulta: childAttrOrText(consulta, "TipoConsulta", "v")
      });
    }
  }

  return consultas;
}

export function extractOmieConfiguracionConsulta(xml: string): OmieConsultaConfiguracionExtract {
  const root = findPayloadRoot(xml, "RespuestaConfiguracionConsulta");
  const cabecera = firstDirectElementChild(root, "Cabecera");

  return {
    codigo: childAttrOrText(cabecera, "CodConsulta", "v"),
    descripcion: childAttrOrText(cabecera, "Titulo", "v"),
    categoria: childAttrOrText(cabecera, "Seccion", "v"),
    version: extractVersion(cabecera ?? root),
    tipoConsulta: childAttrOrText(cabecera, "TipoConsulta", "v"),
    parametros: extractParametros(root),
    columnas: extractColumnas(root)
  };
}

export class OmieConsultasCatalogParserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OmieConsultasCatalogParserError";
  }
}

function extractParametros(root: XmlElement): OmieConsultaCatalogoParametro[] {
  const parametros = firstDirectElementChild(root, "Parametros");
  if (!parametros) {
    return [];
  }

  return directElementChildren(parametros).map((element) => ({
    tipo: localName(element),
    nombre: attr(element, "n"),
    descripcion: attr(element, "desc"),
    longitud: attr(element, "long"),
    comodin: attr(element, "comodin"),
    selecciones: extractSelecciones(element),
    atributos: attributesToRecord(element)
  }));
}

function extractColumnas(root: XmlElement): OmieConsultaCatalogoColumna[] {
  const columnas = firstDirectElementChild(root, "Columnas");
  if (!columnas) {
    return [];
  }

  return directElementChildren(columnas).map((element) => ({
    tipo: localName(element),
    nombre: attr(element, "n"),
    descripcion: attr(element, "desc"),
    longitud: attr(element, "long"),
    agregado: attr(element, "agregado"),
    etiquetaXml: attr(element, "xml") ?? attr(element, "etiquetaXml") ?? attr(element, "etiqueta") ?? attr(element, "tag"),
    atributos: attributesToRecord(element)
  }));
}

function extractSelecciones(element: XmlElement) {
  const seleccion = firstDirectElementChild(element, "Seleccion");
  if (!seleccion) {
    return [];
  }

  return directElementChildren(seleccion, "Valor").map((value) => ({
    codigo: attr(value, "cod"),
    descripcion: attr(value, "desc"),
    atributos: attributesToRecord(value)
  }));
}

function findPayloadRoot(xml: string, rootName: string): XmlElement {
  const doc = parseXml(xml);
  const root = firstDescendantByLocalName(requireDocumentElement(doc), rootName);
  if (root) {
    return root;
  }

  const returnNode = firstDescendantByLocalName(requireDocumentElement(doc), "return");
  const embeddedXml = returnNode?.textContent?.trim();
  if (embeddedXml?.startsWith("<")) {
    const embeddedDoc = parseXml(embeddedXml);
    const embeddedRoot = firstDescendantByLocalName(requireDocumentElement(embeddedDoc), rootName);
    if (embeddedRoot) {
      return embeddedRoot;
    }
  }

  throw new OmieConsultasCatalogParserError(`No se encontro ${rootName} en la respuesta OMIE.`);
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
    throw new OmieConsultasCatalogParserError(`XML OMIE no valido: ${errors.join("; ") || "documento vacio"}`);
  }

  return doc;
}

function requireDocumentElement(doc: XmlDocument) {
  if (!doc.documentElement) {
    throw new OmieConsultasCatalogParserError("XML OMIE sin elemento raiz.");
  }

  return doc.documentElement;
}

function extractVersion(element: XmlElement | undefined) {
  if (!element) {
    return undefined;
  }

  const codigo = firstDirectElementChild(element, "CodConsulta");
  return (
    attr(codigo, "version") ??
    attr(codigo, "Version") ??
    childAttrOrText(element, "Version", "v") ??
    childAttrOrText(element, "VersionConsulta", "v") ??
    childAttrOrText(element, "Ver", "v")
  );
}

function childAttrOrText(parent: XmlElement | undefined, childName: string, attributeName: string) {
  const child = firstDirectElementChild(parent, childName);
  return attr(child, attributeName) ?? directText(child);
}

function directElementChildren(parent: XmlElement, childName?: string) {
  const children: XmlElement[] = [];
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const child = parent.childNodes.item(index);
    if (child && isElementNode(child) && (!childName || localName(child) === childName)) {
      children.push(child);
    }
  }

  return children;
}

function firstDirectElementChild(parent: XmlElement | undefined, childName: string) {
  if (!parent) {
    return undefined;
  }

  return directElementChildren(parent, childName)[0];
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
