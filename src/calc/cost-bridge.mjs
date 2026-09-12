/**
 * The cost bridge.
 *
 * A supplier asks for a price increase. This decomposes the request into cost
 * drivers, applies the movement of each driver's index over the correct period,
 * and produces the change the evidence actually warrants — plus the part that
 * it does not.
 *
 * That second number is the point of the whole thing. The gap between what was
 * requested and what the evidence supports is what a buyer negotiates against.
 *
 * NOTHING HERE MAY BE DELEGATED TO A LANGUAGE MODEL. Same inputs, same answer,
 * every time, or the output cannot be put in front of an approver.
 */

import {
  ONE, ratioMul, scaleDiv, SCALE,
  money, moneyApplyChange, moneySub, moneyTimesQuantity, assertSameCurrency,
} from "./exact.mjs";

/** Where a value came from. Anything ai-inferred must be confirmed first. */
export const PROVENANCE = Object.freeze({
  USER: "user-entered",
  DOCUMENT: "document-extracted",
  EXTERNAL: "externally-sourced",
  CALCULATED: "system-calculated",
  AI: "ai-inferred",
  UNKNOWN: "unknown",
});

/** A value an AI produced may not enter arithmetic until a human confirms it. */
export function assertUsable(field, name) {
  if (!field || typeof field !== "object") return;
  if (field.provenance === PROVENANCE.AI && !field.confirmedBy) {
    throw new Error(
      `Refusing to calculate with unconfirmed AI-inferred value for "${name}". ` +
      `Confirm the extracted field first.`
    );
  }
}

/**
 * @typedef {Object} Driver
 * @property {string} id
 * @property {string} label
 * @property {bigint} weight         share of unit cost, as a Ratio (0.42 = 42%)
 * @property {bigint} indexMovement  movement over the claim period, as a Ratio
 * @property {string} [provenance]
 * @property {object} [confirmedBy]
 * @property {string} [source]
 */

/**
 * @param {Object} input
 * @param {Object} input.baseline           { unitPrice: Money, annualVolume: int }
 * @param {Driver[]} input.drivers
 * @param {bigint} input.requestedChange    Ratio, e.g. 0.09 for +9%
 * @param {Object} [input.constraints]      { cap?, floor?, collar? } as Ratios
 * @param {Object} [input.period]           { months?, retrospectiveMonths? }
 * @param {number} [input.lifetimeYears]
 */
export function costBridge(input) {
  const { baseline, drivers, requestedChange, constraints = {}, period = {}, lifetimeYears = 3 } = input;

  validate(input);

  const assumptions = [];

  // --- 1. Weighted decomposition -------------------------------------------
  let warranted = 0n;
  const contributions = [];
  let weightTotal = 0n;

  for (const d of drivers) {
    assertUsable(d, `driver "${d.id}" `);
    const contribution = ratioMul(d.weight, d.indexMovement);
    warranted += contribution;
    weightTotal += d.weight;
    contributions.push({
      id: d.id,
      label: d.label,
      weight: d.weight,
      indexMovement: d.indexMovement,
      contribution,
      source: d.source ?? null,
      provenance: d.provenance ?? PROVENANCE.UNKNOWN,
    });
  }

  // Weight that the supplier has not accounted for. Not an error — a gap.
  const unexplainedWeight = ONE - weightTotal;
  if (unexplainedWeight > 0n) {
    assumptions.push({
      id: "unexplained-weight",
      text: `Drivers account for ${pct(weightTotal)} of unit cost. The remaining ` +
            `${pct(unexplainedWeight)} is unexplained and is treated as unchanged.`,
      impact: "reduces warranted change",
    });
  }

  const warrantedBeforeConstraints = warranted;

  // --- 2. Contract constraints ---------------------------------------------
  let constraintApplied = null;
  if (constraints.cap !== undefined && warranted > constraints.cap) {
    warranted = constraints.cap;
    constraintApplied = "cap";
    assumptions.push({
      id: "cap-applied",
      text: `Contract caps indexation at ${pct(constraints.cap)}; the driver ` +
            `evidence would otherwise support ${pct(warrantedBeforeConstraints)}.`,
      impact: "binding",
    });
  }
  if (constraints.floor !== undefined && warranted < constraints.floor) {
    warranted = constraints.floor;
    constraintApplied = "floor";
    assumptions.push({
      id: "floor-applied",
      text: `Contract floors indexation at ${pct(constraints.floor)}.`,
      impact: "binding",
    });
  }
  // A collar is a symmetric dead-band: movement inside it triggers no change.
  if (constraints.collar !== undefined) {
    const c = constraints.collar < 0n ? -constraints.collar : constraints.collar;
    if (warranted > -c && warranted < c) {
      warranted = 0n;
      constraintApplied = "collar";
      assumptions.push({
        id: "collar-applied",
        text: `Movement of ${pct(warrantedBeforeConstraints)} falls inside the ` +
              `contractual collar of +/-${pct(c)}, so no change is triggered.`,
        impact: "binding",
      });
    }
  }

  // --- 3. Prices and the unsupported remainder ------------------------------
  const unit = baseline.unitPrice;
  const warrantedUnitPrice = moneyApplyChange(unit, warranted);
  const requestedUnitPrice = moneyApplyChange(unit, requestedChange);

  const unsupportedChange = requestedChange - warranted;
  const requestedDelta = moneySub(requestedUnitPrice, unit);
  const warrantedDelta = moneySub(warrantedUnitPrice, unit);
  const unsupportedDelta = moneySub(requestedUnitPrice, warrantedUnitPrice);

  // --- 4. Exposure ----------------------------------------------------------
  const vol = BigInt(baseline.annualVolume);
  const annual = {
    requested: moneyTimesQuantity(requestedDelta, vol),
    warranted: moneyTimesQuantity(warrantedDelta, vol),
    unsupported: moneyTimesQuantity(unsupportedDelta, vol),
  };

  const lifetime = {
    requested: moneyTimesQuantity(requestedDelta, vol * BigInt(lifetimeYears)),
    warranted: moneyTimesQuantity(warrantedDelta, vol * BigInt(lifetimeYears)),
    unsupported: moneyTimesQuantity(unsupportedDelta, vol * BigInt(lifetimeYears)),
  };

  // Retrospective application: volume already delivered under the old price.
  let retrospective = null;
  if (period.retrospectiveMonths) {
    const months = BigInt(period.retrospectiveMonths);
    const retroVol = scaleDiv(vol * months * SCALE, 12n * SCALE);
    retrospective = {
      months: period.retrospectiveMonths,
      units: retroVol,
      requested: moneyTimesQuantity(requestedDelta, retroVol),
      warranted: moneyTimesQuantity(warrantedDelta, retroVol),
      unsupported: moneyTimesQuantity(unsupportedDelta, retroVol),
    };
    assumptions.push({
      id: "retrospective",
      text: `${period.retrospectiveMonths} month(s) of retrospective application ` +
            `covers approximately ${retroVol} units already delivered.`,
      impact: "increases exposure",
    });
  }

  return Object.freeze({
    warrantedChange: warranted,
    warrantedBeforeConstraints,
    requestedChange,
    unsupportedChange,
    constraintApplied,
    unexplainedWeight,
    unitPrice: { baseline: unit, warranted: warrantedUnitPrice, requested: requestedUnitPrice },
    delta: { requested: requestedDelta, warranted: warrantedDelta, unsupported: unsupportedDelta },
    annual,
    lifetime,
    retrospective,
    contributions,
    assumptions,
    // Enough to reproduce this result by hand.
    formula: "warranted = Σ(driver.weight × driver.indexMovement), then cap/floor/collar",
  });
}

/**
 * Effect of accepting only part of the request.
 * `acceptedChange` is a Ratio: what you are willing to concede.
 */
export function partialAcceptance(bridge, acceptedChange) {
  const unit = bridge.unitPrice.baseline;
  const accepted = moneyApplyChange(unit, acceptedChange);
  const delta = moneySub(accepted, unit);
  const avoidedPerUnit = moneySub(bridge.unitPrice.requested, accepted);
  const vol = bridge.annual.requested.minor === 0n
    ? 0n
    : bridge.annual.requested.minor / (bridge.delta.requested.minor || 1n);
  return Object.freeze({
    acceptedChange,
    acceptedUnitPrice: accepted,
    annualCost: moneyTimesQuantity(delta, vol),
    annualAvoided: moneyTimesQuantity(avoidedPerUnit, vol),
    versusWarranted: acceptedChange - bridge.warrantedChange,
  });
}

/**
 * Effect of delaying implementation by N months — the increase applies to
 * (12 - N)/12 of the year's volume instead of all of it.
 */
export function delayEffect(bridge, months, annualVolume) {
  if (months < 0 || months > 12) throw new RangeError("Delay must be 0-12 months");
  const vol = BigInt(annualVolume);
  const affected = scaleDiv(vol * BigInt(12 - months), 12n);
  const avoidedUnits = vol - affected;
  return Object.freeze({
    months,
    affectedUnits: affected,
    avoidedUnits,
    firstYearCost: moneyTimesQuantity(bridge.delta.requested, affected),
    firstYearAvoided: moneyTimesQuantity(bridge.delta.requested, avoidedUnits),
  });
}

/* -------------------------------------------------------------- validation */

function validate(input) {
  const { baseline, drivers, requestedChange } = input;

  if (!baseline || !baseline.unitPrice) throw new TypeError("baseline.unitPrice is required");
  if (typeof baseline.annualVolume !== "number" || !Number.isInteger(baseline.annualVolume)) {
    throw new TypeError("baseline.annualVolume must be an integer number of units");
  }
  if (baseline.annualVolume < 0) throw new RangeError("annualVolume cannot be negative");
  if (typeof requestedChange !== "bigint") throw new TypeError("requestedChange must be a Ratio (BigInt)");
  if (!Array.isArray(drivers) || drivers.length === 0) throw new TypeError("At least one cost driver is required");

  const seen = new Set();
  let total = 0n;
  for (const d of drivers) {
    if (!d.id) throw new TypeError("Every driver needs an id");
    if (seen.has(d.id)) throw new RangeError(`Duplicate driver id: ${d.id}`);
    seen.add(d.id);
    if (typeof d.weight !== "bigint") throw new TypeError(`Driver "${d.id}" weight must be a Ratio (BigInt)`);
    if (typeof d.indexMovement !== "bigint") throw new TypeError(`Driver "${d.id}" indexMovement must be a Ratio (BigInt)`);
    if (d.weight < 0n) throw new RangeError(`Driver "${d.id}" weight cannot be negative`);
    total += d.weight;
  }
  if (total > ONE) {
    throw new RangeError(
      `Driver weights total ${pct(total)}, which exceeds 100% of unit cost. ` +
      `Check for double counting — freight inside both material and logistics is the usual cause.`
    );
  }

  const { cap, floor } = input.constraints ?? {};
  if (cap !== undefined && floor !== undefined && floor > cap) {
    throw new RangeError("Contract floor cannot exceed contract cap");
  }
}

function pct(r) {
  const hundredths = scaleDiv(r * 10000n, SCALE);
  const neg = hundredths < 0n;
  const abs = neg ? -hundredths : hundredths;
  return (neg ? "-" : "") + (abs / 100n) + "." + (abs % 100n).toString().padStart(2, "0") + "%";
}

export { pct as formatPercent };
