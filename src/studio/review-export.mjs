/**
 * A package to send for technical review.
 *
 * Increment C3, built under the roadmap's own condition: *"C3 may initially
 * export a requirements review sheet without a CAD file if no real exporter is
 * available, but must label that limitation and must not claim the CAD export
 * feature complete."* That is exactly the situation. There is no geometry
 * kernel in this repository, so there is no model to export and no drawing to
 * generate, and both say so by name rather than being quietly absent.
 *
 * What this does produce is real: a requirement schedule a reviewer can read,
 * the same schedule as structured data, the assumptions and open questions,
 * and a manifest carrying the actual SHA-256 of the actual bytes. A reviewer
 * can check the manifest against the files and know nothing changed in
 * between.
 *
 * Four rules, each from `design/06-PART-BUILDER-AND-REVIEW.md`.
 *
 * 1. **One snapshot.** Every artifact carries the same part id, revision,
 *    units and timestamp, because a package whose sheet and schedule came from
 *    different moments is worse than no package — it looks consistent and is
 *    not.
 *
 * 2. **Only formats that were actually produced.** "Do not advertise a format
 *    merely because its extension is easy to generate." An unavailable format
 *    is listed with the reason it is unavailable.
 *
 * 3. **Nothing here is complete by default.** A package with a detached
 *    requirement, an unresolved conflict or a missing artifact is incomplete
 *    and says which. "A package must not claim 'complete' if…"
 *
 * 4. **Exporting is not approving.** Every artifact is labelled DRAFT — FOR
 *    TECHNICAL REVIEW, nothing advances a review state, and no message is sent
 *    to anyone. "Export success is separate from technical approval."
 */

import { schedule, labelOfKind, serialiseRequirements } from "./requirements.mjs";

/** The words that go on every artifact. Never softened, never parameterised. */
export const DRAFT_LABEL = "DRAFT — FOR TECHNICAL REVIEW";

/**
 * Wording that must never appear on an artifact.
 *
 * "Prevent title-block status or footer wording from suggesting manufacturing
 * release." A reviewer skim-reading a header is entitled to assume a document
 * that says "approved" was approved by somebody.
 */
const FORBIDDEN = [
  /\bapproved\b/i, /\breleased?\s+for\s+manufactur/i, /\bproduction\s+release\b/i,
  /\bissued\s+for\s+manufactur/i, /\bsigned\s*-?\s*off\b/i,
];

/* --------------------------------------------------------------- formats */

/**
 * What this build can actually produce, and what it cannot.
 *
 * Declared here rather than discovered at export time, so that adding a real
 * exporter is a change to this table and to nothing else — and so the reason a
 * format is missing is written down next to the format.
 */
export const FORMATS = Object.freeze({
  "requirement-schedule.html": Object.freeze({
    available: true,
    what: "The requirement schedule, laid out to be read",
  }),
  "requirement-schedule.json": Object.freeze({
    available: true,
    what: "The same schedule as structured data",
  }),
  "review-notes.md": Object.freeze({
    available: true,
    what: "Assumptions, open questions and what is unresolved",
  }),
  "manifest.json": Object.freeze({
    available: true,
    what: "Every file in this package, with its SHA-256",
  }),
  "model.step": Object.freeze({
    available: false,
    what: "The solid model",
    why: "No geometry engine is integrated in this build, so there is no model to export. "
       + "The dimensions in the schedule are the authoritative record.",
  }),
  "drawing.pdf": Object.freeze({
    available: false,
    what: "A dimensioned drawing",
    why: "Generating a drawing needs geometry to dimension. Nothing here can produce views, "
       + "and a sheet of numbers laid out like a drawing would be a drawing in appearance only.",
  }),
});

/* -------------------------------------------------------------- snapshot */

/**
 * Freeze one moment.
 *
 * Everything the package contains is derived from this and nothing reads the
 * live scenario again, so the artifacts cannot disagree with each other even
 * if somebody carries on editing while the export runs.
 */
export function snapshot(input = {}) {
  const part = String(input.part ?? "").trim();
  if (!part) throw new RangeError("A review package needs the part it is about.");

  const requirements = [...(input.requirements ?? [])];
  const features = [...(input.features ?? [])];

  return Object.freeze({
    part,
    partRevision: input.partRevision ? String(input.partRevision) : null,
    /* Null rather than a number: there is no model, and a model revision of 1
       would imply one exists. */
    modelRevision: input.modelRevision ?? null,
    model: input.model ?? null,
    material: input.material ? Object.freeze({ ...input.material }) : null,
    units: input.units ?? "mm",
    preparedBy: input.preparedBy ?? null,
    at: input.at ?? new Date().toISOString(),
    status: DRAFT_LABEL,
    requirements: Object.freeze(requirements),
    features: Object.freeze(features),
    schedule: schedule(requirements, features),
    scenario: input.scenario ?? null,
  });
}

/* ------------------------------------------------------------- artifacts */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** The heading that appears on everything, in the same words each time. */
function header(snap) {
  return {
    part: snap.part,
    partRevision: snap.partRevision,
    modelRevision: snap.modelRevision,
    units: snap.units,
    status: snap.status,
    exportedAt: snap.at,
    preparedBy: snap.preparedBy,
  };
}

/** The schedule, to be read by a person. */
export function scheduleHtml(snap) {
  const s = snap.schedule;
  const rows = s.rows.map((r) => `<tr>
  <td>${esc(r.id)}</td>
  <td>${esc(r.label)}</td>
  <td>${esc(r.target)}</td>
  <td>${esc(r.stated ?? r.limits ?? "—")}</td>
  <td>${esc(r.spec ?? "—")}</td>
  <td>${esc(r.source ?? "not recorded")}</td>
  <td>${esc(statusWords(r))}</td>
</tr>`).join("\n");

  const gaps = [
    ...s.conflicts.map((c) => `<li>${esc(c.why)}</li>`),
    ...(s.detached.length ? [`<li>${s.detached.length} requirement(s) no longer point at a feature that exists.</li>`] : []),
    ...(s.waitingForGeometry.length ? [`<li>${s.waitingForGeometry.length} requirement(s) name a feature that has not been modelled. There is no model in this package.</li>`] : []),
    ...(s.unverified.length ? [`<li>${s.unverified.length} requirement(s) cite a specification whose text was not supplied, so their limits are not recorded here.</li>`] : []),
  ].join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(snap.part)} — requirement schedule — ${esc(DRAFT_LABEL)}</title>
<style>
body{font:14px/1.6 system-ui,sans-serif;margin:32px;color:#111;max-width:72rem}
.status{display:inline-block;border:2px solid #b45309;color:#b45309;padding:4px 12px;
  font-weight:700;letter-spacing:.04em;margin-bottom:16px}
table{border-collapse:collapse;width:100%;margin:16px 0;font-size:13px}
th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f4f4f5}
dl{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;font-size:13px}
dt{font-weight:600}
.gaps{border-left:4px solid #b45309;padding-left:14px}
footer{margin-top:32px;font-size:12px;color:#555;border-top:1px solid #ddd;padding-top:12px}
</style></head><body>
<div class="status">${esc(DRAFT_LABEL)}</div>
<h1>${esc(snap.part)}${snap.partRevision ? ` — revision ${esc(snap.partRevision)}` : ""}</h1>
<dl>
  <dt>Units</dt><dd>${esc(snap.units)}</dd>
  <dt>Model revision</dt><dd>${snap.modelRevision === null ? "no model in this package" : esc(snap.modelRevision)}</dd>
  <dt>Prepared by</dt><dd>${esc(snap.preparedBy ?? "not recorded")}</dd>
  <dt>Exported</dt><dd>${esc(snap.at)}</dd>
</dl>

<h2>Requirements (${s.total})</h2>
${s.total === 0 ? "<p>No requirements have been recorded.</p>" : `<table>
<thead><tr><th>Id</th><th>Kind</th><th>Applies to</th><th>Requirement</th>
<th>Specification</th><th>Source</th><th>State</th></tr></thead>
<tbody>
${rows}
</tbody></table>`}

${gaps ? `<h2>What is unresolved</h2><ul class="gaps">\n${gaps}\n</ul>` : ""}

<footer>
<p>This package is a draft prepared for technical review. It does not authorise manufacture,
record a review decision, or commit anyone to anything. Nothing has been sent to anybody.</p>
<p>${snap.model ? "A parametric model snapshot accompanies this schedule as part-model.json. Its dimensions are in micrometres; it is not a STEP solid or a manufacturing drawing." : "It contains no solid model and no dimensioned drawing; the dimensions and limits in the table above are the authoritative record."}</p>
</footer>
</body></html>`;
}

function statusWords(r) {
  const bits = [];
  if (r.verification === "unverified") bits.push("specification text not supplied");
  if (r.verification === "flagged-for-review") bits.push("question for the reviewer");
  if (r.attachment === "needs-reattachment") bits.push("needs reattaching");
  if (r.attachment === "no-feature-yet") bits.push("awaiting the part model");
  if (r.missing && r.missing.length) bits.push(`missing ${r.missing.join(", ")}`);
  return bits.length ? bits.join("; ") : "recorded";
}

/** The same schedule, for a system rather than a person. */
export function scheduleJson(snap) {
  return JSON.stringify({
    ...header(snap),
    requirements: JSON.parse(serialiseRequirements(snap.requirements)),
    summary: {
      total: snap.schedule.total,
      conflicts: snap.schedule.conflicts,
      incomplete: snap.schedule.incomplete,
      unverified: snap.schedule.unverified,
      detached: snap.schedule.detached,
      awaitingModel: snap.schedule.waitingForGeometry,
      readyToRequestReview: snap.schedule.readyToRequestReview,
    },
    notIncluded: unavailable(),
  }, null, 2);
}

/** Assumptions, open questions, and what a reviewer is being asked. */
export function reviewNotes(snap) {
  const s = snap.schedule;
  const questions = snap.requirements
    .filter((r) => r.question)
    .map((r) => `- **${labelOfKind(r.kind)}** (${r.id}): ${r.question}`);

  const unverified = snap.requirements
    .filter((r) => r.verification === "unverified")
    .map((r) => `- ${r.id} cites ${r.spec.name}${r.spec.revision ? ` revision ${r.spec.revision}` : " with no revision given"}. `
      + "Its text was not supplied, so what it requires is not recorded in this package.");

  return [
    `# ${snap.part}${snap.partRevision ? ` — revision ${snap.partRevision}` : ""}`,
    "",
    `**${DRAFT_LABEL}**`,
    "",
    `Exported ${snap.at}. Units: ${snap.units}.`,
    "",
    "## What this package is",
    "",
    "A set of engineering requirements prepared for someone technical to check.",
    "It is not an approval, it does not release anything for manufacture, and",
    "nothing in it has been sent to anyone.",
    "",
    "## What it does not contain",
    "",
    ...unavailable().map((f) => `- **${f.name}** — ${f.what}. ${f.why}`),
    "",
    ...(questions.length ? ["## Questions for the reviewer", "", ...questions, ""] : []),
    ...(unverified.length ? ["## Requirements this package cannot stand behind", "", ...unverified, ""] : []),
    ...(s.conflicts.length
      ? ["## Conflicts, unresolved on purpose", "",
        "Choosing between these is an engineering decision and has been left to you.", "",
        ...s.conflicts.map((c) => `- ${c.why}`), ""]
      : []),
    ...(s.nextQuestion ? ["## The first thing to settle", "", s.nextQuestion, ""] : []),
  ].join("\n");
}

const unavailable = () => Object.entries(FORMATS)
  .filter(([, f]) => !f.available)
  .map(([name, f]) => ({ name, what: f.what, why: f.why }));

/* ---------------------------------------------------------------- hashing */

/** SHA-256 of a string, as lowercase hex. */
export async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) {
    throw new Error("This environment has no SHA-256, so a manifest cannot be produced honestly.");
  }
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* --------------------------------------------------------------- package */

/**
 * Build the package.
 *
 * Returns the files and a manifest describing them. Nothing is written
 * anywhere and nothing is sent; what the caller does with the bytes is the
 * caller's business, and that separation is why exporting cannot approve
 * anything even by accident.
 */
export async function buildPackage(snap) {
  const files = {
    "requirement-schedule.html": scheduleHtml(snap),
    "requirement-schedule.json": scheduleJson(snap),
    "review-notes.md": reviewNotes(snap),
  };
  if (snap.model) {
    files["part-model.json"] = JSON.stringify({
      schema: "buyrworld-part-review/1",
      ...header(snap),
      geometryUnits: "um",
      model: snap.model,
      material: snap.material,
      requirementSchedule: JSON.parse(scheduleJson(snap)),
      displayRows: snap.schedule.rows,
      limitations: ["Parametric primitives only. Not a STEP solid.",
        "Draft for technical review; not a manufacturing drawing.",
        "Costs and stock purchasing quantities are not derived from this preview."]
    }, (key, value) => typeof value === "bigint" ? value.toString() : value, 2);
  }

  /* Every artifact carries the label, checked rather than assumed — it is the
     one thing that stops a draft being read as a decision. */
  for (const [name, text] of Object.entries(files)) {
    if (!text.includes(DRAFT_LABEL)) {
      throw new Error(`${name} does not carry "${DRAFT_LABEL}". Every artifact must.`);
    }
    for (const pattern of FORBIDDEN) {
      if (pattern.test(text)) {
        throw new Error(
          `${name} contains wording that reads as an approval (${pattern}). ` +
          "A review draft must not look like a release.");
      }
    }
  }

  const entries = [];
  for (const [name, text] of Object.entries(files)) {
    entries.push({
      name,
      bytes: new TextEncoder().encode(text).length,
      sha256: await sha256(text),
      what: FORMATS[name] ? FORMATS[name].what : null,
    });
  }

  const s = snap.schedule;
  const omissions = [
    ...unavailable().map((f) => `${f.name}: ${f.why}`),
    ...(s.conflicts.length ? [`${s.conflicts.length} unresolved conflict(s) between requirements.`] : []),
    ...(s.detached.length ? [`${s.detached.length} requirement(s) have lost the feature they applied to.`] : []),
    ...(s.incomplete.length ? [`${s.incomplete.length} requirement(s) are missing a value.`] : []),
  ];

  /* Complete means every requested artifact was produced and nothing in the
     schedule is unresolved. Two formats are permanently unavailable in this
     build, so a package from this build is never complete — which is the
     honest answer, and saying it plainly is the point. */
  const complete = omissions.length === 0;

  const manifestText = JSON.stringify({
    ...header(snap),
    files: entries,
    notIncluded: unavailable(),
    omissions,
    complete,
    note: complete
      ? "Every requested artifact was produced."
      : "This package is incomplete. What is missing is listed above, by name and reason.",
    approval: "None. Exporting this package does not record a review, approve the part, "
      + "or authorise manufacture. No message has been sent to anyone.",
  }, null, 2);

  files["manifest.json"] = manifestText;

  return Object.freeze({
    files: Object.freeze(files),
    manifest: Object.freeze({
      files: Object.freeze(entries),
      omissions: Object.freeze(omissions),
      complete,
      notIncluded: Object.freeze(unavailable()),
    }),
    /* Named so a caller cannot mistake it for a review state. */
    exported: true,
    reviewed: false,
    approved: false,
  });
}

/**
 * Check a package against its own manifest.
 *
 * The manifest claims a hash for each file. This recomputes them, which is the
 * only thing that makes the claim worth making.
 */
export async function verifyPackage(pkg) {
  const problems = [];
  for (const entry of pkg.manifest.files) {
    const text = pkg.files[entry.name];
    if (text === undefined) {
      problems.push(`${entry.name} is in the manifest and not in the package.`);
      continue;
    }
    const actual = await sha256(text);
    if (actual !== entry.sha256) {
      problems.push(`${entry.name} does not match its manifest hash.`);
    }
  }
  for (const name of Object.keys(pkg.files)) {
    if (name === "manifest.json") continue;
    if (!pkg.manifest.files.some((f) => f.name === name)) {
      problems.push(`${name} is in the package and not in the manifest.`);
    }
  }
  return Object.freeze({ ok: problems.length === 0, problems: Object.freeze(problems) });
}
