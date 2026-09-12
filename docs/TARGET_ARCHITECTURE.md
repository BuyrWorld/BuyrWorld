# Target architecture

## Principle

**The model extracts and explains. Code calculates.** Every number a buyer might
put in front of an approver must be reproducible without a language model in the
loop. This single rule drives the whole structure below.

## Shape

```
src/
  domain/          typed entities + Zod schemas — no I/O, no framework
  calc/            pure deterministic functions — no I/O, no AI, fully unit-tested
  features/
    cases/ baselines/ claims/ evidence/
    scenarios/ negotiation/ decisions/ outcomes/
  services/
    ai/            model adapter, prompt versions, JSON validation, mock
    documents/     local parsing, size and type limits, quarantine
    exports/       decision pack, spreadsheet, print
    storage/       local-first persistence
  components/      presentational only
  styles/
api/
  chat/            server-side credentials, rate limited
  health/
fixtures/procurebench/
tests/ unit/ integration/ e2e/ security/
docs/
```

`domain/` and `calc/` are the defensible core and must stay free of framework,
network and AI dependencies so they can be tested exhaustively and, later, moved
behind a boundary.

## Domain model

`CommercialCase` is the aggregate root. Around it:

- **Context** — `OrganisationContext`, `Supplier`, `CommercialBaseline`,
  `VolumeProfile`, `ContractConstraint`
- **The claim** — `SupplierClaim`, `ClaimLine`, `CostDriver`
- **Support** — `EvidenceItem`, `SourceReference`
- **Analysis** — `CommercialScenario`, `Calculation`, `CalculationAssumption`,
  `RiskAssessment`
- **Response** — `NegotiationObjective`, `NegotiationLever`, `RecommendedAction`
- **Resolution** — `HumanDecision`, `Approval`, `SupplierResponse`,
  `NegotiatedOutcome`, `LearningRecord`, `AuditEvent`

### The two rules that matter most

**1. Provenance is not optional.** Every material field is a wrapper, not a bare
value:

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
has been confirmed. That is enforced at the type boundary, not by convention.

**2. Money is never a number.** `{ amount: Decimal, currency, asOf, fxSource }`.
Floating-point arithmetic on prices is a defect, and an unconverted currency
comparison is a worse one.

The model must also carry: units and their normalisation, annual and lifetime
volumes, effective dates, retrospective and temporary changes, driver
percentages (material, labour, energy, freight, packaging, overhead, margin),
index base period, lag and movement, caps, collars and floors, fixed versus
variable split, MOQ and batch effects, Incoterms, payment-term financial effect,
and one-time versus recurring costs.

## Calculation engine

Pure functions. Given the same case, the same numbers, forever.

- unit and currency normalisation
- weighted driver decomposition against index movement, with lag
- cap, collar and floor application
- requested versus warranted delta, and the **unsupported remainder**
- annualised, lifetime and retrospective exposure
- partial-acceptance, phasing and delay scenarios
- payment-term and MOQ effects
- portfolio weighting across lines

Output is a `Calculation` carrying its formula, its inputs, and every
`CalculationAssumption` — so the decision pack can show the working.

## AI layer

One adapter interface, one mock implementation, versioned prompts.

- Structured JSON output, validated at runtime; invalid JSON is an error state,
  never a silent fallback.
- Field-level confidence, surfaced in the UI.
- Uploaded document text is wrapped in explicit delimiters and labelled as
  untrusted data that cannot alter instructions.
- Server-side credentials only, explicit timeouts, bounded retries, partial
  results rather than a 504.
- No prompt or document content in logs, ever.
- Every prompt change is evaluated against ProcureBench before it ships.

## Migration approach

Strangler, not rewrite. `index.html` keeps working while capability moves out
from under it:

1. Extract the Spend Analyser's deterministic logic into `calc/` with tests —
   it is the best existing code and needs no AI.
2. Build `domain/` and the cost bridge behind it.
3. Build the flagship workflow as one vertical slice against the new core.
4. Point the existing Price-Increase Defender at the real engine.
5. Retire screens only once something better exists.

## Deliberate non-choices

- **No framework yet.** React earns its place when case state becomes genuinely
  interactive; it is not justified by fashion. The domain and calculation layers
  are framework-free either way, so the decision can be deferred safely.
- **No server-side case storage.** Local-first keeps the privacy story simple
  and honest for a demonstration.
- **No `package.json` added in Phase 1.** The hosting project currently has no
  build step; adding a manifest may change how the platform builds and deploys.
  That needs a deliberate check of the project settings first.
