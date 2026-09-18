# v5 Phase 0 — reconciliation against HEAD

`specs/02-ROADMAP.md` Phase 0: *"Inspect current code, prior update patch and
repository instructions… mark the gap matrix with file evidence. Port only
missing prior fixes."*

**Baseline:** `ef09fdf`, `main`, clean. 2,537 tests, all six checks pass.

The pack audited public main at `29bf84a` and says to recheck HEAD. That is
the right instruction: `29bf84a` was superseded by a twelve-commit merge on
16 September, and four of the matrix rows have moved since.

## The gap matrix, at HEAD

| Pri | Row | Pack's status | At `ef09fdf` | Evidence |
|---|---|---|---|---|
| P0 | Read pictures and scanned drawings | PDF-only input and handler | **Confirmed, unchanged** | `index.html` `scx-file` and `ctx-file` both `accept=".pdf,application/pdf"`; `exRead` gates on `/\.pdf$/i` |
| P0 | Reliable case memory | "full engineering state needs persistence" | **Done since the audit** | `studio-store.mjs` schema 2 stores `model` + `requirements`; `scClearSession` clears nine pieces of state; `session-boundary.test.mjs` |
| P1 | Task-led home / five entry routes | Concept only | **Missing** | No intake router exists |
| P1 | Specialists sharing one case | No orchestration | **Missing** | `propose-edit.mjs` is one adapter, not orchestration |
| P1 | Career-stage guidance | Personas specified | **Missing** | No role/depth/scope controls |
| P2 | Visual supply chain + what-if | Ideas only | **Missing** | — |
| P2 | Daily briefing | Concept | **Missing** | — |
| P3 | Practice / pocket assistant | Concepts | **Missing** | — |
| P3 | Richer CAD and review | Bounded work exists | **Partial, improved since** | `geometry.mjs`, `review-export.mjs`, and `dxf-export.mjs` added after the audit |

## Prior pack: reconciled, nothing to port

The pack says the 16 September update "was not pushed by us" and must be
reconciled feature by feature. It was applied on a branch, verified, merged
and deployed. Every feature it lists is present at HEAD:

| Feature | Evidence |
|---|---|
| SVG geometry views | `src/render/part-view.mjs` |
| Live pending resize | "Preview · not applied" in `studio-view.mjs` |
| Stable feature IDs | `issuedIds` in `geometry.mjs` |
| Geometry snapshot export | `part-model.json` in `review-export.mjs` |
| Python review dossier | `scripts/build_part_review.py` |

**Nothing to port.** The pack's warning about older full-file replacements
overwriting newer source is the live risk here, and the reason nothing from
`prior-packs/` is being applied: HEAD is ahead of both ZIPs.

## The "retain" list, all present

Manual *No drawing* entry, the block/hole/pocket studio, requirement rows,
bounded edit history, review export — each verified at HEAD.

## Leak isolation, which the pack asks to verify

The five integration points it names — `scSaveDraft`, `scFormScenario`,
`scApplyScenario`, `scNewDraft`, `scClear` — were the subject of a fix on
16 September. Geometry, requirements, provenance, scenarios, undo history, a
prepared export and a pending drawing comparison are all cleared between
cases, and a test reads the module-level `_sc` declarations and fails if
`scClearSession` misses one.

## What Phase 1 actually needs, and what it cannot have

Phase 1 is the P0 that is still real: **reading pictures**.

Buildable here, offline, with no credentials:

- A byte-sniffing upload router, so format comes from content rather than a
  filename. The pack is explicit that widening `accept` alone still fails.
- Image preview with zoom, pan, rotate and page navigation.
- Per-page PDF text assessment, to tell a text PDF from a scanned one.
- The extraction job adapter, with an honest unavailable state.
- The confirmation queue: candidate, original text, source region, method.

**Not buildable here:** OCR itself. It needs a binary runtime and PDF
rasterisation, behind authenticated same-origin job endpoints. This
repository is static HTML/JS on Vercel with Node serverless functions and no
Python runtime, and the pack says so itself: *"A Python script in a static
repository is not a deployed service."*

So the Phase 1 gate — *"real JPG and scanned-PDF extraction demonstrated with
a configured backend"* — is **blocked**, and the pack's own instruction for
that case applies: implement and test the adapter plus honest
unavailable/manual states, and label live provider validation blocked.

An image that cannot be read must say so and offer manual entry. It must not
produce a fabricated value, and it must not silently do nothing, which is
what it does today.

---

# v5 Phase 1 — what was built, and what is blocked

`specs/02-ROADMAP.md` Phase 1: *"upload router, image/PDF viewer, extraction
worker adapter and confirmation queue… Gate: reviewable fields with source
regions; no silent pages or stale writes; real JPG and scanned-PDF extraction
demonstrated with a configured backend. If backend unavailable, record that
gate blocked while keeping preview/manual usable."*

## Built

| Piece | Module | What it changed |
|---|---|---|
| Upload router | `src/intake/file-router.mjs` | Format comes from the first sixteen bytes. Both inputs accepted `.pdf` only and the handler rejected everything else by filename, so widening one alone fixed nothing. |
| Viewer | `src/intake/viewer.mjs` | Zoom, pan, quarter turns, fit, pages, and regions anchored to the document rather than the screen. |
| Confirmation queue | `src/intake/review.mjs` | Four answers instead of two. Corrections keep the reading they replaced; decisions carry who, when and what from; a changed document sends its rows back for review and says which. |
| Page assessment | `src/intake/page-text.mjs` | Which pages were read, named rather than counted, with the sparse middle state a presence check misses. |
| Worker adapter | `src/intake/extraction-job.mjs` | The job states, the honest unavailable answer, retryable against permanent failure, and the rule for a result that arrives too late to apply. |

## The gate, line by line

**Reviewable fields with source regions — partly.** Fields are reviewable
with the four actions. Regions are supported end to end: the viewer produces
them in document coordinates, and `review.mjs` stores one on the evidence.
Nothing produces one yet, and `region` is `null` rather than a box covering
the page, because a crop that proves nothing is worse than an absent one. A
rule reader is handed a page's text and never sees geometry; regions arrive
with OCR, or with a PDF text layer read with its geometry retained.

**No silent pages — met.** `page-text.mjs` names every page that was not
read, every page that carries too little text to have been read, and every
page beyond the read limit, with both counts.

**No stale writes — met in the adapter, untested against a real worker.**
Four refusals: another case, an old revision, fields edited since the job was
sent, and a cancellation that raced the result.

**Real JPG extraction — met, by a different route than the spec assumes.**
The spec assumes a self-hosted OCR worker. This repository is static HTML and
JS on Vercel with Node serverless functions, and OCR needs a binary runtime
and PDF rasterisation it has not got — the pack says so itself: *"A Python
script in a static repository is not a deployed service."*

So the reading is done by a multimodal model through `api/read-document.js`,
which is `specs/03` route 4 rather than route 3. That is a real difference
and worth being precise about: there is no OCR layer, so there are no
character bounding boxes, and therefore still no source regions from this
route either. What there is instead is a quoted line of printed text per
value, which the browser checks actually contains the value before the
reading is shown at all.

**The privacy copy changed, and that is the part to review.** The page said
"The file never leaves this browser", unscoped. It was true when a rule-read
PDF was the only route. It is now scoped to the route where it is true, the
upload is disclosed where it is offered, and nothing is sent without an
explicit per-document consent step that says what leaves the computer, who
reads it, and that a model can misread a photograph. A test fails if an
unscoped local-only promise reappears anywhere on the page.

**Scanned PDFs — read, page by page.** pdf.js was already loaded for the
text layer and can draw a page to a canvas, which makes a scanned page the
same problem as a photograph and lets it use the route that already exists.
`page-text.mjs` names the pages this browser could not read and the offer
names them back; four are sent at a time, because the reader allows six
requests a minute and each page is one request. A twenty-page scan sent in
full would be refused halfway with no way to tell which half, so the limit is
stated in the offer instead of discovered.

Each page is sent on its own rather than four to a request: a reader given
four pages at once has to keep track of which answer belongs to which, and
that is a thing it can get wrong. One page per request cannot be confused. A
page that fails does not lose the pages that worked, and two pages
disagreeing about one field are both kept and surfaced through the same
`findConflicts` the rule-read path uses.

So the Phase 1 format list — JPEG, PNG, PDF text, scanned and mixed — is
met. A mixed PDF reads its text pages here and offers its scanned pages to be
read elsewhere, and the two sets of readings end up in one queue.

## Still open in Phase 1

- **Region selection wired to a control.** Built and tested; still not
  connected, and now said out loud rather than left as an absence. Nothing
  that reads a document here reports coordinates — the rule reader is handed a
  PDF's text layer rather than its geometry, and the vision reader is not asked
  for boxes, because a box drawn in the wrong place is worse evidence than no
  box: it looks checkable and is wrong. So `cropsSaid` counts how many
  readings carry a region and says so under the table. Today that is none of
  them, and the sentence tells a reviewer to read the quoted characters, which
  is the evidence that does exist. It is written as a count, so the day a
  reader does report regions the sentence changes by itself.
- **A corpus of real drawings.** Two synthetic fixtures show the pipeline
  works. `specs/03`'s accuracy contract wants held-out real drawings at
  several quality levels, with precision, recall and abstention reported by
  field and format, before anybody leans on the reader.

## The envelope, against specs/04

`specs/04-COMPLETE-CASE.md` describes a fuller envelope than schema 3 holds:
scenario alternatives, next actions, specialist findings, notes and outcome
events. None of those has a producer yet, and adding empty slots for them
would be guessing at their shape.

What is built instead is the rule that makes guessing unnecessary — *"migrate
older scenarios without erasing unknown values"*. A field this build has
never heard of survives being loaded and saved here, so a newer build's work
is not destroyed by an older tab opening the case. That was a real defect:
before this, it was erased silently.

One deliberate divergence. `specs/04` asks for "exact calculation
inputs/results" to be stored. The inputs are; the results are not, and that
predates this work — a reopened scenario recomputes, so it can never show a
total its own inputs no longer support. Storing a result would reintroduce
exactly that. The estimate store is where a figure somebody argued with is
kept deliberately frozen, and the two answer different questions.

## Closed since: the case envelope

The vertical slice now survives refresh, reopen and new-case reset. The
review queue is stored with the scenario at schema 3 — a version-2 record is
a version-3 record with no queue, so older saved work still opens and says
why it has none.

Two things that mattered more than the storage itself. Each decision keeps
the document reference it was made about, so reopening a case whose drawing
has since changed sends those rows back for review rather than trusting them.
And `localStorage` is a text file the person using the browser can edit — not
a privilege problem, since they could type the value instead, but an
integrity one: a stored decision that carries no record of who made it comes
back needing a look, and the count is reported rather than the row quietly
appearing unticked.
