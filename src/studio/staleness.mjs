/**
 * Whether something worked out earlier still describes the part in front of
 * you.
 *
 * `specs/04-COMPLETE-CASE.md`: *"Change geometry/material/requirements → mark
 * dependent estimates and review exports stale, list what changed and require
 * recalculation/review."*
 *
 * Two things in the Studio are worked out once and then held: the calculated
 * plan and cost, which a saved estimate is built from, and the review package,
 * which is what gets handed to an engineer. Neither was invalidated when the
 * part changed. Both survived until the case was closed.
 *
 * The harm is specific rather than theoretical. Calculate a cost, add a
 * pocket, then save the estimate: what is stored is the cost of the part
 * before the pocket, filed under the part after it. Build a review package,
 * change a tolerance, then export: the engineer receives a package describing
 * a requirement that no longer exists. Neither says anything is wrong,
 * because from the inside nothing is.
 *
 * So a derived thing carries a stamp of what it was derived from, and can be
 * asked whether that is still true.
 *
 * The comparison is of exact serialised forms rather than a hash. A hash is
 * smaller and faster and would be right almost always, and "almost always" is
 * the wrong standard for deciding whether a cost belongs to a part. The
 * amount being held is one model and a list of requirements.
 */

import { serialise } from "../services/outcome-store.mjs";

/**
 * What a derived thing can depend on, and what to call each when it moves.
 *
 * Named rather than positional so the message can say which — "something
 * changed" sends somebody looking through a form for it.
 */
export const DEPENDS = Object.freeze({
  geometry: "the part's geometry",
  material: "the material",
  requirements: "the requirements",
  inputs: "the figures entered",
});

const NAMES = Object.keys(DEPENDS);

/**
 * Which of those names are already plural.
 *
 * Agreement cannot be worked out from how many things changed: one changed
 * dependency called "the requirements" still takes *have*. Getting this
 * wrong produces "The requirements has changed", which is the kind of
 * sentence that survives in a product for years because it is only ever seen
 * by somebody who is already annoyed about something else.
 */
const PLURAL = new Set(["requirements", "inputs"]);

/**
 * A record of what something was derived from.
 *
 * Only the parts actually passed are stamped. A review package that does not
 * depend on the quantity should not be invalidated by the quantity changing,
 * and the caller is what knows which is which.
 */
export function stamp(parts = {}) {
  const at = {};
  for (const name of NAMES) {
    if (!(name in parts)) continue;
    /* undefined and null are different from absent: a scenario with no model
       is a real state, and something derived while there was no model must
       go stale when one appears. */
    at[name] = serialise(parts[name] ?? null);
  }
  return Object.freeze({ at: Object.freeze(at), stampedAt: new Date().toISOString() });
}

/**
 * What has moved since.
 *
 * Only the parts that were stamped are compared. Something not stamped was
 * not depended on, and reporting it as a change would train people to ignore
 * the message — which is the failure mode of every warning that cries wolf.
 */
export function changedSince(mark, parts = {}) {
  if (!mark || !mark.at) return Object.freeze([]);
  const moved = [];
  for (const name of NAMES) {
    if (!(name in mark.at)) continue;
    if (mark.at[name] !== serialise(parts[name] ?? null)) moved.push(name);
  }
  return Object.freeze(moved);
}

/** Whether a derived thing still describes what it was derived from. */
export const isStale = (mark, parts) => changedSince(mark, parts).length > 0;

/**
 * What to say about it.
 *
 * Names what moved and says what has to happen, because "this is out of date"
 * leaves somebody to work out both. The verb is the caller's: an estimate is
 * recalculated, a review package is rebuilt, and telling somebody to do the
 * wrong one is worse than telling them nothing.
 */
export function saidPlainly(moved, { rebuild = "worked out again" } = {}) {
  if (!moved || moved.length === 0) return "";
  const said = moved.map((n) => DEPENDS[n] ?? n);
  const list = said.length === 1
    ? said[0]
    : `${said.slice(0, -1).join(", ")} and ${said[said.length - 1]}`;
  /* Plural if more than one thing moved, or if the one thing that moved has
     a plural name. */
  const has = moved.length > 1 || PLURAL.has(moved[0]) ? "have" : "has";
  return `${cap(list)} ${has} changed since this was ${rebuild === "rebuilt" ? "built" : "worked out"}. `
       + `It describes the part as it was, not as it is, and has to be ${rebuild} before it is used.`;
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The whole answer about one derived thing, in the shape a caller renders.
 *
 * `usable` is the field that matters: the spec says a stale artefact
 * *requires* recalculation, not that it warns and proceeds. A caller that
 * reads only `said` and shows it beside an export button has implemented a
 * caption, not a rule.
 */
export function check(mark, parts, { rebuild = "worked out again" } = {}) {
  const moved = changedSince(mark, parts);
  return Object.freeze({
    stale: moved.length > 0,
    usable: moved.length === 0,
    changed: moved,
    said: saidPlainly(moved, { rebuild }),
    stampedAt: mark?.stampedAt ?? null,
  });
}
