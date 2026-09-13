/**
 * The commercial memory spine.
 *
 * Six entities, not thirty-five. The wider model is documented in
 * docs/DOMAIN_MODEL.md, but only what existing code actually consumes is built
 * here: this repository already carries four exported-and-never-called
 * functions, and speculative entities would be more of the same. An entity
 * earns its place in this file when something reads it.
 *
 * Everything is pure. No storage, no I/O, no framework — services persist
 * these; this module only decides what a valid one looks like.
 *
 * The relationships that matter, and why:
 *
 *   Supplier  ──< Part          a part number means nothing without the supplier
 *   Supplier  ──< Contract      a contract reference is unique within a supplier
 *   Supplier  ──< CommercialCase
 *   Case      ──> Part, Contract
 *   Case      ──< Outcome       what actually happened
 *   Outcome   ──< LearningRecord what it teaches the next case
 *
 * A case names its supplier by id, so renaming the supplier does not orphan
 * years of history — which is exactly what free-text matching did before.
 */

import { KIND, entityId, supplierId, partId, contractId, normaliseName, isId } from "./ids.mjs";

/** Bump when the meaning of a stored entity changes. */
export const DOMAIN_SCHEMA = 1;

/** Where a case has got to. Nothing here implies approval. */
export const CASE_STATUS = Object.freeze({
  DRAFT: "draft",
  ANALYSED: "analysed",
  DECIDED: "decided",
  CLOSED: "closed",
});

const req = (value, what) => {
  const s = String(value ?? "").trim();
  if (s === "") throw new TypeError(`${what} is required`);
  return s;
};

const nullable = (value) => {
  const s = String(value ?? "").trim();
  return s === "" ? null : s;
};

const iso = (value, what) => {
  if (value == null) return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}(-\d{2})?([T ].*)?$/.test(s)) {
    throw new RangeError(`${what} must be YYYY-MM or an ISO date, not ${JSON.stringify(value)}`);
  }
  return s;
};

const base = (kind, id, now) => ({ id, kind, schema: DOMAIN_SCHEMA, createdAt: now, updatedAt: now });

/* --------------------------------------------------------------- supplier */

/**
 * @param {object}   input
 * @param {string}   input.name        as it should be displayed
 * @param {string[]} [input.aliases]   other spellings seen in documents
 * @param {boolean}  [input.synthetic]
 */
export function supplier(input = {}) {
  const name = req(input.name, "A supplier name");
  const now = input.now ?? new Date().toISOString();
  const id = input.id ?? supplierId(name);
  if (!isId(KIND.SUPPLIER, id)) throw new RangeError(`Not a supplier id: ${id}`);

  /* Aliases are stored normalised and deduplicated, and the display name is
     always one of them, so a lookup by any spelling on file finds this record. */
  const aliases = new Set([normaliseName(name)]);
  for (const a of input.aliases ?? []) {
    const n = normaliseName(a);
    if (n) aliases.add(n);
  }

  return Object.freeze({
    ...base(KIND.SUPPLIER, id, now),
    name,
    aliases: Object.freeze([...aliases]),
    category: nullable(input.category),
    country: nullable(input.country),
    notes: nullable(input.notes),
    // Recorded when two records are merged, so the merge can be undone.
    mergedFrom: Object.freeze([...(input.mergedFrom ?? [])]),
    synthetic: input.synthetic !== false,
  });
}

/** Add a spelling without losing the identity the history hangs off. */
export function withAlias(sup, alias) {
  const n = normaliseName(alias);
  if (!n || sup.aliases.includes(n)) return sup;
  return Object.freeze({ ...sup, aliases: Object.freeze([...sup.aliases, n]), updatedAt: new Date().toISOString() });
}

/** Rename for display. The id and every alias survive, by design. */
export function renamed(sup, name) {
  const next = req(name, "A supplier name");
  const aliases = new Set([...sup.aliases, normaliseName(next)]);
  return Object.freeze({ ...sup, name: next, aliases: Object.freeze([...aliases]), updatedAt: new Date().toISOString() });
}

/* ------------------------------------------------------------------- part */

/**
 * A part is identified within its supplier: the same drawing number quoted by
 * two suppliers is two commercial relationships, and comparing them only means
 * something if they are kept apart.
 */
export function part(input = {}) {
  const supplierName = input.supplierId ?? req(input.supplier, "A part's supplier");
  const sid = isId(KIND.SUPPLIER, supplierName) ? supplierName : supplierId(supplierName);
  const number = req(input.number, "A part number");
  const now = input.now ?? new Date().toISOString();

  return Object.freeze({
    ...base(KIND.PART, input.id ?? partId(sid, number), now),
    supplierId: sid,
    number,
    description: nullable(input.description),
    // Left null rather than guessed. A material nobody stated is not "steel".
    material: nullable(input.material),
    specification: nullable(input.specification),
    annualVolume: Number.isInteger(input.annualVolume) ? input.annualVolume : null,
    synthetic: input.synthetic !== false,
  });
}

/* --------------------------------------------------------------- contract */

/**
 * Contract terms are not a side panel: `cost-bridge.mjs` already lets a cap,
 * collar or floor override the evidenced figure, and `evidence.mjs` detects a
 * claim the contract does not permit. This gives those constraints somewhere
 * to live between sessions.
 */
export function contract(input = {}) {
  const supplierName = input.supplierId ?? req(input.supplier, "A contract's supplier");
  const sid = isId(KIND.SUPPLIER, supplierName) ? supplierName : supplierId(supplierName);
  const reference = req(input.reference, "A contract reference");
  const now = input.now ?? new Date().toISOString();

  return Object.freeze({
    ...base(KIND.CONTRACT, input.id ?? contractId(sid, reference), now),
    supplierId: sid,
    reference,
    effectiveFrom: iso(input.effectiveFrom, "effectiveFrom"),
    expiresOn: iso(input.expiresOn, "expiresOn"),
    noticePeriodWeeks: Number.isInteger(input.noticePeriodWeeks) ? input.noticePeriodWeeks : null,
    /* Clause objects are built by evidence.mjs (contractConstraint). They are
       carried, not redefined, so there is one shape for a constraint. */
    clauses: Object.freeze([...(input.clauses ?? [])]),
    synthetic: input.synthetic !== false,
  });
}

/* -------------------------------------------------------- commercial case */

/**
 * The envelope that ties a claim to the party, part and contract it concerns.
 * `ref` stays free text because people have their own numbering; `id` is what
 * the system uses, so a retyped reference cannot detach a case from its past.
 */
export function commercialCase(input = {}) {
  const supplierName = input.supplierId ?? req(input.supplier, "A case's supplier");
  const sid = isId(KIND.SUPPLIER, supplierName) ? supplierName : supplierId(supplierName);
  const now = input.now ?? new Date().toISOString();
  const status = input.status ?? CASE_STATUS.DRAFT;
  if (!Object.values(CASE_STATUS).includes(status)) throw new RangeError(`Not a case status: ${status}`);

  const id = input.id ?? entityId(KIND.CASE, `${sid}|${req(input.ref ?? now, "A case reference")}`);

  return Object.freeze({
    ...base(KIND.CASE, id, now),
    ref: nullable(input.ref),
    supplierId: sid,
    partId: input.partId ?? null,
    contractId: input.contractId ?? null,
    status,
    openedOn: iso(input.openedOn, "openedOn") ?? now,
    // Set when an outcome resolves this case. Null is "not yet", never "none".
    outcomeId: input.outcomeId ?? null,
    synthetic: input.synthetic !== false,
  });
}

/* -------------------------------------------------------- learning record */

/**
 * What a completed case teaches.
 *
 * Derived from recorded facts, never drafted by a model. Each field is
 * something a person observed: the argument made, the evidence asked for, what
 * the supplier did, and what it was worth. A learning record with no outcome
 * behind it is an opinion, so `outcomeId` and `caseId` are both required.
 */
export function learningRecord(input = {}) {
  const now = input.now ?? new Date().toISOString();
  const caseId = req(input.caseId, "A learning record's case");
  const outcomeId = req(input.outcomeId, "A learning record's outcome");
  const argument = req(input.argument, "The argument made");

  if (input.worked != null && typeof input.worked !== "boolean") {
    throw new TypeError("`worked` is a recorded fact: true, false, or omitted when unknown.");
  }

  return Object.freeze({
    ...base(KIND.LEARNING, input.id ?? entityId(KIND.LEARNING, `${outcomeId}|${normaliseName(argument)}`), now),
    caseId,
    outcomeId,
    supplierId: input.supplierId ?? null,
    driverId: nullable(input.driverId),
    argument,
    evidenceRequested: nullable(input.evidenceRequested),
    supplierResponse: nullable(input.supplierResponse),
    buyerAction: nullable(input.buyerAction),
    // Money stays Money. A learning record carrying a float would undo the
    // entire point of the calculation layer.
    valueMovedMinor: typeof input.valueMovedMinor === "bigint" ? input.valueMovedMinor : null,
    currency: nullable(input.currency),
    worked: input.worked ?? null,
    synthetic: input.synthetic !== false,
  });
}

/* ------------------------------------------------------------- integrity */

/**
 * Check that every reference in a set of entities points at something present.
 *
 * Returns findings rather than throwing: a dangling reference is a thing to
 * show someone, not a reason to refuse to open their data.
 */
export function checkReferences({ suppliers = [], parts = [], contracts = [], cases = [], learning = [] } = {}) {
  const has = (list, id) => list.some((e) => e && e.id === id);
  const findings = [];
  const note = (entity, field, id, expected) =>
    findings.push({ entity: entity.id, field, missing: id, expected });

  for (const p of parts) if (!has(suppliers, p.supplierId)) note(p, "supplierId", p.supplierId, "supplier");
  for (const c of contracts) if (!has(suppliers, c.supplierId)) note(c, "supplierId", c.supplierId, "supplier");
  for (const k of cases) {
    if (!has(suppliers, k.supplierId)) note(k, "supplierId", k.supplierId, "supplier");
    if (k.partId && !has(parts, k.partId)) note(k, "partId", k.partId, "part");
    if (k.contractId && !has(contracts, k.contractId)) note(k, "contractId", k.contractId, "contract");
  }
  for (const l of learning) {
    if (!has(cases, l.caseId)) note(l, "caseId", l.caseId, "case");
    if (l.supplierId && !has(suppliers, l.supplierId)) note(l, "supplierId", l.supplierId, "supplier");
  }

  return Object.freeze({ ok: findings.length === 0, findings: Object.freeze(findings) });
}
