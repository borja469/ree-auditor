import { type ReactNode, useMemo } from "react";
import { BarChart3, Search, TrendingUp } from "lucide-react";
import type { EChartsOption } from "echarts";
import { InlineLoading } from "../../../GlobalLoadingOverlay";
import { TechnicalDataTable } from "../../../components/technical-data-table/TechnicalDataTable";
import type { RowQuality, TechnicalColumn, TechnicalKpi } from "../../../components/technical-data-table/TechnicalDataTableTypes";
import type { OmiePrecioPeriodo, OmiePreciosResponse } from "../../../api";
import { formatOmiePrice } from "../detalle-carga/OmieDetalleCargaHelpers";
import { EChart, PanelTitle, formatFixedDecimalNumber, formatFullDate, formatFullDateTime, formatNumber, normalizeNumericValue } from "../../shared/RestoredModuleCommon";
type OmiePreciosProps = {
  fecha: string;
  precios?: OmiePreciosResponse;
  loading: boolean;
  onFechaChange: (value: string) => void;
  onRefresh: () => Promise<void> | void;
  onGoToDownloads: () => void;
};

export function OmiePreciosModule({ fecha, precios, loading, onFechaChange, onRefresh, onGoToDownloads }: OmiePreciosProps) {
  const rows = precios?.periodos ?? [];
  const kpis = useMemo(() => buildOmiePreciosKpis(precios), [precios]);
  const chartOption = useMemo<EChartsOption>(() => buildOmiePreciosChartOption(rows), [rows]);
  const columns = useMemo<Array<TechnicalColumn<OmiePrecioPeriodo>>>(
    () => [
      {
        id: "fecha",
        label: "Fecha",
        width: 118,
        sticky: true,
        type: "date",
        filter: "text",
        value: (row) => row.fecha,
        render: (row) => formatFullDate(row.fecha)
      },
      {
        id: "periodo",
        label: "Periodo",
        width: 78,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.periodo
      },
      {
        id: "clave",
        label: "Clave",
        width: 120,
        filter: "text",
        value: (row) => row.clave
      },
      {
        id: "precioMd",
        label: "Precio MD",
        width: 108,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.precioMd,
        render: (row) => formatOmiePrice(row.precioMd)
      },
      {
        id: "precioMi1",
        label: "Precio MI1",
        width: 108,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.precioMi1,
        render: (row) => formatOmiePrice(row.precioMi1)
      },
      {
        id: "precioMi2",
        label: "Precio MI2",
        width: 108,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.precioMi2,
        render: (row) => formatOmiePrice(row.precioMi2)
      },
      {
        id: "precioMi3",
        label: "Precio MI3",
        width: 108,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.precioMi3,
        render: (row) => formatOmiePrice(row.precioMi3)
      },
      {
        id: "precioXbid",
        label: "Precio XBID",
        width: 110,
        align: "right",
        type: "number",
        filter: "number",
        value: (row) => row.precioXbid,
        render: (row) => formatOmiePrice(row.precioXbid)
      }
    ],
    []
  );
  const quality = useMemo(() => buildOmiePreciosQuality(rows), [rows]);

  if (loading && !precios) {
    return (
      <>
        <section className="content-grid omie-grid">
          <div className="panel wide omie-control-panel">
            <PanelTitle icon={<BarChart3 size={18} />} title="Precios OMIE" />
            <div className="omie-toolbar compact">
              <label className="filter-field">
                <span>Fecha</span>
                <input disabled={loading} type="date" value={fecha} onChange={(event) => onFechaChange(event.target.value)} />
              </label>
              <button className="secondary-button" disabled={loading || !fecha} onClick={onRefresh} type="button">
                <Search size={16} />
                Consultar
              </button>
            </div>
          </div>
        </section>
        <section className="content-grid">
          <div className="panel wide">
            <InlineLoading label="Cargando precios OMIE" />
          </div>
        </section>
      </>
    );
  }

  if (!precios) {
    return (
      <>
        <section className="content-grid omie-grid">
          <div className="panel wide omie-control-panel">
            <PanelTitle icon={<BarChart3 size={18} />} title="Precios OMIE" />
            <div className="omie-toolbar compact">
              <label className="filter-field">
                <span>Fecha</span>
                <input disabled={loading} type="date" value={fecha} onChange={(event) => onFechaChange(event.target.value)} />
              </label>
              <button className="secondary-button" disabled={loading || !fecha} onClick={onRefresh} type="button">
                <Search size={16} />
                Consultar
              </button>
            </div>
          </div>
        </section>
        <section className="content-grid">
          <div className="panel wide">
            <div className="empty-state">
              <strong>Precios OMIE</strong>
              <div>Selecciona una fecha y pulsa Consultar.</div>
              <button className="secondary-button" onClick={onGoToDownloads} type="button">
                Ir a descargas
              </button>
            </div>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <section className="content-grid omie-grid">
        <div className="panel wide omie-control-panel">
          <PanelTitle icon={<BarChart3 size={18} />} title="Precios OMIE" subtitle={`${precios.resolucion} - ${rows.length.toLocaleString("es-ES")} periodos`} />
          <div className="omie-toolbar compact">
            <label className="filter-field">
              <span>Fecha</span>
              <input disabled={loading} type="date" value={fecha} onChange={(event) => onFechaChange(event.target.value)} />
            </label>
            <button className="secondary-button" disabled={loading || !fecha} onClick={onRefresh} type="button">
              <Search size={16} />
              Consultar
            </button>
          </div>
        </div>
      </section>

      <section className="content-grid">
        <div className="panel wide">
          <PanelTitle icon={<TrendingUp size={18} />} title="Evolucion intradia" subtitle={precios.ultimaDescarga ? `Ultima descarga: ${formatFullDateTime(precios.ultimaDescarga)}` : "Sin descargas procesadas"} />
          <EChart option={chartOption} height={360} />
        </div>
      </section>

      <TechnicalDataTable
        columns={columns}
        exportFileName={`omie-precios-${precios.fecha}`}
        getDuplicateKey={(row) => `${row.fecha}|${row.periodo}`}
        getGroupLabel={() => ""}
        getRowId={(row) => row.clave}
        getRowQuality={(row) => quality.rowQuality(row)}
        getTotalsRow={() => buildOmiePreciosTotalsRow(precios)}
        hasNext={false}
        kpis={kpis}
        loading={loading}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        page={0}
        pageSize={rows.length}
        rows={rows}
        showModeSelector={false}
        showPagination={false}
        title="Detalle de precios"
      />
    </>
  );
}


function buildOmiePreciosChartOption(rows: OmiePrecioPeriodo[]): EChartsOption {
  const series = [
    { name: "Precio MD", key: "precioMd" as const },
    { name: "Precio MI1", key: "precioMi1" as const },
    { name: "Precio MI2", key: "precioMi2" as const },
    { name: "Precio MI3", key: "precioMi3" as const },
    { name: "Precio XBID", key: "precioXbid" as const }
  ];

  return {
    color: ["#2563eb", "#16a34a", "#f97316", "#7c3aed", "#0f766e"],
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => (typeof value === "number" ? formatOmiePrice(value) : String(value ?? "-"))
    },
    legend: {
      type: "scroll",
      top: 2,
      textStyle: { color: "#294553", fontWeight: 700 }
    },
    grid: { left: 56, right: 36, top: 58, bottom: 66, containLabel: true },
    dataZoom: [
      { type: "inside", filterMode: "none" },
      { type: "slider", height: 22, bottom: 20, filterMode: "none" }
    ],
    xAxis: {
      type: "category",
      data: rows.map((row) => String(row.periodo)),
      axisLabel: { color: "#5a7381", hideOverlap: true },
      axisLine: { lineStyle: { color: "#bccbd4" } }
    },
    yAxis: {
      type: "value",
      name: "EUR/MWh",
      axisLabel: { color: "#5a7381", formatter: (value: number) => formatFixedDecimalNumber(value, 0) },
      splitLine: { lineStyle: { color: "#edf2f5" } }
    },
    series: series.map((item) => ({
      name: item.name,
      type: "line" as const,
      smooth: true,
      symbolSize: 5,
      connectNulls: false,
      data: rows.map((row) => normalizeNumericValue(row[item.key]) ?? null)
    }))
  };
}

function buildOmiePreciosKpis(precios?: OmiePreciosResponse): TechnicalKpi[] {
  if (!precios) {
    return [];
  }

  const statEntries: Array<[string, keyof OmiePreciosResponse["estadisticas"]]> = [
    ["Precio MD", "precioMd"],
    ["Precio MI1", "precioMi1"],
    ["Precio MI2", "precioMi2"],
    ["Precio MI3", "precioMi3"],
    ["Precio XBID", "precioXbid"]
  ];

  return [
    ...statEntries.map(([label, key]) => {
      const stat = precios.estadisticas[key];
      return {
        label,
        value: formatOmiePrice(stat.media),
        meta: `min ${formatOmiePrice(stat.min)} Â· max ${formatOmiePrice(stat.max)} Â· ${formatNumber(stat.registros)} registros`
      } satisfies TechnicalKpi;
    }),
    { label: "Periodos", value: formatNumber(precios.periodos.length), meta: precios.resolucion },
    { label: "Ultima descarga", value: precios.ultimaDescarga ? formatFullDateTime(precios.ultimaDescarga) : "-", meta: "OMIE" }
  ];
}

function buildOmiePreciosTotalsRow(precios: OmiePreciosResponse): Record<string, ReactNode> {
  const stats = precios.estadisticas;
  return {
    fecha: "Media",
    periodo: `${precios.periodos.length} periodos`,
    clave: precios.resolucion,
    precioMd: formatOmiePrice(stats.precioMd.media),
    precioMi1: formatOmiePrice(stats.precioMi1.media),
    precioMi2: formatOmiePrice(stats.precioMi2.media),
    precioMi3: formatOmiePrice(stats.precioMi3.media),
    precioXbid: formatOmiePrice(stats.precioXbid.media)
  };
}

function buildOmiePreciosQuality(rows: OmiePrecioPeriodo[]) {
  const warnings = rows.filter((row) => [row.precioMd, row.precioMi1, row.precioMi2, row.precioMi3, row.precioXbid].some((value) => value === null || value === undefined)).length;
  const missingSeries = rows.reduce((sum, row) => sum + [row.precioMd, row.precioMi1, row.precioMi2, row.precioMi3, row.precioXbid].filter((value) => value === null || value === undefined).length, 0);

  return {
    warnings,
    missingSeries,
    rowQuality: (row: OmiePrecioPeriodo): RowQuality => {
      const labels = [
        row.precioMd === null || row.precioMd === undefined ? "Precio MD vacio" : "",
        row.precioMi1 === null || row.precioMi1 === undefined ? "Precio MI1 vacio" : "",
        row.precioMi2 === null || row.precioMi2 === undefined ? "Precio MI2 vacio" : "",
        row.precioMi3 === null || row.precioMi3 === undefined ? "Precio MI3 vacio" : "",
        row.precioXbid === null || row.precioXbid === undefined ? "Precio XBID vacio" : ""
      ].filter(Boolean);

      return {
        tone: labels.length > 0 ? (labels.length === 5 ? "danger" : "warning") : "ok",
        labels
      };
    }
  };
}
