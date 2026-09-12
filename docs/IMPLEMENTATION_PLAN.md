# Implementation plan

Status against the seven phases. Honest about what is done and what is not.

| Phase | Status |
|---|---|
| 0 — Safety and evidence | **Done.** Baseline in `CURRENT_STATE.md`. |
| 1 — De-commercialise and anonymise | **Done.** Verified by `scripts/verify-content.mjs`. |
| 2 — New product shell | **Partial.** Homepage, navigation, metadata and positioning done. Domain model not built. |
| 3 — Flagship workflow | **Not started.** |
| 4 — ProcureBench | **Not started.** |
| 5 — Security hardening | **Partial.** Logging, citations and truncation resolved in earlier sessions; XSS, headers, rate limiting and file limits open. |
| 6 — UX and accessibility | **Not started.** |
| 7 — Verification and handover | **Partial.** Content verification and documentation done; no test suite exists to run. |

Phases 3, 4 and 6 are substantial engineering. They were not attempted rather
than attempted badly — a half-built workflow with placeholder buttons would be
worse than none, and the brief forbids pretending.

---

## Phase 2 completion — domain model

Nothing else can be built properly first.

1. Decide the stack. Recommendation: TypeScript and Zod, compiled with Vite,
   tested with Vitest. **Check the hosting project's build settings before
   adding a `package.json`** — the project currently has no build step and
   introducing one may change how it deploys.
2. Implement `domain/` as schemas first, types derived from them, so runtime
   validation and compile-time types cannot drift apart.
3. Implement `Tracked<T>` and `Money` before any entity uses them. Retrofitting
   provenance is far harder than starting with it.
4. Write the synthetic worked case as a fixture. It is the specification for
   every screen that follows.

**Done when:** a synthetic case round-trips through the schemas, and an
`ai-inferred` field cannot enter a calculation without confirmation.

## Phase 3 — one vertical slice

Build one complete path, not ten partial screens: baseline → claim →
decomposition → evidence → calculation → scenarios → options → decision pack.

Order matters. Build the **cost bridge with its tests first**, before any UI.
It is the part that makes the product defensible, and it is testable with no
interface at all.

Then repoint the existing Price-Increase Defender at it — replacing the
model-invented `JUSTIFICATION STRENGTH: NN/100` with a computed warranted range
and an explicit unsupported remainder. That single change converts the product
from prose to evidence.

**Done when:** the synthetic case produces a decision pack in which every number
traces to a formula and every formula to an input.

## Phase 4 — ProcureBench

20+ fictional cases covering unit conversion, currency movement, wrong index
period, index lag, driver weighting, caps and floors, retrospective application,
temporary surcharge, freight double counting, Incoterm inconsistency, MOQ
consequences, payment terms, volume breaks, missing evidence, contradictory
evidence, unsupported margin, quote-scope differences, one-time tooling,
multi-line exposure — and at least one where accepting is the right answer.

Each case: inputs, expected extraction, expected calculation, expected evidence
gaps, acceptable recommendation boundaries, unacceptable hallucinations.

**Do not tune cases to flatter the system.** A case the engine fails is more
valuable than one it passes.

## Phase 5 — remaining security

In severity order: the filename XSS, then rate limiting on the AI route, then
CSP and security headers, then file size and type limits, then spreadsheet
formula-injection escaping, then Subresource Integrity or bundling for the CDN
libraries. Details and current status in `SECURITY_REVIEW.md`.

## Phase 6 — UX and accessibility

Evidence and confidence states are the hard part: a figure must *look* different
depending on whether it is supplied, derived or assumed, without the interface
becoming noisy. Target WCAG 2.2 AA. Test tables, exports and keyboard paths.

## Phase 7 — verification

Build a single script running: type check, lint, unit tests, integration tests,
security tests, build, ProcureBench, and `verify-content.mjs`. Only the last of
these exists today.

---

## Sequencing risk

The temptation is to build screens, because screens are visible. The order that
actually works is the reverse: **schemas, then calculations, then tests, then
interface.** A beautiful case workspace on top of arithmetic nobody can verify
reproduces exactly the problem this rebuild exists to solve.
