/**
 * The commercial opportunity radar.
 *
 * Every other module answers a question somebody asked. This one looks across
 * what has accumulated and says what is worth asking about — the first thing
 * here that reads the whole corpus rather than one case.
 *
 * It is also the test of whether any of this was worth building. If a radar
 * over a real body of cases, outcomes, spend and parts has little to say, the
 * data model is not earning its keep, and that is a finding worth having.
 *
 * Four rules shape it.
 *
 * A signal that needs data nobody has recorded does not fire. It is absent, not
 * speculative — a radar that invents findings to look busy is worse than an
 * empty one, because the empty one tells you what to go and record.
 *
 * Value at stake is real money from a real calculation, or it is null. Never an
 * estimate dressed as a figure.
 *
 * Severity is derived from stated thresholds, printed alongside the finding, so
 * the ranking can be argued with rather than taken on trust.
 *
 * And nothing here totals the opportunities. The same money appears in more
 * than one of them by design — a concentrated supplier who also over-asks shows
 * up twice — and adding them would produce exactly the inflated pipeline number
 * this system exists to avoid.
 */

import { SCALE, ONE, money, moneyToDecimalString, ratioToPercentString, scaleDiv } from "./exact.mjs";
import { supplierHistory, historyBySupplier } from "./supplier-history.mjs";
import { portfolio } from "./portfolio.mjs";
import { findComparable, priceGap } from "./comparable.mjs";
import { suggestMerges } from "../domain/registry.mjs";
import { millPerformance, DEFAULT_MINIMUM_LOTS } from "./mill.mjs";
import { normaliseName } from "../domain/ids.mjs";

const pct = (r) => ratioToPercentString(r, 2);

/** Rule-derived, never scored. */
export const SEVERITY = Object.freeze({ HIGH: "high", MEDIUM: "medium", LOW: "low" });

const RANK = { high: 3, medium: 2, low: 1 };

/** The thresholds every severity decision uses, in one place so they are checkable. */
export const THRESHOLDS = Object.freeze({
  concentrationHigh: 1800,          // HHI, the conventional reading
  singleSupplierShare: 300_000_000n, // 30% of spend with one supplier
  tailSuppliers: 10,                 // a tail worth consolidating
  overAskMaterial: 20_000_000n,      // 2.00 percentage points above the evidence
  minimumClaims: 3,                  // below this a pattern is an anecdote

  /* Lots. The conformity thresholds are product rules, exactly as they are in
     mill.mjs, and mean nothing statistically — they are the point at which a
     buyer would want to be asked the question. */
  conformityConcern: 900_000_000n,   // 90% of reviewed lots conforming
  conformityPoor: 800_000_000n,      // 80%
  completenessConcern: 800_000_000n, // 80% of first submissions complete
  unattributedShare: 200_000_000n,   // 20% of lots naming no producer
  pendingLots: 5,                    // decisions outstanding
  minimumLots: DEFAULT_MINIMUM_LOTS, // below this no rate is read at all
});

const finding = (o) => Object.freeze({
  valueAtStake: null,
  evidence: Object.freeze([]),
  missing: Object.freeze([]),
  ...o,
});

/* ---------------------------------------------------------------- signals */

/** Concentration and tail, from a spend analysis. */
function fromSpend(spend) {
  if (!spend || !spend.ok) return [];
  const out = [];

  if (spend.concentration.hhi >= THRESHOLDS.concentrationHigh) {
    out.push(finding({
      id: "concentration",
      kind: "supplier-concentration",
      title: "Spend is concentrated in few suppliers",
      subject: null,
      severity: SEVERITY.HIGH,
      why: `Concentration index ${spend.concentration.hhi}, at or above the ${THRESHOLDS.concentrationHigh} ` +
           `conventionally read as high. ${spend.suppliers[0].name} alone is ${pct(spend.largestSupplierShare)} of analysed spend.`,
      valueAtStake: spend.suppliers[0].value,
      evidence: Object.freeze([`Spend analysis of ${spend.rows} rows`, spend.concentration.method]),
      action: "Check whether the largest lines have a qualified alternative. Concentration is only a risk where there is no fallback.",
      missing: Object.freeze(["Whether an alternative exists for the largest supplier — record one in the claim reviewer."]),
    }));
  }

  const tail = spend.bands.find((b) => b.label.startsWith("Tail"));
  if (tail && tail.count >= THRESHOLDS.tailSuppliers) {
    out.push(finding({
      id: "tail",
      kind: "tail-spend",
      title: `${tail.count} suppliers account for under 1% each`,
      subject: null,
      severity: SEVERITY.LOW,
      why: `${tail.count} suppliers hold ${pct(tail.share)} of spend between them. Each carries the same ` +
           `onboarding, payment and review cost as a large one.`,
      valueAtStake: tail.value,
      evidence: Object.freeze([`Spend analysis of ${spend.rows} rows`]),
      action: "Review the tail for suppliers doing the same thing, then consolidate deliberately rather than by attrition.",
      missing: Object.freeze(["What each tail supplier actually provides. The analysis knows the amounts, not the capability."]),
    }));
  }

  return out;
}

/** Behaviour visible in a supplier's recorded claims. */
function fromHistory(outcomes, suppliers) {
  if (!Array.isArray(outcomes) || !outcomes.length) return [];
  const out = [];

  for (const h of historyBySupplier(outcomes, { suppliers })) {
    if (h.count < THRESHOLDS.minimumClaims) continue;   // an anecdote is not a pattern

    if (h.averages.overAsk !== null && h.averages.overAsk >= THRESHOLDS.overAskMaterial) {
      out.push(finding({
        id: `over-ask-${h.supplierId}`,
        kind: "asks-above-the-evidence",
        title: `${h.supplier} opens above what the evidence supports`,
        subject: h.supplier,
        severity: h.counts.aboveEvidencedPosition > h.count / 2 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
        why: `Across ${h.count} recorded claims they ask ${pct(h.averages.overAsk)} more than the evidence ` +
             `supports on average, and ${h.counts.aboveEvidencedPosition} of ${h.count} settled above the evidenced position.`,
        valueAtStake: h.totals.length === 1 ? h.totals[0].concededAboveWarranted : null,
        evidence: Object.freeze([`${h.count} recorded outcomes`, h.method]),
        action: "Open the next claim at the evidenced figure and hold. The pattern is the argument.",
        missing: h.totals.length > 1
          ? Object.freeze(["Claims span more than one currency, so no single amount is quoted."])
          : Object.freeze([]),
      }));
    }

    for (const d of h.drivers) {
      if (!d.claimedEveryRound || d.everEvidenced) continue;
      out.push(finding({
        id: `repeat-driver-${h.supplierId}-${d.id}`,
        kind: "unevidenced-driver-repeated",
        title: `${h.supplier} claims ${d.label} every time and has never evidenced it`,
        subject: h.supplier,
        severity: SEVERITY.HIGH,
        why: `${d.label} appeared in all ${d.timesClaimed} recorded claims and carried evidence in none of them.`,
        evidence: Object.freeze([`${d.timesClaimed} recorded claims`]),
        action: `Ask for the ${d.label} breakdown before discussing anything else. It has never been produced.`,
        missing: Object.freeze(["What the supplier would say if asked directly. No request has been recorded."]),
      }));
    }
  }
  return out;
}

/** Money sitting in cases nobody has closed. */
function fromPortfolio(outcomes, cases) {
  const p = portfolio({ outcomes, cases });
  const out = [];

  for (const f of p.inFlight) {
    out.push(finding({
      id: `in-flight-${f.currency}`,
      kind: "exposure-in-flight",
      title: "Disputed money sitting in open cases",
      subject: null,
      severity: SEVERITY.HIGH,
      why: `${f.currency} ${moneyToDecimalString(f.unsupported)} across ${f.cases} open case(s) is claimed ` +
           `and not evidenced. None of it is settled either way.`,
      valueAtStake: f.unsupported,
      evidence: Object.freeze([`${f.cases} open case(s) with a calculated exposure`]),
      action: "Close the oldest first. An unsupported claim left open is usually conceded by default.",
      missing: p.openWithoutFigures
        ? Object.freeze([`${p.openWithoutFigures} open case(s) have not been calculated and contribute nothing to this figure.`])
        : Object.freeze([]),
    }));
  }

  if (p.coverage.rate !== null && !p.coverage.complete) {
    out.push(finding({
      id: "coverage",
      kind: "outcomes-not-recorded",
      title: "Most analysed cases have no recorded outcome",
      subject: null,
      severity: SEVERITY.MEDIUM,
      why: `${p.coverage.closed} of ${p.coverage.analysed} analysed cases have an outcome. Everything the ` +
           `radar can say about supplier behaviour rests on the ones that do.`,
      evidence: Object.freeze([`${p.coverage.analysed} analysed cases`]),
      action: "Record what was agreed on the closed ones. It is the only input that compounds.",
      missing: Object.freeze([]),
    }));
  }

  return out;
}

/** Parts priced above something comparable, with the difference unexplained. */
function fromParts(parts) {
  const list = Array.isArray(parts) ? parts.filter((p) => p && p.unitPrice) : [];
  if (list.length < 2) return [];

  const out = [];
  const seen = new Set();

  for (const target of list) {
    const r = findComparable(target, list);
    const best = r.best;
    /* A barely-compared pair is not evidence of anything, so it never raises a
       finding — it only ever produces a suggestion to describe the parts. */
    if (!best || best.thin) continue;

    const g = priceGap(target, best.part);
    if (!g.ok || g.unexplained.minor <= 0n) continue;

    const pairKey = [target.ref, best.b].sort().join("|");
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);

    out.push(finding({
      id: `price-gap-${target.ref}`,
      kind: "comparable-priced-lower",
      title: `${target.ref} costs more than a comparable part`,
      subject: target.ref,
      severity: g.unexplainedAnnual ? SEVERITY.HIGH : SEVERITY.MEDIUM,
      why: `${pct(best.comparability)} of what could be checked matched ${best.b}` +
           (best.differed.length ? `, differing on ${best.differed.map((d) => d.label).join(", ")}. ` : `. `) +
           `${g.currency} ${moneyToDecimalString(g.unexplained)} a unit is not accounted for.`,
      valueAtStake: g.unexplainedAnnual ?? g.unexplained,
      evidence: Object.freeze([best.statement, g.method]),
      action: "Put the difference to the supplier. It is a question, not a finding that the part is mispriced.",
      missing: Object.freeze([
        "What the recorded differences are actually worth. Nothing has been costed, so the whole gap reads as unexplained.",
      ]),
    }));
  }
  return out;
}

/** Two records that may be one company. */
/* ------------------------------------------------------------------ lots ---
   What the reviewed-lot record says, and the one place it meets a claim.

   Every rate here is read from mill.mjs rather than worked out again. That
   module refuses to show a percentage below its evidence threshold, and a
   radar that recomputed the division would quietly undo the refusal — two
   good lots out of two would become a hundred per cent finding. So the rule
   is simple: if mill.mjs withheld the rate, there is nothing here to fire on.
*/
function fromLots(lots, cases) {
  const list = Array.isArray(lots) ? lots.filter(Boolean) : [];
  if (list.length === 0) return [];

  const perf = millPerformance(list, { minimumLots: THRESHOLDS.minimumLots });
  const out = [];

  /* Suppliers with an open claim, by name. Name matching is what there is —
     a certificate names a mill and a letter names a supplier, and nothing
     guarantees they are written the same way. Where it misses, the two
     findings simply stay separate, which is the safe direction to miss in. */
  const claiming = new Map();
  for (const c of Array.isArray(cases) ? cases : []) {
    const name = String(c?.meta?.supplier ?? "").trim();
    if (!name) continue;
    claiming.set(normaliseName(name), c);
  }

  for (const row of perf.rows) {
    const rate = row.conformity;

    /* ---- the join: quality behind a claim ---- */
    const open = claiming.get(normaliseName(row.producer));
    if (open && rate.sufficient && rate.ratio !== null && rate.ratio < THRESHOLDS.conformityConcern) {
      const exposure = open.annualUnsupportedMinor && open.currency
        ? money(BigInt(open.annualUnsupportedMinor), open.currency, null)
        : null;
      out.push(finding({
        id: `quality-behind-claim-${row.producer}`,
        kind: "claiming-while-underperforming",
        title: `${row.producer} is asking for more while ${pct(ONE - rate.ratio)} of reviewed lots did not conform`,
        subject: row.producer,
        severity: SEVERITY.HIGH,
        why: `${rate.numerator} of ${rate.denominator} reviewed lots conformed. There is an open claim from ` +
             `the same name. Quality is not a reason to refuse a justified increase, and it is a reason to ` +
             `ask why the price should rise before the record does.`,
        valueAtStake: exposure,
        evidence: Object.freeze([rate.statement, "Matched to the open claim by supplier name."]),
        action: "Put the two together in the same conversation. They are usually held in separate ones.",
        missing: Object.freeze([
          "Whether the mill on those certificates and the supplier on that letter are the same legal entity. " +
          "This matched them by name.",
        ]),
      }));
    }

    /* ---- the record itself ---- */
    if (rate.sufficient && rate.ratio !== null && rate.ratio < THRESHOLDS.conformityConcern) {
      out.push(finding({
        id: `conformity-${row.producer}`,
        kind: "reviewed-lot-conformity",
        title: `${row.producer}: ${rate.percent} of reviewed lots conformed`,
        subject: row.producer,
        severity: rate.ratio < THRESHOLDS.conformityPoor ? SEVERITY.HIGH : SEVERITY.MEDIUM,
        why: `${rate.statement} Below ${pct(THRESHOLDS.conformityConcern)} is the point this asks the ` +
             `question; it is a product rule and not a statistical one.`,
        evidence: Object.freeze([
          rate.statement,
          row.from ? `Reviewed between ${row.from} and ${row.to}.` : "No review dates recorded.",
        ]),
        action: "Ask what changed. A rate is a record of what happened, not a forecast of the next delivery.",
        missing: Object.freeze([
          ...(row.pending ? [`${row.pending} lot(s) have no decision yet and are in neither figure.`] : []),
          ...(row.partialScopeLots
            ? [`${row.partialScopeLots} lot(s) were compared against only some requirements, so this is not complete lot conformity.`]
            : []),
        ]),
      }));
    }

    /* ---- paperwork, which is a different problem with a different fix ---- */
    const paper = row.firstPassCompleteness;
    if (paper.sufficient && paper.ratio !== null && paper.ratio < THRESHOLDS.completenessConcern) {
      out.push(finding({
        id: `completeness-${row.producer}`,
        kind: "document-completeness",
        title: `${row.producer}: ${paper.percent} of first submissions arrived complete`,
        subject: row.producer,
        severity: SEVERITY.MEDIUM,
        why: `${paper.statement} Chasing paperwork is work somebody does every time, and it is not the ` +
             `same problem as material that does not conform.`,
        evidence: Object.freeze([paper.statement]),
        action: "Send them the list of what a complete submission contains. It is usually never been asked for.",
        missing: Object.freeze([]),
      }));
    }

    /* ---- blame, where the record already answers it ---- */
    if (row.attributedToDistributor > 0) {
      const total = row.nonconformityCategories.reduce((t, c) => t + c.count, 0);
      if (row.attributedToDistributor * 2 >= total) {
        out.push(finding({
          id: `distributor-${row.producer}`,
          kind: "issues-are-the-distributor's",
          title: `Most confirmed issues against ${row.producer} were the distributor's`,
          subject: row.producer,
          severity: SEVERITY.MEDIUM,
          why: `${row.attributedToDistributor} of ${total} confirmed issue(s) were attributed to the ` +
               `distributor rather than the mill. The conversation about them is with a different company.`,
          evidence: Object.freeze([row.attributionNote].filter(Boolean)),
          action: "Take the paperwork problems to whoever is supplying, not to whoever is making.",
          missing: Object.freeze([]),
        }));
      }
    }

    if (row.pending >= THRESHOLDS.pendingLots) {
      out.push(finding({
        id: `pending-${row.producer}`,
        kind: "lots-awaiting-decision",
        title: `${row.pending} lots from ${row.producer} have no decision`,
        subject: row.producer,
        severity: SEVERITY.LOW,
        why: "Every rate above this supplier's name is computed over the lots that were decided. These " +
             "are not counted as good and not counted as bad; they are not counted.",
        evidence: Object.freeze([`${row.lots} lot(s) recorded, ${row.pending} undecided`]),
        action: "Decide them. Until then the record is about less material than you have.",
        missing: Object.freeze([]),
      }));
    }
  }

  /* ---- the finding that tells you what to go and record ---- */
  if (perf.unattributed > 0 && perf.lots > 0) {
    const share = scaleDiv(BigInt(perf.unattributed) * SCALE, BigInt(perf.lots));
    if (share >= THRESHOLDS.unattributedShare) {
      out.push(finding({
        id: "unattributed-lots",
        kind: "producer-not-identified",
        title: `${pct(share)} of lots do not identify the producer`,
        subject: null,
        severity: SEVERITY.MEDIUM,
        why: `${perf.unattributed} of ${perf.lots} lot(s) name no mill, so they belong to nobody's record. ` +
             `No amount of reviewing builds a supplier quality picture out of certificates that do not say ` +
             `who made the material.`,
        evidence: Object.freeze([perf.unattributedNote].filter(Boolean)),
        action: "Ask for certificates that name the producer. It is a purchase-order requirement, not a favour.",
        missing: Object.freeze([]),
      }));
    }
  }

  return out;
}

function fromSuppliers(suppliers) {
  return suggestMerges(suppliers ?? []).map((m) =>
    finding({
      id: `duplicate-${m.a}-${m.b}`,
      kind: "possible-duplicate-supplier",
      title: `${m.names[0]} and ${m.names[1]} may be the same party`,
      subject: m.names[0],
      severity: SEVERITY.MEDIUM,
      why: m.reason,
      evidence: Object.freeze(["Both names reduce to the same key once legal suffixes are removed"]),
      action: "Confirm or dismiss. Merging pools their negotiating history, so it is not done automatically.",
      missing: Object.freeze(["Whether they are one legal entity. Nothing on file answers that."]),
    })
  );
}

/* ------------------------------------------------------------------ scan */

/**
 * Look across everything recorded.
 *
 * @param {object}  input
 * @param {object} [input.spend]      an analyseSpend result
 * @param {Array}  [input.outcomes]
 * @param {Array}  [input.cases]
 * @param {Array}  [input.parts]      comparison-shaped parts
 * @param {Array}  [input.suppliers]  registry records
 */
export function scanOpportunities(input = {}) {
  const found = [
    ...fromSpend(input.spend),
    ...fromHistory(input.outcomes ?? [], input.suppliers ?? null),
    ...fromPortfolio(input.outcomes ?? [], input.cases ?? []),
    ...fromParts(input.parts ?? []),
    ...fromSuppliers(input.suppliers),
    ...fromLots(input.lots ?? [], input.cases ?? []),
  ];

  /* Severity first, then value where it is known. A finding with no figure is
     not buried beneath small ones with figures: not knowing what something is
     worth is not evidence that it is worth little. */
  const opportunities = found.sort((a, b) =>
    (RANK[b.severity] - RANK[a.severity]) ||
    ((b.valueAtStake ? 1 : 0) - (a.valueAtStake ? 1 : 0)) ||
    (a.valueAtStake && b.valueAtStake
      ? (b.valueAtStake.minor > a.valueAtStake.minor ? 1 : b.valueAtStake.minor < a.valueAtStake.minor ? -1 : 0)
      : 0) ||
    String(a.id).localeCompare(String(b.id))
  );

  const sources = {
    spend: Boolean(input.spend?.ok),
    outcomes: (input.outcomes ?? []).length,
    cases: (input.cases ?? []).length,
    parts: (input.parts ?? []).filter((p) => p && p.unitPrice).length,
    suppliers: (input.suppliers ?? []).length,
  };

  /* What the radar cannot look at, so an empty result is legible. */
  const blind = [];
  if (!sources.spend) blind.push("No spend data has been analysed, so concentration and tail are invisible.");
  if (!sources.outcomes) blind.push("No outcomes recorded, so nothing can be said about how any supplier behaves.");
  if (sources.parts < 2) blind.push("Fewer than two priced parts, so nothing can be compared.");
  if (!sources.suppliers) blind.push("No supplier records, so duplicates cannot be spotted.");
  blind.push("Contract dates are not held anywhere, so review windows and expiries are not checked.");

  return Object.freeze({
    opportunities: Object.freeze(opportunities),
    counts: Object.freeze({
      total: opportunities.length,
      high: opportunities.filter((o) => o.severity === SEVERITY.HIGH).length,
      medium: opportunities.filter((o) => o.severity === SEVERITY.MEDIUM).length,
      low: opportunities.filter((o) => o.severity === SEVERITY.LOW).length,
    }),
    sources: Object.freeze(sources),
    blindSpots: Object.freeze(blind),
    headline: opportunities.length
      ? `${opportunities.length} thing(s) worth asking about, ${opportunities.filter((o) => o.severity === SEVERITY.HIGH).length} of them pressing.`
      : "Nothing to raise. That may mean there is nothing, or that there is nothing recorded to look at — the blind spots below say which.",
    method:
      "Every finding comes from a calculation over recorded data, and states the rule that produced it. " +
      "A signal needing data nobody recorded does not fire rather than being guessed at. Amounts are not " +
      "totalled: the same money appears in more than one finding by design, and adding them would produce " +
      "a pipeline figure that means nothing.",
  });
}
