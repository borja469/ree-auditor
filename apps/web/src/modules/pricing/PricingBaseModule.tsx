import { useEffect, useMemo, useState } from "react";
import { Calculator, Clipboard, FileDown, FileSpreadsheet, RotateCcw, Search } from "lucide-react";
import {
  downloadPricingBaseExport,
  getPricingBaseTable,
  getPricingCalculatorManualValues,
  savePricingCalculatorManualValue,
  type PricingBaseFilters,
  type PricingBaseMeffProfileRow,
  type PricingBaseResponse,
  type PricingBaseRow,
  type PricingCalculatorManualConcept,
  type PricingCalculatorManualValue
} from "../../api";
import { downloadBlob } from "../../components/technical-data-table/TechnicalDataTableHelpers";
import { PanelTitle, formatDecimalNumber, formatNumber } from "../shared/RestoredModuleCommon";

const PAGE_SIZE = 10000;
const PERIODS = ["P1", "P2", "P3", "P4", "P5", "P6"] as const;
const MONTHS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] as const;
type ProfileTab = "omie" | "meff";
type BaseTariff = ProfiledPeriodMatrix["tariff"];
type CalculatorConceptKey = (typeof PRICING_CALCULATOR_CONCEPTS)[number]["key"];

export function PricingBaseModule() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string }>();
  const [filters, setFilters] = useState<PricingBaseFilters>(() => defaultFilters());
  const [page, setPage] = useState(0);
  const [response, setResponse] = useState<PricingBaseResponse>();
  const [profileTab, setProfileTab] = useState<ProfileTab>("omie");
  const [calculatorManualValues, setCalculatorManualValues] = useState<Map<string, number | null>>(() => new Map());
  const [calculatorDrafts, setCalculatorDrafts] = useState<Map<string, string>>(() => new Map());
  const [calculatorEnabledConcepts, setCalculatorEnabledConcepts] = useState<Set<CalculatorConceptKey>>(() => new Set(PRICING_CALCULATOR_CONCEPTS.map((concept) => concept.key)));

  async function load(nextFilters = filters, nextPage = page) {
    setLoading(true);
    setMessage(undefined);
    try {
      const normalized = normalizeFilters(nextFilters);
      const result = await getPricingBaseTable({ ...normalized, skip: nextPage * PAGE_SIZE, take: PAGE_SIZE });
      setFilters(normalized);
      setResponse(result);
      setPage(nextPage);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando tabla base de pricing." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(defaultFilters(), 0);
  }, []);

  useEffect(() => {
    void loadCalculatorManualValues();
  }, []);

  const omiePeriodMatrices = useMemo(() => buildOmiePeriodMatrices(response?.rows ?? []), [response]);
  const meffPeriodMatrices = useMemo(() => buildMeffPriceMatrices(response?.meffForward.months ?? [], omiePeriodMatrices), [response, omiePeriodMatrices]);
  const cadRadPeriodSummary = useMemo(() => buildCadRadPeriodSummary(response?.rows ?? []), [response]);
  const lossesPeriodSummary = useMemo(() => buildLossesPeriodSummary(response?.rows ?? []), [response]);

  async function loadCalculatorManualValues() {
    try {
      const values = await getPricingCalculatorManualValues();
      setCalculatorManualValues(buildManualValueMap(values));
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando valores manuales del calculador." });
    }
  }

  async function saveCalculatorManualCell(concept: PricingCalculatorManualConcept, tariff: string, period: string, raw: string) {
    const key = calculatorManualKey(concept, tariff, period);
    const value = parseCalculatorInput(raw);
    if (value === undefined) {
      setMessage({ tone: "error", text: "El valor del calculador debe ser numerico." });
      return;
    }
    setMessage(undefined);
    try {
      const saved = await savePricingCalculatorManualValue({ concepto: concept, tarifa: tariff, periodo: period, valor: value });
      setCalculatorManualValues((current) => {
        const next = new Map(current);
        next.set(calculatorManualKey(saved.concepto, saved.tarifa, saved.periodo), saved.valor);
        return next;
      });
      setCalculatorDrafts((current) => {
        const next = new Map(current);
        next.delete(key);
        return next;
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error guardando valor del calculador." });
    }
  }

  async function exportPricingBase(format: "csv" | "xls") {
    setMessage(undefined);
    try {
      const normalized = normalizeFilters(filters);
      const blob = await downloadPricingBaseExport(normalized, format);
      if (format === "xls") {
        downloadBlob(`pricing-base-${normalized.fechaReferencia ?? "tabla"}.xlsx`, blob, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        return;
      }
      const content = await blob.text();
      downloadBlob(`pricing-base-${normalized.fechaReferencia ?? "tabla"}.csv`, content, "text/csv;charset=utf-8");
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error exportando tabla base de pricing." });
    }
  }

  return (
    <div className="omie-layout omie-layout-a">
      <div className="panel wide omie-control-panel">
        <PanelTitle icon={<Calculator size={18} />} title="Pricing base" subtitle="Tabla horaria para apuntamientos" />
        <div className="omie-toolbar compact">
          <label className="filter-field">
            <span>Fecha referencia</span>
            <input disabled={loading} type="date" value={filters.fechaReferencia ?? ""} onChange={(event) => setFilters((current) => ({ ...current, fechaReferencia: event.target.value }))} />
          </label>
          <label className="filter-field checkbox-field">
            <span>Incluir fecha</span>
            <input disabled={loading} checked={filters.incluirFechaReferencia !== false} type="checkbox" onChange={(event) => setFilters((current) => ({ ...current, incluirFechaReferencia: event.target.checked }))} />
          </label>
          <button className="secondary-button" disabled={loading} onClick={() => load(filters, 0)} type="button">
            <Search size={16} />
            Consultar
          </button>
          <button className="secondary-button" disabled={loading} onClick={() => load(defaultFilters(), 0)} type="button">
            <RotateCcw size={16} />
            Limpiar
          </button>
          <button className="secondary-button" disabled={loading} onClick={() => exportPricingBase("csv")} type="button">
            <FileDown size={16} />
            CSV
          </button>
          <button className="secondary-button" disabled={loading} onClick={() => exportPricingBase("xls")} type="button">
            <FileSpreadsheet size={16} />
            Excel
          </button>
        </div>
      </div>

      {message && <div className={`status-message ${message.tone}`}>{message.text}</div>}

      {response && (
        <div className="panel wide">
          <PanelTitle icon={<Calculator size={18} />} title="Validaciones" subtitle={`${response.sourceData.timezone} - ${response.sourceData.profiles} / ${response.sourceData.omie}`} />
          <div className="validation-strip">
            {response.validations.map((validation) => (
              <span className={`validation-pill ${validation.status}`} key={validation.name} title={validation.message}>
                {validation.name.replace(/_/g, " ")}: {validation.status}
              </span>
            ))}
          </div>
        </div>
      )}

      {response && (
        <PricingCalculatorPanel
          cadRadRows={cadRadPeriodSummary}
          drafts={calculatorDrafts}
          lossesRows={lossesPeriodSummary}
          manualValues={calculatorManualValues}
          enabledConcepts={calculatorEnabledConcepts}
          meffMonths={response.meffForward.months}
          meffMatrices={meffPeriodMatrices}
          onDraftChange={(key, value) =>
            setCalculatorDrafts((current) => {
              const next = new Map(current);
              next.set(key, value);
              return next;
            })
          }
          onToggleConcept={(conceptKey, enabled) =>
            setCalculatorEnabledConcepts((current) => {
              const next = new Set(current);
              if (enabled) {
                next.add(conceptKey);
              } else {
                next.delete(conceptKey);
              }
              return next;
            })
          }
          onSave={saveCalculatorManualCell}
          onCopySuccess={(text) => setMessage({ tone: "info", text })}
        />
      )}

      {response && (
        <>
          <div className="view-tabs" role="tablist" aria-label="Perfilado por tarifa">
            <button className={profileTab === "omie" ? "active" : ""} onClick={() => setProfileTab("omie")} type="button">
              OMIE perfilado por tarifa
            </button>
            <button className={profileTab === "meff" ? "active" : ""} onClick={() => setProfileTab("meff")} type="button">
              MEFF perfilado por tarifa
            </button>
          </div>
          {profileTab === "omie" && (
            <ProfiledTariffMatrixPanel
              title="OMIE perfilado por tarifa"
              subtitle="(suma perfil x OMIE / suma perfil) / media OMIE por mes y periodo"
              matrices={omiePeriodMatrices}
              priceLabel="OMIE"
              valueMode="ratio"
            />
          )}
          {profileTab === "meff" && (
            <ProfiledTariffMatrixPanel
              title="MEFF perfilado por tarifa"
              subtitle={`Precio directo MEFF BASE Futuro ${response.meffForward.publicationDate ? `publicado el ${formatDate(response.meffForward.publicationDate)}` : "sin publicacion cargada"}`}
              matrices={meffPeriodMatrices}
              priceLabel="MEFF"
              valueMode="price"
              priceMonths={response.meffForward.months}
              showTotalRow
            />
          )}
        </>
      )}

      {response && (
        <div className="panel wide">
          <PanelTitle icon={<Calculator size={18} />} title="CAD + RAD por tarifa" subtitle="(suma perfil x CAD + suma perfil x RAD) / suma perfil, por periodo" />
          <div className="pricing-matrix-scroll">
            <table className="pricing-matrix-table pricing-period-summary-table">
              <thead>
                <tr>
                  <th>Tarifa</th>
                  {PERIODS.map((period) => (
                    <th key={period}>{period}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cadRadPeriodSummary.map((row) => (
                  <tr key={row.tariff}>
                    <th>{row.tariff}</th>
                    {PERIODS.map((period) => {
                      const cell = row.cells.get(period);
                      return (
                        <td key={period} title={cell ? cadRadCellTitle(cell) : undefined}>
                          {formatMatrixValue(cell?.value ?? null)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {response && (
        <div className="panel wide">
          <PanelTitle icon={<Calculator size={18} />} title="Perdidas por tarifa" subtitle="suma perfil x perdidas / suma perfil, por periodo" />
          <div className="pricing-matrix-scroll">
            <table className="pricing-matrix-table pricing-period-summary-table">
              <thead>
                <tr>
                  <th>Tarifa</th>
                  {PERIODS.map((period) => (
                    <th key={period}>{period}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lossesPeriodSummary.map((row) => (
                  <tr key={row.tariff}>
                    <th>{row.tariff}</th>
                    {PERIODS.map((period) => {
                      const cell = row.cells.get(period);
                      return (
                        <td key={period} title={cell ? lossesCellTitle(cell) : undefined}>
                          {formatMatrixValue(cell?.value ?? null)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}

type ProfiledPeriodMatrixCell = {
  value: number | null;
  weightedPrice: number | null;
  averagePrice: number | null;
  sumProduct: number;
  sumProfile: number;
  priceCount: number;
  sourceLabel?: string;
};

type ProfiledPeriodMatrix = {
  tariff: "2.0TD" | "3.0TD" | "3.0TDVE" | "6.1TD";
  months: Array<{ key: string; label: string }>;
  cells: Map<string, ProfiledPeriodMatrixCell>;
};

type OmieMatrixConfig = {
  tariff: ProfiledPeriodMatrix["tariff"];
  profile: keyof Pick<PricingBaseRow, "perfilIntermedio20TD" | "perfilIntermedio30TD" | "perfilIntermedio30TDVE" | "perfilIntermedio61TD">;
  product: keyof Pick<PricingBaseRow, "productoPerfilOmie20TD" | "productoPerfilOmie30TD" | "productoPerfilOmie30TDVE" | "productoPerfilOmie61TD">;
  price: keyof Pick<PricingBaseRow, "precioOmie">;
  period: keyof Pick<PricingBaseRow, "periodo20TD" | "periodo30TD" | "periodo6XTD">;
};

type MeffMatrixConfig = {
  tariff: ProfiledPeriodMatrix["tariff"];
  profile: keyof Pick<PricingBaseMeffProfileRow, "perfilIntermedio20TD" | "perfilIntermedio30TD" | "perfilIntermedio30TDVE" | "perfilIntermedio61TD">;
  product: keyof Pick<PricingBaseMeffProfileRow, "productoPerfilMeff20TD" | "productoPerfilMeff30TD" | "productoPerfilMeff30TDVE" | "productoPerfilMeff61TD">;
  price: keyof Pick<PricingBaseMeffProfileRow, "precioMeff">;
  period: keyof Pick<PricingBaseMeffProfileRow, "periodo20TD" | "periodo30TD" | "periodo6XTD">;
};

type BasePricingMatrixConfig = {
  tariff: ProfiledPeriodMatrix["tariff"];
  profile: keyof Pick<PricingBaseRow, "perfilIntermedio20TD" | "perfilIntermedio30TD" | "perfilIntermedio30TDVE" | "perfilIntermedio61TD">;
  period: keyof Pick<PricingBaseRow, "periodo20TD" | "periodo30TD" | "periodo6XTD">;
};

type CadRadPeriodCell = {
  value: number | null;
  sumCadProduct: number;
  sumRadProduct: number;
  sumProfile: number;
  rowCount: number;
};

type CadRadPeriodSummaryRow = {
  tariff: ProfiledPeriodMatrix["tariff"];
  cells: Map<string, CadRadPeriodCell>;
};

type CadRadMatrixConfig = BasePricingMatrixConfig & {
  cadProduct: keyof Pick<PricingBaseRow, "productoPerfilCad20TD" | "productoPerfilCad30TD" | "productoPerfilCad30TDVE" | "productoPerfilCad61TD">;
  radProduct: keyof Pick<PricingBaseRow, "productoPerfilRad20TD" | "productoPerfilRad30TD" | "productoPerfilRad30TDVE" | "productoPerfilRad61TD">;
};

type LossesPeriodCell = {
  value: number | null;
  sumLossesProduct: number;
  sumProfile: number;
  rowCount: number;
};

type LossesPeriodSummaryRow = {
  tariff: ProfiledPeriodMatrix["tariff"];
  cells: Map<string, LossesPeriodCell>;
};

type LossesMatrixConfig = BasePricingMatrixConfig & {
  lossesProduct: keyof Pick<PricingBaseRow, "productoPerfilPerdidas20TD" | "productoPerfilPerdidas30TD" | "productoPerfilPerdidas30TDVE" | "productoPerfilPerdidas61TD">;
};

const OMIE_MATRIX_CONFIGS: OmieMatrixConfig[] = [
  { tariff: "2.0TD", profile: "perfilIntermedio20TD", product: "productoPerfilOmie20TD", price: "precioOmie", period: "periodo20TD" },
  { tariff: "3.0TD", profile: "perfilIntermedio30TD", product: "productoPerfilOmie30TD", price: "precioOmie", period: "periodo30TD" },
  { tariff: "3.0TDVE", profile: "perfilIntermedio30TDVE", product: "productoPerfilOmie30TDVE", price: "precioOmie", period: "periodo30TD" },
  { tariff: "6.1TD", profile: "perfilIntermedio61TD", product: "productoPerfilOmie61TD", price: "precioOmie", period: "periodo6XTD" }
];

const MEFF_MATRIX_CONFIGS: MeffMatrixConfig[] = [
  { tariff: "2.0TD", profile: "perfilIntermedio20TD", product: "productoPerfilMeff20TD", price: "precioMeff", period: "periodo20TD" },
  { tariff: "3.0TD", profile: "perfilIntermedio30TD", product: "productoPerfilMeff30TD", price: "precioMeff", period: "periodo30TD" },
  { tariff: "3.0TDVE", profile: "perfilIntermedio30TDVE", product: "productoPerfilMeff30TDVE", price: "precioMeff", period: "periodo30TD" },
  { tariff: "6.1TD", profile: "perfilIntermedio61TD", product: "productoPerfilMeff61TD", price: "precioMeff", period: "periodo6XTD" }
];

const CAD_RAD_MATRIX_CONFIGS: CadRadMatrixConfig[] = [
  {
    tariff: "2.0TD",
    profile: "perfilIntermedio20TD",
    cadProduct: "productoPerfilCad20TD",
    radProduct: "productoPerfilRad20TD",
    period: "periodo20TD"
  },
  {
    tariff: "3.0TD",
    profile: "perfilIntermedio30TD",
    cadProduct: "productoPerfilCad30TD",
    radProduct: "productoPerfilRad30TD",
    period: "periodo30TD"
  },
  {
    tariff: "3.0TDVE",
    profile: "perfilIntermedio30TDVE",
    cadProduct: "productoPerfilCad30TDVE",
    radProduct: "productoPerfilRad30TDVE",
    period: "periodo30TD"
  },
  {
    tariff: "6.1TD",
    profile: "perfilIntermedio61TD",
    cadProduct: "productoPerfilCad61TD",
    radProduct: "productoPerfilRad61TD",
    period: "periodo6XTD"
  }
];

const LOSSES_MATRIX_CONFIGS: LossesMatrixConfig[] = [
  {
    tariff: "2.0TD",
    profile: "perfilIntermedio20TD",
    lossesProduct: "productoPerfilPerdidas20TD",
    period: "periodo20TD"
  },
  {
    tariff: "3.0TD",
    profile: "perfilIntermedio30TD",
    lossesProduct: "productoPerfilPerdidas30TD",
    period: "periodo30TD"
  },
  {
    tariff: "3.0TDVE",
    profile: "perfilIntermedio30TDVE",
    lossesProduct: "productoPerfilPerdidas30TDVE",
    period: "periodo30TD"
  },
  {
    tariff: "6.1TD",
    profile: "perfilIntermedio61TD",
    lossesProduct: "productoPerfilPerdidas61TD",
    period: "periodo6XTD"
  }
];

function ProfiledTariffMatrixPanel({
  title,
  subtitle,
  matrices,
  priceLabel,
  valueMode,
  priceMonths,
  showTotalRow = false
}: {
  title: string;
  subtitle: string;
  matrices: ProfiledPeriodMatrix[];
  priceLabel: string;
  valueMode: "ratio" | "price";
  priceMonths?: NonNullable<PricingBaseResponse["meffForward"]>["months"];
  showTotalRow?: boolean;
}) {
  return (
    <div className="panel wide">
      <PanelTitle icon={<Calculator size={18} />} title={title} subtitle={subtitle} />
      {priceMonths && <MeffPriceSummaryTable months={priceMonths} />}
      <div className="pricing-matrix-grid">
        {matrices.map((matrix) => (
          <div className="pricing-matrix-block" key={matrix.tariff}>
            <h3>{matrix.tariff}</h3>
            <div className="pricing-matrix-scroll">
              <table className="pricing-matrix-table">
                <thead>
                  <tr>
                    <th>Mes</th>
                    {PERIODS.map((period) => (
                      <th key={period}>{period}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.months.map((month) => (
                    <tr key={month.key}>
                      <th>{month.label}</th>
                      {PERIODS.map((period) => {
                        const cell = matrix.cells.get(`${month.key}|${period}`);
                        return (
                          <td key={period} title={cell ? matrixCellTitle(cell, priceLabel, valueMode) : undefined}>
                            {formatMatrixValue((valueMode === "price" ? cell?.weightedPrice : cell?.value) ?? null, valueMode === "price" ? 2 : 6)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {showTotalRow && (
                    <tr className="pricing-total-row">
                      <th>Total</th>
                      {PERIODS.map((period) => (
                        <td key={period}>{formatMatrixValue(sumMatrixPeriod(matrix, period, valueMode), valueMode === "price" ? 2 : 6)}</td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MeffPriceSummaryTable({ months }: { months: NonNullable<PricingBaseResponse["meffForward"]>["months"] }) {
  return (
    <div className="pricing-matrix-scroll pricing-meff-summary-scroll">
      <table className="pricing-matrix-table pricing-meff-summary-table">
        <thead>
          <tr>
            <th>Mes</th>
            {months.map((month) => (
              <th key={month.key}>{month.label}</th>
            ))}
            <th>Promedio</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Precio MEFF</th>
            {months.map((month) => (
              <td key={month.key} title={[month.origin, month.sourceProductCode].filter(Boolean).join(" - ") || undefined}>
                {formatMatrixValue(month.price, 2)}
              </td>
            ))}
            <td>{formatMatrixValue(average(months.map((month) => month.price)), 2)}</td>
          </tr>
          <tr>
            <th>Inc. 7 dias %</th>
            {months.map((month) => (
              <td className={percentageToneClass(month.change7DaysPct)} key={month.key}>{formatPercentage(month.change7DaysPct)}</td>
            ))}
            {renderPercentageAverageCell(months.map((month) => month.change7DaysPct))}
          </tr>
          <tr>
            <th>Inc. 14 dias %</th>
            {months.map((month) => (
              <td className={percentageToneClass(month.change14DaysPct)} key={month.key}>{formatPercentage(month.change14DaysPct)}</td>
            ))}
            {renderPercentageAverageCell(months.map((month) => month.change14DaysPct))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

type PricingCalculatorColumn = {
  tariff: BaseTariff;
  period: (typeof PERIODS)[number];
};

type PricingCalculatorConcept = {
  key:
    | "renta4"
    | "coefForward"
    | "apuntamiento"
    | "pool"
    | "cos"
    | "si3"
    | "ppc"
    | "retribucionOm"
    | "retribucionOs"
    | "aportacionFnee"
    | "desvio"
    | "modificador"
    | "perdidas"
    | "perdidasInc"
    | "costeFinanciero"
    | "atr"
    | "precioFinal";
  label: string;
  kind: "automatic" | "manual" | "manualOverride" | "final";
  manualConcept?: PricingCalculatorManualConcept;
};

const PRICING_CALCULATOR_CONCEPTS: PricingCalculatorConcept[] = [
  { key: "renta4", label: "Renta 4", kind: "manual", manualConcept: "renta4" },
  { key: "coefForward", label: "Coef Forward", kind: "automatic" },
  { key: "apuntamiento", label: "Apuntamiento", kind: "automatic" },
  { key: "pool", label: "Pool", kind: "automatic" },
  { key: "cos", label: "C. Operador del Sistema", kind: "manualOverride", manualConcept: "cos" },
  { key: "si3", label: "SI3", kind: "manual", manualConcept: "si3" },
  { key: "ppc", label: "PPC", kind: "manual", manualConcept: "ppc" },
  { key: "retribucionOm", label: "Retribucion OM", kind: "manual", manualConcept: "retribucionOm" },
  { key: "retribucionOs", label: "Retribucion OS", kind: "manual", manualConcept: "retribucionOs" },
  { key: "aportacionFnee", label: "Aportacion FNEE", kind: "manual", manualConcept: "aportacionFnee" },
  { key: "desvio", label: "Desvio", kind: "manual", manualConcept: "desvio" },
  { key: "modificador", label: "Modificador", kind: "manual", manualConcept: "modificador" },
  { key: "perdidas", label: "Perdidas", kind: "automatic" },
  { key: "perdidasInc", label: "Perdidas Inc.", kind: "manual", manualConcept: "perdidasInc" },
  { key: "costeFinanciero", label: "Coste financiero", kind: "automatic" },
  { key: "atr", label: "ATR", kind: "manual", manualConcept: "atr" },
  { key: "precioFinal", label: "Precio Final", kind: "final" }
];

function PricingCalculatorPanel({
  cadRadRows,
  drafts,
  enabledConcepts,
  lossesRows,
  manualValues,
  meffMonths,
  meffMatrices,
  onDraftChange,
  onToggleConcept,
  onSave,
  onCopySuccess
}: {
  cadRadRows: CadRadPeriodSummaryRow[];
  drafts: Map<string, string>;
  enabledConcepts: Set<CalculatorConceptKey>;
  lossesRows: LossesPeriodSummaryRow[];
  manualValues: Map<string, number | null>;
  meffMonths: NonNullable<PricingBaseResponse["meffForward"]>["months"];
  meffMatrices: ProfiledPeriodMatrix[];
  onDraftChange: (key: string, value: string) => void;
  onToggleConcept: (conceptKey: CalculatorConceptKey, enabled: boolean) => void;
  onSave: (concept: PricingCalculatorManualConcept, tariff: string, period: string, raw: string) => void;
  onCopySuccess: (text: string) => void;
}) {
  const columns = buildPricingCalculatorColumns(meffMatrices);
  const tariffGroups = buildPricingCalculatorTariffGroups(columns);
  const coefForward = average(meffMonths.map((month) => (month.price === null || month.previous7DaysPrice === null ? null : month.price - month.previous7DaysPrice)));
  const meffByTariff = new Map(meffMatrices.map((row) => [row.tariff, row]));
  const cadRadByTariff = new Map(cadRadRows.map((row) => [row.tariff, row]));
  const lossesByTariff = new Map(lossesRows.map((row) => [row.tariff, row]));

  async function copyCalculatorSnapshot() {
    try {
      const text = buildPricingCalculatorClipboardText({
        columns,
        tariffGroups,
        enabledConcepts,
        drafts,
        manualValues,
        meffMatrices,
        cadRadRows,
        lossesRows,
        coefForward
      });
      await navigator.clipboard.writeText(text);
      onCopySuccess("Calculador de precios copiado al portapapeles.");
    } catch {
      onCopySuccess("No se ha podido copiar el calculador de precios.");
    }
  }

  return (
    <div className="panel wide pricing-calculator-panel">
      <div className="pricing-calculator-header">
        <PanelTitle icon={<Calculator size={18} />} title="Calculador de precios" subtitle="Matriz por tarifa y periodo con datos automaticos y parametros manuales persistentes" />
        <button className="secondary-button" disabled={columns.length === 0} onClick={() => void copyCalculatorSnapshot()} type="button">
          <Clipboard size={16} />
          Copiar
        </button>
      </div>
      <div className="pricing-calculator-scroll">
        <table className="pricing-calculator-table">
          <thead>
            <tr>
              <th className="pricing-calculator-sticky" rowSpan={2}>CONCEPTOS</th>
              {tariffGroups.map((group, index) => (
                <th className={`pricing-calculator-tariff-head ${index > 0 ? "pricing-calculator-tariff-start" : ""} ${index < tariffGroups.length - 1 ? "pricing-calculator-tariff-end" : ""}`} colSpan={group.colSpan} key={group.tariff}>
                  {group.tariff}
                </th>
              ))}
            </tr>
            <tr>
              {columns.map((column) => (
                <th className={`pricing-calculator-period-head ${pricingCalculatorTariffBoundaryClass(columns, column)}`} key={pricingCalculatorColumnKey(column)}>{column.period}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PRICING_CALCULATOR_CONCEPTS.map((concept) => (
              <tr className={`pricing-calculator-row pricing-calculator-row--${concept.kind}`} key={concept.key}>
                <th className="pricing-calculator-sticky">
                  <label className="pricing-calculator-concept-toggle">
                    <input
                      checked={enabledConcepts.has(concept.key)}
                      disabled={concept.key === "precioFinal"}
                      onChange={(event) => onToggleConcept(concept.key, event.target.checked)}
                      type="checkbox"
                    />
                    <span>{concept.label}</span>
                  </label>
                </th>
                {columns.map((column) => {
                  const value = calculatePricingCalculatorValue({
                    conceptKey: concept.key,
                    column,
                    enabledConcepts,
                    manualValues,
                    coefForward,
                    meffMatrix: meffByTariff.get(column.tariff),
                    cadRadRow: cadRadByTariff.get(column.tariff),
                    lossesRow: lossesByTariff.get(column.tariff)
                  });
                  if ((concept.kind === "manual" || concept.kind === "manualOverride") && concept.manualConcept) {
                    const key = calculatorManualKey(concept.manualConcept, column.tariff, column.period);
                    const draft = drafts.get(key);
                    const hasManualValue = manualValues.has(key);
                    const inputValue = draft ?? formatCalculatorInputValue(hasManualValue ? (manualValues.get(key) ?? null) : value);
                    return (
                      <td className={`${concept.kind === "manualOverride" && !hasManualValue && draft === undefined ? "pricing-calculator-override-cell" : "pricing-calculator-manual-cell"} ${pricingCalculatorTariffBoundaryClass(columns, column)}`} key={pricingCalculatorColumnKey(column)}>
                        <input
                          title={concept.kind === "manualOverride" && !hasManualValue ? "Valor automatico. Edita para guardar un valor manual; deja vacio para volver al automatico." : undefined}
                          value={inputValue}
                          onBlur={(event) => onSave(concept.manualConcept as PricingCalculatorManualConcept, column.tariff, column.period, event.target.value)}
                          onChange={(event) => onDraftChange(key, event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.currentTarget.blur();
                            }
                          }}
                        />
                      </td>
                    );
                  }
                  return (
                    <td className={`${concept.kind === "final" ? "pricing-calculator-final-cell" : "pricing-calculator-auto-cell"} ${pricingCalculatorTariffBoundaryClass(columns, column)}`} key={pricingCalculatorColumnKey(column)}>
                      {formatMatrixValue(value, 2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function buildOmiePeriodMatrices(rows: PricingBaseRow[]): ProfiledPeriodMatrix[] {
  return buildProfiledPeriodMatrices(rows, OMIE_MATRIX_CONFIGS, MONTHS.map((month) => ({ key: month, label: month })), (row) => String(row.mes));
}

function buildMeffPriceMatrices(months: NonNullable<PricingBaseResponse["meffForward"]>["months"], omieMatrices: ProfiledPeriodMatrix[]): ProfiledPeriodMatrix[] {
  const omieByTariff = new Map(omieMatrices.map((matrix) => [matrix.tariff, matrix]));
  return MEFF_MATRIX_CONFIGS.map((config) => {
    const cells = new Map<string, ProfiledPeriodMatrixCell>();
    const omieMatrix = omieByTariff.get(config.tariff);
    for (const month of months) {
      for (const period of PERIODS) {
        const omieCell = omieMatrix?.cells.get(`${month.month}|${period}`);
        const periodProfileTotal = sumPeriodProfile(omieMatrix, period);
        const value = calculateMeffProfiledValue(month.price, omieCell, periodProfileTotal);
        cells.set(`${month.key}|${period}`, {
          value,
          weightedPrice: value,
          averagePrice: month.price,
          sumProduct: (month.price ?? 0) * (omieCell?.value ?? 0) * (omieCell?.sumProfile ?? 0),
          sumProfile: periodProfileTotal,
          priceCount: value === null ? 0 : 1,
          sourceLabel: [
            [month.origin, month.sourceProductCode].filter(Boolean).join(" - "),
            omieCell ? `MEFF x OMIE x perfil mes-periodo / perfil periodo (${formatOptionalDecimal(omieCell.sumProfile, 12)} / ${formatOptionalDecimal(periodProfileTotal, 12)})` : "sin perfil OMIE"
          ].filter(Boolean).join(" | ")
        });
      }
    }
    return {
      tariff: config.tariff,
      months: months.map((month) => ({ key: month.key, label: month.label })),
      cells
    };
  });
}

function calculateMeffProfiledValue(meffPrice: number | null, omieCell: ProfiledPeriodMatrixCell | undefined, periodProfileTotal: number) {
  if (meffPrice === null || !omieCell || omieCell.value === null || !Number.isFinite(omieCell.value) || omieCell.sumProfile === 0 || periodProfileTotal === 0) {
    return null;
  }
  return (meffPrice * omieCell.value * omieCell.sumProfile) / periodProfileTotal;
}

function sumPeriodProfile(matrix: ProfiledPeriodMatrix | undefined, period: (typeof PERIODS)[number]) {
  if (!matrix) {
    return 0;
  }
  return matrix.months.reduce((sum, month) => sum + (matrix.cells.get(`${month.key}|${period}`)?.sumProfile ?? 0), 0);
}

function sumMatrixPeriod(matrix: ProfiledPeriodMatrix, period: (typeof PERIODS)[number], valueMode: "ratio" | "price") {
  let total = 0;
  let count = 0;
  for (const month of matrix.months) {
    const monthKey = month.key;
    const cell = matrix.cells.get(`${monthKey}|${period}`);
    const value = valueMode === "price" ? cell?.weightedPrice : cell?.value;
    if (typeof value === "number" && Number.isFinite(value)) {
      total += value;
      count += 1;
    }
  }
  return count === 0 ? null : total;
}

function buildProfiledPeriodMatrices<Row extends PricingBaseRow | PricingBaseMeffProfileRow>(
  rows: Row[],
  configs: Array<{
    tariff: ProfiledPeriodMatrix["tariff"];
    profile: keyof Row;
    product: keyof Row;
    price: keyof Row;
    period: keyof Row;
  }>,
  months: Array<{ key: string; label: string }>,
  monthKey: (row: Row) => string
): ProfiledPeriodMatrix[] {
  return configs.map((config) => {
    const groups = new Map<string, { sumProduct: number; sumProfile: number; sumPrice: number; priceCount: number; sourceLabel?: string }>();
    for (const row of rows) {
      const profile = numericOrNull(row[config.profile]);
      const product = numericOrNull(row[config.product]);
      const price = numericOrNull(row[config.price]);
      const period = row[config.period];
      if (!PERIODS.includes(period as (typeof PERIODS)[number]) || profile === null || product === null || price === null) {
        continue;
      }
      const key = `${monthKey(row)}|${period}`;
      const current = groups.get(key) ?? { sumProduct: 0, sumProfile: 0, sumPrice: 0, priceCount: 0, sourceLabel: sourceLabel(row) };
      current.sumProduct += product;
      current.sumProfile += profile;
      current.sumPrice += price;
      current.priceCount += 1;
      groups.set(key, current);
    }

    const cells = new Map<string, ProfiledPeriodMatrixCell>();
    for (const [key, group] of groups.entries()) {
      const weightedPrice = group.sumProfile === 0 ? null : group.sumProduct / group.sumProfile;
      const averagePrice = group.priceCount === 0 ? null : group.sumPrice / group.priceCount;
      const value = weightedPrice === null || averagePrice === null || averagePrice === 0 ? null : weightedPrice / averagePrice;
      cells.set(key, {
        value,
        weightedPrice,
        averagePrice,
        sumProduct: group.sumProduct,
        sumProfile: group.sumProfile,
        priceCount: group.priceCount,
        sourceLabel: group.sourceLabel
      });
    }

    return { tariff: config.tariff, months, cells };
  });
}

function buildCadRadPeriodSummary(rows: PricingBaseRow[]): CadRadPeriodSummaryRow[] {
  return CAD_RAD_MATRIX_CONFIGS.map((config) => {
    const groups = new Map<string, { sumCadProduct: number; sumRadProduct: number; sumProfile: number; rowCount: number }>();
    for (const row of rows) {
      const profile = numericOrNull(row[config.profile]);
      const cadProduct = numericOrNull(row[config.cadProduct]);
      const radProduct = numericOrNull(row[config.radProduct]);
      const period = row[config.period];
      if (!PERIODS.includes(period as (typeof PERIODS)[number]) || profile === null || cadProduct === null || radProduct === null) {
        continue;
      }
      const current = groups.get(period) ?? { sumCadProduct: 0, sumRadProduct: 0, sumProfile: 0, rowCount: 0 };
      current.sumCadProduct += cadProduct;
      current.sumRadProduct += radProduct;
      current.sumProfile += profile;
      current.rowCount += 1;
      groups.set(period, current);
    }

    const cells = new Map<string, CadRadPeriodCell>();
    for (const [period, group] of groups.entries()) {
      cells.set(period, {
        value: group.sumProfile === 0 ? null : (group.sumCadProduct + group.sumRadProduct) / group.sumProfile,
        sumCadProduct: group.sumCadProduct,
        sumRadProduct: group.sumRadProduct,
        sumProfile: group.sumProfile,
        rowCount: group.rowCount
      });
    }
    return { tariff: config.tariff, cells };
  });
}

function buildLossesPeriodSummary(rows: PricingBaseRow[]): LossesPeriodSummaryRow[] {
  return LOSSES_MATRIX_CONFIGS.map((config) => {
    const groups = new Map<string, { sumLossesProduct: number; sumProfile: number; rowCount: number }>();
    for (const row of rows) {
      const profile = numericOrNull(row[config.profile]);
      const lossesProduct = numericOrNull(row[config.lossesProduct]);
      const period = row[config.period];
      if (!PERIODS.includes(period as (typeof PERIODS)[number]) || profile === null || lossesProduct === null) {
        continue;
      }
      const current = groups.get(period) ?? { sumLossesProduct: 0, sumProfile: 0, rowCount: 0 };
      current.sumLossesProduct += lossesProduct;
      current.sumProfile += profile;
      current.rowCount += 1;
      groups.set(period, current);
    }

    const cells = new Map<string, LossesPeriodCell>();
    for (const [period, group] of groups.entries()) {
      cells.set(period, {
        value: group.sumProfile === 0 ? null : group.sumLossesProduct / group.sumProfile,
        sumLossesProduct: group.sumLossesProduct,
        sumProfile: group.sumProfile,
        rowCount: group.rowCount
      });
    }
    return { tariff: config.tariff, cells };
  });
}

function buildPricingCalculatorColumns(matrices: ProfiledPeriodMatrix[]): PricingCalculatorColumn[] {
  return matrices.flatMap((matrix) => periodsForTariff(matrix.tariff).map((period) => ({ tariff: matrix.tariff, period })));
}

function buildPricingCalculatorClipboardText({
  columns,
  tariffGroups,
  enabledConcepts,
  drafts,
  manualValues,
  meffMatrices,
  cadRadRows,
  lossesRows,
  coefForward
}: {
  columns: PricingCalculatorColumn[];
  tariffGroups: Array<{ tariff: BaseTariff; colSpan: number }>;
  enabledConcepts: Set<CalculatorConceptKey>;
  drafts: Map<string, string>;
  manualValues: Map<string, number | null>;
  meffMatrices: ProfiledPeriodMatrix[];
  cadRadRows: CadRadPeriodSummaryRow[];
  lossesRows: LossesPeriodSummaryRow[];
  coefForward: number | null;
}) {
  const meffByTariff = new Map(meffMatrices.map((row) => [row.tariff, row]));
  const cadRadByTariff = new Map(cadRadRows.map((row) => [row.tariff, row]));
  const lossesByTariff = new Map(lossesRows.map((row) => [row.tariff, row]));
  const lines = [
    "Calculador de precios",
    "Estado: [x] habilitado / [ ] deshabilitado",
    "",
    ["CONCEPTOS", ...tariffGroups.map((group) => group.tariff)].join("\t"),
    ["", ...columns.map((column) => column.period)].join("\t")
  ];

  for (const concept of PRICING_CALCULATOR_CONCEPTS) {
    const label = `${enabledConcepts.has(concept.key) ? "[x]" : "[ ]"} ${concept.label}`;
    const values = columns.map((column) => {
      const value = calculatePricingCalculatorValue({
        conceptKey: concept.key,
        column,
        enabledConcepts,
        manualValues,
        coefForward,
        meffMatrix: meffByTariff.get(column.tariff),
        cadRadRow: cadRadByTariff.get(column.tariff),
        lossesRow: lossesByTariff.get(column.tariff)
      });
      if ((concept.kind === "manual" || concept.kind === "manualOverride") && concept.manualConcept) {
        const key = calculatorManualKey(concept.manualConcept, column.tariff, column.period);
        const draft = drafts.get(key);
        return draft ?? formatCalculatorInputValue(manualValues.has(key) ? (manualValues.get(key) ?? null) : value);
      }
      return formatMatrixValue(value, 2);
    });
    lines.push([label, ...values].join("\t"));
  }

  return lines.join("\n");
}

function buildPricingCalculatorTariffGroups(columns: PricingCalculatorColumn[]) {
  const groups: Array<{ tariff: BaseTariff; colSpan: number }> = [];
  for (const column of columns) {
    const last = groups[groups.length - 1];
    if (last?.tariff === column.tariff) {
      last.colSpan += 1;
    } else {
      groups.push({ tariff: column.tariff, colSpan: 1 });
    }
  }
  return groups;
}

function periodsForTariff(tariff: BaseTariff): Array<(typeof PERIODS)[number]> {
  return tariff === "2.0TD" ? ["P1", "P2", "P3"] : [...PERIODS];
}

function calculatePricingCalculatorValue({
  conceptKey,
  column,
  enabledConcepts,
  manualValues,
  coefForward,
  meffMatrix,
  cadRadRow,
  lossesRow
}: {
  conceptKey: CalculatorConceptKey;
  column: PricingCalculatorColumn;
  enabledConcepts: Set<CalculatorConceptKey>;
  manualValues: Map<string, number | null>;
  coefForward: number | null;
  meffMatrix: ProfiledPeriodMatrix | undefined;
  cadRadRow: CadRadPeriodSummaryRow | undefined;
  lossesRow: LossesPeriodSummaryRow | undefined;
}) {
  const apuntamiento = meffMatrix ? sumMatrixPeriod(meffMatrix, column.period, "price") : null;
  const renta4 = manualNumber(manualValues, "renta4", column);
  const pool = nullableSum([
    calculatorContribution(apuntamiento, "apuntamiento", enabledConcepts),
    calculatorContribution(coefForward, "coefForward", enabledConcepts),
    calculatorContribution(renta4, "renta4", enabledConcepts)
  ]);
  const calculatedCos = cadRadRow?.cells.get(column.period)?.value ?? null;
  const cos = manualOverrideNumber(manualValues, "cos", column, calculatedCos);
  const perdidas = lossesRow?.cells.get(column.period)?.value ?? null;
  const si3 = manualNumber(manualValues, "si3", column);
  const ppc = manualNumber(manualValues, "ppc", column);
  const retribucionOm = manualNumber(manualValues, "retribucionOm", column);
  const retribucionOs = manualNumber(manualValues, "retribucionOs", column);
  const aportacionFnee = manualNumber(manualValues, "aportacionFnee", column);
  const desvio = manualNumber(manualValues, "desvio", column);
  const modificador = manualNumber(manualValues, "modificador", column);
  const perdidasInc = manualNumber(manualValues, "perdidasInc", column);
  const atr = manualNumber(manualValues, "atr", column);
  const perdidasRate = percentageToRate(calculatorContribution(perdidas, "perdidas", enabledConcepts));
  const perdidasIncRate = percentageToRate(calculatorContribution(perdidasInc, "perdidasInc", enabledConcepts));
  const baseCostes = nullableSum([
    calculatorContribution(pool, "pool", enabledConcepts),
    calculatorContribution(cos, "cos", enabledConcepts),
    calculatorContribution(si3, "si3", enabledConcepts),
    calculatorContribution(ppc, "ppc", enabledConcepts),
    calculatorContribution(retribucionOm, "retribucionOm", enabledConcepts),
    calculatorContribution(retribucionOs, "retribucionOs", enabledConcepts),
    calculatorContribution(aportacionFnee, "aportacionFnee", enabledConcepts),
    calculatorContribution(desvio, "desvio", enabledConcepts),
    calculatorContribution(modificador, "modificador", enabledConcepts)
  ]);
  const importeConPerdidas = baseCostes === null || perdidasRate === null ? null : baseCostes * (1 + perdidasRate + (perdidasIncRate ?? 0));
  const costeFinanciero = importeConPerdidas === null ? null : importeConPerdidas * 0.0075;
  const final = nullableSum([
    importeConPerdidas,
    calculatorContribution(costeFinanciero, "costeFinanciero", enabledConcepts),
    calculatorContribution(atr, "atr", enabledConcepts)
  ]);

  switch (conceptKey) {
    case "renta4":
      return renta4;
    case "coefForward":
      return coefForward;
    case "apuntamiento":
      return apuntamiento;
    case "pool":
      return pool;
    case "cos":
      return cos;
    case "si3":
      return si3;
    case "ppc":
      return ppc;
    case "retribucionOm":
      return retribucionOm;
    case "retribucionOs":
      return retribucionOs;
    case "aportacionFnee":
      return aportacionFnee;
    case "desvio":
      return desvio;
    case "modificador":
      return modificador;
    case "perdidas":
      return perdidas;
    case "perdidasInc":
      return perdidasInc;
    case "costeFinanciero":
      return costeFinanciero;
    case "atr":
      return atr;
    case "precioFinal":
      return final;
    default:
      return null;
  }
}

function manualNumber(values: Map<string, number | null>, concept: PricingCalculatorManualConcept, column: PricingCalculatorColumn) {
  return values.get(calculatorManualKey(concept, column.tariff, column.period)) ?? 0;
}

function manualOverrideNumber(values: Map<string, number | null>, concept: PricingCalculatorManualConcept, column: PricingCalculatorColumn, automaticValue: number | null) {
  const key = calculatorManualKey(concept, column.tariff, column.period);
  return values.has(key) ? (values.get(key) ?? null) : automaticValue;
}

function calculatorContribution(value: number | null, concept: CalculatorConceptKey, enabledConcepts: Set<CalculatorConceptKey>) {
  return enabledConcepts.has(concept) ? value : 0;
}

function nullableAdd(left: number | null, right: number | null) {
  return left === null || right === null ? null : left + right;
}

function nullableSum(values: Array<number | null>) {
  if (values.some((value) => value === null || value === undefined || !Number.isFinite(value))) {
    return null;
  }
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function percentageToRate(value: number | null) {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value / 100;
}

function buildManualValueMap(values: PricingCalculatorManualValue[]) {
  return new Map(values.map((value) => [calculatorManualKey(value.concepto, value.tarifa, value.periodo), value.valor]));
}

function calculatorManualKey(concept: PricingCalculatorManualConcept, tariff: string, period: string) {
  return `${concept}|${tariff}|${period}`;
}

function pricingCalculatorColumnKey(column: PricingCalculatorColumn) {
  return `${column.tariff}|${column.period}`;
}

function pricingCalculatorTariffBoundaryClass(columns: PricingCalculatorColumn[], column: PricingCalculatorColumn) {
  const index = columns.findIndex((item) => item.tariff === column.tariff && item.period === column.period);
  const previous = columns[index - 1];
  const next = columns[index + 1];
  return [previous && previous.tariff !== column.tariff ? "pricing-calculator-tariff-start" : "", next && next.tariff !== column.tariff ? "pricing-calculator-tariff-end" : ""].filter(Boolean).join(" ");
}

function parseCalculatorInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const compact = trimmed.replace(/\s/g, "");
  const normalized = compact.includes(",") ? compact.replace(/\./g, "").replace(",", ".") : compact;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatCalculatorInputValue(value: number | null) {
  return value === null || value === undefined || !Number.isFinite(value) ? "" : formatDecimalNumber(value, 2);
}

function defaultFilters(): PricingBaseFilters {
  return { fechaReferencia: new Date().toISOString().slice(0, 10), incluirFechaReferencia: true };
}

function normalizeFilters(filters: PricingBaseFilters): PricingBaseFilters {
  return {
    fechaReferencia: filters.fechaReferencia || defaultFilters().fechaReferencia,
    incluirFechaReferencia: filters.incluirFechaReferencia !== false
  };
}

function formatOptionalDecimal(value: number | null, digits: number) {
  return value === null || value === undefined || !Number.isFinite(value) ? "-" : formatDecimalNumber(value, digits);
}

function formatMatrixValue(value: number | null, digits = 6) {
  return value === null || value === undefined || !Number.isFinite(value) ? "-" : formatDecimalNumber(value, digits);
}

function matrixCellTitle(cell: ProfiledPeriodMatrixCell, priceLabel: string, valueMode: "ratio" | "price") {
  if (valueMode === "price") {
    return [
      `${priceLabel}: ${formatOptionalDecimal(cell.weightedPrice, 2)}`,
      cell.sourceLabel ? `Origen: ${cell.sourceLabel}` : ""
    ].filter(Boolean).join("\n");
  }

  return [
    `Ratio: ${formatMatrixValue(cell.value)}`,
    `${priceLabel} ponderado: ${formatOptionalDecimal(cell.weightedPrice, 6)}`,
    `${priceLabel} medio: ${formatOptionalDecimal(cell.averagePrice, 6)}`,
    `Suma producto: ${formatOptionalDecimal(cell.sumProduct, 12)}`,
    `Suma perfil: ${formatOptionalDecimal(cell.sumProfile, 12)}`,
    `Horas: ${formatNumber(cell.priceCount)}`,
    cell.sourceLabel ? `Origen: ${cell.sourceLabel}` : ""
  ].filter(Boolean).join("\n");
}

function formatPercentage(value: number | null) {
  return value === null || value === undefined || !Number.isFinite(value) ? "-" : `${formatDecimalNumber(value, 2)}%`;
}

function renderPercentageAverageCell(values: Array<number | null>) {
  const value = average(values);
  return <td className={percentageToneClass(value)}>{formatPercentage(value)}</td>;
}

function percentageToneClass(value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) {
    return "";
  }
  return value > 0 ? "pricing-negative-change" : "pricing-positive-change";
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return valid.length === 0 ? null : valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function sourceLabel(row: PricingBaseRow | PricingBaseMeffProfileRow) {
  if ("precioMeffOrigen" in row && row.precioMeffOrigen) {
    return [row.precioMeffOrigen, row.precioMeffProductoOrigen].filter(Boolean).join(" - ");
  }
  return undefined;
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function cadRadCellTitle(cell: CadRadPeriodCell) {
  return [
    `Valor: ${formatMatrixValue(cell.value)}`,
    `Suma producto CAD: ${formatOptionalDecimal(cell.sumCadProduct, 12)}`,
    `Suma producto RAD: ${formatOptionalDecimal(cell.sumRadProduct, 12)}`,
    `Suma perfil: ${formatOptionalDecimal(cell.sumProfile, 12)}`,
    `Horas con CAD y RAD: ${formatNumber(cell.rowCount)}`
  ].join("\n");
}

function lossesCellTitle(cell: LossesPeriodCell) {
  return [
    `Perdidas: ${formatMatrixValue(cell.value)}`,
    `Suma producto perdidas: ${formatOptionalDecimal(cell.sumLossesProduct, 12)}`,
    `Suma perfil: ${formatOptionalDecimal(cell.sumProfile, 12)}`,
    `Horas con perdidas: ${formatNumber(cell.rowCount)}`
  ].join("\n");
}

function numericOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
