/**
 * The action dispatcher.
 *
 * One hundred and forty inline event attributes became data attributes and a
 * table, which is what let `script-src` drop `unsafe-inline`. The conversion
 * was mechanical; the thing worth testing is the dispatcher it converted them
 * to, because everything clickable on the site now depends on it.
 *
 * The table rather than a `window[name]` lookup is the point. A name that
 * arrived in markup must not be able to choose which function runs — that is
 * most of what taking code out of markup was for — so a name that is not in
 * the table does nothing at all.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { pageSource } from "../helpers/page.mjs";

const app = readFileSync("app.js", "utf8");
const html = pageSource();

/** The dispatcher alone, driven directly. */
function dispatcher() {
  const start = app.indexOf("var ACTIONS = Object.create(null);");
  const end = app.indexOf("/* One listener for all three navigations");
  assert.ok(start > 0 && end > start, "the dispatcher is not where this test expects it");

  const listeners = {};
  const ran = [];
  const sandbox = {
    document: { addEventListener: (type, fn) => { listeners[type] = fn; } },
    console, RAN: ran,
  };
  vm.createContext(sandbox);
  vm.runInContext(app.slice(start, end), sandbox);

  const el = (attrs, tag = "BUTTON") => ({
    tagName: tag,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    closest: (sel) => {
      const key = sel.slice(1, -1);
      return key in attrs ? el(attrs, tag) : null;
    },
  });

  return {
    ran,
    register: (body) => vm.runInContext(`registerActions(${body});`, sandbox),
    fire: (type, attrs, tag, extra = {}) => {
      if (!listeners[type]) throw new Error(`nothing listens for ${type}`);
      listeners[type]({
        target: el(attrs, tag),
        preventDefault() { ran.push("prevented"); },
        ...extra,
      });
    },
  };
}

let d;
beforeEach(() => {
  d = dispatcher();
  d.register(`{
    plain: function () { RAN.push("plain"); },
    one: function (a) { RAN.push("one:" + a); },
    two: function (a, b) { RAN.push("two:" + a + "/" + b); },
    self: function () { RAN.push("self:" + this.tagName); },
    withEvent: function (a, b, ev) { RAN.push("event:" + (ev && ev.key)); },
  }`);
});

describe("it dispatches every shape the conversion produced", () => {
  test("an action with no arguments", () => {
    d.fire("click", { "data-do": "plain" });
    assert.deepEqual(d.ran, ["plain"]);
  });

  test("an action with one argument, which arrives as a string", () => {
    d.fire("click", { "data-do": "one", "data-a": "tools" });
    assert.deepEqual(d.ran, ["one:tools"]);
  });

  test("an action with two", () => {
    d.fire("click", { "data-do": "two", "data-a": "x", "data-b": "y" });
    assert.deepEqual(d.ran, ["two:x/y"]);
  });

  test("the element is bound, so an adapter can reach it", () => {
    // Every $self adapter depends on this: the handlers that read `this`
    // still read the element they are on.
    d.fire("click", { "data-do": "self" }, "INPUT");
    assert.deepEqual(d.ran, ["self:INPUT"]);
  });

  test("the event is passed, so a key can be read", () => {
    d.fire("keydown", { "data-key": "withEvent" }, "DIV", { key: "Enter" });
    assert.deepEqual(d.ran, ["event:Enter"]);
  });

  test("all four event types are listened for", () => {
    d.fire("click", { "data-do": "plain" });
    d.fire("change", { "data-chg": "plain" });
    d.fire("input", { "data-inp": "plain" });
    d.fire("keydown", { "data-key": "plain" });
    assert.deepEqual(d.ran, ["plain", "plain", "plain", "plain"]);
  });

  test("an anchor is prevented before its action runs", () => {
    // The inline forms all ended in "return false"; an anchor that navigates
    // as well as acting would lose the page.
    d.fire("click", { "data-do": "one", "data-a": "legal" }, "A");
    assert.deepEqual(d.ran, ["prevented", "one:legal"]);
  });

  test("a button is not prevented, because nothing needs it to be", () => {
    d.fire("click", { "data-do": "plain" }, "BUTTON");
    assert.deepEqual(d.ran, ["plain"]);
  });
});

describe("a name from markup cannot choose a function", () => {
  test("a name that is not in the table does nothing", () => {
    d.fire("click", { "data-do": "somethingElse" });
    assert.deepEqual(d.ran, []);
  });

  test("it cannot reach anything through the prototype chain", () => {
    // Object.create(null) is why. On a plain object, "constructor" and
    // "toString" are functions, and a dispatcher that called them would be
    // exactly the hole this design exists to close.
    for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      d.fire("click", { "data-do": name });
    }
    assert.deepEqual(d.ran, []);
  });

  test("the table is built without a prototype, deliberately", () => {
    assert.match(app, /var ACTIONS = Object\.create\(null\);/);
  });

  test("no lookup goes through window", () => {
    const start = app.indexOf("var ACTIONS = Object.create(null);");
    const src = app.slice(start, app.indexOf("/* One listener for all three navigations"));
    assert.equal(/window\s*\[/.test(src), false, "a string from markup must not index window");
    assert.equal(/\beval\b|new Function/.test(src), false);
  });
});

/**
 * The registered table, brace-matched and stripped of comments.
 *
 * Both matter. Slicing to the end of the file instead reads whatever follows
 * the table as though it were part of it — true by one line today, false as
 * soon as anything is appended. And a word followed by a colon inside a
 * comment reads as a registered name: "adapters:" in the note above the
 * dispatcher is exactly that, and it is not an action.
 */
function actionTable() {
  const at = app.lastIndexOf("registerActions({");
  assert.ok(at > 0, "the action table is not where this expects it");
  let depth = 0, quote = null, end = -1;
  for (let i = app.indexOf("{", at); i < app.length; i++) {
    const c = app[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  assert.ok(end > at, "the action table does not close");
  return app.slice(at, end)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

/** Every name the markup asks the dispatcher for. */
const askedFor = () => new Set(
  [...pageSource().matchAll(/\sdata-(?:do|chg|inp|key)="([A-Za-z_$][\w$]*)"/g)].map((m) => m[1]));

describe("every action the markup asks for exists", () => {
  test("no attribute names an action the table does not hold", () => {
    // The conversion was mechanical, and a typo in it would leave a control
    // that silently does nothing.
    const asked = askedFor();
    assert.ok(asked.size >= 60, `only ${asked.size} actions found; the conversion may be incomplete`);

    const table = actionTable();
    /* A plain string search, not a regex. Several action names carry a `$`
       suffix — `cardKey$event`, `copyMinutes$self` — and `$` is an anchor in a
       pattern, so interpolating one produces an expression that matches
       nothing and reports seven working controls as unregistered. */
    const missing = [...asked].filter((name) => !table.includes(`${name}:`));
    assert.deepEqual(missing, [], `markup asks for actions that are not registered:\n  ${missing.join("\n  ")}`);
  });

  test("no action is registered that nothing can reach", () => {
    /* A control wired up without a button, or left behind when its button
       went. Either way it is dead: the dispatcher can run it and nothing can
       ask it to. Zero today, which is the moment to hold it there. */
    const asked = askedFor();
    const registered = [...actionTable().matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]);
    assert.ok(registered.length >= 60, `only ${registered.length} registered; the table was not read`);

    const unreachable = [...new Set(registered)].filter((name) => !asked.has(name));
    assert.deepEqual(unreachable, [],
      `registered and unreachable from any markup:\n  ${unreachable.join("\n  ")}`);
  });

  test("every registered action names something that exists", () => {
    const table = app.slice(app.indexOf("registerActions({"), app.length);
    // Several entries share a line, so this cannot anchor at the start of one.
    const direct = [...table.matchAll(/[\s{]([A-Za-z_$][\w$]*):\s*([A-Za-z_$][\w$]*)\s*,/g)]
      .filter(([, , target]) => target !== "function");
    assert.ok(direct.length >= 40, `only ${direct.length} direct registrations found`);
    for (const [, name, target] of direct) {
      assert.ok(app.includes(`function ${target}(`),
        `${name} is registered as ${target}, which is not a function in app.js`);
    }
  });
});

describe("the keyboard path survived delegation", () => {
  test("cardKey is handed the card rather than reading it off the event", () => {
    // e.currentTarget is the document under delegation, and .click() on that
    // does nothing at all — Enter would have stopped working on every card
    // with no error anywhere.
    assert.match(app, /function cardKey\(e,el\)/);
    assert.match(app, /\(el\|\|e\.currentTarget\)\.click\(\)/);
    assert.match(app, /cardKey\$event: function \(_a, _b, ev\) \{ cardKey\(ev, this\); \}/);
  });

  test("every card that takes a key press is still a button to a screen reader", () => {
    for (const [, attrs] of html.matchAll(/<div([^>]*data-key="cardKey[^>]*)>/g)) {
      assert.match(attrs, /role="button"/);
      assert.match(attrs, /tabindex="0"/);
    }
  });
});
