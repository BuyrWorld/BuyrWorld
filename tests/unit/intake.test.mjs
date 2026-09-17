/**
 * What are we solving today?
 *
 * The five routes are named by `specs/05`, so the design is not in question.
 * What is in question is honesty: four of them lead somewhere and one does
 * not, and a card offering the fifth anyway is a door into an empty room.
 * Somebody who opens one stops trusting the other four.
 *
 * The other half is the describe box. A router that always matches something
 * is a router that is always confident and often wrong, and the sentence it
 * reads is being typed by somebody who does not yet know which tool they
 * want — which is precisely when being sent confidently to the wrong one
 * costs the most.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ROUTE, ROUTES, ready, notReady, routeFor, saidAboutUnready,
  resumable, resumableSaid,
} from "../../src/case/intake.mjs";

/* ------------------------------------------------------------- the five */

describe("the five entry cards", () => {
  test("all five the spec names are here", () => {
    assert.equal(ROUTES.length, 5);
    for (const id of Object.values(ROUTE)) {
      assert.ok(ROUTES.some((r) => r.id === id), id);
    }
  });

  test("each says what it is for, in a sentence about the problem", () => {
    /* Not "opens the deflation tool". Somebody arriving does not know what a
       deflation tool is; they know a supplier has asked for more money. */
    for (const r of ROUTES) {
      assert.ok(r.said.length > 30, r.id);
      assert.equal(/tool|module|page|feature/i.test(r.title), false, r.title);
    }
  });

  test("four lead somewhere and one does not", () => {
    assert.equal(ready().length, 4);
    assert.equal(notReady().length, 1);
    assert.equal(notReady()[0].id, ROUTE.DELIVERY);
  });

  test("every ready route names the page it opens", () => {
    for (const r of ready()) assert.ok(r.page, r.id);
  });

  test("the one that is not ready says what is missing, not 'coming soon'", () => {
    /* "Coming soon" is a promise. This is a description of what is absent,
       which is the thing somebody can act on — by not waiting for it. */
    const [d] = notReady();
    assert.equal(d.page, null);
    assert.match(d.whyNot, /no engine for delivery dates/);
    assert.equal(/soon|shortly|next release|roadmap/i.test(d.whyNot), false);
  });

  test("two routes that share a page say so", () => {
    /* A card that appears to open something separate and does not is a small
       lie that costs trust in the rest of the list. */
    const neg = ROUTES.find((r) => r.id === ROUTE.NEGOTIATION);
    const brief = ROUTES.find((r) => r.id === ROUTE.BRIEF);
    assert.match(neg.note, /opens the same place/);
    assert.match(brief.note, /made from a case/);
  });
});

/* --------------------------------------------------------- describing it */

describe("describing the problem", () => {
  const routes = (text) => routeFor(text).matched.map((m) => m.id);

  test("an increase goes to understanding a quote", () => {
    for (const said of [
      "Our supplier wants a 9% price increase",
      "They have put the price up again",
      "Received a new quotation with a surcharge",
    ]) {
      assert.deepEqual(routes(said), [ROUTE.QUOTE], said);
    }
  });

  test("a drawing goes to checking a drawing", () => {
    for (const said of [
      "I need to check the tolerances on this drawing",
      "A mill certificate arrived and I want it read",
    ]) {
      assert.deepEqual(routes(said), [ROUTE.DRAWING], said);
    }
  });

  test("a meeting goes to preparing a negotiation", () => {
    assert.deepEqual(routes("I have a meeting with them on Thursday"), [ROUTE.NEGOTIATION]);
  });

  test("a late delivery matches the route that is not ready", () => {
    /* It must still match. Failing to recognise it would be a second failure
       on top of not being able to help. */
    assert.deepEqual(routes("The delivery is three weeks late"), [ROUTE.DELIVERY]);
  });

  test("and that is where the honesty has to be", () => {
    const r = routeFor("The delivery is overdue and the line stops on Friday");
    assert.match(saidAboutUnready(r), /no engine for delivery dates/);
  });

  test("a sentence with two halves offers both rather than choosing", () => {
    /* A late delivery and a price increase in one sentence is one problem
       with two halves, and picking one is picking wrong half the time. */
    const r = routeFor("They are late and now they want a price increase for it");
    assert.equal(r.matched.length, 2);
    assert.equal(r.certain, false);
    assert.match(r.why, /could be/);
    assert.match(r.why, /rather than one being chosen for you/);
  });

  test("one match is reported as one match, not as certainty", () => {
    const r = routeFor("a price increase");
    assert.equal(r.certain, true);
    assert.match(r.why, /looks like/);
  });

  test("nothing recognisable says so, and guesses at nothing", () => {
    const r = routeFor("I need to sort out the thing with the people");
    assert.deepEqual([...r.matched], []);
    assert.match(r.why, /does not match any of the five/);
    assert.match(r.why, /nothing has been guessed at/);
  });

  test("an empty box is not a failure to understand", () => {
    for (const nothing of ["", "   ", null, undefined]) {
      const r = routeFor(nothing);
      assert.match(r.why, /Nothing was described yet/);
      assert.deepEqual([...r.matched], []);
    }
  });

  test("the rules are narrow enough not to fire on everything", () => {
    /* A rule matching "cost" would fire on every sentence anybody types into
       a procurement tool. These are the sentences that should match nothing. */
    for (const said of [
      "What does this tool do?",
      "Can I export the results?",
      "Who has access to my data?",
    ]) {
      assert.deepEqual(routes(said), [], said);
    }
  });

  test("nothing is ranked, because there is nothing to rank with", () => {
    /* A score here would be the confidence percentage `specs/06` forbids,
       wearing a different hat. */
    const r = routeFor("They are late and now they want a price increase for it");
    for (const m of r.matched) {
      assert.equal("score" in m, false);
      assert.equal("confidence" in m, false);
    }
  });
});

/* ------------------------------------------------------------ picking up */

describe("work to come back to", () => {
  const saved = (id, at, over = {}) => ({
    id, name: `Case ${id}`, updatedAt: at,
    summary: { waitingOn: [], unknowns: 0, ...over },
  });

  test("the most recently touched comes first", () => {
    /* What somebody is coming back to is almost always what they last left. */
    const list = resumable([
      saved("A", "2026-09-10T00:00:00Z"),
      saved("C", "2026-09-17T00:00:00Z"),
      saved("B", "2026-09-14T00:00:00Z"),
    ]);
    assert.deepEqual(list.map((x) => x.id), ["C", "B", "A"]);
  });

  test("at most three, as the spec asks", () => {
    const many = Array.from({ length: 9 }, (_, n) => saved(`S${n}`, `2026-09-0${n}T00:00:00Z`));
    assert.equal(resumable(many).length, 3);
  });

  test("and fewer than three is fewer than three, not padded", () => {
    /* "Avoid an initial wall of metrics" cuts both ways: two cases is two
       cards, not two cards and a filler. */
    assert.equal(resumable([saved("A", "2026-09-10T00:00:00Z")]).length, 1);
    assert.equal(resumable([]).length, 0);
  });

  test("a card says why it is worth opening", () => {
    const [one] = resumable([saved("A", "2026-09-10T00:00:00Z",
      { waitingOn: ["a material rate"], unknowns: 2 })]);
    const said = resumableSaid(one);
    assert.match(said, /waiting on a material rate/);
    assert.match(said, /2 things marked not known/);
  });

  test("and one with nothing outstanding says that", () => {
    const [one] = resumable([saved("A", "2026-09-10T00:00:00Z")]);
    assert.equal(resumableSaid(one), "Nothing outstanding on it.");
  });

  test("one unknown reads as one", () => {
    const [one] = resumable([saved("A", "2026-09-10T00:00:00Z", { unknowns: 1 })]);
    assert.match(resumableSaid(one), /1 thing marked not known/);
  });

  test("anything that is not a case is left out rather than shown blank", () => {
    assert.equal(resumable([null, {}, saved("A", "2026-09-10T00:00:00Z")]).length, 1);
    assert.deepEqual([...resumable(undefined)], []);
  });

  test("a case with no name is still openable", () => {
    const [one] = resumable([{ id: "SCN-9", updatedAt: "2026-09-10T00:00:00Z" }]);
    assert.equal(one.title, "SCN-9");
  });
});
