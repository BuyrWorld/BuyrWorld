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

import {
  extractDocument, confirmCandidate, readiness, reviewTable,
  CONFIDENCE as EX_CONFIDENCE, TARGET as EX_TARGET,
} from "../../src/intake/extract-document.mjs";

const html = readFileSync("index.html", "utf8");

function fnSource(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  const end = html.indexOf("\nfunction ", start + 1);
  return html.slice(start, end < 0 ? html.length : end);
}

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
  const src = ["exErr", "exResultHTML", "exApply"].map(fnSource).join("\n")
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

  test("both modes have an upload, and both accept only PDFs", () => {
    for (const which of ["scx", "ctx"]) {
      assert.match(html, new RegExp(`id="${which}-file" accept="\\.pdf,application/pdf"`));
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
    assert.match(bindSource(), /window\.BW\.confirmCandidate\(c,"this browser"\)/);
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

  test("an image file is refused with the reason", () => {
    const fn = fnSource("exRead");
    assert.match(fn, /no dimension may be derived from its pixels/);
    assert.match(fn, /Enter the values by hand instead/);
  });
});
