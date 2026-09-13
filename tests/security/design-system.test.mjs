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

const html = readFileSync("index.html", "utf8");
/** The stylesheet only: the rest of the file is markup and script. */
const css = html.slice(html.indexOf(":root{"), html.indexOf("</style>"));

describe("the token layer", () => {
  test("every surface, ink and semantic colour is defined", () => {
    for (const name of [
      "bw-bg", "bw-sidebar", "bw-surface", "bw-surface-2", "bw-border", "bw-border-strong",
      "bw-text", "bw-muted", "bw-subtle",
      "bw-accent", "bw-accent-ink", "bw-accent-soft",
      "bw-danger", "bw-warning", "bw-success",
    ]) {
      assert.match(css, new RegExp(`--${name}\\s*:`), `--${name} is missing`);
    }
  });

  test("one spacing scale exists, rather than one per feature", () => {
    for (const step of ["bw-1", "bw-2", "bw-3", "bw-4", "bw-5", "bw-6", "bw-8"]) {
      assert.match(css, new RegExp(`--${step}\\s*:`), `--${step} is missing`);
    }
  });

  test("a type scale for the workspace exists", () => {
    for (const t of ["bw-t-page", "bw-t-panel", "bw-t-metric", "bw-t-body", "bw-t-meta"]) {
      assert.match(css, new RegExp(`--${t}\\s*:`));
    }
  });

  test("nothing existing was deleted to make room", () => {
    // The old names must survive: removing them would break 1,382 call sites.
    for (const old of ["bg", "panel", "panel2", "line", "text", "muted", "lime"]) {
      assert.match(css, new RegExp(`--${old}\\s*:`), `--${old} was removed`);
    }
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
    const wide = css.match(/@media\(max-width:1100px\)\{([^@]*)\}/)[1];
    assert.match(wide, /\.bw-grid-3\{grid-template-columns:repeat\(2/);
    const narrow = css.match(/@media\(max-width:760px\)\{([^@]*)\}/)[1];
    assert.match(narrow, /\.bw-grid-2,\.bw-grid-3\{grid-template-columns:minmax\(0,1fr\)\}/);
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

  test("it appears only where there is room, and the top nav yields to it", () => {
    assert.match(css, /\.bw-side\{display:none\}/, "narrow screens keep the existing mobile menu untouched");
    const desktop = css.slice(css.indexOf("@media(min-width:1080px){"));
    assert.match(desktop, /#desknav\{display:none\}/, "two navigations at once would be a duplicate");
    assert.match(desktop, /header\{padding-left:236px\}/);
    assert.match(desktop, /main\{padding-left:236px\}/);
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
    assert.equal((render.match(/LINKS\.map/g) || []).length, 2, "one source of truth for destinations");
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
