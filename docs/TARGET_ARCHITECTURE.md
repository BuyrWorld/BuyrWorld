# Target architecture

Parts of this are now built. Sections that describe something which exists say
so and name the module; everything else is still a target. The distinction
matters — a design document that reads as entirely aspirational when half of it
has shipped misleads as much as one that claims too much.

## Principle

**The model extracts and explains. Code calculates.** Every number a buyer might
put in front of an approver must be reproducible without a language model in the
loop. This single rule drives the whole structure below.

## Shape

`[built]` marks what exists today.

```
src/
  domain/          typed entities + Zod schemas — no I/O, no framework
  calc/            [built] pure deterministic functions — no I/O, no AI, fully tested
  data/            [built] the synthetic index series the demonstration ships
  render/          [built] decision pack output
  features/
    cases/ baselines/ claims/ evidence/
    scenarios/ negotiation/ decisions/ outcomes/
  services/
    ai/            model adapter, prompt versions, JSON validation, mock
    documents/     local parsing, size and type limits, quarantine
    exports/       decision pack, spreadsheet, print
    storage/       [built] local-first persistence — outcome-store.mjs
  components/      presentational only
  styles/
api/
  chat/            [built] server-side credentials, origin check, rate limited
  health/
fixtures/procurebench/        [built] 21 evaluation cases
tests/ unit/ integration/ security/   [built] 231 tests
tests/ e2e/                   not yet
docs/                         [built]
```

`domain/` and `calc/` are the defensible core and must stay free of framework,
network and AI dependencies so they can be tested exhaustively and, later, moved
behind a boundary. The seven modules in `calc/` honour that today: none of them
imports anything but each other.

## Domain model

**Status: partly built.** What exists is the calculation core and the records
around it — enough for one workflow, not the full ontology. `CommercialCase` as
an aggregate root does not exist yet; the claim review passes a bridge result
between functions instead.

`CommercialCase` is the aggregate root. Around it:

- **Context** — `OrganisationContext`, `Supplier`, `CommercialBaseline`,
  `VolumeProfile`, `ContractConstraint` *(partly built: `contractConstraint()`
  in `evidence.mjs`)*
- **The claim** — `SupplierClaim`, `ClaimLine`, `CostDriver` *(partly built:
  `supplierClaim()`, and drivers as inputs to `costBridge()`)*
- **Support** — `EvidenceItem`, `SourceReference` *(built: `evidence.mjs`)*
- **Analysis** — `CommercialScenario`, `Calculation`, `CalculationAssumption`,
  `RiskAssessment` *(built except `RiskAssessment`)*
- **Response** — `NegotiationObjective`, `NegotiationLever`, `RecommendedAction`
  *(partly built: options and a rule-derived recommendation in
  `decision-pack.mjs`)*
- **Resolution** — `HumanDecision`, `Approval`, `SupplierResponse`,
  `NegotiatedOutcome`, `LearningRecord`, `AuditEvent` *(built except
  `SupplierResponse` and `AuditEvent`)*

### The two rules that matter most

**1. Provenance is not optional.** Every material field should be a wrapper, not
a bare value:

```ts
type Provenance =
  | "user-entered" | "document-extracted" | "externally-sourced"
  | "system-calculated" | "ai-inferred" | "unknown";

type Tracked<T> = {
  value: T;
  provenance: Provenance;
  confidence?: number;        // only meaningful for ai-inferred
  source?: SourceReference;   // required unless user-entered or unknown
  confirmedBy?: HumanDecision;
  supersedes?: Tracked<T>;    // version history
};
```

A value whose provenance is `ai-inferred` may not enter a calculation until it
has been confirmed.

**Status: enforced, but at the function boundary rather than the type
boundary.** `assertUsable()` in `cost-bridge.mjs` throws on an unconfirmed
`ai-inferred` driver, and a test proves it. The full `Tracked<T>` wrapper waits
on TypeScript; until then the rule holds where it matters most and nowhere else.

**2. Money is never a number.** **Status: built.** `exact.mjs` stores money as a
whole number of minor units on `BigInt`, with a currency and a date. There is no
floating point anywhere in `calc/`. Mixing currencies raises rather than
converting, and a rate without a date and a source is rejected.

The model must also carry: units and their normalisation, annual and lifetime
volumes, effective dates, retrospective and temporary changes, driver
percentages, index base period, lag and movement, caps, collars and floors,
fixed versus variable split, MOQ and batch effects, Incoterms, payment-term
financial effect, and one-time versus recurring costs.

*Built so far:* annual and lifetime volumes, effective dates, retrospective
periods, driver percentages, index base period and lag, caps, collars and
floors, delay effects, currency with dated conversion. *Not yet:* unit
normalisation, MOQ and batch effects, Incoterms, payment-term effects,
temporary-versus-permanent changes.

## Calculation engine

**Status: built.** Pure functions. Given the same case, the same numbers,
forever — and a ProcureBench case asserts exactly that on every run.

- weighted driver decomposition against index movement, with lag ✓
- index movement from the contractual base period ✓
- cap, collar and floor application ✓
- requested versus warranted delta, and the **unsupported remainder** ✓
- annualised, lifetime and retrospective exposure ✓
- partial-acceptance and delay scenarios ✓
- currency conversion, and the cost / FX / cross-term split ✓
- unit normalisation, MOQ and payment-term effects — not yet
- portfolio weighting across lines — not yet

Output carries its formula, its inputs and every assumption, so the decision
pack can show the working rather than assert a number.

**One thing learned building it.** Exposure must round once, at the total.
Rounding a per-unit delta to pennies and then multiplying by volume understated
a 4.2 million-unit line by £12,600 a year. Every unit test passed before and
after, because they used round numbers; a ProcureBench case with an awkward
price found it immediately.

## AI layer

**Status: partly built.**

- Structured JSON output, validated at runtime; invalid JSON is an error state,
  never a silent fallback — *not built; the tools still return prose*
- Field-level confidence, surfaced in the UI — *not built*
- Uploaded document text wrapped in explicit delimiters and labelled as
  untrusted data that cannot alter instructions — **built**, one shared
  `untrusted()` wrapper across all six document-bearing prompts
- Server-side credentials only, explicit timeouts, bounded retries, partial
  results rather than a 504 — **built**, except retries
- No prompt or document content in logs, ever — **built**
- Every prompt change evaluated against ProcureBench before it ships —
  *ProcureBench exists but evaluates the calculation layer, not prompts*
- One adapter interface, one mock implementation, versioned prompts — *not
  built*

The strongest guarantee is structural rather than architectural: in the claim
review the arithmetic completes before the model is called, and the computed
figures enter the prompt as fixed facts. An injected instruction cannot reach a
number because the numbers already exist.

## Migration approach

Strangler, not rewrite. `index.html` keeps working while capability moves out
from under it.

1. ~~Extract the Spend Analyser's deterministic logic into `calc/` with tests~~
   — **not done, and deliberately.** The cost bridge was built first because it
   is what makes the product defensible; the Spend Analyser still works as it
   is. This remains the best next extraction.
2. ~~Build `domain/` and the cost bridge behind it~~ — cost bridge **done**,
   `domain/` outstanding.
3. ~~Build the flagship workflow as one vertical slice~~ — **done**.
4. ~~Point the existing Price-Increase Defender at the real engine~~ — **done**.
5. Retire screens only once something better exists — ongoing.

## Deliberate non-choices

- **No framework yet.** React earns its place when case state becomes genuinely
  interactive; it is not justified by fashion. The calculation layer is
  framework-free either way, so the decision can still be deferred safely.
- **No server-side case storage.** Local-first keeps the privacy story simple
  and honest for a demonstration. Outcomes live in the browser with export and
  clear controls.
- **No `package.json`.** The hosting project has no build step, and adding a
  manifest can change how the platform builds and deploys. Node's built-in test
  runner was used instead, so 231 tests and CI exist with zero dependencies. CI
  fails deliberately if a manifest appears, so this cannot change by accident —
  check the project's framework settings first when it does change.
- **No end-to-end tests.** Playwright would need a dependency and a browser
  download. The integration tests assert the page's contract with the engine
  instead, which catches the drift that matters most without the machinery.
