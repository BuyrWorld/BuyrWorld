# Security and privacy review

Status of each issue raised by the September 2026 strategic audit, plus findings
from direct code inspection. Severities are the audit's where it assigned one.
CRITICAL there means "enterprise trust blocker", not a confirmed breach.

## Resolved

| Sev | Issue | Resolution |
|---|---|---|
| CRITICAL | Prompt content logged to the platform console and pushed to Upstash with no TTL | `api/chat.js` now emits content-free telemetry only: request id, timestamp, tool, model, turn count, character count, latency, status, error class. No message text reaches a log on any path. |
| HIGH | Admin secret passed in a URL query string | `api/logs.js` deleted. It existed only to serve stored prompt content. |
| HIGH | Citations discarded | The endpoint returned only `text`, dropping citation arrays and search-result blocks. Both are now returned and rendered under every web-grounded output. |
| HIGH | Unnecessary personal data collection | Waitlist form, Formspree handler, enquiry routes and commercial analytics removed. The site now collects nothing. |
| MEDIUM | Silent truncation at eight sites | All now disclose actual coverage with real numbers. |
| MEDIUM | Truncated answers served as complete | `stop_reason` of `max_tokens` or `pause_turn` now returns `partial: true`, and the UI says the answer was cut short. |
| MEDIUM | Web search failures invisible | They arrive as HTTP 200 with an error object, so nothing threw and the tool answered from the model's own priors. Now detected and surfaced. |
| MEDIUM | Privacy policy materially inaccurate | Rewritten to describe actual processing. |
| LOW | Unreferenced archive served from the site root | `buyrworld-phase2.zip` removed from the tree. |
| HIGH | Filename DOM XSS in the contract upload path | Filenames are now set with `textContent` via `fileChip()`; no filename is interpolated into `innerHTML` anywhere. |
| HIGH | `ciEsc` output used inside `href` attributes | Both sites now use `attrEsc` (which escapes quotes) and `safeUrl` (http/https only). |
| MEDIUM | CDN libraries without Subresource Integrity | All six are now pinned by SHA-512. Each hash was computed from the bytes the CDN served and checked against the hash it publishes. `loadScript` fails closed: an unpinned URL is refused rather than loaded unverified. The pdf.js worker, which the library fetches itself and which `integrity` cannot reach, is fetched, digested and verified in code before it runs. |
| MEDIUM | Prompt injection from uploaded documents | One shared `untrusted()` wrapper now fences every document-bearing prompt — supplier letter, contract (three tools), quote files and meeting notes. An injected copy of the fence is stripped, so a document cannot close its own block, and the rule is restated after the content so a long document cannot bury it. |
| MEDIUM | No file size limit before parser operations | `extractFile` refuses anything over 8MB before allocating a buffer. |
| HIGH | `/api/chat` had no origin check or rate limit | Origin allowlist plus a per-IP token bucket (12/minute), both checked before any model call. See the caveat below. |
| MEDIUM | No security headers | `vercel.json` sets CSP, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` and `Permissions-Policy`. |

## Partially addressed

**Prompt injection.** The claim-review path is structurally safe: the arithmetic
runs to completion before the model is called, and the supplier letter enters
the prompt as explicitly labelled untrusted data that must not be followed as
instructions. An injected instruction cannot alter a figure, because no figure
comes from the model. The other tools that accept documents do not yet carry
that labelling.

## Open

| Sev | Issue | Note |
|---|---|---|
| HIGH | The rate limit is per warm instance, not global | It lives in module scope, so a distributed client gets one bucket per instance. Real limiting needs shared state. It raises the cost of casual abuse; it is not a defence against a determined one. |
| MEDIUM | `script-src` still needs `'unsafe-inline'` | 120+ inline `onclick`-style handlers make a nonce impossible today. The other CSP directives are locked down; this one is honest rather than absent. A test asserts the handler count so the weakness stays visible. |
| — | Spreadsheet formula injection | **Not applicable.** The audit listed this as a risk class, but this codebase has no CSV or XLSX export path — XLSX is read only, and exports are HTML-as-`.doc` and jsPDF. Re-check if a spreadsheet export is ever added. |
| LOW | No dependency manifest, lockfile, scanning or CI | Nothing pins or audits the CDN versions. |

## Outstanding owner actions

These need console access and cannot be done from the repository:

1. **Purge the Upstash `prompts:*` keys.** The code stopped writing, but
   historical prompt content is still stored. Until this is done the CRITICAL is
   only half closed.
2. **Rotate the admin key, the Upstash token and the model API key.**
3. **Delete the two Upstash environment variables** from the hosting project —
   nothing references them now.

## Identity visible outside the working tree

Removing identity from the tree does not remove it from any of these. Each is a
separate decision for the owner:

- **Git history.** Every removed file and personal reference remains in earlier
  commits, and the repository is **public**. History was not rewritten, as
  instructed.
- **Commit authorship.** Measured 2026-09-13: the personal email appears on
  **all 243 commits**, and "Josh Frost" as the author name on 45 of them. From
  this point commits are authored as `BuyrWorld` with a GitHub noreply address,
  set in the repo-local git config. That is forward-only; it changes nothing
  already pushed.
- **The photograph is still retrievable.** `founder.jpg` was fetched from
  `raw.githubusercontent.com` at an old commit on 2026-09-13 and returned HTTP
  200, 75,106 bytes. Deleting a file removes it from the tree, not from history.
- **188 commits** have the name or email inside file content.
- **The company number is the vector that survives everything else.** The legal
  page names BUYRWORLD LTD and company number 17289466, and Companies House
  publishes director names. No amount of repository work closes that; it is a
  structural decision, not a code one.

  **Options, in order of leverage.** Making the repository private closes
  authorship, file history and the photograph at once, keeps Vercel deploying,
  and is reversible — at the cost of the portfolio value. Rewriting history with
  `git filter-repo` works but is irreversible, changes every SHA, may leave
  objects in forks and caches, and contradicts the audit's instruction to
  preserve rather than destroy evidence while the employment position is
  unresolved. The forward-only identity change above is free and has been done.
- **Repository ownership.** The hosting account name is visible.
- **Domain registration** and hosting account details.
- **The legal notice.** The registered company name, company number and
  registered office remain on the legal page. That is corporate rather than
  personal information, and removing a real company's legal identity from a live
  site is not a change to make automatically — **flagged for owner review**.

---

# Data handling

*Added 14 September 2026, after five browser-local stores and a document reader
had been built since the original review. That review examined a product that
kept nothing between visits and uploaded documents only to have them summarised.
Neither is true any more, and the most sensitive thing the product now holds —
a private supplier-quality record — did not exist when it was written.*

Everything below states what the code does. Nothing here is a policy, a legal
position or a commitment; those are the owner's to make, and this document does
not invent them.

## What is kept, and where

Five stores, all in `localStorage` in one browser profile on one machine. There
is no account, no server-side copy and no synchronisation, so a record exists on
exactly one device until somebody exports it.

| Key | Module | Holds | Per-record cap |
|---|---|---|---|
| `bw.cases.v1` | `case-store.mjs` | Analysed claims: supplier, part, the figures, status | 256KB |
| `bw.outcomes.v1` | `outcome-store.mjs` | What was agreed on a closed case | — |
| `bw.parts.v1` | `part-store.mjs` | The parts library and its comparison attributes | — |
| `bw.lots.v1` | `lot-store.mjs` | **Reviewed lots**: producer, site, distributor, heat, lot, decision, nonconformities and who they were attributed to, reviewer and reasoning | 32KB |
| `bw.estimates.v1` | `estimate-store.mjs` | Saved cost build-ups: what each element came to and how strong the figure was | 64KB |

`bw.probe` is written and removed immediately to test whether storage works at
all. It holds nothing.

**`bw.lots.v1` is the one to think hardest about.** It is a supplier-quality
record naming producers, the issues confirmed against them, who was held
responsible, and the reviewer who decided. `mill.mjs` tells a reader on screen
that it is "private to this browser". That is accurate, and this is the first
document to say so.

## What leaves the browser

Three things, and it is worth being exact about which.

**1. Prompts to `/api/chat`.** Three call sites: the AI tools, the web-grounded
tools and the Buyr AI chat. Whatever prompt the tool assembled goes with them,
and for the quote comparator that includes the text of uploaded quotation files.
Document text is wrapped in an explicit untrusted fence and declared to be data
rather than instructions, and the fence marker is stripped from the content
first so a document cannot close it.

`api/chat.js` logs metadata only — request id, timestamp, tool, model, turn
count, character counts, latency, status, error class. No message text reaches a
log on any path. That was the original review's critical finding and it is
closed in code; the Upstash purge listed under **Outstanding owner actions**
above is the half that still needs doing.

Everything sent to that endpoint is assembled in `src/services/ai/`, which is
the only part of the product that speaks to a model. `grounding.mjs` rejects any
field whose verbatim span does not appear in the document it was supposedly read
from, and every field it returns is marked `ai-inferred` and cannot enter
arithmetic until a person confirms it. That is an integrity control rather than a
privacy one, but it is where the boundary is, so it is worth knowing it is one
place and not several.

**2. Library scripts from cdnjs**: exceljs, jsPDF, mammoth, xlsx and pdf.js.
These are fetched, not sent to — no document goes with the request. The pdf.js
worker is the exception worth naming, because it is fetched and then *executed*:
`verifiedWorkerURL()` refuses to load an unpinned worker, fetches with
`credentials: "omit"`, hashes the bytes with SHA-512 and compares them against a
pinned digest before running them. A worker that fails the check is not run.

**3. Files the user saves.** The decision pack, the quote comparison document,
the jsPDF exports, and each store's `export…()` function. An export is plain
JSON or HTML on the user's disk, outside anything this application controls.
`exportLots()` in particular produces the full supplier-quality record.

**No store is ever sent anywhere.** No load function from any of the five
appears in any request body — checked by grep, not by memory. The stores are
read to render screens and to build documents the user saves, and that is all.

## What never touches the network at all

The newest and most sensitive parts of the product are also the most isolated,
which is not a coincidence — both follow from choosing rules over a model.

- **Should Cost Expert**, all three modes: material planning, certificate
  checking and mill performance. No model call, no endpoint.
- **Document extraction** (`extract-document.mjs`). A PDF is read into text in
  the browser by pdf.js and matched against written rules. There is no OCR
  service, no extraction endpoint and no prompt, so there is nothing to leak —
  and nothing to inject, because a drawing note saying "ignore the above" is a
  drawing containing that sentence and matches no rule.
- **Inbox classification** (`classify.mjs`). Deterministic for the same reasons.
- **The build-up comparison** and every calculation in `src/calc/`.

A user can therefore run the entire should-cost, certificate and mill workflow
with the network unavailable, and nothing about those documents will have left
the machine.

## What this means in practice

Stated plainly because the code cannot state it:

- **A shared or public machine keeps the record.** There is no sign-out, because
  there is no account. Everything above stays in that browser profile until the
  site's data is cleared.
- **Clearing site data destroys it irrecoverably.** There is no server copy and
  no undo. The export functions exist for this reason and nothing prompts anyone
  to use them.
- **Private browsing keeps nothing.** The stores will appear to work and will be
  empty on the next visit.
- **A second device starts empty.** Sharing a record means exporting a file and
  moving it.
- **An export is an ordinary file.** Once saved it is subject to whatever
  protects that disk, which is not this application.
- **A browser that blocks site data is handled, not hidden.** Every store
  reports `available: false` rather than appearing to save; a write refused by
  storage returns the error rather than failing silently.

## What has not been assessed

Named so the gaps are not mistaken for clean results.

- **No penetration test, dependency audit or threat model** has been performed
  against any of this.
- **The five cdnjs libraries carry no integrity check except the pdf.js worker.**
  The `<script>` loads have no `integrity` attribute; a compromised CDN response
  would execute. The worker path shows what closing this would look like.
- **`unsafe-inline` remains in the script-src CSP**, with 132 inline handlers
  still to migrate. Measured and ratcheting down; see `CLAUDE.md`.
- **Nothing has been reviewed by anyone but the author and this tool.**
- **Retention, lawful basis, controller and processor roles, and any obligation
  arising from holding supplier-quality data are not addressed here.** They are
  questions for a qualified person and are deliberately left open rather than
  guessed at.
