/**
 * The brief somebody sends their manager.
 *
 * This is the artefact that leaves the building, which changes what the tests
 * are about. On screen, a withheld figure not appearing is a good behaviour.
 * In a document that gets emailed, forwarded and quoted in a meeting, it is
 * the only behaviour — if the rule held everywhere except here, it would hold
 * nowhere that counted.
 *
 * So the load-bearing test is the one that runs a case with unconfirmed
 * assumptions all the way through to text and looks for a number in it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { brief, readiness, DRAFT_LABEL } from "../../src/case/brief.mjs";
import { claim, narrative, SECTION, WEIGHT } from "../../src/case/narrative.mjs";
import { quoteCase, needsOf } from "../../src/case/from-quote.mjs";
import { costBridge } from "../../src/calc/cost-bridge.mjs";
import { ratioFromPercent, moneyFromDecimal } from "../../src/calc/exact.mjs";

const p = (x) => ratioFromPercent(x);
const gbp = (x) => moneyFromDecimal(x, "GBP");

/** Shares entered by hand: the ordinary case, where they are assumed. */
const handEntered = () => costBridge({
  baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
  requestedChange: p("9"),
  drivers: [
    { id: "material", label: "Steel bar", weight: p("42"), indexMovement: p("10"),
      source: "synthetic-index-A" },
    { id: "labour", label: "Direct labour", weight: p("18"), indexMovement: p("5"),
      source: "synthetic-index-B" },
  ],
});

const caseFor = (bridge, confirmed = new Set()) =>
  narrative(quoteCase(bridge, { supplier: "Northgate (synthetic)" }), { confirmed });

/* ------------------------------------------ the rule that matters most here */

describe("a figure withheld on screen cannot reappear in the brief", () => {
  test("no number reaches the text while anything is unconfirmed", () => {
    /* The whole point. A brief is forwarded and quoted, and a figure that
       escapes into one has escaped for good. */
    const b = brief(caseFor(handEntered()));
    assert.equal(/\d+\.\d{2}\s*(GBP|%)/.test(b.text), false, b.text);
    assert.equal(/\d+\.\d{2}%/.test(b.text), false);
  });

  test("and no placeholder stands where one would have been", () => {
    const b = brief(caseFor(handEntered()));
    assert.equal(/\*\*\s*(—|-|n\/a|TBC|\?\?)\s*\*\*/i.test(b.text), false);
  });

  test("confirming everything lets the figures through", () => {
    const bridge = handEntered();
    const b = brief(caseFor(bridge, new Set(needsOf(bridge))));
    assert.match(b.text, /\d+\.\d{2} GBP/);
    assert.match(b.text, /\d+\.\d{2}%/);
    assert.equal(b.complete, true);
  });

  test("confirming most of them does not", () => {
    const bridge = handEntered();
    const some = needsOf(bridge).slice(0, -1);
    const b = brief(caseFor(bridge, new Set(some)));
    assert.equal(/\d+\.\d{2} GBP/.test(b.text), false);
    assert.equal(b.complete, false);
  });

  test("it names which figures it could not state", () => {
    /* Saying "no figures" is honest and unhelpful. Saying which ones lets
       somebody go and get them. */
    const b = brief(caseFor(handEntered()));
    assert.ok(b.withheld.length > 0);
    assert.ok(b.withheld.includes("annual"));
  });
});

/* ------------------------------------------------------- what it leads with */

describe("what is missing comes first", () => {
  test("the gaps are at the top, not the bottom", () => {
    /* A case reads top to bottom and can afford to end with what is missing.
       A brief is skimmed, and a caveat at the end of a skimmed document is a
       caveat nobody read. */
    const b = brief(caseFor(handEntered()));
    const caveat = b.text.indexOf("## Read this first");
    const story = b.text.indexOf("## What happened");

    /* Both present first. Asserting only the order passes when the caveat is
       gone entirely, because indexOf returns -1 and -1 is before everything —
       which is how deleting the whole section left this green. */
    assert.notEqual(caveat, -1, "there is no caveat section at all");
    assert.notEqual(story, -1, "the brief does not say what happened");
    assert.ok(caveat < story, "the caveat is below the narrative");
  });

  test("each unconfirmed thing is listed by name, in that section", () => {
    /* Scoped to the section. The ids also appear inside the claim sentences
       that say what they are waiting for, so searching the whole document
       finds them whether or not the list exists. */
    const bridge = handEntered();
    const b = brief(caseFor(bridge));
    const from = b.text.indexOf("## Read this first");
    assert.notEqual(from, -1);
    const listed = b.text.slice(from, b.text.indexOf("## What happened"));
    for (const id of needsOf(bridge)) assert.ok(listed.includes(id), id);
  });

  test("a complete case has no such section", () => {
    const bridge = handEntered();
    const b = brief(caseFor(bridge, new Set(needsOf(bridge))));
    assert.equal(b.text.includes("Read this first"), false);
  });
});

/* --------------------------------------------------------- it is a draft */

describe("it says it is a draft, twice", () => {
  test("in the first lines and again at the end", () => {
    /* `specs/06`: distinguish a draft recommendation from an approved action.
       Once at the top is a label somebody scrolls past. */
    const b = brief(caseFor(handEntered()));
    const first = b.text.indexOf(DRAFT_LABEL);
    const last = b.text.lastIndexOf(DRAFT_LABEL);
    assert.ok(first >= 0 && last > first, "the draft label appears once or not at all");
    assert.ok(first < 200, "the label is not near the top");
  });

  test("it says who prepared it and that nothing is agreed", () => {
    const b = brief(caseFor(handEntered()), { preparedBy: "a buyer", preparedFor: "the manager" });
    assert.match(b.text, /Prepared .* for the manager/);
    assert.match(b.text, /confirmed by a buyer/);
    assert.match(b.text, /Nothing in it has been agreed with anybody/);
  });

  test("it separates the calculation from the judgement", () => {
    /* The figures come from a tested engine. What to do about them does not,
       and a brief that blurs the two invites a manager to treat the second as
       carrying the authority of the first. */
    const b = brief(caseFor(handEntered()));
    assert.match(b.text, /The figures come from a tested calculation; the judgement does not/);
  });

  test("it never claims something was approved or agreed", () => {
    const b = brief(caseFor(handEntered()));
    assert.deepEqual([...b.forbidden], [], `the brief used forbidden wording:\n${b.text}`);
  });

  test("and it would notice if something upstream did", () => {
    /* Otherwise the check above passes because nothing ever says it, which is
       true today and is not what the test is for. */
    const rogue = narrative([
      claim({ section: SECTION.NEXT, said: "This has been approved by the category manager." }),
    ]);
    assert.ok(brief(rogue).forbidden.length > 0, "a forbidden word went unreported");
  });
});

/* ----------------------------------------------------------- the structure */

describe("what a manager is given", () => {
  const complete = () => {
    const bridge = handEntered();
    return brief(caseFor(bridge, new Set(needsOf(bridge))));
  };

  test("the four things specs/06 asks a management card for", () => {
    const text = complete().text;
    for (const heading of ["What happened", "Why it matters", "The options",
                           "The decision needed", "Evidence and what is assumed"]) {
      assert.ok(text.includes(`## ${heading}`), `${heading} is missing`);
    }
  });

  test("what is at stake is gathered where it can be skimmed", () => {
    /* The material points appear in their own sections too. A manager
       skimming for what is at stake should not have to find them, and
       repetition is the right trade. */
    const b = complete();
    assert.match(b.text, /## What is at stake/);
    assert.match(b.text, /not supported by any driver given/);
  });

  test("an empty section is left out rather than shown empty", () => {
    /* On screen an empty heading distinguishes "no options" from "options not
       shown". In a brief it is a heading with nothing under it, which reads
       as an unfinished document. */
    const thin = narrative([claim({ section: SECTION.HAPPENED, said: "Something happened." })]);
    const b = brief(thin);
    assert.equal(b.text.includes("## The options"), false);
    assert.match(b.text, /## What happened/);
  });

  test("the title is the caller's, and there is always one", () => {
    assert.match(brief(caseFor(handEntered()), { title: "Northgate, 9% ask" }).text,
      /^# Northgate, 9% ask/);
    assert.match(brief(caseFor(handEntered())).text, /^# Supplier price increase/);
  });

  test("it is markdown, because what happens to it is a paste into an email", () => {
    const b = complete();
    assert.match(b.text, /^# /m);
    assert.match(b.text, /^- /m);
    assert.equal(/<[a-z]+[ >]/i.test(b.text), false, "markup reached the brief");
  });

  test("it refuses to brief on nothing", () => {
    assert.throws(() => brief(null), /no case to brief on/);
  });
});

/* -------------------------------------------------------------- readiness */

describe("whether it is worth sending", () => {
  test("an incomplete brief is worth sending, and says why", () => {
    /* "Here is what I cannot answer" is a useful thing to tell a manager, and
       refusing to produce one would be the tool deciding that for somebody. */
    const said = readiness(brief(caseFor(handEntered())));
    assert.match(said, /unconfirmed/);
    assert.match(said, /That is worth sending/);
    assert.match(said, /says what you need in order to answer/);
  });

  test("a complete one is still a draft", () => {
    const bridge = handEntered();
    const said = readiness(brief(caseFor(bridge, new Set(needsOf(bridge)))));
    assert.match(said, /rests on something confirmed/);
    assert.match(said, /nothing in it has been agreed/);
  });

  test("the count agrees with itself", () => {
    const b = brief(caseFor(handEntered()));
    assert.ok(readiness(b).startsWith(String(b.waiting.length)));
  });
});
