export type Section =
  | "reeDownloads"
  | "reganecu"
  | "reeSeie"
  | "medidas"
  | "liquidationAnalysis"
  | "reeLosses"
  | "omieProgramas"
  | "omiePrecios"
  | "omieAnalisisMensual"
  | "omieComprobacionLiquidaciones"
  | "omieGarantias"
  | "omieTransacciones"
  | "omieDescargas"
  | "esiosIndicadores"
  | "esiosPerfiles"
  | "esiosSeries"
  | "esiosDescargas"
  | "esiosConfiguracion"
  | "pricingBase"
  | "pricingMeff";

export type ReganecuView = "history" | "summary" | "hourly" | "qh";
export type ReeSeieView = "summary" | "hourly";
export type MedidasView = "history" | "summary" | "qh" | "graphs";
export type ReeLossesViewKey = "history" | "system" | "detail";
export type OmieProgramasViewKey = "mercadoDiario" | "intradiarios" | "evolucion";
export type ImportMode = "reganecu" | "medper" | "reeLosses" | "reeSeie";
export type SidebarGroupKey = "ree" | "omie" | "esios" | "pricing";

export type SidebarMenuItem = {
  key: string;
  label: string;
  description?: string;
  active: boolean;
  onSelect?: () => void;
  children?: SidebarMenuItem[];
};

export type ImportHistoryMode = "reganecu" | "medper";
export type ImportHistoryFile = import("../api").ReeFile | import("../api").MedperFile;
export type LoadStatus = "valid" | "partial" | "error" | "processing";
export type LoadSortKey = "status" | "type" | "period" | "fileName" | "totalRecords" | "validRecords" | "invalidRecords" | "duplicatedRecords" | "importedAt";

export type SidebarGroupConfig = {
  key: SidebarGroupKey;
  title: string;
  active: boolean;
  items: SidebarMenuItem[];
};

export type UploadResponse = {
  summary: import("../api").ImportResponse["summary"];
  results: Array<{
    fileName: string;
    errors: Array<{
      sourceFileName: string;
      lineNumber: number;
      message: string;
    }>;
  }>;
};

export type Message = { tone: "success" | "error" | "info"; text: string };
