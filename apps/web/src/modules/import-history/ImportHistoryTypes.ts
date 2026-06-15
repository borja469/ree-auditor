import type { ImportResponse, ReeFile } from "../../api";
import type { ImportHistoryFile, ImportHistoryMode } from "../../app-shell/AppShellTypes";

export type HistoryViewProps = {
  files: ReeFile[];
  latestImport?: ImportResponse;
  onRefresh?: () => Promise<void> | void;
};

export type ImportHistoryDashboardViewProps = {
  files: ImportHistoryFile[];
  latestImport?: { summary: ImportResponse["summary"] };
  mode: ImportHistoryMode;
  onRefresh?: () => Promise<void> | void;
};