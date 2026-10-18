from pathlib import Path

path = Path("index.html")
html = path.read_text(encoding="utf-8")
anchor = '<script type="module" src="/mount.mjs?v=17f91a1f"></script>'
bridge = '<script type="module" src="/buyrflow-bridge.mjs?v=1"></script>'
if bridge not in html:
    if html.count(anchor) != 1:
        raise RuntimeError(f"Expected one mount.mjs anchor, found {html.count(anchor)}")
    html = html.replace(anchor, anchor + "\n" + bridge, 1)
    path.write_text(html, encoding="utf-8")
print("BuyrFlow capability bridge module inserted.")
