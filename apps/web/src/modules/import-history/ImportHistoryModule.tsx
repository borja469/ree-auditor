import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Database,
  FileClock,
  FileDown,
  FileSpreadsheet,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  UploadCloud,
  X
} from "lucide-react";
import type { ImportHistoryDetail, ImportHistoryLogs, ImportResponse } from "../../api";
import { deleteImportFile, getImportFileDetail, getImportFileErrorsCsv, getImportFileLogs, reprocessImportFile } from "../../api";
import type { ImportHistoryFile, LoadSortKey, LoadStatus, Message } from "../../app-shell/AppShellTypes";
import { downloadBlob } from "../../components/technical-data-table/TechnicalDataTableHelpers";
import {
  buildImportHistoryCharts,
  compareLoads,
  exportLoadCsv,
  formatActionValue,
  formatDateTime,
  formatMonthKeyLabel,
  formatNumber,
  getHistoryPeriodKey,
  getHistoryPeriodLabel,
  getLoadStatus,
  qualityLabel,
  safeExportName
} from "./ImportHistoryHelpers";
import type { HistoryViewProps, ImportHistoryDashboardViewProps } from "./ImportHistoryTypes";
export function HistoryView({
  files,
  latestImport,
  onRefresh
}: HistoryViewProps) {
  return <ImportHistoryDashboardView files={files} latestImport={latestImport} mode="reganecu" onRefresh={onRefresh} />;
}

export function ImportHistoryDashboardView({
  files,
  latestImport,
  mode,
  onRefresh
}: ImportHistoryDashboardViewProps) {
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState("");
  const [loadDate, setLoadDate] = useState("");
  const [period, setPeriod] = useState("");
  const [agent, setAgent] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [onlyDuplicates, setOnlyDuplicates] = useState(false);
  const [compact, setCompact] = useState(true);
  const [cardMode, setCardMode] = useState(false);
  const [sortKey, setSortKey] = useState<LoadSortKey>("importedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [tablePage, setTablePage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [actionMessage, setActionMessage] = useState<Message>();
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [actionModal, setActionModal] = useState<{
    title: string;
    content: ReactNode;
  }>();

  const versionOptions = useMemo(() => [...new Set(files.map((file) => file.version))].sort(), [files]);
  const filteredFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const result = files.filter((file) => {
      const filePeriod = getHistoryPeriodKey(file);
      const importedDate = file.importedAt.slice(0, 10);
      const haystack = [file.fileName, file.tipoArchivo, file.version, file.sujetoEic, filePeriod, importedDate].join(" ").toLowerCase();
      if (normalizedQuery && !haystack.includes(normalizedQuery)) {
        return false;
      }
      if (version && file.version !== version) {
        return false;
      }
      if (loadDate && importedDate !== loadDate) {
        return false;
      }
      if (period && filePeriod !== period) {
        return false;
      }
      if (agent && !file.sujetoEic.toLowerCase().includes(agent.toLowerCase())) {
        return false;
      }
      if (onlyErrors && file.invalidRecords === 0 && file.status !== "FAILED") {
        return false;
      }
      if (onlyDuplicates && file.duplicatedRecords === 0 && file.status !== "DUPLICATED") {
        return false;
      }
      return true;
    });

    return result.sort((left, right) => compareLoads(left, right, sortKey, sortDirection));
  }, [agent, files, loadDate, onlyDuplicates, onlyErrors, period, query, sortDirection, sortKey, version]);
  const tablePageSize = compact ? 12 : 8;
  const pagedFiles = filteredFiles.slice(tablePage * tablePageSize, tablePage * tablePageSize + tablePageSize);
  const pageCount = Math.max(Math.ceil(filteredFiles.length / tablePageSize), 1);
  const selectedCount = [...selectedIds].filter((id) => filteredFiles.some((file) => file.id === id)).length;
  const kpis = buildImportHistoryKpis(files, latestImport);
  const chartData = buildImportHistoryCharts(files);
  const copy = mode === "reganecu"
    ? {
        eyebrow: "REGANECU ï¿½ Histï¿½rico",
        title: "Consola operativa de cargas REGANECU",
        description: "Supervisiï¿½n de ficheros horarios y cuartohorarios, calidad de datos y trazabilidad de cargas.",
        importHint: "Arrastra TXT, CSV o ZIP en la zona superior de la aplicaciï¿½n. La validaciï¿½n bloquea duplicados por tipo, fecha y versiï¿½n.",
        tableTitle: "Cargas REGANECU",
        empty: "Sin cargas REGANECU con los filtros seleccionados.",
        exportName: "cargas-reganecu.csv"
      }
    : {
        eyebrow: "MEDPERQH ï¿½ Histï¿½rico",
        title: "Consola operativa de cargas de medidas",
        description: "Supervisiï¿½n de ficheros MEDPERQH, calidad de medida y trazabilidad de cargas cuartohorarias.",
        importHint: "Arrastra TXT, CSV o ZIP en la zona superior de la aplicaciï¿½n. La validaciï¿½n bloquea duplicados por tipo, fecha y versiï¿½n.",
        tableTitle: "Cargas MEDPERQH",
        empty: "Sin cargas MEDPERQH con los filtros seleccionados.",
        exportName: "cargas-medidas.csv"
      };

  useEffect(() => {
    if (tablePage > pageCount - 1) {
      setTablePage(Math.max(pageCount - 1, 0));
    }
  }, [pageCount, tablePage]);

  function toggleSort(nextKey: LoadSortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      setSortDirection(nextKey === "fileName" || nextKey === "status" || nextKey === "type" ? "asc" : "desc");
    }
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function togglePageSelection(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const file of pagedFiles) {
        if (checked) {
          next.add(file.id);
        } else {
          next.delete(file.id);
        }
      }
      return next;
    });
  }

  function resetFilters() {
    setQuery("");
    setVersion("");
    setLoadDate("");
    setPeriod("");
    setAgent("");
    setOnlyErrors(false);
    setOnlyDuplicates(false);
    setTablePage(0);
  }

  async function runHistoryAction(file: ImportHistoryFile, action: () => Promise<void>) {
    setActionBusyId(file.id);
    setActionMessage(undefined);
    try {
      await action();
    } catch (error) {
      setActionMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo completar la accion." });
    } finally {
      setActionBusyId(null);
    }
  }

  function showDetail(file: ImportHistoryFile) {
    void runHistoryAction(file, async () => {
      const detail = await getImportFileDetail(file.id);
      setActionModal({
        title: `Detalle de carga ï¿½ ${file.fileName}`,
        content: <ImportDetailModalContent detail={detail} />
      });
    });
  }

  function downloadErrors(file: ImportHistoryFile) {
    void runHistoryAction(file, async () => {
      const csv = await getImportFileErrorsCsv(file.id);
      downloadBlob(`${safeExportName(file.fileName)}-errores.csv`, csv, "text/csv;charset=utf-8");
      setActionMessage({ tone: "success", text: `Errores de ${file.fileName} descargados.` });
    });
  }

  function reprocessFile(file: ImportHistoryFile) {
    if (!window.confirm(`Se reprocesara la carga ${file.fileName} y se sobrescribiran los datos anteriores. ï¿½Continuar?`)) {
      return;
    }

    void runHistoryAction(file, async () => {
      const response = await reprocessImportFile(file.id);
      await onRefresh?.();
      setActionMessage({
        tone: response.summary.failedFiles > 0 ? "error" : "success",
        text: `Reprocesado ${file.fileName}: ${response.summary.recordsImported.toLocaleString("es-ES")} registros importados.`
      });
    });
  }

  function deleteFile(file: ImportHistoryFile) {
    if (!window.confirm(`Se eliminara la carga ${file.fileName} y sus registros relacionados. ï¿½Continuar?`)) {
      return;
    }

    void runHistoryAction(file, async () => {
      await deleteImportFile(file.id);
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(file.id);
        return next;
      });
      await onRefresh?.();
      setActionMessage({ tone: "success", text: `Carga ${file.fileName} eliminada.` });
    });
  }

  function showLogs(file: ImportHistoryFile) {
    void runHistoryAction(file, async () => {
      const logs = await getImportFileLogs(file.id);
      setActionModal({
        title: `Logs de carga ï¿½ ${file.fileName}`,
        content: <ImportLogsModalContent logs={logs} />
      });
    });
  }

  return (
    <section className="ops-dashboard">
      <div className="ops-hero">
        <div>
          <p className="ops-eyebrow">{copy.eyebrow}</p>
          <h2>{copy.title}</h2>
          <span>{copy.description}</span>
        </div>
        <div className="ops-hero-actions">
          <button className="ops-primary-button" onClick={() => exportLoadCsv(copy.exportName, filteredFiles)} type="button">
            <FileDown size={17} />
            Exportar cargas
          </button>
        </div>
      </div>

      <div className="ops-kpi-grid">
        {kpis.map((kpi) => (
          <div className={`ops-kpi-card ${kpi.tone}`} key={kpi.label}>
            <div className="ops-kpi-icon">{kpi.icon}</div>
            <span>{kpi.label}</span>
            <strong>{kpi.value}</strong>
            <small>{kpi.detail}</small>
          </div>
        ))}
      </div>

      <div className="ops-workbench">
        <div className="ops-drop-panel">
          <div className="ops-drop-icon">
            <UploadCloud size={24} />
          </div>
          <div>
            <strong>Importaciï¿½n rï¿½pida</strong>
            <span>{copy.importHint}</span>
          </div>
          <div className="ops-progress-track">
            <span style={{ width: `${Math.min(100, Math.max(8, latestImport ? 100 : 18))}%` }} />
          </div>
          <small>{latestImport ? `${latestImport.summary.recordsImported} registros en la ï¿½ltima carga` : "Sin carga reciente en esta sesiï¿½n"}</small>
        </div>
        <OpsMiniChart title="Evoluciï¿½n cargas" rows={chartData.monthlyLoads} valueLabel="cargas" tone="cyan" />
        <OpsMiniChart title="Invï¿½lidos por mes" rows={chartData.monthlyInvalids} valueLabel="incidencias" tone="rose" />
        <OpsMiniChart title="Volumen por tipo" rows={chartData.byVersion} valueLabel="registros" tone="emerald" />
      </div>

      <div className="ops-filter-bar">
        <label className="ops-search">
          <Search size={16} />
          <input value={query} onChange={(event) => { setQuery(event.target.value); setTablePage(0); }} placeholder="Buscar archivo, agente, periodo..." />
        </label>
        <select value={version} onChange={(event) => { setVersion(event.target.value); setTablePage(0); }}>
          <option value="">Todas las versiones</option>
          {versionOptions.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <input type="date" value={loadDate} onChange={(event) => { setLoadDate(event.target.value); setTablePage(0); }} />
        <input value={period} onChange={(event) => { setPeriod(event.target.value); setTablePage(0); }} placeholder="Periodo YYYY-MM" />
        <input value={agent} onChange={(event) => { setAgent(event.target.value); setTablePage(0); }} placeholder="Agente/distribuidora" />
        <button className={onlyErrors ? "active" : ""} onClick={() => { setOnlyErrors((current) => !current); setTablePage(0); }} type="button">Solo errores</button>
        <button className={onlyDuplicates ? "active" : ""} onClick={() => { setOnlyDuplicates((current) => !current); setTablePage(0); }} type="button">Solo duplicados</button>
        <button onClick={resetFilters} type="button">
          <RotateCcw size={15} />
        </button>
      </div>

      {actionMessage && <div className={`status-message ${actionMessage.tone} ops-action-message`}>{actionMessage.text}</div>}

      <div className="ops-table-panel">
        <div className="ops-table-head">
          <div>
            <strong>{copy.tableTitle}</strong>
            <span>{filteredFiles.length} ficheros filtrados ï¿½ {selectedCount} seleccionados</span>
          </div>
          <div className="ops-view-toggle">
            <button className={compact ? "active" : ""} onClick={() => setCompact(true)} type="button">Compacto</button>
            <button className={!compact ? "active" : ""} onClick={() => setCompact(false)} type="button">Cï¿½modo</button>
            <button className={cardMode ? "active" : ""} onClick={() => setCardMode((current) => !current)} type="button">Tarjetas</button>
          </div>
        </div>

        {cardMode ? (
          <div className="ops-card-grid">
            {pagedFiles.map((file) => (
              <OpsLoadCard file={file} key={file.id} />
            ))}
            {pagedFiles.length === 0 && <div className="ops-empty">{copy.empty}</div>}
          </div>
        ) : (
          <OpsLoadsTable
            compact={compact}
            files={pagedFiles}
            selectedIds={selectedIds}
            sortDirection={sortDirection}
            sortKey={sortKey}
            onSort={toggleSort}
            onToggleAll={togglePageSelection}
            onToggleRow={toggleSelection}
            actionBusyId={actionBusyId}
            onDetail={showDetail}
            onDownloadErrors={downloadErrors}
            onReprocess={reprocessFile}
            onDelete={deleteFile}
            onLogs={showLogs}
            emptyText={copy.empty}
          />
        )}

        <div className="ops-pagination">
          <span>Pï¿½gina {tablePage + 1} de {pageCount}</span>
          <button disabled={tablePage === 0} onClick={() => setTablePage((current) => Math.max(0, current - 1))} type="button">
            <ChevronLeft size={16} />
          </button>
          <button disabled={tablePage >= pageCount - 1} onClick={() => setTablePage((current) => Math.min(pageCount - 1, current + 1))} type="button">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {actionModal && (
        <ImportActionModal title={actionModal.title} onClose={() => setActionModal(undefined)}>
          {actionModal.content}
        </ImportActionModal>
      )}
    </section>
  );
}

function OpsMiniChart({
  title,
  rows,
  valueLabel,
  tone
}: {
  title: string;
  rows: Array<{ label: string; value: number }>;
  valueLabel: string;
  tone: "cyan" | "emerald" | "rose";
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <div className={`ops-chart-card ${tone}`}>
      <div className="ops-chart-title">
        <strong>{title}</strong>
        <span>{rows.reduce((sum, row) => sum + row.value, 0).toLocaleString("es-ES")} {valueLabel}</span>
      </div>
      <div className="ops-bars">
        {rows.length === 0 && <small>Sin datos</small>}
        {rows.map((row) => (
          <div className="ops-bar-row" key={row.label}>
            <span>{row.label}</span>
            <div><i style={{ width: `${Math.max((row.value / max) * 100, row.value > 0 ? 4 : 0)}%` }} /></div>
            <small>{row.value.toLocaleString("es-ES")}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function OpsLoadsTable({
  files,
  compact,
  emptyText,
  selectedIds,
  sortKey,
  sortDirection,
  onSort,
  onToggleAll,
  onToggleRow,
  actionBusyId,
  onDetail,
  onDownloadErrors,
  onReprocess,
  onDelete,
  onLogs
}: {
  files: ImportHistoryFile[];
  compact: boolean;
  emptyText: string;
  selectedIds: Set<string>;
  sortKey: LoadSortKey;
  sortDirection: "asc" | "desc";
  onSort: (key: LoadSortKey) => void;
  onToggleAll: (checked: boolean) => void;
  onToggleRow: (id: string) => void;
  actionBusyId: string | null;
  onDetail: (file: ImportHistoryFile) => void;
  onDownloadErrors: (file: ImportHistoryFile) => void;
  onReprocess: (file: ImportHistoryFile) => void;
  onDelete: (file: ImportHistoryFile) => void;
  onLogs: (file: ImportHistoryFile) => void;
}) {
  const allSelected = files.length > 0 && files.every((file) => selectedIds.has(file.id));
  const header = [
    { key: "status" as const, label: "Estado" },
    { key: "type" as const, label: "Tipo" },
    { key: "period" as const, label: "Periodo" },
    { key: "fileName" as const, label: "Archivo" },
    { key: "totalRecords" as const, label: "Registros" },
    { key: "validRecords" as const, label: "Vï¿½lidos" },
    { key: "invalidRecords" as const, label: "Invï¿½lidos" },
    { key: "duplicatedRecords" as const, label: "Duplicados" },
    { key: "importedAt" as const, label: "Fecha carga" }
  ];

  return (
    <div className={`ops-load-table ${compact ? "compact" : ""}`}>
      <div className="ops-load-row ops-load-header">
        <span className="ops-select-cell">
          <input checked={allSelected} onChange={(event) => onToggleAll(event.currentTarget.checked)} type="checkbox" />
        </span>
        {header.map((column) => (
          <button className={sortKey === column.key ? "sorted" : ""} key={column.key} onClick={() => onSort(column.key)} type="button">
            {column.label}
            {sortKey === column.key && <small>{sortDirection === "asc" ? "?" : "?"}</small>}
          </button>
        ))}
        <span>Acciones</span>
      </div>
      {files.map((file) => (
        <div className="ops-load-row" key={file.id}>
          <span className="ops-select-cell">
            <input checked={selectedIds.has(file.id)} onChange={() => onToggleRow(file.id)} type="checkbox" />
          </span>
          <span><LoadStatusBadge status={getLoadStatus(file)} /></span>
          <span>{file.version}</span>
          <span>{getHistoryPeriodLabel(file)}</span>
          <span className="ops-file-cell" title={file.fileName}>{file.fileName}</span>
          <span className="ops-number-cell">{file.totalRecords.toLocaleString("es-ES")}</span>
          <span className="ops-number-cell good">{file.validRecords.toLocaleString("es-ES")}</span>
          <span className="ops-number-cell danger">{file.invalidRecords.toLocaleString("es-ES")}</span>
          <span className="ops-number-cell warning">{file.duplicatedRecords.toLocaleString("es-ES")}</span>
          <span>{formatDateTime(file.importedAt)}</span>
          <span className="ops-action-cell">
            <button disabled={actionBusyId === file.id} onClick={() => onDetail(file)} title="Ver detalle" type="button"><Clipboard size={15} /></button>
            <button disabled={actionBusyId === file.id} onClick={() => onDownloadErrors(file)} title="Descargar errores" type="button"><FileDown size={15} /></button>
            <button disabled={actionBusyId === file.id} onClick={() => onReprocess(file)} title="Reprocesar" type="button"><RefreshCw size={15} /></button>
            <button disabled={actionBusyId === file.id} onClick={() => onDelete(file)} title="Eliminar" type="button"><Trash2 size={15} /></button>
            <button disabled={actionBusyId === file.id} onClick={() => onLogs(file)} title="Ver logs" type="button"><FileClock size={15} /></button>
            <button disabled title="Comparar: endpoint pendiente" type="button"><FileSpreadsheet size={15} /></button>
          </span>
        </div>
      ))}
      {files.length === 0 && <div className="ops-empty">{emptyText}</div>}
    </div>
  );
}

function ImportActionModal({
  title,
  children,
  onClose
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
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

function ImportDetailModalContent({ detail }: { detail: ImportHistoryDetail }) {
  const file = detail.file;
  const previewColumns = detail.preview[0] ? Object.keys(detail.preview[0]) : [];

  return (
    <div className="ops-modal-body">
      <div className="ops-detail-grid">
        <Metric label="Estado" value={file.status} />
        <Metric label="Tipo fichero" value={file.tipoArchivo} />
        <Metric label="Versiï¿½n" value={file.version} />
        <Metric label="Periodo" value={getHistoryPeriodLabel(file)} />
        <Metric label="Registros" value={file.totalRecords.toLocaleString("es-ES")} />
        <Metric label="Persistidos" value={detail.recordCounts.total.toLocaleString("es-ES")} />
        <Metric label="Vï¿½lidos" value={file.validRecords.toLocaleString("es-ES")} />
        <Metric label="Invï¿½lidos" value={file.invalidRecords.toLocaleString("es-ES")} />
        <Metric label="Duplicados" value={file.duplicatedRecords.toLocaleString("es-ES")} />
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
                <b>Lï¿½nea {error.lineNumber}</b>
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
              {previewColumns.map((column) => (
                <span key={column}>{column}</span>
              ))}
            </div>
            {detail.preview.map((row, index) => (
              <div className="ops-preview-row" key={index}>
                {previewColumns.map((column) => (
                  <span key={column}>{formatActionValue(row[column])}</span>
                ))}
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

function OpsLoadCard({ file }: { file: ImportHistoryFile }) {
  return (
    <article className="ops-load-card">
      <div>
        <LoadStatusBadge status={getLoadStatus(file)} />
        <strong>{file.fileName}</strong>
        <span>{file.version} ï¿½ {file.tipoArchivo} ï¿½ {getHistoryPeriodLabel(file)} ï¿½ {file.sujetoEic}</span>
      </div>
      <div className="ops-load-card-metrics">
        <span>{file.totalRecords.toLocaleString("es-ES")} total</span>
        <span className="good">{file.validRecords.toLocaleString("es-ES")} vï¿½lidos</span>
        <span className="danger">{file.invalidRecords.toLocaleString("es-ES")} invï¿½lidos</span>
        <span className="warning">{file.duplicatedRecords.toLocaleString("es-ES")} dup.</span>
      </div>
    </article>
  );
}

function LoadStatusBadge({ status }: { status: LoadStatus }) {
  const label = status === "valid" ? "Validado" : status === "partial" ? "Parcial" : status === "error" ? "Error" : "Procesando";
  return <span className={`ops-status-badge ${status}`}>{label}</span>;
}

function buildImportHistoryKpis(files: ImportHistoryFile[], latestImport?: { summary: ImportResponse["summary"] }) {
  const totals = files.reduce(
    (acc, file) => ({
      records: acc.records + file.totalRecords,
      valid: acc.valid + file.validRecords,
      invalid: acc.invalid + file.invalidRecords,
      duplicated: acc.duplicated + file.duplicatedRecords
    }),
    { records: 0, valid: 0, invalid: 0, duplicated: 0 }
  );
  const latestFile = [...files].sort((left, right) => new Date(right.importedAt).getTime() - new Date(left.importedAt).getTime())[0];
  const sortedPeriods = [...files].map(getHistoryPeriodKey).sort();
  const latestPeriod = sortedPeriods[sortedPeriods.length - 1];

  return [
    { label: "Total registros", value: totals.records.toLocaleString("es-ES"), detail: `${files.length} cargas`, tone: "info", icon: <Database size={18} /> },
    { label: "Vï¿½lidos", value: totals.valid.toLocaleString("es-ES"), detail: qualityLabel(totals.valid, totals.records), tone: "good", icon: <CheckCircle2 size={18} /> },
    { label: "Invï¿½lidos", value: totals.invalid.toLocaleString("es-ES"), detail: qualityLabel(totals.invalid, totals.records), tone: totals.invalid > 0 ? "danger" : "good", icon: <AlertTriangle size={18} /> },
    { label: "Duplicados", value: totals.duplicated.toLocaleString("es-ES"), detail: qualityLabel(totals.duplicated, totals.records), tone: totals.duplicated > 0 ? "warning" : "good", icon: <Clipboard size={18} /> },
    { label: "ï¿½ltima carga", value: latestFile ? formatDateTime(latestFile.importedAt) : "-", detail: latestImport ? `${latestImport.summary.recordsImported} registros importados` : "Sin carga en sesiï¿½n", tone: "accent", icon: <FileClock size={18} /> },
    { label: "ï¿½ltimo periodo", value: latestPeriod ? formatMonthKeyLabel(latestPeriod) : "-", detail: latestFile?.version ?? "Sin periodo", tone: "info", icon: <Activity size={18} /> }
  ];
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{typeof value === "number" ? formatNumber(value) : value}</strong>
    </div>
  );
}
