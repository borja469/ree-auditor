import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { ChevronDown, ChevronRight, Download, RefreshCw } from "lucide-react";
import {
  downloadReeLqZipCatalogPair,
  getReeLqZipCatalog,
  type ReeLqMessageSummary,
  type ReeLqMonthlyMatrixCell,
  type ReeLqMonthlyMatrixResponse,
  type ReeLqSettlement
} from "../../api";
import { downloadBlob } from "../../components/technical-data-table/TechnicalDataTableHelpers";
import { REE_SETTLEMENT_CODES, settlementLabel } from "../../settlements";

type Notice = { tone: "success" | "error" | "info"; text: string };
type FamilyFilter = "" | "liquicomun" | "liqui-empresa";
type StatusFilter = "" | "complete" | "partial" | "empty";
type CatalogHistoryRow = {
  id: string;
  month: string;
  settlement: ReeLqSettlement;
  settlementType: string;
  family: "liquicomun" | "liqui-empresa";
  owner: string;
  publicationDate: string | null;
  downloadedAt: string | null;
  status: "Descargado";
  records: string;
  message: ReeLqMessageSummary;
  cell: ReeLqMonthlyMatrixCell;
};

const DEFAULT_OWNER = "STROM";

export function ReeZipFilesModule({ disabled = false }: { disabled?: boolean }) {
  const [matrix, setMatrix] = useState<ReeLqMonthlyMatrixResponse>();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>();
  const [openYears, setOpenYears] = useState<Set<string>>(() => new Set([String(new Date().getFullYear())]));
  const [monthFilter, setMonthFilter] = useState("");
  const [settlementFilter, setSettlementFilter] = useState<ReeLqSettlement | "">("");
  const [familyFilter, setFamilyFilter] = useState<FamilyFilter>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");

  const visibleMatrix: ReeLqMonthlyMatrixResponse = matrix ?? {
    source: "REE_ESIOS",
    service: "ServicioLQ",
    from: "",
    to: "",
    owner: DEFAULT_OWNER,
    months: [],
    settlements: REE_SETTLEMENT_CODES,
    cells: []
  };
  const filteredMonths = useMemo(
    () => visibleMatrix.months.filter((month) => !monthFilter || month === monthFilter),
    [monthFilter, visibleMatrix.months]
  );
  const filteredSettlements = useMemo(
    () => REE_SETTLEMENT_CODES.filter((settlement) => !settlementFilter || settlement === settlementFilter),
    [settlementFilter]
  );
  const filteredCells = useMemo(
    () => filterCells(visibleMatrix, filteredMonths, filteredSettlements, familyFilter, statusFilter),
    [familyFilter, filteredMonths, filteredSettlements, statusFilter, visibleMatrix]
  );
  const yearGroups = buildYearGroups(filteredMonths);
  const historyRows = useMemo(() => buildHistoryRows(filteredCells, familyFilter), [familyFilter, filteredCells]);

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
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "No se pudo descargar el ZIP local." });
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
          <span>{`Historico local por anio. Sujeto ${DEFAULT_OWNER}. Cada celda conserva la ultima publicacion local conocida de la liquidacion.`}</span>
        </div>
        <button className="ops-primary-button" disabled={disabled || Boolean(busyKey)} onClick={() => void loadMatrix()} type="button">
          <RefreshCw size={16} />
          {busyKey === "load" ? "Recargando" : "Recargar"}
        </button>
      </div>

      <div className="ree-zip-toolbar">
        <label>
          Periodo
          <input type="month" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)} />
        </label>
        <label>
          Liquidacion
          <select value={settlementFilter} onChange={(event) => setSettlementFilter(event.target.value as ReeLqSettlement | "")}>
            <option value="">Todas</option>
            {REE_SETTLEMENT_CODES.map((settlement) => <option key={settlement} value={settlement}>{settlement} - {settlementLabel(settlement)}</option>)}
          </select>
        </label>
        <label>
          Familia
          <select value={familyFilter} onChange={(event) => setFamilyFilter(event.target.value as FamilyFilter)}>
            <option value="">Todas</option>
            <option value="liquicomun">Comun</option>
            <option value="liqui-empresa">Empresa</option>
          </select>
        </label>
        <label>
          Estado
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            <option value="">Todos</option>
            <option value="complete">Descargado comun+empresa</option>
            <option value="partial">Descarga parcial</option>
            <option value="empty">No disponible</option>
          </select>
        </label>
      </div>

      {notice && <div className={`status-message ree-zip-notice ${notice.tone}`}>{notice.text}</div>}

      <div className="ree-zip-matrix-panel">
        {!matrix && <div className="ree-zip-empty">Mostrando todo el historico local disponible. Actualiza ZIPs locales desde Centro de cargas para alimentar esta matriz.</div>}
        {matrix && yearGroups.length === 0 && <div className="ree-zip-empty">No hay ZIPs locales para los filtros seleccionados.</div>}
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
            settlements={filteredSettlements}
          />
        ))}
      </div>

      <div className="ree-zip-history-panel">
        <div className="ops-table-head">
          <div>
            <strong>Historico local de publicaciones</strong>
            <span>{historyRows.length} publicacion(es) descargadas en el servidor</span>
          </div>
        </div>
        <div className="table-scroll">
          <table className="ree-zip-history-table">
            <thead>
              <tr>
                <th>Periodo</th>
                <th>Liquidacion</th>
                <th>Tipo</th>
                <th>Familia</th>
                <th>Sujeto / Owner</th>
                <th>Fecha publicacion</th>
                <th>Fecha descarga</th>
                <th>Estado</th>
                <th>Registros</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.length === 0 && (
                <tr>
                  <td colSpan={10}><div className="empty-state">Sin publicaciones descargadas para los filtros seleccionados.</div></td>
                </tr>
              )}
              {historyRows.map((row) => (
                <tr key={row.id}>
                  <td>{formatMonth(row.month)}</td>
                  <td><strong>{row.settlement}</strong></td>
                  <td>{row.settlementType}</td>
                  <td>{familyLabel(row.family)}</td>
                  <td>{row.owner}</td>
                  <td>{formatShortDate(row.publicationDate)}</td>
                  <td>{formatDateTime(row.downloadedAt)}</td>
                  <td><span className="ops-status-badge valid">{row.status}</span></td>
                  <td>{row.records}</td>
                  <td>
                    <button disabled={disabled || busyKey === `${row.month}-${row.settlement}`} onClick={() => void downloadCell(row.cell)} type="button">
                      <Download size={13} />
                      ZIP
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
  onToggle,
  settlements
}: {
  busyKey: string | null;
  disabled: boolean;
  group: YearGroup;
  isOpen: boolean;
  matrix: ReeLqMonthlyMatrixResponse;
  onDownload: (cell: ReeLqMonthlyMatrixCell) => Promise<void>;
  onToggle: () => void;
  settlements: ReeLqSettlement[];
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
          <div className="ree-zip-matrix-grid" style={{ gridTemplateColumns: `96px repeat(${settlements.length}, minmax(156px, 1fr))` }}>
            <div className="ree-zip-matrix-header">Mes</div>
            {settlements.map((settlement) => (
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
                settlements={settlements}
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
  onDownload,
  settlements
}: {
  busyKey: string | null;
  disabled: boolean;
  matrix: ReeLqMonthlyMatrixResponse;
  month: string;
  onDownload: (cell: ReeLqMonthlyMatrixCell) => Promise<void>;
  settlements: ReeLqSettlement[];
}) {
  return (
    <>
      <div className="ree-zip-matrix-month">{formatMonth(month)}</div>
      {settlements.map((settlement) => {
        const cell = matrix.cells.find((item) => item.month === month && item.settlement === settlement) ?? emptyCell(month, settlement);
        const hasAny = Boolean(cell.liquicomun || cell.liquiEmpresa);
        const isComplete = Boolean(cell.liquicomun && cell.liquiEmpresa);
        const statusLabel = hasAny ? (isComplete ? "Descargado" : "Parcial") : "No disponible";
        const statusTone = hasAny ? (isComplete ? "complete" : "partial") : "empty";
        const key = `${month}-${settlement}`;
        return (
          <div className={`ree-zip-matrix-cell ${hasAny ? "available" : "empty"}`} key={settlement}>
            <div className="ree-zip-matrix-cell-status-row">
              <span className={`ree-zip-matrix-status ${statusTone}`}>{statusLabel}</span>
            </div>
            <div className="ree-zip-matrix-files">
              <MatrixFileBadge label="Comun" message={cell.liquicomun} />
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

function MatrixFileBadge({ label, message }: { label: string; message: ReeLqMessageSummary | null }) {
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
        {" · "}
        {formatShortDate(message.publicationDate)}
        {" · "}
        {message.code || "-"}
      </small>
    </span>
  );
}

function filterCells(matrix: ReeLqMonthlyMatrixResponse, months: string[], settlements: ReeLqSettlement[], family: FamilyFilter, status: StatusFilter) {
  const cells = [];
  for (const month of months) {
    for (const settlement of settlements) {
      const cell = matrix.cells.find((item) => item.month === month && item.settlement === settlement) ?? emptyCell(month, settlement);
      const hasCommon = Boolean(cell.liquicomun);
      const hasEmpresa = Boolean(cell.liquiEmpresa);
      const visibleByFamily = !family || (family === "liquicomun" ? hasCommon : hasEmpresa);
      const cellStatus: StatusFilter = hasCommon && hasEmpresa ? "complete" : hasCommon || hasEmpresa ? "partial" : "empty";
      if (visibleByFamily && (!status || cellStatus === status)) {
        cells.push(cell);
      }
    }
  }
  return cells;
}

function buildHistoryRows(cells: ReeLqMonthlyMatrixCell[], familyFilter: FamilyFilter): CatalogHistoryRow[] {
  const rows: CatalogHistoryRow[] = [];
  for (const cell of cells) {
    if ((!familyFilter || familyFilter === "liquicomun") && cell.liquicomun) {
      rows.push(historyRow(cell, "liquicomun", cell.liquicomun));
    }
    if ((!familyFilter || familyFilter === "liqui-empresa") && cell.liquiEmpresa) {
      rows.push(historyRow(cell, "liqui-empresa", cell.liquiEmpresa));
    }
  }
  return rows.sort((left, right) =>
    right.month.localeCompare(left.month) ||
    REE_SETTLEMENT_CODES.indexOf(left.settlement) - REE_SETTLEMENT_CODES.indexOf(right.settlement) ||
    left.family.localeCompare(right.family)
  );
}

function historyRow(cell: ReeLqMonthlyMatrixCell, family: "liquicomun" | "liqui-empresa", message: ReeLqMessageSummary): CatalogHistoryRow {
  return {
    id: `${cell.month}-${cell.settlement}-${family}`,
    month: cell.month,
    settlement: cell.settlement,
    settlementType: settlementLabel(cell.settlement),
    family,
    owner: family === "liquicomun" ? "REE" : "STROM",
    publicationDate: message.publicationDate,
    downloadedAt: message.downloadedAt ?? null,
    status: "Descargado",
    records: "-",
    message,
    cell
  };
}

function emptyCell(month: string, settlement: ReeLqSettlement): ReeLqMonthlyMatrixCell {
  return {
    month,
    settlement,
    settlementCode: settlement,
    settlementType: settlement.startsWith("A") ? "A" : "C",
    settlementNumber: Number(settlement.slice(1, 2)),
    settlementLabel: settlementLabel(settlement),
    liquicomun: null,
    liquiEmpresa: null
  };
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

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

function formatMonth(value: string) {
  const [year, month] = value.split("-");
  return month && year ? `${month}/${year}` : value;
}

function familyLabel(value: "liquicomun" | "liqui-empresa") {
  return value === "liquicomun" ? "Comun" : "Empresa";
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
