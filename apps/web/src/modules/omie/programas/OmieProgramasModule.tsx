import { type ReactNode, useMemo } from "react";
import { BarChart3, Search, TrendingUp } from "lucide-react";
import type { EChartsOption } from "echarts";
import { TechnicalDataTable } from "../../../components/technical-data-table/TechnicalDataTable";
import type { RowQuality, TechnicalColumn, TechnicalKpi } from "../../../components/technical-data-table/TechnicalDataTableTypes";
import type { OmieProgramaEvolucionPeriodo, OmieProgramaEvolucionResponse, OmieProgramaPeriodo, OmieProgramaResponse } from "../../../api";
import type { OmieProgramasViewKey } from "../../../app-shell/AppShellTypes";
import { formatOmieEnergy } from "../liquidaciones/OmieLiquidacionesHelpers";
import { EChart, PanelTitle, formatFullDate, formatFullDateTime, formatNumber, sumNumeric } from "../../shared/RestoredModuleCommon";
type OmieProgramasProps = {
  view: OmieProgramasViewKey;
  fecha: string;
  sesion: string;
  mercadoDiario?: OmieProgramaResponse;
  intradiario?: OmieProgramaResponse;
  evolucion?: OmieProgramaEvolucionResponse;
  loading: boolean;
  onFechaChange: (value: string) => void;
  onSesionChange: (value: string) => void;
  onRefresh: () => Promise<void> | void;
  onGoToDownloads: () => void;
} & Record<string, unknown>;

export function OmieProgramasModule({
  view,
  fecha,
  sesion,
  mercadoDiario,
  intradiario,
  evolucion,
  loading,
  onFechaChange,
  onSesionChange,
  onRefresh,
  onGoToDownloads
}: OmieProgramasProps) {
  const dataset = useMemo(() => buildOmieProgramasDataset(view, mercadoDiario, intradiario, evolucion), [evolucion, intradiario, mercadoDiario, view]);
  const kpis = useMemo(() => buildOmieProgramasKpis(view, dataset.response), [dataset.response, view]);
  const chartOption = useMemo<EChartsOption>(() => buildOmieProgramasChartOption(view, dataset.response), [dataset.response, view]);
  const columns = useMemo<Array<TechnicalColumn<OmieProgramaPeriodo | OmieProgramaEvolucionPeriodo>>>(() => buildOmieProgramasColumns(view, dataset.response), [dataset.response, view]);
  const totalsRow = useMemo(() => buildOmieProgramasTotalsRow(view, dataset.response), [dataset.response, view]);
  const getRowQuality = useMemo(() => buildOmieProgramasQuality(view, dataset.response), [dataset.response, view]);

  if (loading && !dataset.response) {
    return (
      <section className="content-grid omie-grid">
        <div className="panel wide omie-control-panel">
          <PanelTitle icon={<BarChart3 size={18} />} title="OMIE Programas" />
          <div className="omie-toolbar compact">
            <label className="filter-field">
              <span>Fecha</span>
              <input disabled={loading} type="date" value={fecha} onChange={(event) => onFechaChange(event.target.value)} />
            </label>
            {view === "intradiarios" && (
              <label className="filter-field">
                <span>Sesion</span>
                <input disabled={loading} inputMode="numeric" maxLength={2} value={sesion} onChange={(event) => onSesionChange(event.target.value)} />
              </label>
            )}
            <button className="secondary-button" disabled={loading || !fecha} onClick={onRefresh} type="button">
              <Search size={16} />
              Consultar
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (!dataset.response) {
    return (
      <section className="content-grid">
        <div className="panel wide">
          <div className="empty-state">
            <strong>OMIE Programas</strong>
            <div>Selecciona una fecha y pulsa Consultar.</div>
            <button className="secondary-button" onClick={onGoToDownloads} type="button">
              Ir a descargas
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="content-grid omie-grid">
        <div className="panel wide omie-control-panel">
          <PanelTitle icon={<BarChart3 size={18} />} title={dataset.title} subtitle={dataset.subtitle} />
          <div className="omie-toolbar compact">
            <label className="filter-field">
              <span>Fecha</span>
              <input disabled={loading} type="date" value={fecha} onChange={(event) => onFechaChange(event.target.value)} />
            </label>
            {view === "intradiarios" && (
              <label className="filter-field">
                <span>Sesion</span>
                <input disabled={loading} inputMode="numeric" maxLength={2} value={sesion} onChange={(event) => onSesionChange(event.target.value)} />
              </label>
            )}
            <button className="secondary-button" disabled={loading || !fecha} onClick={onRefresh} type="button">
              <Search size={16} />
              Consultar
            </button>
          </div>
        </div>
      </section>

      <section className="content-grid">
        <div className="panel wide">
          <PanelTitle icon={<TrendingUp size={18} />} title={dataset.chartTitle} subtitle={dataset.chartSubtitle} />
          <EChart option={chartOption} height={360} />
        </div>
      </section>

      <TechnicalDataTable
        columns={columns}
        exportFileName={`omie-programas-${view}-${dataset.response.fecha}`}
        getDuplicateKey={(row) => `${row.fecha}|${row.periodo}`}
        getGroupLabel={() => ""}
        getRowId={(row) => `${row.fecha}|${row.periodo}`}
        getRowQuality={getRowQuality}
        getTotalsRow={totalsRow ? () => totalsRow : undefined}
        hasNext={false}
        kpis={kpis}
        loading={loading}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        page={0}
        pageSize={dataset.rows.length}
        rows={dataset.rows}
        showModeSelector={false}
        showPagination={false}
        title={dataset.tableTitle}
      />
    </>
  );
}

type OmieProgramasDataset = {
  response?: OmieProgramaResponse | OmieProgramaEvolucionResponse;
  rows: Array<OmieProgramaPeriodo | OmieProgramaEvolucionPeriodo>;
  title: string;
  subtitle: string;
  chartTitle: string;
  chartSubtitle: string;
  tableTitle: string;
};

function buildOmieProgramasDataset(
  view: OmieProgramasViewKey,
  mercadoDiario?: OmieProgramaResponse,
  intradiario?: OmieProgramaResponse,
  evolucion?: OmieProgramaEvolucionResponse
): OmieProgramasDataset {
  if (view === "mercadoDiario") {
    return buildOmieProgramasResponseDataset(mercadoDiario, "Mercado Diario", "Evolucion de energia por periodo", "Detalle de Mercado Diario");
  }

  if (view === "intradiarios") {
    return buildOmieProgramasResponseDataset(intradiario, "Intradiario", "Evolucion de energia por periodo", "Detalle de Intradiario");
  }

  if (!evolucion) {
    return {
      rows: [],
      title: "Evolucion",
      subtitle: "Sin datos",
      chartTitle: "Evolucion comparativa",
      chartSubtitle: "PVD y sesiones intradiarias",
      tableTitle: "Detalle de Evolucion"
    };
  }

  const subtitle = [
    evolucion.pvd ? `PVD ${formatOmieEnergy(evolucion.pvd.totalEnergiaMWh)} MWh` : null,
    `${evolucion.sesiones?.length ?? 0} sesiones`,
    `${evolucion.diferencias?.length ?? 0} diferencias`
  ]
    .filter(Boolean)
    .join(" - ");

  return {
    response: evolucion,
    rows: evolucion.periodos,
    title: "Evolucion",
    subtitle,
    chartTitle: "Comparativa PVD y sesiones",
    chartSubtitle: evolucion.uOfertante,
    tableTitle: "Detalle de Evolucion"
  };
}

function buildOmieProgramasResponseDataset(
  response: OmieProgramaResponse | undefined,
  title: string,
  chartTitle: string,
  tableTitle: string
): OmieProgramasDataset {
  if (!response) {
    return {
      rows: [],
      title,
      subtitle: "Sin datos",
      chartTitle,
      chartSubtitle: "",
      tableTitle
    };
  }

  const subtitle = [
    response.uOfertante,
    response.sesion ? `Sesion ${response.sesion}` : response.tipoPrograma,
    `${formatOmieEnergy(response.totalEnergiaMWh)} MWh`
  ].join(" - ");

  return {
    response,
    rows: response.periodos,
    title,
    subtitle,
    chartTitle,
    chartSubtitle: response.ultimaDescarga ? `Ultima descarga: ${formatFullDateTime(response.ultimaDescarga)}` : "Sin descargas procesadas",
    tableTitle
  };
}

function buildOmieProgramasColumns(view: OmieProgramasViewKey, response?: OmieProgramaResponse | OmieProgramaEvolucionResponse): Array<TechnicalColumn<OmieProgramaPeriodo | OmieProgramaEvolucionPeriodo>> {
  const baseColumns: Array<TechnicalColumn<OmieProgramaPeriodo | OmieProgramaEvolucionPeriodo>> = [
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
      id: "descripcionPeriodo",
      label: "Descripcion",
      width: 180,
      filter: "text",
      value: (row) => row.descripcionPeriodo
    },
    {
      id: "clave",
      label: "Clave",
      width: 118,
      filter: "text",
      value: (row) => row.clave
    },
    {
      id: "energiaMWh",
      label: "Energia MWh",
      width: 118,
      align: "right",
      type: "number",
      filter: "number",
      value: (row) => row.energiaMWh,
      render: (row) => formatOmieEnergy(row.energiaMWh)
    }
  ];

  if (view !== "evolucion" || !response || !("periodos" in response)) {
    return baseColumns;
  }

  const evolution = response as OmieProgramaEvolucionResponse;
  const evolutionRows = evolution.periodos;
  const sessionKeys = [
    ...(evolution.pvd ? ["PVD"] : []),
    ...(evolution.sesiones?.map((item) => item.sesion ?? item.tipoPrograma) ?? []),
    ...new Set(evolutionRows.flatMap((row) => Object.keys(row.sesiones ?? {})))
  ].filter((value): value is string => Boolean(value));
  const uniqueSessionKeys = [...new Set(sessionKeys)];
  const differenceKeys = [
    ...new Set(evolutionRows.flatMap((row) => Object.keys(row.diferencias ?? {})))
  ];

  const evolutionColumns: Array<TechnicalColumn<OmieProgramaEvolucionPeriodo>> = [
    {
      id: "pvd",
      label: "PVD",
      width: 100,
      align: "right",
      type: "number",
      filter: "number",
      value: (row: OmieProgramaEvolucionPeriodo) => row.pvd,
      render: (row: OmieProgramaEvolucionPeriodo) => formatOmieEnergy(row.pvd)
    },
    ...uniqueSessionKeys.map((sessionKey): TechnicalColumn<OmieProgramaEvolucionPeriodo> => ({
      id: `sesion:${sessionKey}`,
      label: sessionKey.startsWith("P") ? sessionKey : `Sesion ${sessionKey}`,
      width: 112,
      align: "right",
      type: "number",
      filter: "number",
      value: (row: OmieProgramaEvolucionPeriodo) => row.sesiones?.[sessionKey] ?? null,
      render: (row: OmieProgramaEvolucionPeriodo) => formatOmieEnergy(row.sesiones?.[sessionKey])
    })),
    ...differenceKeys.map((differenceKey): TechnicalColumn<OmieProgramaEvolucionPeriodo> => ({
      id: `dif:${differenceKey}`,
      label: differenceKey,
      width: 118,
      align: "right",
      type: "number",
      filter: "number",
      value: (row: OmieProgramaEvolucionPeriodo) => row.diferencias?.[differenceKey] ?? null,
      render: (row: OmieProgramaEvolucionPeriodo) => formatOmieEnergy(row.diferencias?.[differenceKey])
    }))
  ];

  return [...baseColumns, ...evolutionColumns] as Array<TechnicalColumn<OmieProgramaPeriodo | OmieProgramaEvolucionPeriodo>>;
}

function buildOmieProgramasKpis(view: OmieProgramasViewKey, response?: OmieProgramaResponse | OmieProgramaEvolucionResponse): TechnicalKpi[] {
  if (!response) {
    return [];
  }

  if (view === "evolucion") {
    const evolution = response as OmieProgramaEvolucionResponse;
    return [
      { label: "PVD", value: `${formatOmieEnergy(evolution.pvd?.totalEnergiaMWh ?? sumNumeric(evolution.periodos.map((row) => row.pvd)))} MWh`, meta: "Programa base" },
      { label: "Sesiones", value: formatNumber(evolution.sesiones?.length ?? 0), meta: "Comparadas" },
      { label: "Diferencias", value: formatNumber(evolution.diferencias?.length ?? 0), meta: "Series" },
      { label: "Periodos", value: formatNumber(evolution.periodos.length), meta: "15 min" },
      { label: "Ofertante", value: evolution.uOfertante, meta: "OMIE" }
    ];
  }

  const base = response as OmieProgramaResponse;
  return [
    { label: "Energia total", value: `${formatOmieEnergy(base.totalEnergiaMWh)} MWh`, meta: base.tipoPrograma },
    { label: "Periodos", value: formatNumber(base.periodos.length), meta: base.resolucion },
    { label: "Sesion", value: base.sesion ?? "-", meta: view === "intradiarios" ? "Intradiario" : "Mercado Diario" },
    { label: "Ofertante", value: base.uOfertante, meta: "OMIE" },
    { label: "Ultima descarga", value: base.ultimaDescarga ? formatFullDateTime(base.ultimaDescarga) : "-", meta: "OMIE" }
  ];
}

function buildOmieProgramasTotalsRow(view: OmieProgramasViewKey, response?: OmieProgramaResponse | OmieProgramaEvolucionResponse): Record<string, ReactNode> | undefined {
  if (!response) {
    return undefined;
  }

  if (view === "evolucion") {
    const evolution = response as OmieProgramaEvolucionResponse;
    return {
      fecha: "Total",
      periodo: formatNumber(evolution.periodos.length),
      descripcionPeriodo: evolution.pvd ? "PVD + sesiones" : "Evolucion",
      clave: "",
      energiaMWh: formatOmieEnergy(sumNumeric(evolution.periodos.map((row) => row.energiaMWh))),
      pvd: formatOmieEnergy(evolution.pvd?.totalEnergiaMWh ?? sumNumeric(evolution.periodos.map((row) => row.pvd))),
    };
  }

  const base = response as OmieProgramaResponse;
  return {
    fecha: "Total",
    periodo: formatNumber(base.periodos.length),
    descripcionPeriodo: base.tipoPrograma,
    clave: base.sesion ?? "",
    energiaMWh: formatOmieEnergy(base.totalEnergiaMWh)
  };
}

function buildOmieProgramasQuality(view: OmieProgramasViewKey, response?: OmieProgramaResponse | OmieProgramaEvolucionResponse) {
  return (row: OmieProgramaPeriodo | OmieProgramaEvolucionPeriodo): RowQuality => {
    const labels = [
      row.energiaMWh === null || row.energiaMWh === undefined ? "Energia vacia" : "",
      row.descripcionPeriodo ? "" : "Descripcion vacia"
    ].filter(Boolean);

    if (view === "evolucion" && "pvd" in row) {
      if (row.pvd === null || row.pvd === undefined) {
        labels.push("PVD vacio");
      }
      if (Object.values(row.sesiones ?? {}).every((value) => value === null || value === undefined)) {
        labels.push("Sin sesiones");
      }
    }

    return {
      tone: labels.length > 0 ? "warning" : response ? "ok" : "warning",
      labels
    };
  };
}

function buildOmieProgramasChartOption(view: OmieProgramasViewKey, response?: OmieProgramaResponse | OmieProgramaEvolucionResponse): EChartsOption {
  if (!response) {
    return {};
  }

  if (view === "evolucion" && "pvd" in response) {
    const evolution = response as OmieProgramaEvolucionResponse;
    const rows = evolution.periodos;
    const sessionKeys = [...new Set([
      ...(evolution.sesiones?.map((item) => item.sesion ?? item.tipoPrograma) ?? []),
      ...rows.flatMap((row) => Object.keys(row.sesiones ?? {}))
    ])].filter((value): value is string => Boolean(value));
    const differenceKeys = [...new Set(rows.flatMap((row) => Object.keys(row.diferencias ?? {})))];

    return {
      color: ["#2563eb", "#16a34a", "#f97316", "#7c3aed", "#0f766e", "#dc2626", "#0891b2"],
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) => (typeof value === "number" ? formatOmieEnergy(value) : String(value ?? "-"))
      },
      legend: {
        type: "scroll",
        top: 2,
        textStyle: { color: "#294553", fontWeight: 700 }
      },
      grid: { left: 56, right: 52, top: 58, bottom: 66, containLabel: true },
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
      yAxis: [
        {
          type: "value",
          name: "MWh",
          axisLabel: { color: "#5a7381", formatter: (value: number) => formatOmieEnergy(value) },
          splitLine: { lineStyle: { color: "#edf2f5" } }
        },
        {
          type: "value",
          name: "Dif.",
          axisLabel: { color: "#5a7381", formatter: (value: number) => formatOmieEnergy(value) },
          splitLine: { show: false }
        }
      ],
      series: [
        {
          name: "PVD",
          type: "line" as const,
          smooth: true,
          symbolSize: 6,
          yAxisIndex: 0,
          data: rows.map((row) => row.pvd ?? null)
        },
        ...sessionKeys.map((sessionKey) => ({
          name: sessionKey.startsWith("P") ? sessionKey : `Sesion ${sessionKey}`,
          type: "line" as const,
          smooth: true,
          symbolSize: 5,
          yAxisIndex: 0,
          data: rows.map((row) => row.sesiones?.[sessionKey] ?? null)
        })),
        ...differenceKeys.map((differenceKey) => ({
          name: differenceKey,
          type: "bar" as const,
          yAxisIndex: 1,
          data: rows.map((row) => row.diferencias?.[differenceKey] ?? null)
        }))
      ]
    };
  }

  const base = response as OmieProgramaResponse;
  const rows = base.periodos;
  return {
    color: ["#2563eb"],
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => (typeof value === "number" ? formatOmieEnergy(value) : String(value ?? "-"))
    },
    legend: {
      show: false
    },
    grid: { left: 56, right: 36, top: 20, bottom: 50, containLabel: true },
    dataZoom: [
      { type: "inside", filterMode: "none" },
      { type: "slider", height: 22, bottom: 10, filterMode: "none" }
    ],
    xAxis: {
      type: "category",
      data: rows.map((row) => String(row.periodo)),
      axisLabel: { color: "#5a7381", hideOverlap: true },
      axisLine: { lineStyle: { color: "#bccbd4" } }
    },
    yAxis: {
      type: "value",
      name: "MWh",
      axisLabel: { color: "#5a7381", formatter: (value: number) => formatOmieEnergy(value) },
      splitLine: { lineStyle: { color: "#edf2f5" } }
    },
    series: [
      {
        name: base.tipoPrograma,
        type: "line" as const,
        smooth: true,
        symbolSize: 6,
        data: rows.map((row) => row.energiaMWh)
      }
    ]
  };
}

