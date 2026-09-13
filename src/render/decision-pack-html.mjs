/**
 * Renders a decision pack as a self-contained, print-clean HTML document.
 *
 * Separate from the pack itself so the content can be tested without a browser
 * and so the same data could be rendered another way later.
 *
 * Everything is escaped. Supplier names, part descriptions, quoted passages and
 * index labels all originate outside this system.
 */

import { moneyToDecimalString } from "../calc/exact.mjs";
import { formatPercent } from "../calc/cost-bridge.mjs";
import { LABEL } from "../calc/provenance.mjs";

const esc = (t) =>
  String(t == null ? "" : t)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const M = moneyToDecimalString;
const P = formatPercent;

/**
 * What this supplier has done before.
 *
 * Placed ahead of the executive summary deliberately: three claims with a
 * consistent over-ask changes how every figure below it should be read, and a
 * reader who meets that fact on page two has already formed a view.
 */
function historySection(pack) {
  const h = pack.history;
  if (!h || !h.count) return "";
  const rows = h.claims.map((c) => `
  <tr>
    <td>${esc(c.at || `Round ${c.round}`)}</td>
    <td class="n">${P(c.requested)}</td>
    <td class="n">${P(c.warranted)}</td>
    <td class="n">${P(c.agreed)}</td>
    <td class="n">${c.concededAboveWarranted > 0n
      ? `${esc(c.currency)} ${M(c.concededAboveWarrantedAnnual)}` : "&mdash;"}</td>
  </tr>`).join("");

  const repeats = h.drivers.filter((d) => d.claimedEveryRound && !d.everEvidenced);
  const worked = h.argumentsThatWorked.filter((a) => a.worked > 0);

  return `<h2>Their record</h2>
<p>${esc(h.headline)}</p>
<div class="tw"><table>
  <tr><th>When</th><th class="n">Asked</th><th class="n">Evidenced</th><th class="n">Agreed</th><th class="n">Above the evidence</th></tr>${rows}
</table></div>
${repeats.length ? `<p class="gap-material"><b>Claimed every round and never evidenced:</b> ${
  repeats.map((d) => esc(d.label)).join(", ")}. Ask for the breakdown before anything else.</p>` : ""}
${worked.length ? `<p class="sub"><b>Has worked against this supplier:</b> ${
  worked.map((a) => `${esc(a.description)} (${a.worked} of ${a.used})`).join(" &middot; ")}.</p>` : ""}
${h.mixedCurrency ? `<p class="sub">Claims span more than one currency, so totals are kept separate rather than added.</p>` : ""}
<p class="sub">${esc(h.method)}</p>
`;
}

/**
 * The position to take into the room.
 *
 * The pack used to stop at "this much is warranted", which is the half a
 * reader cannot act on. Every figure here is derived by the engine; the only
 * judgement is which row you choose, and the ladder says plainly which of them
 * are evidenced and which are a decision.
 */
function negotiationSection(pack) {
  const n = pack.negotiation;
  if (!n) return "";
  const cur = esc(n.currency);

  const challenges = n.ladder.challenges.length ? `
<h3>Ask for these first</h3>
<ul>${n.ladder.challenges.map((c) => `
  <li><b>${esc(c.label)}</b> &mdash; ${P(c.contribution)} of the increase, worth ${cur} ${M(c.worthAnnually)} a year.
  <span class="muted">${esc(c.why)}</span></li>`).join("")}
</ul>` : "";

  const ladder = `
<h3>What each step costs</h3>
<div class="tw"><table>
  <tr><th>Position</th><th class="n">Accepted</th><th class="n">Unit</th><th class="n">This step costs</th></tr>
  ${n.ladder.concessions.map((c) => `
  <tr>
    <td>${esc(c.note.split(".")[0])}${c.evidenced
      ? " <b>(evidenced)</b>" : ' <span class="muted">(a choice)</span>'}</td>
    <td class="n">${P(c.acceptedChange)}</td>
    <td class="n">${M(c.acceptedUnitPrice)}</td>
    <td class="n">${cur} ${M(c.costOfThisStep)}</td>
  </tr>`).join("")}
</table></div>`;

  const rebuttals = n.rebuttals.length ? `
<h3>What they will say</h3>
<ul>${n.rebuttals.slice(0, 8).map((r) => `
  <li>${esc(r.theirPoint)}<br><span class="muted">Ask for ${esc(r.ask)}.</span>${
    r.worthAnnually ? ` <b>${cur} ${M(r.worthAnnually)} a year.</b>`
      : ' <span class="muted">(nothing to recover &mdash; already treated as zero)</span>'}</li>`).join("")}
</ul>` : "";

  const walk = `
<h3>Walking away is ${esc(n.walkAway.credibility)}</h3>
<p>${esc(n.walkAway.rule)}</p>
${n.walkAway.breakeven ? `<p>Switching pays back in about <b>${
  n.walkAway.breakeven.yearsApprox.toFixed(1)} year${n.walkAway.breakeven.yearsApprox === 1 ? "" : "s"}</b>
&mdash; ${esc(n.walkAway.breakeven.basis)} ${tag(LABEL.ASSUMED)}, because nobody has quoted an alternative.</p>` : ""}`;

  return `<h2>Negotiating position</h2>
<div class="tw"><table>
  <tr><th>Anchor</th><th class="n">Change</th><th class="n">Unit</th><th class="n">Annual, ${cur}</th></tr>
  <tr><td>Open at &mdash; the hard line ${tag(LABEL.DERIVED)}</td><td class="n">${P(n.openingPosition.openAt)}</td>
      <td class="n">${M(n.hardLine.unitPrice)}</td><td class="n">${M(n.hardLine.annualCost)}</td></tr>
  <tr><td>Target &mdash; what the evidence supports</td><td class="n">${P(n.openingPosition.target)}</td>
      <td class="n">${M(n.anchors.warranted.unitPrice)}</td><td class="n">${M(n.anchors.warranted.annualCost)}</td></tr>
  <tr><td>Their ask</td><td class="n">${P(pack.summary.requested)}</td>
      <td class="n">${M(n.anchors.requested.unitPrice)}</td><td class="n">${M(n.anchors.requested.annualCost)}</td></tr>
</table></div>
<p><b>In dispute: ${cur} ${M(n.anchors.inDispute)} a year (${P(n.anchors.inDisputeChange)}).</b>
Everything below the target is arithmetic both sides can check.</p>
${n.hardLine.assessed
  ? `<p>The hard line is ${cur} ${M(n.hardLine.belowWarrantedBy)} a year below the warranted figure &mdash;
     what survives if none of the unevidenced drivers is supported.</p>`
  : `<p class="gap-minor">No evidence assessment, so the hard line cannot be told apart from the warranted figure.</p>`}
${challenges}${ladder}
<p class="sub">Deferral instead of money &mdash; ${n.deferrals.map((d) =>
  `${d.months} month${d.months > 1 ? "s" : ""}: ${cur} ${M(d.firstYearAvoided)} avoided in year one`).join(" &middot; ")}.</p>
${rebuttals}${walk}
<p class="sub">${esc(n.openingPosition.rule)}</p>
<p class="sub">${esc(n.method)}</p>
`;
}

export function renderDecisionPackHTML(pack) {
  const cur = esc(pack.summary.currency);
  const m = pack.meta;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.caseId || "Supplier claim review")} — decision pack</title>
<style>
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font: 11pt/1.55 Georgia, "Times New Roman", serif; color: #16160f; margin: 0; padding: 24px; max-width: 900px; }
  h1 { font-size: 20pt; margin: 0 0 4px; letter-spacing: -.01em; }
  h2 { font-size: 12pt; text-transform: uppercase; letter-spacing: .08em; margin: 26px 0 8px;
       padding-bottom: 5px; border-bottom: 1px solid #16160f; page-break-after: avoid; }
  h3 { font-size: 11pt; margin: 14px 0 4px; page-break-after: avoid; }
  p { margin: 0 0 8px; }
  .sub { color: #5a5a53; font-size: 9.5pt; }
  .synthetic { background: #fff3cd; border: 1px solid #b8860b; padding: 8px 11px; margin: 0 0 18px; font-size: 9.5pt; }
  .headline { font-size: 13pt; line-height: 1.45; margin: 0 0 6px; }
  table { border-collapse: collapse; width: 100%; margin: 6px 0 10px; font-size: 10pt; page-break-inside: avoid; }
  /* A table narrower than the screen is fine; one wider than it must scroll
     inside its own box rather than pushing the whole document sideways. */
  .tw { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 6px 0 10px; }
  .tw table { margin: 0; min-width: 420px; }
  th { text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .06em;
       border-bottom: 1px solid #16160f; padding: 5px 8px 5px 0; }
  td { padding: 5px 8px 5px 0; border-bottom: 1px solid #ddd; vertical-align: top; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rec { border: 2px solid #16160f; padding: 12px 14px; margin: 8px 0 4px; page-break-inside: avoid; }
  .rec .action { font-size: 12pt; font-weight: bold; }
  ul { margin: 4px 0 8px; padding-left: 20px; }
  li { margin: 2px 0; }
  .gap-material { color: #a01919; }
  .gap-minor { color: #8a6d1f; }
  .muted { color: #5a5a53; }
  /* A provenance tag must survive a black-and-white print, so it carries its
     own text and a border rather than relying on colour. */
  .prov { display: inline-block; font-size: 7.5pt; letter-spacing: .04em; text-transform: uppercase;
          padding: 1px 5px; border: 1px solid currentColor; border-radius: 3px; vertical-align: 1px;
          margin-left: 6px; white-space: nowrap; }
  .prov-supplied { color: #1d5a1d; }
  .prov-derived  { color: #16160f; }
  .prov-assumed  { color: #a01919; font-weight: bold; }
  .legend { font-size: 9pt; color: #5a5a53; margin: 4px 0 12px; }
  .legend .prov { margin-left: 0; margin-right: 4px; }
  .verify { border: 2px solid #a01919; padding: 12px 14px; margin: 8px 0; page-break-inside: avoid; }
  .verify h3 { margin-top: 0; }
  .verify li { margin: 7px 0; }
  .opt { border-left: 3px solid #ccc; padding: 2px 0 2px 12px; margin: 12px 0; page-break-inside: avoid; }
  .opt.chosen { border-left-color: #16160f; }
  .foot { margin-top: 28px; padding-top: 10px; border-top: 1px solid #16160f; font-size: 9pt; color: #5a5a53; }
  .approval { border: 1px dashed #16160f; padding: 12px 14px; margin-top: 10px; }
  .approval .line { margin-top: 18px; border-bottom: 1px solid #16160f; height: 1px; }
  @media print {
    body { padding: 0; }
    .noprint { display: none; }
    /* On paper there is nowhere to scroll to, so let a wide table wrap. */
    .tw { overflow-x: visible; }
    .tw table { min-width: 0; }
  }

  /* Phones. The pack is read on one as often as it is printed. */
  @media screen and (max-width: 640px) {
    body { padding: 16px 14px; font-size: 10.5pt; }
    h1 { font-size: 17pt; }
    h2 { font-size: 11pt; margin-top: 20px; }
    table { font-size: 9pt; }
    .rec { padding: 10px 11px; }
    .rec .action { font-size: 11pt; }
    .opt { padding-left: 9px; }
    .prov { margin-left: 4px; font-size: 7pt; }
    .verify { padding: 10px 11px; }
  }
</style></head><body>

<h1>Supplier claim review</h1>
<p class="sub">
  ${m.caseId ? `Case ${esc(m.caseId)} &middot; ` : ""}${esc(m.supplier || "Supplier not stated")}
  ${m.part ? ` &middot; ${esc(m.part)}` : ""}
  ${m.received ? ` &middot; request received ${esc(m.received)}` : ""}
  ${m.generatedAt ? ` &middot; prepared ${esc(m.generatedAt)}` : ""}
</p>

${m.synthetic ? `<p class="synthetic"><b>Synthetic demonstration data.</b> Every figure, supplier and source in this
document is fictional. It is not a real supplier claim and must not be used as one.</p>` : ""}

${historySection(pack)}
<h2>Executive summary</h2>
<p class="headline">${esc(pack.summary.headline)}</p>
<div class="tw"><table>
  <tr><th>Position</th><th class="n">Change</th><th class="n">Annual, ${cur}</th></tr>
  <tr><td>Requested by the supplier</td><td class="n">${P(pack.summary.requested)}</td><td class="n">${M(pack.summary.annualRequested)}</td></tr>
  <tr><td>Supported by the evidence ${tag(LABEL.DERIVED)}</td><td class="n">${P(pack.summary.warranted)}</td><td class="n">${M(pack.summary.annualWarranted)}</td></tr>
  <tr><td><b>Unsupported</b></td><td class="n"><b>${P(pack.summary.unsupported)}</b></td><td class="n"><b>${M(pack.summary.annualUnsupported)}</b></td></tr>
</table></div>

<p class="legend">Every figure below is labelled:
  ${(pack.provenance?.legend ?? []).map((l) => `${tag(l.label)}${esc(l.means)}`).join(" &middot; ")}</p>

<h2>Recommended action</h2>
<div class="rec">
  <div class="action">${esc(labelFor(pack.recommendation.action))}</div>
  <p style="margin-top:6px">${esc(pack.recommendation.because)}</p>
  <p class="sub" style="margin:0">Derived by rule: ${esc(pack.recommendation.rule)}. A reviewer who disagrees should
  disagree with the rule, not with a judgement.</p>
</div>

<h2>Baseline</h2>
<div class="tw"><table>
  <tr><td>Current unit price</td><td class="n">${cur} ${M(pack.baseline.unitPrice)}</td></tr>
  <tr><td>Annual volume</td><td class="n">${esc(String(pack.baseline.annualVolume))} units</td></tr>
  <tr><td>Annual line value</td><td class="n">${cur} ${M(lineValue(pack))}</td></tr>
</table></div>

<h2>Claim decomposition</h2>
<div class="tw"><table>
  <tr><th>Driver</th><th class="n">Share of cost</th><th class="n">Movement</th><th class="n">Contribution</th></tr>
  ${pack.decomposition.map((c) => `
  <tr><td>${esc(c.label)}${provTag(pack, c.id, "weight")}${c.lineage ? `<div class="sub">${esc(c.lineage)}</div>` : ""}${
    c.basis ? `<div class="sub gap-material">Their base ${esc(c.basis.claimedBase)} would add ${P(c.basis.overstatement)}.</div>` : ""
  }</td><td class="n">${P(c.weight)}</td><td class="n">${P(c.indexMovement)}${provTag(pack, c.id, "movement")}</td><td class="n">${P(c.contribution)}</td></tr>`).join("")}
  <tr><td class="muted">Unexplained share of unit cost</td><td class="n muted">${P(unexplained(pack))}</td>
      <td class="n muted">unknown</td><td class="n muted">treated as nil</td></tr>
</table></div>
${pack.contract.constraintApplied ? `<p>A contract ${esc(pack.contract.constraintApplied)} applies. The driver evidence
alone would support ${P(pack.contract.warrantedBeforeConstraints)}.</p>` : ""}
${pack.retrospective ? `<p>Retrospective application over ${esc(String(pack.retrospective.months))} months covers
approximately ${esc(String(pack.retrospective.units))} units already delivered, an unsupported
${cur} ${M(pack.retrospective.unsupported)}.</p>` : ""}

${pack.currency ? `<h2>Currency</h2>
<p>The supplier prices in ${esc(pack.currency.supplierCurrency)}; this analysis reports in ${esc(pack.currency.currency)}.
A rate move is not a cost move, so the two are separated.</p>
<div class="tw"><table>
  <tr><td>Total change</td><td class="n">${esc(pack.currency.currency)} ${M(pack.currency.totalChange)}</td></tr>
  <tr><td>Their cost increase, at the baseline rate</td><td class="n">${M(pack.currency.costEffect)}</td></tr>
  <tr><td><b>Exchange rate movement (${P(pack.currency.rateMovement)}) — not their cost</b></td><td class="n"><b>${M(pack.currency.fxEffect)}</b></td></tr>
  <tr><td>Interaction</td><td class="n">${M(pack.currency.crossTerm)}</td></tr>
</table></div>
<p class="sub">${esc(pack.currency.lineage)}. ${esc(pack.currency.method)}</p>` : ""}

<h2>Evidence</h2>
<p>Fully evidenced: <b>${formatWeightPct(pack.evidence.coverageOfClaimedWeight)}</b> of the claimed unit-cost weight.
${pack.evidence.materialGaps ? `<span class="gap-material">${esc(String(pack.evidence.materialGaps))} material gap(s).</span>` : "No material gaps."}</p>
${pack.evidence.gaps.length ? `<ul>${pack.evidence.gaps.map((g) =>
  `<li class="gap-${esc(g.severity)}">${esc(g.text)}</li>`).join("")}</ul>` : "<p>No evidence gaps identified.</p>"}
<p class="sub">${esc(pack.evidence.method)}</p>

${pack.contract.contradictions.length ? `<h2>Contract</h2>
<ul>${pack.contract.contradictions.map((x) => `<li class="gap-material">${esc(x.text)}</li>`).join("")}</ul>` : ""}

<h2>Scenario comparison</h2>
<div class="tw"><table>
  <tr><th>Scenario</th><th class="n">Change</th><th class="n">Annual cost, ${cur}</th><th>Basis</th></tr>
  ${pack.scenarios.map((sc) => `
  <tr><td>${esc(sc.label)}</td><td class="n">${P(sc.change)}</td><td class="n">${M(sc.annualCost)}</td>
      <td class="sub">${esc(sc.basis)}</td></tr>`).join("")}
</table></div>

<h2>Options</h2>
${pack.options.map((o) => `
<div class="opt${o.action === pack.recommendation.action ? " chosen" : ""}">
  <h3>${esc(o.label)}${o.action === pack.recommendation.action ? " &mdash; recommended" : ""}</h3>
  <p>Annual cost ${cur} ${M(o.financialImpact.annual)}${
    o.financialImpact.avoided ? `, avoiding ${cur} ${M(o.financialImpact.avoided)}` : ""
  }${o.financialImpact.note ? `. ${esc(o.financialImpact.note)}` : "."}</p>
  ${o.risks.length ? `<p class="sub"><b>Risks:</b> ${o.risks.map(esc).join(" ")}</p>` : ""}
  ${o.requiresApproval ? `<p class="sub"><b>Approval:</b> ${esc(o.requiresApproval)}</p>` : ""}
  <p class="sub"><b>Confidence:</b> ${esc(o.confidence)}${
    o.whatWouldChangeThis ? ` &middot; <b>What would change this:</b> ${esc(o.whatWouldChangeThis)}` : ""
  }</p>
</div>`).join("")}

${negotiationSection(pack)}
${pack.assumptionsToVerify?.length ? `<h2>Assumptions to verify</h2>
<div class="verify">
  <h3>${pack.assumptionsToVerify.filter((a) => a.material).length} material, ${pack.assumptionsToVerify.filter((a) => !a.material).length} minor</h3>
  <p class="sub">These figures rest on an assumption rather than on evidence. Each says what would settle it,
  because "verify this" without "how" is not actionable.</p>
  <ul>
  ${pack.assumptionsToVerify.map((a) => `<li><b>${esc(a.figure)}</b>${a.material ? " " + tag(LABEL.ASSUMED) : ""}<br>
    <span class="sub">Assumes ${esc(a.assumption)}</span><br>
    <span class="sub">Settled by: ${esc(a.settledBy)}</span></li>`).join("")}
  </ul>
</div>` : ""}

<h2>Assumptions</h2>
${pack.assumptions.length ? `<ul>${pack.assumptions.map((a) => `<li>${esc(a.text)}</li>`).join("")}</ul>`
  : "<p>No assumptions recorded.</p>"}

<h2>Uncertainties</h2>
<ul>${pack.uncertainties.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>

<h2>Source appendix</h2>
${pack.sources.length ? `<div class="tw"><table>
  <tr><th>For</th><th>Source</th><th>Kind</th></tr>
  ${pack.sources.map((sc) => `<tr><td>${esc(sc.for)}</td><td>${esc(sc.detail)}</td><td class="sub">${esc(sc.kind)}</td></tr>`).join("")}
</table></div>` : "<p>No sources were attached to this analysis, which is itself a finding.</p>"}

<h2>Approval record</h2>
<div class="approval">
  <p><b>Status: ${esc(pack.approval.state)}.</b> ${esc(pack.approval.note)}</p>
  <div class="line"></div><p class="sub">Decision and amount agreed</p>
  <div class="line"></div><p class="sub">Approved by (name and role)</p>
  <div class="line"></div><p class="sub">Date</p>
</div>

<div class="foot">
  <p>${esc(pack.disclaimer)}</p>
  <p>All figures computed in exact integer arithmetic by a tested engine. No language model produced any number
  in this document. Every figure traces to a driver, a formula and a source listed above.</p>
  <p>Prepared by ${esc(pack.meta.preparedBy)}.</p>
</div>

</body></html>`;
}

function tag(label) {
  return `<span class="prov prov-${esc(label)}">${esc(label)}</span>`;
}
function provTag(pack, driverId, field) {
  const p = pack.provenance?.byDriver?.find((x) => x.id === driverId);
  const l = p?.[field];
  return l ? `<span class="prov prov-${esc(l.label)}" title="${esc(l.why)}">${esc(l.label)}</span>` : "";
}

function labelFor(action) {
  return String(action).replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}
function lineValue(pack) {
  const { unitPrice, annualVolume } = pack.baseline;
  return { minor: unitPrice.minor * BigInt(annualVolume), currency: unitPrice.currency, asOf: unitPrice.asOf };
}
function unexplained(pack) {
  const claimed = pack.decomposition.reduce((n, c) => n + c.weight, 0n);
  return 1_000_000_000n - claimed;
}
function formatWeightPct(r) {
  const h = (r * 10000n) / 1_000_000_000n;
  return `${h / 100n}.${(h % 100n).toString().padStart(2, "0")}%`;
}
