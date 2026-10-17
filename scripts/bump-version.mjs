#!/usr/bin/env node
/**
 * The asset version is the content, not a date somebody remembered to type.
 *
 *   node scripts/bump-version.mjs          # write the version into index.html
 *   node scripts/bump-version.mjs --check  # say whether it is current; exit 1 if not
 *
 * index.html asks for app.js, mount.mjs and studio-enhancements.css with a
 * `?v=` query so that a browser cannot pair fresh markup with a stale script or
 * stylesheet. On 25 September that pairing made every new button do nothing.
 * The version used to be typed by hand, and a test only checked that the three
 * tags agreed with each other — so the next edit to app.js without a bump would
 * have shipped the same failure with every check green.
 *
 * Now the version is the first eight hex characters of a SHA-256 over the files
 * it protects, read in a fixed order with line endings normalised. Change any
 * of them and the version changes; forget to run this and
 * tests/security/design-system.test.mjs fails and prints the line to paste.
 *
 * The files under src/ are part of the hash even though they are not loaded with
 * a version of their own (docs/OPERATING.md says why that is an accepted risk).
 * Including them means a change anywhere in the engine still gives mount.mjs a
 * new URL, so the module graph's entry point is always the current one.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const DIRECT = ["app.js", "mount.mjs", "studio-enhancements.css"];
const TAG = /((?:src|href)="\/(?:app\.js|mount\.mjs|studio-enhancements\.css)\?v=)([A-Za-z0-9._-]+)(")/g;

function filesUnder(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) filesUnder(full, out);
    else out.push(full);
  }
  return out;
}

/** Every file the version protects, as repository-relative paths in a fixed order. */
export function protectedFiles(root = ROOT) {
  const engine = filesUnder(join(root, "src")).map((f) => relative(root, f).split(sep).join("/"));
  return [...DIRECT, ...engine.sort()];
}

/* Fewer files than this means the walk has stopped finding the engine, and a
   hash of nothing is a constant that would never go stale. */
const FLOOR = 20;

/** The version these files should be served under. */
export function computeVersion(root = ROOT) {
  const files = protectedFiles(root);
  if (files.length < FLOOR) {
    throw new Error(`The asset version covers only ${files.length} files; expected at least ${FLOOR}. `
      + "This check has stopped looking at the engine.");
  }
  const h = createHash("sha256");
  for (const rel of files) {
    // The path is hashed too, so moving a file is a change.
    h.update(rel + "\0");
    h.update(readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n"));
    h.update("\0");
  }
  return h.digest("hex").slice(0, 8);
}

/** The versions index.html currently asks for. */
export function statedVersions(root = ROOT) {
  const html = readFileSync(join(root, "index.html"), "utf8");
  return [...html.matchAll(TAG)].map((m) => m[2]);
}

function main() {
  const want = computeVersion();
  const have = statedVersions();
  if (have.length !== 3) {
    console.error(`Expected three versioned tags in index.html, found ${have.length}. Nothing written.`);
    process.exit(1);
  }
  const current = have.every((v) => v === want);

  if (process.argv.includes("--check")) {
    if (current) {
      console.log(`Asset version is current: ${want}`);
      return;
    }
    console.error(`Asset version is stale: index.html says ${[...new Set(have)].join(", ")}, the files say ${want}.`);
    console.error("Run: node scripts/bump-version.mjs");
    process.exit(1);
  }

  if (current) {
    console.log(`Already current: ${want}`);
    return;
  }
  const path = join(ROOT, "index.html");
  const html = readFileSync(path, "utf8").replace(TAG, `$1${want}$3`);
  writeFileSync(path, html);
  console.log(`index.html now asks for ?v=${want} on all three assets.`);
}

/* Run only when invoked directly, not when a test imports the functions above.
   Compared case-insensitively because Windows paths can differ only in case. */
const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) main();
