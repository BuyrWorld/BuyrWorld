/**
 * Mill performance.
 *
 * A private record of how material from a producer has actually reviewed out,
 * built from lots somebody reached a decision about. Not a score, not a
 * ranking anybody else can see, and not a prediction.
 *
 * The temptation this module exists to resist is a single number per mill.
 * One number is what everybody asks for and it cannot be made honest: it hides
 * the sample size, it pools different grades and different specifications as
 * though they were the same requirement, it treats a distributor's clerical
 * error as a mill's metallurgy, and it invites a ranking where a mill with two
 * good lots sits above one with two hundred. So there is no composite score
 * here, and the default view is an evidence table rather than a league.
 *
 * Six rules carry that.
 *
 * 1. Two over two is not two hundred over two hundred. Both are 100%, and
 *    they are not the same statement. Every rate is returned with its
 *    numerator, its denominator and its date range, and a rate is never
 *    returned as a bare number.
 *
 * 2. Below the evidence threshold, no percentage is shown at all. Not a
 *    percentage with an asterisk — none. A figure on a page gets read and
 *    remembered whatever is printed beside it.
 *
 * 3. One lot is one lot. The identity is the producer, the heat and the lot,
 *    so re-uploading a certificate or issuing a revision of it does not create
 *    a second conforming lot. A certificate covering several lots has to say
 *    which ones; nothing is multiplied out by guessing.
 *
 * 4. Attribution is kept, including when it is unknown. Producer, site and
 *    distributor are separate, a lot whose producer the certificate never
 *    named is attributed to nobody, and responsibility for a nonconformity is
 *    recorded beside the rate rather than silently adjusting it.
 *
 * 5. The metrics do not merge. Whether a lot conformed and whether its
 *    paperwork arrived complete the first time are different questions about
 *    different things, and averaging them produces a number about neither.
 *
 * 6. A comparison only means something inside a cohort. Two mills judged
 *    against different specifications, grades or product forms have not been
 *    judged against the same requirements, and putting them in one column is
 *    a category error however tidy it looks.
 *
 * None of this is a probability. A conformity rate is a record of what
 * happened to the lots that were reviewed; it is not the chance that the next
 * delivery conforms, and this module will not describe it as one.
 */

import { SCALE, scaleDiv, ratioToPercentString } from "./exact.mjs";

/** How a lot's review ended. */
export const DECISION = Object.freeze({
  CONFORMING: "conforming",
  NONCONFORMING: "nonconforming",
  PENDING: "pending",
});

/** Who a confirmed nonconformity was attributed to. Unknown stays unknown. */
export const RESPONSIBILITY = Object.freeze({
  PRODUCER: "producer",
  DISTRIBUTOR: "distributor",
  UNKNOWN: "not established",
});

/**
 * How much of a lot was actually checked.
 *
 * A chemistry-only comparison that comes back clean has established something
 * about chemistry. Presenting it as lot conformity claims the mechanical
 * results, the heat treatment and the document set were checked too.
 */
export const SCOPE = Object.freeze({
  FULL: "all applicable requirements",
  PARTIAL: "some requirements",
});

/**
 * The minimum number of reviewed lots before a rate is shown at all.
 *
 * A product rule, not a statistical one, and it says so wherever it appears.
 * There is no sample size at which a conformity rate becomes a prediction.
 */
export const DEFAULT_MINIMUM_LOTS = 5;

/* ------------------------------------------------------------------ record */

const clean = (v) => String(v ?? "").trim();
const key = (v) => clean(v).toLowerCase().replace(/\s+/g, " ");

/**
 * One reviewed lot.
 *
 * @param {object}  input
 * @param {string}  input.lotKey        from certificate.mjs — producer, heat, lot
 * @param {string} [input.producer]     the mill. Absent means unattributed.
 * @param {string} [input.site]         the manufacturing site, where stated
 * @param {string} [input.distributor]
 * @param {string}  input.decision      DECISION.*
 * @param {string} [input.scope]        SCOPE.*
 * @param {boolean}[input.firstSubmissionComplete]  null when not assessed
 * @param {Array}  [input.nonconformities]  [{ category, responsibility }]
 * @param {string} [input.reviewedAt]   ISO date
 */
export function lotRecord(input = {}) {
  const lot = clean(input.lotKey);
  if (!lot) {
    throw new TypeError(
      "A lot record needs a lot key. Without the producer, heat and lot there is nothing to count " +
      "once, and a record that cannot be counted once will be counted twice.");
  }
  const decision = input.decision;
  if (!Object.values(DECISION).includes(decision)) {
    throw new RangeError(`Unknown decision ${JSON.stringify(decision)}`);
  }

  const ncs = (input.nonconformities ?? []).map((n) => {
    const category = clean(n.category);
    if (!category) throw new TypeError("A nonconformity needs a category");
    const responsibility = n.responsibility ?? RESPONSIBILITY.UNKNOWN;
    if (!Object.values(RESPONSIBILITY).includes(responsibility)) {
      throw new RangeError(`Unknown responsibility ${JSON.stringify(responsibility)}`);
    }
    return Object.freeze({ category, responsibility });
  });

  if (decision === DECISION.NONCONFORMING && ncs.length === 0) {
    throw new TypeError(
      "A lot recorded as nonconforming needs at least one category. A count with no categories " +
      "cannot be acted on and cannot be attributed.");
  }

  return Object.freeze({
    lotKey: lot,
    producer: clean(input.producer) || null,
    site: clean(input.site) || null,
    distributor: clean(input.distributor) || null,
    grade: clean(input.grade) || null,
    form: clean(input.form) || null,
    condition: clean(input.condition) || null,
    specification: clean(input.specification) || null,
    specificationRevision: clean(input.specificationRevision) || null,
    decision,
    scope: input.scope ?? SCOPE.PARTIAL,
    /* Null is not false. A submission nobody assessed for completeness is
       absent from that metric's denominator, not counted as a failure. */
    firstSubmissionComplete: typeof input.firstSubmissionComplete === "boolean"
      ? input.firstSubmissionComplete : null,
    nonconformities: Object.freeze(ncs),
    reviewedAt: clean(input.reviewedAt) || null,
    certificate: clean(input.certificate) || null,
    supersedes: clean(input.supersedes) || null,
    synthetic: input.synthetic !== false,
  });
}

/**
 * The seam between a certificate check and a performance record.
 *
 * Takes a `checkCertificate` result and the `recordReview` decision made
 * against it, and produces the lot record. Deliberately dependency-free: it
 * reads fields rather than importing the certificate module, so neither has
 * to know how the other works.
 *
 * Two mappings are worth stating out loud.
 *
 * A concession becomes a nonconforming lot. The material did not meet the
 * requirement; somebody accepted it anyway, under their reference. Recording
 * it as conforming would let every concession quietly raise a mill's rate,
 * which is the exact opposite of what a concession means.
 *
 * Scope is full only where every applicable requirement was actually
 * compared. A check with an element missing, or a reading nobody could
 * settle, compared some requirements — and a rate built from it should not be
 * read as complete lot conformity.
 */
export function lotFromReview(check, review, { responsibility = RESPONSIBILITY.UNKNOWN } = {}) {
  if (!check || !check.certificate) throw new TypeError("There is no certificate check to record");
  if (!review || !review.disposition) throw new TypeError("There is no decision to record");
  if (!check.lotKey) {
    throw new RangeError(
      "This certificate does not identify a lot — no heat or cast number — so it cannot join a " +
      "performance record. A record that cannot be counted once will be counted twice.");
  }

  const decision =
    review.disposition === "accepted" ? DECISION.CONFORMING
      : review.disposition === "pending" ? DECISION.PENDING
        /* rejected, and accepted under concession, both mean it did not conform. */
        : DECISION.NONCONFORMING;

  const compared = check.findings.filter(
    (f) => f.result === "meets" || f.result === "does not meet" || f.result === "not applicable");
  const scope = compared.length === check.findings.length ? SCOPE.FULL : SCOPE.PARTIAL;

  const failed = check.findings.filter((f) => f.result === "does not meet" && f.mandatory);
  const nonconformities = decision === DECISION.NONCONFORMING
    ? (failed.length
      ? failed.map((f) => ({ category: f.property, responsibility }))
      /* Rejected without a failed comparison — a document problem, or the
         reviewer's own reason. Recorded as such rather than invented. */
      : [{ category: review.reasoning ? "rejected on review" : "rejected", responsibility }])
    : [];

  const paperworkComplete = !check.documentIssues.some((d) => d.id === "pages" || d.id === "unconfirmed")
    && !check.findings.some((f) => f.result === "missing evidence");

  const c = check.certificate;
  return lotRecord({
    lotKey: check.lotKey,
    producer: c.producer,
    site: c.site ?? null,
    distributor: c.distributor,
    grade: c.grade ?? null,
    form: c.form,
    condition: c.condition,
    specification: c.statedSpecification,
    specificationRevision: c.statedRevision,
    decision,
    scope,
    firstSubmissionComplete: paperworkComplete,
    nonconformities,
    reviewedAt: review.at ?? null,
    certificate: c.number,
    supersedes: c.supersedes,
  });
}

/* ---------------------------------------------------------------- identity */

/**
 * Collapse a list of records to one per lot.
 *
 * The later record for a lot wins, which is what makes a revised certificate
 * a correction rather than a second lot. The count of what was collapsed is
 * returned, because "we received forty certificates covering thirty-one lots"
 * is itself worth knowing.
 */
export function uniqueLots(records) {
  const byLot = new Map();
  let superseded = 0;
  for (const r of records) {
    if (byLot.has(r.lotKey)) superseded++;
    byLot.set(r.lotKey, r);
  }
  return Object.freeze({
    lots: Object.freeze([...byLot.values()]),
    submissions: records.length,
    superseded,
  });
}

/**
 * Split records by whether the producer is known.
 *
 * A lot whose certificate never named the mill cannot join a mill's record.
 * It is not dropped — it is counted in its own bucket, because a supply base
 * where a third of the paperwork does not identify the producer is telling
 * you something.
 */
export function attribute(records) {
  const attributed = [];
  const unattributed = [];
  for (const r of records) (r.producer ? attributed : unattributed).push(r);
  return Object.freeze({
    attributed: Object.freeze(attributed),
    unattributed: Object.freeze(unattributed),
    note: unattributed.length
      ? `${unattributed.length} lot(s) do not identify the producer and are attributed to nobody. ` +
        `Assigning them to whoever issued or supplied the certificate would put a distributor's ` +
        `paperwork onto a mill's record.`
      : null,
  });
}

/* ----------------------------------------------------------------- filters */

/** The dimensions a view may be narrowed by. Each one is a real distinction. */
export const FILTERS = Object.freeze(["grade", "form", "condition", "specification", "specificationRevision", "site"]);

export function applyFilters(records, filters = {}) {
  let out = records;
  for (const f of FILTERS) {
    const want = filters[f];
    if (!want) continue;
    out = out.filter((r) => key(r[f]) === key(want));
  }
  if (filters.from) out = out.filter((r) => r.reviewedAt && r.reviewedAt >= filters.from);
  if (filters.to) out = out.filter((r) => r.reviewedAt && r.reviewedAt <= filters.to);
  return out;
}

/**
 * What a set of records has in common, which is what a comparison across them
 * would actually be comparing.
 */
export function cohortOf(records) {
  const distinct = (f) => [...new Set(records.map((r) => clean(r[f])).filter(Boolean))];
  const grades = distinct("grade");
  const forms = distinct("form");
  const specs = distinct("specification");
  return Object.freeze({
    grades: Object.freeze(grades),
    forms: Object.freeze(forms),
    specifications: Object.freeze(specs),
    /* One of each, or it is not one cohort. */
    single: grades.length <= 1 && forms.length <= 1 && specs.length <= 1,
  });
}

/* ----------------------------------------------------------------- a rate */

/**
 * A rate that carries its own evidence.
 *
 * Never a bare number, and below the threshold not a number at all. The
 * caller cannot accidentally render a percentage that the data does not
 * support, because there is no percentage to render.
 */
function rate(numerator, denominator, minimum, what) {
  const enough = denominator >= minimum;
  return Object.freeze({
    what,
    numerator,
    denominator,
    /* Null below the threshold. A percentage with a caveat beside it is still
       a percentage, and it is the percentage people carry away. */
    ratio: denominator > 0 && enough ? scaleDiv(BigInt(numerator) * SCALE, BigInt(denominator)) : null,
    percent: denominator > 0 && enough
      ? ratioToPercentString(scaleDiv(BigInt(numerator) * SCALE, BigInt(denominator)), 1)
      : null,
    sufficient: enough,
    shortBy: enough ? 0 : minimum - denominator,
    statement: denominator === 0
      ? `No lots have a final decision, so there is no ${what} to report.`
      : enough
        ? `${numerator} of ${denominator} reviewed lots.`
        : `${numerator} of ${denominator} reviewed lots — below the ${minimum}-lot threshold, so no ` +
          `percentage is shown. Two out of two and two hundred out of two hundred are both 100%, and ` +
          `they are not the same statement.`,
  });
}

/* ------------------------------------------------------------ performance */

/**
 * The record for one producer, or for a whole filtered set.
 *
 * @param {Array}  records
 * @param {object} [opts]
 * @param {number} [opts.minimumLots]  the evidence threshold
 */
export function producerRecord(records, { minimumLots = DEFAULT_MINIMUM_LOTS } = {}) {
  const decided = records.filter((r) => r.decision !== DECISION.PENDING);
  const conforming = decided.filter((r) => r.decision === DECISION.CONFORMING);
  const pending = records.filter((r) => r.decision === DECISION.PENDING);

  const assessed = records.filter((r) => r.firstSubmissionComplete !== null);
  const complete = assessed.filter((r) => r.firstSubmissionComplete === true);

  /* Categories, counted with their responsibility kept beside them rather
     than folded into the rate. */
  const categories = new Map();
  for (const r of records) {
    for (const n of r.nonconformities) {
      const k = `${n.category}|${n.responsibility}`;
      categories.set(k, (categories.get(k) ?? 0) + 1);
    }
  }
  const byCategory = [...categories.entries()]
    .map(([k, count]) => {
      const [category, responsibility] = k.split("|");
      return Object.freeze({ category, responsibility, count });
    })
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  const attributedToDistributor = byCategory
    .filter((c) => c.responsibility === RESPONSIBILITY.DISTRIBUTOR)
    .reduce((n, c) => n + c.count, 0);

  const partial = records.filter((r) => r.scope !== SCOPE.FULL);

  const dates = records.map((r) => r.reviewedAt).filter(Boolean).sort();

  return Object.freeze({
    producer: records.length ? records[0].producer : null,
    sites: Object.freeze([...new Set(records.map((r) => r.site).filter(Boolean))]),

    lots: records.length,
    /* The two metrics, kept apart. They answer different questions. */
    conformity: rate(conforming.length, decided.length, minimumLots, "reviewed-lot conformity rate"),
    firstPassCompleteness: rate(complete.length, assessed.length, minimumLots, "first-pass document completeness"),

    pending: pending.length,
    pendingNote: pending.length
      ? `${pending.length} lot(s) have no final decision yet and are in neither rate above.`
      : null,

    nonconformityCategories: Object.freeze(byCategory),
    attributedToDistributor,
    attributionNote: attributedToDistributor > 0
      ? `${attributedToDistributor} confirmed issue(s) were attributed to the distributor rather than ` +
        `the mill. They are counted in the conformity rate, which is about lots, and named here, ` +
        `which is about blame. The two are not the same question.`
      : null,

    /* What was actually checked, so a chemistry-only pass is not read as more. */
    partialScopeLots: partial.length,
    scopeNote: partial.length
      ? `${partial.length} of ${records.length} lot(s) were compared against only some of the ` +
        `applicable requirements. A comparison that checked chemistry has established something ` +
        `about chemistry, and this rate should not be read as complete lot conformity.`
      : null,

    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    undated: records.filter((r) => !r.reviewedAt).length,
  });
}

/**
 * Every producer in the set, as an evidence table.
 *
 * Deliberately not sorted by performance. The default view is a table of what
 * is recorded; putting it in rank order is a separate, explicit request.
 */
export function millPerformance(records, { minimumLots = DEFAULT_MINIMUM_LOTS, filters = {} } = {}) {
  const filtered = applyFilters(records, filters);
  const { lots, submissions, superseded } = uniqueLots(filtered);
  const { attributed, unattributed, note } = attribute(lots);

  const byProducer = new Map();
  for (const r of attributed) {
    const k = key(r.producer);
    if (!byProducer.has(k)) byProducer.set(k, []);
    byProducer.get(k).push(r);
  }

  const rows = [...byProducer.values()]
    .map((group) => producerRecord(group, { minimumLots }))
    /* By name, so the order carries no implication. */
    .sort((a, b) => a.producer.localeCompare(b.producer));

  const cohort = cohortOf(lots);

  return Object.freeze({
    rows: Object.freeze(rows),
    producers: rows.length,
    lots: lots.length,
    submissions,
    supersededSubmissions: superseded,
    submissionNote: superseded
      ? `${submissions} certificate submission(s) cover ${lots.length} lot(s). A revision or a ` +
        `re-upload corrects the record for a lot; it does not add one.`
      : null,
    unattributed: unattributed.length,
    unattributedNote: note,
    cohort,
    cohortNote: cohort.single
      ? null
      : `These lots span ${cohort.grades.length} grade(s), ${cohort.forms.length} product form(s) and ` +
        `${cohort.specifications.length} specification(s). That is a summary, not a comparison: ` +
        `different material requirements are not equivalent, and a rate across them is a rate about ` +
        `a mixture.`,
    minimumLots,
    method:
      "Every rate is shown with its numerator, its denominator and the period it covers. Below the " +
      `${minimumLots}-lot threshold no percentage is shown at all, because a percentage with a caveat ` +
      "beside it is still the figure people carry away. The threshold is a product rule, not a " +
      "statistical guarantee. Conformity and first-pass document completeness are separate metrics " +
      "and are never merged. A lot is identified by producer, heat and lot, so a revised certificate " +
      "corrects a record rather than adding one. There is no composite score.",
    disclaimer:
      "This is a record of how reviewed lots turned out. It is not a probability that future material " +
      "will conform, it is not a supplier rating, and it is private to this browser — nothing here is " +
      "pooled with anybody else's records or published.",
  });
}

/* ----------------------------------------------------------------- ranking */

/**
 * A ranked view, which is opt-in and comes with conditions.
 *
 * Producers below the evidence threshold are not ranked low — they are not
 * ranked. Ranking a mill with two lots against one with two hundred produces
 * an order, and an order is read as a judgement.
 */
export function rank(performance, { minimumLots = performance.minimumLots } = {}) {
  const eligible = performance.rows.filter((r) => r.conformity.sufficient);
  const insufficient = performance.rows.filter((r) => !r.conformity.sufficient);

  const ranked = [...eligible].sort((a, b) => {
    if (a.conformity.ratio !== b.conformity.ratio) return a.conformity.ratio > b.conformity.ratio ? -1 : 1;
    /* A tie on rate goes to the one with more evidence behind it. */
    return b.conformity.denominator - a.conformity.denominator;
  });

  return Object.freeze({
    ranked: Object.freeze(ranked),
    insufficient: Object.freeze(insufficient),
    minimumLots,
    /* A ranking across an unlike set is refused rather than drawn. */
    safe: performance.cohort.single && ranked.length >= 2,
    why: !performance.cohort.single
      ? "These lots span more than one grade, form or specification, so a ranking would order " +
        "producers by requirements they were not all judged against."
      : ranked.length < 2
        ? `Fewer than two producers clear the ${minimumLots}-lot threshold, so there is nothing to rank.`
        : null,
    note:
      `${insufficient.length} producer(s) are not ranked because they have fewer than ${minimumLots} ` +
      `reviewed lots. They are not ranked last — they are not ranked. A threshold is a product rule ` +
      `and does not make the producers above it better, only better evidenced.`,
  });
}
