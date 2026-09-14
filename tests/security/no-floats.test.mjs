/**
 * "No floating point in src/calc" has been a stated rule since September 2026
 * and nothing has ever checked it. The cost-shock simulator was built on
 * `parseFloat` and `toFixed` before it was rewritten, and the rule exists
 * because of that, so leaving it to memory is how it comes back.
 *
 * This is a ratchet, not a purge. Every floating-point construct currently in
 * the calculation layer is listed below with the reason it is tolerable — all
 * of them are either integer counts, boolean-to-number coercions used for sort
 * ordering, or a display figure explicitly named "approx". Anything not on the
 * list fails. The list may shrink; it may not grow without somebody writing
 * down why.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "src/calc";

/**
 * Constructs that mean a real number is in play.
 *
 * `Number.isInteger` is excluded because it is a guard against floats rather
 * than a use of one. A bare decimal literal is caught too: `0.2` in the
 * calculation layer is the thing the rule is about.
 */
const FLOAT = [
  { id: "parseFloat", re: /\bparseFloat\s*\(/g },
  { id: "toFixed", re: /\.toFixed\s*\(/g },
  { id: "Math", re: /\bMath\.(round|floor|ceil|abs|pow|max|min|sqrt)\s*\(/g },
  { id: "Number()", re: /(^|[^.\w])Number\s*\(/g },
  { id: "decimal literal", re: /(^|[^\w.])\d+\.\d+(?![\d])/g },
  { id: "division by a literal", re: /\/\s*1e\d+/g },
];

/**
 * Source with comments and string literals removed, so prose cannot trip it.
 *
 * Layered regexes are not good enough here, and the first version proved it:
 * stripping block comments first left `// 1e9` at the end of a line of real
 * code, which then read as a division. A comment can contain a quote and a
 * string can contain a slash, so this walks the characters instead.
 *
 * Regular-expression literals are not handled — the calculation layer has
 * none, and a scanner that guesses at `/` would be worse than one that does
 * not try. Anything it cannot classify stays in, which fails loudly rather
 * than passing quietly.
 */
function code(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i], next = text[i + 1];
    if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      out += " ";
      i = end < 0 ? text.length : end + 2;
    } else if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      out += " ";
      i = end < 0 ? text.length : end;
    } else if (c === '"' || c === "'" || c === "`") {
      out += '""';
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * The exceptions, each with the reason it stands.
 * Format: "file:construct" -> why.
 */
const ALLOWED = new Map(Object.entries({
  "batna.mjs:Number()": "booleans coerced for sort order, and one display figure named yearsApprox",
  "batna.mjs:division by a literal": "yearsApprox, a display figure, explicitly named as approximate",
  "comparable.mjs:Number()": "booleans coerced so thin pairs sort below the rest",
  "index-series.mjs:Number()": "parsing YYYY-MM into integer months",
  "index-series.mjs:Math": "Math.floor over integer months",
  "learning.mjs:Math": "Math.max over three integer counts of missing fields",
  "negotiation.mjs:Number()": "yearsApprox, a display figure, explicitly named as approximate",
  "negotiation.mjs:division by a literal": "the same yearsApprox figure",
  "outcome.mjs:Math": "a success rate over two integer counts, rounded for display",
  "spend.mjs:Number()": "an already-exact BigInt converted once for display",
  "spend.mjs:Math": "Math.max and Math.ceil over a supplier count",
  "spend.mjs:decimal literal": "the top-fifth threshold; checked to agree with n/5 for every n up to 200,000",
}));

describe("the calculation layer stays on integers", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".mjs"));

  test("there are modules to check, so a passing run means something", () => {
    assert.ok(files.length >= 15, `only ${files.length} modules found in ${DIR}`);
  });

  test("no floating-point construct appears that is not written down", () => {
    const unexplained = [];
    for (const file of files) {
      const src = code(readFileSync(join(DIR, file), "utf8"));
      for (const { id, re } of FLOAT) {
        re.lastIndex = 0;
        if (!re.test(src)) continue;
        const key = `${file}:${id}`;
        if (!ALLOWED.has(key)) unexplained.push(key);
      }
    }
    assert.deepEqual(unexplained, [],
      "Floating point in the calculation layer. Either use the exact primitives, " +
      "or add the construct to ALLOWED with the reason it is safe:\n  " + unexplained.join("\n  "));
  });

  test("the exception list has not gone stale", () => {
    // An entry for something that no longer exists is a licence nobody is
    // using, and the next float to land in that file would inherit it.
    const stale = [];
    for (const key of ALLOWED.keys()) {
      const [file, id] = key.split(":");
      if (!files.includes(file)) { stale.push(key); continue; }
      const def = FLOAT.find((f) => f.id === id);
      const src = code(readFileSync(join(DIR, file), "utf8"));
      def.re.lastIndex = 0;
      if (!def.re.test(src)) stale.push(key);
    }
    assert.deepEqual(stale, [], `these exceptions are no longer needed and should be deleted:\n  ${stale.join("\n  ")}`);
  });

  test("the newest modules carry no exception at all", () => {
    // Everything added from the should-cost work onwards is exact throughout,
    // and the point of the ratchet is that it stays that way.
    for (const file of ["should-cost.mjs", "units.mjs", "sourcing.mjs", "shadow.mjs", "radar.mjs", "portfolio.mjs", "supplier-history.mjs", "cost-bridge.mjs", "fx.mjs", "provenance.mjs"]) {
      for (const { id } of FLOAT) {
        assert.equal(ALLOWED.has(`${file}:${id}`), false, `${file} has acquired a floating-point exception`);
      }
    }
  });

  test("the scanner is not fooled by prose, and does bite", () => {
    // A rule that cannot fail is not a rule. Both halves are checked here.
    assert.equal(code("/* uses parseFloat historically */ const a = 1n;").includes("parseFloat"), false);
    assert.equal(code('const s = "0.25";').includes("0.25"), false);
    const sample = code("const x = parseFloat(y);");
    const def = FLOAT.find((f) => f.id === "parseFloat");
    def.re.lastIndex = 0;
    assert.equal(def.re.test(sample), true);
  });
});
