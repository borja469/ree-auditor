import { aggregateColumns } from "../aggregation/engine.js";
import type { TechnicalAggregateColumnDefinition } from "../aggregation/types.js";
import type {
  TechnicalHierarchyAggregatedNode,
  TechnicalHierarchyLevel,
  TechnicalHierarchyNode
} from "./types.js";

function encodeNodePart(value: string): string {
  return encodeURIComponent(value);
}

function buildNodeId(parentId: string | null, levelId: string, key: string): string {
  const current = `${encodeNodePart(levelId)}=${encodeNodePart(key)}`;
  return parentId ? `${parentId}/${current}` : current;
}

function createFlatNode<T>(row: T, index: number): TechnicalHierarchyNode<T> {
  const key = String(index);

  return {
    id: buildNodeId(null, "flat", key),
    level: "flat",
    key,
    label: key,
    depth: 0,
    rows: [row],
    children: []
  };
}

function groupRowsByKey<T>(
  rows: readonly T[],
  getKey: (row: T) => string
): Array<{ key: string; rows: T[]; firstRow: T }> {
  const groups = new Map<string, { key: string; rows: T[]; firstRow: T }>();
  const order: string[] = [];

  for (const row of rows) {
    const key = getKey(row);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
      continue;
    }

    groups.set(key, { key, rows: [row], firstRow: row });
    order.push(key);
  }

  return order.map((key) => groups.get(key) as { key: string; rows: T[]; firstRow: T });
}

function buildLevelNodes<T>(
  rows: readonly T[],
  levels: readonly TechnicalHierarchyLevel<T>[],
  levelIndex: number,
  parentId: string | null,
  depth: number
): TechnicalHierarchyNode<T>[] {
  if (rows.length === 0) {
    return [];
  }

  if (levels.length === 0) {
    return rows.map((row, index) => createFlatNode(row, index));
  }

  if (levelIndex >= levels.length) {
    return [];
  }

  const level = levels[levelIndex];
  const groupedRows = groupRowsByKey(rows, level.getKey);

  return groupedRows.map((group) => {
    const nodeId = buildNodeId(parentId, level.id, group.key);
    const children =
      levelIndex + 1 < levels.length
        ? buildLevelNodes(group.rows, levels, levelIndex + 1, nodeId, depth + 1)
        : [];

    return {
      id: nodeId,
      level: level.id,
      key: group.key,
      label: level.getLabel ? level.getLabel(group.firstRow) : group.key,
      depth,
      rows: [...group.rows],
      children
    };
  });
}

function visitNodes<T, TNode extends TechnicalHierarchyNode<T>, TResult>(
  nodes: readonly TNode[],
  visitor: (node: TNode) => TResult | null
): TResult | null {
  for (const node of nodes) {
    const result = visitor(node);
    if (result !== null) {
      return result;
    }

    const childResult = visitNodes(node.children as unknown as readonly TNode[], visitor);
    if (childResult !== null) {
      return childResult;
    }
  }

  return null;
}

function aggregateNode<T>(
  node: TechnicalHierarchyNode<T>,
  aggregateDefinitions: readonly TechnicalAggregateColumnDefinition<T>[]
): TechnicalHierarchyAggregatedNode<T> {
  return {
    ...node,
    rows: [...node.rows],
    aggregates: aggregateColumns(node.rows, aggregateDefinitions),
    children: node.children.map((child) => aggregateNode(child, aggregateDefinitions))
  };
}

export function buildHierarchy<T>(
  rows: readonly T[],
  levels: readonly TechnicalHierarchyLevel<T>[]
): TechnicalHierarchyNode<T>[] {
  return buildLevelNodes(rows, levels, 0, null, 0);
}

export function flattenHierarchy<T, TNode extends TechnicalHierarchyNode<T>>(
  nodes: readonly TNode[]
): TNode[] {
  const flattened: TNode[] = [];

  const walk = (currentNodes: readonly TNode[]) => {
    for (const node of currentNodes) {
      flattened.push(node);
      walk(node.children as unknown as readonly TNode[]);
    }
  };

  walk(nodes);
  return flattened;
}

export function getHierarchyTotals<T, TNode extends TechnicalHierarchyNode<T>>(
  nodes: readonly TNode[]
): Record<string, number> {
  const totals: Record<string, number> = {};

  const walk = (currentNodes: readonly TechnicalHierarchyNode<T>[]) => {
    for (const node of currentNodes) {
      totals[node.id] = node.rows.length;
      walk(node.children);
    }
  };

  walk(nodes);
  return totals;
}

export function findHierarchyNode<T, TNode extends TechnicalHierarchyNode<T>>(
  nodes: readonly TNode[],
  nodeId: string
): TNode | null {
  return visitNodes(nodes, (node) => (node.id === nodeId ? node : null));
}

export function aggregateHierarchy<T>(
  nodes: readonly TechnicalHierarchyNode<T>[],
  aggregateDefinitions: readonly TechnicalAggregateColumnDefinition<T>[]
): TechnicalHierarchyAggregatedNode<T>[] {
  return nodes.map((node) => aggregateNode(node, aggregateDefinitions));
}

export function buildHierarchyWithAggregates<T>(
  rows: readonly T[],
  levels: readonly TechnicalHierarchyLevel<T>[],
  aggregateDefinitions: readonly TechnicalAggregateColumnDefinition<T>[]
): TechnicalHierarchyAggregatedNode<T>[] {
  return aggregateHierarchy(buildHierarchy(rows, levels), aggregateDefinitions);
}
