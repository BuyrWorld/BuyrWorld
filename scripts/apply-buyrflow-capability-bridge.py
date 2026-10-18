import re
from pathlib import Path


def guarded_replace(text: str, old: str, new: str, label: str) -> str:
    """Apply one known migration exactly once; fail if the repository shape drifted."""
    if new in text:
        return text
    if text.count(old) != 1:
        raise RuntimeError(f"{label}: expected one migration anchor, found {text.count(old)}")
    return text.replace(old, new, 1)


# 1. Load the browser adapter immediately after the real engine mount. The
# mount tag is content-versioned, so match the governed hash rather than pinning
# this migration to whichever hash happened to exist when the bridge was built.
index_path = Path("index.html")
html = index_path.read_text(encoding="utf-8")
bridge = '<script type="module" src="/buyrflow-bridge.mjs?v=1"></script>'
if bridge not in html:
    mount_re = re.compile(
        r'<script type="module" src="/mount\.mjs\?v=[A-Za-z0-9._-]+"></script>'
    )
    mounts = list(mount_re.finditer(html))
    if len(mounts) != 1:
        raise RuntimeError(f"Expected one versioned mount.mjs tag, found {len(mounts)}")
    anchor = mounts[0].group(0)
    html = html.replace(anchor, anchor + "\n" + bridge, 1)
    index_path.write_text(html, encoding="utf-8")


# 2. This repository deliberately treats its state/evidence documents as
# executable governance. Adding one src module and one eight-test file changes
# the governed inventory, so update the factual records in the same migration
# rather than weakening the assertions that caught the drift.
state_path = Path("docs/CURRENT_STATE.md")
state = state_path.read_text(encoding="utf-8")
state = guarded_replace(
    state,
    "| Modules under `src/` | 0 | 76 |",
    "| Modules under `src/` | 0 | 77 |",
    "CURRENT_STATE module count",
)
state = guarded_replace(
    state,
    "| Test files | 0 | 128 |",
    "| Test files | 0 | 129 |",
    "CURRENT_STATE test-file count",
)
state = guarded_replace(
    state,
    "| Tests | 0 | 3,678, all passing |",
    "| Tests | 0 | 3,686, all passing |",
    "CURRENT_STATE test count",
)
state_note = (
    "A governed BuyrFlow capability handoff now lives at "
    "`src/integration/buyrflow-bridge.mjs`. It validates only the versioned "
    "Should-Cost session, Case identity and requirement context, and normalises "
    "a build-up only after the buyer saves it in that session. It does not "
    "calculate a cost, approve a supplier or carry Case/specification content "
    "in the launch URL.\n\n"
)
state_anchor = "## The calculation layer — `src/calc/`\n"
if "`src/integration/buyrflow-bridge.mjs`" not in state:
    if state.count(state_anchor) != 1:
        raise RuntimeError("CURRENT_STATE bridge note anchor drifted")
    state = state.replace(state_anchor, state_note + state_anchor, 1)
state_path.write_text(state, encoding="utf-8")

handover_path = Path("docs/OWNER_HANDOVER.md")
handover = handover_path.read_text(encoding="utf-8")
handover = guarded_replace(
    handover,
    "**The source.** 76 modules under `src/`.",
    "**The source.** 77 modules under `src/`.",
    "OWNER_HANDOVER module count",
)
handover = guarded_replace(
    handover,
    "**The checks.** 3,678 tests across 128 files,",
    "**The checks.** 3,686 tests across 129 files,",
    "OWNER_HANDOVER test counts",
)
handover_note = (
    "**BuyrFlow handoff.** `src/integration/buyrflow-bridge.mjs` is a narrow "
    "Should-Cost capability boundary, not a second costing engine. BuyrFlow "
    "opens a request-bound session; the Case context arrives only after the "
    "handshake; and only a build-up deliberately saved during that session can "
    "be returned. Piece-count mismatches and non-exact money are refused. The "
    "returned result remains evidence for a human decision, not an award.\n\n"
)
handover_anchor = "**The workflow.** Supplier Claim Review runs end to end:"
if "**BuyrFlow handoff.**" not in handover:
    if handover.count(handover_anchor) != 1:
        raise RuntimeError("OWNER_HANDOVER bridge note anchor drifted")
    handover = handover.replace(handover_anchor, handover_note + handover_anchor, 1)
handover_path.write_text(handover, encoding="utf-8")

evidence_path = Path("docs/EVIDENCE.md")
evidence = evidence_path.read_text(encoding="utf-8")
evidence = guarded_replace(
    evidence,
    "76 modules under `src/`",
    "77 modules under `src/`",
    "EVIDENCE module count",
)
evidence = guarded_replace(
    evidence,
    "3,678 tests across 128 files, seven checks",
    "3,686 tests across 129 files, seven checks",
    "EVIDENCE test counts",
)
evidence_row = (
    "| The BuyrFlow Should-Cost handoff is request-bound rather than a hidden "
    "second engine | `tests/unit/buyrflow-bridge.test.mjs` covers approved "
    "origins, URL data minimisation, exact request matching, save-time binding, "
    "piece-count mismatch refusal, exact minor-unit money and Case-bound result "
    "messages. The bridge delegates the calculation to the existing Should-Cost "
    "Studio. |\n"
)
evidence_anchor = "| Notes taken in a call are stored only on an explicit save |"
if "The BuyrFlow Should-Cost handoff is request-bound" not in evidence:
    if evidence.count(evidence_anchor) != 1:
        raise RuntimeError("EVIDENCE bridge row anchor drifted")
    evidence = evidence.replace(evidence_anchor, evidence_row + evidence_anchor, 1)
evidence_path.write_text(evidence, encoding="utf-8")

print("BuyrFlow capability bridge and governed inventory updates applied.")
