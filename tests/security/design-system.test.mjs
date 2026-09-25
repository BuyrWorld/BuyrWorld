/**
 * The design system, checked rather than eyeballed.
 *
 * Visual Phase 1 introduced a token layer alongside 1,382 inline style
 * attributes. It could only be additive: nothing existing was removed, and the
 * original seven variables became aliases so every one of those call sites
 * keeps working and moves with the new palette.
 *
 * These tests hold that arrangement in place. The failure they exist to catch
 * is drift — a new primitive hardcoding a colour, a spacing value invented for
 * one feature, or a status chip that signals by colour alone.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { pageSource } from "../helpers/page.mjs";

const html = pageSource();
/** The page's own stylesheet: the rest of the file is markup and script. */
const pageCss = html.slice(html.indexOf(":root{"), html.indexOf("</style>"));
/**
 * Every rule the browser applies, wherever it is written.
 *
 * The studio's rules moved into their own file to keep index.html small, and
 * a ratchet that only reads the inline block would have quietly stopped
 * covering them — which would make "move it to a stylesheet" the way round
 * every rule below. The separate file was already served and already
 * unchecked before that move; this closes both gaps at once.
 *
 * Token *definitions* are still asserted against the inline block alone.
 * There is one :root, and it is there.
 */
const css = pageCss + "\n" + readFileSync("studio-enhancements.css", "utf8");

describe("the token layer", () => {
  test("every surface, ink and semantic colour is defined", () => {
    for (const name of [
      "bw-bg", "bw-sidebar", "bw-surface", "bw-surface-2", "bw-border", "bw-border-strong",
      "bw-text", "bw-muted", "bw-subtle",
      "bw-accent", "bw-accent-ink", "bw-accent-soft",
      "bw-danger", "bw-warning", "bw-success",
    ]) {
      assert.match(pageCss, new RegExp(`--${name}\\s*:`), `--${name} is missing`);
    }
  });

  test("one spacing scale exists, rather than one per feature", () => {
    for (const step of ["bw-1", "bw-2", "bw-3", "bw-4", "bw-5", "bw-6", "bw-8"]) {
      assert.match(pageCss, new RegExp(`--${step}\\s*:`), `--${step} is missing`);
    }
  });

  test("a type scale for the workspace exists", () => {
    for (const t of ["bw-t-page", "bw-t-panel", "bw-t-metric", "bw-t-body", "bw-t-meta"]) {
      assert.match(pageCss, new RegExp(`--${t}\\s*:`));
    }
  });

  test("nothing existing was deleted to make room", () => {
    // The old names must survive: removing them would break 1,382 call sites.
    for (const old of ["bg", "panel", "panel2", "line", "text", "muted", "lime"]) {
      assert.match(pageCss, new RegExp(`--${old}\\s*:`), `--${old} was removed`);
    }
  });

  test("every token the code asks for is one that exists", () => {
    /* A var() naming nothing does not fall back — it makes the whole
       declaration invalid and the browser drops it, with no error anywhere.
       Seven names were being used this way across forty-nine declarations:
       --bw-line, --bw-line-strong, --bw-panel, --bw-raised, --bw-lime,
       --bw-r-1 and --bw-r-2. Borders that never drew and radii that stayed
       square, in code that read as though it had styled them.
       Markup and script are included deliberately: most of this page's
       styling is written in inline style attributes built by app.js. */
    const sources = html + readFileSync("app.js", "utf8")
      + readFileSync("studio-enhancements.css", "utf8");
    const defined = new Set(
      [...sources.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
    const used = new Set(
      [...sources.matchAll(/var\(\s*(--[a-z0-9-]+)\s*[,)]/gi)].map((m) => m[1]));

    const undefinedTokens = [...used].filter((name) => !defined.has(name));
    assert.deepEqual(undefinedTokens, [],
      `these are used and never defined, so every declaration using them is `
      + `silently dropped:\n  ${undefinedTokens.join("\n  ")}`);
  });
});

describe("the primitives", () => {
  const CLASSES = [
    "bw-panel", "bw-panel-head", "bw-panel-title",
    "bw-metric", "bw-metric-label", "bw-metric-value", "bw-metric-sub",
    "bw-status", "bw-act", "bw-act-primary", "bw-act-secondary", "bw-act-text",
    "bw-table", "bw-list-row", "bw-grid",
  ];

  test("each shared class is defined once, as a class", () => {
    for (const c of CLASSES) {
      assert.match(css, new RegExp(`\\.${c}[,{: ]`), `.${c} is not defined`);
    }
  });

  test("primitives take their colours from tokens, never from literals", () => {
    // A hardcoded hex in a shared class is how a palette stops being one.
    const blocks = [...css.matchAll(/\.(bw-[a-z0-9-]+)[^{]*\{([^}]*)\}/g)];
    assert.ok(blocks.length >= 15, `expected the primitives, found ${blocks.length}`);
    const offenders = [];
    for (const [, name, body] of blocks) {
      // rgba() is allowed: soft fills and hairlines need alpha, which a hex token cannot carry.
      const hex = body.match(/#[0-9a-fA-F]{3,8}/g) || [];
      if (hex.length) offenders.push(`.${name} hardcodes ${hex.join(", ")}`);
    }
    assert.deepEqual(offenders, [], `colours must come from tokens:\n  ${offenders.join("\n  ")}`);
  });

  test("spacing in the primitives comes from the scale", () => {
    const blocks = [...css.matchAll(/\.(bw-panel|bw-metric-grid|bw-grid)[^{]*\{([^}]*)\}/g)];
    for (const [, name, body] of blocks) {
      const raw = (body.match(/(?:padding|gap|margin)\s*:\s*([^;]+)/g) || []).join(" ");
      assert.equal(/\d+px/.test(raw), false, `.${name} invents a spacing value instead of using the scale`);
    }
  });
});

describe("status never depends on colour alone", () => {
  test("every chip carries a dot as well as its text", () => {
    assert.match(css, /\.bw-status::before\{content:""/,
      "a chip must have a non-colour marker; its label carries the meaning");
  });

  test("the variants a procurement reader needs all exist", () => {
    for (const v of ["live", "approved", "evidenced", "review", "medium", "derived", "high", "assumed", "supplied", "low"]) {
      assert.match(css, new RegExp(`\\.bw-status--${v}`), `--${v} chip is missing`);
    }
  });

  test("provenance states are covered, since they are load-bearing elsewhere", () => {
    // supplied / derived / assumed are already a first-class concept in the
    // calculation layer; the chips must be able to express them.
    for (const v of ["supplied", "derived", "assumed"]) {
      assert.match(css, new RegExp(`\\.bw-status--${v}`));
    }
  });
});

describe("the action system is small", () => {
  test("four kinds, not one per tool", () => {
    const kinds = [...css.matchAll(/\.bw-act-([a-z]+)\{/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(kinds)].sort(), ["danger", "primary", "secondary", "text"]);
  });

  test("the primary action puts dark text on the accent", () => {
    assert.match(css, /\.bw-act-primary\{background:var\(--bw-accent\);color:var\(--bw-accent-ink\)\}/);
  });

  test("a disabled action looks disabled", () => {
    assert.match(css, /\.bw-act\[disabled\]/);
  });

  test("focus is visible on the new controls too", () => {
    assert.match(css, /\.bw-act:focus-visible[^{]*\{outline:3px solid/);
  });
});

describe("layout degrades rather than shrinking until unreadable", () => {
  test("the grids collapse at stated widths", () => {
    assert.match(css, /@media\(max-width:1100px\)/);
    assert.match(css, /@media\(max-width:760px\)/);
  });

  test("three columns become two, then one", () => {
    /* Every block at each width, joined, rather than the first one. There is
       more than one @media(max-width:760px) in the sheet now that the Studio
       has its own, and matching only the first made this assert against
       whichever happened to be written earliest — it broke the moment a rule
       was inserted above it, which is a test that depends on source order
       rather than on the rule it cares about. */
    const at = (w) => [...css.matchAll(new RegExp(`@media\\(max-width:${w}px\\)\\{([^@]*)\\}`, "g"))]
      .map((m) => m[1]).join("\n");

    assert.match(at(1100), /\.bw-grid-3\{grid-template-columns:repeat\(2/);
    assert.match(at(760), /\.bw-grid-2,\.bw-grid-3\{grid-template-columns:minmax\(0,1fr\)\}/);
  });

  test("a wide table scrolls inside its own box", () => {
    // The rule the exported documents already follow: the page body must never
    // scroll sideways because one table is too wide.
    assert.match(css, /\.bw-table-wrap\{overflow-x:auto/);
  });
});

describe("Phase 1 changed nothing but the paint", () => {
  test("no inline handlers were added", () => {
    const handlers = (html.match(/\son(click|input|change|load|error|submit)=/g) || []).length;
    assert.ok(handlers <= 132, `inline handlers rose to ${handlers}`);
  });

  test("the existing card and button classes are untouched", () => {
    // Screens migrate onto the primitives one at a time; nothing was restyled
    // underneath a working feature.
    assert.match(css, /\.card\{/);
    assert.match(css, /\.btn\{/);
  });

  test("every route still exists", () => {
    for (const id of ["page-home", "page-inbox", "page-tool-defender", "page-spend", "page-market"]) {
      assert.match(html, new RegExp(`id="${id}"`), `${id} disappeared`);
    }
  });
});

describe("the application shell", () => {
  test("the sidebar exists, is labelled, and sits between the header and main", () => {
    assert.match(html, /<aside class="bw-side" id="bw-side" aria-label="Sections">/);
    assert.ok(html.indexOf('id="bw-side"') > html.indexOf("</header>"));
    assert.ok(html.indexOf('id="bw-side"') < html.indexOf('<main id="main"'));
  });

  test("the skip link still precedes main, and every page is still inside it", () => {
    // The shell is CSS, not a DOM restructure, precisely so these hold.
    assert.ok(html.indexOf('class="skip-link"') < html.indexOf('<main id="main"'));
    const mainStart = html.indexOf('<main id="main"');
    const mainEnd = html.indexOf("</main>");
    for (const m of html.matchAll(/<div class="page[^"]*" id="page-/g)) {
      assert.ok(m.index > mainStart && m.index < mainEnd, "a page escaped the main landmark");
    }
  });

  test("it appears only where there is room, and the top bar yields to it entirely", () => {
    assert.match(css, /\.bw-side\{display:none\}/, "narrow screens keep the existing mobile menu untouched");
    const desktop = css.slice(css.indexOf("@media(min-width:1080px){"));
    // The bar held a nav already hidden as a duplicate and a second copy of
    // the wordmark the sidebar now carries. Nothing was left in it to show.
    assert.match(desktop, /header\{display:none\}/, "a bar containing only a duplicate logo still costs 57px");
    assert.match(desktop, /main\{padding-left:236px\}/);
    assert.match(desktop, /footer\{padding-left:236px\}/);
  });

  test("the active destination is marked for a screen reader, not only in colour", () => {
    assert.match(html, /aria-current="page"/);
    assert.match(css, /\.bw-side-link\[aria-current="page"\]/);
    assert.match(css, /\.bw-side-link\[aria-current="page"\]::before\{content:""/,
      "the active marker is a rule, so it survives a colour-blind reading");
  });

  test("keyboard focus is visible on a sidebar link", () => {
    assert.match(css, /\.bw-side-link:focus-visible\{outline:3px solid/);
  });

  test("the nav is built from LINKS, so it cannot advertise a route that does not exist", () => {
    const render = html.slice(html.indexOf("function renderNav()"), html.indexOf("document.addEventListener(\"click\""));
    assert.match(render, /side\.innerHTML=/);
    // The sidebar groups the destinations rather than listing them, so it no
    // longer maps LINKS directly. LINKS is still the one source of truth:
    // the grouping may only rearrange what is already there.
    assert.match(render, /LINKS\.map/, "the top nav still derives from LINKS");
    assert.match(render, /labels\[x\[0\]\]=x\[1\]/, "the sidebar takes its labels from LINKS too");

    const keys = [...html.match(/const LINKS=\[(.*?)\];/s)[1].matchAll(/\["([a-z-]+)",/g)].map((m) => m[1]);
    const grouped = [...html.match(/const NAV_GROUPS=\[(.*?)\n\];/s)[1].matchAll(/"([a-z-]+)"/g)]
      .map((m) => m[1]);
    assert.deepEqual([...grouped].sort(), [...keys].sort(),
      "the sidebar groups reach every destination exactly once, and invent none");
  });

  test("every destination in LINKS has an icon", () => {
    const links = html.match(/const LINKS=\[(.*?)\];/s)[1];
    const keys = [...links.matchAll(/\["([a-z-]+)",/g)].map((m) => m[1]);
    assert.ok(keys.length >= 8);
    const icons = html.slice(html.indexOf("const NAV_ICONS={"), html.indexOf("function navIcon"));
    for (const k of keys) {
      // A plain substring, not a constructed regex: escaping a key into one is
      // a needless way to get this wrong, and it went wrong here first time.
      assert.ok(icons.includes(`\n  ${k}:`), `${k} has no icon, so the sidebar would fall back`);
    }
  });

  test("all three navigations are delegated, taking handlers down rather than up", () => {
    const render = html.slice(html.indexOf("function renderNav()"), html.indexOf('document.addEventListener("click"'));
    assert.equal(/onclick=/.test(render), false, "a nine-item sidebar must not add nine handlers");
    assert.match(html, /document\.addEventListener\("click",function\(e\)\{[\s\S]{0,200}closest\("\[data-go\]"\)/);
  });

  test("nav labels are escaped, which they were not before", () => {
    const render = html.slice(html.indexOf("function renderNav()"), html.indexOf('document.addEventListener("click"'));
    assert.match(render, /ciEsc\(l\)/);
  });

  test("the sidebar says the data is synthetic", () => {
    assert.match(html, /Synthetic demonstration data throughout/);
  });

  test("no decorative control was invented", () => {
    // The reference has a search field and a status light. Neither has anything
    // behind it here yet, and the north star forbids non-functional controls.
    const side = html.slice(html.indexOf('id="bw-side"'), html.indexOf('<main id="main"'));
    assert.equal(/input|search/i.test(side), false, "a search box that searches nothing is decoration");
  });
});

describe("form fields use the primitive", () => {
  test("the repeated label is a class, not typed out 25 times", () => {
    assert.match(css, /\.bw-field\{display:block;font-size:var\(--bw-t-meta\);color:var\(--bw-muted\)\}/);
    assert.equal(/<label style="font-size:12px;color:var\(--muted\)">/.test(html), false,
      "the hand-typed field label should be gone");
  });

  test("one field grid serves every form", () => {
    // Three of these differed only by a minmax value picked by eye — 120, 130,
    // 140 — which is the "different spacing per feature" the north star warns of.
    assert.match(css, /\.bw-fields\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(128px,1fr\)\)/);
    assert.equal(/grid-template-columns:repeat\(auto-fit,minmax\(1[234]0px,1fr\)\);gap:10px/.test(html), false,
      "the hand-typed field grids should be gone");
  });

  test("every migrated field kept its input and its accessible name", () => {
    // 25 labels changed at once; a silent break here would be a form that looks
    // right and cannot be filled in.
    const page = html.slice(html.indexOf('id="page-tool-defender"'), html.indexOf('id="page-tool-sim"'));
    const wired = [...page.matchAll(/<label class="bw-field">([^<]*)<(input|select|textarea)[^>]*id="([a-z0-9-]+)"/g)];
    assert.equal(wired.length, (page.match(/<label class="bw-field">/g) || []).length,
      "a label lost its control");
    assert.ok(wired.length >= 20, `expected the claim form's fields, found ${wired.length}`);
    for (const [whole, text] of wired) {
      assert.ok(/aria-label=/.test(whole) || text.trim().length > 2,
        `a field has neither a visible label nor an aria-label: ${whole.slice(0, 70)}`);
    }
  });

  test("the input reset still restores a focus ring", () => {
    // .bwin removes the outline; the field primitive must not have hidden that.
    assert.match(css, /input\.bwin:focus-visible[^{]*\{[^}]*outline:3px solid/);
  });
});

describe("article prose was migrated without losing an article", () => {
  test("all fifteen articles are still there", () => {
    // CLAUDE.md: greedy matches have eaten neighbouring articles in this file
    // before. This is the count that would reveal it.
    assert.equal((html.match(/\{t:"/g) || []).length, 15);
  });

  test("each article still has a title, a category and a body", () => {
    const block = html.slice(html.indexOf("const ARTICLES=["), html.indexOf("\nconst BLOG_CATS=["));
    for (const field of ["t:", "cat:", "mins:", "body:"]) {
      const n = (block.match(new RegExp(field.replace(":", "\s*:"), "g")) || []).length;
      assert.ok(n >= 15, `only ${n} articles carry ${field}`);
    }
  });

  test("the body container styles its own prose", () => {
    assert.match(html, /<div id="blog-body" class="bw-prose">/);
    assert.match(css, /\.bw-prose\{font-size:15px;line-height:1\.75;color:var\(--bw-body\)\}/);
    assert.match(css, /\.bw-prose > p\{margin-bottom:var\(--bw-4\)\}/);
  });

  test("the per-paragraph styling is gone", () => {
    assert.equal(/style="color:#CFCFCF;font-size:15px;line-height:1\.75;margin-bottom:16px"/.test(html), false,
      "49 paragraphs carrying the same four declarations");
    assert.equal(/style="font-size:18px;margin:22px 0 10px"/.test(html), false);
  });

  test("the repeated in-article row is a component", () => {
    assert.match(css, /\.bw-figrow\{display:flex/);
    for (const c of ["bw-figrow-t", "bw-figrow-d", "bw-figrow-n"]) {
      assert.match(css, new RegExp(`\.${c}\{`), `.${c} is missing`);
      assert.ok(html.includes(`class="${c}"`), `.${c} is defined but unused`);
    }
  });

  test("body copy is a token now, not a literal repeated everywhere", () => {
    assert.match(css, /--bw-body\s*:\s*#CFCFCF/);
  });
});

describe("tables use the shared one", () => {
  test("only the export glossary styles its own table", () => {
    // Each hand-rolled table had its own header size — 10.5px here, 11px there
    // — and its own cell padding. That drift is what a shared table prevents.
    const left = [...html.matchAll(/<table style="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(left.length, 1, `hand-styled tables remaining:\n  ${left.join("\n  ")}`);
    // miGlossTable renders into the exported document, which is a light page.
    // The application's dark table would be invisible on paper.
    assert.match(left[0], /border-collapse:collapse;width:100%;margin:4px 0 10px/);
  });

  test("the application's tables all use the primitive", () => {
    assert.ok((html.match(/class="bw-table"/g) || []).length >= 8);
    assert.ok((html.match(/class="bw-table-wrap"/g) || []).length >= 8,
      "a wide table must scroll in its own box, not push the page sideways");
  });

  test("no hand-styled table header survives in the application", () => {
    const appOnly = html.slice(0, html.indexOf("function miGlossTable("));
    assert.equal(/<th style="text-align:(left|right);padding-bottom/.test(appOnly), false);
  });
});
