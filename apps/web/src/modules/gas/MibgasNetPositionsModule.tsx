import { useEffect, useMemo, useState } from "react";
import { BarChart3, Search } from "lucide-react";
import { TechnicalDataTable } from "../../components/technical-data-table/TechnicalDataTable";
import { stringifyCellValue } from "../../components/technical-data-table/TechnicalDataTableHelpers";
import type { RowQuality, TechnicalColumn } from "../../components/technical-data-table/TechnicalDataTableTypes";
import { getMibgasPrivateNetPositions, type MibgasNetPositionRow } from "../../api";
import { PanelTitle, formatDecimalNumber, formatFullDate, formatNumber } from "../shared/RestoredModuleCommon";

const QUERY_CODE = "3144";
const QUERY_TITLE = "Posicion neta por periodo de entrega";
const DEFAULT_TAKE = 2000;

type Message = { tone: "success" | "error" | "info"; text: string };

type NetPositionFilters = {
  tradingDayFrom?: string;
  tradingDayTo?: string;
  installation?: string;
  includeTotals: boolean;
};

const initialFilters: NetPositionFilters = {
  tradingDayFrom: "",
  tradingDayTo: "",
  installation: "",
  includeTotals: false
};

const INSTALLATIONS = ["PVB", "VTP", "BCN", "BBG", "CAR", "HUE", "REG", "SAG", "TVB", "AVB"];

export function MibgasNetPositionsModule() {
  const [filters, setFilters] = useState<NetPositionFilters>(initialFilters);
  const [rows, setRows] = useState<MibgasNetPositionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<Message>();

  const columns = useMemo<Array<TechnicalColumn<MibgasNetPositionRow>>>(() => buildMibgasNetPositionColumns(), []);

  async function load(nextFilters = filters) {
    setLoading(true);
    setMessage(undefined);
    try {
      const netRows = await getMibgasPrivateNetPositions({
        tradingDayFrom: nextFilters.tradingDayFrom || undefined,
        tradingDayTo: nextFilters.tradingDayTo || undefined,
        installation: nextFilters.installation || undefined,
        includeTotals: nextFilters.includeTotals,
        take: DEFAULT_TAKE
      });
      setRows(netRows);
      if (netRows.length === DEFAULT_TAKE) {
        setMessage({ tone: "info", text: `Mostrando los ultimos ${formatNumber(DEFAULT_TAKE)} registros. Acota el rango para revisar mas detalle.` });
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando posiciones netas MIBGAS." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(initialFilters);
  }, []);

  return (
    <div className="omie-layout omie-layout-a omie-transactions-layout gas-mibgas-module">
      <div className="panel wide omie-control-panel">
        <PanelTitle icon={<BarChart3 size={18} />} title="MIBGAS Posicion neta" subtitle={`Consulta ${QUERY_CODE} - ${QUERY_TITLE}`} />
        <div className="omie-toolbar compact">
          <label className="filter-field">
            <span>Dia gas desde</span>
            <input
              disabled={loading}
              type="date"
              value={filters.tradingDayFrom ?? ""}
              onChange={(event) => setFilters((current) => ({ ...current, tradingDayFrom: event.target.value }))}
            />
          </label>
          <label className="filter-field">
            <span>Dia gas hasta</span>
            <input
              disabled={loading}
              type="date"
              value={filters.tradingDayTo ?? ""}
              onChange={(event) => setFilters((current) => ({ ...current, tradingDayTo: event.target.value }))}
            />
          </label>
          <label className="filter-field">
            <span>Instalacion</span>
            <select
              disabled={loading}
              value={filters.installation ?? ""}
              onChange={(event) => setFilters((current) => ({ ...current, installation: event.target.value }))}
            >
              <option value="">Todas</option>
              {INSTALLATIONS.map((installation) => (
                <option key={installation} value={installation}>
                  {installation}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Totales</span>
            <select
              disabled={loading}
              value={filters.includeTotals ? "1" : ""}
              onChange={(event) => setFilters((current) => ({ ...current, includeTotals: event.target.value === "1" }))}
            >
              <option value="">Excluir</option>
              <option value="1">Incluir</option>
            </select>
          </label>
          <button className="secondary-button" disabled={loading} onClick={() => void load()} type="button">
            <Search size={16} />
            Consultar
          </button>
        </div>
      </div>

      {message && <div className={`status-message ${message.tone}`}>{message.text}</div>}

      <TechnicalDataTable
        columns={columns}
        exportFileName="mibgas-posicion-neta-3144"
        getDuplicateKey={(row) => row.id}
        getGroupLabel={() => ""}
        getRowId={(row) => row.id}
        getRowQuality={buildMibgasNetPositionQuality}
        hasNext={false}
        kpis={[]}
        loading={loading}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        page={0}
        pageSize={Math.max(rows.length, 1)}
        rows={rows}
        showModeSelector={false}
        showPagination={false}
        title={QUERY_TITLE}
      />
    </div>
  );
}

function buildMibgasNetPositionColumns(): Array<TechnicalColumn<MibgasNetPositionRow>> {
  return [
    {
      id: "tradingDay",
      label: "Dia gas",
      width: 108,
      sticky: true,
      type: "date",
      filter: "text",
      value: (row) => row.tradingDay,
      render: (row) => formatFullDate(row.tradingDay)
    },
    {
      id: "installation",
      label: "Instalacion",
      width: 104,
      sticky: true,
      filter: "text",
      value: (row) => row.installation,
      render: (row) => formatText(row.installation)
    },
    {
      id: "portfolioId",
      label: "Cartera",
      width: 142,
      filter: "text",
      value: (row) => row.portfolioId,
      render: (row) => formatText(row.portfolioId)
    },
    {
      id: "productId",
      label: "Producto",
      width: 150,
      filter: "text",
      value: (row) => row.productId,
      render: (row) => formatText(row.productId)
    },
    {
      id: "saleQuantity",
      label: "Venta",
      width: 104,
      align: "right",
      type: "number",
      filter: "number",
      value: (row) => row.saleQuantity,
      render: (row) => formatDecimalText(row.saleQuantity)
    },
    {
      id: "purchaseQuantity",
      label: "Compra",
      width: 104,
      align: "right",
      type: "number",
      filter: "number",
      value: (row) => row.purchaseQuantity,
      render: (row) => formatDecimalText(row.purchaseQuantity)
    },
    {
      id: "netQuantity",
      label: "Neto",
      width: 104,
      align: "right",
      type: "number",
      filter: "number",
      numericTone: "signed",
      value: (row) => row.netQuantity,
      render: (row) => formatDecimalText(row.netQuantity)
    },
    {
      id: "isTotal",
      label: "Tipo fila",
      width: 104,
      filter: "text",
      value: (row) => (row.isTotal ? "Total" : "Detalle"),
      render: (row) => (row.isTotal ? "Total" : "Detalle")
    },
    {
      id: "segmentId",
      label: "Segmento",
      width: 112,
      filter: "text",
      value: (row) => row.segmentId,
      render: (row) => formatText(row.segmentId),
      visibility: "advanced"
    },
    {
      id: "updatedAt",
      label: "Actualizado",
      width: 132,
      type: "date",
      filter: "text",
      value: (row) => row.updatedAt,
      render: (row) => formatDateTime(row.updatedAt),
      visibility: "advanced"
    }
  ];
}

function buildMibgasNetPositionQuality(row: MibgasNetPositionRow): RowQuality {
  const labels = [
    row.tradingDay ? undefined : "Sin dia gas",
    row.installation ? undefined : "Sin instalacion",
    row.productId ? undefined : "Sin producto",
    row.netQuantity ? undefined : "Sin neto"
  ].filter(Boolean) as string[];

  return {
    tone: labels.length ? "warning" : "ok",
    labels
  };
}

function formatText(value?: string | null) {
  return stringifyCellValue(value) || "-";
}

function formatDecimalText(value?: string | null) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? formatDecimalNumber(parsed, 4) : value;
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("es-ES", {
        dateStyle: "short",
        timeStyle: "short"
      }).format(date);
}
