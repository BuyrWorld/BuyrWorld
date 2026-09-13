/**
 * The shadow negotiator.
 *
 * Most of these tests defend one rule, because it is the thing buyers most
 * often get backwards and the thing a fluent language model would get wrong
 * most confidently:
 *
 *     You do not concede before you have asked.
 *
 * A concession offered while an evidence request is outstanding pays for
 * something that was never established. The engine must not put one above an
 * unspent request, whatever else is true.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { costBridge } from "../../src/calc/cost-bridge.mjs";
import { assessEvidence, evidence, EVIDENCE_KIND as K } from "../../src/calc/evidence.mjs";
import { prepareNegotiation } from "../../src/calc/negotiation.mjs";
import { recordOutcome } from "../../src/calc/outcome.mjs";
import { supplierHistory } from "../../src/calc/supplier-history.mjs";
import { alternative, assessBatna, fact, KNOWN, READINESS, MATERIAL } from "../../src/calc/batna.mjs";
import { nextMoves, recordRound, MOVE } from "../../src/calc/shadow.mjs";
import { ratioFromPercent as pc, moneyFromDecimal, moneyToDecimalString as str } from "../../src/calc/exact.mjs";

const gbp = (x) => moneyFromDecimal(x, "GBP");

const DRIVERS = [
  { id: "material", label: "Steel bar", weight: pc("42"), indexMovement: pc("10") },
  { id: "labour", label: "Labour", weight: pc("18"), indexMovement: pc("5") },
];

const bridge = () => costBridge({
  baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
  requestedChange: pc("9"), drivers: DRIVERS,
});

const plan = (b = bridge()) => prepareNegotiation({ bridge: b, ev: assessEvidence(b, {}) });
const shadow = (live = {}, extra = {}) => {
  const b = bridge();
  return nextMoves({ bridge: b, negotiation: plan(b), live, ...extra });
};
const kinds = (s) => s.moves.map((m) => m.kind);
const allAskIds = () => plan().rebuttals.map((r) => r.id);

describe("asking comes before everything", () => {
  test("with nothing asked, every top move is a request", () => {
    const s = shadow({ round: 1 });
    assert.equal(s.best.kind, MOVE.ASK);
    assert.ok(s.unspentAsks > 0);
  });

  test("no concession is offered above an unspent request", () => {
    // The rule the whole module exists for.
    const s = shadow({ round: 1 });
    const firstConcede = kinds(s).indexOf(MOVE.CONCEDE);
    const lastAsk = kinds(s).lastIndexOf(MOVE.ASK);
    if (firstConcede >= 0) assert.ok(lastAsk < firstConcede, "a concession outranked an outstanding request");
  });

  test("and the warning says so in words", () => {
    const s = shadow({ round: 1 });
    assert.ok(s.doNotConcede.some((d) => /Paying before asking settles nothing/.test(d)));
  });

  test("once the asks are spent, challenges surface", () => {
    const s = shadow({ round: 3, asked: allAskIds() });
    assert.equal(s.unspentAsks, 0);
    assert.equal(s.best.kind, MOVE.CHALLENGE);
  });

  test("a challenge is not offered before its evidence was requested", () => {
    // Before the request it is an assertion; after a refusal it is a finding.
    assert.equal(kinds(shadow({ round: 1 })).includes(MOVE.CHALLENGE), false);
  });

  test("an asked-for driver is challengeable, an unasked one is not", () => {
    const materialAsks = plan().rebuttals.filter((r) => r.driverId === "material").map((r) => r.id);
    const s = shadow({ round: 2, asked: materialAsks });
    const challenges = s.moves.filter((m) => m.kind === MOVE.CHALLENGE);
    assert.equal(challenges.length, 1);
    assert.match(challenges[0].headline, /Steel bar/);
  });
});

describe("each move carries its worth and its rule", () => {
  const s = shadow({ round: 1 });

  test("every move states the rule that produced it", () => {
    for (const m of s.moves) {
      assert.ok(m.rule && m.rule.length > 20, `${m.id} has no rule`);
      assert.ok(m.headline && m.why, `${m.id} is missing its wording`);
    }
  });

  test("money, where a move has any, is exact", () => {
    for (const m of s.moves) {
      if (m.worth) assert.equal(typeof m.worth.minor, "bigint");
    }
  });

  test("a move worth nothing quantifiable says null rather than zero", () => {
    const unexplained = s.moves.find((m) => m.id === "unexplained-cost");
    if (unexplained) assert.equal(unexplained.worth, null);
  });

  test("the method disclaims a script", () => {
    assert.match(s.method, /No language model is involved/);
    assert.match(s.method, /none of this is a script/);
  });
});

describe("where the offer sits", () => {
  test("with no offer it says to open at the hard line", () => {
    const s = shadow({ round: 1 });
    assert.equal(s.position.offer, null);
    assert.match(s.position.statement, /Open at the hard line/);
  });

  test("an offer above the evidenced figure names the unsupported part", () => {
    const s = shadow({ round: 3, supplierOffer: pc("7"), asked: allAskIds() });
    assert.equal(s.position.withinPlan, false);
    assert.match(s.position.statement, /1\.90% above the evidenced figure/);
  });

  test("an offer at or below it ends the argument", () => {
    const s = shadow({ round: 4, supplierOffer: pc("5"), asked: allAskIds() });
    assert.equal(s.position.withinPlan, true);
    assert.ok(kinds(s).includes(MOVE.HOLD));
    assert.match(s.moves.find((m) => m.kind === MOVE.HOLD).why, /nothing left to argue/);
  });

  test("holding is not offered while money is still on the table", () => {
    assert.equal(kinds(shadow({ round: 3, supplierOffer: pc("7") })).includes(MOVE.HOLD), false);
  });
});

describe("the risk of accepting now", () => {
  test("it prices what accepting would concede", () => {
    const s = shadow({ round: 3, supplierOffer: pc("7"), asked: allAskIds() });
    assert.equal(str(s.riskIfAccepted.annual), "95000.00");   // 1.90% of £5m
    assert.match(s.riskIfAccepted.statement, /concedes 1\.90% that nothing on file supports/);
  });

  test("an offer inside the evidenced figure carries no such risk", () => {
    assert.equal(shadow({ round: 4, supplierOffer: pc("4") }).riskIfAccepted, null);
  });

  test("with no offer there is nothing to price", () => {
    assert.equal(shadow({ round: 1 }).riskIfAccepted, null);
  });
});

describe("what not to concede", () => {
  const s = shadow({ round: 1 });

  test("the hard line and the evidenced figure are both named", () => {
    assert.ok(s.doNotConcede.some((d) => /rests on drivers that carry no evidence/.test(d)));
    assert.ok(s.doNotConcede.some((d) => /unsupported by construction/.test(d)));
  });

  test("the gap between them is priced", () => {
    assert.ok(s.doNotConcede.some((d) => /GBP 255000\.00 a year/.test(d)));
  });
});

describe("their own record, where it is a pattern", () => {
  const past = (at) => recordOutcome({
    bridge: bridge(), agreedChange: pc("8"),
    meta: { supplier: "Alpha Castings Ltd", recordedAt: at, caseId: "c-" + at },
  });
  const threeRounds = () => supplierHistory(
    ["2024-01", "2025-01", "2026-01"].map(past), "Alpha Castings Ltd");

  test("a driver claimed every round and never evidenced becomes a move", () => {
    const s = shadow({ round: 2, asked: allAskIds() }, { history: threeRounds() });
    const show = s.moves.find((m) => m.kind === MOVE.SHOW);
    assert.ok(show);
    assert.match(show.headline, /claimed 3 times and never evidenced/);
  });

  test("two claims is not a pattern and produces nothing", () => {
    const thin = supplierHistory(["2024-01", "2025-01"].map(past), "Alpha Castings Ltd");
    assert.equal(kinds(shadow({ round: 2 }, { history: thin })).includes(MOVE.SHOW), false);
  });

  test("a move already made is not recommended again", () => {
    const h = threeRounds();
    const id = "history-" + h.drivers.find((d) => d.claimedEveryRound && !d.everEvidenced).id;
    const s = shadow({ round: 3, asked: allAskIds(), shown: [id] }, { history: h });
    assert.equal(s.moves.some((m) => m.id === id), false);
  });
});

describe("walking away is only offered where it is real", () => {
  const withFacts = () => Object.fromEntries(MATERIAL.map((m) => [m.id, fact("yes", KNOWN.SUPPLIED)]));

  test("an assessed, checked alternative makes it a move", () => {
    const batna = assessBatna({
      alternatives: [alternative({ supplier: "Northgate", readiness: READINESS.QUALIFIED, facts: withFacts() })],
      noticePeriodWeeks: 12,
    });
    assert.ok(kinds(shadow({ round: 3 }, { batna })).includes(MOVE.WALK));
  });

  test("an alternative nobody has checked does not", () => {
    const batna = assessBatna({
      alternatives: [alternative({ supplier: "Unknown Co", readiness: READINESS.QUALIFIED })],
      noticePeriodWeeks: 12,
    });
    assert.equal(kinds(shadow({ round: 3 }, { batna })).includes(MOVE.WALK), false);
  });

  test("no BATNA at all means no bluff is suggested", () => {
    assert.equal(kinds(shadow({ round: 3 })).includes(MOVE.WALK), false);
  });
});

describe("concessions, when they do appear", () => {
  const spent = () => shadow({ round: 4, asked: allAskIds() });

  test("they are priced from the ladder, not invented", () => {
    const c = spent().moves.filter((m) => m.kind === MOVE.CONCEDE);
    assert.ok(c.length >= 1);
    for (const m of c) assert.ok(m.worth && m.worth.minor > 0n);
  });

  test("it never recommends giving away most of the remainder", () => {
    const c = spent().moves.filter((m) => m.kind === MOVE.CONCEDE);
    assert.equal(c.some((m) => /Three quarters|accepted in full/.test(m.headline)), false);
  });

  test("holding is not dressed up as a concession", () => {
    const c = spent().moves.filter((m) => m.kind === MOVE.CONCEDE);
    assert.equal(c.some((m) => /Hold at the warranted figure/.test(m.headline)), false);
  });

  test("deferral is offered before money", () => {
    const k = kinds(spent());
    const defer = k.indexOf(MOVE.DEFER);
    const concede = k.indexOf(MOVE.CONCEDE);
    if (defer >= 0 && concede >= 0) assert.ok(defer < concede, "timing costs the buyer nothing in principle");
  });
});

describe("recording what actually happened", () => {
  const rec = { id: "weight-material", kind: MOVE.ASK, headline: "Ask for the cost breakdown" };

  test("following the recommendation is recorded as such", () => {
    const r = recordRound({ recommended: rec, taken: rec, supplierResponse: "none provided", moved: true });
    assert.equal(r.followed, true);
    assert.equal(r.moved, true);
  });

  test("overriding it is kept, with the reason it matters", () => {
    // The cases where a buyer ignored it and was right are the useful ones.
    const other = { id: "defer", kind: MOVE.DEFER, headline: "Offer a deferral" };
    const r = recordRound({ recommended: rec, taken: other, moved: false });
    assert.equal(r.followed, false);
    assert.match(r.note, /overrode it and was right/);
  });

  test("whether the supplier moved is an observation, not an inference", () => {
    assert.equal(recordRound({ recommended: rec, taken: rec }).moved, null);
    assert.equal(recordRound({ recommended: rec, taken: rec, moved: "probably" }).moved, null);
  });

  test("it produces the shape the outcome capture already takes", () => {
    const r = recordRound({ recommended: rec, taken: rec, supplierResponse: "refused", moved: false });
    assert.equal(r.asArgument.id, "weight-material");
    assert.equal(r.asArgument.description, "Ask for the cost breakdown");
    assert.equal(r.asArgument.evidenceRequested, "the cost breakdown");
    assert.equal(r.asArgument.supplierResponse, "refused");
    assert.equal(r.asArgument.worked, false);
  });

  test("nothing taken produces no argument rather than an empty one", () => {
    assert.equal(recordRound({ recommended: rec }).asArgument, null);
    assert.equal(recordRound({}).followed, null);
  });
});

describe("it refuses bad input", () => {
  test("no negotiation plan is a type error", () => {
    assert.throws(() => nextMoves({}), /needs a prepareNegotiation result/);
    assert.throws(() => nextMoves({ negotiation: {} }), /needs a prepareNegotiation result/);
  });
});
