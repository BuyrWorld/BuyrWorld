/**
 * The application shell: the chrome that surrounds every page.
 *
 * This suite exists because of one reported defect. The UI brief said the
 * footer logo "appears clipped" and guessed at content overflow. Neither was
 * it. When the shell gained a fixed 236px sidebar, `header` and `main` were
 * indented past it and `footer` was not — so above 1080px the footer drew from
 * x=0, underneath an opaque panel, and the first thing in the footer is the
 * logo. Between 1080 and about 1400px the centred content column starts left
 * of 236px, so the mark was partly or entirely covered.
 *
 * The asset was never the problem, which is why the asset is measured here
 * too: the next export of it could genuinely crop the mark, and the symptom on
 * screen would be indistinguishable from this one.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

import { pageSource } from "../helpers/page.mjs";

import { inkBounds } from "../helpers/png.mjs";

const html = pageSource();

/** The declaration block of the desktop-shell media query. */
function shellQuery() {
  const start = html.indexOf("@media(min-width:1080px){");
  assert.ok(start > 0, "the desktop shell media query is gone");
  return html.slice(start, html.indexOf("\n}", start));
}

describe("nothing is drawn underneath the sidebar", () => {
  const SIDEBAR = 236;

  test("the sidebar is a fixed, opaque panel of a known width", () => {
    const rule = html.match(/\.bw-side\{[^}]*\}/g).find((r) => r.includes("position:fixed"));
    assert.ok(rule, "the sidebar is no longer a fixed panel");
    assert.ok(rule.includes(`width:${SIDEBAR}px`), `the sidebar is not ${SIDEBAR}px wide any more`);
    assert.ok(rule.includes("background:var(--bw-sidebar)"), "the sidebar is no longer opaque");
  });

  test("every top-level landmark is either indented past it or not drawn at all", () => {
    // The bug was an omission, so the test is over the whole set rather than
    // over the one member that was missing. A landmark satisfies this two
    // ways: it starts to the right of the sidebar, or the sidebar replaced it.
    const q = shellQuery();
    for (const landmark of ["header", "main", "footer"]) {
      const cleared = q.includes(`${landmark}{padding-left:${SIDEBAR}px}`);
      const hidden = q.includes(`${landmark}{display:none}`);
      assert.ok(cleared || hidden,
        `${landmark} is neither cleared of the sidebar nor hidden, so it draws underneath it`);
    }
  });

  test("the content column would otherwise start left of the sidebar", () => {
    // Why this was visible rather than theoretical: .wrap is a centred column,
    // and at common desktop widths its left edge falls inside the sidebar.
    const wrap = html.match(/\.wrap\{max-width:(\d+)px;margin:0 auto;padding:0 (\d+)px\}/);
    assert.ok(wrap, ".wrap changed shape; this calculation needs revisiting");
    const [, max, pad] = wrap.map(Number);
    const leftEdgeAt = (vw) => Math.max(0, (vw - max) / 2) + pad;
    assert.ok(leftEdgeAt(1080) < SIDEBAR, "sanity: at 1080px the column starts well inside the sidebar");
    assert.ok(leftEdgeAt(1280) < SIDEBAR, "sanity: at 1280px it still does");
    assert.ok(leftEdgeAt(1920) > SIDEBAR, "sanity: at 1920px it does not, which is why this looked intermittent");
  });
});

describe("one wordmark", () => {
  test("the logo is a file, not embedded twice in the page", () => {
    assert.ok(existsSync("buyrworld-logo.png"), "the logo asset is missing");
    assert.equal(/src="data:image\/png;base64,/.test(html), false,
      "an inline base64 image is back in index.html");
    assert.equal(html.split('src="/buyrworld-logo.png"').length - 1, 3,
      "expected the header, the footer and the sidebar to share one asset");
  });

  test("every reference declares the intrinsic size, so nothing reflows on decode", () => {
    const refs = html.match(/<img src="\/buyrworld-logo\.png"[^>]*>/g) || [];
    assert.equal(refs.length, 3);
    const { width, height } = inkBounds("buyrworld-logo.png");
    for (const tag of refs) {
      assert.match(tag, new RegExp(`width="${width}" height="${height}"`), `no intrinsic size on ${tag.slice(0, 60)}`);
      assert.match(tag, /alt="/, "an image with no alt attribute at all");
    }
  });

  test("the sidebar carries the lockup rather than setting the name in type", () => {
    assert.equal(/class="bw-side-brand">Buyr<span>World<\/span>/.test(html), false,
      "the sidebar is back to a second, different wordmark");
    assert.match(html, /class="bw-side-brand" data-go="home" aria-label="BuyrWorld — home"/);
    assert.match(html, /\.bw-side-brand img\{width:\d+px/);
  });

  test("it fits the sidebar it sits in", () => {
    const rendered = Number(html.match(/\.bw-side-brand img\{width:(\d+)px/)[1]);
    const pad = Number(html.match(/--bw-3:(\d+)px/)[1]);
    const sideGutter = Number(html.match(/\.bw-side\{[^}]*padding:var\(--bw-5\) var\(--bw-3\)/) ? pad : 0);
    assert.ok(rendered + 2 * (sideGutter + pad) <= 236, "the wordmark is wider than the sidebar can hold");
  });
});

describe("the asset itself", () => {
  test("the artwork has clear space on every side", () => {
    // The reported symptom was a clipped mark. If an export ever truly clips
    // it, ink runs to the canvas edge and this fails — rather than the cause
    // being guessed at from a screenshot a second time.
    const { margins } = inkBounds("buyrworld-logo.png");
    for (const [side, px] of Object.entries(margins)) {
      assert.ok(px > 0, `the artwork runs off the ${side} edge of the canvas`);
    }
  });

  test("it is the shape the page is told it is", () => {
    const { width, height } = inkBounds("buyrworld-logo.png");
    assert.equal(width, 560);
    assert.equal(height, 156);
  });
});

describe("one palette, not two", () => {
  test("no neutral-black surface is left over from before the palette moved", () => {
    // The brief read the sidebar as blue-green against black content. The
    // sidebar and the page ground are the same family two steps apart; what
    // actually differed were three surfaces still carrying the old neutral.
    const screen = html.slice(0, html.indexOf("function ciShell("));
    for (const stale of ["#161616", "rgba(17,17,17", "rgba(12,12,12", "#0C0C0C"]) {
      assert.equal(screen.includes(stale), false, `${stale} still sits beside the blue-grey palette`);
    }
  });

  test("text on the accent comes from the token that exists for it", () => {
    assert.equal(/color:#0C0C0C/.test(html), false);
    assert.ok(html.split("var(--bw-accent-ink)").length - 1 >= 4);
  });

  test("the browser chrome is told the page ground, not the old one", () => {
    const bg = html.match(/--bw-bg:(#[0-9A-Fa-f]{6})/)[1];
    assert.match(html, new RegExp(`<meta name="theme-color" content="${bg}">`, "i"));
  });
});

describe("the flat list becomes four groups", () => {
  const linkKeys = [...html.match(/const LINKS=\[(.*?)\];/s)[1].matchAll(/\["([a-z-]+)","([^"]+)"\]/g)]
    .map((m) => ({ key: m[1], label: m[2] }));

  test("the labels no longer describe each other", () => {
    // "Buyr AI" and "AI Tools" sat next to each other and named the same
    // thing twice; "Resources" and "Project" named nothing in particular.
    const labels = linkKeys.map((l) => l.label);
    assert.ok(!labels.includes("AI Tools"), "two destinations still both lead with AI");
    assert.ok(!labels.includes("Resources"), "Resources says nothing about what is behind it");
    assert.ok(!labels.includes("Project"), "Project says nothing about what is behind it");
    assert.deepEqual([...new Set(labels)].length, labels.length, "two destinations share a label");
  });

  test("no destination was dropped in the regrouping", () => {
    // Relabelling is safe; losing a route is not. The keys are the routes.
    assert.deepEqual(
      linkKeys.map((l) => l.key).sort(),
      ["academy", "ai", "blog", "contact", "dash", "home", "inbox", "market", "parts", "shouldcost", "templates", "tools"],
    );
  });

  test("a group heading is a heading, not a link", () => {
    assert.match(html, /class="bw-side-group">'\+ciEsc\(g\[0\]\)/);
    assert.equal(/class="bw-side-group"[^>]*data-go/.test(html), false,
      "a heading that navigates is a link wearing the wrong clothes");
  });

  test("the grouping is rejected at runtime if it names a route that does not exist", () => {
    // A silent drop would remove a destination from the product with no error.
    assert.match(html, /NAV_GROUPS names a destination that is not in LINKS/);
  });

  test("every group heading earns its place", () => {
    const groups = html.match(/const NAV_GROUPS=\[(.*?)\n\];/s)[1];
    const named = [...groups.matchAll(/\["([^"]+)",\[([^\]]*)\]\]/g)];
    assert.ok(named.length >= 3, "fewer than three named groups is not a grouping");
    for (const [, heading, members] of named) {
      const count = (members.match(/"/g) || []).length / 2;
      assert.ok(count >= 2, `"${heading}" groups ${count} destination — a group of one is a label`);
    }
  });
});

describe("the fold", () => {
  test("the hero is smaller than the four ways in", () => {
    // It still has to say what the product is. It no longer has to be the
    // whole first screen of a laptop before anything actionable appears.
    const hero = html.match(/\.hero\{padding:(\d+)px 0 (\d+)px/);
    assert.ok(Number(hero[1]) + Number(hero[2]) <= 100, "the hero padding is back above 100px");
    const h = Number(html.match(/\.hero-h\{font-size:(\d+)px/)[1]);
    assert.ok(h <= 48, `the hero headline is ${h}px`);
  });

  test("the headline is set to a measure rather than the full column", () => {
    assert.match(html, /<h1 class="hero-h" style="max-width:\d+ch">/);
  });

  test("what to do next still sits on the home page", () => {
    assert.match(html, /What do you need today\?/);
    assert.match(html, /id="pillars"/);
  });
});
