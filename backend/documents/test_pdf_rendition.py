from rest_framework.test import APITestCase

from documents.ingestion import ingest_xml
from documents.test_api import ApiAssertionsMixin
from documents.xml_validation import PROJECT_ROOT


class PdfRenditionApiTests(ApiAssertionsMixin, APITestCase):
    @classmethod
    def setUpTestData(cls):
        result = ingest_xml(PROJECT_ROOT / "sample-data" / "xml" / "FM-S100_Rev2.xml")
        if not result.success:
            raise AssertionError(result.message)

    def test_outline_maps_every_node_to_a_page(self):
        body = self.assert_json(
            self.client.get("/api/documents/FM-S100/revisions/2/pdf/outline/")
        )
        self.assertEqual(body["pageCount"], 1080)
        self.assertEqual(len(body["nodes"]), 1283)
        self.assertEqual(body["unmatched"], [])
        # The topic that the client's deep-link samples open first.
        self.assertEqual(body["nodes"]["fm100-t1193"]["page"], 2)
        for location in body["nodes"].values():
            self.assertLessEqual(location["page"], location["endPage"])

    def test_pdf_file_is_served(self):
        response = self.client.get("/api/documents/FM-S100/revisions/2/pdf/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertTrue(b"".join(response.streaming_content).startswith(b"%PDF"))

    def test_unknown_revision_has_no_pdf(self):
        self.assert_error(
            self.client.get("/api/documents/FM-S100/revisions/9/pdf/outline/"),
            404,
            "REVISION_NOT_FOUND",
        )
        self.assert_error(
            self.client.get("/api/documents/FM-S100/revisions/9/pdf/"),
            404,
            "NOT_FOUND",
        )
