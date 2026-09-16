/**
 * Document extraction, executed against the page's own code.
 *
 * The engine decides what a document says. What this checks is the seam, and
 * the seam has three ways to betray the whole point of the feature:
 *
 *   - a value reaching a form field without anybody confirming it, which
 *     turns a proposal into a fact by accident;
 *   - an edited value keeping its tick, so what was checked against the
 *     document is not what gets used;
 *   - a quote reaching the page unescaped, which is the one place where
 *     content somebody else wrote becomes markup.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { pageSource, fnSource as pageFnSource } from "../helpers/page.mjs";

import {
  extractDocument, confirmCandidate, readiness, reviewTable,
  CONFIDENCE as EX_CONFIDENCE, TARGET as EX_TARGET,
} from "../../src/intake/extract-document.mjs";
import {
  identify as identifyFile, nextStep as fileNextStep, withinLimits as fileWithinLimits,
  HANDLING as FILE_HANDLING, HEAD_BYTES,
} from "../../src/intake/file-router.mjs";
import {
  queue as reviewQueue, documentRef, needsReReview, confirm as reviewConfirm,
  correct as reviewCorrect, markUnknown as reviewUnknown, reject as reviewReject,
  METHOD as REVIEW_METHOD, DISPOSITION as REVIEW_DISPOSITION,
} from "../../src/intake/review.mjs";

const html = pageSource();

/** The page's own source for one function. `html` is this file's copy of the page. */
const fnSource = (name) => pageFnSource(name, html);


const CERT_PAGES = [
  { page: 1, text: "CERTIFICATE No: SYN-CERT-0001\nManufacturer: Northgate Steelworks (synthetic)\n" +
                   "Heat No: H-77213   Lot: L-4\nSpecification: SYN-SPEC-100 Rev C\nPage 1 of 2" },
  { page: 2, text: "C 0.18 %   S <0.005 %\nRm 468 N/mm2" },
];

const DRAWING_PAGES = [
  { page: 1, text: "Drawing No: BRK-A-102 Rev: B\nMaterial: FG-300\n" +
                   "Thickness 5 mm  Width 200 mm  Length 100 mm" },
];

/** The form fields the page fills, as a stub the test can read back. */
function formStub() {
  const ids = [
    "ct-number", "ct-heat", "ct-lot", "ct-producer", "ct-distributor", "ct-spec",
    "ct-specrev", "ct-condition", "ct-form", "ct-pagesdec",
    "sc-bt", "sc-bw", "sc-bl", "sc-grade", "sc-qty",
  ];
  const fields = {};
  for (const id of ids) fields[id] = { value: "" };
  return fields;
}

let sandbox;
let out;
let apply;
let fields;

beforeEach(() => {
  out = { innerHTML: "" };
  apply = { innerHTML: "" };
  fields = formStub();
  sandbox = {
    document: {
      getElementById: (id) =>
        (id === "ctx-out" || id === "scx-out" ? out
          : id === "ctx-apply" || id === "scx-apply" ? apply
            : id === "ctx-name" || id === "scx-name" ? { textContent: "" }
              : (id in fields ? fields[id] : null)),
    },
    window: {
      BW: {
        extractDocument, confirmCandidate, readiness, reviewTable,
        EX_CONFIDENCE, EX_TARGET,
      },
    },
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
    console,
    _exState: { scx: null, ctx: null },
    _ctObs: [],
    ctRenderRows: () => {},
  };
  vm.createContext(sandbox);
  const src = ["exErr", "exResultHTML", "exApply", "exDecisionHTML"].map(fnSource).join("\n")
    + "\n" + html.slice(html.indexOf("var EX_TO_FORM="), html.indexOf("function exApply("));
  new vm.Script(src).runInContext(sandbox);
});

/** Put an extraction into the page's state and render it. */
function render(which, pages, opts = {}) {
  const r = extractDocument(pages, { filename: "synthetic.pdf", ...opts });
  sandbox._exState[which] = r;
  sandbox.out = out;
  vm.runInContext(`out_html = exResultHTML(${JSON.stringify(which)}, _exState[${JSON.stringify(which)}]);`, sandbox);
  return { result: r, html: sandbox.out_html };
}

/** Confirm every row of the current state, the way a tick does. */
function confirmAll(which) {
  const r = sandbox._exState[which];
  sandbox._exState[which] = { ...r, candidates: r.candidates.map((c) => confirmCandidate(c, "tester")) };
}

function runApply(which) {
  vm.runInContext(`exApply(${JSON.stringify(which)});`, sandbox);
  return apply.innerHTML;
}

describe("it is wired in", () => {
  test("the extractor is imported and mounted", () => {
    assert.match(html, /from "\.\/src\/intake\/extract-document\.mjs"/);
    const mount = (html.match(/window\.BW\s*=\s*\{([\s\S]*?)\};/) || [])[1] || "";
    for (const name of ["extractDocument", "confirmCandidate", "readiness", "reviewTable"]) {
      assert.ok(mount.includes(name), `${name} is not exposed`);
    }
  });

  test("both modes take a photograph as well as a PDF", () => {
    /* This was `accept=".pdf,application/pdf"` on both, which is half of the
       defect the v5 gap matrix names: the input refused the file before the
       handler got a chance to, so fixing the handler alone would have changed
       nothing a person could see. */
    for (const which of ["scx", "ctx"]) {
      const accept = new RegExp(`id="${which}-file" accept="([^"]*)"`).exec(html);
      assert.ok(accept, `${which} has no upload`);
      for (const kind of ["application/pdf", "image/jpeg", "image/png"]) {
        assert.ok(accept[1].includes(kind), `${which} does not accept ${kind}`);
      }
    }
  });

  test("the page reads pages, not one flattened string", () => {
    const fn = fnSource("scPdfPages");
    assert.match(fn, /pages\.push\(\{page:i,text:/);
    assert.match(fn, /pagesInDocument:pdf\.numPages/);
  });

  test("the page cap is generous and the true count is still reported", () => {
    // The comparator stops at twelve pages and says nothing. Here the true
    // page count travels with the read, so a page nobody looked at becomes a
    // blocker rather than a silence.
    const fn = fnSource("scPdfPages");
    const cap = Number(fn.match(/Math\.min\(pdf\.numPages,(\d+)\)/)[1]);
    assert.ok(cap >= 60, `the cap is ${cap}`);
    assert.match(fn, /return \{pages:pages,pagesInDocument:pdf\.numPages\}/);
  });

  test("no inline handlers were added", () => {
    const handlers = (html.match(/\son(click|input|change|load|error|submit)=/g) || []).length;
    assert.ok(handlers <= 132, `inline handlers rose to ${handlers}`);
  });

  test("the page extracts nothing itself", () => {
    for (const name of ["exResultHTML", "exApply"]) {
      const src = fnSource(name).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
      assert.equal(/new RegExp|\.match\(\/|\.exec\(/.test(src), false,
        `${name} does its own pattern matching instead of rendering what the engine found`);
    }
  });
});

describe("the review table", () => {
  test("every row shows the page and the characters it was read from", () => {
    const { html: out } = render("ctx", CERT_PAGES, { target: EX_TARGET.CERTIFICATE, pagesInDocument: 2 });
    assert.match(out, /Heat or cast number/);
    assert.match(out, /Heat No: H-77213/);
    const head = out.slice(out.indexOf("<thead>"), out.indexOf("</thead>"));
    for (const col of ["Field", "Value", "Unit", "Page", "Read from", "How", "Confirm"]) {
      assert.ok(head.includes(col), `${col} column is missing`);
    }
  });

  test("how a value was matched is shown, not hidden behind a number", () => {
    const { html: out } = render("ctx", CERT_PAGES, { target: EX_TARGET.CERTIFICATE });
    assert.match(out, /bw-status--evidenced">labelled/);
  });

  test("a value with no unit is marked in the row", () => {
    const { html: out } = render("ctx", [{ page: 1, text: "C 0.18" }], { target: EX_TARGET.CERTIFICATE });
    assert.match(out, /no unit stated/);
  });

  test("a document that disagrees with itself says so above the table", () => {
    const { html: out } = render("scx",
      [{ page: 1, text: "Thickness 5 mm" }, { page: 2, text: "Thickness 6 mm" }],
      { target: EX_TARGET.DRAWING });
    assert.match(out, /The document disagrees with itself/);
    assert.ok(out.indexOf("disagrees with itself") < out.indexOf("<table"));
  });

  test("blockers render above everything, as things to resolve", () => {
    const { html: out } = render("ctx", CERT_PAGES, { target: EX_TARGET.CERTIFICATE, pagesInDocument: 5 });
    assert.match(out, /Resolve before anything rests on this/);
    assert.match(out, /page\(s\) were not read/);
    assert.ok(out.indexOf("Resolve before") < out.indexOf("<table"));
  });

  test("a document with no text at all offers no table to tick", () => {
    const { html: out } = render("ctx", [{ page: 1, text: "" }], { target: EX_TARGET.CERTIFICATE, pagesInDocument: 1 });
    assert.match(out, /picture of a document/);
    assert.match(out, /no dimension may be derived from its pixels/);
    assert.equal(/<tbody>/.test(out), false, "there is nothing to confirm");
  });

  test("nothing matched is explained rather than left blank", () => {
    const { html: out } = render("scx", [{ page: 1, text: "Nothing here matches anything." }],
      { target: EX_TARGET.DRAWING });
    assert.match(out, /the rules here are deliberately narrow/);
  });
});

describe("nothing is used until it is confirmed", () => {
  test("unconfirmed values do not reach the form", () => {
    render("ctx", CERT_PAGES, { target: EX_TARGET.CERTIFICATE, pagesInDocument: 2 });
    const msg = runApply("ctx");
    assert.equal(fields["ct-heat"].value, "", "an unconfirmed value reached a form field");
    assert.match(msg, /Not confirmed, so not used/);
  });

  test("confirmed values do reach the form", () => {
    render("ctx", CERT_PAGES, { target: EX_TARGET.CERTIFICATE, pagesInDocument: 2 });
    confirmAll("ctx");
    const msg = runApply("ctx");
    assert.equal(fields["ct-heat"].value, "H-77213");
    assert.equal(fields["ct-number"].value, "SYN-CERT-0001");
    assert.match(msg, /Filled in/);
  });

  test("a drawing fills the material planner's own fields", () => {
    render("scx", DRAWING_PAGES, { target: EX_TARGET.DRAWING, pagesInDocument: 1 });
    confirmAll("scx");
    runApply("scx");
    assert.equal(fields["sc-bt"].value, "5");
    assert.equal(fields["sc-bw"].value, "200");
    assert.equal(fields["sc-bl"].value, "100");
  });

  test("chemistry and mechanical results become certificate observations", () => {
    render("ctx", CERT_PAGES, { target: EX_TARGET.CERTIFICATE, pagesInDocument: 2 });
    confirmAll("ctx");
    runApply("ctx");
    const carbon = sandbox._ctObs.find((r) => r[0] === "C");
    assert.ok(carbon, "carbon did not reach the observation rows");
    assert.equal(carbon[1], "0.18");
    assert.equal(carbon[2], "%");
    assert.equal(carbon[3], "2", "the page it was read from travels with it");
    assert.equal(carbon[5], true, "it arrives already checked, because it was confirmed here");
    assert.ok(sandbox._ctObs.some((r) => r[0] === "S" && r[1] === "<0.005"),
      "the inequality survives the whole path from document to observation");
  });

  test("a field with no home on the form is named rather than dropped", () => {
    render("scx", DRAWING_PAGES, { target: EX_TARGET.DRAWING, pagesInDocument: 1 });
    confirmAll("scx");
    const msg = runApply("scx");
    assert.match(msg, /has no field on this form, so enter it by hand/);
    assert.match(msg, /Part or drawing number/);
  });

  test("what may rest on the reading is stated after applying", () => {
    render("scx", DRAWING_PAGES, { target: EX_TARGET.DRAWING, pagesInDocument: 1 });
    const before = runApply("scx");
    assert.match(before, /budgetary estimate, labelled incomplete/);

    confirmAll("scx");
    fields["sc-qty"].value = "1000";
    const after = runApply("scx");
    assert.match(after, /order-ready recommendation/);
  });

  test("a blocker keeps the reading budgetary however much is confirmed", () => {
    render("scx", DRAWING_PAGES, { target: EX_TARGET.DRAWING, pagesInDocument: 4 });
    confirmAll("scx");
    fields["sc-qty"].value = "1000";
    const msg = runApply("scx");
    assert.match(msg, /budgetary/);
    assert.match(msg, /nothing should rest on this reading yet/);
  });
});

describe("editing and confirming", () => {
  const bindSource = () => fnSource("exBind");

  test("editing a value drops its confirmation", () => {
    // What was checked against the document was the old value.
    const fn = bindSource();
    assert.match(fn, /state:"proposed",confirmedBy:null,edited:true/);
    assert.match(fn, /loses its confirmation/);
  });

  test("an edited value keeps the page and quote it came from", () => {
    const fn = bindSource();
    assert.match(fn, /Object\.assign\(\{\},c,\{value:t\.value/);
    assert.equal(/page:null|quote:null/.test(fn), false);
  });

  test("unticking a box removes the confirmation", () => {
    assert.match(bindSource(), /t\.checked\?window\.BW\.confirmCandidate/);
  });

  test("confirming is recorded through the engine, not by setting a flag", () => {
    assert.match(bindSource(), /window\.BW\.confirmCandidate\(c,EX_REVIEWER\)/);
    /* The name is a constant now, because four actions record one and three
       of them would otherwise each carry their own spelling of it. */
    assert.match(html, /var EX_REVIEWER="this browser";/);
  });
});

describe("the document is content, and it is escaped", () => {
  test("a quote carrying markup does not reach the page raw", () => {
    const { html: out } = render("ctx",
      [{ page: 1, text: 'Heat No: <img src=x onerror="alert(1)">' }],
      { target: EX_TARGET.CERTIFICATE });
    assert.equal(/<img src=x/.test(out), false);
  });

  test("a value carrying a quote character cannot break out of its input", () => {
    const { html: out } = render("ctx",
      [{ page: 1, text: 'Manufacturer: Acme" onfocus="alert(1)' }],
      { target: EX_TARGET.CERTIFICATE });
    assert.equal(/onfocus="alert/.test(out), false);
    assert.match(out, /&quot;/);
  });

  test("nothing raw reaches the markup", () => {
    const { html: out } = render("ctx", CERT_PAGES, { target: EX_TARGET.CERTIFICATE });
    assert.equal(/\[object Object\]|undefined|NaN/.test(out), false);
  });
});

describe("what the page must keep saying", () => {
  const panel = () => html.slice(html.indexOf('id="ctx-file"') - 1400, html.indexOf('id="ctx-out"'));

  test("it says the file never leaves the browser", () => {
    assert.match(panel(), /never leaves this browser/);
    assert.match(panel(), /no upload, no extraction service and no prompt/);
  });

  test("it says nothing found is used until confirmed", () => {
    assert.match(panel(), /Nothing found is used until you confirm it/);
  });

  test("the method travels with every result", () => {
    const { html: out } = render("ctx", CERT_PAGES, { target: EX_TARGET.CERTIFICATE });
    assert.match(out, /No model was asked, nothing was uploaded anywhere/);
  });

  test("the format is decided by the file's bytes, not by its name", () => {
    /* The other half. `exRead` gated on `/\.pdf$/i` and returned an error
       before opening anything, so a JPEG was refused whatever the input
       accepted — and a PDF saved as ".bin" was refused too. */
    const fn = fnSource("exRead");
    assert.equal(/\\\.pdf\$/i.test(fn), false, "a format decision is still being made from a filename");
    assert.match(fn, /B\.identifyFile\(new Uint8Array\(head\),f\.name\)/);
    assert.match(fn, /f\.slice\(0,B\.HEAD_BYTES\)\.arrayBuffer\(\)/);
  });

  test("and nothing is claimed to have been read off it", () => {
    /* The honest state, and the one that must not drift: an image is shown so
       a person can read it, and the values stay theirs to type. A viewer that
       implied a reading was coming would be worse than the refusal it
       replaced. */
    const say = fnSource("exShowImage");
    assert.match(say, /msg\.textContent=say/, "the message comes from the router, not from here");
    assert.match(say, /Nothing on it has been read/);
    assert.equal(/verified|confirmed automatically/i.test(say), false);
  });

  test("the previous document is closed when the next one opens", () => {
    /* An object URL holds the file alive until it is revoked, and a preview
       left behind is the last case's drawing still on screen. */
    assert.match(fnSource("exViewClose"), /URL\.revokeObjectURL\(open\.url\)/);
    assert.match(fnSource("exRead"), /exViewClose\(which\);/);
    assert.match(fnSource("scClearSession"), /exViewClose\("scx"\); exViewClose\("ctx"\);/);
  });

  test("a name that disagrees with the contents is reported, not resolved quietly", () => {
    const fn = fnSource("exRead");
    assert.match(fn, /id\.mismatch\?exNote\(id\.mismatchNote\)/);
    assert.match(fnSource("exNote"), /ciEsc\(m\)/, "the note is escaped like every other filename");
  });
});

/* ------------------------------------------------- the routing, executed */

/**
 * `exRead` run for real, against the real router.
 *
 * Matching the source of the branch was not enough: replacing the image test
 * with `if(false&&id.handling===…)` left every assertion passing, because a
 * dead branch reads exactly like a live one. The only way to know a file
 * reaches the right handler is to hand one over and see where it lands.
 */
describe("a file goes where its bytes say it should", () => {
  const bytesOf = (...prefix) => new Uint8Array([...prefix, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

  const JPEG = bytesOf(0xFF, 0xD8, 0xFF);
  const PNG = bytesOf(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A);
  const PDF = bytesOf(0x25, 0x50, 0x44, 0x46, 0x2D);
  const TIFF = bytesOf(0x49, 0x49, 0x2A, 0x00);

  /** A File, as much of one as this function touches. */
  const fileOf = (bytes, name, size) => ({
    name,
    size: size === undefined ? bytes.length : size,
    slice: (from, to) => ({ arrayBuffer: async () => bytes.slice(from, to).buffer }),
  });

  /** Run exRead over one file and report everything it did. */
  async function read(which, file, before = null) {
    const shown = [];
    const outEl = { innerHTML: "" };
    const nameEl = { textContent: "" };
    const box = {
      document: {
        getElementById: (id) =>
          (id === `${which}-out` ? outEl : id === `${which}-name` ? nameEl : null),
      },
      window: {
        BW: {
          identifyFile, fileNextStep, fileWithinLimits, FILE_HANDLING, HEAD_BYTES,
          extractDocument, EX_TARGET,
          documentRef, reviewQueue, needsReReview, REVIEW_METHOD,
        },
      },
      ciEsc: (x) => String(x),
      console,
      _exState: { scx: before, ctx: before },
      closed: [],
      shown,
      /* Two spies. What is being tested is where a file goes, and each of
         these has its own tests; running the whole viewer here would test the
         DOM rather than the routing. */
      exShowImage: (w, f, say, note) => shown.push({ w, name: f.name, say, note }),
      exResultHTML: () => "<table>the rows</table>",
      exViewClose: (w) => box.closed.push(w),
      scPdfPages: async () => ({ pages: DRAWING_PAGES, pagesInDocument: 1 }),
      _exReview: { scx: null, ctx: null },
      exFingerprint: async () => "fingerprint",
      exReReviewHTML: () => "<div>needs checking again</div>",
      scReadStarted: () => {},
      engineNote: () => "<p>the engine is missing</p>",
    };
    vm.createContext(box);
    new vm.Script(["exRead", "exErr", "exNote"].map(fnSource).join("\n")).runInContext(box);

    const input = { files: [file], value: "x" };
    box.input = input;
    await vm.runInContext("exRead(" + JSON.stringify(which) + ", input);", box);
    return { out: outEl.innerHTML, name: nameEl.textContent, shown, state: box._exState[which],
             closed: box.closed, input };
  }

  test("a JPEG reaches the viewer rather than an error", async () => {
    const r = await read("scx", fileOf(JPEG, "drawing-photo.jpg"));
    assert.equal(r.shown.length, 1, "the image branch did not run");
    assert.equal(r.shown[0].name, "drawing-photo.jpg");
    assert.equal(r.out, "", "nothing was written to the error area");
  });

  test("and it is told plainly that nothing will be read for it", async () => {
    const r = await read("scx", fileOf(PNG, "scan.png"));
    assert.match(r.shown[0].say, /No text reader is configured/);
    assert.match(r.shown[0].say, /nothing will be read for you/);
    /* Not "verified", and not a reading that is merely coming later. The
       refusal this replaced was at least honest, and a viewer that implied a
       reading was on its way would be a step backwards. */
    assert.equal(/verified|will be read here|read for you to check/i.test(r.shown[0].say), false);
  });

  test("a PDF still goes to the reader, and still reads", async () => {
    const r = await read("scx", fileOf(PDF, "drawing.pdf"));
    assert.equal(r.shown.length, 0, "a PDF was sent to the image viewer");
    assert.ok(r.state && r.state.candidates.length > 0, "nothing was extracted");
    assert.match(r.name, /1 of 1 page/);
  });

  test("a PDF named something else is read as a PDF", async () => {
    /* The name was the only evidence before, and this file would have been
       refused for not ending in .pdf. */
    const r = await read("scx", fileOf(PDF, "drawing.bin"));
    assert.ok(r.state && r.state.candidates.length > 0, "the bytes were ignored");
  });

  test("a PNG named .jpg is read as a PNG, and the disagreement is shown", async () => {
    const r = await read("scx", fileOf(PNG, "png-renamed.jpg"));
    assert.equal(r.shown.length, 1);
    assert.match(r.shown[0].note, /named \.jpg and its contents are image\/png/);
  });

  test("a format this cannot use says what to do instead", async () => {
    const r = await read("ctx", fileOf(TIFF, "scan.tif"));
    assert.equal(r.shown.length, 0);
    assert.match(r.out, /Export it as a PNG or a PDF/);
  });

  test("an oversized file is refused before anything is opened", async () => {
    const r = await read("scx", fileOf(JPEG, "huge.jpg", 400 * 1024 * 1024));
    assert.equal(r.shown.length, 0);
    assert.match(r.out, /the limit is/);
  });

  test("the previous document is closed before the next one is opened", async () => {
    /* Seeded, because a sandbox that starts empty makes "it was cleared" a
       claim that cannot fail — which is the shape of vacuous test this suite
       has now found five times. */
    const stale = { candidates: [{ label: "the last drawing" }] };
    const r = await read("scx", fileOf(JPEG, "second.jpg"), stale);
    assert.deepEqual(r.closed, ["scx"], "the previous preview was left open");
    assert.equal(r.state, null, "the previous reading survived into this one");
  });

  test("and it is cleared even when the new file cannot be used at all", async () => {
    /* The worse version: a file that fails leaves the last drawing's values
       on screen, offered for confirmation against a document nobody is
       looking at any more. */
    const stale = { candidates: [{ label: "the last drawing" }] };
    const r = await read("scx", fileOf(TIFF, "scan.tif"), stale);
    assert.equal(r.state, null);
    assert.match(r.out, /Export it as a PNG or a PDF/);
  });

  test("the input is cleared, so the same file can be chosen again", async () => {
    /* A change event does not fire for the same file twice. Somebody who
       picks the wrong drawing, then picks the right one, then picks the first
       again would otherwise get nothing at all. */
    for (const f of [fileOf(JPEG, "a.jpg"), fileOf(PDF, "a.pdf"), fileOf(TIFF, "a.tif")]) {
      const r = await read("scx", f);
      assert.equal(r.input.value, "", `the input kept its value after ${f.name}`);
    }
  });

  test("with no engine it says so rather than failing silently", async () => {
    const shown = [];
    const outEl = { innerHTML: "" };
    const box = {
      document: { getElementById: (id) => (id === "scx-out" ? outEl : null) },
      window: {},
      console, _exState: { scx: null }, shown,
      exShowImage: () => shown.push(1), exViewClose: () => {},
      engineNote: () => "<p>the engine is missing</p>",
      ciEsc: (x) => String(x),
    };
    vm.createContext(box);
    new vm.Script(["exRead", "exErr", "exNote"].map(fnSource).join("\n")).runInContext(box);
    box.input = { files: [fileOf(JPEG, "d.jpg")], value: "x" };
    await vm.runInContext('exRead("scx", input);', box);
    assert.match(outEl.innerHTML, /the engine is missing/);
    assert.equal(shown.length, 0);
  });
});

/* ------------------------------------------- the two decisions, executed */

/**
 * "Not on the drawing" and "that reading is wrong", through the page.
 *
 * Both were missing, and both were landing as an untouched row — the same
 * thing a field nobody has looked at looks like. Run rather than matched:
 * a rendered button proves markup, not that pressing it does anything.
 */
describe("a reading can be ruled out, not only ticked", () => {
  /** A page with the decision functions and the table renderer in it. */
  function studio() {
    const outEl = { innerHTML: "" };
    const box = {
      document: { getElementById: (id) => (id === "scx-out" ? outEl : null) },
      window: {
        BW: {
          extractDocument, reviewTable, EX_CONFIDENCE, EX_TARGET,
          reviewQueue, documentRef, needsReReview,
          reviewUnknown, reviewReject, reviewCorrect,
          REVIEW_METHOD, REVIEW_DISPOSITION,
        },
      },
      ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
      attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
      console,
      EX_REVIEWER: "this browser",
      _exState: { scx: null },
      _exReview: { scx: null },
    };
    vm.createContext(box);
    new vm.Script(["exErr", "exResultHTML", "exDecisionHTML", "exItem", "exSetItem",
                   "exRerender", "exDecide", "exUndecide"].map(fnSource).join("\n"))
      .runInContext(box);

    const doc = documentRef({ filename: "brk-a-102.pdf", fingerprint: "abc" });
    const result = extractDocument(DRAWING_PAGES, { filename: "brk-a-102.pdf", target: EX_TARGET.DRAWING });
    box._exState.scx = result;
    box._exReview.scx = reviewQueue(result, { method: REVIEW_METHOD.RULE, document: doc });
    vm.runInContext('_render = exResultHTML("scx", _exState.scx);', box);
    outEl.innerHTML = box._render;

    return {
      box, outEl,
      html: () => outEl.innerHTML,
      decide: (field, action) =>
        vm.runInContext(`exDecide("scx", ${JSON.stringify(field)}, ${JSON.stringify(action)});`, box),
      undo: (field) => vm.runInContext(`exUndecide("scx", ${JSON.stringify(field)});`, box),
      item: (field) => box._exReview.scx.find((i) => i.field === field),
      /* A tick, as the change handler applies one. */
      confirmInPlace: (field) => {
        const r = box._exState.scx;
        box._exState.scx = { ...r, candidates: r.candidates.map((x) =>
          (x.field === field ? confirmCandidate(x, "this browser") : x)) };
      },
      candidate: (field) => box._exState.scx.candidates.find((c) => c.field === field),
    };
  }

  test("both answers are offered on every row", () => {
    const s = studio();
    assert.match(s.html(), /data-ex-unknown="thickness"/);
    assert.match(s.html(), /data-ex-reject="thickness"/);
    assert.match(s.html(), /not on it</);
    assert.match(s.html(), />wrong</);
  });

  test("marking one not-on-the-document records it and says so", () => {
    const s = studio();
    s.decide("thickness", "unknown");
    assert.equal(s.item("thickness").disposition, REVIEW_DISPOSITION.UNKNOWN);
    assert.match(s.html(), /not on the document/);
    assert.equal(s.item("thickness").revisions[0].by, "this browser");
  });

  test("rejecting a reading says something different", () => {
    /* The distinction the whole thing turns on: the drawing being silent and
       the rule having matched the wrong thing are not the same answer. */
    const s = studio();
    s.decide("thickness", "reject");
    assert.equal(s.item("thickness").disposition, REVIEW_DISPOSITION.REJECTED);
    assert.match(s.html(), /reading rejected/);
    assert.equal(/not on the document/.test(s.html()), false);
  });

  test("ruling out a row takes its tick away", () => {
    /* Confirmed first, or this asserts that something never confirmed is not
       confirmed — which is true of an empty page. The real case is somebody
       who ticked a row and then noticed the rule had matched the wrong
       number: the tick has to go, or a rejected reading is still applied. */
    const s = studio();
    s.confirmInPlace("thickness");
    assert.equal(s.candidate("thickness").state, "confirmed", "the fixture did not confirm");

    s.decide("thickness", "reject");
    assert.notEqual(s.candidate("thickness").state, "confirmed");
    assert.equal(s.candidate("thickness").confirmedBy, null);
  });

  test("the evidence survives being ruled out", () => {
    /* A rule that keeps being rejected on the same kind of drawing is the
       most useful thing this queue can report, and a deleted row reports
       nothing. */
    const s = studio();
    const read = s.item("thickness").evidence.value;
    s.decide("thickness", "reject");
    assert.equal(s.item("thickness").evidence.value, read);
    assert.ok(s.item("thickness").evidence.quote);
  });

  test("a decision can be taken back, and the taking back is kept", () => {
    const s = studio();
    s.decide("thickness", "unknown");
    s.undo("thickness");
    assert.equal(s.item("thickness").disposition, REVIEW_DISPOSITION.PROPOSED);
    assert.equal(s.item("thickness").value, s.item("thickness").evidence.value,
      "the reading did not come back");
    assert.equal(s.item("thickness").revisions.length, 1,
      "undoing erased the record that a decision was made");
    assert.match(s.html(), /data-ex-unknown="thickness"/, "the row did not return to offering both");
  });

  test("one row's decision leaves the others alone", () => {
    const s = studio();
    s.decide("thickness", "unknown");
    assert.equal(s.item("width").disposition, REVIEW_DISPOSITION.PROPOSED);
    assert.match(s.html(), /data-ex-unknown="width"/);
  });

  test("with no queue built, the row still renders and offers both", () => {
    /* exDecisionHTML is called from a renderer that runs before any queue
       exists in several paths. Throwing there would take the whole table
       with it. */
    const s = studio();
    s.box._exReview.scx = null;
    vm.runInContext('_render = exResultHTML("scx", _exState.scx);', s.box);
    assert.match(s.box._render, /data-ex-unknown="thickness"/);
  });
});
