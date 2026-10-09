from pathlib import Path
from typing import TypedDict

from documents.xml_content import (
    ContentExtractionResult,
    TopicContent,
    extract_all_topic_content,
)
from documents.xml_hierarchy import ChapterNavigation, extract_hierarchy
from documents.xml_metadata import extract_metadata
from documents.xml_validation import (
    DEFAULT_XML_PATH,
    XmlValidationIssue,
    validate_xml,
)


class NormalizedDocumentPayload(TypedDict):
    document: dict[str, str]
    version: dict[str, object]
    chapters: list[ChapterNavigation]
    topicContentById: dict[str, TopicContent]


class SerializedIssue(TypedDict):
    line: int | None
    column: int | None
    message: str


class SerializedSkippedBlock(TypedDict):
    type: str
    id: str | None
    topicId: str


class IngestionReport(TypedDict):
    is_valid: bool
    errors: list[SerializedIssue]
    unresolvedXrefs: list[SerializedIssue]
    skippedBlocks: list[SerializedSkippedBlock]


class NormalizedDocumentResult(TypedDict):
    payload: NormalizedDocumentPayload | None
    ingestionReport: IngestionReport


def _serialize_issue(issue: XmlValidationIssue) -> SerializedIssue:
    return {
        "line": issue.line,
        "column": issue.column,
        "message": issue.message,
    }


def _is_unresolved_xref(issue: XmlValidationIssue) -> bool:
    return (
        "references unknown ID " in issue.message
        or "has no target." in issue.message
    )


def _report(
    errors: list[XmlValidationIssue],
    content: ContentExtractionResult | None = None,
) -> IngestionReport:
    unresolved_xrefs = [issue for issue in errors if _is_unresolved_xref(issue)]
    skipped_blocks: list[SerializedSkippedBlock] = []
    if content is not None:
        skipped_blocks = [
            {
                "type": block.type,
                "id": block.id,
                "topicId": block.topic_id,
            }
            for block in content.skipped_blocks
        ]
    return {
        "is_valid": not errors,
        "errors": [_serialize_issue(issue) for issue in errors],
        "unresolvedXrefs": [
            _serialize_issue(issue) for issue in unresolved_xrefs
        ],
        "skippedBlocks": skipped_blocks,
    }


def _topic_ids_from_navigation(
    chapters: list[ChapterNavigation],
) -> list[str]:
    return [
        topic["id"]
        for chapter in chapters
        for section in chapter["sections"]
        for topic in section["topics"]
    ]


def assemble_normalized_document(
    xml_path: str | Path | None = None,
) -> NormalizedDocumentResult:
    """Validate and assemble the contract-shaped document plus ingestion report.

    The payload combines the contract's document/version/navigation fields with
    a permanent-ID-keyed topic content map. The report remains a sibling of the
    payload so ingestion diagnostics are not mixed into document data.
    """
    xml_file = Path(xml_path) if xml_path is not None else DEFAULT_XML_PATH
    validation = validate_xml(xml_path=xml_file)
    if not validation.is_valid:
        return {
            "payload": None,
            "ingestionReport": _report(validation.errors),
        }

    metadata_result = extract_metadata(xml_path=xml_file)
    hierarchy_result = extract_hierarchy(xml_path=xml_file)
    content_result = extract_all_topic_content(xml_path=xml_file)

    errors = [
        *metadata_result.errors,
        *hierarchy_result.errors,
        *content_result.errors,
    ]

    if (
        not metadata_result.is_valid
        or metadata_result.metadata is None
        or not hierarchy_result.is_valid
        or not content_result.is_valid
    ):
        report = _report(errors, content_result)
        unresolved_only = bool(errors) and all(
            _is_unresolved_xref(issue) for issue in errors
        )
        if not unresolved_only:
            return {"payload": None, "ingestionReport": report}

    if metadata_result.metadata is None:
        return {
            "payload": None,
            "ingestionReport": _report(errors, content_result),
        }

    navigation_topic_ids = _topic_ids_from_navigation(hierarchy_result.navigation)
    content_topic_ids = [topic["id"] for topic in content_result.topics]
    content_ids_unique = len(content_topic_ids) == len(set(content_topic_ids))
    if (
        not content_ids_unique
        or set(navigation_topic_ids) != set(content_topic_ids)
        or len(navigation_topic_ids) != len(content_topic_ids)
    ):
        consistency_error = XmlValidationIssue(
            line=None,
            column=None,
            message=(
                "Hierarchy topics and topic content entries do not have a "
                "one-to-one ID match."
            ),
        )
        errors.append(consistency_error)
        return {
            "payload": None,
            "ingestionReport": _report(errors, content_result),
        }

    metadata = metadata_result.metadata
    metadata_json: dict[str, str | int] = {
        "docId": metadata.doc_id,
        "title": metadata.title,
        "docType": metadata.doc_type,
        "applicability": metadata.applicability,
        "revision": metadata.revision,
        "revisionDate": metadata.revision_date.isoformat(),
        "effectiveDate": metadata.effective_date.isoformat(),
        "owner": metadata.owner,
        "changeSummary": metadata.change_summary,
        "classification": metadata.classification,
    }
    topic_content_by_id = {
        topic["id"]: topic for topic in content_result.topics
    }
    payload: NormalizedDocumentPayload = {
        "document": {
            "id": metadata.root_id,
            "namespace": metadata.namespace,
            "docType": metadata.root_doc_type,
        },
        "version": {
            "revision": metadata.revision,
            "metadata": metadata_json,
        },
        "chapters": hierarchy_result.navigation,
        "topicContentById": topic_content_by_id,
    }
    return {
        "payload": payload,
        "ingestionReport": _report(errors, content_result),
    }
