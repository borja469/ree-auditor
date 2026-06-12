import type { TechnicalPreferencesState } from "../types.js";
import { normalizeTechnicalPreferencesState } from "./state.js";
import type {
  TechnicalPreferencesEnvelope,
  TechnicalPreferencesMigration,
  TechnicalPreferencesStorageAdapter,
  TechnicalPreferencesStorageBackend,
  TechnicalPreferencesStorageOptions
} from "./types.js";

const DEFAULT_VERSION = 1;

function createNoopBackend(): TechnicalPreferencesStorageBackend {
  const values = new Map<string, string>();

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) ?? null : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function resolveBackend(backend?: TechnicalPreferencesStorageBackend): TechnicalPreferencesStorageBackend {
  if (backend) {
    return backend;
  }

  const storage = globalThis.localStorage;
  if (storage) {
    return {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
      removeItem: (key) => storage.removeItem(key)
    };
  }

  return createNoopBackend();
}

function composeStorageKey(keyPrefix: string | undefined, key: string): string {
  return keyPrefix ? `${keyPrefix}:${key}` : key;
}

function parseEnvelope(input: unknown): TechnicalPreferencesEnvelope | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const candidate = input as Record<string, unknown>;
  if (typeof candidate.version !== "number" || !Number.isFinite(candidate.version)) {
    return null;
  }

  const state = normalizeTechnicalPreferencesState(candidate.state as Partial<TechnicalPreferencesState> | undefined);
  return {
    version: candidate.version,
    state
  };
}

function normalizeMigrators(migrations: Array<TechnicalPreferencesMigration> | undefined): Array<TechnicalPreferencesMigration> {
  return [...(migrations ?? [])].sort((left, right) => left.from - right.from || left.to - right.to);
}

function migrateEnvelope(
  value: unknown,
  targetVersion: number,
  migrations: Array<TechnicalPreferencesMigration>,
  fallback?: Partial<TechnicalPreferencesState>
): TechnicalPreferencesEnvelope | null {
  const normalizedMigrations = normalizeMigrators(migrations);

  const sourceEnvelope = parseEnvelope(value);
  if (sourceEnvelope && sourceEnvelope.version === targetVersion) {
    return {
      version: targetVersion,
      state: normalizeTechnicalPreferencesState(sourceEnvelope.state, fallback)
    };
  }

  let currentVersion = sourceEnvelope?.version ?? 0;
  let currentState = normalizeTechnicalPreferencesState(
    sourceEnvelope?.state ?? (value as Partial<TechnicalPreferencesState> | undefined),
    fallback
  );

  while (currentVersion < targetVersion) {
    const nextMigration = normalizedMigrations.find((migration) => migration.from === currentVersion);
    if (!nextMigration) {
      return null;
    }

    currentState = normalizeTechnicalPreferencesState(nextMigration.migrate(currentState), fallback);
    currentVersion = nextMigration.to;
  }

  if (currentVersion !== targetVersion) {
    return null;
  }

  return {
    version: targetVersion,
    state: currentState
  };
}

export function createTechnicalPreferencesStorage(
  options: TechnicalPreferencesStorageOptions = {}
): TechnicalPreferencesStorageAdapter {
  const backend = resolveBackend(options.backend);
  const version = options.version ?? DEFAULT_VERSION;
  const keyPrefix = options.keyPrefix;
  const migrations = options.migrations ?? [];
  const defaultState = options.defaultState;

  return {
    version,
    load(key: string): TechnicalPreferencesState | null {
      const rawValue = backend.getItem(composeStorageKey(keyPrefix, key));
      if (rawValue === null) {
        return null;
      }

      try {
        const parsedValue = JSON.parse(rawValue) as unknown;
        const envelope = migrateEnvelope(parsedValue, version, migrations, defaultState);
        return envelope?.state ?? null;
      } catch {
        return null;
      }
    },
    save(key: string, value: TechnicalPreferencesState): void {
      const envelope: TechnicalPreferencesEnvelope = {
        version,
        state: normalizeTechnicalPreferencesState(value, defaultState)
      };

      backend.setItem(composeStorageKey(keyPrefix, key), JSON.stringify(envelope));
    },
    clear(key: string): void {
      backend.removeItem(composeStorageKey(keyPrefix, key));
    },
    migrate(
      value: unknown,
      targetVersion: number = version
    ): TechnicalPreferencesEnvelope | null {
      return migrateEnvelope(value, targetVersion, migrations, defaultState);
    }
  };
}
