/**
 * Labelling every figure supplied, derived or assumed.
 *
 * The decision pack claims every figure traces to a source, and then prints
 * every figure identically. A reviewer cannot see at a glance which number came
 * out of the supplier's letter, which the engine worked out, and which is
 * somebody's assumption — and those three warrant very different amounts of
 * trust.
 *
 * Three labels, because a reviewer can hold three in their head:
 *
 *   SUPPLIED  stated in a document or by a named external source. Check it
 *             against the source.
 *   DERIVED   computed by this engine from other values. Check the formula.
 *   ASSUMED   rests on a stated assumption, or on nothing at all. Check whether
 *             you believe it — and this is the list to take into the room.
 *
 * A buyer typing a driver weight from memory is making an assumption, and the
 * product says so. Treating "the user entered it" as evidence is how a guess
 * becomes a number in a decision pack.
 */

export const LABEL = Object.freeze({
  SUPPLIED: "supplied",
  DERIVED: "derived",
  ASSUMED: "assumed",
});

const EVIDENCED_KINDS = new Set([
  "document-passage",
  "contract-clause",
  "published-index",
  "externally-sourced",
]);

/**
 * Label one tracked field.
 * @param {object} field  { provenance, evidence?, confirmedBy?, lineage? }
 * @returns {{label: string, why: string, evidenced: boolean}}
 */
export function labelFor(field) {
  if (!field || typeof field !== "object") {
    return mark(LABEL.ASSUMED, "no provenance was recorded for this value", false);
  }

  const kind = field.evidence?.kind ?? null;
  const p = field.provenance ?? "unknown";

  if (p === "system-calculated" || p === "calculation") {
    return mark(LABEL.DERIVED, "computed by the engine from the inputs above", true);
  }
  if (kind && EVIDENCED_KINDS.has(kind)) {
    const where = field.evidence.clause
      ? `clause ${field.evidence.clause}`
      : field.evidence.quote
        ? `a quoted passage in the ${field.evidence.label}`
        : field.evidence.label || "an external source";
    return mark(LABEL.SUPPLIED, `stated in ${where}`, true);
  }
  if (p === "externally-sourced" || field.lineage) {
    return mark(LABEL.SUPPLIED, field.lineage || "taken from a named external source", true);
  }
  if (kind === "user-assumption") {
    return mark(LABEL.ASSUMED, "a stated assumption", false);
  }
  if (p === "user-entered") {
    // Entered by a person is not the same as evidenced by a document.
    return mark(LABEL.ASSUMED, "entered by hand, with no source attached", false);
  }
  if (p === "ai-inferred") {
    return field.confirmedBy
      ? mark(LABEL.SUPPLIED, `read from a document and confirmed by ${field.confirmedBy.by}`, true)
      : mark(LABEL.ASSUMED, "proposed by a model and not yet confirmed", false);
  }
  return mark(LABEL.ASSUMED, "no source was recorded", false);
}

function mark(label, why, evidenced) {
  return Object.freeze({ label, why, evidenced });
}

/**
 * Everything in a completed analysis that rests on an assumption.
 *
 * This is the block a buyer takes into the room: each entry says what is
 * assumed and what would settle it, because "verify this" without "how" is
 * not actionable.
 *
 * @param {object} bridge    a costBridge result
 * @param {object} [ev]      an assessEvidence result, if one was produced
 */
export function assumptionsToVerify(bridge, ev = null) {
  const out = [];
  if (!bridge) return out;

  for (const c of bridge.contributions ?? []) {
    const weight = labelFor({ provenance: c.provenance, evidence: c.evidence?.weight });
    const movement = labelFor({ provenance: c.provenance, evidence: c.evidence?.movement, lineage: c.lineage });

    if (weight.label === LABEL.ASSUMED) {
      out.push({
        id: `weight-${c.id}`,
        figure: `${c.label} share of unit cost`,
        assumption: `that ${c.label.toLowerCase()} is the stated share of unit cost`,
        settledBy: "a cost breakdown from the supplier, or your own should-cost model",
        material: c.weight >= 200_000_000n,   // 20% or more of unit cost
      });
    }
    if (movement.label === LABEL.ASSUMED) {
      out.push({
        id: `movement-${c.id}`,
        figure: `${c.label} movement`,
        assumption: "that the movement is as stated, with no published series behind it",
        settledBy: "the name of the index, its base period and the lag the contract specifies",
        material: true,
      });
    }
  }

  if ((bridge.unexplainedWeight ?? 0n) > 0n) {
    out.push({
      id: "unexplained-cost",
      figure: "the unattributed share of unit cost",
      assumption: "that the cost not attributed to any driver did not move at all",
      settledBy: "a full cost breakdown, so the remainder is accounted for rather than assumed flat",
      material: bridge.unexplainedWeight >= 250_000_000n,   // a quarter or more
    });
  }

  if (bridge.retrospective) {
    out.push({
      id: "retrospective-volume",
      figure: "retrospective volume",
      assumption: `that roughly ${bridge.retrospective.units} units were delivered in the retrospective period, pro rata from the annual figure`,
      settledBy: "actual delivered quantities for those months",
      material: false,
    });
  }

  if (bridge.currency) {
    out.push({
      id: "fx-snapshot",
      figure: "the exchange rate effect",
      assumption: "that the rates on the dates shown are the right ones to use",
      settledBy: "the rate the contract specifies, or the rate on the actual settlement dates",
      material: false,
    });
  }

  for (const gap of ev?.gaps ?? []) {
    if (gap.severity === "material" && !out.some((x) => x.id === gap.id)) {
      out.push({
        id: gap.id,
        figure: "evidence gap",
        assumption: gap.text,
        settledBy: "the supporting document",
        material: true,
      });
    }
  }

  return out;
}

/** A short legend, so the labels do not need explaining twice on the page. */
export const LEGEND = Object.freeze([
  { label: LABEL.SUPPLIED, means: "stated in a document or by a named source" },
  { label: LABEL.DERIVED, means: "computed by the engine from the figures above" },
  { label: LABEL.ASSUMED, means: "rests on an assumption — check before relying on it" },
]);
