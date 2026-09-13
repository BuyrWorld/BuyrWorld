/**
 * Local-first case storage.
 *
 * A supplier claim is not a sitting. The letter lands on Monday, the cost
 * breakdown is chased on Tuesday, the index print arrives on Thursday, and the
 * decision is taken the week after. Until this existed, the product required
 * all of that before you closed the tab: `index.html` touched `localStorage`
 * exactly zero times, so every input, driver, extraction and confirmation died
 * on refresh.
 *
 * Cases stay in the viewer's browser, like outcomes, for the same reason: a
 * demonstration that asks people not to enter real supplier data has no
 * business sending anything anywhere.
 *
 * Three things this has to get right.
 *
 *   1. BigInt. Every figure in the engine is one, and JSON.stringify throws on
 *      it. The tagging is imported from the outcome store rather than copied,
 *      so the two stores cannot drift into different formats.
 *
 *   2. Versioning. A case stored by a different build may not mean what this
 *      build thinks it means. Rather than hand a caller a shape it might
 *      misread, an unreadable case is withheld and reported. Silently opening
 *      it would be the worse failure: the arithmetic would look fine.
 *
 *   3. Size. A case can carry a pasted letter, and localStorage has one shared
 *      quota. One oversized case must not be able to push out every other one,
 *      so a payload over the cap is refused with its actual size rather than
 *      being attempted and taking the write down with it.
 */

import { serialise, deserialise } from "./outcome-store.mjs";

const KEY = "bw.cases.v1";

/** Bump when the stored shape changes meaning. Older cases are then withheld. */
export const SCHEMA_VERSION = 1;

/** Per-case cap. Generous for a letter, small against a 5MB shared quota. */
export const MAX_CASE_BYTES = 256 * 1024;

/** Where a case has got to. Nothing here implies approval. */
export const STATUS = Object.freeze({
  DRAFT: "draft",           // being entered
  ANALYSED: "analysed",     // the bridge has run
  DECIDED: "decided",       // a position was taken
  CLOSED: "closed",         // an outcome was recorded against it
});

const store_ = (s) => s ?? globalThis.localStorage;

/** Unique enough, without assuming crypto.randomUUID exists. */
function newId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* fall through */ }
  return "c-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

/* ------------------------------------------------------------------ shape */

/**
 * Build a case envelope. `data` is opaque to the store: the form owns its own
 * shape, and the store's job is to keep it intact, not to understand it.
 *
 * @param {object} input
 * @param {string} [input.ref]       the human reference, e.g. "SC-001"
 * @param {string} [input.supplier]
 * @param {string} [input.category]
 * @param {string} [input.status]
 * @param {object} [input.data]      whatever the page needs to resume
 * @param {object} [input.summary]   figures from the last calculation, if any
 * @param {boolean} [input.synthetic]
 */
export function newCase(input = {}) {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id ?? newId(),
    schema: SCHEMA_VERSION,
    ref: input.ref ?? null,
    supplier: input.supplier ?? null,
    category: input.category ?? null,
    status: input.status ?? STATUS.DRAFT,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    // Synthetic unless someone explicitly says otherwise, so an unlabelled
    // case is never presented as real.
    synthetic: input.synthetic !== false,
    outcomeRecorded: input.outcomeRecorded ?? false,
    /* Figures from the last calculation, kept beside the form payload rather
       than inside it: the portfolio totals what is still in dispute across open
       cases, and re-deriving that from field strings would mean teaching it the
       form's shape. Absent until a case has been calculated — and an absent
       summary is an unknown, never a zero. */
    summary: input.summary ?? null,
    data: input.data ?? {},
  };
}

/* ---------------------------------------------------------------- access */

/** Is storage usable at all? Answers without throwing. */
export function storageAvailable(store) {
  try {
    const s = store_(store);
    if (!s) return false;
    const probe = KEY + ".probe";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** Everything on disk, readable or not. Internal. */
function readAll(store) {
  try {
    const raw = store_(store)?.getItem(KEY);
    if (!raw) return [];
    const parsed = deserialise(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const readable = (c) => Boolean(c) && typeof c === "object" && c.schema === SCHEMA_VERSION && Boolean(c.id);

const byRecency = (a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""));

/**
 * Cases this build can open, most recently touched first.
 * Never throws; an unreadable store is an empty list.
 */
export function loadCases(store) {
  return readAll(store).filter(readable).sort(byRecency);
}

/** One case by id, or null. */
export function loadCase(id, store) {
  return loadCases(store).find((c) => c.id === id) ?? null;
}

/**
 * Summaries for a list view — enough to choose between cases without loading
 * every pasted letter into the page at once.
 */
export function listCases(store) {
  return loadCases(store).map((c) => Object.freeze({
    id: c.id,
    ref: c.ref,
    supplier: c.supplier,
    category: c.category,
    status: c.status,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    synthetic: c.synthetic !== false,
    outcomeRecorded: Boolean(c.outcomeRecorded),
  }));
}

/**
 * What is actually in storage, including what cannot be opened.
 *
 * A case withheld by the version gate must be visible somewhere, or it looks
 * like data loss.
 */
export function storeStatus(store) {
  const all = readAll(store);
  const good = all.filter(readable);
  const bad = all.filter((c) => !readable(c));
  return Object.freeze({
    available: storageAvailable(store),
    total: all.length,
    readable: good.length,
    unreadable: bad.length,
    unreadableReasons: Object.freeze(bad.map((c) => {
      if (!c || typeof c !== "object") return "An entry that is not a case.";
      if (!c.id) return "A case with no id.";
      return `Case ${c.ref ?? c.id} was saved by schema ${c.schema ?? "unknown"}; this build reads ${SCHEMA_VERSION}.`;
    })),
    schema: SCHEMA_VERSION,
  });
}

/* ----------------------------------------------------------------- write */

/**
 * Insert or update one case, by id.
 *
 * @returns {{ok: boolean, id?: string, count?: number, bytes?: number, error?: string}}
 */
export function saveCase(caseObj, store) {
  const s = store_(store);
  if (!s) {
    return { ok: false, error: "This browser is not allowing local storage, so the case was not saved." };
  }
  if (!caseObj || typeof caseObj !== "object" || !caseObj.id) {
    return { ok: false, error: "That is not a case. Build one with newCase() first." };
  }

  const record = { ...caseObj, schema: SCHEMA_VERSION, updatedAt: new Date().toISOString() };

  // Measure before writing. A payload over the cap is refused on its own,
  // rather than being attempted and taking every other case down with it.
  let encoded;
  try {
    encoded = serialise(record);
  } catch (e) {
    return { ok: false, error: `The case could not be encoded: ${e?.message ?? e}` };
  }
  const bytes = encoded.length;
  if (bytes > MAX_CASE_BYTES) {
    return {
      ok: false, bytes,
      error: `This case is ${Math.round(bytes / 1024)}KB, over the ${Math.round(MAX_CASE_BYTES / 1024)}KB limit. ` +
             `Shorten the pasted documents — the figures and confirmations are what need keeping, not the full text.`,
    };
  }

  try {
    // Preserve entries this build cannot read. They belong to someone's other
    // build, and dropping them here would be silent data loss.
    const all = readAll(s);
    const i = all.findIndex((c) => c && c.id === record.id);
    if (i >= 0) all[i] = record; else all.unshift(record);
    s.setItem(KEY, serialise(all));
    return { ok: true, id: record.id, count: all.filter(readable).length, bytes };
  } catch (e) {
    const kind = String(e?.name || "") + " " + String(e?.message || "");
    if (/quota|exceeded/i.test(kind)) {
      return { ok: false, bytes, error: "Local storage is full. Export the cases you want to keep, then delete some." };
    }
    if (/security|denied|access/i.test(kind)) {
      return { ok: false, error: "This browser is blocking local storage for this site, so the case was not saved." };
    }
    return { ok: false, error: `The case could not be saved: ${e?.message ?? e}` };
  }
}

/** Move a case along without rewriting its payload. */
export function setStatus(id, status, store) {
  if (!Object.values(STATUS).includes(status)) {
    return { ok: false, error: `Not a status: ${status}` };
  }
  const existing = loadCase(id, store);
  if (!existing) return { ok: false, error: "No case with that id." };
  return saveCase({ ...existing, status }, store);
}

/**
 * Record that an outcome resolved this case.
 * The link is what lets a later claim from the same supplier be read against
 * the analysis that produced the last one.
 */
export function linkOutcome(id, outcomeRef, store) {
  const existing = loadCase(id, store);
  if (!existing) return { ok: false, error: "No case with that id." };
  return saveCase(
    { ...existing, status: STATUS.CLOSED, outcomeRecorded: true, outcomeRef: outcomeRef ?? null },
    store
  );
}

export function deleteCase(id, store) {
  const s = store_(store);
  try {
    const all = readAll(s);
    const next = all.filter((c) => !(c && c.id === id));
    if (next.length === all.length) return { ok: false, error: "No case with that id." };
    s.setItem(KEY, serialise(next));
    return { ok: true, count: next.filter(readable).length };
  } catch (e) {
    return { ok: false, error: `Could not delete: ${e?.message ?? e}` };
  }
}

/** Delete everything. The reset control the demonstration promises. */
export function clearCases(store) {
  try {
    store_(store).removeItem(KEY);
    return { ok: true, count: 0 };
  } catch (e) {
    return { ok: false, error: `Could not clear: ${e?.message ?? e}` };
  }
}

/* ------------------------------------------------------------ portability */

/** A portable copy, so nothing is trapped in one browser. */
export function exportCases(store) {
  return serialise({
    format: "buyrworld.cases.v1",
    schema: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    synthetic: true,
    cases: loadCases(store),
  });
}

/**
 * Import a previously exported file. Appends by default: silently overwriting
 * someone's cases is a worse failure than a duplicate. A case whose id already
 * exists is skipped rather than merged, because two builds' idea of the same
 * id is not something this can adjudicate.
 */
export function importCases(text, store, { replace = false } = {}) {
  const s = store_(store);
  let parsed;
  try {
    parsed = deserialise(text);
  } catch {
    return { ok: false, error: "That file is not a readable case export." };
  }
  if (!parsed || parsed.format !== "buyrworld.cases.v1" || !Array.isArray(parsed.cases)) {
    return { ok: false, error: "That file is not a BuyrWorld case export." };
  }
  if (parsed.schema !== SCHEMA_VERSION) {
    return {
      ok: false,
      error: `That export is schema ${parsed.schema}; this build reads ${SCHEMA_VERSION}. ` +
             `Open it with the build that wrote it, or export the outcomes instead.`,
    };
  }
  try {
    const existing = replace ? [] : readAll(s);
    const seen = new Set(existing.map((c) => c && c.id));
    const fresh = parsed.cases.filter((c) => c && c.id && !seen.has(c.id));
    const skipped = parsed.cases.length - fresh.length;
    const merged = [...fresh, ...existing];
    s.setItem(KEY, serialise(merged));
    return { ok: true, count: merged.filter(readable).length, imported: fresh.length, skipped };
  } catch (e) {
    return { ok: false, error: `Could not import: ${e?.message ?? e}` };
  }
}

export const STORAGE_KEY = KEY;
