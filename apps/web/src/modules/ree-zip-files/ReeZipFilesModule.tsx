import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
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
  const displayMonths = buildRollingMonths(15);
  const visibleMatrix: ReeLqMonthlyMatrixResponse = matrix ?? {
    source: "REE_ESIOS",
    service: "ServicioLQ",
    from: displayMonths.at(-1) ?? "",
    to: displayMonths[0] ?? "",
    owner: DEFAULT_OWNER,
    months: displayMonths,
    settlements: REE_LQ_SETTLEMENTS,
    cells: []
  };

  useEffect(() => {
    void loadMatrix({ silent: true });
  }, []);

  async function loadMatrix(options: { silent?: boolean } = {}) {
    setBusyKey("load");
    if (!options.silent) {
      setNotice(undefined);
    }
    try {
      const response = await getReeLqZipCatalog(15, DEFAULT_OWNER);
      setMatrix(response);
      if (!options.silent) {
        setNotice({ tone: "success", text: `Catalogo local recargado: ${response.cells.length} celda(s) con ZIPs.` });
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
          <span>Mes actual y 15 meses atras. Sujeto {DEFAULT_OWNER}. Descarga los ZIPs comun y empresa guardados en el servidor.</span>
        </div>
        <button className="ops-primary-button" disabled={disabled || Boolean(busyKey)} onClick={() => void loadMatrix()} type="button">
          <RefreshCw size={16} />
          {busyKey === "load" ? "Recargando" : "Recargar"}
        </button>
      </div>

      {notice && <div className={`status-message ree-zip-notice ${notice.tone}`}>{notice.text}</div>}

      <div className="ree-zip-matrix-panel">
        {!matrix && <div className="ree-zip-empty">Mostrando meses desde el actual hasta 15 meses atras. Actualiza ZIPs locales desde Centro de cargas para alimentar esta matriz.</div>}
          <div className="ree-zip-matrix-scroll">
            <div className="ree-zip-matrix-grid" style={{ gridTemplateColumns: `96px repeat(${REE_LQ_SETTLEMENTS.length}, minmax(156px, 1fr))` }}>
              <div className="ree-zip-matrix-header">Mes</div>
              {REE_LQ_SETTLEMENTS.map((settlement) => (
                <div className="ree-zip-matrix-header" key={settlement}>{settlement}</div>
              ))}
              {displayMonths.map((month) => (
                <MatrixRow
                  busyKey={busyKey}
                  disabled={disabled}
                  key={month}
                  matrix={visibleMatrix}
                  month={month}
                  onDownload={downloadCell}
                />
              ))}
            </div>
          </div>
      </div>
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
              <MatrixFileBadge label="Común" message={cell.liquicomun} />
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
      <small>{formatVersion(message.fileVersion)} · {formatShortDate(message.publicationDate)} · {message.code || "-"}</small>
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

function buildRollingMonths(monthsBack: number) {
  const now = new Date();
  const months: string[] = [];
  for (let offset = 0; offset <= monthsBack; offset += 1) {
    const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() - offset, 1));
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}
