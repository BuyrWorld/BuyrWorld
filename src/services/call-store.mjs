/**
 * Call notes, kept only because somebody asked.
 *
 * `specs/02`'s Phase 4 gate: *"notes retained only by explicit save"*. So this
 * file exists to be the one place notes can be written, and `src/case/call.mjs`
 * deliberately cannot reach it: the call module has no storage at all, and a
 * note becomes a stored thing only when a person presses save and the page
 * calls this.
 *
 * Three decisions follow from that, and each is the opposite of what a store
 * usually does.
 *
 *   - **No autosave, and nowhere to put one.** There is no timer, no
 *     beforeunload, no save-on-blur. A call somebody chose not to keep is not
 *     kept, including when the tab closes.
 *   - **What is saved is what was decided.** A proposed commitment is a
 *     reading, not a record; only the ones somebody confirmed, corrected or
 *     marked unknown are written, along with every note as it was taken. A
 *     stored "action list" full of things a rule guessed at is worse than no
 *     list.
 *   - **A saved call says it was never sent.** Nothing in the product can send
 *     one, and a record that does not say so invites somebody months later to
 *     assume the follow-up went out.
 */

const KEY = "bw.calls.v1";

export const SCHEMA_VERSION = 1;
const READABLE_SCHEMAS = Object.freeze([1]);

/** A call is words. 64KB is a long one; a longer one is a transcript. */
export const MAX_CALL_BYTES = 64 * 1024;

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
    return {
      ok: false,
      error: "This browser refused to store the call, so nothing was saved. "
           + "Copy the follow-up instead — it is the part that matters.",
    };
  }
}

const readable = (r) => Boolean(r) && typeof r === "object"
  && READABLE_SCHEMAS.includes(r.schema);

let minted = 0;

/** A stable id for a saved call. */
export function newCallId() {
  const stamp = Date.now().toString(36);
  const seq = (minted++).toString(36).padStart(3, "0");
  const salt = Math.floor(Math.random() * 46656).toString(36).padStart(3, "0");
  return `CALL-${stamp}-${seq}-${salt}`;
}

/**
 * Keep this call.
 *
 * Refuses an empty one rather than storing a row that says nothing happened,
 * and refuses to store a commitment nobody has looked at: `decided` is the
 * filter, and it is applied here rather than trusted from the caller so that
 * no future caller can quietly skip it.
 */
export function saveCall({ id, title = null, goal = null, at = null, notes = [], commitments = [] } = {},
                         store) {
  if (!id) return { ok: false, error: "A call needs an id before it can be stored." };
  if (notes.length === 0 && commitments.length === 0) {
    return { ok: false, error: "There are no notes and nothing was agreed, so there is nothing to save." };
  }

  const decided = commitments.filter((c) => c && c.disposition && c.disposition !== "proposed");

  const entry = {
    schema: SCHEMA_VERSION,
    id,
    title: title ? String(title) : null,
    goal,
    at: at ?? new Date().toISOString(),
    savedAt: new Date().toISOString(),
    notes: notes.map((n) => ({ said: n.said, source: n.source, at: n.at })),
    commitments: decided.map((c) => ({
      id: c.id, owner: c.owner, what: c.what, date: c.date, dateSaid: c.dateSaid,
      needs: c.needs, disposition: c.disposition, why: c.why,
      evidence: { quote: c.evidence?.quote ?? null, at: c.evidence?.at ?? null,
                  source: c.evidence?.source ?? null },
      revisions: c.revisions ?? [],
    })),
    /* Said in the record, not only on the screen it was saved from. */
    sent: false,
  };

  const bytes = JSON.stringify(entry).length;
  if (bytes > MAX_CALL_BYTES) {
    return {
      ok: false,
      error: `These notes are ${Math.round(bytes / 1024)}KB, over the `
           + `${Math.round(MAX_CALL_BYTES / 1024)}KB limit. Copy the follow-up instead.`,
    };
  }

  const all = readAll(store);
  const at_ = all.findIndex((r) => r && r.id === id);
  if (at_ >= 0) all[at_] = entry; else all.push(entry);

  const written = writeAll(all, store);
  if (!written.ok) return written;
  return {
    ok: true,
    id,
    replaced: at_ >= 0,
    kept: entry.commitments.length,
    dropped: commitments.length - entry.commitments.length,
  };
}

export function loadCalls(store) {
  return Object.freeze(readAll(store).filter(readable));
}

export function loadCall(id, store) {
  return loadCalls(store).find((r) => r.id === id) ?? null;
}

export function deleteCall(id, store) {
  const all = readAll(store);
  const kept = all.filter((r) => !(r && r.id === id));
  if (kept.length === all.length) return { ok: false, error: "No call with that id." };
  return writeAll(kept, store);
}

export function storeStatus(store) {
  const all = readAll(store);
  const good = all.filter(readable);
  return Object.freeze({
    available: storageAvailable(store),
    total: all.length,
    readable: good.length,
    unreadable: all.length - good.length,
    schema: SCHEMA_VERSION,
  });
}
