/**
 * Before the call, during it, and afterwards.
 *
 * `specs/07` and the Phase 4 gate in `specs/02` both turn on restraint rather
 * than capability: *"Unknown dates stay unknown"*, *"Sending requires
 * deliberate review/action"*, *"notes retained only by explicit save"*. So most
 * of this file is about what the module will not do — read a date out of
 * something that is not one, confirm a commitment that is missing its date,
 * put an unchecked line in a follow-up as agreed, or write anything anywhere.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { costBridge } from "../../src/calc/cost-bridge.mjs";
import { assessEvidence } from "../../src/calc/evidence.mjs";
import { prepareNegotiation } from "../../src/calc/negotiation.mjs";
import { ratioFromPercent, moneyFromDecimal } from "../../src/calc/exact.mjs";
import {
  prepare, withGoal, withQuestion, readiness,
  note, commitments, dateIn,
  confirmCommitment, correctCommitment, commitmentUnknown, rejectCommitment,
  agreed, outstanding, followUp, followUpReadiness,
  GOAL, GOAL_SAID, NOTE_SOURCE, OWNER, PHASE, DISPOSITION,
} from "../../src/case/call.mjs";

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

const planned = () => {
  const bridge = claim();
  return prepare({ bridge, negotiation: prepareNegotiation({ bridge, ev: assessEvidence(bridge) }) });
};

/* ------------------------------------------------------------ before it */

describe("the sheet you take in", () => {
  test("says what the case has, and where each part came from", () => {
    const sheet = planned();
    assert.equal(sheet.phase, PHASE.BEFORE);
    assert.ok(sheet.context.length > 0);
    for (const c of sheet.context) assert.ok(c.from, "a line with no source");
  });

  test("three questions, derived from the ladder", () => {
    const sheet = planned();
    assert.equal(sheet.questions.length, 3);
    assert.ok(sheet.questions.some((q) => /Steel bar/.test(q.said ?? "")));
    assert.ok(sheet.questions.every((q) => !q.said || q.from));
  });

  test("and never three by padding", () => {
    /* No plan and no unresolved list: the slots are empty and say whose they
       are to write. "Ask about their cost base" is what a padded sheet looks
       like, and it makes a sheet look finished when it is not. */
    const sheet = prepare({});
    assert.equal(sheet.questions.length, 3);
    assert.deepEqual(sheet.questions.map((q) => q.said), [null, null, null]);
    assert.match(readiness(withGoal(sheet, GOAL.HOLD)), /none is written/);
  });

  test("a question somebody writes is marked as theirs", () => {
    const sheet = withQuestion(planned(), 0, "Which index did you actually use?");
    assert.equal(sheet.questions[0].said, "Which index did you actually use?");
    assert.equal(sheet.questions[0].mine, true);
    assert.equal(sheet.questions[0].from, "you");
    assert.equal(sheet.questions[1].mine, false, "the others were rewritten too");
  });

  test("and a question can be cleared back to an empty slot", () => {
    const sheet = withQuestion(planned(), 1, "   ");
    assert.equal(sheet.questions[1].said, null);
    assert.equal(sheet.questions[1].mine, false);
  });

  test("there are only three of them", () => {
    assert.throws(() => withQuestion(planned(), 3, "a fourth"), /three questions/);
  });

  test("the goal is one of the four, not free text", () => {
    assert.throws(() => withGoal(planned(), "get the best price"), /not a goal/);
    assert.equal(withGoal(planned(), GOAL.DEFER).goal, GOAL.DEFER);
  });

  test("readiness says what is missing", () => {
    assert.match(readiness(planned()), /No goal chosen/);
    assert.match(readiness(withGoal(planned(), GOAL.EVIDENCE)), /2 of three questions/);
    assert.match(
      readiness(withQuestion(withGoal(planned(), GOAL.EVIDENCE), 2, "And the lag?")),
      /Three questions and a goal/);
  });

  test("and says nothing has been sent, on every one of them", () => {
    const sheets = [
      planned(),
      withGoal(planned(), GOAL.EVIDENCE),
      withQuestion(withGoal(prepare({}), GOAL.HOLD), 0, "Which index?"),
      prepare({}),
    ];
    for (const s of sheets) assert.match(readiness(s), /Nothing here has been sent/);
  });

  test("preparing one changes nothing about the case", () => {
    const bridge = claim();
    const before = JSON.stringify(bridge, (k, v) => typeof v === "bigint" ? String(v) : v);
    prepare({ bridge, negotiation: prepareNegotiation({ bridge }) });
    assert.equal(
      JSON.stringify(bridge, (k, v) => typeof v === "bigint" ? String(v) : v), before);
  });
});

/* ------------------------------------------------------------- during it */

describe("notes", () => {
  test("say how they arrived", () => {
    assert.equal(note({ text: "they mentioned steel" }).source, NOTE_SOURCE.TYPED);
    assert.equal(
      note({ text: "they mentioned steel", source: NOTE_SOURCE.DICTATED }).source,
      NOTE_SOURCE.DICTATED);
  });

  test("an empty one is not a note", () => {
    assert.throws(() => note({ text: "   " }), /not a note/);
  });

  test("and one with no provenance is refused", () => {
    assert.throws(() => note({ text: "x", source: "guessed" }), /how it arrived/);
  });
});

/* ------------------------------------------------------------ the dates */

describe("reading a date", () => {
  test("a full ISO date is one", () => {
    assert.equal(dateIn("send it by 2026-10-12").iso, "2026-10-12");
  });

  test("a named date with a year is one", () => {
    assert.equal(dateIn("by 12 October 2026").iso, "2026-10-12");
    assert.equal(dateIn("by October 12, 2026").iso, "2026-10-12");
  });

  test("a named date with no year is not, and says why", () => {
    const d = dateIn("by 12 October");
    assert.equal(d.iso, null);
    assert.equal(d.said, "12 October");
    assert.equal(d.needs, "a year");
    assert.match(d.why, /wrong every December/);
  });

  test("12/10/2026 is refused rather than chosen between", () => {
    const d = dateIn("re-issue by 12/10/2026");
    assert.equal(d.iso, null);
    assert.match(d.why, /two different days/);
  });

  test("next week is not a date", () => {
    const d = dateIn("we will look at it next week");
    assert.equal(d.iso, null);
    assert.equal(d.said, "next week");
    assert.equal(d.needs, "a date");
  });

  test("and a line with nothing in it says nothing says when", () => {
    const d = dateIn("they will think about it");
    assert.equal(d.said, null);
    assert.match(d.why, /Nothing in the note says when/);
  });
});

/* ------------------------------------------------- what the notes propose */

describe("commitments read out of notes", () => {
  const notes = () => [
    note({ text: "They will send the index breakdown by 2026-10-12" }),
    note({ text: "We agreed to review the volumes next week" }),
    note({ text: "Long discussion about the weather" }),
    note({ text: "Supplier to confirm the freight terms by 12 October" }),
  ];

  test("each carries who, what, when and the words it came from", () => {
    const [first] = commitments(notes());
    assert.equal(first.owner, OWNER.THEM);
    assert.equal(first.what, "send the index breakdown");
    assert.equal(first.date, "2026-10-12");
    assert.equal(first.evidence.quote, "They will send the index breakdown by 2026-10-12");
    assert.equal(first.evidence.source, NOTE_SOURCE.TYPED);
  });

  test("a line that commits nobody to anything produces nothing", () => {
    assert.equal(commitments(notes()).length, 3);
    assert.equal(
      commitments(notes()).some((c) => /weather/.test(c.what)), false);
  });

  test("everything starts proposed, and nothing starts agreed", () => {
    for (const c of commitments(notes())) assert.equal(c.disposition, DISPOSITION.PROPOSED);
    assert.deepEqual(agreed(commitments(notes())), []);
  });

  test("the date comes out of the words, so a follow-up says it once", () => {
    const [first] = commitments(notes());
    assert.equal(first.what.includes("2026-10-12"), false);
    assert.equal(first.what.endsWith("by"), false, "a dangling preposition was left behind");
  });

  test("a dictated line is marked as dictated all the way through", () => {
    const [c] = commitments([
      note({ text: "They will send it by 2026-10-12", source: NOTE_SOURCE.DICTATED })]);
    assert.equal(c.evidence.source, NOTE_SOURCE.DICTATED);
  });
});

describe("deciding about one", () => {
  const first = () => commitments([
    note({ text: "They will send the index breakdown by 2026-10-12" })])[0];
  const undated = () => commitments([
    note({ text: "We agreed to review the volumes next week" })])[0];

  test("confirming records who did it", () => {
    const c = confirmCommitment(first(), "category manager");
    assert.equal(c.disposition, DISPOSITION.CONFIRMED);
    assert.equal(c.revisions.at(-1).by, "category manager");
  });

  test("and cannot be done by nobody", () => {
    assert.throws(() => confirmCommitment(first()), /who made it/);
  });

  test("one missing its date cannot be confirmed", () => {
    assert.throws(() => confirmCommitment(undated(), "me"), /would record a date nobody gave/);
  });

  test("but it can be corrected into one", () => {
    const c = correctCommitment(undated(), { date: "2026-09-25" }, "me");
    assert.equal(c.date, "2026-09-25");
    assert.equal(c.needs, null);
    assert.equal(c.disposition, DISPOSITION.CORRECTED);
  });

  test("a correction that is not a date is refused", () => {
    assert.throws(() => correctCommitment(undated(), { date: "next Tuesday" }, "me"), /not a date/);
  });

  test("or marked unknown, which is not the same as rejected", () => {
    const unknown = commitmentUnknown(undated(), "me", "they would not commit");
    assert.equal(unknown.disposition, DISPOSITION.UNKNOWN);
    assert.equal(unknown.date, null);
    assert.equal(rejectCommitment(undated(), "me").disposition, DISPOSITION.REJECTED);
  });

  test("the words it was read from survive every decision", () => {
    const corrected = correctCommitment(first(), { what: "send the full breakdown" }, "me");
    assert.equal(corrected.evidence.quote, "They will send the index breakdown by 2026-10-12");
    assert.equal(corrected.revisions.at(-1).from.what, "send the index breakdown");
  });

  test("only what somebody stood behind counts as agreed", () => {
    const items = [confirmCommitment(first(), "me"), undated()];
    assert.equal(agreed(items).length, 1);
    assert.equal(outstanding(items).length, 1);
  });
});

/* ------------------------------------------------------------ afterwards */

describe("the follow-up draft", () => {
  const items = () => commitments([
    note({ text: "They will send the index breakdown by 2026-10-12" }),
    note({ text: "We agreed to review the volumes next week" }),
  ]);

  test("lists only checked commitments as agreed", () => {
    const decided = [confirmCommitment(items()[0], "me"), items()[1]];
    const draft = followUp(withGoal(prepare({}), GOAL.EVIDENCE), decided);
    assert.match(draft.text, /## What we agreed[\s\S]*send the index breakdown by 2026-10-12/);
    assert.match(draft.text, /## Still open[\s\S]*review the volumes — still needs a date/);
  });

  test("says so plainly when nothing was checked", () => {
    const draft = followUp(prepare({}), items());
    assert.match(draft.text, /Nothing was recorded as agreed/);
    assert.equal(draft.complete, false);
  });

  test("is a draft, and says nothing has been sent", () => {
    const draft = followUp(prepare({}), items());
    assert.equal(draft.sent, false);
    assert.match(draft.text, /not a record either side has agreed/);
    assert.match(followUpReadiness(draft), /Nothing has been sent/);
  });

  test("names what the call was for, when one was chosen", () => {
    const draft = followUp(withGoal(prepare({}), GOAL.HOLD), []);
    assert.ok(draft.text.includes(GOAL_SAID[GOAL.HOLD]));
  });
});

/* ------------------------------------------------- the retention promise */

describe("nothing here is retained", () => {
  test("the module cannot write anywhere, which is how the promise is kept", () => {
    /* `specs/02`'s Phase 4 gate: "notes retained only by explicit save". The
       check is on the source rather than on behaviour, because the assurance
       being made is that there is no path at all. */
    const source = readFileSync("src/case/call.mjs", "utf8");
    for (const sink of ["localStorage", "sessionStorage", "indexedDB", "fetch(", "XMLHttpRequest"]) {
      assert.equal(source.includes(sink), false, `call.mjs reaches for ${sink}`);
    }
  });

  test("and it imports nothing that can", () => {
    const source = readFileSync("src/case/call.mjs", "utf8");
    const imports = [...source.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]);
    assert.deepEqual(imports, ["../intake/review.mjs"]);
  });
});
