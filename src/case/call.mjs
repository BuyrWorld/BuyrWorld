/**
 * Before the call, during it, and afterwards.
 *
 * `specs/07-PRACTICE-MOBILE-AND-STUDIO.md`: *"Before a call: confirmed
 * context, goal, unresolved questions, constraints and an editable
 * three-question plan. During: compact notes, user-initiated dictation if
 * configured, visible recording/transcription state, pause/stop, typed
 * fallback. After: proposed commitments with speaker/owner/date/source, human
 * correction and explicit save; generate a draft follow-up and management
 * brief. Unknown dates stay unknown. Sending requires deliberate review/action."*
 *
 * Four rules come out of that, and they are what the module is:
 *
 *   - **Nothing here is retained.** A call sheet and its notes are values. They
 *     reach storage when somebody saves them and not before, which is why no
 *     function in this file writes anything anywhere. `specs/02`'s gate says
 *     *"notes retained only by explicit save"*, and the way to be sure of that
 *     is to have nowhere to write to.
 *   - **A commitment is proposed, never recorded.** What comes out of a note is
 *     a candidate carrying the exact words it was read from, in the same
 *     vocabulary `src/intake/review.mjs` uses for a value read off a drawing —
 *     the same words, imported rather than re-spelled, because two vocabularies
 *     for one idea drift and then disagree.
 *   - **An unknown date stays unknown.** "Next week" is not a date, and neither
 *     is "12 October" in a year nobody wrote down. Both are kept as what was
 *     said, with the date left empty and the gap reported. A follow-up note
 *     saying the wrong date is worse than one saying the date is not settled.
 *   - **Nothing is sent.** There is no transport in this file and no caller can
 *     give it one. A draft follow-up is text a person reads, edits and sends
 *     themselves.
 *
 * No model reads anything here. The rules below are written down, each match
 * returns the characters it matched, and a note instructing the reader is just
 * a note containing that sentence.
 */

import { ACTION, DISPOSITION } from "../intake/review.mjs";

/* One vocabulary for "somebody looked at this and said what it is", shared
   with the document queue rather than invented again. */
export { ACTION, DISPOSITION };

const now = () => new Date().toISOString();

/** Where in a call this is. */
export const PHASE = Object.freeze({
  BEFORE: "before",
  DURING: "during",
  AFTER: "after",
});

/**
 * How a note arrived.
 *
 * Kept on the note because it is evidence about the words: a line somebody
 * typed is what they meant to write, and a line a recogniser produced is what
 * a machine thought it heard. A commitment read out of the second one is one
 * step further from what was actually said, and the queue says so.
 */
export const NOTE_SOURCE = Object.freeze({
  TYPED: "typed",
  DICTATED: "dictated",
});

/**
 * What a call can be for.
 *
 * A closed list, each tied to something the case can actually answer. "Get the
 * best price" is not here: it is not a goal, it is a wish, and a plan built on
 * it cannot say afterwards whether it was met.
 */
export const GOAL = Object.freeze({
  EVIDENCE: "evidence",
  HOLD: "hold",
  SETTLE: "settle",
  DEFER: "defer",
});

export const GOAL_SAID = Object.freeze({
  [GOAL.EVIDENCE]: "Get the evidence that is missing, and agree nothing today",
  [GOAL.HOLD]: "Hold at the hard line",
  [GOAL.SETTLE]: "Settle at the figure the evidence supports",
  [GOAL.DEFER]: "Trade timing rather than money",
});

/* ------------------------------------------------------------ before it */

/**
 * The sheet somebody takes into the call.
 *
 * Everything on it is derived from the case: the context is what has been
 * confirmed, the questions come from the ladder the negotiation plan already
 * built, and the constraints are what that plan says about walking away.
 * Nothing is drafted, and nothing is generic — a question this cannot derive
 * is left as an empty slot for the person to write, which is honest, whereas
 * "ask about their cost base" is filler that makes a sheet look finished.
 */
export function prepare({ bridge = null, negotiation = null, unresolved = [], at = now() } = {}) {
  const context = [];
  if (bridge) {
    context.push(said("What they are asking for is decomposed, driver by driver.", "the calculation"));
    if (bridge.unexplainedWeight > 0n) {
      context.push(said(
        "Part of the unit cost is covered by no driver they have given.", "the calculation"));
    }
  }
  if (negotiation) {
    context.push(said(
      "There is a hard line, a target and a limit, each with the rule that produced it.",
      "the negotiation plan"));
  }

  const asked = questionsFrom(negotiation, unresolved.map(asQuestion));

  return Object.freeze({
    at,
    phase: PHASE.BEFORE,
    context: Object.freeze(context),
    goal: null,
    questions: asked.questions,
    constraints: constraintsFrom(negotiation),
    /* What is left after three of them became the plan. Listing an item that
       is already sitting in a question box above it is how a sheet comes to
       look longer than it is. */
    unresolved: asked.rest,
  });
}

/** A question, however the caller wrote it down. */
const asQuestion = (u) => typeof u === "string"
  ? Object.freeze({ said: u, why: null })
  : Object.freeze({ said: String(u?.said ?? ""), why: u?.why ?? null });

const said = (text, from) => Object.freeze({ said: text, from });

/**
 * Three questions, and never three by padding.
 *
 * The challenges in the negotiation plan are already ordered — a request for
 * evidence outranks a challenge, which outranks a concession — so the first
 * three of those are the three worth asking. Where the case yields fewer, the
 * remaining slots say whose they are to write.
 */
function questionsFrom(negotiation, unresolved) {
  const derived = [];
  let usedFrom = 0;

  /* A challenge names a driver and says why it is challengeable; the question
     is that turned round. The plan's own sentence is carried word for word as
     the reason, rather than summarised here — a paraphrase of an argument is
     the thing that loses the argument. */
  for (const c of negotiation?.ladder?.challenges ?? []) {
    if (derived.length >= 3) break;
    if (!c.label) continue;
    derived.push({
      said: `What supports ${c.label}?`,
      why: c.why ?? null,
      from: "the negotiation plan",
      mine: false,
    });
  }
  for (const u of unresolved) {
    if (derived.length >= 3) break;
    if (!u.said) { usedFrom++; continue; }
    derived.push({ said: u.said, why: u.why, from: "the case", mine: false });
    usedFrom++;
  }

  const slots = derived.filter((q) => q.said);
  while (slots.length < 3) {
    slots.push({ said: null, why: null, from: null, mine: false });
  }

  return Object.freeze({
    questions: Object.freeze(slots.slice(0, 3).map(Object.freeze)),
    rest: Object.freeze(unresolved.slice(usedFrom).map((u) => u.said).filter(Boolean)),
  });
}

/** What the plan says you cannot do, in the plan's own words. */
function constraintsFrom(negotiation) {
  if (!negotiation) return Object.freeze([]);
  const out = [];
  if (negotiation.openingPosition?.rule) {
    out.push(said(negotiation.openingPosition.rule, "the negotiation plan"));
  }
  if (negotiation.walkAway?.credibility) {
    out.push(said(
      `Walking away is ${String(negotiation.walkAway.credibility).replace(/-/g, " ")}.`,
      "the walk-away assessment"));
  }
  return Object.freeze(out.map(Object.freeze));
}

/** Choose what the call is for. */
export function withGoal(sheet, goal) {
  if (!GOAL_SAID[goal]) throw new TypeError(`"${goal}" is not a goal this understands`);
  return Object.freeze({ ...sheet, goal });
}

/**
 * Write one of the three questions yourself.
 *
 * The slot is marked as the person's, which is the whole reason this is not
 * simply an array of strings: a question somebody wrote and a question derived
 * from the ladder are different kinds of thing, and the sheet should not
 * pretend the engine asked for one it did not.
 */
export function withQuestion(sheet, index, text) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i > 2) {
    throw new RangeError("the plan has three questions, numbered 0 to 2");
  }
  const written = String(text ?? "").trim();
  const questions = sheet.questions.map((q, at) => at !== i ? q : Object.freeze({
    said: written || null,
    why: null,
    from: written ? "you" : null,
    mine: Boolean(written),
  }));
  return Object.freeze({ ...sheet, questions: Object.freeze(questions) });
}

/** Whether the sheet is worth taking in. */
export function readiness(sheet) {
  const asked = sheet.questions.filter((q) => q.said).length;

  const state = !sheet.goal
    ? "No goal chosen yet. A call without one is a conversation."
    : asked === 0
      ? "No questions yet. The plan is three of them, and none is written."
      : asked < 3
        ? `${asked} of three questions written. The rest are yours to write.`
        : "Three questions and a goal.";

  /* On every line, not only the finished one. The sheet is the first screen
     that looks like something a product would send somewhere, and the moment
     to say it does not is while somebody is still filling it in. */
  return `${state} Nothing here has been sent to anybody.`;
}

/* ------------------------------------------------------------- during it */

/**
 * One line of notes.
 *
 * Time is recorded because a commitment's evidence is the moment as much as
 * the words: two people remembering a call differently is the ordinary case,
 * and the note that says when is the one that settles it.
 */
export function note({ text, source = NOTE_SOURCE.TYPED, at = now() } = {}) {
  const said = String(text ?? "").trim();
  if (!said) throw new TypeError("an empty note is not a note");
  if (source !== NOTE_SOURCE.TYPED && source !== NOTE_SOURCE.DICTATED) {
    throw new TypeError(`a note has to say how it arrived, not "${source}"`);
  }
  return Object.freeze({ said, source, at });
}

/* -------------------------------------------------------------- after it */

/** Who owes the thing. */
export const OWNER = Object.freeze({
  US: "us",
  THEM: "the supplier",
});

/**
 * The shapes a commitment is written in.
 *
 * Deliberately few. Each one is a sentence somebody actually writes in a call
 * note, and a line matching none of them produces nothing at all — a reader
 * that finds a commitment in every line teaches people to stop reading the
 * list, which costs more than the commitments it would have caught.
 */
const FORMS = Object.freeze([
  { owner: OWNER.THEM, re: /^(?:they|the supplier|supplier)\s+(?:will|are going to|agreed to|agree to)\s+(.+)$/i },
  { owner: OWNER.US, re: /^(?:we|i)\s+(?:will|are going to|agreed to|agree to)\s+(.+)$/i },
  { owner: OWNER.THEM, re: /^(?:they|the supplier|supplier)\s+to\s+(.+)$/i },
  { owner: OWNER.US, re: /^(?:we|i)\s+to\s+(.+)$/i },
]);

const MONTHS = Object.freeze([
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
]);

/**
 * A date, or an honest record of why there is not one.
 *
 * Only a date with a year in it becomes a date. "12 October" is not one: the
 * year is a guess, and the guess is wrong every December. "Next week" is not
 * one either. Both come back as what was said with nothing in `iso`, and the
 * queue reports them as needing a date rather than quietly choosing.
 *
 * `12/10/2026` is refused outright. It is the twelfth of October to half the
 * world and the tenth of December to the other half, and there is nothing in a
 * call note that says which.
 */
export function dateIn(text) {
  const line = String(text ?? "");

  const iso = line.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const [, y, m, d] = iso;
    if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return Object.freeze({ said: iso[0], iso: iso[0], needs: null, why: null });
    }
  }

  const slashed = line.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/);
  if (slashed) {
    return Object.freeze({
      said: slashed[0], iso: null,
      needs: "a date written so it cannot be read two ways",
      why: `"${slashed[0]}" is two different days depending on where you are.`,
    });
  }

  const named = line.match(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join("|")})\\b(?:\\s+(\\d{4}))?`, "i"))
    || line.match(
      new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "i"));

  if (named) {
    const monthFirst = MONTHS.includes(String(named[1]).toLowerCase());
    const day = Number(monthFirst ? named[2] : named[1]);
    const month = MONTHS.indexOf(String(monthFirst ? named[1] : named[2]).toLowerCase()) + 1;
    const year = named[3];
    if (!year) {
      return Object.freeze({
        said: named[0], iso: null, needs: "a year",
        why: `The note says "${named[0]}" and no year, and the year is wrong every December.`,
      });
    }
    return Object.freeze({
      said: named[0],
      iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      needs: null, why: null,
    });
  }

  const vague = line.match(/\b(?:next week|this week|next month|soon|shortly|in a few days|asap)\b/i);
  if (vague) {
    return Object.freeze({
      said: vague[0], iso: null, needs: "a date",
      why: `The note says "${vague[0]}", which is not one.`,
    });
  }

  return Object.freeze({
    said: null, iso: null, needs: "a date",
    why: "Nothing in the note says when.",
  });
}

/**
 * One proposed commitment.
 *
 * `evidence` is frozen at the moment of reading and nothing below writes to
 * it, exactly as a document reading works: the words the note used, when it
 * was taken, and whether a person typed them or a recogniser did.
 */
function commitment(n, index, { owner, what }) {
  const when = dateIn(n.said);
  return Object.freeze({
    id: `commitment-${index}`,
    owner,
    /* The date comes out of the words: the follow-up prints it separately, and
       "send the breakdown by 2026-10-12 by 2026-10-12" is what happens when it
       is left in. What was said is kept whole in the evidence. */
    what: withoutDate(what, when.said),
    date: when.iso,
    dateSaid: when.said,
    needs: when.needs,
    needsWhy: when.why,
    evidence: Object.freeze({
      quote: n.said,
      at: n.at,
      source: n.source,
      note: index,
    }),
    disposition: DISPOSITION.PROPOSED,
    why: null,
    revisions: Object.freeze([]),
  });
}

/** The words, with the trailing date phrase the reader already took removed. */
function withoutDate(what, said) {
  if (!said) return what;
  const at = what.lastIndexOf(said);
  if (at < 0) return what;
  return what.slice(0, at).replace(/\s+(?:by|on|before|from|due)\s*$/i, "").trim() || what;
}

/**
 * What the notes propose was agreed.
 *
 * Read by written rule, and silent about lines that match none of them. The
 * failure this shape exists to prevent is an "actions" list that is mostly
 * wrong, because a list that is mostly wrong is read once.
 */
export function commitments(notes = []) {
  const out = [];
  notes.forEach((n, index) => {
    if (!n || !n.said) return;
    for (const form of FORMS) {
      const m = n.said.match(form.re);
      if (!m) continue;
      out.push(commitment(n, index, { owner: form.owner, what: m[1].trim().replace(/[.\s]+$/, "") }));
      break;
    }
  });
  return Object.freeze(out);
}

function revise(item, { action, by, what, date, why = null }) {
  if (!by) throw new TypeError("a decision about a commitment has to record who made it");
  const disposition = {
    [ACTION.CONFIRM]: DISPOSITION.CONFIRMED,
    [ACTION.CORRECT]: DISPOSITION.CORRECTED,
    [ACTION.UNKNOWN]: DISPOSITION.UNKNOWN,
    [ACTION.REJECT]: DISPOSITION.REJECTED,
  }[action];

  return Object.freeze({
    ...item,
    what: what === undefined ? item.what : what,
    date: date === undefined ? item.date : date,
    /* A corrected date answers whatever the reading was missing. */
    needs: date === undefined ? item.needs : (date ? null : item.needs),
    disposition,
    why,
    revisions: Object.freeze([...item.revisions, Object.freeze({
      action, by: String(by), at: now(),
      from: Object.freeze({ what: item.what, date: item.date }),
      to: Object.freeze({
        what: what === undefined ? item.what : what,
        date: date === undefined ? item.date : date,
      }),
      why,
    })]),
  });
}

/** "That is what was agreed." */
export const confirmCommitment = (item, by) => {
  if (item.needs) {
    throw new RangeError(
      `This is missing ${item.needs}. Correct it or mark it unknown — confirming it would `
      + "record a date nobody gave.");
  }
  return revise(item, { action: ACTION.CONFIRM, by });
};

/** "Nearly — it was this." */
export function correctCommitment(item, { what, date } = {}, by) {
  const written = what === undefined ? undefined : String(what).trim();
  if (written !== undefined && !written) {
    throw new TypeError("a correction needs the words; to drop it, reject it");
  }
  if (date !== undefined && date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    throw new RangeError(`"${date}" is not a date. Write it as 2026-10-12, or leave it unknown.`);
  }
  return revise(item, { action: ACTION.CORRECT, by, what: written, date });
}

/** "Something was agreed, and when is not settled." */
export const commitmentUnknown = (item, by, why = null) =>
  revise(item, { action: ACTION.UNKNOWN, by, date: null, why });

/** "Nobody agreed that." */
export const rejectCommitment = (item, by, why = null) =>
  revise(item, { action: ACTION.REJECT, by, why });

/** Only what somebody stood behind. */
export const agreed = (items = []) => Object.freeze(items.filter((i) =>
  i.disposition === DISPOSITION.CONFIRMED || i.disposition === DISPOSITION.CORRECTED));

/** What is still waiting on a person. */
export const outstanding = (items = []) => Object.freeze(items.filter((i) =>
  i.disposition === DISPOSITION.PROPOSED || i.disposition === DISPOSITION.UNKNOWN));

/* ------------------------------------------------------- the follow-up */

/**
 * A draft note to send afterwards — and it is a draft.
 *
 * Only commitments somebody stood behind appear as agreed. Everything else is
 * listed as not settled, including a date that was said but never pinned,
 * because the whole value of a follow-up is that the other side can correct it
 * before it becomes what everybody remembers.
 *
 * It is text. Nothing in this module can send it, and the sentence at the
 * bottom says so to whoever reads the draft over somebody's shoulder.
 */
export function followUp(sheet, items = [], { title = "Our call" } = {}) {
  const took = agreed(items);
  const open = outstanding(items);

  const lines = [`# ${title}`, ""];
  if (sheet?.goal) lines.push(`What it was for: ${GOAL_SAID[sheet.goal]}.`, "");

  lines.push("## What we agreed", "");
  if (took.length === 0) {
    lines.push("Nothing was recorded as agreed.", "");
  } else {
    for (const i of took) {
      lines.push(`- ${owned(i)} ${i.what}${i.date ? ` by ${i.date}` : ""}.`);
    }
    lines.push("");
  }

  lines.push("## Still open", "");
  if (open.length === 0) {
    lines.push("Nothing outstanding from my notes.", "");
  } else {
    for (const i of open) {
      const missing = i.needs ? ` — still needs ${i.needs}` : "";
      lines.push(`- ${owned(i)} ${i.what}${missing}.`);
    }
    lines.push("");
  }

  lines.push(
    "This is a draft written from my notes of the call, not a record either side has agreed. "
    + "Correct anything I have wrong.");

  return Object.freeze({
    text: lines.join("\n"),
    agreed: took.length,
    open: open.length,
    complete: open.length === 0 && took.length > 0,
    sent: false,
  });
}

const owned = (i) => (i.owner === OWNER.US ? "We will" : "They will");

/** What a person is told about the draft, beside the button that copies it. */
export const followUpReadiness = (draft) =>
  draft.complete
    ? "Every commitment has been checked. It is still a draft, and nothing has been sent."
    : `${draft.open} thing${draft.open === 1 ? "" : "s"} still unsettled, and the draft says so. `
      + "Nothing has been sent.";

/** The four, as a list, so a page can offer them without knowing their names. */
export const GOALS = Object.freeze(Object.values(GOAL));
