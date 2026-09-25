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
/**
 * The tags to replace, matched by pattern rather than by exact string.
 *
 * Each src carries a cache-busting version — `/app.js?v=…` — because the page
 * and its scripts are separate requests with separate cache entries, and fresh
 * markup against a stale script leaves every control the markup names doing
 * nothing. Matching the literal tag would break on every version bump.
 */
const SCRIPTS = Object.freeze([
  { tag: /<script src="\/app\.js(\?[^"]*)?"><\/script>/, file: "app.js",
    open: "<script>", close: "</script>" },
  { tag: /<script type="module" src="\/mount\.mjs(\?[^"]*)?"><\/script>/, file: "mount.mjs",
    open: '<script type="module">', close: "</script>" },
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
    if (!s.tag.test(html)) {
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

/**
 * Every function the case view draws itself with, and the state they share.
 *
 * Four test files build the case view in a `vm` context, and each one used to
 * carry its own list of function names. Three times in two days a new block on
 * the case — the what-ifs, the chain, the call — turned every other file's
 * twenty-nine passing tests into twenty-nine ReferenceErrors, because the
 * renderer called something that file had never heard of.
 *
 * So the list lives here, beside the thing that extracts it. A file that wants
 * the case view gets all of it; what each one leaves out of its `window.BW` is
 * still its own business, and leaving a module out is how those files check
 * that a block stays silent without it.
 */
export function caseViewSource(app = pageSource()) {
  const fns = [
    "caseClear", "caseLabelFor", "caseNarrative", "caseRender",
    "caseControlsHTML", "caseSectionHTML", "caseClaimHTML", "caseIsAssumption",
    "caseFigureText", "caseFootHTML", "caseSetRole", "caseSetDepth", "caseConfirm",
    "caseBriefHTML", "caseBriefTitle", "caseCopyBrief",
    "caseSpecialistsHTML", "caseNegotiationPlan",
    "caseSceneHTML", "caseSceneAttentionHTML", "caseSceneStageHTML", "caseSceneQuestionHTML",
    "whatIfBase", "whatIfHTML", "whatIfPanelHTML", "whatIfWorkedHTML", "whatIfAxesHTML",
    "whatIfAdoptHTML", "whatIfAdoptedHTML", "whatIfOpen", "whatIfSet", "whatIfWork",
    "whatIfAdopt", "whatIfClear",
    "callHTML", "callBeforeHTML", "callListHTML", "callDuringHTML", "callSpeech",
    "callAfterHTML", "callItemHTML", "callOpen", "callUnresolved", "callSetGoal",
    "callSetQuestion", "callNoteKey", "callAddNote", "callReadNotes", "callDecide",
    "callConfirm", "callUnknown", "callReject", "callCopyFollowUp", "callSave", "callClear",
    "practiceHTML", "practiceSetupHTML", "practiceSessionHTML", "practiceMovesHTML",
    "practiceFeedbackHTML", "practiceStart", "practiceStartFromCase", "practiceBegin",
    "practiceSaid", "practiceSay", "practiceFinish", "practiceAgain", "practiceClear",
  ];

  return [
    "var _caseRole=null; var _caseDepth=null;",
    "var _caseConfirmed=Object.create(null);",
    "var _whatIfKind=null; var _whatIfInputs=Object.create(null);",
    "var _whatIfWorked=Object.create(null); var _whatIfAdopted=[];",
    "var _callSheet=null; var _callNotes=[]; var _callItems=null;",
    "var _callScreen=null; var _callId=null; var _callSpeech=null;",
    'var _practice=null; var _practiceSaid="";',
    'var CALL_BY = "this browser";',
    ...fns.map((name) => fnSource(name, app)),
  ].join("\n");
}
