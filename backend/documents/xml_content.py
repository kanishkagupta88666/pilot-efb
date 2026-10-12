from dataclasses import dataclass
from pathlib import Path
from typing import Literal, NotRequired, TypedDict, TypeAlias, cast

from lxml import etree

from documents.xml_validation import (
    DEFAULT_XML_PATH,
    XmlValidationIssue,
    secure_xml_parser,
    validate_xml,
)


TEXT_BLOCK_TYPES = {"para", "note", "caution", "warning"}
SUPPORTED_BLOCK_TYPES = TEXT_BLOCK_TYPES | {"list", "table", "checklist"}
ID_BEARING_TYPES = SUPPORTED_BLOCK_TYPES | {
    "chapter",
    "section",
    "topic",
    "check",
    "melItem",
}
XML_NAMESPACE = "urn:sample:fltpub:1.0"


class TextSegment(TypedDict):
    type: Literal["text"]
    text: str


class XrefSegment(TypedDict):
    type: Literal["xref"]
    targetId: str
    text: str


class TextBlock(TypedDict):
    type: Literal["para", "note", "caution", "warning"]
    id: str
    segments: list[TextSegment | XrefSegment]


class ListBlock(TypedDict):
    type: Literal["list"]
    id: str
    items: list[str]


class TableRow(TypedDict):
    header: NotRequired[bool]
    cells: list[str]


class TableBlock(TypedDict):
    type: Literal["table"]
    id: str
    rows: list[TableRow]


class ChecklistCheck(TypedDict):
    id: str
    challenge: str
    response: str


class ChecklistBlock(TypedDict):
    type: Literal["checklist"]
    id: str
    checks: list[ChecklistCheck]


ContentBlock: TypeAlias = TextBlock | ListBlock | TableBlock | ChecklistBlock


class TopicContent(TypedDict):
    id: str
    number: str
    title: str
    chapterId: str
    sectionId: str
    blocks: list[ContentBlock]


@dataclass(frozen=True)
class SkippedContentBlock:
    type: str
    id: str | None
    topic_id: str


@dataclass
class ContentExtractionResult:
    is_valid: bool
    topics: list[TopicContent]
    skipped_blocks: list[SkippedContentBlock]
    errors: list[XmlValidationIssue]


@dataclass
class TopicContentResult:
    is_valid: bool
    topic: TopicContent | None
    skipped_blocks: list[SkippedContentBlock]
    errors: list[XmlValidationIssue]


def _issue(message: str, line: int | None = None) -> XmlValidationIssue:
    return XmlValidationIssue(line=line, column=None, message=message)


def _parse_issues(error: etree.XMLSyntaxError, parser: etree.XMLParser) -> list[XmlValidationIssue]:
    issues = [
        XmlValidationIssue(
            line=entry.line or None,
            column=entry.column or None,
            message=entry.message,
        )
        for entry in parser.error_log
    ]
    if issues:
        return issues

    line, column = getattr(error, "position", (None, None))
    return [
        XmlValidationIssue(
            line=line,
            column=column,
            message="Malformed XML document.",
        )
    ]


def _text_content(element: etree._Element) -> str:
    return element.text if element.text is not None else ""


def _is_named(element: etree._Element, name: str) -> bool:
    return isinstance(element.tag, str) and element.tag == f"{{{XML_NAMESPACE}}}{name}"


def _text_block(element: etree._Element, block_type: str) -> TextBlock:
    block_id = element.get("id")
    if block_id is None:
        raise ValueError(f"Validated {block_type} block is missing its ID.")

    segments: list[TextSegment | XrefSegment] = []
    if element.text is not None:
        segments.append({"type": "text", "text": element.text})

    for child in element:
        if not _is_named(child, "xref"):
            continue
        target_id = child.get("target")
        if target_id is None:
            raise ValueError(f"Validated xref in block {block_id} is missing its target.")
        segments.append(
            {
                "type": "xref",
                "targetId": target_id,
                "text": _text_content(child),
            }
        )
        if child.tail is not None:
            segments.append({"type": "text", "text": child.tail})

    return cast(
        TextBlock,
        {"type": block_type, "id": block_id, "segments": segments},
    )


def _convert_block(element: etree._Element, block_type: str) -> ContentBlock:
    block_id = element.get("id")
    if block_id is None:
        raise ValueError(f"Validated {block_type} block is missing its ID.")

    if block_type in TEXT_BLOCK_TYPES:
        return _text_block(element, block_type)
    if block_type == "list":
        return {
            "type": "list",
            "id": block_id,
            "items": [
                _text_content(item)
                for item in element
                if _is_named(item, "item")
            ],
        }
    if block_type == "table":
        rows: list[TableRow] = []
        for row in element:
            if not _is_named(row, "row"):
                continue
            row_data: TableRow = {
                "cells": [
                    _text_content(cell)
                    for cell in row
                    if _is_named(cell, "cell")
                ]
            }
            header = row.get("header")
            if header is not None:
                row_data["header"] = header in {"true", "1"}
            rows.append(row_data)
        return {"type": "table", "id": block_id, "rows": rows}
    if block_type == "checklist":
        checks: list[ChecklistCheck] = []
        for check in element:
            if not _is_named(check, "check"):
                continue
            check_id = check.get("id")
            challenge = next(
                (
                    _text_content(child)
                    for child in check
                    if _is_named(child, "challenge")
                ),
                None,
            )
            response = next(
                (
                    _text_content(child)
                    for child in check
                    if _is_named(child, "response")
                ),
                None,
            )
            if check_id is None or challenge is None or response is None:
                raise ValueError(
                    f"Validated checklist block {block_id} has an incomplete check."
                )
            checks.append(
                {"id": check_id, "challenge": challenge, "response": response}
            )
        return {"type": "checklist", "id": block_id, "checks": checks}

    raise ValueError(f"Unsupported block type requested for conversion: {block_type}")


def extract_all_topic_content(
    xml_path: str | Path | None = None,
) -> ContentExtractionResult:
    """Validate and extract all topic content in one ordered XML traversal."""
    xml_file = Path(xml_path) if xml_path is not None else DEFAULT_XML_PATH
    validation = validate_xml(xml_path=xml_file)
    if not validation.is_valid:
        return ContentExtractionResult(
            is_valid=False,
            topics=[],
            skipped_blocks=[],
            errors=validation.errors,
        )

    parser = secure_xml_parser()
    try:
        root = etree.parse(str(xml_file), parser=parser).getroot()
    except OSError as error:
        return ContentExtractionResult(
            is_valid=False,
            topics=[],
            skipped_blocks=[],
            errors=[_issue(f"Unable to read XML file: {error}")],
        )
    except etree.XMLSyntaxError as error:
        return ContentExtractionResult(
            is_valid=False,
            topics=[],
            skipped_blocks=[],
            errors=_parse_issues(error, parser),
        )

    namespace = etree.QName(root).namespace
    if namespace is None:
        return ContentExtractionResult(
            is_valid=False,
            topics=[],
            skipped_blocks=[],
            errors=[_issue("The validated manual does not have an XML namespace.")],
        )

    if namespace != XML_NAMESPACE:
        return ContentExtractionResult(
            is_valid=False,
            topics=[],
            skipped_blocks=[],
            errors=[_issue(f"Unexpected XML namespace: {namespace}")],
        )

    topics: list[TopicContent] = []
    topics_by_id: dict[str, TopicContent] = {}
    document_ids: set[str] = set()
    ids_seen: set[str] = set()
    skipped_blocks: list[SkippedContentBlock] = []
    xref_targets: list[tuple[str, str, int | None]] = []
    errors: list[XmlValidationIssue] = []

    for element in root.iter():
        if not isinstance(element.tag, str) or etree.QName(element).namespace != XML_NAMESPACE:
            continue

        element_name = etree.QName(element).localname
        element_id = element.get("id")
        if element_id is not None:
            document_ids.add(element_id)
            if element_name in ID_BEARING_TYPES and element_id in ids_seen:
                errors.append(
                    _issue(
                        f"Duplicate XML ID '{element_id}'.",
                        line=element.sourceline,
                    )
                )
            if element_name in ID_BEARING_TYPES:
                ids_seen.add(element_id)

        if element_name == "topic":
            section = element.getparent()
            chapter = section.getparent() if section is not None else None
            title = element.find(f"{{{XML_NAMESPACE}}}title")
            topic_id = element.get("id")
            number = element.get("number")
            if (
                topic_id is None
                or number is None
                or title is None
                or section is None
                or chapter is None
                or section.get("id") is None
                or chapter.get("id") is None
            ):
                errors.append(
                    _issue(
                        "Validated topic is missing required identity, title, or parent data.",
                        line=element.sourceline,
                    )
                )
                continue

            topic: TopicContent = {
                "id": topic_id,
                "number": number,
                "title": _text_content(title),
                "chapterId": chapter.get("id"),
                "sectionId": section.get("id"),
                "blocks": [],
            }
            topics.append(topic)
            topics_by_id[topic_id] = topic
            continue

        parent = element.getparent()
        if parent is None or not isinstance(parent.tag, str):
            continue
        if not _is_named(parent, "topic"):
            continue

        topic_id = parent.get("id")
        block_type = element_name
        if topic_id is None or topic_id not in topics_by_id:
            errors.append(
                _issue(
                    "Validated topic block has no extracted topic parent.",
                    line=element.sourceline,
                )
            )
            continue

        if block_type == "title":
            continue
        if block_type not in SUPPORTED_BLOCK_TYPES:
            skipped_blocks.append(
                SkippedContentBlock(
                    type=block_type,
                    id=element_id,
                    topic_id=topic_id,
                )
            )
            continue

        try:
            block = _convert_block(element, block_type)
        except ValueError as error:
            errors.append(_issue(str(error), line=element.sourceline))
            continue
        topics_by_id[topic_id]["blocks"].append(block)

        if block_type in TEXT_BLOCK_TYPES:
            xref_targets.extend(
                (
                    child.get("target", ""),
                    block["id"],
                    child.sourceline,
                )
                for child in element
                if _is_named(child, "xref")
            )

    for target_id, source_block_id, line in xref_targets:
        if not target_id:
            errors.append(_issue(f"Xref in block '{source_block_id}' has no target.", line))
        elif target_id not in document_ids:
            errors.append(
                _issue(
                    f"Xref in block '{source_block_id}' references unknown ID "
                    f"'{target_id}'.",
                    line,
                )
            )

    return ContentExtractionResult(
        is_valid=not errors,
        topics=topics,
        skipped_blocks=skipped_blocks,
        errors=errors,
    )


def extract_topic_content(
    topic_id: str,
    xml_path: str | Path | None = None,
) -> TopicContentResult:
    """Extract one topic by permanent ID using the shared document traversal."""
    result = extract_all_topic_content(xml_path=xml_path)
    if not result.is_valid:
        topic = next(
            (topic for topic in result.topics if topic["id"] == topic_id),
            None,
        )
        return TopicContentResult(
            is_valid=False,
            topic=topic,
            skipped_blocks=result.skipped_blocks,
            errors=result.errors,
        )

    topic = next(
        (topic for topic in result.topics if topic["id"] == topic_id),
        None,
    )
    if topic is None:
        return TopicContentResult(
            is_valid=False,
            topic=None,
            skipped_blocks=result.skipped_blocks,
            errors=[_issue(f"Topic ID '{topic_id}' was not found.")],
        )

    return TopicContentResult(
        is_valid=True,
        topic=topic,
        skipped_blocks=result.skipped_blocks,
        errors=[],
    )
