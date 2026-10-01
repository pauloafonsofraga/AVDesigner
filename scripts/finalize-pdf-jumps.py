"""Experimental reference: replace Chromium's incorrect Jump destinations.

Usage: python finalize-pdf-jumps.py input.pdf pages.json output.pdf
pages.json is [{"jumpNodes": buildOutputJumpNavigation(scene).jumpNodes}, ...],
one record per drawing page. The normal WireNexus PDF export never invokes this.
"""
import json
import sys
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, FloatObject, NameObject, NullObject


def target_name(annotation):
    destination = annotation.get("/Dest")
    if destination is None:
        action = annotation.get("/A", {})
        if action.get("/S") != "/GoTo":
            raise ValueError("Jump annotation is not an internal GoTo")
        destination = action.get("/D")
    if not isinstance(destination, (str, NameObject)):
        raise ValueError("Jump annotation has no named destination")
    return str(destination).lstrip("/")


def finalize(source, manifest_path, output):
    pages = json.loads(Path(manifest_path).read_text())
    reader = PdfReader(source)
    records = {}
    for page_index, page in enumerate(pages):
        if page_index >= len(reader.pages):
            raise ValueError("Navigation manifest references a missing PDF page")
        for record in page["jumpNodes"]:
            key = record["destinationId"]
            if key in records or record["sourceId"] == record["targetId"]:
                raise ValueError("Duplicate or self-referencing Jump destination")
            records[key] = (page_index, record)
    if not records:
        raise ValueError("No paired Jump Nodes in navigation manifest")
    if any(record["targetDestinationId"] not in records for _, record in records.values()):
        raise ValueError("Navigation manifest has a missing target")
    writer = PdfWriter(clone_from=source)
    annotations = {}
    for page_index, page in enumerate(writer.pages):
        for reference in page.get("/Annots", []):
            annotation = reference.get_object()
            if annotation.get("/Subtype") != "/Link":
                continue
            target = target_name(annotation)
            if target not in records:
                raise ValueError("Unexpected PDF link annotation")
            source_record = records[records[target][1]["targetDestinationId"]][1]
            source_id = source_record["destinationId"]
            if source_id in annotations or records[source_id][0] != page_index:
                raise ValueError("Duplicate Jump annotation or incorrect source page")
            rect = [float(value) for value in annotation["/Rect"]]
            if rect[2] <= rect[0] or rect[3] <= rect[1]:
                raise ValueError("Jump annotation has an empty rectangle")
            annotations[source_id] = (page_index, annotation, rect)
    if set(annotations) != set(records):
        raise ValueError(f"Missing Jump annotations: {sorted(set(records) - set(annotations))}")
    for source_id, (_, annotation, _) in annotations.items():
        target_id = records[source_id][1]["targetDestinationId"]
        target_page, _, target_rect = annotations[target_id]
        destination = ArrayObject([writer.pages[target_page].indirect_reference,
            NameObject("/XYZ"), FloatObject(target_rect[0]), FloatObject(target_rect[3]), NullObject()])
        annotation.pop(NameObject("/Dest"), None)
        annotation[NameObject("/A")] = DictionaryObject({
            NameObject("/S"): NameObject("/GoTo"), NameObject("/D"): destination
        })
    with open(output, "wb") as handle:
        writer.write(handle)
    return len(annotations)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("Usage: finalize-pdf-jumps.py input.pdf pages.json output.pdf")
    count = finalize(*sys.argv[1:])
    print(json.dumps({"experimental": True, "rewrittenJumpLinks": count, "output": sys.argv[3]}))
