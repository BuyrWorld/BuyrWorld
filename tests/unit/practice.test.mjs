/**
 * Practice.
 *
 * The Phase 4 gate is one sentence — *"practice cannot send or alter live
 * data"* — and most of this file is that sentence checked from several angles:
 * a session says it is synthetic in its own data, an imported case arrives
 * with the identifying parts gone, and nothing in the module can write
 * anywhere or hand a commitment back to a case.
 *
 * The rest is `specs/07`'s other instruction, which is a refusal:
 * *"Avoid arbitrary numerical competency scores."*
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { costBridge } from "../../src/calc/cost-bridge.mjs";
import { ratioFromPercent, moneyFromDecimal } from "../../src/calc/exact.mjs";
import {
  start, say, finish, feedback, importCase, newSessionId,
  LABEL, GOAL, DIFFICULTY, DIFFICULTY_SAID, MOVE, MOVE_SAID, NOT_IMPORTED,
} from "../../src/case/practice.mjs";

const p = (x) => ratioFromPercent(x);
const gbp = (x) => moneyFromDecimal(x, "GBP");

const claim = () => costBridge({
  baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
  requestedChange: p("9"),
  drivers: [
    { id: "material", label: "Steel bar", weight: p("42"), indexMovement: p("10"),
      source: "synthetic-index-A" },
    { id: "labour", label: "Direct labour", weight: p("18"), indexMovement: p("5") },
  ],
});

const play = (moves, difficulty = DIFFICULTY.STEADY) =>
  moves.reduce((s, m) => say(s, m), start({ difficulty }));

/* ------------------------------------------------------ it is not real */

describe("a session says what it is", () => {
  test("carries the label in its own data, not in a caller's styling", () => {
    assert.equal(start().label, LABEL);
    assert.match(start().label, /does not change your live case/);
  });

  test("and its id says so before anything reads the rest", () => {
    assert.match(newSessionId(), /^PRACTICE-/);
    assert.match(start().id, /^PRACTICE-/);
  });

  test("it is marked synthetic, and only a synthetic session can be played", () => {
    assert.equal(start().synthetic, true);
    assert.throws(() => say({ turns: [] }, MOVE.ASK), /only runs on a practice session/);
  });

  test("a goal and a difficulty it does not understand are refused", () => {
    assert.throws(() => start({ goal: "win" }), /not a goal/);
    assert.throws(() => start({ difficulty: "impossible" }), /not a difficulty/);
  });

  test("the three difficulties differ in how hard it is to move, not how honest it is", () => {
    for (const d of Object.values(DIFFICULTY)) assert.ok(DIFFICULTY_SAID[d]);
    const easy = say(start({ difficulty: DIFFICULTY.EASY }), MOVE.ASK);
    const hard = say(start({ difficulty: DIFFICULTY.HARD }), MOVE.ASK);
    assert.notEqual(easy.turns[0].reply, hard.turns[0].reply);
  });
});

/* ------------------------------------------------------- importing a case */

describe("importing a real case", () => {
  const imported = () => importCase(claim());

  test("keeps the shape of the argument", () => {
    assert.equal(imported().drivers, 2);
    assert.equal(imported().evidenced, 1);
    assert.equal(imported().unevidenced, 1);
    assert.equal(imported().somethingUnexplained, true);
  });

  test("and drops everything that identifies it", () => {
    /* By key, not by substring: the summary sentence says "part of the unit
       cost", and a check that reads that as the `part` field is one that can
       only be satisfied by writing worse English. */
    const keys = Object.keys(imported());
    for (const field of NOT_IMPORTED) {
      assert.equal(keys.includes(field), false, `${field} survived the import`);
    }
  });

  test("and nothing a driver was called comes with it", () => {
    const words = JSON.stringify(imported());
    for (const identifying of ["Steel bar", "Direct labour", "synthetic-index-A"]) {
      assert.equal(words.includes(identifying), false, `${identifying} survived the import`);
    }
  });

  test("no money comes across", () => {
    const words = JSON.stringify(imported());
    assert.equal(/\d+\.\d{2}/.test(words), false, "a money figure reached the practice session");
    assert.equal(words.includes("50000"), false, "the volume reached the practice session");
  });

  test("the session can open without one", () => {
    assert.ok(start().opening.length > 20);
    assert.equal(start().from, null);
  });

  test("and says the situation plainly when there is one", () => {
    assert.match(start({ from: imported() }).opening, /2 drivers, 1 of them evidenced/);
  });
});

/* -------------------------------------------------------------- the turns */

describe("taking a turn", () => {
  test("every move gets a reply from the table", () => {
    for (const move of Object.values(MOVE)) {
      const s = say(start(), move);
      assert.ok(s.turns[0].reply, `${move} has no reply`);
      assert.ok(MOVE_SAID[move]);
    }
  });

  test("nothing is mutated — a turn returns a new session", () => {
    const before = start();
    const after = say(before, MOVE.ASK);
    assert.equal(before.turns.length, 0);
    assert.equal(after.turns.length, 1);
  });

  test("what the buyer said is kept beside what the supplier said", () => {
    const s = say(start(), MOVE.ASK, "Which index, and from when?");
    assert.equal(s.turns[0].said, "Which index, and from when?");
    assert.ok(s.turns[0].reply);
  });

  test("a move it does not understand is refused", () => {
    assert.throws(() => say(start(), "shout"), /not a move/);
  });

  test("walking away ends it, and a finished session cannot be played", () => {
    const s = say(start(), MOVE.WALK);
    assert.equal(s.over, true);
    assert.throws(() => say(s, MOVE.ASK), /has finished/);
  });

  test("and finishing is something a person can just do", () => {
    assert.equal(finish(start()).over, true);
  });
});

/* ------------------------------------------------------------- feedback */

describe("what it says afterwards", () => {
  test("nothing yet, and the first move to try", () => {
    const f = feedback(start());
    assert.deepEqual(f.observed, []);
    assert.match(f.next, /Ask them for something first/);
  });

  test("it never scores anybody", () => {
    const f = feedback(play([MOVE.ASK, MOVE.CHALLENGE, MOVE.DEFER, MOVE.HOLD]));
    assert.equal(f.score, null);
    const words = JSON.stringify(f);
    assert.equal(/\b\d+ ?\/ ?\d+\b/.test(words), false, "a score appeared");
    assert.equal(/out of (ten|10|100)/i.test(words), false, "a score appeared");
  });

  test("conceding before asking is named, in the order it happened", () => {
    const f = feedback(play([MOVE.CONCEDE, MOVE.ASK]));
    assert.ok(f.observed.some((o) => /before you had asked/.test(o)));
    assert.match(f.next, /spend the asks before the concessions/);
  });

  test("never asking at all is named first", () => {
    const f = feedback(play([MOVE.CONCEDE, MOVE.CONCEDE]));
    assert.ok(f.observed.some((o) => /never asked them for evidence/.test(o)));
    assert.match(f.next, /open by asking/);
  });

  test("asking first is named as the right way round", () => {
    const f = feedback(play([MOVE.ASK, MOVE.CHALLENGE, MOVE.CONCEDE]));
    assert.ok(f.observed.some((o) => /asked before you offered anything/.test(o)));
  });

  test("not challenging anything is named, with what to do about it", () => {
    const f = feedback(play([MOVE.ASK, MOVE.HOLD]));
    assert.ok(f.observed.some((o) => /Nothing they said was challenged/.test(o)));
    assert.match(f.next, /challenge that one specifically/);
  });

  test("trading timing is recognised", () => {
    const f = feedback(play([MOVE.ASK, MOVE.CHALLENGE, MOVE.DEFER]));
    assert.ok(f.observed.some((o) => /timing on the table/.test(o)));
  });

  test("and every line is about something that happened", () => {
    const f = feedback(play([MOVE.ASK]));
    assert.equal(f.observed.some((o) => /timing on the table/.test(o)), false,
      "it credited a move nobody made");
  });

  test("it carries the label too, because feedback gets pasted elsewhere", () => {
    assert.equal(feedback(play([MOVE.ASK])).label, LABEL);
  });
});

/* ------------------------------------------------------------ the promise */

describe("practice cannot touch anything real", () => {
  const source = readFileSync("src/case/practice.mjs", "utf8");

  test("it imports nothing at all", () => {
    assert.deepEqual([...source.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]), []);
  });

  test("and reaches for no store, network or global", () => {
    for (const sink of ["localStorage", "sessionStorage", "fetch(", "XMLHttpRequest",
                        "window.", "saveCase", "saveCall"]) {
      assert.equal(source.includes(sink), false, `practice.mjs reaches for ${sink}`);
    }
  });

  test("nothing it returns looks like a commitment a case could take", () => {
    /* `specs/07`: "never invent commitments on the live case". The turns are
       moves and replies; there is no owner, no date and no disposition, so
       there is nothing shaped like a commitment for a caller to file. */
    const s = play([MOVE.ASK, MOVE.CHALLENGE]);
    for (const turn of s.turns) {
      assert.deepEqual(Object.keys(turn).sort(), ["move", "reply", "said"]);
    }
  });
});
