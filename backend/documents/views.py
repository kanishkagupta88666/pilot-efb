import re

from django.db.models import Prefetch
from rest_framework.decorators import api_view
from rest_framework.response import Response

from documents import revision_status
from documents.api_errors import (
    DOCUMENT_NOT_FOUND,
    INVALID_REQUEST,
    NO_CURRENT_REVISION,
    NODE_NOT_A_TOPIC,
    NODE_NOT_FOUND,
    REVISION_NOT_FOUND,
    UNSUPPORTED_NODE_TYPE,
    ApiError,
)
from documents.ingestion import DocumentTreeIntegrityError, validate_version_tree
from documents.models import ContentAnchor, Document, DocumentNode, DocumentVersion

READ_METHODS = ["GET", "HEAD"]
_REVISION_PATTERN = re.compile(r"0|[1-9][0-9]*")
_MAX_REVISION_DIGITS = 10
_NODE_NOT_FOUND_MESSAGE = (
    "The node ID does not exist in the selected document revision."
)


@api_view(READ_METHODS)
def health(request):
    return Response({"status": "ok"})


def _require_well_formed(identifier: str, label: str) -> None:
    if "\x00" in identifier:
        raise ApiError(400, INVALID_REQUEST, f"The {label} is malformed.")


def _get_version(doc_id: str, revision: str) -> DocumentVersion:
    """Return the requested version or raise the matching contract error.

    Malformed identifiers are rejected before any query. A well-formed
    revision too long to be stored is simply a revision that does not exist.
    """
    _require_well_formed(doc_id, "document ID")
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


def _get_current_version(doc_id: str) -> DocumentVersion:
    """Return the document's current revision, as the library reports it."""
    _require_well_formed(doc_id, "document ID")
    versions = list(
        DocumentVersion.objects.filter(document_id=doc_id).only(
            "document_id",
            "revision",
            "effective_date",
        )
    )
    current = revision_status.current_revision(
        versions,
        revision_status.current_date(),
    )
    if current is not None:
        return current

    if not versions and not Document.objects.filter(pk=doc_id).exists():
        raise ApiError(404, DOCUMENT_NOT_FOUND, "The document does not exist.")
    raise ApiError(
        404,
        NO_CURRENT_REVISION,
        "The document has no current revision.",
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
    _require_well_formed(topic_id, "node ID")
    version = _get_version(doc_id, revision)
    node = (
        DocumentNode.objects.select_related("parent__parent")
        .filter(version=version, node_id=topic_id)
        .first()
    )
    if node is None:
        raise ApiError(404, NODE_NOT_FOUND, _NODE_NOT_FOUND_MESSAGE)
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


def _without_blocks(queryset, topic_path: str = ""):
    """Leave topic content out of a lookup that only needs identity."""
    return queryset.defer(
        f"{topic_path}content_blocks",
        f"{topic_path}parent__content_blocks",
        f"{topic_path}parent__parent__content_blocks",
    )


def _first_topic(node: DocumentNode, version: DocumentVersion) -> DocumentNode | None:
    """Return the first topic in document order inside a chapter or section."""
    inside = (
        {"parent": node}
        if node.node_type == DocumentNode.NodeType.SECTION
        else {"parent__parent": node}
    )
    return (
        _without_blocks(DocumentNode.objects.select_related("parent__parent"))
        .filter(version=version, node_type=DocumentNode.NodeType.TOPIC, **inside)
        .order_by("position")
        .first()
    )


def _node_not_found(version: DocumentVersion, node_id: str) -> ApiError:
    """Build the not-found error, naming other revisions that hold the ID.

    Other revisions are read only to describe the failure. The request is
    never answered from a revision that was not selected.
    """
    elsewhere = {"version__document_id": version.document_id}
    # The selected revision cannot appear: this runs only after it had no match.
    revisions = set(
        DocumentNode.objects.filter(node_id=node_id, **elsewhere).values_list(
            "version__revision",
            flat=True,
        )
    )
    revisions.update(
        ContentAnchor.objects.filter(anchor_id=node_id, **elsewhere).values_list(
            "version__revision",
            flat=True,
        )
    )
    details = {"availableRevisions": sorted(revisions)} if revisions else None
    return ApiError(404, NODE_NOT_FOUND, _NODE_NOT_FOUND_MESSAGE, details)


@api_view(READ_METHODS)
def resolve_node(request, doc_id: str):
    for parameter in ("nodeId", "revision"):
        if len(request.query_params.getlist(parameter)) > 1:
            raise ApiError(
                400,
                INVALID_REQUEST,
                f"The {parameter} query parameter must be given only once.",
            )
    node_id = request.query_params.get("nodeId")
    if not node_id:
        raise ApiError(
            400,
            INVALID_REQUEST,
            "The nodeId query parameter is required.",
        )
    _require_well_formed(node_id, "node ID")
    if "revision" in request.query_params:
        version = _get_version(doc_id, request.query_params["revision"])
    else:
        version = _get_current_version(doc_id)
    # Access control, once it exists, belongs here: after the version is
    # selected and before any node lookup.

    node = (
        _without_blocks(DocumentNode.objects.select_related("parent__parent"))
        .filter(version=version, node_id=node_id)
        .first()
    )
    if node is None:
        anchor = (
            _without_blocks(
                ContentAnchor.objects.select_related("topic__parent__parent"),
                "topic__",
            )
            .filter(version=version, anchor_id=node_id)
            .first()
        )
        if anchor is None:
            raise _node_not_found(version, node_id)
        topic, target_type = anchor.topic, anchor.anchor_type
        if (
            topic.node_type != DocumentNode.NodeType.TOPIC
            or topic.version_id != version.pk
        ):
            raise DocumentTreeIntegrityError(
                f"Anchor {anchor.pk} does not belong to a topic "
                f"in version {version.pk}."
            )
    elif node.node_type == DocumentNode.NodeType.TOPIC:
        topic, target_type = node, node.node_type
    else:
        topic, target_type = _first_topic(node, version), node.node_type
        if topic is None:
            raise ApiError(
                422,
                UNSUPPORTED_NODE_TYPE,
                "The node exists but contains no topic to open.",
            )

    section, chapter = _topic_parents(topic, version)
    return Response(
        {
            "documentId": version.document_id,
            "selectedRevision": version.revision,
            "chapterId": chapter.node_id,
            "sectionId": section.node_id,
            "topicId": topic.node_id,
            "targetNodeId": node_id,
            "targetType": target_type,
            "topic": {
                "id": topic.node_id,
                "number": topic.number,
                "title": topic.title,
            },
        }
    )
