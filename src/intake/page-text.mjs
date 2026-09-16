/**
 * Which pages can actually be read, and which are pictures.
 *
 * `specs/03-FILE-INTELLIGENCE.md` route 3: *"retain native page text with
 * geometry; assess text presence/quality page by page. Rasterize and OCR pages
 * with missing/broken text. Mixed PDFs require both paths… Page limits must
 * state processed/skipped counts."*
 *
 * The router already tells somebody that scanned pages cannot be read in this
 * build and that they will be told which. Nothing was telling them which. The
 * extraction counts pages with no text, which is the right count and the wrong
 * answer: a person looking at a twelve-page certificate and the words "3 pages
 * carry no text" has to work out which three by opening the file themselves.
 *
 * Presence is also not the question the spec asks. A scanned page with a
 * stamped reference number in a text layer has text, and treating it as
 * readable is a quiet failure — the rules run, find nothing, and the document
 * looks like one that simply had nothing on it. The middle state is the
 * important one and it needs its own name.
 *
 * Nothing here decides anything. It reports what is readable so the page can
 * say so, and so a value that was never looked for is never mistaken for a
 * value that is not there.
 */

/** What one page turned out to be. */
export const PAGE = Object.freeze({
  /* Enough text to run rules over. */
  TEXT: "text",
  /* Some text, but far too little to be the page's content — a stamped
     number over a scan, a header on an otherwise photographed sheet. */
  SPARSE: "sparse",
  /* Nothing at all. A picture of a page. */
  NONE: "none",
});

/**
 * Where "sparse" begins.
 *
 * A drawing's title block alone runs to a few hundred characters, and the
 * thinnest real page in the synthetic fixtures is a continuation sheet with a
 * heading and one row — around eighty. Forty is below anything that carries
 * content and above the stray-stamp case this exists to catch.
 *
 * The number is arguable and the shape is not: there has to be a middle state,
 * and it has to be named rather than folded into either neighbour.
 */
export const SPARSE_BELOW = 40;

/** Words, roughly — enough to tell prose from a scattering of marks. */
const words = (text) => String(text).trim().split(/\s+/).filter(Boolean).length;

/** One page, assessed. */
export function assessPage(page) {
  const n = Number(page?.page);
  const text = String(page?.text ?? "");
  const characters = text.trim().length;

  if (characters === 0) {
    return Object.freeze({
      page: n, kind: PAGE.NONE, characters: 0, words: 0,
      why: "This page has no text at all. It is a picture of a page.",
    });
  }
  if (characters < SPARSE_BELOW) {
    return Object.freeze({
      page: n, kind: PAGE.SPARSE, characters, words: words(text),
      why: `This page has ${characters} characters of text, which is too little to be its `
         + "content. It is most likely a scan with something stamped or typed over it.",
    });
  }
  return Object.freeze({
    page: n, kind: PAGE.TEXT, characters, words: words(text),
    why: "This page has text that can be read.",
  });
}

/** A run of page numbers, said the way a person would say it. */
export function pageList(numbers) {
  const ns = [...new Set(numbers.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (ns.length === 0) return "";

  const runs = [];
  let start = ns[0], last = ns[0];
  for (const n of ns.slice(1)) {
    if (n === last + 1) { last = n; continue; }
    runs.push([start, last]);
    start = last = n;
  }
  runs.push([start, last]);

  const said = runs.map(([a, b]) => (a === b ? `${a}` : b === a + 1 ? `${a} and ${b}` : `${a}–${b}`));
  if (said.length === 1) return said[0];
  return `${said.slice(0, -1).join(", ")} and ${said[said.length - 1]}`;
}

/**
 * The whole document, page by page.
 *
 * `pagesInDocument` is what the file says it holds; `pages` is what was
 * actually handed over. Pages beyond a read limit are skipped, not absent, and
 * the spec is explicit that a limit states both counts rather than quietly
 * stopping.
 */
export function assessDocument(pages, { pagesInDocument = null } = {}) {
  const list = (pages ?? []).map(assessPage);
  const of = (kind) => list.filter((p) => p.kind === kind).map((p) => p.page);

  const readable = of(PAGE.TEXT);
  const sparse = of(PAGE.SPARSE);
  const none = of(PAGE.NONE);
  const total = pagesInDocument ?? list.length;
  const skipped = [];
  for (let n = list.length + 1; n <= total; n++) skipped.push(n);

  return Object.freeze({
    pages: Object.freeze(list),
    readable: Object.freeze(readable),
    sparse: Object.freeze(sparse),
    none: Object.freeze(none),
    skipped: Object.freeze(skipped),
    pagesInDocument: total,
    pagesRead: list.length,
    /* The two that need a reader this build does not have. Sparse belongs
       here: a page with a stamp over a scan is a scan. */
    needsReading: Object.freeze([...sparse, ...none].sort((a, b) => a - b)),
    /* Nothing readable anywhere is a different situation from a mixed
       document, and the page should not offer a review table for it. */
    anyReadable: readable.length > 0,
    mixed: readable.length > 0 && (sparse.length + none.length) > 0,
  });
}

/**
 * What to tell somebody, naming the pages.
 *
 * One short paragraph rather than a count, because the count was already
 * there and was not enough to act on. The wording never claims a page will be
 * read later — there is no reader in this build, and saying so plainly is the
 * whole point of naming the pages at all.
 */
export function saidPlainly(assessment) {
  const a = assessment;
  const said = [];

  if (a.pagesRead === 0) return "Nothing was read from this document.";

  if (!a.anyReadable) {
    said.push("No page of this document has readable text — every page is a picture. "
            + "Nothing here can read it, and no value may be taken from its pixels. "
            + "The document is shown so you can read it and enter the values yourself.");
  } else if (a.mixed) {
    said.push(`Pages ${pageList(a.readable)} were read.`);
    if (a.none.length) {
      said.push(`Page${a.none.length > 1 ? "s" : ""} ${pageList(a.none)} `
              + `${a.none.length > 1 ? "are" : "is"} a picture with no text, so nothing on `
              + `${a.none.length > 1 ? "them" : "it"} was read.`);
    }
    if (a.sparse.length) {
      said.push(`Page${a.sparse.length > 1 ? "s" : ""} ${pageList(a.sparse)} carr`
              + `${a.sparse.length > 1 ? "y" : "ies"} only a few characters — most likely a scan `
              + "with something stamped over it. Treat it as unread.");
    }
    said.push("Anything stated on those pages is not missing from the drawing; it is missing from "
            + "what was read. Enter it yourself.");
  } else {
    said.push(`All ${a.pagesRead} page${a.pagesRead > 1 ? "s" : ""} were read.`);
  }

  if (a.skipped.length) {
    said.push(`Page${a.skipped.length > 1 ? "s" : ""} ${pageList(a.skipped)} `
            + `${a.skipped.length > 1 ? "were" : "was"} not read at all: the document has `
            + `${a.pagesInDocument} pages and ${a.pagesRead} were opened.`);
  }

  return said.join(" ");
}
