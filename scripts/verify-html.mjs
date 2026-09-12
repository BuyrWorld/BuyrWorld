#!/usr/bin/env node
/**
 * index.html integrity checks.
 *
 * The application lives in one large, fragile HTML file with no build step, so
 * these are the checks that would otherwise only fail in a browser: a single
 * unclosed div silently breaks a whole page section, and a nav link to a
 * deleted page throws on click.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { Script } from "node:vm";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "bw-verify-"));

/** ES modules legally contain `import`, which the classic parser rejects. */
function checkModuleSyntax(code, label) {
  const file = join(scratch, `block-${label}.mjs`);
  writeFileSync(file, code);
  const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  return r.status === 0 ? null : (r.stderr || "").split("\n").find((l) => l.includes("Error")) || "syntax error";
}

const html = readFileSync("index.html", "utf8");
const problems = [];

/* --- 1. Every inline script must parse --- */
let blocks = 0;
const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
let m;
while ((m = re.exec(html))) {
  const attrs = m[1] || "";
  if (/\bsrc=/i.test(attrs)) continue;                       // external
  const type = (attrs.match(/type=["']([^"']+)["']/i) || [])[1];
  if (type && !/javascript|module/i.test(type)) continue;     // ld+json etc.
  blocks++;
  const line = html.slice(0, m.index).split("\n").length;
  if (/module/i.test(type || "")) {
    const err = checkModuleSyntax(m[2], String(blocks));
    if (err) problems.push(`inline module at line ~${line} does not parse: ${err}`);
  } else {
    try {
      new Script(m[2]);
    } catch (e) {
      problems.push(`inline script at line ~${line} does not parse: ${e.message}`);
    }
  }
}
rmSync(scratch, { recursive: true, force: true });

/* --- 2. div balance --- */
const open = (html.match(/<div/g) || []).length;
const close = (html.match(/<\/div>/g) || []).length;
if (open !== close) problems.push(`div imbalance: ${open} open vs ${close} close`);

/* --- 3. Every navigation target must resolve to a real page --- */
const pages = new Set([...html.matchAll(/id="page-([a-z0-9-]+)"/g)].map((x) => x[1]));
const linksDecl = (html.match(/const LINKS=\[[\s\S]*?\]\];/) || [""])[0];
const navTargets = [...linksDecl.matchAll(/\["([a-z0-9-]+)"/g)].map((x) => x[1]);
const goTargets = [...new Set([...html.matchAll(/go\('([a-z0-9-]+)'\)/g)].map((x) => x[1]))];

for (const t of navTargets) if (!pages.has(t)) problems.push(`nav link "${t}" has no page section`);
for (const t of goTargets) if (!pages.has(t)) problems.push(`go('${t}') has no page section`);

/* --- 4. Nothing should reference a deleted asset --- */
for (const asset of ["founder.jpg", "buyrworld-phase2.zip", "api/logs"]) {
  if (html.includes(asset)) problems.push(`reference to removed asset: ${asset}`);
}

console.log(
  `Checked ${blocks} inline script block(s), ${open} divs, ` +
  `${navTargets.length} nav targets, ${goTargets.length} go() targets, ${pages.size} pages.`
);

if (problems.length === 0) {
  console.log("PASS — index.html is structurally sound.");
  process.exit(0);
}
console.log(`FAIL — ${problems.length} problem(s):`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(1);
