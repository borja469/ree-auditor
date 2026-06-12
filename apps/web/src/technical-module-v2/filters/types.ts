export type TechnicalFilterType = "text" | "number" | "date" | "enum" | "boolean";

export type TechnicalFilterPrimitive = string | number | boolean;

export type TechnicalNumberFilterValue = {
  min?: number | null;
  max?: number | null;
};

export type TechnicalDateFilterValue = {
  from?: string | Date | null;
  to?: string | Date | null;
};

export type TechnicalFilterValue =
  | string
  | number
  | boolean
  | Array<TechnicalFilterPrimitive>
  | TechnicalNumberFilterValue
  | TechnicalDateFilterValue
  | null
  | undefined;

export type TechnicalFilterState = Record<string, TechnicalFilterValue>;

export type TechnicalFilterOption = {
  value: TechnicalFilterPrimitive;
  label: string;
};

export type TechnicalFilterDefinition<T> = {
  id: string;
  type: TechnicalFilterType;
  getValue: (row: T) => unknown;
  label?: string;
};
