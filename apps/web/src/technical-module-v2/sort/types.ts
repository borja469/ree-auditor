import type { TechnicalSortDirection as BaseTechnicalSortDirection } from "../types.js";

export type TechnicalSortDirection = BaseTechnicalSortDirection;

export type TechnicalSortState = {
  columnId: string;
  direction: TechnicalSortDirection;
};

export type TechnicalSortDefinition<T> = {
  id: string;
  getValue: (row: T) => unknown;
  type?: "text" | "number" | "date" | "boolean";
};
