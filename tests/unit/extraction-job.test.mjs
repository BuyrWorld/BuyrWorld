/**
 * The extraction job adapter.
 *
 * There is no worker to talk to, and that is recorded rather than worked
 * around: `specs/03` wants an isolated Python document worker with OCR and PDF
 * rasterisation behind authenticated endpoints, which needs a binary runtime
 * this repository has not got. `specs/02` says what to do — keep preview and
 * manual entry usable, and mark the gate blocked.
 *
 * So what is tested here is everything around the hole, and one thing that is
 * a correctness problem rather than plumbing: when a result finally arrives,
 * is it still the right answer?
 *
 * Four ways it is not, and every one of them looks like success from the
 * worker's side. That is the case these tests exist for — a late reading
 * applied quietly is indistinguishable from the software changing a number on
 * its own.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  submission, submit, failure, canRetry, retryOf, applicable, asComparison,
  configured, JOB, FAILURE, REFUSED, UNAVAILABLE, UNAVAILABLE_SAID,
} from "../../src/intake/extraction-job.mjs";

const SENT_AT = 1_000_000;
const sub = (over = {}) =>
  submission({ caseId: "case-1", revision: 3, documentId: "doc-a", at: SENT_AT, ...over });

const ready = (over = {}) => ({
  state: JOB.REVIEW_READY, submission: sub(), candidates: [{ field: "thickness", value: "5" }], ...over,
});

const at = (over = {}) => ({ caseId: "case-1", revision: 3, editedAt: 0, cancelled: false, ...over });

/* ------------------------------------------------------------ the unasked */

describe("with nothing to ask", () => {
  test("it says so, and does not pretend to have queued anything", async () => {
    const r = await submit({ name: "d.pdf" }, sub());
    assert.equal(r.ok, false);
    assert.equal(r.unavailable, UNAVAILABLE);
    assert.equal(r.state, JOB.FAILED);
    assert.equal(r.said, UNAVAILABLE_SAID);
  });

  test("the wording offers the thing that does work", () => {
    /* Preview and manual entry stay usable, which is `specs/02`'s own
       instruction for a blocked gate. Saying only "unavailable" would leave
       somebody with a drawing and no way forward. */
    assert.match(UNAVAILABLE_SAID, /shown so you can read it/);
    assert.match(UNAVAILABLE_SAID, /values are yours to enter/);
  });

  test("it never claims something will be read later", () => {
    /* "Nothing will be read for you" is the honest sentence and contains the
       words a blunter check would catch, so this looks for the promise rather
       than for the verb: work that is pending, coming, or under way. */
    assert.match(UNAVAILABLE_SAID, /nothing will be read for you/);
    assert.equal(/shortly|queued|processing|being read|in progress|once (it|this)/i
      .test(UNAVAILABLE_SAID), false);
  });

  test("whether anything is configured is a question with an answer", () => {
    assert.equal(configured({}), false);
    assert.equal(configured({ transport: async () => ({}) }), true);
  });
});

/* -------------------------------------------------------------- submitting */

describe("submitting", () => {
  test("a job has to belong to a case and a revision", () => {
    assert.throws(() => submission({ revision: 1 }), /belong to a case/);
    assert.throws(() => submission({ caseId: "c" }), /name the revision/);
  });

  test("a retry carries the same key, so the work is not done twice", () => {
    /* And more importantly does not produce a second competing answer for the
       same document. */
    assert.equal(sub().idempotencyKey, sub().idempotencyKey);
    assert.notEqual(sub().idempotencyKey, sub({ revision: 4 }).idempotencyKey);
    assert.notEqual(sub().idempotencyKey, sub({ documentId: "doc-b" }).idempotencyKey);
  });

  test("with a worker, it queues and says nothing is used until confirmed", async () => {
    const r = await submit({}, sub(), { transport: async () => ({ state: JOB.QUEUED, jobId: "j1" }) });
    assert.equal(r.ok, true);
    assert.equal(r.state, JOB.QUEUED);
    assert.equal(r.jobId, "j1");
    assert.match(r.said, /Nothing it finds will be used until you confirm it/);
  });

  test("a transport that throws becomes a failure, not an exception", async () => {
    const r = await submit({}, sub(), { transport: async () => { throw new Error("gateway timeout"); } });
    assert.equal(r.ok, false);
    assert.equal(r.state, JOB.FAILED);
  });
});

/* ---------------------------------------------------------------- failing */

describe("a failure says whether trying again is worth anything", () => {
  test("a timeout can be tried again", () => {
    const f = failure(new Error("gateway timeout"), sub());
    assert.equal(f.failure, FAILURE.RETRYABLE);
    assert.equal(canRetry(f), true);
    assert.match(f.said, /can be tried again/);
  });

  test("an unsupported format cannot, and says so instead of offering a button", () => {
    /* Offering a retry on something that will never work is a way of wasting
       somebody's afternoon politely. */
    const f = failure(new Error("unsupported format: DWG"), sub());
    assert.equal(f.failure, FAILURE.PERMANENT);
    assert.equal(canRetry(f), false);
    assert.match(f.said, /Trying again will not change that/);
    assert.match(f.said, /enter the values by hand/);
  });

  test("an encrypted document is permanent too", () => {
    assert.equal(failure(new Error("encrypted"), sub()).failure, FAILURE.PERMANENT);
  });

  test("anything unrecognised is treated as worth retrying", () => {
    /* Refusing to let somebody try again is a worse mistake than letting them
       try twice. */
    assert.equal(failure(new Error("something nobody anticipated"), sub()).failure, FAILURE.RETRYABLE);
    assert.equal(failure(undefined, sub()).failure, FAILURE.RETRYABLE);
  });

  test("a retry reuses the original submission exactly", () => {
    const f = failure(new Error("timeout"), sub());
    assert.equal(retryOf(f).idempotencyKey, sub().idempotencyKey);
    assert.equal(retryOf(failure(new Error("unsupported"), sub())), null);
  });
});

/* ------------------------------------------------- the late arriving answer */

describe("a result that arrives may no longer be the right answer", () => {
  test("a reading for the case in front of you, unedited, applies", () => {
    const v = applicable(ready(), at());
    assert.equal(v.ok, true);
    assert.equal(v.refused, null);
  });

  test("a reading for another case does not populate this one", () => {
    /* The spec's own example, and the one that would be hardest to notice:
       the numbers are right, for somebody else's part. */
    const v = applicable(ready(), at({ caseId: "case-2" }));
    assert.equal(v.ok, false);
    assert.equal(v.refused, REFUSED.OTHER_CASE);
    assert.match(v.why, /for a different case/);
  });

  test("a reading of a drawing that has since been replaced does not apply", () => {
    const v = applicable(ready(), at({ revision: 4 }));
    assert.equal(v.refused, REFUSED.OLD_REVISION);
    assert.match(v.why, /replaced while this was being read/);
  });

  test("a reading does not overwrite what somebody typed after sending it", () => {
    /* The difference between a reader that helps and one that silently
       reverts your typing. */
    const v = applicable(ready(), at({ editedAt: SENT_AT + 1 }));
    assert.equal(v.refused, REFUSED.EDITED_SINCE);
    assert.match(v.why, /what you typed stands/);
  });

  test("an edit before the job was sent is not a reason to refuse", () => {
    /* Otherwise every case that was typed into at all could never be read,
       which would make the whole feature unreachable for anybody who started
       by entering what they knew. */
    assert.equal(applicable(ready(), at({ editedAt: SENT_AT - 1 })).ok, true);
  });

  test("a cancelled job that finished anyway is not used", () => {
    assert.equal(applicable(ready({ state: JOB.CANCELLED }), at()).refused, REFUSED.CANCELLED);
    assert.equal(applicable(ready(), at({ cancelled: true })).refused, REFUSED.CANCELLED);
  });

  test("an unfinished job is not applied either", () => {
    for (const state of [JOB.QUEUED, JOB.RUNNING, JOB.FAILED]) {
      assert.equal(applicable(ready({ state }), at()).ok, false, state);
    }
  });

  test("nothing at all is refused rather than thrown", () => {
    assert.equal(applicable(null, at()).refused, REFUSED.NOT_READY);
    assert.equal(applicable({}, at()).refused, REFUSED.NOT_READY);
  });

  test("a missing case is not the same case", () => {
    assert.equal(applicable(ready(), at({ caseId: undefined })).refused, REFUSED.OTHER_CASE);
    assert.equal(applicable(ready(), {}).refused, REFUSED.OTHER_CASE);
  });
});

/* --------------------------------------------------------- what is kept */

describe("a refused reading is kept, not thrown away", () => {
  test("it carries what it found and why it was not used", () => {
    /* Somebody waited for it. Discarding it silently is the other way to be
       wrong. */
    const v = applicable(ready(), at({ editedAt: SENT_AT + 1 }));
    const c = asComparison(ready(), v);
    assert.equal(c.refused, REFUSED.EDITED_SINCE);
    assert.deepEqual(c.candidates, [{ field: "thickness", value: "5" }]);
    assert.equal(c.why, v.why);
  });

  test("an edited-since reading is offered as a comparison", () => {
    const v = applicable(ready(), at({ editedAt: SENT_AT + 1 }));
    assert.equal(asComparison(ready(), v).offer, "Compare it with what you typed");
  });

  test("a reading for another case is not offered as anything", () => {
    /* It is about a different part. Offering it to compare against would be
       inviting somebody to reconcile two unrelated drawings. */
    const v = applicable(ready(), at({ caseId: "case-2" }));
    assert.equal(asComparison(ready(), v).offer, null);
  });
});

/* -------------------------------------------- a reader that answers at once */

describe("a worker that answers in one round trip", () => {
  test("the reply comes through with the result", async () => {
    /* The state machine is the same whether an answer arrives now or after
       polling. A synchronous reader that had to be polled for an answer it
       already gave would be silly, so the text rides along. */
    const r = await submit({}, sub(), {
      transport: async () => ({ state: JOB.REVIEW_READY, text: '{"candidates":[]}' }),
    });
    assert.equal(r.state, JOB.REVIEW_READY);
    assert.equal(r.text, '{"candidates":[]}');
  });

  test("a truncated reply is carried as truncated", async () => {
    const r = await submit({}, sub(), {
      transport: async () => ({ state: JOB.REVIEW_READY, text: "{", truncated: true }),
    });
    assert.equal(r.truncated, true);
  });

  test("a reader that gives no text is not described as having given some", async () => {
    const r = await submit({}, sub(), { transport: async () => ({ state: JOB.QUEUED }) });
    assert.equal(r.text, null);
    assert.equal(r.truncated, false);
  });

  test("and such a result still goes through the same applicability check", async () => {
    /* Arriving in one round trip does not exempt it: the case can still have
       changed between the click and the answer. */
    const r = await submit({}, sub(), {
      transport: async () => ({ state: JOB.REVIEW_READY, text: "{}" }),
    });
    assert.equal(applicable(r, at({ caseId: "case-2" })).refused, REFUSED.OTHER_CASE);
    assert.equal(applicable(r, at()).ok, true);
  });
});
