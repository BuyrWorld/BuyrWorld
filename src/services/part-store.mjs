/**
 * The parts library.
 *
 * Comparison needs a body of parts that outlives any one case. A case records
 * the part it concerns; it does not accumulate a library, and without one the
 * question "what else do we buy that is like this" has nowhere to look.
 *
 * Same arrangement as the other stores: browser-local, schema-gated, and
 * sharing one BigInt tagging format so a price written here reads back exactly.
 * The gate withholds rather than misreads, because a part whose attributes mean
 * something different in another build would produce a confident comparison of
 * two things that are not alike.
 */

import { serialise, deserialise } from "./outcome-store.mjs";
import { part as makePart } from "../domain/entities.mjs";

const KEY = "bw.parts.v1";

/** Bump when the stored shape changes meaning. Older parts are then withheld. */
export const SCHEMA_VERSION = 1;

const store_ = (s) => s ?? globalThis.localStorage;

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

const readable = (p) => Boolean(p) && typeof p === "object" && p.schema === SCHEMA_VERSION && Boolean(p.id);

/** Everything this build can read, by supplier then part number. */
export function loadParts(store) {
  return readAll(store)
    .filter(readable)
    .sort((a, b) => String(a.supplierId).localeCompare(String(b.supplierId)) ||
                    String(a.number).localeCompare(String(b.number)));
}

export function loadPart(id, store) {
  return loadParts(store).find((p) => p.id === id) ?? null;
}

/**
 * Insert or update, by id.
 *
 * A part's id is derived from its supplier and number, so saving the same part
 * twice updates it rather than creating a near-duplicate that would then be
 * compared against itself.
 */
export function savePart(p, store) {
  const s = store_(store);
  if (!s) return { ok: false, error: "This browser is not allowing local storage, so the part was not saved." };
  if (!p || typeof p !== "object" || !p.id) {
    return { ok: false, error: "That is not a part. Build one with part() first." };
  }

  const record = { ...p, schema: SCHEMA_VERSION, updatedAt: new Date().toISOString() };
  try {
    /* Entries this build cannot read belong to someone's other build; dropping
       them here would be silent data loss. */
    const all = readAll(s);
    const i = all.findIndex((x) => x && x.id === record.id);
    if (i >= 0) all[i] = record; else all.push(record);
    s.setItem(KEY, serialise(all));
    return { ok: true, id: record.id, count: all.filter(readable).length };
  } catch (e) {
    const kind = String(e?.name || "") + " " + String(e?.message || "");
    if (/quota|exceeded/i.test(kind)) {
      return { ok: false, error: "Local storage is full. Export or delete some parts." };
    }
    if (/security|denied|access/i.test(kind)) {
      return { ok: false, error: "This browser is blocking local storage for this site, so the part was not saved." };
    }
    return { ok: false, error: `The part could not be saved: ${e?.message ?? e}` };
  }
}

export function deletePart(id, store) {
  const s = store_(store);
  try {
    const all = readAll(s);
    const next = all.filter((p) => !(p && p.id === id));
    if (next.length === all.length) return { ok: false, error: "No part with that id." };
    s.setItem(KEY, serialise(next));
    return { ok: true, count: next.filter(readable).length };
  } catch (e) {
    return { ok: false, error: `Could not delete: ${e?.message ?? e}` };
  }
}

export function clearParts(store) {
  try {
    store_(store).removeItem(KEY);
    return { ok: true, count: 0 };
  } catch (e) {
    return { ok: false, error: `Could not clear: ${e?.message ?? e}` };
  }
}

/** What is in storage, including what cannot be opened. */
export function storeStatus(store) {
  const all = readAll(store);
  const good = all.filter(readable);
  return Object.freeze({
    available: storageAvailable(store),
    total: all.length,
    readable: good.length,
    unreadable: all.length - good.length,
    schema: SCHEMA_VERSION,
    /* How much of the library is actually described. A library of names
       compares nothing, and saying so is more use than an empty result. */
    described: good.filter((p) => Object.keys(p.attributes ?? {}).length >= 3).length,
    priced: good.filter((p) => p.unitPrice).length,
  });
}

/** A portable copy, so nothing is trapped in one browser. */
export function exportParts(store) {
  return serialise({
    format: "buyrworld.parts.v1",
    schema: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    synthetic: true,
    parts: loadParts(store),
  });
}

/**
 * Import a previously exported file. Appends; a part already present is
 * skipped rather than merged, because two builds' idea of the same part is not
 * something this can adjudicate.
 */
export function importParts(text, store, { replace = false } = {}) {
  const s = store_(store);
  let parsed;
  try {
    parsed = deserialise(text);
  } catch {
    return { ok: false, error: "That file is not a readable parts export." };
  }
  if (!parsed || parsed.format !== "buyrworld.parts.v1" || !Array.isArray(parsed.parts)) {
    return { ok: false, error: "That file is not a BuyrWorld parts export." };
  }
  if (parsed.schema !== SCHEMA_VERSION) {
    return {
      ok: false,
      error: `That export is schema ${parsed.schema}; this build reads ${SCHEMA_VERSION}. ` +
             `Open it with the build that wrote it.`,
    };
  }
  try {
    const existing = replace ? [] : readAll(s);
    const seen = new Set(existing.map((p) => p && p.id));
    const fresh = parsed.parts.filter((p) => p && p.id && !seen.has(p.id));
    const merged = [...existing, ...fresh];
    s.setItem(KEY, serialise(merged));
    return { ok: true, count: merged.filter(readable).length, imported: fresh.length,
             skipped: parsed.parts.length - fresh.length };
  } catch (e) {
    return { ok: false, error: `Could not import: ${e?.message ?? e}` };
  }
}

/**
 * A stored part in the shape comparable.mjs reads.
 *
 * The two shapes differ deliberately: the domain part is identified within its
 * supplier, while a comparison is about the thing itself. This is the seam, and
 * keeping it explicit is better than making one module understand both.
 */
export function forComparison(p) {
  return Object.freeze({
    ref: p.number,
    supplier: p.supplierId ?? null,
    attributes: p.attributes ?? {},
    unitPrice: p.unitPrice ?? null,
    annualVolume: p.annualVolume ?? null,
    describedWeight: null,
    synthetic: p.synthetic !== false,
  });
}

export { makePart as part };
export const STORAGE_KEY = KEY;
