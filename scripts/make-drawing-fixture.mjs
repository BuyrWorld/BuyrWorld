/**
 * A synthetic drawing, drawn from nothing.
 *
 * The v5 pack's fixtures were made with Pillow. There is no Python here and
 * no dependencies to add one, so this draws a PNG with `zlib` and a bitmap
 * font defined below — which turns out to be the better answer anyway: the
 * fixture is reproducible from a file somebody can read, and what it claims
 * to say is a few lines above the code that draws it rather than a fact about
 * a binary nobody can open.
 *
 * What it exists to test is the distinction `specs/03` asks for and the live
 * reader got wrong: *"Distinguish explicitly marked tolerances from a general
 * title-block tolerance."* Reading the pack's `clear.jpg`, the model took the
 * title-block tolerance and attached it to the length. The evidence check
 * caught it, because the quote it gave did not contain the tolerance — but
 * that drawing cannot tell a working general-tolerance path from a broken
 * one, because it has no dimension carrying a tolerance of its own.
 *
 * So this one has all three cases on one sheet:
 *
 *   - a dimension with a tolerance printed against it     (THICKNESS)
 *   - dimensions with none                                (LENGTH, WIDTH)
 *   - a general tolerance in the title block              (ISO 2768-m)
 *
 * A correct reading attaches the first to THICKNESS, leaves the second two
 * null, and reports the third once as generalTolerance. Any other shape is a
 * failure this can name.
 *
 * It is fictional. It carries no real part, supplier or specification, it
 * says so on its face, and it is committed to a public repository — so
 * "SYNTHETIC" is on the drawing rather than only in a README.
 *
 * Run: node scripts/make-drawing-fixture.mjs
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

/* --------------------------------------------------------------- the font */

/**
 * A 5×7 bitmap font, written as pictures of the letters.
 *
 * Hex would be shorter and unreviewable. Somebody checking whether the
 * fixture really says "2768" should be able to see the 2 in this file.
 */
const GLYPHS = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "01100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  "*": ["00000", "10101", "01110", "11111", "01110", "10101", "00000"],
  "#": ["01010", "11111", "01010", "01010", "01010", "11111", "01010"],
};

const GLYPH_W = 5;
const GLYPH_H = 7;

/* ------------------------------------------------------------- the canvas */

/** A greyscale canvas. 255 is white, 0 is black. */
function canvas(width, height) {
  const px = new Uint8Array(width * height).fill(255);
  return { width, height, px };
}

const set = (c, x, y, v) => {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
  c.px[y * c.width + x] = v;
};

/** One character, scaled up. */
function glyph(c, ch, x, y, scale, ink) {
  const rows = GLYPHS[ch] ?? GLYPHS["#"];
  for (let gy = 0; gy < GLYPH_H; gy++) {
    for (let gx = 0; gx < GLYPH_W; gx++) {
      if (rows[gy][gx] !== "1") continue;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) set(c, x + gx * scale + sx, y + gy * scale + sy, ink);
      }
    }
  }
}

/** A line of text. Returns where the next one would start. */
function text(c, said, x, y, scale = 3, ink = 0) {
  const step = (GLYPH_W + 1) * scale;
  let at = x;
  for (const ch of String(said).toUpperCase()) {
    glyph(c, ch, at, y, scale, ink);
    at += step;
  }
  return y + (GLYPH_H + 3) * scale;
}

const width = (said, scale) => String(said).length * (GLYPH_W + 1) * scale;

function rect(c, x, y, w, h, ink = 0, thickness = 2) {
  for (let t = 0; t < thickness; t++) {
    for (let i = 0; i <= w; i++) { set(c, x + i, y + t, ink); set(c, x + i, y + h - t, ink); }
    for (let i = 0; i <= h; i++) { set(c, x + t, y + i, ink); set(c, x + w - t, y + i, ink); }
  }
}

function line(c, x1, y1, x2, y2, ink = 0, thickness = 2) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x1 + ((x2 - x1) * i) / steps);
    const y = Math.round(y1 + ((y2 - y1) * i) / steps);
    for (let t = 0; t < thickness; t++) set(c, x, y + t, ink);
  }
}

/* ---------------------------------------------------------------- the PNG */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Eight-bit greyscale, which is all a line drawing needs. */
function toPng(c) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.width, 0);
  ihdr.writeUInt32BE(c.height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 0;   // greyscale
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace

  const raw = Buffer.alloc((c.width + 1) * c.height);
  for (let y = 0; y < c.height; y++) {
    raw[y * (c.width + 1)] = 0;   // filter: none
    Buffer.from(c.px.subarray(y * c.width, (y + 1) * c.width))
      .copy(raw, y * (c.width + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------ the drawing */

/**
 * What the sheet says, in one place.
 *
 * The ground-truth file is written from this object, so the expectation and
 * the drawing cannot disagree — a fixture whose answer key drifts from the
 * picture is worse than no fixture.
 */
export const SHEET = Object.freeze({
  partNumber: "SYN-BRK-2100",
  material: "SYNTHETIC ALLOY 6082",
  condition: "AS MACHINED",
  dimensions: Object.freeze([
    Object.freeze({ field: "length", label: "LENGTH", value: "120.00", unit: "MM", tolerance: null }),
    Object.freeze({ field: "width", label: "WIDTH", value: "64.00", unit: "MM", tolerance: null }),
    Object.freeze({ field: "thickness", label: "THICKNESS", value: "12.00", unit: "MM",
                    tolerance: "+/-0.05" }),
  ]),
  generalTolerance: "ISO 2768-M",
});

export function draw() {
  const c = canvas(1100, 860);

  /* A border and a part outline, so it reads as a drawing rather than a list. */
  rect(c, 12, 12, c.width - 24, c.height - 24, 0, 3);

  const bx = 90, by = 150, bw = 520, bh = 240;
  rect(c, bx, by, bw, bh, 0, 3);
  /* A dimension line under the part, clear of the text below it. Two sheets
     of this kind have already been drawn with the line running through the
     first line of text, which is legible to a person and exactly the sort of
     thing that makes a reader's job harder for no reason. */
  line(c, bx, by + bh + 40, bx + bw, by + bh + 40);
  line(c, bx, by + bh + 20, bx, by + bh + 60);
  line(c, bx + bw, by + bh + 20, bx + bw, by + bh + 60);

  text(c, "SYNTHETIC DRAWING - NOT FOR MANUFACTURE", 40, 45, 3);
  text(c, "NO REAL PART, SUPPLIER OR SPECIFICATION", 40, 85, 2);

  /* The dimensions. The tolerance is printed on the same line as the
     dimension it governs, which is the whole point of the fixture. */
  let y = 490;
  for (const d of SHEET.dimensions) {
    const said = d.tolerance
      ? `${d.label}: ${d.value} ${d.tolerance} ${d.unit}`
      : `${d.label}: ${d.value} ${d.unit}`;
    y = text(c, said, 90, y, 3);
  }

  y = text(c, `MATERIAL: ${SHEET.material}`, 90, y + 10, 3);
  y = text(c, `FINISH: ${SHEET.condition}`, 90, y, 3);

  /* The title block, bottom right, well away from the dimensions. A general
     tolerance belongs here and nowhere near a dimension line. */
  const tw = 430, th = 150;
  const tx = c.width - tw - 40, ty = c.height - th - 40;
  /* Well below the dimensions and the material line, so nothing overlaps it.
     A title block drawn over the text it is meant to be distinct from would
     defeat the fixture's whole purpose. */
  rect(c, tx, ty, tw, th, 0, 3);
  line(c, tx, ty + 46, tx + tw, ty + 46);

  text(c, "TITLE BLOCK", tx + 14, ty + 14, 3);
  text(c, `DRAWING NO: ${SHEET.partNumber}`, tx + 14, ty + 60, 2);
  text(c, `GENERAL TOLERANCE: ${SHEET.generalTolerance}`, tx + 14, ty + 92, 2);
  text(c, "UNLESS OTHERWISE STATED", tx + 14, ty + 118, 2);

  return c;
}

/** The answer key, derived from the same object the drawing is. */
export function groundTruth() {
  return {
    id: "general-tolerance.png",
    note: "Synthetic. Tests the distinction specs/03 asks for: a tolerance marked against "
        + "one dimension, two dimensions with none, and a general tolerance in the title "
        + "block. A correct reading attaches the first to thickness, leaves the other two "
        + "null, and reports the third once as generalTolerance.",
    expected: {
      partNumber: { value: SHEET.partNumber, unit: null, tolerance: null },
      material: { value: SHEET.material, unit: null, tolerance: null },
      condition: { value: SHEET.condition, unit: null, tolerance: null },
      ...Object.fromEntries(SHEET.dimensions.map((d) => [d.field, {
        value: d.value, unit: "mm", tolerance: d.tolerance,
      }])),
      generalTolerance: { value: SHEET.generalTolerance, unit: null, tolerance: null },
    },
  };
}

/* ------------------------------------------------------------------ main */

if (process.argv[1] && process.argv[1].endsWith("make-drawing-fixture.mjs")) {
  mkdirSync("fixtures/drawings", { recursive: true });
  const png = toPng(draw());
  writeFileSync("fixtures/drawings/general-tolerance.png", png);
  writeFileSync("fixtures/drawings/general-tolerance.json",
    `${JSON.stringify(groundTruth(), null, 2)}\n`);
  console.log(`fixtures/drawings/general-tolerance.png — ${(png.length / 1024).toFixed(1)}KB`);
  console.log("fixtures/drawings/general-tolerance.json — answer key");
}

export { toPng, canvas, text, GLYPHS };
