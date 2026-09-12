/**
 * ProcureBench — the evaluation corpus.
 *
 * Every case is FICTIONAL. Invented suppliers, parts, indices and volumes. No
 * real supplier, contract, price or customer information appears here, and none
 * may ever be added.
 *
 * Design rule: cases are NOT tuned to make the system look accurate. Several
 * exist specifically because they are hard, and at least one exists because the
 * correct answer is "the supplier is right, pay it".
 *
 * Each case declares:
 *   input            what goes into the engine
 *   expect           exact expected outputs (calculation layer — evaluable now)
 *   expectGaps       evidence gaps a competent reviewer must be shown
 *   boundaries       acceptable recommendation range (for the options layer)
 *   mustNotClaim     hallucinations that would be unacceptable
 *   notYetEvaluable  true when the case needs a layer that does not exist yet
 */

import { ratioFromPercent as pc, moneyFromDecimal as m } from "../../src/calc/exact.mjs";
import { STEEL_A } from "./indices.mjs";

const GBP = (x) => m(x, "GBP");
const d = (id, label, weight, move) => ({ id, label, weight: pc(weight), indexMovement: pc(move), provenance: "user-entered" });

export const CASES = [

/* ---------------------------------------------------- straightforward ---- */
{
  id: "PB-01",
  title: "Weighted decomposition, plain",
  why: "The base case. If this drifts, everything downstream is wrong.",
  input: {
    baseline: { unitPrice: GBP("100.00"), annualVolume: 50_000 },
    requestedChange: pc("9"),
    drivers: [d("material", "Steel bar", "42", "10"), d("labour", "Labour", "18", "5"), d("energy", "Energy", "8", "12")],
  },
  expect: { warrantedChange: "6.06%", unsupportedChange: "2.94%", annualUnsupported: "147000.00", unexplainedWeight: "32.00%" },
  expectGaps: ["32% of unit cost is unexplained"],
  boundaries: { minAccept: "0%", maxAccept: "6.06%" },
  mustNotClaim: ["that the full 9% is supported", "a named index the buyer did not supply"],
},

{
  id: "PB-02",
  title: "Accepting is the correct answer",
  why: "An engine that cannot say 'they are right, pay it' is an argument generator, not an analysis tool.",
  input: {
    baseline: { unitPrice: GBP("48.00"), annualVolume: 12_000 },
    requestedChange: pc("5.4"),
    drivers: [d("material", "Polymer resin", "60", "8"), d("freight", "Inbound freight", "12", "5")],
  },
  expect: { warrantedChange: "5.40%", unsupportedChange: "0.00%", annualUnsupported: "0.00" },
  expectGaps: ["28% of unit cost is unexplained"],
  boundaries: { minAccept: "5.4%", maxAccept: "5.4%" },
  mustNotClaim: ["that the claim is inflated", "that evidence is missing for the claimed drivers"],
},

{
  id: "PB-03",
  title: "Supplier asks for less than the evidence supports",
  why: "Under-asking is real. Flagging it as an overcharge would destroy trust.",
  input: {
    baseline: { unitPrice: GBP("200.00"), annualVolume: 8_000 },
    requestedChange: pc("3"),
    drivers: [d("material", "Aluminium", "50", "12")],
  },
  expect: { warrantedChange: "6.00%", unsupportedChange: "-3.00%", annualUnsupported: "-48000.00" },
  expectGaps: ["50% of unit cost is unexplained"],
  boundaries: { minAccept: "3%", maxAccept: "3%" },
  mustNotClaim: ["that the supplier is overcharging", "that the buyer should pay the higher warranted figure"],
},

/* ------------------------------------------------------------ contract --- */
{
  id: "PB-04",
  title: "Contract cap binds below the evidence",
  why: "The contract beats the arithmetic, and the buyer must be told what the cap suppressed.",
  input: {
    baseline: { unitPrice: GBP("100.00"), annualVolume: 50_000 },
    requestedChange: pc("9"),
    drivers: [d("material", "Steel bar", "42", "10"), d("labour", "Labour", "18", "5"), d("energy", "Energy", "8", "12")],
    constraints: { cap: pc("5") },
  },
  expect: { warrantedChange: "5.00%", warrantedBefore: "6.06%", constraintApplied: "cap", unsupportedChange: "4.00%" },
  expectGaps: ["contract cap suppressed 1.06% of otherwise-supported movement"],
  boundaries: { minAccept: "0%", maxAccept: "5%" },
  mustNotClaim: ["a warranted figure above the contractual cap"],
},

{
  id: "PB-05",
  title: "Collar suppresses a small movement entirely",
  why: "A dead-band means no change at all, not a small one.",
  input: {
    baseline: { unitPrice: GBP("15.00"), annualVolume: 200_000 },
    requestedChange: pc("0.4"),
    drivers: [d("material", "Copper wire", "20", "2")],
    constraints: { collar: pc("1") },
  },
  expect: { warrantedChange: "0.00%", constraintApplied: "collar", unsupportedChange: "0.40%" },
  expectGaps: ["movement fell inside the contractual collar"],
  boundaries: { minAccept: "0%", maxAccept: "0%" },
  mustNotClaim: ["that a 0.4% increase is contractually due"],
},

{
  id: "PB-06",
  title: "Floor binds on a falling market",
  why: "Symmetry. Indexation that only moves up is not indexation.",
  input: {
    baseline: { unitPrice: GBP("80.00"), annualVolume: 30_000 },
    requestedChange: pc("0"),
    drivers: [d("material", "Steel bar", "42", "-10")],
    constraints: { floor: pc("-2") },
  },
  expect: { warrantedChange: "-2.00%", warrantedBefore: "-4.20%", constraintApplied: "floor" },
  expectGaps: ["58% of unit cost is unexplained"],
  boundaries: { minAccept: "-2%", maxAccept: "-2%" },
  mustNotClaim: ["that no reduction is due"],
},

{
  id: "PB-07",
  title: "Floor above cap is incoherent",
  why: "Contradictory terms must raise, not silently resolve to one of them.",
  input: {
    baseline: { unitPrice: GBP("100.00"), annualVolume: 1_000 },
    requestedChange: pc("3"),
    drivers: [d("material", "Steel", "50", "6")],
    constraints: { cap: pc("2"), floor: pc("5") },
  },
  expectThrows: /floor cannot exceed/,
},

/* -------------------------------------------------------- data quality --- */
{
  id: "PB-08",
  title: "Freight double counted",
  why: "Freight inside both the material line and a separate logistics line is the most common inflation trick.",
  input: {
    baseline: { unitPrice: GBP("62.50"), annualVolume: 40_000 },
    requestedChange: pc("11"),
    drivers: [d("material", "Material incl. inbound freight", "70", "10"), d("freight", "Inbound freight", "40", "20")],
  },
  expectThrows: /exceeds 100%/,
  expectGaps: ["driver weights total more than unit cost"],
  mustNotClaim: ["a warranted figure derived from overlapping weights"],
},

{
  id: "PB-09",
  title: "Duplicate driver id",
  why: "The same driver claimed twice under one label.",
  input: {
    baseline: { unitPrice: GBP("10.00"), annualVolume: 1_000 },
    requestedChange: pc("5"),
    drivers: [d("material", "Steel", "20", "5"), d("material", "Steel again", "20", "5")],
  },
  expectThrows: /Duplicate driver id/,
},

{
  id: "PB-10",
  title: "Fractional volume",
  why: "You cannot buy 1000.5 units. Silent truncation would misstate exposure.",
  input: {
    baseline: { unitPrice: GBP("10.00"), annualVolume: 1000.5 },
    requestedChange: pc("5"),
    drivers: [d("material", "Steel", "20", "5")],
  },
  expectThrows: /integer number of units/,
},

{
  id: "PB-11",
  title: "A float where an exact ratio belongs",
  why: "0.09 as a JS number is not exactly 9%. The type boundary must refuse it.",
  input: {
    baseline: { unitPrice: GBP("10.00"), annualVolume: 1_000 },
    requestedChange: 0.09,
    drivers: [d("material", "Steel", "20", "5")],
  },
  expectThrows: /must be a Ratio/,
},

{
  id: "PB-12",
  title: "No drivers at all",
  why: "A claim with no stated basis is not a claim with a warranted figure of zero — it is unevaluable.",
  input: {
    baseline: { unitPrice: GBP("10.00"), annualVolume: 1_000 },
    requestedChange: pc("7"),
    drivers: [],
  },
  expectThrows: /At least one cost driver/,
},

/* ------------------------------------------------------------- exposure -- */
{
  id: "PB-13",
  title: "Retrospective application",
  why: "Volume already delivered under the old price is the part buyers most often miss.",
  input: {
    baseline: { unitPrice: GBP("100.00"), annualVolume: 50_000 },
    requestedChange: pc("9"),
    drivers: [d("material", "Steel bar", "42", "10"), d("labour", "Labour", "18", "5"), d("energy", "Energy", "8", "12")],
    period: { retrospectiveMonths: 4 },
  },
  expect: { warrantedChange: "6.06%", retrospectiveUnits: "16667", retrospectiveUnsupported: "49000.98" },
  expectGaps: ["retrospective period applies to volume already delivered"],
  boundaries: { minAccept: "0%", maxAccept: "6.06%" },
  mustNotClaim: ["that retrospective application is automatically contractual"],
},

{
  id: "PB-14",
  title: "Large volume, small unit delta",
  why: "Pennies times millions. Floating point would drift here; exact arithmetic must not.",
  input: {
    baseline: { unitPrice: GBP("0.84"), annualVolume: 4_200_000 },
    requestedChange: pc("7.5"),
    drivers: [d("material", "Polymer", "55", "9")],
  },
  expect: { warrantedChange: "4.95%", annualRequested: "264600.00", annualWarranted: "174636.00", annualUnsupported: "89964.00" },
  expectGaps: ["45% of unit cost is unexplained"],
  boundaries: { minAccept: "0%", maxAccept: "4.95%" },
  mustNotClaim: ["a rounded exposure that differs from the exact figure"],
},

{
  id: "PB-15",
  title: "Zero volume",
  why: "A dormant part number. Exposure is zero; the engine must not divide by it.",
  input: {
    baseline: { unitPrice: GBP("100.00"), annualVolume: 0 },
    requestedChange: pc("9"),
    drivers: [d("material", "Steel", "42", "10")],
  },
  expect: { warrantedChange: "4.20%", annualUnsupported: "0.00" },
  expectGaps: ["no volume means no exposure, but the rate still matters for future orders"],
  boundaries: { minAccept: "0%", maxAccept: "4.2%" },
  mustNotClaim: ["a non-zero annual exposure"],
},

{
  id: "PB-16",
  title: "Deflation the supplier did not pass on",
  why: "Holding price flat when input costs fell is itself a claim, and it is worth money.",
  input: {
    baseline: { unitPrice: GBP("250.00"), annualVolume: 6_000 },
    requestedChange: pc("0"),
    drivers: [d("material", "Nickel", "48", "-9")],
  },
  expect: { warrantedChange: "-4.32%", unsupportedChange: "4.32%", annualUnsupported: "64800.00" },
  expectGaps: ["52% of unit cost is unexplained"],
  boundaries: { minAccept: "-4.32%", maxAccept: "0%" },
  mustNotClaim: ["that no action is available because no increase was requested"],
},

/* ----------------------------------------- needs layers not yet built ---- */
{
  id: "PB-17",
  title: "Base-period shopping",
  why: "Same index, same end date, a base chosen to flatter. The cheapest way to inflate a claim, and invisible unless you recompute from the contract.",
  input: {
    baseline: { unitPrice: GBP("120.00"), annualVolume: 25_000 },
    requestedChange: pc("9.79"),
    drivers: [{
      id: "material", label: "Steel bar", weight: pc("50"), provenance: "externally-sourced",
      index: {
        series: STEEL_A,
        contractualBasePeriod: "2025-01",
        claimedBasePeriod: "2025-06",
        measurePeriod: "2026-06",
      },
    }],
  },
  expect: { warrantedChange: "5.00%", unsupportedChange: "4.79%" },
  expectAssumptions: ["base-period-material"],
  expectGaps: ["the claim measures from a different base than the contract"],
  boundaries: { minAccept: "0%", maxAccept: "5%" },
  mustNotClaim: ["that 19.57% movement is contractually applicable", "that the supplier's base period is the contractual one"],
},

{
  id: "PB-18",
  title: "Index lag ignored",
  why: "Movement takes months to reach a delivered price. Claiming it immediately charges for cost the supplier has not yet incurred.",
  input: {
    baseline: { unitPrice: GBP("64.00"), annualVolume: 90_000 },
    requestedChange: pc("5"),
    drivers: [{
      id: "material", label: "Steel bar", weight: pc("50"), provenance: "externally-sourced",
      index: {
        series: STEEL_A,
        contractualBasePeriod: "2025-01",
        measurePeriod: "2026-06",
        lagMonths: 3,
      },
    }],
  },
  expect: { warrantedChange: "2.00%", unsupportedChange: "3.00%" },
  expectAssumptions: ["index-lag-material"],
  expectGaps: ["unlagged movement has not reached the delivered price"],
  boundaries: { minAccept: "0%", maxAccept: "2%" },
  mustNotClaim: ["that the full 10% movement is recoverable now"],
},

{
  id: "PB-19",
  title: "Currency movement conflated with cost movement",
  why: "An FX shift is not an input-cost increase, and mixing them double counts.",
  notYetEvaluable: "Needs dated FX conversion; the engine deliberately refuses mixed currencies rather than converting.",
  boundaries: { minAccept: "0%", maxAccept: "cost movement excluding FX" },
  mustNotClaim: ["a combined figure that counts FX twice"],
},

{
  id: "PB-20",
  title: "Contradictory evidence between letter and contract",
  why: "The letter claims a mechanism the contract does not contain.",
  notYetEvaluable: "Needs contract constraint extraction linked to evidence.",
  boundaries: { minAccept: "0%", maxAccept: "contractual mechanism only" },
  mustNotClaim: ["that the letter's mechanism applies without checking the contract"],
},
];

export const EVALUABLE = CASES.filter((c) => !c.notYetEvaluable);
export const PENDING = CASES.filter((c) => c.notYetEvaluable);
