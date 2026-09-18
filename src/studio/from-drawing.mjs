/**
 * The block, from the dimensions somebody confirmed off the drawing.
 *
 * `specs/02`'s Phase 5 opens: *"Connect confirmed dimensions/material/
 * requirements to bounded 3D editing."* The reader has proposed a width, a
 * length and a thickness; somebody has looked at each of them and said yes.
 * Until now that agreement went into the costing fields and stopped, and
 * anybody wanting a model typed the same three numbers again — which is both
 * tedious and the way two records of one part come to disagree.
 *
 * The word doing the work is **confirmed**. This is handed the output of
 * `review.confirmedValues`, which contains only what a person confirmed or
 * corrected: a proposed reading — the state everything starts in — is not in
 * it and cannot be. A model built from what a reader thought it saw, carrying
 * the same authority as one somebody checked, is exactly the confusion the
 * review queue exists to prevent.
 *
 * Three refusals:
 *
 *   - **A missing dimension stops it.** Two of three is not a block, and the
 *     third is not zero.
 *   - **A value with no unit stops it**, because `units.mjs` refuses one and
 *     is right to: a drawing that says 10 says nothing until it says 10 of
 *     what.
 *   - **A round part stops it.** The builder makes rectangular blocks; a
 *     drawing with a diameter and no width is a bar, and squaring it off would
 *     produce a part nobody drew.
 */

import { length as lengthOf } from "../calc/units.mjs";

/** The three a block needs, and what each is called on a drawing. */
export const NEEDED = Object.freeze({
  width: "the width",
  length: "the length",
  thickness: "the thickness",
});

/**
 * Turn confirmed readings into the three dimensions, or say what stops it.
 *
 * `confirmed` is `[{ field, value, unit, from }]` — `review.confirmedValues`'s
 * own shape, passed through rather than re-derived, so this cannot accidentally
 * be given a queue that still holds proposals.
 */
export function blockFrom(confirmed = []) {
  const byField = new Map();
  for (const item of confirmed) {
    if (item && item.field && !byField.has(item.field)) byField.set(item.field, item);
  }

  const missing = [];
  const dims = {};
  const from = [];

  for (const field of Object.keys(NEEDED)) {
    const item = byField.get(field);
    if (!item || item.value === null || item.value === undefined || item.value === "") {
      missing.push({ field, why: `Nothing confirmed gives ${NEEDED[field]}.` });
      continue;
    }
    try {
      const l = lengthOf(item.value, item.unit);
      dims[`${field === "width" ? "width" : field === "length" ? "length" : "thickness"}Um`] = l.um;
      from.push(Object.freeze({
        field, said: `${NEEDED[field]} is ${item.value} ${item.unit}, ${item.from}.`,
      }));
    } catch (e) {
      /* units.mjs refuses a missing or unconvertible unit, and its sentence
         says which — better than anything that could be written here. */
      missing.push({ field, why: `${cap(NEEDED[field])}: ${e.message}` });
    }
  }

  if (missing.length > 0) {
    const round = byField.has("diameter") && !byField.has("width");
    return Object.freeze({
      ok: false,
      missing: Object.freeze(missing.map(Object.freeze)),
      why: round
        ? "This drawing gives a diameter rather than a width. The builder makes rectangular "
          + "blocks, and squaring off a bar would produce a part nobody drew."
        : "A block needs all three, confirmed. What is missing is asked for rather than "
          + "assumed — a dimension nobody has confirmed is not zero.",
    });
  }

  return Object.freeze({
    ok: true,
    dims: Object.freeze(dims),
    from: Object.freeze(from),
    why: "Built from the three dimensions somebody confirmed off the drawing. Nothing that "
       + "was only proposed is in it.",
  });
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
