/**
 * Which pages were actually read.
 *
 * The router tells somebody that scanned pages cannot be read here and that
 * they will be told which. Nothing was telling them which — the extraction
 * counted pages with no text, which is a count and not an answer.
 *
 * The middle state is what these tests are really about. A scan with a
 * stamped reference number in its text layer has text; treating it as
 * readable makes the rules run over nothing and the document look like one
 * that simply had nothing on it. That failure is silent, which is the kind
 * this codebase keeps having to dig out.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  assessPage, assessDocument, saidPlainly, pageList, PAGE, SPARSE_BELOW,
} from "../../src/intake/page-text.mjs";

const REAL = "Drawing No: BRK-A-102 Rev: B   Material: FG-300   "
           + "Thickness 5 mm   Width 200 mm   Length 100 mm   General tolerance ISO 2768-m";

const page = (n, text) => ({ page: n, text });

/* ------------------------------------------------------------- one page */

describe("one page", () => {
  test("a page with content is readable", () => {
    const a = assessPage(page(1, REAL));
    assert.equal(a.kind, PAGE.TEXT);
    assert.equal(a.page, 1);
    assert.ok(a.characters > SPARSE_BELOW);
  });

  test("a page with nothing on it is a picture, and says so", () => {
    const a = assessPage(page(2, ""));
    assert.equal(a.kind, PAGE.NONE);
    assert.equal(a.characters, 0);
    assert.match(a.why, /picture of a page/);
  });

  test("whitespace is nothing", () => {
    assert.equal(assessPage(page(2, "   \n\t  ")).kind, PAGE.NONE);
  });

  test("a scan with a stamp over it is neither of those", () => {
    /* The case this module exists for. "QA-4471" in a text layer over a
       photographed sheet is text, and reading it as a readable page means the
       rules run, find nothing, and the drawing looks blank. */
    const a = assessPage(page(3, "QA-4471"));
    assert.equal(a.kind, PAGE.SPARSE);
    assert.match(a.why, /too little to be its content/);
    assert.match(a.why, /stamped or typed over it/);
  });

  test("the boundary is where it says it is, in both directions", () => {
    assert.equal(assessPage(page(1, "x".repeat(SPARSE_BELOW - 1))).kind, PAGE.SPARSE);
    assert.equal(assessPage(page(1, "x".repeat(SPARSE_BELOW))).kind, PAGE.TEXT);
  });

  test("a missing page object does not throw", () => {
    /* A reader that returns a hole should produce a report of a hole. */
    assert.equal(assessPage(undefined).kind, PAGE.NONE);
    assert.equal(assessPage({}).kind, PAGE.NONE);
  });
});

/* ---------------------------------------------------------- the document */

describe("the whole document", () => {
  test("a text PDF is wholly readable", () => {
    const a = assessDocument([page(1, REAL), page(2, REAL)]);
    assert.deepEqual([...a.readable], [1, 2]);
    assert.deepEqual([...a.needsReading], []);
    assert.equal(a.anyReadable, true);
    assert.equal(a.mixed, false);
  });

  test("a scan is readable nowhere", () => {
    const a = assessDocument([page(1, ""), page(2, "")]);
    assert.equal(a.anyReadable, false);
    assert.equal(a.mixed, false);
    assert.deepEqual([...a.needsReading], [1, 2]);
  });

  test("a mixed document is named as mixed, which is the case the spec calls out", () => {
    const a = assessDocument([page(1, REAL), page(2, ""), page(3, REAL)]);
    assert.equal(a.mixed, true);
    assert.deepEqual([...a.readable], [1, 3]);
    assert.deepEqual([...a.none], [2]);
  });

  test("a sparse page needs reading just as much as an empty one", () => {
    /* Folding sparse in with readable is the silent failure; folding it in
       with empty is the honest call, because a stamp over a scan is a scan. */
    const a = assessDocument([page(1, REAL), page(2, "QA-4471")]);
    assert.deepEqual([...a.sparse], [2]);
    assert.deepEqual([...a.needsReading], [2]);
    assert.equal(a.readable.includes(2), false);
  });

  test("pages beyond the read limit are skipped, not absent", () => {
    const a = assessDocument([page(1, REAL), page(2, REAL)], { pagesInDocument: 5 });
    assert.deepEqual([...a.skipped], [3, 4, 5]);
    assert.equal(a.pagesRead, 2);
    assert.equal(a.pagesInDocument, 5);
  });

  test("nothing is skipped when everything was opened", () => {
    assert.deepEqual([...assessDocument([page(1, REAL)], { pagesInDocument: 1 }).skipped], []);
    assert.deepEqual([...assessDocument([page(1, REAL)]).skipped], []);
  });

  test("an empty document is reported, not thrown", () => {
    const a = assessDocument([]);
    assert.equal(a.pagesRead, 0);
    assert.equal(a.anyReadable, false);
  });

  test("needsReading comes back in page order, however the pages arrived", () => {
    const a = assessDocument([page(1, ""), page(2, REAL), page(3, "QA-1"), page(4, "")]);
    assert.deepEqual([...a.needsReading], [1, 3, 4]);
  });
});

/* ------------------------------------------------------------ the wording */

describe("saying which pages", () => {
  test("consecutive pages are a range, and one page is one page", () => {
    assert.equal(pageList([3]), "3");
    assert.equal(pageList([3, 4]), "3 and 4");
    assert.equal(pageList([3, 4, 5]), "3–5");
    assert.equal(pageList([1, 3, 4, 5, 9]), "1, 3–5 and 9");
    assert.equal(pageList([]), "");
  });

  test("it does not care what order they arrive in, or repeat one", () => {
    assert.equal(pageList([5, 3, 4, 3]), "3–5");
  });

  test("a mixed document names the readable pages and the ones that are not", () => {
    const said = saidPlainly(assessDocument([page(1, REAL), page(2, ""), page(3, REAL)]));
    assert.match(said, /Pages 1 and 3 were read/);
    assert.match(said, /Page 2 is a picture with no text/);
  });

  test("and says the values are missing from the reading, not from the drawing", () => {
    /* The distinction somebody acts on. "Nothing found" reads as "the drawing
       does not say", which is how a thickness gets typed in from memory. */
    const said = saidPlainly(assessDocument([page(1, REAL), page(2, "")]));
    assert.match(said, /not missing from the drawing; it is missing from what was read/);
  });

  test("a sparse page is described as what it probably is", () => {
    const said = saidPlainly(assessDocument([page(1, REAL), page(2, "QA-4471")]));
    assert.match(said, /Page 2 carries only a few characters/);
    assert.match(said, /Treat it as unread/);
  });

  test("plurals hold, in both directions", () => {
    const one = saidPlainly(assessDocument([page(1, REAL), page(2, "")]));
    const many = saidPlainly(assessDocument([page(1, REAL), page(2, ""), page(3, "")]));
    assert.match(one, /Page 2 is a picture/);
    assert.match(many, /Pages 2 and 3 are a picture/);
  });

  test("a document with nothing readable says so first, and offers manual entry", () => {
    const said = saidPlainly(assessDocument([page(1, ""), page(2, "")]));
    assert.match(said, /every page is a picture/);
    assert.match(said, /enter the values yourself/);
  });

  test("skipped pages are stated with both counts", () => {
    const said = saidPlainly(assessDocument([page(1, REAL)], { pagesInDocument: 4 }));
    assert.match(said, /Pages 2–4 were not read at all/);
    assert.match(said, /has 4 pages and 1 were opened/);
  });

  test("a wholly readable document says so without listing every page", () => {
    const said = saidPlainly(assessDocument([page(1, REAL), page(2, REAL)]));
    assert.match(said, /All 2 pages were read/);
  });

  test("nothing read at all is not described as a document", () => {
    assert.equal(saidPlainly(assessDocument([])), "Nothing was read from this document.");
  });

  test("it never promises a reading that is not coming", () => {
    /* There is no OCR in this build. Naming the pages is only honest if the
       wording does not imply somebody will get to them later. */
    for (const a of [
      assessDocument([page(1, REAL), page(2, "")]),
      assessDocument([page(1, ""), page(2, "")]),
      assessDocument([page(1, REAL)], { pagesInDocument: 3 }),
    ]) {
      const said = saidPlainly(a);
      assert.equal(/will be read|being read|reading now|shortly|queued/i.test(said), false, said);
    }
  });
});
