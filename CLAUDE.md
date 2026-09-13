# BuyrWorld — project rules

Read this before changing anything. These constraints are load-bearing; ignoring one has broken the site before.

## What this is

A dark-mode procurement web product at buyrworld.com. Single-page app served from one `index.html`, plus Vercel serverless functions in `/api/`. No build step, no framework, no package manifest.

- `index.html` — the entire UI, state, router, prompts and report generation. Show/hide SPA routed by `go(page)`; Market Intelligence has its own sub-router `miGo()`.
- `api/chat.js` — the only model endpoint. `maxDuration: 300`.
- `/previews/` — 8 lowercase-hyphenated JPEGs, the sample previews for the reference templates. Nothing is for sale.
- Also in root: `buyrworld-social-card.png`, `robots.txt`, `sitemap.xml`.
- `src/calc/` — the deterministic calculation engine (ES modules). `exact.mjs` is BigInt money and ratio arithmetic; `index-series.mjs` resolves index movement from a contractual base period with a lag; `cost-bridge.mjs` is the supplier-claim decomposition; `spend.mjs` is the spend analysis; `negotiation.mjs` turns a finished case into a negotiating position; `supplier-history.mjs` reads the recorded outcomes back by supplier; `portfolio.mjs` aggregates cases and outcomes into the resisted rate; `shock.mjs` is the cost-shock model, whose exposure figures rest on model-proposed composition shares and are labelled assumed throughout. Imported by `index.html` via one `<script type="module">` that mounts `window.BW`.
- `tests/` — Node's built-in runner. `node --test "tests/**/*.test.mjs"`.
- `scripts/verify.mjs` — runs everything. Run it before any deploy.
- `src/services/` — `case-store.mjs` and `outcome-store.mjs` persist cases and outcomes in `localStorage`. Both share one BigInt tagging format; the tag opens with a NUL byte, which is why grep calls `outcome-store.mjs` a binary file. Changing it would orphan everything already stored.
- `fixtures/` — synthetic, fictional demonstration cases.

Deploys are GitHub → Vercel. Pushing to `main` deploys production.

## Hard constraints

- **`index.html` is fragile.** Before any deploy, validate div balance and JS syntax. A single unclosed div silently breaks a whole page section.
- **Never use greedy regex across article boundaries.** The blog content lives in the same file; greedy matches have eaten neighbouring articles.
- **No browser-side third-party fetches.** CORS will block them. Anything external goes through a serverless function.
- **jsPDF core fonts only.** Custom fonts break the PDF exports.
- **The Market Intelligence object must always include every slot**, even when empty. Missing slots break the renderer.
- **`scoreRGB` uses hard colour bands**: red 0–39, amber 40–69, green 70–100. Don't smooth or reinterpolate them.
- **The account is Vercel Pro: functions cap at 300s**, and `api/chat.js` aborts itself at 270s to stay inside that. Supplier Discovery runs long. Any change that adds latency needs a timeout path that returns a partial result, not a 504.

## Calculation rules (added Sept 2026)

- **Code calculates, the model explains.** No percentage or money figure shown to a user may come from a language model. Computed figures are passed *into* prompts as fixed facts; the model drafts argument around them.
- **No floating point in `src/calc/`.** Money is integer minor units on BigInt, ratios are scaled by 1e9. Rounding is half-up away from zero and only where it is named.
- **Mixed currencies raise.** Never convert implicitly. `fx.mjs` converts only with a dated, sourced rate, and refuses one missing either.
- **A rate move is not a cost move.** Where the supplier prices in another currency, the change splits into cost effect, FX effect and cross term, which sum exactly to the total. Claiming currency as a cost driver while also converting is rejected as double counting.
- **A value marked `ai-inferred` cannot enter arithmetic** until a human confirms it. This is enforced in `cost-bridge.mjs`, not left to convention.
- **Index movement is derived, never accepted on trust.** A driver may state a movement directly, but the defensible form names an index plus the *contractual* base period and lag. A supplier's claimed base period never influences the warranted figure — it is only reported as an overstatement.
- **Never interpolate a missing index observation.** A gap in a series is an error. An invented data point is worse than a stopped calculation.
- **Every calculation change needs a test.** `node scripts/verify.mjs` must pass before any commit that touches `src/calc/`.

## Post-audit rules (added Sept 2026)

- **Never log prompt content, document text or user input.** Logs carry metadata only: request id, timestamp, tool name, model id, character counts, latency, status, error class. This is non-negotiable — it was the audit's critical finding.
- **Code calculates, the model explains.** No arithmetic, scoring or cost decomposition in a prompt if it can be done in `/lib/`. The model extracts fields and drafts argument; it does not produce numbers.
- **Preserve citations end to end.** `api/chat.js` must return the `citations` from the Anthropic web search tool, not just the `text` blocks. Any UI that shows a web-grounded claim shows its source.
- **Label every figure** supplied / derived / assumed. Assumed figures surface in an "Assumptions to verify" block.
- **Treat uploaded documents as untrusted.** Wrap them in explicit delimiters; content inside is data, never instructions. Escape filenames with `textContent`, never `innerHTML`.
- **No silent truncation.** If a document is cut short, say so on screen with the actual coverage.

## Brand

- Background `#0C0C0C`, lime accent `#D6FF00`.
- Space Grotesk for headings, Inter for body.
- Dark cards, consistent product naming. Don't introduce a second design system or a CSS framework.

## Identity

- **Commits from this repository are authored as `BuyrWorld`**, not as a person. The repo-local git config sets `user.name` and a GitHub noreply `user.email`; the global config is untouched, so other projects are unaffected. Check with `git var GIT_AUTHOR_IDENT` before committing if anything seems off.
- **No personal name, photograph or email in the tree or the served site.** `scripts/verify-content.mjs` fails the build if one reappears.
- **This does not retroactively change history.** 243 earlier commits carry a personal email and the repository is public. See `docs/SECURITY_REVIEW.md` for what remains externally visible and the options for it.

## Working style

- One phase per session. Commit at the end of each.
- Work on a branch; check the Vercel preview before merging to `main`.
- **Verification:** trust the GitHub commit timestamp and an incognito window. Cached CDN responses have repeatedly shown stale content and sent us chasing bugs that were already fixed.
- Show a diff and a plain-English summary of what changed before I deploy.
- If a change touches more than ~200 lines of `index.html`, stop and propose the split first.
