# Implementation status — BuyrWorld, packs v4 and v5

**Where this stands is the table below.** The record of how it got here is
`docs/HISTORY.md`, which is history by construction rather than by being
further down the page.

## What exists now

| Capability | State | Where |
|---|---|---|
| Should-Cost Studio, three columns | built | `index.html`, `app.js` |
| Upload drawing / No drawing, equally | built | `scEntry` |
| One model behind both routes | built | `src/studio/scenario.mjs` |
| Provenance, "I don't know", field help | built | `SC_FIELD_HELP` |
| Save and reopen a draft | built | `src/services/studio-store.mjs` |
| A late drawing compares, never overwrites | built | `compareExtraction` |
| Engineering requirements (v4 C1) | built | `src/studio/requirements.mjs` |
| Part Builder, bounded (v4 C2) | built | `src/studio/geometry.mjs` |
| Technical-review package (v4 C3) | built, within its limits | `src/studio/review-export.mjs` |
| Described edits, validated (v4 C4) | built | `src/studio/edit-proposal.mjs` |
| Instructions read by rule, no model | built | `src/studio/read-instruction.mjs` |
| Rotatable preview, feature selection | built, unseen in a browser | `src/render/` |
| Offline review dossier | built, unrun here | `scripts/build_part_review.py` |
| **v5 Phase 1** — read a picture of a drawing | built, no provider configured | `src/intake/` |
| A drawing viewer, and a queue somebody reviews | built | `src/intake/viewer.mjs`, `src/intake/review.mjs` |
| Scanned and mixed PDFs, page by page | built, unrun against a provider | `src/intake/vision-read.mjs` |
| **v5 Phase 2** — the same figures, said as a case | built | `src/case/narrative.mjs` |
| Role and depth, which never hide a material risk | built | `src/case/projection.mjs` |
| Specialists, consulted only where the case holds enough | built | `src/case/specialists.mjs` |
| A draft brief for a manager | built | `src/case/brief.mjs` |
| A task-led way in, and what changed since last time | built | `src/case/intake.mjs`, `src/case/briefing.mjs` |
| **v5 Phase 3** — three what-ifs, in exact money | built | `src/calc/scenarios.mjs` |
| The what-ifs on the page, adopted with a name against them | built | `app.js` |
| The chain, as the case knows it | built | `src/case/supply-scene.mjs` |
| **v5 Phase 4** — before, during and after a call | built | `src/case/call.mjs` |
| Commitments read out of notes, by rule | built | `src/case/call.mjs` |
| Notes kept only when somebody saves them | built | `src/services/call-store.mjs` |
| Dictation | built, deliberately switched off | `src/services/speech.mjs` |
| Practice against a rule-driven supplier | built | `src/case/practice.mjs` |
| **v5 Phase 5** — a model written and read back exactly | built | `src/studio/model-io.mjs` |
| The part carried into the costing form, deliberately | built | `src/studio/to-cost.mjs` |
| Confirmed drawing dimensions reaching the builder | built | `src/studio/from-drawing.mjs` |
| **v6 Phase 1** — guided and expert views over one scenario | built | `scView`, `SC_STEPS` in `app.js` |
| Panels moved between layouts, never duplicated | built, executed in tests | `scCapturePanels`, `scPanelsHome` |
| A missing answer that produces a question to ask | built | `SC_FIELD_HELP`, `scGapCardHTML` |
| What each gap costs you, and what survives it | built | `scStillAvailable` |
| Every open question in one place, grouped by who answers | built | `scAskQuestions` |
| The result leading with what it establishes | built | `scVerdictHTML` |
| Two worked examples, complete and with a gap | built | `scExample` |
| The optional model behind an explicit action | built | `scShowBuilder` |
| The commercial basis in the review package | built | `scCommercialBasis`, `review-export.mjs` |
| Capability wording reconciled with what runs | built | the capability table in `index.html` |
| An explicit assumption, refused without a basis | built | `scAssumeApply`, `_scAssumed` |
| Comparing a supported change to the plan | built, material plan only | `SC_VARIATIONS`, `scBuildPlan` |
| The studio's rules in their own stylesheet | built | `studio-enhancements.css` |

## What does not exist

| | Why |
|---|---|
| A solid-model or drawing export | No geometry kernel. The package names both as absent, with reasons, and is never marked complete. |
| Curves, fillets, chamfers, freeform | The builder is rectangular blocks, through-holes and rectangular pockets, and says so. |
| A configured AI provider | Instructions are read by written rule — the path that must keep working after one arrives. |
| Working dictation | The machinery is built and tested; no recogniser is handed to it. The browser's own sends audio to the vendor, and this site says it sends nothing anywhere. Switching it on is a decision about that. |
| A configured extraction service | `src/intake/extract-document.mjs` reads by rule, offline, and proposes unconfirmed candidates. |
| Model-to-cost linkage, automatic | Still deliberate, and now built as the explicit transfer the audit asked for: allowances are typed, the blank is worked out, and a person carries it over with their name against it. Purchased mass never crosses — that follows from the layout and the stock actually bought. |
| Comparing cost between two plans | The cost elements are **amounts** for the plan as entered, not rates. Re-running with a different stock size or quantity would attach the same money to a different purchase, producing a per-part figure that looks calculated and is not. The comparison therefore covers the material plan and says so; comparing cost needs rate-based entry, which this does not have. |
| Comparing a different order quantity | The same reason, and the sharpest case of it: with amounts rather than rates, ordering twice as many would report the same total cost. Offering it would be worse than not offering it. |
| Any browser verification | See below. Still true after v6 Phase 1: the view switching is executed against a DOM shim in `tests/integration/should-cost-view-switch.test.mjs`, which found a real `insertBefore` fault that source-reading tests had passed over — but a shim is not a browser and says nothing about layout, focus order, touch or paint. |
| Any real case | The corpus is zero. Every engine has only met synthetic fixtures. |

## What to do next

**`docs/BROWSER-CHECKS.md`** — 99 checks in the order worth doing them, each
mapped to the pack acceptance line it closes. **Nothing here has been opened
in a browser**, and v5 Phases 1 to 4 have added a reader, a case view, three
what-ifs, a chain, three call screens and a practice room since that list was
written. Sections 9, 10 and 11 cover them. Section 11 is the one to do first,
and to do at 390px: a call happens on a phone.

**v5 Phase 5 is built** — the exact roundtrip and the reviewed model-to-cost
transfer — so what is left of the roadmap is the cross-phase work it always
said would be: actual screenshots, an evidence log, and the browser pass above.

The two things Phase 5 deliberately did not do. There is still no CAD kernel,
so `model.step` remains listed as unavailable with the reason, and
`tests/security/public-claims.test.mjs` now fails if anything is written out
under a name an engineer would open as a solid. And the transfer carries the
blank, never the purchase quantity: how many are bought is the layout's answer,
and joining those two would be the silent linkage the audit warned about.

Two things Phase 3 deliberately stopped short of, so they are not mistaken
for oversights. Adopting an option records the decision and does not apply it
to the plan — applying it needs a plan somebody can edit, which this tool
does not yet have. And the chain reads the case; nothing writes back to it.

**Running it, and what it needs**: `docs/OPERATING.md` — the local run, both
API contracts with their limits and refusals, the environment variables by
name, retention, and what would have to change for each unavailable thing to
work. Its library table, its endpoint limits and its model ids are checked
against the code.

**What is actually evidenced**: `docs/EVIDENCE.md` — every claim this product
makes about itself, what backs it, and the longer list of what does not. Its
figures are checked against the tree, and the sentences somebody would be glad
to delete are held there by a test.

**Deploying and undoing it**: `docs/ROLLBACK.md`. Pushing to `main` deploys
production, and until now nothing said how to put it back. It also says what a
rollback cannot reach — what is already in somebody's browser — which is the
part worth reading before it is needed.

Then one real case end to end, which would teach more than the next feature.

## Decisions

- **The pack's reference implementations are not adopted.** `material-planning.mjs`
  and `money.mjs` are reference code; the repository's equivalents are verified
  and exact. Adopting the pack's would be a regression.
- **The approved PNG governs composition, not arithmetic.** Its stage prices do
  not reconcile with its headline total, its nesting figure is not a geometric
  result, and its High/Medium confidence chips are explicitly rejected by
  `design/04-APPROVED-STUDIO.md`. None of them enter the code.
- **Provenance vocabulary** follows the pack: *User confirmed*, *Extracted —
  check this*, *Assumed*, *Missing*. The repository's existing `provenance.mjs`
  already distinguishes these; the labels are a presentation mapping onto it.

---

## How it was built

The record of why each thing is the way it is — in the order the work
happened, and not edited to agree with today — is **`docs/HISTORY.md`**.

It used to sit below this table, which is how the document came to say one
feature was unstarted two lines above the entry recording it done. Ordering
was doing work that a separate file does properly.
