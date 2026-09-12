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
| MEDIUM | CDN libraries without Subresource Integrity | jsPDF, ExcelJS and the document parsers load from a public CDN. |
| — | Spreadsheet formula injection | **Not applicable.** The audit listed this as a risk class, but this codebase has no CSV or XLSX export path — XLSX is read only, and exports are HTML-as-`.doc` and jsPDF. Re-check if a spreadsheet export is ever added. |
| MEDIUM | Prompt injection in the tools other than claim review | The claim-review prompt labels the letter as untrusted data; the quote, contract and minutes prompts do not yet. |
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
- **Commit authorship.** Author name and email appear on every commit.
- **Repository ownership.** The hosting account name is visible.
- **Domain registration** and hosting account details.
- **The legal notice.** The registered company name, company number and
  registered office remain on the legal page. That is corporate rather than
  personal information, and removing a real company's legal identity from a live
  site is not a change to make automatically — **flagged for owner review**.
