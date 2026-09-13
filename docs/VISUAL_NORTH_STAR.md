# BuyrWorld Visual North Star

## Product direction

BuyrWorld should increasingly feel like a **procurement operating system** rather than a collection of AI tools.

The product should be:

- serious
- analytical
- compact
- premium
- practical
- information-rich
- evidence-led
- calm rather than flashy

Avoid:

- crypto-dashboard aesthetics
- gaming UI
- excessive glassmorphism
- giant marketing typography
- decorative animation
- generic AI-startup patterns
- template-marketplace visual identity inside the application

---

## 1. Application shell

Preferred desktop structure:

**LEFT SIDEBAR + TOP BAR + WORKSPACE**

### Sidebar

Approximate width:
`220–240px`

Contains:

- BuyrWorld brand
- compact tagline
- Home
- Buyr Inbox
- Cases
- Suppliers
- Contracts
- Sourcing
- Negotiations
- Market Intelligence
- Outcomes / Savings
- Reports
- Resources
- Settings

Only expose destinations that work or are clearly labelled.

Active state:

- slightly lighter panel
- lime accent
- consistent line icon
- no oversized glow

### Top bar

Include:

- global search
- optional organisation/user area
- restrained status indicator if real

Suggested search placeholder:

`Search suppliers, cases, contracts, categories, or ask Buyr…`

Do not create non-functional decorative controls.

---

## 2. Core colour system

Use current BuyrWorld identity, rationalised into tokens.

Suggested direction:

- `--bw-bg: #0B1014`
- `--bw-sidebar: #090E12`
- `--bw-surface: #11181E`
- `--bw-surface-2: #151E25`
- `--bw-border: rgba(255,255,255,.07)`
- `--bw-text: #F3F6F8`
- `--bw-muted: #95A1AA`
- `--bw-subtle: #6F7C85`
- `--bw-accent: #D6FF00` or the current BuyrWorld lime
- `--bw-danger: muted red`
- `--bw-warning: muted amber`
- `--bw-success: restrained green`

Lime should be a **scarce accent**, not a background colour used everywhere.

---

## 3. Typography

Keep:

- **Space Grotesk** — headings, metrics, key commercial figures
- **Inter** — UI, body, metadata

Application scale:

- Page title: `28–32px`
- Panel title: `15–17px`
- Major metric: `24–32px`
- Body: `13–14px`
- Metadata: `11–12px`

Avoid large hero typography inside the app workspace.

---

## 4. Spacing and density

Aim for:

**high information density + low visual noise**

Use a consistent spacing rhythm based around:

`4 / 8 / 12 / 16 / 20 / 24 / 32`

Do not invent different spacing per feature.

Prefer compact cards over large empty sections.

---

## 5. Shared card system

Cards should generally use:

- subtle 1px border
- 10–14px radius
- dark tonal separation
- very restrained shadow
- clear title row
- optional right-side action
- no decorative gradients unless extremely subtle

Create reusable classes/components for:

- `.bw-panel`
- `.bw-panel-head`
- `.bw-metric`
- `.bw-metric-label`
- `.bw-metric-value`
- `.bw-status`
- `.bw-action-primary`
- `.bw-action-secondary`
- `.bw-table`
- `.bw-list-row`

Names may differ if the existing architecture suggests better ones.

---

## 6. Home dashboard

The future dashboard should answer:

- What needs my attention?
- Where is money at risk?
- What changed?
- What should I do next?
- What case was I working on?

Preferred desktop composition:

### Row 1
- Buyr Inbox — large
- Negotiation / active commercial case — large
- Market Signals — narrow

### Row 2
- Supplier Commercial DNA — large
- Commercial Opportunity Radar — large

### Row 3
- Executive Decision Pack
- Recent Cases / Case Memory

Do not add cards solely because they exist in the visual reference.

Map cards to actual BuyrWorld capabilities.

---

## 7. Buyr Inbox

This should become a strong entry point.

Potential content:

- supplier
- subject
- short message/document preview
- detected workflow
- primary next action

Possible actions:

- Analyse claim
- Link contract
- Create case
- Build position

Use a single dominant CTA.

---

## 8. Negotiation / Commercial Command Centre

This should visually prioritise economically meaningful numbers.

Potential metrics:

- Current Price
- Supplier Ask
- Evidence-Supported Position
- Contractual Ceiling
- Unsupported Remainder
- Annual Exposure
- Recommended Opening Position

Do not use arbitrary AI confidence scores where a commercial measure can replace them.

Where existing deterministic engines already provide values, use them.

---

## 9. Supplier Commercial DNA

Possible metrics:

- recorded claim count
- average opening ask
- average evidenced position
- average settlement gap
- unsupported amount resisted
- evidence quality
- typical negotiation duration
- tactics that historically worked

Always show sample size.

Never imply statistical confidence unsupported by the data.

---

## 10. Opportunity Radar

Opportunities should be action-oriented.

Examples:

- contract review window open
- commodity deflation not passed through
- supplier ask above evidence
- similar part price gap
- technically viable alternative supplier
- concentration risk
- payment-term opportunity

Each row should ideally show:

- what happened
- affected object/category/supplier
- estimated value at stake if available
- severity or priority
- clear next action

---

## 11. Market Signals

This should remain compact.

Its role is **procurement action**, not financial trading.

Show only signals relevant to commercial cases, categories or suppliers.

---

## 12. Case Memory

Cases should feel persistent and real.

Useful fields:

- case
- supplier
- category
- stage/status
- last updated
- verified outcome where one exists

Never show fabricated savings as real.

---

## 13. Decision Pack

Create a clean export/action card for the existing decision-pack capability.

Possible checklist:

- Commercial analysis
- Evidence
- Market context
- Contract position
- Negotiation strategy
- Risks
- Approval

Primary action:
`Generate pack`

Secondary:
`Preview`

---

## 14. Buttons

Limit to a small system.

### Primary
- lime
- dark text

### Secondary
- dark surface
- border

### Text action
- minimal
- arrow/chevron

### Danger
- restrained red

Do not create unique button styles for each tool.

---

## 15. Status chips

Create shared styles for:

- LIVE
- IN REVIEW
- APPROVED
- HIGH
- MEDIUM
- LOW
- SUPPLIED
- DERIVED
- ASSUMED
- EVIDENCED

Status must not rely on colour alone.

---

## 16. Charts

Use charts sparingly.

Preferred:

- small historical bars
- small line trends
- ranked horizontal bars
- simple deltas

Avoid:

- decorative donuts
- meaningless gauges
- 3D charts
- fake forecasts

Every chart should answer a procurement question.

---

## 17. Responsiveness

Desktop is the primary product view.

At smaller widths:

- 3 columns → 2
- 2 columns → 1
- sidebar → drawer/menu
- data tables → horizontal scroll or stacked rows

Do not shrink desktop layouts until unreadable.

---

## 18. Public site vs application

Long-term:

**public BuyrWorld website**
and
**BuyrWorld workspace**

should feel distinct.

The target reference is for the **workspace**.

Do not perform a risky routing rewrite to achieve this immediately.

Progressively move working product pages into the application shell.

---

## 19. Legacy visual cleanup

Where safe, reduce application-level remnants of:

- template-store visual language
- membership/pricing cards
- checkout controls
- founder promotion
- giant marketing hero sections
- random feature tiles
- excessive decorative animation

Do not remove genuinely useful resources.

Reclassify them where appropriate.

---

## 20. CSS strategy

Build a clear token/component layer instead of appending more isolated CSS.

Prefer a small number of composable primitives.

Do not delete old styles until usage is verified.

If changing a large section of `index.html`, obey the repository's existing safety limits and split the work.

---

## 21. Interaction quality

Use subtle:

- hover borders
- row highlighting
- button transitions
- active navigation transitions

Avoid:

- bounce
- exaggerated scale
- glowing neon everywhere
- moving backgrounds
- cinematic transitions

---

## 22. Realistic-data rule

The UI may use:

- real existing data
- repository fixtures
- clearly labelled demo data
- honest empty states

It must not use fabricated metrics presented as live organisational facts.

---

## 23. Visual phases

### Phase 1 — Foundation
- tokens
- shell
- sidebar
- top bar
- workspace
- shared panels
- buttons
- chips

### Phase 2 — Home dashboard
Translate existing functionality into a procurement command centre.

### Phase 3 — Commercial workflow
Redesign the claim/negotiation/case/supplier experience.

### Phase 4 — Intelligence and sourcing
Market Intelligence, Supplier Discovery, Contracts, Quote Comparison, Spend.

### Phase 5 — Responsive pass

### Phase 6 — Consistency audit and obsolete-style cleanup

One phase per safe commit.

---

## 24. Final visual test

For every screen ask:

- Does this look like software rather than a website?
- Can the user identify the most important action in five seconds?
- Is commercial value/risk obvious?
- Is the information dense without feeling noisy?
- Are assumptions/evidence/status visually understandable?
- Does anything look decorative but useless?
- Would a procurement director be comfortable using this in a supplier meeting?

If not, refine it.
