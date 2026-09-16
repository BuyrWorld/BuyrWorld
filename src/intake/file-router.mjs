/**
 * What is this file, actually?
 *
 * `specs/03-FILE-INTELLIGENCE.md`, route 1: *"Sniff bytes/MIME and decode,
 * comparing extension. Reject unsafe/corrupt input with a specific
 * explanation; don't rely on extension alone."*
 *
 * The reason that is route one rather than a detail: today the drawing reader
 * decides what a file is by looking at the end of its name, and the pack's
 * diagnosis is that widening the input's `accept` list would not fix it,
 * because the handler rejects the file separately on the same evidence. A
 * name is a claim made by whoever saved the file. The first few bytes are
 * what the file is.
 *
 * The two disagreeing is itself worth reporting. `png-renamed.jpg` is in the
 * pack's own fixtures, and the honest answer is not to silently trust one or
 * the other — it is to decode by content and say that the name was wrong,
 * because a person who thinks they uploaded a JPEG and a system that read a
 * PNG will eventually disagree about something that matters.
 *
 * Nothing here decodes an image or reads a page. It answers one question — what
 * is this, and can anything here read it — so that everything downstream can
 * stop guessing from a filename.
 */

/** What this build can do with a file once it knows what it is. */
export const HANDLING = Object.freeze({
  /* Rendered in the browser, and its printed text may be read if a reader is
     configured. */
  IMAGE: "image",
  /* Page text extracted locally by rule; pages without usable text need OCR. */
  PDF: "pdf",
  /* Recognised, and nothing here can use it. Named so the person is told what
     it is rather than that it "failed". */
  UNSUPPORTED: "unsupported",
  /* The bytes do not match anything known. */
  UNRECOGNISED: "unrecognised",
});

/**
 * Signatures, as byte prefixes.
 *
 * Short and specific. A longer list would be a wider surface of things this
 * claims to understand, and `specs/03` asks for *declared* format coverage —
 * a format in this table is one the product says it can name.
 */
const SIGNATURES = Object.freeze([
  { type: "image/jpeg", ext: "jpg", handling: HANDLING.IMAGE,
    bytes: [0xFF, 0xD8, 0xFF] },
  { type: "image/png", ext: "png", handling: HANDLING.IMAGE,
    bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { type: "application/pdf", ext: "pdf", handling: HANDLING.PDF,
    bytes: [0x25, 0x50, 0x44, 0x46, 0x2D] },                       // %PDF-

  /* Recognised and refused, with a reason. Each of these is something a buyer
     plausibly has and would otherwise be told only that it "is not a PDF". */
  { type: "image/tiff", ext: "tif", handling: HANDLING.UNSUPPORTED,
    bytes: [0x49, 0x49, 0x2A, 0x00],
    why: "TIFF scans are common and this build cannot decode them. Export it as a PNG or a PDF." },
  { type: "image/tiff", ext: "tif", handling: HANDLING.UNSUPPORTED,
    bytes: [0x4D, 0x4D, 0x00, 0x2A],
    why: "TIFF scans are common and this build cannot decode them. Export it as a PNG or a PDF." },
  { type: "application/zip", ext: "zip", handling: HANDLING.UNSUPPORTED,
    bytes: [0x50, 0x4B, 0x03, 0x04],
    why: "This is a zip archive — which is also what a modern Office or CAD file is inside. "
       + "Open it and upload the drawing itself." },
  { type: "application/msword", ext: "doc", handling: HANDLING.UNSUPPORTED,
    bytes: [0xD0, 0xCF, 0x11, 0xE0],
    why: "An older Office document. Save it as a PDF and upload that." },
  { type: "image/gif", ext: "gif", handling: HANDLING.UNSUPPORTED,
    bytes: [0x47, 0x49, 0x46, 0x38],
    why: "A GIF is a screen image, not a document scan. A PNG or a PDF will read better." },
]);

/** Extensions that claim to be something, for comparing against the bytes. */
const CLAIMED = Object.freeze({
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", pdf: "application/pdf",
  tif: "image/tiff", tiff: "image/tiff", gif: "image/gif",
  zip: "application/zip", doc: "application/msword", docx: "application/zip",
});

const matches = (bytes, sig) => sig.bytes.every((b, i) => bytes[i] === b);

/**
 * Identify a file from its first bytes.
 *
 * @param {Uint8Array} head  the first bytes — sixteen is plenty
 * @param {string} name      what it was called, used only to disagree with
 */
export function identify(head, name = "") {
  const bytes = head instanceof Uint8Array ? head : new Uint8Array(head ?? []);
  const ext = (/\.([A-Za-z0-9]+)$/.exec(String(name)) || [])[1]?.toLowerCase() ?? null;
  const claimed = ext ? CLAIMED[ext] ?? null : null;

  if (bytes.length === 0) {
    return refuse("The file is empty.", { ext, claimed });
  }

  const sig = SIGNATURES.find((s) => matches(bytes, s));

  if (!sig) {
    return Object.freeze({
      ok: false,
      handling: HANDLING.UNRECOGNISED,
      type: null, ext, claimed,
      mismatch: false,
      why: ext
        ? `The name says ${ext.toUpperCase()}, and the contents are not something this recognises. `
          + "It may be damaged, or a format this build cannot read."
        : "This is not a format this build recognises.",
    });
  }

  /* The name and the bytes disagreeing is a fact about the file, and it is
     reported whether or not the file is usable. Somebody who believes they
     uploaded a JPEG and a system that read a PNG will disagree later about
     something that matters more. */
  const mismatch = Boolean(claimed) && claimed !== sig.type;

  return Object.freeze({
    ok: sig.handling === HANDLING.IMAGE || sig.handling === HANDLING.PDF,
    handling: sig.handling,
    type: sig.type,
    ext, claimed, mismatch,
    mismatchNote: mismatch
      ? `This is named .${ext} and its contents are ${sig.type}. The contents decide; `
        + "the name is only what somebody called it."
      : null,
    why: sig.why ?? null,
  });
}

function refuse(why, rest) {
  return Object.freeze({
    ok: false, handling: HANDLING.UNRECOGNISED, type: null,
    mismatch: false, mismatchNote: null, why, ...rest,
  });
}

/** How many bytes `identify` needs. */
export const HEAD_BYTES = 16;

/* ------------------------------------------------------------------ limits */

/**
 * Bounds, stated rather than discovered.
 *
 * `specs/03`: *"Bound upload bytes… make limits explicit in UI."* A limit a
 * person meets without having been told is indistinguishable from a fault.
 */
export const LIMITS = Object.freeze({
  bytes: 20 * 1024 * 1024,
  /* Pages read from a PDF in one pass. The pack asks that a limit report
     processed and skipped counts rather than silently truncating. */
  pages: 30,
});

/** Whether a file is within the stated bounds, and what to say if not. */
export function withinLimits(size) {
  if (!Number.isFinite(size) || size < 0) return { ok: false, why: "That file has no readable size." };
  if (size === 0) return { ok: false, why: "The file is empty." };
  if (size > LIMITS.bytes) {
    return {
      ok: false,
      why: `That file is ${(size / 1024 / 1024).toFixed(1)}MB and the limit is `
         + `${LIMITS.bytes / 1024 / 1024}MB. A drawing exported at a lower resolution usually reads just as well.`,
    };
  }
  return { ok: true };
}

/* -------------------------------------------------------- what happens next */

/**
 * What the product can do with this file, in words a person can act on.
 *
 * Separate from `identify` because identifying is about the file and this is
 * about this build — the same PNG is a different proposition depending on
 * whether a reader is configured, and that is a deployment fact rather than a
 * fact about the bytes.
 *
 * @param {object} id             the result of identify()
 * @param {object} [capabilities] { ocr } — whether a text reader is available
 */
export function nextStep(id, { ocr = false } = {}) {
  if (id.handling === HANDLING.PDF) {
    return Object.freeze({
      canPreview: true,
      canRead: true,
      /* Pages with no text layer need rasterising and OCR, which is a
         different capability from reading a text PDF. */
      needsOcrForScannedPages: !ocr,
      say: ocr
        ? "This will be read page by page, and any scanned pages will be read as images."
        : "Pages with selectable text will be read here in this browser. Scanned pages cannot "
          + "be read in this build — you will be told which, and can enter those values yourself.",
    });
  }

  if (id.handling === HANDLING.IMAGE) {
    return Object.freeze({
      canPreview: true,
      canRead: ocr,
      say: ocr
        ? "This will be shown, and its printed text read for you to check."
        : "This will be shown so you can read it, and you can type what it says. "
          + "No text reader is configured in this build, so nothing will be read for you.",
    });
  }

  return Object.freeze({
    canPreview: false,
    canRead: false,
    say: id.why ?? "This build cannot read that file.",
  });
}
