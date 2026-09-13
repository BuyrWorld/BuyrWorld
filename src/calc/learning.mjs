/**
 * Outcome learning.
 *
 * The brief calls this the moat, and it is — but only if it stays honest, and
 * the honest version is narrower than the tempting one.
 *
 * A learning record is derived from what a person recorded: the argument they
 * made, the evidence they asked for, what the supplier did, and whether it
 * moved them. Nothing here is drafted by a model, and nothing is inferred from
 * prose. If it was not recorded, it is not learned.
 *
 * The hard discipline is about money. An outcome has one avoided figure and
 * often several arguments, and there is no way to know which argument earned
 * which part of it. Splitting it evenly would be invention; attributing all of
 * it to each argument would be worse. So a record carries the outcome's figure
 * as CONTEXT, labelled with how many arguments shared it, and never claims an
 * argument delivered it. A reader can see "£42,000 avoided across 3 arguments"
 * and draw their own conclusion. That is the most the data supports.
 *
 * The second discipline is sample size. "Freight challenges succeed 100% of the
 * time" is a dangerous sentence when it rests on one case. Every aggregate here
 * reports its denominator, and a pattern below a stated threshold is explicitly
 * marked as too thin to lean on.
 */

import { money, moneyAdd, scaleDiv, SCALE, ratioToPercentString } from "./exact.mjs";
import { learningRecord } from "../domain/entities.mjs";
import { supplierId as toSupplierId } from "../domain/ids.mjs";

/** Below this many observations, a rate is reported but flagged as thin. */
export const THIN_EVIDENCE_BELOW = 3;

const pct = (r) => ratioToPercentString(r, 2);

/* ---------------------------------------------------------------- derive */

/**
 * Learning records from one recorded outcome.
 *
 * One per argument used. An outcome with no arguments recorded produces none —
 * an empty list, not a placeholder, because a negotiation nobody described
 * teaches nothing.
 */
export function learningFrom(outcome) {
  if (!outcome || !outcome.learning || !Array.isArray(outcome.learning.argumentsUsed)) return Object.freeze([]);

  const args = outcome.learning.argumentsUsed.filter((a) => a && String(a.description ?? a.id ?? "").trim());
  if (!args.length) return Object.freeze([]);

  const caseId = outcome.meta.caseId ?? outcome.meta.caseRef ?? "unattributed";
  const avoided = outcome.computed.avoidedAnnual;

  return Object.freeze(args.map((a) => {
    const record = learningRecord({
      caseId,
      outcomeId: outcome.id,
      supplierId: outcome.meta.supplierId ?? null,
      argument: String(a.description ?? a.id).trim(),
      evidenceRequested: a.evidenceRequested ?? null,
      supplierResponse: a.supplierResponse ?? null,
      buyerAction: a.buyerAction ?? null,
      currency: outcome.position.currency,
      worked: typeof a.worked === "boolean" ? a.worked : null,
      synthetic: outcome.meta.synthetic !== false,
      now: outcome.meta.recordedAt ?? undefined,
    });

    /* The outcome's figure, as context. Deliberately NOT valueMovedMinor:
       that field would assert this argument earned it, and nothing recorded
       here supports that. */
    return Object.freeze({
      ...record,
      outcomeAvoided: avoided,
      sharedWithArguments: args.length,
      verdict: outcome.computed.verdict,
      driverId: a.driverId ?? null,
    });
  }));
}

/** Every learning record derivable from a body of outcomes. */
export function learningCorpus(outcomes) {
  const list = Array.isArray(outcomes) ? outcomes : [];
  const out = [];
  for (const o of list) out.push(...learningFrom(o));
  return Object.freeze(out);
}

/* ------------------------------------------------------------- aggregate */

/** Same argument, normalised, so "Challenged freight" and "challenged  freight" agree. */
const argKey = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * What has actually worked.
 *
 * @param {Array}  records          learningFrom / learningCorpus output
 * @param {object} [opts]
 * @param {string} [opts.supplier]  narrow to one supplier — a name or an id.
 *                                  What moves THIS supplier is a different
 *                                  question from what moves suppliers at large,
 *                                  and conflating them is how a pattern gets
 *                                  applied to a counterparty it was never
 *                                  observed against.
 */
export function whatWorks(records, { supplier = null } = {}) {
  const all = Array.isArray(records) ? records : [];
  const wantId = supplier
    ? (String(supplier).startsWith("sup_") ? String(supplier) : toSupplierId(supplier))
    : null;

  const mine = wantId ? all.filter((r) => r.supplierId === wantId) : all;

  const byArgument = new Map();
  for (const r of mine) {
    const key = argKey(r.argument);
    if (!key) continue;
    const acc = byArgument.get(key) ?? {
      argument: r.argument,
      observed: 0,
      worked: 0,
      didNotWork: 0,
      unknown: 0,
      cases: new Set(),
      evidenceRequested: new Set(),
      currency: r.currency ?? null,
      contextAvoidedMinor: 0n,
      contextOutcomes: new Set(),
    };
    acc.observed++;
    if (r.worked === true) acc.worked++;
    else if (r.worked === false) acc.didNotWork++;
    else acc.unknown++;
    acc.cases.add(r.caseId);
    if (r.evidenceRequested) acc.evidenceRequested.add(r.evidenceRequested);

    /* Outcome money is counted once per outcome, not once per argument, or an
       outcome with four arguments would appear to have avoided four times what
       it did. */
    if (r.outcomeAvoided && !acc.contextOutcomes.has(r.outcomeId)) {
      acc.contextOutcomes.add(r.outcomeId);
      if (acc.currency === r.outcomeAvoided.currency) {
        acc.contextAvoidedMinor += r.outcomeAvoided.minor;
      } else {
        acc.currency = acc.currency ?? r.outcomeAvoided.currency;
      }
    }
    byArgument.set(key, acc);
  }

  const patterns = [...byArgument.values()].map((a) => {
    const decided = a.worked + a.didNotWork;
    const rate = decided > 0 ? scaleDiv(BigInt(a.worked) * SCALE, BigInt(decided)) : null;
    const thin = decided < THIN_EVIDENCE_BELOW;
    return Object.freeze({
      argument: a.argument,
      observed: a.observed,
      worked: a.worked,
      didNotWork: a.didNotWork,
      unknown: a.unknown,
      decided,
      cases: a.cases.size,
      rate,
      // Said plainly, because a 100% rate on one observation reads as a fact.
      thinEvidence: thin,
      statement: rate === null
        ? `${a.argument}: used ${a.observed} time(s), with no recorded result.`
        : `${a.argument}: worked ${a.worked} of ${decided} recorded time(s)` +
          (thin ? ` — too few to lean on.` : ` (${pct(rate)}).`),
      evidenceRequested: Object.freeze([...a.evidenceRequested]),
      // Context only. Not attributed to this argument.
      outcomeContext: a.contextOutcomes.size
        ? Object.freeze({
            outcomes: a.contextOutcomes.size,
            avoided: money(a.contextAvoidedMinor, a.currency ?? "GBP", null),
            note: "Total avoided across the outcomes where this argument was used. It is not what this argument earned — no record attributes money to a single argument.",
          })
        : null,
    });
  });

  patterns.sort((a, b) => {
    if (a.thinEvidence !== b.thinEvidence) return a.thinEvidence ? 1 : -1;  // solid patterns first
    if (b.worked !== a.worked) return b.worked - a.worked;
    return b.observed - a.observed;
  });

  const solid = patterns.filter((p) => !p.thinEvidence);

  return Object.freeze({
    scope: wantId ? "supplier" : "all suppliers",
    supplierId: wantId,
    records: mine.length,
    patterns: Object.freeze(patterns),
    solidPatterns: solid.length,
    headline: !mine.length
      ? "No arguments have been recorded yet. Nothing can be learned from a negotiation nobody described."
      : solid.length
        ? `${solid.length} pattern(s) with ${THIN_EVIDENCE_BELOW} or more recorded results, from ${mine.length} recorded argument(s).`
        : `${mine.length} recorded argument(s), none yet with ${THIN_EVIDENCE_BELOW} recorded results. Treat everything here as anecdote.`,
    method:
      "Derived from arguments a person recorded against completed outcomes. Success is their judgement " +
      "at the time, not a measurement. Money shown beside a pattern is the total avoided across the " +
      "outcomes it appeared in, counted once per outcome, and is never attributed to a single argument.",
  });
}

/* --------------------------------------------------------------- gaps */

/**
 * Arguments used without recording what was asked for or what came back.
 *
 * These are the records that will teach nothing later, and saying so now is
 * more useful than discovering the corpus is hollow in a year.
 */
export function captureGaps(records) {
  const all = Array.isArray(records) ? records : [];
  const missingEvidence = all.filter((r) => !r.evidenceRequested).length;
  const missingResponse = all.filter((r) => !r.supplierResponse).length;
  const missingResult = all.filter((r) => r.worked === null).length;

  return Object.freeze({
    records: all.length,
    missingEvidence,
    missingResponse,
    missingResult,
    complete: all.length - Math.max(missingEvidence, missingResponse, missingResult),
    note: all.length === 0
      ? "Nothing recorded yet."
      : `Of ${all.length} recorded argument(s): ${missingResult} have no result, ` +
        `${missingEvidence} do not say what evidence was requested, and ${missingResponse} do not say ` +
        `what the supplier did. Those three fields are what turns a note into something the next case can use.`,
  });
}
