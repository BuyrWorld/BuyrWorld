/**
 * The documentation is checked, not trusted.
 *
 * `CURRENT_STATE.md` described four modules while thirty-four existed, and
 * `SECURITY_REVIEW.md` had no mention of `localStorage` while five stores held
 * data — including a private supplier-quality record. Nobody noticed, because
 * nothing was looking.
 *
 * So the load-bearing claims in those two documents are assertions here. Not
 * the prose, which is allowed to be prose, but the facts somebody would act on:
 * which stores exist, that none of them is ever transmitted, and which parts of
 * the product make no network call at all. If one of those stops being true,
 * this fails rather than the document quietly becoming a lie.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { pageSource } from "../helpers/page.mjs";

const security = readFileSync("docs/SECURITY_REVIEW.md", "utf8");
const state = readFileSync("docs/CURRENT_STATE.md", "utf8");
const html = pageSource();

/** Every module under src/, by path. */
function modules(dir = "src", out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) modules(full, out);
    else if (name.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

const source = (f) => readFileSync(f, "utf8");

/* ------------------------------------------------------------ the stores */

describe("the stores the review lists are the stores that exist", () => {
  /** Keys as the code actually writes them. */
  const keysInCode = () => {
    const found = new Set();
    for (const f of modules("src/services")) {
      const m = source(f).match(/const KEY = "([^"]+)"/);
      if (m) found.add(m[1]);
    }
    return [...found].sort();
  };

  test("there are five, and the review names each one", () => {
    const keys = keysInCode();
    assert.equal(keys.length, 5, `found ${keys.length} stores: ${keys.join(", ")}`);
    for (const key of keys) {
      assert.ok(security.includes(`\`${key}\``), `${key} is not in the data-handling section`);
    }
  });

  test("the review names no store that does not exist", () => {
    const keys = new Set(keysInCode());
    const claimed = [...security.matchAll(/`(bw\.[a-z]+\.v\d)`/g)].map((m) => m[1]);
    for (const c of new Set(claimed)) {
      assert.ok(keys.has(c), `the review describes ${c}, which no module writes`);
    }
  });

  test("the probe key is described as holding nothing, because it does", () => {
    assert.match(security, /`bw\.probe` is written and removed immediately/);
    for (const f of modules("src/services")) {
      const src = source(f);
      if (!src.includes("bw.probe")) continue;
      // Scoped to the availability check, which is the only place the probe
      // belongs. Some stores put the key in a local first, so this matches the
      // sequence rather than the spelling: a write, then a remove, with
      // nothing between them that could return early.
      const start = src.indexOf("export function storageAvailable");
      assert.ok(start > 0, `${f} uses the probe outside an availability check`);
      const body = src.slice(start, src.indexOf("\n}", start));
      const write = body.search(/setItem\(/);
      const remove = body.search(/removeItem\(/);
      assert.ok(write >= 0 && remove > write, `${f} writes the probe without removing it`);
      assert.equal(/\breturn\b|\bthrow\b/.test(body.slice(write, remove)), false,
        `${f} can leave the probe behind`);
    }
  });

  test("the lot store is singled out, because it holds the most", () => {
    // Producers, confirmed issues, who was blamed, and who decided. If that
    // stops being the most sensitive store the emphasis should move.
    assert.match(security, /`bw\.lots\.v1` is the one to think hardest about/);
    assert.match(security, /private to this browser/);
  });
});

/* -------------------------------------------------- the network isolation */

describe("no store is ever transmitted, as the review claims", () => {
  const LOADERS = ["loadCases", "loadOutcomes", "loadParts", "loadLots", "loadEstimates"];

  test("the claim is in the review, so it can be checked against", () => {
    assert.match(security, /\*\*No store is ever sent anywhere\.\*\*/);
  });

  test("no loader appears inside a request body", () => {
    // The check the review says was done by grep rather than by memory.
    const bodies = [...html.matchAll(/body:\s*JSON\.stringify\(([\s\S]{0,400}?)\)\s*\}/g)].map((m) => m[1]);
    assert.ok(bodies.length >= 3, `expected the request bodies, found ${bodies.length}`);
    for (const body of bodies) {
      for (const loader of LOADERS) {
        assert.equal(body.includes(loader), false, `${loader} reaches a request body`);
      }
    }
  });

  test("no store module fetches anything itself", () => {
    for (const f of modules("src/services")) {
      assert.equal(/\bfetch\s*\(/.test(source(f)), false, `${f} makes a network call`);
    }
  });

  test("nothing in the calculation or intake layers fetches either", () => {
    for (const f of [...modules("src/calc"), ...modules("src/intake"), ...modules("src/domain")]) {
      assert.equal(/\bfetch\s*\(/.test(source(f)), false, `${f} makes a network call`);
    }
  });
});

describe("what the review says never touches the network, does not", () => {
  /** One named page function's source. */
  const fn = (name) => {
    const start = html.indexOf(`function ${name}(`);
    assert.ok(start > 0, `${name} not found`);
    const end = html.indexOf("\nfunction ", start + 1);
    return html.slice(start, end < 0 ? html.length : end);
  };

  test("the should-cost, certificate and mill paths make no model call", () => {
    for (const name of ["scRun", "ctRun", "mlRun", "ctDecide", "bcCompareHTML", "bcSave"]) {
      const src = fn(name);
      assert.equal(/fetch\s*\(|\/api\/chat|callAI/.test(src), false, `${name} calls out`);
    }
  });

  test("the extraction path makes no model call", () => {
    for (const name of ["exRead", "exApply", "exResultHTML"]) {
      assert.equal(/\/api\/chat|callAI/.test(fn(name)), false, `${name} calls the model`);
    }
  });

  test("the review says why that is, not merely that it is", () => {
    assert.match(security, /nothing to inject/);
    assert.match(security, /matches no rule/);
  });
});

/* --------------------------------------------------------- the pdf worker */

describe("the one fetched script that is executed is checked first", () => {
  test("the review describes the control", () => {
    assert.match(security, /SHA-512/);
    assert.match(security, /refuses an unpinned worker/);
    assert.match(security, /Failing closed on an unknown URL is the part that matters/);
  });

  test("the control is really there", () => {
    const src = html.slice(html.indexOf("async function verifiedWorkerURL("));
    assert.match(src, /Refusing to load an unpinned worker/);
    assert.match(src, /crypto\.subtle\.digest\("SHA-512"/);
    assert.match(src, /credentials:"omit"/);
    assert.match(src, /failed its integrity check and was not run/);
  });

  test("every third-party script is pinned, and the review says so", () => {
    // This test exists because the review once said the opposite. It claimed
    // five of six libraries had no integrity check, on the strength of
    // grepping index.html for an attribute that was never going to be there:
    // nothing is loaded by a static tag. Checking the control instead of the
    // spelling is the whole difference.
    const app = readFileSync("app.js", "utf8");
    const loader = app.slice(app.indexOf("function loadScript("));
    assert.match(loader, /Refusing to load an unpinned third-party script/,
      "loadScript must fail closed on a URL with no hash");
    assert.match(loader, /s\.integrity=integrity/);
    assert.match(loader, /crossOrigin="anonymous"/,
      "without this the browser cannot check the hash at all");

    const map = app.slice(app.indexOf("const SRI = {"), app.indexOf("function loadScript("));
    const pinned = [...map.matchAll(/"(https:\/\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(pinned.length >= 5, `the pin map has shrunk to ${pinned.length}`);
    for (const url of new Set([...app.matchAll(/loadScript\("(https:\/\/[^"]+)"/g)].map((m) => m[1]))) {
      assert.ok(pinned.includes(url), `${url} is loaded but carries no hash`);
    }
    assert.match(security, /All of them are pinned/);
  });

  test("the correction is left visible rather than edited out", () => {
    // A security document that silently changes its mind is not one anybody
    // should rely on.
    assert.match(security, /This entry was wrong and has been corrected/);
  });
});

/* ------------------------------------------------------- the state document */

describe("the state document knows what exists", () => {
  test("every module is named in it", () => {
    const missing = modules()
      .map((f) => f.split(/[\\/]/).pop())
      .filter((name) => !state.includes(name));
    assert.deepEqual(missing, [],
      `modules the state document has never heard of:\n  ${missing.join("\n  ")}`);
  });

  test("it names no module that has gone", () => {
    const real = new Set(modules().map((f) => f.split(/[\\/]/).pop()));
    const claimed = [...state.matchAll(/`([a-z-]+\.mjs)`/g)].map((m) => m[1]);
    for (const c of new Set(claimed)) {
      assert.ok(real.has(c), `the state document describes ${c}, which no longer exists`);
    }
  });

  test("the module count it states is the module count there is", () => {
    const stated = Number((state.match(/Modules under `src\/` \| 0 \| (\d+) \|/) || [])[1]);
    assert.equal(stated, modules().length, "the count has drifted");
  });

  test("the test-file count it states is right", () => {
    const stated = Number((state.match(/Test files \| 0 \| (\d+) \|/) || [])[1]);
    const actual = (function count(dir, n = 0) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        n = e.isDirectory() ? count(join(dir, e.name), n) : (e.name.endsWith(".test.mjs") ? n + 1 : n);
      }
      return n;
    })("tests");
    assert.equal(stated, actual, "the test-file count has drifted");
  });

  test("the inline-handler figure matches what is there", () => {
    const stated = Number((state.match(/Inline event handlers \| — \| (\d+)/) || [])[1]);
    // Every event attribute, not the six the old ratchet counted. It never
    // knew about onkeydown, and eight were hiding behind that.
    const actual = (html.match(/\son[a-z]+="/g) || []).length;
    assert.equal(stated, actual, "the state document and the page disagree");
    assert.equal(actual, 0, "they agree, and they agree on zero");
  });

  test("it says plainly what is still not true", () => {
    // The section that will be tempting to quietly delete.
    assert.match(state, /Nobody has used it/);
    assert.match(state, /corpus of zero/);
    assert.match(state, /Upstash purge is outstanding/);
  });
});

/* -------------------------------------------------------- what it promises */

describe("the review does not invent what it cannot know", () => {
  test("it says so, in as many words", () => {
    assert.match(security, /Nothing here is a policy, a legal\s+position or a commitment/);
  });

  test("it leaves retention and lawful basis open rather than guessing", () => {
    // Matched on a single line so a reflow does not fail the test; the point
    // is that the words are there, not where they wrap.
    const flat = security.replace(/\s+/g, " ");
    assert.match(flat, /Retention, lawful basis, controller and processor roles/);
    assert.match(flat, /deliberately left open rather than guessed at/);
  });

  test("it names what has not been assessed at all", () => {
    for (const gap of ["penetration test", "unsafe-inline", "reviewed by anyone but the author"]) {
      assert.ok(security.includes(gap), `the review does not mention: ${gap}`);
    }
  });
});
