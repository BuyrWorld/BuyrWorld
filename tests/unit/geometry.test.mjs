/**
 * The bounded Part Builder — increment C2.
 *
 * Deliberately small: a rectangular block, through-holes and rectangular
 * pockets. The pack asks to begin exactly there and, in the same breath, not
 * to claim a general CAD replacement.
 *
 * Two things carry most of the weight.
 *
 * A round hole's volume contains π, which no integer of cubic micrometres
 * equals. So a part with holes has a volume *interval*, and the tests below
 * check the bracket actually contains the truth rather than merely looking
 * tight.
 *
 * And feature ids survive deletion. `requirements.mjs` attaches tolerances to
 * feature ids; if ids were derived from array position, deleting hole 2 of 3
 * would hand hole 3's tolerance to a different hole. That module refuses to
 * transfer a requirement silently — and this is the only place that refusal
 * can actually be honoured.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  FEATURE, FRAME, SCHEMA_VERSION,
  block, addHole, addPocket, editFeature, removeFeature, resize,
  whyInvalid, featureIds, volume, mass, history,
} from "../../src/studio/geometry.mjs";
import { density } from "../../src/calc/units.mjs";
import { attachments, requirement, KIND, SCOPE, ATTACHMENT } from "../../src/studio/requirements.mjs";

const mm = (x) => BigInt(Math.round(x * 1000));
/** 100 x 50 x 10 mm plate. */
const plate = () => block({ widthUm: mm(100), lengthUm: mm(50), thicknessUm: mm(10) });
const ok = (r) => { assert.equal(r.error, undefined, r.error); return r.model; };

/* --------------------------------------------------------------- the frame */

describe("the coordinate frame is stated, not assumed", () => {
  test("the origin and every axis are named", () => {
    // "15 mm from the corner" means nothing until everyone agrees which corner.
    assert.match(FRAME.origin, /bottom-left corner of the top face/);
    assert.ok(FRAME.x && FRAME.y && FRAME.z);
  });

  test("the block carries the frame with it", () => {
    assert.equal(plate().frame, FRAME);
    assert.equal(plate().schema, SCHEMA_VERSION);
  });

  test("a block needs real dimensions", () => {
    assert.throws(() => block({ widthUm: 0n, lengthUm: mm(50), thicknessUm: mm(10) }),
      /must be more than nothing/);
    assert.throws(() => block({ widthUm: 1.5, lengthUm: mm(50), thicknessUm: mm(10) }),
      /whole number of micrometres/);
  });
});

/* ------------------------------------------------------------- validation */

describe("impossible geometry is refused, and the model survives", () => {
  test("a hole outside the block is refused, and says where the block is", () => {
    const m = plate();
    const r = addHole(m, { xUm: mm(120), yUm: mm(25), diameterUm: mm(6) });
    assert.match(r.error, /falls outside the block/);
    assert.match(r.error, /100 × 50mm/);
    assert.equal(r.model, m, "the last valid model is returned unchanged");
  });

  test("a hole half over the edge is refused too", () => {
    // Its centre is inside; its edge is not.
    const r = addHole(plate(), { xUm: mm(1), yUm: mm(25), diameterUm: mm(6) });
    assert.match(r.error, /falls outside the block/);
  });

  test("the rejected proposal comes back, so the form can keep it", () => {
    /* Losing what somebody typed and asking again is how they give up. */
    const r = addHole(plate(), { xUm: mm(120), yUm: mm(25), diameterUm: mm(6) });
    assert.equal(r.proposal.xUm, mm(120));
    assert.equal(r.proposal.diameterUm, mm(6));
  });

  test("two features cannot occupy the same place", () => {
    const m = ok(addHole(plate(), { xUm: mm(20), yUm: mm(25), diameterUm: mm(10) }));
    const r = addHole(m, { xUm: mm(22), yUm: mm(25), diameterUm: mm(10) });
    assert.match(r.error, /overlaps hole-1/);
  });

  test("a pocket as deep as the plate is a hole, and says so", () => {
    const r = addPocket(plate(), { xUm: mm(10), yUm: mm(10), widthUm: mm(20), lengthUm: mm(20), depthUm: mm(10) });
    assert.match(r.error, /That is a hole, not a pocket/);
  });

  test("a pocket needs a depth", () => {
    const r = addPocket(plate(), { xUm: mm(10), yUm: mm(10), widthUm: mm(20), lengthUm: mm(20), depthUm: 0n });
    assert.match(r.error, /needs a depth/);
  });

  test("editing to something impossible leaves the model alone", () => {
    const m = ok(addHole(plate(), { xUm: mm(20), yUm: mm(25), diameterUm: mm(6) }));
    const r = editFeature(m, "hole-1", { xUm: mm(200) });
    assert.match(r.error, /falls outside/);
    assert.equal(r.model.features[0].xUm, mm(20), "the good value is still there");
  });

  test("editing a feature that is not there says so", () => {
    assert.match(editFeature(plate(), "hole-9", { xUm: mm(1) }).error, /no hole-9 on this part/);
  });
});

/* --------------------------------------------------------- stable identity */

describe("feature ids survive deletion", () => {
  const three = () => {
    let m = plate();
    m = ok(addHole(m, { xUm: mm(15), yUm: mm(25), diameterUm: mm(6) }));
    m = ok(addHole(m, { xUm: mm(50), yUm: mm(25), diameterUm: mm(6) }));
    m = ok(addHole(m, { xUm: mm(85), yUm: mm(25), diameterUm: mm(6) }));
    return m;
  };

  test("they are named in order as they are added", () => {
    assert.deepEqual(featureIds(three()), ["hole-1", "hole-2", "hole-3"]);
  });

  test("removing one does not renumber the others", () => {
    const m = ok(removeFeature(three(), "hole-2"));
    assert.deepEqual(featureIds(m), ["hole-1", "hole-3"]);
  });

  test("and the next hole added does not reuse the gone id", () => {
    /* The whole reason ids are not array positions. hole-2 carried a
       tolerance; a new hole inheriting that name inherits the tolerance. */
    let m = ok(removeFeature(three(), "hole-2"));
    m = ok(addHole(m, { xUm: mm(50), yUm: mm(40), diameterUm: mm(4) }));
    assert.deepEqual(featureIds(m), ["hole-1", "hole-3", "hole-4"]);
  });

  test("editing a feature keeps its id, because it is the same feature", () => {
    const m = ok(editFeature(three(), "hole-2", { diameterUm: mm(8) }));
    assert.equal(m.features[1].id, "hole-2");
    assert.equal(m.features[1].diameterUm, mm(8));
  });

  test("holes and pockets are numbered separately", () => {
    let m = ok(addHole(plate(), { xUm: mm(15), yUm: mm(25), diameterUm: mm(6) }));
    m = ok(addPocket(m, { xUm: mm(40), yUm: mm(10), widthUm: mm(20), lengthUm: mm(20), depthUm: mm(3) }));
    assert.deepEqual(featureIds(m), ["hole-1", "pocket-1"]);
  });
});

/* ------------------------------------------- the reason this matters to C1 */

describe("requirements can finally lose their target", () => {
  test("a tolerance on a hole that exists is attached", () => {
    const m = ok(addHole(plate(), { xUm: mm(15), yUm: mm(25), diameterUm: mm(6) }));
    const r = requirement({ kind: KIND.SURFACE_TEXTURE, parameter: "Ra", value: "1.6",
      scope: { type: SCOPE.FEATURE, featureId: "hole-1" } });
    assert.equal(attachments([r], featureIds(m))[0].state, ATTACHMENT.OK);
  });

  test("and detaches when that hole is deleted", () => {
    /* Before this module existed, the page had no feature list to pass, so
       every requirement reported as waiting and DETACHED could never occur —
       a state with tests that could not happen in the product. */
    let m = ok(addHole(plate(), { xUm: mm(15), yUm: mm(25), diameterUm: mm(6) }));
    m = ok(addHole(m, { xUm: mm(50), yUm: mm(25), diameterUm: mm(6) }));
    const r = requirement({ kind: KIND.SURFACE_TEXTURE, parameter: "Ra", value: "1.6",
      scope: { type: SCOPE.FEATURE, featureId: "hole-1" } });

    const after = ok(removeFeature(m, "hole-1"));
    const [a] = attachments([r], featureIds(after));
    assert.equal(a.state, ATTACHMENT.DETACHED);
    assert.match(a.why, /hole-1 no longer exists/);
  });

  test("and does not quietly move to the hole that remains", () => {
    let m = ok(addHole(plate(), { xUm: mm(15), yUm: mm(25), diameterUm: mm(6) }));
    m = ok(addHole(m, { xUm: mm(50), yUm: mm(25), diameterUm: mm(6) }));
    const r = requirement({ kind: KIND.SURFACE_TEXTURE, parameter: "Ra", value: "1.6",
      scope: { type: SCOPE.FEATURE, featureId: "hole-1" } });
    const after = ok(removeFeature(m, "hole-1"));
    assert.equal(r.scope.featureId, "hole-1", "it still points where it pointed");
    assert.deepEqual(featureIds(after), ["hole-2"]);
  });
});

/* ------------------------------------------------------------- resizing */

describe("resizing the block", () => {
  test("features that would fall outside stop it, and are named", () => {
    const m = ok(addHole(plate(), { xUm: mm(85), yUm: mm(25), diameterUm: mm(6) }));
    const r = resize(m, { widthUm: mm(50) });
    assert.match(r.error, /hole-1 would fall outside/);
    assert.deepEqual(r.orphaned, ["hole-1"]);
    assert.equal(r.model.widthUm, mm(100), "nothing was changed");
  });

  test("a resize that fits is allowed and bumps the revision", () => {
    const m = ok(addHole(plate(), { xUm: mm(15), yUm: mm(25), diameterUm: mm(6) }));
    const bigger = ok(resize(m, { widthUm: mm(200) }));
    assert.equal(bigger.widthUm, mm(200));
    assert.equal(bigger.revision, m.revision + 1);
  });

  test("nothing is moved to make it fit", () => {
    // Moving a hole to keep a resize working would silently change the part.
    const m = ok(addHole(plate(), { xUm: mm(85), yUm: mm(25), diameterUm: mm(6) }));
    resize(m, { widthUm: mm(50) });
    assert.equal(m.features[0].xUm, mm(85));
  });
});

/* --------------------------------------------------------------- volume */

describe("volume is exact where it can be", () => {
  test("a plain block is exact", () => {
    const v = volume(plate());
    assert.equal(v.exact, true);
    assert.equal(v.lowerUm3, v.upperUm3);
    assert.equal(v.lowerUm3, mm(100) * mm(50) * mm(10));
    assert.match(v.why, /Every feature is rectangular/);
  });

  test("a rectangular pocket keeps it exact", () => {
    const m = ok(addPocket(plate(), { xUm: mm(10), yUm: mm(10), widthUm: mm(20), lengthUm: mm(20), depthUm: mm(3) }));
    const v = volume(m);
    assert.equal(v.exact, true);
    assert.equal(v.pocketsUm3, mm(20) * mm(20) * mm(3));
    assert.equal(v.lowerUm3, v.grossUm3 - v.pocketsUm3);
  });
});

describe("volume is bounded where it cannot be exact", () => {
  const withHole = () => ok(addHole(plate(), { xUm: mm(50), yUm: mm(25), diameterUm: mm(10) }));

  test("a round hole makes it an interval, and says why", () => {
    const v = volume(withHole());
    assert.equal(v.exact, false);
    assert.ok(v.lowerUm3 < v.upperUm3);
    assert.match(v.why, /contains pi/);
  });

  test("the bounds actually contain the truth", () => {
    /* The test that matters. A tight-looking interval that excludes the real
       value is worse than a wide one, so this checks containment against a
       high-precision figure rather than against the same constants the module
       used. π r² t for r = 5mm, t = 10mm is 785.398163397448…  mm³. */
    const v = volume(withHole());
    const removed = { lo: v.grossUm3 - v.upperUm3, hi: v.grossUm3 - v.lowerUm3 };
    const trueMm3 = Math.PI * 25 * 10;                 // 785.3981633974483
    const loMm3 = Number(removed.lo) / 1e9;
    const hiMm3 = Number(removed.hi) / 1e9;
    assert.ok(loMm3 <= trueMm3, `lower bound ${loMm3} is above the truth ${trueMm3}`);
    assert.ok(hiMm3 >= trueMm3, `upper bound ${hiMm3} is below the truth ${trueMm3}`);
  });

  test("and they are tight enough to be useful", () => {
    // Within a cubic micrometre on a 50 cm³ part: the interval exists to be
    // honest, not to be vague.
    const v = volume(withHole());
    assert.ok(v.upperUm3 - v.lowerUm3 <= 2n);
  });

  test("more holes widen the interval, never narrow it", () => {
    let m = withHole();
    const one = volume(m);
    m = ok(addHole(m, { xUm: mm(20), yUm: mm(25), diameterUm: mm(10) }));
    const two = volume(m);
    assert.ok(two.upperUm3 - two.lowerUm3 >= one.upperUm3 - one.lowerUm3);
    assert.ok(two.lowerUm3 < one.lowerUm3, "and the part gets lighter");
  });

  test("a hole and a pocket together stay bounded", () => {
    let m = withHole();
    m = ok(addPocket(m, { xUm: mm(5), yUm: mm(5), widthUm: mm(15), lengthUm: mm(15), depthUm: mm(3) }));
    const v = volume(m);
    assert.equal(v.exact, false);
    assert.equal(v.pocketsUm3, mm(15) * mm(15) * mm(3));
  });
});

/* ----------------------------------------------------------------- mass */

describe("mass needs a density somebody sourced", () => {
  const d = () => density(2700, "kg/m3", "supplier datasheet, entered by the buyer");

  test("with no density there is no weight, and it says why", () => {
    const m = mass(plate(), null);
    assert.equal(m.known, false);
    assert.match(m.why, /guessed from a similar alloy/);
  });

  test("a plain block weighs an exact amount", () => {
    // 100 x 50 x 10 mm is 50 cm³; at 2.7 g/cm³ that is 135 g.
    const m = mass(plate(), d());
    assert.equal(m.known, true);
    assert.equal(m.exact, true);
    assert.equal(m.lowerUg, m.upperUg);
    assert.equal(m.lowerUg / 1000n, 135_000n, "135 g");
  });

  test("a part with a hole weighs between two amounts", () => {
    const withHole = ok(addHole(plate(), { xUm: mm(50), yUm: mm(25), diameterUm: mm(10) }));
    const m = mass(withHole, d());
    assert.equal(m.exact, false);
    assert.ok(m.lowerUg <= m.upperUg);
    assert.ok(m.upperUg < 135_000_000n, "lighter than the solid block");
  });

  test("the density's source is carried, because the weight rests on it", () => {
    assert.equal(mass(plate(), d()).source, "supplier datasheet, entered by the buyer");
  });

  test("a density with no source never gets this far", () => {
    assert.throws(() => density(2700, "kg/m3", ""), /needs a source/);
  });
});

/* -------------------------------------------------------------- history */

describe("undo", () => {
  test("steps back to the previous model", () => {
    const h = history(plate());
    h.push(ok(addHole(h.current(), { xUm: mm(15), yUm: mm(25), diameterUm: mm(6) })));
    assert.equal(featureIds(h.current()).length, 1);
    h.undo();
    assert.equal(featureIds(h.current()).length, 0);
  });

  test("and forward again, to the same model it left", () => {
    const h = history(plate());
    h.push(ok(addHole(h.current(), { xUm: mm(15), yUm: mm(25), diameterUm: mm(6) })));
    const before = h.current();
    h.undo();
    assert.equal(h.canRedo(), true);
    h.redo();
    assert.equal(h.current(), before, "redo returns the model itself, not a rebuild of it");
    assert.deepEqual(featureIds(h.current()), ["hole-1"]);
  });

  test("editing after undoing discards what was ahead", () => {
    // What everybody expects, and what a naive stack gets wrong.
    const h = history(plate());
    h.push(ok(addHole(h.current(), { xUm: mm(15), yUm: mm(25), diameterUm: mm(6) })));
    h.push(ok(addHole(h.current(), { xUm: mm(50), yUm: mm(25), diameterUm: mm(6) })));
    h.undo();
    h.push(ok(addPocket(h.current(), { xUm: mm(60), yUm: mm(10), widthUm: mm(20), lengthUm: mm(20), depthUm: mm(3) })));
    assert.equal(h.canRedo(), false);
    assert.deepEqual(featureIds(h.current()), ["hole-1", "pocket-1"]);
  });

  test("it will not go back past the beginning", () => {
    const h = history(plate());
    assert.equal(h.canUndo(), false);
    h.undo(); h.undo();
    assert.equal(featureIds(h.current()).length, 0);
  });

  test("it is bounded, so a long session cannot grow without limit", () => {
    const h = history(plate(), 5);
    let m = plate();
    for (let i = 0; i < 20; i++) {
      m = ok(addHole(m, { xUm: mm(5 + i * 4), yUm: mm(25), diameterUm: mm(3) }));
      h.push(m);
    }
    assert.equal(h.depth(), 5);
    assert.equal(featureIds(h.current()).length, 20, "the newest is still the current one");
  });
});
