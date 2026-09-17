/**
 * Every check has to fail when it checks nothing.
 *
 * This suite has now found the same fault five times, and it always looks the
 * same from outside: the check passes. The extraction moved the scripts out of
 * index.html and verify-html.mjs went to "0 scripts, 0 nav targets" while still
 * reporting the page structurally sound. assertUsable() was documented in three
 * places as the backstop for AI-inferred values and had never been handed one.
 * The route scan matched a single quoting style the page had stopped using. A
 * classify test named a behaviour and guarded its assertions behind a condition
 * its fixture never met. And eval-extraction.mjs reported "no ungrounded value
 * was accepted" — a number that is zero when no value was proposed.
 *
 * None of them ever failed. That is the shape: the default outcome of a check
 * that has stopped looking is success.
 *
 * So each check script carries a floor, and this file is what keeps the floors
 * there. It reads source rather than behaviour on purpose — the behaviour is
 * "exit non-zero on an empty corpus", which cannot be exercised without an
 * empty corpus, and the useful thing to defend is that the guard exists at all.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const read = (f) => readFileSync(f, "utf8");

/* Each check, and the count it must refuse to pass on. */
const SCRIPTS = [
  {
    file: "scripts/verify-content.mjs",
    what: "the prohibited-content scan",
    floor: /if \(scanned < FLOOR\)[\s\S]{0,200}process\.exit\(1\)/,
    why: "a scan of no files finds no violations",
  },
  {
    file: "scripts/eval.mjs",
    what: "ProcureBench",
    floor: /if \(CASES\.length === 0 \|\| EVALUABLE\.length === 0 \|\| totalChecks === 0\)[\s\S]{0,300}process\.exit\(1\)/,
    why: "zero failures out of zero cases is not a pass",
  },
  {
    file: "scripts/eval-extraction.mjs",
    what: "claim extraction",
    floor: /if \(results\.length === 0 \|\| claimed === 0 \|\| grounded === 0\)[\s\S]{0,300}process\.exit\(1\)/,
    why: "no ungrounded value is accepted when no value is proposed",
  },
  {
    file: "scripts/verify-html.mjs",
    what: "page integrity",
    floor: /blocks === 0[\s\S]{0,400}goTargets\.length < 5/,
    why: "it once checked 0 scripts and 0 nav targets and called the page sound",
  },
];

describe("a check that has stopped looking fails", () => {
  for (const s of SCRIPTS) {
    test(`${s.what} refuses an empty run — ${s.why}`, () => {
      assert.match(read(s.file), s.floor,
        `${s.file} has lost its floor: it would report success having examined nothing`);
    });
  }

  test("the floor comes before the success path, or it never runs", () => {
    // A guard after `process.exit(0)` is decoration.
    const content = read("scripts/verify-content.mjs");
    assert.ok(content.indexOf("This check has stopped looking") < content.indexOf('console.log("PASS'),
      "the floor must be reached before the pass");
  });

  test("no check script has been added without one", () => {
    const known = new Set(SCRIPTS.map((s) => s.file.replace("scripts/", "")));
    /* A runner, an operator tool, and a fixture generator. None of the
       three examines the tree, so none can stop looking at it — which is the
       thing a floor exists to catch. The exemption is deliberate and listed
       here rather than inferred from the filename. */
    const exempt = new Set([
      "verify.mjs",                 // the runner itself
      "purge-prompt-logs.mjs",      // an operator tool, run by hand
      "make-drawing-fixture.mjs",   // draws a synthetic fixture; examines nothing
    ]);
    for (const name of readdirSync("scripts")) {
      if (!name.endsWith(".mjs") || exempt.has(name)) continue;
      assert.ok(known.has(name),
        `scripts/${name} is a new check with no floor listed here — add one, or exempt it deliberately`);
    }
  });
});

/* ------------------------------------------------ the ratchets in tests */

describe("the ratchets know how much they are looking at", () => {
  test("the float ratchet fails if it finds too few modules", () => {
    assert.match(read("tests/security/no-floats.test.mjs"), /files\.length >= 15/);
  });

  test("the documentation counts are derived, never copied", () => {
    // A stated count that is not compared against the tree is a comment.
    const doc = read("tests/security/documentation.test.mjs");
    assert.match(doc, /the count has drifted/);
    assert.match(doc, /the test-file count has drifted/);
  });
});

/* -------------------------------------------- and the suite itself */

describe("the suite asserts something in every test", () => {
  /* Found by counting executed assertions per test across the whole run: two
     tests executed none. One relied on an exception failing it; the other
     guarded its assertions behind a condition its own fixture never met, so it
     named a behaviour it never checked. Both are fixed, and this keeps the
     shape from coming back in the form that is easiest to write by accident. */
  test("no test body is only a call with no claim about it", () => {
    const offenders = [];
    for (const file of walk("tests")) {
      const src = read(file);
      /* The span from one test() to the next declaration, rather than the
         braces of the body. Counting braces needs to know a regex literal from
         a block, and /\{[^}]*\}/ inside a test is common enough here that the
         brace version reported two healthy tests as empty. The span can only
         err the safe way: it sees more than the body, never less. */
      const starts = [...src.matchAll(/\btest\((["'`])((?:\\.|(?!\1).)*)\1\s*,/g)];
      starts.forEach((m, i) => {
        const from = m.index + m[0].length;
        const next = starts[i + 1] ? starts[i + 1].index : src.length;
        const span = src.slice(from, Math.min(next, src.indexOf("\ndescribe(", from) < 0 ? next
          : Math.min(next, src.indexOf("\ndescribe(", from))));
        if (!/\bassert\b/.test(span)) offenders.push(`${file.replace(/\\/g, "/")} › ${m[2]}`);
      });
    }
    assert.deepEqual(offenders, [],
      "a test that asserts nothing passes for as long as it exists");
  });

  test("and the detector above would notice one", () => {
    /* Otherwise this file joins the list it exists to keep empty.

       The sample is assembled rather than written out: a literal `test(` in
       this file is found by the scan above and taken for a real declaration,
       which is how the first version of this test flagged itself. */
    const t = "te" + "st";
    const sample = `${t}("claims nothing", () => { doSomething(); });\n`
                 + `${t}("claims something", () => { ok(1); });`;
    const starts = [...sample.matchAll(new RegExp(`\\b${t}\\((["'\`])((?:\\\\.|(?!\\1).)*)\\1\\s*,`, "g"))];
    assert.equal(starts.length, 2, "the sample itself was not read");

    const empty = starts.filter((m, i) => {
      const span = sample.slice(m.index + m[0].length, starts[i + 1] ? starts[i + 1].index : sample.length);
      return !/\bok\b/.test(span);
    });
    assert.equal(empty.length, 1);
    assert.equal(empty[0][2], "claims nothing");
  });
});

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith(".test.mjs")) out.push(full);
  }
  return out;
}
