import { useEffect, useMemo, useState } from "react";
import { BarChart3, Search } from "lucide-react";
import { TechnicalDataTable } from "../../components/technical-data-table/TechnicalDataTable";
import { stringifyCellValue } from "../../components/technical-data-table/TechnicalDataTableHelpers";
import type { RowQuality, TechnicalColumn } from "../../components/technical-data-table/TechnicalDataTableTypes";
import { getMibgasPrivateTransactions, type MibgasTransactionRow } from "../../api";
import { formatDateTime } from "../ree-losses/ReeLossesHelpers";
import { PanelTitle, formatDecimalNumber, formatFullDate, formatNumber } from "../shared/RestoredModuleCommon";

const QUERY_CODE = "3140";
const QUERY_TITLE = "Transacciones por periodo de entrega";
const DEFAULT_TAKE = 2000;

type Message = { tone: "success" | "error" | "info"; text: string };
type TransactionSideFilter = "" | "COMPRA" | "VENTA";

type TransactionFilters = {
  tradingDayFrom?: string;
  tradingDayTo?: string;
  side: TransactionSideFilter;
};

const initialFilters: TransactionFilters = {
  tradingDayFrom: "",
  tradingDayTo: "",
  side: ""
};

export function MibgasDeliveryTransactionsModule() {
  const [filters, setFilters] = useState<TransactionFilters>(initialFilters);
  const [rows, setRows] = useState<MibgasTransactionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<Message>();

  const columns = useMemo<Array<TechnicalColumn<MibgasTransactionRow>>>(() => buildMibgasTransactionColumns(), []);

  async function load(nextFilters = filters) {
    setLoading(true);
    setMessage(undefined);
    try {
      const transactionRows = await getMibgasPrivateTransactions({
        tradingDayFrom: nextFilters.tradingDayFrom || undefined,
        tradingDayTo: nextFilters.tradingDayTo || undefined,
        buySellIndicator: nextFilters.side || undefined,
        take: DEFAULT_TAKE
      });
      setRows(transactionRows);
      if (transactionRows.length === DEFAULT_TAKE) {
        setMessage({ tone: "info", text: `Mostrando los ultimos ${formatNumber(DEFAULT_TAKE)} registros. Acota el rango de dias para revisar mas detalle.` });
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Error cargando transacciones MIBGAS." });
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
        <PanelTitle icon={<BarChart3 size={18} />} title="MIBGAS Transacciones" subtitle={`Consulta ${QUERY_CODE} · ${QUERY_TITLE}`} />
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
            <span>Estado / sentido</span>
            <select
              disabled={loading}
              value={filters.side}
              onChange={(event) => setFilters((current) => ({ ...current, side: event.target.value as TransactionSideFilter }))}
            >
              <option value="">Todos</option>
              <option value="COMPRA">Compra</option>
              <option value="VENTA">Venta</option>
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
        exportFileName="mibgas-transacciones-3140"
        getDuplicateKey={(row) => row.transactionId || row.id}
        getGroupLabel={() => ""}
        getRowId={(row) => row.id}
        getRowQuality={buildMibgasTransactionQuality}
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

function buildMibgasTransactionColumns(): Array<TechnicalColumn<MibgasTransactionRow>> {
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
      id: "contractId",
      label: "Producto / contrato",
      width: 156,
      sticky: true,
      filter: "text",
      value: (row) => row.contractId,
      render: (row) => formatText(row.contractId)
    },
    {
      id: "portfolioId",
      label: "Cartera",
      width: 132,
      filter: "text",
      value: (row) => row.portfolioId,
      render: (row) => formatText(row.portfolioId)
    },
    {
      id: "buySellIndicator",
      label: "Sentido",
      width: 92,
      filter: "text",
      value: (row) => row.buySellIndicator,
      render: (row) => formatSide(row.buySellIndicator)
    },
    {
      id: "price",
      label: "Precio",
      width: 104,
      align: "right",
      type: "number",
      filter: "number",
      value: (row) => row.price,
      render: (row) => formatDecimalText(row.price)
    },
    {
      id: "quantity",
      label: "Cantidad",
      width: 112,
      align: "right",
      type: "number",
      filter: "number",
      value: (row) => row.quantity,
      render: (row) => formatDecimalText(row.quantity)
    },
    {
      id: "contractType",
      label: "Segmento",
      width: 118,
      filter: "text",
      value: (row) => row.contractType,
      render: (row) => formatText(row.contractType)
    },
    {
      id: "transactionId",
      label: "Transaccion",
      width: 148,
      filter: "text",
      value: (row) => row.transactionId,
      render: (row) => formatText(row.transactionId)
    },
    {
      id: "orderId",
      label: "Orden",
      width: 132,
      filter: "text",
      value: (row) => row.orderId,
      render: (row) => formatText(row.orderId),
      visibility: "advanced"
    },
    {
      id: "transactionDatetime",
      label: "Fecha transaccion",
      width: 136,
      type: "date",
      filter: "text",
      value: (row) => row.transactionDatetime,
      render: (row) => formatDateTime(row.transactionDatetime),
      visibility: "advanced"
    },
    {
      id: "marketParticipantId",
      label: "Participante",
      width: 132,
      filter: "text",
      value: (row) => row.marketParticipantId,
      render: (row) => formatText(row.marketParticipantId),
      visibility: "advanced"
    },
    {
      id: "auctionNumber",
      label: "Subasta",
      width: 104,
      filter: "text",
      value: (row) => row.auctionNumber,
      render: (row) => formatText(row.auctionNumber),
      visibility: "advanced"
    },
    {
      id: "messageId",
      label: "Mensaje",
      width: 148,
      filter: "text",
      value: (row) => row.messageId,
      render: (row) => formatText(row.messageId),
      visibility: "advanced"
    },
    {
      id: "messageVersion",
      label: "Version",
      width: 92,
      filter: "text",
      value: (row) => row.messageVersion,
      render: (row) => formatText(row.messageVersion),
      visibility: "advanced"
    },
    {
      id: "messageDatetime",
      label: "Fecha mensaje",
      width: 136,
      type: "date",
      filter: "text",
      value: (row) => row.messageDatetime,
      render: (row) => formatDateTime(row.messageDatetime),
      visibility: "advanced"
    }
  ];
}

function buildMibgasTransactionQuality(row: MibgasTransactionRow): RowQuality {
  const labels = [
    row.transactionId ? undefined : "Sin transaccion",
    row.contractId ? undefined : "Sin contrato",
    row.quantity ? undefined : "Sin cantidad",
    row.price ? undefined : "Sin precio"
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

function formatSide(value?: string | null) {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) {
    return "-";
  }
  if (["C", "B", "BUY", "COMPRA"].includes(normalized)) {
    return "Compra";
  }
  if (["V", "S", "SELL", "VENTA"].includes(normalized)) {
    return "Venta";
  }
  return value ?? "-";
}
