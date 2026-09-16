/**
 * Asking something else to read a document, and refusing its answer when the
 * answer no longer applies.
 *
 * `specs/03-FILE-INTELLIGENCE.md`: *"Use revision tokens plus cancellation: a
 * late result for case A cannot populate case B or overwrite fields edited
 * after submission. Background retry uses the same idempotency key; visible
 * status distinguishes retryable timeout from unsupported format."*
 *
 * There is no worker to talk to. `specs/03` requires an isolated Python
 * document worker behind authenticated same-origin job endpoints, with OCR and
 * PDF rasterisation — a binary runtime this repository does not have and
 * cannot acquire by adding a dependency, as the pack itself says. So the live
 * gate is blocked, and `specs/02` names what to do about that: *"If backend
 * unavailable, record that gate blocked while keeping preview/manual
 * usable."*
 *
 * What is buildable, and what this is, is everything around the hole. The
 * states a job moves through, the honest unavailable answer when nothing is
 * configured, the difference between a timeout worth retrying and a format
 * that will never work, and — the part that is a correctness problem rather
 * than a plumbing one — the rule about when a result that finally arrives may
 * still be used.
 *
 * That rule is the reason this exists now rather than when a worker does. A
 * reading that comes back ninety seconds later, for the drawing somebody has
 * since replaced, against fields they have since typed into, is not a slow
 * success. It is a wrong answer arriving quietly, and the only place to stop
 * it is at the seam where it lands.
 */

/** What a job is doing. The names are the ones `specs/03` specifies. */
export const JOB = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  REVIEW_READY: "review_ready",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

/** Why a job failed, because the two need different offers. */
export const FAILURE = Object.freeze({
  /* Worth pressing again: a timeout, a restart, a busy queue. */
  RETRYABLE: "retryable",
  /* Never going to work: the format is not one the worker reads. Offering a
     retry here is a way of wasting somebody's afternoon politely. */
  PERMANENT: "permanent",
});

/** No worker is configured in this build. Said once, in one place. */
export const UNAVAILABLE = "no-document-worker-configured";

/** What to tell somebody when there is nothing to ask. */
export const UNAVAILABLE_SAID =
  "No document reader is configured in this build, so nothing will be read for you. "
  + "The document is shown so you can read it, and the values are yours to enter.";

/**
 * A submission, with everything needed to know later whether its answer still
 * applies.
 *
 * `editedAt` is the crux. A result may only be applied to fields nobody has
 * touched since the job was sent — that is not a nicety, it is the difference
 * between a reader that helps and one that silently reverts somebody's typing.
 */
export function submission({ caseId, revision, documentId, at = Date.now() } = {}) {
  if (!caseId) throw new TypeError("a job has to belong to a case");
  if (revision === undefined || revision === null) {
    throw new TypeError("a job has to name the revision it was sent for");
  }
  return Object.freeze({
    caseId: String(caseId),
    revision: Number(revision),
    documentId: documentId === undefined ? null : String(documentId),
    at: Number(at),
    /* The same key on a retry, so a worker that already did the work does not
       do it twice and does not produce a second competing answer. */
    idempotencyKey: `${caseId}:${revision}:${documentId ?? "none"}`,
  });
}

/**
 * Send a document to be read.
 *
 * The transport is injected, as everywhere else here, so this is testable
 * without a network and honest without a provider: with none, it does not
 * pretend to queue anything.
 */
export async function submit(file, sub, { transport } = {}) {
  if (typeof transport !== "function") {
    return Object.freeze({
      ok: false, state: JOB.FAILED, unavailable: UNAVAILABLE,
      said: UNAVAILABLE_SAID, submission: sub,
    });
  }

  try {
    const res = await transport({ file, submission: sub });
    return Object.freeze({
      ok: true,
      state: res?.state ?? JOB.QUEUED,
      jobId: res?.jobId ?? null,
      submission: sub,
      /* A worker that answers in one round trip hands its reading back here
         rather than through a second call. Carried rather than dropped: the
         state machine is the same either way, and a synchronous reader that
         had to be polled for an answer it already gave would be silly. */
      text: res?.text ?? null,
      truncated: Boolean(res?.truncated),
      said: "Sent to be read. Nothing it finds will be used until you confirm it.",
    });
  } catch (e) {
    return failure(e, sub);
  }
}

/** A thrown transport error, classified rather than shown raw. */
export function failure(error, sub) {
  const said = String(error?.message ?? error ?? "");
  /* Only what a worker can actually tell us apart on. Anything unrecognised
     is treated as retryable, because refusing to let somebody try again is a
     worse mistake than letting them try twice. */
  const permanent = /unsupported|cannot read this format|encrypted|too many pages/i.test(said);
  return Object.freeze({
    ok: false,
    state: JOB.FAILED,
    failure: permanent ? FAILURE.PERMANENT : FAILURE.RETRYABLE,
    submission: sub,
    said: permanent
      ? `This could not be read: ${said}. Trying again will not change that — `
        + "enter the values by hand, or supply the document in another format."
      : `This did not finish: ${said}. It can be tried again.`,
  });
}

/** Whether pressing the button again is worth anything. */
export const canRetry = (result) =>
  result?.state === JOB.FAILED && result.failure === FAILURE.RETRYABLE;

/** A retry carries the same key, so the worker knows it is the same request. */
export function retryOf(result) {
  if (!canRetry(result)) return null;
  return result.submission;
}

/* ------------------------------------------------------- the arriving answer */

/** Why a result was refused, in words somebody can act on. */
export const REFUSED = Object.freeze({
  OTHER_CASE: "another-case",
  OLD_REVISION: "old-revision",
  EDITED_SINCE: "edited-since",
  CANCELLED: "cancelled",
  NOT_READY: "not-ready",
});

/**
 * Whether a result that has arrived may still be used.
 *
 * Four ways for a perfectly good reading to be the wrong answer by the time
 * it lands, and none of them is a failure of the worker:
 *
 *   - it belongs to a case nobody is looking at any more;
 *   - the drawing has been replaced since it was sent;
 *   - somebody has typed into the fields it would fill;
 *   - it was cancelled and finished anyway, which is the normal way a
 *     cancellation races a result.
 *
 * Refusing is the whole job. A late result applied quietly is indistinguishable
 * from the software changing a number on its own.
 */
export function applicable(result, now) {
  const sub = result?.submission;
  if (!sub) return refuse(REFUSED.NOT_READY, "There is nothing to apply.");

  if (result.state === JOB.CANCELLED || now?.cancelled) {
    return refuse(REFUSED.CANCELLED,
      "This reading was cancelled. It finished anyway, and has not been used.");
  }
  if (result.state !== JOB.REVIEW_READY) {
    return refuse(REFUSED.NOT_READY, "This reading is not finished.");
  }
  if (String(now?.caseId) !== sub.caseId) {
    return refuse(REFUSED.OTHER_CASE,
      "This reading was for a different case, so it has not been used here.");
  }
  if (Number(now?.revision) !== sub.revision) {
    return refuse(REFUSED.OLD_REVISION,
      "The document was replaced while this was being read, so the reading is "
      + "of the previous one and has not been used.");
  }

  const edited = Number(now?.editedAt ?? 0);
  if (edited && edited > sub.at) {
    return refuse(REFUSED.EDITED_SINCE,
      "You edited these fields after this was sent to be read. Nothing has been "
      + "changed — what you typed stands, and the reading is shown separately so "
      + "you can compare it.");
  }

  return Object.freeze({ ok: true, refused: null, why: null });
}

const refuse = (refused, why) => Object.freeze({ ok: false, refused, why });

/**
 * A reading that arrived too late to apply, kept rather than thrown away.
 *
 * Discarding it silently is the other way to be wrong: somebody waited for
 * it. Offering it as a comparison lets them see what the document said
 * without anything being written on their behalf.
 */
export function asComparison(result, verdict) {
  return Object.freeze({
    why: verdict.why,
    refused: verdict.refused,
    candidates: result?.candidates ?? [],
    offer: verdict.refused === REFUSED.EDITED_SINCE
      ? "Compare it with what you typed"
      : null,
  });
}

/** Whether this build can ask anything to read a document at all. */
export const configured = ({ transport } = {}) => typeof transport === "function";
