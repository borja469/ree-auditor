import { type DragEvent, type ReactNode, useMemo, useState } from "react";
import {
  AlertTriangle,
  Clipboard,
  Database,
  Download,
  FileClock,
  FileDown,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
  X
} from "lucide-react";
import {
  deleteImportFile,
  getImportFileDetail,
  getImportFileErrorsCsv,
  getImportFileLogs,
  reprocessImportFile,
  type ImportHistoryDetail,
  type ImportHistoryLogs,
  type MedperFile,
  type MedperMonthlyConsumptionRow,
  type ReeFile,
  type ReeLossesImportFile
} from "../../api";
import type { ImportMode } from "../../app-shell/AppShellTypes";
import { downloadBlob } from "../../components/technical-data-table/TechnicalDataTableHelpers";

type UnifiedStatus = "correct" | "error" | "pending" | "incomplete" | "duplicated" | "warning";
type ReeDownloadModule = "REGANECU" | "MEDPER" | "K REE";
type SourceKind = "import" | "reeLosses" | "medperCoverage";

type UnifiedRow = {
  id: string;
  source: SourceKind;
  module: ReeDownloadModule;
  status: UnifiedStatus;
  type: string;
  periodKey: string;
  periodLabel: string;
  fileName: string;
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  duplicatedRecords: number;
  importedAt: string | null;
  user: string;
  observations: string;
  original?: ReeFile | MedperFile | ReeLossesImportFile;
};

type MonthlyCoverageRow = {
  month: string;
  medper: UnifiedStatus;
  reganecu: UnifiedStatus;
  reeLosses: UnifiedStatus;
};

type ActionModal = {
  title: string;
  content: ReactNode;
};

type ReeDownloadCenterProps = {
  reganecuFiles: ReeFile[];
  medperFiles: MedperFile[];
  medperMonthlyConsumption: MedperMonthlyConsumptionRow[];
  reeLossesImports: ReeLossesImportFile[];
  loading: boolean;
  files: File[];
  importMode: ImportMode;
  uploading: boolean;
  progress: number;
  disabled: boolean;
  onImportModeChange: (mode: ImportMode) => void;
  onSelectFiles: (files: FileList | null) => void;
  onRemoveFile: (index: number) => void;
  onUpload: () => void;
  onRefresh: () => Promise<void> | void;
};

const MODULE_OPTIONS: ReeDownloadModule[] = ["REGANECU", "MEDPER", "K REE"];
const STATUS_OPTIONS: UnifiedStatus[] = ["correct", "error", "pending", "incomplete", "duplicated", "warning"];
const REQUIRED_MEDPER_VERSIONS = ["C3", "C4", "C5"];

const STATUS_LABELS: Record<UnifiedStatus, string> = {
  correct: "Correcto",
  error: "Error",
  pending: "Pendiente",
  incomplete: "Incompleto",
  duplicated: "Duplicado",
  warning: "Advertencia"
};

export function ReeDownloadCenterModule({
  reganecuFiles,
  medperFiles,
  medperMonthlyConsumption,
  reeLossesImports,
  loading,
  files,
  importMode,
  uploading,
  progress,
  disabled,
  onImportModeChange,
  onSelectFiles,
  onRemoveFile,
  onUpload,
  onRefresh
}: ReeDownloadCenterProps) {
  const [dragging, setDragging] = useState(false);
  const [month, setMonth] = useState("");
  const [module, setModule] = useState<ReeDownloadModule | "">("");
  const [status, setStatus] = useState<UnifiedStatus | "">("");
  const [type, setType] = useState("");
  const [loadDate, setLoadDate] = useState("");
  const [query, setQuery] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [onlyDuplicated, setOnlyDuplicated] = useState(false);
  const [onlyPending, setOnlyPending] = useState(false);
  const [onlyLatestMonth, setOnlyLatestMonth] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ tone: "success" | "error" | "info"; text: string }>();
  const [actionModal, setActionModal] = useState<ActionModal>();

  const rows = useMemo(
    () => buildUnifiedRows(reganecuFiles, medperFiles, medperMonthlyConsumption, reeLossesImports),
    [medperFiles, medperMonthlyConsumption, reeLossesImports, reganecuFiles]
  );
  const latestMonth = useMemo(() => rows.map((row) => row.periodKey).filter(Boolean).sort().at(-1) ?? "", [rows]);
  const typeOptions = useMemo(() => [...new Set(rows.map((row) => row.type).filter(Boolean))].sort(), [rows]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      const haystack = [row.module, row.status, row.type, row.periodLabel, row.fileName, row.user, row.observations].join(" ").toLowerCase();
      if (normalizedQuery && !haystack.includes(normalizedQuery)) {
        return false;
      }
      if (module && row.module !== module) {
        return false;
      }
      if (status && row.status !== status) {
        return false;
      }
      if (type && row.type !== type) {
        return false;
      }
      if (month && row.periodKey !== month) {
        return false;
      }
      if (loadDate && row.importedAt?.slice(0, 10) !== loadDate) {
        return false;
      }
      if (onlyErrors && row.status !== "error" && row.invalidRecords === 0) {
        return false;
      }
      if (onlyDuplicated && row.status !== "duplicated" && row.duplicatedRecords === 0) {
        return false;
      }
      if (onlyPending && row.status !== "pending" && row.status !== "incomplete") {
        return false;
      }
      if (onlyLatestMonth && latestMonth && row.periodKey !== latestMonth) {
        return false;
      }
      return true;
    });
  }, [latestMonth, loadDate, module, month, onlyDuplicated, onlyErrors, onlyLatestMonth, onlyPending, query, rows, status, type]);

  const globalKpis = useMemo(() => buildGlobalKpis(rows), [rows]);
  const moduleKpis = useMemo(() => buildModuleKpis(rows), [rows]);
  const coverageRows = useMemo(() => buildMonthlyCoverageRows(rows).slice(0, 6), [rows]);

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (!disabled) {
      onSelectFiles(event.dataTransfer.files);
    }
  }

  function exportUnifiedRows() {
    const exportRows = filteredRows.map((row) => ({
      estado: STATUS_LABELS[row.status],
      modulo: row.module,
      tipo: row.type,
      periodo: row.periodLabel,
      archivo: row.fileName,
      registros: row.totalRecords,
      validos: row.validRecords,
      invalidos: row.invalidRecords,
      duplicados: row.duplicatedRecords,
      fechaCarga: formatDateTime(row.importedAt),
      usuario: row.user,
      observaciones: row.observations
    }));
    exportCsv("centro-descargas-ree.csv", exportRows);
  }

  async function runRowAction(row: UnifiedRow, action: () => Promise<void>) {
    setActionBusyId(row.id);
    setActionMessage(undefined);
    try {
      await action();
    } catch (error) {
      setActionMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo completar la acción." });
    } finally {
      setActionBusyId(null);
    }
  }

  function showDetail(row: UnifiedRow) {
    if (row.source !== "import") {
      setActionModal({
        title: `Detalle de carga - ${row.fileName}`,
        content: <StaticDetailModal row={row} />
      });
      return;
    }
    void runRowAction(row, async () => {
      const detail = await getImportFileDetail(row.original!.id);
      setActionModal({
        title: `Detalle de carga - ${row.fileName}`,
        content: <ImportDetailModalContent detail={detail} />
      });
    });
  }

  function downloadErrors(row: UnifiedRow) {
    if (row.source !== "import") {
      setActionMessage({ tone: "info", text: "K REE no dispone actualmente de endpoint de errores por carga." });
      return;
    }
    void runRowAction(row, async () => {
      const csv = await getImportFileErrorsCsv(row.original!.id);
      downloadBlob(`${safeExportName(row.fileName)}-errores.csv`, csv, "text/csv;charset=utf-8");
      setActionMessage({ tone: "success", text: `Errores de ${row.fileName} descargados.` });
    });
  }

  function downloadOriginal(row: UnifiedRow) {
    setActionMessage({
      tone: "info",
      text: `La descarga del fichero original no esta expuesta por los endpoints actuales para ${row.module}.`
    });
  }

  function reprocessRow(row: UnifiedRow) {
    if (row.source !== "import") {
      setActionMessage({ tone: "info", text: "K REE no dispone actualmente de reproceso por carga." });
      return;
    }
    if (!window.confirm(`Se reprocesara la carga ${row.fileName} y se sobrescribirán los datos anteriores. ¿Continuar?`)) {
      return;
    }
    void runRowAction(row, async () => {
      const response = await reprocessImportFile(row.original!.id);
      await onRefresh();
      setActionMessage({
        tone: response.summary.failedFiles > 0 ? "error" : "success",
        text: `Reprocesado ${row.fileName}: ${response.summary.recordsImported.toLocaleString("es-ES")} registros importados.`
      });
    });
  }

  function deleteRow(row: UnifiedRow) {
    if (row.source !== "import") {
      setActionMessage({ tone: "info", text: "K REE no dispone actualmente de eliminacion por carga." });
      return;
    }
    if (!window.confirm(`Se eliminara la carga ${row.fileName} y sus registros relacionados. ¿Continuar?`)) {
      return;
    }
    void runRowAction(row, async () => {
      await deleteImportFile(row.original!.id);
      await onRefresh();
      setActionMessage({ tone: "success", text: `Carga ${row.fileName} eliminada.` });
    });
  }

  function showLogs(row: UnifiedRow) {
    if (row.source !== "import") {
      setActionMessage({ tone: "info", text: "K REE no dispone actualmente de logs por carga." });
      return;
    }
    void runRowAction(row, async () => {
      const logs = await getImportFileLogs(row.original!.id);
      setActionModal({
        title: `Logs de carga - ${row.fileName}`,
        content: <ImportLogsModalContent logs={logs} />
      });
    });
  }

  return (
    <section className="ree-download-center">
      <div className="ops-hero">
        <div>
          <p className="ops-eyebrow">Liquidaciones REE</p>
          <h2>Centro de Descargas Liquidaciones REE</h2>
          <span>Consola operativa unica para cargas REGANECU, MEDPER y K REE.</span>
        </div>
        <div className="ops-hero-actions">
          <button className="ops-secondary-button" disabled={filteredRows.length === 0} onClick={exportUnifiedRows} type="button">
            <FileDown size={17} />
            Exportar cargas
          </button>
          <button className="ops-primary-button" disabled={loading} onClick={() => void onRefresh()} type="button">
            <RefreshCw size={16} />
            Actualizar
          </button>
        </div>
      </div>

      <label
        className={`ree-download-dropzone ${dragging ? "dragging" : ""} ${disabled ? "disabled" : ""}`}
        onDragEnter={() => !disabled && setDragging(true)}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <UploadCloud size={28} />
        <span>{files.length ? `${files.length} fichero(s) preparados` : "Soltar TXT, CSV, ZIP o ficheros Liquidaciones REE"}</span>
        <input
          disabled={disabled}
          multiple
          onChange={(event) => {
            onSelectFiles(event.target.files);
            event.currentTarget.value = "";
          }}
          type="file"
        />
      </label>

      <div className="ree-download-upload-actions">
        <div className="import-mode" aria-label="Tipo de importacion" role="group">
          <button className={importMode === "reganecu" ? "active" : ""} disabled={disabled} onClick={() => onImportModeChange("reganecu")} type="button">
            <Database size={15} />
            REGANECU
          </button>
          <button className={importMode === "medper" ? "active" : ""} disabled={disabled} onClick={() => onImportModeChange("medper")} type="button">
            <Clipboard size={15} />
            MEDPER
          </button>
          <button className={importMode === "reeLosses" ? "active" : ""} disabled={disabled} onClick={() => onImportModeChange("reeLosses")} type="button">
            <AlertTriangle size={15} />
            K REE
          </button>
        </div>
        {uploading && (
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        )}
        <button className="primary-button" disabled={disabled || files.length === 0} onClick={onUpload} type="button">
          <UploadCloud size={18} />
          {uploading ? "Importando" : "Importar"}
        </button>
      </div>

      {files.length > 0 && (
        <div className="ree-download-file-queue">
          {files.map((file, index) => (
            <span className="file-chip" key={`${file.name}-${file.size}-${file.lastModified}`}>
              {file.name}
              <button disabled={disabled} onClick={() => onRemoveFile(index)} type="button">
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="ree-command-summary">
        <div className="ree-summary-group">
          <span>Resumen operativo</span>
          <strong>{formatNumber(globalKpis.loads)} cargas</strong>
          <small>{formatNumber(globalKpis.records)} registros · Última carga {globalKpis.latestLoad ? formatDateTime(globalKpis.latestLoad) : "-"}</small>
        </div>
        <div className="ree-summary-group">
          <span>Salud de cargas</span>
          <strong>{formatNumber(globalKpis.correct)} correctas</strong>
          <small>{formatNumber(globalKpis.errors)} errores · {formatNumber(globalKpis.duplicated)} duplicadas · {formatNumber(globalKpis.pending)} pendientes</small>
        </div>
        <div className="ree-summary-group modules">
          <span>Estado de módulos</span>
          {moduleKpis.map((kpi) => (
            <small key={kpi.module}><b>{kpi.module}</b> {formatNumber(kpi.loads)} cargas · {formatNumber(kpi.errors)} errores</small>
          ))}
        </div>
      </div>

      <div className="ree-monthly-coverage" aria-label="Cobertura mensual Liquidaciones REE">
        <div className="ree-coverage-row header">
          <span>Mes</span>
          <span>MEDPER</span>
          <span>REGANECU</span>
          <span>K REE</span>
        </div>
        {coverageRows.length === 0 ? (
          <div className="ree-coverage-empty">Sin meses cargados.</div>
        ) : (
          coverageRows.map((row) => (
            <div className="ree-coverage-row" key={row.month}>
              <span>{formatMonth(row.month)}</span>
              <CoverageBadge status={row.medper} />
              <CoverageBadge status={row.reganecu} />
              <CoverageBadge status={row.reeLosses} />
            </div>
          ))
        )}
      </div>

      <div className="ops-filter-bar ree-download-filter-bar">
        <label className="ops-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Archivo, observaciones, usuario..." />
        </label>
        <select value={module} onChange={(event) => setModule(event.target.value as ReeDownloadModule | "")}>
          <option value="">Todos los modulos</option>
          {MODULE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value as UnifiedStatus | "")}>
          <option value="">Todos los estados</option>
          {STATUS_OPTIONS.map((item) => <option key={item} value={item}>{STATUS_LABELS[item]}</option>)}
        </select>
        <select value={type} onChange={(event) => setType(event.target.value)}>
          <option value="">Todos los tipos</option>
          {typeOptions.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <input aria-label="Periodo" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        <input aria-label="Fecha carga" type="date" value={loadDate} onChange={(event) => setLoadDate(event.target.value)} />
      </div>

      <div className="ree-download-quick-filters">
        <button className={onlyErrors ? "active" : ""} onClick={() => setOnlyErrors((current) => !current)} type="button">Solo errores</button>
        <button className={onlyDuplicated ? "active" : ""} onClick={() => setOnlyDuplicated((current) => !current)} type="button">Solo duplicados</button>
        <button className={onlyPending ? "active" : ""} onClick={() => setOnlyPending((current) => !current)} type="button">Solo pendientes</button>
        <button className={onlyLatestMonth ? "active" : ""} onClick={() => setOnlyLatestMonth((current) => !current)} type="button">Solo ultimo mes</button>
      </div>

      {actionMessage && <div className={`status-message ${actionMessage.tone}`}>{actionMessage.text}</div>}

      <div className="ops-table-panel ree-download-table-panel">
        <div className="ops-table-head">
          <div>
            <strong>Histórico unificado de cargas</strong>
            <span>{filteredRows.length} filas filtradas de {rows.length}</span>
          </div>
        </div>
        <div className="table-scroll">
          <table className="ree-download-table">
            <thead>
              <tr>
                <th>Estado</th>
                <th>Modulo</th>
                <th>Tipo</th>
                <th>Periodo</th>
                <th>Archivo</th>
                <th>Registros</th>
                <th>Válidos</th>
                <th>Invalidos</th>
                <th>Duplicados</th>
                <th>Fecha carga</th>
                <th>Usuario</th>
                <th>Observaciones</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={13}>
                    <div className="empty-state">Sin cargas de Liquidaciones REE para los filtros seleccionados.</div>
                  </td>
                </tr>
              )}
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td><StatusBadge status={row.status} /></td>
                  <td>{row.module}</td>
                  <td>{row.type}</td>
                  <td>{row.periodLabel}</td>
                  <td className="ops-file-cell" title={row.fileName}>{row.fileName}</td>
                  <td className="ops-number-cell">{formatNumber(row.totalRecords)}</td>
                  <td className="ops-number-cell good">{formatNumber(row.validRecords)}</td>
                  <td className={`ops-number-cell ${row.invalidRecords > 0 ? "danger" : ""}`}>{formatNumber(row.invalidRecords)}</td>
                  <td className={`ops-number-cell ${row.duplicatedRecords > 0 ? "warning" : ""}`}>{formatNumber(row.duplicatedRecords)}</td>
                  <td>{formatDateTime(row.importedAt)}</td>
                  <td>{row.user}</td>
                  <td>{row.observations}</td>
                  <td>
                    <span className="ops-action-cell">
                      <button disabled={actionBusyId === row.id} onClick={() => showDetail(row)} title="Ver detalle" type="button"><Clipboard size={15} /></button>
                      <button disabled={actionBusyId === row.id} onClick={() => downloadOriginal(row)} title="Descargar fichero original" type="button"><Download size={15} /></button>
                      <button disabled={actionBusyId === row.id} onClick={() => reprocessRow(row)} title="Reprocesar" type="button"><RefreshCw size={15} /></button>
                      <button disabled={actionBusyId === row.id} onClick={() => downloadErrors(row)} title="Ver/descargar errores" type="button"><FileDown size={15} /></button>
                      <button disabled={actionBusyId === row.id} onClick={() => deleteRow(row)} title="Eliminar" type="button"><Trash2 size={15} /></button>
                      <button disabled={actionBusyId === row.id} onClick={() => showLogs(row)} title="Trazabilidad / logs" type="button"><FileClock size={15} /></button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {actionModal && (
        <ActionModal title={actionModal.title} onClose={() => setActionModal(undefined)}>
          {actionModal.content}
        </ActionModal>
      )}
    </section>
  );
}

function buildUnifiedRows(
  reganecuFiles: ReeFile[],
  medperFiles: MedperFile[],
  medperMonthlyConsumption: MedperMonthlyConsumptionRow[],
  reeLossesImports: ReeLossesImportFile[]
): UnifiedRow[] {
  return [
    ...reganecuFiles.map((file) => importFileRow(file, "REGANECU")),
    ...medperFiles.map((file) => importFileRow(file, "MEDPER")),
    ...reeLossesImports.map(reeLossesRow),
    ...medperCoverageRows(medperMonthlyConsumption)
  ].sort(compareRows);
}

function importFileRow(file: ReeFile | MedperFile, module: "REGANECU" | "MEDPER"): UnifiedRow {
  const periodStart = "fechaLiquidacion" in file ? file.fechaLiquidacion : file.fechaInicio;
  return {
    id: `${module}-${file.id}`,
    source: "import",
    module,
    status: importStatus(file),
    type: file.tipoArchivo,
    periodKey: toMonthKey(periodStart),
    periodLabel: "fechaLiquidacion" in file ? formatDate(file.fechaLiquidacion) : `${formatDate(file.fechaInicio)} - ${formatDate(file.fechaFin)}`,
    fileName: file.fileName,
    totalRecords: file.totalRecords,
    validRecords: file.validRecords,
    invalidRecords: file.invalidRecords,
    duplicatedRecords: file.duplicatedRecords,
    importedAt: file.importedAt,
    user: "-",
    observations: file.errorMessage ?? fileObservation(file),
    original: file
  };
}

function reeLossesRow(file: ReeLossesImportFile): UnifiedRow {
  return {
    id: `KREE-${file.id}`,
    source: "reeLosses",
    module: "K REE",
    status: importStatus(file),
    type: file.tipoArchivo ?? "K REE",
    periodKey: toMonthKey(file.fechaInicio ?? file.fechaFin ?? file.importedAt),
    periodLabel: file.fechaInicio && file.fechaFin ? `${formatDate(file.fechaInicio)} - ${formatDate(file.fechaFin)}` : formatDate(file.fechaInicio ?? file.fechaFin),
    fileName: file.fileName,
    totalRecords: file.totalRecords,
    validRecords: file.validRecords,
    invalidRecords: file.invalidRecords,
    duplicatedRecords: file.duplicatedRecords,
    importedAt: file.importedAt,
    user: "-",
    observations: file.errorMessage ?? fileObservation(file),
    original: file
  };
}

function medperCoverageRows(rows: MedperMonthlyConsumptionRow[]): UnifiedRow[] {
  const byMonth = new Map<string, MedperMonthlyConsumptionRow[]>();
  for (const row of rows) {
    const monthRows = byMonth.get(row.month) ?? [];
    monthRows.push(row);
    byMonth.set(row.month, monthRows);
  }
  return [...byMonth.entries()].map(([month, monthRows]) => {
    const loadedVersions = REQUIRED_MEDPER_VERSIONS.filter((version) => monthRows.some((row) => row.version === version && row.hasData));
    const missingVersions = REQUIRED_MEDPER_VERSIONS.filter((version) => !loadedVersions.includes(version));
    return {
      id: `MEDPER-COVERAGE-${month}`,
      source: "medperCoverage",
      module: "MEDPER",
      status: loadedVersions.length === REQUIRED_MEDPER_VERSIONS.length ? "correct" : loadedVersions.length === 0 ? "pending" : "incomplete",
      type: "Cobertura C3/C4/C5",
      periodKey: month,
      periodLabel: formatMonth(month),
      fileName: "Resumen mensual de medidas",
      totalRecords: loadedVersions.length,
      validRecords: loadedVersions.length,
      invalidRecords: 0,
      duplicatedRecords: 0,
      importedAt: null,
      user: "-",
      observations: missingVersions.length === 0 ? "C3, C4 y C5 cargadas" : `Falta ${missingVersions.join(", ")}`
    };
  });
}

function importStatus(file: ReeFile | MedperFile | ReeLossesImportFile): UnifiedStatus {
  if (file.status === "FAILED") {
    return "error";
  }
  if (file.status === "DUPLICATED") {
    return "duplicated";
  }
  if (file.invalidRecords > 0) {
    return "warning";
  }
  if (file.duplicatedRecords > 0) {
    return "duplicated";
  }
  return "correct";
}

function fileObservation(file: ReeFile | MedperFile | ReeLossesImportFile) {
  if (file.status === "DUPLICATED") {
    return "Carga duplicada";
  }
  if (file.invalidRecords > 0 || file.duplicatedRecords > 0) {
    return `${formatNumber(file.invalidRecords)} invalidos / ${formatNumber(file.duplicatedRecords)} duplicados`;
  }
  return file.containerFileName ? `Origen: ${file.containerFileName}` : "Carga importada";
}

function buildGlobalKpis(rows: UnifiedRow[]) {
  const importedRows = rows.filter((row) => row.source !== "medperCoverage");
  return {
    loads: importedRows.length,
    records: importedRows.reduce((sum, row) => sum + row.totalRecords, 0),
    correct: importedRows.filter((row) => row.status === "correct").length,
    errors: importedRows.filter((row) => row.status === "error" || row.invalidRecords > 0).length,
    duplicated: importedRows.filter((row) => row.status === "duplicated" || row.duplicatedRecords > 0).length,
    pending: rows.filter((row) => row.status === "pending" || row.status === "incomplete").length,
    latestLoad: importedRows.map((row) => row.importedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null
  };
}

function buildModuleKpis(rows: UnifiedRow[]) {
  return MODULE_OPTIONS.map((module) => {
    const moduleRows = rows.filter((row) => row.module === module && row.source !== "medperCoverage");
    return {
      module,
      loads: moduleRows.length,
      records: moduleRows.reduce((sum, row) => sum + row.totalRecords, 0),
      errors: moduleRows.filter((row) => row.status === "error" || row.invalidRecords > 0).length
    };
  });
}

function buildMonthlyCoverageRows(rows: UnifiedRow[]): MonthlyCoverageRow[] {
  const months = [...new Set(rows.map((row) => row.periodKey).filter(Boolean))].sort((left, right) => right.localeCompare(left));
  return months.map((month) => ({
    month,
    medper: coverageStatus(rows.filter((row) => row.periodKey === month && row.module === "MEDPER")),
    reganecu: coverageStatus(rows.filter((row) => row.periodKey === month && row.module === "REGANECU")),
    reeLosses: coverageStatus(rows.filter((row) => row.periodKey === month && row.module === "K REE"))
  }));
}

function coverageStatus(rows: UnifiedRow[]): UnifiedStatus {
  if (rows.length === 0) {
    return "pending";
  }
  if (rows.some((row) => row.status === "error")) {
    return "error";
  }
  if (rows.some((row) => row.status === "pending" || row.status === "incomplete")) {
    return "incomplete";
  }
  return "correct";
}

function compareRows(left: UnifiedRow, right: UnifiedRow) {
  const leftTime = left.importedAt ? new Date(left.importedAt).getTime() : 0;
  const rightTime = right.importedAt ? new Date(right.importedAt).getTime() : 0;
  return rightTime - leftTime || right.periodKey.localeCompare(left.periodKey) || left.module.localeCompare(right.module);
}

function StatusBadge({ status }: { status: UnifiedStatus }) {
  return <span className={`ops-status-badge ${statusClass(status)}`}>{STATUS_LABELS[status]}</span>;
}

function CoverageBadge({ status }: { status: UnifiedStatus }) {
  const label = status === "pending" ? "Sin datos" : status === "incomplete" ? "Incompleto" : status === "correct" ? "Completo" : STATUS_LABELS[status];
  return <span className={`ops-status-badge ${statusClass(status)}`}>{label}</span>;
}

function statusClass(status: UnifiedStatus) {
  if (status === "correct") {
    return "valid";
  }
  if (status === "error") {
    return "error";
  }
  if (status === "pending") {
    return "processing";
  }
  if (status === "duplicated" || status === "warning" || status === "incomplete") {
    return "partial";
  }
  return "muted";
}

function ActionModal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="ops-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="ops-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="ops-modal-head">
          <strong>{title}</strong>
          <button onClick={onClose} title="Cerrar" type="button">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StaticDetailModal({ row }: { row: UnifiedRow }) {
  return (
    <div className="ops-modal-body">
      <div className="ops-detail-grid">
        <Metric label="Estado" value={STATUS_LABELS[row.status]} />
        <Metric label="Modulo" value={row.module} />
        <Metric label="Tipo" value={row.type} />
        <Metric label="Periodo" value={row.periodLabel} />
        <Metric label="Registros" value={formatNumber(row.totalRecords)} />
        <Metric label="Válidos" value={formatNumber(row.validRecords)} />
        <Metric label="Invalidos" value={formatNumber(row.invalidRecords)} />
        <Metric label="Duplicados" value={formatNumber(row.duplicatedRecords)} />
      </div>
      <div className="ops-modal-section">
        <strong>Observaciones</strong>
        <span>{row.observations}</span>
      </div>
    </div>
  );
}

function ImportDetailModalContent({ detail }: { detail: ImportHistoryDetail }) {
  const file = detail.file;
  const previewColumns = detail.preview[0] ? Object.keys(detail.preview[0]) : [];
  return (
    <div className="ops-modal-body">
      <div className="ops-detail-grid">
        <Metric label="Estado" value={file.status} />
        <Metric label="Tipo fichero" value={file.tipoArchivo} />
        <Metric label="Version" value={file.version} />
        <Metric label="Registros" value={formatNumber(file.totalRecords)} />
        <Metric label="Persistidos" value={formatNumber(detail.recordCounts.total)} />
        <Metric label="Válidos" value={formatNumber(file.validRecords)} />
        <Metric label="Invalidos" value={formatNumber(file.invalidRecords)} />
        <Metric label="Duplicados" value={formatNumber(file.duplicatedRecords)} />
        <Metric label="Carga" value={formatDateTime(file.importedAt)} />
      </div>
      <div className="ops-modal-section">
        <strong>Errores detectados</strong>
        {detail.errors.length === 0 ? (
          <span>No hay errores almacenados para esta carga.</span>
        ) : (
          <div className="ops-error-preview">
            {detail.errors.slice(0, 8).map((error, index) => (
              <div key={`${error.sourceFileName}-${error.lineNumber}-${index}`}>
                <b>Linea {error.lineNumber}</b>
                <span>{error.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="ops-modal-section">
        <strong>Primeros registros</strong>
        {previewColumns.length === 0 ? (
          <span>No hay registros persistidos para previsualizar.</span>
        ) : (
          <div className="ops-preview-table">
            <div className="ops-preview-row header">
              {previewColumns.map((column) => <span key={column}>{column}</span>)}
            </div>
            {detail.preview.map((row, index) => (
              <div className="ops-preview-row" key={index}>
                {previewColumns.map((column) => <span key={column}>{formatActionValue(row[column])}</span>)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ImportLogsModalContent({ logs }: { logs: ImportHistoryLogs }) {
  return (
    <div className="ops-modal-body">
      <pre className="ops-log-box">{logs.text}</pre>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function exportCsv<T extends object>(name: string, rows: T[]) {
  if (rows.length === 0) {
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(";"), ...rows.map((row) => headers.map((header) => csvCell(row[header as keyof T])).join(";"))];
  downloadBlob(name, lines.join("\n"), "text/csv;charset=utf-8");
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

function safeExportName(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "carga";
}

function formatActionValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function toMonthKey(value?: string | null) {
  return value?.slice(0, 7) ?? "";
}

function formatMonth(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match ? `${match[2]}/${match[1]}` : "-";
}

function formatDate(value?: string | null) {
  if (!value) {
    return "-";
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatNumber(value: number) {
  return value.toLocaleString("es-ES");
}
