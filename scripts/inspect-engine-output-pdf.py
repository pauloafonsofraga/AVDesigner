"""Inspect PDFs emitted by engine-output-pdf-smoke.mjs (requires pypdf)."""
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
    expected = {}
    for page_index, data in enumerate(pages):
        assert data["diagnostics"]["visibleJumpLinkPaths"] == 0
        matrix = world_transform(reader.pages[page_index], data["diagnostics"]["viewBox"])
        for link in data["navigation"]:
            expected[link["destinationId"]] = {**link, "page": page_index,
                                               "rect": printed_rect(matrix, link["bounds"])}
    annotations = [(i, a.get_object()) for i, p in enumerate(reader.pages)
                   for a in p.get("/Annots", []) if a.get_object()["/Subtype"] == "/Link"]
    assert len(annotations) == len(expected), (name, "annotation count", len(annotations), len(expected))
    assert len(reader.named_destinations) == len(expected)
    if name != "jumps-cross-page":
        assert len(expected) == pages[0]["diagnostics"]["jumpAnnotations"]
        assert len(expected) == 2 * pages[0]["diagnostics"]["jumpLinks"]
    seen = set()
    for page_index, annotation in annotations:
        assert "/URI" not in annotation and "/URI" not in annotation.get("/A", {})
        destination_name = annotation.get("/Dest")
        if destination_name is None:
            assert annotation["/A"]["/S"] == "/GoTo"
            destination_name = annotation["/A"]["/D"]
        target_id = str(destination_name).lstrip("/")
        target = expected[target_id]
        source = next(item for item in expected.values() if item["targetDestinationId"] == target_id)
        assert target["targetDestinationId"] == source["destinationId"], "reciprocal pair"
        assert source["source"] == target["target"] and source["target"] == target["source"]
        assert source["destinationId"] not in seen
        seen.add(source["destinationId"])
        assert page_index == source["page"]
        rect = list(map(float, annotation["/Rect"]))
        assert rect[2] > rect[0] and rect[3] > rect[1]
        assert all(abs(a-b) < .02 for a, b in zip(rect, source["rect"])), (name, rect, source)
        dest = reader.named_destinations[destination_name]
        assert reader.get_destination_page_number(dest) == target["page"]
        assert 0 <= target["page"] < len(reader.pages)
        assert dest["/Type"] == "/XYZ" and float(dest["/Zoom"]) == 0, "preserve reader zoom"
        # Chromium quantizes the SVG origin and fragment offsets separately to
        # whole CSS pixels (up to two pixels / 1.5 pt combined).
        # A page-margin offset would be ~11.3 pt and must fail this assertion.
        assert abs(float(dest["/Left"])-target["rect"][0]) <= 1.5, (name, dest, target)
        assert abs(float(dest["/Top"])-target["rect"][3]) <= 1.5, (name, dest, target)
        assert source["rect"] != target["rect"], "separated endpoints must not share coordinates"
        if name == "jumps-cross-page":
            assert source["page"] != target["page"]
    return {"count": len(annotations), "nodes": list(expected.values()),
            "pageHeights": [float(p.mediabox.height) for p in reader.pages]}


directory = Path(sys.argv[1])
results = []
navigation = {}
for name in ["engine", "legacy", "engine-full", "legacy-full", "multipage",
             "jumps-wide", "jumps-tall", "jumps-cross-page", "jumps-wide-repeat"]:
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
        assert len(reader.pages) == (3 if name == "jumps-cross-page" else 2)
    elif name == "multipage":
        lengths = [int(n) for n in re.findall(r"\b1 SDI (\d+)m\b", table_text)]
        assert sorted(lengths) == list(range(1, 301)), "Every cable schedule row must appear exactly once"
        device_names = re.findall(r"\b1 Device (\d+)\b", table_text)
        assert sorted(map(int, device_names)) == list(range(1, 101)), "Every device row must appear exactly once"
        assert len(reader.pages) > 3
    else:
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
control = PdfReader(directory / "jumps-without-navigation.pdf")
assert not any(p.get("/Annots") for p in control.pages)
assert first.pages[0].get_contents().get_data() == control.pages[0].get_contents().get_data(), "Invisible navigation must not change drawing ink, bounds, scale or whitespace"


def paint_operations(page):
    # Removing annotations renumbers later PDF font resources, not table paint.
    operations = []
    for args, op in page.get_contents().operations:
        if op == b"Tf":
            font = page["/Resources"]["/Font"][args[0]].get_object()
            args = [font["/BaseFont"], font["/ToUnicode"].get_object().get_data(), *args[1:]]
        operations.append((args, op))
    return operations


assert [paint_operations(p) for p in first.pages[1:]] == [paint_operations(p) for p in control.pages[1:]], "Invisible navigation must not change report table paint"
results.append({"name": "jumps-without-navigation", "pages": len(control.pages),
                "identical_paint_streams": True, "internal_reciprocal_annotations": 0})
(directory / "verified-navigation.json").write_text(json.dumps(navigation, indent=2))
print(json.dumps(results, indent=2))
