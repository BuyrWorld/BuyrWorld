/**
 * BATNA capture and assessment, executed against the page's own code.
 *
 * The thing worth testing here is the meaning of a tick box. A tick means "I
 * have this on file" and maps to a supplied fact; an untouched box maps to
 * unknown, never to no. If that ever inverts, an alternative nobody has checked
 * starts reading as one that has been checked and found wanting — or worse, as
 * leverage.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import {
  alternative, assessBatna, fact, KNOWN, READINESS, STRENGTH, MATERIAL,
} from "../../src/calc/batna.mjs";

const html = readFileSync("index.html", "utf8");

/** One named function's source, found forward so the slice cannot run backwards. */
function fnSource(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  const end = html.indexOf("\nfunction ", start + 1);
  return html.slice(start, end < 0 ? html.length : end);
}

/** Run the page's BATNA code over a stub form. */
function run({ alts = [], position = {} } = {}) {
  const fields = {
    "def-alts": position.alternatives ?? "",
    "def-qual": position.qual ?? "",
    "def-notice": position.notice ?? "",
    "def-switch": position.switching ?? "",
    "def-crit": position.criticality ?? "",
    "def-currency": "GBP",
  };
  const host = { innerHTML: "", dataset: {}, addEventListener() {} };
  const sandbox = {
    document: {
      getElementById: (id) =>
        (id === "def-alts-list" ? host : (id in fields ? { value: fields[id] } : null)),
    },
    window: { BW: { alternative, assessBatna, fact, KNOWN, READINESS, STRENGTH, MATERIAL,
      moneyFromDecimal: (v, c) => ({ minor: BigInt(Math.round(Number(v) * 100)), currency: c, asOf: null }) } },
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
    console,
    _defAlts: alts,
  };
  // defPosition sits above and is what defBatna reads the contract terms from.
  const src = fnSource("defPosition") + "\n" + fnSource("defAltRow") + "\n" +
              fnSource("defRenderAlts") + "\n" + fnSource("defAddAlt") + "\n" +
              fnSource("defRemoveAlt") + "\n" + fnSource("defBatna") + "\n" + fnSource("defBatnaHTML");
  vm.createContext(sandbox);
  new vm.Script(src + "\n;defRenderAlts();\n;globalThis.__B__ = defBatna();\n;globalThis.__H__ = defBatnaHTML();")
    .runInContext(sandbox);
  return { batna: sandbox.__B__, html: sandbox.__H__, host, rows: sandbox._defAlts };
}

const ticked = (...idx) => {
  const c = [false, false, false, false, false, false];
  for (const i of idx) c[i] = true;
  return c;
};

describe("it is wired in", () => {
  test("the engine is imported and mounted", () => {
    assert.match(html, /from "\.\/src\/calc\/batna\.mjs"/);
    const mount = (html.match(/window\.BW\s*=\s*\{([\s\S]*?)\};/) || [])[1] || "";
    for (const name of ["assessBatna", "alternative", "fact", "MATERIAL", "READINESS"]) {
      assert.match(mount, new RegExp(name), `${name} is not exposed`);
    }
  });

  test("the negotiation is given the assessment", () => {
    assert.match(html, /prepareNegotiation\(\{bridge:r,ev:ev,position:defPosition\(\),batna:defBatna\(\)\}\)/);
  });

  test("the panel renders inside the negotiation plan", () => {
    // Pinned to the call rather than to its neighbours: the plan has gained
    // panels four times, and each time this failed for no reason but order.
    assert.match(html, /\+defBatnaHTML\(\)/);
    const plan = html.slice(html.indexOf("+rebut+walk"), html.indexOf("+rebut+walk") + 200);
    assert.ok(plan.includes("defBatnaHTML()"), "the BATNA panel left the negotiation plan");
  });

  test("capture sits in the sourcing position section, where it belongs", () => {
    assert.ok(html.indexOf('id="def-alts-list"') > html.indexOf("5 &middot; Your position"));
    assert.match(html, /A name is not a fallback/);
  });

  test("no inline handlers were added", () => {
    const handlers = (html.match(/\son(click|input|change|load|error|submit)=/g) || []).length;
    assert.ok(handlers <= 132, `inline handlers rose to ${handlers}`);
  });

  test("every checkbox carries an accessible name", () => {
    // The visible text follows the box inside the label, which a browser
    // associates but nothing in the markup guarantees.
    const fn = fnSource("defAltRow");
    assert.match(fn, /aria-label="'\+attrEsc\(m\.label\)\+'"/);
  });
});

describe("what a tick means", () => {
  test("an untouched box is unknown, never a no", () => {
    const { batna } = run({
      alts: [["Northgate", "qualified", "", ticked()]],
      position: { notice: "12" },
    });
    assert.equal(batna.best.evidencedCount, 0);
    assert.equal(batna.best.unknownCount, MATERIAL.length);
    assert.equal(batna.strength, STRENGTH.WEAK, "a qualified supplier nobody checked is not leverage");
    assert.equal(batna.cappedByEvidence, true);
  });

  test("a tick is a supplied fact", () => {
    const { batna } = run({
      alts: [["Northgate", "qualified", "", ticked(0, 1, 2)]],
      position: { notice: "12" },
    });
    assert.equal(batna.best.evidencedCount, 3);
    assert.equal(batna.strength, STRENGTH.STRONG, "half the attributes clears the cap");
  });

  test("the boxes map to the engine's material attributes in order", () => {
    const { batna } = run({
      alts: [["Northgate", "qualified", "", ticked(1)]],
      position: { notice: "12" },
    });
    assert.equal(batna.best.facts[MATERIAL[1].id].evidenced, true);
    assert.equal(batna.best.facts[MATERIAL[0].id].evidenced, false);
  });
});

describe("assessing what was captured", () => {
  test("an alternative that cannot be qualified in time is not viable", () => {
    const { batna } = run({
      alts: [["Slowco", "candidate", "40", ticked(0, 1, 2)]],
      position: { notice: "12" },
    });
    assert.equal(batna.viable.length, 0);
    assert.equal(batna.strength, STRENGTH.WEAK);
  });

  test("a blank weeks field is unknown rather than zero", () => {
    const { batna } = run({
      alts: [["Northgate", "candidate", "", ticked(0, 1, 2)]],
      position: { notice: "12" },
    });
    assert.equal(batna.best.qualificationWeeks, null);
    assert.match(batna.alternatives[0].timing, /has not been estimated/);
  });

  test("a row with no supplier name is ignored", () => {
    const { batna } = run({
      alts: [["   ", "qualified", "4", ticked(0, 1, 2)]],
      position: { notice: "12" },
    });
    assert.equal(batna, null, "an empty row is not an alternative");
  });

  test("nothing captured and nothing stated produces no assessment at all", () => {
    assert.equal(run({}).batna, null);
    assert.equal(run({}).html, "");
  });

  test("a sole-source designation ends it regardless of what was captured", () => {
    const { batna } = run({
      alts: [["Northgate", "qualified", "", ticked(0, 1, 2, 3, 4, 5)]],
      position: { notice: "52", criticality: "single-source" },
    });
    assert.equal(batna.strength, STRENGTH.NONE);
  });
});

describe("the panel", () => {
  const full = () => run({
    alts: [["Northgate Precision", "qualified", "", ticked(0, 1, 2)],
           ["Slowco", "candidate", "40", ticked(0)]],
    position: { notice: "12" },
  });

  test("strength is a chip with its rule beneath", () => {
    const { html: out } = full();
    assert.match(out, /The alternative to agreeing is/);
    assert.match(out, /bw-status--evidenced">strong/);
    assert.match(out, /already qualified and can be used inside the notice period/);
  });

  test("each alternative shows whether it is usable and how much is checked", () => {
    const { html: out } = full();
    assert.match(out, /Northgate Precision/);
    assert.match(out, />usable</);
    assert.match(out, />not in time</);
    assert.match(out, /3 of 6/);
    assert.match(out, /1 of 6/);
  });

  test("a capped assessment says so on the page", () => {
    const { html: out } = run({
      alts: [["Unknown Co", "qualified", "", ticked()]],
      position: { notice: "12" },
    });
    assert.match(out, /capped by evidence/);
    assert.match(out, /nobody has checked is not leverage/);
  });

  test("the open questions are on the page, not just in the object", () => {
    const { html: out } = run({
      alts: [["Northgate", "candidate", "", ticked()]],
      position: { notice: "12" },
    });
    assert.match(out, /What would change this/);
    assert.match(out, /Estimate qualification time for Northgate/);
  });

  test("the method disclaims what it is", () => {
    // The apostrophe is escaped on the way in, which is the point of ciEsc.
    assert.match(full().html, /No capability here is inferred from a supplier&#39;s name/);
  });

  test("a supplier name carrying markup is escaped", () => {
    const { html: out } = run({
      alts: [['<img src=x onerror="alert(1)">', "qualified", "", ticked(0, 1, 2)]],
      position: { notice: "12" },
    });
    assert.equal(/<img src=x/.test(out), false);
    assert.match(out, /&lt;img/);
  });

  test("nothing raw reaches the markup", () => {
    assert.equal(/\[object Object\]|undefined|NaN|\d+n\b/.test(full().html), false);
  });
});

describe("the empty capture state", () => {
  test("it says what having none actually means", () => {
    const { host } = run({ alts: [] });
    assert.match(host.innerHTML, /walking away is reported as having nowhere to go/);
    assert.match(host.innerHTML, /which is the honest answer/);
  });
});

describe("the shadow negotiator is wired in", () => {
  test("the engine is imported and mounted", () => {
    assert.match(html, /from "\.\/src\/calc\/shadow\.mjs"/);
    const mount = (html.match(/window\.BW\s*=\s*\{([\s\S]*?)\};/) || [])[1] || "";
    for (const name of ["nextMoves", "recordRound"]) {
      assert.match(mount, new RegExp(name), `${name} is not exposed`);
    }
  });

  test("it renders inside the negotiation plan, after the BATNA panel", () => {
    // The order still matters — what to do next belongs after what you can
    // fall back on — but the two need not be adjacent.
    const plan = html.slice(html.indexOf("+rebut+walk"), html.indexOf("+rebut+walk") + 200);
    assert.ok(plan.includes("defShadowHTML(r)"), "the shadow negotiator left the negotiation plan");
    assert.ok(plan.indexOf("defBatnaHTML()") < plan.indexOf("defShadowHTML(r)"));
  });

  test("the offer field is named for a screen reader", () => {
    assert.match(html, /id="sh-offer"[^>]*aria-label="Their current offer, percent"/);
  });

  test("it computes nothing in the page", () => {
    const fn = fnSource("defShadowHTML");
    assert.ok(fn.length > 500);
    const code = fn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.equal(/parseFloat|toFixed|\*\s*100/.test(code), false);
    assert.match(fn, /defShadow\(r\)/);
  });

  test("marking a move done is delegated, not an inline handler per move", () => {
    const fn = fnSource("defShadowBind");
    assert.match(fn, /page\.addEventListener\("click"/);
    assert.match(fn, /data-sh-act/);
    const html_fn = fnSource("defShadowHTML");
    assert.equal(/onclick=/.test(html_fn), false);
  });

  test("the round state is not persisted", () => {
    // It is the state of one conversation, not a record. Storing it would make
    // a half-finished meeting look like a case.
    assert.match(html, /var _shadowLive=\{round:1,offer:"",asked:\[\],shown:\[\]\}/);
    assert.equal(/saveCase\([^)]*_shadowLive/.test(html), false);
  });

  test("a spent move is remembered so it is not suggested twice", () => {
    const fn = fnSource("defShadowDone");
    assert.match(fn, /_shadowLive\.asked\.push\(id\)/);
    assert.match(fn, /_shadowLive\.round\+\+/);
  });
});
