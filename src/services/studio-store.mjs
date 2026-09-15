/**
 * Saved Studio scenarios, including unfinished ones.
 *
 * Unlike `estimate-store.mjs`, which stores a finished result deliberately
 * without its working, this stores the working and nothing else. The two
 * answer different questions. An estimate is a figure somebody argued with
 * and must not change when the engine does; a scenario is a desk with papers
 * on it, and reopening it has to put every paper back where it was —
 * including the ones with nothing written on them yet.
 *
 * So a draft is the normal case here, not a degraded one. `design/05-NO-DRAWING.md`
 * requires incomplete work to be saveable and reopenable without losing inputs
 * or provenance, and requires it to work with no document id, which is why
 * nothing in this file requires one.
 *
 * Results are not stored. They are recomputed from the fields on open, so a
 * reopened scenario can never show a total that its own inputs no longer
 * support.
 */

import { scenario, readiness, started } from "../studio/scenario.mjs";

const KEY = "bw.studio.v1";

export const SCHEMA_VERSION = 1;

/* Generous next to the estimate store's 64KB: a scenario carries per-field
   provenance, which is several times the size of the values themselves. */
export const MAX_SCENARIO_BYTES = 128 * 1024;

function localStore() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function storageAvailable(store) {
  const s = store ?? localStore();
  if (!s) return false;
  try {
    s.setItem("bw.probe", "1");
    s.removeItem("bw.probe");
    return true;
  } catch {
    return false;
  }
}

function readAll(store) {
  const s = store ?? localStore();
  if (!s) return [];
  try {
    const raw = s.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(records, store) {
  const s = store ?? localStore();
  if (!s) return { ok: false, error: "This browser is not storing anything for this site." };
  try {
    s.setItem(KEY, JSON.stringify(records));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Storage refused the write: ${e && e.name ? e.name : "unknown error"}.` };
  }
}

/* A record this build can read. The schema gate is the same one the other
   stores use: withhold rather than misread something another build wrote. */
const readable = (r) =>
  Boolean(r) && typeof r === "object" && r.schema === SCHEMA_VERSION
  && Boolean(r.id) && Boolean(r.fields);

/* ---------------------------------------------------------------- reading */

/**
 * Every scenario this build can read, newest first.
 *
 * Rehydrated through `scenario()` so that a record written before a field
 * existed comes back with that field empty rather than absent — which is what
 * makes acceptance example 7 work without a migration script.
 */
export function loadScenarios(store) {
  return readAll(store)
    .filter(readable)
    .map((r) => scenario(r))
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}

export function loadScenario(id, store) {
  return loadScenarios(store).find((s) => s.id === id) ?? null;
}

export function storeStatus(store) {
  const all = readAll(store);
  const good = all.filter(readable);
  const bad = all.filter((r) => !readable(r));
  return Object.freeze({
    available: storageAvailable(store),
    total: all.length,
    readable: good.length,
    unreadable: bad.length,
    unreadableReasons: Object.freeze(bad.map((r) => {
      if (!r || typeof r !== "object") return "An entry that is not a scenario.";
      if (!r.id) return "A scenario with no id.";
      return `Scenario ${r.name ?? r.id} was saved by schema ${r.schema ?? "unknown"}; this build reads ${SCHEMA_VERSION}.`;
    })),
    schema: SCHEMA_VERSION,
  });
}

/* ---------------------------------------------------------------- writing */

/* Ids created so far in this page's life. Randomness alone is not enough:
   three base-36 characters is 46,656 values, and two hundred ids inside one
   millisecond share a timestamp, which collides about a third of the time by
   the birthday bound. A saved scenario landing on another's id overwrites it.
   The counter makes a collision impossible within a session, and the random
   suffix keeps two sessions in the same millisecond apart. */
let minted = 0;

/** A stable id for a new scenario. */
export function newId() {
  const stamp = Date.now().toString(36);
  const seq = (minted++).toString(36).padStart(3, "0");
  const salt = Math.floor(Math.random() * 46656).toString(36).padStart(3, "0");
  return `SCN-${stamp}-${seq}-${salt}`;
}

/**
 * Save a scenario, finished or not.
 *
 * The saved record carries what is missing at the moment of saving. Not so
 * that reopening trusts it — readiness is recomputed from the fields — but so
 * a list of saved work can say "waiting on a material rate" without loading
 * and recalculating every scenario to find out.
 */
export function saveScenario(s, store) {
  if (!s || !s.id) return { ok: false, error: "A scenario needs an id before it can be stored." };
  if (!started(s)) {
    return { ok: false, error: "Nothing has been entered yet, so there is nothing to save." };
  }

  const r = readiness(s);
  const entry = {
    ...s,
    schema: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    updatedAt: s.updatedAt ?? new Date().toISOString(),
    /* A summary for the list, recomputed on open. Never read as authority. */
    summary: {
      quantityReady: r.quantityPlan.ready,
      costReady: r.cost.ready,
      waitingOn: r.cost.missing.slice(0, 4),
      unknowns: r.unknowns.length,
    },
  };

  const bytes = JSON.stringify(entry).length;
  if (bytes > MAX_SCENARIO_BYTES) {
    return {
      ok: false,
      error: `This scenario is ${Math.round(bytes / 1024)}KB, over the ${Math.round(MAX_SCENARIO_BYTES / 1024)}KB limit.`,
    };
  }

  const all = readAll(store);
  const at = all.findIndex((x) => x && x.id === s.id);
  const previous = at >= 0 ? all[at] : null;

  /* Saving an older revision over a newer one loses work silently, which is
     the one thing a save must never do. The caller reloads and merges. */
  if (previous && Number(previous.revision ?? 0) > Number(s.revision ?? 0)) {
    return {
      ok: false,
      conflict: true,
      error: `The stored copy of this scenario is newer (revision ${previous.revision} against ${s.revision}). Reopen it before saving.`,
      previous,
    };
  }

  if (at >= 0) all[at] = entry; else all.push(entry);

  const written = writeAll(all, store);
  if (!written.ok) return written;
  return { ok: true, replaced: Boolean(previous), id: s.id };
}

export function deleteScenario(id, store) {
  const all = readAll(store);
  const kept = all.filter((r) => !(r && r.id === id));
  if (kept.length === all.length) return { ok: false, error: "No scenario with that id." };
  return writeAll(kept, store);
}

export function clearScenarios(store) {
  return writeAll([], store);
}
