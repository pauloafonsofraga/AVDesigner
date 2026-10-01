"""Inspect production PDFs emitted by engine-output-pdf-smoke.mjs."""
import json
import re
import sys
from pathlib import Path
from pypdf import PdfReader


def multiply(a, b):
    return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
            a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
            a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]]


def world_transform(page, view):
    """Recover the printed SVG CTM from its Engine viewBox background, not UI pixels.

    This includes page orientation/origin, frame border/padding, meet scaling and
    letterboxing. Navigation rectangles are deliberately not used as calibration.
    """
    matrix = [1, 0, 0, 1, 0, 0]
    stack = []
    expected = [view[key] for key in ["x", "y", "width", "height"]]
    for args, op in page.get_contents().operations:
        if op == b"q":
            stack.append(matrix[:])
        elif op == b"Q":
            matrix = stack.pop()
        elif op == b"cm":
            matrix = multiply(matrix, list(map(float, args)))
        elif op == b"re" and all(abs(float(a)-b) < .001 for a, b in zip(args, expected)):
            return matrix
    raise AssertionError("Engine SVG background transform not found")


def printed_rect(matrix, bounds):
    def point(x, y):
        a, b, c, d, e, f = matrix
        return [a*x+c*y+e, b*x+d*y+f]
    first = point(bounds["x"], bounds["y"])
    last = point(bounds["x"]+bounds["width"], bounds["y"]+bounds["height"])
    return [min(first[0], last[0]), min(first[1], last[1]),
            max(first[0], last[0]), max(first[1], last[1])]


def inspect_navigation(reader, name, directory):
    pages = json.loads((directory / f"{name}.navigation.json").read_text())
    assert all(page["diagnostics"]["visibleJumpLinkPaths"] == 0 for page in pages)
    assert all(page["diagnostics"]["jumpAnnotations"] == 0 for page in pages)
    assert not any(p.get("/Annots") for p in reader.pages), f"{name}: production Jump links must be absent"
    assert not reader.named_destinations, f"{name}: production Jump destinations must be absent"
    return {"count": 0}


directory = Path(sys.argv[1])
results = []
navigation = {}
for name in ["engine", "engine-full", "multipage",
             "jumps-wide", "jumps-tall", "jumps-wide-repeat", "managed-loom"]:
    reader = PdfReader(directory / f"{name}.pdf")
    texts = [page.extract_text() for page in reader.pages]
    assert all(len(text.strip().splitlines()) > 1 for text in texts), f"{name}: blank/header-only page"
    operations = reader.pages[0].get_contents().operations
    paths = sum(op in [b"m", b"l", b"c", b"re"] for _, op in operations)
    glyphs = sum(op in [b"Tj", b"TJ"] for _, op in operations)
    assert paths > 100 and glyphs > 20, f"{name}: drawing must contain vector paths and text, not a screenshot"
    table_text = "\n".join(texts[1:])
    assert "Devices" in table_text and "Cable Schedule" in table_text
    if name.startswith("jumps-"):
        assert len(reader.pages) == 2
    elif name == "multipage":
        lengths = [int(n) for n in re.findall(r"\b1 SDI (\d+)m\b", table_text)]
        assert sorted(lengths) == list(range(1, 301)), "Every cable schedule row must appear exactly once"
        device_names = re.findall(r"\b1 Device (\d+)\b", table_text)
        assert sorted(map(int, device_names)) == list(range(1, 101)), "Every device row must appear exactly once"
        assert len(reader.pages) > 3
    elif name != "managed-loom":
        assert len(reader.pages) == 2
        for section in ["Adapters / Breakouts", "Racks", "LED Screens", "Matrix Routing"]:
            assert section in table_text, (name, section)
    navigation[name] = inspect_navigation(reader, name, directory)
    results.append({"name": name, "pages": len(reader.pages), "vector_path_ops": paths,
                    "text_ops": glyphs, "internal_reciprocal_annotations": navigation[name]["count"]})
first = PdfReader(directory / "jumps-wide.pdf")
repeat = PdfReader(directory / "jumps-wide-repeat.pdf")
assert [p.get_contents().get_data() for p in first.pages] == [p.get_contents().get_data() for p in repeat.pages], "PDF drawing/report streams must be deterministic"
assert [str(a.get_object()) for p in first.pages for a in p.get("/Annots", [])] == [str(a.get_object()) for p in repeat.pages for a in p.get("/Annots", [])], "PDF annotations must be deterministic"
print(json.dumps(results, indent=2))
