"""Author a new revision: edit a draft, then publish it.

A draft is a private copy of a document's latest revision. Edits change
only the draft. Publishing stores it as a new DocumentVersion with the next
revision number, so the published revisions are never changed and revision
comparison, search and the offline index pick the new revision up as they
do any other. Pilots never see a draft.

Rules
-----
* One draft per document at a time (client Q&A #7).
* Only XML manuals can be authored. A PDF-only document's content comes from
  its PDF, so a new revision of it is a new PDF.
* New sections of text get new IDs of the form ``<prefix>-new-p0001`` (blocks)
  and ``<prefix>-new-t0001`` (topics). They are never reused and cannot
  collide with the client's IDs, which never contain ``-new-``. Existing IDs
  are never changed.
* Topic numbers are positions: adding or deleting a topic renumbers the
  topics after it in the same section, as it would in the client's manuals.
* A draft cannot be published while a paragraph still links to a topic or
  block the draft deletes.
* Editing a paragraph's text turns its cross-references into plain text.
"""

from copy import deepcopy
from datetime import date
import re

from django.db import transaction
from django.utils import timezone

from documents import revision_diff, revision_status
from documents.ingestion import (
    _anchor_records,
    _node_records,
    _require_unambiguous_ids,
    get_normalized_document,
    validate_version_tree,
)
from documents.models import ContentAnchor, Document, DocumentNode, Draft, DocumentVersion

TEXT_TYPES = ("para", "note", "caution", "warning")
MAX_TEXT = 4000
MAX_TITLE = 200
MAX_SUMMARY = 1000
_NEW_ID = re.compile(r"-new-[tp](\d+)$")


class AuthoringError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def _invalid(message: str) -> AuthoringError:
    return AuthoringError(400, "INVALID_REQUEST", message)


def _clean_text(value, label: str, limit: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise _invalid(f"The {label} must not be empty.")
    text = " ".join(value.split())
    if len(text) > limit:
        raise _invalid(f"The {label} must be at most {limit} characters.")
    return text


# Reading ---------------------------------------------------------------


def _latest_version(document_id: str) -> DocumentVersion:
    version = (
        DocumentVersion.objects.filter(document_id=document_id).order_by("-revision").first()
    )
    if version is None:
        if not Document.objects.filter(pk=document_id).exists():
            raise AuthoringError(404, "DOCUMENT_NOT_FOUND", "The document does not exist.")
        raise AuthoringError(404, "REVISION_NOT_FOUND", "The document has no revision.")
    return version


def get_draft(document_id: str) -> Draft:
    draft = Draft.objects.select_related("base_version").filter(document_id=document_id).first()
    if draft is None:
        raise AuthoringError(404, "NO_DRAFT", "This document has no draft.")
    return draft


def _id_prefix(payload: dict) -> str:
    """The client's ID prefix, from the first topic ID: fm100-t0001 -> fm100."""
    for chapter in payload["chapters"]:
        for section in chapter["sections"]:
            for topic in section["topics"]:
                return topic["id"].rsplit("-", 1)[0]
    return "node"


def _highest_new_number(document_id: str, payload: dict) -> int:
    highest = 0

    def note(identifier: str) -> None:
        nonlocal highest
        match = _NEW_ID.search(identifier)
        if match:
            highest = max(highest, int(match[1]))

    for node_id, blocks in DocumentNode.objects.filter(
        version__document_id=document_id
    ).values_list("node_id", "content_blocks"):
        note(node_id)
        for block in blocks or ():
            note(block["id"])
    for topic_id, topic in payload["topics"].items():
        note(topic_id)
        for block in topic["blocks"]:
            note(block["id"])
    return highest


def _draft_revision(draft: Draft) -> revision_diff.DraftRevision:
    return revision_diff.DraftRevision(
        document_id=draft.document_id,
        revision=draft.base_version.revision + 1,
        payload=draft.payload,
    )


def draft_view(draft: Draft) -> dict:
    """The draft's outline and its changes against the base revision."""
    changes = revision_diff.compare_versions(draft.base_version, _draft_revision(draft))
    return {
        "docId": draft.document_id,
        "baseRevision": draft.base_version.revision,
        "nextRevision": draft.base_version.revision + 1,
        "createdAt": draft.created_at.isoformat(),
        "updatedAt": draft.updated_at.isoformat(),
        "chapters": draft.payload["chapters"],
        "summary": changes["summary"],
        "changes": {"topics": changes["topics"], "blocks": changes["blocks"]},
        "earliestEffectiveDate": _earliest_effective_date(draft.document_id).isoformat(),
    }


def topic_view(draft: Draft, topic_id: str) -> dict:
    comparison = revision_diff.compare_node(draft.base_version, _draft_revision(draft), topic_id)
    if comparison is None:
        raise AuthoringError(404, "NODE_NOT_FOUND", "The topic is not in the draft or its base.")
    return comparison


# Starting and discarding -------------------------------------------------


@transaction.atomic
def start_draft(document_id: str) -> tuple[Draft, bool]:
    """Return the document's draft, creating it from the latest revision."""
    existing = Draft.objects.select_related("base_version").filter(document_id=document_id).first()
    if existing is not None:
        return existing, False
    base = _latest_version(document_id)
    if (base.metadata or {}).get("source") == "pdf-only":
        raise AuthoringError(
            422,
            "NOT_EDITABLE",
            "This document comes from a PDF; publish a new PDF to revise it.",
        )
    normalized = get_normalized_document(document_id, base.revision)
    payload = {
        "chapters": normalized["chapters"],
        "topics": {
            topic_id: {"blocks": deepcopy(topic["blocks"])}
            for topic_id, topic in normalized["topicContentById"].items()
        },
    }
    payload["nextNewId"] = _highest_new_number(document_id, payload) + 1
    payload["idPrefix"] = _id_prefix(payload)
    return Draft.objects.create(document_id=document_id, base_version=base, payload=payload), True


def discard_draft(document_id: str) -> None:
    get_draft(document_id).delete()


# Editing ----------------------------------------------------------------


def _locate_topic(payload: dict, topic_id: str) -> tuple[dict, int]:
    for chapter in payload["chapters"]:
        for section in chapter["sections"]:
            for index, topic in enumerate(section["topics"]):
                if topic["id"] == topic_id:
                    return section, index
    raise AuthoringError(404, "NODE_NOT_FOUND", "The topic is not in the draft.")


def _new_id(payload: dict, kind: str) -> str:
    number = payload["nextNewId"]
    payload["nextNewId"] = number + 1
    return f"{payload['idPrefix']}-new-{kind}{number:04d}"


def _renumber(section: dict) -> None:
    """Number the section's topics by position, when they follow that pattern."""
    pattern = re.compile(rf"^{re.escape(section['number'])}\.\d+$")
    if all(pattern.match(topic["number"]) or "-new-" in topic["id"] for topic in section["topics"]):
        for index, topic in enumerate(section["topics"], start=1):
            topic["number"] = f"{section['number']}.{index}"


def _save(draft: Draft) -> Draft:
    draft.updated_at = timezone.now()
    draft.save(update_fields=("payload", "updated_at"))
    return draft


def _edit(document_id: str, change) -> Draft:
    with transaction.atomic():
        draft = Draft.objects.select_for_update().select_related("base_version").filter(
            document_id=document_id
        ).first()
        if draft is None:
            raise AuthoringError(404, "NO_DRAFT", "This document has no draft.")
        change(draft.payload)
        return _save(draft)


def _blocks(payload: dict, topic_id: str) -> list[dict]:
    _locate_topic(payload, topic_id)
    return payload["topics"][topic_id]["blocks"]


def _block_index(blocks: list[dict], block_id: str) -> int:
    for index, block in enumerate(blocks):
        if block["id"] == block_id:
            return index
    raise AuthoringError(404, "NODE_NOT_FOUND", "The block is not in this topic of the draft.")


def add_block(document_id: str, topic_id: str, *, after_id, block_type, text) -> tuple[Draft, str]:
    if block_type not in TEXT_TYPES:
        raise _invalid(f"The block type must be one of: {', '.join(TEXT_TYPES)}.")
    text = _clean_text(text, "text", MAX_TEXT)
    created: list[str] = []

    def change(payload: dict) -> None:
        blocks = _blocks(payload, topic_id)
        position = 0 if after_id is None else _block_index(blocks, after_id) + 1
        block_id = _new_id(payload, "p")
        blocks.insert(position, {"type": block_type, "id": block_id,
                                 "segments": [{"type": "text", "text": text}]})
        created.append(block_id)

    return _edit(document_id, change), created[0]


def update_block(document_id: str, topic_id: str, block_id: str, *, text, block_type=None) -> Draft:
    text = _clean_text(text, "text", MAX_TEXT)
    if block_type is not None and block_type not in TEXT_TYPES:
        raise _invalid(f"The block type must be one of: {', '.join(TEXT_TYPES)}.")

    def change(payload: dict) -> None:
        blocks = _blocks(payload, topic_id)
        block = blocks[_block_index(blocks, block_id)]
        if block["type"] not in TEXT_TYPES:
            raise AuthoringError(
                422, "NOT_EDITABLE", "Only paragraphs, notes, cautions and warnings can be edited."
            )
        current = "".join(segment["text"] for segment in block["segments"])
        if current == text and (block_type is None or block_type == block["type"]):
            return
        block["segments"] = [{"type": "text", "text": text}]
        if block_type is not None:
            block["type"] = block_type

    return _edit(document_id, change)


def delete_block(document_id: str, topic_id: str, block_id: str) -> Draft:
    def change(payload: dict) -> None:
        blocks = _blocks(payload, topic_id)
        index = _block_index(blocks, block_id)
        if len(blocks) == 1:
            raise AuthoringError(
                422, "NOT_EDITABLE", "A topic needs at least one block; delete the topic instead."
            )
        del blocks[index]

    return _edit(document_id, change)


def rename_topic(document_id: str, topic_id: str, *, title) -> Draft:
    title = _clean_text(title, "title", MAX_TITLE)

    def change(payload: dict) -> None:
        section, index = _locate_topic(payload, topic_id)
        section["topics"][index]["title"] = title

    return _edit(document_id, change)


def add_topic(document_id: str, *, after_topic_id, title, text) -> tuple[Draft, str]:
    title = _clean_text(title, "title", MAX_TITLE)
    text = _clean_text(text, "text", MAX_TEXT)
    created: list[str] = []

    def change(payload: dict) -> None:
        section, index = _locate_topic(payload, after_topic_id)
        topic_id = _new_id(payload, "t")
        block_id = _new_id(payload, "p")
        section["topics"].insert(index + 1, {
            "id": topic_id,
            "number": f"{section['number']}.new",
            "title": title,
        })
        payload["topics"][topic_id] = {
            "blocks": [{"type": "para", "id": block_id, "segments": [{"type": "text", "text": text}]}]
        }
        _renumber(section)
        created.append(topic_id)

    return _edit(document_id, change), created[0]


def delete_topic(document_id: str, topic_id: str) -> Draft:
    def change(payload: dict) -> None:
        section, index = _locate_topic(payload, topic_id)
        del section["topics"][index]
        del payload["topics"][topic_id]
        _renumber(section)

    return _edit(document_id, change)


# Publishing -------------------------------------------------------------


def _earliest_effective_date(document_id: str) -> date:
    """A new revision takes effect no earlier than today or any existing revision."""
    latest = (
        DocumentVersion.objects.filter(document_id=document_id)
        .order_by("-effective_date")
        .values_list("effective_date", flat=True)
        .first()
    )
    today = revision_status.current_date()
    return max(today, latest) if latest else today


def _dangling_references(payload: dict) -> list[tuple[str, str]]:
    """(block ID, target ID) for each link to something the draft no longer has."""
    known = set(payload["topics"])
    for chapter in payload["chapters"]:
        known.add(chapter["id"])
        for section in chapter["sections"]:
            known.add(section["id"])
    for topic in payload["topics"].values():
        for block in topic["blocks"]:
            known.add(block["id"])
            for check in block.get("checks", ()):
                known.add(check["id"])
    dangling = []
    for topic in payload["topics"].values():
        for block in topic["blocks"]:
            for segment in block.get("segments", ()):
                if segment["type"] == "xref" and segment["targetId"] not in known:
                    dangling.append((block["id"], segment["targetId"]))
    return dangling


def publish(document_id: str, *, change_summary, effective_date) -> DocumentVersion:
    change_summary = _clean_text(change_summary, "change summary", MAX_SUMMARY)
    try:
        effective = date.fromisoformat(effective_date)
    except (TypeError, ValueError) as error:
        raise _invalid("The effective date must be a date (YYYY-MM-DD).") from error

    with transaction.atomic():
        draft = Draft.objects.select_for_update().select_related("base_version").filter(
            document_id=document_id
        ).first()
        if draft is None:
            raise AuthoringError(404, "NO_DRAFT", "This document has no draft.")
        earliest = _earliest_effective_date(document_id)
        if effective < earliest:
            raise _invalid(f"The effective date must be {earliest.isoformat()} or later.")
        summary = revision_diff.compare_versions(draft.base_version, _draft_revision(draft))["summary"]
        if not any(summary.values()):
            raise AuthoringError(422, "NO_CHANGES", "The draft has no changes to publish.")
        dangling = _dangling_references(draft.payload)
        if dangling:
            block_id, target = dangling[0]
            raise AuthoringError(
                422,
                "DANGLING_REFERENCE",
                f"Block {block_id} links to {target}, which this draft deletes. "
                "Edit or delete that block first.",
            )

        latest = DocumentVersion.objects.filter(document_id=document_id).order_by("-revision").first()
        revision = latest.revision + 1
        today = revision_status.current_date()
        metadata = {
            **draft.base_version.metadata,
            "revision": revision,
            "revisionDate": today.isoformat(),
            "effectiveDate": effective.isoformat(),
            "changeSummary": change_summary,
            "authoredInPrototype": True,
            "baseRevision": draft.base_version.revision,
        }
        metadata.pop("pdf", None)
        version = DocumentVersion.objects.create(
            document_id=document_id,
            revision=revision,
            revision_date=today,
            effective_date=effective,
            metadata=metadata,
            source_filename="authored-in-prototype",
        )
        chapters, sections, topics = _node_records(version, draft.payload["chapters"], draft.payload["topics"])
        DocumentNode.objects.bulk_create(chapters)
        DocumentNode.objects.bulk_create(sections)
        DocumentNode.objects.bulk_create(topics)
        anchors = _anchor_records(version, topics)
        _require_unambiguous_ids([*chapters, *sections, *topics], anchors)
        ContentAnchor.objects.bulk_create(anchors)
        validate_version_tree(version)
        draft.delete()
    return version


def block_text(block: dict) -> str:
    return "".join(segment["text"] for segment in block.get("segments", ())) or revision_diff.block_text(block)


def snapshot(document_id: str, topic_id: str, block_id: str | None = None) -> dict:
    """What a topic or block looks like in the draft now, for the audit log."""
    draft = get_draft(document_id)
    section, index = _locate_topic(draft.payload, topic_id)
    topic = section["topics"][index]
    result = {"topicNumber": topic["number"], "topicTitle": topic["title"]}
    if block_id is not None:
        blocks = draft.payload["topics"][topic_id]["blocks"]
        block = blocks[_block_index(blocks, block_id)]
        result.update(blockType=block["type"], text=block_text(block))
    return result
