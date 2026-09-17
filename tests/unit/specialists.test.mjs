/**
 * Who has something to say about this case.
 *
 * The design decision worth testing hardest is the one `specs/06` leads with:
 * *"Use an orchestrator to select relevant specialists, not five verbose chat
 * windows on every task."* Five cards on every case is the failure mode —
 * after the third case where the delivery specialist had nothing, nobody
 * reads any of them.
 *
 * So most of this is about restraint: who is consulted, who is not and why,
 * and the difference between a specialist that looked and found nothing and
 * one that was never asked. Those read the same when left blank and are very
 * different claims.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  consult, finding, aggregate, missingAcross,
  SPECIALIST, SPECIALIST_TITLE, NOT_CONSULTED, CONFIDENCE_SAID,
} from "../../src/case/specialists.mjs";
import { costBridge } from "../../src/calc/cost-bridge.mjs";
import { prepareNegotiation } from "../../src/calc/negotiation.mjs";
import { ratioFromPercent, moneyFromDecimal } from "../../src/calc/exact.mjs";

const p = (x) => ratioFromPercent(x);
const gbp = (x) => moneyFromDecimal(x, "GBP");

/** An increase with an unsupported part and an unattributed share. */
const bridge = (over = {}) => costBridge({
  baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
  requestedChange: p("9"),
  drivers: [
    { id: "material", label: "Steel bar", weight: p("42"), indexMovement: p("10"),
      source: "synthetic-index-A" },
    { id: "labour", label: "Direct labour", weight: p("18"), indexMovement: p("5"),
      source: "synthetic-index-B" },
  ],
  ...over,
});

const from = (c, who) => c.findings.filter((f) => f.from === who);
const skipped = (c, who) => c.notConsulted.find((x) => x.from === who);

/* --------------------------------------------------------- the restraint */

describe("only the specialists with something to say", () => {
  test("a quote-only case consults two of them", () => {
    /* Nothing pretends the other three looked. */
    const c = consult({ bridge: bridge() });
    assert.ok(from(c, SPECIALIST.COMMERCIAL).length > 0);
    assert.ok(skipped(c, SPECIALIST.TECHNICAL));
    assert.ok(skipped(c, SPECIALIST.DELIVERY));
  });

  test("a specialist with no data says so, rather than appearing empty", () => {
    /* "Nothing from delivery" reads as delivery having looked and found
       nothing, which is a stronger claim than not having been asked. */
    const c = consult({ bridge: bridge() });
    assert.equal(skipped(c, SPECIALIST.TECHNICAL).why, NOT_CONSULTED.NO_DATA);
  });

  test("and one that looked and found nothing says that instead", () => {
    /* The distinction that makes the list worth reading. */
    const clean = costBridge({
      baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
      requestedChange: p("7"),
      drivers: [{ id: "m", label: "Steel", weight: p("100"), indexMovement: p("7"),
                  source: "synthetic-index-A" }],
    });
    const c = consult({ bridge: clean });
    const note = skipped(c, SPECIALIST.COMMERCIAL);
    assert.ok(note, "commercial produced a finding on a fully supported increase");
    assert.equal(note.why, "nothing to raise on this case");
    assert.notEqual(note.why, NOT_CONSULTED.NO_DATA);
  });

  test("an empty case consults nobody and says so four times", () => {
    const c = consult({});
    assert.deepEqual([...c.findings], []);
    assert.equal(c.notConsulted.length, 4);
  });

  test("management is the brief, not a card among the cards", () => {
    /* Putting the summary of the cards among the cards is how a list stops
       being a list. */
    const c = consult({ bridge: bridge() });
    assert.equal(from(c, SPECIALIST.MANAGEMENT).length, 0);
    assert.match(c.management, /see the brief/);
  });
});

/* ------------------------------------------------------------ the cards */

describe("what a card carries", () => {
  test("all five things specs/06 asks for", () => {
    /* A finding without a consequence is an observation, and a proposed
       action without the missing inputs is a suggestion to act on something
       nobody has checked. */
    const c = consult({ bridge: bridge() });
    const unattributed = c.findings.find((f) => /no driver against it/.test(f.said));
    assert.ok(unattributed);
    assert.ok(unattributed.evidence.length > 0, "no supporting evidence");
    assert.ok(unattributed.missing.length > 0, "no missing inputs");
    assert.ok(unattributed.action, "no proposed action");
    assert.ok(unattributed.consequence, "no consequence");
  });

  test("the commercial finding names the unsupported part", () => {
    const c = consult({ bridge: bridge() });
    const said = from(c, SPECIALIST.COMMERCIAL).map((f) => f.said).join(" ");
    assert.match(said, /not supported by any driver/);
  });

  test("a contractual cap is raised as its own finding", () => {
    const capped = bridge({ constraints: { cap: p("3") } });
    assert.ok(capped.constraintApplied, "the fixture did not trigger a constraint");
    const c = consult({ bridge: capped });
    assert.match(from(c, SPECIALIST.COMMERCIAL).map((f) => f.said).join(" "),
      /what the contract permits are different figures/);
  });

  test("the negotiation cards come from the engine, not from prose", () => {
    const b = bridge();
    const c = consult({ bridge: b, plan: prepareNegotiation({ bridge: b }) });
    const cards = from(c, SPECIALIST.NEGOTIATION);
    assert.ok(cards.length > 0);
    assert.match(cards[0].evidence[0].said, /Open at the hard line/);
  });

  test("the technical specialist never signs anything off", () => {
    /* `specs/06`: never autonomous sign-off. A technical card saying a part
       is fine would be the most dangerous sentence this product could
       produce. */
    const c = consult({
      requirements: [{ id: "REQ-1", verification: "unverified", summary: "ISO 2768-m" }],
      unconfirmedReadings: [{ field: "thickness", label: "Thickness" }],
    });
    const said = from(c, SPECIALIST.TECHNICAL).map((f) => f.said + " " + f.action).join(" ");
    assert.ok(said.length > 0);
    assert.equal(/\b(is fine|approved|acceptable|conforms|signed off|passes)\b/i.test(said), false,
      `the technical specialist signed something off: ${said}`);
  });

  test("it reports what the drawing has not said", () => {
    const c = consult({
      requirements: [{ id: "REQ-1", verification: "unverified", summary: "ISO 2768-m" }],
    });
    assert.match(from(c, SPECIALIST.TECHNICAL)[0].said, /what they require is not known/);
  });

  test("delivery speaks only to what batna.mjs can answer", () => {
    /* Timing alternatives and operational unknowns are also asked for by the
       spec and have no engine here, so they are not invented. */
    const c = consult({ batna: { readiness: "not-ready", missing: ["a qualified alternative"] } });
    const cards = from(c, SPECIALIST.DELIVERY);
    assert.equal(cards.length, 1);
    assert.match(cards[0].said, /rests on this one continuing to supply/);
  });

  test("a ready alternative is not raised as a risk", () => {
    const c = consult({ batna: { readiness: "ready" } });
    assert.equal(from(c, SPECIALIST.DELIVERY).length, 0);
    assert.ok(skipped(c, SPECIALIST.DELIVERY));
  });

  test("a finding has to come from one of the five, and has to say something", () => {
    assert.throws(() => finding({ from: "vibes", said: "x" }), /not one of the five/);
    assert.throws(() => finding({ from: SPECIALIST.COMMERCIAL, said: "  " }), /say something/);
  });
});

/* ------------------------------------------------- agreement and disagreement */

describe("duplicates are gathered, contradictions are not resolved", () => {
  test("two specialists saying the same thing become one line naming both", () => {
    const both = aggregate([
      finding({ from: SPECIALIST.COMMERCIAL, said: "The lead time is unconfirmed." }),
      finding({ from: SPECIALIST.DELIVERY, said: "The lead time is unconfirmed." }),
    ]);
    assert.equal(both.length, 1);
    assert.deepEqual([...both[0].alsoFrom], [SPECIALIST.DELIVERY]);
  });

  test("the same specialist repeating itself does not cite itself twice", () => {
    const once = aggregate([
      finding({ from: SPECIALIST.COMMERCIAL, said: "The lead time is unconfirmed." }),
      finding({ from: SPECIALIST.COMMERCIAL, said: "The lead time is unconfirmed." }),
    ]);
    assert.equal(once.length, 1);
    assert.deepEqual([...once[0].alsoFrom], []);
  });

  test("two specialists disagreeing stay two findings", () => {
    /* `specs/06`: preserve contradictions as unresolved, citing both sources.
       Resolving it here by keeping the more confident one is exactly the
       invented consensus the spec forbids — and there is no confidence to
       compare anyway. */
    const both = aggregate([
      finding({ from: SPECIALIST.COMMERCIAL, said: "The alternative is cheaper." }),
      finding({ from: SPECIALIST.DELIVERY, said: "The alternative cannot deliver in time." }),
    ]);
    assert.equal(both.length, 2);
  });

  test("nothing anywhere carries a confidence percentage", () => {
    /* A number for how sure something is invites arithmetic on it, and there
       is nothing behind it to divide. */
    const b = bridge();
    const c = consult({ bridge: b, plan: prepareNegotiation({ bridge: b }),
                        batna: { readiness: "not-ready" },
                        requirements: [{ id: "R", verification: "unverified" }] });
    for (const f of c.findings) {
      assert.equal("confidence" in f, false, f.said);
      assert.equal(/\b\d{1,3}\s*% (confident|sure|likely)/i.test(f.said + f.action), false, f.said);
    }
    assert.match(CONFIDENCE_SAID, /neither is a probability/);
  });
});

/* ---------------------------------------------------------- what is missing */

describe("what the cards are waiting on", () => {
  test("it is gathered once across all of them", () => {
    const c = consult({
      bridge: bridge(),
      requirements: [{ id: "R", verification: "unverified" }],
      batna: { readiness: "not-ready", missing: ["a qualified alternative"] },
    });
    const missing = missingAcross(c);
    assert.ok(missing.length > 0);
    assert.equal(missing.length, new Set(missing).size, "the same gap is listed twice");
  });

  test("a gap two specialists both name is listed once", () => {
    /* The test above cannot see this: its fixture happens to produce no
       duplicate gaps, so the deduplication does nothing either way and
       removing it leaves the assertion green. This constructs the collision.

       It matters because the list is what somebody works through. The same
       missing thing appearing twice reads as two things to go and get. */
    const both = {
      findings: [
        finding({ from: SPECIALIST.COMMERCIAL, said: "One.", missing: ["the lead time"] }),
        finding({ from: SPECIALIST.DELIVERY, said: "Two.", missing: ["the lead time", "the volume"] }),
      ],
    };
    assert.deepEqual([...missingAcross(both)], ["the lead time", "the volume"]);
  });

  test("a case with nothing outstanding reports nothing", () => {
    assert.deepEqual([...missingAcross(consult({}))], []);
  });

  test("every specialist has a name a person would use", () => {
    for (const s of Object.values(SPECIALIST)) {
      assert.ok(SPECIALIST_TITLE[s], s);
      assert.match(SPECIALIST_TITLE[s], /^[A-Z]/, s);
    }
  });
});
