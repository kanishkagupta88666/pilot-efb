from dataclasses import dataclass
from pathlib import Path
from typing import Literal, TypedDict

from lxml import etree

from documents.xml_validation import (
    DEFAULT_XML_PATH,
    XmlValidationIssue,
    secure_xml_parser,
    validate_xml,
)


class HierarchyNode(TypedDict):
    id: str
    nodeType: Literal["chapter", "section", "topic"]
    number: str
    title: str
    parentId: str | None
    sequence: int


class TopicNavigation(TypedDict):
    id: str
    number: str
    title: str


class SectionNavigation(TypedDict):
    id: str
    number: str
    title: str
    topics: list[TopicNavigation]


class ChapterNavigation(TypedDict):
    id: str
    number: str
    title: str
    sections: list[SectionNavigation]


@dataclass
class HierarchyExtractionResult:
    is_valid: bool
    nodes: list[HierarchyNode]
    navigation: list[ChapterNavigation]
    errors: list[XmlValidationIssue]


def build_navigation(nodes: list[HierarchyNode]) -> list[ChapterNavigation]:
    """Build the nested chapter/section/topic navigation shape in source order."""
    chapters: list[ChapterNavigation] = []
    chapters_by_id: dict[str, ChapterNavigation] = {}
    sections_by_id: dict[str, SectionNavigation] = {}

    for node in nodes:
        if node["nodeType"] == "chapter":
            chapter: ChapterNavigation = {
                "id": node["id"],
                "number": node["number"],
                "title": node["title"],
                "sections": [],
            }
            chapters.append(chapter)
            chapters_by_id[node["id"]] = chapter
        elif node["nodeType"] == "section":
            if node["parentId"] is None:
                raise ValueError(f"Section {node['id']} has no chapter parent.")
            parent_chapter = chapters_by_id.get(node["parentId"])
            if parent_chapter is None:
                raise ValueError(
                    f"Section {node['id']} references unknown chapter "
                    f"{node['parentId']}."
                )
            section: SectionNavigation = {
                "id": node["id"],
                "number": node["number"],
                "title": node["title"],
                "topics": [],
            }
            parent_chapter["sections"].append(section)
            sections_by_id[node["id"]] = section
        elif node["nodeType"] == "topic":
            if node["parentId"] is None:
                raise ValueError(f"Topic {node['id']} has no section parent.")
            parent_section = sections_by_id.get(node["parentId"])
            if parent_section is None:
                raise ValueError(
                    f"Topic {node['id']} references unknown section "
                    f"{node['parentId']}."
                )
            parent_section["topics"].append(
                {
                    "id": node["id"],
                    "number": node["number"],
                    "title": node["title"],
                }
            )

    return chapters


def _parse_errors(error: etree.XMLSyntaxError) -> list[XmlValidationIssue]:
    errors = [
        XmlValidationIssue(
            line=entry.line or None,
            column=entry.column or None,
            message=entry.message,
        )
        for entry in error.error_log
    ]
    if errors:
        return errors

    line, column = getattr(error, "position", (None, None))
    return [
        XmlValidationIssue(
            line=line,
            column=column,
            message="Malformed XML document.",
        )
    ]


def _failure(errors: list[XmlValidationIssue]) -> HierarchyExtractionResult:
    return HierarchyExtractionResult(
        is_valid=False,
        nodes=[],
        navigation=[],
        errors=errors,
    )


def extract_hierarchy(
    xml_path: str | Path | None = None,
) -> HierarchyExtractionResult:
    """Validate a manual, then extract its ordered chapter/section/topic hierarchy."""
    xml_file = Path(xml_path) if xml_path is not None else DEFAULT_XML_PATH
    validation = validate_xml(xml_path=xml_file)
    if not validation.is_valid:
        return _failure(validation.errors)

    try:
        root = etree.parse(str(xml_file), parser=secure_xml_parser()).getroot()
    except OSError as error:
        return _failure(
            [
                XmlValidationIssue(
                    line=None,
                    column=None,
                    message=f"Unable to read XML file: {error}",
                )
            ]
        )
    except etree.XMLSyntaxError as error:
        return _failure(_parse_errors(error))

    namespace = etree.QName(root).namespace
    if namespace is None:
        return _failure(
            [
                XmlValidationIssue(
                    line=root.sourceline,
                    column=None,
                    message="The validated manual does not have an XML namespace.",
                )
            ]
        )

    nodes: list[HierarchyNode] = []
    for chapter_sequence, chapter in enumerate(
        root.findall(f"{{{namespace}}}chapter"),
        start=1,
    ):
        chapter_id = chapter.get("id")
        chapter_number = chapter.get("number")
        chapter_title = chapter.find(f"{{{namespace}}}title")
        if chapter_id is None or chapter_number is None or chapter_title is None:
            return _failure(
                [
                    XmlValidationIssue(
                        line=chapter.sourceline,
                        column=None,
                        message="Validated chapter is missing required hierarchy data.",
                    )
                ]
            )
        nodes.append(
            {
                "id": chapter_id,
                "nodeType": "chapter",
                "number": chapter_number,
                "title": (chapter_title.text or "").strip(),
                "parentId": None,
                "sequence": chapter_sequence,
            }
        )

        for section_sequence, section in enumerate(
            chapter.findall(f"{{{namespace}}}section"),
            start=1,
        ):
            section_id = section.get("id")
            section_number = section.get("number")
            section_title = section.find(f"{{{namespace}}}title")
            if section_id is None or section_number is None or section_title is None:
                return _failure(
                    [
                        XmlValidationIssue(
                            line=section.sourceline,
                            column=None,
                            message="Validated section is missing required hierarchy data.",
                        )
                    ]
                )
            nodes.append(
                {
                    "id": section_id,
                    "nodeType": "section",
                    "number": section_number,
                    "title": (section_title.text or "").strip(),
                    "parentId": chapter_id,
                    "sequence": section_sequence,
                }
            )

            for topic_sequence, topic in enumerate(
                section.findall(f"{{{namespace}}}topic"),
                start=1,
            ):
                topic_id = topic.get("id")
                topic_number = topic.get("number")
                topic_title = topic.find(f"{{{namespace}}}title")
                if topic_id is None or topic_number is None or topic_title is None:
                    return _failure(
                        [
                            XmlValidationIssue(
                                line=topic.sourceline,
                                column=None,
                                message="Validated topic is missing required hierarchy data.",
                            )
                        ]
                    )
                nodes.append(
                    {
                        "id": topic_id,
                        "nodeType": "topic",
                        "number": topic_number,
                        "title": (topic_title.text or "").strip(),
                        "parentId": section_id,
                        "sequence": topic_sequence,
                    }
                )

    return HierarchyExtractionResult(
        is_valid=True,
        nodes=nodes,
        navigation=build_navigation(nodes),
        errors=[],
    )
