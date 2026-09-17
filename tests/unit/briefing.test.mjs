/**
 * What changed since you were last here.
 *
 * `specs/05` calls this a daily brief. It is not called that here, because
 * "daily" implies a schedule, a place the schedule runs and a reason to
 * expect something new each morning — and this build holds cases in one
 * browser with no accounts and no server. Nothing changes while nobody is
 * here. What has moved since I last looked is a real question; answering it
 * honestly beats answering a bigger one by implying facts that do not exist.
 *
 * The spec is unusually direct about what this must not become — *"no streak
 * guilt, fake urgency, opaque leaderboards or invented savings"* — and the
 * last of those is the one with teeth. Estimated opportunity, agreed savings
 * and a realised outcome are all money, all sitting in the same list, and
 * summing them is the easiest feature anybody could add here. It is also how
 * a tool starts reporting savings nobody made.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  changes, money, saidPlainly, anythingToSay,
  MOST_CHANGES, CHANGED, MONEY_KIND, MONEY_SAID, NOTHING_CHANGED, FIRST_VISIT,
} from "../../src/case/briefing.mjs";

const scenario = (id, at, over = {}) => ({
  id, name: `Case ${id}`, updatedAt: at,
  summary: { waitingOn: [], unknowns: 0, ...over },
});
const estimate = (id, at, over = {}) => ({ id, name: `Estimate ${id}`, savedAt: at, ...over });
const outcome = (id, at) => ({ id, supplier: `Supplier ${id}`, at });

/* ------------------------------------------------------------ what moved */

describe("what has moved", () => {
  test("nothing before the marker is reported", () => {
    const r = changes({ scenarios: [scenario("A", "2026-09-10T00:00:00Z")] },
      "2026-09-12T00:00:00Z");
    assert.equal(r.total, 0);
  });

  test("and everything after it is", () => {
    const r = changes({ scenarios: [scenario("A", "2026-09-14T00:00:00Z")] },
      "2026-09-12T00:00:00Z");
    assert.equal(r.total, 1);
  });

  test("a first visit shows everything rather than nothing", () => {
    /* No marker means nobody has been here. Showing nothing on the one visit
       where somebody most wants to see what is here would be a strange
       reading of "new". */
    const r = changes({ scenarios: [scenario("A", "2026-09-10T00:00:00Z")] }, null);
    assert.equal(r.total, 1);
  });

  test("cases, estimates and outcomes all count as changes", () => {
    const r = changes({
      scenarios: [scenario("A", "2026-09-14T00:00:00Z")],
      estimates: [estimate("E", "2026-09-15T00:00:00Z")],
      outcomes: [outcome("O", "2026-09-16T00:00:00Z")],
    }, null);
    assert.equal(r.total, 3);
    assert.deepEqual(
      [...r.needsYou, ...r.canWait].map((c) => c.kind).sort(),
      [CHANGED.CASE, CHANGED.ESTIMATE, CHANGED.OUTCOME].sort());
  });

  test("anything without an id is not a change", () => {
    const r = changes({ scenarios: [null, {}, scenario("A", "2026-09-14T00:00:00Z")] }, null);
    assert.equal(r.total, 1);
  });
});

/* ------------------------------------------------ what needs somebody */

describe("what needs you, and what does not", () => {
  test("a case waiting on something needs you", () => {
    const r = changes({ scenarios: [
      scenario("A", "2026-09-14T00:00:00Z", { waitingOn: ["a material rate"] }),
    ] }, null);
    assert.equal(r.needsYou.length, 1);
    assert.equal(r.canWait.length, 0);
    assert.match(r.needsYou[0].why, /Waiting on a material rate/);
  });

  test("a case marked not-known needs you too", () => {
    const r = changes({ scenarios: [scenario("A", "2026-09-14T00:00:00Z", { unknowns: 2 })] },
      null);
    assert.equal(r.needsYou.length, 1);
  });

  test("a complete case can wait", () => {
    const r = changes({ scenarios: [scenario("A", "2026-09-14T00:00:00Z")] }, null);
    assert.equal(r.canWait.length, 1);
    assert.equal(r.needsYou.length, 0);
  });

  test("an estimate saved with gaps needs you", () => {
    /* It is the one somebody will read as a number. */
    const r = changes({ estimates: [estimate("E", "2026-09-14T00:00:00Z", { complete: false })] },
      null);
    assert.equal(r.needsYou.length, 1);
    assert.match(r.needsYou[0].why, /before putting it beside another/);
  });

  test("a recorded outcome never needs you", () => {
    /* It is a thing that happened. Worth knowing, nothing to do. */
    const r = changes({ outcomes: [outcome("O", "2026-09-14T00:00:00Z")] }, null);
    assert.equal(r.needsYou.length, 0);
    assert.equal(r.canWait.length, 1);
  });

  test("the newest comes first in both lists", () => {
    const r = changes({ scenarios: [
      scenario("A", "2026-09-10T00:00:00Z"),
      scenario("C", "2026-09-17T00:00:00Z"),
      scenario("B", "2026-09-14T00:00:00Z"),
    ] }, null);
    assert.deepEqual(r.canWait.map((c) => c.id), ["C", "B", "A"]);
  });
});

/* -------------------------------------------------------------- the cap */

describe("at most three of each", () => {
  test("three is the limit the spec asks for", () => {
    assert.equal(MOST_CHANGES, 3);
    const many = Array.from({ length: 7 },
      (_, n) => scenario(`S${n}`, `2026-09-1${n}T00:00:00Z`));
    assert.equal(changes({ scenarios: many }, null).canWait.length, 3);
  });

  test("what needs you is not crowded out by what does not", () => {
    /* Truncating before sorting is how the one thing that mattered ends up
       below three that did not. */
    const mixed = [
      scenario("W1", "2026-09-17T00:00:00Z"),
      scenario("W2", "2026-09-16T00:00:00Z"),
      scenario("W3", "2026-09-15T00:00:00Z"),
      scenario("N1", "2026-09-14T00:00:00Z", { waitingOn: ["a rate"] }),
    ];
    const r = changes({ scenarios: mixed }, null);
    assert.equal(r.needsYou.length, 1);
    assert.equal(r.needsYou[0].id, "N1");
  });

  test("and what is not shown is said rather than implied by a short list", () => {
    const many = Array.from({ length: 9 },
      (_, n) => scenario(`S${n}`, `2026-09-1${n}T00:00:00Z`));
    const r = changes({ scenarios: many }, null);
    assert.equal(r.moreThanShown, 6);
    assert.match(saidPlainly(r), /6 more are not shown here/);
  });

  test("fewer than three says nothing about more", () => {
    const r = changes({ scenarios: [scenario("A", "2026-09-14T00:00:00Z")] }, null);
    assert.equal(r.moreThanShown, 0);
    assert.equal(/not shown/.test(saidPlainly(r)), false);
  });
});

/* ------------------------------------------------------------ the wording */

describe("what it says", () => {
  test("nothing changed is a statement, not a congratulation", () => {
    /* "You're all caught up" is congratulation for the absence of work, and
       the spec bans streak guilt for the same reason. */
    const r = changes({}, "2026-09-12T00:00:00Z");
    assert.equal(saidPlainly(r), NOTHING_CHANGED);
    assert.equal(/caught up|well done|great|keep it up|streak/i.test(NOTHING_CHANGED), false);
  });

  test("a first visit says what will happen rather than that nothing has", () => {
    const r = changes({}, null);
    assert.equal(saidPlainly(r, { firstVisit: true }), FIRST_VISIT);
    assert.match(FIRST_VISIT, /show up here when you come back/);
  });

  test("it counts both kinds", () => {
    const r = changes({ scenarios: [
      scenario("N", "2026-09-17T00:00:00Z", { waitingOn: ["a rate"] }),
      scenario("W", "2026-09-16T00:00:00Z"),
    ] }, null);
    const said = saidPlainly(r);
    assert.match(said, /1 thing needs something from you/);
    assert.match(said, /1 other moved and can wait/);
  });

  test("plurals hold", () => {
    const r = changes({ scenarios: [
      scenario("N1", "2026-09-17T00:00:00Z", { waitingOn: ["a"] }),
      scenario("N2", "2026-09-16T00:00:00Z", { waitingOn: ["b"] }),
      scenario("W1", "2026-09-15T00:00:00Z"),
      scenario("W2", "2026-09-14T00:00:00Z"),
    ] }, null);
    const said = saidPlainly(r);
    assert.match(said, /2 things need something from you/);
    assert.match(said, /2 others moved/);
  });

  test("nothing anywhere is urgent, overdue or a streak", () => {
    /* `specs/05` bans fake urgency and streak guilt outright. */
    const r = changes({ scenarios: [
      scenario("N", "2026-09-17T00:00:00Z", { waitingOn: ["a rate"] }),
    ] }, null);
    const all = [saidPlainly(r), NOTHING_CHANGED, FIRST_VISIT,
                 ...r.needsYou.map((c) => `${c.said} ${c.why}`)].join(" ");
    assert.equal(/urgent|overdue|deadline|streak|don't lose|act now|last chance/i.test(all), false,
      all);
  });

  test("anythingToSay answers the question a caller actually has", () => {
    assert.equal(anythingToSay(changes({}, null)), false);
    assert.equal(anythingToSay(changes({ scenarios: [scenario("A", "2026-09-14T00:00:00Z")] },
      null)), true);
  });
});

/* -------------------------------------------------- the three kinds of money */

describe("three figures, never added", () => {
  test("each is carried with a sentence saying what it is", () => {
    /* A number under a heading somebody skimmed gets repeated in a meeting as
       though it were banked. */
    const m = money({ estimated: "40000.00", agreed: "12000.00", realised: "3000.00" });
    assert.equal(m.rows.length, 3);
    for (const row of m.rows) {
      assert.ok(MONEY_SAID[row.kind], row.kind);
      assert.equal(row.said, MONEY_SAID[row.kind]);
    }
  });

  test("there is no total, and the absence is deliberate", () => {
    /* The easiest possible feature to add here, and how a tool starts
       reporting savings nobody made. */
    const m = money({ estimated: "40000.00", agreed: "12000.00", realised: "3000.00" });
    assert.equal("total" in m, false);
    assert.equal("sum" in m, false);
    assert.match(m.why, /not added together/);
    assert.match(m.why, /savings nobody made/);
  });

  test("the three say different things about what they are", () => {
    assert.match(MONEY_SAID[MONEY_KIND.ESTIMATED], /Nobody has agreed it/);
    assert.match(MONEY_SAID[MONEY_KIND.AGREED], /not necessarily been invoiced/);
    assert.match(MONEY_SAID[MONEY_KIND.REALISED], /actually landed/);
    assert.equal(new Set(Object.values(MONEY_SAID)).size, 3);
  });

  test("a figure that does not exist is absent rather than zero", () => {
    /* Nothing agreed yet is not nothing agreed. */
    const m = money({ estimated: "40000.00" });
    assert.equal(m.rows.length, 1);
    assert.equal(m.rows[0].kind, MONEY_KIND.ESTIMATED);
  });

  test("no figures at all is an empty list, not three zeroes", () => {
    assert.deepEqual([...money({}).rows], []);
  });

  test("nothing here computes a figure", () => {
    /* Each is whatever the caller's own engine worked out, carried across. */
    const m = money({ agreed: { minor: 1200000n, currency: "GBP" } });
    assert.equal(m.rows[0].value.minor, 1200000n);
  });
});
