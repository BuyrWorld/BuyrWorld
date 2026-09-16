import copy
import hashlib
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("review", ROOT / "scripts/build_part_review.py")
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


def sample():
    metadata = {"part": "Synthetic bracket", "partRevision": "B", "modelRevision": 3,
                "exportedAt": "2026-09-15T12:00:00Z"}
    return {"schema": "buyrworld-part-review/1", "geometryUnits": "um", "status": review.DRAFT,
            **metadata, "requirementSchedule": {**metadata, "requirements": [], "summary": {}},
            "model": {"schema": 1, "revision": 3, "widthUm": "100000",
                      "lengthUm": "60000", "thicknessUm": "10000", "features": [
                          {"id": "hole-1", "kind": "through-hole",
                           "xUm": "15000", "yUm": "20000", "diameterUm": "8000"},
                          {"id": "pocket-1", "kind": "rectangular-pocket", "xUm": "40000",
                           "yUm": "10000", "widthUm": "20000", "lengthUm": "20000",
                           "depthUm": "3000"}]}}


class PartReviewTests(unittest.TestCase):
    def test_package_preserves_source_and_hashes_actual_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "input.json"
            raw = json.dumps(sample()).encode()
            source.write_bytes(raw)
            archive = review.build(source, root / "result")
            with zipfile.ZipFile(archive) as z:
                self.assertIsNone(z.testzip())
                self.assertEqual(z.read("source-snapshot.json"), raw)
                manifest = json.loads(z.read("manifest.json"))
                for name, record in manifest["files"].items():
                    self.assertEqual(hashlib.sha256(z.read(name)).hexdigest(), record["sha256"])
                self.assertIn("100 × 60 × 10 mm", z.read("dimensioned-views.svg").decode())
            with self.assertRaisesRegex(ValueError, "existing work"):
                review.build(source, root / "result")

    def test_stale_model_or_schedule_is_refused(self):
        for location, key in [("model", "revision"), ("requirementSchedule", "modelRevision")]:
            data = sample()
            data[location][key] = 9
            with self.assertRaises(ValueError):
                review.validate(data)

    def test_overlap_outside_and_through_pocket_are_refused(self):
        for key, value in [("xUm", "98000"), ("depthUm", "10000"), ("xUm", "10000")]:
            data = sample()
            data["model"]["features"][1][key] = value
            with self.assertRaises(ValueError):
                review.validate(data)

    def test_duplicate_ids_and_noninteger_dimensions_are_refused(self):
        data = sample()
        data["model"]["features"][1]["id"] = "hole-1"
        with self.assertRaises(ValueError):
            review.validate(data)
        for bad in [True, -1, "1.5", "NaN", "1e8", "0"]:
            data = sample()
            data["model"]["widthUm"] = bad
            with self.assertRaises(ValueError):
                review.validate(data)

    def test_odd_diameter_does_not_round_away_an_outside_edge(self):
        data = sample()
        data["model"]["features"] = [{"id": "hole-1", "kind": "through-hole",
                                     "xUm": "1000", "yUm": "1000", "diameterUm": "2001"}]
        with self.assertRaises(ValueError):
            review.validate(data)

    def test_html_escapes_input_and_keeps_unknown_material_unknown(self):
        data = sample()
        data["part"] = '<script>alert("x")</script>'
        output = review.review_html(data, data["model"])
        self.assertNotIn("<script>", output)
        self.assertIn("&lt;script&gt;", output)
        self.assertIn("Not recorded", output)
        self.assertEqual(review.mm("123456"), "123.456")
        self.assertEqual(review.mm("100000"), "100")


if __name__ == "__main__":
    unittest.main()
