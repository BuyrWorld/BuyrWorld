/**
 * The same case, shown to different people.
 *
 * Most of this file is two properties, checked across every role and depth
 * rather than at a few chosen points — because the failure they guard against
 * is a table entry being wrong, and a table entry being wrong is exactly what
 * spot checks miss.
 *
 *   - Every projection is a subset of one set of facts. `specs/05` says all
 *     views use the same facts; a view that could add or reword one would
 *     make that an intention rather than a property.
 *   - No projection drops a material claim. The spec says role selection
 *     never hides a material risk, and a rule that holds for six roles and
 *     not the seventh is not a rule.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { claim, narrative, SECTION, WEIGHT } from "../../src/case/narrative.mjs";
import {
  project, hiddenSaid, defaultDepthFor, showsAt, SHOWS,
  ROLE, ROLES, ROLE_TITLE, DEPTH, DEPTHS, SCOPE_AVAILABLE, SCOPE_SAID,
} from "../../src/case/projection.mjs";

/** A case with something in every section and every weight. */
const full = () => narrative([
  claim({ section: SECTION.HAPPENED, said: "The supplier moved the date to the 30th." }),
  claim({ section: SECTION.HAPPENED, said: "The works order was raised on the 2nd.",
          weight: WEIGHT.DETAIL }),
  claim({ section: SECTION.MATTERS, said: "That is after the build.",
          weight: WEIGHT.MATERIAL }),
  claim({ section: SECTION.MATTERS, said: "It changes the landed cost.",
          needs: ["quantity"], figure: { amount: "1250.00", currency: "GBP" } }),
  claim({ section: SECTION.OPTIONS, said: "Split the delivery." }),
  claim({ section: SECTION.OPTIONS, said: "Expedite the balance.", weight: WEIGHT.DETAIL }),
  claim({ section: SECTION.NEXT, said: "Ask for the revised schedule in writing." }),
  claim({ section: SECTION.NEXT, said: "Check the works order date against it." }),
  claim({ section: SECTION.NEXT, said: "Tell the planner today.", weight: WEIGHT.MATERIAL }),
  claim({ section: SECTION.EVIDENCE, said: "Read from the supplier's email of 14 September." }),
]);

const every = [];
for (const role of ROLES) for (const depth of [null, ...DEPTHS]) every.push({ role, depth });

/* ----------------------------------------------------------- the invariants */

describe("every view is the same case", () => {
  test("no view shows anything the case did not say", () => {
    /* A projection that could add a claim would make "all views use the same
       facts" an intention rather than a property. */
    const n = full();
    const said = new Set(n.claims.map((c) => c.said));
    for (const at of every) {
      for (const c of project(n, at).claims) {
        assert.ok(said.has(c.said), `${at.role}/${at.depth} invented: ${c.said}`);
      }
    }
  });

  test("no view rewords a claim or restores a withheld figure", () => {
    /* The projection selects. If it could rewrite, the depth switch would
       become a second author. */
    const n = full();
    const byText = new Map(n.claims.map((c) => [c.said, c]));
    for (const at of every) {
      for (const c of project(n, at).claims) {
        const original = byText.get(c.said);
        assert.equal(c.figure, original.figure, `${at.role}/${at.depth} changed a figure`);
        assert.equal(c.weight, original.weight);
      }
    }
  });

  test("no role and no depth ever hides a material claim", () => {
    /* The rule `specs/05` states outright. Checked at all twenty-eight
       combinations, because a rule that holds for six roles and not the
       seventh is not a rule. */
    const n = full();
    const material = n.claims.filter((c) => c.weight === WEIGHT.MATERIAL);
    assert.ok(material.length >= 2, "the fixture has nothing material to hide");

    for (const at of every) {
      const shown = new Set(project(n, at).claims.map((c) => c.said));
      for (const c of material) {
        assert.ok(shown.has(c.said),
          `${at.role} at ${at.depth ?? "its default"} hid a material claim: ${c.said}`);
      }
    }
  });

  test("and a material claim is never counted as hidden", () => {
    const n = full();
    for (const at of every) {
      const view = project(n, at);
      assert.equal(view.hidden.some((c) => c.weight === WEIGHT.MATERIAL), false,
        `${at.role}/${at.depth}`);
    }
  });

  test("shown and hidden together are the whole case, always", () => {
    /* Neither losing a claim nor counting one twice. */
    const n = full();
    for (const at of every) {
      const view = project(n, at);
      assert.equal(view.claims.length + view.hidden.length, n.claims.length,
        `${at.role}/${at.depth}`);
    }
  });

  test("every section survives every view", () => {
    /* A view that dropped a heading would make a case with nothing under it
       and a case not showing it look alike. */
    const n = full();
    for (const at of every) {
      assert.equal(project(n, at).sections.length, 5, `${at.role}/${at.depth}`);
    }
  });
});

/* --------------------------------------------------------------- the depths */

describe("depth decides how much", () => {
  test("technical shows everything", () => {
    const n = full();
    const view = project(n, { role: ROLE.BUYER, depth: DEPTH.TECHNICAL });
    assert.equal(view.hidden.length, 0);
    assert.equal(view.claims.length, n.claims.length);
  });

  test("standard leaves the detail out", () => {
    const n = full();
    const view = project(n, { role: ROLE.BUYER, depth: DEPTH.STANDARD });
    assert.ok(view.hidden.length > 0);
    assert.equal(view.claims.some((c) => c.weight === WEIGHT.DETAIL), false);
  });

  test("guided leaves the detail out and asks for the terms to be explained", () => {
    /* `specs/05`, junior default: plain meaning and expandable terminology.
       That is a rendering instruction, not a change to what is said. */
    const view = project(full(), { role: ROLE.JUNIOR, depth: DEPTH.GUIDED });
    assert.equal(view.explainTerms, true);
    assert.equal(project(full(), { depth: DEPTH.TECHNICAL }).explainTerms, false);
  });

  test("an unknown depth falls back to standard, not to material only", () => {
    /* The first version asserted only that something was shown, which the
       material guard satisfies on its own — so a fallback of "nothing" would
       have passed while showing a case stripped to its risks. */
    const n = full();
    const odd = project(n, { role: ROLE.BUYER, depth: "exhaustive" });
    const standard = project(n, { role: ROLE.BUYER, depth: DEPTH.STANDARD });
    assert.deepEqual(odd.claims.map((c) => c.said), standard.claims.map((c) => c.said));
    assert.deepEqual([...showsAt("exhaustive")], [...showsAt(DEPTH.STANDARD)]);
  });

  test("every depth admits material, and the table is checked directly", () => {
    /* Two locks hold this door — the table and an unconditional keep in the
       filter — which means neither can be caught failing on its own. So each
       is tested in its own right: this is the table. */
    for (const depth of DEPTHS) {
      assert.ok(SHOWS[depth].includes(WEIGHT.MATERIAL), `${depth} does not admit material`);
    }
    assert.equal(Object.keys(SHOWS).length, DEPTHS.length,
      "a depth exists with no row, or a row with no depth");
  });
});

/* ---------------------------------------------------------------- the roles */

describe("role picks a starting point, not a cage", () => {
  test("a junior starts guided and everyone else starts standard", () => {
    assert.equal(defaultDepthFor(ROLE.JUNIOR), DEPTH.GUIDED);
    for (const role of ROLES.filter((r) => r !== ROLE.JUNIOR)) {
      assert.equal(defaultDepthFor(role), DEPTH.STANDARD, role);
    }
  });

  test("a chosen depth beats the role's default", () => {
    /* `specs/05`: users may override defaults at any time. */
    const view = project(full(), { role: ROLE.JUNIOR, depth: DEPTH.TECHNICAL });
    assert.equal(view.depth, DEPTH.TECHNICAL);
    assert.equal(view.depthWasChosen, true);
    assert.equal(view.claims.some((c) => c.weight === WEIGHT.DETAIL), true);
  });

  test("and not choosing one is distinguishable from choosing the default", () => {
    assert.equal(project(full(), { role: ROLE.BUYER }).depthWasChosen, false);
    assert.equal(project(full(), { role: ROLE.BUYER, depth: DEPTH.STANDARD }).depthWasChosen, true);
  });

  test("a junior is given one next action", () => {
    /* One is not a simplification of three. Three next actions is a list to
       choose from, which is the thing somebody new has no basis for doing. */
    const next = project(full(), { role: ROLE.JUNIOR })
      .sections.find((s) => s.section === SECTION.NEXT);
    assert.equal(next.claims.length, 1);
  });

  test("and the one they are given is the material one", () => {
    /* A cap that dropped a material action would be the rule failing in the
       one section where it is a thing to do rather than a thing to know. */
    const next = project(full(), { role: ROLE.JUNIOR })
      .sections.find((s) => s.section === SECTION.NEXT);
    assert.equal(next.claims[0].weight, WEIGHT.MATERIAL);
    assert.match(next.claims[0].said, /Tell the planner today/);
  });

  test("several material actions all survive the cap", () => {
    const n = narrative([
      claim({ section: SECTION.NEXT, said: "Tell the planner.", weight: WEIGHT.MATERIAL }),
      claim({ section: SECTION.NEXT, said: "Stop the works order.", weight: WEIGHT.MATERIAL }),
      claim({ section: SECTION.NEXT, said: "Tidy the file." }),
    ]);
    const next = project(n, { role: ROLE.JUNIOR })
      .sections.find((s) => s.section === SECTION.NEXT);
    assert.equal(next.claims.length, 2);
    assert.equal(next.claims.every((c) => c.weight === WEIGHT.MATERIAL), true);
  });

  test("everyone else sees all the next actions", () => {
    for (const role of ROLES.filter((r) => r !== ROLE.JUNIOR)) {
      const next = project(full(), { role, depth: DEPTH.TECHNICAL })
        .sections.find((s) => s.section === SECTION.NEXT);
      assert.equal(next.claims.length, 3, role);
    }
  });

  test("every role has a name a person would recognise", () => {
    for (const role of ROLES) {
      assert.ok(ROLE_TITLE[role], role);
      assert.match(ROLE_TITLE[role], /^[A-Z]/, role);
    }
  });

  test("an unknown role behaves like an ordinary one rather than failing", () => {
    const view = project(full(), { role: "chief-vibes-officer" });
    assert.equal(view.depth, DEPTH.STANDARD);
    assert.ok(view.claims.length > 0);
  });
});

/* ---------------------------------------------------------------- scope */

describe("scope says what is true rather than drawing a control", () => {
  test("it reports that there is nothing to scope by", () => {
    /* A control that appears to restrict what somebody sees while restricting
       nothing is worse than no control: it is a claim about safety that is
       not true. */
    assert.equal(SCOPE_AVAILABLE, false);
    assert.equal(project(full(), {}).scopeAvailable, false);
  });

  test("and says plainly that role changes how much, not what you may see", () => {
    assert.match(SCOPE_SAID, /no teams, sites or regions/);
    assert.match(SCOPE_SAID, /how much is shown, not what you are allowed to see/);
  });

  test("nothing in it claims a permission model", () => {
    assert.equal(/permission|authoris|restricted to|your team's/i.test(SCOPE_SAID), false);
  });
});

/* ------------------------------------------------------------- what is left out */

describe("a view says when it is showing less", () => {
  test("it counts what it left out", () => {
    /* A view that quietly shows less than the case holds teaches somebody
       that the case holds that much. */
    const said = hiddenSaid(project(full(), { depth: DEPTH.STANDARD }));
    assert.match(said, /2 further points are recorded/);
    assert.match(said, /Nothing material is ever hidden/);
  });

  test("one reads as one", () => {
    const n = narrative([
      claim({ section: SECTION.HAPPENED, said: "A fact." }),
      claim({ section: SECTION.HAPPENED, said: "A detail.", weight: WEIGHT.DETAIL }),
    ]);
    assert.match(hiddenSaid(project(n, { depth: DEPTH.STANDARD })), /1 further point is recorded/);
  });

  test("and a view showing everything says nothing", () => {
    assert.equal(hiddenSaid(project(full(), { depth: DEPTH.TECHNICAL })), "");
  });
});
