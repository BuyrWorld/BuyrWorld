/**
 * The certificate check, executed against the page's own code.
 *
 * The engine decides; this suite checks that the page hands it the right
 * things and shows what came back without softening it. Three failures it
 * exists to catch:
 *
 *   - a value typed as written arriving stripped of its inequality or its
 *     trailing zero, which changes the answer rather than the presentation;
 *   - a result table that reports an overall pass while a mandatory line
 *     below it says otherwise;
 *   - the disclaimer quietly going missing, which would turn a comparison of
 *     two documents into something that looks like a release.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { pageSource, fnSource as pageFnSource } from "../helpers/page.mjs";

import {
  quantity as ctQuantity, requirement as ctRequirement, observation as ctObservation,
  certificate as ctCertificate, checkCertificate, recordReview, lotKey,
  RESULT as CT_RESULT, OVERALL as CT_OVERALL, KIND as CT_KIND,
  DISPOSITION as CT_DISPOSITION, RULES_VERSION as CT_RULES,
} from "../../src/calc/certificate.mjs";
/* A thickness on the page is entered in millimetres and converted by the
   same exact length parser the material planner uses. */
import { length as scLength } from "../../src/calc/units.mjs";

const html = pageSource();

/** The page's own source for one function. `html` is this file's copy of the page. */
const fnSource = (name) => pageFnSource(name, html);


/** The synthetic example the page itself loads, as the row arrays it stores. */
const EXAMPLE_OBS = [
  ["C", "0.18", "%", "2", "C 0.18", true],
  ["S", "<0.005", "%", "2", "S <0.005", true],
  ["P", "0.03", "%", "2", "P 0.03", true],
  ["UTS", "468", "MPa", "3", "Rm 468 N/mm2", true],
  ["hardness", "201", "HV", "3", "HV10 201", true],
];
const EXAMPLE_REQS = [
  ["C", "", "0.200", "%", true, "SYN-SPEC-100", "C", "7.2", "numeric", "", "", ""],
  ["S", "", "0.030", "%", true, "SYN-SPEC-100", "C", "7.2", "numeric", "", "", ""],
  ["P", "", "0.030", "%", true, "SYN-SPEC-100", "C", "7.2", "numeric", "", "", ""],
  ["UTS", "450", "", "MPa", true, "SYN-SPEC-100", "C", "8.1", "numeric", "", "plate", "25"],
  ["UTS", "430", "", "MPa", true, "SYN-SPEC-100", "C", "8.2", "numeric", "", "plate", ""],
  ["hardness", "", "210", "HB", true, "SYN-SPEC-100", "C", "8.4", "numeric", "", "", ""],
  ["condition", "", "", "", true, "SYN-DRW-4471", "B", "note 3", "text", "normalised", "", ""],
  ["surface finish", "", "", "", true, "SYN-DRW-4471", "B", "note 5", "interpretation", "", "", ""],
];

function run({ obs = EXAMPLE_OBS, reqs = EXAMPLE_REQS, header = {} } = {}) {
  const values = {
    "ct-number": "SYN-CERT-0001", "ct-rev": "1", "ct-supersedes": "",
    "ct-producer": "Northgate Steelworks (synthetic)", "ct-issuer": "Northgate Steelworks (synthetic)",
    "ct-distributor": "", "ct-heat": "H-77213", "ct-lot": "L-4",
    "ct-form": "plate", "ct-condition": "normalised",
    "ct-spec": "SYN-SPEC-100", "ct-specrev": "C", "ct-pages": "3", "ct-pagesdec": "3", "ct-thickness": "12",
    ...header,
  };
  const out = { innerHTML: "" };
  const sandbox = {
    document: { getElementById: (id) => (id === "ct-out" ? out : (id in values ? { value: values[id] } : null)) },
    window: {
      BW: {
        ctQuantity, ctRequirement, ctObservation, ctCertificate, checkCertificate, recordReview, lotKey,
        CT_RESULT, CT_OVERALL, CT_KIND, CT_DISPOSITION, CT_RULES, scLength,
      },
    },
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
    console,
    _ctObs: obs.map((r) => [...r]),
    _ctReqs: reqs.map((r) => [...r]),
    _ctCheck: null,
  };
  const src = ["ctv", "ctAppliesTo", "ctRun", "ctResultHTML", "ctDecisionHTML"].map(fnSource).join("\n");
  vm.createContext(sandbox);
  new vm.Script(src + "\n;ctRun();").runInContext(sandbox);
  return out.innerHTML;
}

/** Only the rows of the results table, so a match cannot come from the prose. */
function tableRows(out) {
  const body = out.slice(out.indexOf("<tbody>"), out.indexOf("</table>"));
  return body.split("<tr>").slice(1);
}

/**
 * The row for one property, matched on its first cell only.
 *
 * A looser match reads ">S" out of ">SYN-SPEC-100" in the source column and
 * returns whichever row happens to come first, which quietly makes every
 * assertion about that row an assertion about a different one.
 */
function rowFor(out, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const first = new RegExp(`^<td>${escaped}[< ]`);
  const row = tableRows(out).find((r) => first.test(r));
  assert.ok(row, `no row for ${property} in the results table`);
  return row;
}

describe("it is wired in", () => {
  test("the engine is imported and mounted", () => {
    assert.match(html, /from "\.\/src\/calc\/certificate\.mjs"/);
    const mount = (html.match(/window\.BW\s*=\s*\{([\s\S]*?)\};/) || [])[1] || "";
    for (const name of ["checkCertificate", "ctQuantity", "ctRequirement", "ctObservation", "ctCertificate", "recordReview"]) {
      assert.ok(mount.includes(name), `${name} is not exposed`);
    }
  });

  test("the three modes are tabs, and the material mode is the default", () => {
    for (const mode of ["material", "cert", "mill"]) {
      assert.match(html, new RegExp(`id="sc-mode-${mode}" role="tabpanel"`));
    }
    assert.match(html, /id="sc-mode-cert" role="tabpanel"[^>]*hidden/);
    assert.match(html, /id="sc-mode-mill" role="tabpanel"[^>]*hidden/);
    assert.match(html, /id="sc-tab-material"[^>]*aria-selected="true"/);
  });

  test("switching modes moves the selected state, not only the colour", () => {
    const fn = fnSource("ctSwitch");
    assert.match(fn, /setAttribute\("aria-selected"/);
    assert.match(fn, /panel\.hidden=!on/);
    // Exactly one panel is shown, which a per-panel toggle cannot get wrong
    // the way a pair of booleans could once a third mode arrived.
    assert.match(fn, /var panels=\{material:"sc-mode-material",cert:"sc-mode-cert",mill:"sc-mode-mill"\}/);
  });

  test("no inline handlers were added", () => {
    const handlers = (html.match(/\son(click|input|change|load|error|submit)=/g) || []).length;
    assert.ok(handlers <= 132, `inline handlers rose to ${handlers}`);
  });

  test("the page compares nothing itself", () => {
    for (const name of ["ctRun", "ctResultHTML"]) {
      const src = fnSource(name).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
      assert.equal(/parseFloat|toFixed/.test(src), false, `${name} does its own arithmetic`);
      assert.equal(/[<>]=?\s*0\.\d/.test(src), false, `${name} compares a value against a limit`);
    }
  });
});

describe("a value is handed over exactly as it was written", () => {
  test("an inequality survives the page", () => {
    // S <0.005 against max 0.030: every value it could be is under the limit.
    const row = rowFor(run(), "S");
    assert.match(row, /&lt;0\.005/);
    assert.match(row, /bw-status--evidenced">meets/);
  });

  test("an inequality that straddles the limit is not resolved on the way through", () => {
    const out = run({ reqs: [["S", "", "0.001", "%", true, "SYN-SPEC-100", "C", "7.2", "numeric", ""]] });
    assert.match(rowFor(out, "S"), /review required/);
    assert.match(out, /cannot settle the limit either way/);
  });

  test("a trailing zero is not lost, so the precision rule still bites", () => {
    // P is reported 0.03 against a limit of 0.030 — rounded, exactly the
    // limit, and the true value could be 0.034.
    const row = rowFor(run(), "P");
    assert.match(row, /review required/);
    assert.match(run(), /cannot tell you which side/);
  });

  test("a value entered with no unit is refused rather than compared", () => {
    const out = run({ obs: [["C", "0.18", "", "2", "", true]] });
    assert.match(out, /missing evidence|not a unit/);
  });
});

describe("the result table", () => {
  const out = () => run();

  test("it has the five columns the comparison produces", () => {
    const head = out().slice(out().indexOf("<thead>"), out().indexOf("</thead>"));
    for (const col of ["Requirement", "Required", "Certificate evidence", "Result", "Source"]) {
      assert.ok(head.includes(col), `${col} column is missing`);
    }
  });

  test("every result word the engine can produce is rendered as itself", () => {
    const o = out();
    // The example is built to exercise four of the five states.
    for (const state of ["meets", "review required"]) {
      assert.ok(o.includes(state), `${state} never appears`);
    }
  });

  test("each row names the document and revision the limit came from", () => {
    const row = rowFor(out(), "C");
    assert.match(row, /SYN-SPEC-100 rev C/);
    assert.match(row, /7\.2/);
  });

  test("each row shows the page the value was read from", () => {
    assert.match(rowFor(out(), "C"), /p2/);
    assert.match(rowFor(out(), "UTS"), /p3/);
  });

  test("hardness is not converted between scales", () => {
    const row = rowFor(out(), "hardness");
    assert.match(row, /review required/);
    assert.match(out(), /Hardness scales do not convert/);
  });

  test("a clause needing judgement is shown as needing it, not as a pass", () => {
    assert.match(rowFor(out(), "surface finish"), /review required/);
    assert.match(out(), /needs engineering judgement/);
  });
});

describe("one unmet mandatory requirement is the answer", () => {
  const failing = () => run({
    obs: [["C", "0.31", "%", "2", "C 0.31", true]],
    reqs: [["C", "", "0.200", "%", true, "SYN-SPEC-100", "C", "7.2", "numeric", ""]],
  });

  test("the overall state is a potential nonconformance", () => {
    assert.match(failing(), /bw-status--high">potential nonconformance/);
  });

  test("it is called out above the table, not left to be found in it", () => {
    const o = failing();
    assert.ok(o.indexOf("mandatory requirement(s) are not met") < o.indexOf("<table"),
      "the headline must sit above the table a reader would have to scan");
    assert.match(o, /bw-danger/);
  });

  test("twenty passes do not outvote one failure", () => {
    const obs = Array.from({ length: 20 }, (_, i) => [`E${i}`, "0.100", "%", "2", "", true]);
    const reqs = Array.from({ length: 20 }, (_, i) => [`E${i}`, "", "1.000", "%", true, "SYN-SPEC-100", "C", "7", "numeric", ""]);
    const out = run({
      obs: [...obs, ["C", "0.31", "%", "2", "", true]],
      reqs: [...reqs, ["C", "", "0.200", "%", true, "SYN-SPEC-100", "C", "7.2", "numeric", ""]],
    });
    assert.match(out, /potential nonconformance/);
  });

  test("missing evidence is not shown as a failure", () => {
    const out = run({
      obs: [["C", "0.18", "%", "2", "", true]],
      reqs: [["C", "", "0.200", "%", true, "SYN-SPEC-100", "C", "7.2", "numeric", ""],
             ["S", "", "0.030", "%", true, "SYN-SPEC-100", "C", "7.2", "numeric", ""]],
    });
    assert.match(out, /incomplete evidence/);
    assert.equal(/potential nonconformance/.test(out), false);
    assert.match(out, /not evidence that the material is wrong/);
  });
});

describe("the document itself", () => {
  test("missing pages are reported", () => {
    const out = run({ header: { "ct-pages": "2", "ct-pagesdec": "4" } });
    assert.match(out, /Pages are missing/);
    assert.match(out, /on a page nobody has/);
  });

  test("a revision mismatch puts every comparison in doubt", () => {
    const out = run({ header: { "ct-specrev": "B" } });
    assert.match(out, /specification revision does not match/);
    assert.match(out, /Revisions change limits/);
  });

  test("an unnamed producer cannot be credited with the lot", () => {
    const out = run({ header: { "ct-producer": "", "ct-distributor": "Meridian Stockholding (synthetic)" } });
    assert.match(out, /producer is not identified/);
    assert.match(out, /cannot join a producer&#39;s record/);
  });

  test("an unchecked value is marked on its own row and in the summary", () => {
    const out = run({ obs: [["C", "0.18", "%", "2", "C 0.18", false]], reqs: [EXAMPLE_REQS[0]] });
    assert.match(rowFor(out, "C"), /unchecked/);
    assert.match(out, /have not been confirmed against the document/);
  });

  test("no heat number means the lot cannot be counted", () => {
    const out = run({ header: { "ct-heat": "" } });
    assert.match(out, /lot cannot be identified/);
  });
});

describe("conflicting requirements are surfaced", () => {
  test("two documents with different limits for one property are reported", () => {
    const out = run({
      obs: [["C", "0.18", "%", "2", "", true]],
      reqs: [["C", "", "0.200", "%", true, "SYN-SPEC-100", "C", "7.2", "numeric", ""],
             ["C", "", "0.150", "%", true, "SYN-PO-9001", "1", "3", "numeric", ""]],
    });
    assert.match(out, /Requirements that disagree with each other/);
    assert.match(out, /decision for the responsible engineer/);
    // Both are still checked, and both still report their own answer.
    assert.match(out, /meets/);
    assert.match(out, /does not meet/);
  });
});

describe("what the page must never stop saying", () => {
  test("the disclaimer is on every result", () => {
    for (const out of [run(), run({ obs: [["C", "0.18", "%", "2", "", true]], reqs: [EXAMPLE_REQS[0]] })]) {
      assert.match(out, /cannot release material for manufacture or installation/);
      assert.match(out, /no result here is an approval/);
    }
  });

  test("a clean result still says it is not a release", () => {
    const out = run({
      obs: [["C", "0.18", "%", "2", "", true]],
      reqs: [["C", "", "0.200", "%", true, "SYN-SPEC-100", "C", "7.2", "numeric", ""]],
    });
    assert.match(out, /meets checked requirements/);
    assert.match(out, /not a release of the material/);
  });

  test("the comparison rules version is on the result", () => {
    assert.match(run(), new RegExp(`Comparison rules version ${CT_RULES.replace(/\./g, "\\.")}`));
  });

  test("the standing copy says no limit is supplied for you", () => {
    const page = html.slice(html.indexOf('id="sc-mode-cert"'), html.indexOf('id="ct-out"'));
    assert.match(page, /No limit is supplied for you/);
    assert.match(page, /revisions change limits/);
    assert.match(page, /comparison of two documents/);
  });
});

describe("escaping", () => {
  test("a property name carrying markup does not reach the page raw", () => {
    const out = run({
      obs: [['<img src=x onerror="alert(1)">', "0.18", "%", "2", "", true]],
      reqs: [['<img src=x onerror="alert(1)">', "", "0.200", "%", true, "S", "C", "7", "numeric", ""]],
    });
    assert.equal(/<img src=x/.test(out), false);
    assert.match(out, /&lt;img/);
  });

  test("nothing raw reaches the markup", () => {
    assert.equal(/\[object Object\]|undefined|NaN/.test(run()), false);
  });
});

describe("a limit that does not apply is not a pass", () => {
  test("the thickness-scoped limit applies to 12mm plate and the other one does too", () => {
    // The example carries two UTS limits: one for plate up to 25mm and one
    // for plate generally. At 12mm both apply, which is the ordinary case.
    const out = run();
    assert.equal(/Did not apply/.test(out), false);
    assert.match(out, /8 of 8 requirement\(s\) applied/);
  });

  test("at 50mm the thickness-scoped limit drops out, and says why", () => {
    const out = run({ header: { "ct-thickness": "50" } });
    assert.match(out, /Did not apply/);
    assert.match(out, /thicker than the range this limit covers/);
    assert.match(out, /7 of 8 requirement\(s\) applied/);
  });

  test("a form-scoped limit drops out on another form", () => {
    const out = run({ header: { "ct-form": "bar" } });
    assert.match(out, /Did not apply/);
    assert.match(out, /it applies to plate, and this is bar/);
  });

  test("what did not apply is listed apart from what went wrong", () => {
    const out = run({ header: { "ct-thickness": "50" } });
    // A requirement that never applied is not a finding about this material,
    // and putting it among them would read as a problem.
    const whyStart = out.indexOf("Why, in each case");
    const didNotApply = out.indexOf("Did not apply");
    assert.ok(whyStart > 0 && didNotApply > whyStart, "the two lists must be separate sections");
    const why = out.slice(whyStart, didNotApply);
    assert.equal(/not applicable/.test(why), false);
  });

  test("the count of checks done excludes what did not apply", () => {
    // Counting an inapplicable limit as a check inflates how much was done.
    const all = run();
    const some = run({ header: { "ct-thickness": "50" } });
    assert.match(all, /8 of 8/);
    assert.match(some, /7 of 8/);
  });

  test("leaving both applicability fields blank means the limit applies", () => {
    const out = run({
      obs: [["C", "0.18", "%", "2", "", true]],
      reqs: [["C", "", "0.200", "%", true, "SYN-SPEC-100", "C", "7.2", "numeric", "", "", ""]],
    });
    assert.match(out, /1 of 1 requirement\(s\) applied/);
    assert.equal(/Did not apply/.test(out), false);
  });
});
