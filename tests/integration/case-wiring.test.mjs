/**
 * Save and resume, executed against the page's own code.
 *
 * The interesting failure here is not a crash — it is a case that resumes
 * *almost* correctly: one field left behind from the previous case, or a
 * driver row silently dropped. Both would produce a confident wrong number, so
 * these tests run the real collect/restore pair over a stub form and compare
 * field by field.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import {
  newCase, saveCase, loadCase, listCases, deleteCase, storeStatus, STATUS,
} from "../../src/services/case-store.mjs";

const html = readFileSync("index.html", "utf8");

/** Every def-* control the Defender page actually declares. */
function declaredFields() {
  const page = html.slice(html.indexOf('id="page-tool-defender"'), html.indexOf('id="page-tool-sim"'));
  const ids = new Set();
  for (const m of page.matchAll(/<(input|select|textarea)\b[^>]*\bid="(def-[a-z0-9-]+)"[^>]*>/g)) {
    if (/type="file"/.test(m[0])) continue;
    ids.add(m[2]);
  }
  return [...ids];
}

/** A stub form carrying exactly those controls, plus the page's own functions. */
function makeSandbox(store) {
  const els = new Map();
  const mk = (id, type = "text") => ({ id, type, value: "", innerHTML: "", scrollIntoView() {} });
  for (const id of declaredFields()) els.set(id, mk(id));
  for (const id of ["def-cases", "def-calc", "def-out", "def-drivers", "def-extract"]) els.set(id, mk(id));
  els.set("oc-category", mk("oc-category"));

  const page = {
    id: "page-tool-defender",
    scrollIntoView() {},
    querySelectorAll: (sel) => {
      const want = [...sel.matchAll(/(input|select|textarea)\[id\^="def-"\]/g)].map((m) => m[1]);
      return [...els.values()].filter((e) => e.id.startsWith("def-") &&
        want.length > 0 && !["def-cases", "def-calc", "def-out", "def-drivers", "def-extract"].includes(e.id));
    },
  };
  els.set("page-tool-defender", page);

  const sandbox = {
    document: { getElementById: (id) => els.get(id) ?? null },
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    console,
    _defRows: [],
    _defResult: null,
    defRenderDrivers() {},
    window: {
      BW: {
        newCase, listCases, storeStatus, CASE_STATUS: STATUS,
        saveCase: (c) => saveCase(c, store),
        loadCase: (id) => loadCase(id, store),
        deleteCase: (id) => deleteCase(id, store),
        listCasesBound: () => listCases(store),
      },
    },
    _els: els,
  };
  // listCases/storeStatus need the same store as the writes.
  sandbox.window.BW.listCases = () => listCases(store);
  sandbox.window.BW.storeStatus = () => storeStatus(store);

  const src = html.slice(html.indexOf("var _defCaseId=null;"), html.indexOf("\nfunction defHistoryHTML(){"));
  vm.createContext(sandbox);
  new vm.Script(src).runInContext(sandbox);
  return sandbox;
}

function makeStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

let store, sb;
beforeEach(() => { store = makeStore(); sb = makeSandbox(store); });

const set = (id, v) => { sb._els.get(id).value = v; };
const get = (id) => sb._els.get(id).value;

describe("the page is wired to the store", () => {
  test("the store is imported and mounted", () => {
    assert.match(html, /from "\.\/src\/services\/case-store\.mjs"/);
    const mount = (html.match(/window\.BW\s*=\s*\{([\s\S]*?)\};/) || [])[1] || "";
    for (const name of ["newCase", "saveCase", "loadCase", "listCases", "deleteCase", "storeStatus"]) {
      assert.match(mount, new RegExp(name), `${name} is not exposed`);
    }
  });

  test("there is somewhere to put the list, and a control to save", () => {
    assert.match(html, /<div id="def-cases"/);
    assert.match(html, /onclick="defSaveCase\(\)"/);
  });

  test("the list renders when the Defender is opened", () => {
    assert.match(html, /p==="tool-defender"&&typeof defRenderCases==="function"/);
  });

  test("the list sits above the form, because choosing a case comes first", () => {
    assert.ok(html.indexOf('id="def-cases"') < html.indexOf('id="def-price"'));
  });
});

describe("collecting the form", () => {
  test("every declared field is captured, not a hand-written subset", () => {
    const declared = declaredFields();
    assert.ok(declared.length >= 15, `expected the Defender's fields, found ${declared.length}`);
    for (const id of declared) set(id, "v-" + id);
    const data = sb.defCollect();
    for (const id of declared) {
      assert.equal(data.fields[id], "v-" + id, `${id} was not captured`);
    }
  });

  test("a field added to the page later is captured without touching this code", () => {
    // The collection is derived from the DOM, which is the point: the failure
    // being prevented is a new input that nobody remembers to add to a list.
    const extra = { id: "def-brand-new", type: "text", value: "kept" };
    sb._els.set("def-brand-new", extra);
    assert.equal(sb.defCollect().fields["def-brand-new"], "kept");
  });

  test("the driver rows come with it", () => {
    sb._defRows = [["Material", "42", "10", "index", "2025-01", "2025-06", "2026-06", "3"]];
    const data = sb.defCollect();
    // Compared by value: the vm context has its own Array prototype, so a
    // strict deep-equal rejects structurally identical rows across realms.
    assert.equal(JSON.stringify(data.drivers),
      JSON.stringify([["Material", "42", "10", "index", "2025-01", "2025-06", "2026-06", "3"]]));
  });

  test("the drivers are copied, not referenced", () => {
    sb._defRows = [["Material", "42"]];
    const data = sb.defCollect();
    sb._defRows[0][1] = "99";
    assert.equal(data.drivers[0][1], "42", "a later edit must not rewrite a saved case");
  });
});

describe("restoring", () => {
  test("a round trip returns every value", () => {
    set("def-price", "100.00"); set("def-volume", "50000"); set("def-request", "9");
    sb._defRows = [["Material", "42", "10", "direct", "", "", "", ""]];
    const data = sb.defCollect();

    set("def-price", "999"); sb._defRows = [];
    sb.defRestore(data);

    assert.equal(get("def-price"), "100.00");
    assert.equal(get("def-volume"), "50000");
    assert.equal(JSON.stringify(sb._defRows),
      JSON.stringify([["Material", "42", "10", "direct", "", "", "", ""]]));
  });

  test("a field missing from the saved case is cleared, not inherited", () => {
    // The dangerous case: resuming case B and silently keeping case A's volume.
    set("def-price", "100.00"); set("def-volume", "50000");
    const data = sb.defCollect();
    delete data.fields["def-volume"];

    sb.defRestore(data);
    assert.equal(get("def-volume"), "", "the previous case's number must not survive");
    assert.equal(get("def-price"), "100.00");
  });

  test("restoring nothing does not throw", () => {
    sb.defRestore(undefined);
    sb.defRestore({});
  });
});

describe("saving and resuming a case", () => {
  test("saving stores what is on the form", () => {
    set("def-case", "SC-001"); set("def-supplier", "Meridian Fabrication Ltd"); set("def-price", "100.00");
    sb.defSaveCase();

    const [row] = listCases(store);
    assert.equal(row.ref, "SC-001");
    assert.equal(row.supplier, "Meridian Fabrication Ltd");
    assert.equal(loadCase(row.id, store).data.fields["def-price"], "100.00");
  });

  test("saving twice updates the same case rather than making a second", () => {
    set("def-case", "SC-001"); sb.defSaveCase();
    set("def-price", "120.00"); sb.defSaveCase();
    assert.equal(listCases(store).length, 1);
    assert.equal(loadCase(listCases(store)[0].id, store).data.fields["def-price"], "120.00");
  });

  test("a saved case is a draft until it has been calculated", () => {
    set("def-case", "SC-001"); sb.defSaveCase();
    assert.equal(listCases(store)[0].status, STATUS.DRAFT);

    sb._defResult = { unitPrice: {} };
    sb.defSaveCase();
    assert.equal(listCases(store)[0].status, STATUS.ANALYSED);
  });

  test("resuming loads the other case and leaves nothing of this one behind", () => {
    set("def-case", "SC-A"); set("def-price", "100.00"); set("def-volume", "50000");
    sb.defSaveCase();
    const idA = listCases(store)[0].id;

    sb.defNewCase();
    set("def-case", "SC-B"); set("def-price", "80.00");
    sb.defSaveCase();

    sb.defResumeCase(idA);
    assert.equal(get("def-case"), "SC-A");
    assert.equal(get("def-price"), "100.00");
    assert.equal(get("def-volume"), "50000");
  });

  test("resuming clears the previous analysis rather than showing it against new inputs", () => {
    set("def-case", "SC-A"); sb.defSaveCase();
    const id = listCases(store)[0].id;
    sb._defResult = { unitPrice: {} };
    sb._els.get("def-calc").innerHTML = "<p>old figures</p>";

    sb.defResumeCase(id);
    assert.equal(sb._defResult, null, "a stored result could have come from a different engine");
    assert.equal(sb._els.get("def-calc").innerHTML, "");
  });

  test("starting a new case empties the form", () => {
    set("def-case", "SC-A"); set("def-price", "100.00");
    sb.defSaveCase();
    sb.defNewCase();
    assert.equal(get("def-case"), "");
    assert.equal(get("def-price"), "");
    assert.equal(listCases(store).length, 1, "the saved case is not deleted by starting a new one");
  });

  test("deleting removes it and forgets it was open", () => {
    set("def-case", "SC-A"); sb.defSaveCase();
    sb.defDeleteCase(listCases(store)[0].id);
    assert.deepEqual(listCases(store), []);
    sb.defSaveCase();
    assert.equal(listCases(store).length, 1, "the next save starts a new case, not a resurrection");
  });

  test("resuming an id that is gone does nothing rather than blanking the form", () => {
    set("def-price", "100.00");
    sb.defResumeCase("not-a-real-id");
    assert.equal(get("def-price"), "100.00");
  });
});

describe("the list", () => {
  test("an empty store explains what saving is for", () => {
    const out = sb.defCaseListHTML();
    assert.match(out, /No saved cases/);
    assert.match(out, /picked up days later/);
  });

  test("a saved case appears with its reference, supplier and status", () => {
    set("def-case", "SC-001"); set("def-supplier", "Meridian Fabrication Ltd");
    sb.defSaveCase();
    const out = sb.defCaseListHTML();
    assert.match(out, /Saved cases \(1\)/);
    assert.match(out, /SC-001/);
    assert.match(out, /Meridian Fabrication Ltd/);
    assert.match(out, /draft/);
  });

  test("the open case is marked, so it is clear what is on screen", () => {
    set("def-case", "SC-001"); sb.defSaveCase();
    assert.match(sb.defCaseListHTML(), />open</);
  });

  test("it says the data stays on this device", () => {
    set("def-case", "SC-001"); sb.defSaveCase();
    assert.match(sb.defCaseListHTML(), /Stored in this browser only/);
  });

  test("a case withheld by the version gate is reported, not hidden", () => {
    set("def-case", "SC-001"); sb.defSaveCase();
    const raw = JSON.parse(store.getItem("bw.cases.v1"));
    raw.push({ ...raw[0], id: "other", schema: 99 });
    store.setItem("bw.cases.v1", JSON.stringify(raw));

    const out = sb.defCaseListHTML();
    assert.match(out, /1 case\(s\) were saved by a different version/);
    assert.match(out, /have not been deleted/);
  });

  test("a supplier name cannot inject markup through the list", () => {
    set("def-case", "SC-001");
    set("def-supplier", '<img src=x onerror="alert(1)">');
    sb.defSaveCase();
    const out = sb.defCaseListHTML();
    assert.equal(/<img src=x/.test(out), false, "the name must be escaped");
    assert.match(out, /&lt;img/);
  });

  test("nothing raw reaches the markup", () => {
    set("def-case", "SC-001"); sb.defSaveCase();
    assert.equal(/\[object Object\]|undefined|NaN/.test(sb.defCaseListHTML()), false);
  });
});

describe("storage that refuses", () => {
  test("a blocked store is said out loud rather than losing the case quietly", () => {
    const blocked = {
      getItem() { throw new Error("SecurityError: denied"); },
      setItem() { throw new Error("SecurityError: denied"); },
      removeItem() { throw new Error("SecurityError: denied"); },
    };
    const s2 = makeSandbox(blocked);
    s2._els.get("def-case").value = "SC-001";
    s2.defSaveCase();
    assert.match(s2._els.get("def-cases").innerHTML, /blocking local storage/);
  });
});
