from pathlib import Path
from tempfile import TemporaryDirectory

from django.test import TestCase
from rest_framework.test import APITestCase

from documents.xml_validation import validate_xml


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
