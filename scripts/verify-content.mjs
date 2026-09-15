#!/usr/bin/env node
/**
 * Prohibited-content verification for the BuyrWorld non-commercial demonstration.
 *
 * Fails the build if commercial or personally identifying content reappears in
 * anything that ships. Deliberately does NOT flag legitimate procurement
 * vocabulary — supplier price, should-cost, cost drivers, savings and spend
 * analysis are the subject matter of this project, not violations.
 *
 * Usage:  node scripts/verify-content.mjs
 * Exit:   0 = clean, 1 = violations found
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = process.cwd();
// Development-only directories. These are excluded from deployment by
// .vercelignore, and they legitimately name retired vendors inside assertions
// that those vendors are ABSENT — scanning them would flag the very tests that
// prove the removal held.
const SKIP_DIRS = new Set([
  ".git", "node_modules", "scripts", "docs", "tests", "September 2026 Progress",
]);
const TEXT_EXT = new Set([".html", ".js", ".mjs", ".css", ".json", ".txt", ".xml", ".md", ".webmanifest", ".svg"]);

/** Phrases that are legitimate precisely because they are denials. */
const ALLOWED = [
  "no waitlist and no contact form",
  "No payment processor, form handler or analytics provider is used",
  "Nothing on this site is offered for sale",
  "no services are offered",
  "not accepting commercial work",
  "no advisory, consulting or template services are offered",
];

const RULES = [
  // --- personal identity ---
  { id: "personal-name",   re: /\bjosh(ua)?\b/gi,                       why: "personal first name" },
  { id: "personal-surname",re: /\bfrost\b/gi,                            why: "personal surname" },
  { id: "founder",         re: /\bfounder(s|-led)?\b/gi,                 why: "founder identity framing" },
  { id: "personal-photo",  re: /founder\.jpg|headshot|portrait\.(jpg|png)/gi, why: "personal photograph" },
  { id: "personal-email",  re: /[a-z0-9._%+-]+@(gmail|outlook|hotmail|yahoo|icloud)\.[a-z]{2,}/gi, why: "personal email address" },

  // --- payments and commerce ---
  { id: "stripe",          re: /stripe/gi,                               why: "payment processor" },
  { id: "payment-url",     re: /buy\.stripe\.com|paypal\.me|checkout\.[a-z]+\.com/gi, why: "payment link" },
  { id: "checkout",        re: /\bcheckout\b/gi,                         why: "checkout flow" },
  { id: "buy-now",         re: /\bbuy now\b|>\s*Buy\s*[£$€]|onclick="buy\(/gi, why: "purchase call to action" },
  { id: "subscription",    re: /[£$€]\s?\d+(\.\d{1,2})?\s*(\/|per\s)\s*(mo|month|yr|year)/gi, why: "subscription price" },
  { id: "plan-tier",       re: /\bpro membership\b|\bpremium plan\b|\bfree tier\b|\bupgrade to pro\b/gi, why: "sales tier" },

  // --- lead generation and services ---
  { id: "consultation",    re: /book a consultation|paid consultation|enquire about advisory|advisory enquiry/gi, why: "consulting offer" },
  { id: "sales-enquiry",   re: /sales enquiry|sales inquiry/gi,          why: "sales lead capture" },
  { id: "waitlist",        re: /\bwaitlist\b/gi,                         why: "waitlist capture" },
  { id: "form-handler",    re: /formspree\.io/gi,                        why: "third-party form handler" },
  { id: "analytics",       re: /plausible\.io|googletagmanager|google-analytics|gtag\(/gi, why: "commercial analytics" },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function allowed(line) {
  return ALLOWED.some((a) => line.toLowerCase().includes(a.toLowerCase()));
}

const files = walk(ROOT);
const violations = [];
let scanned = 0;

for (const file of files) {
  const rel = relative(ROOT, file).split("\\").join("/");
  const ext = extname(file).toLowerCase();

  // Binary assets: the filename itself must not carry identity.
  if (!TEXT_EXT.has(ext)) {
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      if (rule.re.test(rel)) violations.push({ rel, line: 0, rule, text: rel });
    }
    continue;
  }

  scanned++;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (allowed(line)) return;
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      const m = rule.re.exec(line);
      if (m) {
        const at = Math.max(0, m.index - 45);
        violations.push({ rel, line: i + 1, rule, text: line.slice(at, m.index + 75).trim() });
      }
    }
  });
}

console.log(`Scanned ${scanned} text files and ${files.length - scanned} binary assets.\n`);

/* A scan that scanned nothing finds nothing, and "no prohibited content
   found" is then true and meaningless. The tree has had more than forty text
   files for the life of this script; a number below twenty means the walk or
   the extension list broke, not that the repository shrank. */
const FLOOR = 20;
if (scanned < FLOOR) {
  console.log(`FAIL — only ${scanned} text file(s) were scanned. This check has stopped looking.`);
  process.exit(1);
}
if (RULES.length === 0) {
  console.log("FAIL — no rules to check against. This check has stopped looking.");
  process.exit(1);
}

if (violations.length === 0) {
  console.log("PASS — no prohibited commercial or personal content found.");
  process.exit(0);
}

const byRule = new Map();
for (const v of violations) byRule.set(v.rule.id, [...(byRule.get(v.rule.id) || []), v]);

console.log(`FAIL — ${violations.length} finding(s) across ${byRule.size} rule(s):\n`);
for (const [id, list] of byRule) {
  console.log(`  [${id}] ${list[0].rule.why} — ${list.length} hit(s)`);
  for (const v of list.slice(0, 5)) console.log(`     ${v.rel}:${v.line}  …${v.text}…`);
  if (list.length > 5) console.log(`     … and ${list.length - 5} more`);
  console.log();
}
process.exit(1);
