/**
 * A supplier's price increase, said as a case.
 *
 * The first workflow of the five `specs/05` names — *"understand a quote"* —
 * and the one this product already has an engine for. `cost-bridge.mjs`
 * decomposes a claimed increase into the part the drivers warrant and the
 * part nothing supports. What was missing is anything that turns that into
 * the five sections a person reads.
 *
 * So this arranges; it does not calculate. Every figure it carries came out
 * of the bridge, in the bridge's own exact types, and nothing here adds,
 * scales or rounds one. That is the same rule the rest of the repository
 * follows from the other side: the engine works out the numbers and this
 * decides which of them somebody is shown and when.
 *
 * "When" is the whole of it. `specs/05`: *"Show a numerical impact only after
 * relevant inputs are confirmed."* The bridge already refuses to let an
 * `ai-inferred` value into arithmetic. This is the softer neighbouring case —
 * a figure that is arithmetically sound and rests on a share of unit cost
 * somebody assumed rather than sourced. That figure is real, and showing it
 * as though it were settled is how an assumption becomes a negotiating
 * position. So a claim carrying it names those assumptions as its needs, and
 * `narrative.mjs` withholds the figure until they are confirmed.
 */

import { claim, evidenceOf, SECTION, WEIGHT } from "./narrative.mjs";
import { assumptionsToVerify } from "../calc/provenance.mjs";
import { moneyToDecimalString, ratioToPercentString } from "../calc/exact.mjs";

/** A money figure, carried exactly and formatted by whatever shows it. */
const moneyFigure = (m, what) => Object.freeze({
  kind: "money",
  minor: m.minor,
  currency: m.currency,
  amount: moneyToDecimalString(m),
  what,
});

/** A percentage, as the bridge holds it. */
const percentFigure = (ratio, what) => Object.freeze({
  kind: "percent",
  ratio,
  amount: ratioToPercentString(ratio),
  what,
});

/**
 * What a figure in this case waits on.
 *
 * Every assumption the provenance layer found, named by the thing it is an
 * assumption about. A figure resting on three assumed shares waits on all
 * three: partial confirmation is not confirmation, and showing the figure
 * once two of the three are settled would be the most tempting version of
 * exactly the mistake this prevents.
 */
export function needsOf(bridge, evidence = null) {
  return Object.freeze(assumptionsToVerify(bridge, evidence).map((a) => a.id));
}

/** Those assumptions as something a person can be shown and act on. */
export function assumptionClaims(bridge, evidence = null) {
  return assumptionsToVerify(bridge, evidence).map((a) => claim({
    id: a.id,
    section: SECTION.EVIDENCE,
    said: `${a.figure} rests on an assumption: ${a.assumption}.`,
    weight: WEIGHT.NORMAL,
    evidence: [evidenceOf({ kind: "assumption", said: a.assumption })],
  }));
}

/**
 * The case, as claims.
 *
 * `labels` supplies the words for anything this cannot name itself — a
 * driver's label comes from the case, not from here.
 */
export function quoteCase(bridge, { evidence = null, supplier = null } = {}) {
  if (!bridge) throw new TypeError("There is no cost bridge to describe.");

  const who = supplier ? `${supplier} has` : "The supplier has";
  const needs = needsOf(bridge, evidence);
  const out = [];

  /* ---- what happened ---- */

  out.push(claim({
    id: "requested",
    section: SECTION.HAPPENED,
    said: `${who} asked for an increase.`,
    figure: percentFigure(bridge.requestedChange, "the increase asked for"),
    /* Even the request waits: it is stated as a share of a unit price, and a
       unit price built on an assumed composition is not a settled base. */
    needs,
  }));

  out.push(claim({
    id: "warranted",
    section: SECTION.HAPPENED,
    said: "The drivers given account for part of it.",
    figure: percentFigure(bridge.warrantedChange, "what the drivers warrant"),
    needs,
  }));

  if (bridge.constraintApplied) {
    out.push(claim({
      id: "constraint",
      section: SECTION.HAPPENED,
      said: `A contractual ${bridge.constraintApplied} applied, so what the drivers `
          + "warranted and what the contract permits are not the same figure.",
      weight: WEIGHT.DETAIL,
    }));
  }

  /* ---- why it matters ---- */

  out.push(claim({
    id: "annual",
    section: SECTION.MATTERS,
    said: "Accepting the request in full costs this much a year at the current volume.",
    figure: moneyFigure(bridge.annual.requested, "the annual cost of the request"),
    needs,
  }));

  out.push(claim({
    id: "unsupported",
    section: SECTION.MATTERS,
    said: "Part of the request is not supported by any driver given.",
    figure: percentFigure(bridge.unsupportedChange, "the unsupported part"),
    needs,
    /* An unsupported share is the thing a buyer is in the conversation for.
       No depth setting may hide it. */
    weight: WEIGHT.MATERIAL,
  }));

  if (bridge.unexplainedWeight > 0n) {
    out.push(claim({
      id: "unexplained-weight",
      section: SECTION.MATTERS,
      said: "Some of the unit cost is not attributed to any driver at all, so no movement "
          + "has been claimed against it and none has been ruled out either.",
      figure: percentFigure(bridge.unexplainedWeight, "the share of cost nobody has accounted for"),
      needs,
      weight: WEIGHT.MATERIAL,
    }));
  }

  /* ---- your options ---- */

  out.push(claim({
    id: "option-warranted",
    section: SECTION.OPTIONS,
    said: "Concede what the drivers warrant and nothing beyond it.",
    figure: moneyFigure(bridge.annual.warranted, "the annual cost of conceding the warranted part"),
    needs,
  }));

  out.push(claim({
    id: "option-question",
    section: SECTION.OPTIONS,
    said: "Ask for the evidence behind the part no driver supports before conceding any of it.",
  }));

  if (bridge.unexplainedWeight > 0n) {
    out.push(claim({
      id: "option-composition",
      section: SECTION.OPTIONS,
      said: "Ask what the unattributed share of the unit cost is made of. A share nobody has "
          + "named cannot be argued about.",
    }));
  }

  /* ---- the next step ---- */

  out.push(needs.length > 0
    ? claim({
        id: "next-confirm",
        section: SECTION.NEXT,
        said: "Confirm the assumed shares of unit cost before taking any figure here into a "
            + "conversation. Until then they are this tool's arithmetic on somebody's estimate.",
        weight: WEIGHT.MATERIAL,
      })
    : claim({
        id: "next-ask",
        section: SECTION.NEXT,
        said: "Put the unsupported part of the request to the supplier in writing, and ask what "
            + "evidence stands behind it.",
        weight: WEIGHT.MATERIAL,
      }));

  /* ---- evidence and what is missing ---- */

  out.push(claim({
    id: "how",
    section: SECTION.EVIDENCE,
    said: `Worked out as ${bridge.formula}. Every figure here came from that, not from a model.`,
    weight: WEIGHT.DETAIL,
    evidence: [evidenceOf({ kind: "method", said: bridge.formula })],
  }));

  for (const c of bridge.contributions ?? []) {
    out.push(claim({
      id: `driver-${c.id}`,
      section: SECTION.EVIDENCE,
      said: `${c.label} was given as a driver.`,
      weight: WEIGHT.DETAIL,
      evidence: [evidenceOf({ kind: "driver", said: c.label, field: c.id })],
    }));
  }

  out.push(...assumptionClaims(bridge, evidence));

  return Object.freeze(out);
}
