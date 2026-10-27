from datetime import date
from unittest.mock import patch

from rest_framework.test import APITestCase

from documents.ingestion import ingest_xml
from documents.models import Draft, DocumentNode, DocumentVersion
from documents.pdf_only import ingest_pdf_only
from documents.revision_diff import compare_versions
from documents.test_api import ApiAssertionsMixin
from documents.test_support import WriteAccessMixin
from documents.xml_validation import PROJECT_ROOT

TODAY = date(2026, 10, 14)
DOC = "/api/documents/FM-S200"


class AuthoringTests(WriteAccessMixin, ApiAssertionsMixin, APITestCase):
    @classmethod
    def setUpTestData(cls):
        result = ingest_xml(PROJECT_ROOT / "sample-data" / "xml" / "FM-S200_Rev4.xml")
        if not result.success:
            raise AssertionError(result.message)
        cls.topics = list(
            DocumentNode.objects.filter(version__document_id="FM-S200", node_type="topic")
            .order_by("position")
        )

    def setUp(self):
        super().setUp()
        today = patch("documents.revision_status.current_date", return_value=TODAY)
        today.start()
        self.addCleanup(today.stop)

    def start(self):
        return self.assert_json(self.client.post(f"{DOC}/draft/"), 201)

    def topic(self, index=0):
        return self.topics[index]

    def first_text_block(self, topic):
        return next(b for b in topic.content_blocks if b["type"] in ("para", "note", "caution", "warning"))

    def test_start_returns_the_same_draft(self):
        body = self.start()
        self.assertEqual((body["baseRevision"], body["nextRevision"]), (4, 5))
        self.assertEqual(body["summary"], {"modified": 0, "added": 0, "removed": 0, "moved": 0})
        again = self.assert_json(self.client.post(f"{DOC}/draft/"), 200)
        self.assertEqual(again["createdAt"], body["createdAt"])
        self.assertEqual(Draft.objects.count(), 1)

    def test_modify_add_delete_blocks_show_as_changes(self):
        self.start()
        topic = self.topic()
        url = f"{DOC}/draft/topics/{topic.node_id}/blocks/"
        block = self.first_text_block(topic)
        body = self.assert_json(self.client.patch(f"{url}{block['id']}/", {"text": "Changed text."}, format="json"))
        self.assertEqual(next(b for b in body["blocks"] if b["id"] == block["id"])["status"], "modified")

        added = self.assert_json(
            self.client.post(url, {"afterId": block["id"], "type": "caution", "text": "New caution."}, format="json"),
            201,
        )
        self.assertIn("-new-p", added["blockId"])
        self.assertEqual(next(b for b in added["blocks"] if b["id"] == added["blockId"])["status"], "added")

        last = topic.content_blocks[-1]["id"]
        body = self.assert_json(self.client.delete(f"{url}{last}/"))
        self.assertEqual(next(b for b in body["blocks"] if b["id"] == last)["status"], "removed")

        summary = self.assert_json(self.client.get(f"{DOC}/draft/"))["summary"]
        self.assertEqual(summary["modified"], 1)

    def test_add_rename_delete_topics_renumber_the_section(self):
        self.start()
        first, second = self.topic(0), self.topic(1)
        body = self.assert_json(
            self.client.post(
                f"{DOC}/draft/topics/",
                {"afterTopicId": first.node_id, "title": "New topic", "text": "First paragraph."},
                format="json",
            ),
            201,
        )
        section = body["chapters"][0]["sections"][0]
        numbers = {t["id"]: t["number"] for t in section["topics"]}
        prefix = first.number.rsplit(".", 1)[0]
        self.assertEqual(numbers[body["topicId"]], f"{prefix}.2")
        self.assertEqual(numbers[second.node_id], f"{prefix}.3")

        self.assert_json(self.client.patch(f"{DOC}/draft/topics/{first.node_id}/", {"title": "Renamed"}, format="json"))
        body = self.assert_json(self.client.delete(f"{DOC}/draft/topics/{second.node_id}/"))
        self.assertEqual(body["summary"]["added"], 1)
        self.assertEqual(body["summary"]["removed"], 1)
        self.assertEqual(body["summary"]["modified"], 1)

    def test_rules(self):
        self.start()
        topic = self.topic()
        url = f"{DOC}/draft/topics/{topic.node_id}/blocks/"
        self.assert_error(self.client.post(url, {"type": "para", "text": "  "}, format="json"), 400, "INVALID_REQUEST")
        self.assert_error(self.client.post(url, {"type": "table", "text": "x"}, format="json"), 400, "INVALID_REQUEST")
        self.assert_error(self.client.patch(f"{url}nope/", {"text": "x"}, format="json"), 404, "NODE_NOT_FOUND")
        self.assert_error(
            self.client.post(f"{DOC}/draft/publish/", {"changeSummary": "x", "effectiveDate": "2026-10-15"}, format="json"),
            422,
            "NO_CHANGES",
        )
        self.assert_error(
            self.client.post(f"{DOC}/draft/publish/", {"changeSummary": "x", "effectiveDate": "2026-01-01"}, format="json"),
            400,
            "INVALID_REQUEST",
        )
        # A topic keeps at least one block.
        single = next(t for t in self.topics if len(t.content_blocks) == 1) if any(
            len(t.content_blocks) == 1 for t in self.topics
        ) else None
        if single:
            self.assert_error(
                self.client.delete(f"{DOC}/draft/topics/{single.node_id}/blocks/{single.content_blocks[0]['id']}/"),
                422,
                "NOT_EDITABLE",
            )

    def test_cannot_publish_a_link_to_a_deleted_topic(self):
        self.start()
        linked = None
        for topic in self.topics:
            for block in topic.content_blocks:
                for segment in block.get("segments", ()):
                    if segment["type"] == "xref":
                        linked = segment["targetId"]
                        break
        self.assertIsNotNone(linked, "the sample has cross-references")
        target = DocumentNode.objects.filter(version__document_id="FM-S200", node_id=linked).first()
        self.assert_json(self.client.delete(f"{DOC}/draft/topics/{target.node_id}/"))
        self.assert_error(
            self.client.post(f"{DOC}/draft/publish/", {"changeSummary": "x", "effectiveDate": "2026-10-14"}, format="json"),
            422,
            "DANGLING_REFERENCE",
        )

    def test_publish_creates_the_next_revision_and_keeps_the_base(self):
        self.start()
        topic = self.topic()
        block = self.first_text_block(topic)
        self.client.patch(f"{DOC}/draft/topics/{topic.node_id}/blocks/{block['id']}/", {"text": "Changed text."}, format="json")
        body = self.assert_json(
            self.client.post(
                f"{DOC}/draft/publish/",
                {"changeSummary": "Clarified the first paragraph.", "effectiveDate": "2026-10-14"},
                format="json",
            ),
            201,
        )
        self.assertEqual((body["revision"], body["baseRevision"]), (5, 4))
        self.assertFalse(Draft.objects.exists())
        base, new = (DocumentVersion.objects.get(document_id="FM-S200", revision=r) for r in (4, 5))
        self.assertEqual(new.metadata["changeSummary"], "Clarified the first paragraph.")
        self.assertTrue(new.metadata["authoredInPrototype"])
        changes = compare_versions(base, new)
        self.assertEqual(changes["blocks"]["modified"], [block["id"]])
        # The base revision is untouched.
        stored = DocumentNode.objects.get(version=base, node_id=topic.node_id).content_blocks
        self.assertEqual(stored, topic.content_blocks)
        # The new revision is current and searchable.
        library = self.assert_json(self.client.get("/api/documents/"))
        statuses = {r["revision"]: r["status"] for d in library["documents"] if d["id"] == "FM-S200" for r in d["availableRevisions"]}
        self.assertEqual(statuses, {4: "superseded", 5: "current"})

    def test_discard(self):
        self.start()
        self.assertEqual(self.client.delete(f"{DOC}/draft/").status_code, 204)
        self.assert_error(self.client.get(f"{DOC}/draft/"), 404, "NO_DRAFT")

    def test_pdf_only_documents_are_not_editable(self):
        ingest_pdf_only(PROJECT_ROOT / "sample-data" / "pdf-only" / "Bulletin_26-02.pdf")
        self.assert_error(self.client.post("/api/documents/BUL-26-02/draft/"), 422, "NOT_EDITABLE")
