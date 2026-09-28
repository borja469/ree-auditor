import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, RefreshCw, Search } from "lucide-react";
import {
  confirmMercadoIndicatorMapping,
  getMercadoDataset,
  getMercadoDatasetValidation,
  getMercadoIndicatorMapping,
  refreshMercadoIndicatorMapping,
  type MercadoDatasetResponse,
  type MercadoDatasetValidationResponse,
  type MercadoIndicatorMappingAlternative,
  type MercadoIndicatorMappingRow
} from "../../api";
import { getTodayInputValue } from "../../app-shell/AppState";
import { PanelTitle, formatDecimalNumber, formatNumber } from "../shared/RestoredModuleCommon";

type MercadoFilters = {
  fechaDesde: string;
  fechaHasta: string;
  geoId: string;
};

const DATASET_COLUMNS = ["timestampUtc", "precioOmie", "demandaPrevista", "eolica", "fotovoltaica", "nuclear", "bombeo", "intercambios", "dataQualityStatus"];

type MercadoMappingChoice = Pick<
  MercadoIndicatorMappingAlternative,
  "indicatorId" | "nombre" | "geoId" | "geoKey" | "geoName" | "confidence" | "functionalCategory" | "scoreBreakdown" | "ambiguityReason" | "warnings"
>;

export function MercadoModule() {
  const [filters, setFilters] = useState<MercadoFilters>(() => {
    const today = getTodayInputValue();
    return { fechaDesde: today, fechaHasta: today, geoId: "" };
  });
  const [mapping, setMapping] = useState<MercadoIndicatorMappingRow[]>([]);
  const [dataset, setDataset] = useState<MercadoDatasetResponse>();
  const [validation, setValidation] = useState<MercadoDatasetValidationResponse>();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string }>();
  const [selectedMappingChoices, setSelectedMappingChoices] = useState<Record<string, string>>({});

  const mappingSummary = useMemo(() => {
    const rows = mapping.filter((row) => row.variable !== "precioOmie");
    return {
      total: rows.length,
      auto: rows.filter((row) => row.status === "auto").length,
      confirmed: rows.filter((row) => row.status === "confirmed").length,
      ambiguous: rows.filter((row) => row.status === "ambiguous").length,
      missing: rows.filter((row) => row.status === "not_found").length
    };
  }, [mapping]);

  useEffect(() => {
    void refreshMapping();
  }, []);

  async function refreshMapping() {
    setLoading(true);
    setMessage(undefined);
    try {
      setMapping(await getMercadoIndicatorMapping());
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo cargar el mapping Mercado." });
    } finally {
      setLoading(false);
    }
  }

  async function refreshMappingCache() {
    setLoading(true);
    setMessage(undefined);
    try {
      setMapping(await refreshMercadoIndicatorMapping());
      setMessage({ tone: "success", text: "Mapping Mercado recalculado." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo recalcular el mapping Mercado." });
    } finally {
      setLoading(false);
    }
  }

  async function runValidation() {
    setLoading(true);
    setMessage(undefined);
    try {
      const request = buildRequest(filters);
      const [nextDataset, nextValidation, nextMapping] = await Promise.all([
        getMercadoDataset({ ...request, take: 24 }),
        getMercadoDatasetValidation(request),
        getMercadoIndicatorMapping()
      ]);
      setDataset(nextDataset);
      setValidation(nextValidation);
      setMapping(nextMapping);
      setMessage({ tone: "success", text: "Validacion Mercado actualizada." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo validar el dataset Mercado." });
    } finally {
      setLoading(false);
    }
  }

  async function confirmMapping(row: MercadoIndicatorMappingRow) {
    const choice = getSelectedMappingChoice(row, selectedMappingChoices[row.variable]);
    if (!choice) {
      return;
    }
    setLoading(true);
    setMessage(undefined);
    try {
      await confirmMercadoIndicatorMapping({
        variable: row.variable,
        indicatorId: choice.indicatorId,
        geoId: choice.geoId,
        geoKey: choice.geoKey
      });
      setMapping(await getMercadoIndicatorMapping());
      setMessage({ tone: "success", text: `Mapping confirmado para ${row.variable}: ${choice.indicatorId}.` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo confirmar el mapping." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="omie-layout omie-layout-a mercado-module">
      <div className="panel wide omie-control-panel">
        <PanelTitle icon={<Database size={18} />} title="Mercado Dataset" subtitle="Mapping automatico ESIOS y validacion de calidad del dataset horario" />
        <div className="omie-toolbar compact">
          <label className="filter-field">
            <span>Fecha desde</span>
            <input disabled={loading} onChange={(event) => setFilters((current) => ({ ...current, fechaDesde: event.target.value }))} type="date" value={filters.fechaDesde} />
          </label>
          <label className="filter-field">
            <span>Fecha hasta</span>
            <input disabled={loading} onChange={(event) => setFilters((current) => ({ ...current, fechaHasta: event.target.value }))} type="date" value={filters.fechaHasta} />
          </label>
          <label className="filter-field">
            <span>Geo ID</span>
            <input disabled={loading} inputMode="numeric" onChange={(event) => setFilters((current) => ({ ...current, geoId: event.target.value.replace(/\D/g, "") }))} placeholder="Auto" value={filters.geoId} />
          </label>
          <button className="secondary-button" disabled={loading} onClick={refreshMappingCache} type="button">
            <RefreshCw size={16} />
            Mapping
          </button>
          <button className="primary-button" disabled={loading} onClick={runValidation} type="button">
            <Search size={16} />
            Validar
          </button>
        </div>
      </div>

      {message && <div className={`status-message ${message.tone}`}>{message.text}</div>}

      <div className="mercado-kpi-grid">
        <MercadoKpi label="Quality score" value={validation ? formatDecimalNumber(validation.qualityScore, 2) : "-"} tone={qualityTone(validation?.qualityScore)} />
        <MercadoKpi label="Cobertura temporal" value={validation ? `${formatDecimalNumber(validation.coverage.temporalCoveragePct, 2)}%` : "-"} />
        <MercadoKpi label="Variables auto" value={`${mappingSummary.auto + mappingSummary.confirmed}/${mappingSummary.total}`} />
        <MercadoKpi label="Ambiguos" value={formatNumber(mappingSummary.ambiguous)} tone={mappingSummary.ambiguous > 0 ? "warning" : "ok"} />
        <MercadoKpi label="Errores" value={formatNumber(validation?.errors.length ?? 0)} tone={(validation?.errors.length ?? 0) > 0 ? "danger" : "ok"} />
      </div>

      <section className="panel wide mercado-panel">
        <div className="mercado-panel-head">
          <PanelTitle icon={<CheckCircle2 size={18} />} title="Mapping de indicadores" subtitle="Ranking automatico desde el catalogo ESIOS" />
        </div>
        <div className="mercado-table-shell">
          <table className="mercado-table">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Estado</th>
                <th>Indicador</th>
                <th>Categoria</th>
                <th>Geo</th>
                <th>Score</th>
                <th>Motivo</th>
                <th>Candidato</th>
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              {mapping.map((row) => {
                const options = getMappingChoices(row);
                const selectedKey = selectedMappingChoices[row.variable] ?? candidateKey(options[0]);
                return (
                  <tr key={row.variable}>
                    <td>
                      <strong>{row.variable}</strong>
                    </td>
                    <td>
                      <span className={`ops-status-badge ${statusClass(row.status)}`}>{row.status}</span>
                    </td>
                    <td>
                      <span>{row.indicatorId ?? "-"}</span>
                      <small>{row.nombre ?? "-"}</small>
                    </td>
                    <td>{row.functionalCategory ?? "-"}</td>
                    <td>{row.geoId ?? row.geoKey ?? "-"}</td>
                    <td>
                      <span>{formatDecimalNumber(row.confidence, 0)}%</span>
                      <small>{formatScoreBreakdown(row.scoreBreakdown)}</small>
                    </td>
                    <td>
                      {row.ambiguityReason ?? (row.warnings.length ? row.warnings.join(" | ") : "-")}
                    </td>
                    <td>
                      {row.status === "ambiguous" && options.length > 0 ? (
                        <select
                          className="mercado-mapping-select"
                          disabled={loading}
                          onChange={(event) => setSelectedMappingChoices((current) => ({ ...current, [row.variable]: event.target.value }))}
                          value={selectedKey}
                        >
                          {options.map((option) => (
                            <option key={candidateKey(option)} value={candidateKey(option)}>
                              {formatCandidateOption(option)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        row.alternatives.slice(0, 3).map((item) => `${item.indicatorId} ${item.nombre ?? ""}`).join(" | ") || "-"
                      )}
                    </td>
                    <td>
                      {row.status === "ambiguous" && options.length > 0 && (
                        <button className="secondary-button" disabled={loading} onClick={() => confirmMapping(row)} type="button">
                          Confirmar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel wide mercado-panel">
        <PanelTitle icon={<AlertTriangle size={18} />} title="Validacion" subtitle="Cobertura temporal, nulos e incidencias del dataset" />
        {validation ? (
          <div className="mercado-validation-grid">
            <div className="mercado-issues">
              <strong>Errores</strong>
              {(validation.errors.length ? validation.errors : ["Sin errores criticos."]).map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
            <div className="mercado-issues">
              <strong>Avisos</strong>
              {(validation.warnings.length ? validation.warnings.slice(0, 10) : ["Sin avisos."]).map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-state">Ejecuta la validacion para ver el informe de calidad.</div>
        )}
      </section>

      <section className="panel wide mercado-panel">
        <PanelTitle icon={<Database size={18} />} title="Vista previa dataset" subtitle="Primeras 24 filas del dataset horario" />
        {dataset ? (
          <div className="mercado-table-shell">
            <table className="mercado-table mercado-dataset-table">
              <thead>
                <tr>
                  {DATASET_COLUMNS.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataset.rows.map((row) => (
                  <tr key={row.timestampUtc}>
                    {DATASET_COLUMNS.map((column) => (
                      <td key={column}>{formatDatasetCell(row[column as keyof typeof row])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">Sin dataset cargado.</div>
        )}
      </section>
    </section>
  );
}

function buildRequest(filters: MercadoFilters) {
  return {
    fechaDesde: filters.fechaDesde,
    fechaHasta: filters.fechaHasta,
    ...(filters.geoId ? { geoId: filters.geoId } : {})
  };
}

function getMappingChoices(row: MercadoIndicatorMappingRow): MercadoMappingChoice[] {
  const primary: MercadoMappingChoice[] = row.indicatorId
    ? [
        {
          indicatorId: row.indicatorId,
          nombre: row.nombre,
          geoId: row.geoId,
          geoKey: row.geoKey,
          geoName: null,
          confidence: row.confidence,
          functionalCategory: row.functionalCategory,
          scoreBreakdown: row.scoreBreakdown ?? {
            base: 0,
            category: 0,
            preferred: 0,
            strongPreferred: 0,
            unit: 0,
            frequency: 0,
            data: 0,
            geography: 0,
            penalties: 0,
            total: row.confidence
          },
          ambiguityReason: row.ambiguityReason,
          warnings: row.warnings
        }
      ]
    : [];
  const byKey = new Map<string, MercadoMappingChoice>();
  for (const option of [...primary, ...row.alternatives]) {
    byKey.set(candidateKey(option), option);
  }
  return [...byKey.values()];
}

function getSelectedMappingChoice(row: MercadoIndicatorMappingRow, selectedKey?: string) {
  const options = getMappingChoices(row);
  return options.find((option) => candidateKey(option) === selectedKey) ?? options[0] ?? null;
}

function candidateKey(option?: MercadoMappingChoice) {
  if (!option) {
    return "";
  }
  return `${option.indicatorId}:${option.geoId ?? ""}:${option.geoKey ?? ""}`;
}

function formatCandidateOption(option: MercadoMappingChoice) {
  const geo = option.geoId ?? option.geoKey ?? "-";
  return `${option.indicatorId} | ${option.functionalCategory ?? "-"} | ${formatDecimalNumber(option.confidence, 0)}% | Geo ${geo} | ${option.nombre ?? "-"}`;
}

function formatScoreBreakdown(score: MercadoIndicatorMappingRow["scoreBreakdown"]) {
  if (!score) {
    return "-";
  }
  return `cat ${score.category} pref ${score.preferred + score.strongPreferred} geo ${score.geography} data ${formatDecimalNumber(score.data, 1)} pen ${score.penalties}`;
}

function MercadoKpi({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warning" | "danger" }) {
  return (
    <div className={`technical-kpi ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function qualityTone(value?: number) {
  if (value === undefined) {
    return undefined;
  }
  if (value >= 85) {
    return "ok";
  }
  if (value >= 60) {
    return "warning";
  }
  return "danger";
}

function statusClass(status: string) {
  if (status === "auto" || status === "confirmed" || status === "external") {
    return "valid";
  }
  if (status === "ambiguous") {
    return "partial";
  }
  return "error";
}

function formatDatasetCell(value: unknown) {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "number") {
    return formatDecimalNumber(value, 3);
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return String(value);
}
