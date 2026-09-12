import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const flat = html.replace(/\n/g, " ");

/** WCAG 2.1 relative luminance and contrast ratio. */
const channel = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = (hex) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("colour contrast (WCAG 1.4.3)", () => {
  const GROUND = "#0C0C0C";
  const CARD = "#1A1A1A";
  const inks = {
    "--text": "#E8E8E2", "--muted": "#8F8F8F", "--lime": "#D6FF00",
    "body copy": "#CFCFCF", warning: "#FFB800", danger: "#FF5C5C",
  };

  test("every ink meets 4.5:1 on the page background", () => {
    for (const [name, hex] of Object.entries(inks)) {
      const r = contrast(hex, GROUND);
      assert.ok(r >= 4.5, `${name} ${hex} is ${r.toFixed(2)}:1 on ${GROUND}, below the 4.5:1 minimum`);
    }
  });

  test("every ink meets 4.5:1 on a card as well", () => {
    for (const [name, hex] of Object.entries(inks)) {
      const r = contrast(hex, CARD);
      assert.ok(r >= 4.5, `${name} ${hex} is ${r.toFixed(2)}:1 on a card, below the 4.5:1 minimum`);
    }
  });

  test("the contrast helper is right, so the tests above mean something", () => {
    assert.equal(contrast("#FFFFFF", "#000000").toFixed(0), "21");   // the known maximum
    assert.equal(contrast("#777777", "#FFFFFF").toFixed(2), "4.48"); // a known near-miss
  });
});

describe("keyboard operation (WCAG 2.1.1)", () => {
  test("nothing with a click handler is unreachable by keyboard", () => {
    const clickable = [...html.matchAll(/<(\w+)([^>]*\sonclick=[^>]*)>/g)];
    const stranded = clickable.filter(([, tag, attrs]) =>
      !/^(button|a|input|select|textarea|summary)$/.test(tag) &&
      !/tabindex=/.test(attrs)
    );
    const report = stranded.map(([, tag, a]) => `  <${tag} ${a.slice(0, 70)}`).join("\n");
    assert.equal(stranded.length, 0,
      `element(s) with onclick that a keyboard cannot reach:\n${report}\n` +
      `Use a <button>, or add role="button" tabindex="0" onkeydown="cardKey(event)".`);
  });

  test("card buttons respond to Enter and Space, as a real button does", () => {
    assert.match(html, /function cardKey\(e\)/);
    assert.match(html, /e\.key!=="Enter"&&e\.key!==" "/);
    assert.match(html, /e\.currentTarget\.click\(\)/);
  });

  test("every keyboard-operable card declares its role", () => {
    const cards = [...html.matchAll(/<div([^>]*onkeydown="cardKey[^>]*)>/g)];
    assert.ok(cards.length >= 3, "expected the agent, academy and blog cards");
    for (const [, attrs] of cards) {
      assert.match(attrs, /role="button"/, "a keyboard-operable div must say what it is");
      assert.match(attrs, /tabindex="0"/);
    }
  });
});

describe("focus is visible (WCAG 2.4.7, 2.4.11)", () => {
  test("a focus-visible style exists", () => {
    assert.match(html, /:focus-visible\{outline:3px solid var\(--lime\)/);
  });

  test("the input reset that removes the outline puts one back", () => {
    assert.match(html, /outline\s*:\s*none/, "the .bwin reset still removes it");
    assert.match(html, /input\.bwin:focus-visible[^{]*\{[^}]*outline:3px solid/,
      "so an explicit focus indicator must be restored for inputs");
  });

  test("browsers without :focus-visible still get an indicator", () => {
    assert.match(html, /@supports not selector\(:focus-visible\)/);
  });
});

describe("structure and landmarks", () => {
  test("there is a main landmark and a skip link that targets it", () => {
    assert.match(html, /<main id="main"/);
    assert.match(html, /<a class="skip-link" href="#main">/);
    assert.ok(html.indexOf('class="skip-link"') < html.indexOf("<main"),
      "the skip link must come before the content it skips to");
  });

  test("the skip link is reachable but out of the way until focused", () => {
    assert.match(html, /\.skip-link\{[^}]*left:-9999px/);
    assert.match(html, /\.skip-link:focus\{left:0\}/);
  });

  test("every page section sits inside main", () => {
    const mainStart = html.indexOf("<main id=");
    const mainEnd = html.indexOf("</main>");
    assert.ok(mainStart > -1 && mainEnd > mainStart);
    const pages = [...html.matchAll(/<div class="page[^"]*" id="page-/g)];
    for (const m of pages) {
      assert.ok(m.index > mainStart && m.index < mainEnd,
        "a page section was left outside the main landmark");
    }
  });

  test("the document declares its language", () => {
    assert.match(html, /<html lang="en"/);
  });

  test("changing route moves focus, so a screen reader follows", () => {
    assert.match(html, /m\.focus\(\{preventScroll:true\}\)/);
    assert.match(html, /<main id="main" tabindex="-1"/,
      "main must be programmatically focusable for that to work");
  });
});

describe("form controls are named (WCAG 3.3.2)", () => {
  test("every control has an accessible name", () => {
    const controls = [...html.matchAll(/<(input|textarea|select)([^>]*)>/g)];
    const unnamed = [];
    for (const [, tag, attrs] of controls) {
      if (/type="(hidden|submit|button|file)"/.test(attrs)) continue;
      if (/aria-label=|aria-labelledby=/.test(attrs)) continue;
      const id = (attrs.match(/id="([^"]+)"/) || [])[1];
      if (id && new RegExp(`for="${id}"`).test(html)) continue;
      if (id && new RegExp(`<label[^>]*>[^<]{0,80}<${tag}[^>]*id="${id}"`).test(flat)) continue;
      unnamed.push(id || attrs.slice(0, 50));
    }
    assert.deepEqual(unnamed, [],
      "a placeholder is not a name — it vanishes on input and is not reliably announced");
  });

  test("no control is named after an example value", () => {
    // "aria-label=\"2025-01\"" tells a screen-reader user nothing about the field.
    const labels = [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    const uselessness = labels.filter((l) => /^\d{4}-\d{2}$/.test(l) || /^\d+$/.test(l) || /^[A-Z]{2}-\d+$/.test(l));
    assert.deepEqual(uselessness, [], "these name the field after an example value");
  });

  test("labels are not truncated mid-sentence", () => {
    const labels = [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    for (const l of labels) {
      assert.ok(l.length <= 80, `"${l}" is too long to be a useful name`);
      assert.equal(/\be\.g\.$/.test(l), false, `"${l}" ends mid-example`);
    }
  });
});

describe("motion (WCAG 2.3.3)", () => {
  test("reduced motion covers every animation, not a named few", () => {
    const block = html.match(/@media \(prefers-reduced-motion:reduce\)\{[\s\S]{0,500}?\n\}/);
    assert.ok(block, "a reduced-motion block must exist");
    assert.match(block[0], /\*,\*::before,\*::after/,
      "17 keyframe animations exist; listing them individually is how one gets missed");
    assert.match(block[0], /animation-duration:\.001ms !important/);
  });

  test("the hero canvas checks the preference too, since CSS cannot stop it", () => {
    assert.match(html, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
  });
});

describe("navigation state is announced, not only coloured", () => {
  test("the current page carries aria-current", () => {
    const navRenders = (html.match(/aria-current="page"/g) || []).length;
    assert.ok(navRenders >= 2, "both the desktop and mobile navs should mark the current page");
  });
});
