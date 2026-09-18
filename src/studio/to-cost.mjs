/**
 * From the part somebody drew to the material somebody buys — deliberately,
 * and only once.
 *
 * The 15 September audit left this as the second thing to fix, and worded the
 * danger precisely: *"The visual model and stock/blank plan are separate. Do
 * not silently use model mass as purchased stock mass. A future explicit,
 * reviewed transfer should explain stock allowances, removed volume and
 * material evidence."* `specs/02`'s Phase 5 asks for the same thing from the
 * other end: *"Connect confirmed dimensions/material/requirements to bounded
 * 3D editing, review package and scenario revision."*
 *
 * The part is not the blank. A finished part 100 × 60 × 10 was cut from
 * something larger, and how much larger is a decision somebody makes about
 * machining, holding and flatness — not a number that can be derived from the
 * part. So:
 *
 *   - **No allowance, no transfer.** A blank the same size as the part is an
 *     allowance of nothing, which is a decision and must be typed as one. This
 *     refuses rather than defaulting to zero, because zero is the single
 *     assumption that makes every downstream figure quietly too low.
 *   - **What is carried is the blank, never the part's mass as purchased
 *     mass.** Purchased mass is stock units × stock volume, and `planMaterial`
 *     works it out once the layout and the bought stock are known. This hands
 *     over the blank's dimensions and volume and says so in as many words.
 *   - **A range is never handed over as a number.** A part with a round
 *     feature has a volume with pi in it, and `geometry.mjs` reports bounds.
 *     The bounds travel as bounds; the single figure the cost plan would use
 *     for net mass is withheld, with the reason, rather than collapsed.
 *   - **A transfer is an act with a name and a revision against it.** It is
 *     stamped with the geometry and material it was derived from, and one
 *     taken against a part that has since changed cannot be accepted — the
 *     same rule, through the same module, that stops a stale estimate being
 *     saved.
 */

import { volume, mass } from "./geometry.mjs";
import { massOf } from "../calc/units.mjs";
import { stamp, check } from "./staleness.mjs";

/** What has to be decided before a blank exists. */
export const ALLOWANCES = Object.freeze({
  sideUm: "How much extra across the width, on each side, for machining and holding?",
  endUm: "How much extra along the length, at each end?",
  faceUm: "How much extra on the thickness, in total across both faces?",
});

/** An allowance somebody typed. Zero is allowed; absent is not. */
const given = (v) => typeof v === "bigint" && v >= 0n;

/**
 * Work out the blank, and everything that follows from it.
 *
 * Returns `{ ok: false, missing }` while anything it needs is undecided, and
 * never a partial answer: a blank size shown beside a missing allowance is a
 * figure somebody will write down.
 */
export function propose({ model = null, density = null, allowances = {} } = {}) {
  const missing = [];
  if (!model || typeof model.widthUm !== "bigint") {
    missing.push({
      what: "the part",
      why: "There is no model yet, so there is nothing to cut a blank from.",
    });
  }
  for (const [name, question] of Object.entries(ALLOWANCES)) {
    if (!given(allowances[name])) {
      missing.push({
        what: name,
        why: question,
      });
    }
  }
  if (missing.length > 0) {
    return Object.freeze({
      ok: false,
      missing: Object.freeze(missing.map(Object.freeze)),
      said: "This is not worked out yet. A blank the same size as the part is an allowance of "
          + "nothing, which is a decision rather than a default — so it is asked for rather "
          + "than assumed.",
    });
  }

  const blank = Object.freeze({
    widthUm: model.widthUm + 2n * allowances.sideUm,
    lengthUm: model.lengthUm + 2n * allowances.endUm,
    thicknessUm: model.thicknessUm + allowances.faceUm,
  });
  const blankVolumeUm3 = blank.widthUm * blank.lengthUm * blank.thicknessUm;

  const part = volume(model);
  const removed = Object.freeze({
    /* Least removed when the part is at its largest, and the other way about.
       Swapping these is the kind of mistake that survives review because both
       numbers look reasonable. */
    lowerUm3: blankVolumeUm3 - part.upperUm3,
    upperUm3: blankVolumeUm3 - part.lowerUm3,
    exact: part.exact,
  });

  const m = density ? mass(model, density) : Object.freeze({ known: false,
    why: "No density has been confirmed, so no weight is carried over. A weight guessed from "
       + "a similar alloy moves the whole purchased quantity." });

  return Object.freeze({
    ok: true,
    blank,
    blankVolumeUm3,
    part: Object.freeze({
      lowerUm3: part.lowerUm3, upperUm3: part.upperUm3, exact: part.exact, why: part.why,
    }),
    removed,
    allowances: Object.freeze({ ...allowances }),
    mass: m.known
      ? Object.freeze({
          known: true,
          partLowerUg: m.lowerUg,
          partUpperUg: m.upperUg,
          blankUg: blankMass(blankVolumeUm3, density),
          source: m.source,
          /* Said here because this is the exact place the audit warned about. */
          note: "This is the weight of one blank and of the finished part. It is not the "
              + "purchased weight: that is stock units times stock volume, and follows from "
              + "the layout and the stock actually bought.",
        })
      : Object.freeze({ known: false, why: m.why }),

    /* The fields the cost plan takes, and nothing else — so a caller cannot
       reach past this into the model and take something that was withheld. */
    forPlan: Object.freeze({
      blankVolumeUm3,
      blankWidthUm: blank.widthUm,
      blankLengthUm: blank.lengthUm,
      /* Withheld when the part's volume is a bracket. The plan reports net
         mass as a figure, and a bound presented as a figure is the thing this
         repository refuses everywhere else. */
      partVolumeUm3: part.exact ? part.lowerUm3 : null,
      partVolumeWithheld: part.exact
        ? null
        : "The part has a round feature, so its volume is a bracket rather than a figure. "
          + "The net weight of the finished parts is left out rather than shown as one end "
          + "of it.",
      density: density ?? null,
      /* Never present, and named so that its absence is deliberate rather than
         an oversight somebody later fills in. */
      purchasedMassUg: null,
    }),

    says: Object.freeze([
      `The blank is the part plus ${fmt(allowances.sideUm)}mm each side, `
        + `${fmt(allowances.endUm)}mm each end and ${fmt(allowances.faceUm)}mm on the thickness.`,
      part.exact
        ? `Cutting it to shape removes ${fmt3(removed.lowerUm3)} cubic mm.`
        : `Cutting it to shape removes between ${fmt3(removed.lowerUm3)} and `
          + `${fmt3(removed.upperUm3)} cubic mm — the part has a round feature, so its volume `
          + "contains pi.",
      "Nothing here says what the stock is or how many blanks fit on it. That is the layout, "
        + "and the purchase quantity follows from it.",
    ]),

    basedOn: stamp({ geometry: model, material: density ?? null }),
    revision: model.revision,
  });
}

/* Through `units.mjs`'s `massOf`, which its own comment calls "the single
   rounding in the chain, named". A second conversion written here is how two
   parts of one product come to disagree about a weight by a microgram, and
   then — multiplied by a purchase quantity — by a kilogram. */
const blankMass = (volumeUm3, density) =>
  (density && typeof density.perMm3Scaled === "bigint") ? massOf(volumeUm3, density) : null;

/**
 * Take it.
 *
 * `specs/02` asks for explicit revision transitions, and this is one: a
 * transfer records who made it and what it was made against, and one made
 * against a part that has moved since is refused rather than applied. The
 * caller applies the result to the plan; this is the evidence that somebody
 * chose to.
 */
export function accept(proposal, by, { model = null, density = null } = {}) {
  if (!proposal || !proposal.ok) {
    throw new RangeError("This is not worked out yet, so there is nothing to carry over.");
  }
  if (!by) throw new TypeError("Carrying this into the cost plan has to record who did it.");

  const state = check(proposal.basedOn, { geometry: model, material: density ?? null },
    { rebuild: "worked out again" });
  if (state.stale) throw new RangeError(state.said);

  return Object.freeze({
    ...proposal.forPlan,
    by: String(by),
    at: new Date().toISOString(),
    fromRevision: proposal.revision,
    allowances: proposal.allowances,
    /* What the person is answerable for having decided, kept with the record
       rather than only shown on the screen where they decided it. */
    says: proposal.says,
  });
}

/** Whether a transfer still describes the part it was made from. */
export const stillAbout = (transferOrProposal, { model = null, density = null } = {}) =>
  !check(transferOrProposal?.basedOn ?? null, { geometry: model, material: density ?? null }).stale;

/* --------------------------------------------------------------- saying it */

/** Micrometres as millimetres, with no trailing zeros. */
function fmt(um) {
  const whole = um / 1000n;
  const frac = String(um % 1000n).padStart(3, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

/** Cubic micrometres as cubic millimetres, rounded down to a whole one. */
const fmt3 = (um3) => String(um3 / 1_000_000_000n);
