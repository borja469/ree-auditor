import { useEffect, useMemo, useState } from "react";
import { consultSips, getSipsCapabilities, getSipsConfig, getSipsHistory, getSipsStored, saveSipsConfig, testSipsConfig } from "../../api";
import type { SipsCapabilities, SipsConfig, SipsConsumption, SipsHistory, SipsStored } from "../../api";
import { EChart } from "../shared/RestoredModuleCommon";
import "./sips.css";

type Magnitude = "active" | "inductive" | "capacitive" | "demand";
const MAGNITUDES: Record<Magnitude, { label: string; unit: string }> = {
  active: { label: "Energía activa", unit: "kWh" }, inductive: { label: "Reactiva inductiva", unit: "kVArh" },
  capacitive: { label: "Reactiva capacitiva", unit: "kVArh" }, demand: { label: "Potencia demandada", unit: "kW" }
};
const TENSION_V_DESCRIPTIONS: Record<string, string> = {
  "01": "1X220", "02": "1X230", "03": "3X380", "04": "3X380/220", "05": "3X400", "06": "3X400/230",
  "07": "1X127", "08": "1X133", "09": "2X220", "10": "2X230", "11": "3X220", "12": "3X220/127",
  "13": "3X230", "14": "3X230/133", "15": "5.000", "16": "6.000", "17": "7.200", "18": "8.000",
  "19": "10.000", "20": "11.000", "21": "12.000", "22": "13.000", "23": "13.200", "24": "15.000",
  "25": "16.500", "26": "17.000", "27": "20.000", "28": "22.000", "29": "25.000", "30": "26.500",
  "31": "30.000", "32": "36.000", "33": "44.000", "34": "45.000", "35": "66.000", "36": "110.000",
  "37": "132.000", "38": "220.000", "39": "400.000", "40": "1.200", "41": "2.000", "42": "5.500",
  "43": "55.000", "44": "130.000", "45": "100", "46": "150", "47": "3x100", "48": "3x150/260",
  "49": "3x260", "99": "Otra tensión obsoleta"
};
const TARIFA_ATR_DESCRIPTIONS: Record<string, string> = {
  "001": "2.0.A", "002": "2.0.N.A", "003": "3.0A", "004": "2.0DHA", "005": "2.1.A",
  "006": "2.1.DHA", "007": "2.0 DHS", "008": "2.1 DHS", "011": "3.1A", "012": "6.1A",
  "013": "6.2", "014": "6.3", "015": "6.4", "016": "6.5", "017": "6.1B",
  "018": "2.0TD", "019": "3.0TD", "020": "6.1TD", "021": "6.2TD", "022": "6.3TD",
  "023": "6.4TD", "024": "3.0TDVE", "025": "6.1TDVE"
};
const LECTURA_DESCRIPTIONS: Record<string, string> = {
  "10": "Telemedida", "11": "Telemedida corregida", "20": "TPL", "21": "TPL corregida",
  "30": "Visual", "31": "Visual corregida", "40": "Estimada", "50": "Autolectura",
  "60": "Telegestión", "70": "Calculada", "99": "Sin Lectura"
};
const MODO_CONTROL_POTENCIA_DESCRIPTIONS: Record<string, string> = {
  "1": "ICP", "2": "Maxímetro", "3": "Control de potencia en contador de telegestión.",
  "4": "Sin control de potencia"
};
const TIPO_CONTRATO_DESCRIPTIONS: Record<string, string> = {
  "01": "Anual", "02": "Eventual Medido", "03": "Temporada", "04": "Energía Adicional",
  "05": "Suministro a instalaciones RECORE", "06": "Interconexiones internacionales",
  "07": "Suministro de Obras", "08": "Suministro de Socorro", "09": "Eventual a tanto alzado",
  "10": "Pruebas", "11": "Duplicado", "12": "De reserva"
};
const PERIODICIDAD_FACTURACION_DESCRIPTIONS: Record<string, string> = { "01": "Mensual", "02": "Bimestral" };
const PROPIEDAD_EQUIPO_DESCRIPTIONS: Record<string, string> = {
  "1": "Distribuidor", "2": "Cliente", "3": "Comercializador", "4": "Otros"
};
const CLASIFICACION_PS_DESCRIPTIONS: Record<string, string> = {
  "01": "Punto de medida tipo 1", "02": "Punto de medida tipo 2", "03": "Punto de medida tipo 3",
  "04": "Punto de medida tipo 4", "05": "Punto de medida tipo 5"
};
const TIPO_SUMINISTRO_DESCRIPTIONS: Record<string, string> = {
  AL: "Almacén", AP: "Alumbrado publico", AS: "Ascensores", AT: "Antena Telefonía Móvil",
  BA: "Batería de acumuladores", CM: "Centro de Maniobra y Control", EA: "Escalera-Ascensor",
  ES: "Escalera", FT: "Fabrica y Talleres sin Riesgo Especifico", FV: "Inst. Fotovoltaica",
  GA: "Garaje", GB: "Grupo Bombeo, Riego por Goteo", HP: "Loc.Húmedos con Riesgo Corrosión o Polv.",
  IN: "Nave industrial", IT: "Instalación Temporal en Emplazam.Abierto", KC: "Kioskos / cabinas tfno",
  LB: "Locales a Baja Temperatura", LC: "Local comercial", OF: "Oficina", PC: "Publica concurrencia",
  RA: "Refugio o Albergue Agrícola", RT: "Repetidor de Televisión", SA: "Servicios Auxiliares",
  SC: "Sumtro complementario", SE: "Sumtro eventual", SG: "Servicio general vivienda",
  SM: "Semáforo", SO: "Sumtro obras", TL: "Telecomunicaciones", TR: "Trastero",
  UF: "Uso finca", UV: "Usos Varios", VI: "Vivienda", VE: "Recarga de vehículo eléctrico"
};
const DH_EQUIPO_MEDIDA_DESCRIPTIONS: Record<string, string> = {
  "0": "Dos períodos (Tarifa Nocturna)", "1": "Sin Discriminación Horaria", "2": "Dos períodos",
  "3": "Tres períodos, sin discriminación de sábados y festivos",
  "4": "Tres períodos, con discriminación de sábados y festivos",
  "5": "Cinco períodos", "6": "Seis períodos", "7": "Siete períodos",
  "8": "DH Supervalle", "9": "Tres períodos", A: "Seis períodos"
};
const PS_CODE_DESCRIPTIONS: Record<string, Record<string, string>> = {
  codigoClasificacionPS: CLASIFICACION_PS_DESCRIPTIONS,
  codigoTipoSuministro: TIPO_SUMINISTRO_DESCRIPTIONS,
  codigoModoControlPotencia: MODO_CONTROL_POTENCIA_DESCRIPTIONS,
  codigoTipoContrato: TIPO_CONTRATO_DESCRIPTIONS,
  codigoPeriodicidadFacturacion: PERIODICIDAD_FACTURACION_DESCRIPTIONS,
  codigoPropiedadEquipoMedida: PROPIEDAD_EQUIPO_DESCRIPTIONS,
  codigoPropiedadICP: PROPIEDAD_EQUIPO_DESCRIPTIONS,
  codigoDHEquipoDeMedida: DH_EQUIPO_MEDIDA_DESCRIPTIONS
};
const BLOCKS: Array<{ title: string; keys: string[] }> = [
  { title: "Identificación del suministro", keys: ["cups", "codigoEmpresaDistribuidora", "nombreEmpresaDistribuidora", "referenciaCatastralPS", "fechaAltaSuministro", "codigoClasificacionPS", "codigoTipoSuministro"] },
  { title: "Ubicación", keys: ["PaisPS", "desProvinciaPS", "desMunicipioPS", "desPoblacionPS", "codigoPostalPS", "tipoViaPS", "viaPS", "numFincaPS", "duplicadorFincaPS", "escaleraPS", "pisoPS", "puertaPS", "XPS", "YPS", "HusoPS", "BandaPS"] },
  { title: "Datos técnicos", keys: ["codigoTensionV", "potenciaMaximaBIEW", "potenciaMaximaAPMW", "tipoControDelPotencia", "tipoPerfilConsumo", "codigoTensionMedida", "potenciaCGPW", "codigoModoControlPotencia", "codigoBIE", "fechaEmisionBIE", "fechaCaducidadBIE", "codigoAPM", "fechaEmisionAPM", "fechaCaducidadAPM"] },
  { title: "Contrato y tarifa ATR", keys: ["codigoTarifaATREnVigor", "codigoSegmentoCargoEnVigor", "codigoTipoContrato", "codigoPeriodicidadFacturacion", "valorDerechosExtensionW", "valorDerechosAccesoW", "fechaLimiteDerechosReconocidos"] },
  { title: "Potencias contratadas P1 a P6", keys: Array.from({ length: 6 }, (_, index) => `potenciasContratadasEnWP${index + 1}`) },
  { title: "Equipos de medida", keys: ["codigoPropiedadEquipoMedida", "codigoPropiedadICP", "codigoLecturaRemota", "codigoFasesEquipoMedida", "codigoDHEquipoDeMedida", "codigoAccesibilidadContador", "fechaUltimaLectura", "relacionTransformacionIntensidad"] },
  { title: "Comercializadora y movimientos", keys: ["codigoComercializadorVigente", "fechaUltimoCambioComercializador", "cambioComercializadorEnCurso", "fechaUltimoMovimientoContrato", "codigoAgregadorIndependienteVigente", "fechaUltimoCambioAgregadorIndependiente", "cambioAgregadorIndependienteEnCurso"] },
  { title: "Autoconsumo", keys: ["acogimientoAutoconsumo"] },
  { title: "Condiciones especiales", keys: ["aplicacionBonoSocial", "suministroEsencial", "esViviendaHabitual", "suspensionSuminstroImpago", "codigoPSContratable", "motivoEstadoNoContratable", "codigoClaseExpediente", "codigoMotivoExpediente", "cnae"] },
  { title: "Datos del titular", keys: ["tipoPersona", "tipoIdTitular", "idTitular", "nombreTitular", "apellido1Titular", "apellido2Titular", "PaisTitular", "desProvinciaTitular", "desMunicipioTitular", "desPoblacionTitular", "codigoPostalTitular", "tipoViaTitular", "viaTitular", "numFincaTitular", "pisoTitular", "puertaTitular"] }
];

export function SipsModule() {
  const [cups, setCups] = useState(""); const [data, setData] = useState<SipsStored>(); const [history, setHistory] = useState<SipsHistory[]>([]);
  const [historyPage, setHistoryPage] = useState(1); const [historyPageSize, setHistoryPageSize] = useState(20); const [historyTotal, setHistoryTotal] = useState(0); const [historyLoading, setHistoryLoading] = useState(false);
  const [capabilities, setCapabilities] = useState<SipsCapabilities>({ admin: false, holder: false });
  const [config, setConfig] = useState<SipsConfig>(); const [showConfig, setShowConfig] = useState(false);
  const [environment, setEnvironment] = useState("production"); const [consumerKey, setConsumerKey] = useState(""); const [consumerSecret, setConsumerSecret] = useState("");
  const [tab, setTab] = useState<"ps" | "consumption">("ps"); const [magnitude, setMagnitude] = useState<Magnitude>("active");
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [descending, setDescending] = useState(true);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [showAll, setShowAll] = useState(false);
  const [manualCopyText, setManualCopyText] = useState("");
  const [dataSource, setDataSource] = useState<"consult" | "stored">("stored"); const [consultError, setConsultError] = useState("");
  useEffect(() => { void Promise.all([getSipsCapabilities(), getSipsHistory(1)]).then(([caps, result]) => { setCapabilities(caps); setHistory(result.items); setHistoryPage(result.page); setHistoryPageSize(result.pageSize); setHistoryTotal(result.total); }).catch(() => setMessage("No se pudo cargar SIPS.")); }, []);
  const latest = data?.queries[0];
  const latestPs = data?.queries.find((query) => query.kind === "PS");
  const latestConsumption = data?.queries.find((query) => query.kind === "CONSUMPTION");
  const queryStatus = latestPs && latestConsumption ? (latestPs.status === "OK" && latestConsumption.status === "OK" ? "Correcto" : latestPs.status === "OK" || latestConsumption.status === "OK" ? "Parcial" : latestPs.status === "NO_RESULTS" && latestConsumption.status === "NO_RESULTS" ? "Sin resultados" : latestPs.errorCode && latestPs.errorCode === latestConsumption.errorCode ? statusText("ERROR", latestPs.errorCode) : "Consulta fallida") : latest ? statusText(latest.status, latest.errorCode) : "Sin consulta";
  const resultTone = consultError ? "error" : dataSource === "stored" ? "stored" : latestPs?.status === "OK" && latestConsumption?.status === "OK" ? "success" : latestPs?.status === "OK" || latestConsumption?.status === "OK" ? "partial" : latestPs?.status === "NO_RESULTS" && latestConsumption?.status === "NO_RESULTS" ? "empty" : "error";
  const resultTitle = consultError ? "No se pudo completar la consulta" : dataSource === "stored" ? "Datos guardados" : resultTone === "success" ? "Consulta completada" : resultTone === "partial" ? "Consulta parcial" : resultTone === "empty" ? "Sin resultados" : "Consulta fallida";
  const rows = useMemo(() => (data?.consumptions ?? []).filter((row) => (!from || row.dateTo >= from) && (!to || row.dateFrom <= to)).sort((a, b) => descending ? b.dateTo.localeCompare(a.dateTo) : a.dateTo.localeCompare(b.dateTo)), [data, from, to, descending]);
  useEffect(() => setManualCopyText(""), [rows, magnitude]);
  const chartRows = useMemo(() => [...rows].sort((a, b) => a.dateTo.localeCompare(b.dateTo)), [rows]);
  const historyPages = Math.max(1, Math.ceil(historyTotal / historyPageSize));

  async function loadHistoryPage(page: number) {
    setHistoryLoading(true);
    try {
      const result = await getSipsHistory(page);
      setHistory(result.items); setHistoryPage(result.page); setHistoryPageSize(result.pageSize); setHistoryTotal(result.total);
    } catch { setMessage("No se pudo cargar el historial de consultas."); }
    finally { setHistoryLoading(false); }
  }

  async function load(value: string) {
    setBusy(true); setMessage(""); setConsultError("");
    try { const stored = await getSipsStored(value.trim().toUpperCase()); setData(stored); setCups(stored.cups); setDataSource("stored"); }
    catch (error) { setMessage(readError(error)); }
    finally { setBusy(false); }
  }
  async function consult(selectedCups = cups) {
    setBusy(true); setMessage(""); setConsultError("");
    try {
      const result = await consultSips(selectedCups.trim().toUpperCase()); setData(result.data); setCups(result.data.cups); setDataSource("consult");
      void loadHistoryPage(1);
    } catch (error) { setConsultError(readError(error)); }
    finally { setBusy(false); }
  }
  async function openConfig() {
    try { const loaded = await getSipsConfig(); setConfig(loaded); setEnvironment(loaded.environment); setShowConfig(true); setMessage(""); }
    catch (error) { setMessage(readError(error)); }
  }
  async function saveConfig() {
    setBusy(true);
    try { const loaded = await saveSipsConfig({ environment, ...(consumerKey ? { consumerKey } : {}), ...(consumerSecret ? { consumerSecret } : {}) }); setConfig(loaded); setConsumerKey(""); setConsumerSecret(""); setMessage("Configuración guardada."); }
    catch (error) { setMessage(readError(error)); }
    finally { setBusy(false); }
  }
  async function testConfig() {
    setBusy(true);
    try { const result = await testSipsConfig(); setMessage(result.message); setConfig(await getSipsConfig()); }
    catch (error) { setMessage(readError(error)); }
    finally { setBusy(false); }
  }
  function exportRows() {
    const headers = rows.length ? Object.keys(rows[0].raw) : [];
    const text = [headers, ...rows.map((row) => headers.map((key) => row.raw[key] ?? ""))].map((fields) => fields.map((field) => `"${String(field).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `sips-consumos-${data?.cups ?? ""}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  async function copyRows() {
    const cells = [consumptionHeaders(magnitude), ...rows.map((row) => consumptionCells(row, magnitude))];
    const text = cells.map((line) => line.map((value, index) => excelTsvCell(value, index)).join("\t")).join("\r\n");
    let copied = false;
    try {
      if (!window.isSecureContext || !navigator.clipboard?.writeText) copied = copyTextViaSelection(text);
      else { await navigator.clipboard.writeText(text); copied = true; }
    } catch {
      copied = copyTextViaSelection(text);
    }
    if (copied) {
      setManualCopyText("");
      setMessage(`${rows.length} registros de consumos copiados. Puedes pegarlos en Excel.`);
    } else {
      setManualCopyText(text);
      setMessage("El navegador bloqueó la copia automática. Selecciona la tabla de abajo y pulsa Ctrl+C.");
    }
  }

  return <div className="sips-page">
    <section className="panel sips-toolbar">
      <form onSubmit={(event) => { event.preventDefault(); void consult(); }}>
        <label>CUPS <input aria-label="CUPS" value={cups} onChange={(event) => setCups(event.target.value.toUpperCase())} placeholder="ES..." maxLength={24} /></label>
        <button type="submit" disabled={busy}>Consultar</button>
        {capabilities.admin && <button type="button" onClick={() => void openConfig()}>Configuración</button>}
      </form>
      <span>Estado: {busy ? "Consultando…" : consultError ? "Error" : data && dataSource === "stored" ? "Datos guardados" : queryStatus}</span>
      <span>Última actualización: {latest ? new Date(latest.queriedAt).toLocaleString("es-ES") : ""}</span>
    </section>
    {!busy && (data || consultError) && <section className={`sips-result sips-result--${resultTone}`} role="status">
      <span className="sips-result-icon" aria-hidden="true">{resultTone === "success" ? "✓" : resultTone === "partial" ? "!" : resultTone === "error" ? "×" : resultTone === "empty" ? "–" : "▣"}</span>
      <div className="sips-result-body">
        <strong>{resultTitle}</strong>
        {consultError ? <p>{consultError}{data ? " Los datos que siguen corresponden a una consulta anterior." : ""}</p> : <>
          <p>{data?.cups}{latest ? ` · ${dataSource === "stored" ? "Última consulta" : "Actualizado"}: ${new Date(latest.queriedAt).toLocaleString("es-ES")}` : ""}</p>
          <div className="sips-result-details"><span>Datos PS: <b>{queryResultDetail(latestPs, Boolean(data?.ps))}</b></span><span>Consumos PS: <b>{queryResultDetail(latestConsumption, Boolean(data?.consumptions.length))}</b></span></div>
        </>}
      </div>
    </section>}
    {message && <p className="sips-message" role="status">{message}</p>}
    {showConfig && capabilities.admin && <section className="panel sips-config">
      <div className="panel-title"><h2>Configuración CNMC</h2><button type="button" onClick={() => setShowConfig(false)}>Cerrar</button></div>
      <div className="sips-form-grid">
        <label>Entorno <select value={environment} onChange={(event) => setEnvironment(event.target.value)}><option value="production">Producción</option><option value="preproduction">Preproducción</option></select></label>
        <label>Consumer Key (User Secret) <input type="password" autoComplete="off" value={consumerKey} onChange={(event) => setConsumerKey(event.target.value)} placeholder={config?.keyConfigured ? "Configurada" : "Sin configurar"} /></label>
        <label>Consumer Secret (Password Secret) <input type="password" autoComplete="off" value={consumerSecret} onChange={(event) => setConsumerSecret(event.target.value)} placeholder={config?.secretConfigured ? "Configurada" : "Sin configurar"} /></label>
      </div>
      <p>Estado de conexión: {config?.connectionStatus ?? ""} · Última prueba: {config?.lastConnectionTest ? new Date(config.lastConnectionTest).toLocaleString("es-ES") : ""}</p>
      <div className="sips-actions"><button disabled={busy} onClick={() => void saveConfig()}>Guardar configuración</button><button disabled={busy} onClick={() => void testConfig()}>Probar conexión</button></div>
    </section>}
    {data && <>
      <section className="panel sips-summary"><strong>{data.cups}</strong><span>Distribuidora: {data.ps?.fields.nombreEmpresaDistribuidora ?? ""}</span><span>Tarifa ATR: {formatTarifaAtr(data.ps?.fields.codigoTarifaATREnVigor ?? "")}</span><span>Alta: {data.ps?.fields.fechaAltaSuministro ?? ""}</span></section>
      <div className="view-tabs"><button className={tab === "ps" ? "active" : ""} onClick={() => setTab("ps")}>Datos PS <QueryTabBadge query={latestPs} /></button><button className={tab === "consumption" ? "active" : ""} onClick={() => setTab("consumption")}>Consumos PS <QueryTabBadge query={latestConsumption} /></button></div>
      {tab === "ps" && <section className="sips-blocks">
        {!data.ps && <p className="panel">Sin datos PS almacenados.</p>}
        {data.ps && BLOCKS.filter((block) => block.title !== "Datos del titular" || capabilities.holder).map((block) => {
          const visibleKeys = block.keys.filter((key) => data.ps!.fields[key]?.trim());
          return visibleKeys.length ? <div className="panel" key={block.title}><h2>{block.title}</h2><dl className="sips-fields">{visibleKeys.map((key) => <div key={key}><dt>{label(key)}</dt><dd>{formatPsValue(key, data.ps!.fields[key])}</dd></div>)}</dl></div> : null;
        })}
        {data.ps && <div className="panel"><button onClick={() => setShowAll((value) => !value)}>{showAll ? "Ocultar" : "Ver"} todos los campos CSV</button>{showAll && <dl className="sips-fields sips-all-fields">{Object.entries(data.ps.fields).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>}</div>}
      </section>}
      {tab === "consumption" && <section className="panel">
        <div className="sips-consumption-filters"><label>Magnitud <select value={magnitude} onChange={(event) => setMagnitude(event.target.value as Magnitude)}>{Object.entries(MAGNITUDES).map(([key, value]) => <option key={key} value={key}>{value.label} ({value.unit})</option>)}</select></label><label>Desde <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Hasta <input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button onClick={() => setDescending((value) => !value)}>Fecha {descending ? "↓" : "↑"}</button><button disabled={!rows.length} onClick={() => void copyRows()}>Copiar tabla</button><button disabled={!rows.length} onClick={exportRows}>Exportar CSV</button></div>
        {manualCopyText && <div className="sips-copy-manual"><label>Tabla para copiar manualmente<textarea readOnly value={manualCopyText} onFocus={(event) => event.currentTarget.select()} /></label><button type="button" onClick={() => setManualCopyText("")}>Cerrar</button></div>}
        {chartRows.length > 0 && <div className="sips-chart"><h2>Evolución de {MAGNITUDES[magnitude].label.toLowerCase()} ({MAGNITUDES[magnitude].unit})</h2><EChart height={260} option={{ tooltip: { trigger: "axis" }, legend: { top: 0 }, grid: { left: 55, right: 20, bottom: 50, top: 35 }, xAxis: { type: "category", data: chartRows.map((row) => row.dateTo) }, yAxis: { type: "value", name: MAGNITUDES[magnitude].unit }, dataZoom: [{ type: "inside" }, { type: "slider", bottom: 5 }], series: [...Array.from({ length: 6 }, (_, index) => ({ name: `P${index + 1}`, type: "bar" as const, data: chartRows.map((row) => row.magnitudes[magnitude][index] ?? null), barMaxWidth: 18 })), ...(magnitude === "demand" ? [] : [{ name: "Total", type: "line" as const, data: chartRows.map((row) => row.totals[magnitude]), symbol: "none" as const, lineStyle: { width: 3 }, z: 10 }])] }} /></div>}
        <div className="sips-table-wrap"><table className="sips-table"><thead><tr>{consumptionHeaders(magnitude).map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={`${row.dateFrom}-${row.dateTo}`}>{consumptionCells(row, magnitude).map((value, index) => <td key={index}>{value}</td>)}</tr>)}</tbody></table></div>
        {!rows.length && <p>No hay consumos para el filtro seleccionado.</p>}
      </section>}
    </>}
    <section className="panel"><h2>Historial de consultas</h2><div className="sips-table-wrap"><table className="sips-table"><thead><tr><th>CUPS</th><th>Distribuidora</th><th>Tarifa ATR</th><th>Última consulta</th><th>Datos PS</th><th>Consumos PS</th><th>Acciones</th></tr></thead><tbody>{history.map((row) => <tr key={row.cups}><td>{row.cups}</td><td>{row.distributor}</td><td>{formatTarifaAtr(row.tariff)}</td><td>{new Date(row.lastQuery).toLocaleString("es-ES")}</td><td>{statusText(row.psStatus, row.psErrorCode)}</td><td>{statusText(row.consumptionStatus, row.consumptionErrorCode)}</td><td><button disabled={busy} onClick={() => void load(row.cups)}>Abrir</button> <button disabled={busy} onClick={() => void consult(row.cups)}>Actualizar</button></td></tr>)}</tbody></table></div><div className="sips-pagination"><span>{historyTotal ? `${(historyPage - 1) * historyPageSize + 1}–${(historyPage - 1) * historyPageSize + history.length} de ${historyTotal} CUPS` : "0 CUPS"}</span><button disabled={busy || historyLoading || historyPage <= 1} onClick={() => void loadHistoryPage(historyPage - 1)}>Anterior</button><span>Página {historyPage} de {historyPages}</span><button disabled={busy || historyLoading || historyPage >= historyPages} onClick={() => void loadHistoryPage(historyPage + 1)}>Siguiente</button></div></section>
  </div>;
}

function QueryTabBadge({ query }: { query?: SipsStored["queries"][number] }) {
  if (!query) return null;
  const tone = query.status === "OK" ? "success" : query.status === "NO_RESULTS" ? "empty" : "error";
  return <span className={`sips-tab-badge sips-tab-badge--${tone}`} title={statusText(query.status, query.errorCode)}>{tone === "success" ? "✓ Correcto" : tone === "empty" ? "– Sin resultados" : "! Error"}</span>;
}
function queryResultDetail(query?: SipsStored["queries"][number], storedData = false) {
  if (!query) return "Sin consulta";
  if (query.status === "OK") return `${query.recordCount} ${query.recordCount === 1 ? "registro" : "registros"}`;
  const detail = statusText(query.status, query.errorCode);
  return storedData ? `${detail}; datos guardados disponibles` : detail;
}
function statusText(status?: string, code?: string | null) { if (!status) return ""; if (status === "OK") return "Correcto"; if (status === "NO_RESULTS") return "Sin resultados"; const descriptions: Record<string, string> = { AUTH: "Credenciales CNMC rechazadas", PERMISSION: "Sin permisos", NOT_FOUND: "Fichero no disponible", INVALID_CSV: "CSV no válido", CUPS_MISMATCH: "CUPS inesperado", TIMEOUT: "Tiempo agotado", CONNECTION: "Error de conexión", CONFIG: "Sin configurar" }; return descriptions[code ?? ""] ?? "Error de servicio"; }
function formatNumber(value: number) { return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 3 }).format(value); }
function consumptionHeaders(magnitude: Magnitude) { return ["Inicio", "Fin", "ATR", ...Array.from({ length: 6 }, (_, index) => `P${index + 1}`), `${magnitude === "demand" ? "Máximo" : "Total"} ${MAGNITUDES[magnitude].unit}`, "Lectura"]; }
function consumptionCells(row: SipsConsumption, magnitude: Magnitude) { return [row.dateFrom, row.dateTo, formatTarifaAtr(row.tariff), ...row.magnitudes[magnitude].map((value) => value === null ? "" : formatNumber(value)), formatNumber(magnitude === "demand" ? row.totals.demandMax : row.totals[magnitude]), LECTURA_DESCRIPTIONS[row.readingType] ?? row.readingType]; }
function excelTsvCell(value: string, index: number) { const clean = value.replace(/[\t\r\n]+/g, " "); return (index === 2 || index === 10) && /^[=+\-@]/.test(clean) ? `'${clean}` : clean; }
function copyTextViaSelection(text: string) {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}
function formatTarifaAtr(value: string) { return TARIFA_ATR_DESCRIPTIONS[value] ?? value; }
function formatPsValue(key: string, value: string) { if (key === "codigoTensionV") return TENSION_V_DESCRIPTIONS[value] ?? value; if (key === "codigoTarifaATREnVigor") return formatTarifaAtr(value); if (PS_CODE_DESCRIPTIONS[key]) return PS_CODE_DESCRIPTIONS[key][value] ?? value; if (key.endsWith("W") || /EnWP\d$/.test(key)) { const number = Number(value); return value && Number.isFinite(number) ? `${formatNumber(number / 1000)} kW` : ""; } return value; }
function label(key: string) { return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/PS$/, " PS").replace(/EnW/g, " (W)").replace(/^codigo /i, "Código ").replace(/^des /i, "Descripción "); }
function readError(error: unknown) { return error instanceof Error ? error.message : "No se pudo completar la operación."; }
