"""Verify experimental app-owned PDFs against their Engine-to-page transform."""
import json
import sys
from collections import Counter
from pathlib import Path

from pypdf import PdfReader


directory = Path(sys.argv[1])
expected = json.loads((directory / "expected.json").read_text())
results = []
for name, case in expected.items():
    reader = PdfReader(directory / f"{name}.pdf")
    nodes = {node["destinationId"]: node for node in case["nodes"]}
    assert len(nodes) == len(case["nodes"]), f"{name}: duplicate destination ID"
    assert len(reader.pages) >= case["pages"], f"{name}: drawing pages missing"
    assert len(reader.named_destinations) == len(nodes), f"{name}: named destinations missing"
    links = []
    for page_index, page in enumerate(reader.pages):
        assert float(page.mediabox.width) > 0 and float(page.mediabox.height) > 0
        for reference in page.get("/Annots", []):
            annotation = reference.get_object()
            if annotation.get("/Subtype") == "/Link":
                links.append((page_index, annotation))
    assert len(links) == len(nodes), f"{name}: expected {len(nodes)} links, got {len(links)}"
    seen = set()
    for page_index, annotation in links:
        assert "/URI" not in annotation and "/URI" not in annotation.get("/A", {})
        assert annotation["/A"]["/S"] == "/GoTo"
        target_id = str(annotation["/A"]["/D"])
        target = nodes[target_id]
        source = nodes[target["targetDestinationId"]]
        assert source["sourceId"] == target["targetId"]
        assert source["targetId"] == target["sourceId"]
        assert source["destinationId"] not in seen
        seen.add(source["destinationId"])
        assert page_index == source["pageIndex"]
        box = source["pdfRect"]
        source_rect = [box["x"], source["paperHeight"] - box["y"] - box["height"],
                       box["x"] + box["width"], source["paperHeight"] - box["y"]]
        rect = list(map(float, annotation["/Rect"]))
        assert rect[2] > rect[0] and rect[3] > rect[1]
        assert all(abs(a - b) < 0.03 for a, b in zip(rect, source_rect)), (name, rect, source_rect)
        destination = reader.named_destinations[target_id]
        assert reader.get_destination_page_number(destination) == target["pageIndex"]
        target_box = target["pdfRect"]
        assert destination["/Type"] == "/XYZ"
        assert abs(float(destination["/Left"]) - target_box["x"]) < 0.03
        assert abs(float(destination["/Top"]) - (target["paperHeight"] - target_box["y"])) < 0.03
        assert str(destination["/Zoom"]) == "NullObject"
    drawing = reader.pages[0]
    ops = drawing.get_contents().operations
    assert sum(op in [b"m", b"l", b"c", b"re"] for _, op in ops) > 20, f"{name}: drawing rasterized"
    assert sum(op in [b"Tj", b"TJ"] for _, op in ops) > 3, f"{name}: missing vector text"
    report_pages = reader.pages[case["pages"]:]
    report_lines = [line.strip() for page in report_pages for line in page.extract_text().splitlines()]
    assert "Devices" in report_lines, name
    assert all(len([line for line in page.extract_text().splitlines() if line.strip()]) > 4
               for page in report_pages), f"{name}: blank or title-only report page"
    if name == "large-report":
        expected_rows = Counter(f"1 {row['type']} {row['length']}"
                                for row in case["reportRows"]["cables"])
        actual_rows = Counter(line for line in report_lines if line in expected_rows)
        assert len(case["reportRows"]["cables"]) == 300
        assert actual_rows == expected_rows, f"{name}: duplicate or missing cable rows"
    results.append({"name": name, "pages": len(reader.pages), "links": len(links),
                    "warnings": len(case["warnings"]), "bytes": case["bytes"]})
print(json.dumps({"passed": len(results), "failed": 0, "results": results}, indent=2))
