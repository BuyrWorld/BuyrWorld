/**
 * What is this file, actually?
 *
 * `specs/03-FILE-INTELLIGENCE.md` route 1: *"Sniff bytes/MIME and decode,
 * comparing extension. Reject unsafe/corrupt input with a specific
 * explanation; don't rely on extension alone."*
 *
 * The v5 gap matrix diagnoses the current defect precisely: the input accepts
 * only `.pdf` and the handler *separately* rejects anything else by filename,
 * so widening the input alone would still fail. Deciding by bytes is what
 * makes both fixable at once.
 *
 * These run against the pack's own fixtures, which is the point of shipping
 * them — `png-renamed.jpg` exists to catch exactly the habit of believing a
 * name.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

import {
  identify, nextStep, withinLimits, HANDLING, LIMITS, HEAD_BYTES,
} from "../../src/intake/file-router.mjs";

const FIXTURES = "design-handoff/BuyrWorld-v5/fixtures";
const havePack = existsSync(FIXTURES);

/** The first bytes of a fixture, as a browser would read them. */
const head = (name) =>
  new Uint8Array(readFileSync(`${FIXTURES}/${name}`)).slice(0, HEAD_BYTES);

/** A made-up file with a given signature, for the cases the pack has no fixture for. */
const bytesOf = (...prefix) => new Uint8Array([...prefix, 0, 1, 2, 3, 4, 5, 6, 7]);

/* ------------------------------------------------------- the pack's fixtures */

describe("the pack's own fixtures", { skip: havePack ? false : "the v5 pack is not present" }, () => {
  test("a JPEG is a JPEG", () => {
    const r = identify(head("clear.jpg"), "clear.jpg");
    assert.equal(r.type, "image/jpeg");
    assert.equal(r.handling, HANDLING.IMAGE);
    assert.equal(r.ok, true);
    assert.equal(r.mismatch, false);
  });

  test("a PNG is a PNG", () => {
    const r = identify(head("clear.png"), "clear.png");
    assert.equal(r.type, "image/png");
    assert.equal(r.handling, HANDLING.IMAGE);
  });

  test("a PDF is a PDF", () => {
    const r = identify(head("scan-two-pages.pdf"), "scan-two-pages.pdf");
    assert.equal(r.type, "application/pdf");
    assert.equal(r.handling, HANDLING.PDF);
  });

  test("a PNG named .jpg is read as a PNG, and the name is called out", () => {
    /* The fixture the pack includes to catch believing a filename. Both halves
       matter: the file is usable, and the person is told their name was
       wrong — because they and the system disagreeing about what was uploaded
       will surface later as something worse. */
    const r = identify(head("png-renamed.jpg"), "png-renamed.jpg");
    assert.equal(r.type, "image/png", "the bytes decide");
    assert.equal(r.ok, true, "and it is still perfectly readable");
    assert.equal(r.mismatch, true);
    assert.match(r.mismatchNote, /named \.jpg and its contents are image\/png/);
    assert.match(r.mismatchNote, /The contents decide/);
  });

  test("the corrupt fixture is refused, as its README requires", () => {
    /* "corrupt.jpg must fail decoding." It has no JPEG header at all — its
       first bytes are the text "not a jp…" — so this is the case where the
       name claims one thing and the contents are not a format at all. The
       answer names both halves rather than saying "failed". */
    const r = identify(head("corrupt.jpg"), "corrupt.jpg");
    assert.equal(r.ok, false);
    assert.equal(r.handling, HANDLING.UNRECOGNISED);
    assert.equal(r.type, null, "nothing is claimed about what it is");
    assert.match(r.why, /name says JPG, and the contents are not something this recognises/);
    assert.match(r.why, /may be damaged/);
  });

  test("the low-resolution and rotated fixtures identify normally", () => {
    for (const name of ["low-resolution.jpg", "rotated.jpg"]) {
      assert.equal(identify(head(name), name).handling, HANDLING.IMAGE, name);
    }
  });
});

/* --------------------------------------------------- recognised and refused */

describe("formats it knows and cannot use", () => {
  test("a TIFF is named, not merely rejected", () => {
    /* "This is not a PDF" tells somebody nothing they can act on. */
    const r = identify(bytesOf(0x49, 0x49, 0x2A, 0x00), "scan.tif");
    assert.equal(r.handling, HANDLING.UNSUPPORTED);
    assert.equal(r.ok, false);
    assert.match(r.why, /Export it as a PNG or a PDF/);
  });

  test("both TIFF byte orders", () => {
    assert.equal(identify(bytesOf(0x4D, 0x4D, 0x00, 0x2A), "s.tif").type, "image/tiff");
  });

  test("a zip says what a zip usually is here", () => {
    const r = identify(bytesOf(0x50, 0x4B, 0x03, 0x04), "drawing.docx");
    assert.match(r.why, /also what a modern Office or CAD file is inside/);
    assert.match(r.why, /upload the drawing itself/);
  });

  test("an old Office document says to save it as a PDF", () => {
    assert.match(identify(bytesOf(0xD0, 0xCF, 0x11, 0xE0), "spec.doc").why, /Save it as a PDF/);
  });

  test("something unrecognised says so without guessing", () => {
    const r = identify(bytesOf(0x00, 0x01, 0x02, 0x03), "mystery.dwg");
    assert.equal(r.handling, HANDLING.UNRECOGNISED);
    assert.match(r.why, /name says DWG, and the contents are not something this recognises/);
  });

  test("an empty file is empty, not unrecognised nonsense", () => {
    assert.match(identify(new Uint8Array([]), "x.pdf").why, /The file is empty/);
  });
});

/* ------------------------------------------------------------ the bounds */

describe("limits are stated, not discovered", () => {
  test("an ordinary file passes", () => {
    assert.equal(withinLimits(2 * 1024 * 1024).ok, true);
  });

  test("an oversized one says its size and the limit, and what to do", () => {
    /* A limit somebody meets without having been told about it is
       indistinguishable from a fault. */
    const r = withinLimits(45 * 1024 * 1024);
    assert.equal(r.ok, false);
    assert.match(r.why, /45\.0MB and the limit is 20MB/);
    assert.match(r.why, /lower resolution usually reads just as well/);
  });

  test("zero and nonsense are refused distinctly", () => {
    assert.match(withinLimits(0).why, /empty/);
    assert.match(withinLimits(NaN).why, /no readable size/);
    assert.match(withinLimits(-1).why, /no readable size/);
  });

  test("the page limit exists and is a number somebody can be told", () => {
    assert.equal(typeof LIMITS.pages, "number");
    assert.ok(LIMITS.pages > 0);
  });
});

/* ------------------------------------------------- what happens next */

describe("what the product can do with it", () => {
  const png = () => identify(bytesOf(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A), "d.png");
  const pdf = () => identify(bytesOf(0x25, 0x50, 0x44, 0x46, 0x2D), "d.pdf");

  test("with no reader, an image is shown and nothing is claimed about it", () => {
    /* The honest state for this build. It must not imply a reading is coming,
       and it must not refuse the file — being able to see the drawing while
       typing is most of the value. */
    const n = nextStep(png(), { ocr: false });
    assert.equal(n.canPreview, true);
    assert.equal(n.canRead, false);
    assert.match(n.say, /shown so you can read it, and you can type what it says/);
    assert.match(n.say, /No text reader is configured/);
  });

  test("with a reader, it says what will be read", () => {
    const n = nextStep(png(), { ocr: true });
    assert.equal(n.canRead, true);
    assert.match(n.say, /printed text read for you to check/);
    assert.equal(/verified|confirmed automatically/i.test(n.say), false,
      "OCR output is never described as verified");
  });

  test("a PDF is readable either way, because its text layer is local", () => {
    assert.equal(nextStep(pdf(), { ocr: false }).canRead, true);
  });

  test("and says plainly that scanned pages are the part that will not work", () => {
    const n = nextStep(pdf(), { ocr: false });
    assert.equal(n.needsOcrForScannedPages, true);
    assert.match(n.say, /Scanned pages cannot be read in this build/);
    assert.match(n.say, /you will be told which/);
  });

  test("an unsupported format carries its own reason forward", () => {
    const tif = identify(bytesOf(0x49, 0x49, 0x2A, 0x00), "s.tif");
    const n = nextStep(tif, { ocr: true });
    assert.equal(n.canPreview, false);
    assert.equal(n.canRead, false);
    assert.match(n.say, /Export it as a PNG or a PDF/);
  });
});

/* ------------------------------------------- the defect this exists to fix */

describe("the defect the gap matrix names", () => {
  test("nothing here decides anything from a file extension", () => {
    /* The whole point. The current reader gates on /\.pdf$/i in two places,
       and the pack's diagnosis is that widening the input alone still fails
       because the handler rejects the file separately. */
    const src = readFileSync("src/intake/file-router.mjs", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");
    assert.equal(/\\\.pdf\$|\\\.(jpe?g|png)\$/i.test(src), false,
      "a format decision is being made from a filename");
  });

  test("an image is not refused for not being a PDF", () => {
    const jpg = identify(bytesOf(0xFF, 0xD8, 0xFF), "photo-of-drawing.jpg");
    assert.equal(jpg.ok, true);
    assert.equal(jpg.handling, HANDLING.IMAGE);
  });

  test("a PDF named something else is still a PDF", () => {
    const r = identify(bytesOf(0x25, 0x50, 0x44, 0x46, 0x2D), "drawing.bin");
    assert.equal(r.handling, HANDLING.PDF);
    assert.equal(r.ok, true);
  });

  test("sixteen bytes is enough to decide", () => {
    assert.ok(HEAD_BYTES >= 8);
    const r = identify(new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), "x.png");
    assert.equal(r.type, "image/png");
  });
});
