/**
 * Reading a tolerance off a drawing.
 *
 * `specs/03-FILE-INTELLIGENCE.md`, engineering fields: *"symmetric/asymmetric
 * tolerances, limit dimensions… Distinguish explicitly marked tolerances from
 * a general title-block tolerance; show applicability as unconfirmed until
 * reviewed. Missing is not zero and nominal is not measured."*
 *
 * `src/studio/requirements.mjs` already holds a tolerance exactly — three
 * notations reduced to one band in nanometres, so two requirements cannot look
 * different and mean the same thing. Micrometres would not do: one thou is
 * 25.4µm, and a tenth of a thou is 2.54µm, so a unit that cannot divide by ten
 * loses imperial tolerances in the last place.
 *
 * What was missing is only the reading. This turns what is printed into what
 * that module already understands, and refuses everything else out loud.
 *
 * Two refusals matter more than the parsing:
 *
 *   - **A general tolerance is not applied to anything.** A title block
 *     saying ISO 2768-m governs every dimension that has no tolerance of its
 *     own — which ones those are is a question about the drawing, not about
 *     the text, and answering it here would put limits on features nobody
 *     checked. It comes back as a general requirement whose applicability is
 *     explicitly unconfirmed.
 *   - **A class is not a number.** "ISO 2768-m" is a citation. The deviations
 *     it implies depend on the nominal size and on a table this product does
 *     not carry, and inventing them would be the worst kind of plausible.
 *     `VERIFICATION.UNVERIFIED` is the existing word for exactly this: the
 *     requirement is real, what it requires is not known here.
 *
 * No floating point anywhere: everything is text in and BigInt out, through
 * `deviationNm`.
 */

import { tolerance as exactTolerance, deviationNm, nmToDecimal,
         KIND, VERIFICATION } from "../studio/requirements.mjs";

/** How the tolerance was written. */
export const FORM = Object.freeze({
  /* ±0.1 — one deviation both ways. */
  SYMMETRIC: "symmetric",
  /* +0.2 / -0.05 — two deviations. */
  ASYMMETRIC: "asymmetric",
  /* 10.05 / 9.95 — the limits stated outright, no nominal needed. */
  LIMITS: "limits",
  /* ISO 2768-m and its relatives. A citation, not a band. */
  CLASS: "class",
  /* Read, and not a tolerance this understands. Kept, never guessed at. */
  UNREADABLE: "unreadable",
});

/** Who the tolerance is about. */
export const APPLIES = Object.freeze({
  /* Printed against one dimension. It governs that dimension. */
  MARKED: "marked-on-a-dimension",
  /* In the title block. It governs whatever has nothing of its own, and
     which dimensions those are is not a question about this text. */
  GENERAL: "general-until-reviewed",
});

/** Why a tolerance could not be read. Reported, never silently dropped. */
export const REFUSED = Object.freeze({
  EMPTY: "nothing was written",
  GEOMETRIC: "a geometric control rather than a size tolerance",
  NOT_A_TOLERANCE: "not a tolerance this reads",
  BACKWARDS: "the upper limit is below the lower one",
  TOO_FINE: "finer than this can hold exactly",
});

/**
 * Tolerance classes that name a standard rather than a number.
 *
 * Recognised so they can be reported as citations. The tables behind them are
 * not here, and a deviation invented from a remembered table would be the
 * most plausible wrong number this product could produce.
 */
const CLASSES = Object.freeze([
  /ISO\s*2768\s*-?\s*([a-zA-Z]{1,2})\b/,
  /DIN\s*7168\s*-?\s*([a-zA-Z]{1,2})?/,
  /EN\s*22768\s*-?\s*([a-zA-Z]{1,2})?/,
  /ASME\s*Y\s*14\.5(?:\s*-\s*\d{4})?/,
  /ISO\s*8015\b/,
]);

/**
 * Symbols that mean a geometric control.
 *
 * `specs/03`: *"GD&T and standards clauses outside the supported semantic
 * parser remain raw review items, not invented interpretations."* A flatness
 * callout is not a size tolerance and must not be turned into one — the
 * number beside it is a zone, not a deviation from a nominal, and reading it
 * as ± would silently widen or narrow a real requirement.
 */
const GEOMETRIC = /[⌀⏥⏤◎⊥∥∠⌭⌒⌓⌯⌖◯⟂]|\bGD&T\b|\b(?:flatness|perpendicularity|concentricity|runout|profile|true\s*position)\b/i;

/** A plain decimal, the only number shape `deviationNm` accepts. */
const NUM = "\\d+(?:\\.\\d+)?";

/** Normalise the ways a drawing writes plus-or-minus. */
const flatten = (text) =>
  String(text ?? "")
    .replace(/[±]/g, "+/-")
    .replace(/[−–—]/g, "-")   // minus sign, en dash, em dash
    .replace(/\s+/g, " ")
    .trim();

/**
 * Read printed tolerance text.
 *
 * Returns what was written, in the shape `requirements.mjs` takes. It does not
 * compute a band: that needs the nominal, and a tolerance whose nominal is
 * unknown is still a tolerance worth recording.
 */
export function readTolerance(text) {
  const said = flatten(text);
  if (!said) return refuse(REFUSED.EMPTY, said);

  if (GEOMETRIC.test(said)) {
    return Object.freeze({
      ok: false, form: FORM.UNREADABLE, why: REFUSED.GEOMETRIC, said,
      /* Kept rather than discarded — it is a real requirement, and a reviewer
         reading it is better than this reading it wrongly. */
      raw: said,
      note: "This is a geometric control, not a size tolerance. It is kept as written for "
          + "review rather than read into limits, because the number beside it is a zone "
          + "rather than a deviation from a nominal.",
    });
  }

  for (const re of CLASSES) {
    const m = re.exec(said);
    if (!m) continue;
    return Object.freeze({
      ok: true, form: FORM.CLASS, said,
      convention: said,
      grade: m[1] ? m[1] : null,
      note: "A general tolerance class. What it permits depends on the nominal size and on "
          + "a table this product does not carry, so the citation is recorded and the "
          + "limits are not.",
    });
  }

  /* +0.2 / -0.05, and the same written the other way round. Tried before
     symmetric so "+0.1/-0.1" is read as what it is rather than collapsed.
     Two patterns and two explicit reads rather than reversing a match: a
     match array's first element is the whole match, so reversing one shifts
     every index and silently swaps the deviations. */
  const plusFirst = new RegExp(`^\\+\\s*(${NUM})\\s*(?:\\/|,|\\s)\\s*-\\s*(${NUM})$`).exec(said);
  if (plusFirst) {
    return Object.freeze({ ok: true, form: FORM.ASYMMETRIC, said,
      upper: `+${plusFirst[1]}`, lower: `-${plusFirst[2]}` });
  }
  const minusFirst = new RegExp(`^-\\s*(${NUM})\\s*(?:\\/|,|\\s)\\s*\\+\\s*(${NUM})$`).exec(said);
  if (minusFirst) {
    return Object.freeze({ ok: true, form: FORM.ASYMMETRIC, said,
      upper: `+${minusFirst[2]}`, lower: `-${minusFirst[1]}` });
  }

  const sym = new RegExp(`^\\+\\/-\\s*(${NUM})$`).exec(said);
  if (sym) return Object.freeze({ ok: true, form: FORM.SYMMETRIC, said, plusMinus: sym[1] });

  /* Limits stated outright: "10.05 / 9.95", or MAX and MIN named. Each side
     is read by its own label rather than by position, so the printed order
     cannot swap them. */
  const max = new RegExp(`MAX\\.?\\s*(${NUM})`, "i").exec(said);
  const min = new RegExp(`MIN\\.?\\s*(${NUM})`, "i").exec(said);
  if (max && min) {
    if (compareDecimals(max[1], min[1]) <= 0) {
      return refuse(REFUSED.BACKWARDS, said);
    }
    return Object.freeze({ ok: true, form: FORM.LIMITS, said,
      maximum: max[1], minimum: min[1] });
  }

  const pair = new RegExp(`^(${NUM})\\s*\\/\\s*(${NUM})$`).exec(said);
  if (pair) {
    const a = pair[1], b = pair[2];
    /* Printed larger-first or smaller-first; which is the maximum is a fact
       about the numbers, not about the order somebody typed them. */
    const bigger = compareDecimals(a, b) >= 0 ? a : b;
    const smaller = bigger === a ? b : a;
    if (bigger === smaller) return refuse(REFUSED.NOT_A_TOLERANCE, said);
    return Object.freeze({ ok: true, form: FORM.LIMITS, said,
      maximum: bigger, minimum: smaller });
  }

  return refuse(REFUSED.NOT_A_TOLERANCE, said);
}

const refuse = (why, said) =>
  Object.freeze({ ok: false, form: FORM.UNREADABLE, why, said, raw: said });

/** Compare two plain decimals without floating point. */
export function compareDecimals(a, b) {
  const [ai = "0", af = ""] = String(a).split(".");
  const [bi = "0", bf = ""] = String(b).split(".");
  const width = Math.max(af.length, bf.length);
  const an = BigInt(ai + af.padEnd(width, "0"));
  const bn = BigInt(bi + bf.padEnd(width, "0"));
  return an === bn ? 0 : an > bn ? 1 : -1;
}

/* ---------------------------------------------------------- the band */

/**
 * Turn a reading into the exact tolerance the rest of the product holds.
 *
 * Needs the nominal, because a deviation with nothing to deviate from is not
 * a limit. A class never produces a band at all — the citation is the answer,
 * and the deviations are not known here.
 */
export function asTolerance(reading, { nominal, unit } = {}) {
  if (!reading?.ok) {
    return { ok: false, why: reading?.note ?? "That tolerance could not be read." };
  }
  if (reading.form === FORM.CLASS) {
    return {
      ok: false,
      why: "A tolerance class states which table applies, not what the limits are. "
         + "Supply the class's own figures, or state the limits on this dimension.",
      unverified: true,
    };
  }
  if (!unit) return { ok: false, why: "A tolerance needs a unit. A number on its own is not a limit." };
  if (nominal === undefined || nominal === null || nominal === "") {
    return {
      ok: false,
      why: "This tolerance was read without the dimension it applies to, so its limits "
         + "cannot be worked out. Say which dimension it governs.",
      needsNominal: true,
    };
  }

  const input = { unit, nominal };
  if (reading.form === FORM.SYMMETRIC) input.plusMinus = reading.plusMinus;
  else if (reading.form === FORM.ASYMMETRIC) { input.upper = reading.upper; input.lower = reading.lower; }
  else if (reading.form === FORM.LIMITS) { input.maximum = reading.maximum; input.minimum = reading.minimum; }

  try {
    return { ok: true, tolerance: exactTolerance(input) };
  } catch (e) {
    return { ok: false, why: String(e.message ?? e) };
  }
}

/**
 * What kind of requirement this reading is, in the vocabulary that already
 * exists for it.
 *
 * A tolerance printed against a dimension is dimensional. One in the title
 * block is a general tolerance, and `requirements.mjs` already keeps those
 * apart — which is what `specs/03` asks for, so this maps rather than
 * inventing a third idea.
 */
export function kindOf(reading, applies) {
  if (applies === APPLIES.GENERAL || reading?.form === FORM.CLASS) return KIND.GENERAL_TOLERANCE;
  return KIND.DIMENSIONAL;
}

/**
 * How much this product can stand behind it.
 *
 * A class cites a table that is not here; the requirement is real and what it
 * requires is not known. That is precisely `VERIFICATION.UNVERIFIED`, and
 * reusing it is better than a new word meaning the same thing.
 */
export function verificationOf(reading) {
  if (reading?.form === FORM.CLASS) return VERIFICATION.UNVERIFIED;
  if (!reading?.ok) return VERIFICATION.QUESTION;
  return VERIFICATION.SOURCED;
}

/**
 * What to tell somebody about a tolerance that was read.
 *
 * A general one says outright that nothing has been applied to anything. It
 * is the sentence that stops a title-block tolerance quietly becoming a limit
 * on fourteen features nobody looked at.
 */
export function saidPlainly(reading, applies) {
  if (!reading) return "";
  if (!reading.ok) {
    return reading.note
      ?? `"${reading.said}" was not read as a tolerance (${reading.why}). It is kept as written.`;
  }

  const where = applies === APPLIES.GENERAL
    ? "This is a general tolerance from the document rather than one marked against a "
      + "dimension. Which dimensions it governs has not been decided here — it governs "
      + "whatever carries no tolerance of its own, and that is a question about the drawing."
    : "";

  if (reading.form === FORM.CLASS) {
    return `${reading.convention} is cited. ${reading.note}${where ? " " + where : ""}`;
  }

  const shape = {
    [FORM.SYMMETRIC]: `Plus or minus ${reading.plusMinus}.`,
    [FORM.ASYMMETRIC]: `${reading.upper} and ${reading.lower}, which are not the same either way.`,
    [FORM.LIMITS]: `Between ${reading.minimum} and ${reading.maximum}, stated as limits.`,
  }[reading.form];

  return where ? `${shape} ${where}` : shape;
}

export { nmToDecimal, deviationNm };
