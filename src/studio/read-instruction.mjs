/**
 * Reading a typed instruction into a proposal, by written rule.
 *
 * `src/intake/extract-document.mjs` reads drawings this way and says why: with
 * no prompt, a document instructing the reader is just a document containing
 * that sentence. The same reasoning applies here, and more sharply — this text
 * is about to become a change to a part.
 *
 * So there is no model in this file. It recognises a small set of phrasings,
 * produces the same proposal shape `edit-proposal.mjs` validates, and refuses
 * anything it does not recognise. That is what makes the feature work with no
 * AI service configured, which the pack requires twice: "Manual modelling must
 * remain useful without an AI service", and "Keep UI functional without
 * pretending that an AI service exists."
 *
 * When a real adapter is wired in it produces proposals in this same shape and
 * goes through the same validation. This is not a placeholder for that; it is
 * the offline path that has to keep working after it arrives.
 *
 * What it will not do is guess. A sentence it half-understands produces a
 * question naming what it could not read, never an operation assembled from
 * the parts it did understand.
 */

import { OPERATION } from "./edit-proposal.mjs";

/** A number with optional decimals, as text. */
const NUM = String.raw`(\d+(?:\.\d{1,3})?)`;

/**
 * The phrasings this understands.
 *
 * Each names what it produces. Deliberately few: a reader that recognises
 * twenty shapes of sentence recognises nineteen of them badly, and every one
 * it gets slightly wrong moves metal.
 */
const RULES = [
  {
    id: "add-hole-at",
    // "add a 6mm hole at 15, 25"  ·  "put a 6 mm hole at 15,25"
    re: new RegExp(String.raw`^(?:add|put)\s+(?:a|an)?\s*${NUM}\s*mm\s+hole\s+at\s+${NUM}\s*,\s*${NUM}$`, "i"),
    make: (m) => [{ op: OPERATION.ADD_HOLE, diameterMm: m[1], xMm: m[2], yMm: m[3] }],
  },
  {
    id: "add-pocket-at",
    // "add a 20 x 20mm pocket 3mm deep at 40, 10"
    re: new RegExp(String.raw`^add\s+(?:a|an)?\s*${NUM}\s*(?:x|×|by)\s*${NUM}\s*mm\s+pocket\s+${NUM}\s*mm\s+deep\s+at\s+${NUM}\s*,\s*${NUM}$`, "i"),
    make: (m) => [{ op: OPERATION.ADD_POCKET, widthMm: m[1], lengthMm: m[2],
      depthMm: m[3], xMm: m[4], yMm: m[5] }],
  },
  {
    id: "move-along-axis",
    // "move hole-1 10mm along x"  ·  "move the pocket 2.5 mm along Y"
    re: new RegExp(String.raw`^move\s+(?:the\s+)?([a-z]+(?:-\d+)?)\s+(-?${NUM})\s*mm\s+along\s+([xy])$`, "i"),
    make: (m) => [{
      op: OPERATION.MOVE_FEATURE,
      ...targetOf(m[1]),
      dxMm: m[4].toLowerCase() === "x" ? m[2] : "0",
      dyMm: m[4].toLowerCase() === "y" ? m[2] : "0",
    }],
  },
  {
    id: "resize-hole",
    // "make hole-1 8mm"  ·  "change the hole to 8 mm"
    re: new RegExp(String.raw`^(?:make|change)\s+(?:the\s+)?([a-z]+(?:-\d+)?)\s+(?:to\s+)?${NUM}\s*mm$`, "i"),
    make: (m) => [{ op: OPERATION.RESIZE_HOLE, ...targetOf(m[1]), diameterMm: m[2] }],
  },
  {
    id: "remove",
    // "remove hole-2"  ·  "delete the pocket"
    re: new RegExp(String.raw`^(?:remove|delete)\s+(?:the\s+)?([a-z]+(?:-\d+)?)$`, "i"),
    make: (m) => [{ op: OPERATION.REMOVE_FEATURE, ...targetOf(m[1]) }],
  },
];

/** "hole-1" is an id; "hole" is a description that may or may not resolve. */
function targetOf(word) {
  return /-\d+$/.test(word) ? { featureId: word.toLowerCase() } : { target: word.toLowerCase() };
}

/**
 * Sentences that are clearly about the part and clearly not actionable.
 *
 * Recognised so the answer can say what is missing rather than "I did not
 * understand", which is true but useless. Each is a case the pack names.
 */
const UNACTIONABLE = [
  { re: /aerospace|aircraft|medical|automotive\s+grade/i,
    why: "Which material, specification and revision apply is a question for your organisation "
       + "or your customer. Tell me the grade and I can record it; I will not choose one." },
  { re: /\btighten|loosen|tighter|looser\b/i,
    why: "By how much, and on which dimension? A tolerance changed by an amount nobody named "
       + "is a tolerance nobody can check." },
  { re: /\b(stronger|lighter|cheaper|better|nicer|optimi[sz]e)\b/i,
    why: "That is a design decision rather than a measurement. Tell me the change you want "
       + "made — a size, a position, a feature — and I can propose it." },
  { re: /\bfillet|chamfer|round(?:ed)?\s+(?:corner|edge)|radius\b/i,
    why: "This builds rectangular blocks with round holes and rectangular pockets, and nothing "
       + "else. A fillet or a chamfer needs a proper modelling tool." },
];

/**
 * Read one instruction.
 *
 * @param {string} text          what the person typed
 * @param {number} modelRevision the revision it was typed against
 * @returns a proposal for `validate()`, or a question, or a refusal
 */
export function readInstruction(text, modelRevision = undefined) {
  const said = String(text ?? "").trim().replace(/\s+/g, " ").replace(/[.!]$/, "");
  if (!said) {
    return { ok: false, question: "Type what you would like changed.", said: "" };
  }

  for (const rule of RULES) {
    const m = rule.re.exec(said);
    if (m) {
      return {
        ok: true,
        said,
        rule: rule.id,
        proposal: { modelRevision, said, operations: rule.make(m) },
      };
    }
  }

  for (const u of UNACTIONABLE) {
    if (u.re.test(said)) return { ok: false, question: u.why, said, recognised: true };
  }

  /* Not understood, and saying so with examples rather than guessing at the
     nearest rule. A sentence half-recognised is where an instruction becomes
     a change nobody asked for. */
  return {
    ok: false,
    said,
    question: "I could not read that as a change to the part.",
    examples: Object.freeze([
      "add a 6mm hole at 15, 25",
      "add a 20 x 20mm pocket 3mm deep at 40, 10",
      "move hole-1 10mm along X",
      "change hole-1 to 8mm",
      "remove pocket-1",
    ]),
  };
}

/** Every phrasing this understands, for showing a person what it can take. */
export const PHRASINGS = Object.freeze(RULES.map((r) => r.id));
