import type {
  MedperCurves,
  MedperFile,
  MedperFilterOptions,
  MedperFilters,
  MedperImportResponse,
  MedperMonthlyConsumptionRow,
  MedperSummary,
  MedperqhRecord
} from "../../api";
import type { MedidasView } from "../../app-shell/AppShellTypes";

export type MedperFilterBandProps = {
  view: MedidasView;
  filters: MedperFilters;
  options?: MedperFilterOptions;
  onChange: (key: keyof MedperFilters, value: string) => void;
  onApply: () => void;
  disabled?: boolean;
};

export type MedperViewPanelProps = {
  activeView: MedidasView;
  files: MedperFile[];
  latestImport?: MedperImportResponse;
  summary?: MedperSummary;
  monthlyConsumption: MedperMonthlyConsumptionRow[];
  qhRows: MedperqhRecord[];
  curves?: MedperCurves;
  qhGraphFilters: MedperFilters;
  filterOptions?: MedperFilterOptions;
  selectedMonth: string | null;
  qhPage: number;
  qhPageSize: number;
  qhHasNext: boolean;
  loading: boolean;
  onQhPageChange: (page: number) => void;
  onQhPageSizeChange: (pageSize: number) => void;
  loadQhExportRows: () => Promise<MedperqhRecord[]>;
  onQhGraphFilterChange: (key: keyof MedperFilters, value: string) => void;
  onQhGraphApply: () => void;
  onRefreshHistory: () => Promise<void> | void;
};
