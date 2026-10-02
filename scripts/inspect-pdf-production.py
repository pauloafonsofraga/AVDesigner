"""Verify production app-owned PDFs against their Engine-to-page transform."""
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
    assert not reader.named_destinations, f"{name}: obsolete named Jump destinations"
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
        assert "/JS" not in annotation and "/JS" not in annotation.get("/A", {})
        assert "/Dest" not in annotation, f"{name}: expected direct GoTo action"
        assert annotation["/A"]["/S"] == "/GoTo"
        rect = list(map(float, annotation["/Rect"]))
        matches = []
        for candidate in case["nodes"]:
            if candidate["pageIndex"] != page_index:
                continue
            box = candidate["pdfRect"]
            candidate_rect = [box["x"], candidate["paperHeight"] - box["y"] - box["height"],
                              box["x"] + box["width"], candidate["paperHeight"] - box["y"]]
            if all(abs(a - b) < 0.03 for a, b in zip(rect, candidate_rect)):
                matches.append(candidate)
        assert len(matches) == 1, f"{name}: source annotation does not match exactly one Jump"
        source = matches[0]
        target = nodes[source["targetDestinationId"]]
        assert source["sourceId"] == target["targetId"] and source["targetId"] == target["sourceId"]
        assert source["destinationId"] not in seen
        seen.add(source["destinationId"])
        assert rect[2] > rect[0] and rect[3] > rect[1]
        action_destination = annotation["/A"]["/D"]
        assert len(action_destination) == 5
        assert action_destination[0] == reader.pages[target["pageIndex"]].indirect_reference
        assert action_destination[1] == "/XYZ"
        assert abs(float(action_destination[2]) - target["pdfRect"]["x"]) < 0.03
        assert abs(float(action_destination[3]) -
                   (target["paperHeight"] - target["pdfRect"]["y"])) < 0.03
        assert str(action_destination[4]) == "NullObject", f"{name}: zoom must remain unchanged"
    assert seen == set(nodes), f"{name}: missing reciprocal source annotations"
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
    if name == "full-project":
        assert any("OUT \\ IN" in line for line in report_lines), f"{name}: matrix crosspoint grid missing"
        assert any("Matrix Routing" in line for line in report_lines), f"{name}: matrix routing missing"
    results.append({"name": name, "pages": len(reader.pages), "links": len(links),
                    "warnings": len(case["warnings"]), "bytes": case["bytes"]})
print(json.dumps({"passed": len(results), "failed": 0, "results": results}, indent=2))
