/**
 * The three call screens, run against the page's own code.
 *
 * `specs/02`'s Phase 4 gate has three parts this can check without a browser:
 * practice cannot alter live data (the next file), *"notes retained only by
 * explicit save"*, and the screens themselves. The retention promise is the
 * one worth the most: a note must reach storage when somebody presses save and
 * at no other moment, including when the case is recalculated, a screen is
 * switched, a commitment is confirmed or the follow-up is copied.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { caseViewSource } from "../helpers/page.mjs";
import { costBridge } from "../../src/calc/cost-bridge.mjs";
import { assessEvidence } from "../../src/calc/evidence.mjs";
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
import { dictation, STATE as SPEECH_STATE, WHY_UNAVAILABLE as SPEECH_WHY }
  from "../../src/services/speech.mjs";
import { saveCall, loadCalls, loadCall, newCallId } from "../../src/services/call-store.mjs";

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

/** A localStorage the test can look inside. */
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
  els.set("case-view", { id: "case-view", innerHTML: "" });
  els.set("def-supplier", { id: "def-supplier", value: "Northgate (synthetic)" });
  els.set("case-brief-msg", { id: "case-brief-msg", textContent: "" });
  els.set("whatif-by", { id: "whatif-by", value: "" });
  els.set("whatif-adopt-msg", { id: "whatif-adopt-msg", textContent: "" });
  els.set("call-note", { id: "call-note", value: "" });
  els.set("call-note-msg", { id: "call-note-msg", textContent: "" });
  els.set("call-msg", { id: "call-msg", textContent: "" });

  const copied = [];
  const box = {
    document: { getElementById: (id) => els.get(id) ?? null },
    navigator: { clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } },
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
        dictation, SPEECH_STATE, SPEECH_WHY,
        /* The store is handed the test's own localStorage, so the test can see
           whether anything was written and when. */
        saveCall: (record) => saveCall(record, store),
        loadCalls: () => loadCalls(store),
        loadCall: (id) => loadCall(id, store),
        newCallId,
      },
    },
    _defResult: null,
  };
  vm.createContext(box);
  new vm.Script(caseViewSource(app)).runInContext(box);

  const run = (src) => vm.runInContext(src, box);

  return {
    box, els, copied, store, run,
    calculate: (bridge) => { box.__b = bridge; run("_defResult=__b;"); },
    render: () => run("caseRender();"),
    html: () => els.get("case-view").innerHTML,
    block: () => {
      const html = els.get("case-view").innerHTML;
      const at = html.indexOf("The call");
      return at < 0 ? "" : html.slice(at);
    },
    open: (screen) => run(`callOpen(${JSON.stringify(screen)});`),
    type: (text) => { els.get("call-note").value = text; },
    add: (text) => {
      els.get("call-note").value = text;
      run("callAddNote();");
    },
    notes: () => JSON.parse(run("JSON.stringify(_callNotes.map(function(n){return n.said;}))")),
    read: () => run("callReadNotes();"),
    items: () => JSON.parse(run(
      "JSON.stringify((_callItems||[]).map(function(i){"
      + "return {what:i.what,date:i.date,needs:i.needs,disposition:i.disposition};}))")),
    setField: (id, value) => els.set(id, { id, value }),
    confirm: (i) => run(`callConfirm(${i});`),
    unknown: (i) => run(`callUnknown(${i});`),
    reject: (i) => run(`callReject(${i});`),
    save: () => run("callSave();"),
    /* The message lands a tick later, so the promise the action hands back is
       what the test waits on. */
    copy: () => run("callCopyFollowUp();"),
    msg: () => els.get("call-msg").textContent || "",
    noteMsg: () => els.get("call-note-msg").textContent || "",
    stored: () => loadCalls(store),
    setGoal: (g) => run(`callSetGoal({ value: ${JSON.stringify(g)} });`),
    setQuestion: (i, text) =>
      run(`callSetQuestion({ value: ${JSON.stringify(text)} }, ${JSON.stringify(String(i))});`),
  };
}

let v;
beforeEach(() => { v = page(); v.calculate(claim()); v.render(); });

/* -------------------------------------------------------------- the block */

describe("before a calculation exists", () => {
  test("there is no call block, because there is no case to have a call about", () => {
    const bare = page();
    bare.render();
    assert.equal(bare.html(), "");
  });

  test("and the module missing leaves the case standing", () => {
    const bare = page();
    vm.runInContext("delete window.BW.prepareCall;", bare.box);
    bare.calculate(claim());
    bare.render();
    assert.ok(bare.html().includes("What happened"));
    assert.equal(bare.html().includes("The call"), false);
  });
});

describe("the three screens", () => {
  test("all three are offered, and none is open to begin with", () => {
    for (const label of ["Before", "During", "After"]) {
      assert.ok(v.block().includes(`>${label}<`), `${label} is not offered`);
    }
    assert.equal(v.block().includes("A line of notes"), false);
  });

  test("opening the same one again closes it", () => {
    v.open("during");
    assert.ok(v.block().includes("A line of notes"));
    v.open("during");
    assert.equal(v.block().includes("A line of notes"), false);
  });

  test("the block says nothing is kept or sent, before anything is opened", () => {
    assert.match(v.block(), /Nothing here is kept until you save it/);
  });
});

/* ------------------------------------------------------------- before it */

describe("the sheet", () => {
  beforeEach(() => { v.open("before"); });

  test("offers the four goals and nothing else", () => {
    for (const g of CALL_GOALS) assert.ok(v.block().includes(CALL_GOAL_SAID[g]));
  });

  test("shows three question slots, and they are questions", () => {
    assert.equal((v.block().match(/Question \d/g) || []).length >= 3, true);
    assert.match(v.block(), /What settles Steel bar share of unit cost\?/);
    assert.match(v.block(), /a cost breakdown from the supplier/);
  });

  test("what is left over is listed below them, not repeated in them", () => {
    assert.equal([...v.block().matchAll(/aria-label="Question \d"/g)].length, 3);
    assert.match(v.block(), /Still unanswered/);
    assert.equal(
      v.block().split("Still unanswered")[1].includes("What settles Steel bar share of unit cost?"),
      false, "a question is listed twice");
  });

  test("a question somebody writes is marked as theirs and survives a redraw", () => {
    v.setQuestion(0, "Which index did you actually use?");
    assert.ok(v.block().includes("Which index did you actually use?"));
    assert.match(v.block(), /Question 1 — yours/);
    v.render();
    assert.ok(v.block().includes("Which index did you actually use?"));
  });

  test("choosing a goal keeps it", () => {
    v.setGoal(CALL_GOAL.EVIDENCE);
    assert.ok(v.block().includes(CALL_GOAL_SAID[CALL_GOAL.EVIDENCE]));
    assert.match(v.block(), /selected/);
  });

  test("and the readiness line always says nothing has been sent", () => {
    assert.match(v.block(), /Nothing here has been sent to anybody/);
  });
});

/* -------------------------------------------------------------- during it */

describe("writing notes", () => {
  beforeEach(() => { v.open("during"); });

  test("a line is added and shown", () => {
    v.add("They will send the index breakdown by 2026-10-12");
    assert.deepEqual(v.notes(), ["They will send the index breakdown by 2026-10-12"]);
    assert.ok(v.block().includes("They will send the index breakdown by 2026-10-12"));
  });

  test("the box is cleared so the next line is not written on top of the last", () => {
    v.add("First line");
    assert.equal(v.els.get("call-note").value, "");
  });

  test("an empty one says why rather than doing nothing", () => {
    v.add("   ");
    assert.deepEqual(v.notes(), []);
    assert.match(v.noteMsg(), /not a note/);
  });

  test("the microphone is off, and the screen says why it is off", () => {
    assert.match(v.block(), /microphone off/);
    assert.ok(v.block().includes(SPEECH_WHY.NOT_ENABLED));
  });

  test("every note is marked as typed, because that is how it arrived", () => {
    v.add("They will send it by 2026-10-12");
    assert.match(v.block(), /— typed/);
  });
});

/* --------------------------------------------------------------- after it */

describe("reading the notes", () => {
  beforeEach(() => {
    v.open("during");
    v.add("They will send the index breakdown by 2026-10-12");
    v.add("We agreed to review the volumes next week");
    v.add("Long discussion about the weather");
    v.open("after");
  });

  test("nothing is read until somebody asks", () => {
    assert.match(v.block(), /Read my notes/);
    assert.equal(v.items().length, 0);
  });

  test("two commitments come out of three notes", () => {
    v.read();
    assert.equal(v.items().length, 2);
    assert.equal(v.items().some((i) => /weather/.test(i.what)), false);
  });

  test("everything starts proposed, and the words it came from are shown", () => {
    v.read();
    for (const i of v.items()) assert.equal(i.disposition, "proposed");
    assert.match(v.block(), /From your note: &quot;They will send the index breakdown/);
  });

  test("one missing its date says what it needs, and why", () => {
    v.read();
    assert.match(v.block(), /Needs a date\./);
    assert.match(v.block(), /which is not one/);
  });

  test("adding another note puts the readings back, rather than leaving a stale list", () => {
    v.read();
    assert.equal(v.items().length, 2);
    v.open("during");
    v.add("They will also confirm the freight by 2026-11-01");
    v.open("after");
    assert.equal(v.items().length, 0, "the old readings survived a new note");
  });
});

describe("deciding what was agreed", () => {
  beforeEach(() => {
    v.open("during");
    v.add("They will send the index breakdown by 2026-10-12");
    v.add("We agreed to review the volumes next week");
    v.open("after");
    v.read();
    v.setField("call-what-0", "send the index breakdown");
    v.setField("call-date-0", "2026-10-12");
    v.setField("call-what-1", "review the volumes");
    v.setField("call-date-1", "");
  });

  test("confirming an unchanged row records a confirmation", () => {
    v.confirm(0);
    assert.equal(v.items()[0].disposition, "confirmed");
  });

  test("changing the date first records a correction instead", () => {
    v.setField("call-date-0", "2026-10-19");
    v.confirm(0);
    assert.equal(v.items()[0].disposition, "corrected");
    assert.equal(v.items()[0].date, "2026-10-19");
  });

  test("confirming one that still has no date is refused, where you are looking", () => {
    v.confirm(1);
    assert.equal(v.items()[1].disposition, "proposed");
    assert.match(v.msg(), /would record a date nobody gave/);
  });

  test("correcting the date settles it", () => {
    v.setField("call-date-1", "2026-09-25");
    v.confirm(1);
    assert.equal(v.items()[1].disposition, "corrected");
    assert.equal(v.items()[1].needs, null);
  });

  test("when is not settled is a decision, and is not rejection", () => {
    v.unknown(1);
    assert.equal(v.items()[1].disposition, "unknown");
    v.reject(0);
    assert.equal(v.items()[0].disposition, "rejected");
  });

  test("a decided row stops offering the buttons", () => {
    v.confirm(0);
    assert.equal((v.block().match(/That is right/g) || []).length, 1,
      "a row that has been decided is still asking");
  });
});

/* ------------------------------------------------------ the retention rule */

describe("notes are retained only by explicit save", () => {
  beforeEach(() => {
    v.open("during");
    v.add("They will send the index breakdown by 2026-10-12");
    v.open("after");
    v.read();
    v.setField("call-what-0", "send the index breakdown");
    v.setField("call-date-0", "2026-10-12");
  });

  test("writing notes stores nothing", () => {
    assert.equal(v.store._map.size, 0);
  });

  test("reading them, deciding about them and copying the draft store nothing", async () => {
    v.confirm(0);
    await v.copy();
    v.render();
    assert.equal(v.store._map.size, 0, "something was written without being asked");
  });

  test("recalculating the case stores nothing either", () => {
    v.calculate(claim());
    v.render();
    assert.equal(v.store._map.size, 0);
  });

  test("pressing save is what writes it", () => {
    v.confirm(0);
    v.save();
    assert.equal(v.stored().length, 1);
    assert.equal(v.stored()[0].notes.length, 1);
    assert.match(v.msg(), /Saved in this browser/);
    assert.match(v.msg(), /Nothing was sent anywhere/);
  });

  test("and a reading nobody checked is left out, with the count said plainly", () => {
    v.save();
    assert.equal(v.stored()[0].commitments.length, 0);
    assert.match(v.msg(), /left out because nobody has checked/);
  });

  test("saving twice replaces rather than growing a second copy", () => {
    v.confirm(0);
    v.save();
    v.save();
    assert.equal(v.stored().length, 1);
  });

  test("the screen says what saving does, and what it does not", () => {
    assert.match(v.block(), /leaving the page loses them/);
    assert.match(v.block(), /sends them nowhere/);
  });
});

describe("the follow-up", () => {
  beforeEach(() => {
    v.open("during");
    v.add("They will send the index breakdown by 2026-10-12");
    v.open("after");
    v.read();
    v.setField("call-what-0", "send the index breakdown");
    v.setField("call-date-0", "2026-10-12");
  });

  test("goes to the clipboard, not to anybody", async () => {
    v.confirm(0);
    await v.copy();
    assert.equal(v.copied.length, 1);
    assert.match(v.copied[0], /## What we agreed/);
    assert.match(v.msg(), /nothing has been sent/);
  });

  test("an unchecked commitment is not in it as agreed", async () => {
    await v.copy();
    assert.match(v.copied[0], /Nothing was recorded as agreed/);
  });
});

describe("putting the case down", () => {
  test("takes the call with it", () => {
    v.open("during");
    v.add("They will send it by 2026-10-12");
    v.run("caseClear();");
    assert.deepEqual(v.notes(), []);
    v.render();
    assert.equal(v.block().includes("A line of notes"), false);
  });
});
