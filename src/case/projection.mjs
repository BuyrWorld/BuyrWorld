/**
 * The same case, shown to different people.
 *
 * `specs/05-EXPERIENCE-AND-ROLES.md`: *"Role choices: junior buyer, buyer,
 * procurement manager, senior procurement manager, head of supply chain,
 * regional head of supply chain, custom. Separate depth switch: guided /
 * standard / technical; users may override defaults any time… Role selection
 * never grants permissions or hides material risks… All views use the same
 * facts, uncertainty and permission-filtered sources."*
 *
 * This is a selection over the claims `narrative.mjs` produced, and nothing
 * else. It cannot add a claim, cannot reword one, and cannot put a figure
 * back that was withheld. That is the whole design: "all views use the same
 * facts" is a property a test can check rather than an intention a team has,
 * because there is one set of facts and every view is a subset of it.
 *
 * Two invariants, and they are the reason this file exists:
 *
 *   - **Every projection is a subset.** No role sees anything another role
 *     could not, and no role sees anything the case did not say.
 *   - **No projection drops a material claim.** The spec says role selection
 *     never hides a material risk, and whether a claim is material is decided
 *     by the claim in `narrative.mjs` — not by the reader, not here.
 *
 * What this deliberately does not do: `specs/05` describes role-specific
 * content — team workload for a manager, site comparisons for a regional
 * head, aggregate exposure for a head of supply chain. None of that has a
 * producer. Inventing claim kinds for them would be building the shelf before
 * the thing that goes on it, so role currently sets a default depth and caps
 * the next actions, and the rest arrives when something can fill it.
 */

import { SECTION, WEIGHT } from "./narrative.mjs";

/** Who is reading. `specs/05` names these seven. */
export const ROLE = Object.freeze({
  JUNIOR: "junior-buyer",
  BUYER: "buyer",
  MANAGER: "procurement-manager",
  SENIOR: "senior-procurement-manager",
  HEAD: "head-of-supply-chain",
  REGIONAL: "regional-head-of-supply-chain",
  CUSTOM: "custom",
});

export const ROLE_TITLE = Object.freeze({
  [ROLE.JUNIOR]: "Junior buyer",
  [ROLE.BUYER]: "Buyer",
  [ROLE.MANAGER]: "Procurement manager",
  [ROLE.SENIOR]: "Senior procurement manager",
  [ROLE.HEAD]: "Head of supply chain",
  [ROLE.REGIONAL]: "Regional head of supply chain",
  [ROLE.CUSTOM]: "Custom",
});

/**
 * How much of it.
 *
 * A separate switch from role, because `specs/05` says so and because the two
 * are genuinely independent: a junior buyer working through a technical
 * drawing wants the technical depth, and a head of supply chain skimming
 * fourteen cases wants the guided one.
 */
export const DEPTH = Object.freeze({
  GUIDED: "guided",
  STANDARD: "standard",
  TECHNICAL: "technical",
});

/** Where each role starts. A default, overridable at any time. */
const DEFAULT_DEPTH = Object.freeze({
  [ROLE.JUNIOR]: DEPTH.GUIDED,
  [ROLE.BUYER]: DEPTH.STANDARD,
  [ROLE.MANAGER]: DEPTH.STANDARD,
  [ROLE.SENIOR]: DEPTH.STANDARD,
  [ROLE.HEAD]: DEPTH.STANDARD,
  [ROLE.REGIONAL]: DEPTH.STANDARD,
  [ROLE.CUSTOM]: DEPTH.STANDARD,
});

export const defaultDepthFor = (role) => DEFAULT_DEPTH[role] ?? DEPTH.STANDARD;

/**
 * How many next steps a role is given at once.
 *
 * `specs/05`, junior default: *"plain meaning, one next action, worked
 * explanation"*. One is not a simplification of three — three next actions is
 * a list to choose from, which is the thing somebody new has no basis for
 * doing yet.
 */
const NEXT_ACTIONS = Object.freeze({
  [ROLE.JUNIOR]: 1,
  [ROLE.BUYER]: Infinity,
  [ROLE.MANAGER]: Infinity,
  [ROLE.SENIOR]: Infinity,
  [ROLE.HEAD]: Infinity,
  [ROLE.REGIONAL]: Infinity,
  [ROLE.CUSTOM]: Infinity,
});

/**
 * Which weights a depth shows.
 *
 * Material appears in every one, and the filter below also keeps it
 * unconditionally. That is two locks on one door, deliberately — and worth
 * being honest about, because it means neither can be caught failing on its
 * own: remove the unconditional keep and the table still holds; take material
 * out of a table row and the keep still holds.
 *
 * The redundancy is kept because this is the one rule `specs/05` states
 * outright, and because the likely future mistake is somebody adding a fourth
 * depth and forgetting the row. What is tested instead is each lock in its
 * own right: `SHOWS` is exported so every row can be checked to contain
 * material, and the invariant across all roles and depths is checked
 * separately.
 */
export const SHOWS = Object.freeze({
  [DEPTH.GUIDED]: Object.freeze([WEIGHT.MATERIAL, WEIGHT.NORMAL]),
  [DEPTH.STANDARD]: Object.freeze([WEIGHT.MATERIAL, WEIGHT.NORMAL]),
  [DEPTH.TECHNICAL]: Object.freeze([WEIGHT.MATERIAL, WEIGHT.NORMAL, WEIGHT.DETAIL]),
});

/* ---------------------------------------------------------------- scope */

/**
 * What this build can honestly say about scope.
 *
 * `specs/05` wants scope choices reflecting *"actual permitted team/site/
 * region data"*. There are no accounts here, no teams and no permissions —
 * one browser holding its own cases. A scope control would therefore filter
 * nothing, and a control that appears to restrict what somebody sees while
 * restricting nothing is worse than no control: it is a claim about safety
 * that is not true.
 *
 * So the honest answer is reported rather than a dropdown drawn. When there
 * is an account model, this is where it goes.
 */
export const SCOPE_AVAILABLE = false;

export const SCOPE_SAID =
  "This build holds cases in this browser only. There are no teams, sites or regions to "
  + "choose between, and nothing here is filtered by who you are — the role setting changes "
  + "how much is shown, not what you are allowed to see.";

/* ----------------------------------------------------------- the projection */

/**
 * One view of a narrative.
 *
 * `depth` overrides the role's default when given. `specs/05`: *"users may
 * override defaults any time"* — so a role does not lock a depth, it picks a
 * starting one.
 */
export function project(n, { role = ROLE.BUYER, depth = null } = {}) {
  const chosen = depth ?? defaultDepthFor(role);
  const shows = SHOWS[chosen] ?? SHOWS[DEPTH.STANDARD];

  const keep = (c) =>
    /* Material first and unconditionally. A depth that could drop one would
       make the spec's rule depend on the table above being right. */
    c.weight === WEIGHT.MATERIAL || shows.includes(c.weight);

  const sections = n.sections.map((s) => {
    let claims = s.claims.filter(keep);

    if (s.section === SECTION.NEXT) {
      const cap = NEXT_ACTIONS[role] ?? Infinity;
      if (claims.length > cap) {
        /* Material next steps are kept whatever the cap, then the rest fill
           what is left. A cap that could drop a material action would be the
           rule failing in the one section where it is a thing to do. */
        const must = claims.filter((c) => c.weight === WEIGHT.MATERIAL);
        const rest = claims.filter((c) => c.weight !== WEIGHT.MATERIAL);
        claims = must.length >= cap ? must : [...must, ...rest.slice(0, cap - must.length)];
      }
    }

    return Object.freeze({ ...s, claims: Object.freeze(claims) });
  });

  const shown = sections.flatMap((s) => s.claims);

  return Object.freeze({
    role,
    depth: chosen,
    depthWasChosen: depth !== null,
    sections: Object.freeze(sections),
    claims: Object.freeze(shown),
    /* Guided asks for the terminology to be expandable, which is a rendering
       instruction and not a change to what is said. */
    explainTerms: chosen === DEPTH.GUIDED,
    /* What this view is not showing, so it can say so rather than looking
       like the whole case. */
    hidden: Object.freeze(n.claims.filter((c) => !shown.includes(c))),
    scopeAvailable: SCOPE_AVAILABLE,
    scopeSaid: SCOPE_SAID,
  });
}

/**
 * What a view is leaving out, said plainly.
 *
 * A view that quietly shows less than the case holds teaches somebody that
 * the case holds that much. One sentence, and only when there is something to
 * say.
 */
export function hiddenSaid(view) {
  const n = view.hidden.length;
  if (n === 0) return "";
  return `${n} further ${n === 1 ? "point is" : "points are"} recorded on this case and not `
       + `shown at this depth. Nothing material is ever hidden.`;
}

/** Every role and depth, for a caller offering the choice. */
/** Which weights a given depth admits, for a caller that needs to know. */
export const showsAt = (depth) => SHOWS[depth] ?? SHOWS[DEPTH.STANDARD];

export const ROLES = Object.freeze(Object.values(ROLE));
export const DEPTHS = Object.freeze(Object.values(DEPTH));
