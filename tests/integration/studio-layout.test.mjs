/**
 * The approved Should-Cost Studio: two ways in, three columns.
 *
 * `references/approved/should-cost-studio.png` is the visual anchor and
 * `design/04-APPROVED-STUDIO.md` controls the behaviour. Two requirements from
 * the pack are load-bearing and testable without a browser:
 *
 *   "The Should-Cost Studio MUST offer two equally clear starting options."
 *   "No drawing is a normal supported source type, not an error/fallback."
 *
 * The page previously had the drawing reader as panel "0 · Read it off the
 * drawing", above the form and marked optional — which reads as the way in,
 * with typing as what you do when it fails. That is the framing the pack
 * rules out, so most of this file is about the two being peers.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { pageSource, fnSource, markupOnly } from "../helpers/page.mjs";

const app = readFileSync("app.js", "utf8");
const html = pageSource();
const markup = markupOnly();

/** The Should Cost page's own markup, so a match elsewhere cannot pass for one here. */
function studio() {
  const at = markup.indexOf('id="sc-mode-material"');
  assert.notEqual(at, -1, "the Should Cost material panel is not in the page");
  const end = markup.indexOf('id="sc-mode-cert"', at);
  assert.ok(end > at, "the certificate panel should follow it");
  return markup.slice(at, end);
}

/** Just the two entry buttons, for assertions about their wording. */
function entryBlock() {
  const s = studio();
  const at = s.indexOf('class="bw-studio-entry"');
  assert.notEqual(at, -1, "the entry choice is not on the page");
  const end = s.indexOf("</div>", s.indexOf('id="sc-entry-upload"'));
  assert.ok(end > at);
  return s.slice(at, end);
}

/* ------------------------------------------------------- two equal ways in */

describe("two equally clear ways to start", () => {
  const s = studio();

  test("both choices exist", () => {
    assert.match(s, /id="sc-entry-manual"/);
    assert.match(s, /id="sc-entry-upload"/);
  });

  test("the manual one is named as a choice, not as a fallback", () => {
    // "No drawing — enter details manually", in the pack's own words. Not
    // "skip", "or continue without", or anything that reads as giving up.
    const entry = entryBlock();
    assert.match(entry, /No drawing &mdash; enter details manually/);
    /* Scoped to the two buttons. Run over the whole panel this caught the
       word "instead" in an unrelated contingency label — a test that fails on
       copy three screens away is a test nobody will keep. */
    assert.equal(/skip|instead|can't upload|cannot upload|no file\?/i.test(entry), false,
      "the manual route must not be worded as a consolation");
  });

  test("they are the same shape, so neither is visually the lesser", () => {
    const both = [...s.matchAll(/<button[^>]*class="bw-entry"[^>]*>/g)];
    assert.equal(both.length, 2);
    for (const b of both) {
      assert.match(b[0], /class="bw-entry"/, "same class, so the same geometry");
    }
    // One grid, two equal fractions.
    assert.match(html, /\.bw-studio-entry\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  });

  test("each says what it will actually do", () => {
    assert.match(s, /You can leave anything you are not sure of/);
    assert.match(s, /Nothing is used until you confirm it/);
  });

  test("the choice is announced, not just drawn", () => {
    assert.match(s, /role="group" aria-label="How would you like to start\?"/);
    assert.match(s, /id="sc-entry-manual" aria-pressed="true"/);
    assert.match(s, /id="sc-entry-upload" aria-pressed="false"/);
  });

  test("and it is not signalled by colour alone", () => {
    // The house rule for every status in this product.
    assert.match(html, /\.bw-entry\[aria-pressed="true"\]\{[^}]*border-color/);
    assert.match(html, /\.bw-entry\[aria-pressed="true"\] \.bw-entry-title::after\{content:"✓"/);
  });

  test("manual is what you get without choosing", () => {
    // Most parts arrive as a description, not a PDF.
    // The declaration sits beside the function, not inside it.
    assert.match(app, /var _scEntry="manual";/);
    assert.match(fnSource("scEntry", app), /which === "upload" \? "upload" : "manual"/);
    assert.match(s, /id="sc-upload-panel" hidden/);
  });
});

/* -------------------------------------------------------- what choosing does */

describe("choosing a way in", () => {
  /** Run scEntry over a stub page and report what it did. */
  function run(which, { missing = [] } = {}) {
    const els = new Map();
    const make = (id) => ({ id, hidden: false, attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; } });
    for (const id of ["sc-upload-panel", "sc-entry-manual", "sc-entry-upload"]) {
      if (!missing.includes(id)) els.set(id, make(id));
    }
    const sandbox = {
      document: { getElementById: (id) => els.get(id) ?? null },
      console,
    };
    vm.createContext(sandbox);
    vm.runInContext(`var _scEntry="manual";\n${fnSource("scEntry", app)}`, sandbox);
    vm.runInContext(`scEntry(${JSON.stringify(which)})`, sandbox);
    return { els, mode: vm.runInContext("_scEntry", sandbox) };
  }

  test("upload reveals the reader", () => {
    const r = run("upload");
    assert.equal(r.mode, "upload");
    assert.equal(r.els.get("sc-upload-panel").hidden, false);
  });

  test("no drawing hides it", () => {
    const r = run("manual");
    assert.equal(r.mode, "manual");
    assert.equal(r.els.get("sc-upload-panel").hidden, true);
  });

  test("both buttons are kept in step", () => {
    const r = run("upload");
    assert.equal(r.els.get("sc-entry-upload").attrs["aria-pressed"], "true");
    assert.equal(r.els.get("sc-entry-manual").attrs["aria-pressed"], "false");
  });

  test("an unrecognised choice falls to manual rather than to nothing", () => {
    assert.equal(run("nonsense").mode, "manual");
    assert.equal(run(undefined).mode, "manual");
  });

  test("choosing clears nothing", () => {
    /* The pack requires a drawing to be uploadable later "without erasing
       existing data". Somebody can type for ten minutes and then find the
       PDF; the ten minutes has to survive it. */
    const fn = fnSource("scEntry", app);
    assert.equal(/\.value\s*=\s*""/.test(fn), false, "scEntry must not clear a field");
    assert.equal(/scClear|innerHTML\s*=\s*""/.test(fn), false, "nor wipe a panel");
  });

  test("it survives a page that is missing an element", () => {
    // Every lookup is guarded, so a partial render cannot throw here.
    assert.doesNotThrow(() => run("upload", { missing: ["sc-upload-panel"] }));
    assert.doesNotThrow(() => run("manual", { missing: ["sc-entry-manual", "sc-entry-upload"] }));
  });

  test("it is reachable from markup by name, through the table", () => {
    assert.match(app, /scEntry: function \(which\) \{ scEntry\(which\); \}/);
    assert.match(studio(), /data-do="scEntry" data-a="manual"/);
    assert.match(studio(), /data-do="scEntry" data-a="upload"/);
  });
});

/* ------------------------------------------------------------ three columns */

describe("the approved three-column layout", () => {
  const s = studio();

  test("there is one studio grid, holding three columns", () => {
    assert.equal((s.match(/class="bw-studio"/g) || []).length, 1);
    assert.equal((s.match(/class="bw-studio-col/g) || []).length, 3);
  });

  test("the proportions are the approved ones", () => {
    // 28 / 42 / 30 from design/04-APPROVED-STUDIO.md, as fractions rather
    // than fixed widths so it fills a real viewport.
    assert.match(html, /\.bw-studio\{[^}]*grid-template-columns:minmax\(0,28fr\) minmax\(0,42fr\) minmax\(0,30fr\)/);
  });

  test("inputs, then route, then result — in that order", () => {
    const part = s.indexOf("1 &middot; The part");
    const route = s.indexOf("4 &middot; The route");
    const out = s.indexOf('id="sc-out"');
    assert.ok(part > 0 && route > part && out > route,
      "the columns must read left to right the way the work happens");
  });

  test("the result is a column, not a strip under the form", () => {
    // The single biggest difference from the concept: with the result below a
    // long form it is off screen while you are editing the numbers that move it.
    assert.match(s, /class="bw-studio-col bw-studio-result"/);
    assert.equal(/<div id="sc-out" style="margin-top/.test(s), false,
      "sc-out should no longer be a full-width block after the grid");
  });

  test("it stacks rather than clips on a narrow screen", () => {
    assert.match(html, /@media\(max-width:1200px\)\{\.bw-studio\{grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)\}/);
    assert.match(html, /@media\(max-width:860px\)\{\.bw-studio\{grid-template-columns:minmax\(0,1fr\)\}/);
    // The entry pair goes to one column too; index.html is stored with CRLF,
    // so nothing here may assume a bare \n between rules.
    assert.match(html, /@media\(max-width:760px\)\{\.bw-studio-entry\{grid-template-columns:minmax\(0,1fr\)\}\}/);
  });

  test("no column can be squeezed to nothing", () => {
    // minmax(0,…) everywhere: without the zero minimum a long unbroken string
    // in one column pushes the others off the screen.
    const rule = html.slice(html.indexOf(".bw-studio{"), html.indexOf(".bw-studio-col{"));
    assert.equal(/minmax\(0,/.test(rule), true);
    assert.equal(/minmax\((?!0,)/.test(rule), false);
  });
});

/* ------------------------------------------- nothing that worked stopped working */

describe("the existing planner is intact", () => {
  const s = studio();

  test("every field the engine reads is still on the page", () => {
    for (const id of ["sc-qty", "sc-unit", "sc-grade", "sc-bw", "sc-bl", "sc-bt",
      "sc-s1", "sc-s2", "sc-kerf", "sc-edge", "sc-form", "sc-stages", "sc-costs", "sc-out"]) {
      assert.match(s, new RegExp(`id="${id}"`), `${id} went missing in the restructure`);
    }
  });

  test("the drawing reader still exists, just no longer above everything", () => {
    assert.match(s, /id="scx-file"/);
    assert.match(s, /id="scx-out"/);
    assert.match(s, /id="sc-upload-panel"/);
  });

  test("the other two modes are untouched", () => {
    assert.match(markup, /id="sc-mode-cert"/);
    assert.match(markup, /id="sc-mode-mill"/);
  });

  test("the page still binds itself on arrival", () => {
    const at = app.indexOf('ON_ARRIVAL["shouldcost"]');
    assert.notEqual(at, -1);
    assert.match(app.slice(at, at + 200), /scBind\(\)/);
  });
});
