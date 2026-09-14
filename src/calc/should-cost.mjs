/**
 * Should-cost: what to order, how much, and why.
 *
 * The question this answers is not "what does the finished part weigh". It is
 * "what stock do I buy". Between those two numbers sit a blank bigger than the
 * part, a saw that turns material into dust, a sheet that does not divide
 * evenly, scrap at every stage, pieces consumed setting the machine up, pieces
 * destroyed proving the material, and a supplier who sells sheets rather than
 * square millimetres. Each of those is a separate number here, and each is
 * shown separately, because a buyer challenged on a quantity has to be able to
 * say which of them the extra material is.
 *
 * Four rules the arithmetic enforces rather than documents.
 *
 * 1. Losses are defined, not named. "5% scrap" means nothing on its own: five
 *    percent of the input rejected is a different quantity from five percent
 *    added to demand, and the difference compounds through a route. Every
 *    stage here states a yield — accepted output over input — and the chain is
 *    computed backwards from the parts actually wanted.
 *
 * 2. Nothing is counted twice. A layout that already accounts for kerf and
 *    edge margin has priced the cutting waste; a general cutting-scrap uplift
 *    on top of it is the same material charged twice. That combination raises
 *    rather than quietly inflating the order.
 *
 * 3. Contingency is a separate line with its own label. Material planning
 *    inflated "to be safe" is indistinguishable from material planning that is
 *    wrong, and neither can be defended to a supplier.
 *
 * 4. A missing rate is missing. It never becomes zero, and it never becomes a
 *    market price from somewhere. A cost with a hole in it reports a partial
 *    subtotal and says what is missing; it does not report a total.
 *
 * The layout is a simple grid — rows and columns of identical rectangles, with
 * kerf between them and a margin at the edge. It is called that everywhere it
 * appears. It is not a nesting solution and must not be read as one; an
 * irregular shape needs a validated nester or a utilisation figure a competent
 * person has signed for.
 */

import {
  SCALE, money, moneyToDecimalString, scaleDiv,
} from "./exact.mjs";
import { massOf } from "./units.mjs";

/* -------------------------------------------------------------- provenance */

/** How much weight a cost element carries. Ordered weakest to strongest. */
export const BASIS = Object.freeze({
  ASSUMED: "assumed",       // nobody has checked this
  REVIEWED: "user-reviewed", // a competent person entered it
  QUOTED: "quote-backed",    // it came from a supplier's own figure
});

const BASIS_RANK = Object.freeze({ [BASIS.ASSUMED]: 0, [BASIS.REVIEWED]: 1, [BASIS.QUOTED]: 2 });

/** What an estimate as a whole may be called, which is the weakest part of it. */
export const CONFIDENCE = Object.freeze({
  INCOMPLETE: "incomplete",   // something necessary has no figure at all
  BUDGETARY: "budgetary",     // complete, but resting on assumptions
  REVIEWED: "user-reviewed",
  QUOTED: "quote-backed",
});

/* ------------------------------------------------------------ route stages */

/**
 * Where a stage's test and setup pieces come from.
 *
 * INPUT  — consumed before the yield applies. Setting a press up destroys raw
 *          blanks whether or not the process is any good.
 * OUTPUT — consumed from accepted parts. A destructive test on a finished part
 *          takes a good one, so the demand rises before the yield divides.
 *
 * Getting this backwards is the classic double count, which is why it is a
 * required field rather than a default.
 */
export const CONSUMES = Object.freeze({ INPUT: "input", OUTPUT: "output" });

/**
 * One operation in the route.
 *
 * @param {object}  input
 * @param {string}  input.id
 * @param {string}  input.name
 * @param {bigint}  input.yield          Ratio (1e9 = 100%). Accepted out / in.
 * @param {number} [input.fixedPieces]   setup, first-article and test pieces
 * @param {string} [input.consumes]      CONSUMES.INPUT (default) or OUTPUT
 * @param {string} [input.basis]         BASIS.*
 */
export function stage(input = {}) {
  const id = String(input.id ?? "").trim();
  const name = String(input.name ?? "").trim();
  if (!id || !name) throw new TypeError("A stage needs an id and a name");

  const y = input.yield;
  if (typeof y !== "bigint") {
    throw new TypeError(`${name}: yield must be a Ratio — build it with ratioFromPercent`);
  }
  if (y <= 0n) {
    throw new RangeError(
      `${name}: a yield of zero or less cannot produce anything, so no input quantity satisfies it. ` +
      `If the stage is not yet characterised, leave it out and say so.`);
  }
  if (y > SCALE) {
    throw new RangeError(`${name}: a yield above 100% would create material. Did you mean a scrap rate?`);
  }

  const fixed = input.fixedPieces ?? 0;
  if (!Number.isInteger(fixed) || fixed < 0) {
    throw new RangeError(`${name}: fixed pieces must be a whole number of pieces, not ${fixed}`);
  }

  const consumes = input.consumes ?? CONSUMES.INPUT;
  if (consumes !== CONSUMES.INPUT && consumes !== CONSUMES.OUTPUT) {
    throw new RangeError(
      `${name}: say whether its ${fixed} setup/test pieces come out of the input or out of accepted ` +
      `output. Assuming one is how the same pieces get counted twice.`);
  }

  return Object.freeze({
    id, name, yield: y, fixedPieces: fixed, consumes,
    basis: input.basis ?? BASIS.ASSUMED,
  });
}

/** Ceiling division on BigInts. Pieces are discrete; you cannot start 0.4 of one. */
function ceilDiv(n, d) {
  if (d <= 0n) throw new RangeError("Division by a non-positive quantity");
  return n <= 0n ? 0n : (n + d - 1n) / d;
}

/**
 * Work backwards through the route from the parts actually wanted.
 *
 * For each stage, from last to first:
 *
 *     demand      = good_output (+ fixed pieces, if they come out of output)
 *     required_in = ceil(demand / yield) + fixed pieces, if they come out of input
 *
 * Rounding happens at every stage, not once at the end, because every stage
 * hands over whole pieces.
 *
 * @param {number} goodParts  accepted parts required out of the last stage
 * @param {Array}  stages     in route order, first operation first
 */
export function routeInput(goodParts, stages) {
  if (!Number.isInteger(goodParts) || goodParts <= 0) {
    throw new RangeError(`Required parts must be a positive whole number, not ${goodParts}`);
  }
  const list = Array.isArray(stages) ? [...stages] : [];

  const steps = [];
  let carried = BigInt(goodParts);

  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    const out = carried;
    const demand = s.consumes === CONSUMES.OUTPUT ? out + BigInt(s.fixedPieces) : out;
    const throughYield = ceilDiv(demand * SCALE, s.yield);
    const required = s.consumes === CONSUMES.INPUT ? throughYield + BigInt(s.fixedPieces) : throughYield;

    steps.unshift(Object.freeze({
      stage: s,
      goodOutput: out,
      /* What the stage must receive, and where each extra piece went. */
      requiredInput: required,
      lostToYield: throughYield - demand,
      lostToFixed: BigInt(s.fixedPieces),
      consumes: s.consumes,
    }));
    carried = required;
  }

  return Object.freeze({
    goodParts: BigInt(goodParts),
    /* The number of blanks to release into production. */
    blanksRequired: carried,
    steps: Object.freeze(steps),
    /* Every piece above the parts wanted, and nothing else. */
    processLoss: carried - BigInt(goodParts),
    method:
      "Computed backwards through the route. At each stage required input is the demand divided by " +
      "that stage's yield, rounded up to whole pieces, plus any setup or test pieces the stage takes " +
      "out of its input. Pieces taken out of accepted output are added to demand before the division " +
      "instead, so the same pieces are never counted twice.",
  });
}

/* ---------------------------------------------------------------- layouts */

/**
 * A simple grid of identical rectangles on a rectangular sheet.
 *
 * Not a nesting solution. Rows and columns only, kerf between neighbours, a
 * margin all the way round. Both orientations are computed; the better one is
 * chosen only if rotation is permitted, because grain direction is a real
 * constraint and silently rotating a part is a scrap report waiting to happen.
 *
 * @param {object}  sheet          {width, length} lengths
 * @param {object}  blank          {width, length} lengths
 * @param {object}  opts
 * @param {object}  opts.kerf        length — the width the cut itself removes
 * @param {object}  opts.edgeMargin  length — unusable stock at each edge
 * @param {boolean} opts.rotationAllowed
 */
export function sheetLayout(sheet, blank, { kerf, edgeMargin, rotationAllowed = false } = {}) {
  for (const [what, v] of [["sheet width", sheet.width], ["sheet length", sheet.length],
                           ["blank width", blank.width], ["blank length", blank.length],
                           ["kerf", kerf], ["edge margin", edgeMargin]]) {
    if (!v || typeof v.um !== "bigint") throw new TypeError(`${what} must be a length — build it with length()`);
  }

  const usableW = sheet.width.um - 2n * edgeMargin.um;
  const usableL = sheet.length.um - 2n * edgeMargin.um;

  const across = (span, size) => {
    if (size <= 0n) throw new RangeError("A blank dimension must be positive");
    if (span < size) return 0n;
    /* n pieces occupy n*size + (n-1)*kerf, so n = floor((span + kerf) / (size + kerf)). */
    return (span + kerf.um) / (size + kerf.um);
  };

  const orient = (w, l, name) => {
    const cols = across(usableW, w);
    const rows = across(usableL, l);
    return { name, cols, rows, count: cols * rows, blankWidth: w, blankLength: l };
  };

  const asDrawn = orient(blank.width.um, blank.length.um, "as drawn");
  const rotated = orient(blank.length.um, blank.width.um, "rotated 90°");

  const chosen = rotationAllowed && rotated.count > asDrawn.count ? rotated : asDrawn;

  const blankArea = blank.width.um * blank.length.um;
  const sheetArea = sheet.width.um * sheet.length.um;
  const usedArea = blankArea * chosen.count;

  if (chosen.count === 0n) {
    return Object.freeze({
      ok: false,
      perSheet: 0n,
      reason: usableW <= 0n || usableL <= 0n
        ? "The edge margin leaves no usable area on this stock."
        : "The blank does not fit on this stock in the permitted orientation." +
          (rotationAllowed ? "" : " Rotation is not permitted, so it was not tried."),
      rotationWouldHelp: !rotationAllowed && rotated.count > 0n,
      kind: "simple grid",
    });
  }

  return Object.freeze({
    ok: true,
    kind: "simple grid",
    orientation: chosen.name,
    rotationAllowed,
    /* Stated so the alternative is visible rather than implied. */
    rotationWouldHelp: !rotationAllowed && rotated.count > asDrawn.count,
    columns: chosen.cols,
    rows: chosen.rows,
    perSheet: chosen.count,

    /* The inputs travel with the result. A saved estimate has to be
       reproducible without the form that produced it, and a diagram drawn
       from anything other than these numbers can disagree with the count
       beside it. `blankWidthUm` is the chosen orientation, not the entered
       one, so a drawing of it is of the part as it will actually be cut. */
    sheetWidthUm: sheet.width.um,
    sheetLengthUm: sheet.length.um,
    blankWidthUm: chosen.blankWidth,
    blankLengthUm: chosen.blankLength,
    kerfUm: kerf.um,
    edgeMarginUm: edgeMargin.um,

    sheetAreaUm2: sheetArea,
    usedAreaUm2: usedArea,
    unusedAreaUm2: sheetArea - usedArea,
    /* Utilisation as a Ratio, so it prints through the same formatter as everything else. */
    utilisation: scaleDiv(usedArea * SCALE, sheetArea),
    note:
      "A simple grid of identical rectangles: rows and columns, kerf between neighbours, a margin at " +
      "every edge. It is not an optimal nest, and an irregular shape needs a validated nesting method " +
      "or a utilisation figure a competent person has confirmed.",
  });
}

/**
 * Blanks cut from a bar, with trim off each end.
 *
 * @param {object} bar          {length} length
 * @param {object} blankLength  length
 * @param {object} opts         {kerf, endTrim} lengths
 */
export function barLayout(bar, blankLength, { kerf, endTrim } = {}) {
  for (const [what, v] of [["bar length", bar.length], ["blank length", blankLength],
                           ["kerf", kerf], ["end trim", endTrim]]) {
    if (!v || typeof v.um !== "bigint") throw new TypeError(`${what} must be a length`);
  }
  const usable = bar.length.um - 2n * endTrim.um;
  if (usable <= 0n || usable < blankLength.um) {
    return Object.freeze({
      ok: false, perBar: 0n, kind: "bar cutting",
      reason: usable <= 0n
        ? "The end trim consumes the whole bar."
        : "The bar is shorter than one blank once the end trim is taken off.",
    });
  }
  /* The last cut in a bar is a cut too: n blanks need n kerfs, not n-1,
     because the final piece is parted off from the remaining stub. */
  const perBar = usable / (blankLength.um + kerf.um);
  const used = perBar * blankLength.um;
  return Object.freeze({
    ok: true, kind: "bar cutting",
    perBar,
    /* As above: the inputs travel with the result. */
    barLengthUm: bar.length.um,
    blankLengthUm: blankLength.um,
    kerfUm: kerf.um,
    endTrimUm: endTrim.um,
    usableLengthUm: usable,
    usedLengthUm: used,
    kerfLengthUm: perBar * kerf.um,
    trimLengthUm: 2n * endTrim.um,
    remainderUm: usable - perBar * (blankLength.um + kerf.um),
    utilisation: scaleDiv(used * SCALE, bar.length.um),
    note: "End trim is taken off both ends, and every blank is parted off with a cut, so n blanks " +
          "consume n kerfs rather than n-1.",
  });
}

/* ----------------------------------------------------------- material plan */

/**
 * From parts wanted to stock to buy.
 *
 * @param {object} input
 * @param {number} input.goodParts
 * @param {Array}  input.stages
 * @param {object} input.layout        a sheetLayout or barLayout result
 * @param {object} input.density
 * @param {bigint} input.stockVolumeUm3   one purchase unit (one sheet, one bar)
 * @param {bigint} [input.blankVolumeUm3] one blank
 * @param {bigint} [input.partVolumeUm3]  the finished part, where geometry supports it
 * @param {number} [input.packIncrement]  the supplier sells in multiples of this
 * @param {number} [input.minimumOrder]   stock units
 * @param {bigint} [input.contingency]    Ratio, applied to blanks and labelled
 * @param {boolean}[input.generalScrapUplift] see the double-count guard below
 */
export function planMaterial(input = {}) {
  const route = routeInput(input.goodParts, input.stages ?? []);
  const layout = input.layout;
  if (!layout || !layout.ok) {
    return Object.freeze({
      ok: false,
      route,
      reason: layout ? layout.reason : "No stock layout was calculated, so no purchase quantity follows.",
    });
  }

  /* Rule 2, enforced. The layout has already priced the cutting waste. */
  if (input.generalScrapUplift) {
    throw new RangeError(
      "A general cutting-scrap uplift was applied on top of a layout that already accounts for kerf " +
      "and edge margin. That is the same material counted twice. Adjust the kerf or the margin, or " +
      "add a contingency, which is labelled as one.");
  }

  const perStock = layout.perSheet ?? layout.perBar;

  /* Contingency is a separate quantity with its own name, never folded in. */
  const contingency = input.contingency ?? 0n;
  if (contingency < 0n) throw new RangeError("Contingency cannot be negative");
  const contingencyBlanks = contingency === 0n
    ? 0n
    : ceilDiv(route.blanksRequired * contingency, SCALE);

  const blanksToRelease = route.blanksRequired + contingencyBlanks;
  const stockNeeded = ceilDiv(blanksToRelease, perStock);

  /* Then what the supplier will actually sell. */
  const increment = input.packIncrement ?? 1;
  const minimum = input.minimumOrder ?? 0;
  if (!Number.isInteger(increment) || increment < 1) throw new RangeError("Pack increment must be a positive whole number");
  if (!Number.isInteger(minimum) || minimum < 0) throw new RangeError("Minimum order cannot be negative");

  const toIncrement = ceilDiv(stockNeeded, BigInt(increment)) * BigInt(increment);
  const stockToBuy = toIncrement > BigInt(minimum) ? toIncrement : BigInt(minimum);

  /* Mass, where a density was supplied. */
  const d = input.density;
  const grossUg = d ? massOf(input.stockVolumeUm3 * stockToBuy, d) : null;
  const blankUg = d && input.blankVolumeUm3 ? massOf(input.blankVolumeUm3, d) : null;
  const partUg = d && input.partVolumeUm3 ? massOf(input.partVolumeUm3, d) : null;
  const netUg = partUg === null ? null : partUg * route.goodParts;

  /* Where the difference between net and gross actually went. Recoverable
     offcut (whole unused area of bought stock) is kept apart from scrap
     generated making the parts, because one can often be sold back as a size
     and the other only as swarf. */
  const boughtVolume = input.stockVolumeUm3 * stockToBuy;
  const releasedVolume = input.blankVolumeUm3 ? input.blankVolumeUm3 * blanksToRelease : null;
  const offcutVolume = releasedVolume === null ? null : boughtVolume - releasedVolume;

  return Object.freeze({
    ok: true,
    route,
    layout,

    /* The quantities, each one separate and each one named. */
    quantities: Object.freeze({
      acceptedPartsRequired: route.goodParts,
      blanksForProcess: route.blanksRequired,
      contingencyBlanks,
      blanksToRelease,
      stockUnitsNeeded: stockNeeded,
      stockUnitsToBuy: stockToBuy,
      roundedUpForPurchase: stockToBuy - stockNeeded,
      blanksPerStockUnit: perStock,
    }),

    mass: Object.freeze({
      finishedPartsNetUg: netUg,
      oneBlankUg: blankUg,
      grossPurchasedUg: grossUg,
      densitySource: d ? d.source : null,
    }),

    volume: Object.freeze({
      purchasedUm3: boughtVolume,
      releasedAsBlanksUm3: releasedVolume,
      recoverableOffcutUm3: offcutVolume,
    }),

    /* Stated as separate causes, because a challenge is always about one of them. */
    losses: Object.freeze({
      processLossPieces: route.processLoss,
      contingencyPieces: contingencyBlanks,
      purchaseRoundingUnits: stockToBuy - stockNeeded,
    }),

    statement:
      `${route.goodParts} accepted parts needs ${route.blanksRequired} blanks through the route` +
      (contingencyBlanks > 0n ? `, plus ${contingencyBlanks} contingency` : "") +
      `, which is ${stockToBuy} stock unit(s) at ${perStock} blanks each` +
      (stockToBuy > stockNeeded ? ` after rounding up to what the supplier sells` : "") + ".",
  });
}

/* ------------------------------------------------------------- cost model */

/**
 * The cost elements a should-cost estimate is made of. Each is optional; an
 * element with no rate is reported as missing rather than as zero.
 */
export const COST_ELEMENTS = Object.freeze([
  { id: "stock", label: "Raw stock", basisNeeded: "purchase quantity × price per compatible unit" },
  { id: "preparation", label: "Cutting and preparation", basisNeeded: "setup plus time, cuts or a quoted charge" },
  { id: "manufacturing", label: "Manufacturing", basisNeeded: "operation setup and cycle rate, or a supplier quote" },
  { id: "special", label: "Special processes", basisNeeded: "batch minimum and per-part, weight or area charge" },
  { id: "inspection", label: "Inspection and testing", basisNeeded: "setup, test charges and sample consumption" },
  { id: "freight", label: "Freight and packaging", basisNeeded: "an entered or attributable estimate" },
  { id: "tooling", label: "Tooling and NRE", basisNeeded: "a one-time charge", oneTime: true },
  { id: "scrapCredit", label: "Scrap credit", basisNeeded: "recoverable quantity × an evidenced credit rate", credit: true },
  { id: "overhead", label: "Overhead and margin", basisNeeded: "an explicit assumption with its calculation basis" },
]);

/**
 * Add the cost elements up, and refuse to call a partial sum a total.
 *
 * An entry with no `amount` is the point of this function: it says "this part
 * of the cost applies and nobody has a figure for it". That is a different
 * statement from leaving the element out, which says it does not apply. The
 * first produces a subtotal and a gap; the second produces a complete estimate.
 * Neither ever produces a zero standing in for an unknown.
 *
 * @param {object} plan     a planMaterial result
 * @param {Array}  entries  [{ id, amount: Money|null, basis, quality, note }]
 * @param {object} [opts]   { currency, amortiseTooling: boolean }
 */
export function costPlan(plan, entries = [], { currency = null, amortiseTooling = false } = {}) {
  if (!plan || !plan.ok) {
    return Object.freeze({ ok: false, reason: "There is no material plan to cost." });
  }

  const byId = new Map();
  for (const e of entries) {
    const def = COST_ELEMENTS.find((c) => c.id === e.id);
    if (!def) throw new RangeError(`${e.id} is not a cost element this model knows`);
    if (byId.has(e.id)) throw new RangeError(`${e.id} was entered twice`);
    const priced = e.amount !== null && e.amount !== undefined;
    if (priced && typeof e.amount.minor !== "bigint") {
      throw new TypeError(`${e.id}: an amount must be Money, or null to declare it unpriced`);
    }
    if (priced && !String(e.basis ?? "").trim()) {
      throw new TypeError(`${e.id} has no basis. A cost without a basis cannot be defended, so it is not accepted.`);
    }
    byId.set(e.id, { ...e, priced });
  }

  const firstPriced = [...byId.values()].find((e) => e.priced);
  const cur = currency ?? (firstPriced ? firstPriced.amount.currency : null);
  for (const e of byId.values()) {
    if (e.priced && cur && e.amount.currency !== cur) {
      throw new RangeError(
        `${e.id} is in ${e.amount.currency} against a ${cur} estimate. Mixed currencies are never ` +
        `converted implicitly — supply a dated, sourced rate and convert first.`);
    }
  }

  const parts = plan.quantities.acceptedPartsRequired;
  const lines = [];
  const missing = [];
  let recurringMinor = 0n;
  let oneTimeMinor = 0n;
  let weakest = BASIS.QUOTED;

  for (const def of COST_ELEMENTS) {
    const e = byId.get(def.id);
    /* An element nobody mentioned does not apply. An estimate for a part with
       no special processes is complete without a special-process line. */
    if (!e) continue;

    if (!e.priced) {
      missing.push(Object.freeze({
        id: def.id, label: def.label, needs: def.basisNeeded,
        note: e.note ?? null,
      }));
      lines.push(Object.freeze({
        id: def.id, label: def.label, amount: null, signed: 0n,
        oneTime: Boolean(def.oneTime) && !amortiseTooling, credit: Boolean(def.credit),
        basis: null, quality: null, note: e.note ?? null,
      }));
      continue;
    }

    const quality = e.quality ?? BASIS.ASSUMED;
    if (BASIS_RANK[quality] === undefined) throw new RangeError(`${def.id}: unknown basis ${quality}`);
    if (BASIS_RANK[quality] < BASIS_RANK[weakest]) weakest = quality;

    const signed = def.credit ? -e.amount.minor : e.amount.minor;
    if (def.oneTime && !amortiseTooling) oneTimeMinor += signed;
    else recurringMinor += signed;

    lines.push(Object.freeze({
      id: def.id, label: def.label, amount: e.amount, signed,
      oneTime: Boolean(def.oneTime) && !amortiseTooling,
      credit: Boolean(def.credit),
      basis: String(e.basis), quality, note: e.note ?? null,
    }));
  }

  const complete = missing.length === 0;
  const confidence = !complete ? CONFIDENCE.INCOMPLETE
    : weakest === BASIS.QUOTED ? CONFIDENCE.QUOTED
    : weakest === BASIS.REVIEWED ? CONFIDENCE.REVIEWED
    : CONFIDENCE.BUDGETARY;

  const perPart = parts > 0n ? money(scaleDiv(recurringMinor, parts), cur, null) : null;
  const materialLine = lines.find((l) => l.id === "stock");
  const materialShare = materialLine && recurringMinor > 0n
    ? scaleDiv(materialLine.amount.minor * SCALE, recurringMinor)
    : null;

  return Object.freeze({
    ok: true,
    currency: cur,
    lines: Object.freeze(lines),
    missing: Object.freeze(missing),
    complete,
    confidence,
    /* Named `subtotal`, never `total`, while anything is missing. */
    subtotal: cur ? money(recurringMinor, cur, null) : null,
    oneTime: cur ? money(oneTimeMinor, cur, null) : null,
    perAcceptedPart: complete ? perPart : null,
    materialShare,
    statement: complete
      ? `${lines.length} cost element(s), ${confidence}. ` +
        `${cur} ${moneyToDecimalString(money(recurringMinor, cur, null))} for ${parts} accepted parts` +
        (oneTimeMinor !== 0n ? `, plus ${cur} ${moneyToDecimalString(money(oneTimeMinor, cur, null))} one-time.` : ".")
      : `This is a partial subtotal, not a cost. ${missing.length} element(s) apply and have no figure: ` +
        `${missing.map((m) => m.label).join(", ")}. Nothing was assumed in their place.`,
    method:
      "Each element carries its own basis and the strength of that basis; the estimate as a whole is " +
      "only as strong as its weakest element. A missing rate stays missing — it is never zero and " +
      "never a market price from elsewhere — so an incomplete estimate reports a subtotal and what " +
      "is absent, rather than a total.",
  });
}

/**
 * Everything a saved estimate has to carry to be reproducible later.
 * The brief's rule: a result without its assumptions is not a result.
 */
export function assumptions(plan, cost) {
  const rows = [];
  if (plan && plan.ok) {
    for (const step of plan.route.steps) {
      rows.push({
        what: `${step.stage.name} yield`,
        value: step.stage.yield,
        kind: "ratio",
        basis: step.stage.basis,
        affects: "how many blanks are released",
      });
      if (step.stage.fixedPieces > 0) {
        rows.push({
          what: `${step.stage.name} setup and test pieces`,
          value: BigInt(step.stage.fixedPieces),
          kind: "pieces",
          basis: step.stage.basis,
          affects: `taken from the ${step.consumes}`,
        });
      }
    }
    if (plan.mass.densitySource) {
      rows.push({ what: "Density", value: null, kind: "text", basis: plan.mass.densitySource, affects: "mass, and therefore material cost" });
    }
    if (plan.layout.kind === "simple grid") {
      rows.push({
        what: "Stock layout",
        value: null, kind: "text",
        basis: `simple grid, ${plan.layout.orientation}` + (plan.layout.rotationAllowed ? ", rotation permitted" : ", rotation not permitted"),
        affects: "blanks per stock unit",
      });
    }
    if (plan.quantities.contingencyBlanks > 0n) {
      rows.push({
        what: "Contingency",
        value: plan.quantities.contingencyBlanks, kind: "pieces", basis: BASIS.ASSUMED,
        affects: "blanks released above what the route requires",
      });
    }
  }
  if (cost && cost.ok) {
    for (const l of cost.lines) {
      rows.push({ what: l.label, value: l.amount, kind: "money", basis: `${l.quality} — ${l.basis}`, affects: "the estimate" });
    }
  }
  return Object.freeze(rows.map(Object.freeze));
}
