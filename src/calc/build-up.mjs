/**
 * A supplier's claimed cost structure, against your own build-up.
 *
 * Every argument in this product so far has been conducted in the supplier's
 * numbers. They say material is forty-two per cent of the part and moved
 * eight per cent; the engine checks the eight, the index, the base period and
 * the lag. It has never been able to check the forty-two, because there was
 * nothing to check it against.
 *
 * There is now. A should-cost build-up computes what the part costs from its
 * geometry, its route and rates somebody entered — so the share of that cost
 * which is material is a figure you own. Putting the two side by side lets a
 * buyer ask the one question a supplier finds hardest: not "is your index
 * right", which they can argue about, but "is your cost structure what you
 * say it is", which is a claim about the part they are making from the
 * drawing you sent them.
 *
 * Four rules keep this honest, and the first is the one that matters.
 *
 * 1. This does not prove a supplier wrong. A build-up made from your rates is
 *    what *you* think the part costs. Their yield, their overhead, their
 *    scrap and their buying power are not yours, and a difference is a
 *    question to put to them rather than a finding against them. Nothing here
 *    is phrased as a verdict, and the warranted figure is not recalculated:
 *    this challenges an input, it does not replace an answer.
 *
 * 2. An element your build-up does not model is not a zero. If a supplier
 *    claims energy at twelve per cent and the build-up has no energy line,
 *    that is a limitation of the build-up, not evidence against the claim.
 *    Unmapped drivers and unmapped elements are both reported as gaps, and
 *    the comparison says it is partial.
 *
 * 3. The mapping is somebody's, not something to infer. Which cost element
 *    answers which driver is a judgement about what the supplier meant, and a
 *    product that guesses it is guessing the argument.
 *
 * 4. It reports both directions. A build-up showing material *lower* than
 *    claimed is the interesting case; one showing it higher is reported just
 *    as plainly, because a comparison that only fires when it helps you is
 *    not a comparison.
 */

import { SCALE, ratioMul, ratioToPercentString, scaleDiv } from "./exact.mjs";

/** How far apart two shares have to be before it is worth raising. */
export const MATERIAL_GAP = 50_000_000n; // 5 percentage points

/* --------------------------------------------------------------- the shares */

/**
 * What each cost element is, as a share of the recurring cost.
 *
 * Refused outright while the estimate has gaps, on exactly the reasoning
 * `costPlan` already uses to withhold its own material share: a proportion of
 * a partial sum is a real number about the wrong total, and it moves the
 * moment a gap is filled. A comparison built on one would be an argument
 * built on one.
 */
export function buildUpShares(cost) {
  if (!cost || !cost.ok) {
    return Object.freeze({ ok: false, why: "There is no cost estimate to take shares from." });
  }
  if (!cost.complete) {
    return Object.freeze({
      ok: false,
      why: `This estimate has ${cost.missing.length} element(s) with no figure ` +
           `(${cost.missing.map((m) => m.label).join(", ")}). A share of a partial subtotal is a ` +
           `number about the wrong total, and it changes the moment a gap is filled — so there is ` +
           `nothing here to compare a supplier's structure against yet.`,
    });
  }

  /* Recurring only. A one-time tooling charge is not part of the structure of
     a unit price, and `costPlan` has already decided whether it was amortised
     into one. */
  const recurring = cost.lines.filter((l) => !l.oneTime && l.amount !== null);
  const total = recurring.reduce((n, l) => n + l.signed, 0n);
  if (total <= 0n) {
    return Object.freeze({ ok: false, why: "The recurring cost is zero or negative, so it has no shares." });
  }

  const shares = recurring.map((l) => Object.freeze({
    id: l.id,
    label: l.label,
    amount: l.amount,
    credit: l.credit,
    share: scaleDiv(l.signed * SCALE, total),
    /* The estimate is only as strong as this line, and a weak line makes a
       weak share. It travels so it can be said out loud. */
    quality: l.quality,
    basis: l.basis,
  }));

  return Object.freeze({
    ok: true,
    total,
    currency: cost.currency,
    confidence: cost.confidence,
    shares: Object.freeze(shares),
    byId: Object.freeze(Object.fromEntries(shares.map((s) => [s.id, s]))),
  });
}

/* ------------------------------------------------------------ the comparison */

/**
 * Put a claim's weights beside the build-up's shares.
 *
 * @param {object} input
 * @param {object} input.bridge  a costBridge result — its contributions carry
 *                               the claimed weight and movement per driver
 * @param {object} input.cost    a costPlan result for the same part
 * @param {object} input.map     { [driverId]: costElementId } — somebody's
 *                               judgement about which line answers which driver
 */
export function compareToBuildUp({ bridge, cost, map = {} } = {}) {
  if (!bridge || !Array.isArray(bridge.contributions)) {
    return Object.freeze({ ok: false, why: "There is no claim decomposition to compare." });
  }
  const built = buildUpShares(cost);
  if (!built.ok) return Object.freeze({ ok: false, why: built.why });

  const usedElements = new Set();
  const rows = [];
  const unmappedDrivers = [];

  for (const c of bridge.contributions) {
    const elementId = map[c.id];
    if (!elementId) {
      unmappedDrivers.push(Object.freeze({
        id: c.id, label: c.label, claimedWeight: c.weight,
        why: "No cost element was mapped to this driver, so the build-up says nothing about it.",
      }));
      continue;
    }
    const element = built.byId[elementId];
    if (!element) {
      unmappedDrivers.push(Object.freeze({
        id: c.id, label: c.label, claimedWeight: c.weight,
        why: `This driver is mapped to "${elementId}", which this estimate does not cost. ` +
             `That is a gap in the build-up, not evidence about the claim.`,
      }));
      continue;
    }
    usedElements.add(elementId);

    const difference = c.weight - element.share;
    const material = difference > MATERIAL_GAP || difference < -MATERIAL_GAP;

    /* What the gap is worth, in the currency of the claim: percentage points
       of the increase being asked for. Exactly the arithmetic the bridge
       already does per driver — weight times movement — run on the
       difference in weight rather than on the weight itself. */
    const atClaimedMovement = ratioMul(difference, c.indexMovement ?? 0n);

    rows.push(Object.freeze({
      driverId: c.id,
      driver: c.label,
      element: element.label,
      claimedWeight: c.weight,
      buildUpShare: element.share,
      difference,
      /* Named for what it is: the supplier's figure is higher, or lower. */
      direction: difference > 0n ? "claimed higher" : difference < 0n ? "claimed lower" : "the same",
      material,
      claimedMovement: c.indexMovement ?? null,
      atClaimedMovement,
      /* How much weight the build-up line itself can take. */
      buildUpQuality: element.quality,
      buildUpBasis: element.basis,
      statement:
        `${c.label}: the claim puts it at ${ratioToPercentString(c.weight, 1)} of unit cost; this ` +
        `build-up puts ${element.label} at ${ratioToPercentString(element.share, 1)}` +
        (material
          ? `, a difference of ${ratioToPercentString(difference > 0n ? difference : -difference, 1)}.`
          : `, which is close enough not to be worth raising.`),
    }));
  }

  const unusedElements = built.shares
    .filter((s) => !usedElements.has(s.id))
    .map((s) => Object.freeze({
      id: s.id, label: s.label, share: s.share,
      why: "This is part of the build-up and no driver was mapped to it. The claim may simply not " +
           "rest on it.",
    }));

  const raisable = rows.filter((r) => r.material);
  /* Only where the claim puts the weight above the build-up does the gap
     inflate what is being asked for. The other direction is reported and is
     not added up, because it is not money the buyer is being asked for. */
  const overstatedPoints = raisable
    .filter((r) => r.difference > 0n)
    .reduce((n, r) => n + r.atClaimedMovement, 0n);

  const partial = unmappedDrivers.length > 0 || unusedElements.length > 0;

  return Object.freeze({
    ok: true,
    rows: Object.freeze(rows),
    raisable: Object.freeze(raisable),
    unmappedDrivers: Object.freeze(unmappedDrivers),
    unusedElements: Object.freeze(unusedElements),
    partial,
    buildUpConfidence: built.confidence,
    overstatedPoints,
    statement: rows.length === 0
      ? "No driver in this claim was mapped to a line in the build-up, so there is nothing to compare."
      : raisable.length === 0
        ? `All ${rows.length} mapped driver(s) sit within ${ratioToPercentString(MATERIAL_GAP, 0)} of ` +
          `this build-up. The claimed cost structure is consistent with it.`
        : `${raisable.length} of ${rows.length} mapped driver(s) differ from this build-up by more than ` +
          `${ratioToPercentString(MATERIAL_GAP, 0)}` +
          (overstatedPoints > 0n
            ? `. Where the claim puts the weight higher, that accounts for ` +
              `${ratioToPercentString(overstatedPoints, 2)} of the increase being asked for.`
            : `, all of them below the build-up.`),
    method:
      "A build-up made from your own rates is what you think the part costs, not what it costs them: " +
      "their yield, overhead, scrap and buying power are not yours. A difference here is a question " +
      "to put to a supplier, never a finding against one, and nothing above recalculates the " +
      "warranted change — this challenges an input to it. Shares are taken from the recurring cost " +
      "only, and only where the estimate is complete, because a share of a partial subtotal is a " +
      "number about the wrong total. Both directions are reported: a comparison that only fires when " +
      "it helps you is not a comparison.",
    caveat: partial
      ? `This comparison is partial. ${unmappedDrivers.length} claimed driver(s) have no line in the ` +
        `build-up and ${unusedElements.length} build-up line(s) have no driver. An element the ` +
        `build-up does not model is a limit of the build-up, not evidence about the claim.`
      : null,
  });
}

/**
 * What to ask, derived from what differs.
 *
 * Phrased as questions rather than assertions, because that is what the
 * position actually is: a buyer with an independent build-up has a question a
 * supplier has to answer, not a proof they have to accept.
 */
export function questionsFrom(comparison) {
  if (!comparison || !comparison.ok) return Object.freeze([]);
  const out = [];

  for (const r of comparison.raisable) {
    const gap = r.difference > 0n ? r.difference : -r.difference;
    out.push(Object.freeze({
      driverId: r.driverId,
      worthPoints: r.difference > 0n ? r.atClaimedMovement : 0n,
      question: r.difference > 0n
        ? `You put ${r.driver} at ${ratioToPercentString(r.claimedWeight, 1)} of unit cost. Building ` +
          `this part up from the drawing puts ${r.element} at ${ratioToPercentString(r.buildUpShare, 1)}. ` +
          `What accounts for the ${ratioToPercentString(gap, 1)} difference?`
        : `You put ${r.driver} at ${ratioToPercentString(r.claimedWeight, 1)}, which is ` +
          `${ratioToPercentString(gap, 1)} below our own build-up. Is the balance recovered elsewhere ` +
          `in the price, or is our build-up wrong?`,
    }));
  }

  for (const d of comparison.unmappedDrivers) {
    out.push(Object.freeze({
      driverId: d.id,
      worthPoints: 0n,
      question: `Our build-up for this part has no line for ${d.label}. What does it cover, and how ` +
                `is it costed?`,
    }));
  }

  /* Sorted by what the answer is worth, which is not the same as by size of
     gap: a large gap on a driver that has not moved is worth nothing. */
  return Object.freeze([...out].sort((a, b) => (b.worthPoints > a.worthPoints ? 1 : b.worthPoints < a.worthPoints ? -1 : 0)));
}
