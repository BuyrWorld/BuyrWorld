/**
 * The task-led way in, run against the page's own code.
 *
 * `specs/05` asks the home page to lead with "What are we solving today?".
 * This sits after the hero rather than replacing it — what a public home page
 * opens with is a decision for whoever owns the site, not one to take while
 * implementing a spec.
 *
 * What these check is the part that is not a layout preference: the route
 * that is not ready is shown and shown as unready, a description that matches
 * nothing sends nobody anywhere, and two matches offer two buttons.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { fnSource, pageSource } from "../helpers/page.mjs";
import {
  ROUTES as INTAKE_ROUTES, routeFor, saidAboutUnready, resumable, resumableSaid, ROUTE,
} from "../../src/case/intake.mjs";

const app = readFileSync("app.js", "utf8");

function page({ scenarios = [] } = {}) {
  const els = new Map();
  for (const id of ["intake-routes", "intake-answer", "intake-resume"]) {
    els.set(id, { id, innerHTML: "" });
  }
  els.set("intake-say", { id: "intake-say", value: "" });

  const went = [];
  const opened = [];
  const box = {
    document: { getElementById: (id) => els.get(id) ?? null },
    console,
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
    go: (p) => went.push(p),
    scOpenDraft: (id) => opened.push(id),
    window: {
      BW: {
        INTAKE_ROUTES, routeFor, saidAboutUnready, resumable, resumableSaid,
        loadScenarios: () => scenarios,
      },
    },
  };
  vm.createContext(box);
  new vm.Script([
    fnSource("intakeRenderRoutes", app), fnSource("intakeDescribe", app),
    fnSource("intakeKey", app), fnSource("intakeRenderResume", app),
    fnSource("intakeResume", app),
  ].join("\n")).runInContext(box);

  return {
    box, els, went, opened,
    routes: () => { vm.runInContext("intakeRenderRoutes();", box); return els.get("intake-routes").innerHTML; },
    resume: () => { vm.runInContext("intakeRenderResume();", box); return els.get("intake-resume").innerHTML; },
    say: (text) => {
      els.get("intake-say").value = text;
      vm.runInContext("intakeDescribe();", box);
      return els.get("intake-answer").innerHTML;
    },
    key: (k) => vm.runInContext(`intakeKey({ key: ${JSON.stringify(k)} });`, box),
    answer: () => els.get("intake-answer").innerHTML,
    open: (id) => vm.runInContext(`intakeResume(${JSON.stringify(id)});`, box),
  };
}

let v;
beforeEach(() => { v = page(); });

/* ------------------------------------------------------------- the cards */

describe("the five cards", () => {
  test("all five are drawn", () => {
    const html = v.routes();
    for (const r of INTAKE_ROUTES) assert.ok(html.includes(r.title), r.title);
  });

  test("the four that work carry a button to somewhere", () => {
    const html = v.routes();
    for (const r of INTAKE_ROUTES.filter((x) => x.ready)) {
      assert.ok(html.includes(`data-a="${r.page}"`), r.title);
    }
  });

  test("the one that does not is shown, and says why", () => {
    /* Leaving it out would be tidier and would mean somebody with a late
       delivery finds nothing and concludes the product has no opinion — when
       the truth is it has no engine, which is worth saying. */
    const html = v.routes();
    assert.match(html, /Rescue a late delivery/);
    assert.match(html, /no engine for delivery dates/);
  });

  test("and carries no button at all", () => {
    const html = v.routes();
    const card = html.slice(html.indexOf("Rescue a late delivery"));
    const end = card.indexOf("</div></div>");
    assert.equal(/data-do="go"/.test(card.slice(0, end > 0 ? end : card.length)), false,
      "the unready card offers a way in");
  });

  test("routes that share a page say so on the card", () => {
    assert.match(v.routes(), /opens the same place/);
  });

  test("with no engine it draws nothing rather than throwing", () => {
    const bare = page();
    vm.runInContext("window.BW = {};", bare.box);
    assert.equal(bare.routes(), "");
  });
});

/* ---------------------------------------------------------- describing it */

describe("describing the problem", () => {
  test("a match offers a button rather than navigating", () => {
    /* Sending somebody straight to a page on one rule firing is the confident
       wrong answer this exists to avoid. */
    const html = v.say("A supplier wants a 9% increase");
    assert.match(html, /Understand a quote/);
    assert.match(html, /data-a="tool-defender"/);
    assert.deepEqual([...v.went], [], "it navigated on its own");
  });

  test("two matches offer two", () => {
    const html = v.say("They are late and now they want a price increase for it");
    assert.match(html, /rather than one being chosen for you/);
    assert.match(html, /Understand a quote/);
    assert.match(html, /Rescue a late delivery/);
  });

  test("and the unready one is offered as a label, not a button", () => {
    const html = v.say("They are late and now they want a price increase for it");
    assert.match(html, /Rescue a late delivery — not in this build/);
    assert.match(html, /no engine for delivery dates/);
  });

  test("nothing recognisable sends nobody anywhere", () => {
    const html = v.say("I need to sort out the thing with the people");
    assert.match(html, /does not match any of the five/);
    assert.equal(/data-do="go"/.test(html), false);
  });

  test("an empty box says so rather than looking broken", () => {
    assert.match(v.say(""), /Nothing was described yet/);
  });

  test("Enter does what the button does", () => {
    v.els.get("intake-say").value = "a price increase";
    v.key("Enter");
    assert.match(v.answer(), /Understand a quote/);
  });

  test("and another key does not", () => {
    v.els.get("intake-say").value = "a price increase";
    v.key("a");
    assert.equal(v.answer(), "");
  });

  test("what somebody typed cannot become markup", () => {
    const html = v.say('<img src=x onerror=alert(1)> price increase');
    assert.equal(/<img src=x/.test(html), false);
  });
});

/* ------------------------------------------------------------ picking up */

describe("work to come back to", () => {
  const saved = (id, at, over = {}) => ({
    id, name: `Case ${id}`, updatedAt: at, summary: { waitingOn: [], unknowns: 0, ...over },
  });

  test("nothing saved shows nothing at all", () => {
    /* An empty "recent work" heading on a first visit is a product telling
       somebody they have forgotten something they never did. */
    assert.equal(v.resume(), "");
  });

  test("saved work appears, newest first, three at most", () => {
    const many = page({ scenarios: [
      saved("A", "2026-09-10T00:00:00Z"), saved("B", "2026-09-14T00:00:00Z"),
      saved("C", "2026-09-17T00:00:00Z"), saved("D", "2026-09-01T00:00:00Z"),
    ] });
    const html = many.resume();
    assert.match(html, /Pick up where you left off/);
    assert.equal((html.match(/Open it/g) || []).length, 3);
    assert.ok(html.indexOf("Case C") < html.indexOf("Case B"));
    assert.equal(/Case D/.test(html), false);
  });

  test("each card says what it is waiting on", () => {
    const one = page({ scenarios: [
      saved("A", "2026-09-10T00:00:00Z", { waitingOn: ["a material rate"], unknowns: 2 }),
    ] });
    assert.match(one.resume(), /waiting on a material rate/);
    assert.match(one.resume(), /2 things marked not known/);
  });

  test("opening one goes to the page and opens it there", () => {
    const one = page({ scenarios: [saved("A", "2026-09-10T00:00:00Z")] });
    one.resume();
    one.open("A");
    assert.deepEqual([...one.went], ["shouldcost"]);
    assert.deepEqual([...one.opened], ["A"]);
  });

  test("a store that throws leaves the band empty rather than broken", () => {
    const bad = page();
    vm.runInContext("window.BW.loadScenarios = function(){ throw new Error('no'); };", bad.box);
    assert.equal(bad.resume(), "");
  });
});

/* ------------------------------------------------------------- the wiring */

describe("it is wired the way the page requires", () => {
  test("every control asks for an action the table registers", () => {
    const html = pageSource();
    for (const name of ["intakeDescribe", "intakeKey$event", "intakeResume"]) {
      assert.ok(html.includes(`${name}:`), `${name} is not registered`);
    }
  });

  test("the describe box carries a name of its own", () => {
    assert.match(pageSource(), /id="intake-say"[^>]*aria-label="Describe what you are solving"/);
  });

  test("the band is drawn at load, and a failure there does not stop the page", () => {
    /* It sits above the pillars, which are drawn by the same boot block. One
       throwing and taking the other with it would leave the home page half
       built with nothing saying why. */
    const boot = pageSource();
    assert.match(boot, /intakeRenderRoutes\(\); intakeRenderResume\(\);/);
    assert.match(boot, /The intake band did not draw/);
  });
});
