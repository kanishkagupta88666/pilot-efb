import json
import uuid

from rest_framework.test import APITestCase

from documents import search
from documents.ingestion import ingest_xml
from documents.models import Annotation, ContentAnchor, DocumentVersion
from documents.test_api import ApiAssertionsMixin
from documents.xml_validation import PROJECT_ROOT

SYNC = "/api/annotations/sync/"
CASES = json.loads(
    (PROJECT_ROOT / "sample-data" / "revision-keys" / "annotation_test_cases_Rev1_to_Rev2.json").read_text(
        encoding="utf-8"
    )
)["cases"]


def change(**overrides) -> dict:
    item = {
        "id": str(uuid.uuid4()),
        "kind": "highlight",
        "documentId": "FM-S100",
        "revision": 1,
        "topicId": "fm100-t0001",
        "topicNumber": "01.10.2",
        "nodeId": "fm100-p00001",
        "start": 0,
        "end": 10,
        "quote": "The Captai",
        "anchorText": "The Captain …",
        "note": "",
        "createdAt": "2026-10-16T09:00:00Z",
        "updatedAt": "2026-10-16T09:00:00Z",
    }
    item.update(overrides)
    return item


class AnnotationSyncTests(ApiAssertionsMixin, APITestCase):
    def sync(self, owner, changes):
        return self.assert_json(self.client.post(SYNC, {"owner": owner, "changes": changes}, format="json"))

    def test_annotations_are_private_to_their_owner_and_follow_them(self):
        mine = change()
        self.sync("Pat Pilot", [mine])
        # Same pilot on another device, name typed differently: sees it.
        self.assertEqual([a["id"] for a in self.sync("  pat   PILOT ", [])["annotations"]], [mine["id"]])
        # Another pilot: does not, and cannot overwrite it.
        other = self.sync("Alex Pilot", [{**mine, "note": "x", "updatedAt": "2026-10-16T10:00:00Z"}])
        self.assertEqual(other["annotations"], [])
        self.assertEqual(other["rejected"][0]["reason"], "Not your annotation.")

    def test_newest_change_wins(self):
        item = change(kind="note", note="first")
        self.sync("Pat", [item])
        self.sync("Pat", [{**item, "note": "newer", "updatedAt": "2026-10-16T11:00:00Z"}])
        stale = self.sync("Pat", [{**item, "note": "older edit sent late", "updatedAt": "2026-10-16T10:00:00Z"}])
        self.assertEqual(stale["annotations"][0]["note"], "newer")

    def test_deletion_reaches_other_devices(self):
        item = change()
        self.sync("Pat", [item])
        body = self.sync("Pat", [{**item, "deleted": True, "updatedAt": "2026-10-16T12:00:00Z"}])
        self.assertTrue(body["annotations"][0]["deleted"])

    def test_validation(self):
        self.assert_error(self.client.post(SYNC, {"owner": "", "changes": []}, format="json"), 400, "INVALID_REQUEST")
        body = self.sync("Pat", [
            change(kind="scribble"),
            change(start=5, end=2),
            change(kind="note", note=""),
            change(id="not-a-uuid"),
            change(updatedAt="yesterday"),
        ])
        self.assertEqual(len(body["rejected"]), 5)
        self.assertEqual(Annotation.objects.count(), 0)


class RevisionSafeAnnotationTests(ApiAssertionsMixin, APITestCase):
    """The client's own test anchors: annotate in Rev 1, read in Rev 2."""

    @classmethod
    def setUpTestData(cls):
        for revision in (1, 2):
            ingest_xml(PROJECT_ROOT / "sample-data" / "xml" / f"FM-S100_Rev{revision}.xml")
        cls.rev1 = DocumentVersion.objects.get(document_id="FM-S100", revision=1)

    def annotation_in_rev1(self, node_id):
        anchor = ContentAnchor.objects.select_related("topic").get(version=self.rev1, anchor_id=node_id)
        block = next(b for b in anchor.topic.content_blocks if b["id"] == node_id)
        return {
            "id": str(uuid.uuid4()),
            "nodeId": node_id,
            "topicId": anchor.topic.node_id,
            "topicNumber": anchor.topic.number,
            "anchorText": search.block_text(block),
        }

    def test_client_annotation_cases(self):
        expected = {"unchanged": "unchanged", "changed": "changed", "moved": "moved", "removed": "removed"}
        items = {case["case"]: self.annotation_in_rev1(case["anchorNodeId"]) for case in CASES}
        body = self.assert_json(
            self.client.post(
                "/api/documents/FM-S100/revisions/2/annotation-status/",
                {"annotations": list(items.values())},
                format="json",
            )
        )
        by_id = {s["id"]: s for s in body["statuses"]}
        for case, item in items.items():
            with self.subTest(case=case):
                self.assertEqual(by_id[item["id"]]["status"], expected[case])
        moved = by_id[items["moved"]["id"]]
        self.assertEqual(moved["previousTopicNumber"], items["moved"]["topicNumber"])
        self.assertNotEqual(moved["topicNumber"], items["moved"]["topicNumber"])
        self.assertIsNotNone(by_id[items["changed"]["id"]]["currentText"])

    def test_bookmark_on_a_topic(self):
        body = self.assert_json(
            self.client.post(
                "/api/documents/FM-S100/revisions/2/annotation-status/",
                {"annotations": [{"id": "b1", "topicId": "fm100-t0008", "topicNumber": "01.10.9"},
                                 {"id": "b2", "topicId": "fm100-t0037", "topicNumber": "02.10.10"}]},
                format="json",
            )
        )
        self.assertEqual([s["status"] for s in body["statuses"]], ["removed", "unchanged"])
