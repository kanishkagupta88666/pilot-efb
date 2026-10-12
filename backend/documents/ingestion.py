from collections import Counter
from dataclasses import dataclass
import logging
from pathlib import Path
from time import perf_counter
from typing import TypedDict

from django.db import DatabaseError, IntegrityError, transaction
from django.utils import timezone

from documents.models import ContentAnchor, Document, DocumentNode, DocumentVersion
from documents.xml_content import TopicContent
from documents.xml_normalization import assemble_normalized_document
from documents.xml_normalization import (
    NormalizedDocumentPayload,
    SerializedIssue,
    SerializedSkippedBlock,
)

logger = logging.getLogger(__name__)


class _TopicOutline(TypedDict):
    id: str
    number: str
    title: str


class _SectionOutline(TypedDict):
    id: str
    number: str
    title: str
    topics: list[_TopicOutline]


class _ChapterOutline(TypedDict):
    id: str
    number: str
    title: str
    sections: list[_SectionOutline]


@dataclass
class IngestionResult:
    success: bool
    duplicate: bool
    document_id: str | None
    revision: int | None
    chapters_written: int
    sections_written: int
    topics_written: int
    total_nodes_written: int
    errors: list[SerializedIssue]
    unresolved_xrefs: list[SerializedIssue]
    skipped_blocks: list[SerializedSkippedBlock]
    skipped_block_counts: dict[str, int]
    elapsed_seconds: float
    message: str | None = None


class DocumentTreeIntegrityError(IntegrityError):
    """Raised when a stored document version does not form a valid tree."""


def validate_version_tree(version: DocumentVersion) -> None:
    """Validate hierarchy and ordering invariants for one stored version."""
    records = list(
        DocumentNode.objects.filter(version=version).values(
            "id",
            "node_type",
            "parent_id",
            "position",
            "sequence",
            "parent__version_id",
            "parent__node_type",
            "parent__position",
        )
    )
    nodes = {record["id"]: record for record in records}
    positions: set[int] = set()
    sibling_sequences: set[tuple[int | None, int]] = set()

    for node in records:
        node_id = node["id"]
        node_type = node["node_type"]
        parent_id = node["parent_id"]
        position = node["position"]
        sequence = node["sequence"]

        if node_type not in DocumentNode.NodeType.values:
            raise DocumentTreeIntegrityError(
                f"Node {node_id} has invalid node type {node_type!r}."
            )
        if position in positions:
            raise DocumentTreeIntegrityError(
                f"Version {version.pk} has duplicate node position {position}."
            )
        positions.add(position)

        sibling_key = (parent_id, sequence)
        if sibling_key in sibling_sequences:
            raise DocumentTreeIntegrityError(
                f"Version {version.pk} has duplicate sibling sequence {sequence} "
                f"for parent {parent_id!r}."
            )
        sibling_sequences.add(sibling_key)

        if parent_id is not None and (
            node["parent__version_id"] != version.pk or parent_id not in nodes
        ):
            raise DocumentTreeIntegrityError(
                f"Node {node_id} has a parent outside version {version.pk}."
            )

    completed: set[int] = set()
    for node_id in nodes:
        path: set[int] = set()
        cursor: int | None = node_id
        while cursor is not None and cursor not in completed:
            if cursor in path:
                raise DocumentTreeIntegrityError(
                    f"Version {version.pk} contains a parent cycle at node {cursor}."
                )
            path.add(cursor)
            cursor = nodes[cursor]["parent_id"]
        completed.update(path)

    for node in records:
        node_id = node["id"]
        node_type = node["node_type"]
        parent_id = node["parent_id"]
        position = node["position"]

        if node_type == DocumentNode.NodeType.CHAPTER:
            if parent_id is not None:
                raise DocumentTreeIntegrityError(
                    f"Chapter node {node_id} must not have a parent."
                )
            continue

        if parent_id is None:
            raise DocumentTreeIntegrityError(
                f"{node_type.title()} node {node_id} must have a parent."
            )

        expected_parent_type = (
            DocumentNode.NodeType.CHAPTER
            if node_type == DocumentNode.NodeType.SECTION
            else DocumentNode.NodeType.SECTION
        )
        if node["parent__node_type"] != expected_parent_type:
            raise DocumentTreeIntegrityError(
                f"{node_type.title()} node {node_id} must have a "
                f"{expected_parent_type} parent."
            )
        if node["parent__position"] >= position:
            raise DocumentTreeIntegrityError(
                f"Parent of node {node_id} must precede it in document order."
            )

    open_parent_ids: dict[str, int | None] = {
        DocumentNode.NodeType.SECTION: None,
        DocumentNode.NodeType.TOPIC: None,
    }
    last_sequences: dict[int | None, int] = {}
    for node in sorted(records, key=lambda record: record["position"]):
        node_id = node["id"]
        node_type = node["node_type"]
        parent_id = node["parent_id"]
        sequence = node["sequence"]

        if node_type == DocumentNode.NodeType.CHAPTER:
            open_parent_ids[DocumentNode.NodeType.SECTION] = node_id
            open_parent_ids[DocumentNode.NodeType.TOPIC] = None
        else:
            if parent_id != open_parent_ids[node_type]:
                raise DocumentTreeIntegrityError(
                    f"Node {node_id} is positioned outside its parent's range "
                    "in document order."
                )
            if node_type == DocumentNode.NodeType.SECTION:
                open_parent_ids[DocumentNode.NodeType.TOPIC] = node_id

        previous_sequence = last_sequences.get(parent_id)
        if previous_sequence is not None and sequence <= previous_sequence:
            raise DocumentTreeIntegrityError(
                f"Sibling sequence of node {node_id} does not match "
                "document order."
            )
        last_sequences[parent_id] = sequence


def _failed(
    *,
    started_at: float,
    message: str,
    document_id: str | None = None,
    revision: int | None = None,
    duplicate: bool = False,
    errors: list[SerializedIssue] | None = None,
    unresolved_xrefs: list[SerializedIssue] | None = None,
    skipped_blocks: list[SerializedSkippedBlock] | None = None,
) -> IngestionResult:
    skipped = skipped_blocks or []
    return IngestionResult(
        success=False,
        duplicate=duplicate,
        document_id=document_id,
        revision=revision,
        chapters_written=0,
        sections_written=0,
        topics_written=0,
        total_nodes_written=0,
        errors=errors or [],
        unresolved_xrefs=unresolved_xrefs or [],
        skipped_blocks=skipped,
        skipped_block_counts=dict(Counter(block["type"] for block in skipped)),
        elapsed_seconds=perf_counter() - started_at,
        message=message,
    )


def _node_records(
    version: DocumentVersion,
    chapters: list[_ChapterOutline],
    topics_by_id: dict[str, TopicContent],
) -> tuple[list[DocumentNode], list[DocumentNode], list[DocumentNode]]:
    chapter_records: list[DocumentNode] = []
    section_records: list[DocumentNode] = []
    topic_records: list[DocumentNode] = []
    chapters_by_id: dict[str, DocumentNode] = {}
    sections_by_id: dict[str, DocumentNode] = {}
    position = 0

    for chapter_sequence, chapter in enumerate(chapters, start=1):
        position += 1
        chapter_node = DocumentNode(
            version=version,
            node_id=chapter["id"],
            node_type=DocumentNode.NodeType.CHAPTER,
            number=chapter["number"],
            title=chapter["title"],
            parent=None,
            sequence=chapter_sequence,
            position=position,
            content_blocks=None,
        )
        chapter_records.append(chapter_node)
        chapters_by_id[chapter["id"]] = chapter_node

        for section_sequence, section in enumerate(chapter["sections"], start=1):
            position += 1
            section_node = DocumentNode(
                version=version,
                node_id=section["id"],
                node_type=DocumentNode.NodeType.SECTION,
                number=section["number"],
                title=section["title"],
                parent=chapters_by_id[chapter["id"]],
                sequence=section_sequence,
                position=position,
                content_blocks=None,
            )
            section_records.append(section_node)
            sections_by_id[section["id"]] = section_node

            for topic_sequence, topic_outline in enumerate(section["topics"], start=1):
                position += 1
                topic_content = topics_by_id[topic_outline["id"]]
                topic_records.append(
                    DocumentNode(
                        version=version,
                        node_id=topic_outline["id"],
                        node_type=DocumentNode.NodeType.TOPIC,
                        number=topic_outline["number"],
                        title=topic_outline["title"],
                        parent=sections_by_id[section["id"]],
                        sequence=topic_sequence,
                        position=position,
                        content_blocks=topic_content["blocks"],
                    )
                )

    return chapter_records, section_records, topic_records


def _anchor_records(
    version: DocumentVersion,
    topic_records: list[DocumentNode],
) -> list[ContentAnchor]:
    """Build one anchor per stored block and per checklist check."""
    anchor_records: list[ContentAnchor] = []
    for topic_node in topic_records:
        for block in topic_node.content_blocks:
            anchor_records.append(
                ContentAnchor(
                    version=version,
                    topic=topic_node,
                    anchor_id=block["id"],
                    anchor_type=block["type"],
                )
            )
            if block["type"] != ContentAnchor.AnchorType.CHECKLIST:
                continue
            for check in block["checks"]:
                anchor_records.append(
                    ContentAnchor(
                        version=version,
                        topic=topic_node,
                        anchor_id=check["id"],
                        anchor_type=ContentAnchor.AnchorType.CHECK,
                    )
                )
    return anchor_records


def _require_unambiguous_ids(
    node_records: list[DocumentNode],
    anchor_records: list[ContentAnchor],
) -> None:
    """Refuse a revision in which one ID would name two different targets.

    A node ID and a block or check ID live in different tables, so the
    database cannot keep them apart. The same pass also catches a block or
    check ID that is repeated.
    """
    seen = {record.node_id for record in node_records}
    repeated: set[str] = set()
    for anchor in anchor_records:
        if anchor.anchor_id in seen:
            repeated.add(anchor.anchor_id)
        seen.add(anchor.anchor_id)
    if repeated:
        raise DocumentTreeIntegrityError(
            "IDs used more than once in this revision: "
            f"{', '.join(sorted(repeated)[:5])}."
        )


def ingest_xml(
    xml_path: str | Path,
    *,
    replace: bool = False,
) -> IngestionResult:
    """Validate, normalize, and transactionally store one XML document revision."""
    started_at = perf_counter()
    source_path = Path(xml_path)
    assembly = assemble_normalized_document(xml_path=source_path)
    report = assembly["ingestionReport"]
    payload = assembly["payload"]
    errors = report["errors"]
    unresolved_xrefs = report["unresolvedXrefs"]
    skipped_blocks = report["skippedBlocks"]

    if (
        payload is None
        or report["is_valid"] is not True
        or errors
        or unresolved_xrefs
    ):
        message = "XML assembly is invalid; no records were written."
        if unresolved_xrefs:
            message = (
                "XML assembly contains unresolved cross-references; "
                "no records were written."
            )
        return _failed(
            started_at=started_at,
            message=message,
            errors=errors,
            unresolved_xrefs=unresolved_xrefs,
            skipped_blocks=skipped_blocks,
        )

    document_data = payload["document"]
    version_data = payload["version"]
    metadata = version_data["metadata"]
    revision = version_data["revision"]
    document_id = document_data["id"]
    topic_content = payload["topicContentById"]

    try:
        with transaction.atomic():
            document, _ = Document.objects.get_or_create(
                id=document_id,
                defaults={
                    "title": metadata["title"],
                    "doc_type": document_data["docType"],
                    "namespace": document_data["namespace"],
                },
            )
            version = (
                DocumentVersion.objects.select_for_update()
                .filter(document=document, revision=revision)
                .first()
            )
            if version is not None and not replace:
                return _failed(
                    started_at=started_at,
                    message=(
                        f"Document {document_id} revision {revision} already exists."
                    ),
                    document_id=document_id,
                    revision=revision,
                    duplicate=True,
                    errors=errors,
                    unresolved_xrefs=unresolved_xrefs,
                    skipped_blocks=skipped_blocks,
                )

            document.title = metadata["title"]
            document.doc_type = document_data["docType"]
            document.namespace = document_data["namespace"]
            document.save(update_fields=("title", "doc_type", "namespace"))

            if version is None:
                version = DocumentVersion.objects.create(
                    document=document,
                    revision=revision,
                    revision_date=metadata["revisionDate"],
                    effective_date=metadata["effectiveDate"],
                    metadata=metadata,
                    source_filename=source_path.name,
                )
            else:
                version.revision_date = metadata["revisionDate"]
                version.effective_date = metadata["effectiveDate"]
                version.metadata = metadata
                version.source_filename = source_path.name
                version.ingested_at = timezone.now()
                version.save(
                    update_fields=(
                        "revision_date",
                        "effective_date",
                        "metadata",
                        "source_filename",
                        "ingested_at",
                    )
                )
                version.nodes.all().delete()

            (
                chapter_records,
                section_records,
                topic_records,
            ) = _node_records(version, payload["chapters"], topic_content)
            if chapter_records:
                DocumentNode.objects.bulk_create(chapter_records)
            if section_records:
                DocumentNode.objects.bulk_create(section_records)
            if topic_records:
                DocumentNode.objects.bulk_create(topic_records)
            anchor_records = _anchor_records(version, topic_records)
            _require_unambiguous_ids(
                [*chapter_records, *section_records, *topic_records],
                anchor_records,
            )
            if anchor_records:
                ContentAnchor.objects.bulk_create(anchor_records)

            validate_version_tree(version)

    except DocumentTreeIntegrityError as error:
        return _failed(
            started_at=started_at,
            message=f"Invalid document tree: {error}",
            document_id=document_id,
            revision=revision,
            errors=errors,
            unresolved_xrefs=unresolved_xrefs,
            skipped_blocks=skipped_blocks,
        )
    except DatabaseError:
        logger.exception(
            "Database write failed while ingesting %s revision %s.",
            document_id,
            revision,
        )
        return _failed(
            started_at=started_at,
            message="Database write failed; no records were written.",
            document_id=document_id,
            revision=revision,
            errors=errors,
            unresolved_xrefs=unresolved_xrefs,
            skipped_blocks=skipped_blocks,
        )

    return IngestionResult(
        success=True,
        duplicate=False,
        document_id=document_id,
        revision=revision,
        chapters_written=len(chapter_records),
        sections_written=len(section_records),
        topics_written=len(topic_records),
        total_nodes_written=(
            len(chapter_records) + len(section_records) + len(topic_records)
        ),
        errors=errors,
        unresolved_xrefs=unresolved_xrefs,
        skipped_blocks=skipped_blocks,
        skipped_block_counts=dict(Counter(block["type"] for block in skipped_blocks)),
        elapsed_seconds=perf_counter() - started_at,
    )


def get_normalized_document(
    document_id: str,
    revision: int,
) -> NormalizedDocumentPayload | None:
    """Rebuild the normalized JSON payload from stored rows, without XML access."""
    version = (
        DocumentVersion.objects.select_related("document")
        .filter(document_id=document_id, revision=revision)
        .first()
    )
    if version is None:
        return None

    validate_version_tree(version)
    nodes = list(
        version.nodes.select_related("parent__parent").order_by("position")
    )
    chapters: list[dict] = []
    chapters_by_id: dict[str, dict] = {}
    sections_by_id: dict[str, dict] = {}
    topic_content_by_id: dict[str, TopicContent] = {}

    for node in nodes:
        if node.node_type == DocumentNode.NodeType.CHAPTER:
            chapter = {
                "id": node.node_id,
                "number": node.number,
                "title": node.title,
                "sections": [],
            }
            chapters.append(chapter)
            chapters_by_id[node.node_id] = chapter
        elif node.node_type == DocumentNode.NodeType.SECTION:
            if node.parent_id is None:
                raise ValueError(f"Stored section {node.node_id} has no parent.")
            section = {
                "id": node.node_id,
                "number": node.number,
                "title": node.title,
                "topics": [],
            }
            chapters_by_id[node.parent.node_id]["sections"].append(section)
            sections_by_id[node.node_id] = section
        elif node.node_type == DocumentNode.NodeType.TOPIC:
            if node.parent_id is None or node.parent.parent_id is None:
                raise ValueError(
                    f"Stored topic {node.node_id} has incomplete parent hierarchy."
                )
            sections_by_id[node.parent.node_id]["topics"].append(
                {
                    "id": node.node_id,
                    "number": node.number,
                    "title": node.title,
                }
            )
            topic_content_by_id[node.node_id] = {
                "id": node.node_id,
                "number": node.number,
                "title": node.title,
                "chapterId": node.parent.parent.node_id,
                "sectionId": node.parent.node_id,
                "blocks": node.content_blocks,
            }

    document = version.document
    return {
        "document": {
            "id": document.id,
            "namespace": document.namespace,
            "docType": document.doc_type,
        },
        "version": {
            "revision": version.revision,
            "metadata": version.metadata,
        },
        "chapters": chapters,
        "topicContentById": topic_content_by_id,
    }
