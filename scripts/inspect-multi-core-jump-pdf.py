"""Compare exported PDF links with the actual browser export scene, not a second fixture."""
import json
import sys
from pathlib import Path
from pypdf import PdfReader

directory = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/wirenexus-multi-core-jump")
expected = json.loads((directory / "pdf-expected.json").read_text())
reader = PdfReader(directory / "multi-core-jump.pdf")
nodes = expected["nodes"]
annotations = [(i, ref.get_object()) for i, page in enumerate(reader.pages)
               for ref in page.get("/Annots", []) if ref.get_object().get("/Subtype") == "/Link"]
assert len(annotations) == len(nodes) == 2
for node in nodes:
    rect = node["pdfRect"]
    reference = [rect["x"], node["paperHeight"] - rect["y"] - rect["height"],
                 rect["x"] + rect["width"], node["paperHeight"] - rect["y"]]
    match = [(i, a) for i, a in annotations if all(abs(float(v) - r) < .02 for v, r in zip(a["/Rect"], reference))]
    assert len(match) == 1 and match[0][0] == node["pageIndex"]
    annotation = match[0][1]
    action = annotation["/A"].get_object()
    assert action["/S"] == "/GoTo" and "/URI" not in action
    destination = action["/D"]
    assert destination[1] == "/XYZ" and str(destination[4]) == "NullObject"
    target = next(n for n in nodes if n["sourceId"] == node["targetId"])
    assert destination[0].idnum == reader.pages[target["pageIndex"]].indirect_reference.idnum
    assert float(destination[2]) <= target["pdfRect"]["x"]
    assert float(destination[3]) >= target["paperHeight"] - target["pdfRect"]["y"]
text = reader.pages[0].extract_text()
name = expected["scene"]["modelData"]["multiCores"][0]["name"]
assert name in text
print(json.dumps({"pages": len(reader.pages), "reciprocalLinks": len(annotations),
                  "annotationPositionsMatchCanvas": True, "trunkLabelPresent": name}))
