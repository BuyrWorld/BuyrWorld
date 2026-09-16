/**
 * The top view as DXF, which is a thing this can actually be right about.
 *
 * The pack is blunt about the trap: *"Potential export formats such as STEP
 * for a supported solid model, DXF for supported 2D geometry and PDF for a
 * review sheet must be verified against the chosen implementation. Do not
 * advertise a format merely because its extension is easy to generate."*
 *
 * So: what can this repository be right about without a kernel?
 *
 * **A DXF top view, exactly.** The supported geometry is a rectangular
 * outline, circular through-holes and rectangular pockets. Every one of those
 * is a DXF primitive — LINE and CIRCLE — at integer micrometre precision. The
 * file is not an approximation of the model; it is the model's plan, and a
 * test parses it back and checks every coordinate against the geometry it came
 * from.
 *
 * **A STEP solid, not at all.** A block with through-holes could be written as
 * an extruded profile with inner boundaries, but a blind pocket cannot: it
 * needs a boolean subtraction, and that needs a kernel. Emitting STEP for the
 * parts that happen to be expressible and quietly dropping the pockets would
 * produce a file that opens cleanly and describes a different part. That is a
 * worse outcome than having no STEP at all, so there is none, and
 * `review-export.mjs` says why by name.
 *
 * It is not a dimensioned drawing, and the package repeats that wherever it
 * offers the file. There are no dimensions, no tolerances, no annotations and
 * no title block; it is geometry. The requirement schedule remains the
 * authoritative record of what the part must satisfy.
 */

import { FEATURE } from "./geometry.mjs";

/** DXF's unit code for millimetres, so a reader does not have to guess. */
const INSUNITS_MM = 4;

export const DXF_LAYERS = Object.freeze({
  OUTLINE: "PART-OUTLINE",
  HOLES: "HOLES",
  POCKETS: "POCKETS",
});

/**
 * Micrometres to a millimetre decimal, exactly.
 *
 * Never `Number(um) / 1000`: that is float division on a dimension, and this
 * repository does not do that even for a file somebody else will read. Three
 * decimal places hold a micrometre exactly and nothing is rounded.
 */
export function umToMm(um) {
  const n = BigInt(um);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = abs / 1000n;
  const frac = String(abs % 1000n).padStart(3, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/* A DXF group: a code on one line, its value on the next. */
const g = (code, value) => `${code}\n${value}`;

function line(layer, x1, y1, x2, y2) {
  return [
    g(0, "LINE"), g(8, layer),
    g(10, umToMm(x1)), g(20, umToMm(y1)), g(30, "0.000"),
    g(11, umToMm(x2)), g(21, umToMm(y2)), g(31, "0.000"),
  ].join("\n");
}

function circle(layer, cx, cy, r) {
  return [
    g(0, "CIRCLE"), g(8, layer),
    g(10, umToMm(cx)), g(20, umToMm(cy)), g(30, "0.000"),
    g(40, umToMm(r)),
  ].join("\n");
}

/** The four sides of an axis-aligned rectangle, as separate lines. */
function rectangle(layer, x, y, w, h) {
  return [
    line(layer, x, y, x + w, y),
    line(layer, x + w, y, x + w, y + h),
    line(layer, x + w, y + h, x, y + h),
    line(layer, x, y + h, x, y),
  ];
}

/**
 * The model's plan view, as DXF R12.
 *
 * R12 on purpose: it is the most widely readable version there is, and this
 * geometry needs nothing later. A newer version would buy features this cannot
 * use and readers it cannot count on.
 */
export function toDxf(model) {
  if (!model || typeof model.widthUm !== "bigint" || typeof model.lengthUm !== "bigint") {
    throw new TypeError("A DXF needs a model with a width and a length in micrometres.");
  }
  if (model.widthUm <= 0n || model.lengthUm <= 0n) {
    throw new RangeError("A DXF needs positive dimensions.");
  }

  const entities = [
    /* The outline, from the origin the model states: the bottom-left corner of
       the top face. A DXF whose origin differs from the model's is a drawing
       of the right shape in the wrong place. */
    ...rectangle(DXF_LAYERS.OUTLINE, 0n, 0n, model.widthUm, model.lengthUm),
  ];

  for (const f of model.features) {
    if (f.kind === FEATURE.HOLE) {
      entities.push(circle(DXF_LAYERS.HOLES, f.xUm, f.yUm, f.diameterUm / 2n));
    } else {
      /* A pocket is drawn as its opening. Its depth is not in a plan view and
         is not implied by one — it is in the schedule, with everything else
         about the part that a shape cannot carry. */
      entities.push(...rectangle(DXF_LAYERS.POCKETS, f.xUm, f.yUm, f.widthUm, f.lengthUm));
    }
  }

  return [
    /* Units declared rather than assumed. A DXF with no $INSUNITS is a set of
       numbers whose scale the reader has to guess, and guessing wrong on a
       part is the expensive kind of wrong. */
    g(0, "SECTION"), g(2, "HEADER"),
    g(9, "$INSUNITS"), g(70, INSUNITS_MM),
    g(0, "ENDSEC"),

    g(0, "SECTION"), g(2, "ENTITIES"),
    ...entities,
    g(0, "ENDSEC"),

    g(0, "EOF"),
  ].join("\n") + "\n";
}

/* ------------------------------------------------------------- reading it */

/**
 * Read a DXF back into the shapes it describes.
 *
 * Here rather than only in the tests, because `acceptance/PART-REVIEW-CHECKS.md`
 * asks that exported files be "checked with a suitable parser/reader for actual
 * dimensions, units, placement and geometry validity" — and a check that lives
 * only in a test proves the test, not the export. The export can verify itself
 * before anyone downloads it.
 */
export function readDxf(text) {
  const lines = String(text).split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push([lines[i].trim(), lines[i + 1].trim()]);
  }

  let units = null;
  const entities = [];
  let current = null;

  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i];

    if (code === "9" && value === "$INSUNITS") {
      const next = pairs[i + 1];
      if (next && next[0] === "70") units = Number(next[1]);
      continue;
    }

    if (code === "0") {
      if (current) entities.push(current);
      current = (value === "LINE" || value === "CIRCLE") ? { type: value } : null;
      continue;
    }
    if (!current) continue;

    if (code === "8") current.layer = value;
    else if (code === "10") current.x = value;
    else if (code === "20") current.y = value;
    else if (code === "11") current.x2 = value;
    else if (code === "21") current.y2 = value;
    else if (code === "40") current.r = value;
  }
  if (current) entities.push(current);

  return Object.freeze({
    units,
    millimetres: units === INSUNITS_MM,
    entities: Object.freeze(entities.map(Object.freeze)),
    circles: Object.freeze(entities.filter((e) => e.type === "CIRCLE")),
    lines: Object.freeze(entities.filter((e) => e.type === "LINE")),
  });
}

/**
 * Does the DXF describe the model it claims to?
 *
 * Run before the file is offered, so a package never carries a drawing that
 * disagrees with its own schedule.
 */
export function checkDxf(text, model) {
  const read = readDxf(text);
  const problems = [];

  if (!read.millimetres) problems.push("The file does not declare millimetres.");

  const holes = model.features.filter((f) => f.kind === FEATURE.HOLE);
  if (read.circles.length !== holes.length) {
    problems.push(`${holes.length} hole(s) on the part and ${read.circles.length} circle(s) in the file.`);
  }
  for (const h of holes) {
    const want = { x: umToMm(h.xUm), y: umToMm(h.yUm), r: umToMm(h.diameterUm / 2n) };
    const found = read.circles.some((c) => c.x === want.x && c.y === want.y && c.r === want.r);
    if (!found) problems.push(`${h.id} is not in the file at ${want.x}, ${want.y}.`);
  }

  const pockets = model.features.filter((f) => f.kind === FEATURE.POCKET);
  const expectedLines = 4 + pockets.length * 4;
  if (read.lines.length !== expectedLines) {
    problems.push(`Expected ${expectedLines} line(s) — one outline and ${pockets.length} pocket(s) — and found ${read.lines.length}.`);
  }

  return Object.freeze({ ok: problems.length === 0, problems: Object.freeze(problems) });
}
