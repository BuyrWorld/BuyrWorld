/**
 * The rule the whole "a model cannot reach a number" claim rests on.
 *
 * CLAUDE.md states it as a hard rule: a value marked `ai-inferred` cannot
 * enter arithmetic until a person confirms it, and this is enforced in
 * cost-bridge.mjs rather than left to convention. The owner handover and the
 * security review both repeat it.
 *
 * Until this file, nothing exercised it. 1,853 tests, and the single guard the
 * safety story depends on had never been shown to fire — while three documents
 * described it as the backstop. Tests existed that a model's output is
 * *marked* ai-inferred, and that provenance labels render correctly, but
 * nothing ever put an unconfirmed value in front of the engine.
 *
 * So this is the test that should have been written first.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  PROVENANCE, assertUsable, costBridge, formatPercent,
} from "../../src/calc/cost-bridge.mjs";
import { ratioFromPercent, moneyFromDecimal } from "../../src/calc/exact.mjs";
import { confirmField } from "../../src/services/ai/grounding.mjs";

const pc = ratioFromPercent;
const gbp = (v) => moneyFromDecimal(v, "GBP", null);

/** A claim with one driver, whose provenance the caller decides. */
const claim = (driver) => ({
  baseline: { unitPrice: gbp("10.00"), annualVolume: 100000 },
  requestedChange: pc(8),
  drivers: [{ id: "material", label: "Material", weight: pc(60), indexMovement: pc(8), ...driver }],
});

const CONFIRMED = { by: "category owner", at: "2026-09-15" };

/* ------------------------------------------------------------- the guard */

describe("assertUsable, on its own", () => {
  test("it refuses an ai-inferred value nobody has confirmed", () => {
    assert.throws(
      () => assertUsable({ provenance: PROVENANCE.AI, confirmedBy: null }, "weight"),
      /Refusing to calculate with unconfirmed AI-inferred value/);
  });

  test("the refusal says which field and what to do", () => {
    assert.throws(
      () => assertUsable({ provenance: PROVENANCE.AI, confirmedBy: null }, "material weight"),
      /material weight[\s\S]*Confirm the extracted field first/);
  });

  test("it allows the same value once somebody has confirmed it", () => {
    assert.doesNotThrow(() => assertUsable({ provenance: PROVENANCE.AI, confirmedBy: CONFIRMED }, "weight"));
  });

  test("it does not object to anything that did not come from a model", () => {
    for (const p of [PROVENANCE.USER, PROVENANCE.DOCUMENT, PROVENANCE.EXTERNAL, PROVENANCE.CALCULATED]) {
      assert.doesNotThrow(() => assertUsable({ provenance: p, confirmedBy: null }, "weight"), p);
    }
  });

  test("it ignores what is not a field at all, rather than throwing on it", () => {
    for (const v of [null, undefined, "", 0, 7]) assert.doesNotThrow(() => assertUsable(v, "x"));
  });
});

/* ------------------------------------------- the guard where it has to be */

describe("costBridge refuses to calculate with it", () => {
  test("an unconfirmed ai-inferred driver stops the calculation", () => {
    // The whole point. A model proposed a weight, nobody checked it, and the
    // engine will not turn it into money.
    assert.throws(
      () => costBridge(claim({ provenance: PROVENANCE.AI, confirmedBy: null })),
      /Refusing to calculate with unconfirmed AI-inferred value/);
  });

  test("it names the driver, so a person knows which one to check", () => {
    assert.throws(
      () => costBridge(claim({ id: "energy", label: "Energy", provenance: PROVENANCE.AI, confirmedBy: null })),
      /driver "energy"/);
  });

  test("confirming it lets the same claim through", () => {
    const r = costBridge(claim({ provenance: PROVENANCE.AI, confirmedBy: CONFIRMED }));
    assert.equal(formatPercent(r.warrantedChange), "4.80%");
  });

  test("one unconfirmed driver among several stops all of it", () => {
    // Not "the confirmed part is calculated and the rest ignored": a partial
    // decomposition would understate the warranted figure and look complete.
    const input = claim({ provenance: PROVENANCE.AI, confirmedBy: CONFIRMED });
    input.drivers.push({
      id: "energy", label: "Energy", weight: pc(20), indexMovement: pc(30),
      provenance: PROVENANCE.AI, confirmedBy: null,
    });
    assert.throws(() => costBridge(input), /driver "energy"/);
  });

  test("a user-entered claim is unaffected, which is the ordinary case", () => {
    const r = costBridge(claim({ provenance: PROVENANCE.USER }));
    assert.equal(formatPercent(r.warrantedChange), "4.80%");
  });

  test("a driver with no provenance at all still calculates", () => {
    // Absent is not the same as ai-inferred. Refusing here would break every
    // caller that never had a provenance to give.
    assert.doesNotThrow(() => costBridge(claim({})));
  });
});

/* ----------------------------------------- confirmation is a person's act */

describe("what counts as confirmed", () => {
  test("confirmField records who and when, and that is what unlocks it", () => {
    const proposed = { value: "60", quote: "material is 60% of cost", provenance: PROVENANCE.AI, confirmedBy: null };
    assert.throws(() => assertUsable(proposed, "weight"), /Refusing/);

    const confirmed = confirmField(proposed, "category owner");
    assert.equal(confirmed.confirmedBy.by, "category owner");
    assert.match(confirmed.confirmedBy.at, /^\d{4}-\d{2}-\d{2}$/);
    assert.doesNotThrow(() => assertUsable(confirmed, "weight"));
  });

  test("confirming without saying who is refused", () => {
    assert.throws(() => confirmField({ provenance: PROVENANCE.AI }), /needs to record who confirmed it/);
  });

  test("confirming does not alter the original, so the proposal survives", () => {
    const proposed = { value: "60", provenance: PROVENANCE.AI, confirmedBy: null };
    confirmField(proposed, "QA");
    assert.equal(proposed.confirmedBy, null);
  });

  test("an empty object is not a confirmation", () => {
    assert.throws(() => assertUsable({ provenance: PROVENANCE.AI, confirmedBy: "" }, "x"), /Refusing/);
    assert.throws(() => assertUsable({ provenance: PROVENANCE.AI }, "x"), /Refusing/);
  });
});

/* -------------------------------------------------- the documented claim */

describe("the rule is written down where it is enforced", () => {
  test("the wording in the guard matches what the documents promise", () => {
    // Three documents say the engine refuses. If the message ever softens
    // into a warning, this is the test that should stop it.
    let message = null;
    try {
      assertUsable({ provenance: PROVENANCE.AI, confirmedBy: null }, "weight");
    } catch (e) {
      message = e.message;
    }
    assert.ok(message, "the guard did not throw at all");
    assert.match(message, /Refusing/, "a refusal, not a warning");
  });
});
