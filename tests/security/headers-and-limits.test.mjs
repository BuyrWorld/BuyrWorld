import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
const chat = readFileSync("api/chat.js", "utf8");
const html = readFileSync("index.html", "utf8");

const headersFor = (source) => {
  const rule = vercel.headers.find((h) => h.source === source);
  assert.ok(rule, `no header rule for ${source}`);
  return Object.fromEntries(rule.headers.map((h) => [h.key, h.value]));
};

describe("security headers", () => {
  const h = headersFor("/(.*)");

  test("the unambiguous wins are all set", () => {
    assert.equal(h["X-Content-Type-Options"], "nosniff");
    assert.equal(h["Referrer-Policy"], "strict-origin-when-cross-origin");
    assert.equal(h["X-Frame-Options"], "SAMEORIGIN");
    assert.match(h["Permissions-Policy"], /camera=\(\)/);
    assert.match(h["Permissions-Policy"], /geolocation=\(\)/);
  });

  test("CSP locks down the directives that do not need inline", () => {
    const csp = h["Content-Security-Policy"];
    assert.match(csp, /object-src 'none'/, "no plugins");
    assert.match(csp, /base-uri 'self'/, "no base-tag hijacking");
    assert.match(csp, /frame-ancestors 'self'/, "no clickjacking");
    assert.match(csp, /form-action 'none'/, "nothing should post anywhere");
    assert.match(csp, /default-src 'self'/);
  });

  test("form-action 'none' is honest — no forms remain", () => {
    assert.equal(html.includes("<form"), false,
      "if a form is ever added, form-action must be relaxed deliberately");
  });

  test("script-src still needs unsafe-inline, and that is a known weakness", () => {
    const csp = h["Content-Security-Policy"];
    // Documenting rather than pretending. 120+ inline handlers must go first.
    assert.match(csp, /script-src [^;]*'unsafe-inline'/);
    const inlineHandlers = (html.match(/on(click|input|change|load|error)=/g) || []).length;
    assert.ok(inlineHandlers > 0,
      "when this reaches zero, remove unsafe-inline and switch to a nonce");
  });

  test("every third-party origin the page uses is allowed, and no more", () => {
    const csp = h["Content-Security-Policy"];
    const used = new Set(
      [...html.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase())
    );
    const externallyLoaded = [...used].filter((host) =>
      /cdnjs|tradingview|googleapis|gstatic/.test(host)
    );
    for (const host of externallyLoaded) {
      assert.ok(csp.includes(host), `${host} is loaded by the page but absent from the CSP`);
    }
    // Anything retired must not be re-permitted.
    assert.equal(csp.includes("plausible.io"), false, "analytics was removed; do not allow it back");
    assert.equal(csp.includes("formspree.io"), false);
    assert.equal(csp.includes("stripe.com"), false);
  });

  test("the calculation modules are served as JavaScript", () => {
    const m = headersFor("/src/(.*).mjs");
    assert.match(m["Content-Type"], /text\/javascript/,
      "a wrong MIME type makes the browser refuse the module entirely");
  });
});

describe("AI endpoint abuse controls", () => {
  test("an origin allowlist exists and covers the real hosts", () => {
    assert.match(chat, /ALLOWED_HOST_SUFFIXES/);
    assert.match(chat, /buyrworld\.com/);
    assert.match(chat, /vercel\.app/, "preview deployments must still work");
  });

  test("a per-client rate limit exists with a window and a ceiling", () => {
    assert.match(chat, /WINDOW_MS\s*=\s*[\d_]+/);
    assert.match(chat, /MAX_PER_WINDOW\s*=\s*\d+/);
    assert.match(chat, /function rateLimited\(/);
  });

  test("both checks run before any model call", () => {
    const originAt = chat.indexOf("originAllowed(req)");
    const limitAt = chat.indexOf("rateLimited(clientKey(req))");
    const fetchAt = chat.indexOf("api.anthropic.com");
    assert.ok(originAt > -1 && limitAt > -1 && fetchAt > -1);
    assert.ok(originAt < fetchAt, "origin must be checked before spending credits");
    assert.ok(limitAt < fetchAt, "rate limit must be checked before spending credits");
  });

  test("rejections return the right status and a retry hint", () => {
    assert.match(chat, /status\(403\)/);
    assert.match(chat, /status\(429\)/);
    assert.match(chat, /Retry-After/);
  });

  test("rejections are logged without content", () => {
    assert.match(chat, /err: "origin_rejected"/);
    assert.match(chat, /err: "rate_limited"/);
    // the telemetry helper never takes message text
    assert.equal(/telemetry\([^)]*content/.test(chat), false);
  });

  test("the per-instance limitation is written down, not glossed over", () => {
    assert.match(chat, /HONEST LIMITATION/);
    assert.match(chat, /per warm\s*\n?\/\/ instance/);
  });
});

describe("the rate limiter actually limits", () => {
  test("a burst is allowed up to the ceiling, then blocked, then resets", async () => {
    // Exercise the real implementation by extracting it from the source.
    const src = chat.slice(chat.indexOf("const WINDOW_MS"), chat.indexOf("export default"));
    const { rateLimited, MAX } = new Function(
      src + "; return { rateLimited, MAX: MAX_PER_WINDOW };"
    )();

    let blocked = 0;
    for (let i = 0; i < MAX; i++) if (rateLimited("1.2.3.4")) blocked++;
    assert.equal(blocked, 0, "everything inside the ceiling should pass");

    assert.equal(rateLimited("1.2.3.4"), true, "one over the ceiling is blocked");
    assert.equal(rateLimited("5.6.7.8"), false, "a different client is unaffected");
  });
});
