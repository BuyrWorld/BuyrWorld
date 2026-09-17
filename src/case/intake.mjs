/**
 * What are we solving today?
 *
 * `specs/05-EXPERIENCE-AND-ROLES.md`: *"Lead with 'What are we solving
 * today?' and one intake box supporting describe/upload. Five entry cards:
 * understand a quote; rescue a late delivery; check a drawing; prepare a
 * negotiation; brief my manager."*
 *
 * The routes are named by the spec, so this is not a design question. What it
 * is is an honesty question, and the answer decides whether the home page is
 * useful or a menu of disappointments: **four of the five lead somewhere and
 * one does not.** Rescuing a late delivery needs an engine this build has
 * not got. A card offering it anyway would be a door into an empty room, and
 * somebody who opens one stops trusting the other four.
 *
 * So a route says whether it is ready, and an unready one says what it would
 * need. That is the same rule the specialist orchestrator follows, for the
 * same reason.
 *
 * Describing a problem routes by written rule. No model: a router that reads
 * a sentence with a prompt is a router that can be talked into the wrong tool
 * by the sentence, and the sentence here is being typed by somebody who does
 * not yet know which tool they want. The rules are narrow, and where two
 * match it offers both rather than choosing — a router that always picks
 * sends people confidently to the wrong place.
 */

/** The five, as `specs/05` names them. */
export const ROUTE = Object.freeze({
  QUOTE: "understand-a-quote",
  DELIVERY: "rescue-a-late-delivery",
  DRAWING: "check-a-drawing",
  NEGOTIATION: "prepare-a-negotiation",
  BRIEF: "brief-my-manager",
});

/**
 * Where each goes, and whether it can go there.
 *
 * `page` is the page's own route name, so nothing here has to know how the
 * router works — only which door to knock on.
 */
export const ROUTES = Object.freeze([
  Object.freeze({
    id: ROUTE.QUOTE,
    title: "Understand a quote",
    said: "A supplier has asked for an increase, and you want to know how much of it the "
        + "evidence actually supports.",
    page: "tool-defender",
    ready: true,
  }),
  Object.freeze({
    id: ROUTE.DRAWING,
    title: "Check a drawing",
    said: "Read a drawing or a certificate, confirm what it says, and build the part it "
        + "describes.",
    page: "shouldcost",
    ready: true,
  }),
  Object.freeze({
    id: ROUTE.NEGOTIATION,
    title: "Prepare a negotiation",
    said: "Turn a finished analysis into an opening position, a ladder of challenges and a "
        + "walk-away.",
    page: "tool-defender",
    ready: true,
    /* It is the same page as understanding the quote because the position is
       built from the bridge. Saying so beats a card that appears to open
       something separate and does not. */
    note: "The position is built from the quote analysis, so this opens the same place.",
  }),
  Object.freeze({
    id: ROUTE.BRIEF,
    title: "Brief my manager",
    said: "Turn a case into a draft somebody can send, with what is still missing at the top.",
    page: "tool-defender",
    ready: true,
    needs: "a case to brief on",
    note: "A brief is made from a case, so this opens the case you were last working on.",
  }),
  Object.freeze({
    id: ROUTE.DELIVERY,
    title: "Rescue a late delivery",
    said: "Work out what a slipped date costs and what can still be done about it.",
    page: null,
    ready: false,
    /* Named rather than implied. "Coming soon" is a promise; this is a
       description of what is missing. */
    whyNot: "This build has no engine for delivery dates and schedule impact. Nothing here "
          + "could work out what a slipped date costs, so the card would open a page that "
          + "asked you questions and gave you nothing back.",
  }),
]);

/** The ones somebody can actually use. */
export const ready = () => Object.freeze(ROUTES.filter((r) => r.ready));

/** And the ones that are named so their absence is visible. */
export const notReady = () => Object.freeze(ROUTES.filter((r) => !r.ready));

/* --------------------------------------------------------- describing it */

/**
 * Words that point at a route.
 *
 * Deliberately narrow. A rule that fires on "cost" would match every sentence
 * anybody types into a procurement tool, and a router that always matches is
 * a router that is always confident and often wrong.
 */
const RULES = Object.freeze([
  { route: ROUTE.QUOTE, re: /\b(price increase|increase|uplift|surcharge|quote|quotation|cost up|put(?:ting)? (?:the )?price up|inflation)\b/i },
  { route: ROUTE.DRAWING, re: /\b(drawing|dxf|tolerance|certificate|mill cert|material cert|specification|spec sheet|part number)\b/i },
  { route: ROUTE.NEGOTIATION, re: /\b(negotiat\w*|meeting with|counter[- ]?offer|position|walk[- ]?away|batna)\b/i },
  { route: ROUTE.BRIEF, re: /\b(brief|summar\w+ for|tell my manager|write.*up for|escalat\w+)\b/i },
  { route: ROUTE.DELIVERY, re: /\b(late|delay\w*|slipp\w+|overdue|miss(?:ed|ing) (?:the )?date|lead time|expedit\w+|shortage)\b/i },
]);

/**
 * Which routes a description points at.
 *
 * Returns everything that matched, in the order the routes are listed, and
 * says plainly when nothing did. It does not rank: there is nothing here that
 * could tell a strong match from a weak one, and inventing a score would be
 * the confidence percentage `specs/06` forbids wearing a different hat.
 */
export function routeFor(text) {
  const said = String(text ?? "").trim();
  if (!said) {
    return Object.freeze({
      matched: Object.freeze([]),
      why: "Nothing was described yet.",
      certain: false,
    });
  }

  const hit = RULES.filter((r) => r.re.test(said)).map((r) => r.route);
  const matched = ROUTES.filter((r) => hit.includes(r.id));

  if (matched.length === 0) {
    return Object.freeze({
      matched: Object.freeze([]),
      why: "That does not match any of the five things this can start. Choose one, or open a "
         + "tool directly — nothing has been guessed at.",
      certain: false,
    });
  }

  return Object.freeze({
    matched: Object.freeze(matched),
    /* One match is not certainty, it is one rule firing. The wording is
       careful about that, because a sentence mentioning a late delivery and a
       price increase is describing one problem with two halves. */
    certain: matched.length === 1,
    why: matched.length === 1
      ? `That looks like ${matched[0].title.toLowerCase()}.`
      : `That could be ${matched.map((m) => m.title.toLowerCase()).join(" or ")}. `
        + "Both are offered rather than one being chosen for you.",
  });
}

/**
 * What to say when a description points at the route that is not ready.
 *
 * The most likely way somebody meets the gap, and the worst moment to be
 * vague about it.
 */
export function saidAboutUnready(result) {
  const unready = result.matched.filter((r) => !r.ready);
  if (unready.length === 0) return "";
  return unready.map((r) => `${r.title}: ${r.whyNot}`).join(" ");
}

/* ----------------------------------------------------------- picking up */

/**
 * Work somebody can return to.
 *
 * `specs/05` asks for resumable cases and *"at most three meaningful
 * changes"*, and is emphatic about what home must not be — *"avoid an initial
 * wall of metrics"*. Three is a limit rather than a target: two saved
 * scenarios is two cards, not two cards and a filler.
 *
 * Sorted by when they were last touched, because the thing somebody is coming
 * back to is almost always the thing they last left.
 */
export function resumable(scenarios = [], { limit = 3 } = {}) {
  return Object.freeze(
    [...scenarios]
      .filter((s) => s && s.id)
      .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
      .slice(0, limit)
      .map((s) => Object.freeze({
        id: s.id,
        title: s.name || s.id,
        at: s.updatedAt ?? null,
        /* What is outstanding, so a card says why it is worth opening rather
           than only that it exists. */
        waitingOn: Object.freeze([...(s.summary?.waitingOn ?? [])]),
        unknowns: s.summary?.unknowns ?? 0,
      })));
}

/** One line about a resumable case, or nothing when there is nothing to say. */
export function resumableSaid(item) {
  if (item.waitingOn.length === 0 && item.unknowns === 0) return "Nothing outstanding on it.";
  const parts = [];
  if (item.waitingOn.length > 0) parts.push(`waiting on ${item.waitingOn.join(", ")}`);
  if (item.unknowns > 0) {
    parts.push(`${item.unknowns} thing${item.unknowns === 1 ? "" : "s"} marked not known`);
  }
  return `Still ${parts.join("; ")}.`;
}
