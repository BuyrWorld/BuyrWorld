/**
 * The technical-review package — increment C3.
 *
 * Built under the roadmap's own condition: a requirements review sheet without
 * a CAD file is allowed, provided the limitation is labelled and the CAD
 * export is not claimed. So the tests that matter most are the ones about what
 * the package says it is *not*.
 *
 * `acceptance/PART-REVIEW-CHECKS.md` is the source for most of this file:
 *
 *   "Missing artifact or export failure cannot produce a falsely complete package"
 *   "Unknown data can be exported as a clearly incomplete review draft;
 *    export never sets manufacturing approval"
 *   "Every artifact has the same part/revision, model revision, units and
 *    review status; hashes and manifest match actual bytes"
 *   "No reviewer email, sharing invitation or supplier message is sent merely
 *    by exporting"
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DRAFT_LABEL, FORMATS,
  snapshot, scheduleHtml, scheduleJson, reviewNotes,
  sha256, buildPackage, verifyPackage,
} from "../../src/studio/review-export.mjs";
import {
  KIND, SCOPE, tolerance, requirement,
} from "../../src/studio/requirements.mjs";

const dim = (over = {}) => requirement({
  kind: KIND.DIMENSIONAL,
  tolerance: tolerance({ nominal: "10", plusMinus: "0.1", unit: "mm" }),
  source: "the enquiry",
  ...over,
});

const snap = (over = {}) => snapshot({
  part: "SYN-BRACKET-001",
  partRevision: "B",
  units: "mm",
  preparedBy: "a buyer",
  at: "2026-09-15T12:00:00.000Z",
  requirements: [dim()],
  ...over,
});

/* ------------------------------------------------ what it does not contain */

describe("what the package says it is not", () => {
  test("the model and the drawing are named as unavailable, with reasons", () => {
    assert.equal(FORMATS["model.step"].available, false);
    assert.equal(FORMATS["drawing.pdf"].available, false);
    assert.match(FORMATS["model.step"].why, /No geometry engine is integrated/);
    assert.match(FORMATS["drawing.pdf"].why, /needs geometry to dimension/);
  });

  test("they are listed in the package, not silently absent", async () => {
    const pkg = await buildPackage(snap());
    const names = pkg.manifest.notIncluded.map((f) => f.name);
    assert.deepEqual([...names].sort(), ["drawing.pdf", "model.step"]);
  });

  test("and in each artifact a person might read on its own", async () => {
    const pkg = await buildPackage(snap());
    assert.match(pkg.files["review-notes.md"], /What it does not contain/);
    assert.match(pkg.files["review-notes.md"], /model\.step/);
    assert.match(pkg.files["requirement-schedule.html"], /no solid model and no dimensioned drawing/);
  });

  test("the schedule says the written limits are the authority instead", async () => {
    /* "Do not assume all tolerances, finishes or product information survive a
       geometry-only export; carry authoritative requirements in the companion
       schedule and label any loss." Here there is no geometry at all, so the
       schedule is the whole record and says so. */
    const pkg = await buildPackage(snap());
    assert.match(pkg.files["requirement-schedule.html"], /the authoritative record/);
  });

  test("no format is advertised that was not produced", async () => {
    const pkg = await buildPackage(snap());
    for (const entry of pkg.manifest.files) {
      assert.ok(pkg.files[entry.name] !== undefined, `${entry.name} is listed and absent`);
    }
    assert.equal(pkg.files["model.step"], undefined);
    assert.equal(pkg.files["drawing.pdf"], undefined);
  });
});

/* -------------------------------------------------------- never complete */

describe("a package cannot claim to be complete when it is not", () => {
  test("this build's package is never complete, and says why", async () => {
    // Two formats are permanently unavailable here. Saying so plainly is the
    // whole point of the increment being allowed to ship without them.
    const pkg = await buildPackage(snap());
    assert.equal(pkg.manifest.complete, false);
    assert.ok(pkg.manifest.omissions.length >= 2);
    assert.match(pkg.files["manifest.json"], /This package is incomplete/);
  });

  test("an unresolved conflict is one of the omissions", async () => {
    const a = dim({ scope: { type: SCOPE.FEATURE, featureId: "bore-1" } });
    const b = dim({ scope: { type: SCOPE.FEATURE, featureId: "bore-1" },
      tolerance: tolerance({ nominal: "10", plusMinus: "0.05", unit: "mm" }) });
    const pkg = await buildPackage(snap({ requirements: [a, b], features: ["bore-1"] }));
    assert.ok(pkg.manifest.omissions.some((o) => /unresolved conflict/.test(o)));
  });

  test("a detached requirement is another", async () => {
    const r = dim({ scope: { type: SCOPE.FEATURE, featureId: "bore-1" } });
    const pkg = await buildPackage(snap({ requirements: [r], features: ["bore-2"] }));
    assert.ok(pkg.manifest.omissions.some((o) => /lost the feature/.test(o)));
  });

  test("an incomplete requirement is another still", async () => {
    const r = requirement({ kind: KIND.GEOMETRIC, characteristic: "Position" });
    const pkg = await buildPackage(snap({ requirements: [r] }));
    assert.ok(pkg.manifest.omissions.some((o) => /missing a value/.test(o)));
  });

  test("unknown data can still be exported, clearly marked", async () => {
    // The acceptance check says so directly: a draft with gaps is exportable
    // and must be obviously a draft with gaps.
    const r = requirement({ kind: KIND.INSPECTION, requirement: "CMM report",
      question: "First article only, or every batch?" });
    const pkg = await buildPackage(snap({ requirements: [r] }));
    assert.match(pkg.files["review-notes.md"], /Questions for the reviewer/);
    assert.match(pkg.files["review-notes.md"], /First article only/);
  });
});

/* ---------------------------------------------------- exporting is not approving */

describe("exporting approves nothing", () => {
  test("every artifact carries the draft label", async () => {
    const pkg = await buildPackage(snap());
    for (const [name, text] of Object.entries(pkg.files)) {
      assert.ok(text.includes(DRAFT_LABEL), `${name} does not carry the draft label`);
    }
  });

  test("the label is the words the pack specifies", () => {
    assert.equal(DRAFT_LABEL, "DRAFT — FOR TECHNICAL REVIEW");
  });

  test("no artifact contains wording that reads as a release", async () => {
    /* "Prevent title-block status or footer wording from suggesting
       manufacturing release." A reviewer skimming a header is entitled to
       assume a document saying "approved" was approved by somebody. */
    const pkg = await buildPackage(snap());
    for (const [name, text] of Object.entries(pkg.files)) {
      for (const word of [/\bapproved\b/i, /released for manufacture/i, /production release/i]) {
        assert.equal(word.test(text), false, `${name} contains ${word}`);
      }
    }
  });

  test("the build refuses an artifact that would read as approved", async () => {
    // Checked rather than assumed, because the wording is the only thing
    // separating a draft from a decision.
    const bad = snap({ part: "Bracket, approved for production" });
    await assert.rejects(() => buildPackage(bad), /reads as an approval/);
  });

  test("the package says outright that it approves nothing", async () => {
    const pkg = await buildPackage(snap());
    assert.match(pkg.files["manifest.json"], /does not record a review, approve the part/);
    assert.match(pkg.files["review-notes.md"], /It is not an approval/);
  });

  test("the result carries no review state that could be mistaken for one", async () => {
    const pkg = await buildPackage(snap());
    assert.equal(pkg.exported, true);
    assert.equal(pkg.reviewed, false);
    assert.equal(pkg.approved, false);
  });

  test("nothing is sent anywhere", async () => {
    /* "No reviewer email, sharing invitation or supplier message is sent
       merely by exporting." The module returns bytes and touches nothing. */
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("src/studio/review-export.mjs", "utf8"));
    assert.equal(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|mailto:/.test(src), false,
      "the export module must not be able to send anything");
    const pkg = await buildPackage(snap());
    assert.match(pkg.files["manifest.json"], /No message has been sent to anyone/);
  });
});

/* ------------------------------------------------------ one snapshot */

describe("every artifact comes from one moment", () => {
  test("they share the part, revision, units and timestamp", async () => {
    const pkg = await buildPackage(snap());
    for (const name of ["requirement-schedule.html", "requirement-schedule.json", "review-notes.md"]) {
      assert.ok(pkg.files[name].includes("SYN-BRACKET-001"), `${name} lacks the part`);
      assert.ok(pkg.files[name].includes("2026-09-15T12:00:00.000Z"), `${name} lacks the timestamp`);
    }
    assert.match(pkg.files["requirement-schedule.json"], /"units": "mm"/);
  });

  test("the snapshot does not change under a later edit", () => {
    const reqs = [dim()];
    const s = snapshot({ part: "X", requirements: reqs });
    reqs.push(dim({ tolerance: tolerance({ nominal: "50", plusMinus: "1", unit: "mm" }) }));
    assert.equal(s.requirements.length, 1, "the snapshot froze what it was given");
  });

  test("the model revision is null rather than a number that implies a model", () => {
    assert.equal(snap().modelRevision, null);
    assert.match(scheduleHtml(snap()), /no model in this package/);
  });

  test("a package needs a part to be about", () => {
    assert.throws(() => snapshot({}), /needs the part it is about/);
  });
});

/* --------------------------------------------------------------- hashes */

describe("the manifest is checkable", () => {
  test("a known value hashes to the known digest", async () => {
    // The empty string's SHA-256, so a wrong algorithm cannot pass unnoticed.
    assert.equal(await sha256(""),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("every file is listed with its size and hash", async () => {
    const pkg = await buildPackage(snap());
    for (const entry of pkg.manifest.files) {
      assert.match(entry.sha256, /^[0-9a-f]{64}$/);
      assert.ok(entry.bytes > 0);
    }
  });

  test("the hashes match the actual bytes", async () => {
    const pkg = await buildPackage(snap());
    const check = await verifyPackage(pkg);
    assert.equal(check.ok, true, check.problems.join("; "));
  });

  test("a file altered after export fails the check", async () => {
    /* Which is the only thing that makes publishing a hash worth doing. */
    const pkg = await buildPackage(snap());
    const tampered = { ...pkg, files: { ...pkg.files,
      "review-notes.md": `${pkg.files["review-notes.md"]}\n(edited)` } };
    const check = await verifyPackage(tampered);
    assert.equal(check.ok, false);
    assert.match(check.problems[0], /does not match its manifest hash/);
  });

  test("a file present and unlisted fails too", async () => {
    const pkg = await buildPackage(snap());
    const extra = { ...pkg, files: { ...pkg.files, "sneaked-in.txt": "hello" } };
    const check = await verifyPackage(extra);
    assert.equal(check.ok, false);
    assert.match(check.problems[0], /in the package and not in the manifest/);
  });

  test("and a file listed and missing", async () => {
    const pkg = await buildPackage(snap());
    const files = { ...pkg.files };
    delete files["review-notes.md"];
    const check = await verifyPackage({ ...pkg, files });
    assert.equal(check.ok, false);
    assert.match(check.problems[0], /in the manifest and not in the package/);
  });

  test("the manifest is not asked to hash itself", async () => {
    // It cannot contain its own digest, and pretending otherwise would be a
    // hash nobody can check.
    const pkg = await buildPackage(snap());
    assert.equal(pkg.manifest.files.some((f) => f.name === "manifest.json"), false);
    assert.ok(pkg.files["manifest.json"], "but it is still in the package");
  });
});

/* ------------------------------------------------------------ the content */

describe("what a reviewer is given", () => {
  test("every requirement appears with its limits, scope and source", async () => {
    const pkg = await buildPackage(snap());
    const html = pkg.files["requirement-schedule.html"];
    assert.match(html, /10mm ±0\.1/);
    assert.match(html, /the whole part/);
    assert.match(html, /the enquiry/);
  });

  test("a requirement with no recorded source says so rather than showing blank", async () => {
    const pkg = await buildPackage(snap({ requirements: [dim({ source: null })] }));
    assert.match(pkg.files["requirement-schedule.html"], /not recorded/);
  });

  test("an unverified citation is called out in both the sheet and the notes", async () => {
    const r = dim({ spec: { name: "SYN-SPEC-100", revision: "C" } });
    const pkg = await buildPackage(snap({ requirements: [r] }));
    assert.match(pkg.files["requirement-schedule.html"], /specification text not supplied/);
    assert.match(pkg.files["review-notes.md"], /cannot stand behind/);
  });

  test("conflicts are handed over unresolved, and said to be", async () => {
    const a = dim({ scope: { type: SCOPE.FEATURE, featureId: "bore-1" } });
    const b = dim({ scope: { type: SCOPE.FEATURE, featureId: "bore-1" },
      tolerance: tolerance({ nominal: "10", plusMinus: "0.05", unit: "mm" }) });
    const pkg = await buildPackage(snap({ requirements: [a, b], features: ["bore-1"] }));
    assert.match(pkg.files["review-notes.md"], /unresolved on purpose/);
    assert.match(pkg.files["review-notes.md"], /left to you/);
  });

  test("an empty set of requirements exports and says it is empty", async () => {
    const pkg = await buildPackage(snap({ requirements: [] }));
    assert.match(pkg.files["requirement-schedule.html"], /No requirements have been recorded/);
  });

  test("the structured form carries the same figures as the sheet", async () => {
    const pkg = await buildPackage(snap());
    const json = JSON.parse(pkg.files["requirement-schedule.json"]);
    assert.equal(json.part, "SYN-BRACKET-001");
    assert.equal(json.summary.total, 1);
    assert.equal(json.requirements.length, 1);
    assert.equal(json.status, DRAFT_LABEL);
  });

  test("a value from a person cannot break out of the sheet", async () => {
    const r = dim({ source: '<script>alert(1)</script>' });
    const pkg = await buildPackage(snap({ requirements: [r] }));
    assert.equal(/<script>alert/.test(pkg.files["requirement-schedule.html"]), false);
    assert.match(pkg.files["requirement-schedule.html"], /&lt;script&gt;/);
  });
});
