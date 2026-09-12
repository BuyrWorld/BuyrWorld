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

## Partially addressed

**Unsafe rendering.** Rendering added in this work is safe: `attrEsc()` escapes
quotes, which the pre-existing `ciEsc()` does not, and `safeUrl()` admits only
`http` and `https`. Verified against hostile input — a `javascript:` URL is
dropped, injected markup in a title is escaped, ampersands encode correctly, and
`rel="noopener noreferrer"` is set. **The pre-existing defect remains:**
`loadContractFile()` interpolates raw filenames into `innerHTML` at four points,
and `ciEsc()` output is used inside `href` and `data-name` attributes.

## Open

| Sev | Issue | Note |
|---|---|---|
| HIGH | Filename DOM XSS in the contract upload path | Fix is small — switch to `textContent`. The quote-upload path 60 lines away already does this correctly and is the pattern to copy. |
| HIGH | `/api/chat` has no identity, rate limit, quota or origin check | A public endpoint spending real model credits. |
| MEDIUM | CDN libraries without Subresource Integrity | jsPDF, ExcelJS and the document parsers load from a public CDN. |
| MEDIUM | No Content-Security-Policy, `frame-ancestors`, `Referrer-Policy` or `Permissions-Policy` | HSTS is present. |
| MEDIUM | No file size, page or row limits before parser operations | Decompression bombs and malformed files untested. |
| MEDIUM | No formula-injection escaping in spreadsheet exports | A cell beginning `=`, `+`, `-` or `@` executes when the file is opened. |
| MEDIUM | Prompt injection from uploaded documents | Document text is delimited in some prompts but never labelled as untrusted data that cannot change instructions. |
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
