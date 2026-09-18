/**
 * What the public pages claim, against what the product does.
 *
 * The home page said **"No account, nothing stored"** while six localStorage
 * stores held cases, outcomes, parts, reviewed lots, estimates and scenarios.
 * The site's own legal page says it accurately in section 3 — "What stays in
 * your browser" — so the hero was contradicting a page two clicks away.
 *
 * A privacy claim is the last place to be loose. "Nothing stored" is the kind
 * of wrong that sounds like a promise, and somebody deciding whether to paste
 * a supplier letter into this would be deciding on it.
 *
 * It also said "Four ways in" above five pillars: true when written, wrong
 * from the day a fifth was added.
 *
 * Neither was caught by anything. Every other figure on this site is derived
 * or ratcheted; these two were prose.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { pageSource, markupOnly } from "../helpers/page.mjs";

const html = pageSource();
const markup = markupOnly();
const app = readFileSync("app.js", "utf8");

const home = markup.slice(markup.indexOf('id="page-home"'),
  markup.indexOf('<div class="page"', markup.indexOf('id="page-home"') + 10));

/** Every localStorage key the product actually writes. */
function storageKeys() {
  const keys = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".mjs")) {
        for (const m of readFileSync(full, "utf8").matchAll(/"(bw\.[a-z]+\.v\d)"/g)) keys.add(m[1]);
      }
    }
  };
  walk("src");
  return [...keys];
}

/* ------------------------------------------------------------- storage */

describe("what the site says about storage is true", () => {
  test("the product does store things, which is the fact to be honest about", () => {
    const keys = storageKeys();
    assert.ok(keys.length >= 5,
      `only ${keys.length} stores found — this test is checking the wrong thing`);
  });

  test("no page claims nothing is stored", () => {
    /* The exact words that were there. Kept as a test rather than only a fix,
       because the sentence is short, reassuring and easy to reach for again. */
    assert.equal(/nothing stored|nothing is stored|no data is stored/i.test(markup), false,
      "a page claims nothing is stored while six localStorage stores exist");
  });

  test("the home page says where saved work goes instead", () => {
    assert.match(home, /Saved work stays in this browser/);
  });

  test("and does not promise more than the legal page does", () => {
    /* The legal page is precise: file contents are parsed locally, and only
       text submitted to an AI tool leaves the device. The hero must not
       out-promise it by saying everything stays put. */
    assert.equal(/nothing leaves|never leaves your (browser|device|computer)/i.test(home), false,
      "the hero must not claim more than section 3 of the legal page");
  });

  test("the legal page still explains it properly", () => {
    const legal = markup.slice(markup.indexOf('id="page-legal"'),
      markup.indexOf('<div class="page"', markup.indexOf('id="page-legal"') + 10));
    assert.match(legal, /What stays in your browser/);
    assert.match(legal, /Only the text you choose to submit to an AI tool leaves your device/);
  });
});

/* --------------------------------------------------------------- counts */

describe("a number in prose matches what it counts", () => {
  test("the pillars sentence is derived, not written beside the list", () => {
    /* "Four ways in" was true once. Changing it to "Five" would be true once
       too. The sentence counts the list now, so the next person to add a
       pillar cannot make the page wrong by not noticing. */
    assert.match(html, /intro\.textContent=\(PILLAR_WORDS\[n\]\|\|String\(n\)\)/);
    assert.match(markup, /<p id="pillars-intro"/);
  });

  test("no stale count is left in the markup", () => {
    assert.equal(/(Four|Five|Three|Six) ways in/.test(markup), false,
      "the count belongs with the list, not in the page source");
  });

  test("the word for the actual number of pillars exists", () => {
    const at = app.indexOf("const PILLARS=[");
    const list = app.slice(at, app.indexOf("\n];", at));
    const count = (list.match(/^\["/gm) || []).length;
    assert.ok(count >= 4, `found ${count} pillars, which looks wrong`);

    const words = JSON.parse(
      (app.match(/var PILLAR_WORDS=(\[[^\]]+\]);/) || [])[1].replace(/'/g, '"'));
    assert.ok(words[count], `${count} pillars and no word for it`);
  });
});

/* ------------------------------------------------------- the wider habit */

describe("the public pages do not overstate what this is", () => {
  test("no page calls the demonstrations real", () => {
    assert.equal(/real (customer|supplier) (data|results)/i.test(markup), false);
  });

  test("the synthetic-data claim is still there, because it is true", () => {
    assert.match(home, /Synthetic<\/b> data only/);
  });
});

/* ------------------------------------------------- what it calls a CAD file */

describe("nothing is labelled as a solid model it is not", () => {
  /* `specs/02`'s Phase 5 gate ends: *"never relabel an SVG or mesh as
     STEP/native CAD."* The temptation is specific and cheap — the part view is
     already an SVG and the DXF is already geometry, and either could be handed
     over under a name an engineer would open expecting a solid. What stops it
     is that no such filename exists anywhere in what the product writes out. */

  const produced = [markup, app, readFileSync("mount.mjs", "utf8")].join("\n")
    + readdirSync("src/studio")
      .map((f) => readFileSync(join("src/studio", f), "utf8")).join("\n");

  test("no artifact is written out under a solid-model name", () => {
    /* `files["…"] = …` is how the package names what it ships, so that shape
       is what is searched for. `model.step` appears in FORMATS as an entry
       saying it does not exist, which is a description rather than an offer. */
    const written = [...produced.matchAll(/files\[\s*"([^"]+)"\s*\]\s*=/g)].map((m) => m[1]);
    for (const name of written) {
      assert.equal(/\.(step|stp|iges|igs|sldprt|x_t|prt)$/i.test(name), false,
        `${name} is written out under a name an engineer would open as a solid`);
    }
    assert.ok(written.length >= 3, "no written artifacts were found, so this checked nothing");
  });

  test("the formats it cannot produce are listed as unavailable, with reasons", async () => {
    const { FORMATS } = await import("../../src/studio/review-export.mjs");
    assert.equal(FORMATS["model.step"].available, false);
    assert.ok(FORMATS["model.step"].why.length > 80,
      "an unavailable format needs a reason somebody can act on");
  });

  test("and nothing in the product says the SVG or the DXF is one", () => {
    for (const claim of [
      /(svg|dxf|preview)[^.]{0,40}\b(is|as)\s+(a\s+)?(step|solid model|native cad)\b/i,
      /\b(step|native cad)\s+(file\s+)?(export|download)\s+(is\s+)?(available|ready|supported)\b/i,
    ]) {
      assert.equal(claim.test(produced), false, `something claims ${claim}`);
    }
  });
});

/* ------------------------------------------------------------- the README */

describe("the README says the same things the product does", () => {
  /* It is the first thing a stranger reads, on a public repository, about a
     product whose whole discipline is not overstating itself. Everything in it
     that can be checked, is. */
  const readme = readFileSync("README.md", "utf8");

  test("it does not claim the browser pass has happened", () => {
    assert.match(readme, /never been opened in a browser/);
  });

  test("it says the data is synthetic, in the same words the site does", () => {
    assert.match(readme, /synthetic/i);
    assert.equal(/real (customer|supplier) (data|results)/i.test(readme), false);
  });

  test("it makes no accuracy claim about reading documents", () => {
    assert.match(readme, /not accurate at reading documents, and does not claim to be/);
  });

  test("it does not say there is a CAD export", () => {
    assert.equal(/\b(step|native cad) (export|file) (is )?(available|supported)\b/i.test(readme), false);
  });

  test("the test count it states is the one the checks run", () => {
    const stated = (readme.match(/([\d,]+) tests, \d+ checks/) || [])[1];
    const handover = (readFileSync("docs/OWNER_HANDOVER.md", "utf8")
      .match(/([\d,]+) tests across/) || [])[1];
    assert.equal(stated, handover, "the README and the handover disagree about the test count");
  });

  test("every document it points at is there", () => {
    for (const m of readme.matchAll(/\]\((docs\/[A-Z-]+\.md|[A-Z-]+\.md)\)/g)) {
      assert.doesNotThrow(() => readFileSync(m[1]),
        `the README links to ${m[1]}, which is not there`);
    }
  });

  test("and it does not offer a licence the repository has not granted", () => {
    assert.match(readme, /No licence is granted/);
  });
});
