/**
 * What goes into an attribute comes back out unchanged.
 *
 * A browser decodes an attribute exactly once. attrEsc escapes & < > " and ',
 * which is everything an attribute needs, so it must be applied exactly once.
 * For two weeks 33 call sites wrapped it round ciEsc as well, on the belief
 * that attrEsc left angle brackets alone. It never did. The ampersand was
 * escaped twice, so "Steel & energy" came back as "Steel &amp; energy", and
 * every screen that reads a field back and redraws it — call preparation,
 * practice, the what-ifs, saved drafts — grew another "amp;" each time.
 *
 * The integration tests did not see it because their harnesses stub attrEsc
 * with a version that escapes only the quote, which is the same mistaken
 * belief written down as a fixture. These tests use the page's real escapers.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { realEscapers, decodeAttr } from "../helpers/escapers.mjs";

const app = readFileSync("app.js", "utf8");

const AWKWARD = [
  "Steel & energy",
  "<2025 base>",
  `He said "9%" and she said '4%'`,
  "&amp; already looks escaped",
  "a < b && c > d",
  "",
];

describe("attrEsc, applied once", () => {
  const { attrEsc } = realEscapers();

  test("every awkward string survives the round trip", () => {
    for (const s of AWKWARD) assert.equal(decodeAttr(attrEsc(s)), s, JSON.stringify(s));
  });

  test("and is stable when read back and drawn again, which is what a redraw does", () => {
    for (const s of AWKWARD) {
      let v = s;
      for (let i = 0; i < 3; i++) v = decodeAttr(attrEsc(v));
      assert.equal(v, s, JSON.stringify(s));
    }
  });

  test("leaves nothing in the attribute that could close it or open a tag", () => {
    for (const s of AWKWARD) assert.doesNotMatch(attrEsc(s), /["'<>]/);
  });
});

describe("no attribute is escaped twice", () => {
  test("app.js never wraps attrEsc round another escaper", () => {
    const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const doubled = [...code.matchAll(/attrEsc\(\s*(ciEsc|esc)\(/g)];
    assert.equal(doubled.length, 0,
      "attrEsc already escapes & < > \" and '. Wrapping it round ciEsc or esc escapes the "
      + "ampersand twice and corrupts the text on every redraw.");
  });
});
