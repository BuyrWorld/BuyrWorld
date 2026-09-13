/**
 * Outcome capture.
 *
 * What was asked, what the evidence supported, what was actually agreed, and
 * what that teaches the next case.
 *
 * This is the part that compounds. A front end can be copied in a weekend; a
 * body of outcomes labelled with which argument worked against which supplier
 * position cannot be derived by reading anything. It is also the only part of
 * the loop that can tell you whether the analysis was any good — an engine that
 * is never checked against what happened is just a confident opinion.
 *
 * The arithmetic here is computed, never typed. A buyer entering their own
 * "saving achieved" is how savings numbers stop meaning anything.
 */

import { ONE, scaleDiv, moneyScale, moneyTimesQuantity, moneyToDecimalString } from "./exact.mjs";
import { formatPercent } from "./cost-bridge.mjs";
import { periodsBetween } from "./index-series.mjs";
import { EVIDENCE_KIND } from "./evidence.mjs";
import { supplierId, entityId, KIND } from "../domain/ids.mjs";

/**
 * Whether a driver carried evidence, decided the same way assessEvidence
 * decides it: a movement is evidenced by an explicit item or by the lineage of
 * a published series; a weight is evidenced only by an explicit item, because
 * a share of unit cost is an assumption until the supplier opens its book.
 */
function driverEvidenced(c) {
  const real = (e) => Boolean(e) && e.kind !== EVIDENCE_KIND.NONE;
  const movement = c.evidence?.movement ? real(c.evidence.movement) : Boolean(c.lineage);
  const weight = real(c.evidence?.weight);
  return { weight, movement, both: weight && movement };
}

/** How the agreed position compares with what the evidence supported. */
export const VERDICT = Object.freeze({
  BETTER: "better-than-the-evidence-supported",
  AT: "at-the-evidenced-position",
  WORSE: "above-the-evidenced-position",
  CONCEDED_UNSUPPORTED: "conceded-the-unsupported-amount-in-full",
});

/**
 * @param {object} input
 * @param {object} input.bridge             the analysis this outcome resolves
 * @param {bigint} input.agreedChange       what was actually agreed, as a Ratio
 * @param {string} [input.requestedEffectiveFrom]  YYYY-MM the supplier wanted
 * @param {string} [input.agreedEffectiveFrom]     YYYY-MM actually agreed
 * @param {string[]} [input.nonPriceConcessions]
 * @param {string[]} [input.supplierCommitments]
 * @param {Array}  [input.argumentsUsed]    [{ id, description, worked }]
 * @param {object} [input.decision]         { by, at, note }
 * @param {string} [input.reviewDate]
 * @param {string} [input.lessons]
 * @param {object} [input.meta]             { caseRef, supplier, category }
 */
export function recordOutcome(input) {
  const {
    bridge, agreedChange,
    requestedEffectiveFrom = null, agreedEffectiveFrom = null,
    nonPriceConcessions = [], supplierCommitments = [],
    argumentsUsed = [], decision = {}, reviewDate = null, lessons = "",
    meta = {},
  } = input;

  if (!bridge || !bridge.contributions) throw new TypeError("An outcome must resolve a costBridge result");
  if (typeof agreedChange !== "bigint") {
    throw new TypeError("agreedChange must be a Ratio (BigInt). A typed percentage is not a figure.");
  }
  if (agreedChange > bridge.requestedChange) {
    throw new RangeError(
      `Agreed ${formatPercent(agreedChange)} exceeds the ${formatPercent(bridge.requestedChange)} requested. ` +
      `Check the figure — a buyer does not agree more than was asked for.`
    );
  }

  const unit = bridge.unitPrice.baseline;
  const vol = BigInt(bridge.annualVolume);
  const line = moneyTimesQuantity(unit, vol);
  const cur = unit.currency;

  /* ------------------------------------------------------ the arithmetic */
  const avoidedChange = bridge.requestedChange - agreedChange;
  const acceptedChange = agreedChange;
  const versusWarranted = agreedChange - bridge.warrantedChange;

  const avoidedAnnual = moneyScale(line, avoidedChange);
  const acceptedAnnual = moneyScale(line, acceptedChange);

  // Delay is worth the accepted increase, pro rata, for the months it was pushed.
  let delayMonths = 0;
  let delayValue = moneyScale(line, 0n);
  if (requestedEffectiveFrom && agreedEffectiveFrom) {
    delayMonths = periodsBetween(requestedEffectiveFrom, agreedEffectiveFrom);
    if (delayMonths < 0) {
      throw new RangeError(
        `The agreed effective date ${agreedEffectiveFrom} is earlier than the requested ${requestedEffectiveFrom}.`
      );
    }
    if (delayMonths > 0) {
      const proRata = scaleDiv(BigInt(delayMonths) * ONE, 12n);
      delayValue = moneyScale(moneyScale(line, acceptedChange), proRata);
    }
  }

  const verdict =
    agreedChange < bridge.warrantedChange ? VERDICT.BETTER
    : agreedChange === bridge.warrantedChange ? VERDICT.AT
    : agreedChange === bridge.requestedChange ? VERDICT.CONCEDED_UNSUPPORTED
    : VERDICT.WORSE;

  /* ------------------------------------------------------ what it teaches */
  const worked = argumentsUsed.filter((a) => a.worked === true).map((a) => a.id);
  const didNot = argumentsUsed.filter((a) => a.worked === false).map((a) => a.id);

  /* An identity, so a learning record has something to point at. Deterministic
     from what makes this outcome distinct — the case it resolves, when it was
     recorded, and what was agreed — so re-recording the same settlement does
     not produce a second one. */
  const sid = meta.supplierId ?? (meta.supplier ? supplierId(meta.supplier) : null);
  const outcomeId = meta.outcomeId ?? entityId(
    KIND.OUTCOME,
    [meta.caseId ?? meta.caseRef ?? sid ?? "unattributed", meta.recordedAt ?? "", agreedChange.toString()].join("|")
  );

  return Object.freeze({
    id: outcomeId,
    meta: Object.freeze({
      caseRef: meta.caseRef ?? null,
      /* The name as it was written, kept verbatim — it is what the document
         said, and rewriting it would lose evidence. The id beside it is what
         the system matches on, so a later rename or a full stop cannot detach
         this outcome from the supplier's history. Derived from the name when
         not supplied, which is why records written before this existed need no
         migration: the same name has always produced the same id. */
      supplier: meta.supplier ?? null,
      supplierId: sid,
      caseId: meta.caseId ?? null,
      category: meta.category ?? null,
      synthetic: meta.synthetic !== false,
      recordedAt: meta.recordedAt ?? null,
    }),

    position: Object.freeze({
      requested: bridge.requestedChange,
      warranted: bridge.warrantedChange,
      agreed: agreedChange,
      currency: cur,
      annualLineValue: line,
    }),

    /* What they claimed, kept so a later case can see the pattern. Without
       this, a supplier that claims freight every year and has evidenced it
       once looks identical to one claiming it for the first time. */
    claim: Object.freeze({
      drivers: Object.freeze(bridge.contributions.map((c) => {
        const ev = driverEvidenced(c);
        return Object.freeze({
          id: c.id,
          label: c.label,
          weight: c.weight,
          contribution: c.contribution,
          evidenced: ev.both,
          weightEvidenced: ev.weight,
          movementEvidenced: ev.movement,
        });
      })),
      unexplainedWeight: bridge.unexplainedWeight,
    }),

    computed: Object.freeze({
      avoidedChange,
      avoidedAnnual,
      acceptedChange,
      acceptedAnnual,
      versusWarranted,
      verdict,
      delayMonths,
      delayValue,
      // Everything the buyer kept, in one figure.
      totalAvoidedFirstYear: moneyScale(line, avoidedChange + scaleDiv(BigInt(delayMonths) * acceptedChange, 12n)),
    }),

    timing: Object.freeze({
      requestedEffectiveFrom,
      agreedEffectiveFrom,
      reviewDate,
    }),

    concessions: Object.freeze({
      fromSupplier: Object.freeze([...nonPriceConcessions]),
      commitments: Object.freeze([...supplierCommitments]),
    }),

    decision: Object.freeze({
      by: decision.by ?? null,
      at: decision.at ?? null,
      note: decision.note ?? null,
      recorded: Boolean(decision.by),
    }),

    learning: Object.freeze({
      argumentsUsed: Object.freeze(argumentsUsed.map((a) => Object.freeze({ ...a }))),
      worked: Object.freeze(worked),
      didNotWork: Object.freeze(didNot),
      lessons: lessons || null,
      // A one-line summary for the corpus.
      headline:
        `${formatPercent(bridge.requestedChange)} requested, ${formatPercent(bridge.warrantedChange)} evidenced, ` +
        `${formatPercent(agreedChange)} agreed. ${cur} ${moneyToDecimalString(avoidedAnnual)} avoided` +
        (delayMonths ? `, plus ${delayMonths} month(s) of delay worth ${cur} ${moneyToDecimalString(delayValue)}` : "") +
        `.`,
    }),
  });
}

/**
 * Aggregate a body of outcomes.
 *
 * This is the asset. Not the average — the pattern: which arguments actually
 * move a supplier, and how often the evidenced position is where things land.
 */
export function summariseOutcomes(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return Object.freeze({
      count: 0,
      note: "No outcomes recorded yet. The analysis cannot be checked against reality until it is.",
    });
  }

  const byCurrency = new Map();
  const argStats = new Map();
  const verdicts = { [VERDICT.BETTER]: 0, [VERDICT.AT]: 0, [VERDICT.WORSE]: 0, [VERDICT.CONCEDED_UNSUPPORTED]: 0 };
  let avoidedRatioTotal = 0n;
  let delayMonthsTotal = 0;

  for (const r of records) {
    const cur = r.position.currency;
    const acc = byCurrency.get(cur) ?? { avoided: 0n, accepted: 0n, delay: 0n, n: 0 };
    acc.avoided += r.computed.avoidedAnnual.minor;
    acc.accepted += r.computed.acceptedAnnual.minor;
    acc.delay += r.computed.delayValue.minor;
    acc.n++;
    byCurrency.set(cur, acc);

    verdicts[r.computed.verdict] = (verdicts[r.computed.verdict] ?? 0) + 1;
    avoidedRatioTotal += r.computed.avoidedChange;
    delayMonthsTotal += r.computed.delayMonths;

    for (const a of r.learning.argumentsUsed) {
      const st = argStats.get(a.id) ?? { id: a.id, description: a.description ?? a.id, used: 0, worked: 0 };
      st.used++;
      if (a.worked === true) st.worked++;
      argStats.set(a.id, st);
    }
  }

  const args = [...argStats.values()]
    .map((a) => ({ ...a, successRate: a.used ? Math.round((a.worked / a.used) * 100) : 0 }))
    .sort((a, b) => b.successRate - a.successRate || b.used - a.used);

  return Object.freeze({
    count: records.length,
    byCurrency: Object.freeze(
      [...byCurrency.entries()].map(([currency, a]) =>
        Object.freeze({
          currency,
          cases: a.n,
          avoidedAnnual: { minor: a.avoided, currency, asOf: null },
          acceptedAnnual: { minor: a.accepted, currency, asOf: null },
          delayValue: { minor: a.delay, currency, asOf: null },
        })
      )
    ),
    meanAvoidedChange: scaleDiv(avoidedRatioTotal, BigInt(records.length)),
    delayMonthsTotal,
    verdicts: Object.freeze(verdicts),
    // Ranked by how often they actually moved a supplier, not by how good they sound.
    arguments: Object.freeze(args),
    method:
      "Aggregated from recorded outcomes only. Success rate is the share of times an argument " +
      "was used and the outcome was marked as moved by it — a buyer's judgement, not a measurement.",
  });
}
