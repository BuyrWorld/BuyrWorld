/**
 * Looking at the document.
 *
 * `specs/03-FILE-INTELLIGENCE.md`: *"Show original document immediately when
 * locally previewable, with pages, zoom, pan, rotate, fit and selectable
 * regions."*
 *
 * This is the half of reading a drawing that works with no reader at all, and
 * it is most of the value: somebody who can see the drawing large enough to
 * read it can type what it says. That is why an image is shown rather than
 * refused.
 *
 * Everything here is arithmetic on a view, kept out of the page so it can be
 * tested. Two properties are the ones worth having:
 *
 *   - **A region belongs to the document, not to the screen.** The
 *     confirmation queue stores where on the page a value was found, and that
 *     must still point at the same characters after the drawing has been
 *     zoomed, panned and turned. So screen coordinates convert to document
 *     coordinates and back, and the round trip returns what it started with.
 *   - **The drawing cannot be lost.** Panning stops at the edges instead of
 *     letting the page slide out of view, which is the usual way a viewer
 *     ends up looking broken.
 *
 * Floating point is deliberate and fine here: this is a view transform, not
 * money. `src/calc/` is where that rule lives.
 */

/** Rotations offered. Quarter turns only — anything else is a tilted scan. */
export const TURNS = Object.freeze([0, 90, 180, 270]);

/**
 * Zoom stops, as multiples of the document's own pixels.
 *
 * A ladder rather than free scaling: a fixed set of stops means clicking in
 * twice and back out twice returns to where you were, which continuous zoom
 * does not.
 */
export const STOPS = Object.freeze([0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8]);

/**
 * Open a document for viewing.
 *
 * @param {object} doc       { pages: [{w,h}, …] } in document units
 * @param {object} viewport  { w, h } in CSS pixels
 */
export function open(doc, viewport) {
  const pages = (doc?.pages ?? []).map((p) => ({ w: Number(p.w) || 0, h: Number(p.h) || 0 }));
  if (pages.length === 0) throw new Error("a document with no pages cannot be viewed");
  if (!(viewport?.w > 0) || !(viewport?.h > 0)) throw new Error("the viewport has no size");

  return centred({
    pages,
    viewport: { w: viewport.w, h: viewport.h },
    page: 0,
    turn: 0,
    /* null means "fit", which is a different thing from whatever number fit
       currently works out to: the view stays fitted when the pane is resized,
       rather than keeping a scale that was right for the old size. */
    scale: null,
    panX: 0, panY: 0,
  });
}

/* ------------------------------------------------------------ the geometry */

/** The page as it sits after rotation — a quarter turn swaps the sides. */
export function rotated(s) {
  const p = s.pages[s.page];
  return s.turn % 180 === 0 ? { w: p.w, h: p.h } : { w: p.h, h: p.w };
}

/** The scale at which the whole page is visible. */
export function fitScale(s) {
  const r = rotated(s);
  if (!(r.w > 0) || !(r.h > 0)) return 1;
  return Math.min(s.viewport.w / r.w, s.viewport.h / r.h);
}

/** The scale actually in force — `null` means fitted. */
export const scaleOf = (s) => (s.scale === null ? fitScale(s) : s.scale);

/** The rendered size of the page, in screen pixels. */
export function contentSize(s) {
  const r = rotated(s), k = scaleOf(s);
  return { w: r.w * k, h: r.h * k };
}

/**
 * Pan, clamped.
 *
 * Smaller than the pane on an axis: centred, and that axis does not move — a
 * drawing that drifts off-centre when there is room for it looks like a fault.
 * Larger: bounded so an edge can never come inside the pane, which is what
 * stops the page being lost off-screen entirely.
 */
export function clamp(s, x, y) {
  const c = contentSize(s);
  const one = (size, available, v) =>
    size <= available ? (available - size) / 2 : Math.min(0, Math.max(available - size, v));
  return { panX: one(c.w, s.viewport.w, x), panY: one(c.h, s.viewport.h, y) };
}

/** Centred within the pane, or hard against the edges if it is larger. */
function centred(s) {
  const c = contentSize(s);
  return { ...s, ...clamp(s, (s.viewport.w - c.w) / 2, (s.viewport.h - c.h) / 2) };
}

/** Where a document point lands on screen. */
export function toViewport(s, { x, y }) {
  const p = s.pages[s.page], k = scaleOf(s);
  let rx, ry;
  switch (s.turn) {
    case 90:  rx = p.h - y; ry = x;       break;
    case 180: rx = p.w - x; ry = p.h - y; break;
    case 270: rx = y;       ry = p.w - x; break;
    default:  rx = x;       ry = y;
  }
  return { x: rx * k + s.panX, y: ry * k + s.panY };
}

/** And back — the inverse, which is what turns a drag into a region. */
export function toDocument(s, { x, y }) {
  const p = s.pages[s.page], k = scaleOf(s);
  const rx = (x - s.panX) / k, ry = (y - s.panY) / k;
  switch (s.turn) {
    case 90:  return { x: ry,       y: p.h - rx };
    case 180: return { x: p.w - rx, y: p.h - ry };
    case 270: return { x: p.w - ry, y: rx };
    default:  return { x: rx,       y: ry };
  }
}

/* --------------------------------------------------------------- the moves */

/** Move the page under the pointer, within the bounds. */
export const pan = (s, dx, dy) => ({ ...s, ...clamp(s, s.panX + dx, s.panY + dy) });

/**
 * Zoom, holding one point still.
 *
 * Without a focus, zooming walks the thing you were looking at off the screen
 * — you zoom into a tolerance callout and arrive somewhere else entirely.
 */
export function zoomTo(s, scale, focus) {
  const floor = Math.min(STOPS[0], fitScale(s));
  const next = Math.max(floor, Math.min(STOPS[STOPS.length - 1], scale));
  const at = focus ?? { x: s.viewport.w / 2, y: s.viewport.h / 2 };
  const held = toDocument(s, at);

  const zoomed = { ...s, scale: next };
  const after = toViewport({ ...zoomed, panX: 0, panY: 0 }, held);
  return { ...zoomed, ...clamp(zoomed, at.x - after.x, at.y - after.y) };
}

export const zoomIn = (s, focus) =>
  zoomTo(s, STOPS.find((v) => v > scaleOf(s) + 1e-9) ?? STOPS[STOPS.length - 1], focus);

export const zoomOut = (s, focus) =>
  zoomTo(s, [...STOPS].reverse().find((v) => v < scaleOf(s) - 1e-9)
            ?? Math.min(STOPS[0], fitScale(s)), focus);

/** Back to seeing all of it. */
export const fit = (s) => centred({ ...s, scale: null });

/** One document pixel per screen pixel — what "actual size" means. */
export const actual = (s) => zoomTo(s, 1);

/**
 * A quarter turn.
 *
 * Fitted stays fitted, because the fit changes when the sides swap and a
 * portrait page turned sideways should still be wholly visible.
 */
export function turn(s, by) {
  return centred({ ...s, turn: (((s.turn + by) % 360) + 360) % 360 });
}

/**
 * Another page.
 *
 * Zoom and rotation are kept. Two pages of one scan are usually the same
 * drawing, and re-fitting on every page turn makes comparing the same corner
 * across pages into work.
 */
export function goToPage(s, n) {
  const page = Math.max(0, Math.min(s.pages.length - 1, Math.trunc(Number(n) || 0)));
  return centred({ ...s, page });
}

export const nextPage = (s) => goToPage(s, s.page + 1);
export const prevPage = (s) => goToPage(s, s.page - 1);

/** The pane changed size — stay fitted if fitted, stay in bounds either way. */
export const resize = (s, viewport) =>
  centred({ ...s, viewport: { w: viewport.w, h: viewport.h } });

/* ---------------------------------------------------------------- selection */

/**
 * The rectangle a drag covers, in document coordinates.
 *
 * Stored against the document so it still marks the same characters after the
 * view moves — that is what makes a source crop worth keeping at all. Clipped
 * to the page, because a drag that starts on the drawing and ends on the grey
 * surround would otherwise record a region that is partly nowhere.
 */
export function region(s, from, to) {
  const a = toDocument(s, from), b = toDocument(s, to);
  const p = s.pages[s.page];
  const clip = (v, max) => Math.max(0, Math.min(max, v));
  const x1 = clip(Math.min(a.x, b.x), p.w), x2 = clip(Math.max(a.x, b.x), p.w);
  const y1 = clip(Math.min(a.y, b.y), p.h), y2 = clip(Math.max(a.y, b.y), p.h);
  return { page: s.page, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Whether a selection is big enough to have been meant rather than a stray click. */
export const isDeliberate = (r) => r.w >= 4 && r.h >= 4;

/** A stored region drawn back onto the screen, wherever the view is now. */
export function regionOnScreen(s, r) {
  if (r.page !== s.page) return null;
  const corners = [
    toViewport(s, { x: r.x, y: r.y }), toViewport(s, { x: r.x + r.w, y: r.y }),
    toViewport(s, { x: r.x, y: r.y + r.h }), toViewport(s, { x: r.x + r.w, y: r.y + r.h }),
  ];
  const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
  return {
    x: Math.min(...xs), y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
  };
}

/** What to hand CSS. */
export function transform(s) {
  const c = contentSize(s);
  return {
    scale: scaleOf(s), turn: s.turn,
    x: s.panX, y: s.panY, w: c.w, h: c.h,
    fitted: s.scale === null,
    page: s.page, pages: s.pages.length,
  };
}
