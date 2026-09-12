import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const lines = html.split(/\r?\n/);

/**
 * Every place the page writes a variable into HTML.
 *
 * The CSP still needs `unsafe-inline` for script-src, because 120+ inline event
 * handlers cannot be covered by a hash or a nonce. That weakens the CSP's
 * protection against injected script — which only matters if an injection point
 * exists. This file is what keeps that "if" true.
 *
 * An expression reaching innerHTML must either pass through an escaper, or be
 * on the allowlist below with a reason. Anything else fails, so a new
 * unescaped sink cannot appear quietly.
 */

const ESCAPERS = /^(ciEsc|attrEsc|esc|safeUrl|md|miBox|formatPercent|moneyToDecimalString|formatWeight|P|M|String)\(/;

/**
 * Interpolations that are safe because the value is not attacker-controlled.
 * Each entry names why. Adding to this list is a deliberate act.
 */
const ALLOWED = new Map([
  // Navigation and page chrome, from hardcoded arrays in this file.
  ["l", "nav label from the hardcoded LINKS array"],
  ['page===k?"on":""', "a CSS class chosen by an internal comparison"],
  ["elId", "an element id this code chose itself"],
  ["msgs[0]", "loader text from a hardcoded array"],
  ["etaHtml", "loader markup this code built"],

  // Academy pathway content, hardcoded in this file.
  ["p.lvl", "hardcoded academy pathway data"],
  ["p.t", "hardcoded academy pathway data"],
  ["p.d", "hardcoded academy pathway data"],
  ["p.time", "hardcoded academy pathway data"],
  ['p.lvl==="New"?\'style="color:var(--lime);border-color:var(--lime)"\':""', "internal style toggle"],
  ["p.tier?tierBars(p.tier):\"\"", "hardcoded tier, rendered by an internal helper"],
  ["p.roles?`<div class=\"acad-roles\"><span class=\"acad-roles-label\">Suitable for</span>${p.roles", "hardcoded academy roles"],

  // Blog metadata, hardcoded in this file.
  ["a.cat", "hardcoded blog category"],
  ["a.t", "hardcoded blog title"],
  ["a.mins", "hardcoded read time"],
  ["a.date||''", "hardcoded blog date"],
  ['a.date?a.date+" · ":""', "hardcoded blog date"],
  ["t", "hardcoded ticker string"],

  // Market Intelligence chrome. The model output inside these is escaped by
  // miBodyDark / miHlsDark / miBodyExport / miHlsExport before it gets here.
  ["g", "group name from a hardcoded array"],
  ["c", "country or commodity name from a hardcoded select"],
  ['c==="United Kingdom"?"selected":""', "internal select state"],
  ['AI_GROUPS.map(([g])=>`<button class="mi-pill${g===_aiGroup?" on":""', "hardcoded group buttons"],
  ['LIVE_GROUPS.map(([g])=>`<button class="mi-pill${g===_liveGroup?" on":""', "hardcoded group buttons"],
  ["MI.brief.at", "a timestamp this code generated"],
  ["MI.comm.at", "a timestamp this code generated"],
  ["MI.ai.at", "a timestamp this code generated"],
  ["MI.lab.at", "a timestamp this code generated"],
  ['tiles?`<div class="mi-indices">${tiles', "index tiles built from parsed numbers"],
  ["bodyHTML", "built by miBodyDark/miHlsDark, both of which escape"],
  ["extraTop", "markup this code built"],
  ["legend", "markup this code built"],
  ["reply", "model text already escaped by md() before assignment"],
]);

function interpolationsIntoHTML() {
  const out = [];
  lines.forEach((line, i) => {
    if (!/innerHTML|insertAdjacentHTML|document\.write/.test(line)) return;
    const exprs = [...line.matchAll(/\$\{([^}]{1,140})\}/g)].map((m) => m[1].trim());
    const concats = [...line.matchAll(/\+\s*([a-zA-Z_$][\w$.\[\]]*)\s*\+/g)].map((m) => m[1].trim());
    for (const e of [...exprs, ...concats]) {
      if (!e) continue;
      if (/^["'`]/.test(e)) continue;                       // string literals
      if (/^\d/.test(e)) continue;                           // numbers
      if (ESCAPERS.test(e)) continue;                        // escaped
      if (/^(i|j|k|n|idx|slug|id)$/.test(e)) continue;        // loop counters
      if (/\.(length|size|count|months|units|minor)$/.test(e)) continue;
      if (/^(Math|Number|JSON|Object|Array)\./.test(e)) continue;
      out.push({ line: i + 1, expr: e });
    }
  });
  return out;
}

describe("every HTML sink is accounted for", () => {
  test("no unescaped interpolation appears without a documented reason", () => {
    const found = interpolationsIntoHTML();
    const unknown = found.filter((f) => !ALLOWED.has(f.expr));
    const report = unknown.map((f) => `  index.html:${f.line}  ${f.expr}`).join("\n");
    assert.equal(
      unknown.length, 0,
      `New unescaped value(s) reaching innerHTML.\n${report}\n\n` +
      `Either pass it through ciEsc/attrEsc, or add it to ALLOWED with the reason it is safe.`
    );
  });

  test("the allowlist does not rot", () => {
    // An entry that no longer matches anything is a stale exemption.
    const present = new Set(interpolationsIntoHTML().map((f) => f.expr));
    const stale = [...ALLOWED.keys()].filter((k) => !present.has(k));
    assert.deepEqual(stale, [],
      "these allowlist entries no longer match any sink and should be deleted");
  });

  test("every allowlist entry states why it is safe", () => {
    for (const [expr, reason] of ALLOWED) {
      assert.ok(reason && reason.length > 10, `${expr} has no real justification`);
    }
  });
});

describe("the escapers that guard model output", () => {
  test("chat replies are escaped before any markup is added", () => {
    const md = html.match(/function md\(s\)\{[^\n]*/)[0];
    assert.match(md, /return esc\(s\)/, "md must escape first, then add markup");
    // The bold/heading substitutions run on already-escaped text.
    assert.ok(md.indexOf("esc(s)") < md.indexOf("<b>"), "escape precedes substitution");
  });

  test("every Market Intelligence renderer escapes its input", () => {
    for (const fn of ["miBodyDark", "miHlsDark", "miBodyExport", "miHlsExport", "ciBodyHTML", "ciRender"]) {
      const i = html.indexOf(`function ${fn}(`);
      assert.notEqual(i, -1, `${fn} should exist`);
      const body = html.slice(i, i + 2500);
      assert.match(body, /ciEsc\(|esc\(/, `${fn} renders model text without escaping it`);
    }
  });

  test("miBox escapes, since several renderers rely on it", () => {
    const box = html.match(/function miBox\(text\)\{[^\n]*/)[0];
    assert.match(box, /ciEsc\(ciClean\(text\)\)/);
  });
});

describe("the known CSP weakness is measured, not assumed away", () => {
  test("the inline-handler count is recorded so progress is visible", () => {
    const handlers = (html.match(/\son(click|input|change|load|error|submit)=/g) || []).length;
    // This is the number that must reach zero before script-src can drop
    // 'unsafe-inline'. It is asserted as a ceiling so it can only go down.
    assert.ok(handlers > 0, "if this is zero, remove unsafe-inline from the CSP and delete this test");
    assert.ok(handlers <= 140, `inline handlers have grown to ${handlers}; they should be shrinking, not rising`);
  });

  test("no new inline <script> blocks have appeared", () => {
    const inline = (html.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || [])
      .filter((t) => !/application\/ld\+json/.test(t));
    assert.ok(inline.length <= 2,
      `${inline.length} inline script blocks; each one is another thing that must move out before the CSP can tighten`);
  });
});
