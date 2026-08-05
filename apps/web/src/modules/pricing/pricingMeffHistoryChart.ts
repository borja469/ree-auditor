export type PricingMeffHistoryChartPoint = {
  fechaPublicacion: string;
  precio: number | null;
};

export type PricingMeffHistorySelectedPoint = {
  fechaPublicacion: string;
  precio: number | null;
};

export type PricingMeffHistoryRangePreset = "1M" | "3M" | "6M" | "YTD" | "ALL";
export type PricingMeffHistoryChartOption = Record<string, unknown>;

type HistorySeriesPoint = {
  date: string;
  price: number | null;
  previousPrice: number | null;
};

type HistoryStats = {
  minPrice: number;
  maxPrice: number;
  yMin: number;
  yMax: number;
};

const CHART_COLORS = {
  background: "#12212b",
  text: "#edf7fb",
  textMuted: "#b7cbd3",
  grid: "rgba(184, 207, 216, 0.14)",
  axis: "rgba(184, 207, 216, 0.34)",
  primary: "#63c7ee",
  lastPoint: "#f2c94c",
  max: "#ff7b72",
  min: "#57d68d",
  labelBg: "rgba(8, 18, 24, 0.84)",
  tooltipBg: "rgba(8, 18, 24, 0.94)",
  tooltipBorder: "rgba(184, 207, 216, 0.28)",
  dataZoomFill: "rgba(99, 199, 238, 0.24)",
  dataZoomHandle: "#d8edf5"
};

export function buildPricingMeffHistoryChartOption(
  rows: PricingMeffHistoryChartPoint[],
  selectedRow: PricingMeffHistorySelectedPoint,
  rangePreset: PricingMeffHistoryRangePreset,
  compact = false
): PricingMeffHistoryChartOption {
  const seriesRows = buildHistorySeriesRows(rows);
  const stats = getHistoryStats(seriesRows);
  const lastPoint = findLastPricePoint(seriesRows);
  const selectedPoint = findSelectedPoint(seriesRows, selectedRow);
  const range = buildRangeWindow(seriesRows, rangePreset);
  const minLabel = stats ? `Mín. ${formatChartPrice(stats.minPrice, 1)}` : "Mín.";
  const maxLabel = stats ? `Máx. ${formatChartPrice(stats.maxPrice, 1)}` : "Máx.";

  return {
    backgroundColor: CHART_COLORS.background,
    color: [CHART_COLORS.primary, CHART_COLORS.lastPoint, CHART_COLORS.max, CHART_COLORS.min],
    animationDuration: 220,
    aria: {
      enabled: true,
      decal: { show: true }
    },
    legend: {
      top: compact ? 4 : 8,
      right: compact ? 8 : 18,
      textStyle: { color: CHART_COLORS.textMuted, fontSize: compact ? 10 : 12 },
      itemWidth: 18,
      itemHeight: 8,
      data: ["Precio", maxLabel, minLabel]
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "line",
        lineStyle: { color: "rgba(237, 247, 251, 0.45)", width: 1 }
      },
      confine: true,
      backgroundColor: CHART_COLORS.tooltipBg,
      borderColor: CHART_COLORS.tooltipBorder,
      textStyle: { color: CHART_COLORS.text, fontSize: compact ? 11 : 12 },
      formatter: (params: unknown) => formatHistoryTooltip(params, seriesRows, stats)
    },
    grid: {
      left: compact ? 44 : 64,
      right: compact ? 18 : 34,
      top: compact ? 46 : 58,
      bottom: seriesRows.length > 1 ? (compact ? 52 : 64) : 34,
      containLabel: true
    },
    dataZoom: seriesRows.length > 1 ? [
      {
        type: "inside",
        start: range.start,
        end: range.end,
        filterMode: "none",
        zoomOnMouseWheel: true,
        moveOnMouseMove: true
      },
      {
        type: "slider",
        start: range.start,
        end: range.end,
        filterMode: "none",
        height: compact ? 16 : 20,
        bottom: compact ? 12 : 16,
        borderColor: "rgba(184, 207, 216, 0.24)",
        fillerColor: CHART_COLORS.dataZoomFill,
        dataBackground: {
          lineStyle: { color: "rgba(99, 199, 238, 0.36)" },
          areaStyle: { color: "rgba(99, 199, 238, 0.10)" }
        },
        selectedDataBackground: {
          lineStyle: { color: CHART_COLORS.primary },
          areaStyle: { color: "rgba(99, 199, 238, 0.20)" }
        },
        handleStyle: {
          color: CHART_COLORS.dataZoomHandle,
          borderColor: CHART_COLORS.primary
        },
        moveHandleStyle: {
          color: CHART_COLORS.dataZoomHandle
        },
        textStyle: { color: CHART_COLORS.textMuted, fontSize: compact ? 9 : 10 }
      }
    ] : undefined,
    xAxis: {
      type: "category",
      data: seriesRows.map((row) => row.date),
      axisLine: { lineStyle: { color: CHART_COLORS.axis } },
      axisTick: { show: false },
      axisLabel: {
        color: CHART_COLORS.textMuted,
        fontSize: compact ? 10 : 11,
        hideOverlap: true,
        interval: (index: number) => shouldShowDateTick(index, seriesRows.length, compact),
        formatter: (value: string) => formatChartDate(value, compact)
      },
      splitLine: { show: false }
    },
    yAxis: {
      type: "value",
      name: compact ? "" : "Precio (€/MWh)",
      nameTextStyle: { color: CHART_COLORS.textMuted, fontSize: 12, padding: [0, 0, 8, 0] },
      min: stats?.yMin,
      max: stats?.yMax,
      scale: true,
      axisLine: { show: true, lineStyle: { color: CHART_COLORS.axis } },
      axisTick: { show: false },
      axisLabel: {
        color: CHART_COLORS.textMuted,
        fontSize: compact ? 10 : 11,
        formatter: (value: number) => formatNumber(value, 0)
      },
      splitLine: { lineStyle: { color: CHART_COLORS.grid } }
    },
    series: [
      {
        name: "Precio",
        type: "line",
        smooth: false,
        symbol: "circle",
        symbolSize: (value: unknown, params: { dataIndex?: number }) => (params.dataIndex === lastPoint?.index ? 9 : 0),
        showSymbol: true,
        lineStyle: { width: compact ? 2.4 : 3, color: CHART_COLORS.primary },
        itemStyle: { color: CHART_COLORS.lastPoint, borderColor: CHART_COLORS.background, borderWidth: 2 },
        emphasis: { focus: "series" },
        connectNulls: false,
        data: seriesRows.map((row) => row.price),
        markLine: stats ? {
          symbol: "none",
          silent: true,
          label: {
            show: true,
            color: CHART_COLORS.text,
            fontSize: compact ? 10 : 11,
            padding: [4, 7],
            borderRadius: 4,
            backgroundColor: CHART_COLORS.labelBg,
            distance: compact ? 6 : 10
          },
          data: buildReferenceLines(stats)
        } : undefined
      },
      {
        name: "Ultimo valor",
        type: "scatter",
        symbolSize: compact ? 9 : 11,
        data: lastPoint ? [[lastPoint.date, lastPoint.price]] : [],
        itemStyle: { color: CHART_COLORS.lastPoint, borderColor: CHART_COLORS.background, borderWidth: 2 },
        label: {
          show: !!lastPoint && !compact,
          position: "top",
          color: CHART_COLORS.text,
          backgroundColor: CHART_COLORS.labelBg,
          borderRadius: 4,
          padding: [5, 7],
          formatter: () => (lastPoint ? `${formatChartDate(lastPoint.date, false)} · ${formatChartPrice(lastPoint.price, 1)}` : "")
        },
        tooltip: { show: false },
        z: 5
      },
      {
        name: "Fecha marcada",
        type: "scatter",
        symbolSize: compact ? 8 : 10,
        data: selectedPoint ? [[selectedPoint.date, selectedPoint.price]] : [],
        itemStyle: { color: "#ffffff", borderColor: CHART_COLORS.primary, borderWidth: 2 },
        tooltip: { show: false },
        z: 4
      }
    ]
  };
}

export function buildHistorySeriesRows(rows: PricingMeffHistoryChartPoint[]): HistorySeriesPoint[] {
  let previousPrice: number | null = null;
  return rows.map((row) => {
    const current: HistorySeriesPoint = {
      date: row.fechaPublicacion,
      price: row.precio,
      previousPrice
    };
    if (row.precio !== null && Number.isFinite(row.precio)) {
      previousPrice = row.precio;
    }
    return current;
  });
}

export function getHistoryStats(rows: HistorySeriesPoint[]): HistoryStats | undefined {
  const prices = rows.map((row) => row.price).filter((value): value is number => value !== null && Number.isFinite(value));
  if (!prices.length) {
    return undefined;
  }
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const spread = maxPrice - minPrice;
  const margin = spread > 0 ? spread * 0.05 : Math.max(Math.abs(maxPrice) * 0.05, 1);
  return {
    minPrice,
    maxPrice,
    yMin: roundAxisValue(minPrice - margin, "floor"),
    yMax: roundAxisValue(maxPrice + margin, "ceil")
  };
}

export function formatChartPrice(value: number, decimals = 1) {
  return `${formatNumber(value, decimals)} €/MWh`;
}

export function formatChartDate(value: string, compact = false) {
  const parsed = parseIsoDate(value);
  if (!parsed) {
    return value;
  }
  return new Intl.DateTimeFormat("es-ES", compact ? { day: "2-digit", month: "short" } : { day: "2-digit", month: "short", year: "2-digit" }).format(parsed).replace(".", "");
}

export function formatHistoryTooltip(params: unknown, rows: HistorySeriesPoint[], stats?: HistoryStats) {
  const firstParam = Array.isArray(params) ? params[0] : params;
  const dataIndex = typeof firstParam === "object" && firstParam !== null && "dataIndex" in firstParam ? Number((firstParam as { dataIndex?: unknown }).dataIndex) : -1;
  const row = rows[dataIndex];
  if (!row) {
    return "";
  }

  const variation = row.price === null || row.previousPrice === null ? null : row.price - row.previousPrice;
  const distanceToMax = row.price === null || !stats ? null : stats.maxPrice - row.price;
  const distanceToMin = row.price === null || !stats ? null : row.price - stats.minPrice;
  return [
    `<strong>${formatChartDate(row.date, false)}</strong>`,
    `Precio: ${row.price === null ? "-" : formatChartPrice(row.price, 2)}`,
    `Var. día anterior: ${formatSignedPrice(variation)}`,
    `Dif. máximo: ${formatSignedPrice(distanceToMax)}`,
    `Dif. mínimo: ${formatSignedPrice(distanceToMin)}`
  ].join("<br/>");
}

export function getReferenceLabelPosition(kind: "max" | "min", compact = false) {
  if (compact) {
    return kind === "max" ? "insideEndTop" : "insideEndBottom";
  }
  return kind === "max" ? "insideEndTop" : "insideEndBottom";
}

function buildReferenceLines(stats: HistoryStats) {
  return [
    {
      name: `Máx. ${formatChartPrice(stats.maxPrice, 1)}`,
      yAxis: stats.maxPrice,
      lineStyle: { type: "dashed" as const, color: CHART_COLORS.max, width: 1.2, opacity: 0.72 },
      label: { formatter: `Máx. ${formatChartPrice(stats.maxPrice, 1)}`, position: getReferenceLabelPosition("max") }
    },
    {
      name: `Mín. ${formatChartPrice(stats.minPrice, 1)}`,
      yAxis: stats.minPrice,
      lineStyle: { type: "dotted" as const, color: CHART_COLORS.min, width: 1.2, opacity: 0.72 },
      label: { formatter: `Mín. ${formatChartPrice(stats.minPrice, 1)}`, position: getReferenceLabelPosition("min") }
    }
  ];
}

function buildRangeWindow(rows: HistorySeriesPoint[], preset: PricingMeffHistoryRangePreset) {
  if (preset === "ALL" || rows.length <= 1) {
    return { start: 0, end: 100 };
  }

  const lastDate = parseIsoDate(rows[rows.length - 1]?.date);
  if (!lastDate) {
    return { start: 0, end: 100 };
  }

  const fromDate = new Date(lastDate);
  if (preset === "YTD") {
    fromDate.setUTCMonth(0, 1);
  } else {
    const months = preset === "1M" ? 1 : preset === "3M" ? 3 : 6;
    fromDate.setUTCMonth(fromDate.getUTCMonth() - months);
  }

  const firstVisibleIndex = rows.findIndex((row) => {
    const date = parseIsoDate(row.date);
    return date ? date >= fromDate : false;
  });
  if (firstVisibleIndex <= 0) {
    return { start: 0, end: 100 };
  }
  return { start: Math.round((firstVisibleIndex / Math.max(rows.length - 1, 1)) * 100), end: 100 };
}

function findLastPricePoint(rows: HistorySeriesPoint[]) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.price !== null && Number.isFinite(row.price)) {
      return { date: row.date, price: row.price, previousPrice: row.previousPrice, index };
    }
  }
  return undefined;
}

function findSelectedPoint(rows: HistorySeriesPoint[], selectedRow: PricingMeffHistorySelectedPoint) {
  const point = rows.find((row) => row.date === selectedRow.fechaPublicacion);
  const price = point?.price ?? selectedRow.precio;
  return point && price !== null && Number.isFinite(price) ? { date: point.date, price } : undefined;
}

function shouldShowDateTick(index: number, total: number, compact: boolean) {
  if (total <= 1) {
    return true;
  }
  const targetTicks = compact ? 4 : 8;
  const step = Math.max(1, Math.ceil(total / targetTicks));
  return index % step === 0 || index === total - 1;
}

function roundAxisValue(value: number, direction: "floor" | "ceil") {
  const factor = Math.abs(value) >= 100 ? 10 : 1;
  return direction === "floor" ? Math.floor(value / factor) * factor : Math.ceil(value / factor) * factor;
}

function formatSignedPrice(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatChartPrice(value, 2)}`;
}

function formatNumber(value: number, decimals: number) {
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: true
  }).format(value);
}

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return undefined;
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}
