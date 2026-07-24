import { useEffect, useMemo, useState } from "react";
import { CalendarDays, FileText } from "lucide-react";
import { InlineLoading } from "../../GlobalLoadingOverlay";
import {
  getAnnualReport,
  getAnnualReportYears,
  saveAnnualReportRetributionPrice,
  type AnnualReportMetricKind,
  type AnnualReportMetricRow,
  type AnnualReportResponse,
  type AnnualReportTable
} from "../../api";
import { PanelTitle } from "../shared/RestoredModuleCommon";

export function AnnualReportModule() {
  const [years, setYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(() => new Date().getFullYear());
  const [report, setReport] = useState<AnnualReportResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [reloadToken, setReloadToken] = useState(0);
  const [saveNotice, setSaveNotice] = useState<{ kind: "success" | "error"; message: string }>();

  useEffect(() => {
    let ignore = false;
    getAnnualReportYears()
      .then((availableYears) => {
        if (ignore) {
          return;
        }
        setYears(availableYears);
        if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
          setSelectedYear(availableYears[0]);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "No se pudieron cargar los anos disponibles.");
        }
      });
    return () => {
      ignore = true;
    };
  }, [selectedYear]);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(undefined);
    getAnnualReport(selectedYear)
      .then((response) => {
        if (!ignore) {
          setReport(response);
          if (response.availableYears.length > 0) {
            setYears(response.availableYears);
          }
        }
      })
      .catch((err) => {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "No se pudo cargar el informe anual.");
          setReport(undefined);
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, [selectedYear, reloadToken]);

  const yearOptions = useMemo(() => {
    const unique = new Set([...years, report?.year ?? selectedYear]);
    return [...unique].filter(Number.isFinite).sort((left, right) => right - left);
  }, [report?.year, selectedYear, years]);
  const tables = useMemo<AnnualReportTable[]>(() => {
    if (!report) {
      return [];
    }
    return report.tables?.length
      ? report.tables
      : [{ key: "peninsula", title: "Informe Anual Península", missingMonths: report.missingMonths, rows: report.rows }];
  }, [report]);

  return (
    <section className="panel wide annual-report-panel">
      <div className="annual-report-header">
        <PanelTitle icon={<FileText size={18} />} title="Informe Anual" subtitle="Resumen mensual consolidado de energia, importes y precios" />
        <label className="annual-report-year-filter">
          <span>Ano</span>
          <select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))} disabled={loading}>
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && (
        <div className="annual-report-loading">
          <InlineLoading label="Calculando informe anual" />
        </div>
      )}

      {error && <div className="form-message error">{error}</div>}
      {saveNotice && <div className={`annual-report-save-message ${saveNotice.kind}`}>{saveNotice.message}</div>}

      {report && (
        <div className="annual-report-tables">
          {tables.map((table) => (
            <AnnualReportTableView
              key={table.key}
              months={report.months}
              table={table}
              year={report.year}
              onSaved={(message) => {
                setSaveNotice({ kind: "success", message });
                setReloadToken((current) => current + 1);
              }}
              onSaveError={(message) => setSaveNotice({ kind: "error", message })}
            />
          ))}
        </div>
      )}

      {!loading && !error && !report && (
        <div className="empty-state compact">
          <CalendarDays size={18} />
          <span>No hay datos disponibles para el informe anual.</span>
        </div>
      )}
    </section>
  );
}

function AnnualReportTableView({
  table,
  months,
  year,
  onSaved,
  onSaveError
}: {
  table: AnnualReportTable;
  months: string[];
  year: number;
  onSaved: (message: string) => void;
  onSaveError: (message: string) => void;
}) {
  return (
    <section className="annual-report-table-section">
      <h3>{table.title}</h3>
      {table.rows.length > 0 ? (
        <div className="table-scroll omie-annual-summary-scroll annual-report-table-shell">
          <table className="omie-liquidation-table omie-annual-summary-table annual-report-table">
            <colgroup>
              <col className="annual-report-metric-col" />
              {months.map((month) => (
                <col className="annual-report-month-col" key={month} />
              ))}
              <col className="annual-report-total-col" />
            </colgroup>
            <thead>
              <tr>
                <th className="annual-report-sticky-col">Metrica</th>
                {months.map((month) => (
                  <th key={month}>{month.slice(0, 3)}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <AnnualReportRow key={`${table.key}-${row.key}`} row={row} year={year} onSaved={onSaved} onSaveError={onSaveError} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state compact">
          <CalendarDays size={18} />
          <span>No hay datos disponibles para {table.title}.</span>
        </div>
      )}
    </section>
  );
}

function AnnualReportRow({
  row,
  year,
  onSaved,
  onSaveError
}: {
  row: AnnualReportMetricRow;
  year: number;
  onSaved: (message: string) => void;
  onSaveError: (message: string) => void;
}) {
  const highlighted = isHighlightedAnnualReportRow(row.key);
  return (
    <tr className={highlighted ? "annual-report-highlight-row" : undefined}>
      <th className="annual-report-sticky-col" scope="row">
        {row.label}
      </th>
      {row.months.map((value, index) => (
        <td className={buildAnnualCellClassName(row, value)} key={`${row.key}-${index}`}>
          {row.editable ? (
            <AnnualReportEditablePriceCell
              value={typeof value === "number" ? value : null}
              kind={row.kind}
              year={year}
              month={index + 1}
              type={row.editable.type}
              onSaved={onSaved}
              onSaveError={onSaveError}
            />
          ) : (
            formatAnnualValue(value, row.kind)
          )}
        </td>
      ))}
      <td className={row.kind === "text" ? "text annual-report-total" : "number annual-report-total"}>{formatAnnualValue(row.total, row.kind)}</td>
    </tr>
  );
}

function buildAnnualCellClassName(row: AnnualReportMetricRow, value: number | string | null) {
  const classes = [row.kind === "text" ? "text" : "number"];
  if (row.key === "versionUtilizada" && value === "C5") {
    classes.push("annual-report-version-c5");
  }
  return classes.join(" ");
}

function isHighlightedAnnualReportRow(key: string) {
  return [
    "programaMwh",
    "energiaBcMwh",
    "importeTotalEur",
    "importeOmieEur",
    "importeReerEur",
    "resultadoCoberturasEur",
    "importeRetribucionOsEur",
    "importeRetribucionOmEur",
    "importeRemitEur"
  ].includes(key);
}

function AnnualReportEditablePriceCell({
  value,
  kind,
  year,
  month,
  type,
  onSaved,
  onSaveError
}: {
  value: number | null;
  kind: AnnualReportMetricKind;
  year: number;
  month: number;
  type: "OS" | "OM" | "REMIT";
  onSaved: (message: string) => void;
  onSaveError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(() => formatEditableValue(value, kind));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    setDraft(formatEditableValue(value, kind));
    setStatus("idle");
  }, [kind, value]);

  async function save() {
    const parsed = parseEditablePrice(draft);
    if (parsed === "invalid") {
      setStatus("error");
      onSaveError(type === "REMIT" ? "El importe debe ser un numero mayor o igual que cero." : "El precio debe ser un numero mayor o igual que cero.");
      return;
    }
    if (sameNullableNumber(parsed, value)) {
      return;
    }
    setStatus("saving");
    try {
      await saveAnnualReportRetributionPrice({ year, month, type, price: parsed });
      setStatus("saved");
      onSaved(type === "REMIT" ? "Importe REMIT guardado." : `Precio retribucion ${type} guardado.`);
    } catch (err) {
      setStatus("error");
      onSaveError(err instanceof Error ? err.message : type === "REMIT" ? "No se pudo guardar el importe." : "No se pudo guardar el precio.");
    }
  }

  return (
    <input
      className={`annual-report-editable-price annual-report-editable-price-${status}`}
      inputMode="decimal"
      min="0"
      value={draft}
      onBlur={() => void save()}
      onChange={(event) => {
        setDraft(event.target.value);
        setStatus("idle");
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(formatEditableValue(value, kind));
          event.currentTarget.blur();
        }
      }}
      title={status === "saving" ? "Guardando" : status === "saved" ? "Guardado" : status === "error" ? "Error al guardar" : type === "REMIT" ? "Editar importe" : "Editar precio"}
    />
  );
}

function formatAnnualValue(value: number | string | null, kind: AnnualReportMetricKind) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (!Number.isFinite(value)) {
    return "";
  }
  if (kind === "energy") {
    return value.toLocaleString("es-ES", { maximumFractionDigits: 2 });
  }
  if (kind === "currency") {
    return value.toLocaleString("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (kind === "price") {
    return value.toLocaleString("es-ES", { maximumFractionDigits: 2 });
  }
  return String(value);
}

function formatEditableValue(value: number | null, kind: AnnualReportMetricKind) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "";
  }
  return String(Number(value.toFixed(kind === "currency" ? 2 : 12))).replace(".", ",");
}

function parseEditablePrice(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.includes(",") ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return "invalid";
  }
  return parsed;
}

function sameNullableNumber(left: number | null, right: number | null) {
  if (left === null || right === null) {
    return left === right;
  }
  return Math.abs(left - right) < 0.000000000001;
}
