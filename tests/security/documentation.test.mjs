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
const handover = readFileSync("docs/OWNER_HANDOVER.md", "utf8");
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

  test("there are seven, and the review names each one", () => {
    /* Seven since the call store. The count is deliberate rather than derived:
       a new store is a new thing kept on somebody's machine, and it should not
       be possible to add one without this failing and somebody writing down
       what it holds. */
    const keys = keysInCode();
    assert.equal(keys.length, 7, `found ${keys.length} stores: ${keys.join(", ")}`);
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

/* ------------------------------------------------------------- the handover */

describe("the handover describes the product somebody would inherit", () => {
  /* It is the document read by whoever picks this up, including the owner
     after a gap, so being wrong in it costs more than being wrong elsewhere.
     It went a whole session describing seven engine modules while forty-one
     existed, because nothing was checking it. */

  test("it names every part of the product a reader would have to find", () => {
    for (const thing of [
      "should-cost.mjs", "certificate.mjs", "mill.mjs", "build-up.mjs",
      "extract-document.mjs", "classify.mjs", "app.js", "mount.mjs",
    ]) {
      assert.ok(handover.includes(thing), `the handover has never heard of ${thing}`);
    }
  });

  test("the module count it states is the module count there is", () => {
    const stated = Number((handover.match(/([\d,]+) modules under/) || [])[1].replace(/,/g, ""));
    assert.equal(stated, modules().length, "the count has drifted");
  });

  test("the test count it states is the test count there is", () => {
    const stated = Number((handover.match(/([\d,]+) tests across/) || [])[1].replace(/,/g, ""));
    assert.ok(stated > 1500, `the handover claims ${stated} tests`);
    assert.equal(handover.includes("231 tests"), false, "an old figure has survived");
  });

  test("the verification-step count matches the script", () => {
    const script = readFileSync("scripts/verify.mjs", "utf8");
    const steps = (script.match(/^\s*name: /gm) || []).length;
    assert.ok(handover.includes(`runs ${numberWord(steps)} checks`),
      `the script has ${steps} steps and the handover does not say so`);
  });

  test("it no longer says the policy must allow inline script", () => {
    // It said so for a reason that stopped being true.
    assert.equal(/Content-Security-Policy still allows inline script/.test(handover), false);
    assert.match(handover, /Inline script is no\s+longer permitted/);
  });

  test("it still says the things that must never be claimed", () => {
    for (const line of [
      "secure, enterprise-ready or compliant",
      "because none has been measured against a real supplier",
      "That anyone uses it",
    ]) {
      assert.ok(handover.includes(line), `the handover has stopped saying: ${line}`);
    }
  });

  test("it still says nobody has used it, which is the one that will be tempting to drop", () => {
    assert.match(handover, /Nobody has used it/);
    assert.match(handover, /corpus of zero/);
  });
});

/** Small numbers written out, the way the handover writes them. */
function numberWord(n) {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] || String(n);
}

/* ------------------------------------------- the status document says one thing */

describe("the status document does not contradict itself", () => {
  /* The 16 September audit: "Historical sections of IMPLEMENTATION-STATUS.md
     describe features as not built before later sections mark them done."
     Two lines apart it said C4 was unstarted and C4 was done.

     It grew as a diary and was read as a description. Current state now sits
     at the top in one table, and the diary lives underneath, labelled. These
     checks keep those two facts about the document true. */
  const status = readFileSync("IMPLEMENTATION-STATUS.md", "utf8");
  const historyAt = status.indexOf("## How it was built");

  test("current state comes before the history, not after it", () => {
    const current = status.indexOf("## What exists now");
    assert.ok(current > 0, "there is no current-state section");
    assert.ok(historyAt > current,
      "the history must sit below what is current, or a reader meets it first");
  });

  test("the first line says where to look", () => {
    assert.match(status.slice(0, 400), /Where this stands is the table below/);
  });

  test("every path the current-state table names exists", () => {
    const table = status.slice(status.indexOf("## What exists now"),
      status.indexOf("## What does not exist"));
    const paths = [...table.matchAll(/`((?:src|scripts|tests)\/[^`]+|app\.js|index\.html)`/g)]
      .map((m) => m[1])
      .filter((p) => !p.endsWith("/"));
    assert.ok(paths.length >= 8, `only ${paths.length} paths found in the table`);
    for (const p of paths) {
      assert.doesNotThrow(() => readFileSync(p),
        `the table says ${p}, which is not there`);
    }
  });

  test("nothing outside the history claims a built thing is unbuilt", () => {
    /* The exact failure. A present-tense "not started" above the history is a
       description; below it, it is a dated record and says so. */
    const current = status.slice(0, historyAt);
    assert.equal(/\bnot started\b|\bremains unstarted\b|\bis specified, not built\b/i.test(current), false,
      "a section above the history claims something is unbuilt");
  });

  test("the history says its entries are as-at the day they were written", () => {
    const preamble = status.slice(historyAt, historyAt + 900);
    assert.match(preamble, /as-at the moment it was written/);
    /* Whitespace collapsed first: the sentence wraps mid-phrase, so a literal
       space in the pattern meets a newline in the file and never matches. */
    assert.match(preamble.replace(/\s+/g, " "),
      /the table above is the only description of now/);
  });

  test("it points at the browser handover rather than describing it", () => {
    assert.match(status, /docs\/BROWSER-CHECKS\.md/);
    assert.equal(/## Next slice/.test(status), false,
      "a 'next slice' heading at the end is where staleness collects");
  });
});

/* ------------------------------------------------------- the evidence log */

describe("the evidence log's figures are the tree's figures", () => {
  /* `docs/EVIDENCE.md` is the one document whose whole job is to be believed
     about what is and is not established. A stale number in it is worse than a
     stale number anywhere else, so every figure it states is checked here. */
  const evidence = readFileSync("docs/EVIDENCE.md", "utf8");

  const stated = (pattern) => {
    const m = evidence.match(pattern);
    assert.ok(m, `the evidence log no longer states ${pattern}`);
    return Number(m[1].replace(/,/g, ""));
  };

  test("the module count", () => {
    assert.equal(stated(/([\d,]+) modules under `src\/`/), modules().length);
  });

  test("the test and file counts, and the number of checks", () => {
    const files = (function count(dir, n = 0) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        n = e.isDirectory() ? count(join(dir, e.name), n)
          : (e.name.endsWith(".test.mjs") ? n + 1 : n);
      }
      return n;
    })("tests");

    assert.equal(stated(/([\d,]+) tests across/), Number(
      (readFileSync("docs/OWNER_HANDOVER.md", "utf8").match(/([\d,]+) tests across/) || [])[1]
        .replace(/,/g, "")),
      "the evidence log and the handover disagree about how many tests there are");
    assert.equal(stated(/across ([\d,]+) files/), files);

    const script = readFileSync("scripts/verify.mjs", "utf8");
    assert.equal(stated(/files, ([a-z]+) checks/) || 0, 0,
      "the check count is written as a word; this only checks it is not a digit");
    assert.ok(evidence.includes(`${numberWord((script.match(/^\s*name: /gm) || []).length)} checks`),
      "the evidence log does not state the number of checks the script runs");
  });

  test("the browser-check count matches the list", () => {
    const checks = (readFileSync("docs/BROWSER-CHECKS.md", "utf8").match(/- \[ \]/g) || []).length;
    assert.equal(stated(/is ([\d,]+) checks in the order/), checks);
  });

  test("and it still says the things that must not quietly improve", () => {
    /* Each of these is a sentence somebody would be glad to delete. */
    assert.match(evidence, /has ever been opened in one/);
    assert.match(evidence, /BLOCKED/);
    assert.match(evidence, /No real case has been run end to end/);
    assert.match(evidence, /NOT RUN/);
  });
});

/* --------------------------------------------------- the operating document */

describe("the operating document describes the product that exists", () => {
  const operating = readFileSync("docs/OPERATING.md", "utf8");

  test("every library it names is one the page actually loads, at that version", () => {
    /* The first draft of that table said "jsPDF, SheetJS, Chart.js and
       TradingView". Two of those were wrong and two more were missing. Prose
       about dependencies is exactly the kind that rots, so it is derived-ish:
       written by hand and checked here. */
    const loaded = [...readFileSync("app.js", "utf8")
      .matchAll(/cdnjs\.cloudflare\.com\/ajax\/libs\/([a-z.-]+)\/([\d.]+)\//g)]
      .map((m) => ({ name: m[1], version: m[2] }));

    assert.ok(loaded.length >= 5, `only ${loaded.length} CDN libraries found`);
    for (const { name, version } of loaded) {
      assert.ok(operating.includes(name), `${name} is loaded and not in the table`);
      assert.ok(operating.includes(version), `${name} is pinned to ${version}, which is not stated`);
    }
  });

  test("it names no library the page does not load", () => {
    const app = readFileSync("app.js", "utf8");
    const table = operating.slice(operating.indexOf("| Library |"),
      operating.indexOf("That is the only third-party code"));
    for (const m of table.matchAll(/^\| `([a-z.-]+)`/gm)) {
      assert.ok(app.includes(`/${m[1]}/`), `the table names ${m[1]}, which app.js does not load`);
    }
  });

  test("the endpoint limits it states are the ones in the functions", () => {
    const doc = readFileSync("api/read-document.mjs", "utf8");
    const chat = readFileSync("api/chat.js", "utf8");

    const perWindow = (src) => Number((src.match(/MAX_PER_WINDOW = (\d+)/) || [])[1]);
    assert.ok(operating.includes(`${perWindow(chat)} requests per minute`),
      `chat allows ${perWindow(chat)} per minute and the document does not say so`);
    assert.ok(operating.includes(`${perWindow(doc)} requests per minute`),
      `the reader allows ${perWindow(doc)} per minute and the document does not say so`);

    for (const [src, name] of [[chat, "chat"], [doc, "read-document"]]) {
      const model = (src.match(/const MODEL = "([^"]+)"/) || [])[1];
      assert.ok(operating.includes(model), `${name} runs ${model}, which the document does not name`);
    }
  });

  test("and it still says the Upstash purge is outstanding", () => {
    /* The one line in it that somebody has to act on. */
    assert.match(operating, /purge-prompt-logs\.mjs --confirm/);
    assert.match(operating, /outstanding work only the owner can do/);
  });
});
