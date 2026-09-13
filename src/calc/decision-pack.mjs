/**
 * The decision pack.
 *
 * Everything the analysis knows, assembled into one document a reviewer can
 * audit and an approver can sign. This is the artefact that makes the work
 * usable by someone who was not in the room when it was done.
 *
 * Three rules govern what goes in it:
 *
 *   1. Every figure traces back. Recommendation -> scenario -> calculation ->
 *      formula -> assumption -> evidence. A number with no path back is a bug.
 *   2. The recommendation is derived by rule, not by judgement. It is stated
 *      with the condition that produced it and what would change it, so a
 *      reviewer can disagree with the rule rather than with a black box.
 *   3. Nothing here is legal advice, and the pack says so.
 *
 * The pack is pure data. Rendering lives separately so the content can be
 * tested without a browser.
 */

import { ONE, moneyToDecimalString, moneyScale, moneyTimesQuantity } from "./exact.mjs";
import { partialAcceptance, delayEffect, formatPercent } from "./cost-bridge.mjs";
import { assessEvidence } from "./evidence.mjs";
import { labelFor, assumptionsToVerify, LABEL, LEGEND } from "./provenance.mjs";

/** Options the analysis can support with numbers. Ordered by escalation. */
export const ACTION = Object.freeze({
  ACCEPT: "accept-as-requested",
  ACCEPT_WARRANTED: "accept-the-warranted-amount",
  COUNTER: "counter-at-the-warranted-amount",
  REQUEST_EVIDENCE: "request-evidence-before-deciding",
  PHASE: "phase-the-increase",
  DELAY: "delay-implementation",
  REJECT: "reject-as-unsupported",
  ESCALATE: "escalate-non-contractual-claim",
});

/**
 * @param {object} input
 * @param {object} input.meta      { caseId, supplier, part, received, preparedBy?, synthetic }
 * @param {object} input.bridge    a costBridge() result
 * @param {object} [input.evidenceInput]  { claims, constraints } for assessEvidence
 * @param {object} [input.position]       { criticality, alternatives, switchingCost, qualificationWeeks, noticePeriod }
 * @param {string} [input.generatedAt]    ISO timestamp; supplied so packs are reproducible in tests
 */
export function buildDecisionPack({ meta = {}, bridge, evidenceInput = {}, position = {}, generatedAt }) {
  if (!bridge || !bridge.contributions) throw new TypeError("A decision pack needs a costBridge result");

  const ev = assessEvidence(bridge, evidenceInput);
  const cur = bridge.unitPrice.baseline.currency;
  const M = moneyToDecimalString;

  /* ---------------------------------------------------------- scenarios */
  const vol = bridge.annualVolume;
  const scenarios = [
    {
      id: "reject",
      label: "Hold the current price",
      change: 0n,
      annualCost: moneyScale(moneyTimesQuantity(bridge.unitPrice.baseline, BigInt(vol)), 0n),
      basis: "No increase applied.",
    },
    {
      id: "warranted",
      label: "Pay what the evidence supports",
      change: bridge.warrantedChange,
      annualCost: bridge.annual.warranted,
      basis: `Weighted driver movement${bridge.constraintApplied ? `, limited by the contract ${bridge.constraintApplied}` : ""}.`,
    },
    {
      id: "requested",
      label: "Pay as requested",
      change: bridge.requestedChange,
      annualCost: bridge.annual.requested,
      basis: "The supplier's figure, accepted in full.",
    },
  ];

  // A midpoint only makes sense when there is a gap to split.
  if (bridge.unsupportedChange > 0n) {
    const mid = bridge.warrantedChange + bridge.unsupportedChange / 2n;
    scenarios.splice(2, 0, {
      id: "midpoint",
      label: "Split the difference",
      change: mid,
      annualCost: partialAcceptance(bridge, mid, vol).annualCost,
      basis: "Half of the unsupported amount conceded. A negotiating position, not an evidenced one.",
    });
  }

  const delay3 = vol > 0 ? delayEffect(bridge, 3, vol) : null;

  /* ------------------------------------------------------------ options */
  const options = [];
  const push = (action, label, impact, extra) =>
    options.push({
      action, label, financialImpact: impact,
      evidence: extra.evidence ?? [],
      assumptions: extra.assumptions ?? [],
      risks: extra.risks ?? [],
      requiresApproval: extra.requiresApproval ?? null,
      confidence: extra.confidence ?? "medium",
      whatWouldChangeThis: extra.whatWouldChangeThis ?? null,
      ...extra.rest,
    });

  if (ev.contradictions.length) {
    push(ACTION.ESCALATE, "Challenge the contractual basis before discussing price",
      { annual: scenarios[0].annualCost, note: "No price change while the basis is disputed." },
      {
        evidence: ev.contradictions.map((x) => x.text),
        risks: ["Supplier may treat a refusal to engage as a dispute.", "Relationship cost if the mechanism turns out to exist elsewhere in the agreement."],
        requiresApproval: "Category owner; legal review of the clause before any formal position is sent.",
        confidence: "high",
        whatWouldChangeThis: "A clause that does permit the mechanism, or a side letter varying it.",
      });
  }

  if (ev.materialGaps > 0) {
    push(ACTION.REQUEST_EVIDENCE, "Ask for the missing evidence before deciding",
      { annual: scenarios[0].annualCost, note: "Defers the increase while the request is outstanding." },
      {
        evidence: ev.gaps.filter((g) => g.severity === "material").map((g) => g.text),
        assumptions: ["The supplier will supply a breakdown on request."],
        risks: ["Delay may push the effective date without agreement."],
        requiresApproval: "None to request evidence.",
        confidence: "high",
        whatWouldChangeThis: "A credible cost breakdown closing the gaps below.",
      });
  }

  if (bridge.unsupportedChange > 0n) {
    push(ACTION.COUNTER, `Counter at ${formatPercent(bridge.warrantedChange)}`,
      { annual: bridge.annual.warranted, avoided: bridge.annual.unsupported },
      {
        evidence: bridge.contributions.filter((c) => c.lineage).map((c) => c.lineage),
        assumptions: bridge.assumptions.map((a) => a.text),
        risks: ["Supplier may hold firm; consider the alternatives below before committing."],
        requiresApproval: `Spend authority for ${cur} ${M(bridge.annual.warranted)} a year.`,
        confidence: ev.materialGaps === 0 ? "high" : "medium",
        whatWouldChangeThis: "Evidence supporting the unexplained share of unit cost.",
      });
    if (delay3) {
      push(ACTION.DELAY, "Delay implementation by three months",
        { annual: delay3.firstYearCost, avoided: delay3.firstYearAvoided },
        {
          assumptions: [`Applies to ${delay3.affectedUnits} of ${vol} units in year one.`],
          risks: ["Only defers the cost; it does not reduce the run rate."],
          requiresApproval: "Category owner.",
          confidence: "high",
          whatWouldChangeThis: "A contractual notice period that already fixes the effective date.",
        });
    }
  } else if (bridge.unsupportedChange === 0n) {
    push(ACTION.ACCEPT, "Accept — the evidence supports the request in full",
      { annual: bridge.annual.requested },
      {
        evidence: bridge.contributions.filter((c) => c.lineage).map((c) => c.lineage),
        assumptions: bridge.assumptions.map((a) => a.text),
        risks: ["None identified by this analysis beyond the evidence gaps listed."],
        requiresApproval: `Spend authority for ${cur} ${M(bridge.annual.requested)} a year.`,
        confidence: ev.materialGaps === 0 ? "high" : "medium",
        whatWouldChangeThis: "A cost breakdown showing a smaller driver weight than claimed.",
      });
  } else {
    push(ACTION.ACCEPT, "Accept as offered — they have asked for less than the evidence supports",
      { annual: bridge.annual.requested },
      {
        evidence: bridge.contributions.filter((c) => c.lineage).map((c) => c.lineage),
        assumptions: [`The driver evidence would support ${formatPercent(bridge.warrantedChange)}; they asked for ${formatPercent(bridge.requestedChange)}.`],
        risks: ["Expect a further approach when the shortfall becomes apparent to them."],
        requiresApproval: `Spend authority for ${cur} ${M(bridge.annual.requested)} a year.`,
        confidence: "high",
        whatWouldChangeThis: "Nothing in this analysis. Do not volunteer the difference.",
      });
  }

  /* ---------------------------------------------- recommendation by rule */
  const recommendation = recommend({ bridge, ev, options });

  /* ------------------------------------------------------------ sources */
  const sources = [];
  for (const c of bridge.contributions) {
    if (c.lineage) sources.push({ for: `${c.label} movement`, detail: c.lineage, kind: "published-index" });
    if (c.source && !c.lineage) sources.push({ for: `${c.label}`, detail: c.source, kind: "stated" });
  }
  for (const item of ev.items) {
    const e = item.evidence;
    if (e.kind === "document-passage") sources.push({ for: `${item.driverId} ${item.field}`, detail: `${e.label}${e.locator ? `, ${e.locator}` : ""}: "${e.quote}"`, kind: e.kind });
    if (e.kind === "contract-clause") sources.push({ for: `${item.driverId} ${item.field}`, detail: `${e.label} clause ${e.clause}`, kind: e.kind });
  }
  for (const x of ev.contradictions) {
    if (x.constraint) sources.push({ for: "contract basis", detail: `${x.constraint.evidence.label} clause ${x.constraint.evidence.clause}`, kind: "contract-clause" });
    if (x.claim?.evidence?.quote) sources.push({ for: "supplier assertion", detail: `supplier letter: "${x.claim.evidence.quote}"`, kind: "document-passage" });
  }
  if (bridge.currency) sources.push({ for: "exchange rates", detail: bridge.currency.lineage, kind: "externally-sourced" });

  return Object.freeze({
    meta: Object.freeze({
      caseId: meta.caseId ?? null,
      supplier: meta.supplier ?? null,
      part: meta.part ?? null,
      received: meta.received ?? null,
      preparedBy: meta.preparedBy ?? "BuyrWorld claim review",
      synthetic: meta.synthetic !== false,
      generatedAt: generatedAt ?? null,
    }),

    summary: Object.freeze({
      requested: bridge.requestedChange,
      warranted: bridge.warrantedChange,
      unsupported: bridge.unsupportedChange,
      annualRequested: bridge.annual.requested,
      annualWarranted: bridge.annual.warranted,
      annualUnsupported: bridge.annual.unsupported,
      currency: cur,
      headline: headlineFor(bridge, ev, cur),
    }),

    baseline: Object.freeze({
      unitPrice: bridge.unitPrice.baseline,
      annualVolume: vol,
      currency: cur,
    }),

    decomposition: bridge.contributions,
    evidence: ev,
    currency: bridge.currency,
    contract: Object.freeze({
      constraintApplied: bridge.constraintApplied,
      warrantedBeforeConstraints: bridge.warrantedBeforeConstraints,
      contradictions: ev.contradictions,
    }),
    retrospective: bridge.retrospective,
    scenarios,
    options,
    recommendation,
    position,
    // Every figure labelled supplied, derived or assumed, so a reviewer can see
    // which numbers warrant which amount of trust without reading the appendix.
    provenance: Object.freeze({
      legend: LEGEND,
      byDriver: bridge.contributions.map((c) => Object.freeze({
        id: c.id,
        label: c.label,
        weight: labelFor({ provenance: c.provenance, evidence: c.evidence?.weight }),
        movement: labelFor({ provenance: c.provenance, evidence: c.evidence?.movement, lineage: c.lineage }),
      })),
      warranted: labelFor({ provenance: "system-calculated" }),
      exposure: labelFor({ provenance: "system-calculated" }),
    }),
    assumptionsToVerify: assumptionsToVerify(bridge, ev),
    assumptions: bridge.assumptions,
    uncertainties: uncertaintiesFor(bridge, ev),
    sources,

    approval: Object.freeze({
      state: "not-approved",
      by: null,
      at: null,
      note: "This pack records an analysis. It is not approved until a person with spend authority records a decision against it.",
    }),

    disclaimer:
      "Procurement analysis only. This is not legal advice: any contractual question raised here " +
      "should be put to a qualified professional before a position is taken.",
  });
}

/**
 * The recommendation is a rule, stated with its condition. A reviewer who
 * disagrees can see exactly which rule fired rather than arguing with prose.
 */
export function recommend({ bridge, ev, options }) {
  let action, because;

  if (ev.contradictions.length > 0) {
    action = ACTION.ESCALATE;
    because = "The letter relies on a mechanism the supplied contract does not support. " +
              "The arithmetic is irrelevant until the basis is settled.";
  } else if (ev.materialGaps > 0 && bridge.unsupportedChange > 0n) {
    action = ACTION.REQUEST_EVIDENCE;
    because = `${ev.materialGaps} material evidence gap(s) remain and ${formatPercent(bridge.unsupportedChange)} of the ` +
              "request is unsupported. Ask before conceding.";
  } else if (bridge.unsupportedChange > 0n) {
    action = ACTION.COUNTER;
    because = `The evidence supports ${formatPercent(bridge.warrantedChange)}; ` +
              `${formatPercent(bridge.unsupportedChange)} of the request is unsupported.`;
  } else if (bridge.unsupportedChange === 0n) {
    action = ACTION.ACCEPT;
    because = "The driver evidence supports the request in full. Negotiate the terms if anything, not the principle.";
  } else {
    action = ACTION.ACCEPT;
    because = `They have asked for less than the evidence supports (${formatPercent(bridge.requestedChange)} against ` +
              `${formatPercent(bridge.warrantedChange)}).`;
  }

  const option = options.find((o) => o.action === action) ?? options[0] ?? null;
  return Object.freeze({
    action,
    because,
    option,
    rule: "contradiction > material gap > unsupported amount > fully supported > under-asked",
    notLegalAdvice: true,
  });
}

function headlineFor(bridge, ev, cur) {
  const M = moneyToDecimalString;
  if (ev.contradictions.length) {
    return "The contractual basis for this request is disputed. Settle that before discussing the amount.";
  }
  if (bridge.unsupportedChange > 0n) {
    return `${formatPercent(bridge.requestedChange)} requested, ${formatPercent(bridge.warrantedChange)} supported by the evidence. ` +
           `${cur} ${M(bridge.annual.unsupported)} a year is unsupported.`;
  }
  if (bridge.unsupportedChange === 0n) {
    return `${formatPercent(bridge.requestedChange)} requested and fully supported by the driver evidence.`;
  }
  return `${formatPercent(bridge.requestedChange)} requested, which is less than the ${formatPercent(bridge.warrantedChange)} ` +
         `the evidence would support.`;
}

function uncertaintiesFor(bridge, ev) {
  const out = [];
  if (bridge.unexplainedWeight > 0n) {
    out.push(`${formatPercent(bridge.unexplainedWeight)} of unit cost is not attributed to any driver. ` +
             "It is treated as unchanged, which may understate or overstate the warranted figure.");
  }
  if (ev.materialGaps > 0) {
    out.push(`${ev.materialGaps} assertion(s) carry no supporting evidence. The figures are arithmetically ` +
             "correct given the inputs, but the inputs are not all evidenced.");
  }
  if (bridge.currency) {
    out.push("Exchange rates move after the rate date shown. The currency split is a snapshot, not a forecast.");
  }
  if (bridge.retrospective) {
    out.push(`Retrospective volume is estimated pro rata from the annual figure (${bridge.retrospective.units} units); ` +
             "actual delivered quantity may differ.");
  }
  if (out.length === 0) out.push("No material uncertainties identified by this analysis.");
  return out;
}
