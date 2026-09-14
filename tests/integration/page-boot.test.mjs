/**
 * Boot the page's inline script and assert it runs to completion.
 *
 * This exists because of a real outage. A de-commercialisation pass deleted the
 * `TPL` data array but left `TPL.map(...)` behind, ~40 lines into a 2,750-line
 * script. That one ReferenceError stopped execution of everything after it: the
 * templates grid, the academy pathways, the home ticker and the whole blog. The
 * page still looked fine at a glance — the nav rendered, because it ran first —
 * so three sections went blank in production and nothing caught it.
 *
 * Every other test in this suite imports a module. Nothing executed the page.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { pageSource } from "../helpers/page.mjs";

const html = pageSource();

/** The page's own script: the last non-module inline <script> in the document. */
function pageScript() {
  const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g;
  const bodies = [];
  for (const m of html.matchAll(re)) {
    if (/type=/.test(m[1]) && !/type="text\/javascript"/.test(m[1])) continue;
    bodies.push({ body: m[2], line: html.slice(0, m.index).split("\n").length });
  }
  assert.ok(bodies.length, "no inline page script found");
  return bodies[bodies.length - 1];
}

/**
 * A stub DOM. Permissive on purpose: this test is not checking the DOM API, it
 * is checking that the script reaches its last line without throwing. Anything
 * unrecognised returns another stub rather than undefined, so a missing browser
 * method cannot masquerade as a script bug.
 */
function makeDom() {
  const elements = new Map();
  const created = [];

  const stub = (tag = "div", id = null) => {
    const self = {
      tagName: tag, id, innerHTML: "", outerHTML: "", textContent: "", value: "",
      className: "", checked: false, files: [], dataset: {}, style: {},
      children: [], options: [], selectedIndex: 0, scrollTop: 0, offsetWidth: 900,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      appendChild(c) { self.children.push(c); return c; },
      removeChild() {}, remove() {}, insertAdjacentHTML() {}, setAttribute() {},
      getAttribute: () => null, removeAttribute() {}, addEventListener() {},
      removeEventListener() {}, focus() {}, blur() {}, click() {}, submit() {},
      scrollIntoView() {}, contains: () => false,
      // A browser resolves these; returning null would fail the test on the
      // stubs thinness rather than on anything wrong with the page.
      closest: () => stub(), get parentElement() { return stub(); },
      get parentNode() { return stub(); },
      querySelector: () => stub(), querySelectorAll: () => [],
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 900, height: 400, bottom: 400, right: 900 }),
      getContext: () => new Proxy({}, {
        get: (_, k) => (k === "canvas" ? self
          : k === "createLinearGradient" || k === "createRadialGradient"
            ? () => ({ addColorStop() {} })
            : k === "measureText" ? () => ({ width: 10 }) : () => {}),
      }),
    };
    return self;
  };

  const document = {
    readyState: "complete",
    documentElement: stub("html"),
    head: stub("head"),
    body: stub("body"),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, stub("div", id));
      return elements.get(id);
    },
    createElement(tag) { const e = stub(tag); created.push(e); return e; },
    createTextNode: (t) => ({ textContent: t }),
    querySelector: () => stub(),
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    execCommand() {}, write() {}, writeln() {}, close() {},
  };

  const noopCtor = function () { return { observe() {}, unobserve() {}, disconnect() {} }; };
  const storage = {
    _m: new Map(),
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); }, clear() { this._m.clear(); }, key: () => null, length: 0,
  };

  const win = {
    document, localStorage: storage, sessionStorage: storage,
    location: { href: "https://www.buyrworld.com/", hash: "", search: "", pathname: "/", hostname: "www.buyrworld.com", protocol: "https:", origin: "https://www.buyrworld.com", assign() {}, replace() {} },
    navigator: { userAgent: "node", language: "en-GB", clipboard: { writeText: async () => {} }, onLine: true },
    history: { pushState() {}, replaceState() {}, back() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    // Timers must not actually fire: this test boots the page, it does not run it.
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, open: () => stub("window"),
    alert() {}, confirm: () => false, prompt: () => null, print() {},
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" }),
    IntersectionObserver: noopCtor, ResizeObserver: noopCtor, MutationObserver: noopCtor,
    innerWidth: 1280, innerHeight: 900, devicePixelRatio: 1, scrollY: 0,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    console, URL, URLSearchParams, Blob: noopCtor, FileReader: noopCtor,
    performance: { now: () => 0 }, crypto: { randomUUID: () => "test-uuid", getRandomValues: (a) => a },
  };
  win.window = win;
  win.self = win;
  win.globalThis = win;
  win.top = win;
  win.parent = win;
  return { win, document, elements };
}

describe("the page script boots", () => {
  const { body, line } = pageScript();
  const { win, elements } = makeDom();
  let thrown = null;

  before(() => {
    // A sentinel on the last line: if execution stops early, this never runs,
    // which is precisely the failure mode a parse check cannot see.
    const src = body + "\n;globalThis.__BOOTED__ = true;";
    const context = vm.createContext(win);
    try {
      new vm.Script(src, { filename: `index.html (inline script at line ${line})` }).runInContext(context);
    } catch (e) {
      thrown = e;
    }
  });

  test("it runs to the last line without throwing", () => {
    assert.equal(thrown, null,
      thrown && `the page script threw, so everything after it never ran:\n  ${thrown.message}\n` +
      `This blanks every section rendered below the throw. Check for a reference to data that was deleted.`);
    assert.equal(win.__BOOTED__, true, "the script did not reach its final line");
  });

  /* The sections that went blank. Each is filled by a top-level statement, so
     each is a canary for a throw earlier in the file. */
  for (const [id, what] of [
    ["pillars", "the home page pillars grid"],
    ["features", "the home page feature cards"],
    ["tpl-all", "the templates grid"],
    ["pathways", "the academy pathways"],
    ["ticker", "the home page ticker"],
    ["blog-list", "the blog index"],
    ["blog-filter", "the blog category filter"],
    ["desknav", "the desktop navigation"],
    ["bw-side", "the sidebar navigation"],
  ]) {
    test(`${what} (#${id}) is populated`, () => {
      const el = elements.get(id);
      assert.ok(el, `#${id} was never looked up — the code that fills it did not run`);
      assert.ok(el.innerHTML.length > 50,
        `#${id} is empty, so ${what} renders blank on the live site`);
    });
  }

  /* The sidebar is now built from two arrays rather than one, so the thing
     worth checking is that the grouping reaches every destination. Static
     analysis can compare the arrays; only running it proves the markup. */
  test("the sidebar renders every destination, under its group", () => {
    const markup = elements.get("bw-side").innerHTML;
    const links = [...markup.matchAll(/data-go="([a-z-]+)"/g)].map((m) => m[1]);
    const inLinks = [...body.match(/const LINKS=\[(.*?)\];/s)[1].matchAll(/\["([a-z-]+)",/g)].map((m) => m[1]);
    assert.deepEqual([...links].sort(), [...inLinks, "home"].sort(),
      "the rendered sidebar does not match LINKS (home appears twice: the wordmark is also a way home)");
    for (const heading of ["Your work", "Analysis", "Learning"]) {
      assert.ok(markup.includes(heading), `the "${heading}" group heading did not render`);
    }
  });

  test("the wordmark renders as the shared asset, not as type", () => {
    const markup = elements.get("bw-side").innerHTML;
    assert.ok(markup.includes('<img src="/buyrworld-logo.png"'));
    assert.equal(markup.includes("Buyr<span>World</span>"), false);
  });
});
