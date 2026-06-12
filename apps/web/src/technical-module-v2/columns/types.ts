import type { TechnicalFilterType } from "../filters/types.js";

export type TechnicalColumnPresetName = string;

export type TechnicalColumnVisibilityOverride = "visible" | "hidden";

export type TechnicalColumnDefinition = {
  id: string;
  label: string;
  presets?: Array<TechnicalColumnPresetName>;
  hiddenByDefault?: boolean;
  filterType?: TechnicalFilterType;
};

export type TechnicalColumnVisibilityState = {
  preset: TechnicalColumnPresetName;
  overrides: Record<string, TechnicalColumnVisibilityOverride>;
};
