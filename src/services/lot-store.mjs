/**
 * Reviewed lots, kept in this browser.
 *
 * The store is where the unique-lot rule stops being arithmetic and becomes a
 * property of the data: records are keyed by lot, so saving the same lot again
 * replaces it. A re-uploaded certificate cannot become a second conforming
 * lot, because there is nowhere for the second one to go.
 *
 * Like the other stores here it withholds rather than misreads. A record
 * written by a different schema is reported, never dropped and never
 * interpreted — a mill's conformity rate computed over records this build
 * only half understands would be worse than no rate.
 *
 * Nothing leaves the browser. These are somebody's supplier-quality records,
 * and pooling them across customers or publishing a ranking would be a
 * different product with a different permission model, not a feature of
 * this one.
 */

const KEY = "bw.lots.v1";

export const SCHEMA_VERSION = 1;

/** Generous for a record with no free text of consequence, and still bounded. */
export const MAX_LOT_BYTES = 32 * 1024;

function localStore() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    /* A browser with site data blocked throws on access rather than
       returning null, which is why this is a try rather than a check. */
    return null;
  }
}

export function storageAvailable(store) {
  const s = store ?? localStore();
  if (!s) return false;
  try {
    const probe = "bw.probe";
    s.setItem(probe, "1");
    s.removeItem(probe);
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
    /* Corrupt JSON is not an empty store, but it is not readable either.
       storeStatus reports it; nothing here silently starts again. */
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

const readable = (r) =>
  Boolean(r) && typeof r === "object" && r.schema === SCHEMA_VERSION && Boolean(r.lotKey);

/** Everything this build can read. */
export function loadLots(store) {
  return readAll(store).filter(readable);
}

/**
 * What is in the store, including what this build cannot read.
 * Withheld records are reported by count and reason, never dropped.
 */
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
      if (!r || typeof r !== "object") return "An entry that is not a lot record.";
      if (!r.lotKey) return "A record with no lot key.";
      return `Lot ${r.lotKey} was saved by schema ${r.schema ?? "unknown"}; this build reads ${SCHEMA_VERSION}.`;
    })),
    schema: SCHEMA_VERSION,
  });
}

/**
 * Save one reviewed lot.
 *
 * Keyed by lot, so a revision or a re-upload replaces the record rather than
 * adding one. The previous record is returned when it is replaced, because a
 * conforming lot becoming nonconforming is worth telling somebody about.
 */
export function saveLot(record, store) {
  if (!record || !record.lotKey) {
    return { ok: false, error: "A lot record needs a lot key before it can be stored." };
  }

  const entry = { ...record, schema: SCHEMA_VERSION, updatedAt: new Date().toISOString() };
  const bytes = JSON.stringify(entry).length;
  if (bytes > MAX_LOT_BYTES) {
    return {
      ok: false,
      error: `This record is ${Math.round(bytes / 1024)}KB, over the ${Math.round(MAX_LOT_BYTES / 1024)}KB limit.`,
    };
  }

  const all = readAll(store);
  const at = all.findIndex((r) => r && r.lotKey === record.lotKey);
  const previous = at >= 0 ? all[at] : null;
  if (at >= 0) all[at] = entry; else all.push(entry);

  const written = writeAll(all, store);
  if (!written.ok) return written;
  return {
    ok: true,
    replaced: Boolean(previous),
    previous,
    note: previous
      ? `This lot was already recorded${previous.certificate ? ` from certificate ${previous.certificate}` : ""}. ` +
        `The record has been corrected rather than a second lot added.`
      : null,
  };
}

export function deleteLot(lotKey, store) {
  const all = readAll(store);
  const kept = all.filter((r) => !(r && r.lotKey === lotKey));
  if (kept.length === all.length) return { ok: false, error: "No record with that lot key." };
  return writeAll(kept, store);
}

export function clearLots(store) {
  return writeAll([], store);
}

/** Everything, as a document somebody can keep. */
export function exportLots(store) {
  return JSON.stringify({
    kind: "buyrworld.lots",
    schema: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    note: "Private supplier-quality records. Synthetic demonstration data unless stated otherwise.",
    records: loadLots(store),
  }, null, 2);
}

/**
 * Bring records back in.
 *
 * Merges by lot key, which keeps the unique-lot rule across an import too:
 * importing a file twice does not double anybody's lot count.
 */
export function importLots(text, store, { replace = false } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That is not a file this can read." };
  }
  if (!parsed || parsed.kind !== "buyrworld.lots" || !Array.isArray(parsed.records)) {
    return { ok: false, error: "That file is not an export of lot records." };
  }
  if (parsed.schema !== SCHEMA_VERSION) {
    return {
      ok: false,
      error: `That file was written by schema ${parsed.schema}; this build reads ${SCHEMA_VERSION}. ` +
             `Nothing was imported, rather than importing records this build may read wrongly.`,
    };
  }

  const incoming = parsed.records.filter(readable);
  const existing = replace ? [] : readAll(store);
  const byLot = new Map(existing.filter((r) => r && r.lotKey).map((r) => [r.lotKey, r]));
  let added = 0;
  let corrected = 0;
  for (const r of incoming) {
    if (byLot.has(r.lotKey)) corrected++; else added++;
    byLot.set(r.lotKey, r);
  }

  const written = writeAll([...byLot.values()], store);
  if (!written.ok) return written;
  return {
    ok: true, added, corrected,
    skipped: parsed.records.length - incoming.length,
  };
}
