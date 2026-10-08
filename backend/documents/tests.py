from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory

from django.test import TestCase
from rest_framework.test import APITestCase

from documents.xml_metadata import extract_metadata
from documents.xml_validation import validate_xml


MINIMAL_VALID_MANUAL = """\
<?xml version="1.0" encoding="UTF-8"?>
<manual xmlns="urn:sample:fltpub:1.0" id="FM-SAMPLE" docType="FM">
  <meta>
    <docId>FM-SAMPLE</docId>
    <title>  Sample  Manual: Test!  </title>
    <docType>FM</docType>
    <applicability>SAMPLE-100</applicability>
    <revision>2</revision>
    <revisionDate>2026-07-01</revisionDate>
    <effectiveDate>2026-07-15</effectiveDate>
    <owner>Sample Owner</owner>
    <changeSummary>Sample summary.</changeSummary>
    <classification>SYNTHETIC SAMPLE</classification>
  </meta>
  <chapter id="sample-c1" number="01">
    <title>Sample chapter</title>
    <section id="sample-s1" number="01.10">
      <title>Sample section</title>
      <topic id="sample-t1" number="01.10.1">
        <title>Sample topic</title>
        <para id="sample-p1">Sample paragraph.</para>
      </topic>
    </section>
  </chapter>
</manual>
"""


class HealthEndpointTests(APITestCase):
    def test_health_returns_ok(self):
        response = self.client.get("/api/health/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})


class XMLValidationTests(TestCase):
    def test_fm_s100_revision_2_validates(self):
        result = validate_xml()

        self.assertTrue(result.is_valid, result.errors)
        self.assertEqual(result.errors, [])

    def test_well_formed_xml_that_violates_schema_returns_line_and_message(self):
        with TemporaryDirectory() as temporary_directory:
            xml_path = Path(temporary_directory) / "invalid.xml"
            xml_path.write_text(
                '<manual xmlns="urn:sample:fltpub:1.0" id="SAMPLE" docType="FM">\n'
                "  <unexpected />\n"
                "</manual>\n",
                encoding="utf-8",
            )

            result = validate_xml(xml_path=xml_path)

        self.assertFalse(result.is_valid)
        self.assertTrue(result.errors)
        self.assertTrue(any(error.line == 2 for error in result.errors))
        self.assertTrue(all(error.message for error in result.errors))

    def test_missing_xml_file_returns_error(self):
        with TemporaryDirectory() as temporary_directory:
            result = validate_xml(
                xml_path=Path(temporary_directory) / "missing.xml",
            )

        self.assertFalse(result.is_valid)
        self.assertTrue(result.errors)
        self.assertIn("Unable to read XML file", result.errors[0].message)
        self.assertIsNone(result.errors[0].line)
        self.assertIsNone(result.errors[0].column)

    def test_missing_xsd_file_returns_error(self):
        with TemporaryDirectory() as temporary_directory:
            result = validate_xml(
                xsd_path=Path(temporary_directory) / "missing.xsd",
            )

        self.assertFalse(result.is_valid)
        self.assertTrue(result.errors)
        self.assertIn("Unable to read XSD file", result.errors[0].message)
        self.assertIsNone(result.errors[0].line)
        self.assertIsNone(result.errors[0].column)

    def test_malformed_xml_returns_parse_error_with_location(self):
        with TemporaryDirectory() as temporary_directory:
            xml_path = Path(temporary_directory) / "malformed.xml"
            xml_path.write_text(
                "<manual>\n  <meta>\n</manual>\n",
                encoding="utf-8",
            )

            result = validate_xml(xml_path=xml_path)

        self.assertFalse(result.is_valid)
        self.assertTrue(result.errors)
        self.assertTrue(all(error.line is not None for error in result.errors))
        self.assertTrue(all(error.message for error in result.errors))

    def test_invalid_xsd_returns_schema_error(self):
        with TemporaryDirectory() as temporary_directory:
            xsd_path = Path(temporary_directory) / "invalid.xsd"
            xsd_path.write_text(
                '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">\n'
                '  <xs:element name="manual" type="xs:unknownType" />\n'
                "</xs:schema>\n",
                encoding="utf-8",
            )

            result = validate_xml(xsd_path=xsd_path)

        self.assertFalse(result.is_valid)
        self.assertTrue(result.errors)
        self.assertTrue(all(error.message for error in result.errors))


class MetadataExtractionTests(TestCase):
    def _write_manual(self, directory: str, content: str) -> Path:
        xml_path = Path(directory) / "manual.xml"
        xml_path.write_text(content, encoding="utf-8")
        return xml_path

    def test_real_fm_s100_revision_2_metadata_is_extracted(self):
        result = extract_metadata()

        self.assertTrue(result.is_valid, result.errors)
        self.assertIsNotNone(result.metadata)
        metadata = result.metadata
        self.assertEqual(metadata.root_id, "FM-S100")
        self.assertEqual(metadata.root_doc_type, "FM")
        self.assertEqual(metadata.namespace, "urn:sample:fltpub:1.0")
        self.assertEqual(metadata.doc_id, "FM-S100")
        self.assertEqual(metadata.title, "Sample Flight Manual - SAMPLE-100")
        self.assertEqual(metadata.doc_type, "FM")
        self.assertEqual(metadata.applicability, "SAMPLE-100")
        self.assertEqual(metadata.revision, 2)
        self.assertIsInstance(metadata.revision, int)
        self.assertEqual(metadata.revision_date, date(2026, 7, 1))
        self.assertEqual(metadata.effective_date, date(2026, 7, 15))
        self.assertIsInstance(metadata.revision_date, date)
        self.assertIsInstance(metadata.effective_date, date)
        self.assertEqual(metadata.owner, "Sample Flight Standards")
        self.assertEqual(
            metadata.change_summary,
            "Reorganization revision. Topics relocated between sections, "
            "five topics removed, text updates and new topics.",
        )
        self.assertEqual(
            metadata.classification,
            "SYNTHETIC SAMPLE - NOT FOR OPERATIONAL USE",
        )

    def test_metadata_text_trims_ends_and_preserves_internal_whitespace(self):
        with TemporaryDirectory() as temporary_directory:
            xml_path = self._write_manual(
                temporary_directory,
                MINIMAL_VALID_MANUAL,
            )
            result = extract_metadata(xml_path=xml_path)

        self.assertTrue(result.is_valid, result.errors)
        self.assertIsNotNone(result.metadata)
        self.assertEqual(result.metadata.title, "Sample  Manual: Test!")

    def test_valid_xml_with_root_id_mismatch_is_rejected(self):
        fixture = MINIMAL_VALID_MANUAL.replace(
            'id="FM-SAMPLE"',
            'id="OTHER-SAMPLE"',
            1,
        )
        with TemporaryDirectory() as temporary_directory:
            xml_path = self._write_manual(temporary_directory, fixture)
            self.assertTrue(validate_xml(xml_path=xml_path).is_valid)

            result = extract_metadata(xml_path=xml_path)

        self.assertFalse(result.is_valid)
        self.assertIsNone(result.metadata)
        self.assertIn("Root id does not match meta/docId", result.errors[0].message)

    def test_valid_xml_with_root_doc_type_mismatch_is_rejected(self):
        fixture = MINIMAL_VALID_MANUAL.replace(
            'docType="FM"',
            'docType="FOM"',
            1,
        )
        with TemporaryDirectory() as temporary_directory:
            xml_path = self._write_manual(temporary_directory, fixture)
            self.assertTrue(validate_xml(xml_path=xml_path).is_valid)

            result = extract_metadata(xml_path=xml_path)

        self.assertFalse(result.is_valid)
        self.assertIsNone(result.metadata)
        self.assertIn(
            "Root docType does not match meta/docType",
            result.errors[0].message,
        )

    def test_schema_invalid_xml_is_rejected_before_metadata_extraction(self):
        invalid_manual = (
            '<manual xmlns="urn:sample:fltpub:1.0" '
            'id="FM-SAMPLE" docType="FM"><unexpected /></manual>'
        )
        with TemporaryDirectory() as temporary_directory:
            xml_path = self._write_manual(temporary_directory, invalid_manual)
            self.assertFalse(validate_xml(xml_path=xml_path).is_valid)

            result = extract_metadata(xml_path=xml_path)

        self.assertFalse(result.is_valid)
        self.assertIsNone(result.metadata)
        self.assertTrue(result.errors)
