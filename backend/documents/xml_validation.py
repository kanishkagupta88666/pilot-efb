from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from lxml import etree


class _ErrorLogEntry(Protocol):
    line: int
    column: int
    message: str


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_XML_PATH = PROJECT_ROOT / "sample-data" / "xml" / "FM-S100_Rev2.xml"
DEFAULT_XSD_PATH = PROJECT_ROOT / "sample-data" / "schema" / "sample-fltpub.xsd"


@dataclass(frozen=True)
class XmlValidationIssue:
    line: int | None
    column: int | None
    message: str


@dataclass
class ValidationResult:
    is_valid: bool
    errors: list[XmlValidationIssue]


def secure_xml_parser() -> etree.XMLParser:
    return etree.XMLParser(
        resolve_entities=False,
        no_network=True,
        load_dtd=False,
        recover=False,
        huge_tree=False,
    )


def _errors_from_log(error_log: Iterable[_ErrorLogEntry]) -> list[XmlValidationIssue]:
    return [
        XmlValidationIssue(
            line=entry.line or None,
            column=entry.column or None,
            message=entry.message,
        )
        for entry in error_log
    ]


def _exception_errors(
    error: etree.LxmlError, message: str
) -> list[XmlValidationIssue]:
    errors = _errors_from_log(error.error_log)
    if errors:
        return errors

    position = getattr(error, "position", (None, None))
    line, column = position
    return [XmlValidationIssue(line=line, column=column, message=message)]


def validate_xml(
    xml_path: str | Path | None = None,
    xsd_path: str | Path | None = None,
) -> ValidationResult:
    """Validate an XML file against an XSD without resolving external resources."""
    xml_file = Path(xml_path) if xml_path is not None else DEFAULT_XML_PATH
    xsd_file = Path(xsd_path) if xsd_path is not None else DEFAULT_XSD_PATH

    try:
        schema_document = etree.parse(str(xsd_file), parser=secure_xml_parser())
        schema = etree.XMLSchema(schema_document)
    except OSError as error:
        return ValidationResult(
            is_valid=False,
            errors=[
                XmlValidationIssue(
                    line=None,
                    column=None,
                    message=f"Unable to read XSD file: {error}",
                )
            ],
        )
    except (etree.XMLSyntaxError, etree.XMLSchemaParseError) as error:
        return ValidationResult(
            is_valid=False,
            errors=_exception_errors(error, "Invalid XSD schema."),
        )

    try:
        xml_document = etree.parse(str(xml_file), parser=secure_xml_parser())
    except OSError as error:
        return ValidationResult(
            is_valid=False,
            errors=[
                XmlValidationIssue(
                    line=None,
                    column=None,
                    message=f"Unable to read XML file: {error}",
                )
            ],
        )
    except etree.XMLSyntaxError as error:
        return ValidationResult(
            is_valid=False,
            errors=_exception_errors(error, "Malformed XML document."),
        )

    if schema.validate(xml_document):
        return ValidationResult(is_valid=True, errors=[])

    errors = _errors_from_log(schema.error_log)
    if not errors:
        errors = [
            XmlValidationIssue(
                line=None,
                column=None,
                message="XML document does not conform to the XSD schema.",
            )
        ]
    return ValidationResult(is_valid=False, errors=errors)
