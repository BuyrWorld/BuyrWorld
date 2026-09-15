/**
 * Engineering requirements: tolerances, finishes, specifications and the
 * questions nobody has answered yet.
 *
 * Increment C1 of the v4 roadmap, whose value is stated as: "Enter tolerances,
 * finishes, specs and unresolved questions, **even without geometry**". That
 * qualifier is the whole design. A buyer preparing a part for technical review
 * knows the material and the finish long before anyone has modelled it, and
 * making them wait for a CAD kernel to write down "anodise to 25µm except the
 * bore" would be the tool getting in the way.
 *
 * So nothing here needs a model. A requirement names a target, and a target is
 * either the whole part or a feature identified by a stable id. If the feature
 * does not exist yet, the requirement is still recorded and reports itself as
 * waiting for one.
 *
 * Four rules the code enforces rather than documents.
 *
 * 1. **A cited standard is not its contents.** `design/06-PART-BUILDER-AND-REVIEW.md`
 *    is explicit: "A cited standard name alone does not give the tool its
 *    limits". Naming a specification records the citation; it does not fetch
 *    limits, and the requirement stays `unverified` until somebody supplies
 *    the clause text they are working from. There is no table of standards in
 *    this file and there must never be one.
 *
 * 2. **No silent universal tolerance.** A dimension with no stated limits has
 *    no limits, not the ones a general note might imply. Where a general
 *    tolerance exists it is a requirement in its own right with its own scope,
 *    and which one wins on a given dimension is recorded, never inferred.
 *
 * 3. **Limits are exact.** A tolerance is a dimension, and this is a repository
 *    that does not do floating point on dimensions. Everything is integer
 *    nanometres — micrometres cannot hold one thou — and the three ways of
 *    writing the same tolerance —
 *    symmetric, asymmetric, and a pair of absolute limits — reduce to one
 *    representation so they cannot disagree.
 *
 * 4. **A conflict is reported, never resolved.** Two requirements that cannot
 *    both hold are a question for a person. Picking one would be inventing an
 *    engineering decision.
 */

import { LENGTH_UNITS } from "../calc/units.mjs";
import { serialise, deserialise } from "../services/outcome-store.mjs";

/* Nanometres per unit, for deviations only.
 *
 * units.mjs works in micrometres and should: it measures parts, and a part
 * dimension in nanometres is pointless precision. A deviation is three orders
 * of magnitude smaller than the thing it qualifies, and micrometres cannot
 * hold one thou — 0.001 in is 25.4 µm. In nanometres it is 25 400 exactly, a
 * tenth is 2 540, and 0.00001 in is 254. Everything a person can reasonably
 * write as a tolerance lands on an integer.
 *
 * Derived from the existing table rather than retyped, so the two can never
 * drift apart on what an inch is. */
const NM = Object.freeze(Object.fromEntries(
  Object.entries(LENGTH_UNITS).map(([u, per]) => [u, per * 1000n])));

/* ------------------------------------------------------------------ kinds */

/** What a requirement is about. Each has its own required fields. */
export const KIND = Object.freeze({
  DIMENSIONAL: "dimensional-tolerance",
  GENERAL_TOLERANCE: "general-tolerance",
  GEOMETRIC: "geometric-control",
  SURFACE_TEXTURE: "surface-texture",
  FINISH: "finish-coating",
  EDGE: "edge-condition",
  PROCESS: "other-process",
  INSPECTION: "inspection-certification",
});

/** How much of the part a requirement covers. */
export const SCOPE = Object.freeze({
  PART: "whole-part",
  FEATURE: "feature",
  FACES: "selected-faces",
  ALL_EXCEPT: "all-except",
});

/** Whether the tool has been given enough to stand behind it. */
export const VERIFICATION = Object.freeze({
  /* Somebody supplied the clause or the limits they are working from. */
  SOURCED: "sourced",
  /* A specification is cited and its contents were not supplied. The
     requirement is real; what it requires is not known here. */
  UNVERIFIED: "unverified",
  /* Explicitly flagged for the reviewer to answer. */
  QUESTION: "flagged-for-review",
});

export const ATTACHMENT = Object.freeze({
  OK: "attached",
  WAITING: "no-feature-yet",
  DETACHED: "needs-reattachment",
});

export const SCHEMA_VERSION = 1;

/* ------------------------------------------------------- exact deviations */

/**
 * A signed decimal to integer nanometres. Exact for every unit in the table.
 *
 * `units.mjs` refuses a negative length, correctly — a part cannot be −3mm
 * wide. A deviation is not a length: −0.1mm is an ordinary lower limit, so the
 * sign is carried here rather than rejected.
 */
export function deviationNm(value, unit) {
  const text = String(value ?? "").trim();
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) {
    throw new RangeError(`"${value}" is not a plain decimal like 0.05 or -0.1`);
  }
  const per = NM[String(unit ?? "").trim()];
  if (per === undefined) {
    throw new RangeError(
      `"${unit}" is not a unit this understands. Known: ${Object.keys(NM).join(", ")}.`);
  }

  const frac = m[3] ?? "";
  /* Scale by the decimals given, multiply, then divide — in that order, so
     0.0005 in is exact rather than rounded through an intermediate. */
  const scaled = BigInt(m[2] + frac);
  const divisor = 10n ** BigInt(frac.length);
  const product = scaled * per;
  if (product % divisor !== 0n) {
    /* Below a nanometre. Nothing a person writes as a tolerance lands here,
       so this is a typo rather than a limitation being hit. */
    throw new RangeError(
      `${value}${unit} is finer than a nanometre, which is smaller than this can hold exactly. ` +
      `Check the decimal places.`);
  }
  const mag = product / divisor;
  return m[1] === "-" ? -mag : mag;
}

/** Nanometres back to a decimal string in the given unit, trailing zeros trimmed. */
export function nmToDecimal(um, unit) {
  const per = NM[String(unit ?? "").trim()];
  if (per === undefined) throw new RangeError(`"${unit}" is not a unit this understands`);
  const neg = um < 0n;
  const abs = neg ? -um : um;
  const whole = abs / per;
  const rem = abs % per;
  if (rem === 0n) return `${neg ? "-" : ""}${whole}`;
  /* Enough decimals to hold the remainder exactly for these unit factors. */
  const digits = String(per).length - 1 + 3;
  const frac = String((rem * 10n ** BigInt(digits)) / per).padStart(digits, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/* ------------------------------------------------------------- tolerance */

/**
 * The three ways of writing the same tolerance, reduced to one.
 *
 *   symmetric   nominal 10, plus/minus 0.1        -> 9.9 … 10.1
 *   asymmetric  nominal 10, +0.2 / -0.1           -> 9.9 … 10.2
 *   limits      9.9 and 10.2 stated outright      -> 9.9 … 10.2
 *
 * All three produce the same upper and lower in nanometres, so a schedule
 * cannot show two requirements that look different and mean the same thing —
 * or worse, look the same and differ in the last decimal place.
 *
 * There is no default. `design/06-…`: "No silent universal tolerance."
 */
export function tolerance(input = {}) {
  const unit = String(input.unit ?? "").trim();
  if (!unit) throw new RangeError("A tolerance needs a unit. A number on its own is not a limit.");
  if (input.nominal === undefined || input.nominal === null || input.nominal === "") {
    throw new RangeError("A tolerance needs the nominal size it applies to.");
  }

  const nominalNm = deviationNm(input.nominal, unit);
  if (nominalNm < 0n) throw new RangeError("A nominal size cannot be negative.");

  let upperNm;
  let lowerNm;
  let form;

  if (input.plusMinus !== undefined && input.plusMinus !== null && input.plusMinus !== "") {
    const d = deviationNm(input.plusMinus, unit);
    if (d < 0n) throw new RangeError("A plus/minus tolerance is written once, without a sign.");
    upperNm = d;
    lowerNm = -d;
    form = "symmetric";
  } else if (input.upper !== undefined && input.lower !== undefined) {
    upperNm = deviationNm(input.upper, unit);
    lowerNm = deviationNm(input.lower, unit);
    form = "asymmetric";
  } else if (input.maximum !== undefined && input.minimum !== undefined) {
    const max = deviationNm(input.maximum, unit);
    const min = deviationNm(input.minimum, unit);
    upperNm = max - nominalNm;
    lowerNm = min - nominalNm;
    form = "limits";
  } else {
    throw new RangeError(
      "State the tolerance one of three ways: plus/minus, an upper and a lower deviation, " +
      "or a maximum and a minimum. A dimension with no stated limits has none.");
  }

  if (upperNm < lowerNm) {
    throw new RangeError(
      `The upper limit is below the lower one (${nmToDecimal(upperNm, unit)} against ` +
      `${nmToDecimal(lowerNm, unit)}${unit}). Check which way round they go.`);
  }

  return Object.freeze({
    unit, form,
    nominalNm,
    upperNm, lowerNm,
    maximumNm: nominalNm + upperNm,
    minimumNm: nominalNm + lowerNm,
    /* The width of the band, which is what a supplier actually prices. */
    bandNm: upperNm - lowerNm,
    text: `${nmToDecimal(nominalNm, unit)}${unit} ` + (
      form === "symmetric"
        ? `±${nmToDecimal(upperNm, unit)}`
        : `${upperNm >= 0n ? "+" : ""}${nmToDecimal(upperNm, unit)} / ${nmToDecimal(lowerNm, unit)}`),
    range: `${nmToDecimal(nominalNm + lowerNm, unit)} … ${nmToDecimal(nominalNm + upperNm, unit)}${unit}`,
  });
}

/* ------------------------------------------------------------ the record */

/** Fields each kind must have before it says anything useful. */
const REQUIRED = Object.freeze({
  [KIND.DIMENSIONAL]: ["tolerance"],
  [KIND.GENERAL_TOLERANCE]: ["convention"],
  [KIND.GEOMETRIC]: ["characteristic", "value"],
  [KIND.SURFACE_TEXTURE]: ["parameter", "value"],
  [KIND.FINISH]: ["process"],
  [KIND.EDGE]: ["condition"],
  [KIND.PROCESS]: ["process"],
  [KIND.INSPECTION]: ["requirement"],
});

let minted = 0;
export function newRequirementId() {
  return `REQ-${Date.now().toString(36)}-${(minted++).toString(36).padStart(3, "0")}`;
}

/**
 * One requirement.
 *
 * @param {object} input
 * @param {string} input.kind        KIND.*
 * @param {object} [input.scope]     { type, featureId?, faces?, except? }
 * @param {object} [input.spec]      { name, revision, clause?, text? }
 * @param {string} [input.source]    where the person got this from
 */
export function requirement(input = {}) {
  const kind = String(input.kind ?? "").trim();
  if (!REQUIRED[kind]) {
    throw new RangeError(`"${kind}" is not a kind of requirement this holds. ` +
      `Known: ${Object.keys(REQUIRED).join(", ")}.`);
  }

  const scope = normaliseScope(input.scope);
  const spec = input.spec ? normaliseSpec(input.spec) : null;

  /* What is missing, per kind, without guessing at any of it. */
  const missing = REQUIRED[kind].filter((f) => {
    const v = input[f];
    return v === undefined || v === null || v === "";
  });

  return Object.freeze({
    schema: SCHEMA_VERSION,
    id: input.id ?? newRequirementId(),
    kind,
    scope,
    spec,
    source: input.source ?? null,
    note: input.note ?? null,

    /* The kind's own fields, kept as given. */
    tolerance: input.tolerance ?? null,
    convention: input.convention ?? null,
    characteristic: input.characteristic ?? null,
    datums: Object.freeze([...(input.datums ?? [])]),
    parameter: input.parameter ?? null,
    value: input.value ?? null,
    valueUnit: input.valueUnit ?? null,
    process: input.process ?? null,
    designation: input.designation ?? null,
    thickness: input.thickness ?? null,
    condition: input.condition ?? null,
    requirement: input.requirement ?? null,

    missing: Object.freeze(missing),
    verification: verificationOf(input, spec),
    question: input.question ?? null,

    createdBy: input.createdBy ?? null,
    createdAt: input.createdAt ?? null,
    /* The model revision this was attached against, so a later geometry change
       can tell whether the attachment still means what it meant. */
    modelRevision: input.modelRevision ?? null,
  });
}

function normaliseScope(scope) {
  const s = scope ?? { type: SCOPE.PART };
  const type = String(s.type ?? SCOPE.PART);
  if (!Object.values(SCOPE).includes(type)) {
    throw new RangeError(`"${type}" is not a scope this understands.`);
  }
  if (type === SCOPE.FEATURE && !s.featureId) {
    throw new RangeError("A requirement scoped to a feature needs the feature's id.");
  }
  if (type === SCOPE.FACES && !(s.faces && s.faces.length)) {
    throw new RangeError("A requirement scoped to selected faces needs at least one face.");
  }
  if (type === SCOPE.ALL_EXCEPT && !(s.except && s.except.length)) {
    /* "All surfaces except" with nothing excepted is "all surfaces", and
       saying it the long way hides that from anyone reading the schedule. */
    throw new RangeError(
      'Scope "all except" needs the exceptions listed. With nothing excepted it is simply all surfaces.');
  }
  return Object.freeze({
    type,
    featureId: s.featureId ?? null,
    faces: Object.freeze([...(s.faces ?? [])]),
    except: Object.freeze([...(s.except ?? [])]),
    describedAs: s.describedAs ?? null,
  });
}

function normaliseSpec(spec) {
  const name = String(spec.name ?? "").trim();
  if (!name) throw new RangeError("A specification reference needs its identifier.");
  return Object.freeze({
    name,
    /* Absent revision is not "the current one". A specification without its
       revision does not identify a document. */
    revision: spec.revision ? String(spec.revision).trim() : null,
    clause: spec.clause ? String(spec.clause).trim() : null,
    /* The text the person is actually working from. Its presence is what
       separates a citation from a requirement this tool can stand behind. */
    text: spec.text ? String(spec.text) : null,
  });
}

/**
 * Whether the tool has been given enough to stand behind the requirement.
 *
 * Citing a standard records a citation. It does not import the standard's
 * contents, and nothing in this repository knows them. So a requirement that
 * leans on a specification without the clause text is `unverified` — real, and
 * explicitly not something the tool can check against.
 */
function verificationOf(input, spec) {
  if (input.question) return VERIFICATION.QUESTION;
  if (!spec) return VERIFICATION.SOURCED;
  if (spec.text) return VERIFICATION.SOURCED;
  return VERIFICATION.UNVERIFIED;
}

/* ------------------------------------------------------------ attachment */

/**
 * Whether each requirement still points at something that exists.
 *
 * `design/06-…`: "Do not silently transfer a tolerance to a different hole or
 * a finish to a new face." Nothing here moves a requirement. It reports which
 * ones have lost their target so a person can decide.
 *
 * @param {Array}  list        requirements
 * @param {Set|Array} features feature ids that currently exist
 */
export function attachments(list, features = []) {
  const have = features instanceof Set ? features : new Set(features);
  /* No feature list at all is a part with no model yet, which is the normal
     state for C1 — not a part whose every feature has just been deleted. */
  const modelled = have.size > 0;

  return Object.freeze(list.map((r) => {
    if (r.scope.type === SCOPE.PART) return mark(r, ATTACHMENT.OK);
    const wanted = r.scope.type === SCOPE.FEATURE
      ? [r.scope.featureId]
      : [...r.scope.faces, ...r.scope.except];
    if (!modelled) return mark(r, ATTACHMENT.WAITING, wanted);
    const lost = wanted.filter((f) => !have.has(f));
    return lost.length === 0 ? mark(r, ATTACHMENT.OK) : mark(r, ATTACHMENT.DETACHED, lost);
  }));
}

const mark = (r, state, targets = []) => Object.freeze({
  id: r.id, kind: r.kind, state,
  targets: Object.freeze([...targets]),
  why: state === ATTACHMENT.DETACHED
    ? `${targets.join(", ")} no longer exists on the part, so this requirement has no target.`
    : state === ATTACHMENT.WAITING
      ? "There is no model yet, so this cannot be checked against a feature."
      : null,
});

/* ------------------------------------------------------------- conflicts */

/**
 * Requirements that cannot both hold, reported and never resolved.
 *
 * Choosing between two tolerances on the same dimension is an engineering
 * decision. A tool that picks one has made that decision on somebody's behalf
 * and hidden it.
 */
export function conflicts(list) {
  const out = [];

  /* Two requirements of the same kind on the same target. */
  const byTarget = new Map();
  for (const r of list) {
    const key = `${r.kind}::${targetKey(r.scope)}`;
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key).push(r);
  }
  for (const [, group] of byTarget) {
    if (group.length < 2) continue;
    if (group[0].kind === KIND.DIMENSIONAL) {
      const bands = group.map((r) => (r.tolerance ? r.tolerance.bandNm : null));
      const same = bands.every((b) => b !== null && b === bands[0]);
      if (same) continue;    // identical limits stated twice is untidy, not a conflict
    }
    out.push(Object.freeze({
      type: "duplicate-target",
      ids: Object.freeze(group.map((r) => r.id)),
      kind: group[0].kind,
      target: targetKey(group[0].scope),
      why: `${group.length} ${labelOfKind(group[0].kind)} requirements apply to the same target and do not agree.`,
    }));
  }

  /* A specific tolerance where a general tolerance also applies. Not an error
     — it is the ordinary case — but which one governs has to be recorded
     rather than assumed, so it is surfaced until somebody says. */
  const general = list.filter((r) => r.kind === KIND.GENERAL_TOLERANCE);
  const specific = list.filter((r) => r.kind === KIND.DIMENSIONAL);
  for (const g of general) {
    for (const s of specific) {
      if (!overlaps(g.scope, s.scope)) continue;
      if (s.note && /general|overrid/i.test(s.note)) continue;   // precedence stated
      out.push(Object.freeze({
        type: "precedence-unstated",
        ids: Object.freeze([s.id, g.id]),
        kind: KIND.DIMENSIONAL,
        target: targetKey(s.scope),
        why: "A specific tolerance and a general tolerance both cover this. "
          + "Say which governs — it is not assumed.",
      }));
    }
  }

  /* The same specification cited at two different revisions. */
  const revs = new Map();
  for (const r of list) {
    if (!r.spec || !r.spec.revision) continue;
    if (!revs.has(r.spec.name)) revs.set(r.spec.name, new Map());
    const m = revs.get(r.spec.name);
    if (!m.has(r.spec.revision)) m.set(r.spec.revision, []);
    m.get(r.spec.revision).push(r.id);
  }
  for (const [name, m] of revs) {
    if (m.size < 2) continue;
    out.push(Object.freeze({
      type: "specification-revision",
      ids: Object.freeze([...m.values()].flat()),
      kind: null,
      target: name,
      why: `${name} is cited at ${[...m.keys()].join(" and ")}. Two revisions of one specification `
        + "cannot both apply.",
    }));
  }

  return Object.freeze(out);
}

const targetKey = (scope) => {
  if (scope.type === SCOPE.PART) return "the whole part";
  if (scope.type === SCOPE.FEATURE) return scope.featureId;
  if (scope.type === SCOPE.FACES) return [...scope.faces].sort().join("+");
  return `all except ${[...scope.except].sort().join("+")}`;
};

function overlaps(a, b) {
  if (a.type === SCOPE.PART || b.type === SCOPE.PART) return true;
  const setOf = (s) => new Set(s.type === SCOPE.FEATURE ? [s.featureId] : s.faces);
  const x = setOf(a);
  for (const f of setOf(b)) if (x.has(f)) return true;
  return false;
}

export function labelOfKind(kind) {
  return {
    [KIND.DIMENSIONAL]: "dimensional tolerance",
    [KIND.GENERAL_TOLERANCE]: "general tolerance",
    [KIND.GEOMETRIC]: "geometric control",
    [KIND.SURFACE_TEXTURE]: "surface texture",
    [KIND.FINISH]: "finish or coating",
    [KIND.EDGE]: "edge condition",
    [KIND.PROCESS]: "process",
    [KIND.INSPECTION]: "inspection or certification",
  }[kind] ?? kind;
}

/* ----------------------------------------------------------- persistence */

/**
 * A requirement to text, and back.
 *
 * Every limit is a BigInt and JSON.stringify throws on those, so a record
 * could not be stored at all — which is this increment's own exit gate.
 * The tagging format is the one outcome-store.mjs already uses; a second
 * format for the same problem would be one more thing to get wrong.
 */
export function serialiseRequirements(list) {
  return serialise(list);
}

/**
 * Text back to requirements, rebuilt through requirement() rather than
 * trusted as-is, so a record written by an older build comes back with
 * today's shape — and one that cannot be rebuilt is dropped rather than
 * half-read.
 */
export function deserialiseRequirements(text) {
  let raw;
  try {
    raw = deserialise(text);
  } catch {
    return Object.freeze({ requirements: Object.freeze([]), unreadable: 1,
      why: Object.freeze(["The stored requirements were not readable text."]) });
  }
  if (!Array.isArray(raw)) {
    return Object.freeze({ requirements: Object.freeze([]), unreadable: 0,
      why: Object.freeze([]) });
  }

  const out = [];
  const why = [];
  for (const r of raw) {
    try {
      out.push(requirement(r));
    } catch (e) {
      why.push(`${(r && r.id) || "a requirement"} could not be read: ${e.message}`);
    }
  }
  return Object.freeze({
    requirements: Object.freeze(out),
    unreadable: why.length,
    why: Object.freeze(why),
  });
}

/* -------------------------------------------------------------- schedule */

/**
 * The state of a set of requirements, for the reviewer and for the buyer.
 *
 * Both audiences are named in the acceptance checks: "A junior user can
 * identify what to ask the reviewer; a technical reviewer can find limits,
 * scopes, sources and unresolved questions." So this reports what is
 * incomplete as plainly as what is settled.
 */
export function schedule(list, features = []) {
  const attach = attachments(list, features);
  const byId = new Map(attach.map((a) => [a.id, a]));
  const clash = conflicts(list);

  const incomplete = list.filter((r) => r.missing.length > 0);
  const unverified = list.filter((r) => r.verification === VERIFICATION.UNVERIFIED);
  const questions = list.filter((r) => r.verification === VERIFICATION.QUESTION);
  const detached = attach.filter((a) => a.state === ATTACHMENT.DETACHED);
  const waiting = attach.filter((a) => a.state === ATTACHMENT.WAITING);

  return Object.freeze({
    total: list.length,
    rows: Object.freeze(list.map((r) => Object.freeze({
      id: r.id,
      kind: r.kind,
      label: labelOfKind(r.kind),
      target: targetKey(r.scope),
      limits: r.tolerance ? r.tolerance.range : null,
      stated: r.tolerance ? r.tolerance.text : null,
      spec: r.spec ? `${r.spec.name}${r.spec.revision ? ` rev ${r.spec.revision}` : " (no revision given)"}` : null,
      verification: r.verification,
      attachment: byId.get(r.id) ? byId.get(r.id).state : ATTACHMENT.OK,
      missing: r.missing,
      source: r.source,
    }))),
    conflicts: clash,
    incomplete: Object.freeze(incomplete.map((r) => r.id)),
    unverified: Object.freeze(unverified.map((r) => r.id)),
    questions: Object.freeze(questions.map((r) => r.id)),
    detached: Object.freeze(detached.map((a) => a.id)),
    waitingForGeometry: Object.freeze(waiting.map((a) => a.id)),

    /* One sentence a person can act on, or null when there is nothing to do.
       Ordered by what blocks a review soonest. */
    nextQuestion: clash.length
      ? clash[0].why
      : incomplete.length
        ? `${incomplete.length} requirement(s) are missing a value: ${incomplete.map((r) => r.missing.join(", ")).join("; ")}.`
        : detached.length
          ? `${detached.length} requirement(s) no longer point at anything on the part.`
          : unverified.length
            ? `${unverified.length} requirement(s) cite a specification whose text nobody has supplied, so their limits are not known here.`
            : null,

    /* Whether this set could go to a reviewer as it stands. Never "approved" —
       that is a decision made by people, not a state this computes. */
    readyToRequestReview: clash.length === 0 && incomplete.length === 0 && detached.length === 0,
  });
}
