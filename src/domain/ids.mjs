/**
 * Entity identity.
 *
 * Until now nothing in this system had an identity. Suppliers were free-text
 * strings compared with `.trim().toLowerCase()`, parts did not exist, and a
 * case referred to its supplier by whatever the user happened to type. That
 * works until someone writes "Meridian Fabrication Ltd." with a full stop, at
 * which point their entire history silently disappears.
 *
 * Two normalisations, deliberately different, because conflating them is how
 * two real companies get merged into one.
 *
 *   normaliseName  is conservative — case, whitespace, trailing punctuation.
 *                  Two names that differ only by these ARE the same party, and
 *                  resolving them together is safe to do automatically.
 *
 *   similarityKey  is aggressive — it also strips legal suffixes. "Smith Ltd"
 *                  and "Smith GmbH" collapse to the same key. They are very
 *                  probably related and may well be different legal entities
 *                  with different contracts. So this key NEVER resolves an
 *                  identity: it only ever proposes a merge for a human to
 *                  confirm.
 *
 * Ids are derived from the natural key at creation and never recomputed. A
 * renamed supplier keeps its id and gains an alias, because the history hanging
 * off that id is the thing worth protecting.
 */

/** Entity kinds this build knows about. Adding one here is not enough to use it. */
export const KIND = Object.freeze({
  SUPPLIER: "sup",
  PART: "part",
  CONTRACT: "con",
  CASE: "case",
  OUTCOME: "out",
  LEARNING: "learn",
});

const KINDS = new Set(Object.values(KIND));

/* ---------------------------------------------------------- normalisation */

/**
 * Conservative. Safe to resolve on automatically.
 * "  Meridian Fabrication Ltd. " and "meridian  fabrication ltd" agree.
 */
export function normaliseName(raw) {
  return String(raw ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")      // strip accents, so "Müller" meets "Muller"
    .toLowerCase()
    .replace(/[.,;:'"`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* Legal and trading suffixes. Stripping these is a hint, never a decision. */
const SUFFIXES = [
  "ltd", "limited", "plc", "llp", "lp", "llc", "inc", "incorporated", "corp",
  "corporation", "co", "company", "group", "holdings", "holding",
  "gmbh", "ag", "kg", "gmbh & co kg", "sa", "sas", "sarl", "srl", "spa", "bv",
  "nv", "ab", "as", "oy", "aps", "pty", "pte", "sdn bhd", "kk", "zrt", "sp zoo",
];

/**
 * Aggressive. For proposing merges to a person, never for resolving one.
 * Returns "" when nothing survives, which must not be treated as a match.
 */
export function similarityKey(raw) {
  let s = normaliseName(raw).replace(/[&+]/g, " ").replace(/\s+/g, " ").trim();
  // Strip repeatedly: "Smith Holdings Ltd" -> "smith".
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of SUFFIXES) {
      if (s.endsWith(" " + suffix)) {
        s = s.slice(0, -(suffix.length + 1)).trim();
        changed = true;
      }
    }
  }
  return s;
}

/* ----------------------------------------------------------------- ids */

/**
 * FNV-1a, 64-bit, in BigInt.
 *
 * Chosen over crypto because this module must stay pure and run identically in
 * a browser, in Node and in a test, with no async and no platform check. It is
 * not a security primitive and nothing here depends on it being one — it is a
 * spreading function for making a readable, stable id out of a name.
 */
function fnv1a64(text) {
  const OFFSET = 14695981039346656037n;
  const PRIME = 1099511628211n;
  const MASK = (1n << 64n) - 1n;
  let h = OFFSET;
  for (const ch of String(text)) {
    h = (h ^ BigInt(ch.codePointAt(0))) & MASK;
    h = (h * PRIME) & MASK;
  }
  return h;
}

/**
 * A stable id for a natural key.
 *
 * Deterministic on purpose: the same supplier name in two browsers, or in a
 * test and in production, produces the same id, so exported cases and outcomes
 * line up without a central allocator.
 *
 * @param {string} kind  a KIND value
 * @param {string} naturalKey  already normalised by the caller's rules
 */
export function entityId(kind, naturalKey) {
  if (!KINDS.has(kind)) throw new RangeError(`Not an entity kind: ${kind}`);
  const key = String(naturalKey ?? "").trim();
  if (key === "") throw new RangeError(`An id needs a natural key (${kind})`);
  return `${kind}_${fnv1a64(`${kind}:${key}`).toString(36).padStart(13, "0")}`;
}

/** The id a supplier name resolves to, using the conservative normalisation. */
export const supplierId = (name) => entityId(KIND.SUPPLIER, normaliseName(name));

/**
 * A part is identified by its number within a supplier: the same drawing
 * number from two suppliers is two commercial relationships, and pricing one
 * against the other only means anything if they are kept apart.
 */
export const partId = (supplier, partNumber) =>
  entityId(KIND.PART, `${supplierId(supplier)}|${normaliseName(partNumber)}`);

/** A contract reference is unique within a supplier, not globally. */
export const contractId = (supplier, reference) =>
  entityId(KIND.CONTRACT, `${supplierId(supplier)}|${normaliseName(reference)}`);

/** True when an id was produced by this scheme for that kind. */
export function isId(kind, value) {
  return typeof value === "string" && new RegExp(`^${kind}_[0-9a-z]{13}$`).test(value);
}

/** The kind an id belongs to, or null. */
export function kindOf(id) {
  const prefix = String(id ?? "").split("_")[0];
  return KINDS.has(prefix) ? prefix : null;
}
