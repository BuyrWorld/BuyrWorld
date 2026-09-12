/**
 * Synthetic supplier claim SC-001 — "Meridian Fabrication Ltd".
 *
 * FICTIONAL. Invented supplier, invented part, invented indices, invented
 * volumes. No real supplier, contract, price or customer information appears
 * here, and none should ever be added.
 *
 * Run it:  node fixtures/synthetic-claim-001.mjs
 */
import { costBridge, partialAcceptance, delayEffect, formatPercent } from "../src/calc/cost-bridge.mjs";
import { ratioFromPercent as pc, moneyFromDecimal, moneyToDecimalString as gbp } from "../src/calc/exact.mjs";

export const SC001 = {
  meta: {
    id: "SC-001",
    supplier: "Meridian Fabrication Ltd (fictional)",
    part: "Bracket assembly, mild steel, powder coated (fictional)",
    received: "2026-09-01",
    synthetic: true,
  },
  baseline: { unitPrice: moneyFromDecimal("100.00", "GBP", "2026-01-01"), annualVolume: 50_000 },
  requestedChange: pc("9"),
  drivers: [
    { id: "material", label: "Steel bar",      weight: pc("42"), indexMovement: pc("10"), source: "synthetic-index-A", provenance: "externally-sourced" },
    { id: "labour",   label: "Direct labour",  weight: pc("18"), indexMovement: pc("5"),  source: "synthetic-index-B", provenance: "externally-sourced" },
    { id: "energy",   label: "Electricity",    weight: pc("8"),  indexMovement: pc("12"), source: "synthetic-index-C", provenance: "externally-sourced" },
  ],
  constraints: {},
  period: { retrospectiveMonths: 4 },
};

function main() {
  const r = costBridge(SC001);

  console.log(`\nSynthetic claim ${SC001.meta.id} — ${SC001.meta.supplier}`);
  console.log(`${SC001.meta.part}`);
  console.log("-".repeat(72));
  console.log(`Baseline unit price        GBP ${gbp(SC001.baseline.unitPrice)}   x ${SC001.baseline.annualVolume.toLocaleString()} / yr`);
  console.log(`Supplier requests          ${formatPercent(r.requestedChange)}  ->  GBP ${gbp(r.unitPrice.requested)}`);
  console.log();

  console.log("Claim decomposition");
  for (const c of r.contributions) {
    console.log(
      `  ${c.label.padEnd(16)} ${formatPercent(c.weight).padStart(7)} of cost` +
      ` x ${formatPercent(c.indexMovement).padStart(7)} movement` +
      ` = ${formatPercent(c.contribution).padStart(7)}   [${c.source}]`
    );
  }
  console.log(`  ${"unexplained".padEnd(16)} ${formatPercent(r.unexplainedWeight).padStart(7)} of cost` +
              `                          treated as unchanged`);
  console.log();

  console.log(`Warranted by evidence      ${formatPercent(r.warrantedChange)}  ->  GBP ${gbp(r.unitPrice.warranted)}`);
  console.log(`UNSUPPORTED                ${formatPercent(r.unsupportedChange)}  ->  GBP ${gbp(r.delta.unsupported)} per unit`);
  console.log();

  console.log("Exposure");
  console.log(`  Annual, as requested     GBP ${gbp(r.annual.requested)}`);
  console.log(`  Annual, as warranted     GBP ${gbp(r.annual.warranted)}`);
  console.log(`  Annual, unsupported      GBP ${gbp(r.annual.unsupported)}   <- the negotiation`);
  console.log(`  Three-year unsupported   GBP ${gbp(r.lifetime.unsupported)}`);
  if (r.retrospective) {
    console.log(`  Retrospective (${r.retrospective.months} mo)    GBP ${gbp(r.retrospective.unsupported)} on ~${r.retrospective.units} units already delivered`);
  }
  console.log();

  const concede = partialAcceptance(r, r.warrantedChange);
  const delay = delayEffect(r, 3, SC001.baseline.annualVolume);
  console.log("Options");
  console.log(`  Concede the warranted ${formatPercent(r.warrantedChange)}   costs GBP ${gbp(concede.annualCost)} / yr, avoids GBP ${gbp(concede.annualAvoided)}`);
  console.log(`  Delay 3 months                 avoids GBP ${gbp(delay.firstYearAvoided)} in year one`);
  console.log();

  console.log("Assumptions");
  for (const a of r.assumptions) console.log(`  - ${a.text}`);
  console.log();
  console.log(`Formula: ${r.formula}`);
  console.log("All figures computed in exact integer arithmetic. No language model was involved.\n");
}

if (import.meta.url === `file://${process.argv[1].split("\\").join("/")}` ||
    process.argv[1]?.endsWith("synthetic-claim-001.mjs")) {
  main();
}
