/**
 * A provider-backed reader for described edits.
 *
 * `read-instruction.mjs` recognises five phrasings by written rule and refuses
 * the rest. This is the other reader: it asks a model, and then refuses most
 * of what comes back.
 *
 * The important thing is what it is *not* allowed to be. A model here does not
 * decide anything — it proposes an operation from a closed list, and
 * `edit-proposal.mjs` validates that proposal exactly as it validates one the
 * rule reader produced. Same list, same target resolution, same staleness
 * check, same preview, same acceptance. The only difference between the two
 * readers is which one turned a sentence into an object.
 *
 * That is the whole design, and it is why this file is small. Everything that
 * could go wrong with a model's output is already refused somewhere else.
 *
 * Three things belong here and nowhere else:
 *
 * 1. **The prompt**, versioned, so a reply can be traced to what was asked.
 * 2. **A shape check** before the proposal reaches the validator, because the
 *    validator is entitled to assume it was handed an object rather than
 *    whatever a model felt like returning.
 * 3. **The refusal to be configured by accident.** With no transport this
 *    module reports that a provider is not available, and the rule reader
 *    carries on. The pack asks for that twice, and it is the difference
 *    between a feature that degrades and one that breaks.
 */

import { createAdapter, FAILURE } from "./adapter.mjs";
import { OPERATION } from "../../studio/edit-proposal.mjs";

export const PROMPT_VERSION = "studio-edit/2026-09-16";

/** Every operation a reply may name. The same list the validator enforces. */
const ALLOWED = Object.freeze(Object.values(OPERATION));

/**
 * What the model is told.
 *
 * The part is described rather than handed over as internal structures: a
 * model that sees the field names of this codebase will echo them back, and a
 * reply that happens to match an internal shape is not the same as a reply
 * that was understood.
 *
 * Its instructions are refusals, in the same order the validator applies them,
 * because a model that knows it will be refused for guessing is likelier to
 * ask.
 */
export function buildPrompt(model, instruction) {
  const features = model.features.map((f) => (f.kind === "through-hole"
    ? `- ${f.id}: a through-hole, diameter ${mm(f.diameterUm)}mm, centred at X ${mm(f.xUm)}, Y ${mm(f.yUm)}`
    : `- ${f.id}: a pocket ${mm(f.widthUm)} by ${mm(f.lengthUm)}mm, ${mm(f.depthUm)}mm deep, `
      + `corner at X ${mm(f.xUm)}, Y ${mm(f.yUm)}`));

  return [
    "You turn a request about a rectangular part into a structured proposal.",
    "You do not make the change. A person reviews your proposal and decides.",
    "",
    "THE PART",
    `A block ${mm(model.widthUm)} by ${mm(model.lengthUm)}mm and ${mm(model.thicknessUm)}mm thick.`,
    "Measured from the bottom-left corner of the top face. X is across the width,",
    "Y is along the length. All dimensions are millimetres.",
    features.length ? "Features:" : "It has no features yet.",
    ...features,
    "",
    "WHAT YOU MAY PROPOSE",
    `Only these operations: ${ALLOWED.join(", ")}.`,
    "",
    "RULES",
    "1. If the request names no measurement, ask for it. Do not choose one.",
    "2. If more than one feature could be meant, ask which. Do not pick.",
    "3. If the request is about material, tolerance, finish or specification,",
    "   ask — those are not geometry and you may not decide them.",
    "4. If the request needs a shape this part cannot have — a fillet, a chamfer,",
    "   a curve — say so plainly.",
    "5. Never invent a dimension to make a request work.",
    "",
    "REPLY",
    "JSON only. Either:",
    '  {"operations":[{"op":"add-hole","xMm":"15","yMm":"25","diameterMm":"6"}]}',
    "or, when a rule above applies:",
    '  {"question":"There are two holes. Which one?"}',
    "Measurements are strings of millimetres. Name a feature with \"featureId\".",
    "",
    "THE REQUEST",
    String(instruction),
  ].join("\n");
}

const mm = (um) => {
  const n = BigInt(um);
  const frac = String(n % 1000n).padStart(3, "0").replace(/0+$/, "");
  return frac ? `${n / 1000n}.${frac}` : String(n / 1000n);
};

/* ------------------------------------------------------------- the reader */

export const UNAVAILABLE = "no-provider-configured";

/**
 * Ask a provider to propose an edit.
 *
 * Returns the same shape `read-instruction.mjs` returns, so a caller does not
 * need to know which reader answered — and so the rule reader remains a
 * complete substitute rather than a fallback with a different contract.
 *
 * @param {object} model      the current geometry
 * @param {string} instruction what the person typed
 * @param {object} [opts]     { transport } — absent means no provider
 */
export async function proposeEdit(model, instruction, { transport } = {}) {
  if (typeof transport !== "function") {
    /* Not an error. No provider is the ordinary state of this build, and the
       rule reader handles the request instead. */
    return { ok: false, unavailable: UNAVAILABLE, said: String(instruction ?? "").trim(),
      question: "No model service is configured, so this was read by written rule instead." };
  }
  if (!model) {
    return { ok: false, said: String(instruction ?? "").trim(),
      question: "There is no part to change yet. Build a block first." };
  }

  const said = String(instruction ?? "").trim();
  if (!said) return { ok: false, said, question: "Type what you would like changed." };

  const adapter = createAdapter({ transport, promptVersion: PROMPT_VERSION });
  const reply = await adapter.json(buildPrompt(model, said));

  if (!reply.ok) {
    /* A provider that failed is a provider that failed. It is never a reason
       to guess at what the person meant. */
    return {
      ok: false, said, promptVersion: PROMPT_VERSION,
      question: reply.failure === FAILURE.TRANSPORT
        ? "The model service could not be reached, so nothing was proposed."
        : "The model service replied with something this could not read, so nothing was proposed.",
      failure: reply.failure,
    };
  }

  return shapeOf(reply.data, said);
}

/**
 * Turn a reply into a proposal, a question, or a refusal.
 *
 * Exported because it is the interesting half: given any object at all — a
 * confused model, a prompt-injected document, a provider returning something
 * from another conversation — this decides what may be passed on, and a test
 * can hand it anything without a transport.
 */
export function shapeOf(data, said = "") {
  if (data && typeof data.question === "string" && data.question.trim()) {
    /* The model asking is a success. Rule 1 through 4 exist to produce this. */
    return { ok: false, said, promptVersion: PROMPT_VERSION, question: data.question.trim() };
  }

  const ops = Array.isArray(data?.operations) ? data.operations : null;
  if (!ops || ops.length === 0) {
    return { ok: false, said, promptVersion: PROMPT_VERSION,
      question: "The model service did not propose a change this could use." };
  }

  /* Names checked here, before the validator, for one reason: a reply naming
     an operation that does not exist is a reply that did not understand the
     list it was given, and saying that is more useful than the validator's
     generic refusal. Everything else — the numbers, the targets, the
     staleness — is the validator's job and is not repeated. */
  const unknown = ops.map((o) => String(o?.op ?? "")).filter((op) => !ALLOWED.includes(op));
  if (unknown.length) {
    return { ok: false, said, promptVersion: PROMPT_VERSION,
      question: `The model service proposed ${unknown.map((u) => `"${u}"`).join(", ")}, `
        + "which is not something this can do.",
      refused: Object.freeze(unknown) };
  }

  /* Only the fields an operation may carry survive. A reply with extra keys is
     not rejected — models add commentary — but nothing unrecognised is passed
     on to be interpreted by something downstream. */
  const KEEP = ["op", "featureId", "target", "xMm", "yMm", "diameterMm",
    "widthMm", "lengthMm", "depthMm", "dxMm", "dyMm"];

  return {
    ok: true,
    said,
    promptVersion: PROMPT_VERSION,
    proposal: {
      said,
      operations: ops.map((o) => {
        const clean = {};
        for (const k of KEEP) if (o[k] !== undefined) clean[k] = String(o[k]);
        return clean;
      }),
    },
    /* Reported rather than dropped silently: a model reaching for a tolerance
       or a specification is worth seeing, and `withheld()` in
       edit-proposal.mjs says what to do about it. */
    alsoSuggested: Object.freeze(Object.keys(data).filter((k) => k !== "operations" && k !== "question")),
  };
}
