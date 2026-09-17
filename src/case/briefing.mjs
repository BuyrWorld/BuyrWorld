/**
 * What changed since you were last here.
 *
 * `specs/05-EXPERIENCE-AND-ROLES.md`: *"Daily brief derives from changed case
 * events: what changed, why it matters, what needs me, what can wait. Keep
 * 'estimated opportunity', 'agreed savings' and 'realised outcome'
 * distinct."*
 *
 * It is not called a daily brief here, and that is deliberate rather than
 * pedantic. "Daily" implies a schedule, a place the schedule runs, and a
 * reason to expect something new each morning. This build holds cases in one
 * browser's storage with no accounts and no server: there is nothing to run
 * on a schedule and nothing that changes while nobody is here. What there is
 * is a genuine question — what has moved since I last looked — and answering
 * that one honestly is worth more than answering a bigger one by implying
 * facts that do not exist.
 *
 * The spec is unusually direct about what this must not become, and it is
 * worth keeping in front of whoever extends it: *"No streak guilt, fake
 * urgency, opaque leaderboards or invented savings."* So nothing here counts
 * consecutive days, nothing is overdue, and nothing is totalled.
 *
 * That last one is the rule with teeth. **Estimated opportunity, agreed
 * savings and a realised outcome are three different things and are never
 * added together.** A pipeline figure and a banked one summed into a single
 * number is how a tool starts reporting savings nobody made — and it is the
 * easiest possible feature to add here, because the three are all money and
 * all sitting in the same list.
 */

/** `specs/05`: at most three meaningful changes. A limit, not a target. */
export const MOST_CHANGES = 3;

/** What kind of thing moved. */
export const CHANGED = Object.freeze({
  CASE: "a case",
  ESTIMATE: "an estimate",
  OUTCOME: "an outcome",
});

/**
 * The three kinds of money, kept apart.
 *
 * Named so they cannot be added by accident: there is no total field to put
 * the sum in, and a caller wanting one has to write the loop itself and see
 * what it is doing.
 */
export const MONEY_KIND = Object.freeze({
  ESTIMATED: "estimated opportunity",
  AGREED: "agreed savings",
  REALISED: "realised outcome",
});

export const MONEY_SAID = Object.freeze({
  [MONEY_KIND.ESTIMATED]: "what an analysis suggests might be available. Nobody has agreed it.",
  [MONEY_KIND.AGREED]: "what a supplier has agreed to. It has not necessarily been invoiced yet.",
  [MONEY_KIND.REALISED]: "what has actually landed.",
});

/* ------------------------------------------------------------ the changes */

/**
 * One thing that moved.
 *
 * `needsYou` is the whole point of the sorting. A case with an unconfirmed
 * assumption is waiting on a person; one with nothing outstanding is not, and
 * telling somebody both with equal weight is how a list of five becomes a
 * list nobody opens.
 */
function change({ kind, id, title, at, said, needsYou, why = null }) {
  return Object.freeze({ kind, id, title, at, said, needsYou, why });
}

const newer = (a, b) => String(b.at ?? "").localeCompare(String(a.at ?? ""));

/**
 * What has moved since a marker, sorted into what needs somebody and what does
 * not.
 *
 * `since` is an ISO string or null. Null means everything is new, which is
 * what a first visit actually is — the alternative is showing nothing on the
 * one visit where somebody most wants to see what is here.
 */
export function changes({ scenarios = [], estimates = [], outcomes = [] } = {}, since = null) {
  const after = (at) => !since || String(at ?? "") > String(since);
  const out = [];

  for (const s of scenarios) {
    if (!s || !s.id || !after(s.updatedAt)) continue;
    const waiting = s.summary?.waitingOn ?? [];
    const unknowns = s.summary?.unknowns ?? 0;
    out.push(change({
      kind: CHANGED.CASE,
      id: s.id,
      title: s.name || s.id,
      at: s.updatedAt ?? null,
      needsYou: waiting.length > 0 || unknowns > 0,
      said: waiting.length > 0 || unknowns > 0
        ? "It cannot be finished until something is supplied."
        : "Saved and complete as far as its own inputs go.",
      why: waiting.length > 0 ? `Waiting on ${waiting.join(", ")}.` : null,
    }));
  }

  for (const e of estimates) {
    if (!e || !e.id || !after(e.savedAt ?? e.at)) continue;
    /* An incomplete estimate is one somebody will read as a number. That is
       the case worth surfacing; a complete one is just a saved figure. */
    const incomplete = e.complete === false;
    out.push(change({
      kind: CHANGED.ESTIMATE,
      id: e.id,
      title: e.name || e.id,
      at: e.savedAt ?? e.at ?? null,
      needsYou: incomplete,
      said: incomplete
        ? "It was saved with gaps, so it is not comparable with a complete one."
        : "Saved.",
      why: incomplete ? "Fill the gaps before putting it beside another estimate." : null,
    }));
  }

  for (const o of outcomes) {
    if (!o || !o.id || !after(o.at ?? o.savedAt)) continue;
    out.push(change({
      kind: CHANGED.OUTCOME,
      id: o.id,
      title: o.name || o.supplier || o.id,
      at: o.at ?? o.savedAt ?? null,
      /* A recorded outcome is a thing that happened. It is worth knowing and
         there is nothing to do about it. */
      needsYou: false,
      said: "Recorded.",
    }));
  }

  const sorted = out.sort(newer);
  const needsYou = sorted.filter((c) => c.needsYou);
  const canWait = sorted.filter((c) => !c.needsYou);

  return Object.freeze({
    /* What needs somebody comes first and is not truncated away by something
       that does not. Truncating the list before sorting is how the one thing
       that mattered ends up below three that did not. */
    needsYou: Object.freeze(needsYou.slice(0, MOST_CHANGES)),
    canWait: Object.freeze(canWait.slice(0, MOST_CHANGES)),
    total: sorted.length,
    /* Said rather than implied by a short list. */
    moreThanShown: Math.max(0, sorted.length - Math.min(needsYou.length, MOST_CHANGES)
      - Math.min(canWait.length, MOST_CHANGES)),
    since,
  });
}

/**
 * What to say when nothing has moved.
 *
 * Not "you're all caught up", which is congratulation for the absence of
 * work, and not a streak. A statement of fact, and then out of the way.
 */
export const NOTHING_CHANGED = "Nothing has changed since you were last here.";

/** And on a first visit, where everything is new but nothing has happened. */
export const FIRST_VISIT = "Nothing is saved in this browser yet. Anything you keep will "
  + "show up here when you come back.";

export function saidPlainly(result, { firstVisit = false } = {}) {
  if (firstVisit && result.total === 0) return FIRST_VISIT;
  if (result.total === 0) return NOTHING_CHANGED;

  const parts = [];
  if (result.needsYou.length > 0) {
    parts.push(`${result.needsYou.length} thing${result.needsYou.length === 1 ? "" : "s"} `
      + `need${result.needsYou.length === 1 ? "s" : ""} something from you.`);
  }
  if (result.canWait.length > 0) {
    parts.push(`${result.canWait.length} other${result.canWait.length === 1 ? "" : "s"} moved `
      + "and can wait.");
  }
  if (result.moreThanShown > 0) {
    parts.push(`${result.moreThanShown} more ${result.moreThanShown === 1 ? "is" : "are"} `
      + "not shown here.");
  }
  return parts.join(" ");
}

/* ----------------------------------------------------------- the money */

/**
 * The three figures, side by side and never added.
 *
 * There is no total, and the absence is the feature. Each carries its own
 * sentence saying what it is, because "£40,000" under a heading somebody
 * skimmed is a number that will be repeated in a meeting as though it were
 * banked.
 *
 * Nothing is computed here either — each figure is whatever the caller's own
 * engine worked out, carried across unchanged.
 */
export function money({ estimated = null, agreed = null, realised = null } = {}) {
  const row = (kind, value) => value === null || value === undefined
    ? null
    : Object.freeze({ kind, value, said: MONEY_SAID[kind] });

  return Object.freeze({
    rows: Object.freeze([
      row(MONEY_KIND.ESTIMATED, estimated),
      row(MONEY_KIND.AGREED, agreed),
      row(MONEY_KIND.REALISED, realised),
    ].filter(Boolean)),
    /* Said out loud, because the obvious next feature request is a total and
       the reason not to build one should be written down where it will be
       read. */
    why: "These three are not added together. An estimate is what an analysis suggests, an "
       + "agreement is what a supplier accepted, and a realised figure is what landed. Summing "
       + "them reports savings nobody made.",
  });
}

/** Whether there is anything to show at all. */
export const anythingToSay = (result) => result.total > 0;
