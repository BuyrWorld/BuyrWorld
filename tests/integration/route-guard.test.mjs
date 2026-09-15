/**
 * The router's guard.
 *
 * `go()` used to remove `.on` from every page and then call
 * `document.getElementById("page-"+p).classList.add("on")` with nothing
 * checking the lookup. A route with no section threw *after* everything was
 * hidden, so the whole product went blank with only a console error — the one
 * outcome worse than not navigating at all, because it looks like the site
 * broke rather than the link.
 *
 * Nothing could reach it: the nav names only real routes, and so do all eight
 * the Inbox can emit. This file holds both halves — that the lookup now
 * happens before anything is hidden, and that the route lists stay inside the
 * sections that exist, which is what kept it unreachable.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { pageSource } from "../helpers/page.mjs";
import { WORKFLOW } from "../../src/intake/classify.mjs";

const app = readFileSync("app.js", "utf8");
const html = pageSource();

/** Every screen the page actually contains. */
const SECTIONS = new Set(
  [...html.matchAll(/id="page-([a-z0-9-]+)"/g)].map((m) => m[1]),
);

/* ------------------------------------------------------------- the harness */

/**
 * Run the router over a stub document whose sections are `names`.
 *
 * The elements record what was done to them, so the order of hiding and
 * showing can be asserted rather than only the end state — the bug was an
 * ordering bug, and the end state of a throw is not observable.
 */
function router({ names = [...SECTIONS], body = true } = {}) {
  const log = [];
  const pages = new Map();
  const made = [];

  const pageEl = (id) => ({
    id,
    classList: {
      add: (c) => log.push(`show:${id}:${c}`),
      remove: (c) => log.push(`hide:${id}:${c}`),
    },
    style: {},
  });
  for (const n of names) pages.set("page-" + n, pageEl(n));

  const banner = { id: "", innerHTML: "", style: {}, attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; } };

  /* The elements the arrival table reaches for that are not pages. Listed
     rather than conjured, because a stub that answers every id can never see
     the guard fire — a real getElementById returns null, and that null is the
     whole subject of this file. */
  const OTHER = new Set(["mobmenu", "blog-list", "blog-article", "pathways", "pathway-detail", "main"]);
  const others = new Map();

  const doc = {
    getElementById(id) {
      if (pages.has(id)) return pages.get(id);
      if (id === "bw-route-missing") return doc._banner;
      if (OTHER.has(id)) {
        if (!others.has(id)) others.set(id, { id, style: {}, focus() {} });
        return others.get(id);
      }
      return null;
    },
    querySelectorAll: () => [...pages.values()],
    createElement(tag) { made.push(tag); return banner; },
    body: body ? { firstChild: null, appendChild(el) { doc._banner = el; log.push("banner:appended"); } } : null,
    _banner: null,
  };

  const errors = [];
  const sandbox = {
    document: doc,
    window: { scrollTo() {}, console: { error: (m) => errors.push(m) } },
    console: { error: (m) => errors.push(m) },
    renderNav() { log.push("renderNav"); },
    renderDash() { log.push("arrival:dash"); },
    miGo(v) { log.push("miGo:" + v); },
    setTimeout() { log.push("deferred"); return 0; },
    ciEsc: (t) => String(t),
    RAN: log,
  };
  sandbox.window.console = sandbox.console;

  const start = app.indexOf("/* What each screen does on arrival, keyed by route.");
  const end = app.indexOf("// A div with a click handler is unreachable by keyboard");
  assert.ok(start > 0 && end > start, "the router is not where this test expects it");

  vm.createContext(sandbox);
  vm.runInContext('let page="home";\n' + app.slice(start, end), sandbox);

  return {
    log, errors, made, banner,
    go: (p) => vm.runInContext(`go(${JSON.stringify(p)})`, sandbox),
    page: () => vm.runInContext("page", sandbox),
    arrivals: () => vm.runInContext("Object.keys(ON_ARRIVAL)", sandbox),
    run: (code) => vm.runInContext(code, sandbox),
  };
}

let r;
beforeEach(() => { r = router(); });

/* ------------------------------------------------- a route with no section */

describe("a route that does not exist", () => {
  test("does not throw", () => {
    assert.doesNotThrow(() => r.go("reports"));
  });

  test("hides nothing, which is the whole bug", () => {
    // The old order hid every page and then threw. Anything at all in this
    // list means the screen went blank before the failure was noticed.
    r.go("reports");
    assert.deepEqual(r.log.filter((l) => l.startsWith("hide:")), []);
  });

  test("leaves the current page current, so the nav still agrees with the screen", () => {
    r.go("dash");
    r.go("reports");
    assert.equal(r.page(), "dash");
  });

  test("says so, rather than appearing to do nothing", () => {
    r.go("reports");
    assert.match(r.banner.innerHTML, /did not open/);
    assert.equal(r.banner.attrs.role, "alert", "a screen reader is told too");
  });

  test("names the section it looked for, because this is a fault in the build", () => {
    r.go("reports");
    assert.match(r.banner.innerHTML, /page-reports/);
  });

  test("and tells the console, where whoever added the route will look", () => {
    r.go("reports");
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /no section for route reports/);
  });

  test("a second failure reuses the one banner rather than stacking them", () => {
    r.go("reports");
    r.go("invoices");
    assert.equal(r.made.filter((t) => t === "div").length, 1);
    assert.match(r.banner.innerHTML, /page-invoices/);
  });

  test("the page that was open still works: nothing was torn down", () => {
    r.go("dash");
    const before = r.log.length;
    r.go("reports");
    r.go("inbox");
    assert.ok(r.log.slice(before).includes("show:inbox:on"), "navigation still works after a bad route");
  });
});

/* ---------------------------------------------------------- the normal path */

describe("a route that does exist", () => {
  test("hides every page and shows the one asked for", () => {
    r.go("inbox");
    assert.ok(r.log.includes("hide:home:on"));
    assert.ok(r.log.includes("show:inbox:on"));
    assert.equal(r.page(), "inbox");
  });

  test("shows the page before running what the screen does on arrival", () => {
    // Arrival code binds and renders; anything measuring layout has to run
    // against a visible page, not a hidden one.
    r.go("dash");
    assert.ok(r.log.indexOf("show:dash:on") < r.log.indexOf("arrival:dash"),
      "arrival ran before the page was shown");
  });

  test("no banner appears on a route that works", () => {
    r.go("inbox");
    assert.equal(r.made.length, 0);
    assert.equal(r.errors.length, 0);
  });

  test("the nav is redrawn after the page changes, not before", () => {
    r.go("inbox");
    assert.ok(r.log.indexOf("show:inbox:on") < r.log.indexOf("renderNav"));
  });
});

/* ------------------------------------------------------------- the table */

describe("what each screen does on arrival", () => {
  test("every entry names a screen that exists", () => {
    for (const p of r.arrivals()) {
      assert.ok(SECTIONS.has(p), `ON_ARRIVAL has "${p}" but there is no page-${p}`);
    }
  });

  test("a screen whose code has not loaded does not stop navigation", () => {
    // Every arrival call is optional on purpose: these are screens binding
    // themselves, and a missing binder must not cost you the page.
    assert.doesNotThrow(() => r.go("shouldcost"));
    assert.ok(r.log.includes("show:shouldcost:on"));
  });

  test("the table has no prototype, so a name from markup resolves to nothing", () => {
    // go() is reached with t.dataset.go. The guard above already refuses a
    // name with no section, but a defence that leans on another check is not one.
    assert.equal(r.run("Object.getPrototypeOf(ON_ARRIVAL)"), null);
    assert.equal(r.run('typeof ON_ARRIVAL["constructor"]'), "undefined");
    assert.equal(r.run('typeof ON_ARRIVAL["toString"]'), "undefined");
  });

  test("it is a table, not the chain of ifs it replaced", () => {
    const fn = app.slice(app.indexOf("function go(p){"), app.indexOf("// A div with a click handler"));
    assert.equal(/if\s*\(\s*p\s*===\s*"/.test(fn), false,
      "a chain is where a new screen gets forgotten");
  });

  test("blog and academy put their section back to its list", () => {
    // Both show a list and a detail view in the same section. Without this,
    // leaving from an article and returning lands on that article again.
    for (const p of ["blog", "academy"]) {
      assert.ok(r.arrivals().includes(p), `${p} has no arrival entry`);
    }
    const src = app.slice(app.indexOf('ON_ARRIVAL["blog"]'), app.indexOf("function call(fn"));
    assert.match(src, /show\("blog-article", "none"\)/);
    assert.match(src, /show\("pathway-detail", "none"\)/);
  });
});

/* --------------------------------------- what kept the bug out of reach */

describe("every route anything can ask for has a section", () => {
  test("the nav names only screens that exist", () => {
    const at = app.indexOf("const NAV_GROUPS=[");
    const groups = app.slice(at, app.indexOf("\n];", at));
    const named = [...groups.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1])
      .filter((n) => n !== "Your work" && n !== "Analysis" && n !== "Learning");
    assert.ok(named.length >= 10, "the nav list was not read");
    for (const n of named) assert.ok(SECTIONS.has(n), `the nav offers "${n}" and there is no page-${n}`);
  });

  test("every route the Inbox can send a document to exists", () => {
    const routes = new Set(Object.values(WORKFLOW).map((w) => w.route).filter(Boolean));
    assert.ok(routes.size >= 5, "no routes were read from classify.mjs");
    for (const route of routes) {
      assert.ok(SECTIONS.has(route), `classify.mjs routes to "${route}" and there is no page-${route}`);
    }
  });

  test("and each of them actually navigates rather than tripping the guard", () => {
    for (const route of new Set(Object.values(WORKFLOW).map((w) => w.route).filter(Boolean))) {
      const fresh = router();
      fresh.go(route);
      assert.equal(fresh.errors.length, 0, `go("${route}") hit the guard`);
      assert.equal(fresh.page(), route);
    }
  });
});

/* ------------------------------------------------------- the failure path */

describe("the guard itself holds up", () => {
  test("it fires when the section is genuinely absent, not merely unusual", () => {
    // A build that shipped without one section: the rest of the site keeps working.
    const partial = router({ names: ["home", "dash"] });
    partial.go("inbox");
    assert.equal(partial.errors.length, 1);
    partial.go("dash");
    assert.equal(partial.page(), "dash");
  });

  test("an empty or absent route name is refused like any other", () => {
    for (const bad of ["", "constructor", "__proto__", "toString"]) {
      const fresh = router();
      assert.doesNotThrow(() => fresh.go(bad), `go(${JSON.stringify(bad)}) threw`);
      assert.deepEqual(fresh.log.filter((l) => l.startsWith("hide:")), [],
        `go(${JSON.stringify(bad)}) hid the screen`);
    }
  });

  test("the wording does not promise the person can fix it", () => {
    const text = app.slice(app.indexOf("var ROUTE_MISSING_TEXT"), app.indexOf("function routeBanner"));
    assert.match(text, /Nothing you have saved is affected/);
    assert.equal(/try again|refresh|reload/i.test(text), false,
      "a route with no section is a fault in the build; retrying will not help");
  });
});
