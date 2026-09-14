/**
 * Mill performance, executed against the page's own code.
 *
 * The loop this checks is the one the whole module exists for: a comparison
 * is run, a competent person decides, and that decision becomes exactly one
 * lot in a producer's record. Nothing else creates a record.
 *
 * Three ways it could quietly go wrong, all tested here:
 *
 *   - a percentage rendering for a producer with two lots, because the page
 *     read the numerator and denominator and did its own division;
 *   - a concession raising a mill's conformity rate, which would make the
 *     rate go up every time somebody waved material through;
 *   - the same certificate recorded twice becoming two conforming lots.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { pageSource } from "../helpers/page.mjs";

import {
  lotRecord, lotFromReview, millPerformance, rank as millRank, uniqueLots,
  DECISION as MILL_DECISION, RESPONSIBILITY, SCOPE as MILL_SCOPE,
  DEFAULT_MINIMUM_LOTS, FILTERS as MILL_FILTERS,
} from "../../src/calc/mill.mjs";
import {
  saveLot, loadLots, deleteLot, clearLots, exportLots, storeStatus as lotStoreStatus,
} from "../../src/services/lot-store.mjs";
import { recordReview, RULES_VERSION, OVERALL } from "../../src/calc/certificate.mjs";

const html = pageSource();

function fnSource(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  const end = html.indexOf("\nfunction ", start + 1);
  return html.slice(start, end < 0 ? html.length : end);
}

/** A localStorage stand-in the page's store functions can be bound to. */
function fakeStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

let store;
beforeEach(() => { store = fakeStore(); });

/** Run the page's mill code over a stub form, against a store we control. */
function run({ fields = {}, ranked = false, fns = ["mlv", "mlFilters", "mlPerformance", "mlRate", "mlRun"] } = {}) {
  const values = {
    "ml-min": "5", "ml-grade": "", "ml-form": "", "ml-spec": "", "ml-site": "",
    "ml-from": "", "ml-to": "", ...fields,
  };
  const out = { innerHTML: "" };
  const msg = { innerHTML: "" };
  const sandbox = {
    document: {
      getElementById: (id) =>
        (id === "ml-out" ? out : id === "ml-msg" ? msg : (id in values ? { value: values[id] } : null)),
    },
    window: {
      BW: {
        lotRecord, lotFromReview, millPerformance, millRank, uniqueLots,
        MILL_DECISION, RESPONSIBILITY, MILL_SCOPE, DEFAULT_MINIMUM_LOTS, MILL_FILTERS,
        /* Bound to the test store, which is what the real mount does with
           localStorage — the page never passes a store itself. */
        saveLot: (r) => saveLot(r, store),
        loadLots: () => loadLots(store),
        deleteLot: (k) => deleteLot(k, store),
        clearLots: () => clearLots(store),
        exportLots: () => exportLots(store),
        lotStoreStatus: () => lotStoreStatus(store),
        recordReview,
      },
    },
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
    console,
  };
  vm.createContext(sandbox);
  new vm.Script(fns.map(fnSource).join("\n") + `\n;mlRun(${ranked});`).runInContext(sandbox);
  return { out: out.innerHTML, msg: msg.innerHTML, sandbox };
}

let seq = 0;
const put = (over = {}) => saveLot(lotRecord({
  lotKey: over.lotKey ?? `northgate|h-${++seq}|l-1`,
  producer: "Northgate Steelworks (synthetic)",
  site: "Works 1", grade: "FG-300", form: "plate",
  specification: "SYN-SPEC-100", specificationRevision: "C",
  decision: MILL_DECISION.CONFORMING, scope: MILL_SCOPE.FULL,
  firstSubmissionComplete: true, reviewedAt: "2026-06-01",
  ...over,
}), store);

describe("it is wired in", () => {
  test("the engine and the store are imported and mounted", () => {
    assert.match(html, /from "\.\/src\/calc\/mill\.mjs"/);
    assert.match(html, /from "\.\/src\/services\/lot-store\.mjs"/);
    const mount = (html.match(/window\.BW\s*=\s*\{([\s\S]*?)\};/) || [])[1] || "";
    for (const name of ["millPerformance", "lotFromReview", "saveLot", "loadLots", "lotStoreStatus"]) {
      assert.ok(mount.includes(name), `${name} is not exposed`);
    }
  });

  test("it has its own tab and panel", () => {
    assert.match(html, /id="sc-tab-mill"[^>]*data-sc-mode="mill"/);
    assert.match(html, /id="sc-mode-mill" role="tabpanel"/);
  });

  test("no inline handlers were added", () => {
    const handlers = (html.match(/\son(click|input|change|load|error|submit)=/g) || []).length;
    assert.ok(handlers <= 132, `inline handlers rose to ${handlers}`);
  });

  test("the page computes no rate of its own", () => {
    // Everything on screen comes out of mill.mjs. A division here would be a
    // second implementation of the rule the module exists to enforce.
    for (const name of ["mlRun", "mlRate", "mlPerformance"]) {
      const src = fnSource(name).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
      assert.equal(/\/\s*\w+\.denominator|\*\s*100|toFixed/.test(src), false,
        `${name} computes a percentage instead of rendering one`);
    }
  });
});

describe("what an empty record says", () => {
  test("nothing recorded is explained, not rendered as zero producers", () => {
    const { out } = run();
    assert.match(out, /No lots have been recorded yet/);
    assert.match(out, /nothing here exists that somebody did not decide/);
    assert.equal(/0\.0%/.test(out), false);
  });
});

describe("two over two never renders as a percentage", () => {
  test("below the threshold the cell says not shown, with the counts", () => {
    put(); put();
    const { out } = run();
    assert.match(out, /not shown/);
    assert.match(out, /2 of 2 reviewed lots/);
    assert.match(out, /Two out of two and two hundred out of two hundred/);
    assert.equal(/100\.0%/.test(out), false, "a percentage reached the page below the threshold");
  });

  test("above the threshold it renders, with the evidence beneath it", () => {
    for (let i = 0; i < 6; i++) put();
    const { out } = run();
    assert.match(out, /100\.0%/);
    assert.match(out, /6 of 6 reviewed lots/);
  });

  test("the threshold on the page is the threshold the engine uses", () => {
    put(); put();
    assert.equal(/100\.0%/.test(run().out), false);
    assert.match(run({ fields: { "ml-min": "2" } }).out, /100\.0%/);
  });

  test("a blank threshold falls back to the engine's default rather than to zero", () => {
    put(); put();
    const { out } = run({ fields: { "ml-min": "" } });
    assert.equal(/100\.0%/.test(out), false, "an empty box must not disable the threshold");
  });
});

describe("the two metrics stay apart on the page", () => {
  test("conformity and document completeness are separate columns", () => {
    for (let i = 0; i < 6; i++) put();
    const { out } = run();
    const head = out.slice(out.indexOf("<thead>"), out.indexOf("</thead>"));
    assert.match(head, /Reviewed-lot conformity/);
    assert.match(head, /First-pass document completeness/);
  });

  test("a producer can be perfect on one and not the other", () => {
    for (let i = 0; i < 6; i++) put({ firstSubmissionComplete: i < 3 });
    const { out } = run();
    assert.match(out, /100\.0%/);
    assert.match(out, /50\.0%/);
  });

  test("pending lots have their own column and are in neither rate", () => {
    for (let i = 0; i < 6; i++) put();
    put({ decision: MILL_DECISION.PENDING });
    const { out } = run();
    assert.match(out, /6 of 6 reviewed lots/);
    assert.match(out, /in neither rate above/);
  });
});

describe("attribution on the page", () => {
  test("a lot with no producer is counted apart rather than credited to anybody", () => {
    put();
    put({ lotKey: "unattributed|u-1|l-1", producer: "" });
    const { out } = run();
    assert.match(out, /attributed to nobody/);
    // The chip has to say so. "2 lots, 1 producer" on its own reads as
    // though both lots sit in that producer's row.
    assert.match(out, /2 lot\(s\), 1 producer\(s\), 1 unattributed/);
  });

  test("a distributor's error is named, and does not adjust the rate", () => {
    for (let i = 0; i < 5; i++) put();
    put({
      decision: MILL_DECISION.NONCONFORMING,
      nonconformities: [{ category: "wrong certificate supplied", responsibility: RESPONSIBILITY.DISTRIBUTOR }],
    });
    const { out } = run();
    assert.match(out, /Confirmed issues, and who they were attributed to/);
    assert.match(out, /wrong certificate supplied/);
    assert.match(out, /distributor/);
    assert.match(out, /5 of 6 reviewed lots/, "the lot did not conform, whoever caused it");
  });
});

describe("one lot stays one lot through the page", () => {
  test("recording the same lot twice does not make two", () => {
    put({ lotKey: "northgate|h-9|l-1" });
    put({ lotKey: "northgate|h-9|l-1", certificate: "SYN-CERT-0002" });
    const { out } = run();
    assert.match(out, /1 lot\(s\)/);
  });
});

describe("ranking, from the page", () => {
  const twoProducers = () => {
    for (let i = 0; i < 6; i++) put({ producer: "Alpha Mill (synthetic)", lotKey: `alpha|h-${i}|l-1` });
    for (let i = 0; i < 6; i++) {
      put({
        producer: "Zenith Mill (synthetic)", lotKey: `zenith|h-${i}|l-1`,
        decision: MILL_DECISION.NONCONFORMING,
        nonconformities: [{ category: "chemistry out of limit", responsibility: RESPONSIBILITY.PRODUCER }],
      });
    }
  };

  test("the unranked view does not number anybody", () => {
    twoProducers();
    const { out } = run();
    assert.match(out, /The record<\/div>/);
    assert.equal(/<b style="color:var\(--bw-text\)">1\.<\/b>/.test(out), false);
  });

  test("a ranked view numbers, and says who is not in it and why", () => {
    twoProducers();
    const { out } = run({ ranked: true });
    assert.match(out, /Ranked by reviewed-lot conformity/);
    assert.match(out, /not ranked last — they are not ranked/);
  });

  test("a ranking across grades falls back to the table, with the reason", () => {
    for (let i = 0; i < 6; i++) put({ producer: "Alpha Mill (synthetic)", lotKey: `a|h-${i}|l`, grade: "FG-300" });
    for (let i = 0; i < 6; i++) put({ producer: "Zenith Mill (synthetic)", lotKey: `z|h-${i}|l`, grade: "FG-450" });
    const { out } = run({ ranked: true });
    assert.match(out, /requirements they were not all judged against/);
    assert.match(out, /Showing the evidence table instead/);
    assert.match(out, /The record<\/div>/);
  });
});

describe("filters reach the engine", () => {
  test("a grade filter narrows the set", () => {
    for (let i = 0; i < 6; i++) put({ lotKey: `a|h-${i}|l`, grade: "FG-300" });
    put({ lotKey: "b|h-1|l", grade: "FG-450" });
    assert.match(run().out, /7 lot\(s\)/);
    assert.match(run({ fields: { "ml-grade": "FG-300" } }).out, /6 lot\(s\)/);
  });

  test("a date range narrows the set", () => {
    put({ lotKey: "a|h-1|l", reviewedAt: "2026-01-15" });
    put({ lotKey: "b|h-2|l", reviewedAt: "2026-09-15" });
    assert.match(run({ fields: { "ml-from": "2026-06-01" } }).out, /1 lot\(s\)/);
  });

  test("a mixed set is labelled a summary rather than a comparison", () => {
    put({ lotKey: "a|h-1|l", grade: "FG-300" });
    put({ lotKey: "b|h-2|l", grade: "FG-450" });
    assert.match(run().out, /summary, not a comparison/);
  });
});

describe("what the page must never stop saying", () => {
  test("the disclaimer is on every result", () => {
    put();
    const { out } = run();
    assert.match(out, /not a probability that future material/);
    assert.match(out, /not a supplier rating/);
    assert.match(out, /private to this browser/);
  });

  test("the standing copy refuses a single score per mill", () => {
    const panel = html.slice(html.indexOf('id="sc-mode-mill"'), html.indexOf('id="ml-out"'));
    assert.match(panel, /no single score per mill/);
    assert.match(panel, /not a probability that the next delivery conforms/);
    assert.match(panel, /no percentage is shown at all/);
    assert.match(panel, /product rule, not a statistical guarantee/);
  });

  test("the method is rendered with the table", () => {
    put();
    assert.match(run().out, /There is no composite score/);
  });
});

describe("the decision loop", () => {
  const stubCheck = (over = {}) => ({
    lotKey: "northgate|h-77213|l-4",
    overall: over.overall ?? OVERALL.MEETS_CHECKED,
    rulesVersion: RULES_VERSION,
    checked: 1,
    certificate: {
      number: "SYN-CERT-0001", revision: "1", producer: "Northgate Steelworks (synthetic)",
      distributor: null, form: "plate", condition: "normalised",
      statedSpecification: "SYN-SPEC-100", statedRevision: "C", supersedes: null,
      ...over.certificate,
    },
    findings: over.findings ?? [{ property: "C", result: "meets", mandatory: true }],
    documentIssues: over.documentIssues ?? [],
  });

  /** Run the page's own ctDecide over a stub decision form. */
  function decide(check, form = {}) {
    const values = {
      "ct-disposition": "accepted", "ct-reviewer": "QA", "ct-at": "2026-06-01",
      "ct-reasoning": "all applicable limits met", "ct-responsibility": "not established",
      ...form,
    };
    const msg = { innerHTML: "" };
    const sandbox = {
      document: {
        getElementById: (id) =>
          (id === "ct-decision-msg" ? msg : (id in values ? { value: values[id] } : null)),
      },
      window: {
        BW: {
          recordReview, lotFromReview, lotRecord,
          saveLot: (r) => saveLot(r, store),
        },
      },
      ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
      console,
      _ctCheck: check,
    };
    vm.createContext(sandbox);
    new vm.Script(["ctv", "ctDecide"].map(fnSource).join("\n") + "\n;ctDecide();").runInContext(sandbox);
    return msg.innerHTML;
  }

  test("a decision becomes exactly one lot in the record", () => {
    decide(stubCheck());
    assert.equal(loadLots(store).length, 1);
    assert.match(run().out, /1 lot\(s\), 1 producer\(s\)/);
  });

  test("deciding on the same certificate twice does not make two lots", () => {
    decide(stubCheck());
    decide(stubCheck({ certificate: { number: "SYN-CERT-0002" } }));
    assert.equal(loadLots(store).length, 1);
  });

  test("a concession records a nonconforming lot, so it cannot raise the rate", () => {
    // Five clean lots, then one waved through under concession. If a
    // concession counted as conforming the rate would stay at 100%.
    for (let i = 0; i < 5; i++) put({ lotKey: `northgate|h-${i}|l-1` });
    decide(
      stubCheck({
        overall: OVERALL.POTENTIAL_NONCONFORMANCE,
        findings: [{ property: "C", result: "does not meet", mandatory: true }],
      }),
      { "ct-disposition": "accepted under concession", "ct-reasoning": "concession CN-0007" });
    assert.match(run().out, /5 of 6 reviewed lots/);
  });

  test("a decision that departs from the comparison says so", () => {
    const out = decide(
      stubCheck({
        overall: OVERALL.POTENTIAL_NONCONFORMANCE,
        findings: [{ property: "C", result: "does not meet", mandatory: true }],
      }),
      { "ct-disposition": "accepted", "ct-reasoning": "looks fine" });
    assert.match(out, /differs from the comparison/);
  });

  test("a decision with no reviewer is refused, with the reason on screen", () => {
    const out = decide(stubCheck(), { "ct-reviewer": "" });
    assert.match(out, /needs the person/);
    assert.equal(loadLots(store).length, 0);
  });

  test("a decision with no reasoning is refused", () => {
    const out = decide(stubCheck(), { "ct-reasoning": "" });
    assert.match(out, /needs its reasoning/);
    assert.equal(loadLots(store).length, 0);
  });

  test("a certificate that identifies no lot offers no decision block at all", () => {
    const block = html.indexOf("function ctDecisionHTML");
    assert.ok(block > 0);
    assert.match(fnSource("ctDecisionHTML"), /if\(!c\.lotKey\)/);
    assert.match(fnSource("ctDecisionHTML"), /counted once will be counted twice/);
  });

  test("the record names the producer, or says it is attributed to nobody", () => {
    assert.match(decide(stubCheck()), /against Northgate Steelworks \(synthetic\)/);
    const none = decide(stubCheck({ certificate: { producer: "" } }));
    assert.match(none, /attributed to nobody/);
  });
});
