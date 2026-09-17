/**
 * The document viewer.
 *
 * Two things here are worth real tests, and the rest follows from them.
 *
 * A source crop is stored against the document, and the whole point of storing
 * it is that it still marks the same characters later. So the coordinate round
 * trip has to hold at every rotation and every zoom, not just at rest — and
 * rotation is where this kind of code is usually quietly wrong, because a
 * quarter turn swaps the sides and half the arithmetic forgets.
 *
 * And a viewer that lets somebody pan the page off the screen looks broken in
 * a way that reads as "the upload failed".
 */

import { test, describe } from "node:test";
import baseAssert from "node:assert/strict";

import {
  open, fit, actual, fitScale, scaleOf, rotated, contentSize, transform,
  pan, zoomIn, zoomOut, zoomTo, turn, goToPage, nextPage, prevPage, resize,
  toViewport, toDocument, region, regionOnScreen, isDeliberate, STOPS, TURNS,
} from "../../src/intake/viewer.mjs";

/** A landscape A3 drawing at 150dpi, in a pane that is wider than it is tall. */
const drawing = () => open({ pages: [{ w: 2480, h: 1754 }] }, { w: 800, h: 600 });

/** Two pages of different sizes, to catch anything assuming they are alike. */
const twoPages = () =>
  open({ pages: [{ w: 1000, h: 800 }, { w: 600, h: 1200 }] }, { w: 400, h: 400 });

/**
 * `assert`, plus `near` — view geometry is floating point and will not land
 * on an exact value.
 *
 * It hangs off `assert` rather than standing alone as `near(…)` because
 * `checks-still-check.test.mjs` finds a test that claims nothing by looking
 * for the word `assert` in its body, and a bare helper hides a real
 * assertion from it. Twelve of the tests below are geometry comparisons and
 * nothing else, and every one of them was reported as claiming nothing. The
 * ratchet is right to be literal; keeping the call sites `assert.near(…)`
 * is what keeps it able to see this file.
 */
const assert = Object.assign(
  function (...args) { return baseAssert(...args); },
  baseAssert,
  {
    near(a, b, why, tol = 1e-6) {
      baseAssert.ok(Math.abs(a - b) < tol, `${why}: ${a} vs ${b}`);
    },
  },
);

/* ------------------------------------------------------------------ opening */

describe("opening a document", () => {
  test("it starts fitted, so the whole drawing is visible", () => {
    const v = drawing();
    const t = transform(v);
    assert.equal(t.fitted, true);
    assert.ok(t.w <= 800 + 1e-9 && t.h <= 600 + 1e-9, "the page is inside the pane");
    assert.near(t.w, 800, "the limiting side touches the pane");
  });

  test("it is centred on the axis with room to spare", () => {
    const v = drawing();
    const t = transform(v);
    assert.near(t.x, 0, "no room across");
    assert.near(t.y, (600 - t.h) / 2, "centred down the page");
  });

  test("fitted means fitted, not a number that was right once", () => {
    /* The distinction that matters when a pane is resized: a viewer holding
       the old scale shows a drawing that no longer fits and nobody asked it
       to stop fitting. */
    const v = resize(drawing(), { w: 1600, h: 1200 });
    assert.equal(transform(v).fitted, true);
    assert.near(transform(v).w, 1600, "it re-fitted to the new pane");
  });

  test("a document with no pages is refused rather than shown empty", () => {
    assert.throws(() => open({ pages: [] }, { w: 10, h: 10 }), /no pages/);
  });

  test("a pane with no size is refused, because every scale would divide by it", () => {
    assert.throws(() => open({ pages: [{ w: 10, h: 10 }] }, { w: 0, h: 10 }), /no size/);
  });
});

/* ---------------------------------------------------- the coordinate round trip */

describe("a region belongs to the document, not to the screen", () => {
  test("screen to document and back returns the same point, at every rotation", () => {
    /* The property the confirmation queue rests on. If this drifts, a stored
       crop slowly stops pointing at the value it was taken from. */
    for (const t of TURNS) {
      let v = turn(drawing(), t);
      v = zoomTo(v, 2);
      v = pan(v, -120, -80);
      for (const p of [{ x: 0, y: 0 }, { x: 400, y: 300 }, { x: 799, y: 599 }]) {
        const back = toViewport(v, toDocument(v, p));
        assert.near(back.x, p.x, `x at ${t}°`, 1e-6);
        assert.near(back.y, p.y, `y at ${t}°`, 1e-6);
      }
    }
  });

  test("a quarter turn actually turns it — the corners move where they should", () => {
    /* Asserting the round trip alone would pass for an implementation that
       ignored rotation entirely, so this pins the direction. */
    const v = turn(open({ pages: [{ w: 100, h: 50 }] }, { w: 200, h: 200 }), 90);
    const topLeft = toViewport(v, { x: 0, y: 0 });
    const bottomLeft = toViewport(v, { x: 0, y: 50 });
    assert.ok(topLeft.x > bottomLeft.x, "the document's top-left is now to the right");
  });

  test("a turn swaps the sides, and the fit changes with them", () => {
    const flat = drawing();
    const onEnd = turn(flat, 90);
    assert.deepEqual(rotated(onEnd), { w: 1754, h: 2480 });
    assert.ok(fitScale(onEnd) < fitScale(flat), "a tall page fits a wide pane less well");
  });

  test("four quarter turns come back to where it started", () => {
    let v = drawing();
    for (let i = 0; i < 4; i++) v = turn(v, 90);
    assert.equal(v.turn, 0);
  });

  test("turning backwards does not produce a negative rotation", () => {
    assert.equal(turn(drawing(), -90).turn, 270);
  });

  test("a stored region is found again after the view has moved", () => {
    /* Zoom, turn, pan — and the crop still covers the same part of the
       drawing. This is the behaviour the whole module exists for. */
    const v = drawing();
    const r = region(v, { x: 300, y: 200 }, { x: 420, y: 260 });

    let moved = pan(zoomTo(turn(v, 180), 3), -200, -150);
    const box = regionOnScreen(moved, r);
    const corner = toDocument(moved, { x: box.x, y: box.y });
    const far = toDocument(moved, { x: box.x + box.w, y: box.y + box.h });

    assert.near(Math.min(corner.x, far.x), r.x, "the region still starts where it did", 1e-6);
    assert.near(Math.abs(far.x - corner.x), r.w, "and is the same width", 1e-6);
  });

  test("a region on another page is not drawn on this one", () => {
    const r = region(twoPages(), { x: 10, y: 10 }, { x: 50, y: 50 });
    assert.equal(regionOnScreen(nextPage(twoPages()), r), null);
  });

  test("a drag off the edge of the page is clipped to the page", () => {
    /* Half of the drag was over the grey surround, and a region that is partly
       nowhere is not a source crop. */
    const v = drawing();
    const r = region(v, { x: -500, y: -500 }, { x: 5000, y: 5000 });
    assert.equal(r.x, 0);
    assert.equal(r.y, 0);
    assert.equal(r.w, 2480);
    assert.equal(r.h, 1754);
  });

  test("a stray click is not a selection", () => {
    const v = drawing();
    assert.equal(isDeliberate(region(v, { x: 100, y: 100 }, { x: 100, y: 100 })), false);
    assert.equal(isDeliberate(region(v, { x: 100, y: 100 }, { x: 300, y: 200 })), true);
  });

  test("a region is normalised, however the drag was made", () => {
    const v = drawing();
    const down = region(v, { x: 100, y: 100 }, { x: 300, y: 250 });
    const up = region(v, { x: 300, y: 250 }, { x: 100, y: 100 });
    assert.deepEqual(down, up, "dragging up-left records the same rectangle");
    assert.ok(down.w > 0 && down.h > 0, "and never a negative one");
  });
});

/* ------------------------------------------------------------------ panning */

describe("the drawing cannot be lost off the screen", () => {
  test("panning stops at the edge rather than letting it slide away", () => {
    const v = pan(zoomTo(drawing(), 4), 100000, 100000);
    const t = transform(v);
    assert.ok(t.x <= 0 + 1e-9, "the left edge never comes inside the pane");
    assert.ok(t.y <= 0 + 1e-9, "nor the top");
  });

  test("and at the far edge in the other direction", () => {
    const v = pan(zoomTo(drawing(), 4), -100000, -100000);
    const t = transform(v);
    assert.near(t.x + t.w, 800, "the right edge stops at the right of the pane");
    assert.near(t.y + t.h, 600, "and the bottom at the bottom");
  });

  test("an axis with room to spare stays centred and does not drift", () => {
    const v = drawing();
    const before = transform(v).y;
    const after = transform(pan(v, 0, 300)).y;
    assert.near(after, before, "a page smaller than the pane does not move down it");
  });

  test("a pan within the bounds moves by exactly what was asked", () => {
    const v = zoomTo(drawing(), 4);
    const before = transform(v).x;
    assert.near(transform(pan(v, -50, 0)).x, before - 50, "it moved fifty pixels");
  });
});

/* -------------------------------------------------------------------- zoom */

describe("zoom", () => {
  test("it steps through the stops, so in-and-out returns to where it was", () => {
    const v = zoomTo(drawing(), 1);
    assert.near(scaleOf(zoomIn(v)), 1.5, "the next stop up");
    assert.near(scaleOf(zoomOut(zoomIn(v))), 1, "and back down to the same place");
  });

  test("zooming holds the point under the cursor still", () => {
    /* Otherwise you zoom into a tolerance callout and arrive somewhere else. */
    const v = zoomTo(drawing(), 1);
    const at = { x: 250, y: 180 };
    const under = toDocument(v, at);
    const after = toDocument(zoomIn(v, at), at);
    assert.near(after.x, under.x, "the same document x is under the cursor", 1e-6);
    assert.near(after.y, under.y, "and the same y", 1e-6);
  });

  test("it will not zoom past the last stop", () => {
    let v = drawing();
    for (let i = 0; i < 40; i++) v = zoomIn(v);
    assert.near(scaleOf(v), STOPS[STOPS.length - 1], "it stops at the top of the ladder");
  });

  test("a large drawing can still zoom out to fit, below the smallest stop", () => {
    /* A3 at 150dpi in an 800px pane fits at about 0.32, and the smallest stop
       is 0.25 — but a bigger drawing fits below that, and a floor of 0.25
       would make "see all of it" unreachable by zooming out. */
    const big = open({ pages: [{ w: 20000, h: 14000 }] }, { w: 800, h: 600 });
    let v = big;
    for (let i = 0; i < 40; i++) v = zoomOut(v);
    assert.near(scaleOf(v), fitScale(big), "zooming out all the way reaches the fit");
    assert.ok(fitScale(big) < STOPS[0], "which is below the smallest stop");
  });

  test("actual size is one document pixel per screen pixel", () => {
    assert.near(scaleOf(actual(drawing())), 1);
  });

  test("fit goes back to showing all of it", () => {
    const v = fit(zoomTo(drawing(), 8));
    assert.equal(transform(v).fitted, true);
    assert.near(scaleOf(v), fitScale(v));
  });

  test("zooming out far enough re-centres rather than leaving it stuck to an edge", () => {
    const v = fit(pan(zoomTo(drawing(), 8), -3000, -3000));
    const t = transform(v);
    assert.near(t.y, (600 - t.h) / 2, "centred again");
  });
});

/* ------------------------------------------------------------------- pages */

describe("pages", () => {
  test("it moves between them and stops at both ends", () => {
    let v = twoPages();
    assert.equal(v.page, 0);
    assert.equal(prevPage(v).page, 0, "there is no page before the first");
    v = nextPage(v);
    assert.equal(v.page, 1);
    assert.equal(nextPage(v).page, 1, "nor after the last");
  });

  test("a page of a different size is fitted to itself, not to the last one", () => {
    const one = twoPages(), two = nextPage(one);
    assert.deepEqual(contentSize(two).w <= 400 && contentSize(two).h <= 400, true);
    assert.notEqual(fitScale(one), fitScale(two));
  });

  test("zoom and rotation survive a page turn", () => {
    /* Two pages of one scan are usually the same drawing, and re-fitting on
       every turn makes comparing the same corner across them into work. */
    const v = goToPage(zoomTo(turn(twoPages(), 90), 2), 1);
    assert.near(scaleOf(v), 2);
    assert.equal(v.turn, 90);
  });

  test("a nonsense page number lands somewhere real", () => {
    assert.equal(goToPage(twoPages(), 99).page, 1);
    assert.equal(goToPage(twoPages(), -5).page, 0);
    assert.equal(goToPage(twoPages(), NaN).page, 0);
  });
});

/* --------------------------------------------------------------- the moves */

describe("every move leaves a usable view", () => {
  test("no sequence of moves puts the page outside the pane", () => {
    /* Rather than trusting each operation separately: clamping is applied by
       whoever changes the geometry, and one path forgetting it is exactly the
       bug this catches. */
    let v = drawing();
    const moves = [
      (x) => zoomIn(x), (x) => turn(x, 90), (x) => pan(x, -900, -400),
      (x) => zoomOut(x), (x) => nextPage(x), (x) => resize(x, { w: 300, h: 900 }),
      (x) => pan(x, 700, 900), (x) => turn(x, -90), (x) => actual(x), (x) => fit(x),
    ];
    for (const move of moves) {
      v = move(v);
      const t = transform(v);
      const inBounds = t.w <= v.viewport.w
        ? Math.abs(t.x - (v.viewport.w - t.w) / 2) < 1e-6
        : t.x <= 1e-9 && t.x + t.w >= v.viewport.w - 1e-9;
      assert.ok(inBounds, `a move left the page out of bounds: x=${t.x} w=${t.w}`);
      assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y), "the view became unreadable");
    }
  });

  test("nothing mutates the state it was given", () => {
    const v = drawing();
    const before = JSON.stringify(v);
    [zoomIn, fit, actual, nextPage, (x) => turn(x, 90), (x) => pan(x, 10, 10)]
      .forEach((f) => f(v));
    assert.equal(JSON.stringify(v), before, "a move changed the view it was passed");
  });
});
