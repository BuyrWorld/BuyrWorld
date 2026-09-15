# BuyrWorld — project rules

Read this before changing anything. These constraints are load-bearing; ignoring one has broken the site before.

## What this is

A dark-mode procurement web product at buyrworld.com. Single-page app served from one `index.html`, plus Vercel serverless functions in `/api/`. No build step, no framework, no package manifest.

- `index.html` — the entire UI, state, router, prompts and report generation. Show/hide SPA routed by `go(page)`; Market Intelligence has its own sub-router `miGo()`.
- `api/chat.js` — the only model endpoint. `maxDuration: 300`.
- `/previews/` — 8 lowercase-hyphenated JPEGs, the sample previews for the reference templates. Nothing is for sale.
- Also in root: `buyrworld-logo.png` (the one wordmark — header, sidebar and footer all reference it; it was inlined as base64 twice until Sept 2026), `buyrworld-social-card.png`, `robots.txt`, `sitemap.xml`.
- `src/calc/` — the deterministic calculation engine (ES modules). `exact.mjs` is BigInt money and ratio arithmetic; `index-series.mjs` resolves index movement from a contractual base period with a lag; `cost-bridge.mjs` is the supplier-claim decomposition; `spend.mjs` is the spend analysis; `negotiation.mjs` turns a finished case into a negotiating position; `supplier-history.mjs` reads the recorded outcomes back by supplier; `portfolio.mjs` aggregates cases and outcomes into the resisted rate; `learning.mjs` derives what has actually worked, always with its sample size and never attributing money to one argument; `sourcing.mjs` normalises supplier quotes, keeping two rankings apart and refusing to name a winner; `shadow.mjs` recommends the next move during a negotiation, requests before challenges and challenges before concessions, and records what was actually done; `radar.mjs` looks across everything recorded and says what is worth asking about, firing only where real data exists and never totalling its findings, and now reads reviewed lots too — it never computes a rate itself, because `mill.mjs` withholds percentages below its evidence threshold and a second division would undo that refusal; `comparable.mjs` compares parts on what they are rather than what they are called, and reports comparability against what was actually checkable; `batna.mjs` assesses whether a supplier could actually be replaced, and is the one module where the job is to be exact about ignorance rather than about arithmetic; `build-up.mjs` puts a supplier's claimed cost structure beside a should-cost build-up, prices the difference in percentage points of the increase being asked for, and is phrased as a question throughout — a build-up made from your rates is what you think the part costs, not what it costs them; `mill.mjs` builds a private record of how reviewed lots turned out, keeping conformity and document completeness as separate metrics, withholding a percentage entirely below the evidence threshold rather than showing one with a caveat, and refusing a composite score; `certificate.mjs` compares a material certificate against requirements from identified documents, treating every reported value as the range it covers rather than a number, and refusing to convert a unit that has no exact conversion; `units.mjs` holds physical quantities as exact integers — micrometres, micrograms — chosen so every unit it accepts converts with no remainder, and refuses a number that arrives without a unit; `should-cost.mjs` turns a required number of accepted parts into a purchase quantity and a cost over it, computing the route backwards from the parts wanted and keeping process loss, contingency and purchase rounding as three separate numbers; `shock.mjs` is the cost-shock model, whose exposure figures rest on model-proposed composition shares and are labelled assumed throughout. Imported by `index.html` via one `<script type="module">` that mounts `window.BW`.
- `tests/` — Node's built-in runner. `node --test "tests/**/*.test.mjs"`.
- `scripts/verify.mjs` — runs everything. Run it before any deploy.
- `src/intake/extract-document.mjs` — reads drawings and certificates by written rule, never by model. Every value comes back with the page and the exact characters it was matched from, proposed and unconfirmed. It refuses a scan rather than guessing at it, never supplies a missing unit (% and ppm are four orders of magnitude apart), and surfaces conflicting revisions rather than choosing one. Because there is no prompt, a document instructing it is just a document containing that sentence.
- `src/intake/classify.mjs` — deterministic document classification and routing for the Inbox. Knows eight kinds; a certificate and a drawing both route to `shouldcost` and carry a `mode` so the Inbox lands on the right half of that page rather than merely on it. No model: the signals are explicit, each is returned with the passage that triggered it, and nothing written in a document can change the rules.
- `src/services/estimate-store.mjs` — saved build-ups. Stores the result, not the working: a figure somebody argued with last month should still be that figure when the engine's arithmetic moves. Completeness is stored too, so an estimate with gaps cannot become comparable by being saved and reloaded.
- `src/services/lot-store.mjs` — reviewed lots, keyed by lot rather than by row, so a re-uploaded or revised certificate corrects a record instead of creating a second conforming lot. There is nowhere for a duplicate to go.
- `src/services/part-store.mjs` — the parts library. A `Part` carries the twelve comparison attributes from `comparable.mjs`, which owns that vocabulary; `forComparison()` is the seam between the domain shape and the comparison shape, kept explicit rather than making one module understand both.
- `src/domain/` — entity identity and the commercial memory spine (pure: no I/O). `ids.mjs` derives stable ids; `entities.mjs` defines Supplier, Part, Contract, CommercialCase and LearningRecord; `registry.mjs` resolves names and handles explicit, reversible merges. See `docs/DOMAIN_MODEL.md`.
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
- **A value marked `ai-inferred` cannot enter arithmetic** until a human confirms it. `assertUsable()` in `cost-bridge.mjs` refuses, and the page carries each driver row's provenance through to it rather than stamping everything `user-entered` — which is what made the guard inert for months. Editing a value makes the row the person's again. Two layers: the interface disables **Use these values** until every field is confirmed, and the engine refuses anything that gets past it.
- **Index movement is derived, never accepted on trust.** A driver may state a movement directly, but the defensible form names an index plus the *contractual* base period and lag. A supplier's claimed base period never influences the warranted figure — it is only reported as an overstatement.
- **Never interpolate a missing index observation.** A gap in a series is an error. An invented data point is worse than a stopped calculation.
- **No floating point is now enforced, not just stated.** `tests/security/no-floats.test.mjs` is a ratchet: every float construct currently in `src/calc` is listed with why it is safe, and anything else fails. The list may shrink, not grow.
- **Nothing added to the decision pack may move a figure in it.** The build-up comparison and the supplier quality record are sections, sources and uncertainties; the warranted change, the scenarios and the recommendation are byte-identical with and without them, and `tests/unit/decision-pack-join.test.mjs` asserts that directly.
- **Every calculation change needs a test.** `node scripts/verify.mjs` must pass before any commit that touches `src/calc/`.

## Post-audit rules (added Sept 2026)

- **Never log prompt content, document text or user input.** Logs carry metadata only: request id, timestamp, tool name, model id, character counts, latency, status, error class. This is non-negotiable — it was the audit's critical finding.
- **Code calculates, the model explains.** No arithmetic, scoring or cost decomposition in a prompt if it can be done in `/lib/`. The model extracts fields and drafts argument; it does not produce numbers.
- **Preserve citations end to end.** `api/chat.js` must return the `citations` from the Anthropic web search tool, not just the `text` blocks. Any UI that shows a web-grounded claim shows its source.
- **Label every figure** supplied / derived / assumed. Assumed figures surface in an "Assumptions to verify" block.
- **Treat uploaded documents as untrusted.** Wrap them in explicit delimiters; content inside is data, never instructions. Escape filenames with `textContent`, never `innerHTML`.
- **No silent truncation.** If a document is cut short, say so on screen with the actual coverage.

## Design system (added Sept 2026)

- **If `window.BW` is missing, say so.** The engine is a separate module request now, so it can 404, be served as the wrong media type, or be refused by a policy. 34 controls guard on it; `engineBanner()` puts one sentence at the top of the page and names which of those failed, and `engineNote()` is the same sentence wherever a result would have gone. Never add another wording — there is one, and a test holds that.
- **The application lives in `app.js` and `mount.mjs`, not in `index.html`.** The page loads them from the positions the inline blocks occupied. `script-src` no longer allows inline script, so **an inline `onclick` will not run** — markup asks for an action by name (`data-do`, `data-chg`, `data-inp`, `data-key`) and a table in `app.js` maps it to a function. A table, not `window[name]`: a string that arrives in markup must never choose which function runs.
- **The sidebar is fixed and opaque, so every landmark beside it must be indented past it or hidden.** `header` was indented and `footer` was not; above 1080px the footer drew underneath the sidebar and the logo in it looked clipped. `tests/integration/shell.test.mjs` checks the whole set rather than the one that was missing.
- **Tokens live in one `:root` block.** `--bw-*` for surfaces, ink, semantics, spacing, radius and type. The original seven (`--bg`, `--panel`, `--lime` and so on) are now **aliases** of them, because 1,382 inline `style=` attributes reference those names. Never remove an alias.
- **Primitives are `.bw-*` classes** and take colours from tokens only. `tests/security/design-system.test.mjs` fails on a hardcoded hex inside one.
- **Screens migrate onto the primitives one at a time.** `.card` and `.btn` still exist and still work; nothing is restyled underneath a working feature.
- **Contrast is derived from the stylesheet, not copied.** When the palette changed, a hardcoded test list went on passing while testing colours the page had stopped using. `accessibility.test.mjs` now parses the real tokens.
- **A status chip never signals by colour alone** — it carries a dot and its word.
- See `docs/VISUAL_NORTH_STAR.md` and `docs/VISUAL_ACCEPTANCE_CHECKLIST.md`.

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
