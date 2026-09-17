/**
 * A brief somebody can send their manager.
 *
 * The last thing `specs/02`'s Phase 2 gate asks for: *"a junior user explains
 * the issue, sees missing evidence, chooses an action and produces a draft
 * management brief."* And `specs/06` says what a management card holds —
 * *"brief summary, decision needed, options and missing information"* — which
 * is four of the five sections a case already has, in a different order and
 * at a different length.
 *
 * So this composes; it does not summarise. Every line comes from a claim that
 * was already resolved against what is confirmed, which is the only way to
 * guarantee the thing that matters here: **a figure withheld on screen cannot
 * reappear in the brief.** A brief is the artefact that leaves the building.
 * If the rule held everywhere except the document somebody emails, it would
 * hold nowhere that counted.
 *
 * It leads with what is missing rather than burying it. A manager reading a
 * confident paragraph and finding the caveat in the last line has already
 * formed the view the caveat was supposed to prevent.
 *
 * And it says it is a draft, in the first line and again at the end. `specs/06`:
 * *"Distinguish draft recommendation from approved action."* Nothing here has
 * been approved by anybody — it was assembled from a calculation and one
 * person's confirmations, and the person it is sent to is the one who decides.
 */

import { SECTION, sectionOf } from "./narrative.mjs";

/** Said at the top and repeated at the bottom. Never configurable. */
export const DRAFT_LABEL = "DRAFT — NOT AN APPROVED DECISION";

/**
 * Wording the composed part must never carry, whatever it is handed.
 *
 * Checked against the lines built from claims, not against the whole
 * document. The boilerplate says "NOT AN APPROVED DECISION" and "nothing has
 * been agreed with anybody", and a check that cannot tell a denial from a
 * claim fires on the very sentences that make the brief safe — which is how a
 * guard gets deleted for being wrong. It did exactly that on the first run.
 *
 * The variable part is where the risk is: content arriving from a claim
 * somebody wrote somewhere else.
 */
const FORBIDDEN = Object.freeze([
  /\bapproved\b/i,
  /\bwe recommend accepting\b/i,
  /\bsigned off\b/i,
  /\bagreed\b/i,
  /\bguarantee/i,
]);

/**
 * The brief, as text.
 *
 * Markdown rather than HTML: the thing somebody does with this is paste it
 * into an email, and a document that arrives as markup is a document somebody
 * has to clean up before they can use it.
 */
export function brief(narrative, {
  title = "Supplier price increase",
  preparedFor = null,
  preparedBy = "this browser",
  at = new Date().toISOString().slice(0, 10),
} = {}) {
  if (!narrative || !narrative.sections) {
    throw new TypeError("There is no case to brief on.");
  }

  const lines = [];
  const say = (s = "") => lines.push(s);

  /* The lines composed from claims, kept apart from the fixed wording so the
     forbidden-word check has something meaningful to look at. */
  const composed = [];
  const said = (s) => { composed.push(s); say("- " + s); };

  say(`# ${title}`);
  say();
  say(`**${DRAFT_LABEL}**`);
  say();
  say(`Prepared ${at}${preparedFor ? ` for ${preparedFor}` : ""}, from figures calculated in `
    + `BuyrWorld and confirmed by ${preparedBy}. Nothing in it has been agreed with anybody.`);
  say();

  /* What is missing, first.
   *
   * `specs/05` puts it last in the case, where somebody is reading top to
   * bottom and will get there. A brief is skimmed, and a caveat at the end of
   * a skimmed document is a caveat nobody read. */
  const waiting = narrative.waiting ?? [];
  if (waiting.length > 0) {
    say("## Read this first");
    say();
    say(`${waiting.length} thing${waiting.length === 1 ? "" : "s"} on this case `
      + `${waiting.length === 1 ? "is" : "are"} not confirmed, so no figure below has been `
      + "worked out. What is stated is what is known without them.");
    say();
    for (const w of waiting) say(`- ${w}`);
    say();
  }

  section(say, said, narrative, SECTION.HAPPENED, "What happened");
  section(say, said, narrative, SECTION.MATTERS, "Why it matters");
  section(say, said, narrative, SECTION.OPTIONS, "The options");
  section(say, said, narrative, SECTION.NEXT, "The decision needed");

  /* The material points again, gathered.
   *
   * They appear above in their own sections; a manager skimming for what is
   * at stake should not have to find them. Repetition is the right trade
   * here. */
  const material = narrative.material ?? [];
  if (material.length > 0) {
    say("## What is at stake");
    say();
    for (const c of material) said(line(c));
    say();
  }

  section(say, said, narrative, SECTION.EVIDENCE, "Evidence and what is assumed");

  say("---");
  say();
  say(`${DRAFT_LABEL}. The figures come from a tested calculation; the judgement does not. `
    + "Decide with whoever owns the contract.");

  const text = lines.join("\n");
  const fromClaims = composed.join("\n");
  const offending = FORBIDDEN.filter((re) => re.test(fromClaims));

  return Object.freeze({
    text,
    title,
    waiting: Object.freeze([...waiting]),
    /* A brief built from a case with withheld figures is still a brief, and
       saying which is what makes it usable rather than merely honest. */
    withheld: Object.freeze((narrative.withheld ?? []).map((c) => c.id ?? c.said)),
    complete: waiting.length === 0,
    /* If this ever fires, something upstream wrote a word this must not say.
       Reported rather than thrown: refusing to produce the brief would lose
       the work, and a caller that ignores this has chosen to. */
    forbidden: Object.freeze(offending.map((re) => String(re))),
  });
}

function section(say, said, n, which, heading) {
  const claims = sectionOf(n, which);
  if (claims.length === 0) return;
  say(`## ${heading}`);
  say();
  for (const c of claims) said(line(c));
  say();
}

/**
 * One claim as a line.
 *
 * The figure is appended only where the claim still has one. A claim whose
 * figure was withheld already says what it is waiting for, and adding
 * anything where the number would have gone would put a placeholder into the
 * one document that leaves the building.
 */
function line(c) {
  if (!c.figure) return c.said;
  const value = c.figure.kind === "money"
    ? `${c.figure.amount} ${c.figure.currency}`
    : c.figure.amount;
  return `${c.said} **${value}**${c.figure.what ? ` (${c.figure.what})` : ""}`;
}

/**
 * Whether a brief is worth sending yet.
 *
 * Not a refusal — an incomplete brief is often exactly what somebody needs to
 * send, because "here is what I cannot answer" is a useful thing to tell a
 * manager. It is a sentence to show beside the button.
 */
export function readiness(b) {
  if (b.complete) {
    return "Every figure in this brief rests on something confirmed. It is still a draft: "
         + "nothing in it has been agreed.";
  }
  return `${b.waiting.length} thing${b.waiting.length === 1 ? "" : "s"} on this case `
       + `${b.waiting.length === 1 ? "is" : "are"} unconfirmed, so the brief states the `
       + "position without figures. That is worth sending — it says what you need in order "
       + "to answer.";
}
