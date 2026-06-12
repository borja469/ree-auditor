import { useSyncExternalStore } from "react";

export type LoadingScope = "global" | "local" | "inline" | "button";

export type LoadingTask = {
  id: number;
  label: string;
  scope: LoadingScope;
  blocking: boolean;
  startedAt: number;
  timeoutId: number;
};

export type LoadingSnapshot = {
  active: boolean;
  blocking: boolean;
  count: number;
  globalCount: number;
  localCount: number;
  inlineCount: number;
  buttonCount: number;
  label: string | null;
  tasks: LoadingTask[];
};

export type LoadingOptions = {
  label?: string;
  scope?: LoadingScope;
  blocking?: boolean;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 60000;
let nextId = 1;
let tasks = new Map<number, LoadingTask>();
const listeners = new Set<() => void>();

function computeSnapshot(): LoadingSnapshot {
  const currentTasks = [...tasks.values()];
  const globalTasks = currentTasks.filter((task) => task.scope === "global");
  const blockingTasks = globalTasks.filter((task) => task.blocking);
  const visibleTasks = blockingTasks.length > 0 ? blockingTasks : globalTasks;
  const latest = [...visibleTasks].sort((left, right) => right.startedAt - left.startedAt)[0];
  return {
    active: globalTasks.length > 0,
    blocking: blockingTasks.length > 0,
    count: currentTasks.length,
    globalCount: globalTasks.length,
    localCount: currentTasks.filter((task) => task.scope === "local").length,
    inlineCount: currentTasks.filter((task) => task.scope === "inline").length,
    buttonCount: currentTasks.filter((task) => task.scope === "button").length,
    label: latest?.label ?? null,
    tasks: currentTasks
  };
}

let currentSnapshot = computeSnapshot();

function notify() {
  currentSnapshot = computeSnapshot();
  for (const listener of listeners) {
    listener();
  }
}

function snapshot(): LoadingSnapshot {
  return currentSnapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function beginLoading(options: LoadingOptions = {}) {
  const id = nextId++;
  const task: LoadingTask = {
    id,
    label: options.label ?? "Cargando datos",
    scope: options.scope ?? "global",
    blocking: options.blocking ?? true,
    startedAt: performance.now(),
    timeoutId: window.setTimeout(() => endLoading(id), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  };
  tasks = new Map(tasks).set(id, task);
  notify();

  return () => endLoading(id);
}

export function endLoading(id: number) {
  const task = tasks.get(id);
  if (!task) {
    return;
  }

  window.clearTimeout(task.timeoutId);
  const next = new Map(tasks);
  next.delete(id);
  tasks = next;
  notify();
}

export async function withGlobalLoading<T>(work: () => Promise<T> | T, options: LoadingOptions = {}) {
  const stop = beginLoading({ ...options, scope: options.scope ?? "global" });
  try {
    return await work();
  } finally {
    stop();
  }
}

export function isLoadingScope(state: LoadingSnapshot, scope: LoadingScope) {
  return state.tasks.some((task) => task.scope === scope);
}

export function useGlobalLoadingState() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
