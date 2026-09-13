/**
 * BATNA — what the alternative to agreeing actually is.
 *
 * Supplier Discovery already finds names with citations. Finding a name is not
 * a BATNA. The question a buyer needs answered before a negotiation is narrower
 * and much harder: *could this one actually replace them, inside the notice
 * period, and what is still unknown?*
 *
 * This is the first part of the system that depends on facts the product cannot
 * obtain for itself — a supplier's certifications, capacity, financial standing
 * and tooling position are not derivable from anything already on file. So the
 * design principle here is inverted from the rest of the engine. Elsewhere the
 * job is to compute precisely. Here the job is to be exact about ignorance.
 *
 * Three rules follow from that.
 *
 * Every attribute carries how it is known: supplied by a person, cited to a
 * source, assumed, or unknown. A cited fact without a source is not cited, and
 * is refused.
 *
 * Unknowns do not default to favourable. An alternative nobody has checked is
 * not a strong alternative, however promising the name sounds.
 *
 * And strength is capped by evidence. If more of what matters is unknown than
 * known, the assessment cannot rise above weak no matter how the rest reads.
 * That cap is the whole defence against a confident BATNA built on nothing,
 * which is the specific way this feature would otherwise mislead — a buyer who
 * believes they can walk away, and cannot, has been handed a worse position
 * than one who knows they are stuck.
 */

import { SCALE, scaleDiv, money, moneyToDecimalString } from "./exact.mjs";

/** How a fact came to be known. */
export const KNOWN = Object.freeze({
  SUPPLIED: "supplied",   // a person entered it
  CITED: "cited",         // found in a source, which is recorded
  ASSUMED: "assumed",     // a working assumption, labelled
  UNKNOWN: "unknown",     // nobody has established it
});

/** How far along an alternative is. */
export const READINESS = Object.freeze({
  QUALIFIED: "qualified",               // already approved to supply
  IN_QUALIFICATION: "in-qualification", // started, not finished
  CANDIDATE: "candidate",               // identified only
  UNASSESSED: "unassessed",
});

/** The verdict. A band with its reasons, never a score out of a hundred. */
export const STRENGTH = Object.freeze({
  STRONG: "strong",
  MODERATE: "moderate",
  WEAK: "weak",
  NONE: "none",
});

/**
 * The attributes that decide whether a supplier can actually be used.
 *
 * Deliberately short. A long checklist invites filling it in with guesses; this
 * is the set where an unknown genuinely changes the answer.
 */
export const MATERIAL = Object.freeze([
  { id: "technicalMatch", label: "can make the part to specification" },
  { id: "certifications", label: "holds the required certifications" },
  { id: "capacity", label: "has capacity at the volume needed" },
  { id: "leadTime", label: "can meet the lead time" },
  { id: "financialStanding", label: "is financially sound enough to rely on" },
  { id: "toolingTransfer", label: "the tooling position is resolved" },
]);

const MATERIAL_IDS = new Set(MATERIAL.map((m) => m.id));

/* -------------------------------------------------------------- one fact */

/**
 * An attribute, with how it is known.
 *
 * @param {*} value
 * @param {string} state  a KNOWN value
 * @param {object} [src]  { label, url } — required when cited
 */
export function fact(value, state = KNOWN.UNKNOWN, src = null) {
  if (!Object.values(KNOWN).includes(state)) throw new RangeError(`Not a knowledge state: ${state}`);

  if (state === KNOWN.CITED && !(src && String(src.label ?? "").trim())) {
    throw new TypeError(
      "A cited fact needs its source. Without one it is an assumption wearing a citation's clothes."
    );
  }
  if (state === KNOWN.UNKNOWN && value != null && String(value).trim() !== "") {
    throw new TypeError("An unknown fact cannot carry a value. Say what state it is really in.");
  }

  return Object.freeze({
    value: state === KNOWN.UNKNOWN ? null : value,
    state,
    source: src ? Object.freeze({ label: String(src.label), url: src.url ? String(src.url) : null }) : null,
    known: state !== KNOWN.UNKNOWN,
    /* An assumption is "known" in the sense that somebody wrote it down, but it
       is not evidence, and the strength cap counts only evidence. */
    evidenced: state === KNOWN.SUPPLIED || state === KNOWN.CITED,
  });
}

/** Shorthand for the common case: nobody has checked. */
export const unknown = () => fact(null, KNOWN.UNKNOWN);

/* ------------------------------------------------------- one alternative */

/**
 * A candidate replacement.
 *
 * @param {object} input
 * @param {string} input.supplier
 * @param {string} [input.readiness]
 * @param {number} [input.qualificationWeeks]  null when nobody has estimated it
 * @param {object} [input.facts]               { [MATERIAL id]: fact }
 * @param {string[]} [input.blockers]          stated reasons it cannot be used
 */
export function alternative(input = {}) {
  const supplier = String(input.supplier ?? "").trim();
  if (!supplier) throw new TypeError("An alternative needs a supplier name");

  const readiness = input.readiness ?? READINESS.UNASSESSED;
  if (!Object.values(READINESS).includes(readiness)) throw new RangeError(`Not a readiness: ${readiness}`);

  /* Every material attribute exists, whether or not anyone filled it in. An
     absent field would be invisible; an explicit unknown is a question. */
  const facts = {};
  for (const m of MATERIAL) {
    const f = input.facts?.[m.id];
    facts[m.id] = f && f.state ? f : unknown();
  }
  for (const key of Object.keys(input.facts ?? {})) {
    if (!MATERIAL_IDS.has(key)) throw new RangeError(`${key} is not a material attribute`);
  }

  const evidenced = MATERIAL.filter((m) => facts[m.id].evidenced).length;

  return Object.freeze({
    supplier,
    readiness,
    qualificationWeeks: Number.isInteger(input.qualificationWeeks) ? input.qualificationWeeks : null,
    facts: Object.freeze(facts),
    blockers: Object.freeze((input.blockers ?? []).map(String).filter(Boolean)),
    evidencedCount: evidenced,
    unknownCount: MATERIAL.length - evidenced,
    /* What nobody has established, in a buyer's words rather than field names. */
    openQuestions: Object.freeze(
      MATERIAL.filter((m) => !facts[m.id].evidenced).map((m) => m.label)
    ),
    citations: Object.freeze(
      MATERIAL.map((m) => facts[m.id].source).filter(Boolean)
    ),
    synthetic: input.synthetic !== false,
  });
}

/* ------------------------------------------------------------ assessment */

/** Can this one be in place before supply would stop? */
function usableInNotice(alt, noticePeriodWeeks) {
  if (alt.readiness === READINESS.QUALIFIED) return { ok: true, why: "already qualified" };
  if (alt.qualificationWeeks == null) {
    return { ok: false, why: "qualification time has not been estimated" };
  }
  if (noticePeriodWeeks == null) {
    return { ok: false, why: "the contract notice period is not recorded" };
  }
  return alt.qualificationWeeks <= noticePeriodWeeks
    ? { ok: true, why: `${alt.qualificationWeeks} weeks to qualify against ${noticePeriodWeeks} weeks' notice` }
    : { ok: false, why: `${alt.qualificationWeeks} weeks to qualify exceeds ${noticePeriodWeeks} weeks' notice` };
}

const RANK = { [READINESS.QUALIFIED]: 3, [READINESS.IN_QUALIFICATION]: 2, [READINESS.CANDIDATE]: 1, [READINESS.UNASSESSED]: 0 };

/**
 * Assess a set of alternatives against the contract position.
 *
 * @param {object}  input
 * @param {Array}  [input.alternatives]
 * @param {number} [input.noticePeriodWeeks]
 * @param {string} [input.criticality]      "critical" or "single-source" ends it
 * @param {object} [input.switchingCost]    Money
 * @param {object} [input.annualDisputed]   Money — what is in dispute, for a breakeven
 */
export function assessBatna(input = {}) {
  const alternatives = Array.isArray(input.alternatives) ? input.alternatives : [];
  const notice = Number.isInteger(input.noticePeriodWeeks) ? input.noticePeriodWeeks : null;

  const assessed = alternatives.map((a) => {
    const u = usableInNotice(a, notice);
    return Object.freeze({
      ...a,
      usableInNotice: u.ok && a.blockers.length === 0,
      timing: u.why,
      blocked: a.blockers.length > 0,
    });
  });

  /* Ranked by readiness, then by whether it fits the notice period, then by how
     much is actually known about it. Each factor is stated, so the order can be
     argued with rather than taken on trust. */
  const ranked = [...assessed].sort((x, y) =>
    (RANK[y.readiness] - RANK[x.readiness]) ||
    (Number(y.usableInNotice) - Number(x.usableInNotice)) ||
    (y.evidencedCount - x.evidencedCount) ||
    x.supplier.localeCompare(y.supplier)
  );

  const viable = ranked.filter((a) => a.usableInNotice);
  const best = viable[0] ?? ranked[0] ?? null;

  /* ------------------------------------------------------------ strength */
  const soleSource = input.criticality === "critical" || input.criticality === "single-source";
  const halfKnown = best ? best.evidencedCount * 2 >= MATERIAL.length : false;

  let strength = STRENGTH.NONE;
  let rule = "No alternative has been recorded, so there is nothing to fall back on.";

  if (soleSource) {
    strength = STRENGTH.NONE;
    rule = `The part is recorded as ${input.criticality}. There is no alternative to fall back on at any notice period.`;
  } else if (!alternatives.length) {
    // the default above
  } else if (!viable.length) {
    strength = STRENGTH.WEAK;
    rule = `${alternatives.length} alternative(s) recorded, none of which can be in place inside the notice period. ` +
           `A supplier who cannot be used before supply stops is not leverage.`;
  } else if (viable.some((a) => a.readiness === READINESS.QUALIFIED)) {
    strength = STRENGTH.STRONG;
    rule = "At least one alternative is already qualified and can be used inside the notice period.";
  } else {
    strength = STRENGTH.MODERATE;
    rule = "At least one alternative can be qualified inside the notice period, but none is qualified yet.";
  }

  /* The cap. An assessment cannot be stronger than what is actually known about
     the supplier it rests on. This is the defence against a confident BATNA
     built on a name and some optimism. */
  let capped = false;
  if ((strength === STRENGTH.STRONG || strength === STRENGTH.MODERATE) && !halfKnown) {
    strength = STRENGTH.WEAK;
    capped = true;
    rule += ` Held at weak: only ${best.evidencedCount} of ${MATERIAL.length} material attributes of ` +
            `${best.supplier} are evidenced, and an alternative nobody has checked is not leverage.`;
  }

  /* ----------------------------------------------------------- breakeven */
  let breakeven = null;
  if (input.switchingCost && input.annualDisputed && input.annualDisputed.minor > 0n) {
    const years = scaleDiv(input.switchingCost.minor * SCALE, input.annualDisputed.minor);
    breakeven = Object.freeze({
      switchingCost: input.switchingCost,
      annualDisputed: input.annualDisputed,
      years,
      yearsApprox: Number(years) / 1e9,
      basis: `${moneyToDecimalString(input.switchingCost)} of switching cost against ` +
             `${moneyToDecimalString(input.annualDisputed)} a year in dispute.`,
      assumption: "that an alternative would match today's price. Nothing recorded here evidences that.",
    });
  }

  /* ------------------------------------------------- what would change it */
  const toStrengthen = [];
  if (soleSource) {
    toStrengthen.push("Record whether the single-source designation still holds; it is doing all the work here.");
  } else if (!alternatives.length) {
    toStrengthen.push("Identify candidates — Supplier Discovery finds names with citations.");
  } else {
    for (const a of ranked.slice(0, 2)) {
      if (a.qualificationWeeks == null) toStrengthen.push(`Estimate qualification time for ${a.supplier}.`);
      for (const q of a.openQuestions) toStrengthen.push(`${a.supplier}: establish whether it ${q}.`);
    }
    if (notice == null) toStrengthen.push("Record the contract notice period; without it nothing can be timed.");
  }

  return Object.freeze({
    strength,
    rule,
    cappedByEvidence: capped,
    alternatives: Object.freeze(ranked),
    viable: Object.freeze(viable),
    best,
    noticePeriodWeeks: notice,
    breakeven,
    openQuestions: Object.freeze([...new Set(toStrengthen)]),
    citations: Object.freeze(ranked.flatMap((a) => a.citations)),
    /* The shape prepareNegotiation already understands, so an assessed BATNA
       can drive the walk-away verdict instead of a bare count. */
    position: Object.freeze({
      alternatives: viable.length,
      qualificationWeeks: best && best.qualificationWeeks != null ? best.qualificationWeeks : null,
      noticePeriodWeeks: notice,
      criticality: input.criticality ?? null,
      switchingCost: input.switchingCost ?? undefined,
    }),
    method:
      "Assessed from recorded facts only. Every attribute states how it is known — supplied, cited, " +
      "assumed or unknown — and an unknown never counts in favour. Strength is capped at weak when " +
      "less than half of what matters about the best alternative is evidenced, because a supplier " +
      "nobody has checked is not leverage. No capability here is inferred from a supplier's name, " +
      "sector or website.",
  });
}
