/**
 * The page as the browser ends up with it.
 *
 * The application used to be 500KB of inline `<script>` inside index.html, so
 * twenty-five test files read index.html and found everything in it. It is two
 * external files now — the step that lets the page drop `unsafe-inline` — and
 * those tests are still asking the right question: what does this page
 * execute?
 *
 * So this puts the scripts back where they came from and hands over the whole
 * thing. It is not a convenience: a test that read only index.html would now
 * pass while asserting nothing, which is the worst failure a test has.
 */

import { readFileSync, existsSync } from "node:fs";

/** Where each external script is spliced back in. */
const SCRIPTS = Object.freeze([
  { tag: '<script src="/app.js"></script>', file: "app.js", open: "<script>", close: "</script>" },
  { tag: '<script type="module" src="/mount.mjs"></script>', file: "mount.mjs", open: '<script type="module">', close: "</script>" },
]);

let cached = null;

/**
 * index.html with app.js and mount.mjs inlined at their own positions.
 *
 * Raises rather than returning a partial page. A missing script would make
 * every assertion about the application quietly vacuous.
 */
export function pageSource() {
  if (cached) return cached;
  let html = readFileSync("index.html", "utf8");

  for (const s of SCRIPTS) {
    if (!html.includes(s.tag)) {
      throw new Error(
        `index.html does not load ${s.file} the way this helper expects (${s.tag}). ` +
        `If the page changed how it loads its scripts, change this too — do not let it read ` +
        `a page with no application in it.`);
    }
    if (!existsSync(s.file)) throw new Error(`${s.file} is missing`);
    html = html.replace(s.tag, `${s.open}\n${readFileSync(s.file, "utf8")}\n${s.close}`);
  }

  cached = html;
  return html;
}

/** The markup alone, for assertions that are genuinely about the document. */
export function markupOnly() {
  return readFileSync("index.html", "utf8");
}

/**
 * One named function's source, read forward so the slice cannot run backwards.
 *
 * Seven test files had their own copy of this, and the reason it is worth
 * sharing is the bug it prevents: `indexOf` from the end finds the wrong
 * brace, and a backwards slice returns an empty string that matches nothing
 * and fails nothing.
 */
export function fnSource(name, source = pageSource()) {
  let start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in the page`);

  /* Take the `async` with it. Slicing from `function` drops the keyword, and
     the extracted source then fails to parse the moment it contains an await —
     with a syntax error that points at the await rather than at the missing
     keyword, which is a confusing half-hour. */
  if (source.slice(Math.max(0, start - 6), start) === "async ") start -= 6;

  /* Forward, so the slice cannot run backwards: indexOf from the end finds the
     wrong brace, and a backwards slice returns an empty string that matches
     nothing and fails nothing. Both declaration forms end it. */
  const plain = source.indexOf("\nfunction ", start + 1);
  const asyncNext = source.indexOf("\nasync function ", start + 1);
  const end = plain < 0 ? asyncNext : asyncNext < 0 ? plain : Math.min(plain, asyncNext);
  return source.slice(start, end < 0 ? source.length : end);
}
