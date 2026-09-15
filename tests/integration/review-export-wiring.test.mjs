/**
 * Export for technical review, on the page.
 *
 * The package is tested on its own. What is tested here is that the page shows
 * what is missing *before* anything is saved, and that nothing about the
 * button reads as sending or approving.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { fnSource, markupOnly } from "../helpers/page.mjs";
import {
  DRAFT_LABEL, FORMATS, snapshot, buildPackage, verifyPackage,
} from "../../src/studio/review-export.mjs";
import { KIND, SCOPE, tolerance, requirement } from "../../src/studio/requirements.mjs";

const app = readFileSync("app.js", "utf8");
const markup = markupOnly();
const page = markup.slice(markup.indexOf('id="sc-mode-material"'), markup.indexOf('id="sc-mode-cert"'));

const dim = (over = {}) => requirement({
  kind: KIND.DIMENSIONAL,
  tolerance: tolerance({ nominal: "10", plusMinus: "0.1", unit: "mm" }),
  ...over,
});

/* ---------------------------------------------------------------- harness */

function studio({ values = {}, reqs = [dim()] } = {}) {
  const els = new Map();
  const mk = (id) => ({ id, value: values[id] ?? "", innerHTML: "", dataset: {},
    setAttribute() {}, style: {} });
  for (const id of ["rev-out", "rev-partrev", "rev-by", "sc-grade", "sc-unit", "req-target"]) {
    els.set(id, mk(id));
  }

  const saved = [];
  const sandbox = {
    document: {
      getElementById: (id) => els.get(id) ?? null,
      createElement: () => ({ set href(v) { this._h = v; }, get href() { return this._h; },
        download: "", click() { saved.push(this.download); } }),
    },
    console,
    Blob: class { constructor(parts) { this.parts = parts; } },
    URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
    scErr: (m) => `<err>${m}</err>`,
    window: {
      BW: {
        DRAFT_LABEL,
        reviewSnapshot: snapshot,
        buildReviewPackage: buildPackage,
        REVIEW_FORMATS: FORMATS,
      },
    },
  };

  vm.createContext(sandbox);
  vm.runInContext([
    `var _scReqs=${JSON.stringify(reqs, (k, v) => (typeof v === "bigint" ? `__b${v}` : v))}
       .map(function(r){ return JSON.parse(JSON.stringify(r), function(k,v){
         return typeof v==="string"&&v.indexOf("__b")===0?BigInt(v.slice(3)):v; }); });`,
    "var _scPackage=null;",
    fnSource("scVal", app), fnSource("scExportReview", app),
    fnSource("scRenderPackage", app), fnSource("B_DRAFT_LABEL", app),
    fnSource("scSaveArtifact", app),
  ].join("\n"), sandbox);

  return {
    els, saved,
    run: (code) => vm.runInContext(code, sandbox),
    runAsync: (code) => vm.runInContext(code, sandbox),
    out: () => els.get("rev-out").innerHTML,
  };
}

/* ------------------------------------------------- what the page shows */

describe("preparing a package", () => {
  let s;
  beforeEach(() => { s = studio({ values: { "sc-grade": "SYN-BRACKET-001" } }); });

  test("it shows the draft label before anything is saved", async () => {
    await s.runAsync("scExportReview();");
    assert.match(s.out(), /DRAFT — FOR TECHNICAL REVIEW/);
  });

  test("it lists what is not included, with the reason", async () => {
    /* The most useful thing in this package is the list of what it does not
       contain, so it appears before a person has saved anything — somebody who
       has already downloaded four files is past reading it. */
    await s.runAsync("scExportReview();");
    assert.match(s.out(), /Not included/);
    assert.match(s.out(), /model\.step/);
    assert.match(s.out(), /No geometry engine is integrated/);
    assert.match(s.out(), /drawing\.pdf/);
  });

  test("it says the package is incomplete, because it is", async () => {
    await s.runAsync("scExportReview();");
    assert.match(s.out(), /This package is incomplete/);
  });

  test("it says plainly that nothing was sent", async () => {
    await s.runAsync("scExportReview();");
    assert.match(s.out(), /Nothing has been sent/);
    assert.match(s.out(), /does not approve the part or record a review/);
  });

  test("each file is offered with part of its hash", async () => {
    await s.runAsync("scExportReview();");
    assert.match(s.out(), /requirement-schedule\.html/);
    assert.match(s.out(), /requirement-schedule\.json/);
    assert.match(s.out(), /review-notes\.md/);
    assert.match(s.out(), /class="bw-rev-hash"/);
  });

  test("with no engine it says so rather than failing silently", async () => {
    s.run("window.BW=null;");
    await s.runAsync("scExportReview();");
    assert.match(s.out(), /engine did not load/);
  });
});

/* ------------------------------------------------------------- saving */

describe("saving an artifact", () => {
  test("saves the bytes whose hash is on screen", async () => {
    /* Rebuilding on save would produce a different timestamp and therefore a
       different hash from the one the person just read. */
    const s = studio({ values: { "sc-grade": "SYN-BRACKET-001" } });
    await s.runAsync("scExportReview();");
    const before = s.run('_scPackage.manifest.files[0].sha256');
    s.run('scSaveArtifact("requirement-schedule.html");');
    const after = s.run('_scPackage.manifest.files[0].sha256');
    assert.equal(before, after, "the package was rebuilt between showing and saving");
    assert.deepEqual(s.saved, ["BuyrWorld-review-requirement-schedule.html"]);
  });

  test("a name that is not in the package saves nothing", () => {
    const s = studio();
    s.run('scSaveArtifact("model.step");');
    assert.deepEqual(s.saved, [], "an unavailable format must not produce an empty file");
  });

  test("saving before preparing does nothing", () => {
    const s = studio();
    s.run('scSaveArtifact("requirement-schedule.html");');
    assert.deepEqual(s.saved, []);
  });
});

/* -------------------------------------------------------------- the page */

describe("it is on the page", () => {
  test("the action is in the result column, under the result", () => {
    const out = page.indexOf('id="sc-out"');
    const rev = page.indexOf("Send for technical review");
    assert.ok(out > 0 && rev > out, "you look at the cost, then decide to send it");
  });

  test("the wording promises no sending and no approval", () => {
    assert.match(page, /Nothing is sent anywhere/);
    assert.match(page, /nothing is approved/);
    assert.equal(/\bemail\b|\binvite\b|\bshare with\b/i.test(page.slice(page.indexOf("Send for technical review"),
      page.indexOf("Send for technical review") + 900)), false);
  });

  test("the button says prepare, not send", () => {
    // It produces files. Calling it "send" would describe something it cannot do.
    assert.match(page, /data-do="scExportReview">Prepare review package</);
  });

  test("the actions are registered", () => {
    for (const name of ["scExportReview", "scSaveArtifact"]) {
      assert.match(app, new RegExp(`${name}: function`), `${name} is not registered`);
    }
  });

  test("the module reaches the page through the mount", () => {
    const mount = readFileSync("mount.mjs", "utf8");
    for (const name of ["reviewSnapshot", "buildReviewPackage", "DRAFT_LABEL"]) {
      assert.match(mount, new RegExp(`\\b${name}\\b`), `${name} is not exposed`);
    }
  });

  test("the export path cannot send anything", () => {
    /* The acceptance check says no message is sent merely by exporting. The
       module cannot; this confirms the page's half cannot either. */
    const fns = [fnSource("scExportReview", app), fnSource("scSaveArtifact", app),
      fnSource("scRenderPackage", app)].join("\n");
    assert.equal(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|mailto:/.test(fns), false);
  });
});
