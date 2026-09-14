import { test, describe } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

import { pageSource } from "../helpers/page.mjs";
import { labelFor, assumptionsToVerify, LABEL, LEGEND } from "../../src/calc/provenance.mjs";
import { costBridge } from "../../src/calc/cost-bridge.mjs";
import { assessEvidence, evidence, EVIDENCE_KIND as K } from "../../src/calc/evidence.mjs";
import { buildDecisionPack } from "../../src/calc/decision-pack.mjs";
import { renderDecisionPackHTML } from "../../src/render/decision-pack-html.mjs";
import { ratioFromPercent as pc, moneyFromDecimal } from "../../src/calc/exact.mjs";
import { STEEL_A } from "../../src/data/sample-indices.mjs";

const gbp = (x) => moneyFromDecimal(x, "GBP");

describe("three labels, and what earns each", () => {
  test("a quoted passage is supplied", () => {
    const l = labelFor({
      provenance: "user-entered",
      evidence: evidence(K.DOCUMENT, { label: "supplier cost breakdown", quote: "steel is 42% of cost" }),
    });
    assert.equal(l.label, LABEL.SUPPLIED);
    assert.match(l.why, /a quoted passage in the supplier cost breakdown/);
  });

  test("a contract clause is supplied, and names the clause", () => {
    const l = labelFor({ evidence: evidence(K.CONTRACT, { label: "supply agreement", clause: "7.2" }) });
    assert.equal(l.label, LABEL.SUPPLIED);
    assert.match(l.why, /clause 7\.2/);
  });

  test("index lineage is supplied", () => {
    const l = labelFor({ provenance: "user-entered", lineage: "Synthetic Steel Index A: 2025-01 = 100.00" });
    assert.equal(l.label, LABEL.SUPPLIED);
    assert.match(l.why, /Synthetic Steel Index A/);
  });

  test("anything the engine computed is derived", () => {
    assert.equal(labelFor({ provenance: "system-calculated" }).label, LABEL.DERIVED);
  });

  test("typed by a person, with no source, is ASSUMED — not supplied", () => {
    // The judgement this whole module exists for. Treating "the user entered it"
    // as evidence is how a guess becomes a number in a decision pack.
    const l = labelFor({ provenance: "user-entered" });
    assert.equal(l.label, LABEL.ASSUMED);
    assert.match(l.why, /entered by hand, with no source attached/);
  });

  test("an unconfirmed model proposal is assumed; confirmed, it is supplied", () => {
    const proposed = { provenance: "ai-inferred", confirmedBy: null };
    assert.equal(labelFor(proposed).label, LABEL.ASSUMED);
    assert.match(labelFor(proposed).why, /not yet confirmed/);

    const confirmed = { provenance: "ai-inferred", confirmedBy: { by: "category owner", at: "2026-09-13" } };
    assert.equal(labelFor(confirmed).label, LABEL.SUPPLIED);
    assert.match(labelFor(confirmed).why, /confirmed by category owner/);
  });

  test("nothing at all is assumed, and says so rather than guessing", () => {
    assert.equal(labelFor(null).label, LABEL.ASSUMED);
    assert.equal(labelFor({}).label, LABEL.ASSUMED);
    assert.match(labelFor(undefined).why, /no provenance was recorded/);
  });

  test("the legend covers every label that can be produced", () => {
    const produced = new Set([
      labelFor({ provenance: "system-calculated" }).label,
      labelFor({ evidence: evidence(K.CONTRACT, { label: "a", clause: "1" }) }).label,
      labelFor({ provenance: "user-entered" }).label,
    ]);
    for (const l of produced) {
      assert.ok(LEGEND.some((x) => x.label === l), `${l} appears with no legend entry`);
    }
  });
});

describe("assumptions to verify", () => {
  const mixed = () => costBridge({
    baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
    requestedChange: pc("9"),
    drivers: [
      { id: "material", label: "Steel bar", weight: pc("42"), provenance: "user-entered",
        index: { series: STEEL_A, contractualBasePeriod: "2025-01", measurePeriod: "2026-06", lagMonths: 3 },
        evidence: { weight: evidence(K.DOCUMENT, { label: "cost breakdown", quote: "steel is 42% of ex-works cost" }) } },
      { id: "labour", label: "Labour", weight: pc("18"), indexMovement: pc("5"), provenance: "user-entered" },
    ],
    period: { retrospectiveMonths: 4 },
  });

  test("an evidenced figure does not appear; an assumed one does", () => {
    const list = assumptionsToVerify(mixed());
    assert.equal(list.some((a) => a.id === "weight-material"), false, "steel's weight is quoted, so it is not an assumption");
    assert.equal(list.some((a) => a.id === "movement-material"), false, "steel's movement has index lineage");
    assert.ok(list.some((a) => a.id === "weight-labour"));
    assert.ok(list.some((a) => a.id === "movement-labour"));
  });

  test("every entry says what would settle it", () => {
    for (const a of assumptionsToVerify(mixed())) {
      assert.ok(a.settledBy && a.settledBy.length > 15, `${a.id} does not say how to settle it`);
      assert.ok(a.assumption && a.assumption.length > 10, `${a.id} does not say what is assumed`);
    }
  });

  test("the unattributed share is named as an assumption, because assuming it flat is one", () => {
    const a = assumptionsToVerify(mixed()).find((x) => x.id === "unexplained-cost");
    assert.ok(a);
    assert.match(a.assumption, /did not move at all/);
    assert.equal(a.material, true, "40% unattributed is material");
  });

  test("retrospective volume is flagged as an estimate", () => {
    const a = assumptionsToVerify(mixed()).find((x) => x.id === "retrospective-volume");
    assert.ok(a);
    assert.match(a.assumption, /pro rata/);
  });

  test("evidence gaps do not duplicate findings already listed", () => {
    const b = mixed();
    const list = assumptionsToVerify(b, assessEvidence(b, {}));
    const ids = list.map((x) => x.id);
    assert.equal(ids.length, new Set(ids).size, "the same finding must not appear twice");
  });

  test("a fully evidenced case produces an empty list", () => {
    const clean = costBridge({
      baseline: { unitPrice: gbp("100.00"), annualVolume: 1_000 },
      requestedChange: pc("5"),
      drivers: [{
        id: "m", label: "Material", weight: pc("100"), provenance: "externally-sourced",
        index: { series: STEEL_A, contractualBasePeriod: "2025-01", measurePeriod: "2026-06" },
        evidence: { weight: evidence(K.DOCUMENT, { label: "breakdown", quote: "x" }) },
      }],
    });
    assert.deepEqual(assumptionsToVerify(clean), []);
  });
});

describe("the decision pack shows it", () => {
  const pack = () => buildDecisionPack({
    bridge: costBridge({
      baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
      requestedChange: pc("9"),
      drivers: [
        { id: "material", label: "Steel", weight: pc("42"), provenance: "user-entered",
          index: { series: STEEL_A, contractualBasePeriod: "2025-01", measurePeriod: "2026-06" },
          evidence: { weight: evidence(K.DOCUMENT, { label: "breakdown", quote: "x" }) } },
        { id: "labour", label: "Labour", weight: pc("18"), indexMovement: pc("5"), provenance: "user-entered" },
      ],
    }),
  });

  test("the pack carries a label per driver figure", () => {
    const p = pack();
    assert.equal(p.provenance.byDriver.length, 2);
    const steel = p.provenance.byDriver.find((d) => d.id === "material");
    const labour = p.provenance.byDriver.find((d) => d.id === "labour");
    assert.equal(steel.weight.label, LABEL.SUPPLIED);
    assert.equal(labour.weight.label, LABEL.ASSUMED);
    assert.equal(p.provenance.warranted.label, LABEL.DERIVED);
  });

  test("the rendered pack tags figures and carries a legend", () => {
    const html = renderDecisionPackHTML(pack());
    assert.match(html, /Every figure below is labelled/);
    assert.match(html, /class="prov prov-supplied"/);
    assert.match(html, /class="prov prov-assumed"/);
    assert.match(html, /class="prov prov-derived"/);
  });

  test("the tag does not rely on colour alone", () => {
    const html = renderDecisionPackHTML(pack());
    // Each chip contains its own word and a border, so it survives a monochrome
    // print and a colourblind reader.
    assert.match(html, /<span class="prov prov-assumed"[^>]*>assumed<\/span>/);
    assert.match(html, /\.prov \{[^}]*border: 1px solid currentColor/);
  });

  test("the Assumptions to verify block renders when there is something to verify", () => {
    const html = renderDecisionPackHTML(pack());
    assert.match(html, /<h2>Assumptions to verify<\/h2>/);
    assert.match(html, /Settled by:/);
    assert.match(html, /"verify this" without "how" is not actionable|without "how" is not actionable/);
  });

  test("and is absent when there is nothing to verify", () => {
    const clean = buildDecisionPack({
      bridge: costBridge({
        baseline: { unitPrice: gbp("100.00"), annualVolume: 1_000 },
        requestedChange: pc("5"),
        drivers: [{
          id: "m", label: "Material", weight: pc("100"), provenance: "externally-sourced",
          index: { series: STEEL_A, contractualBasePeriod: "2025-01", measurePeriod: "2026-06" },
          evidence: { weight: evidence(K.DOCUMENT, { label: "breakdown", quote: "x" }) },
        }],
      }),
    });
    assert.equal(clean.assumptionsToVerify.length, 0);
    assert.equal(renderDecisionPackHTML(clean).includes("<h2>Assumptions to verify</h2>"), false,
      "an empty block would be noise");
  });
});

describe("the calculator shows it too", () => {
  const html = pageSource();

  test("driver rows carry a provenance chip", () => {
    assert.match(html, /function provChip\(p\)/);
    assert.match(html, /ciEsc\(c\.label\)\+provChip\(pw\)/);
    assert.match(html, /P\(c\.indexMovement\)\+provChip\(pm\)/);
  });

  test("the chip carries its own word, not only a colour", () => {
    assert.match(html, /\+ciEsc\(p\.label\)\+/);
  });

  test("the legend and the verify block are rendered", () => {
    assert.match(html, /function provLegendHTML\(\)/);
    assert.match(html, /function defVerifyHTML\(r\)/);
    assert.match(html, /\+provLegendHTML\(\)/);
    assert.match(html, /\+defVerifyHTML\(r\)/);
  });
});
