export type TechnicalAggregateKind = "sum" | "avg" | "count" | "min" | "max" | "custom";

export type TechnicalAggregateDefinition<T> = {
  kind: TechnicalAggregateKind;
  getValue?: (row: T) => number | null | undefined;
  calculate?: (rows: T[]) => unknown;
};

export type TechnicalAggregateColumnDefinition<T> = {
  id: string;
  aggregate?: TechnicalAggregateKind | TechnicalAggregateDefinition<T> | null;
};

