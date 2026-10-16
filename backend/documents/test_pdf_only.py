import json
from pathlib import Path

from django.test import SimpleTestCase
from rest_framework.test import APITestCase

from documents import pdf_rendition, search
from documents.models import DocumentNode, DocumentVersion
from documents.pdf_only import align, ingest_pdf_only, parse_pdf
from documents.revision_diff import compare_versions
from documents.test_api import ApiAssertionsMixin, fixed_today
from documents.xml_validation import PROJECT_ROOT

REV0 = PROJECT_ROOT / "sample-data" / "pdf-only" / "Bulletin_26-01.pdf"
REV1 = Path(__file__).resolve().parent / "fixtures" / "pdf-only" / "Bulletin_26-01_Rev1.pdf"
KEY = json.loads(REV1.with_suffix(".expected.json").read_text(encoding="utf-8"))


class ParsePdfTests(SimpleTestCase):
    def test_reads_title_metadata_sections_and_paragraphs(self):
        parsed = parse_pdf(REV0)
        self.assertEqual(parsed.title, "Sample Flight Crew Bulletin 26-01: Revised Sample Taxi Guidance")
        self.assertEqual((parsed.applicability, parsed.effective_date), ("ALL", "2026-09-01"))
        self.assertEqual(parsed.owner, "Sample Flight Standards")
        self.assertEqual([s.title for s in parsed.sections], [f"Section {n}" for n in range(1, 7)])
        self.assertEqual(sum(len(s.paragraphs) for s in parsed.sections), 30)

    def test_joins_a_paragraph_split_across_a_page_break(self):
        first = parse_pdf(REV0).sections[1].paragraphs[0]
        # Its first part ends page 1 mid-sentence; the rest starts page 2.
        self.assertIn("quantity display and advise the other pilot", first)
        self.assertTrue(first.endswith("operational purpose."))

    def test_second_bulletin(self):
        parsed = parse_pdf(PROJECT_ROOT / "sample-data" / "pdf-only" / "Bulletin_26-02.pdf")
        self.assertEqual(len(parsed.sections), 12)
        self.assertEqual(sum(len(s.paragraphs) for s in parsed.sections), 60)


class AlignTests(SimpleTestCase):
    def test_insertion_keeps_the_others_paired(self):
        self.assertEqual(align(["a b c", "d e f"], ["a b c", "x y z", "d e f"], 0.6), {0: 0, 2: 1})

    def test_small_edit_is_paired(self):
        old = ["the pilot should monitor the probe heat before the next phase of flight"]
        new = ["the pilot should verify the probe heat before the next phase of flight"]
        self.assertEqual(align(old, new, 0.6), {0: 0})

    def test_rewrite_is_not_paired(self):
        self.assertEqual(align(["engine anti ice is required"], ["taxi slowly on wet runways"], 0.6), {})


class PdfOnlyRevisionTests(ApiAssertionsMixin, APITestCase):
    @classmethod
    def setUpTestData(cls):
        for path in (REV0, REV1):
            result = ingest_pdf_only(path, document_id="BULLETIN-26-01")
            if not result.success:
                raise AssertionError(result.message)
        cls.versions = {v.revision: v for v in DocumentVersion.objects.filter(document_id="BULLETIN-26-01")}

    def setUp(self):
        today = fixed_today()
        today.start()
        self.addCleanup(today.stop)

    def rev0_ids(self):
        """Rev 0 IDs by (section, paragraph) position, both counted from 1."""
        topics = DocumentNode.objects.filter(version=self.versions[0], node_type="topic").order_by("position")
        sections = {}
        positions = {}
        for number, topic in enumerate(topics, start=1):
            sections[number] = topic.node_id
            for index, block in enumerate(topic.content_blocks, start=1):
                positions[(number, index)] = block["id"]
        return sections, positions

    def test_changes_match_the_expected_key(self):
        sections, positions = self.rev0_ids()
        manifest = compare_versions(self.versions[0], self.versions[1])
        expected = KEY["paragraphs"]
        self.assertCountEqual(manifest["blocks"]["modified"], [positions[tuple(p)] for p in expected["modified"]])
        self.assertCountEqual(manifest["blocks"]["removed"], [positions[tuple(p)] for p in expected["removed"]])
        self.assertEqual(len(manifest["blocks"]["added"]), expected["addedCount"])
        self.assertEqual([t["id"] for t in manifest["topics"]["removed"]], [sections[n] for n in KEY["sections"]["removed"]])
        self.assertEqual(len(manifest["topics"]["added"]), KEY["sections"]["addedCount"])

    def test_renumbered_section_keeps_its_id_and_is_not_a_change(self):
        sections, _ = self.rev0_ids()
        [[old_number, new_number]] = KEY["sections"]["renumbered"]
        renumbered = DocumentNode.objects.get(version=self.versions[1], node_id=sections[old_number])
        self.assertEqual(renumbered.title, f"Section {new_number}")
        manifest = compare_versions(self.versions[0], self.versions[1])
        changed = {t["id"] for kind in ("modified", "moved", "added", "removed") for t in manifest["topics"][kind]}
        self.assertNotIn(sections[old_number], changed)

    def test_same_pdf_again_keeps_every_id(self):
        result = ingest_pdf_only(REV1, document_id="BULLETIN-26-01", revision=2)
        self.assertTrue(result.success, result.message)
        self.assertEqual(result.new_ids, 0)
        latest = DocumentVersion.objects.get(document_id="BULLETIN-26-01", revision=2)
        manifest = compare_versions(self.versions[1], latest)
        self.assertEqual(manifest["summary"], {"modified": 0, "added": 0, "removed": 0, "moved": 0})

    def test_metadata_marks_derived_ids(self):
        metadata = self.versions[1].metadata
        self.assertEqual((metadata["source"], metadata["derivedIds"], metadata["docType"]), ("pdf-only", True, "BULLETIN"))
        self.assertEqual(metadata["effectiveDate"], "2026-10-01")

    def test_duplicate_revision_and_outside_path_are_refused(self):
        self.assertFalse(ingest_pdf_only(REV0, document_id="BULLETIN-26-01", revision=0).success)
        outside = ingest_pdf_only("/etc/hosts", document_id="X")
        self.assertFalse(outside.success)
        self.assertIn("inside the project", outside.message)

    def test_outline_map_and_pdf_file(self):
        body = self.assert_json(self.client.get("/api/documents/BULLETIN-26-01/revisions/1/pdf/outline/"))
        self.assertEqual(body["unmatched"], [])
        topics = DocumentNode.objects.filter(version=self.versions[1], node_type="topic").order_by("position")
        self.assertEqual([body["nodes"][t.node_id]["heading"] for t in topics], [t.title for t in topics])
        response = self.client.get("/api/documents/BULLETIN-26-01/revisions/1/pdf/")
        self.assertEqual(response["Content-Type"], "application/pdf")

    def test_stored_pdf_path_cannot_leave_the_allowed_folders(self):
        version = self.versions[1]
        version.metadata = {**version.metadata, "pdf": "backend/config/settings.py"}
        with self.assertRaises(pdf_rendition.PdfNotAvailableError):
            pdf_rendition.version_pdf_path(version)

    def test_bulletin_is_searchable_as_supplemental(self):
        # On the fixed test date Rev 1 is still upcoming, so Rev 0 is searched.
        body = self.assert_json(
            self.client.get("/api/search/?q=cargo+smoke+detection+advisory&category=supplemental")
        )
        self.assertEqual({r["docId"] for r in body["results"]}, {"BULLETIN-26-01"})
        self.assertEqual({r["revision"] for r in body["results"]}, {0})
        self.assertEqual(
            {d["docId"]: d["category"] for d in body["documents"]}["BULLETIN-26-01"], search.SUPPLEMENTAL
        )
