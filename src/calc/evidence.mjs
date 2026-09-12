/**
 * Evidence and lineage.
 *
 * Every material assertion in a claim review must resolve to one of a small,
 * closed set of things. The set is closed deliberately: "the model said so" is
 * not on it, and neither is silence. An assertion with nothing behind it gets
 * the NONE kind and is reported as a gap — which is far more useful to a buyer
 * than a confident number.
 *
 * This is the difference between a decision pack and formatted prose. A
 * reviewer must be able to walk backwards from any figure to the passage,
 * clause, published series or stated assumption it rests on.
 */

import { SCALE, scaleDiv } from "./exact.mjs";

/** The closed set. Adding to it is a deliberate decision, not a convenience. */
export const EVIDENCE_KIND = Object.freeze({
  DOCUMENT: "document-passage",   // a quoted span from something the supplier sent
  CONTRACT: "contract-clause",    // a clause in the agreement
  PUBLISHED: "published-index",   // a dated observation in a named series
  ASSUMPTION: "user-assumption",  // the buyer's own stated assumption
  CALCULATION: "calculation",     // derived by the engine from other evidence
  NONE: "no-supporting-evidence", // asserted with nothing behind it
});

/** Strength ordering. Used to report the weakest link, never to invent a score. */
const STRENGTH = {
  [EVIDENCE_KIND.CONTRACT]: 5,
  [EVIDENCE_KIND.PUBLISHED]: 4,
  [EVIDENCE_KIND.DOCUMENT]: 3,
  [EVIDENCE_KIND.CALCULATION]: 3,
  [EVIDENCE_KIND.ASSUMPTION]: 2,
  [EVIDENCE_KIND.NONE]: 0,
};

/**
 * Create an evidence item.
 *
 * @param {string} kind   one of EVIDENCE_KIND
 * @param {object} ref    { label, locator?, quote?, asOf?, series?, clause? }
 */
export function evidence(kind, ref = {}) {
  if (!Object.values(EVIDENCE_KIND).includes(kind)) {
    throw new RangeError(
      `Unknown evidence kind "${kind}". Use one of: ${Object.values(EVIDENCE_KIND).join(", ")}`
    );
  }
  if (kind !== EVIDENCE_KIND.NONE && !ref.label) {
    throw new TypeError(`Evidence of kind "${kind}" needs a label naming its source`);
  }
  if (kind === EVIDENCE_KIND.DOCUMENT && !ref.quote) {
    throw new TypeError("A document passage must carry the quoted text it refers to");
  }
  if (kind === EVIDENCE_KIND.CONTRACT && !ref.clause) {
    throw new TypeError("A contract clause reference must name the clause");
  }
  return Object.freeze({
    kind,
    label: ref.label ?? null,
    locator: ref.locator ?? null,   // page, line, cell, URL fragment
    quote: ref.quote ?? null,
    clause: ref.clause ?? null,
    series: ref.series ?? null,
    asOf: ref.asOf ?? null,
    strength: STRENGTH[kind],
  });
}

/** Shorthand for the common case: nothing supports this. */
export const noEvidence = (why) =>
  Object.freeze({ ...evidence(EVIDENCE_KIND.NONE), note: why ?? null });

/**
 * Assess the evidence behind a completed cost bridge.
 *
 * Returns coverage by weight — not by count. Three well-evidenced drivers
 * covering 15% of unit cost is weaker than one covering 60%, and counting
 * assertions would hide that.
 *
 * @param {object} bridge  a costBridge() result
 * @param {object} [opts]
 * @param {Array}  [opts.constraints]  ContractConstraint-ish records with evidence
 * @param {Array}  [opts.claims]       assertions made in the supplier letter
 */
export function assessEvidence(bridge, opts = {}) {
  const gaps = [];
  const items = [];

  let evidencedWeight = 0n;
  let claimedWeight = 0n;

  for (const c of bridge.contributions) {
    claimedWeight += c.weight;

    // Movement: derived from a published series, or asserted?
    const movementEv = c.evidence?.movement
      ?? (c.lineage
        ? evidence(EVIDENCE_KIND.PUBLISHED, { label: c.source ?? "index series", series: c.source })
        : noEvidence(`No source given for the ${c.label} movement`));

    // Weight: the share of unit cost. Almost always an assumption unless the
    // supplier has opened its book, and pretending otherwise would be dishonest.
    const weightEv = c.evidence?.weight
      ?? noEvidence(`No cost breakdown supports the ${c.label} weight of ${pctOf(c.weight)}`);

    items.push({ driverId: c.id, field: "indexMovement", evidence: movementEv });
    items.push({ driverId: c.id, field: "weight", evidence: weightEv });

    if (movementEv.kind !== EVIDENCE_KIND.NONE && weightEv.kind !== EVIDENCE_KIND.NONE) {
      evidencedWeight += c.weight;
    }
    if (weightEv.kind === EVIDENCE_KIND.NONE) {
      gaps.push({
        id: `weight-${c.id}`,
        severity: c.weight >= SCALE / 5n ? "material" : "minor", // >= 20% of unit cost
        text: `${c.label}: the claimed ${pctOf(c.weight)} share of unit cost has no supporting breakdown. ` +
              `Ask for the cost structure before accepting this driver.`,
      });
    }
    if (movementEv.kind === EVIDENCE_KIND.NONE) {
      gaps.push({
        id: `movement-${c.id}`,
        severity: "material",
        text: `${c.label}: the movement is asserted, not sourced. Ask which published series and which periods.`,
      });
    }
  }

  // Unexplained cost is its own gap, distinct from unevidenced drivers.
  if (bridge.unexplainedWeight > 0n) {
    gaps.push({
      id: "unexplained-cost",
      severity: bridge.unexplainedWeight >= SCALE / 4n ? "material" : "minor",
      text: `${pctOf(bridge.unexplainedWeight)} of unit cost is not attributed to any driver. ` +
            `Movement there is unknown, and is being treated as zero.`,
    });
  }

  // Contradictions between what the letter claims and what the contract says.
  const contradictions = findContradictions(opts.claims ?? [], opts.constraints ?? []);
  for (const x of contradictions) {
    gaps.push({ id: `contradiction-${x.id}`, severity: "material", text: x.text });
  }

  const coverage = claimedWeight === 0n ? 0n : scaleDiv(evidencedWeight * SCALE, claimedWeight);
  const weakest = items.reduce(
    (min, i) => (i.evidence.strength < min.strength ? i.evidence : min),
    { strength: 99 }
  );

  return Object.freeze({
    // Coverage by weight of unit cost, not by count of assertions.
    coverageOfClaimedWeight: coverage,
    evidencedWeight,
    claimedWeight,
    items,
    gaps,
    contradictions,
    weakestKind: weakest.kind ?? EVIDENCE_KIND.NONE,
    materialGaps: gaps.filter((g) => g.severity === "material").length,
    // Stated so nobody mistakes this for an objective score.
    method:
      "Coverage is the share of claimed unit-cost weight whose weight AND movement " +
      "both carry evidence. It measures evidence sufficiency, not whether the claim is true.",
  });
}

/**
 * A claim in the letter that the contract does not support.
 *
 * Matching is explicit: a claim declares the mechanism it relies on, and a
 * constraint declares the mechanism it permits. Nothing is inferred from prose.
 */
export function findContradictions(claims, constraints) {
  const out = [];
  for (const claim of claims) {
    if (!claim.mechanism) continue;
    const governing = constraints.filter((c) => c.governs === claim.mechanism);
    if (governing.length === 0) {
      out.push({
        id: claim.id,
        text: `The letter relies on "${claim.mechanism}", but no contract clause governing it was supplied. ` +
              `Confirm the mechanism exists before treating the claim as contractual.`,
        claim,
        constraint: null,
      });
      continue;
    }
    for (const c of governing) {
      if (c.permits === false) {
        out.push({
          id: claim.id,
          text: `The letter relies on "${claim.mechanism}", but ${c.evidence?.clause ? "clause " + c.evidence.clause : "the contract"} ` +
                `does not permit it${c.note ? `: ${c.note}` : "."}`,
          claim,
          constraint: c,
        });
      }
    }
  }
  return out;
}

/** A contract constraint with its own evidence. */
export function contractConstraint({ id, governs, permits, note, evidence: ev }) {
  if (!id || !governs) throw new TypeError("A contract constraint needs an id and the mechanism it governs");
  if (!ev || ev.kind !== EVIDENCE_KIND.CONTRACT) {
    throw new TypeError(`Constraint "${id}" must cite a contract clause as its evidence`);
  }
  return Object.freeze({ id, governs, permits: permits !== false, note: note ?? null, evidence: ev });
}

/** An assertion the supplier letter makes. */
export function supplierClaim({ id, mechanism, quote, locator }) {
  if (!id) throw new TypeError("A supplier claim needs an id");
  return Object.freeze({
    id,
    mechanism: mechanism ?? null,
    evidence: quote
      ? evidence(EVIDENCE_KIND.DOCUMENT, { label: "supplier letter", quote, locator })
      : noEvidence("The letter asserts this without stating a basis"),
  });
}

function pctOf(ratio) {
  const h = scaleDiv(ratio * 10000n, SCALE);
  const neg = h < 0n;
  const a = neg ? -h : h;
  return (neg ? "-" : "") + a / 100n + "." + (a % 100n).toString().padStart(2, "0") + "%";
}

export { pctOf as formatWeight };
