/**
 * A bounded parametric part: a rectangular block, through-holes and pockets.
 *
 * Increment C2, deliberately small. `design/06-PART-BUILDER-AND-REVIEW.md`
 * asks to "begin with supported primitives and features: rectangular
 * plate/block and basic through-holes/pockets" and, in the same breath, to
 * "not claim a general CAD replacement". This is the first half and refuses
 * the second: there is no freeform surface here, no fillet, no revolve, and
 * nothing that would let somebody believe otherwise.
 *
 * Three things make it worth having rather than a drawing of a box.
 *
 * **It is exact where it can be.** Every dimension is integer micrometres,
 * like the rest of this repository. The block's volume and a rectangular
 * pocket's volume are exact integers.
 *
 * **It is honestly bounded where it cannot be.** A round hole's volume
 * contains π, which is not a rational number, so it cannot be an exact integer
 * of cubic micrometres. Rather than rounding and presenting the result as
 * exact, the volume of a part with holes is an interval — a lower and an upper
 * bound that provably contain the true value. `certificate.mjs` already treats
 * a reported value as the range it covers; this is the same idea applied to a
 * number the arithmetic itself cannot pin down.
 *
 * **Features have stable identities.** A hole keeps its id when another hole
 * is deleted, because `requirements.mjs` attaches tolerances and finishes to
 * feature ids, and an id that shifts when a neighbour is removed would move a
 * tolerance onto a different hole. That is the one failure the requirements
 * module exists to prevent, and it can only be prevented here.
 */

import { massOf } from "../calc/units.mjs";

/* ------------------------------------------------------------------ pi */

/**
 * Rational bounds on π, as numerators over 1e18.
 *
 * Not an approximation to be rounded away: the pair brackets π, so any
 * quantity computed with the low one is at or below the truth and any computed
 * with the high one is at or above it. Eighteen digits is far past what any
 * manufacturing question needs; the point is that the bracket is provable.
 */
const PI_SCALE = 1_000_000_000_000_000_000n;
const PI_LO = 3_141_592_653_589_793_238n;
const PI_HI = 3_141_592_653_589_793_239n;

/** Floor and ceiling division that stay correct for negative numerators. */
const floorDiv = (a, b) => (a >= 0n ? a / b : -((-a + b - 1n) / b));
const ceilDiv = (a, b) => (a >= 0n ? (a + b - 1n) / b : -((-a) / b));

/* ------------------------------------------------------------- the model */

export const FEATURE = Object.freeze({
  HOLE: "through-hole",
  POCKET: "rectangular-pocket",
});

export const SCHEMA_VERSION = 1;

/**
 * The coordinate frame, stated rather than assumed.
 *
 * The pack asks for an explicit origin and named axes on every operation,
 * because "15mm from the corner" means nothing until everyone agrees which
 * corner. X is across the width, Y along the length, Z up through the
 * thickness, and the origin is the bottom-left of the block's top face.
 */
export const FRAME = Object.freeze({
  origin: "bottom-left corner of the top face",
  x: "across the width",
  y: "along the length",
  z: "down into the thickness",
});

/** A new block. Dimensions are integer micrometres. */
export function block(input = {}) {
  const w = big(input.widthUm, "width");
  const l = big(input.lengthUm, "length");
  const t = big(input.thicknessUm, "thickness");
  for (const [name, v] of [["width", w], ["length", l], ["thickness", t]]) {
    if (v <= 0n) throw new RangeError(`A block's ${name} must be more than nothing.`);
  }
  return Object.freeze({
    schema: SCHEMA_VERSION,
    widthUm: w, lengthUm: l, thicknessUm: t,
    features: Object.freeze([]),
    revision: 1,
    frame: FRAME,
  });
}

function big(v, what) {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  throw new TypeError(`A block's ${what} must be a whole number of micrometres`);
}

/* ----------------------------------------------------------- identities */

/**
 * Ids are minted from a counter carried on the model, not from the array
 * length.
 *
 * Length-based ids repeat after a deletion — remove hole 2 of 3 and the next
 * one added is called hole-3 again, inheriting a tolerance that was written
 * for a hole that no longer exists. That is precisely the silent transfer
 * `requirements.mjs` refuses to do, and it would happen here instead.
 */
function nextId(model, kind) {
  const prefix = kind === FEATURE.HOLE ? "hole" : "pocket";
  let highest = 0;
  for (const id of [...(model.issuedIds ?? []), ...model.features.map(f => f.id)]) {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(id);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `${prefix}-${highest + 1}`;
}

/* ------------------------------------------------------------ validation */

/** Where a feature sits, as a rectangle, for overlap and bounds checks. */
function extent(f) {
  if (f.kind === FEATURE.HOLE) {
    const r = f.diameterUm / 2n;
    return { x0: f.xUm - r, x1: f.xUm + r, y0: f.yUm - r, y1: f.yUm + r };
  }
  return { x0: f.xUm, x1: f.xUm + f.widthUm, y0: f.yUm, y1: f.yUm + f.lengthUm };
}

const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Why a feature cannot be added, or null.
 *
 * Returns the reason rather than throwing, because the caller wants to keep
 * the last valid model *and* the rejected proposal so the person can correct
 * it — "Reject impossible dimensions or failed operations while retaining the
 * last valid model and entered proposal."
 */
export function whyInvalid(model, feature) {
  if (feature.kind === FEATURE.HOLE) {
    if (feature.diameterUm <= 0n) return "A hole needs a diameter.";
  } else {
    if (feature.widthUm <= 0n || feature.lengthUm <= 0n) return "A pocket needs a width and a length.";
    if (feature.depthUm <= 0n) return "A pocket needs a depth.";
    if (feature.depthUm >= model.thicknessUm) {
      return `A pocket ${fmt(feature.depthUm)}mm deep goes through a block `
        + `${fmt(model.thicknessUm)}mm thick. That is a hole, not a pocket.`;
    }
  }

  const e = extent(feature);
  if (e.x0 < 0n || e.y0 < 0n || e.x1 > model.widthUm || e.y1 > model.lengthUm) {
    return `That falls outside the block. The block is ${fmt(model.widthUm)} × `
      + `${fmt(model.lengthUm)}mm, measured from the ${FRAME.origin}.`;
  }

  for (const other of model.features) {
    if (other.id === feature.id) continue;
    if (overlap(e, extent(other))) {
      return `That overlaps ${other.id}. Two features cannot occupy the same place.`;
    }
  }
  return null;
}

const fmt = (um) => {
  const whole = um / 1000n;
  const frac = String(um % 1000n).padStart(3, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
};

/* -------------------------------------------------------------- editing */

/** Add a through-hole. Returns { model } or { error, model } with the model unchanged. */
export function addHole(model, { xUm, yUm, diameterUm }) {
  const feature = Object.freeze({
    id: nextId(model, FEATURE.HOLE), kind: FEATURE.HOLE,
    xUm: big(xUm, "x"), yUm: big(yUm, "y"), diameterUm: big(diameterUm, "diameter"),
  });
  return place(model, feature);
}

/** Add a rectangular pocket. */
export function addPocket(model, { xUm, yUm, widthUm, lengthUm, depthUm }) {
  const feature = Object.freeze({
    id: nextId(model, FEATURE.POCKET), kind: FEATURE.POCKET,
    xUm: big(xUm, "x"), yUm: big(yUm, "y"),
    widthUm: big(widthUm, "width"), lengthUm: big(lengthUm, "length"),
    depthUm: big(depthUm, "depth"),
  });
  return place(model, feature);
}

function place(model, feature) {
  const error = whyInvalid(model, feature);
  /* The rejected proposal comes back with the reason, so the form can keep
     what was typed. Losing it and asking again is how a person gives up. */
  if (error) return { error, model, proposal: feature };
  return {
    model: Object.freeze({
      ...model,
      features: Object.freeze([...model.features, feature]),
      issuedIds: Object.freeze([...new Set([...(model.issuedIds ?? []),
        ...model.features.map(f => f.id), feature.id])]),
      revision: model.revision + 1,
    }),
  };
}

/** Change one feature. The id is kept, because it is the same feature. */
export function editFeature(model, id, changes) {
  const at = model.features.findIndex((f) => f.id === id);
  if (at < 0) return { error: `There is no ${id} on this part.`, model };

  const next = Object.freeze({ ...model.features[at], ...normalise(changes), id });
  const error = whyInvalid(model, next);
  if (error) return { error, model, proposal: next };

  const features = [...model.features];
  features[at] = next;
  return { model: Object.freeze({ ...model, features: Object.freeze(features), revision: model.revision + 1 }) };
}

const normalise = (c) => {
  const out = {};
  for (const [k, v] of Object.entries(c)) out[k] = k.endsWith("Um") ? big(v, k) : v;
  return out;
};

/**
 * Remove a feature.
 *
 * Every other feature keeps its id. Renumbering would move a tolerance written
 * for one hole onto another, which is the exact silent transfer the
 * requirements module refuses to perform — it can only be prevented here.
 */
export function removeFeature(model, id) {
  const kept = model.features.filter((f) => f.id !== id);
  if (kept.length === model.features.length) return { error: `There is no ${id} on this part.`, model };
  return { model: Object.freeze({ ...model, features: Object.freeze(kept), revision: model.revision + 1 }) };
}

/** Resize the block. Features that no longer fit are reported, not moved. */
export function resize(model, dims) {
  const next = Object.freeze({ ...model, ...normalise(dims) });
  for (const d of ["widthUm", "lengthUm", "thicknessUm"]) {
    if (next[d] <= 0n) return { error: "A block's dimensions must be more than nothing.", model };
  }
  const bare = Object.freeze({ ...next, features: Object.freeze([]) });
  const orphaned = model.features.filter((f) => whyInvalid(bare, f) !== null);
  if (orphaned.length) {
    return {
      error: `${orphaned.map((f) => f.id).join(", ")} would fall outside the block at that size. `
        + "Move or remove them first — nothing has been changed.",
      model,
      orphaned: orphaned.map((f) => f.id),
    };
  }
  return { model: Object.freeze({ ...next, revision: model.revision + 1 }) };
}

/** Every feature id currently on the part, for requirements to attach to. */
export const featureIds = (model) => model.features.map((f) => f.id);

/* --------------------------------------------------------------- volume */

/**
 * The volume of the part, as bounds that contain the true value.
 *
 * The block and any rectangular pocket are exact. A round hole is not: its
 * volume contains π, and no integer of cubic micrometres equals it. Reporting
 * a single rounded figure would be presenting an approximation as a
 * measurement, so what comes back is an interval — and when the part has no
 * holes, the interval has zero width and says so.
 */
export function volume(model) {
  const gross = model.widthUm * model.lengthUm * model.thicknessUm;

  let pocketVolume = 0n;
  let holeLo = 0n;
  let holeHi = 0n;

  for (const f of model.features) {
    if (f.kind === FEATURE.POCKET) {
      pocketVolume += f.widthUm * f.lengthUm * f.depthUm;
    } else {
      /* π r² t. The radius may be a half-micrometre, so work in quarters of a
         square micrometre and divide once, at the end, in the direction that
         keeps each bound on the correct side. */
      const quarterAreaTimes4 = f.diameterUm * f.diameterUm;     // (2r)² = 4r²
      const n = quarterAreaTimes4 * model.thicknessUm;           // 4 r² t
      holeLo += floorDiv(PI_LO * n, PI_SCALE * 4n);
      holeHi += ceilDiv(PI_HI * n, PI_SCALE * 4n);
    }
  }

  const lo = gross - pocketVolume - holeHi;
  const hi = gross - pocketVolume - holeLo;

  return Object.freeze({
    grossUm3: gross,
    pocketsUm3: pocketVolume,
    lowerUm3: lo,
    upperUm3: hi,
    /* True when the answer is a number rather than a range, which is exactly
       when no round feature is involved. */
    exact: lo === hi,
    why: lo === hi
      ? "Every feature is rectangular, so this is exact."
      : "The part has round features, whose volume contains pi. These bounds contain the true value.",
  });
}

/**
 * Mass, given a density.
 *
 * Inherits the volume's bounds, because a bound multiplied by a known density
 * is still a bound. A density nobody has sourced is refused by `units.mjs`
 * before it reaches here.
 */
export function mass(model, density) {
  if (!density || typeof density.perMm3Scaled !== "bigint") {
    return Object.freeze({
      known: false,
      why: "No density has been confirmed, so this part has no weight yet. "
        + "A weight guessed from a similar alloy moves the whole purchased quantity.",
    });
  }
  const v = volume(model);
  /* massOf is the repository's single named rounding for this conversion, so
     both bounds go through it rather than through a second one written here.
     Applied to each end, a bracket on volume stays a bracket on mass. */
  return Object.freeze({
    known: true,
    lowerUg: massOf(v.lowerUm3, density),
    upperUg: massOf(v.upperUm3, density),
    exact: v.exact,
    source: density.source ?? null,
    why: v.why,
  });
}

/* -------------------------------------------------------------- history */

/**
 * Undo, kept as whole models rather than reverse operations.
 *
 * A stack of inverse edits has to be right for every operation and stays right
 * only while every operation stays right. Keeping the models themselves is
 * larger and cannot drift: the previous model *is* the previous model. These
 * are small.
 */
export function history(initial, limit = 50) {
  // Issued identities survive deletion AND branching after undo. Otherwise a
  // new hole can inherit a requirement attached to a discarded hole.
  const issued = new Set([...(initial.issuedIds ?? []), ...initial.features.map(f => f.id)]);
  function tracked(model) {
    for (const id of [...(model.issuedIds ?? []), ...model.features.map(f => f.id)]) issued.add(id);
    if ([...issued].every(id => (model.issuedIds ?? []).includes(id))) return model;
    return Object.freeze({ ...model, issuedIds: Object.freeze([...issued]) });
  }
  let stack = [tracked(initial)];
  let at = 0;
  const current = () => (stack[at] = tracked(stack[at]));
  return Object.freeze({
    current,
    revision: () => stack[at].revision,
    canUndo: () => at > 0,
    canRedo: () => at < stack.length - 1,
    push(model) {
      model = tracked(model);
      /* Anything redone from here is gone, which is what everyone expects
         after editing from a point in the past. */
      stack = [...stack.slice(0, at + 1), model];
      if (stack.length > limit) stack = stack.slice(stack.length - limit);
      at = stack.length - 1;
      return model;
    },
    undo() { if (at > 0) at--; return current(); },
    redo() { if (at < stack.length - 1) at++; return current(); },
    depth: () => stack.length,
  });
}
