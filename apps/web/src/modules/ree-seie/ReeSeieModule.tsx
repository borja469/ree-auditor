import { useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { type ReeSeieFile, type ReeSeieSummary } from "../../api";

type Props = {
  files: ReeSeieFile[];
  summary?: ReeSeieSummary;
  loading: boolean;
  onRefresh: () => void;
};

export function ReeSeieModule({ files, summary, loading, onRefresh }: Props) {
  const totals = useMemo(() => buildSummaryTotals(summary, files), [files, summary]);

  return (
    <section className="technical-module restored-module">
      <div className="ops-hero">
        <div>
          <p className="ops-eyebrow">Liquidaciones REE</p>
          <h2>SEIE</h2>
          <span>Resumen horario SEIE.</span>
        </div>
        <div className="ops-hero-actions">
          <button className="ops-primary-button" disabled={loading} onClick={onRefresh} type="button">
            <RefreshCw size={16} />
            Actualizar
          </button>
        </div>
      </div>

      <SummaryPanel summary={summary} totals={totals} />
    </section>
  );
}

function SummaryPanel({ summary, totals }: { summary?: ReeSeieSummary; totals: ReturnType<typeof buildSummaryTotals> }) {
  return (
    <section className="content-grid">
      <div className="panel wide">
        <div className="ree-command-summary">
          <Metric label="Registros" value={formatNumber(totals.records)} detail={`${formatNumber(totals.files)} ficheros en Centro de cargas`} />
          <Metric label="Magnitud" value={formatDecimal(totals.magnitud)} detail="suma filtrada" />
          <Metric label="Energia" value={formatDecimal(totals.energia)} detail="suma filtrada" />
        </div>
      </div>
      <div className="panel wide">
        <div className="ops-table-head">
          <div>
            <strong>Resumen por segmento</strong>
            <span>{summary?.groups.length ?? 0} grupos</span>
          </div>
        </div>
        <div className="table-scroll">
          <table className="ree-download-table">
            <thead>
              <tr>
                <th>Fecha liquidacion</th>
                <th>Version</th>
                <th>Segmento</th>
                <th>Tipo</th>
                <th>Sentido</th>
                <th>Registros</th>
                <th>Magnitud</th>
                <th>Energia</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.groups ?? []).length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">Sin resumen para los filtros seleccionados.</div>
                  </td>
                </tr>
              )}
              {summary?.groups.map((group, index) => (
                <tr key={`${group.fechaLiquidacion}-${group.version}-${group.segmento}-${group.tipo}-${group.sentido}-${index}`}>
                  <td>{formatDate(group.fechaLiquidacion)}</td>
                  <td>{group.version}</td>
                  <td>{group.segmento ?? "-"}</td>
                  <td>{group.tipo ?? "-"}</td>
                  <td>{group.sentido ?? "-"}</td>
                  <td className="ops-number-cell">{formatNumber(group.records)}</td>
                  <td className="ops-number-cell">{formatDecimal(group.magnitud)}</td>
                  <td className="ops-number-cell">{formatDecimal(group.energia)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="ree-summary-group">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function buildSummaryTotals(summary: ReeSeieSummary | undefined, files: ReeSeieFile[]) {
  return {
    files: files.length,
    records: summary?.groups.reduce((sum, group) => sum + group.records, 0) ?? 0,
    magnitud: sumDecimal(summary?.groups.map((group) => group.magnitud)),
    energia: sumDecimal(summary?.groups.map((group) => group.energia))
  };
}

function sumDecimal(values?: Array<string | null | undefined>) {
  const present = values?.map((value) => Number(value ?? 0)).filter(Number.isFinite) ?? [];
  return present.length === 0 ? null : present.reduce((sum, value) => sum + value, 0).toString();
}

function formatDate(value?: string | null) {
  if (!value) {
    return "-";
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function formatNumber(value: number) {
  return value.toLocaleString("es-ES");
}

function formatDecimal(value?: string | null) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString("es-ES", { maximumFractionDigits: 6 }) : value;
}
