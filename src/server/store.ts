import "server-only";
import fs from "node:fs";
import path from "node:path";
import { buildDemoFactory, SCHEMA_VERSION } from "@/domain/seed";
import type { FactoryState } from "@/domain/types";

/**
 * Server-authoritative factory state.
 *
 * Local-first persistence: the state lives in memory (cached on globalThis so every route
 * shares it) and is written through to a JSON file on each mutation, so it survives page
 * refreshes and server restarts. On Cloud Run the file lives on the instance's in-memory
 * filesystem (`/tmp`), so state is per-instance and resets when the instance is recycled —
 * deploy with max-instances=1 for demos (see README).
 */
const DATA_DIR = process.env.TWINFORGE_DATA_DIR || path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "factory-state.json");

type Cache = { state: FactoryState | null; writeError: string | null };
const g = globalThis as unknown as { __twinforge?: Cache };
const cache: Cache = (g.__twinforge ??= { state: null, writeError: null });

function load(): FactoryState {
  try {
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, "utf8")) as FactoryState;
      if (parsed.schemaVersion === SCHEMA_VERSION) return parsed;
    }
  } catch (e) {
    console.warn("[store] could not read persisted state, reseeding:", e);
  }
  const fresh = buildDemoFactory();
  persist(fresh);
  return fresh;
}

function persist(state: FactoryState) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, FILE);
    cache.writeError = null;
  } catch (e) {
    cache.writeError = e instanceof Error ? e.message : String(e);
  }
}

export function getState(): FactoryState {
  if (!cache.state) cache.state = load();
  return cache.state;
}

/** Run a synchronous mutation against the live state and persist it. */
export function mutate<T>(fn: (state: FactoryState) => T): T {
  const state = getState();
  const result = fn(state);
  persist(state);
  return result;
}

export function replaceState(next: FactoryState) {
  cache.state = next;
  persist(next);
  return next;
}

export function persistenceInfo() {
  return {
    kind: "local-json-file" as const,
    path: path.relative(process.cwd(), FILE).startsWith("..") ? FILE : path.relative(process.cwd(), FILE),
    lastWriteError: cache.writeError,
    note: "State is persisted to a local JSON file (per server instance). Not shared across instances.",
  };
}
