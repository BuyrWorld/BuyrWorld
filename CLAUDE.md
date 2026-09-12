# BuyrWorld — project rules

Read this before changing anything. These constraints are load-bearing; ignoring one has broken the site before.

## What this is

A dark-mode procurement web product at buyrworld.com. Single-page app served from one `index.html`, plus Vercel serverless functions in `/api/`. No build step, no framework, no package manifest.

- `index.html` — the entire UI, state, router, prompts and report generation. Show/hide SPA routed by `go(page)`; Market Intelligence has its own sub-router `miGo()`.
- `api/chat.js` — the only model endpoint. `maxDuration: 300`.
- `/previews/` — 8 lowercase-hyphenated JPEGs for the paid templates.
- Also in root: `buyrworld-social-card.png`, `robots.txt`, `sitemap.xml`.

Deploys are GitHub → Vercel. Pushing to `main` deploys production.

## Hard constraints

- **`index.html` is fragile.** Before any deploy, validate div balance and JS syntax. A single unclosed div silently breaks a whole page section.
- **Never use greedy regex across article boundaries.** The blog content lives in the same file; greedy matches have eaten neighbouring articles.
- **No browser-side third-party fetches.** CORS will block them. Anything external goes through a serverless function.
- **jsPDF core fonts only.** Custom fonts break the PDF exports.
- **The Market Intelligence object must always include every slot**, even when empty. Missing slots break the renderer.
- **`scoreRGB` uses hard colour bands**: red 0–39, amber 40–69, green 70–100. Don't smooth or reinterpolate them.
- **The account is Vercel Pro: functions cap at 300s**, and `api/chat.js` aborts itself at 270s to stay inside that. Supplier Discovery runs long. Any change that adds latency needs a timeout path that returns a partial result, not a 504.

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

## Working style

- One phase per session. Commit at the end of each.
- Work on a branch; check the Vercel preview before merging to `main`.
- **Verification:** trust the GitHub commit timestamp and an incognito window. Cached CDN responses have repeatedly shown stale content and sent us chasing bugs that were already fixed.
- Show a diff and a plain-English summary of what changed before I deploy.
- If a change touches more than ~200 lines of `index.html`, stop and propose the split first.
