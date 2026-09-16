#!/usr/bin/env python3
"""Offline review supplement. Python 3.10+, standard library only.

Input: BuyrWorld-review-part-model.json downloaded from the Studio.
Output: a new folder and ZIP containing dimensioned SVG views, readable HTML,
the original snapshot and a SHA-256 manifest. Nothing is sent to a service.
This is not a CAD kernel, a STEP exporter or a manufacturing-release drawing.
"""
import argparse
import hashlib
import html
import json
import re
import sys
import zipfile
from pathlib import Path

DRAFT = "DRAFT — FOR TECHNICAL REVIEW"
MAX_FILE = 5 * 1024 * 1024


def integer(value, name, positive=False):
    if isinstance(value, bool) or not re.fullmatch(r"[0-9]{1,16}", str(value)):
        raise ValueError(f"{name} must be an integer number of micrometres.")
    number = int(value)
    if number > 9007199254740991 or (positive and number == 0):
        raise ValueError(f"{name} is outside the supported range.")
    return number


def validate(data):
    if data.get("schema") != "buyrworld-part-review/1" or data.get("geometryUnits") != "um":
        raise ValueError("Use a part-model.json exported by the updated Studio.")
    if data.get("status") != DRAFT:
        raise ValueError("The snapshot must be a draft for technical review.")
    model = data.get("model")
    if not isinstance(model, dict):
        raise ValueError("The snapshot has no model.")
    if model.get("schema") != 1:
        raise ValueError("Unsupported model schema.")
    if model.get("revision") != data.get("modelRevision"):
        raise ValueError("Model and package revisions differ.")
    schedule = data.get("requirementSchedule", {})
    for key in ("part", "partRevision", "modelRevision", "exportedAt"):
        if schedule.get(key) != data.get(key):
            raise ValueError(f"The requirement schedule has a different {key}.")
    w, l, t = [integer(model.get(key), key, True) for key in
               ("widthUm", "lengthUm", "thicknessUm")]
    features = model.get("features")
    if not isinstance(features, list) or len(features) > 500:
        raise ValueError("The supported limit is 500 features.")
    ids, extents = set(), []
    for feature in features:
        fid = feature.get("id", "")
        if not re.fullmatch(r"(hole|pocket)-[1-9][0-9]*", fid) or fid in ids:
            raise ValueError("Feature ids must be unique hole-N or pocket-N values.")
        ids.add(fid)
        x, y = [integer(feature.get(key), key) for key in ("xUm", "yUm")]
        if feature.get("kind") == "through-hole":
            d = integer(feature.get("diameterUm"), "diameter", True)
            box = (2*x-d, 2*y-d, 2*x+d, 2*y+d)
        elif feature.get("kind") == "rectangular-pocket":
            fw, fl, depth = [integer(feature.get(key), key, True) for key in
                             ("widthUm", "lengthUm", "depthUm")]
            if depth >= t:
                raise ValueError(f"{fid} goes through the block.")
            box = (2*x, 2*y, 2*(x+fw), 2*(y+fl))
        else:
            raise ValueError(f"{fid} has an unsupported feature kind.")
        if box[0] < 0 or box[1] < 0 or box[2] > 2*w or box[3] > 2*l:
            raise ValueError(f"{fid} extends outside the block.")
        for other, oid in extents:
            if box[0] < other[2] and other[0] < box[2] and box[1] < other[3] and other[1] < box[3]:
                raise ValueError(f"{fid} overlaps {oid}; intersecting features are unsupported.")
        extents.append((box, fid))
    return model


def mm(value):
    """Exact decimal label, no binary floating-point conversion."""
    whole, fraction = divmod(int(value), 1000)
    return f"{whole}.{fraction:03}".rstrip("0").rstrip(".") if fraction else str(whole)


def views_svg(data, model):
    w, l, t = [int(model[k]) for k in ("widthUm", "lengthUm", "thicknessUm")]
    # Floating point is used only for positioning ink on the page.
    scale = min(440 / w, 220 / l, 90 / t)
    x0, y0 = 90, 350
    sw, sl, st = w*scale, l*scale, t*scale
    shapes = []
    for f in model["features"]:
        x, y = x0+int(f["xUm"])*scale, y0-int(f["yUm"])*scale
        fid = html.escape(f["id"])
        if f["kind"] == "through-hole":
            r = int(f["diameterUm"])*scale/2
            shapes.append(f'<circle cx="{x}" cy="{y}" r="{r}"/><path class="hidden" d="M{x-r-5},{y} h{2*r+10} M{x},{y-r-5} v{2*r+10}"/>')
        else:
            fw, fl = int(f["widthUm"])*scale, int(f["lengthUm"])*scale
            shapes.append(f'<rect x="{x}" y="{y-fl}" width="{fw}" height="{fl}"/>')
        shapes.append(f'<text class="feature" x="{x+7}" y="{y-10}">{fid}</text>')
    safe = html.escape
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 680" role="img" aria-label="Dimensioned review views">
<style>text{{font:13px sans-serif;fill:#18232b;stroke:none}}rect,circle,path,line{{fill:none;stroke:#34434d;stroke-width:1.2}}.hidden{{stroke-dasharray:4 4;stroke:#71828e}}.feature{{font-size:10px}}.dim{{stroke:#667580}}.title{{font-size:22px;font-weight:700}}.draft{{fill:#996000;font-weight:bold}}</style>
<rect width="900" height="680" fill="white" style="fill:white;stroke:none"/>
<text x="35" y="34" class="draft">{DRAFT}</text>
<text x="35" y="67" class="title">Parametric part · review views</text>
<text x="35" y="90">{safe(str(data.get("part") or "Untitled part"))[:120]} · model revision {safe(str(data["modelRevision"]))} · all dimensions mm</text>
<text x="{x0}" y="118">TOP · X right / Y up</text>
<rect x="{x0}" y="{y0-sl}" width="{sw}" height="{sl}"/>
{"".join(shapes)}
<circle cx="{x0}" cy="{y0}" r="3" style="fill:#34434d"/>
<text x="{x0-12}" y="{y0+20}">0,0</text>
<path class="dim" d="M{x0},{y0+28} v16 M{x0+sw},{y0+28} v16 M{x0},{y0+36} h{sw}"/>
<text x="{x0+sw/2}" y="{y0+56}" text-anchor="middle">{mm(w)}</text>
<path class="dim" d="M{x0-32},{y0} h-16 M{x0-32},{y0-sl} h-16 M{x0-40},{y0} v{-sl}"/>
<text x="{x0-50}" y="{y0-sl/2}" text-anchor="end">{mm(l)}</text>
<text x="{x0}" y="447">FRONT · looking along +Y</text>
<rect x="{x0}" y="464" width="{sw}" height="{st}"/>
<text x="{x0+sw+12}" y="{464+st/2+5}">{mm(t)} thick</text>
<text x="610" y="180">Envelope</text><text x="610" y="205">{mm(w)} × {mm(l)} × {mm(t)} mm</text>
<text x="610" y="246">{len(model["features"])} feature(s)</text>
<text x="35" y="580">Origin: bottom-left of the top face. Positive Z goes down into material.</text>
<text x="35" y="605">Feature coordinates, depths, tolerances and specifications are in review.html.</text>
<text x="35" y="630">Scaled for readability. Do not measure this illustration. Front view shows the envelope only.</text>
<text x="35" y="653">This is a review aid, not a standards-compliant manufacturing drawing or a STEP solid.</text>
</svg>'''


def review_html(data, model):
    esc = lambda v: html.escape(str(v if v is not None else "Not recorded"))
    features = []
    for f in model["features"]:
        if f["kind"] == "through-hole":
            size = f'Ø {mm(f["diameterUm"])} mm, through'
        else:
            size = f'{mm(f["widthUm"])} × {mm(f["lengthUm"])} mm, {mm(f["depthUm"])} mm deep'
        features.append(f'<tr><td>{esc(f["id"])}</td><td>{mm(f["xUm"])}</td><td>{mm(f["yUm"])}</td><td>{esc(size)}</td></tr>')
    rows = []
    for r in data.get("displayRows", []):
        cells = [r.get("id"), r.get("label"), r.get("target"),
                 r.get("stated") or r.get("limits"), r.get("spec"), r.get("source"),
                 r.get("verification")]
        rows.append("<tr>"+"".join(f"<td>{esc(c)}</td>" for c in cells)+"</tr>")
    schedule = data["requirementSchedule"]
    summary = schedule.get("summary", {})
    gaps = {k: v for k, v in summary.items() if k != "total" and v}
    material = data.get("material") or {}
    return f'''<!doctype html><html lang="en"><meta charset="utf-8">
<title>BuyrWorld · {esc(data.get("part"))} · Technical review</title>
<style>body{{margin:0;background:#0b1014;color:#f3f6f8;font:14px/1.6 system-ui,sans-serif}}main{{max-width:1100px;margin:auto;padding:40px}}header{{border-bottom:2px solid #d6ff00;padding-bottom:24px}}.brand{{color:#d6ff00;letter-spacing:.14em;font-weight:700}}h1{{font-size:32px;margin:12px 0 4px}}h2{{margin-top:36px;font-size:20px}}.draft{{display:inline-block;background:#d6ff00;color:#0b1014;padding:5px 10px;font-weight:700}}.facts{{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:24px 0}}.facts div{{padding:16px;background:#151e25;border:1px solid #34434d}}small{{display:block;color:#a8b4bd}}img{{width:100%;background:white;border-radius:8px}}table{{width:100%;border-collapse:collapse;font-size:12px}}th,td{{padding:10px;text-align:left;border-bottom:1px solid #34434d;vertical-align:top;overflow-wrap:anywhere}}th{{color:#d6ff00}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}}details{{margin:20px 0}}footer{{margin-top:36px;color:#a8b4bd}}@media print{{body{{background:white;color:#111}}main{{padding:0}}.facts div{{background:#f5f5f5}}th,small,footer,.brand{{color:#333}}img{{max-height:550px}}h2{{break-after:avoid}}tr{{break-inside:avoid}}details{{display:block}}}}</style>
<main><header><div class="brand">BUYRWORLD / ENGINEERING HANDOFF</div><h1>Part review dossier</h1>
<p>{esc(data.get("part"))} · part revision {esc(data.get("partRevision"))}</p><span class="draft">{DRAFT}</span></header>
<div class="facts"><div><small>MODEL REVISION</small>{esc(data["modelRevision"])}</div><div><small>MATERIAL · AS ENTERED</small>{esc(material.get("name"))}</div><div><small>ENVELOPE · mm</small>{mm(model["widthUm"])} × {mm(model["lengthUm"])} × {mm(model["thicknessUm"])}</div></div>
<p>Exported: {esc(data.get("exportedAt"))}. Prepared by: {esc(data.get("preparedBy"))}.</p>
<p>Density: {esc(material.get("density"))} {esc(material.get("densityUnit"))}. Source: {esc(material.get("source"))}.</p>
<img src="dimensioned-views.svg" alt="Top view with width, length and feature positions, plus front envelope with thickness">
<h2>Feature coordinates</h2><p>All coordinates in mm, from the bottom-left corner of the top face. Z points down into material.</p>
<table><thead><tr><th>Feature</th><th>X</th><th>Y</th><th>Size / depth</th></tr></thead><tbody>{"".join(features) or '<tr><td colspan="4">Plain block; no features recorded.</td></tr>'}</tbody></table>
<h2>Tolerances, finishes and specifications</h2><table><thead><tr><th>Id</th><th>Kind</th><th>Scope</th><th>Requirement</th><th>Specification / revision</th><th>Source</th><th>State</th></tr></thead><tbody>{"".join(rows) or '<tr><td colspan="7">No requirements recorded. Ask the reviewer what is needed.</td></tr>'}</tbody></table>
<h2>Review status and outstanding items</h2><p>These states are carried from the exported schedule. No specification has been independently verified by this Python tool.</p><pre>{esc(json.dumps(gaps, ensure_ascii=False, indent=2))}</pre>
<details><summary>Full requirement records, including clauses and questions</summary><pre>{esc(json.dumps(schedule.get("requirements", []), ensure_ascii=False, indent=2))}</pre></details>
<footer>Draft for technical review. No manufacturing approval, STEP solid, CAD associativity, signed review workflow or cost estimate is provided by this supplement. Open this file in a browser and use Print → Save as PDF if you need a PDF copy. Keep source-snapshot.json with the review.</footer></main></html>'''


def build(source, output):
    source, output = Path(source), Path(output)
    if source.stat().st_size > MAX_FILE:
        raise ValueError("Snapshot exceeds the 5 MB limit.")
    raw = source.read_bytes()
    data = json.loads(raw)
    model = validate(data)
    archive = output.with_suffix(".zip")
    if output.exists() or archive.exists():
        raise ValueError("Choose a new output folder; existing work will not be overwritten.")
    files = {
        "source-snapshot.json": raw,
        "dimensioned-views.svg": views_svg(data, model).encode("utf-8"),
        "review.html": review_html(data, model).encode("utf-8"),
    }
    manifest = {
        "status": DRAFT, "modelRevision": data["modelRevision"],
        "partRevision": data.get("partRevision"), "sourceExportedAt": data["exportedAt"],
        "files": {name: {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
                  for name, content in files.items()},
        "limitations": ["Not a STEP solid or manufacturing drawing.",
                       "No engineering approval or standards verification.",
                       "Front view shows the envelope, not hidden feature edges."],
    }
    files["manifest.json"] = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
    output.mkdir(parents=True)
    for name, content in files.items():
        (output / name).write_bytes(content)
    with zipfile.ZipFile(archive, "x", zipfile.ZIP_DEFLATED) as z:
        for name, content in files.items():
            z.writestr(name, content)
    return archive


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--out", type=Path, required=True, help="New output folder, e.g. part-review")
    args = parser.parse_args()
    try:
        archive = build(args.snapshot, args.out)
    except (ValueError, OSError, KeyError, TypeError, AttributeError) as error:
        print(f"Could not build the review: {error}", file=sys.stderr)
        return 1
    print(f"Review created: {archive}")
    print(f"Open {args.out / 'review.html'} to review or print to PDF.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
