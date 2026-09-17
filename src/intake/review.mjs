/**
 * Deciding what a document actually said.
 *
 * `specs/03-FILE-INTELLIGENCE.md`: *"For each candidate show original text,
 * proposed typed value, unit, source page/region crop, method and warnings.
 * Actions: confirm, correct, mark unknown, reject. Corrections keep original
 * evidence and record user/time/revision. Do not overwrite a confirmed manual
 * value: show a source conflict. Changed files or revisions require
 * re-review."*
 *
 * Two of those four actions did not exist. The page had a tick and an editable
 * box, which covers confirm and correct — and the edit overwrote the value it
 * was correcting, so what the document was read as saying was gone the moment
 * somebody disagreed with it. That is the wrong thing to lose: the reason to
 * record a correction at all is that somebody later asks why the number on the
 * drawing is not the number in the case.
 *
 * So evidence is frozen at the point of reading and never written to again.
 * Everything a person does is a revision on top of it, with their name and the
 * time. The current value is derived, not stored in place of the original.
 *
 * The other two actions are not tidying. **Mark unknown** and **reject** say
 * different things — "the drawing does not tell me this" and "that reading is
 * wrong" — and collapsing them into a blank field loses the distinction this
 * product is built on: blank, unknown and zero are three states, not one.
 */

/** How a value was read. Evidence, and never proof on its own. */
export const METHOD = Object.freeze({
  /* A written rule over a document's own text layer. No model, no prompt. */
  RULE: "rule",
  /* Printed text recognised from pixels. Never described as verified. */
  OCR: "ocr",
  /* A model reading OCR output. `specs/03` route 4 is explicit that this is a
     second source of evidence and not independent proof, because it is
     looking at the same characters the reader already got wrong. */
  MODEL: "model",
  /* A model reading the picture itself. Genuinely a different claim from the
     one above — it is not agreeing with a reader, it is looking at the
     document — and so genuinely a separate source. It is also the one most
     able to be confidently wrong, because a misread photograph produces a
     plausible number rather than a gap. */
  VISION: "vision",
  /* Somebody typed it. Here so a queue can hold a manual value beside a read
     one without pretending the document said it. */
  PERSON: "person",
});

const KNOWN_METHODS = new Set(Object.values(METHOD));

/** What somebody did with a proposed value. */
export const ACTION = Object.freeze({
  CONFIRM: "confirm",
  CORRECT: "correct",
  UNKNOWN: "unknown",
  REJECT: "reject",
});

/**
 * Where an item stands.
 *
 * `PROPOSED` is the state everything starts in and nothing may be used from.
 */
export const DISPOSITION = Object.freeze({
  PROPOSED: "proposed",
  CONFIRMED: "confirmed",
  CORRECTED: "corrected",
  UNKNOWN: "unknown",
  REJECTED: "rejected",
});

const now = () => new Date().toISOString();

/**
 * The document an item was read from.
 *
 * A name is not enough: the same file name with different contents is a
 * different document, and the spec requires a changed file or revision to
 * force re-review. The page hashes what it read; where it cannot, the byte
 * length and the modified time are still better than the name alone.
 */
export function documentRef({ filename, revision = null, fingerprint = null } = {}) {
  if (!filename) throw new TypeError("a document reference needs the file it came from");
  return Object.freeze({
    filename: String(filename),
    revision: revision === null ? null : String(revision),
    fingerprint: fingerprint === null ? null : String(fingerprint),
  });
}

/** Whether two references are the same document, revision included. */
export const sameDocument = (a, b) =>
  Boolean(a && b)
  && a.filename === b.filename
  && a.revision === b.revision
  && a.fingerprint === b.fingerprint;

/* ------------------------------------------------------------------ items */

/**
 * One thing to decide about, with the reading frozen inside it.
 *
 * `region` is where on the page it was found, and it is `null` whenever that
 * is not known — which is every rule-read value today, because the text layer
 * of a PDF is handed over as text and the reader never sees geometry. Null
 * means not known. It must never be filled in with the whole page, which
 * would point a reviewer at a crop that proves nothing.
 */
export function reviewItem(candidate, { method, document: doc, label = null } = {}) {
  if (!candidate) throw new TypeError("there is nothing to review");
  if (!KNOWN_METHODS.has(method)) {
    throw new TypeError(`a reading must say how it was read, not "${method}"`);
  }
  if (!doc) throw new TypeError("a reading must say which document it came from");

  return Object.freeze({
    field: candidate.field,
    label: label ?? candidate.label ?? candidate.field,
    document: doc,

    /* Frozen at the moment of reading. Nothing below ever writes here. */
    evidence: Object.freeze({
      value: candidate.value ?? null,
      unit: candidate.unit ?? null,
      page: candidate.page ?? null,
      quote: candidate.quote ?? null,
      confidence: candidate.confidence ?? null,
      region: candidate.region ?? null,
      /* The tolerance printed against this dimension, where one was. It
         belongs to the evidence rather than to the value: a corrected
         thickness does not change what the drawing said its limits were, and
         somebody confirming 10.00 is confirming 10.00 ±0.05 or nothing.

         Null means none was printed, which is not the same as zero. */
      tolerance: candidate.tolerance ?? null,
      method,
    }),

    disposition: DISPOSITION.PROPOSED,
    /* What the item says now. Starts as what was read. */
    value: candidate.value ?? null,
    unit: candidate.unit ?? null,
    why: null,
    revisions: Object.freeze([]),
  });
}

/** A whole extraction, as things to decide about. */
export function queue(extraction, { method, document: doc, existing = [] } = {}) {
  const items = (extraction?.candidates ?? []).map((c) => reviewItem(c, { method, document: doc }));
  return existing.length ? carryForward(items, existing) : Object.freeze(items);
}

/**
 * Decisions made about the same document, kept; everything else, not.
 *
 * *"Changed files or revisions require re-review."* A person who ticked
 * fourteen rows against revision B should not have to tick them again because
 * a page was re-read — and must be made to, if the drawing itself changed.
 * The evidence has to match too: the same file re-read differently means the
 * reading somebody approved is not the reading in front of them now.
 */
export function carryForward(items, existing) {
  const before = new Map(existing.map((e) => [e.field, e]));
  return Object.freeze(items.map((item) => {
    const was = before.get(item.field);
    if (!was || was.disposition === DISPOSITION.PROPOSED) return item;
    if (!sameDocument(was.document, item.document)) return item;
    if (was.evidence.value !== item.evidence.value
        || was.evidence.quote !== item.evidence.quote
        || was.evidence.page !== item.evidence.page) return item;
    return was;
  }));
}

/** Which items lost a decision because the document moved under them. */
export function needsReReview(items, existing) {
  const after = new Map(carryForward(items, existing).map((i) => [i.field, i]));
  return Object.freeze(existing
    .filter((e) => e.disposition !== DISPOSITION.PROPOSED)
    .filter((e) => after.get(e.field)?.disposition === DISPOSITION.PROPOSED)
    .map((e) => Object.freeze({
      field: e.field,
      label: e.label,
      was: e.value,
      why: "The document this was checked against is not the document in front of you now.",
    })));
}

/* ---------------------------------------------------------------- actions */

function revise(item, { action, by, to, unit, why = null }) {
  if (!by) throw new TypeError("a decision has to record who made it");
  return Object.freeze({
    ...item,
    value: to,
    unit: unit === undefined ? item.unit : unit,
    why,
    disposition: {
      [ACTION.CONFIRM]: DISPOSITION.CONFIRMED,
      [ACTION.CORRECT]: DISPOSITION.CORRECTED,
      [ACTION.UNKNOWN]: DISPOSITION.UNKNOWN,
      [ACTION.REJECT]: DISPOSITION.REJECTED,
    }[action],
    revisions: Object.freeze([...item.revisions, Object.freeze({
      action, by: String(by), at: now(), from: item.value, to, why,
    })]),
  });
}

/** "The document says this, and it is right." */
export const confirm = (item, by) =>
  revise(item, { action: ACTION.CONFIRM, by, to: item.value });

/**
 * "It says this, and the right value is that."
 *
 * The reading is not replaced — `evidence` still holds what was on the page,
 * and the revision holds what it was changed from and to. Somebody asking in
 * six months why the case says 5.2 and the drawing says 5.0 gets an answer.
 */
export function correct(item, { value, unit } = {}, by) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new TypeError("a correction needs a value; to say it is not known, mark it unknown");
  }
  return revise(item, { action: ACTION.CORRECT, by, to: String(value), unit });
}

/**
 * "The document does not tell me this."
 *
 * Not zero, and not blank. A blank field is one nobody has looked at yet;
 * this one has been looked at, and the answer is that the drawing is silent.
 */
export const markUnknown = (item, by, why = null) =>
  revise(item, { action: ACTION.UNKNOWN, by, to: null, unit: null, why });

/**
 * "That reading is wrong."
 *
 * Distinct from unknown: the rule matched something that is not this field at
 * all. Kept rather than deleted, because a rule that keeps being rejected on
 * the same kind of drawing is the most useful thing this queue can tell
 * anybody.
 */
export const reject = (item, by, why = null) =>
  revise(item, { action: ACTION.REJECT, by, to: null, unit: null, why });

/* ------------------------------------------------------------ reading back */

/**
 * Whether this may be used for anything.
 *
 * Confirmed or corrected only. Proposed has not been looked at, unknown says
 * the document is silent, and rejected says the reading was wrong — none of
 * those is a value, and none may quietly become one.
 */
export const usable = (item) =>
  item.disposition === DISPOSITION.CONFIRMED || item.disposition === DISPOSITION.CORRECTED;

/** Everything decided and usable, for whatever comes next. */
export const confirmedValues = (items) =>
  Object.freeze(items.filter(usable).map((i) => Object.freeze({
    field: i.field, value: i.value, unit: i.unit,
    from: i.disposition === DISPOSITION.CORRECTED ? "corrected by a person" : "read and confirmed",
  })));

/** What is still waiting on somebody. */
export const outstanding = (items) =>
  Object.freeze(items.filter((i) => i.disposition === DISPOSITION.PROPOSED));

/**
 * A value somebody typed, against a value the document was read as saying.
 *
 * *"Do not overwrite a confirmed manual value: show a source conflict."* This
 * returns both and picks neither. Whichever way it were resolved
 * automatically, somebody would be told a number they did not enter and not
 * told why.
 */
export function sourceConflict(item, manual) {
  if (manual === null || manual === undefined || String(manual).trim() === "") return null;
  const read = item.evidence.value;
  if (read === null || String(read).trim() === "") return null;
  if (String(manual).trim() === String(read).trim()) return null;

  return Object.freeze({
    field: item.field,
    label: item.label,
    typed: String(manual),
    read: String(read),
    page: item.evidence.page,
    quote: item.evidence.quote,
    why: "You entered one value and the document was read as saying another. "
       + "Nothing has been changed — decide which is right.",
  });
}

/** Every such disagreement across a queue and a form. */
export const sourceConflicts = (items, typed = {}) =>
  Object.freeze(items
    .map((i) => sourceConflict(i, typed[i.field]))
    .filter(Boolean));

/**
 * What to tell somebody about one item, in the words the rest of the product
 * already uses.
 *
 * `src/studio/scenario.mjs` owns that vocabulary; this maps onto it rather
 * than inventing a second set of labels for the same five states.
 */
export function stateOf(item) {
  switch (item.disposition) {
    case DISPOSITION.CONFIRMED: return "User confirmed";
    case DISPOSITION.CORRECTED: return "User confirmed";
    case DISPOSITION.UNKNOWN:   return "Not known yet";
    case DISPOSITION.REJECTED:  return "Missing";
    default:                    return "Extracted — check this";
  }
}

/** How this was read, said plainly rather than as a category name. */
export function methodSaid(item) {
  switch (item.evidence.method) {
    case METHOD.RULE:
      return "Matched by a written rule against the document's own text. No model was asked.";
    case METHOD.OCR:
      return "Recognised from the picture. Printed text read by machine, and not verified.";
    case METHOD.MODEL:
      return "Proposed by a model reading the recognised text. It has not seen the drawing "
           + "itself, so this is a second opinion on the same characters rather than a second source.";
    case METHOD.VISION:
      return "Read from the picture by a model, and not verified by anything. It quoted the "
           + "printed text it took this from — read that rather than the value. A model can "
           + "misread a photograph, and when it does the answer looks like an answer.";
    case METHOD.PERSON:
      return "Entered by hand.";
    default:
      return "How this was read was not recorded.";
  }
}

/** The audit trail, oldest first, for one item. */
export const history = (item) => item.revisions;

/* -------------------------------------------------------- coming back */

/**
 * Rebuild a stored decision, or refuse it.
 *
 * A queue that survives a refresh has to come back from `localStorage`, and
 * `localStorage` is a text file the person using the browser can edit. That
 * is not a privilege problem — somebody who can write their own storage could
 * equally type the value into the form — but it is an integrity one, and the
 * rule this product already follows applies: withhold rather than misread.
 *
 * The rule that matters: **a decision has to carry the record of being made.**
 * `confirm`, `correct`, `markUnknown` and `reject` all append a revision
 * naming who and when, and refuse without one. A stored item claiming to be
 * confirmed with an empty history was not confirmed by anybody — it is an
 * assertion wearing a decision's clothes, and treating it as usable would let
 * an unattributed value into arithmetic through the back door the front door
 * is bolted against.
 *
 * Such an item is not discarded. The reading is real and worth keeping; it
 * comes back proposed, which is where every reading starts, and says so.
 */
export function reviveItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.field || !raw.evidence || typeof raw.evidence !== "object") return null;
  if (!raw.document || !raw.document.filename) return null;
  if (!KNOWN_METHODS.has(raw.evidence.method)) return null;

  const revisions = Array.isArray(raw.revisions) ? raw.revisions : [];
  const attributed = revisions.filter(
    (r) => r && typeof r === "object" && r.by && r.at && r.action in ACTION_TO_DISPOSITION);

  const claimed = Object.values(DISPOSITION).includes(raw.disposition)
    ? raw.disposition : DISPOSITION.PROPOSED;

  /* Any disposition other than proposed is a claim that somebody acted. */
  const honoured = claimed === DISPOSITION.PROPOSED || attributed.length > 0
    ? claimed : DISPOSITION.PROPOSED;

  const unattributed = honoured !== claimed;

  return Object.freeze({
    field: String(raw.field),
    label: raw.label ? String(raw.label) : String(raw.field),
    document: Object.freeze({
      filename: String(raw.document.filename),
      revision: raw.document.revision ?? null,
      fingerprint: raw.document.fingerprint ?? null,
    }),
    evidence: Object.freeze({
      value: raw.evidence.value ?? null,
      unit: raw.evidence.unit ?? null,
      page: raw.evidence.page ?? null,
      quote: raw.evidence.quote ?? null,
      confidence: raw.evidence.confidence ?? null,
      region: raw.evidence.region ?? null,
      tolerance: raw.evidence.tolerance ?? null,
      method: raw.evidence.method,
    }),
    disposition: honoured,
    /* A refused decision loses its value too: the value of a corrected item
       is the correction, and keeping it while discarding the correction would
       show a number nobody can account for. */
    value: unattributed ? (raw.evidence.value ?? null) : (raw.value ?? null),
    unit: unattributed ? (raw.evidence.unit ?? null) : (raw.unit ?? null),
    why: unattributed ? null : (raw.why ?? null),
    revisions: Object.freeze(attributed.map((r) => Object.freeze({
      action: r.action, by: String(r.by), at: String(r.at),
      from: r.from ?? null, to: r.to ?? null, why: r.why ?? null,
    }))),
    /* Said out loud rather than fixed silently, because somebody who ticked
       that row deserves to know it is untucked. */
    restored: unattributed
      ? "This was stored as decided with no record of who decided it, so it is back to "
        + "needing a look."
      : null,
  });
}

const ACTION_TO_DISPOSITION = Object.freeze({
  [ACTION.CONFIRM]: DISPOSITION.CONFIRMED,
  [ACTION.CORRECT]: DISPOSITION.CORRECTED,
  [ACTION.UNKNOWN]: DISPOSITION.UNKNOWN,
  [ACTION.REJECT]: DISPOSITION.REJECTED,
});

/**
 * A whole stored queue, with what could not be rebuilt reported.
 *
 * Dropping items quietly would make a corrupted record look like a shorter
 * document.
 */
export function reviveItems(list) {
  const rows = Array.isArray(list) ? list : [];
  const items = [];
  const refused = [];
  for (const raw of rows) {
    const item = reviveItem(raw);
    if (item) items.push(item);
    else refused.push(Object.freeze({ field: raw?.field ?? null }));
  }
  return Object.freeze({
    items: Object.freeze(items),
    refused: Object.freeze(refused),
    untucked: Object.freeze(items.filter((i) => i.restored)),
  });
}
