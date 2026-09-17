/**
 * What a case says, worked out rather than written.
 *
 * `specs/05-EXPERIENCE-AND-ROLES.md`: *"Every case uses: What happened / Why
 * it matters / Your options / Recommended next step / Evidence and missing
 * information."* And `specs/02`: *"Use deterministic evidence-backed
 * summaries first; introduce provider generation behind a feature flag and
 * schema validation."*
 *
 * Five headings like those are exactly the shape of a thing that wants to be
 * generated, and generated prose with numbers in it is the failure this
 * codebase is built to prevent. So a narrative is not text. It is a list of
 * **claims**, each carrying what it rests on and what it is still waiting
 * for, and the sentence is assembled from them. A model, if one is ever
 * involved, drafts around the claims and never produces a figure — the same
 * rule `api/chat.js` already follows.
 *
 * The rule that makes the whole thing honest is one line of `specs/05`:
 *
 *   > *"Show a numerical impact only after relevant inputs are confirmed."*
 *
 * A claim that carries a figure names the inputs it depends on. If any of
 * them is unconfirmed the figure is withheld and the claim says what is
 * missing instead — which is the spec's own example, *"This could affect
 * Friday's build. We still need the quantity required before then."* The
 * figure is not rounded, hedged, or shown in grey with an asterisk. It is
 * absent, and the reason is in its place.
 *
 * Nothing here renders. It answers what the case says; where and how much of
 * it appears is the projection's business, and that separation is what makes
 * "all views use the same facts" something a test can check rather than
 * something a team intends.
 */

/** The five headings, in the order `specs/05` gives them. */
export const SECTION = Object.freeze({
  HAPPENED: "what-happened",
  MATTERS: "why-it-matters",
  OPTIONS: "your-options",
  NEXT: "recommended-next-step",
  EVIDENCE: "evidence-and-missing-information",
});

/** What each is called on screen. */
export const SECTION_TITLE = Object.freeze({
  [SECTION.HAPPENED]: "What happened",
  [SECTION.MATTERS]: "Why it matters",
  [SECTION.OPTIONS]: "Your options",
  [SECTION.NEXT]: "Recommended next step",
  [SECTION.EVIDENCE]: "Evidence and missing information",
});

const SECTIONS = Object.freeze(Object.values(SECTION));

/**
 * How much weight a claim can take.
 *
 * `MATERIAL` is the one that matters: `specs/05` says role selection "never
 * grants permissions or hides material risks", so a projection may drop
 * anything except this. It is a property of the claim rather than of the
 * reader.
 */
export const WEIGHT = Object.freeze({
  MATERIAL: "material",
  NORMAL: "normal",
  DETAIL: "detail",
});

/**
 * One thing the case says.
 *
 * `needs` is the list of inputs a figure waits on. A claim with a figure and
 * an unmet need shows neither the figure nor a hedge — it shows the need.
 */
export function claim({
  section, said, figure = null, needs = [], evidence = [],
  weight = WEIGHT.NORMAL, id = null,
} = {}) {
  if (!SECTIONS.includes(section)) {
    throw new TypeError(`"${section}" is not one of the five sections`);
  }
  if (!said || !String(said).trim()) {
    throw new TypeError("A claim has to say something.");
  }
  if (figure !== null && needs.length === 0) {
    /* A figure that depends on nothing is a figure nobody has to confirm,
       which is the exact hole `specs/05` closes. If it genuinely rests on
       nothing, say so by naming no figure. */
    throw new TypeError(
      "A figure has to name the inputs it depends on, or it cannot be withheld when they are missing.");
  }
  /* A figure written into the sentence as well survives being withheld.
   *
   * The mechanism above removes `figure`; it cannot remove "about £1,250" from
   * a sentence somebody typed, and that sentence is what a reader sees. So a
   * claim whose own words already contain its own figure is refused at
   * construction, where the author is standing, rather than leaking at the
   * one moment the rule exists for.
   *
   * It is deliberately literal: it looks for this claim's own amount, not for
   * numbers in general. A claim may say "the 30th" or "a 10mm plate" freely. */
  if (figure && figure.amount !== undefined && figure.amount !== null) {
    /* Compared as the amount is actually written, with thousands separators
       and spaces removed so "£1,250.00" is found. An earlier version stripped
       every non-digit and then trailing zeros, which collapses 100.00 to "1"
       and refuses a claim that says "10 items" — a guard that fires on
       innocent sentences gets removed, and then it guards nothing. */
    const flat = String(said).replace(/[,\s]/g, "");
    const amount = String(figure.amount);
    const whole = amount.replace(/\.0+$/, "");
    if (flat.includes(amount) || (whole !== amount && flat.includes(whole))) {
      throw new TypeError(
        `This claim's sentence already contains its own figure (${figure.amount}), `
        + "so withholding the figure would not withhold it. Keep the number out of the words.");
    }
  }

  return Object.freeze({
    id: id ?? null,
    section,
    said: String(said).trim(),
    figure: figure === null ? null : Object.freeze({ ...figure }),
    needs: Object.freeze([...needs]),
    evidence: Object.freeze(evidence.map((e) => Object.freeze({ ...e }))),
    weight,
  });
}

/** Something that can be pointed at: a document, a confirmed reading, a rule. */
export const evidenceOf = ({ kind, said, page = null, quote = null, field = null } = {}) =>
  Object.freeze({ kind, said, page, quote, field });

/* ------------------------------------------------------- withholding figures */

/**
 * Whether every input a claim waits on has been confirmed.
 *
 * `confirmed` is the set of field names a person has actually confirmed —
 * from the review queue, or typed and not in question. Anything not in it is
 * outstanding, including a field nobody has looked at, which is the whole
 * point: absence of a decision is not a decision.
 */
export const met = (need, confirmed) => confirmed.has(need);

/**
 * A claim resolved against what is actually confirmed.
 *
 * The figure survives only if every need is met. Otherwise it goes and the
 * claim says what it is waiting for — not "approximately", not a figure in
 * grey. Absent, with the reason in its place.
 */
export function resolve(c, confirmed, labelOf = (n) => n) {
  const waiting = c.needs.filter((n) => !met(n, confirmed));
  if (waiting.length === 0) {
    return Object.freeze({ ...c, waiting: Object.freeze([]), withheld: false });
  }

  const names = waiting.map(labelOf);
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

  return Object.freeze({
    ...c,
    figure: null,
    waiting: Object.freeze(waiting),
    withheld: c.figure !== null,
    said: c.figure === null
      ? c.said
      /* The spec's own shape: the consequence, then the gap. Saying what is
         missing without saying why it matters is a form to fill in; saying
         why without saying what is missing is a worry. */
      : `${c.said} ${needSentence(list, names.length)}`,
  });
}

const needSentence = (list, count) =>
  `We still need ${list} before ${count === 1 ? "that figure" : "those figures"} can be worked out.`;

/* ------------------------------------------------------------ the narrative */

/**
 * The five sections, from a set of claims.
 *
 * Sections are always present and may be empty. A case with nothing to say
 * under "Your options" says so; dropping the heading would make a case that
 * has options and one that has not look alike.
 */
export function narrative(claims, { confirmed = new Set(), labelOf } = {}) {
  const resolved = claims.map((c) => resolve(c, confirmed, labelOf));
  const sections = SECTIONS.map((section) => Object.freeze({
    section,
    title: SECTION_TITLE[section],
    claims: Object.freeze(resolved.filter((c) => c.section === section)),
  }));

  return Object.freeze({
    sections: Object.freeze(sections),
    claims: Object.freeze(resolved),
    /* Everything the case is waiting on, deduplicated, so "Evidence and
       missing information" can be built from what the other four sections
       could not say rather than from a second opinion about it. */
    waiting: Object.freeze([...new Set(resolved.flatMap((c) => c.waiting))]),
    withheld: Object.freeze(resolved.filter((c) => c.withheld)),
    material: Object.freeze(resolved.filter((c) => c.weight === WEIGHT.MATERIAL)),
  });
}

/** The claims of one section, for a caller that wants just the one. */
export const sectionOf = (n, section) =>
  n.sections.find((s) => s.section === section)?.claims ?? Object.freeze([]);

/**
 * Whether the case can carry a numerical impact at all yet.
 *
 * Asked once, so a surface does not have to work it out from the claims and
 * get it subtly different.
 */
export const anyFigureWithheld = (n) => n.withheld.length > 0;
