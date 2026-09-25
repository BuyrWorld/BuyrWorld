/**
 * Saying so when the calculation engine is not there.
 *
 * `window.BW` is mounted by mount.mjs, which became a separate module request
 * when the page dropped `unsafe-inline` from script-src. A separate request
 * can 404, be served as the wrong media type, or be refused by a policy — the
 * media-type case had to be fixed in vercel.json the same afternoon, so this
 * is a real failure rather than a theoretical one.
 *
 * Thirty-four controls check for the engine and return without a word. A
 * button that does nothing, forever, with no explanation is the worst way for
 * software to fail: it reads as the user's mistake. These tests hold the
 * three things that stop it — the banner appears, it names which failure it
 * was, and it never appears when the engine is fine.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { pageSource, markupOnly } from "../helpers/page.mjs";

const app = readFileSync("app.js", "utf8");
const html = pageSource();

/** Just the engine block, driven directly. */
function engine({ hasBW = false, response = null, fetchFails = false } = {}) {
  const start = app.indexOf("var ENGINE_MISSING_TEXT");
  const end = app.indexOf("/* ======================================================= action dispatch ===");
  assert.ok(start > 0 && end > start, "the engine block is not where this test expects it");

  const body = { firstChild: null, insertBefore(el) { body.firstChild = el; }, appendChild(el) { body.firstChild = el; } };
  const made = [];
  const listeners = {};
  let fetched = null;

  const sandbox = {
    document: {
      body,
      /* The script tag the page loaded the engine with. engineUrl() reads its
         src so the diagnostic checks the same URL — version and all — that
         the browser actually asked for, rather than a bare path that is a
         different cache entry. */
      querySelector: (sel) => (sel.includes("mount.mjs")
        ? { getAttribute: (k) => (k === "src" ? "/mount.mjs?v=test" : null) }
        : null),
      getElementById: (id) => made.find((e) => e.id === id) || null,
      createElement: () => {
        const el = { id: "", innerHTML: "", style: { cssText: "" }, setAttribute(k, v) { el[k] = v; } };
        made.push(el);
        return el;
      },
    },
    window: {
      addEventListener: (t, f) => { listeners[t] = f; },
      ...(hasBW ? { BW: { ok: true } } : {}),
    },
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    fetch: (url, opts) => {
      fetched = { url, opts };
      return fetchFails
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(response);
    },
    console,
  };
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(app.slice(start, end), sandbox);

  return {
    made, listeners,
    get fetched() { return fetched; },
    banner: () => made.find((e) => e.id === "bw-engine-missing"),
    note: () => vm.runInContext("engineNote();", sandbox),
    async load() {
      assert.ok(listeners.load, "nothing listens for load");
      listeners.load();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    },
  };
}

const ok = (type) => ({ ok: true, status: 200, headers: { get: () => type } });
const status = (code) => ({ ok: false, status: code, headers: { get: () => "text/html" } });

describe("when the engine is there", () => {
  test("nothing is said and nothing is fetched", async () => {
    const e = engine({ hasBW: true });
    await e.load();
    assert.equal(e.banner(), undefined, "a banner appeared on a working page");
    assert.equal(e.fetched, null, "a diagnostic request was made for no reason");
  });
});

describe("when it is not", () => {
  test("a banner appears, and says what it means for the user", async () => {
    const e = engine({ response: ok("text/javascript") });
    await e.load();
    const b = e.banner();
    assert.ok(b, "no banner on a page with no engine");
    assert.match(b.innerHTML, /did not load/);
    assert.match(b.innerHTML, /anything that works out a figure will do nothing/);
    assert.match(b.innerHTML, /Nothing you have saved is affected/,
      "the first thing somebody wants to know is whether they have lost work");
  });

  test("it is announced to a screen reader, not just coloured", () => {
    const e = engine({ response: ok("text/javascript") });
    e.listeners.load();
    assert.equal(e.banner().role, "alert");
  });

  test("it is checked after load, because a module runs after parsing", () => {
    // Checking any earlier reports a failure that has not happened yet.
    assert.match(app, /window\.addEventListener\("load", function \(\) \{\s*\n?\s*if \(window\.BW\) return;/);
  });
});

describe("which of the three failures it was", () => {
  test("a 404 says the engine is not deployed", async () => {
    const e = engine({ response: status(404) });
    await e.load();
    assert.match(e.banner().innerHTML, /returned 404/);
    assert.match(e.banner().innerHTML, /not deployed with this page/);
  });

  test("the wrong media type says so, because that is a hosting rule", async () => {
    // This one is not hypothetical: the content-type rule covered /src/ only
    // when the mount moved to the root, and had to be widened.
    const e = engine({ response: ok("text/plain") });
    await e.load();
    assert.match(e.banner().innerHTML, /served as text\/plain rather than JavaScript/);
    assert.match(e.banner().innerHTML, /refused to run it/);
  });

  test("reachable but not running sends the reader to the console", async () => {
    const e = engine({ response: ok("text/javascript") });
    await e.load();
    assert.match(e.banner().innerHTML, /reached and did not run/);
    assert.match(e.banner().innerHTML, /content security\s+policy or a syntax error will be named there/);
  });

  test("unreachable is distinguished from all three", async () => {
    const e = engine({ fetchFails: true });
    await e.load();
    assert.match(e.banner().innerHTML, /could not be fetched at all/);
  });

  test("the diagnostic asks for the file itself, uncached", async () => {
    const e = engine({ response: ok("text/javascript") });
    await e.load();
    /* The versioned URL the stub's script tag carries, not the bare path:
       they are different cache entries, and checking the wrong one would
       report on a file the page never loaded. */
    assert.equal(e.fetched.url, "/mount.mjs?v=test");
    assert.equal(e.fetched.opts.cache, "no-store", "a cached answer would describe the wrong deploy");
  });

  test("the banner is replaced rather than repeated", async () => {
    const e = engine({ response: status(404) });
    await e.load();
    assert.equal(e.made.filter((x) => x.id === "bw-engine-missing").length, 1);
  });
});

describe("at the point of action, not only at the top", () => {
  test("the note is the same sentence as the banner", () => {
    const e = engine({ response: ok("text/javascript") });
    assert.match(e.note(), /did not load/);
    assert.match(e.note(), /Nothing you have saved is affected/);
  });

  test("the claim reviewer uses it, replacing its own older wording", () => {
    // It used to say the page "must be served over http rather than opened
    // from the file system", which was the only failure that existed when the
    // engine was inline and is now the least likely of four.
    assert.match(app, /if\(!window\.BW\)\{ out\.innerHTML=engineNote\(\); return; \}/);
    assert.equal(app.includes("opened from the file system"), false,
      "the old wording describes a failure mode that is no longer the likely one");
  });

  test("the Inbox says it too, because classification is the first thing tried", () => {
    assert.match(app, /if\(out&&!window\.BW\)\{ out\.innerHTML=engineNote\(\); return; \}/);
  });

  test("one sentence, defined once", () => {
    assert.equal((app.match(/The calculation engine did not load/g) || []).length, 1,
      "the wording is duplicated, so it will drift");
  });
});

describe("the banner cannot itself depend on the engine", () => {
  test("it uses no BW function", () => {
    const start = app.indexOf("var ENGINE_MISSING_TEXT");
    const block = app.slice(start, app.indexOf("/* ======================================================= action dispatch ==="));
    assert.equal(/window\.BW\./.test(block), false,
      "a message about the engine being absent must not call the engine");
  });

  test("it escapes what it prints", () => {
    const start = app.indexOf("var ENGINE_MISSING_TEXT");
    const block = app.slice(start, app.indexOf("/* ======================================================= action dispatch ==="));
    // The media type comes off a response header, which is not ours.
    assert.match(block, /ciEsc\(detail\)/);
  });

  test("a hostile content-type header cannot become markup", async () => {
    const e = engine({ response: ok('text/plain"><img src=x onerror="alert(1)') });
    await e.load();
    assert.equal(/<img src=x/.test(e.banner().innerHTML), false);
    assert.match(e.banner().innerHTML, /&lt;img/);
  });
});

describe("the page still loads it", () => {
  test("index.html asks for the mount the diagnostic checks for", () => {
    // markupOnly, not the spliced page: the helper inlines the script, which
    // is exactly the tag being asserted about.
    assert.match(markupOnly(), /<script type="module" src="\/mount\.mjs(\?[^"]*)?"><\/script>/);
  });

  test("the diagnostic fetches the URL the page asked for, version and all", () => {
    /* The srcs carry a cache-busting version, so "/mount.mjs" and
       "/mount.mjs?v=…" are different URLs and different cache entries. A
       diagnostic fetching the bare path could succeed against a file the page
       never loaded, and report the engine as reachable while the one that
       actually failed is still broken. So it reads the src off the tag. */
    assert.match(app, /function engineUrl\(\)/,
      "the diagnostic no longer derives its URL from the page");
    assert.match(app, /querySelector\('script\[src\*="mount\.mjs"\]'\)/);
    assert.match(app, /fetch\(url, \{ cache: "no-store" \}\)/,
      "the diagnostic fetches something other than the URL it just derived");
    assert.doesNotMatch(app, /fetch\("\/mount\.mjs"/,
      "a hardcoded path is back, which ignores the version the page uses");
  });

  test("the file the page names is the file in the tree", () => {
    const loaded = markupOnly().match(/src="\/([\w.-]+\.mjs)(\?[^"]*)?"/)[1];
    assert.equal(loaded, "mount.mjs");
  });
});
