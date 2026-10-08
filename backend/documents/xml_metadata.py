from dataclasses import dataclass
from datetime import date
from pathlib import Path

from lxml import etree

from documents.xml_validation import (
    DEFAULT_XML_PATH,
    ValidationResult,
    XmlValidationIssue,
    secure_xml_parser,
    validate_xml,
)


@dataclass(frozen=True)
class ExtractedDocumentMetadata:
    root_id: str
    root_doc_type: str
    namespace: str
    doc_id: str
    title: str
    doc_type: str
    applicability: str
    revision: int
    revision_date: date
    effective_date: date
    owner: str
    change_summary: str
    classification: str


@dataclass
class MetadataExtractionResult:
    is_valid: bool
    metadata: ExtractedDocumentMetadata | None
    errors: list[XmlValidationIssue]


def _failure(message: str, line: int | None = None) -> MetadataExtractionResult:
    return MetadataExtractionResult(
        is_valid=False,
        metadata=None,
        errors=[XmlValidationIssue(line=line, column=None, message=message)],
    )


def _issues_from_parse_error(error: etree.XMLSyntaxError) -> list[XmlValidationIssue]:
    issues = [
        XmlValidationIssue(
            line=entry.line or None,
            column=entry.column or None,
            message=entry.message,
        )
        for entry in error.error_log
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


def _validated_result(result: ValidationResult) -> MetadataExtractionResult:
    return MetadataExtractionResult(
        is_valid=False,
        metadata=None,
        errors=result.errors,
    )


def extract_metadata(
    xml_path: str | Path | None = None,
) -> MetadataExtractionResult:
    """Validate an XML manual, then extract its root identity and metadata."""
    xml_file = Path(xml_path) if xml_path is not None else DEFAULT_XML_PATH
    validation = validate_xml(xml_path=xml_file)
    if not validation.is_valid:
        return _validated_result(validation)

    try:
        tree = etree.parse(str(xml_file), parser=secure_xml_parser())
    except OSError as error:
        return _failure(f"Unable to read XML file: {error}")
    except etree.XMLSyntaxError as error:
        return MetadataExtractionResult(
            is_valid=False,
            metadata=None,
            errors=_issues_from_parse_error(error),
        )

    root = tree.getroot()
    namespace = etree.QName(root).namespace
    if namespace is None:
        return _failure("The validated manual does not have an XML namespace.")

    root_id = root.get("id")
    root_doc_type = root.get("docType")
    if root_id is None or root_doc_type is None:
        return _failure("The validated manual is missing root identity attributes.")

    meta = root.find(f"{{{namespace}}}meta")
    if meta is None:
        return _failure("The validated manual is missing its metadata element.")

    field_names = (
        "docId",
        "title",
        "docType",
        "applicability",
        "revision",
        "revisionDate",
        "effectiveDate",
        "owner",
        "changeSummary",
        "classification",
    )
    elements = {
        name: meta.find(f"{{{namespace}}}{name}") for name in field_names
    }
    missing_field = next(
        (name for name, element in elements.items() if element is None),
        None,
    )
    if missing_field is not None:
        return _failure(
            f"The validated manual is missing metadata field '{missing_field}'.",
            line=meta.sourceline,
        )

    values = {
        name: (element.text or "").strip()
        for name, element in elements.items()
        if element is not None
    }

    if root_id != values["docId"]:
        return _failure(
            "Root id does not match meta/docId.",
            line=meta.sourceline,
        )
    if root_doc_type != values["docType"]:
        return _failure(
            "Root docType does not match meta/docType.",
            line=meta.sourceline,
        )

    try:
        revision = int(values["revision"])
        revision_date = date.fromisoformat(values["revisionDate"])
        effective_date = date.fromisoformat(values["effectiveDate"])
    except ValueError:
        return _failure(
            "Validated revision or date metadata could not be converted.",
            line=meta.sourceline,
        )

    metadata = ExtractedDocumentMetadata(
        root_id=root_id,
        root_doc_type=root_doc_type,
        namespace=namespace,
        doc_id=values["docId"],
        title=values["title"],
        doc_type=values["docType"],
        applicability=values["applicability"],
        revision=revision,
        revision_date=revision_date,
        effective_date=effective_date,
        owner=values["owner"],
        change_summary=values["changeSummary"],
        classification=values["classification"],
    )
    return MetadataExtractionResult(is_valid=True, metadata=metadata, errors=[])
