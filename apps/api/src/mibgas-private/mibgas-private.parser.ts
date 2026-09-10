import { DOMParser } from "@xmldom/xmldom";
import type { Document as XmlDocument, Element as XmlElement, Node as XmlNode } from "@xmldom/xmldom";
import type { Prisma } from "@prisma/client";
import type {
  MibgasDirectoryEntry,
  MibgasParsedAnnotation,
  MibgasParsedNetPosition,
  MibgasParsedTransaction,
  MibgasQueryColumn,
  MibgasQueryConfigurationResult,
  MibgasQueryParameter,
  MibgasUserData
} from "./mibgas-private.types";

export function extractMibgasPayloadXml(xml: string) {
  const doc = parseXml(xml);
  const envelopeRoot = requireDocumentElement(doc);
  const fault = firstDescendantByLocalName(envelopeRoot, "Fault");
  if (fault) {
    throw new MibgasSoapFaultError(childText(fault, "faultcode"), childText(fault, "faultstring"), serializeElement(fault));
  }

  const serviceResult = firstDescendantByLocalName(envelopeRoot, "return");
  const embeddedXml = serviceResult?.textContent?.trim();
  if (embeddedXml?.startsWith("<")) {
    return embeddedXml;
  }

  const body = firstDescendantByLocalName(envelopeRoot, "Body");
  const bodyChildren = body ? directElementChildren(body) : [];
  const response = bodyChildren[0];
  const responseChildren = response ? directElementChildren(response) : [];
  const payload = responseChildren.find((child) => !["return"].includes(localName(child))) ?? responseChildren[0] ?? response;
  return payload ? serializeElement(payload) : xml;
}

export function xmlToJson(xml: string): Prisma.JsonValue {
  const root = requireDocumentElement(parseXml(xml));
  return { [localName(root)]: elementToJson(root) } as Prisma.JsonValue;
}

export function parseMibgasUserData(xml: string): MibgasUserData {
  const root = findPayloadRoot(xml, "RespuestaDatosUsuario");
  const idAgente = firstDirectElementChild(root, "IdAgente");
  const datosCertificado = firstDirectElementChild(root, "DatosCertificado");
  const datosTitular = firstDescendantByLocalName(datosCertificado, "DatosTitular");
  const validez = firstDescendantByLocalName(datosCertificado, "Validez");

  return {
    agentCode: childAttr(idAgente, "CodAgente"),
    agentDescription: childAttr(idAgente, "DesAgente"),
    agentProfile: childAttr(idAgente, "PerfilAgente"),
    certificateCode: childAttr(datosCertificado, "CodCertificado") ?? childAttr(datosCertificado, "CodTarjeta"),
    registryProfile: childAttr(datosCertificado, "PerfilCertificadoRyC"),
    tradingProfile: childAttr(datosCertificado, "PerfilCertificadoTrad"),
    holderName: childAttr(datosTitular, "Nombre"),
    holderSurnames: childAttr(datosTitular, "Apellidos"),
    holderEmail: childAttr(datosTitular, "EMail"),
    validFrom: childAttr(validez, "FechaAlta"),
    validTo: childAttr(validez, "FechaBaja")
  };
}

export function parseMibgasDirectory(xml: string): MibgasDirectoryEntry[] {
  const root = findFirstPayloadRoot(xml, [
    "RespuestaDirectorioConsultas",
    "DirectorioConsultas",
    "MensajeDirectorioConsultas",
    "ResultadoDirectorioConsultas"
  ]) ?? requireDocumentElement(parseXml(xml));
  const entries: MibgasDirectoryEntry[] = [];

  for (const section of directElementChildren(root, "Seccion")) {
    const sectionName = attr(section, "v");
    for (const query of directElementChildren(section, "Consultas")) {
      const queryCode = childAttr(query, "CodConsulta");
      if (!queryCode) {
        continue;
      }
      entries.push({
        queryCode,
        title: childAttr(query, "Titulo"),
        section: sectionName ?? null,
        queryType: childAttr(query, "TipoConsulta"),
        rawPayloadJson: elementToJsonObject(query)
      });
    }
  }

  if (entries.length > 0) {
    return entries;
  }

  for (const query of findDirectoryQueryElements(root)) {
    const queryCode = childAttr(query, "CodConsulta") ?? attr(query, "CodConsulta") ?? attr(query, "Codigo") ?? attr(query, "cod");
    if (!queryCode || entries.some((entry) => entry.queryCode === queryCode)) {
      continue;
    }
    entries.push({
      queryCode,
      title: childAttr(query, "Titulo") ?? childAttr(query, "DesConsulta") ?? attr(query, "Titulo") ?? attr(query, "Descripcion") ?? null,
      section: findAncestorSectionName(query) ?? null,
      queryType: childAttr(query, "TipoConsulta") ?? attr(query, "TipoConsulta") ?? attr(query, "Tipo") ?? null,
      rawPayloadJson: elementToJsonObject(query)
    });
  }

  return entries;
}

export function parseMibgasQueryConfiguration(xml: string): MibgasQueryConfigurationResult {
  const root = findFirstPayloadRoot(xml, [
    "RespuestaConfiguracionConsulta",
    "ConfiguracionConsulta",
    "MensajeConfiguracionConsulta",
    "ResultadoConfiguracionConsulta"
  ]) ?? findConfigurationRoot(xml) ?? requireDocumentElement(parseXml(xml));
  const header = firstDirectElementChild(root, "Cabecera") ?? firstDescendantByLocalName(root, "Cabecera") ?? root;

  return {
    queryCode: childAttr(header, "CodConsulta") ?? attr(header, "CodConsulta"),
    title: childAttr(header, "Titulo") ?? attr(header, "Titulo") ?? childAttr(header, "DesConsulta") ?? attr(header, "Descripcion"),
    section: childAttr(header, "Seccion") ?? attr(header, "Seccion"),
    queryType: childAttr(header, "TipoConsulta") ?? attr(header, "TipoConsulta") ?? attr(header, "Tipo"),
    parameters: parseParameters(root),
    columns: parseColumns(root),
    rawPayloadJson: elementToJsonObject(root)
  };
}

export function parseMibgasTransactions(xml: string): { header: ReturnType<typeof parseMarketHeader>; rows: MibgasParsedTransaction[] } {
  const documentRoot = requireDocumentElement(parseXml(xml));
  const encolumnadaRoot = firstDescendantByLocalName(documentRoot, "RespuestaEjecucionConsultaEncolumnada") ?? findEncolumnadaRoot(documentRoot);
  if (encolumnadaRoot) {
    return parseMibgasEncolumnadaTransactions(encolumnadaRoot);
  }

  const root = findPayloadRoot(xml, "MessageTransactionsMIBGAS");
  const header = parseMarketHeader(root);
  const rows: MibgasParsedTransaction[] = [];

  for (const data of directElementChildren(root, "TransactionData")) {
    const contractId = childAttr(data, "ContractId");
    if (!contractId) {
      continue;
    }
    const messageScope = childAttr(data, "MessageScope");
    for (const transaction of directElementChildren(data, "ContractTransactions")) {
      const transactionId = childAttr(transaction, "TransactionId");
      if (!transactionId) {
        continue;
      }
      rows.push({
        ...header,
        contractId,
        messageScope,
        marketParticipantId: childAttr(transaction, "MarketParticipantId"),
        portfolioId: childAttr(transaction, "PortfolioId"),
        contractType: childAttr(transaction, "ContractType"),
        auctionNumber: childAttr(transaction, "AuctionNumber"),
        orderId: childAttr(transaction, "OrderId"),
        transactionId,
        buySellIndicator: childAttr(transaction, "BuySellIndicator"),
        price: childAttr(transaction, "Price"),
        quantity: childAttr(transaction, "Quantity"),
        transactionDatetime: childAttr(transaction, "TransactionDateTime"),
        rawPayloadJson: elementToJsonObject(transaction, { ContractId: contractId, MessageScope: messageScope ?? "" })
      });
    }
  }

  return { header, rows };
}

function parseMibgasEncolumnadaTransactions(root: XmlElement): { header: ReturnType<typeof parseMarketHeader>; rows: MibgasParsedTransaction[] } {
  const queryCode = childAttr(root, "CodConsulta");
  const parameters = readNamedValues(firstDescendantByLocalName(root, "Parametros"));
  const rows: MibgasParsedTransaction[] = [];

  for (const fila of findDescendantsByLocalName(root, "Fila")) {
    const values = readNamedValues(fila);
    const transactionId = values.cdtrans ?? values.CdTrans ?? values.transactionId;
    if (!transactionId) {
      continue;
    }
    const tradingDay = values.dgasini ?? values.DGasIni ?? values.fesesion ?? parameters.dgasini ?? parameters.dgasfin;
    rows.push({
      messageId: queryCode,
      messageVersion: null,
      messageDatetime: values.fealta ?? values.FeAlta ?? null,
      tradingDay: tradingDay ?? null,
      senderId: null,
      receiverId: null,
      contractId: values.cdprod ?? values.CdProd ?? values.cdinstal ?? values.cdzona ?? queryCode ?? "ENCOL",
      messageScope: "ENCOL",
      marketParticipantId: values.cdagente ?? parameters.cdagente ?? null,
      portfolioId: values.cdcartera ?? null,
      contractType: values.cdsegmento ?? parameters.cdsegmento ?? null,
      auctionNumber: null,
      orderId: values.cdoferta ?? null,
      transactionId,
      buySellIndicator: values.intipofe ?? values.tcasac ?? values.origen ?? null,
      price: values.precio ?? null,
      quantity: values.cant ?? null,
      transactionDatetime: values.fealta ?? null,
      rawPayloadJson: { ...values, queryCode: queryCode ?? "" }
    });
  }

  return {
    header: {
      messageId: queryCode,
      messageVersion: null,
      messageDatetime: null,
      tradingDay: parameters.dgasini ?? parameters.dgasfin ?? null,
      senderId: null,
      receiverId: null
    },
    rows
  };
}

function findEncolumnadaRoot(root: XmlElement) {
  if (findDescendantsByLocalName(root, "Fila").length > 0) {
    return root;
  }
  return undefined;
}

export function parseMibgasAnnotations(xml: string): { header: ReturnType<typeof parseMarketHeader>; rows: MibgasParsedAnnotation[] } {
  const root = findPayloadRoot(xml, "MessageAnnotationsMIBGAS");
  const header = parseMarketHeader(root);
  const rows: MibgasParsedAnnotation[] = [];

  for (const data of directElementChildren(root, "AnnotationData")) {
    const contractId = childAttr(data, "ContractId");
    if (!contractId) {
      continue;
    }
    const messageScope = childAttr(data, "MessageScope");
    for (const annotation of directElementChildren(data, "ContractAnnotations")) {
      const annotationId = childAttr(annotation, "AnnotationId");
      if (!annotationId) {
        continue;
      }
      rows.push({
        ...header,
        contractId,
        messageScope,
        marketParticipantId: childAttr(annotation, "MarketParticipantId"),
        portfolioId: childAttr(annotation, "PortfolioId"),
        registryAccountId: childAttr(annotation, "RegistryAccountId"),
        clearingAccountId: childAttr(annotation, "ClearingAccountId"),
        contractType: childAttr(annotation, "ContractType"),
        auctionNumber: childAttr(annotation, "AuctionNumber"),
        annotationId,
        annotationType: childAttr(annotation, "AnnotationType"),
        orderId: childAttr(annotation, "OrderId"),
        transactionId: childAttr(annotation, "TransactionId"),
        firstGasDay: childAttr(annotation, "FirstGasDay"),
        lastGasDay: childAttr(annotation, "LastGasDay"),
        buySellIndicator: childAttr(annotation, "BuySellIndicator"),
        price: childAttr(annotation, "Price"),
        quantity: childAttr(annotation, "Quantity"),
        quantitySign: childAttr(annotation, "QuantitySign"),
        delivery: childAttr(annotation, "Delivery"),
        amount: childAttr(annotation, "Amount"),
        amountSign: childAttr(annotation, "AmountSign"),
        taxAmount: childAttr(annotation, "TaxAmount"),
        taxAmountSign: childAttr(annotation, "TaxAmountSign"),
        rawPayloadJson: elementToJsonObject(annotation, { ContractId: contractId, MessageScope: messageScope ?? "" })
      });
    }
  }

  return { header, rows };
}

export function parseMibgasNetPositions(xml: string): { tradingDay: string | null; rows: MibgasParsedNetPosition[] } {
  const documentRoot = requireDocumentElement(parseXml(xml));
  const root = firstDescendantByLocalName(documentRoot, "RespuestaEjecucionConsultaEncolumnada") ?? findEncolumnadaRoot(documentRoot) ?? documentRoot;
  const parameters = readNamedValues(firstDescendantByLocalName(root, "Parametros"));
  const defaultTradingDay = parameters.dgasini ?? parameters.dgasfin ?? parameters.Diadegas ?? null;
  const rows: MibgasParsedNetPosition[] = [];

  for (const fila of findDescendantsByLocalName(root, "Fila")) {
    const values = readNamedValues(fila);
    const tradingDay = values.dgas ?? defaultTradingDay;
    const installation = values.cdinstal ?? null;
    const portfolioId = values.cdctaneg ?? values.cdcartera ?? null;
    const productId = values.cdprod ?? null;
    const segmentId = values.cdsegmento ?? null;
    const isTotal = Boolean(productId?.toLocaleLowerCase("es").includes("total") || (!values.dgas && !portfolioId));
    const rowKey = [tradingDay, installation, portfolioId, productId, segmentId, isTotal ? "TOTAL" : "DETALLE"]
      .map((value) => normalizeRowKeyPart(value))
      .join("|");

    rows.push({
      rowKey,
      tradingDay,
      installation,
      portfolioId,
      productId,
      segmentId,
      saleQuantity: values.venta ?? null,
      purchaseQuantity: values.compra ?? null,
      netQuantity: values.neto ?? null,
      isTotal,
      rawPayloadJson: { ...values, queryCode: childAttr(root, "CodConsulta") ?? "3144" }
    });
  }

  return { tradingDay: defaultTradingDay, rows };
}

export function parseMarketHeader(root: XmlElement) {
  return {
    messageId: childAttr(root, "MessageId"),
    messageVersion: childAttr(root, "MessageVersion"),
    messageDatetime: childAttr(root, "MessageDateTime"),
    tradingDay: childAttr(root, "TradingDay"),
    senderId: childAttr(root, "SenderId"),
    receiverId: childAttr(root, "ReceiverId")
  };
}

export function findMibgasPayloadRootName(xml: string) {
  return localName(requireDocumentElement(parseXml(xml)));
}

function parseParameters(root: XmlElement): MibgasQueryParameter[] {
  const params = firstDirectElementChild(root, "Parametros") ?? firstDescendantByLocalName(root, "Parametros");
  if (!params) {
    return [];
  }
  return directElementChildren(params).map((element) => ({
    type: localName(element),
    name: attr(element, "n"),
    description: attr(element, "desc"),
    length: attr(element, "long"),
    wildcard: attr(element, "comodin"),
    values: parseSelectionValues(element),
    attributes: attributesToRecord(element)
  }));
}

function parseColumns(root: XmlElement): MibgasQueryColumn[] {
  const columns = firstDirectElementChild(root, "Columnas") ?? firstDescendantByLocalName(root, "Columnas");
  if (!columns) {
    return [];
  }
  return directElementChildren(columns).map((element) => ({
    type: localName(element),
    name: attr(element, "n"),
    description: attr(element, "desc"),
    length: attr(element, "long"),
    aggregated: attr(element, "agregado"),
    xmlTag: attr(element, "xml") ?? attr(element, "etiquetaXml") ?? attr(element, "tag"),
    attributes: attributesToRecord(element)
  }));
}

function parseSelectionValues(element: XmlElement) {
  const selection = firstDirectElementChild(element, "Seleccion");
  if (!selection) {
    return [];
  }
  return directElementChildren(selection, "Valor").map((value) => ({
    code: attr(value, "cod"),
    description: attr(value, "desc"),
    attributes: attributesToRecord(value)
  }));
}

function readNamedValues(parent: XmlElement | undefined) {
  const values: Record<string, string> = {};
  if (!parent) {
    return values;
  }
  for (const element of directElementChildren(parent)) {
    const name = attr(element, "n");
    const value = attr(element, "v");
    if (name && value !== null) {
      values[name] = value;
    }
  }
  return values;
}

function normalizeRowKeyPart(value: string | boolean | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value).trim().toUpperCase();
}

function findDescendantsByLocalName(root: XmlElement, name: string) {
  const matches: XmlElement[] = [];
  collectDescendants(root, (element) => {
    if (localName(element) === name) {
      matches.push(element);
    }
  });
  return matches;
}

function findPayloadRoot(xml: string, rootName: string): XmlElement {
  const doc = parseXml(xml);
  const root = firstDescendantByLocalName(requireDocumentElement(doc), rootName);
  if (root) {
    return root;
  }
  throw new MibgasXmlParserError(`No se encontro ${rootName} en la respuesta MIBGAS.`);
}

function findFirstPayloadRoot(xml: string, rootNames: string[]): XmlElement | undefined {
  const documentRoot = requireDocumentElement(parseXml(xml));
  for (const rootName of rootNames) {
    const root = firstDescendantByLocalName(documentRoot, rootName);
    if (root) {
      return root;
    }
  }
  return undefined;
}

function findConfigurationRoot(xml: string): XmlElement | undefined {
  const documentRoot = requireDocumentElement(parseXml(xml));
  let best: XmlElement | undefined;
  collectDescendants(documentRoot, (element) => {
    if (best) {
      return;
    }
    const hasQueryCode =
      Boolean(firstDirectElementChild(element, "CodConsulta")) ||
      Boolean(attr(element, "CodConsulta"));
    const hasConfigurationShape =
      Boolean(firstDirectElementChild(element, "Parametros")) ||
      Boolean(firstDirectElementChild(element, "Columnas")) ||
      Boolean(firstDirectElementChild(element, "Cabecera"));
    if (hasQueryCode && hasConfigurationShape) {
      best = element;
    }
  });
  return best;
}

function findDirectoryQueryElements(root: XmlElement) {
  const matches: XmlElement[] = [];
  collectDescendants(root, (element) => {
    const name = localName(element).toLowerCase();
    const hasQueryCode =
      Boolean(firstDirectElementChild(element, "CodConsulta")) ||
      Boolean(attr(element, "CodConsulta")) ||
      Boolean(attr(element, "Codigo")) ||
      Boolean(attr(element, "cod"));
    if (hasQueryCode && (name.includes("consulta") || Boolean(firstDirectElementChild(element, "TipoConsulta")) || Boolean(firstDirectElementChild(element, "Titulo")))) {
      matches.push(element);
    }
  });
  return matches;
}

function collectDescendants(root: XmlElement, visitor: (element: XmlElement) => void) {
  visitor(root);
  for (let index = 0; index < root.childNodes.length; index += 1) {
    const child = root.childNodes.item(index);
    if (child && isElementNode(child)) {
      collectDescendants(child, visitor);
    }
  }
}

function findAncestorSectionName(element: XmlElement) {
  let current = element.parentNode;
  while (current) {
    if (isElementNode(current) && localName(current) === "Seccion") {
      return attr(current, "v") ?? childAttr(current, "Titulo") ?? attr(current, "Titulo");
    }
    current = current.parentNode;
  }
  return null;
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
    throw new MibgasXmlParserError(`XML MIBGAS no valido: ${errors.join("; ") || "documento vacio"}`);
  }

  return doc;
}

function requireDocumentElement(doc: XmlDocument) {
  if (!doc.documentElement) {
    throw new MibgasXmlParserError("XML MIBGAS sin elemento raiz.");
  }
  return doc.documentElement;
}

function firstDescendantByLocalName(element: XmlElement | undefined, name: string): XmlElement | undefined {
  if (!element) {
    return undefined;
  }
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
  return parent ? directElementChildren(parent, childName)[0] : undefined;
}

function childAttr(parent: XmlElement | undefined, childName: string, attributeName = "v") {
  return attr(firstDirectElementChild(parent, childName), attributeName);
}

function childText(parent: XmlElement | undefined, childName: string) {
  const text = firstDirectElementChild(parent, childName)?.textContent?.trim();
  return text || null;
}

function attr(element: XmlElement | undefined, name: string): string | null {
  const value = element?.getAttribute(name)?.trim();
  return value ? value : null;
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

function elementToJsonObject(element: XmlElement, extraAttributes: Record<string, string> = {}): Prisma.InputJsonObject {
  const json = elementToJson(element);
  return typeof json === "object" && json !== null && !Array.isArray(json)
    ? ({ ...extraAttributes, ...json } as Prisma.InputJsonObject)
    : ({ ...extraAttributes, value: String(json ?? "") } as Prisma.InputJsonObject);
}

function elementToJson(element: XmlElement): string | Record<string, unknown> {
  const attributes = attributesToRecord(element);
  const children = directElementChildren(element);
  const text = directTextContent(element);
  if (Object.keys(attributes).length === 0 && children.length === 0) {
    return text;
  }
  const json: Record<string, unknown> = {};
  if (Object.keys(attributes).length > 0) {
    json.$attributes = attributes;
  }
  if (text) {
    json.$text = text;
  }
  for (const child of children) {
    appendChild(json, localName(child), elementToJson(child));
  }
  return json;
}

function directTextContent(element: XmlElement) {
  const chunks: string[] = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (child && (child.nodeType === 3 || child.nodeType === 4)) {
      const text = child.nodeValue?.trim();
      if (text) {
        chunks.push(text);
      }
    }
  }
  return chunks.join("");
}

function appendChild(json: Record<string, unknown>, name: string, value: unknown) {
  const current = json[name];
  if (current === undefined) {
    json[name] = value;
    return;
  }
  if (Array.isArray(current)) {
    current.push(value);
    return;
  }
  json[name] = [current, value];
}

function serializeElement(element: XmlElement) {
  return element.toString();
}

function localName(element: XmlElement) {
  return element.localName || element.nodeName.split(":").pop() || element.nodeName;
}

function isElementNode(node: XmlNode): node is XmlElement {
  return node.nodeType === 1;
}

export class MibgasXmlParserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MibgasXmlParserError";
  }
}

export class MibgasSoapFaultError extends Error {
  constructor(
    readonly faultCode: string | null,
    readonly faultString: string | null,
    readonly faultXml: string
  ) {
    super(faultString ?? faultCode ?? "SOAP Fault MIBGAS.");
    this.name = "MibgasSoapFaultError";
  }
}
