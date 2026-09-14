/**
 * Certificate against specification.
 *
 * What this does is narrow, and saying so is most of the job: it compares the
 * values written on a material certificate against the requirements written in
 * a specification, a drawing and a purchase order, and reports where they
 * agree. That is a comparison of two documents.
 *
 * It is not proof that the material is what the paperwork says, that it is in
 * the condition it left the mill in, that the right heat arrived, or that any
 * of it is fit for the job. Every result here is stated as a comparison, never
 * as a release, and nothing in this module can approve material for use.
 *
 * Five rules do the work, and each one exists because the obvious shortcut is
 * wrong.
 *
 * 1. A reported value is a range, not a number. "<0.005" does not mean 0.005,
 *    and against a limit of 0.001 it proves nothing at all. Every observation
 *    becomes an interval, and a comparison has three answers rather than two:
 *    the whole interval satisfies the limit, none of it does, or it straddles
 *    — and straddling is reported as needing review, never resolved by
 *    picking the convenient end.
 *
 * 2. Precision is evidence, and a value reported more coarsely than the limit
 *    it is being judged against cannot settle the boundary. 0.03 against a
 *    limit of 0.030 rounds to exactly the limit, and the true value might be
 *    0.034. Clearly inside still passes, clearly outside still fails; only the
 *    boundary case goes to review, and it says why.
 *
 * 3. Units convert exactly or not at all. Per cent to ppm is a factor of ten
 *    thousand and is fine. Hardness scales do not convert to each other at
 *    all — a Brinell-to-Rockwell table is an approximation for a particular
 *    material, not an equivalence — and this refuses rather than applying one.
 *
 * 4. One unmet mandatory requirement is the answer. An overall state is the
 *    worst of its parts, never an average of them, because ninety-nine
 *    passing chemistry lines do not make an out-of-limit tensile acceptable.
 *
 * 5. Missing is not failing. A certificate that does not report an element is
 *    incomplete evidence, not evidence of nonconformance, and the two are
 *    different words on screen and different states in the result.
 *
 * Nothing here infers a limit. A specification's limits arrive as data, from
 * a document identified by revision and clause; this module has no opinion
 * about what any grade requires and will not supply one.
 */

import { SCALE, scaleDiv } from "./exact.mjs";

/** Bumped when a comparison rule changes, and stored with every result. */
export const RULES_VERSION = "1.0.0";

/* --------------------------------------------------------------- results */

export const RESULT = Object.freeze({
  MEETS: "meets",
  DOES_NOT_MEET: "does not meet",
  MISSING_EVIDENCE: "missing evidence",
  REVIEW_REQUIRED: "review required",
  NOT_APPLICABLE: "not applicable",
});

export const OVERALL = Object.freeze({
  MEETS_CHECKED: "meets checked requirements",
  POTENTIAL_NONCONFORMANCE: "potential nonconformance",
  INCOMPLETE_EVIDENCE: "incomplete evidence",
  REVIEW_REQUIRED: "review required",
});

/**
 * Worst wins. The order is deliberate: a potential nonconformance outranks
 * missing evidence, which outranks an unresolved reading, which outranks
 * everything being in order. Nothing averages.
 */
const OVERALL_RANK = Object.freeze({
  [OVERALL.MEETS_CHECKED]: 0,
  [OVERALL.REVIEW_REQUIRED]: 1,
  [OVERALL.INCOMPLETE_EVIDENCE]: 2,
  [OVERALL.POTENTIAL_NONCONFORMANCE]: 3,
});

/* ----------------------------------------------------------------- units */

/**
 * Conversions, and only the exact ones.
 *
 * Each family converts within itself and never outside it. `hardness` is
 * listed as separate families on purpose — HB, HV and HRC are different
 * measurements, and the conversion tables that exist between them are
 * material-specific approximations, not equivalences.
 */
export const UNIT_FAMILIES = Object.freeze({
  /* Per cent is per cent, whether it is carbon content or elongation. The
     property name keeps those apart; the unit does not need to. */
  fraction: Object.freeze({ "%": 10_000n, ppm: 1n, "wt%": 10_000n }),
  stress: Object.freeze({ MPa: 1n, "N/mm2": 1n }),
  temperature: Object.freeze({ "°C": 1n, C: 1n }),
  HB: Object.freeze({ HB: 1n }),
  HV: Object.freeze({ HV: 1n }),
  HRC: Object.freeze({ HRC: 1n }),
  count: Object.freeze({ "": 1n }),
});

function familyOf(unit) {
  const u = String(unit ?? "").trim();
  for (const [name, table] of Object.entries(UNIT_FAMILIES)) {
    if (Object.prototype.hasOwnProperty.call(table, u)) return { family: name, per: table[u] };
  }
  return null;
}

/* ------------------------------------------------------------- quantities */

const OPS = Object.freeze(["<=", ">=", "<", ">", "="]);

/**
 * Parse a value as written on a certificate or in a specification.
 *
 * Keeps three things a bare number loses: the inequality symbol, the number
 * of decimal places it was reported to, and the unit. All three are load
 * bearing further down.
 *
 * Accepts the symbols a document actually uses, including ≤ and ≥.
 *
 * @param {string|number} text  "0.18", "<0.005", "≤0.030", ">=400"
 * @param {string} unit
 */
export function quantity(text, unit, what = "A value") {
  const raw = String(text ?? "").trim().replace(/≤/g, "<=").replace(/≥/g, ">=");
  if (!raw) throw new RangeError(`${what} is missing. A value nobody recorded is not zero.`);

  let op = "=";
  let rest = raw;
  for (const candidate of OPS) {
    if (rest.startsWith(candidate)) { op = candidate; rest = rest.slice(candidate.length).trim(); break; }
  }
  if (!/^-?\d+(\.\d+)?$/.test(rest)) {
    throw new RangeError(`${what}: ${JSON.stringify(String(text))} is not a value this can read. ` +
      `Expected a number, optionally preceded by <, <=, > or >=.`);
  }

  const neg = rest.startsWith("-");
  const [whole, frac = ""] = (neg ? rest.slice(1) : rest).split(".");
  if (frac.length > 9) throw new RangeError(`${what} has more than 9 decimal places: ${rest}`);
  const magnitude = BigInt(whole) * SCALE + BigInt((frac + "000000000").slice(0, 9));

  const f = familyOf(unit);
  if (!f) {
    throw new RangeError(`${what}: ${JSON.stringify(String(unit ?? ""))} is not a unit this understands. ` +
      `Known: ${Object.values(UNIT_FAMILIES).flatMap((t) => Object.keys(t)).filter(Boolean).join(", ")}.`);
  }

  return Object.freeze({
    op,
    scaled: neg ? -magnitude : magnitude,
    dp: frac.length,
    unit: String(unit).trim(),
    family: f.family,
    text: raw,
    /* A result reported as below a detection limit is a real, useful
       statement — it is just not a measurement of a number. */
    belowDetection: op === "<" || op === "<=",
  });
}

/** The canonical magnitude of a quantity within its family. */
function canonical(q) {
  return q.scaled * familyOf(q.unit).per;
}

/**
 * The interval a reported value actually covers.
 * lo/hi of null are unbounded; `loOpen`/`hiOpen` mark a strict inequality.
 */
function intervalOf(q) {
  const v = canonical(q);
  if (q.op === "=") return { lo: v, hi: v, loOpen: false, hiOpen: false };
  if (q.op === "<") return { lo: null, hi: v, loOpen: false, hiOpen: true };
  if (q.op === "<=") return { lo: null, hi: v, loOpen: false, hiOpen: false };
  if (q.op === ">") return { lo: v, hi: null, loOpen: true, hiOpen: false };
  return { lo: v, hi: null, loOpen: false, hiOpen: false }; // >=
}

/** Round a canonical magnitude to `dp` decimal places, half-up away from zero. */
function roundTo(canonicalValue, dp, perUnit) {
  const step = perUnit * 10n ** BigInt(9 - dp);
  if (step <= 0n) return canonicalValue;
  return scaleDiv(canonicalValue, step) * step;
}

/* ------------------------------------------------------------ requirements */

/** What a requirement is asking for. */
export const KIND = Object.freeze({
  NUMERIC: "numeric",         // a limit, a range, or both
  TEXT: "text",               // an exact stated condition, e.g. a temper
  DECLARATION: "declaration", // a statement that must be present
  /* A clause that needs engineering judgement. Never forced into pass/fail:
     it is surfaced for a competent person and reported as such. */
  INTERPRETATION: "interpretation",
});

/**
 * One requirement, from one identified document.
 *
 * @param {object}  input
 * @param {string}  input.id
 * @param {string}  input.property        "C", "UTS", "condition", or a combination
 * @param {string} [input.kind]           KIND.*
 * @param {object} [input.min]            quantity — inclusive lower limit
 * @param {object} [input.max]            quantity — inclusive upper limit
 * @param {string} [input.expected]       for KIND.TEXT
 * @param {Array}  [input.combines]       property names summed before comparison
 * @param {boolean}[input.mandatory]      default true
 * @param {object}  input.source          { document, revision, clause }
 * @param {object} [input.appliesTo]      { forms, conditions, thicknessMinUm, thicknessMaxUm }
 */
export function requirement(input = {}) {
  const id = String(input.id ?? "").trim();
  const property = String(input.property ?? "").trim();
  if (!id || !property) throw new TypeError("A requirement needs an id and a property");

  const src = input.source ?? {};
  if (!String(src.document ?? "").trim() || !String(src.revision ?? "").trim()) {
    throw new TypeError(
      `${property}: a requirement needs the document and the exact revision it came from. ` +
      `A limit without a revision is a limit nobody can check, and revisions change limits.`);
  }

  const kind = input.kind ?? KIND.NUMERIC;
  if (!Object.values(KIND).includes(kind)) throw new RangeError(`${property}: unknown requirement kind ${kind}`);

  if (kind === KIND.NUMERIC && !input.min && !input.max) {
    throw new TypeError(`${property}: a numeric requirement needs a minimum, a maximum, or both`);
  }
  if (input.min && input.max && input.min.family !== input.max.family) {
    throw new RangeError(`${property}: the minimum and maximum are not the same kind of quantity`);
  }
  if (input.min && input.max && canonical(input.min) > canonical(input.max)) {
    throw new RangeError(`${property}: the minimum is above the maximum`);
  }
  if (kind === KIND.TEXT && !String(input.expected ?? "").trim()) {
    throw new TypeError(`${property}: a text requirement needs the condition it expects`);
  }

  return Object.freeze({
    id, property, kind,
    min: input.min ?? null,
    max: input.max ?? null,
    expected: input.expected ? String(input.expected).trim() : null,
    combines: Object.freeze(input.combines ? [...input.combines] : []),
    mandatory: input.mandatory !== false,
    source: Object.freeze({
      document: String(src.document).trim(),
      revision: String(src.revision).trim(),
      clause: String(src.clause ?? "").trim() || null,
    }),
    appliesTo: Object.freeze(input.appliesTo ?? {}),
    note: input.note ? String(input.note) : null,
  });
}

/**
 * One value read off a certificate, with where on the certificate it was read.
 *
 * `confirmed` is the difference between a machine reading and evidence. An
 * unconfirmed extraction can be shown and can be compared, but it carries
 * that state all the way to the result, so nothing rests on an OCR guess
 * without somebody having looked at it.
 */
/** A whole count of pages. There is no page two and a half. */
function pageCount(v, what) {
  if (typeof v === "number") {
    if (!Number.isInteger(v) || v < 0) throw new RangeError(`${what} must be a whole number of pages, not ${v}`);
    return v;
  }
  const s = String(v ?? "").trim();
  if (!/^\d+$/.test(s)) throw new RangeError(`${what} must be a whole number of pages, not ${JSON.stringify(String(v))}`);
  return parseInt(s, 10);
}

export function observation(input = {}) {
  const property = String(input.property ?? "").trim();
  if (!property) throw new TypeError("An observation needs a property");
  const src = input.source ?? {};
  if (!String(src.file ?? "").trim() || src.page === undefined || src.page === null) {
    throw new TypeError(
      `${property}: an observation needs the file and page it was read from. ` +
      `A value with no source on the certificate is not evidence.`);
  }
  return Object.freeze({
    property,
    value: input.value ?? null,
    text: input.text != null ? String(input.text) : (input.value ? input.value.text : null),
    source: Object.freeze({
      file: String(src.file).trim(),
      page: pageCount(src.page, `${property}: the page it was read from`),
      quote: String(src.quote ?? "").trim() || null,
    }),
    confirmed: input.confirmed === true,
    /* Test context a mechanical result is meaningless without. */
    direction: input.direction ? String(input.direction) : null,
    method: input.method ? String(input.method) : null,
    specimen: input.specimen ? String(input.specimen) : null,
  });
}

/**
 * The certificate itself.
 *
 * Producer, issuer and distributor are three fields, not one. A distributor's
 * paperwork error is not a mill's, and a certificate that does not identify
 * the actual producer must keep that uncertainty rather than resolving it to
 * whoever's letterhead it is printed on.
 */
export function certificate(input = {}) {
  const number = String(input.number ?? "").trim();
  if (!number) throw new TypeError("A certificate needs its own number");
  const pages = pageCount(input.pagesProvided ?? 0, "Pages provided");
  const declared = input.pagesDeclared === undefined || input.pagesDeclared === null
    ? null : pageCount(input.pagesDeclared, "Pages declared");

  return Object.freeze({
    number,
    revision: String(input.revision ?? "").trim() || null,
    producer: String(input.producer ?? "").trim() || null,
    issuer: String(input.issuer ?? "").trim() || null,
    distributor: String(input.distributor ?? "").trim() || null,
    /* Whether the producer is actually identified, kept as its own fact. */
    producerIdentified: Boolean(String(input.producer ?? "").trim()),
    heat: String(input.heat ?? "").trim() || null,
    lot: String(input.lot ?? "").trim() || null,
    statedSpecification: String(input.statedSpecification ?? "").trim() || null,
    statedRevision: String(input.statedRevision ?? "").trim() || null,
    form: String(input.form ?? "").trim() || null,
    condition: String(input.condition ?? "").trim() || null,
    thicknessUm: typeof input.thicknessUm === "bigint" ? input.thicknessUm : null,
    pagesProvided: pages,
    pagesDeclared: declared,
    observations: Object.freeze((input.observations ?? []).map((o) => o)),
    supersedes: String(input.supersedes ?? "").trim() || null,
    synthetic: input.synthetic !== false,
  });
}

/**
 * The identity of the physical lot, which is not the identity of the paper.
 *
 * Re-uploading a certificate, or uploading a corrected revision of it, must
 * not turn one lot of material into two. The key is the producer, the heat
 * and the lot — never the certificate number, which changes on revision.
 */
export function lotKey(cert) {
  const parts = [cert.producer, cert.heat, cert.lot].map((p) => (p ?? "").toLowerCase().replace(/\s+/g, " ").trim());
  if (!parts[1]) return null; // no heat number: the lot cannot be identified at all
  return parts.join("|");
}

/* ------------------------------------------------------------ applicability */

/**
 * Does this requirement apply to this material at all?
 *
 * A limit for a different product form or a different thickness range is not
 * a limit this certificate passes or fails; it is a limit that does not
 * apply, and calling it a pass would inflate the count of checks done.
 */
function applies(req, cert) {
  const a = req.appliesTo ?? {};
  if (a.forms && a.forms.length) {
    if (!cert.form) return { applies: false, why: "the certificate does not state the product form" };
    if (!a.forms.some((f) => f.toLowerCase() === cert.form.toLowerCase())) {
      return { applies: false, why: `it applies to ${a.forms.join(", ")}, and this is ${cert.form}` };
    }
  }
  if (a.conditions && a.conditions.length) {
    if (!cert.condition) return { applies: false, why: "the certificate does not state the condition" };
    if (!a.conditions.some((c) => c.toLowerCase() === cert.condition.toLowerCase())) {
      return { applies: false, why: `it applies in ${a.conditions.join(", ")}, and this is ${cert.condition}` };
    }
  }
  if (a.thicknessMinUm !== undefined || a.thicknessMaxUm !== undefined) {
    if (cert.thicknessUm === null) return { applies: false, why: "the certificate does not state a thickness" };
    if (a.thicknessMinUm !== undefined && cert.thicknessUm < a.thicknessMinUm) {
      return { applies: false, why: "the material is thinner than the range this limit covers" };
    }
    if (a.thicknessMaxUm !== undefined && cert.thicknessUm > a.thicknessMaxUm) {
      return { applies: false, why: "the material is thicker than the range this limit covers" };
    }
  }
  return { applies: true, why: null };
}

/* -------------------------------------------------------------- comparison */

/**
 * Does the whole interval satisfy the limit, none of it, or only some?
 *
 * Requirement limits are inclusive, which is why the open/closed flag on the
 * interval's own end only matters at the "none" edge: everything below 0.005
 * is also at or below 0.005, but something strictly above 0.030 is nowhere
 * at or below it.
 */
function coverage(iv, req) {
  const minV = req.min ? canonical(req.min) : null;
  const maxV = req.max ? canonical(req.max) : null;

  const wholeUnderMax = maxV === null || (iv.hi !== null && iv.hi <= maxV);
  const wholeOverMin = minV === null || (iv.lo !== null && iv.lo >= minV);

  const noneUnderMax = maxV !== null && iv.lo !== null && (iv.lo > maxV || (iv.lo === maxV && iv.loOpen));
  const noneOverMin = minV !== null && iv.hi !== null && (iv.hi < minV || (iv.hi === minV && iv.hiOpen));

  if (noneUnderMax || noneOverMin) return "none";
  if (wholeUnderMax && wholeOverMin) return "all";
  return "some";
}

/** A quantity rendered the way it was written, for the evidence column. */
function show(q) {
  return q ? `${q.text}${q.unit ? " " + q.unit : ""}` : "—";
}

function limitText(req) {
  if (req.min && req.max) return `${req.min.text} to ${req.max.text} ${req.max.unit}`.trim();
  if (req.max) return `max ${req.max.text} ${req.max.unit}`.trim();
  if (req.min) return `min ${req.min.text} ${req.min.unit}`.trim();
  if (req.expected) return req.expected;
  return "—";
}

/**
 * Sum several observations into one interval, for a combined-element limit.
 * An inequality anywhere makes the sum an interval, which is the honest
 * result: "Nb <0.01 plus Ta 0.40" is not 0.41.
 */
function sumIntervals(quantities) {
  let lo = 0n, hi = 0n, loOpen = false, hiOpen = false, loUnbounded = false, hiUnbounded = false;
  for (const q of quantities) {
    const iv = intervalOf(q);
    if (iv.lo === null) loUnbounded = true; else lo += iv.lo;
    if (iv.hi === null) hiUnbounded = true; else hi += iv.hi;
    loOpen = loOpen || iv.loOpen;
    hiOpen = hiOpen || iv.hiOpen;
  }
  return {
    lo: loUnbounded ? null : lo,
    hi: hiUnbounded ? null : hi,
    loOpen, hiOpen,
  };
}

/**
 * Judge one requirement against what the certificate reports.
 * Every branch names the rule it applied, so a result can be explained.
 */
function judge(req, cert, byProperty) {
  const applicability = applies(req, cert);
  if (!applicability.applies) {
    return {
      result: RESULT.NOT_APPLICABLE, rule: "applicability",
      evidence: null, why: `This requirement does not apply: ${applicability.why}.`,
    };
  }

  if (req.kind === KIND.INTERPRETATION) {
    return {
      result: RESULT.REVIEW_REQUIRED, rule: "interpretation",
      evidence: null,
      why: "This clause needs engineering judgement. It is not reduced to a pass or a fail here, " +
           "because a comparison that cannot be made mechanically should not look like one that was.",
    };
  }

  const wanted = req.combines.length ? req.combines : [req.property];
  const found = wanted.map((p) => byProperty.get(p.toLowerCase()) ?? null);

  if (found.some((o) => o === null)) {
    const absent = wanted.filter((p, i) => found[i] === null);
    return {
      result: RESULT.MISSING_EVIDENCE, rule: "missing",
      evidence: null,
      why: `The certificate does not report ${absent.join(", ")}. ` +
           `That is missing evidence, not evidence that the material is wrong.`,
    };
  }

  const unconfirmed = found.filter((o) => !o.confirmed);
  const evidence = found.map((o) => ({
    text: o.text, page: o.source.page, file: o.source.file, quote: o.source.quote, confirmed: o.confirmed,
  }));

  if (req.kind === KIND.DECLARATION) {
    return {
      result: RESULT.MEETS, rule: "declaration present", evidence,
      why: `The certificate carries the required declaration on page ${found[0].source.page}.`,
      unconfirmed: unconfirmed.length,
    };
  }

  if (req.kind === KIND.TEXT) {
    const got = String(found[0].text ?? "").trim();
    const same = got.toLowerCase() === req.expected.toLowerCase();
    return {
      result: same ? RESULT.MEETS : RESULT.DOES_NOT_MEET,
      rule: "exact text",
      evidence,
      why: same
        ? `The certificate states "${got}", which is what the requirement asks for.`
        : `The requirement asks for "${req.expected}" and the certificate states "${got}".`,
      unconfirmed: unconfirmed.length,
    };
  }

  /* ---- numeric ---- */
  const values = found.map((o) => o.value);
  if (values.some((v) => !v || typeof v.scaled !== "bigint")) {
    return {
      result: RESULT.REVIEW_REQUIRED, rule: "unreadable value", evidence,
      why: "The value on the certificate could not be read as a number, so no comparison was made.",
      unconfirmed: unconfirmed.length,
    };
  }

  const limitUnit = req.max ?? req.min;
  for (const v of values) {
    if (v.family !== limitUnit.family) {
      const hardness = ["HB", "HV", "HRC"];
      const bothHardness = hardness.includes(v.family) && hardness.includes(limitUnit.family);
      return {
        result: RESULT.REVIEW_REQUIRED, rule: "units do not convert", evidence,
        why: bothHardness
          ? `The requirement is in ${limitUnit.unit} and the certificate reports ${v.unit}. ` +
            `Hardness scales do not convert: the tables that exist between them are approximations ` +
            `for particular materials, not equivalences. Retest or obtain the result in ${limitUnit.unit}.`
          : `The requirement is in ${limitUnit.unit} and the certificate reports ${v.unit}. ` +
            `There is no exact conversion between them, so nothing was converted.`,
        unconfirmed: unconfirmed.length,
      };
    }
  }

  const combined = req.combines.length > 0;
  const iv = combined ? sumIntervals(values) : intervalOf(values[0]);
  const cover = coverage(iv, req);
  const shown = combined
    ? values.map((v) => v.text).join(" + ")
    : show(values[0]);

  if (cover === "none") {
    return {
      result: RESULT.DOES_NOT_MEET, rule: "outside the limit", evidence,
      why: `The certificate reports ${shown} against ${limitText(req)}.`,
      unconfirmed: unconfirmed.length,
    };
  }

  if (cover === "some") {
    return {
      result: RESULT.REVIEW_REQUIRED, rule: "range straddles the limit", evidence,
      why: `The certificate reports ${shown}, which spans ${limitText(req)} rather than sitting ` +
           `clearly on one side of it. A result reported this way cannot settle the limit either way.`,
      unconfirmed: unconfirmed.length,
    };
  }

  /* The whole interval satisfies the limit. One question left: was the value
     reported precisely enough to be believed at the boundary? */
  if (!combined && values[0].op === "=") {
    const minDp = req.min ? req.min.dp : 0;
    const maxDp = req.max ? req.max.dp : 0;
    const limitDp = minDp > maxDp ? minDp : maxDp;
    if (values[0].dp < limitDp) {
      const per = familyOf(values[0].unit).per;
      const rounded = roundTo(canonical(values[0]), limitDp, per);
      const onBoundary = (req.max && rounded === canonical(req.max)) || (req.min && rounded === canonical(req.min));
      if (onBoundary) {
        return {
          result: RESULT.REVIEW_REQUIRED, rule: "precision cannot settle the boundary", evidence,
          why: `The certificate reports ${shown} to ${values[0].dp} decimal place(s) against a limit ` +
               `stated to ${limitDp}. Rounded, it lands exactly on the limit, so the reported figure ` +
               `cannot tell you which side of it the material is.`,
          unconfirmed: unconfirmed.length,
        };
      }
    }
  }

  return {
    result: RESULT.MEETS, rule: "within the limit", evidence,
    why: `The certificate reports ${shown} against ${limitText(req)}.`,
    unconfirmed: unconfirmed.length,
  };
}

/* -------------------------------------------------------------- conflicts */

/**
 * Two documents asking for different things about the same property.
 *
 * This is surfaced and never resolved. Choosing the tighter limit looks
 * responsible and is still a decision about somebody's drawing that nobody
 * authorised this to make.
 */
export function findConflicts(requirements) {
  const byProperty = new Map();
  for (const r of requirements) {
    const key = r.property.toLowerCase();
    if (!byProperty.has(key)) byProperty.set(key, []);
    byProperty.get(key).push(r);
  }

  const out = [];
  for (const [, group] of byProperty) {
    if (group.length < 2) continue;
    const distinct = new Set(group.map((r) => `${r.min ? r.min.text + r.min.unit : ""}|${r.max ? r.max.text + r.max.unit : ""}|${r.expected ?? ""}`));
    if (distinct.size < 2) continue;
    out.push(Object.freeze({
      property: group[0].property,
      requirements: Object.freeze(group.map((r) => Object.freeze({
        id: r.id, limit: limitText(r), source: r.source,
      }))),
      why: `${group.length} documents state different requirements for ${group[0].property}. ` +
           `Which one governs is a decision for the responsible engineer, not for this comparison.`,
    }));
  }
  return Object.freeze(out);
}

/* ------------------------------------------------------------ the check */

/**
 * Compare a certificate against a set of requirements.
 *
 * @param {object} cert
 * @param {Array}  requirements
 * @param {object} [opts]
 * @param {Array}  [opts.knownLots]  lot keys already recorded, so a repeat is seen
 */
export function checkCertificate(cert, requirements, { knownLots = [] } = {}) {
  const reqs = Array.isArray(requirements) ? requirements : [];
  if (!cert || !cert.number) throw new TypeError("There is no certificate to check");

  const byProperty = new Map();
  for (const o of cert.observations) byProperty.set(o.property.toLowerCase(), o);

  const findings = reqs.map((req) => {
    const j = judge(req, cert, byProperty);
    return Object.freeze({
      id: req.id,
      property: req.property,
      required: limitText(req),
      mandatory: req.mandatory,
      kind: req.kind,
      source: req.source,
      ...j,
      evidence: j.evidence ? Object.freeze(j.evidence.map(Object.freeze)) : null,
    });
  });

  /* ---- what is wrong with the paperwork itself ---- */
  const documentIssues = [];

  if (cert.pagesDeclared !== null && cert.pagesProvided < cert.pagesDeclared) {
    documentIssues.push(Object.freeze({
      id: "pages",
      what: "Pages are missing",
      detail: `The certificate declares ${cert.pagesDeclared} pages and ${cert.pagesProvided} were provided. ` +
              `A requirement could be met or unmet on a page nobody has.`,
    }));
  }

  /* A revision only means something against its own document. Requirements
     here come from several — a specification, a drawing, a purchase order —
     and a drawing at revision B says nothing about a specification at
     revision C. Comparing across documents fires this warning on a perfectly
     ordinary set of inputs, which teaches people to ignore it. */
  if (cert.statedRevision && cert.statedSpecification) {
    const sameDocument = reqs.filter(
      (r) => r.source.document.toLowerCase() === cert.statedSpecification.toLowerCase());
    const mismatched = [...new Set(sameDocument.map((r) => r.source.revision))]
      .filter((rev) => rev.toLowerCase() !== cert.statedRevision.toLowerCase());
    if (mismatched.length) {
      documentIssues.push(Object.freeze({
        id: "revision",
        what: "The specification revision does not match",
        detail: `The certificate states ${cert.statedSpecification} revision ${cert.statedRevision}; ` +
                `${sameDocument.length} requirement(s) below come from revision ${mismatched.join(", ")} ` +
                `of the same document. Revisions change limits, so those comparisons may be against the ` +
                `wrong ones.`,
      }));
    }
  }

  if (!cert.producerIdentified) {
    documentIssues.push(Object.freeze({
      id: "producer",
      what: "The producer is not identified",
      detail: `The certificate was issued by ${cert.issuer ?? "an unnamed party"}` +
              (cert.distributor ? ` and supplied through ${cert.distributor}` : "") +
              `, and does not name the mill that made the material. Nothing here can be attributed ` +
              `to a producer, and this lot cannot join a producer's record.`,
    }));
  }

  const unconfirmed = cert.observations.filter((o) => !o.confirmed);
  if (unconfirmed.length) {
    documentIssues.push(Object.freeze({
      id: "unconfirmed",
      what: `${unconfirmed.length} value(s) have not been confirmed against the document`,
      detail: `Extracted values are a reading of the certificate, not the certificate. ` +
              `Until somebody confirms each one, every result resting on them is provisional.`,
    }));
  }

  const key = lotKey(cert);
  const repeat = key !== null && knownLots.includes(key);
  if (key === null) {
    documentIssues.push(Object.freeze({
      id: "lot",
      what: "The lot cannot be identified",
      detail: "No heat or cast number is recorded, so this certificate cannot be tied to a " +
              "specific lot of material, and it cannot be counted as one.",
    }));
  }

  /* ---- the overall state ---- */
  const counts = {};
  for (const r of Object.values(RESULT)) counts[r] = 0;
  for (const f of findings) counts[f.result]++;

  const failedMandatory = findings.filter((f) => f.mandatory && f.result === RESULT.DOES_NOT_MEET);
  const missingMandatory = findings.filter((f) => f.mandatory && f.result === RESULT.MISSING_EVIDENCE);
  const reviewMandatory = findings.filter((f) => f.mandatory && f.result === RESULT.REVIEW_REQUIRED);

  let overall = OVERALL.MEETS_CHECKED;
  const worse = (candidate) => { if (OVERALL_RANK[candidate] > OVERALL_RANK[overall]) overall = candidate; };

  if (reviewMandatory.length) worse(OVERALL.REVIEW_REQUIRED);
  if (missingMandatory.length) worse(OVERALL.INCOMPLETE_EVIDENCE);
  if (documentIssues.some((d) => d.id === "pages" || d.id === "unconfirmed" || d.id === "lot")) {
    worse(OVERALL.INCOMPLETE_EVIDENCE);
  }
  if (documentIssues.some((d) => d.id === "revision")) worse(OVERALL.REVIEW_REQUIRED);
  if (failedMandatory.length) worse(OVERALL.POTENTIAL_NONCONFORMANCE);

  const checked = findings.filter((f) => f.result !== RESULT.NOT_APPLICABLE).length;

  return Object.freeze({
    certificate: cert,
    rulesVersion: RULES_VERSION,
    findings: Object.freeze(findings),
    documentIssues: Object.freeze(documentIssues),
    counts: Object.freeze(counts),
    checked,
    overall,
    /* Kept prominent and separate: the single worst thing found. */
    headline: failedMandatory.length
      ? Object.freeze({
        kind: "nonconformance",
        text: `${failedMandatory.length} mandatory requirement(s) are not met: ` +
              `${failedMandatory.map((f) => f.property).join(", ")}.`,
      })
      : missingMandatory.length
        ? Object.freeze({
          kind: "missing",
          text: `${missingMandatory.length} mandatory requirement(s) have no evidence on the certificate: ` +
                `${missingMandatory.map((f) => f.property).join(", ")}.`,
        })
        : reviewMandatory.length
          ? Object.freeze({
            kind: "review",
            text: `${reviewMandatory.length} requirement(s) could not be settled from what is written: ` +
                  `${reviewMandatory.map((f) => f.property).join(", ")}.`,
          })
          : null,
    lotKey: key,
    /* A certificate re-uploaded, or revised, is the same lot as before. */
    repeatOfKnownLot: repeat,
    supersedes: cert.supersedes,
    conflicts: findConflicts(reqs),
    statement:
      `${checked} requirement(s) checked against ${cert.number}` +
      (cert.revision ? ` revision ${cert.revision}` : "") + ". " +
      (overall === OVERALL.MEETS_CHECKED
        ? "Every applicable requirement checked here is met by the values on the certificate. " +
          "That is a comparison of documents, and it is not a release of the material."
        : `Overall: ${overall}.`),
    method:
      "Every reported value is treated as the range it actually covers, so an inequality that spans a " +
      "limit is reported as unsettled rather than resolved. Units convert only where the conversion is " +
      "exact, and hardness scales never convert. A value reported more coarsely than its limit cannot " +
      "settle the boundary and says so. The overall state is the worst of its parts, never an average: " +
      "one unmet mandatory requirement is the answer regardless of how many others pass. A requirement " +
      "the certificate does not report is missing evidence, not a failure. " +
      `Comparison rules version ${RULES_VERSION}.`,
    disclaimer:
      "This compares a certificate against stated requirements. It does not establish that the material " +
      "is what the certificate says it is, that it is in the stated condition, that the correct heat was " +
      "delivered, or that it is fit for its purpose. It cannot release material for manufacture or " +
      "installation, and no result here is an approval.",
  });
}

/* ---------------------------------------------------------------- review */

export const DISPOSITION = Object.freeze({
  ACCEPT: "accepted",
  REJECT: "rejected",
  CONCESSION: "accepted under concession",
  PENDING: "pending",
});

/**
 * A person's decision, recorded beside the machine's findings and never
 * mistaken for them.
 *
 * The reviewer is required, the reasoning is required, and a disposition that
 * disagrees with the comparison is allowed — that is what a concession is —
 * but it is recorded as a disagreement rather than overwriting the finding.
 */
export function recordReview(check, input = {}) {
  const reviewer = String(input.reviewer ?? "").trim();
  const reasoning = String(input.reasoning ?? "").trim();
  const disposition = input.disposition;

  if (!reviewer) throw new TypeError("A review decision needs the person making it");
  if (!Object.values(DISPOSITION).includes(disposition)) {
    throw new RangeError(`Unknown disposition ${JSON.stringify(disposition)}`);
  }
  if (disposition !== DISPOSITION.PENDING && !reasoning) {
    throw new TypeError("A decision needs its reasoning. A disposition with no reason cannot be audited.");
  }

  /* Does the decision follow from what the comparison found?
     A concession never does — accepting material that did not meet a
     requirement is the definition of one — but it departs deliberately and
     carries its own reference. A plain acceptance over a nonconformance
     departs too, and nothing says the reviewer noticed. Both are recorded as
     departures; only one is marked deliberate. */
  const agrees = disposition === DISPOSITION.ACCEPT
    ? check.overall === OVERALL.MEETS_CHECKED
    : disposition === DISPOSITION.REJECT
      ? check.overall === OVERALL.POTENTIAL_NONCONFORMANCE
      : disposition === DISPOSITION.PENDING;

  return Object.freeze({
    reviewer,
    disposition,
    reasoning: reasoning || null,
    at: String(input.at ?? "").trim() || null,
    /* What was true when the decision was made, so a later re-check that
       reaches a different answer does not silently rewrite history. */
    against: Object.freeze({
      certificate: check.certificate.number,
      certificateRevision: check.certificate.revision,
      overall: check.overall,
      rulesVersion: check.rulesVersion,
      checked: check.checked,
    }),
    /* Stated rather than prevented: a reviewer may accept material the
       comparison flagged, and that is a concession somebody signed for. */
    departsFromFindings: !agrees,
    deliberate: disposition === DISPOSITION.CONCESSION,
    note: !agrees
      ? (disposition === DISPOSITION.CONCESSION
        ? `A concession departs from the comparison by design: it accepts material against a finding of ` +
          `${check.overall}, on the reviewer's reasoning and under their reference.`
        : `This decision differs from the comparison, which found: ${check.overall}. ` +
          `The decision stands on the reviewer's reasoning, not on the comparison.`)
      : null,
  });
}

/**
 * The audit trail for one lot: the checks run against it and the decisions
 * taken, in order, each naming the rules version it was produced under.
 */
export function auditTrail(entries = []) {
  const rows = entries.map((e, i) => Object.freeze({
    seq: i + 1,
    at: e.at ?? null,
    what: e.kind,
    detail: e.detail ?? null,
    rulesVersion: e.rulesVersion ?? null,
    by: e.by ?? null,
  }));
  return Object.freeze(rows);
}

/**
 * Mark earlier results superseded rather than editing them.
 *
 * A report that concluded something on Tuesday still concluded it. Changing
 * the inputs produces a new report; it does not retrospectively change what
 * the old one said, and a saved conclusion that silently mutates is worse
 * than no saved conclusion.
 */
export function supersede(previous, next) {
  return Object.freeze({
    superseded: Object.freeze({ ...previous, supersededBy: next.certificate.number, active: false }),
    active: next,
    why: "The earlier result is kept as it was and marked superseded. Its conclusions were reached " +
         "against the inputs it had, and rewriting them would destroy the record of what was decided.",
  });
}
