/**
 * The confirmation queue.
 *
 * What this has to get right is not the happy path — it is the four places
 * where a proposed value could quietly become a fact:
 *
 *   - a correction that throws away what the document said, so nobody can
 *     later answer why the case and the drawing disagree;
 *   - "not on the drawing" and "that reading is wrong" collapsing into a
 *     blank field, which is also what a field nobody has looked at looks like;
 *   - a decision surviving a change to the document it was a decision about;
 *   - a typed value and a read value being silently resolved in favour of
 *     one of them.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  reviewItem, queue, carryForward, needsReReview, documentRef, sameDocument,
  confirm, correct, markUnknown, reject,
  usable, confirmedValues, outstanding, sourceConflict, sourceConflicts,
  stateOf, methodSaid, history,
  METHOD, ACTION, DISPOSITION,
} from "../../src/intake/review.mjs";

const DOC = documentRef({ filename: "brk-a-102.pdf", revision: "B", fingerprint: "abc123" });

const candidate = (over = {}) => ({
  field: "thickness", label: "Thickness", value: "5", unit: "mm",
  page: 1, quote: "Thickness 5 mm", confidence: "labelled", ...over,
});

const item = (over = {}) => reviewItem(candidate(over), { method: METHOD.RULE, document: DOC });

const extraction = (...candidates) => ({ candidates });

/* ------------------------------------------------------------- the reading */

describe("a reading arrives proposed and carrying its evidence", () => {
  test("nothing is usable until somebody says so", () => {
    const i = item();
    assert.equal(i.disposition, DISPOSITION.PROPOSED);
    assert.equal(usable(i), false);
    assert.equal(stateOf(i), "Extracted — check this");
  });

  test("it says how it was read, and will not be built without that", () => {
    /* `specs/03` route 4 turns on the difference: a model reading OCR output
       is a second opinion on the same characters, not a second source. An
       item that does not know which it is cannot be weighed. */
    assert.throws(() => reviewItem(candidate(), { document: DOC }), /how it was read/);
    assert.throws(() => reviewItem(candidate(), { method: "guessed", document: DOC }), /how it was read/);
    assert.equal(item().evidence.method, METHOD.RULE);
  });

  test("and which document it came from", () => {
    assert.throws(() => reviewItem(candidate(), { method: METHOD.RULE }), /which document/);
  });

  test("a region it does not know is null, never the whole page", () => {
    /* The rule reader is handed a page's text and never sees geometry, so
       there is no region — and a crop covering the whole page would point a
       reviewer at something that proves nothing. */
    assert.equal(item().evidence.region, null);
  });

  test("a region it does know is kept", () => {
    const withRegion = item({ region: { page: 1, x: 10, y: 20, w: 80, h: 12 } });
    assert.deepEqual(withRegion.evidence.region, { page: 1, x: 10, y: 20, w: 80, h: 12 });
  });

  test("how it was read is said plainly, not as a category name", () => {
    assert.match(methodSaid(item()), /written rule/);
    assert.match(methodSaid(item({})), /No model was asked/);

    const ocr = reviewItem(candidate(), { method: METHOD.OCR, document: DOC });
    assert.match(methodSaid(ocr), /not verified/);

    const model = reviewItem(candidate(), { method: METHOD.MODEL, document: DOC });
    assert.match(methodSaid(model), /second opinion on the same characters rather than a second source/);
  });
});

/* -------------------------------------------------------------- confirming */

describe("confirming", () => {
  test("it becomes usable, and records who", () => {
    const i = confirm(item(), "a buyer");
    assert.equal(usable(i), true);
    assert.equal(i.disposition, DISPOSITION.CONFIRMED);
    assert.equal(history(i).length, 1);
    assert.equal(history(i)[0].by, "a buyer");
    assert.equal(history(i)[0].action, ACTION.CONFIRM);
  });

  test("an unattributed decision is refused", () => {
    /* There is no such thing as "somebody confirmed this". */
    assert.throws(() => confirm(item()), /who made it/);
    assert.throws(() => correct(item(), { value: "6" }), /who made it/);
    assert.throws(() => markUnknown(item()), /who made it/);
    assert.throws(() => reject(item()), /who made it/);
  });

  test("the time is recorded, to the second", () => {
    const i = confirm(item(), "a buyer");
    assert.match(history(i)[0].at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

/* -------------------------------------------------------------- correcting */

describe("correcting keeps what the document said", () => {
  test("the evidence is untouched, and the value moves", () => {
    /* The behaviour this module exists for. The page overwrote the value in
       place, so the moment somebody disagreed with the drawing, what the
       drawing said was gone. */
    const i = correct(item(), { value: "5.2" }, "a buyer");
    assert.equal(i.value, "5.2");
    assert.equal(i.evidence.value, "5", "the reading was overwritten");
    assert.equal(i.evidence.quote, "Thickness 5 mm");
    assert.equal(usable(i), true);
  });

  test("and the revision says what it was changed from, by whom", () => {
    const i = correct(item(), { value: "5.2" }, "a buyer");
    const [r] = history(i);
    assert.equal(r.action, ACTION.CORRECT);
    assert.equal(r.from, "5");
    assert.equal(r.to, "5.2");
    assert.equal(r.by, "a buyer");
  });

  test("corrections stack, and the whole history survives", () => {
    let i = correct(item(), { value: "5.2" }, "a buyer");
    i = correct(i, { value: "5.5" }, "an engineer");
    assert.equal(i.value, "5.5");
    assert.equal(history(i).length, 2);
    assert.deepEqual(history(i).map((r) => r.to), ["5.2", "5.5"]);
    assert.equal(i.evidence.value, "5", "the original reading is still there after two corrections");
  });

  test("a unit may be corrected too, since a wrong unit is a wrong value", () => {
    const i = correct(item(), { value: "5", unit: "in" }, "a buyer");
    assert.equal(i.unit, "in");
    assert.equal(i.evidence.unit, "mm");
  });

  test("an empty correction is refused, and told where to go instead", () => {
    /* Blanking the box is how somebody says "I do not know" when nothing
       better is offered, and it would land as a confirmed empty value. */
    for (const v of ["", "   ", null, undefined]) {
      assert.throws(() => correct(item(), { value: v }, "a buyer"), /mark it unknown/);
    }
  });
});

/* ------------------------------------------------- the two missing actions */

describe("not known and wrong are different answers", () => {
  test("marked unknown has been looked at, and is not usable", () => {
    const i = markUnknown(item(), "a buyer", "the drawing does not give a thickness");
    assert.equal(i.disposition, DISPOSITION.UNKNOWN);
    assert.equal(i.value, null);
    assert.equal(usable(i), false);
    assert.equal(stateOf(i), "Not known yet");
    assert.equal(i.why, "the drawing does not give a thickness");
  });

  test("rejected says the reading was wrong, which is not the same thing", () => {
    const i = reject(item(), "a buyer", "that 5 is the drawing sheet number");
    assert.equal(i.disposition, DISPOSITION.REJECTED);
    assert.equal(usable(i), false);
    assert.equal(stateOf(i), "Missing");
    assert.notEqual(stateOf(i), stateOf(markUnknown(item(), "a buyer")));
  });

  test("a rejected reading is kept rather than deleted", () => {
    /* A rule that is rejected on every drawing of a kind is the most useful
       thing this queue can report, and a deleted row reports nothing. */
    const i = reject(item(), "a buyer", "that is the sheet number");
    assert.equal(i.evidence.value, "5");
    assert.equal(i.evidence.quote, "Thickness 5 mm");
    assert.equal(history(i)[0].why, "that is the sheet number");
  });

  test("neither reaches the values anything downstream may use", () => {
    const items = [
      confirm(item({ field: "thickness" }), "a buyer"),
      markUnknown(item({ field: "width" }), "a buyer"),
      reject(item({ field: "length" }), "a buyer"),
      item({ field: "material" }),
    ];
    assert.deepEqual(confirmedValues(items).map((v) => v.field), ["thickness"]);
    assert.deepEqual(outstanding(items).map((i) => i.field), ["material"]);
  });

  test("a corrected value is offered as corrected, not as read", () => {
    const items = [correct(item(), { value: "5.2" }, "a buyer")];
    assert.equal(confirmedValues(items)[0].from, "corrected by a person");
    assert.equal(confirmedValues([confirm(item(), "a buyer")])[0].from, "read and confirmed");
  });
});

/* ----------------------------------------------------------- the document */

describe("a decision belongs to the document it was made about", () => {
  const other = documentRef({ filename: "brk-a-102.pdf", revision: "C", fingerprint: "def456" });

  test("two references match only when everything matches", () => {
    assert.equal(sameDocument(DOC, documentRef({ filename: "brk-a-102.pdf", revision: "B", fingerprint: "abc123" })), true);
    assert.equal(sameDocument(DOC, other), false, "a new revision is a new document");
    assert.equal(sameDocument(DOC, documentRef({ filename: "brk-a-102.pdf", revision: "B" })), false,
      "the same name and revision with different contents is not the same document");
    assert.equal(sameDocument(DOC, null), false);
  });

  test("a document reference needs a file", () => {
    assert.throws(() => documentRef({}), /the file it came from/);
  });

  test("re-reading the same document keeps the decisions", () => {
    /* Somebody who ticked fourteen rows should not tick them again because a
       page was re-read. */
    const first = queue(extraction(candidate()), { method: METHOD.RULE, document: DOC });
    const decided = [confirm(first[0], "a buyer")];
    const again = queue(extraction(candidate()), { method: METHOD.RULE, document: DOC, existing: decided });
    assert.equal(again[0].disposition, DISPOSITION.CONFIRMED);
    assert.equal(again[0].revisions.length, 1);
  });

  test("a new revision of the drawing does not", () => {
    const decided = [confirm(item(), "a buyer")];
    const again = queue(extraction(candidate()), { method: METHOD.RULE, document: other, existing: decided });
    assert.equal(again[0].disposition, DISPOSITION.PROPOSED, "a decision survived a revision change");
  });

  test("nor does the same document read as saying something else", () => {
    /* The same file re-read differently means the reading somebody approved
       is not the reading in front of them now. */
    const decided = [confirm(item(), "a buyer")];
    const again = queue(extraction(candidate({ value: "6" })),
                        { method: METHOD.RULE, document: DOC, existing: decided });
    assert.equal(again[0].disposition, DISPOSITION.PROPOSED);
  });

  test("a changed quote counts, even when the value is the same", () => {
    /* Read from a different place on the document is a different claim, and
       the number agreeing is a coincidence somebody should look at. */
    const decided = [confirm(item(), "a buyer")];
    const again = queue(extraction(candidate({ quote: "T 5 mm (see note 4)" })),
                        { method: METHOD.RULE, document: DOC, existing: decided });
    assert.equal(again[0].disposition, DISPOSITION.PROPOSED);
  });

  test("and what was lost is reported rather than just dropped", () => {
    const decided = [confirm(item(), "a buyer")];
    const items = queue(extraction(candidate()), { method: METHOD.RULE, document: other });
    const again = needsReReview(items, decided);
    assert.equal(again.length, 1);
    assert.equal(again[0].field, "thickness");
    assert.equal(again[0].was, "5");
    assert.match(again[0].why, /not the document in front of you now/);
  });

  test("nothing is reported when nothing was lost", () => {
    const decided = [confirm(item(), "a buyer")];
    const items = queue(extraction(candidate()), { method: METHOD.RULE, document: DOC });
    assert.deepEqual(needsReReview(items, decided), []);
  });

  test("an undecided row carried forward is not reported as lost", () => {
    const decided = [item()];
    const items = queue(extraction(candidate()), { method: METHOD.RULE, document: other });
    assert.deepEqual(needsReReview(items, decided), [], "a row nobody decided cannot lose a decision");
  });
});

/* ----------------------------------------------------------- the conflict */

describe("a typed value and a read value are both shown, and neither wins", () => {
  test("a disagreement is reported with both values and where the reading came from", () => {
    const c = sourceConflict(item(), "6");
    assert.equal(c.typed, "6");
    assert.equal(c.read, "5");
    assert.equal(c.page, 1);
    assert.equal(c.quote, "Thickness 5 mm");
    assert.match(c.why, /Nothing has been changed/);
  });

  test("agreement is not a conflict", () => {
    assert.equal(sourceConflict(item(), "5"), null);
    assert.equal(sourceConflict(item(), " 5 "), null, "whitespace is not a disagreement");
  });

  test("nothing typed is not a conflict", () => {
    for (const v of [null, undefined, "", "  "]) assert.equal(sourceConflict(item(), v), null);
  });

  test("nothing read is not a conflict either", () => {
    assert.equal(sourceConflict(item({ value: null }), "6"), null);
  });

  test("a whole form is checked at once", () => {
    const items = [item({ field: "thickness", value: "5" }), item({ field: "width", value: "200" })];
    const found = sourceConflicts(items, { thickness: "6", width: "200" });
    assert.deepEqual(found.map((c) => c.field), ["thickness"]);
  });

  test("the conflict compares against what was read, not against a correction", () => {
    /* Otherwise correcting a value makes the disagreement with the document
       disappear, which is the disagreement worth keeping. */
    const corrected = correct(item(), { value: "6" }, "a buyer");
    const c = sourceConflict(corrected, "6");
    assert.ok(c, "a correction hid the document");
    assert.equal(c.read, "5");
  });
});

/* -------------------------------------------------------------- the whole */

describe("the queue", () => {
  test("it turns an extraction into things to decide about", () => {
    const q = queue(extraction(candidate(), candidate({ field: "width", value: "200" })),
                    { method: METHOD.RULE, document: DOC });
    assert.equal(q.length, 2);
    assert.deepEqual(q.map((i) => i.disposition), [DISPOSITION.PROPOSED, DISPOSITION.PROPOSED]);
  });

  test("an empty extraction is an empty queue, not a failure", () => {
    assert.deepEqual(queue(extraction(), { method: METHOD.RULE, document: DOC }), []);
    assert.deepEqual(queue(null, { method: METHOD.RULE, document: DOC }), []);
  });

  test("nothing mutates what it was given", () => {
    const i = item();
    const before = JSON.stringify(i);
    confirm(i, "a"); correct(i, { value: "9" }, "a"); markUnknown(i, "a"); reject(i, "a");
    assert.equal(JSON.stringify(i), before);
  });

  test("an item is frozen, so nothing downstream can write a decision into it", () => {
    const i = item();
    assert.throws(() => { "use strict"; i.disposition = DISPOSITION.CONFIRMED; }, TypeError);
    assert.throws(() => { "use strict"; i.evidence.value = "99"; }, TypeError);
  });
});
