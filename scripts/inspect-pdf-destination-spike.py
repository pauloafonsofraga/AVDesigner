"""Verify the four PDFKit destination representations before choosing one."""
import json
import sys
from pathlib import Path

from pypdf import PdfReader

directory = Path(sys.argv[1])
expected = json.loads((directory / "expected.json").read_text())
reader = PdfReader(directory / "destination-spike.pdf")
assert len(reader.pages) == 2
assert len(reader.named_destinations) == 2

for source_page, page in enumerate(reader.pages):
    target_page = 1 - source_page
    target = expected["targets"][target_page]
    annotations = [ref.get_object() for ref in page["/Annots"]]
    assert len(annotations) == len(expected["sources"])
    for source, annotation in zip(expected["sources"], annotations):
        assert annotation["/Subtype"] == "/Link"
        assert "/URI" not in annotation and "/JS" not in annotation
        action = annotation.get("/A", {})
        assert "/URI" not in action and "/JS" not in action
        rect = [float(value) for value in annotation["/Rect"]]
        desired = [source["x"], expected["height"] - source["y"] - source["height"],
                   source["x"] + source["width"], expected["height"] - source["y"]]
        assert rect == desired, (source_page, source["variant"], rect)
        if source["variant"] == "named-fit-r":
            assert action["/S"] == "/GoTo"
            destination = reader.named_destinations[action["/D"]]
            assert destination["/Type"] == "/FitR"
            assert reader.get_destination_page_number(destination) == target_page
            actual = [float(destination[key]) for key in ["/Left", "/Bottom", "/Right", "/Top"]]
            assert actual == target["fitR"]
            continue
        destination = annotation.get("/Dest") if source["variant"] == "direct-dest-fit-r" else action["/D"]
        if source["variant"] != "direct-dest-fit-r":
            assert action["/S"] == "/GoTo"
        else:
            assert "/A" not in annotation
        assert destination[0] == reader.pages[target_page].indirect_reference
        if source["variant"] == "exact-xyz":
            assert destination[1] == "/XYZ"
            assert abs(float(destination[2]) - target["x"]) < 0.01
            assert abs(float(destination[3]) - expected["height"] + target["y"]) < 0.01
            assert str(destination[4]) == "NullObject"
        else:
            assert destination[1] == "/FitR"
            assert list(map(float, destination[2:])) == target["fitR"]

print("PDF destination spike structure PASS: 2 pages, 8 reciprocal links, 4 distinct internal representations")
