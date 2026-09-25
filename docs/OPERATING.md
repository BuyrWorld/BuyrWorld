# Running it, deploying it, and what it needs

The pack asks for *"dependency locks, local run instructions, API contracts,
deployment requirements, retention settings and environment variable examples
without secrets."* This is those, in that order, with the honest answer where
the answer is "none".

Recorded 18 September 2026.

## Dependencies, and the lock that does not exist

There is no `package.json`, no lockfile and no build step, and that is
deliberate rather than unfinished. Nothing in `src/` imports anything that is
not in this repository: the calculation engine, the readers and the stores are
plain ES modules, and the tests run on Node's own runner. There is nothing to
lock because there is nothing to install.

The page does load libraries from a CDN, each pinned to an exact version and
constrained by the `script-src` in `vercel.json`:

| Library | Version | What for |
|---|---|---|
| `jspdf` | 2.5.1 | PDF export. Core fonts only — a custom font breaks it. |
| `xlsx` | 0.18.5 | Reading spend and quote workbooks |
| `exceljs` | 4.4.0 | Writing them back out |
| `pdf.js` | 3.11.174 | The PDF text layer and the page images, including its worker |
| `mammoth` | 1.6.0 | Reading .docx contracts |
| TradingView | — | The market charts, in an iframe of their own |

That is the only third-party code the product runs, and it runs in the browser
rather than in anything that builds. `tests/security/documentation.test.mjs`
checks this list against what `app.js` actually loads.

**Node 22 or 24.** CI runs both. Anything older lacks the test runner features
this uses.

## Running it locally

```
node scripts/verify.mjs              # everything: 3,669 tests, 7 checks
node --test tests/unit/call.test.mjs # one file
python -m http.server 8000           # serve the site, if Python is available
npx serve .                          # or this, if it is not
```

Open `http://localhost:8000`. Every tool that does arithmetic works with no
key, no network and no function — that is the point of the engine being in the
browser. What does **not** work locally without more setup:

| Needs a function | What happens without one |
|---|---|
| Buyr AI chat | The page reports the assistant is unavailable. |
| Reading a picture of a drawing | `workerConfigured` is false; the review queue says so and manual entry stays usable. |
| Supplier Discovery, Market Intelligence | Same: the panel says it could not reach the service. |

To run the functions locally you need the Vercel CLI (`vercel dev`) and a key
in `.env.local`. Neither is required to work on the engine, which is where
almost all of the behaviour lives.

## The two endpoints

Both are POST-only, both refuse cross-origin requests, both rate-limit per warm
instance, and neither logs any content. The per-instance limitation is stated
rather than glossed: a distributed caller gets a bucket per instance, which
raises the cost of casual abuse and is not a defence against a determined one.

### `POST /api/chat`

The assistant and the web-grounded panels.

```jsonc
// request
{ "messages": [ { "role": "user", "content": "…" } ] }

// 200
{ "text": "…", "sources": [ … ], "partial": false, "searchError": null }
```

| | |
|---|---|
| Model | `claude-sonnet-4-6` |
| Ceiling | `maxDuration: 300` (Vercel Pro); the function aborts itself at 270s |
| Rate limit | 12 requests per minute per client, per warm instance |
| Refuses | 405 not POST · 403 wrong origin · 429 over the limit · 400 no messages · 502 upstream failed · 504 search timed out |
| Citations | Returned, not discarded. Any web-grounded claim on screen shows its source. |

### `POST /api/read-document`

Reading a photograph or scan of a drawing or a certificate. Deliberately not a
prompt proxy: the instruction is built server-side from the same module the
browser checks the answer with, so nothing a caller sends becomes an
instruction. Somebody who finds this endpoint can spend credits having pictures
read; they cannot use it as a general model.

```jsonc
// request
{ "image": "<base64>", "mediaType": "image/jpeg", "target": "drawing" }

// 200
{ "text": "…", "truncated": false, "model": "claude-sonnet-5" }
```

| | |
|---|---|
| Model | `claude-sonnet-5` |
| Ceiling | `maxDuration: 60` |
| Rate limit | 6 requests per minute per client, per warm instance |
| Image | 4.5MB after base64 decode; `image/jpeg`, `png`, `webp`, `gif` |
| Target | `drawing` or `certificate`, and nothing else |
| Refuses | 405 · 403 · 429 · 503 no key configured · 400 no image or bad target · 415 wrong type · 413 too large · 502 upstream · 504 timeout |
| Truncation | Reported. A reply cut short is a partial reading, and a partial reading of a drawing is the kind of thing somebody confirms without noticing what is absent. |

## Environment variables

Names and purposes only. No values are in this repository, and none should be.

```sh
# Required for either endpoint to work at all.
ANTHROPIC_API_KEY="sk-ant-…"        # set in Vercel project settings

# Used only by tests and tools that talk to a deployed instance.
BW_ENDPOINT="https://www.buyrworld.com"

# NOT required, and scheduled for deletion — see below.
UPSTASH_REDIS_REST_URL="https://…"
UPSTASH_REDIS_REST_TOKEN="…"
```

With no `ANTHROPIC_API_KEY`, `/api/read-document` answers 503 and the browser
reports the reader as unconfigured rather than failing silently. That is a
tested state, not a hypothetical one.

**The two `UPSTASH_*` variables are outstanding work only the owner can do.**
Nothing in the deployed product reads them any more — the prompt logging they
served was removed in the September audit — but historical stored prompt
content may still exist in that instance. Deleting it is three steps, in this
order:

```sh
node scripts/purge-prompt-logs.mjs --confirm    # delete what is stored
# then rotate ANTHROPIC_API_KEY and the Upstash token
# then delete both UPSTASH_* variables from the Vercel project
```

Until that is done, this is the most important line in this document.

## Retention

| Where | What | For how long |
|---|---|---|
| The browser | Seven `localStorage` stores — cases, outcomes, parts, lots, estimates, Studio scenarios, call notes | Until somebody clears them. `docs/SECURITY_REVIEW.md` lists what each holds. |
| The functions | Nothing. Metadata-only telemetry: request id, timestamp, model, character counts, latency, status, error class. | Vercel's own log retention |
| Anthropic | Whatever their API retention is for the requests made | Theirs, not ours |

Never log prompt content, document text or user input. That was the September
audit's critical finding, and it is the one rule in `CLAUDE.md` marked
non-negotiable.

## Deploying

GitHub → Vercel, project `buyr-world`, team `buyrworlds-projects`, Pro plan.
Push to `main` deploys production; any other branch gets an SSO-protected
preview. `framework: null` — there is no build step to configure.

`.vercelignore` keeps tests, scripts, docs, fixtures, `CLAUDE.md` and the
design handoff out of the deployed surface. **`src/` must stay deployed**:
`index.html` imports the calculation modules from it at runtime.

`vercel.json` carries the security headers, including a `script-src` with no
`'unsafe-inline'` — which is why an inline `onclick` will not run, and why the
page asks for actions by name through a table in `app.js`.

To undo a deploy: `docs/ROLLBACK.md`.

## What would have to change for an unavailable thing to work

Each of these is a decision rather than a missing afternoon, which is why they
are written down here rather than left in a backlog.

| Unavailable | What it would take |
|---|---|
| Dictation | A decision about audio leaving the device — the browser's recogniser sends it to the vendor — **and** a change to `vercel.json`, whose `Permissions-Policy` currently denies `microphone=()` outright. The state machine, the pause and stop, and the typed fallback are already built and tested. |
| Model-proposed geometry edits | A transport handed to `src/services/ai/propose-edit.mjs`. Everything it returns already goes through the same validator a typed instruction does. |
| A solid model export | A CAD kernel. `model.step` is listed as unavailable with the specific obstacle: a blind pocket needs a boolean subtraction. |
| Trusting a drawing reading | Held-out real drawings at several quality levels, scored by `scripts/eval-drawings.mjs`. Until then every value stays proposed until a person confirms it. |
