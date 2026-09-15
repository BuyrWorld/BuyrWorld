/**
 * Turning a sentence into a proposed edit, without letting it become code.
 *
 * Increment C4. The pack is unusually specific about what this must not do,
 * and the shape of the module follows from those refusals rather than from the
 * feature:
 *
 *   "AI should produce a validated modelling proposal, not arbitrary
 *    executable code."
 *   "Ask a short question rather than guessing an ambiguous target."
 *   "AI must not manufacture a tolerance/finish value, choose an unknown
 *    specification revision, automatically approve requirements."
 *   "Stale AI proposals cannot overwrite newer manual edits."
 *
 * So a proposal is **data checked against a closed list of operations**. There
 * is no interpreter here, nothing is evaluated, and an operation this file
 * does not already know about cannot be expressed — which means the worst a
 * compromised or confused model can do is propose a hole in the wrong place,
 * and a person will see it drawn before it happens.
 *
 * The three answers it can give are equally first-class. A proposal can be
 * **ready** to preview, it can be **a question** because the instruction did
 * not pin something down, or it can be **refused** because what was asked is
 * outside what this can do. Guessing is not among them.
 *
 * Nothing here calls a model. A proposal arrives as an object from wherever —
 * the adapter in `src/services/ai/`, a test, eventually a person clicking
 * buttons — and is validated the same way regardless. That is what keeps the
 * manual path working when no AI service is configured, which the pack
 * requires: "Manual modelling must remain useful without an AI service."
 */

import { addHole, addPocket, editFeature, removeFeature, whyInvalid, featureIds } from "./geometry.mjs";

/* ------------------------------------------------- the permitted operations */

/**
 * Every operation a proposal may contain, and the parameters each needs.
 *
 * A closed list, checked by name. An instruction that does not map onto one of
 * these produces a refusal rather than an attempt, because the alternative is
 * a general mechanism for turning sentences into changes — which is the thing
 * the pack spends a paragraph forbidding.
 */
export const OPERATION = Object.freeze({
  ADD_HOLE: "add-hole",
  ADD_POCKET: "add-pocket",
  MOVE_FEATURE: "move-feature",
  RESIZE_HOLE: "resize-hole",
  REMOVE_FEATURE: "remove-feature",
});

const SHAPE = Object.freeze({
  [OPERATION.ADD_HOLE]: { needs: ["xMm", "yMm", "diameterMm"], targets: false },
  [OPERATION.ADD_POCKET]: { needs: ["xMm", "yMm", "widthMm", "lengthMm", "depthMm"], targets: false },
  [OPERATION.MOVE_FEATURE]: { needs: ["dxMm", "dyMm"], targets: true, signed: ["dxMm", "dyMm"] },
  [OPERATION.RESIZE_HOLE]: { needs: ["diameterMm"], targets: true },
  [OPERATION.REMOVE_FEATURE]: { needs: [], targets: true },
});

export const OUTCOME = Object.freeze({
  READY: "ready",
  QUESTION: "needs-an-answer",
  REFUSED: "outside-what-this-can-do",
  STALE: "the-part-moved-on",
});

/* ------------------------------------------------------------- numbers */

/** A millimetre decimal to integer micrometres, or null if it is not one. */
function um(value, { signed = false } = {}) {
  const text = String(value ?? "").trim();
  const m = signed ? /^([+-]?)(\d+)(?:\.(\d{1,3}))?$/.exec(text) : /^(\+?)(\d+)(?:\.(\d{1,3}))?$/.exec(text);
  if (!m) return null;
  const mag = BigInt(m[2]) * 1000n + BigInt((m[3] ?? "").padEnd(3, "0"));
  return m[1] === "-" ? -mag : mag;
}

/* ----------------------------------------------------------- validation */

/**
 * Check a proposal against the operation list and the model it names.
 *
 * @param {object} model     the current geometry
 * @param {object} proposal  { modelRevision, operations: [...], said?, assumptions? }
 */
export function validate(model, proposal = {}) {
  if (!model) {
    return out(OUTCOME.REFUSED, { why: "There is no part to change yet. Build a block first." });
  }

  /* The part moved on while the proposal was being made. Checked before
     anything else, because every target below was resolved against a model
     that is no longer the one on screen. */
  if (proposal.modelRevision !== undefined && proposal.modelRevision !== model.revision) {
    return out(OUTCOME.STALE, {
      why: `This was worked out when the part was at revision ${proposal.modelRevision}; `
        + `it is now at ${model.revision}. Ask again so it can see the part as it is.`,
    });
  }

  const operations = Array.isArray(proposal.operations) ? proposal.operations : [];
  if (operations.length === 0) {
    return out(OUTCOME.REFUSED, { why: "The proposal contains no change to make." });
  }

  const checked = [];
  const questions = [];
  const refusals = [];

  for (const op of operations) {
    const kind = String(op && op.op);
    const shape = SHAPE[kind];

    if (!shape) {
      /* The closed list doing its job. Naming what is possible is more useful
         than saying no, and it is the only place this file describes its own
         limits to a person. */
      refusals.push(`"${kind}" is not something this can do. It can add a hole or a pocket, `
        + "move a feature, change a hole's diameter, or remove a feature.");
      continue;
    }

    if (shape.targets) {
      const resolved = resolveTarget(model, op);
      if (resolved.question) { questions.push(resolved.question); continue; }
      if (resolved.refusal) { refusals.push(resolved.refusal); continue; }
      op.featureId = resolved.id;
    }

    const values = {};
    let bad = false;
    for (const key of shape.needs) {
      const signed = (shape.signed ?? []).includes(key);
      const v = um(op[key], { signed });
      if (v === null) {
        questions.push(`${label(kind)} needs ${plain(key)}, in millimetres. `
          + `I was given ${JSON.stringify(op[key] ?? null)}.`);
        bad = true;
        break;
      }
      values[key] = v;
    }
    if (bad) continue;

    checked.push(Object.freeze({ op: kind, featureId: op.featureId ?? null, values: Object.freeze(values) }));
  }

  if (refusals.length) return out(OUTCOME.REFUSED, { why: refusals.join(" "), refusals, questions });
  if (questions.length) return out(OUTCOME.QUESTION, { questions });

  return out(OUTCOME.READY, { operations: checked, said: proposal.said ?? null });
}

const out = (outcome, rest) => Object.freeze({
  outcome,
  ok: outcome === OUTCOME.READY,
  questions: Object.freeze(rest.questions ?? []),
  refusals: Object.freeze(rest.refusals ?? []),
  operations: Object.freeze(rest.operations ?? []),
  why: rest.why ?? null,
  said: rest.said ?? null,
});

const label = (kind) => ({
  [OPERATION.ADD_HOLE]: "Adding a hole",
  [OPERATION.ADD_POCKET]: "Adding a pocket",
  [OPERATION.MOVE_FEATURE]: "Moving a feature",
  [OPERATION.RESIZE_HOLE]: "Changing a diameter",
  [OPERATION.REMOVE_FEATURE]: "Removing a feature",
}[kind] ?? kind);

const plain = (key) => ({
  xMm: "an X position", yMm: "a Y position", diameterMm: "a diameter",
  widthMm: "a width", lengthMm: "a length", depthMm: "a depth",
  dxMm: "a distance along X", dyMm: "a distance along Y",
}[key] ?? key);

/**
 * Work out which feature was meant.
 *
 * "make this pocket deeper" is only actionable when there is exactly one
 * pocket, or one is selected. Otherwise it is a question — "Ask a short
 * question rather than guessing an ambiguous target" — because picking the
 * first one and being wrong changes the part silently.
 */
function resolveTarget(model, op) {
  const ids = featureIds(model);

  if (op.featureId) {
    if (ids.includes(op.featureId)) return { id: op.featureId };
    return { refusal: `There is no ${op.featureId} on this part. It has ${ids.join(", ") || "no features"}.` };
  }

  /* A described target: "the pocket", "the hole". Only usable when it picks
     out exactly one thing. */
  const described = String(op.target ?? "").toLowerCase();
  if (!described) {
    return { question: `${label(String(op.op))} needs to say which feature. `
      + `This part has ${ids.join(", ") || "no features"}.` };
  }

  const wanted = described.includes("pocket") ? "pocket" : described.includes("hole") ? "hole" : null;
  if (!wanted) {
    return { question: `I could not tell which feature "${op.target}" means. `
      + `This part has ${ids.join(", ") || "no features"}.` };
  }

  const matches = ids.filter((id) => id.startsWith(`${wanted}-`));
  if (matches.length === 1) return { id: matches[0] };
  if (matches.length === 0) return { refusal: `This part has no ${wanted}.` };
  return { question: `There are ${matches.length} ${wanted}s — ${matches.join(", ")}. Which one?` };
}

/* -------------------------------------------------------------- preview */

/**
 * Run a validated proposal through the real geometry operations.
 *
 * The same functions the manual controls use, so an accepted proposal and a
 * hand-entered edit cannot produce different geometry — which the acceptance
 * checks ask for directly: "Direct and accepted AI edits use the same
 * deterministic operation layer and produce equivalent geometry."
 *
 * Nothing is committed. The caller gets the model that *would* result, and
 * what it would cost in requirements.
 */
export function preview(model, validated) {
  if (!validated.ok) return Object.freeze({ ok: false, why: validated.why, model });

  let next = model;
  const applied = [];

  for (const step of validated.operations) {
    const r = apply(next, step);
    if (r.error) {
      /* One bad step stops all of them. A half-applied proposal is a part
         nobody asked for, and worse than none of it. */
      return Object.freeze({
        ok: false, model,
        why: `${describe(step)} cannot be done: ${r.error}`,
        failedAt: step.op,
      });
    }
    next = r.model;
    applied.push(describe(step));
  }

  return Object.freeze({
    ok: true,
    model: next,
    before: model,
    applied: Object.freeze(applied),
    /* Ids that existed before and do not after, so the caller can say which
       requirements the change would strand — before it happens. */
    losesFeatures: Object.freeze(featureIds(model).filter((id) => !featureIds(next).includes(id))),
    gainsFeatures: Object.freeze(featureIds(next).filter((id) => !featureIds(model).includes(id))),
  });
}

function apply(model, step) {
  const v = step.values;
  switch (step.op) {
    case OPERATION.ADD_HOLE:
      return addHole(model, { xUm: v.xMm, yUm: v.yMm, diameterUm: v.diameterMm });
    case OPERATION.ADD_POCKET:
      return addPocket(model, { xUm: v.xMm, yUm: v.yMm, widthUm: v.widthMm,
        lengthUm: v.lengthMm, depthUm: v.depthMm });
    case OPERATION.MOVE_FEATURE: {
      const f = model.features.find((x) => x.id === step.featureId);
      if (!f) return { error: `There is no ${step.featureId} on this part.`, model };
      return editFeature(model, step.featureId, { xUm: f.xUm + v.dxMm, yUm: f.yUm + v.dyMm });
    }
    case OPERATION.RESIZE_HOLE:
      return editFeature(model, step.featureId, { diameterUm: v.diameterMm });
    case OPERATION.REMOVE_FEATURE:
      return removeFeature(model, step.featureId);
    default:
      /* Unreachable: validate() rejects anything not in SHAPE. Here so that
         adding an operation to the list without adding it here fails loudly
         rather than silently doing nothing. */
      return { error: `${step.op} has no implementation.`, model };
  }
}

const mm = (n) => {
  const neg = n < 0n;
  const a = neg ? -n : n;
  const frac = String(a % 1000n).padStart(3, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${a / 1000n}${frac ? `.${frac}` : ""}`;
};

/** What a step would do, in words a person can check against the drawing. */
export function describe(step) {
  const v = step.values;
  switch (step.op) {
    case OPERATION.ADD_HOLE:
      return `Add a ${mm(v.diameterMm)}mm hole at ${mm(v.xMm)}, ${mm(v.yMm)}`;
    case OPERATION.ADD_POCKET:
      return `Add a ${mm(v.widthMm)} × ${mm(v.lengthMm)}mm pocket ${mm(v.depthMm)}mm deep `
        + `at ${mm(v.xMm)}, ${mm(v.yMm)}`;
    case OPERATION.MOVE_FEATURE:
      return `Move ${step.featureId} by ${mm(v.dxMm)}mm along X and ${mm(v.dyMm)}mm along Y`;
    case OPERATION.RESIZE_HOLE:
      return `Change ${step.featureId} to ${mm(v.diameterMm)}mm`;
    case OPERATION.REMOVE_FEATURE:
      return `Remove ${step.featureId}`;
    default:
      return step.op;
  }
}

/* ------------------------------------------------- what it must not invent */

/**
 * Strip anything a model is not allowed to decide.
 *
 * "AI must not manufacture a tolerance/finish value, choose an unknown
 * specification revision, automatically approve requirements." A proposal that
 * arrives carrying those does not have them removed quietly — they come back
 * as things to ask about, because the fact that a model reached for them is
 * itself worth seeing.
 */
export function withheld(proposal = {}) {
  const held = [];
  for (const r of proposal.requirements ?? []) {
    if (r.tolerance || r.value) {
      held.push(`A ${r.kind ?? "requirement"} came with a value nobody supplied. `
        + "Limits and finishes are not for a model to choose — enter it yourself if it is right.");
    }
    if (r.spec && r.spec.revision && !r.spec.suppliedByUser) {
      held.push(`A specification revision (${r.spec.name} ${r.spec.revision}) was filled in. `
        + "Which revision applies is a fact about your organisation, not something to infer.");
    }
    if (r.confirmed || r.approved) {
      held.push("A requirement arrived marked as confirmed. Confirming is a person's act.");
    }
  }
  return Object.freeze(held);
}

/**
 * Accept a previewed proposal.
 *
 * Takes the previewed model rather than re-running the operations, so what is
 * committed is exactly what was shown. Re-running could differ if anything
 * moved in between, and "what you saw" is the only safe definition of what you
 * agreed to.
 */
export function accept(previewed, currentModel) {
  if (!previewed || !previewed.ok) {
    return { error: "There is nothing to accept.", model: currentModel };
  }
  if (previewed.before !== currentModel) {
    /* The part changed between previewing and accepting. The preview is of a
       part that no longer exists. */
    return {
      error: "The part changed after this was previewed. Ask again so the change is worked out "
        + "against the part as it is now.",
      model: currentModel,
      stale: true,
    };
  }
  return { model: previewed.model };
}
