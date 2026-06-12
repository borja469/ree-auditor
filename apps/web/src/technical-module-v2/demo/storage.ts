import type { TechnicalModuleDemoSnapshot, TechnicalModuleDemoStorageBackend, TechnicalModuleDemoStorageEnvelope } from "./types.js";

const DEMO_VERSION = 1;
const DEMO_STORAGE_KEY = "technical-module-v2-demo";

function createMemoryBackend(): TechnicalModuleDemoStorageBackend {
  const values = new Map<string, string>();

  return {
    getItem: (key) => (values.has(key) ? values.get(key) ?? null : null),
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    }
  };
}

function isSnapshot(value: unknown): value is TechnicalModuleDemoSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    (candidate.preset === "basic" || candidate.preset === "advanced") &&
    Array.isArray(candidate.hiddenColumns) &&
    candidate.hiddenColumns.every((entry) => typeof entry === "string") &&
    typeof candidate.filters === "object" &&
    candidate.filters !== null &&
    !Array.isArray(candidate.filters) &&
    ("sort" in candidate ? candidate.sort === null || typeof candidate.sort === "object" : true)
  );
}

function normalizeSnapshot(snapshot: Partial<TechnicalModuleDemoSnapshot> | null | undefined): TechnicalModuleDemoSnapshot {
  return {
    preset: snapshot?.preset === "advanced" ? "advanced" : "basic",
    hiddenColumns: Array.isArray(snapshot?.hiddenColumns)
      ? snapshot!.hiddenColumns.filter((entry): entry is string => typeof entry === "string")
      : [],
    filters:
      snapshot?.filters && typeof snapshot.filters === "object" && !Array.isArray(snapshot.filters)
        ? Object.fromEntries(Object.entries(snapshot.filters).filter(([, value]) => typeof value === "string")) as TechnicalModuleDemoSnapshot["filters"]
        : {},
    sort:
      snapshot?.sort && typeof snapshot.sort === "object" && "columnId" in snapshot.sort && "direction" in snapshot.sort
        ? {
            columnId: typeof snapshot.sort.columnId === "string" ? snapshot.sort.columnId : "",
            direction: snapshot.sort.direction === "desc" ? "desc" : "asc"
          }
        : null
  };
}

export function createTechnicalModuleDemoBackend(): TechnicalModuleDemoStorageBackend {
  return createMemoryBackend();
}

export function loadTechnicalModuleDemoSnapshot(
  backend: TechnicalModuleDemoStorageBackend,
  key: string = DEMO_STORAGE_KEY
): TechnicalModuleDemoSnapshot | null {
  const raw = backend.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const envelope = parsed as TechnicalModuleDemoStorageEnvelope;
    if (envelope.version !== DEMO_VERSION || !isSnapshot(envelope.state)) {
      return null;
    }

    return normalizeSnapshot(envelope.state);
  } catch {
    return null;
  }
}

export function saveTechnicalModuleDemoSnapshot(
  backend: TechnicalModuleDemoStorageBackend,
  snapshot: TechnicalModuleDemoSnapshot,
  key: string = DEMO_STORAGE_KEY
): void {
  const envelope: TechnicalModuleDemoStorageEnvelope = {
    version: DEMO_VERSION,
    state: normalizeSnapshot(snapshot)
  };

  backend.setItem(key, JSON.stringify(envelope));
}

export function clearTechnicalModuleDemoSnapshot(
  backend: TechnicalModuleDemoStorageBackend,
  key: string = DEMO_STORAGE_KEY
): void {
  backend.removeItem(key);
}
