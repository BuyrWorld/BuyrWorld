/**
 * Resolving names to entities.
 *
 * Pure: every function takes the current collection and returns a new one.
 * Storage belongs to services; this decides what resolution means.
 *
 * The rule that matters is the one about merging. Two spellings that differ
 * only by case, spacing, accents or trailing punctuation are the same party,
 * and resolving them together needs nobody's permission. Anything beyond that —
 * "Smith Ltd" against "Smith GmbH" — is a guess about company structure that
 * this system is in no position to make. Those are *suggested*, with the reason
 * shown, and a person decides.
 *
 * Getting this wrong in the permissive direction silently welds two suppliers'
 * negotiating histories together, and every figure downstream stays plausible
 * while being about the wrong company. So the default is to keep them apart.
 */

import { KIND, isId, normaliseName, similarityKey } from "./ids.mjs";
import { supplier as makeSupplier, withAlias } from "./entities.mjs";

/* ------------------------------------------------------------- resolution */

/**
 * Find a supplier by id, by any recorded alias, or by its display name.
 * Never fuzzy. Returns null when there is no exact match.
 */
export function resolveSupplier(suppliers, nameOrId) {
  const list = Array.isArray(suppliers) ? suppliers : [];
  const raw = String(nameOrId ?? "").trim();
  if (!raw) return null;

  if (isId(KIND.SUPPLIER, raw)) {
    const direct = list.find((s) => s.id === raw);
    if (direct) return direct;
    /* An id that was merged away still resolves, to the record that absorbed
       it. Without this, every case and outcome stored against the old id
       dangles the moment someone confirms a merge — which would make merging
       destructive in exactly the way `mergedFrom` exists to prevent. */
    return list.find((s) => s.mergedFrom.some((m) => m.id === raw)) ?? null;
  }

  const key = normaliseName(raw);
  if (!key) return null;
  return list.find((s) => s.aliases.includes(key)) ?? null;
}

/**
 * Resolve, or create and add.
 *
 * @returns {{suppliers: Array, supplier: object, created: boolean}}
 */
export function upsertSupplier(suppliers, name, extra = {}) {
  const list = Array.isArray(suppliers) ? [...suppliers] : [];
  const found = resolveSupplier(list, name);
  if (found) {
    // A new spelling of a supplier already on file is worth remembering, so the
    // next document using it resolves without asking.
    const updated = withAlias(found, name);
    if (updated !== found) list[list.indexOf(found)] = updated;
    return { suppliers: list, supplier: updated, created: false };
  }
  const created = makeSupplier({ name, ...extra });
  list.push(created);
  return { suppliers: list, supplier: created, created: true };
}

/* ---------------------------------------------------------------- merging */

/**
 * Pairs that a person might want to merge, with the reason.
 *
 * Nothing here is applied. The aggressive key strips legal suffixes, which is
 * a hint about relatedness and not evidence of identity: a Ltd and a GmbH may
 * be separate legal entities with separate contracts, and merging them would
 * pool two negotiating histories that belong apart.
 */
export function suggestMerges(suppliers) {
  const list = Array.isArray(suppliers) ? suppliers : [];
  const byKey = new Map();

  for (const s of list) {
    const key = similarityKey(s.name);
    if (!key) continue;                       // nothing survived: never a match
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(s);
  }

  const out = [];
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        out.push(Object.freeze({
          a: group[i].id,
          b: group[j].id,
          names: Object.freeze([group[i].name, group[j].name]),
          sharedKey: key,
          reason:
            `"${group[i].name}" and "${group[j].name}" differ only by legal suffix or punctuation. ` +
            `They may be the same party, or separate legal entities with separate contracts. ` +
            `Merging pools their negotiating history, so confirm before doing it.`,
          confirmed: false,
        }));
      }
    }
  }
  return Object.freeze(out);
}

/**
 * Merge one supplier into another. Explicit, and reversible.
 *
 * The absorbed record is kept inside `mergedFrom` in full rather than being
 * deleted, so a merge made in error can be undone without the history being
 * gone. Returns a remap so references elsewhere can be repointed in the same
 * operation — a merge that leaves parts pointing at a supplier nobody can
 * resolve is worse than no merge.
 */
export function mergeSuppliers(suppliers, fromId, intoId) {
  const list = Array.isArray(suppliers) ? [...suppliers] : [];
  if (fromId === intoId) return { ok: false, error: "A supplier cannot be merged into itself." };

  const from = list.find((s) => s.id === fromId);
  const into = list.find((s) => s.id === intoId);
  if (!from) return { ok: false, error: `No supplier ${fromId}.` };
  if (!into) return { ok: false, error: `No supplier ${intoId}.` };

  const aliases = new Set([...into.aliases, ...from.aliases]);
  const merged = Object.freeze({
    ...into,
    aliases: Object.freeze([...aliases]),
    mergedFrom: Object.freeze([...into.mergedFrom, from]),
    updatedAt: new Date().toISOString(),
  });

  const next = list.filter((s) => s.id !== fromId);
  next[next.indexOf(into)] = merged;

  return {
    ok: true,
    suppliers: next,
    supplier: merged,
    remap: Object.freeze({ [fromId]: intoId }),
  };
}

/** Undo a merge, restoring the absorbed record and its aliases. */
export function unmergeSupplier(suppliers, intoId, fromId) {
  const list = Array.isArray(suppliers) ? [...suppliers] : [];
  const into = list.find((s) => s.id === intoId);
  if (!into) return { ok: false, error: `No supplier ${intoId}.` };

  const restored = into.mergedFrom.find((s) => s.id === fromId);
  if (!restored) return { ok: false, error: `${intoId} does not record a merge from ${fromId}.` };

  const keep = new Set(restored.aliases);
  const reduced = Object.freeze({
    ...into,
    aliases: Object.freeze(into.aliases.filter((a) => !keep.has(a) || into.aliases.indexOf(a) === 0)),
    mergedFrom: Object.freeze(into.mergedFrom.filter((s) => s.id !== fromId)),
    updatedAt: new Date().toISOString(),
  });

  list[list.indexOf(into)] = reduced;
  list.push(restored);
  return { ok: true, suppliers: list, remap: Object.freeze({ [intoId]: fromId }) };
}

/**
 * Repoint `supplierId` references after a merge.
 * Entities that do not carry one are returned untouched.
 */
export function remapReferences(entities, remap) {
  const list = Array.isArray(entities) ? entities : [];
  return list.map((e) => {
    if (!e || !e.supplierId || !remap[e.supplierId]) return e;
    return Object.freeze({ ...e, supplierId: remap[e.supplierId], updatedAt: new Date().toISOString() });
  });
}

/* --------------------------------------------------------------- lookups */

/** Every supplier, ordered by display name, for a picker. */
export function listSuppliers(suppliers) {
  return Object.freeze(
    [...(Array.isArray(suppliers) ? suppliers : [])].sort((a, b) => a.name.localeCompare(b.name))
  );
}

/** Index by id, for joining without repeated scans. */
export function byId(entities) {
  const m = new Map();
  for (const e of Array.isArray(entities) ? entities : []) if (e && e.id) m.set(e.id, e);
  return m;
}
