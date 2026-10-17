/**
 * The page's real escapers, and an attribute decoder that behaves like a
 * browser's. Integration harnesses that stub attrEsc with a quote-only
 * version cannot see what the page actually writes into an attribute; these
 * let a test use the real thing.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const app = readFileSync("app.js", "utf8");

/** The page's own escapers, evaluated from app.js rather than restated. */
export function realEscapers() {
  const grab = (name) => {
    const m = app.match(new RegExp(`^function ${name}\\(t\\)\\{.*\\}$`, "m"));
    assert.ok(m, `${name} is no longer a one-line function in app.js; update this helper`);
    return m[0];
  };
  const box = {};
  vm.createContext(box);
  vm.runInContext(`${grab("ciEsc")}\n${grab("attrEsc")}\nthis.ciEsc = ciEsc; this.attrEsc = attrEsc;`, box);
  return { ciEsc: box.ciEsc, attrEsc: box.attrEsc };
}

/** Decode an attribute value the way an HTML parser does, for the entities attrEsc emits. */
export function decodeAttr(s) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return Object.hasOwn(named, ref.toLowerCase()) ? named[ref.toLowerCase()] : whole;
  });
}
