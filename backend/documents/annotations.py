"""Pilots' private highlights, notes and bookmarks, and how they survive revisions.

Ownership: annotations belong to the pilot, not the device, so the same
pilot sees them on any device (client Q&A #10). Without sign-in the owner is
the name the pilot declares on the device, compared case-insensitively. That
is not private against someone who types the same name; it needs SSO.

Sync: the device keeps annotations locally (offline-first) and sends what
changed. Each annotation carries ``updatedAt``; the newer copy wins, so an
edit made offline on one device and online on another settles on the last
one. Deletions are kept as flags so other devices learn about them.

Revision safety (client Q&A #8), checked against the revision being read:

* unchanged: the node is there and its text is what the pilot annotated.
* changed: the node is there but its text differs: carried forward, flagged
  for the pilot to review. Confirming updates the stored text.
* moved: the node is there under a different topic number: it follows the
  node; the old number is reported.
* removed: the node is not in this revision: shown in a list with the
  original text, where the pilot keeps it as a note or discards it.

A node can be both changed and moved. A detached note (one the pilot kept
after its text was removed) is no longer checked.
"""

from datetime import datetime
import uuid

from django.db import transaction
from django.utils.dateparse import parse_datetime

from documents import search
from documents.models import Annotation, ContentAnchor, DocumentNode, DocumentVersion

MAX_CHANGES = 500
MAX_NOTE = 4000
MAX_QUOTE = 4000
MAX_ANCHOR_TEXT = 20000


class AnnotationError(ValueError):
    pass


def owner_key(name) -> str:
    if not isinstance(name, str) or not name.strip():
        raise AnnotationError("Set your name on this device to keep private annotations.")
    return " ".join(name.split()).lower()[:120]


def serialize(annotation: Annotation) -> dict:
    return {
        "id": str(annotation.id),
        "kind": annotation.kind,
        "documentId": annotation.document_id,
        "revision": annotation.revision,
        "topicId": annotation.topic_id,
        "topicNumber": annotation.topic_number,
        "nodeId": annotation.node_id,
        "start": annotation.start,
        "end": annotation.end,
        "quote": annotation.quote,
        "anchorText": annotation.anchor_text,
        "note": annotation.note,
        "detached": annotation.detached,
        "createdAt": annotation.created_at.isoformat(),
        "updatedAt": annotation.updated_at.isoformat(),
        "deleted": annotation.deleted,
    }


def _text(payload: dict, name: str, limit: int, required: bool = False) -> str:
    value = payload.get(name)
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise AnnotationError(f"{name} must be text.")
    if required and not value.strip():
        raise AnnotationError(f"{name} is required.")
    if len(value) > limit:
        raise AnnotationError(f"{name} is too long.")
    return value


def _when(payload: dict, name: str) -> datetime:
    value = parse_datetime(str(payload.get(name) or ""))
    if value is None or value.tzinfo is None:
        raise AnnotationError(f"{name} must be an ISO date and time with a time zone.")
    return value


def _offset(payload: dict, name: str) -> int | None:
    value = payload.get(name)
    if value is None:
        return None
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise AnnotationError(f"{name} must be a whole number.")
    return value


def _fields(payload: dict) -> dict:
    kind = payload.get("kind")
    if kind not in Annotation.Kind.values:
        raise AnnotationError("kind must be highlight, note or bookmark.")
    revision = payload.get("revision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 0:
        raise AnnotationError("revision must be a whole number.")
    start, end = _offset(payload, "start"), _offset(payload, "end")
    if (start is None) != (end is None) or (start is not None and start >= end):
        raise AnnotationError("start and end must both be given, with start before end.")
    fields = {
        "kind": kind,
        "document_id": _text(payload, "documentId", 128, required=True),
        "revision": revision,
        "topic_id": _text(payload, "topicId", 128, required=True),
        "topic_number": _text(payload, "topicNumber", 64),
        "node_id": _text(payload, "nodeId", 128),
        "start": start,
        "end": end,
        "quote": _text(payload, "quote", MAX_QUOTE),
        "anchor_text": _text(payload, "anchorText", MAX_ANCHOR_TEXT),
        "note": _text(payload, "note", MAX_NOTE),
        "detached": bool(payload.get("detached")),
        "created_at": _when(payload, "createdAt"),
        "updated_at": _when(payload, "updatedAt"),
        "deleted": bool(payload.get("deleted")),
    }
    if kind == Annotation.Kind.NOTE and not fields["note"].strip() and not fields["deleted"]:
        raise AnnotationError("A note needs text.")
    if kind != Annotation.Kind.BOOKMARK and not fields["node_id"] and not fields["detached"]:
        raise AnnotationError("Highlights and notes need a nodeId.")
    return fields


def sync(owner_name, changes) -> dict:
    """Apply a device's changes (newest wins) and return all of the owner's annotations."""
    owner = owner_key(owner_name)
    if not isinstance(changes, list):
        raise AnnotationError("changes must be a list.")
    if len(changes) > MAX_CHANGES:
        raise AnnotationError(f"Send at most {MAX_CHANGES} changes at a time.")
    rejected: list[dict] = []
    with transaction.atomic():
        for payload in changes:
            if not isinstance(payload, dict):
                rejected.append({"id": "", "reason": "Each change must be a JSON object."})
                continue
            try:
                annotation_id = uuid.UUID(str(payload.get("id")))
                fields = _fields(payload)
            except (AnnotationError, ValueError) as error:
                rejected.append({"id": str(payload.get("id", "")), "reason": str(error)})
                continue
            existing = Annotation.objects.select_for_update().filter(pk=annotation_id).first()
            if existing is not None and existing.owner != owner:
                rejected.append({"id": str(annotation_id), "reason": "Not your annotation."})
                continue
            if existing is not None and existing.updated_at >= fields["updated_at"]:
                continue  # The stored copy is as new or newer.
            Annotation.objects.update_or_create(
                pk=annotation_id,
                defaults={**fields, "owner": owner, "owner_name": " ".join(owner_name.split())[:120]},
            )
    annotations = Annotation.objects.filter(owner=owner).order_by("created_at")
    return {"annotations": [serialize(a) for a in annotations], "rejected": rejected}


def _node_text(version: DocumentVersion, node_id: str) -> tuple[DocumentNode, str | None] | None:
    """The topic holding ``node_id`` in this revision, and the node's text."""
    topic = (
        DocumentNode.objects.filter(version=version, node_id=node_id, node_type="topic").first()
    )
    if topic is not None:
        return topic, None
    anchor = (
        ContentAnchor.objects.select_related("topic").filter(version=version, anchor_id=node_id).first()
    )
    if anchor is None:
        return None
    for block in anchor.topic.content_blocks or ():
        if block["id"] == node_id:
            return anchor.topic, search.block_text(block)
        for check in block.get("checks", ()):
            if check["id"] == node_id:
                return anchor.topic, f"{check['challenge']} — {check['response']}"
    return anchor.topic, None


def status_for(version: DocumentVersion, annotations: list[dict]) -> list[dict]:
    """Classify each annotation against ``version``. See the module notes."""
    if not isinstance(annotations, list) or len(annotations) > MAX_CHANGES:
        raise AnnotationError("annotations must be a list of at most 500.")
    results = []
    for item in annotations:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            raise AnnotationError("Each annotation needs an id.")
        node_id = item.get("nodeId") or item.get("topicId")
        if not isinstance(node_id, str) or not node_id:
            raise AnnotationError("Each annotation needs a nodeId or topicId.")
        found = _node_text(version, node_id)
        if found is None:
            results.append({"id": item["id"], "status": "removed", "moved": False, "changed": False})
            continue
        topic, text = found
        recorded_number = item.get("topicNumber") or ""
        moved = bool(recorded_number) and topic.number != recorded_number
        changed = text is not None and text != (item.get("anchorText") or "")
        status = "changed" if changed else "moved" if moved else "unchanged"
        results.append({
            "id": item["id"],
            "status": status,
            "changed": changed,
            "moved": moved,
            "topicId": topic.node_id,
            "topicNumber": topic.number,
            "topicTitle": topic.title,
            "currentText": text,
            "previousTopicNumber": recorded_number if moved else None,
        })
    return results
