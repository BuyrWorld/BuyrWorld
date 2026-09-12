# Implementation plan

Status against the seven phases. Honest about what is done and what is not.

| Phase | Status |
|---|---|
| 0 — Safety and evidence | **Done.** Baseline in `CURRENT_STATE.md`. |
| 1 — De-commercialise and anonymise | **Done.** Guarded by `scripts/verify-content.mjs`. |
| 2 — New product shell | **Done.** Homepage, navigation, metadata, positioning, and the calculation core beneath them. |
| 3 — Flagship workflow | **Done as a vertical slice.** Baseline → claim → decomposition → evidence → calculation → currency → scenarios → options → decision pack → outcome. |
| 4 — ProcureBench | **Done.** 21 cases, all evaluable, 100% calculation accuracy. |
| 5 — Security hardening | **Largely done.** One known weakness remains; see below and `SECURITY_REVIEW.md`. |
| 6 — UX and accessibility | **Accessibility done; visual UX not.** WCAG 2.2 AA pass complete and guarded by 20 tests. Evidence-state design, responsive testing and export layout remain. |
| 7 — Verification and handover | **Done.** `scripts/verify.mjs` runs five checks; CI runs it on every push, on Node 22 and 24. |

## What exists

| Module | What it does |
|---|---|
| `src/calc/exact.mjs` | BigInt money and ratio arithmetic. No floating point anywhere. |
| `src/calc/index-series.mjs` | Index movement from a contractual base period, with lag. Never interpolates a missing observation. |
| `src/calc/cost-bridge.mjs` | Weighted driver decomposition, caps, collars, floors, exposure, the unsupported remainder. |
| `src/calc/fx.mjs` | Dated conversion, and the cost / FX / cross-term split that keeps a rate move out of the cost argument. |
| `src/calc/evidence.mjs` | Evidence kinds, coverage by weight of unit cost, contract contradictions. |
| `src/calc/decision-pack.mjs` | The auditable document. Recommendation derived by rule, with the rule printed. |
| `src/calc/outcome.mjs` | What was agreed, what it avoided, what it teaches, aggregated across cases. |
| `src/services/outcome-store.mjs` | Local-first storage. BigInt-safe, and every browser failure mode handled. |
| `src/render/decision-pack-html.mjs` | Print-clean output, everything escaped. |

231 tests, 21 ProcureBench cases, five verification checks, all run by CI.

---

## What remains, in priority order

### 1. Purge the stored prompt logs, rotate the credentials

Console work. `scripts/purge-prompt-logs.mjs` is ready and dry-runs by default.
Until it is run, the audit's critical finding is only half closed: the code
stopped writing prompt content, but what was written before is still stored.
This is the largest outstanding risk in the project and the only one that cannot
be closed from the repository.

### 2. Remove `'unsafe-inline'` from `script-src`

The CSP is otherwise tight, but `script-src` still needs `'unsafe-inline'`
because the page carries **130 inline event handlers** and **2 inline script
blocks**. Neither can be covered by a hash or a nonce: hashes work for inline
`<script>` elements but never for `onclick`-style attributes.

This is a large, genuinely risky change to a fragile file, and it should be done
in deliberate batches rather than one pass:

1. Move the two inline `<script>` blocks into files under `src/`. Mechanical,
   and a prerequisite.
2. Convert handlers to delegated listeners, a section at a time, running
   `node scripts/verify.mjs` between each batch. The div-balance and dead-link
   checks catch the usual breakage.
3. Handlers generated at runtime inside template strings — the driver table, the
   outcome argument rows, the supplier cards — are the awkward part. They need
   `data-` attributes plus one delegated listener each.
4. Only when the count reaches zero, drop `'unsafe-inline'` and delete the
   ceiling assertion in `tests/security/html-sinks.test.mjs`.

**What makes this survivable in the meantime:** `unsafe-inline` weakens the
defence against *injected* script, which matters only if an injection point
exists. Every sink that writes a variable into HTML has been audited and is
either escaped or on a documented allowlist, and a test fails if a new
unescaped one appears.

### 3. Make the rate limit real

The per-IP bucket in `api/chat.js` lives in module scope, so it is per warm
instance rather than global. It raises the cost of casual abuse; it is not a
defence against a determined one. A real limit needs shared state.

### 4. Phase 6 — the visual half

The accessibility pass is done: contrast verified against both the page ground
and card surfaces, every click target keyboard-operable, focus restored where
the input reset had removed it, a skip link and main landmark, focus moved on
route change, every control named, reduced motion covering all 17 animations,
and aria-current on the navigation. 20 tests hold it in place.

What remains is design rather than compliance. Evidence and confidence states
are the hard part: a figure must *look* different depending on whether it is
supplied, derived or assumed, without the interface becoming noisy. Responsive
behaviour and export layout have not been tested on real devices.

### 5. The domain model as originally specified

`TARGET_ARCHITECTURE.md` lists 26 entities. What exists is the calculation core
and the records around it — enough for one workflow, not the full ontology.

TypeScript and Zod were deferred, not rejected. The blocker is practical: the
hosting project has no build step, and adding a `package.json` can change how it
builds and deploys. Check the project's framework settings first. CI fails
deliberately if a manifest appears, so this cannot happen by accident.

### 6. Document extraction into the typed model

Extraction still produces prose for a human to read rather than fields for the
engine to consume, so the confirmation step the architecture describes has
nothing to confirm yet. This is what would let a supplier letter populate a case
instead of being read alongside one.

---

## Sequencing risk

The temptation is to build screens, because screens are visible. The order that
actually worked here was the reverse: **schemas, then calculations, then tests,
then interface.** The cost bridge existed and was tested before anything
rendered it, and ProcureBench found a £12,600 rounding defect that the unit
tests had missed because they used round numbers.

A beautiful case workspace on top of arithmetic nobody can verify would
reproduce exactly the problem this rebuild exists to solve.
