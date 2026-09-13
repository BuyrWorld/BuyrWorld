/**
 * Negotiation preparation.
 *
 * The cost bridge answers "how much of this claim is warranted". It stops
 * exactly where the buyer's problem starts: they still have to go and have the
 * conversation. This module turns a finished case into the numbers that
 * conversation needs — and nothing else. Every figure here is derived from the
 * bridge and the evidence assessment by exact arithmetic. No figure is drafted
 * by a model, and none is invented.
 *
 * Three ideas do most of the work.
 *
 * 1. There are three anchors, not two. The obvious pair is "what we pay now"
 *    and "what they are asking". The one that matters is between them: the
 *    warranted price. The space above it is the unsupported remainder, and
 *    that — precisely that — is the only money actually in dispute.
 *
 * 2. The warranted figure is not a floor. It is computed from drivers, and some
 *    of those drivers have no evidence behind them. If the supplier cannot
 *    produce a cost breakdown, those contributions fall away and the defensible
 *    figure drops. That lower number is the hard line, and it is worth knowing
 *    before the meeting rather than discovering it during one.
 *
 * 3. A walk-away threat is either credible or it is theatre, and which one is
 *    decidable from facts already on file: whether a qualified alternative
 *    exists, and whether qualifying it fits inside the notice period. Stating
 *    the rule beats asserting the conclusion.
 *
 * What this module will not do: invent a target price, estimate what a rival
 * would quote, or score the supplier's mood. Where something is assumed it is
 * returned in `assumptions` and labelled, in the same way the rest of the
 * engine labels an assumption.
 */

import {
  SCALE, money, moneyAdd, moneyApplyChange, moneyScale, moneyTimesQuantity,
  moneyToDecimalString, scaleDiv, ratioMul, ratioToPercentString,
} from "./exact.mjs";
import { partialAcceptance, delayEffect } from "./cost-bridge.mjs";
import { EVIDENCE_KIND } from "./evidence.mjs";

/** Whether walking away is a real option or a bluff. */
export const CREDIBILITY = Object.freeze({
  CREDIBLE: "credible",
  NOT_CREDIBLE: "not-credible",
  UNKNOWN: "unknown",
});

const pct = (r) => ratioToPercentString(r, 2);
const gbp = (m) => moneyToDecimalString(m);

/* ------------------------------------------------------------------ anchors */

/**
 * The three prices, and the gap between the middle one and the top one.
 * The band is the unsupported remainder: everything else is agreed arithmetic.
 */
function anchorsOf(bridge) {
  const unit = bridge.unitPrice.baseline;
  const vol = BigInt(bridge.annualVolume);
  const lineAtCurrent = moneyTimesQuantity(unit, vol);

  const at = (unitPrice, annualDelta) => Object.freeze({
    unitPrice,
    annualCost: moneyAdd(lineAtCurrent, annualDelta),
    annualDelta,
  });

  return Object.freeze({
    current: Object.freeze({
      unitPrice: unit,
      annualCost: lineAtCurrent,
      annualDelta: money(0n, unit.currency, unit.asOf),
    }),
    warranted: at(bridge.unitPrice.warranted, bridge.annual.warranted),
    requested: at(bridge.unitPrice.requested, bridge.annual.requested),
    /* The only money in dispute. Everything below the warranted price is
       arithmetic both sides can check. */
    inDispute: bridge.annual.unsupported,
    inDisputeChange: bridge.unsupportedChange,
  });
}

/* ------------------------------------------------ which drivers are evidenced */

/** A driver counts as evidenced only when BOTH its weight and movement do. */
function evidencedDriverIds(ev) {
  if (!ev) return null;                    // not assessed is not the same as not evidenced
  const byDriver = new Map();
  for (const item of ev.items) {
    const rec = byDriver.get(item.driverId) ?? {};
    rec[item.field] = item.evidence.kind !== EVIDENCE_KIND.NONE;
    byDriver.set(item.driverId, rec);
  }
  const ids = new Set();
  for (const [id, rec] of byDriver) {
    if (rec.weight === true && rec.indexMovement === true) ids.add(id);
  }
  return ids;
}

/* -------------------------------------------------------------- the ladder */

/**
 * Positions between the hard line and their ask, each priced.
 *
 * Challenges move the number down and are backed by an evidence gap.
 * Concessions move it up and are backed by nothing but a decision to concede —
 * which is why each one says so.
 */
function buildLadder(bridge, evidenced) {
  const unit = bridge.unitPrice.baseline;
  const vol = BigInt(bridge.annualVolume);
  const lineAtCurrent = moneyTimesQuantity(unit, vol);
  const annualValueOf = (changeRatio) => moneyScale(lineAtCurrent, changeRatio);

  /* --- challenges: unevidenced driver contributions --- */
  const challenges = [];
  let unevidencedContribution = 0n;
  if (evidenced) {
    for (const c of bridge.contributions) {
      if (evidenced.has(c.id)) continue;
      if (c.contribution <= 0n) continue;    // a negative driver helps you; leave it alone
      unevidencedContribution += c.contribution;
      challenges.push(Object.freeze({
        id: `challenge-${c.id}`,
        driverId: c.id,
        label: c.label,
        contribution: c.contribution,
        worthAnnually: annualValueOf(c.contribution),
        why: `${c.label} contributes ${pct(c.contribution)} of the warranted increase, but its ` +
             `weight or movement carries no evidence. If it cannot be supported, it comes out.`,
      }));
    }
    challenges.sort((a, b) =>
      b.worthAnnually.minor > a.worthAnnually.minor ? 1
        : b.worthAnnually.minor < a.worthAnnually.minor ? -1 : 0);
  }

  /* The hard line: what survives if none of the unevidenced drivers is supported.
     A cap or collar can only have reduced the warranted figure, so the hard line
     can never sit above it. */
  const stripped = bridge.warrantedChange - unevidencedContribution;
  const hardLineChange = stripped < bridge.warrantedChange ? stripped : bridge.warrantedChange;

  /* --- concessions: fractions of the remainder --- */
  const remainder = bridge.unsupportedChange;
  const concessions = [];
  const steps = [
    ["hold", 0n, "Hold at the warranted figure. Everything here is evidenced arithmetic."],
    ["quarter", 25n, "A quarter of the unsupported remainder conceded."],
    ["half", 50n, "Half the unsupported remainder conceded. Even-split settlements are common; this one is still a choice, not a finding."],
    ["three-quarters", 75n, "Three quarters of the unsupported remainder conceded."],
    ["full", 100n, "Their claim accepted in full."],
  ];
  for (const [id, share, note] of steps) {
    if (remainder <= 0n && share > 0n) continue;   // nothing in dispute to concede
    const conceded = share === 0n ? 0n : scaleDiv(remainder * share, 100n);
    const acceptedChange = bridge.warrantedChange + conceded;
    const p = partialAcceptance(bridge, acceptedChange, bridge.annualVolume);
    concessions.push(Object.freeze({
      id: `concede-${id}`,
      shareOfRemainder: share,
      acceptedChange,
      acceptedUnitPrice: p.acceptedUnitPrice,
      /* partialAcceptance returns the annual INCREASE as `annualCost`. Both the
         increase and the resulting total spend are useful here, and conflating
         them is how a £255k increase gets reported as a £255k contract. */
      annualIncrease: p.annualCost,
      annualTotalCost: moneyAdd(lineAtCurrent, p.annualCost),
      annualAvoided: p.annualAvoided,
      costOfThisStep: annualValueOf(conceded),
      evidenced: share === 0n,
      note,
    }));
  }

  return { challenges, concessions, hardLineChange, unevidencedContribution };
}

/* ------------------------------------------------------------- the rebuttals */

const ASK_FOR = Object.freeze({
  weight: "the cost breakdown that supports this share of unit cost",
  movement: "the published series, the base period and the current period",
  "unexplained-cost": "what the unattributed share of unit cost consists of",
  contradiction: "the clause they say permits this",
});

/**
 * What they will say, what the file shows, and what to ask for.
 *
 * Every row comes from an evidence gap or a contradiction that was already
 * detected. Ordered by what it is worth, because that is the order to raise
 * them in.
 */
function buildRebuttals(bridge, ev) {
  if (!ev) return [];
  const unit = bridge.unitPrice.baseline;
  const vol = BigInt(bridge.annualVolume);
  const annualValueOf = (r) => moneyScale(moneyTimesQuantity(unit, vol), r);
  const byId = new Map(bridge.contributions.map((c) => [c.id, c]));

  const rows = ev.gaps.map((g) => {
    const [prefix, ...rest] = g.id.split("-");
    const driverId = rest.join("-");
    const driver = byId.get(driverId) ?? null;
    const kind = ASK_FOR[g.id] ? g.id : prefix;
    /* What raising it is worth: the driver's own contribution. Unexplained cost
       is already treated as zero movement, so challenging it wins nothing — and
       saying so is more use than a number that flatters the page. */
    const worth = driver && (prefix === "weight" || prefix === "movement")
      ? annualValueOf(driver.contribution)
      : null;
    return Object.freeze({
      id: g.id,
      severity: g.severity,
      driverId: driver ? driver.id : null,
      theirPoint: g.text,
      ask: ASK_FOR[kind] ?? "the document behind this claim",
      worthAnnually: worth,
    });
  });

  /* A base-period overstatement is not an evidence gap — the evidence is there,
     it is simply being read from the wrong month. It is usually the single most
     recoverable item in the file, so it belongs here. */
  for (const c of bridge.contributions) {
    if (!c.basis || c.basis.overstatement <= 0n) continue;
    /* The overstatement is an INDEX movement, not a price change. Only the
       driver's share of unit cost reaches the price, so the recoverable amount
       is weight x overstatement. Using the raw figure would have overstated
       what challenging it is worth — by a factor of 1/weight. */
    const priceEffect = ratioMul(c.weight, c.basis.overstatement);
    rows.push(Object.freeze({
      id: `basis-${c.id}`,
      severity: "material",
      driverId: c.id,
      theirPoint:
        `${c.label}: the letter indexes from ${c.basis.claimedBase}, the contract from ` +
        `${c.basis.contractualBase} — ${c.basis.monthsShifted} month(s) earlier. That overstates ` +
        `the movement by ${pct(c.basis.overstatement)}, which is ${pct(priceEffect)} of unit price ` +
        `at a ${pct(c.weight)} weight.`,
      ask: "the contractual base period, and the movement recalculated from it",
      worthAnnually: annualValueOf(priceEffect),
    }));
  }

  return rows.sort((a, b) => {
    const av = a.worthAnnually ? a.worthAnnually.minor : -1n;
    const bv = b.worthAnnually ? b.worthAnnually.minor : -1n;
    if (av !== bv) return bv > av ? 1 : -1;
    if (a.severity !== b.severity) return a.severity === "material" ? -1 : 1;
    return 0;
  });
}

/* ------------------------------------------------------------ the walk-away */

/**
 * Whether leaving is a real option. Decided by stated rules on stated facts,
 * with the rule returned so it can be argued with.
 */
function assessWalkAway(position, anchors) {
  const { alternatives, qualificationWeeks, noticePeriodWeeks, switchingCost, criticality } = position;
  const unknown = (why) =>
    Object.freeze({ credibility: CREDIBILITY.UNKNOWN, rule: why, breakeven: null });

  if (alternatives == null && qualificationWeeks == null && noticePeriodWeeks == null) {
    return unknown("No sourcing position was supplied, so the credibility of leaving cannot be assessed.");
  }

  let credibility = CREDIBILITY.CREDIBLE;
  let rule = "A qualified alternative exists and can be qualified inside the notice period.";

  if (alternatives != null && alternatives <= 0) {
    credibility = CREDIBILITY.NOT_CREDIBLE;
    rule = "No qualified alternative is recorded. A walk-away threat with nowhere to walk to is not a position.";
  } else if (criticality === "critical" || criticality === "single-source") {
    credibility = CREDIBILITY.NOT_CREDIBLE;
    rule = `The part is recorded as ${criticality}. Leaving is not available at any notice period.`;
  } else if (qualificationWeeks != null && noticePeriodWeeks != null && qualificationWeeks > noticePeriodWeeks) {
    credibility = CREDIBILITY.NOT_CREDIBLE;
    rule =
      `Qualification takes ${qualificationWeeks} weeks and notice is ${noticePeriodWeeks} weeks. ` +
      `The alternative cannot be ready before supply stops, so the threat cannot be executed.`;
  } else if (qualificationWeeks == null || noticePeriodWeeks == null) {
    credibility = CREDIBILITY.UNKNOWN;
    rule = "An alternative exists, but qualification time or notice period is not recorded, so the timing cannot be checked.";
  }

  /* Breakeven: how long conceding the disputed amount takes to fund a switch.
     It assumes an alternative matches today's price — which nobody has verified,
     so it is returned as an assumption rather than a saving. */
  let breakeven = null;
  if (switchingCost && anchors.inDispute.minor > 0n) {
    const years = scaleDiv(switchingCost.minor * SCALE, anchors.inDispute.minor);
    breakeven = Object.freeze({
      switchingCost,
      annualDisputedAmount: anchors.inDispute,
      years,
      yearsApprox: Number(years) / 1e9,
      basis: `${gbp(switchingCost)} of switching cost against ${gbp(anchors.inDispute)} a year in dispute.`,
    });
  }

  return Object.freeze({ credibility, rule, breakeven });
}

/* ------------------------------------------------------------------- public */

/**
 * Prepare a negotiating position from a finished case.
 *
 * @param {object}  input
 * @param {object}  input.bridge     a costBridge result
 * @param {object} [input.ev]        an assessEvidence result; without it the
 *                                   hard line cannot be distinguished from the
 *                                   warranted figure, and this says so
 * @param {object} [input.position]  { criticality, alternatives, switchingCost (Money),
 *                                     qualificationWeeks, noticePeriodWeeks }
 * @param {string} [input.generatedAt]
 */
export function prepareNegotiation({ bridge, ev = null, position = {}, generatedAt = null }) {
  if (!bridge || !bridge.unitPrice) {
    throw new TypeError("prepareNegotiation needs a costBridge result");
  }
  if (position.switchingCost && typeof position.switchingCost.minor !== "bigint") {
    throw new TypeError("position.switchingCost must be Money, not a number — build it with moneyFromDecimal");
  }

  const anchors = anchorsOf(bridge);
  const evidenced = evidencedDriverIds(ev);
  const { challenges, concessions, hardLineChange, unevidencedContribution } =
    buildLadder(bridge, evidenced);
  const rebuttals = buildRebuttals(bridge, ev);
  const walkAway = assessWalkAway(position, anchors);

  const unit = bridge.unitPrice.baseline;
  const vol = BigInt(bridge.annualVolume);
  const lineAtCurrent = moneyTimesQuantity(unit, vol);
  const hardLine = Object.freeze({
    change: hardLineChange,
    /* The unit price at the hard line. Callers that reach for the baseline
       instead are right only when the hard line happens to be zero. */
    unitPrice: moneyApplyChange(unit, hardLineChange),
    annualCost: moneyAdd(lineAtCurrent, moneyScale(lineAtCurrent, hardLineChange)),
    annualDelta: moneyScale(lineAtCurrent, hardLineChange),
    belowWarrantedBy: moneyScale(lineAtCurrent, bridge.warrantedChange - hardLineChange),
    assessed: evidenced !== null,
  });

  /* Deferral is the concession that costs the supplier something and costs you
     nothing in principle, so it is priced alongside the money positions. */
  const deferrals = [1, 3, 6].map((months) => {
    const d = delayEffect(bridge, months, bridge.annualVolume);
    return Object.freeze({
      months,
      firstYearCost: d.firstYearCost,
      firstYearAvoided: d.firstYearAvoided,
    });
  });

  const assumptions = [];
  if (!ev) {
    assumptions.push({
      id: "no-evidence-assessment",
      text: "No evidence assessment was supplied, so every driver is treated as supported and the hard line equals the warranted figure. It is very unlikely that all of them are.",
      label: "assumed",
    });
  }
  if (walkAway.breakeven) {
    assumptions.push({
      id: "switching-breakeven",
      text: "The switching breakeven assumes an alternative supplier would match today's price. Nothing in this case evidences that; treat it as the question to answer, not an answer.",
      label: "assumed",
    });
  }

  return Object.freeze({
    generatedAt,
    currency: unit.currency,
    anchors,
    hardLine,
    ladder: Object.freeze({ challenges, concessions }),
    deferrals: Object.freeze(deferrals),
    rebuttals: Object.freeze(rebuttals),
    walkAway,
    openingPosition: Object.freeze({
      openAt: hardLine.change,
      target: bridge.warrantedChange,
      limit: bridge.warrantedChange,
      /* Printed so it can be disagreed with, in the same way recommend() prints
         its rule. The limit is deliberately the warranted figure: everything
         above it is unevidenced by construction. */
      rule:
        "Open at the hard line — the figure that survives if none of the unevidenced drivers is " +
        "supported. Target the warranted figure, which the arithmetic supports. Treat the warranted " +
        "figure as the limit: the remainder above it is, by construction, the part no evidence " +
        "explains, so conceding any of it is a commercial choice and should be recorded as one.",
    }),
    unevidencedContribution,
    assumptions: Object.freeze(assumptions),
    method:
      "Anchors, ladder and rebuttals are derived from the cost bridge and the evidence assessment " +
      "by exact integer arithmetic. No figure here is produced by a language model, and none is " +
      "an estimate of what another supplier would charge.",
  });
}
