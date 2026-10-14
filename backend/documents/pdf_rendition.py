"""Locate a revision's PDF rendition and map its outline to XML node IDs.

The sample PDFs carry no node IDs. Their outline does list every chapter,
section and topic, in document order, titled "<number> <title>". A number is
unique within one revision, so each outline entry is paired with the node at
the same place in the same revision and accepted only when the number and
title agree. Nothing here matches across revisions, where numbers change.
"""

from dataclasses import dataclass
from functools import lru_cache
import json
from pathlib import Path

from pypdf import PdfReader

from documents.models import DocumentNode, DocumentVersion
from documents.xml_validation import PROJECT_ROOT

SAMPLE_DATA = PROJECT_ROOT / "sample-data"
MANIFEST_PATH = SAMPLE_DATA / "manifest.json"
PDF_ROOT = (SAMPLE_DATA / "pdf").resolve()


class PdfNotAvailableError(LookupError):
    """The revision has no PDF rendition in the manifest."""


@dataclass(frozen=True)
class OutlineEntry:
    depth: int
    title: str
    page: int


def _normalize(text: str) -> str:
    return " ".join(text.split())


def pdf_path(document_id: str, revision: int) -> Path:
    """Return the rendition's path, refusing anything outside ``sample-data/pdf``."""
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    for entry in manifest["documents"]:
        if entry["docId"] == document_id and entry["revision"] == revision:
            relative = entry.get("pdf")
            if not relative:
                break
            path = (SAMPLE_DATA / relative).resolve()
            if path.parent != PDF_ROOT or not path.is_file():
                break
            return path
    raise PdfNotAvailableError(f"{document_id} Rev {revision} has no PDF rendition.")


@lru_cache(maxsize=8)
def _read_outline(path: Path, modified: float) -> tuple[int, tuple[OutlineEntry, ...]]:
    del modified  # Cache key only, so a replaced file is read again.
    reader = PdfReader(path)
    entries: list[OutlineEntry] = []

    def walk(items, depth: int) -> None:
        for item in items:
            if isinstance(item, list):
                walk(item, depth + 1)
            else:
                entries.append(
                    OutlineEntry(
                        depth=depth,
                        title=_normalize(item.title),
                        page=reader.get_destination_page_number(item) + 1,
                    )
                )

    walk(reader.outline, 0)
    return len(reader.pages), tuple(entries)


def outline_map(version: DocumentVersion) -> dict:
    """Map each node ID of ``version`` to the PDF pages its outline entry covers.

    ``page`` is where the node starts; ``endPage`` is where the next outline
    entry starts, so a node's text lies within ``page`` to ``endPage``.
    ``heading`` is the outline title, which is also the heading printed on the
    page, so it can be found in the page text. Nodes are listed in document
    order.
    """
    path = pdf_path(version.document_id, version.revision)
    page_count, entries = _read_outline(path, path.stat().st_mtime)
    nodes = list(
        DocumentNode.objects.filter(version=version)
        .order_by("position")
        .values_list("node_id", "number", "title")
    )

    mapped: dict[str, dict] = {}
    unmatched: list[str] = []
    for index, (node_id, number, title) in enumerate(nodes):
        entry = entries[index] if index < len(entries) else None
        if entry is None or entry.title != _normalize(f"{number} {title}"):
            unmatched.append(node_id)
            continue
        following = entries[index + 1].page if index + 1 < len(entries) else page_count
        mapped[node_id] = {
            "page": entry.page,
            "endPage": max(entry.page, following),
            "heading": entry.title,
        }

    return {
        "documentId": version.document_id,
        "revision": version.revision,
        "pageCount": page_count,
        "nodes": mapped,
        "unmatched": unmatched,
    }
