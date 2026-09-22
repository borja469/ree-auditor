import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { ChevronDown, ChevronRight, Download, RefreshCw } from "lucide-react";
import {
  downloadReeLqZipCatalogPair,
  getReeLqZipCatalog,
  type ReeLqMonthlyMatrixCell,
  type ReeLqMonthlyMatrixResponse,
  type ReeLqSettlement
} from "../../api";
import { downloadBlob } from "../../components/technical-data-table/TechnicalDataTableHelpers";

type Notice = { tone: "success" | "error" | "info"; text: string };

const REE_LQ_SETTLEMENTS: ReeLqSettlement[] = ["A1", "C1", "C2", "C3", "C4", "C5"];
const DEFAULT_OWNER = "STROM";

export function ReeZipFilesModule({ disabled = false }: { disabled?: boolean }) {
  const [matrix, setMatrix] = useState<ReeLqMonthlyMatrixResponse>();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>();
  const [openYears, setOpenYears] = useState<Set<string>>(() => new Set([String(new Date().getFullYear())]));
  const visibleMatrix: ReeLqMonthlyMatrixResponse = matrix ?? {
    source: "REE_ESIOS",
    service: "ServicioLQ",
    from: "",
    to: "",
    owner: DEFAULT_OWNER,
    months: [],
    settlements: REE_LQ_SETTLEMENTS,
    cells: []
  };
  const yearGroups = buildYearGroups(visibleMatrix.months);

  useEffect(() => {
    void loadMatrix({ silent: true });
  }, []);

  async function loadMatrix(options: { silent?: boolean } = {}) {
    setBusyKey("load");
    if (!options.silent) {
      setNotice(undefined);
    }
    try {
      const response = await getReeLqZipCatalog(15, DEFAULT_OWNER, true);
      setMatrix(response);
      if (!options.silent) {
        setNotice({ tone: "success", text: `Catalogo local recargado: ${response.cells.length} celda(s) con ZIPs en ${response.months.length} mes(es).` });
      }
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "No se pudo cargar la matriz de ficheros ZIP." });
    } finally {
      setBusyKey(null);
    }
  }

  async function downloadCell(cell: ReeLqMonthlyMatrixCell) {
    const cellKey = `${cell.month}-${cell.settlement}`;
    setBusyKey(cellKey);
    setNotice(undefined);
    try {
      const result = await downloadReeLqZipCatalogPair({
        month: cell.month,
        settlement: cell.settlement,
        owner: DEFAULT_OWNER
      });
      downloadBlob(result.fileName, result.blob, "application/zip");
      setNotice({ tone: "success", text: `ZIP descargado: ${result.fileName}.` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "No se pudo descargar el ZIP." });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="ree-zip-files">
      <div className="ree-zip-command-panel">
        <div>
          <span className="ops-eyebrow">Liquidaciones REE</span>
          <strong>Ficheros ZIP</strong>
          <span>{`Hist\u00f3rico local por a\u00f1o. Sujeto ${DEFAULT_OWNER}. Descarga los ZIPs com\u00fan y empresa guardados en el servidor.`}</span>
        </div>
        <button className="ops-primary-button" disabled={disabled || Boolean(busyKey)} onClick={() => void loadMatrix()} type="button">
          <RefreshCw size={16} />
          {busyKey === "load" ? "Recargando" : "Recargar"}
        </button>
      </div>

      {notice && <div className={`status-message ree-zip-notice ${notice.tone}`}>{notice.text}</div>}

      <div className="ree-zip-matrix-panel">
        {!matrix && <div className="ree-zip-empty">{"Mostrando todo el hist\u00f3rico local disponible. Actualiza ZIPs locales desde Centro de cargas para alimentar esta matriz."}</div>}
        {matrix && yearGroups.length === 0 && <div className="ree-zip-empty">{"No hay ZIPs locales guardados todav\u00eda."}</div>}
        {yearGroups.map((group) => (
          <YearMatrix
            busyKey={busyKey}
            disabled={disabled}
            group={group}
            isOpen={openYears.has(group.year)}
            key={group.year}
            matrix={visibleMatrix}
            onDownload={downloadCell}
            onToggle={() => toggleYear(group.year, setOpenYears)}
          />
        ))}
      </div>
    </section>
  );
}

function YearMatrix({
  busyKey,
  disabled,
  group,
  isOpen,
  matrix,
  onDownload,
  onToggle
}: {
  busyKey: string | null;
  disabled: boolean;
  group: YearGroup;
  isOpen: boolean;
  matrix: ReeLqMonthlyMatrixResponse;
  onDownload: (cell: ReeLqMonthlyMatrixCell) => Promise<void>;
  onToggle: () => void;
}) {
  const cellCount = countCellsWithZips(matrix, group.months);
  return (
    <section className={`ree-zip-year-panel ${isOpen ? "open" : "closed"}`}>
      <button className="ree-zip-year-toggle" onClick={onToggle} type="button">
        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <strong>{group.year}</strong>
        <span>{group.months.length} mes(es)</span>
        <small>{cellCount} celda(s) con ZIPs</small>
      </button>
      {isOpen && (
        <div className="ree-zip-matrix-scroll">
          <div className="ree-zip-matrix-grid" style={{ gridTemplateColumns: `96px repeat(${REE_LQ_SETTLEMENTS.length}, minmax(156px, 1fr))` }}>
            <div className="ree-zip-matrix-header">Mes</div>
            {REE_LQ_SETTLEMENTS.map((settlement) => (
              <div className="ree-zip-matrix-header" key={settlement}>{settlement}</div>
            ))}
            {group.months.map((month) => (
              <MatrixRow
                busyKey={busyKey}
                disabled={disabled}
                key={month}
                matrix={matrix}
                month={month}
                onDownload={onDownload}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function MatrixRow({
  busyKey,
  disabled,
  matrix,
  month,
  onDownload
}: {
  busyKey: string | null;
  disabled: boolean;
  matrix: ReeLqMonthlyMatrixResponse;
  month: string;
  onDownload: (cell: ReeLqMonthlyMatrixCell) => Promise<void>;
}) {
  return (
    <>
      <div className="ree-zip-matrix-month">{formatMonth(month)}</div>
      {REE_LQ_SETTLEMENTS.map((settlement) => {
        const cell = matrix.cells.find((item) => item.month === month && item.settlement === settlement) ?? {
          month,
          settlement,
          liquicomun: null,
          liquiEmpresa: null
        };
        const hasAny = Boolean(cell.liquicomun || cell.liquiEmpresa);
        const isComplete = Boolean(cell.liquicomun && cell.liquiEmpresa);
        const statusLabel = hasAny ? (isComplete ? "Completa" : "Parcial") : "Sin publicar";
        const statusTone = hasAny ? (isComplete ? "complete" : "partial") : "empty";
        const key = `${month}-${settlement}`;
        return (
          <div className={`ree-zip-matrix-cell ${hasAny ? "available" : "empty"}`} key={settlement}>
            <div className="ree-zip-matrix-cell-status-row">
              <span className={`ree-zip-matrix-status ${statusTone}`}>{statusLabel}</span>
            </div>
            <div className="ree-zip-matrix-files">
              <MatrixFileBadge label={"Com\u00fan"} message={cell.liquicomun} />
              <MatrixFileBadge label="Empresa" message={cell.liquiEmpresa} />
            </div>
            {hasAny && (
              <button disabled={disabled || busyKey === "load" || busyKey === key} onClick={() => void onDownload(cell)} type="button">
                <Download size={13} />
                {busyKey === key ? "Descargando" : "Descargar"}
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

function MatrixFileBadge({ label, message }: { label: string; message: ReeLqMonthlyMatrixCell["liquicomun"] }) {
  if (!message) {
    return (
      <span className="ree-zip-matrix-file missing">
        <b>{label}</b>
        <small>-</small>
      </span>
    );
  }
  return (
    <span className="ree-zip-matrix-file" title={message.messageId}>
      <b>{label}</b>
      <small>
        {formatVersion(message.fileVersion)}
        {" \u00b7 "}
        {formatShortDate(message.publicationDate)}
        {" \u00b7 "}
        {message.code || "-"}
      </small>
    </span>
  );
}

function formatVersion(value: number | null | undefined) {
  return `v${value || 0}`;
}

function formatShortDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const [year, month, day] = value.slice(0, 10).split("-");
  return day && month && year ? `${day}/${month}/${year.slice(-2)}` : value;
}

function formatMonth(value: string) {
  const [year, month] = value.split("-");
  return month && year ? `${month}/${year}` : value;
}

type YearGroup = { year: string; months: string[] };

function buildYearGroups(months: string[]): YearGroup[] {
  const groups = new Map<string, string[]>();
  for (const month of [...months].sort((left, right) => right.localeCompare(left))) {
    const year = month.slice(0, 4);
    const group = groups.get(year) ?? [];
    group.push(month);
    groups.set(year, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([year, groupMonths]) => ({ year, months: groupMonths }));
}

function countCellsWithZips(matrix: ReeLqMonthlyMatrixResponse, months: string[]) {
  const allowedMonths = new Set(months);
  return matrix.cells.filter((cell) => allowedMonths.has(cell.month) && (cell.liquicomun || cell.liquiEmpresa)).length;
}

function toggleYear(year: string, setOpenYears: Dispatch<SetStateAction<Set<string>>>) {
  setOpenYears((current) => {
    const next = new Set(current);
    if (next.has(year)) {
      next.delete(year);
    } else {
      next.add(year);
    }
    return next;
  });
}
