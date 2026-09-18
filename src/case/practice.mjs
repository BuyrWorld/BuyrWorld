/**
 * Practice, which cannot touch anything real.
 *
 * `specs/07`: *"Practice creates a separate synthetic session labelled
 * 'Practice — does not change your live case'. User selects goal and
 * difficulty; AI plays a supplier within supplied scenario constraints.
 * Feedback ties to observed questions, evidence, tradeoffs and next practice
 * step. Avoid arbitrary numerical competency scores. Import a real case only
 * through explicit choice and remove unnecessary sensitive details; never
 * invent commitments on the live case."*
 *
 * And the Phase 4 gate: *"practice cannot send or alter live data"*.
 *
 * So:
 *
 *   - **A session is synthetic and says so in its own data.** The label is a
 *     field, not a caller's styling choice, and every session id begins
 *     `PRACTICE-`. A surface cannot render one as though it were a case
 *     without ignoring both.
 *   - **Importing a real case copies figures and drops names.** What is useful
 *     for practice is the shape of the argument — what is claimed, what is
 *     evidenced, how much rests on nothing. Who the supplier is, which part it
 *     is and which documents were read are not, and each is a thing that
 *     should not be sitting in a practice transcript.
 *   - **Nothing here writes anywhere.** No store is imported, and a practice
 *     session has no path back into a case: what somebody agrees with a
 *     rule-driven supplier is not a commitment, and `specs/07` says so
 *     directly — *"never invent commitments on the live case"*.
 *   - **No score.** Feedback names what was observed and one thing to try
 *     next. A number out of ten would be a judgement invented by a table of
 *     canned replies, and people remember the number long after they have
 *     forgotten it was made up.
 *
 * The supplier is played by written rule, not by a model: the replies are a
 * table, the table is visible, and the difficulty setting changes how hard the
 * supplier is to move rather than how honest it is. A supplier that lies more
 * at higher difficulty would be teaching a lesson nobody asked for.
 */

/** What every session carries, in its own data. */
export const LABEL = "Practice — does not change your live case";

/** How hard the supplier is to move. Not how truthful it is. */
export const DIFFICULTY = Object.freeze({
  EASY: "easy",
  STEADY: "steady",
  HARD: "hard",
});

export const DIFFICULTY_SAID = Object.freeze({
  [DIFFICULTY.EASY]: "Gives you what you ask for, and moves when you press",
  [DIFFICULTY.STEADY]: "Answers one question at a time, and needs pressing twice",
  [DIFFICULTY.HARD]: "Answers narrowly, repeats the ask, and moves only after you hold",
});

/** What the practice is for. The same four a real call has. */
export const GOAL = Object.freeze({
  EVIDENCE: "evidence",
  HOLD: "hold",
  SETTLE: "settle",
  DEFER: "defer",
});

/**
 * What a buyer can do on a turn.
 *
 * The same vocabulary `src/calc/shadow.mjs` uses during a real negotiation,
 * because practising a different set of moves from the ones the product
 * recommends would be practising the wrong thing.
 */
export const MOVE = Object.freeze({
  ASK: "ask",
  CHALLENGE: "challenge",
  HOLD: "hold",
  CONCEDE: "concede",
  DEFER: "defer",
  WALK: "walk",
});

export const MOVE_SAID = Object.freeze({
  [MOVE.ASK]: "Ask them for evidence",
  [MOVE.CHALLENGE]: "Challenge something they cannot support",
  [MOVE.HOLD]: "Hold where you are",
  [MOVE.CONCEDE]: "Offer a step",
  [MOVE.DEFER]: "Offer timing instead of money",
  [MOVE.WALK]: "Say you will look elsewhere",
});

/* ------------------------------------------------------------ importing */

/**
 * A real case, with the things that identify it taken out.
 *
 * Kept: how much is being asked for, how many drivers there are, how many of
 * them carry evidence, and whether part of the cost is unexplained. Those are
 * the argument. Dropped: the supplier, the part, the documents, the notes and
 * the money — a practice transcript with a real annual exposure in it is a
 * document somebody has to think about before sharing, and the exercise does
 * not need one.
 */
export function importCase(bridge, { drivers = null } = {}) {
  if (!bridge) return null;
  const contributions = bridge.contributions ?? [];
  const evidenced = (drivers ?? contributions).filter((c) => c && c.source).length;

  return Object.freeze({
    drivers: contributions.length,
    evidenced,
    unevidenced: contributions.length - evidenced,
    /* A boolean rather than the share: "part of it rests on nothing" is the
       thing to practise arguing, and the exact percentage is the live case's
       business. */
    somethingUnexplained: Boolean(bridge.unexplainedWeight && bridge.unexplainedWeight > 0n),
    /* Said plainly, so a session can open with the situation rather than a
       shape somebody has to decode. */
    said: `${contributions.length} driver${contributions.length === 1 ? "" : "s"}, `
        + `${evidenced} of them evidenced`
        + (bridge.unexplainedWeight && bridge.unexplainedWeight > 0n
            ? ", and part of the unit cost covered by no driver at all." : "."),
  });
}

/* Everything a bridge carries that must not survive the import. Named so the
   test can check the list rather than three examples of it. */
const DROPPED = Object.freeze([
  "supplier", "part", "documents", "notes", "unitPrice", "annual", "lifetime",
]);

export { DROPPED as NOT_IMPORTED };

/* -------------------------------------------------------------- sessions */

let minted = 0;

/** An id that says what it is, before anything reads the rest of the record. */
export function newSessionId() {
  return `PRACTICE-${Date.now().toString(36)}-${(minted++).toString(36).padStart(3, "0")}`;
}

/**
 * Start one.
 *
 * `from` is an imported case or nothing. With nothing, the supplier argues a
 * generic increase — which is a real exercise, and better than refusing to
 * start until somebody has a case to practise on.
 */
export function start({ goal = GOAL.EVIDENCE, difficulty = DIFFICULTY.STEADY, from = null } = {}) {
  if (!Object.values(GOAL).includes(goal)) {
    throw new TypeError(`"${goal}" is not a goal this understands`);
  }
  if (!DIFFICULTY_SAID[difficulty]) {
    throw new TypeError(`"${difficulty}" is not a difficulty this understands`);
  }

  return Object.freeze({
    id: newSessionId(),
    label: LABEL,
    synthetic: true,
    goal,
    difficulty,
    from,
    opening: from
      ? `They have asked for an increase. ${from.said} You have not agreed to anything.`
      : "They have asked for an increase and given you a one-line reason. "
        + "You have not agreed to anything.",
    turns: Object.freeze([]),
    over: false,
  });
}

/**
 * What the supplier says back.
 *
 * A table, not a model. Each reply is what a supplier plausibly says to that
 * move at that difficulty, and none of them concedes anything the buyer has
 * not first made a case for — a practice partner that folds when asked nicely
 * teaches a habit that loses money in the room.
 */
const REPLIES = Object.freeze({
  [MOVE.ASK]: {
    [DIFFICULTY.EASY]: "Of course — I will send the index and the base period we used.",
    [DIFFICULTY.STEADY]: "I can send the index. The weightings are commercially sensitive.",
    [DIFFICULTY.HARD]: "We do not share our cost structure. The figure is the figure.",
  },
  [MOVE.CHALLENGE]: {
    [DIFFICULTY.EASY]: "That is fair. I will take that element out and re-issue.",
    [DIFFICULTY.STEADY]: "I take the point, but the increase still stands as a whole.",
    [DIFFICULTY.HARD]: "Every one of our customers is accepting this.",
  },
  [MOVE.HOLD]: {
    [DIFFICULTY.EASY]: "If you cannot move, I will see what I can do at my end.",
    [DIFFICULTY.STEADY]: "Then we are some way apart. What would you accept?",
    [DIFFICULTY.HARD]: "The price takes effect from the first of next month either way.",
  },
  [MOVE.CONCEDE]: {
    [DIFFICULTY.EASY]: "Thank you — that works. I will confirm it in writing.",
    [DIFFICULTY.STEADY]: "That helps. Can we round it up and be done?",
    [DIFFICULTY.HARD]: "That is a start. It is still below where we need to be.",
  },
  [MOVE.DEFER]: {
    [DIFFICULTY.EASY]: "A later start date is easier for me than a smaller number. Agreed.",
    [DIFFICULTY.STEADY]: "I could look at the date if the number stays where it is.",
    [DIFFICULTY.HARD]: "The date is not the problem. The number is the number.",
  },
  [MOVE.WALK]: {
    [DIFFICULTY.EASY]: "Let us not do that. Tell me what you need.",
    [DIFFICULTY.STEADY]: "That would be a shame after six years. Is there a middle?",
    [DIFFICULTY.HARD]: "That is your decision. Our lead time for a new account is sixteen weeks.",
  },
});

/**
 * Take a turn.
 *
 * Returns a new session. Nothing is mutated, and nothing leaves this module:
 * what a synthetic supplier said is not evidence, not a commitment, and has no
 * route into a case.
 */
export function say(session, move, said = null) {
  if (!session || !session.synthetic) {
    throw new TypeError("Practice only runs on a practice session.");
  }
  if (session.over) throw new RangeError("This session has finished.");
  if (!MOVE_SAID[move]) throw new TypeError(`"${move}" is not a move this understands`);

  const turn = Object.freeze({
    move,
    said: said === null ? null : String(said),
    reply: REPLIES[move][session.difficulty],
  });

  return Object.freeze({
    ...session,
    turns: Object.freeze([...session.turns, turn]),
    /* Walking away ends it, because the exercise after that point is a
       different one. */
    over: move === MOVE.WALK,
  });
}

/** Stop, and look at what happened. */
export const finish = (session) => Object.freeze({ ...session, over: true });

/* -------------------------------------------------------------- feedback */

/**
 * What was observed, and one thing to try next.
 *
 * Every line names something that did or did not happen in the turns above it.
 * There is no score: a number would be invented by this table, and a made-up
 * number is remembered long after the fact that it was made up.
 */
export function feedback(session) {
  const moves = session.turns.map((t) => t.move);
  const observed = [];

  const firstConcession = moves.indexOf(MOVE.CONCEDE);
  const askedFirst = moves.indexOf(MOVE.ASK);
  const challenged = moves.includes(MOVE.CHALLENGE);

  if (moves.length === 0) {
    return Object.freeze({
      label: LABEL,
      observed: Object.freeze([]),
      next: "Nothing happened yet. Ask them for something first — it is the move that "
          + "costs nothing and the one people skip.",
      score: null,
    });
  }

  if (askedFirst === -1) {
    observed.push("You never asked them for evidence.");
  } else if (askedFirst === 0) {
    observed.push("You opened by asking for evidence, which is the move that costs nothing.");
  }

  if (firstConcession >= 0 && askedFirst === -1) {
    observed.push("You offered a step without having asked for anything first, "
      + "so the step paid for something that was never established.");
  } else if (firstConcession >= 0 && askedFirst > firstConcession) {
    observed.push("You offered a step before you had asked, and asked afterwards.");
  } else if (firstConcession >= 0) {
    observed.push("You asked before you offered anything, which is the right way round.");
  }

  if (challenged) {
    observed.push("You challenged something rather than accepting the total as given.");
  } else {
    observed.push("Nothing they said was challenged.");
  }

  if (moves.includes(MOVE.DEFER)) {
    observed.push("You put timing on the table, which costs them something and costs you "
      + "little in principle.");
  }
  if (moves.includes(MOVE.HOLD)) {
    observed.push("You held at least once rather than filling the silence with a concession.");
  }
  if (moves.includes(MOVE.WALK)) {
    observed.push("You said you would look elsewhere. Whether that is credible is a question "
      + "about your alternatives, not about the conversation.");
  }

  return Object.freeze({
    label: LABEL,
    observed: Object.freeze(observed),
    next: nextStep({ moves, askedFirst, firstConcession, challenged }),
    /* Named and null, rather than absent: an absent field invites somebody to
       add one. `specs/07`: "Avoid arbitrary numerical competency scores." */
    score: null,
  });
}

function nextStep({ moves, askedFirst, firstConcession, challenged }) {
  if (askedFirst === -1) {
    return "Next time, open by asking for the index, its base period and the lag. "
         + "It is free, and everything after it is easier.";
  }
  if (firstConcession >= 0 && askedFirst > firstConcession) {
    return "Next time, spend the asks before the concessions. A step offered first buys "
         + "nothing, because nothing has been established for it to buy.";
  }
  if (!challenged) {
    return "Next time, pick the weakest driver and challenge that one specifically. "
         + "A general objection to the total is one they can answer by repeating it.";
  }
  if (!moves.includes(MOVE.DEFER)) {
    return "Next time, try trading the date. It is the concession that costs them something "
         + "real and costs you least.";
  }
  return "Next time, try the same conversation at the next difficulty up.";
}
