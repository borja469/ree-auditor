import type { TechnicalPreferencesState, TechnicalSortDirection, TechnicalPreset, TechnicalDensity } from "../types.js";

export type TechnicalPreferencesStorageBackend = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export type TechnicalPreferencesEnvelope = {
  version: number;
  state: TechnicalPreferencesState;
};

export type TechnicalPreferencesMigration = {
  from: number;
  to: number;
  migrate: (state: TechnicalPreferencesState) => TechnicalPreferencesState;
};

export type TechnicalPreferencesStorageOptions = {
  backend?: TechnicalPreferencesStorageBackend;
  keyPrefix?: string;
  version?: number;
  migrations?: Array<TechnicalPreferencesMigration>;
  defaultState?: Partial<TechnicalPreferencesState>;
};

export type TechnicalPreferencesStorageAdapter = {
  version: number;
  load: (key: string) => TechnicalPreferencesState | null;
  save: (key: string, value: TechnicalPreferencesState) => void;
  clear: (key: string) => void;
  migrate: (value: unknown, targetVersion?: number) => TechnicalPreferencesEnvelope | null;
};

export type TechnicalPreferencesStatePatch = Partial<TechnicalPreferencesState> & {
  preset?: TechnicalPreset;
  density?: TechnicalDensity;
  sort?: {
    id: string;
    direction: TechnicalSortDirection;
  };
};
