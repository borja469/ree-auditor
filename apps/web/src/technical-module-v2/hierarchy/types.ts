export type TechnicalHierarchyLevel<T> = {
  id: string;
  getKey: (row: T) => string;
  getLabel?: (row: T) => string;
};

export type TechnicalHierarchyNode<T> = {
  id: string;
  level: string;
  key: string;
  label: string;
  depth: number;
  rows: T[];
  children: TechnicalHierarchyNode<T>[];
  aggregates?: Record<string, unknown>;
};

export type TechnicalHierarchyAggregatedNode<T> = TechnicalHierarchyNode<T> & {
  aggregates: Record<string, unknown>;
  children: TechnicalHierarchyAggregatedNode<T>[];
};
