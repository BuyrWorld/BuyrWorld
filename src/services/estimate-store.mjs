/**
 * Saved build-ups.
 *
 * A should-cost estimate is worked out on one page and argued with on
 * another, so something has to carry it across. This stores the small part of
 * an estimate that an argument actually needs — what each cost element came
 * to, how strong that figure was, and enough about the part to know which
 * claim it answers.
 *
 * It deliberately does not store the whole estimate. The route, the layout
 * and the geometry are the working; the shares are the result. Storing the
 * working would mean a saved build-up quietly changing meaning whenever the
 * engine's arithmetic changed, and a figure somebody argued with last month
 * should still be the figure they argued with.
 *
 * What it does store is the completeness, because a build-up that had gaps
 * cannot be compared against anything and must not become comparable by
 * being saved and reloaded.
 */

const KEY = "bw.estimates.v1";

export const SCHEMA_VERSION = 1;

export const MAX_ESTIMATE_BYTES = 64 * 1024;

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

const readable = (r) =>
  Boolean(r) && typeof r === "object" && r.schema === SCHEMA_VERSION && Boolean(r.id) && Array.isArray(r.lines);

/**
 * Reduce a live plan and cost to what an argument needs.
 *
 * @param {object} plan  a planMaterial result, for the part it describes
 * @param {object} cost  a costPlan result
 * @param {object} meta  { id, name, part, supplier }
 */
export function estimateFrom(plan, cost, meta = {}) {
  const id = String(meta.id ?? "").trim();
  const name = String(meta.name ?? "").trim();
  if (!id || !name) throw new TypeError("A saved build-up needs an id and a name somebody will recognise");
  if (!cost || !cost.ok) throw new TypeError("There is no cost estimate to save");

  return Object.freeze({
    id,
    name,
    part: String(meta.part ?? "").trim() || null,
    supplier: String(meta.supplier ?? "").trim() || null,
    currency: cost.currency,
    /* The result, not the working. */
    lines: Object.freeze(cost.lines.map((l) => Object.freeze({
      id: l.id,
      label: l.label,
      /* Minor units as a string: BigInt does not survive JSON, and the other
         stores solve that with a tagged format this record does not need —
         there is one number per line and it is read back explicitly. */
      minor: l.amount === null ? null : String(l.signed),
      oneTime: l.oneTime,
      credit: l.credit,
      quality: l.quality,
      basis: l.basis,
    }))),
    /* Carried so a build-up that could not be compared does not become
       comparable by being stored. */
    complete: cost.complete,
    missing: Object.freeze((cost.missing ?? []).map((m) => Object.freeze({ id: m.id, label: m.label }))),
    confidence: cost.confidence,
    acceptedParts: plan && plan.ok ? String(plan.quantities.acceptedPartsRequired) : null,
    synthetic: meta.synthetic !== false,
  });
}

/**
 * Back into the shape `buildUpShares` reads.
 *
 * The inverse of the reduction above, and the only place a stored record is
 * turned back into BigInt. Doing it here rather than in the comparison keeps
 * the comparison unaware that storage exists.
 */
export function asCostPlan(record) {
  if (!record) return null;
  return Object.freeze({
    ok: true,
    complete: record.complete,
    missing: Object.freeze(record.missing ?? []),
    currency: record.currency,
    confidence: record.confidence,
    lines: Object.freeze((record.lines ?? []).map((l) => Object.freeze({
      id: l.id,
      label: l.label,
      amount: l.minor === null ? null : Object.freeze({ minor: BigInt(l.minor), currency: record.currency, asOf: null }),
      signed: l.minor === null ? 0n : BigInt(l.minor),
      oneTime: Boolean(l.oneTime),
      credit: Boolean(l.credit),
      quality: l.quality ?? null,
      basis: l.basis ?? null,
      note: null,
    }))),
  });
}

export function loadEstimates(store) {
  return readAll(store).filter(readable);
}

export function loadEstimate(id, store) {
  return loadEstimates(store).find((r) => r.id === id) ?? null;
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
      if (!r || typeof r !== "object") return "An entry that is not a build-up.";
      if (!r.id) return "A build-up with no id.";
      return `Build-up ${r.name ?? r.id} was saved by schema ${r.schema ?? "unknown"}; this build reads ${SCHEMA_VERSION}.`;
    })),
    schema: SCHEMA_VERSION,
  });
}

export function saveEstimate(estimate, store) {
  if (!estimate || !estimate.id) {
    return { ok: false, error: "A build-up needs an id before it can be stored." };
  }
  const entry = { ...estimate, schema: SCHEMA_VERSION, savedAt: new Date().toISOString() };
  const bytes = JSON.stringify(entry).length;
  if (bytes > MAX_ESTIMATE_BYTES) {
    return { ok: false, error: `This build-up is ${Math.round(bytes / 1024)}KB, over the ${Math.round(MAX_ESTIMATE_BYTES / 1024)}KB limit.` };
  }

  const all = readAll(store);
  const at = all.findIndex((r) => r && r.id === estimate.id);
  const previous = at >= 0 ? all[at] : null;
  if (at >= 0) all[at] = entry; else all.push(entry);

  const written = writeAll(all, store);
  if (!written.ok) return written;
  return { ok: true, replaced: Boolean(previous), previous };
}

export function deleteEstimate(id, store) {
  const all = readAll(store);
  const kept = all.filter((r) => !(r && r.id === id));
  if (kept.length === all.length) return { ok: false, error: "No build-up with that id." };
  return writeAll(kept, store);
}

export function clearEstimates(store) {
  return writeAll([], store);
}
