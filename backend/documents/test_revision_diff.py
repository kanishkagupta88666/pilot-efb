import json

from django.test import SimpleTestCase
from rest_framework.test import APITestCase

from documents.ingestion import ingest_xml
from documents.models import DocumentVersion
from documents.revision_diff import (
    ADDED,
    MODIFIED,
    MOVED,
    REMOVED,
    UNCHANGED,
    _merge_blocks,
    _Section,
    _Topic,
    block_signature,
    compare_node,
    compare_versions,
    word_diff,
)
from documents.test_api import ApiAssertionsMixin, fixed_today
from documents.xml_validation import PROJECT_ROOT

SAMPLE_DATA = PROJECT_ROOT / "sample-data"
SECTION = _Section(id="s1", number="01.10", title="Section", chapter_id="c1")


def para(block_id, *segments):
    return {"type": "para", "id": block_id, "segments": list(segments)}


def text(value):
    return {"type": "text", "text": value}


def topic(*blocks, topic_id="t1"):
    return _Topic(
        id=topic_id,
        number="01.10.1",
        title="Topic",
        position=1,
        section=SECTION,
        blocks=tuple(blocks),
    )


class BlockComparisonTests(SimpleTestCase):
    def test_xref_display_text_is_not_a_change(self):
        old = para("p1", {"type": "xref", "targetId": "t9", "text": "15.10.11 Radar"})
        new = para("p1", {"type": "xref", "targetId": "t9", "text": "15.10.10 Radar"})
        self.assertEqual(block_signature(old), block_signature(new))

    def test_xref_target_change_is_a_change(self):
        old = para("p1", {"type": "xref", "targetId": "t9", "text": "Radar"})
        new = para("p1", {"type": "xref", "targetId": "t8", "text": "Radar"})
        self.assertNotEqual(block_signature(old), block_signature(new))

    def test_word_diff_marks_only_changed_words(self):
        self.assertEqual(
            word_diff("Availability is described below.", "Availability differs by fleet."),
            [
                {"op": "equal", "text": "Availability "},
                {"op": "delete", "text": "is described below."},
                {"op": "insert", "text": "differs by fleet."},
            ],
        )


class MergeBlocksTests(SimpleTestCase):
    def test_statuses_and_removed_placement(self):
        old = topic(
            para("p1", text("Same.")),
            para("p2", text("Gone.")),
            para("p3", text("Old wording.")),
        )
        new = topic(
            para("p1", text("Same.")),
            para("p3", text("New wording.")),
            para("p4", text("Fresh.")),
        )
        entries = _merge_blocks(old, new)
        self.assertEqual(
            [(entry["id"], entry["status"]) for entry in entries],
            [
                ("p1", UNCHANGED),
                ("p2", REMOVED),
                ("p3", MODIFIED),
                ("p4", ADDED),
            ],
        )
        self.assertIsNone(entries[1]["current"])
        self.assertEqual(entries[1]["previous"]["id"], "p2")
        self.assertIn("diff", entries[2])

    def test_removed_first_block_is_listed_first(self):
        old = topic(para("p1", text("Gone.")), para("p2", text("Kept.")))
        new = topic(para("p2", text("Kept.")))
        self.assertEqual(
            [entry["id"] for entry in _merge_blocks(old, new)],
            ["p1", "p2"],
        )


class RealSampleRevisionDiffTests(ApiAssertionsMixin, APITestCase):
    """The diff must reproduce the client's expected revision keys exactly."""

    @classmethod
    def setUpTestData(cls):
        for revision in range(4):
            result = ingest_xml(SAMPLE_DATA / "xml" / f"FM-S100_Rev{revision}.xml")
            if not result.success:
                raise AssertionError(result.message)
        cls.versions = {
            version.revision: version
            for version in DocumentVersion.objects.filter(document_id="FM-S100")
        }

    def setUp(self):
        today = fixed_today()
        today.start()
        self.addCleanup(today.stop)

    def key(self, old, new):
        path = SAMPLE_DATA / "revision-keys" / f"FM-S100_Rev{old}_to_Rev{new}.json"
        return json.loads(path.read_text(encoding="utf-8"))

    def test_manifest_matches_every_revision_key(self):
        for old, new in ((0, 1), (1, 2), (2, 3)):
            with self.subTest(transition=f"Rev{old} to Rev{new}"):
                key = self.key(old, new)
                manifest = compare_versions(self.versions[old], self.versions[new])
                for kind in ("topics", "blocks"):
                    for status, expected in key[kind].items():
                        expected_ids = [
                            item["id"] if isinstance(item, dict) else item
                            for item in expected
                        ]
                        actual_ids = [
                            item["id"] if isinstance(item, dict) else item
                            for item in manifest[kind][status]
                        ]
                        self.assertCountEqual(actual_ids, expected_ids, (kind, status))
                self.assertCountEqual(
                    [(m["id"], m["from"], m["to"]) for m in manifest["topics"][MOVED]],
                    [(m["id"], m["from"], m["to"]) for m in key["topics"]["moved"]],
                )

    def test_annotation_test_case_anchors(self):
        cases = json.loads(
            (
                SAMPLE_DATA / "revision-keys" / "annotation_test_cases_Rev1_to_Rev2.json"
            ).read_text(encoding="utf-8")
        )["cases"]
        expected = {
            "unchanged": UNCHANGED,
            "changed": MODIFIED,
            "removed": REMOVED,
        }
        for case in cases:
            with self.subTest(case=case["case"]):
                comparison = compare_node(
                    self.versions[1], self.versions[2], case["anchorNodeId"]
                )
                block = next(
                    entry
                    for entry in comparison["blocks"]
                    if entry["id"] == case["anchorNodeId"]
                )
                if case["case"] == "moved":
                    self.assertEqual(block["status"], UNCHANGED)
                    self.assertIn(MOVED, comparison["status"])
                    self.assertNotEqual(
                        comparison["previous"]["number"],
                        comparison["current"]["number"],
                    )
                else:
                    self.assertEqual(block["status"], expected[case["case"]])

    def test_changes_endpoint_defaults_to_current_and_previous(self):
        body = self.assert_json(self.client.get("/api/documents/FM-S100/changes/"))
        self.assertEqual((body["fromRevision"], body["toRevision"]), (1, 2))
        self.assertEqual(
            body["summary"],
            {MODIFIED: 25, ADDED: 4, REMOVED: 5, MOVED: 8},
        )

    def test_changes_endpoint_accepts_explicit_revisions(self):
        body = self.assert_json(
            self.client.get("/api/documents/FM-S100/changes/?from=2&to=3")
        )
        self.assertEqual(body["summary"][REMOVED], 2)

    def test_changes_endpoint_rejects_backward_comparison(self):
        self.assert_error(
            self.client.get("/api/documents/FM-S100/changes/?from=3&to=2"),
            400,
            "INVALID_REQUEST",
        )

    def test_first_revision_has_nothing_to_compare_with(self):
        self.assert_error(
            self.client.get("/api/documents/FM-S100/changes/?to=0"),
            404,
            "NO_PREVIOUS_REVISION",
        )

    def test_node_changes_returns_removed_text(self):
        body = self.assert_json(
            self.client.get(
                "/api/documents/FM-S100/changes/nodes/fm100-p00060/?from=1&to=2"
            )
        )
        self.assertEqual(body["status"], [REMOVED])
        self.assertIsNone(body["current"])
        self.assertEqual(body["topicId"], "fm100-t0008")

    def test_node_changes_unknown_node(self):
        self.assert_error(
            self.client.get("/api/documents/FM-S100/changes/nodes/fm100-zzz/"),
            404,
            "NODE_NOT_FOUND",
        )
