#!/usr/bin/env node
/**
 * index.html integrity checks.
 *
 * The application lives in one large, fragile HTML file with no build step, so
 * these are the checks that would otherwise only fail in a browser: a single
 * unclosed div silently breaks a whole page section, and a nav link to a
 * deleted page throws on click.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
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

/* The application lives in its own files now, so the page can drop
   unsafe-inline. Everything below that used to read the inline script reads
   both instead.

   This is not tidying. When the scripts moved out, this check went from
   scanning two blocks and eleven navigation targets to scanning zero of each
   — and went on reporting that the page was structurally sound. A check that
   has stopped looking has to fail, not pass, which is what the two guards at
   the bottom are for. */
const EXTERNAL = ["app.js", "mount.mjs"];
for (const file of EXTERNAL) {
  if (!existsSync(file)) problems.push(`index.html loads ${file}, which is not here`);
  else if (!html.includes(`src="/${file}"`)) problems.push(`${file} exists but index.html does not load it`);
}
/* Markup plus the code it loads: what the browser ends up with. */
const page = html + "\n" + EXTERNAL.filter(existsSync).map((file) => readFileSync(file, "utf8")).join("\n");

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
for (const file of EXTERNAL.filter(existsSync)) {
  const src = readFileSync(file, "utf8");
  blocks++;
  if (file.endsWith(".mjs")) {
    const err = checkModuleSyntax(src, file.replace(/\W/g, "_"));
    if (err) problems.push(`${file} does not parse: ${err}`);
  } else {
    try {
      new Script(src);
    } catch (e) {
      problems.push(`${file} does not parse: ${e.message}`);
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
const linksDecl = (page.match(/const LINKS=\[[\s\S]*?\]\];/) || [""])[0];
const navTargets = [...linksDecl.matchAll(/\["([a-z0-9-]+)"/g)].map((x) => x[1]);
const goTargets = [...new Set([...page.matchAll(/go\('([a-z0-9-]+)'\)/g)].map((x) => x[1]))];

for (const t of navTargets) if (!pages.has(t)) problems.push(`nav link "${t}" has no page section`);
for (const t of goTargets) if (!pages.has(t)) problems.push(`go('${t}') has no page section`);

/* --- 4. Nothing should reference a deleted asset --- */
for (const asset of ["founder.jpg", "buyrworld-phase2.zip", "api/logs"]) {
  if (page.includes(asset)) problems.push(`reference to removed asset: ${asset}`);
}

if (blocks === 0) problems.push("no script was checked at all — this check has stopped looking");
if (navTargets.length === 0) problems.push("no navigation target was found — this check has stopped looking");

console.log(
  `Checked ${blocks} script(s), ${open} divs, ` +
  `${navTargets.length} nav targets, ${goTargets.length} go() targets, ${pages.size} pages.`
);

if (problems.length === 0) {
  console.log("PASS — index.html is structurally sound.");
  process.exit(0);
}
console.log(`FAIL — ${problems.length} problem(s):`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(1);
