/**
 * Practice on the page.
 *
 * The gate is *"practice cannot send or alter live data"*, and the module has
 * no way to — it imports nothing. What a wiring test can add is the other
 * half: that the page does not do it on the module's behalf. So the case is
 * calculated, a session is played to the end, and the calculation, the
 * confirmations, the call notes and the store are all checked to be exactly
 * where they were.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { caseViewSource } from "../helpers/page.mjs";
import { costBridge } from "../../src/calc/cost-bridge.mjs";
import { ratioFromPercent, moneyFromDecimal, moneyToDecimalString } from "../../src/calc/exact.mjs";
import { assumptionsToVerify } from "../../src/calc/provenance.mjs";
import { narrative, sectionOf, SECTION_TITLE } from "../../src/case/narrative.mjs";
import { quoteCase, needsOf } from "../../src/case/from-quote.mjs";
import {
  project, hiddenSaid, ROLE, ROLES, ROLE_TITLE, DEPTH, DEPTHS, SCOPE_SAID,
} from "../../src/case/projection.mjs";
import {
  brief, readiness as briefReadiness, DRAFT_LABEL as BRIEF_DRAFT_LABEL,
} from "../../src/case/brief.mjs";
import {
  consult, missingAcross, SPECIALIST_TITLE, NOT_CONSULTED, CONFIDENCE_SAID,
} from "../../src/case/specialists.mjs";
import { prepareNegotiation } from "../../src/calc/negotiation.mjs";
import {
  prepare as prepareCall, withGoal as withCallGoal, withQuestion as withCallQuestion,
  readiness as callReadiness, note as callNote, commitments,
  confirmCommitment, correctCommitment, commitmentUnknown, rejectCommitment,
  agreed as agreedCommitments, outstanding as outstandingCommitments,
  followUp, followUpReadiness,
  GOAL as CALL_GOAL, GOAL_SAID as CALL_GOAL_SAID, GOALS as CALL_GOALS,
  OWNER as CALL_OWNER, NOTE_SOURCE, DISPOSITION as REVIEW_DISPOSITION,
} from "../../src/case/call.mjs";
import { dictation, WHY_UNAVAILABLE as SPEECH_WHY } from "../../src/services/speech.mjs";
import { saveCall, loadCalls, newCallId } from "../../src/services/call-store.mjs";
import {
  start as practiceStart, say as practiceSay, finish as practiceDone,
  feedback as practiceFeedback, importCase as importForPractice,
  LABEL as PRACTICE_LABEL, GOAL as PRACTICE_GOAL,
  DIFFICULTY as PRACTICE_DIFFICULTY, DIFFICULTY_SAID as PRACTICE_DIFFICULTY_SAID,
  MOVE as PRACTICE_MOVE, MOVE_SAID as PRACTICE_MOVE_SAID,
} from "../../src/case/practice.mjs";

const app = readFileSync("app.js", "utf8");
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

function memory() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

function page() {
  const els = new Map();
  const store = memory();
  for (const id of ["case-view", "def-supplier", "case-brief-msg", "whatif-by",
                    "whatif-adopt-msg", "call-note", "call-note-msg", "call-msg",
                    "practice-goal", "practice-difficulty", "practice-said"]) {
    els.set(id, { id, innerHTML: "", value: "", textContent: "" });
  }
  els.get("def-supplier").value = "Northgate (synthetic)";

  const box = {
    document: { getElementById: (id) => els.get(id) ?? null },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    console,
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
    scVal: (id) => String((els.get(id) || {}).value || ""),
    window: {
      BW: {
        narrative, sectionOf, SECTION_TITLE, quoteCase, needsOf, assumptionsToVerify,
        project, hiddenSaid, ROLE, ROLES, ROLE_TITLE, DEPTH, DEPTHS, SCOPE_SAID,
        brief, briefReadiness, BRIEF_DRAFT_LABEL,
        consult, missingAcross, SPECIALIST_TITLE, NOT_CONSULTED, CONFIDENCE_SAID,
        prepareNegotiation, moneyToDecimalString,
        prepareCall, withCallGoal, withCallQuestion, callReadiness, callNote, commitments,
        confirmCommitment, correctCommitment, commitmentUnknown, rejectCommitment,
        agreedCommitments, outstandingCommitments, followUp, followUpReadiness,
        CALL_GOAL, CALL_GOAL_SAID, CALL_GOALS, CALL_OWNER, NOTE_SOURCE, REVIEW_DISPOSITION,
        dictation, SPEECH_WHY,
        saveCall: (record) => saveCall(record, store),
        loadCalls: () => loadCalls(store),
        newCallId,
        practiceStart, practiceSay, practiceDone, practiceFeedback, importForPractice,
        PRACTICE_LABEL, PRACTICE_GOAL, PRACTICE_DIFFICULTY, PRACTICE_DIFFICULTY_SAID,
        PRACTICE_MOVE, PRACTICE_MOVE_SAID,
      },
    },
    _defResult: null,
  };
  vm.createContext(box);
  new vm.Script(caseViewSource(app)).runInContext(box);

  const run = (src) => vm.runInContext(src, box);

  return {
    box, els, store, run,
    calculate: (bridge) => { box.__b = bridge; run("_defResult=__b;"); },
    render: () => run("caseRender();"),
    html: () => els.get("case-view").innerHTML,
    block: () => {
      const html = els.get("case-view").innerHTML;
      const at = html.indexOf("The call");
      return at < 0 ? "" : html.slice(at);
    },
    open: (screen) => run(`callOpen(${JSON.stringify(screen)});`),
    begin: () => run("practiceStart();"),
    beginFromCase: () => run("practiceStartFromCase();"),
    move: (m) => run(`practiceSay(${JSON.stringify(m)});`),
    type: (text) => {
      els.get("practice-said").value = text;
      run(`practiceSaid({ value: ${JSON.stringify(text)} });`);
    },
    finish: () => run("practiceFinish();"),
    again: () => run("practiceAgain();"),
    session: () => JSON.parse(run(
      "JSON.stringify(_practice === null ? null : "
      + "{ id: _practice.id, label: _practice.label, over: _practice.over, "
      + "turns: _practice.turns.length, from: _practice.from })")),
    setDifficulty: (d) => { els.get("practice-difficulty").value = d; },
    setGoal: (g) => { els.get("practice-goal").value = g; },
  };
}

let v;
beforeEach(() => { v = page(); v.calculate(claim()); v.render(); v.open("practice"); });

/* ----------------------------------------------------------- starting one */

describe("the practice tab", () => {
  test("is offered beside the three call screens", () => {
    assert.match(v.block(), />Practice</);
  });

  test("offers a difficulty for each one the module has", () => {
    for (const d of Object.values(PRACTICE_DIFFICULTY)) {
      assert.ok(v.block().includes(PRACTICE_DIFFICULTY_SAID[d]), `${d} is not offered`);
    }
  });

  test("says the supplier is a table rather than a model, before anybody starts", () => {
    assert.match(v.block(), /played by written rule, not by a model/);
  });

  test("and says what practising on this case would copy, and what it would not", () => {
    assert.match(v.block(), /The supplier, the part, the documents and every figure stay/);
  });
});

describe("a session on screen", () => {
  beforeEach(() => { v.begin(); });

  test("carries the label saying it changes nothing", () => {
    assert.ok(v.block().includes(PRACTICE_LABEL));
    assert.equal(v.session().label, PRACTICE_LABEL);
  });

  test("and its id says so too", () => {
    assert.match(v.session().id, /^PRACTICE-/);
  });

  test("every move the module knows is offered", () => {
    for (const m of Object.values(PRACTICE_MOVE)) {
      assert.ok(v.block().includes(PRACTICE_MOVE_SAID[m]), `${m} is not offered`);
    }
  });

  test("a move gets a reply, and both are shown", () => {
    v.move(PRACTICE_MOVE.ASK);
    assert.equal(v.session().turns, 1);
    assert.match(v.block(), /They said:/);
  });

  test("what somebody types is kept with the move and then cleared", () => {
    v.type("Which index, and from when?");
    v.move(PRACTICE_MOVE.ASK);
    assert.ok(v.block().includes("Which index, and from when?"));
    assert.equal(v.block().includes('value="Which index, and from when?"'), false,
      "the box still holds the last thing said");
  });

  test("difficulty changes the reply, not the honesty", () => {
    v.again();
    v.setDifficulty(PRACTICE_DIFFICULTY.HARD);
    v.begin();
    v.move(PRACTICE_MOVE.ASK);
    const hard = v.block();

    v.again();
    v.setDifficulty(PRACTICE_DIFFICULTY.EASY);
    v.begin();
    v.move(PRACTICE_MOVE.ASK);
    assert.notEqual(hard, v.block());
  });

  test("starting again puts it down", () => {
    v.move(PRACTICE_MOVE.ASK);
    v.again();
    assert.equal(v.session(), null);
    assert.match(v.block(), /What are you practising\?/);
  });
});

/* -------------------------------------------------------------- feedback */

describe("afterwards", () => {
  beforeEach(() => {
    v.begin();
    v.move(PRACTICE_MOVE.CONCEDE);
    v.move(PRACTICE_MOVE.ASK);
    v.finish();
  });

  test("it says what happened, in the module's words", () => {
    assert.ok(v.block().includes(
      practiceFeedback(practiceDone(
        practiceSay(practiceSay(practiceStart(), PRACTICE_MOVE.CONCEDE), PRACTICE_MOVE.ASK)))
        .observed[0]));
  });

  test("and never a score", () => {
    const block = v.block();
    assert.equal(/\b\d+ ?\/ ?\d+\b/.test(block), false, "a score appeared on screen");
    assert.equal(/out of (ten|10|100)/i.test(block), false);
    assert.equal(/score/i.test(block), false);
  });

  test("a finished session offers no more moves", () => {
    assert.equal(v.block().includes(PRACTICE_MOVE_SAID[PRACTICE_MOVE.ASK]
      + '</button><button'), false);
    assert.match(v.block(), /Again/);
  });
});

/* -------------------------------------------------- it cannot touch the case */

describe("practice alters nothing real", () => {
  test("playing a whole session leaves the calculation exactly where it was", () => {
    const before = v.box._defResult;
    v.begin();
    for (const m of [PRACTICE_MOVE.ASK, PRACTICE_MOVE.CHALLENGE, PRACTICE_MOVE.CONCEDE]) v.move(m);
    v.finish();
    assert.equal(v.box._defResult, before, "the calculation object was replaced");
    assert.equal(moneyToDecimalString(v.box._defResult.unitPrice.baseline), "100.00");
  });

  test("and writes nothing to storage", () => {
    v.begin();
    v.move(PRACTICE_MOVE.ASK);
    v.finish();
    assert.equal(v.store._map.size, 0, "practice stored something");
  });

  test("nothing said in practice becomes a note on the case", () => {
    v.begin();
    v.type("They will send the breakdown by 2026-10-12");
    v.move(PRACTICE_MOVE.ASK);
    v.open("during");
    assert.deepEqual(
      JSON.parse(v.run("JSON.stringify(_callNotes.map(function(n){return n.said;}))")), []);
  });

  test("and nothing in it becomes a commitment", () => {
    v.begin();
    v.move(PRACTICE_MOVE.CONCEDE);
    v.finish();
    v.open("after");
    assert.equal(v.run("_callItems === null"), true);
  });

  test("putting the case down takes the practice with it", () => {
    v.begin();
    v.move(PRACTICE_MOVE.ASK);
    v.run("caseClear();");
    assert.equal(v.session(), null);
  });
});

/* ------------------------------------------------------- importing a case */

describe("practising on this case", () => {
  test("is a separate, explicit button", () => {
    assert.match(v.block(), /data-do="practiceStartFromCase"/);
  });

  test("brings across the shape of the argument", () => {
    v.beginFromCase();
    assert.match(v.block(), /2 drivers, 1 of them evidenced/);
  });

  test("and leaves the supplier, the drivers and every figure behind", () => {
    v.beginFromCase();
    const session = JSON.stringify(v.session());
    for (const identifying of ["Northgate", "Steel bar", "Direct labour", "100.00", "50000"]) {
      assert.equal(session.includes(identifying), false, `${identifying} reached the practice`);
    }
  });

  test("starting without the button imports nothing at all", () => {
    v.begin();
    assert.equal(v.session().from, null);
  });
});
