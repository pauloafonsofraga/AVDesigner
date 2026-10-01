"""Verify the developer-only finalizer changes destinations, not page paint."""
import json
import sys

from pypdf import PdfReader

original, finalized = [PdfReader(path) for path in sys.argv[1:3]]
manifest = json.load(open(sys.argv[3]))
records = {node["destinationId"]: node for page in manifest for node in page["jumpNodes"]}
assert len(original.pages) == len(finalized.pages)
for before, after in zip(original.pages, finalized.pages):
    assert before.mediabox == after.mediabox
    assert before.get_contents().get_data() == after.get_contents().get_data()
def links(reader):
    return [(index, annotation.get_object()) for index, page in enumerate(reader.pages)
            for annotation in page.get("/Annots", []) if annotation.get_object().get("/Subtype") == "/Link"]


before_links, after_links = links(original), links(finalized)
assert len(before_links) == len(after_links) == len(records)
source_rects = {}
for page_index, annotation in before_links:
    destination = annotation.get("/Dest", annotation.get("/A", {}).get("/D"))
    source = next(record for record in records.values()
                  if record["targetDestinationId"] == str(destination).lstrip("/"))
    assert source["destinationId"] not in source_rects
    source_rects[source["destinationId"]] = (page_index, list(map(float, annotation["/Rect"])))
for (old_page, old_annotation), (page_index, annotation) in zip(before_links, after_links):
    assert page_index == old_page
    old_destination = old_annotation.get("/Dest", old_annotation.get("/A", {}).get("/D"))
    source = next(record for record in records.values()
                  if record["targetDestinationId"] == str(old_destination).lstrip("/"))
    target = records[source["targetDestinationId"]]
    target_page, target_rect = source_rects[target["destinationId"]]
    assert "/URI" not in annotation and "/URI" not in annotation.get("/A", {})
    assert annotation["/A"]["/S"] == "/GoTo"
    destination = annotation["/A"]["/D"]
    assert destination[1] == "/XYZ" and str(destination[4]) == "NullObject"
    rect = list(map(float, annotation["/Rect"]))
    assert rect[2] > rect[0] and rect[3] > rect[1]
    assert all(abs(a - b) < .02 for a, b in zip(rect, source_rects[source["destinationId"]][1]))
    assert destination[0].idnum == finalized.pages[target_page].indirect_reference.idnum
    assert abs(float(destination[2]) - float(target_rect[0])) < .02
    assert abs(float(destination[3]) - float(target_rect[3])) < .02
print(json.dumps({"reciprocalLinks": len(after_links), "paintStreamsIdentical": True}))
