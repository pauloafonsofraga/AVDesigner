"""Inspect PDFs emitted by engine-output-pdf-smoke.mjs (requires pypdf)."""
import json
import re
import sys
from pathlib import Path
from pypdf import PdfReader


directory = Path(sys.argv[1])
results = []
for name in ["engine", "legacy", "engine-full", "legacy-full", "multipage"]:
    reader = PdfReader(directory / f"{name}.pdf")
    texts = [page.extract_text() for page in reader.pages]
    assert all(len(text.strip().splitlines()) > 1 for text in texts), f"{name}: blank/header-only page"
    operations = reader.pages[0].get_contents().operations
    paths = sum(op in [b"m", b"l", b"c", b"re"] for _, op in operations)
    glyphs = sum(op in [b"Tj", b"TJ"] for _, op in operations)
    assert paths > 100 and glyphs > 20, f"{name}: drawing must contain vector paths and text, not a screenshot"
    table_text = "\n".join(texts[1:])
    assert "Devices" in table_text and "Cable Schedule" in table_text
    if name == "multipage":
        lengths = [int(n) for n in re.findall(r"\b1 SDI (\d+)m\b", table_text)]
        assert sorted(lengths) == list(range(1, 301)), "Every cable schedule row must appear exactly once"
        device_names = re.findall(r"\b1 Device (\d+)\b", table_text)
        assert sorted(map(int, device_names)) == list(range(1, 101)), "Every device row must appear exactly once"
        assert len(reader.pages) > 3
    else:
        assert len(reader.pages) == 2
        for section in ["Adapters / Breakouts", "Racks", "LED Screens", "Matrix Routing"]:
            assert section in table_text, (name, section)
    results.append({"name": name, "pages": len(reader.pages), "vector_path_ops": paths, "text_ops": glyphs})
print(json.dumps(results, indent=2))
