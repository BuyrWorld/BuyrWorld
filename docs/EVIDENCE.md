# What is actually evidenced

The v5 roadmap asks for an evidence log across all phases. This is it: every
claim this product makes about itself, what backs it, and — the half that
matters — what does not.

The order is deliberate. A reader who stops after the first table has read the
good news; the second table is the one to read before repeating any of it to
anybody else.

Recorded 18 September 2026. `tests/security/documentation.test.mjs` checks the
figures below against the tree, so a number here that has drifted fails a run
rather than misleading a reader.

## Evidenced by something that runs

| Claim | What backs it |
|---|---|
| The arithmetic is exact | 76 modules under `src/`, money as integer minor units on BigInt, ratios scaled by 1e9. `tests/security/no-floats.test.mjs` is a ratchet: every floating-point construct in `src/calc` is listed with why it is safe, and anything else fails. |
| A figure shown to a person came from code, not from a model | `api/chat.js` returns text and citations; every percentage and money figure is computed in `src/calc`. The decision-pack join test asserts the warranted change, the scenarios and the recommendation are byte-identical with and without the sections that could have moved them. |
| A supplier's claim is decomposed the same way twice | 21 ProcureBench cases, run on every push. |
| An extracted value cannot be used before somebody confirms it | 18 extraction cases, and the runner's own headline number is ungrounded values **accepted**, which must be zero. |
| A drawing reading is measured, not asserted | `scripts/eval-drawings.mjs` — precision, recall, abstention and coverage by field and by format, with every critical misread listed. One critical misread fails the run. |
| The page has no inline event handlers | Counted in `documentation.test.mjs` and asserted at zero, which is what let `script-src` drop `unsafe-inline`. |
| Nothing written into the page is unescaped | `tests/security/html-sinks.test.mjs` reads every interpolation reaching `innerHTML`; each is escaped or listed with a reason. |
| Notes taken in a call are stored only on an explicit save | `src/case/call.mjs` has no storage and imports nothing that can; the wiring test writes, reads, decides, copies and recalculates, then asserts the store is empty. |
| Practice cannot alter a live case | `src/case/practice.mjs` imports nothing at all. |
| A part model survives being written and read | Write, read, write — identical byte for byte, including a dimension no float could hold. |
| The page cannot ask the engine for something it does not have | `tests/security/engine-surface.test.mjs` compares all 254 names the page reads against the 364 the mount provides. A misspelling here is silent — every call site is guarded — so it is compared rather than trusted. |
| Nothing is offered under a name it is not | `public-claims.test.mjs` reads every filename the product writes out and fails on a solid-model extension. |
| 3,671 tests across 127 files, seven checks | `node scripts/verify.mjs`, on every push, Node 22 and 24. |

## Not evidenced, and why

| Claim nobody should make | What is missing |
|---|---|
| **It works in a browser** | Nothing in this product has ever been opened in one. Every check above runs the served bytes under `node:vm`, which is blind to layout collisions, focus traps, controls unreachable by keyboard and text that clips at 200%. `docs/BROWSER-CHECKS.md` is 99 checks in the order worth doing them. |
| **The readings are accurate** | The corpus is two synthetic fixtures with recorded replies. `specs/03` is explicit that those test routing and evaluator behaviour only, and the production gate it describes — held-out real drawings at several quality levels — is BLOCKED. |
| **The numbers are right about the real world** | Every engine has only met synthetic fixtures. No real case has been run end to end. One would teach more than the next feature. |
| **A live provider behaves as the adapter expects** | No provider is configured. The vision reader, the edit proposer and the document worker each have an adapter, a tested unavailable state and no credential. The recorded replies prove what the pipeline does with an answer, not what a model would say today. |
| **The Python review tool runs** | Python is not installed on the machine this was built on. Its six tests have never been executed here; the pack reports them passing in its own environment, which is its evidence and not mine. |
| **Anybody has used it** | No user testing, recorded or otherwise. `RELEASE-GATES.md` asks for it and the honest answer is NOT RUN. |
| **It is secure, compliant, or enterprise-ready** | `docs/SECURITY_REVIEW.md` says what was reviewed and, at more length, what was not. |
| **Dictation works** | Built, tested and deliberately switched off — the browser's recogniser sends audio to the vendor, and this site says it sends nothing anywhere. |
| **There is a solid model** | No CAD kernel. `model.step` and `drawing.pdf` are listed as unavailable with the specific obstacle, not a shrug. |

## The shape of the failure this log exists to catch

Three times this month a mechanism was documented, tested, and unable to fire
in the product: `assertUsable()` was never handed an ai-inferred value, the
stale-extraction rule was never handed an edit time, and a detached requirement
was never handed a feature list. All three were found by building the thing
that finally supplied the missing input, not by the tests that named them.

So "tested" in the first table means a test exists and passes. It does not
mean the path is reachable by a person, and the only instrument for that is the
browser pass in the second.
