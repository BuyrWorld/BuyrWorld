/**
 * Every name the page reads off the engine is a name the engine has.
 *
 * `window.BW` is 364 names assembled by hand in `mount.mjs`, and the page
 * reaches into it 254 times. A misspelling in either direction produces
 * `undefined`, and `undefined` here is silent: almost every call site in this
 * page is guarded — `if (!B || !B.thing) return ""` — precisely so that a
 * missing engine degrades instead of throwing. The same guard that makes a
 * failed module request survivable makes a typo invisible. The feature simply
 * never appears, and nothing anywhere says why.
 *
 * That is the shape this repository keeps finding: not a crash, but a
 * mechanism that cannot fire and a default outcome of silence. So the surface
 * is compared rather than trusted.
 *
 * It reads source rather than running the page, because running it needs a
 * browser and this is exactly the class of fault a browser pass would be least
 * likely to notice: everything looks fine, one panel is missing, and nobody
 * knows it was meant to be there.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("app.js", "utf8");
const mount = readFileSync("mount.mjs", "utf8");

/**
 * Names the page may read that the mount deliberately does not provide.
 *
 * One entry, and it is a design decision rather than an oversight: a
 * transport configured in the mount would send somebody's part to a provider
 * without their say, so the page asks for it and never receives it. The
 * absence is held in place by `tests/integration/describe-change.test.mjs`,
 * which fails if a transport ever appears there without somebody meaning it.
 *
 * Adding to this list is a deliberate act. A name here is a feature that
 * cannot run.
 */
const DELIBERATELY_ABSENT = new Map([
  ["aiTransport", "the provider-backed edit reader is off until somebody configures it"],
]);

/** The names `mount.mjs` actually puts on the object. */
function mounted() {
  const start = mount.indexOf("window.BW = {");
  assert.ok(start > 0, "mount.mjs no longer assigns window.BW the way this expects");
  const literal = mount.slice(start + "window.BW = {".length, mount.indexOf("};", start));

  const names = new Set();
  /* Split on commas that are not inside a call — `aiAdapter: createAdapter({…})`
     is one entry containing two of them. */
  for (const part of literal.split(/,(?![^(]*\))/)) {
    const m = part.replace(/\/\*[\s\S]*?\*\//g, " ").trim()
      .match(/^([A-Za-z_$][\w$]*)\s*(:|$)/);
    if (m) names.add(m[1]);
  }
  return names;
}

/**
 * The names the page reads off it.
 *
 * `window.BW.x` anywhere, and `B.x` only inside a function that binds `B` to
 * the engine in that same function. The scoping matters: `defBatnaHTML` names
 * its local result `B` and reads `B.strength` off it, which has nothing to do
 * with the engine, and a checker that counted those would report six failures
 * that are not failures — and be switched off for crying wolf.
 */
function readByThePage() {
  const code = app.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
  const names = new Set();

  for (const m of code.matchAll(/window\.BW\.([A-Za-z_$][\w$]*)/g)) names.add(m[1]);

  let bound = 0;
  for (const chunk of code.split(/\n(?=(?:async )?function )/)) {
    if (!/var B\s*=\s*window\.BW/.test(chunk)) continue;
    bound++;
    for (const m of chunk.matchAll(/\bB\.([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  }

  return { names, bound };
}

describe("the engine surface", () => {
  test("the mount provides a substantial number of names", () => {
    /* A floor, for the reason every check here has one: a parse that found
       nothing would report no mismatches and look like a pass. */
    assert.ok(mounted().size > 200, `only ${mounted().size} names parsed out of the mount`);
  });

  test("and the page really does read them through a bound B", () => {
    const { names, bound } = readByThePage();
    assert.ok(bound > 50, `only ${bound} functions bind B to the engine; the scan is wrong`);
    assert.ok(names.size > 150, `only ${names.size} names read; the scan is wrong`);
  });

  test("every name the page reads is one the mount provides", () => {
    const provided = mounted();
    const { names } = readByThePage();

    const missing = [...names]
      .filter((n) => !provided.has(n) && !DELIBERATELY_ABSENT.has(n))
      .sort();

    assert.deepEqual(missing, [],
      "the page reads these off window.BW and the mount does not provide them, so the "
      + "features that depend on them are silently off:\n  " + missing.join("\n  "));
  });

  test("and everything deliberately absent is still absent, for its stated reason", () => {
    const provided = mounted();
    for (const [name, why] of DELIBERATELY_ABSENT) {
      assert.equal(provided.has(name), false,
        `${name} is now mounted. That was deliberate once — ${why} — so if it is meant now, `
        + "say so here and in the test that holds it absent.");
      assert.ok(why.length > 20, `${name} is exempt with no real reason`);
    }
  });

  test("the page still reads every deliberately absent name, or the exemption is stale", () => {
    /* An exemption for a name nobody asks for any more is dead weight, and
       dead weight is what makes a list like this stop being read. */
    const { names } = readByThePage();
    for (const name of DELIBERATELY_ABSENT.keys()) {
      assert.ok(names.has(name),
        `${name} is exempt here and the page no longer asks for it — delete the exemption`);
    }
  });
});
