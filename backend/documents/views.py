import re

from django.db.models import Prefetch
from rest_framework.decorators import api_view
from rest_framework.response import Response

from documents import revision_status
from documents.api_errors import (
    DOCUMENT_NOT_FOUND,
    INVALID_REQUEST,
    NODE_NOT_A_TOPIC,
    NODE_NOT_FOUND,
    REVISION_NOT_FOUND,
    ApiError,
)
from documents.ingestion import DocumentTreeIntegrityError, validate_version_tree
from documents.models import Document, DocumentNode, DocumentVersion

READ_METHODS = ["GET", "HEAD"]
_REVISION_PATTERN = re.compile(r"0|[1-9][0-9]*")
_MAX_REVISION_DIGITS = 10


@api_view(READ_METHODS)
def health(request):
    return Response({"status": "ok"})


def _get_version(doc_id: str, revision: str) -> DocumentVersion:
    """Return the requested version or raise the matching contract error.

    Malformed identifiers are rejected before any query. A well-formed
    revision too long to be stored is simply a revision that does not exist.
    """
    if "\x00" in doc_id:
        raise ApiError(400, INVALID_REQUEST, "The document ID is malformed.")
    if _REVISION_PATTERN.fullmatch(revision) is None:
        raise ApiError(
            400,
            INVALID_REQUEST,
            "The revision must be a whole number.",
        )

    if len(revision) <= _MAX_REVISION_DIGITS:
        version = (
            DocumentVersion.objects.select_related("document")
            .filter(document_id=doc_id, revision=int(revision))
            .first()
        )
        if version is not None:
            return version

    if not Document.objects.filter(pk=doc_id).exists():
        raise ApiError(404, DOCUMENT_NOT_FOUND, "The document does not exist.")
    raise ApiError(
        404,
        REVISION_NOT_FOUND,
        "The revision is not available for this document.",
    )


def _document_identity(document: Document) -> dict[str, str]:
    return {
        "id": document.id,
        "namespace": document.namespace,
        "docType": document.doc_type,
    }


@api_view(READ_METHODS)
def document_library(request):
    # Document ID order is only a stable placeholder: the source/manifest order
    # the contract asks for is not stored anywhere yet.
    documents = Document.objects.order_by("id").prefetch_related(
        Prefetch(
            "versions",
            queryset=DocumentVersion.objects.order_by("revision"),
        )
    )
    today = revision_status.current_date()
    summaries = []
    for document in documents:
        versions = list(document.versions.all())
        statuses = revision_status.derive_statuses(versions, today)
        summaries.append(
            {
                **_document_identity(document),
                "availableRevisions": [
                    {
                        "revision": version.revision,
                        "revisionDate": version.revision_date.isoformat(),
                        "effectiveDate": version.effective_date.isoformat(),
                        "status": statuses[version.revision],
                        "metadata": version.metadata,
                    }
                    for version in versions
                ],
            }
        )
    return Response({"documents": summaries})


@api_view(READ_METHODS)
def navigation(request, doc_id: str, revision: str):
    version = _get_version(doc_id, revision)
    validate_version_tree(version)

    rows = version.nodes.order_by("position").values(
        "id",
        "node_id",
        "node_type",
        "number",
        "title",
        "parent_id",
    )
    chapters: list[dict] = []
    children_by_pk: dict[int, list[dict]] = {}
    try:
        for row in rows:
            item = {
                "id": row["node_id"],
                "number": row["number"],
                "title": row["title"],
            }
            if row["node_type"] == DocumentNode.NodeType.CHAPTER:
                item["sections"] = children_by_pk[row["id"]] = []
                chapters.append(item)
                continue
            if row["node_type"] == DocumentNode.NodeType.SECTION:
                item["topics"] = children_by_pk[row["id"]] = []
            children_by_pk[row["parent_id"]].append(item)
    except KeyError as error:
        raise DocumentTreeIntegrityError(
            f"Version {version.pk} changed while its navigation was loading."
        ) from error

    return Response(
        {
            "document": _document_identity(version.document),
            "version": {
                "revision": version.revision,
                "metadata": version.metadata,
            },
            "chapters": chapters,
        }
    )


def _topic_parents(
    topic: DocumentNode,
    version: DocumentVersion,
) -> tuple[DocumentNode, DocumentNode]:
    """Return the topic's section and chapter, checking only its own chain."""
    section = topic.parent
    chapter = section.parent if section is not None else None
    if (
        section is None
        or section.node_type != DocumentNode.NodeType.SECTION
        or section.version_id != version.pk
        or chapter is None
        or chapter.node_type != DocumentNode.NodeType.CHAPTER
        or chapter.version_id != version.pk
        or chapter.parent_id is not None
    ):
        raise DocumentTreeIntegrityError(
            f"Topic node {topic.pk} has an invalid parent chain "
            f"in version {version.pk}."
        )
    return section, chapter


@api_view(READ_METHODS)
def topic_content(request, doc_id: str, revision: str, topic_id: str):
    if "\x00" in topic_id:
        raise ApiError(400, INVALID_REQUEST, "The node ID is malformed.")
    version = _get_version(doc_id, revision)
    node = (
        DocumentNode.objects.select_related("parent__parent")
        .filter(version=version, node_id=topic_id)
        .first()
    )
    if node is None:
        raise ApiError(
            404,
            NODE_NOT_FOUND,
            "The node ID does not exist in the selected document revision.",
        )
    if node.node_type != DocumentNode.NodeType.TOPIC:
        raise ApiError(
            404,
            NODE_NOT_A_TOPIC,
            "The node exists in the selected document revision but is not a topic.",
        )

    section, chapter = _topic_parents(node, version)
    if not isinstance(node.content_blocks, list):
        raise DocumentTreeIntegrityError(
            f"Topic node {node.pk} has no stored content blocks."
        )

    return Response(
        {
            "document": _document_identity(version.document),
            "version": {
                "revision": version.revision,
                "revisionDate": version.revision_date.isoformat(),
                "effectiveDate": version.effective_date.isoformat(),
            },
            "topic": {
                "id": node.node_id,
                "number": node.number,
                "title": node.title,
                "chapterId": chapter.node_id,
                "sectionId": section.node_id,
                "blocks": node.content_blocks,
            },
        }
    )
