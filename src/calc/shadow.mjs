/**
 * The shadow negotiator.
 *
 * During the conversation, what is the best thing to do next?
 *
 * The brief is explicit that this is not autonomy, and the restraint is the
 * point: the person runs the meeting, this sits beside them. It recommends a
 * move, says which rule produced it, and records what was actually done — so
 * there is learning data long before anyone considers letting software talk to
 * a supplier.
 *
 * No model is involved. Every recommendation is derived from the case already
 * on file: the evidence gaps, the hard line, the supplier's recorded history,
 * and whether walking away is real. A model asked "what should I say next" will
 * always produce something fluent, and fluency is precisely the wrong quality
 * here — a buyer needs to know that a move is worth £42,000 and why, not that
 * it sounds firm.
 *
 * One ordering rule does most of the work, and it is the thing buyers most
 * often get backwards:
 *
 *     You do not concede before you have asked.
 *
 * A concession offered while an evidence request is still outstanding pays for
 * something that was never established. So requests come first, then challenges
 * on what was refused, then — and only then — the priced concessions. The
 * engine will not put a concession above an unspent request, whatever the
 * pressure in the room.
 */

import { SCALE, money, moneyToDecimalString, ratioToPercentString } from "./exact.mjs";

const pct = (r) => ratioToPercentString(r, 2);

/** What kind of move this is. */
export const MOVE = Object.freeze({
  ASK: "ask",              // request evidence that has not been produced
  CHALLENGE: "challenge",  // press a driver that cannot be supported
  SHOW: "show",            // put a pattern from their own history to them
  HOLD: "hold",            // stay where you are; nothing obliges you to move
  CONCEDE: "concede",      // a priced step, only once the asks are spent
  DEFER: "defer",          // trade timing instead of money
  WALK: "walk",            // only where leaving is genuinely credible
});

/** Where the live offer sits against the plan. */
function positionOf(negotiation, live) {
  const offer = typeof live.supplierOffer === "bigint" ? live.supplierOffer : null;
  const { openAt, target, limit } = negotiation.openingPosition;

  if (offer === null) {
    return Object.freeze({
      offer: null,
      statement: "No offer on the table yet. Open at the hard line.",
      withinPlan: null,
    });
  }

  const withinPlan = offer <= limit;
  const overLimit = offer > limit ? offer - limit : 0n;

  return Object.freeze({
    offer,
    versusOpen: offer - openAt,
    versusTarget: offer - target,
    versusLimit: overLimit,
    withinPlan,
    statement: withinPlan
      ? `Their ${pct(offer)} is at or below the evidenced figure of ${pct(limit)}. There is nothing left to argue for.`
      : `Their ${pct(offer)} is ${pct(overLimit)} above the evidenced figure. That part is unsupported by anything on file.`,
  });
}

/* --------------------------------------------------------------- moves */

/**
 * What to do next.
 *
 * @param {object}  input
 * @param {object}  input.bridge
 * @param {object}  input.negotiation   a prepareNegotiation result
 * @param {object} [input.batna]        an assessBatna result
 * @param {object} [input.history]      a supplierHistory result
 * @param {object} [input.live]         { supplierOffer: Ratio, round, asked: [], shown: [] }
 */
export function nextMoves({ bridge, negotiation, batna = null, history = null, live = {} } = {}) {
  if (!negotiation || !negotiation.ladder) {
    throw new TypeError("The shadow negotiator needs a prepareNegotiation result");
  }

  const asked = new Set(live.asked ?? []);
  const shown = new Set(live.shown ?? []);
  const cur = negotiation.currency;
  const position = positionOf(negotiation, live);
  const moves = [];

  /* 1. Requests. Anything the file says has not been evidenced and has not yet
        been asked for. These outrank everything, because every later move is
        cheaper once the answer exists — or once it is refused. */
  for (const r of negotiation.rebuttals) {
    if (asked.has(r.id)) continue;
    moves.push(Object.freeze({
      id: r.id,
      kind: MOVE.ASK,
      headline: `Ask for ${r.ask}`,
      why: r.theirPoint,
      worth: r.worthAnnually,
      rule: "An evidence gap that has not been put to them. Asking costs nothing and settles what follows.",
    }));
  }

  /* 2. Challenges on what was asked for and not produced. A challenge before
        the request is an assertion; after a refusal it is a finding. */
  for (const c of negotiation.ladder.challenges) {
    const requested = [...asked].some((a) => String(a).includes(c.driverId));
    if (!requested) continue;
    moves.push(Object.freeze({
      id: c.id,
      kind: MOVE.CHALLENGE,
      headline: `Press ${c.label} — it was asked for and not evidenced`,
      why: c.why,
      worth: c.worthAnnually,
      rule: "The evidence was requested and has not been produced. The contribution comes out.",
    }));
  }

  /* 3. Their own record, where it is a pattern rather than an anecdote. */
  if (history && history.count >= 3) {
    for (const d of history.drivers) {
      if (!d.claimedEveryRound || d.everEvidenced || shown.has(`history-${d.id}`)) continue;
      moves.push(Object.freeze({
        id: `history-${d.id}`,
        kind: MOVE.SHOW,
        headline: `Put it to them that ${d.label} has been claimed ${d.timesClaimed} times and never evidenced`,
        why: `Across ${history.count} recorded claims, ${d.label} appeared every time and carried evidence in none.`,
        worth: null,
        rule: "A pattern in their own recorded behaviour, with the count stated.",
      }));
    }
  }

  /* 4. Hold, where the offer is already at or inside the evidenced figure. */
  if (position.offer !== null && position.withinPlan) {
    moves.push(Object.freeze({
      id: "hold",
      kind: MOVE.HOLD,
      headline: "Accept, or hold — their offer is within the evidenced position",
      why: position.statement,
      worth: null,
      rule: "Nothing above the evidenced figure is on the table, so there is nothing left to resist.",
    }));
  }

  /* 5. Deferral before money. It costs the supplier something and costs the
        buyer nothing in principle. */
  const defer = negotiation.deferrals.find((d) => d.months === 3);
  if (defer && !shown.has("defer")) {
    moves.push(Object.freeze({
      id: "defer",
      kind: MOVE.DEFER,
      headline: `Offer a three-month deferral instead of money`,
      why: `Deferring three months avoids ${cur} ${moneyToDecimalString(defer.firstYearAvoided)} in the first year.`,
      worth: defer.firstYearAvoided,
      rule: "Timing is a concession that does not move the price.",
    }));
  }

  /* 6. Priced concessions. Last, and only what the ladder already priced. */
  for (const c of negotiation.ladder.concessions) {
    if (c.evidenced) continue;                 // holding is not a concession
    if (c.shareOfRemainder > 50n) continue;    // the engine does not recommend giving most of it away
    moves.push(Object.freeze({
      id: c.id,
      kind: MOVE.CONCEDE,
      headline: `${c.note.split(".")[0]} — ${cur} ${moneyToDecimalString(c.costOfThisStep)} a year`,
      why: "Above the evidenced figure by construction. This is a commercial choice, not a finding.",
      worth: c.costOfThisStep,
      rule: "Offered only once the requests are spent, because a concession before a request pays for nothing.",
    }));
  }

  /* 7. Walking away, only where it is genuinely available. */
  if (batna && (batna.strength === "strong" || batna.strength === "moderate")) {
    moves.push(Object.freeze({
      id: "walk",
      kind: MOVE.WALK,
      headline: "Say plainly that there is an alternative",
      why: batna.rule,
      worth: null,
      rule: "An assessed alternative that could be in place inside the notice period.",
    }));
  }

  /* ------------------------------------------------------------ ordering */
  const RANK = {
    [MOVE.ASK]: 6, [MOVE.CHALLENGE]: 5, [MOVE.SHOW]: 4,
    [MOVE.WALK]: 3, [MOVE.DEFER]: 2, [MOVE.HOLD]: 1, [MOVE.CONCEDE]: 0,
  };
  const ordered = moves.sort((a, b) =>
    (RANK[b.kind] - RANK[a.kind]) ||
    ((b.worth ? b.worth.minor : -1n) > (a.worth ? a.worth.minor : -1n) ? 1 : -1)
  );

  const unspentAsks = ordered.filter((m) => m.kind === MOVE.ASK).length;

  /* ------------------------------------------------ what not to concede */
  const doNotConcede = [];
  if (negotiation.hardLine.assessed && negotiation.hardLine.change < negotiation.openingPosition.target) {
    doNotConcede.push(
      `Anything above ${pct(negotiation.hardLine.change)} rests on drivers that carry no evidence. ` +
      `${cur} ${moneyToDecimalString(negotiation.hardLine.belowWarrantedBy)} a year sits between the hard line and the evidenced figure.`
    );
  }
  doNotConcede.push(
    `Anything above ${pct(negotiation.openingPosition.limit)} is unsupported by construction: it is the part no evidence explains.`
  );
  if (unspentAsks) {
    doNotConcede.push(
      `Do not concede while ${unspentAsks} evidence request(s) are outstanding. Paying before asking settles nothing.`
    );
  }

  /* ------------------------------------------------- risk if accepted now */
  let riskIfAccepted = null;
  if (position.offer !== null && position.versusLimit > 0n) {
    const line = negotiation.anchors.current.annualCost;
    riskIfAccepted = Object.freeze({
      unsupportedChange: position.versusLimit,
      annual: money(
        (line.minor * position.versusLimit) / SCALE,
        cur, null
      ),
      statement:
        `Accepting ${pct(position.offer)} concedes ${pct(position.versusLimit)} that nothing on file supports.`,
    });
  }

  return Object.freeze({
    position,
    moves: Object.freeze(ordered),
    best: ordered[0] ?? null,
    unspentAsks,
    doNotConcede: Object.freeze(doNotConcede),
    riskIfAccepted,
    round: Number.isInteger(live.round) ? live.round : null,
    method:
      "Every move is derived from the case on file — the evidence gaps, the hard line, the supplier's " +
      "recorded history and whether leaving is credible. No language model is involved, and none of this " +
      "is a script: it is what the file supports, in the order that does not pay for something before " +
      "asking whether it is owed.",
  });
}

/* ------------------------------------------------------------- learning */

/**
 * What actually happened, against what was recommended.
 *
 * This is the half that makes the shadow worth running. A recommendation
 * nobody records the outcome of teaches nothing, and the interesting cases are
 * the ones where the buyer ignored it and was right.
 *
 * Deliberately thin: it produces the `argumentsUsed` shape the outcome capture
 * already understands, rather than a parallel learning system of its own.
 */
export function recordRound({ recommended = null, taken = null, supplierResponse = null, moved = null } = {}) {
  const followed = recommended && taken ? recommended.id === taken.id : null;

  return Object.freeze({
    recommendedId: recommended?.id ?? null,
    recommendedKind: recommended?.kind ?? null,
    takenId: taken?.id ?? null,
    takenKind: taken?.kind ?? null,
    followed,
    supplierResponse: supplierResponse ? String(supplierResponse) : null,
    /* Whether the supplier moved is an observation, not an inference. */
    moved: typeof moved === "boolean" ? moved : null,
    /* The shape recordOutcome already takes, so one capture serves both. */
    asArgument: taken
      ? Object.freeze({
          id: taken.id,
          description: taken.headline,
          evidenceRequested: taken.kind === MOVE.ASK ? taken.headline.replace(/^Ask for /, "") : null,
          supplierResponse: supplierResponse ? String(supplierResponse) : null,
          worked: typeof moved === "boolean" ? moved : null,
        })
      : null,
    note:
      followed === false
        ? "The recommendation was not followed. That is worth keeping: the cases where a buyer overrode it and was right are the ones that improve it."
        : null,
  });
}
