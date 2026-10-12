from datetime import date
import json
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlencode

from django.contrib.auth import get_user_model
from django.db import OperationalError, connection
from django.test import SimpleTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from lxml import etree
from rest_framework.test import APIClient, APITestCase

from documents import revision_status, views
from documents.ingestion import DocumentTreeIntegrityError, ingest_xml
from documents.models import ContentAnchor, Document, DocumentNode, DocumentVersion
from documents.xml_normalization import assemble_normalized_document
from documents.xml_validation import DEFAULT_XML_PATH, PROJECT_ROOT

FIXED_TODAY = date(2026, 9, 1)
LIBRARY_URL = "/api/documents/"
INTERNAL_ERROR_BODY = {
    "error": {
        "code": "INTERNAL_ERROR",
        "message": "The server could not complete the request.",
    }
}
SMALL_TREE_NAVIGATION = [
    {
        "id": "x-c-zulu",
        "number": "01",
        "title": "First chapter",
        "sections": [
            {
                "id": "x-s-mike",
                "number": "01.10",
                "title": "First section",
                "topics": [
                    {
                        "id": "x-t-yankee",
                        "number": "01.10.1",
                        "title": "First topic",
                    },
                    {
                        "id": "x-t-alpha",
                        "number": "01.10.2",
                        "title": "Second topic",
                    },
                ],
            },
            {
                "id": "x-s-bravo",
                "number": "01.20",
                "title": "Second section",
                "topics": [
                    {
                        "id": "x-t-kilo",
                        "number": "01.20.1",
                        "title": "Third topic",
                    },
                ],
            },
        ],
    },
    {
        "id": "x-c-alpha",
        "number": "02",
        "title": "Second chapter",
        "sections": [
            {
                "id": "x-s-zulu",
                "number": "02.10",
                "title": "Empty section",
                "topics": [],
            },
        ],
    },
]
FIRST_TOPIC_BLOCKS = [
    {
        "type": "para",
        "id": "x-p-0002",
        "segments": [
            {"type": "text", "text": "See "},
            {"type": "xref", "targetId": "x-t-kilo", "text": "third topic"},
            {"type": "text", "text": "."},
        ],
    },
    {
        "type": "checklist",
        "id": "x-p-0001",
        "checks": [
            {"id": "x-p-0004", "challenge": "Synthetic switch", "response": "On"},
            {"id": "x-p-0003", "challenge": "Synthetic valve", "response": "Closed"},
        ],
    },
]


def fixed_today(day=FIXED_TODAY):
    return patch("documents.revision_status.current_date", return_value=day)


def navigation_url(doc_id, revision):
    return f"/api/documents/{doc_id}/revisions/{revision}/navigation/"


def topic_url(doc_id, revision, topic_id):
    return f"/api/documents/{doc_id}/revisions/{revision}/topics/{topic_id}/"


def make_document(doc_id="DOC-A"):
    return Document.objects.create(
        id=doc_id,
        title=f"Synthetic manual {doc_id}",
        doc_type="FM",
        namespace="urn:sample:fltpub:1.0",
    )


def make_version(document, revision, effective_date, revision_date=None):
    revision_date = revision_date or effective_date
    return DocumentVersion.objects.create(
        document=document,
        revision=revision,
        revision_date=revision_date,
        effective_date=effective_date,
        metadata={
            "docId": document.id,
            "title": document.title,
            "docType": document.doc_type,
            "applicability": "SYNTHETIC-1",
            "revision": revision,
            "revisionDate": revision_date.isoformat(),
            "effectiveDate": effective_date.isoformat(),
            "owner": "Synthetic owner",
            "changeSummary": f"Synthetic change {revision}.",
            "classification": "SYNTHETIC SAMPLE - NOT FOR OPERATIONAL USE",
        },
        source_filename=f"{document.id}_Rev{revision}.xml",
    )


def make_node(
    version,
    node_id,
    node_type,
    position,
    *,
    sequence=1,
    parent=None,
    number="",
    title="",
    blocks=None,
):
    return DocumentNode.objects.create(
        version=version,
        node_id=node_id,
        node_type=node_type,
        number=number or node_id,
        title=title or node_id,
        parent=parent,
        sequence=sequence,
        position=position,
        content_blocks=blocks,
    )


def resolve_url(doc_id, node_id, revision=None):
    query = {"nodeId": node_id}
    if revision is not None:
        query["revision"] = revision
    return f"/api/documents/{doc_id}/resolve-node/?{urlencode(query)}"


def make_anchors(version, nodes, anchors):
    ContentAnchor.objects.bulk_create(
        ContentAnchor(
            version=version,
            topic=nodes[topic_id],
            anchor_id=anchor_id,
            anchor_type=anchor_type,
        )
        for anchor_id, anchor_type, topic_id in anchors
    )


def make_small_tree(version, navigation=None):
    """Store a tree whose source order differs from ID and number order."""
    navigation = SMALL_TREE_NAVIGATION if navigation is None else navigation
    chapter, section, topic = DocumentNode.NodeType
    nodes = {}
    position = 0
    for chapter_sequence, chapter_outline in enumerate(navigation, 1):
        position += 1
        chapter_node = nodes[chapter_outline["id"]] = make_node(
            version,
            chapter_outline["id"],
            chapter,
            position,
            sequence=chapter_sequence,
            number=chapter_outline["number"],
            title=chapter_outline["title"],
        )
        for section_sequence, section_outline in enumerate(
            chapter_outline["sections"], 1
        ):
            position += 1
            section_node = nodes[section_outline["id"]] = make_node(
                version,
                section_outline["id"],
                section,
                position,
                sequence=section_sequence,
                parent=chapter_node,
                number=section_outline["number"],
                title=section_outline["title"],
            )
            for topic_sequence, topic_outline in enumerate(
                section_outline["topics"], 1
            ):
                position += 1
                nodes[topic_outline["id"]] = make_node(
                    version,
                    topic_outline["id"],
                    topic,
                    position,
                    sequence=topic_sequence,
                    parent=section_node,
                    number=topic_outline["number"],
                    title=topic_outline["title"],
                    blocks=(
                        FIRST_TOPIC_BLOCKS
                        if topic_outline["id"] == "x-t-yankee"
                        else []
                    ),
                )
    return nodes


class ApiAssertionsMixin:
    def assert_json(self, response, status_code=200):
        self.assertEqual(response.status_code, status_code, response.content)
        self.assertEqual(response["Content-Type"], "application/json")
        return response.json()

    def assert_error(self, response, status_code, code):
        body = self.assert_json(response, status_code)
        self.assertEqual(set(body), {"error"})
        self.assertEqual(set(body["error"]), {"code", "message"})
        self.assertEqual(body["error"]["code"], code)
        self.assertIsInstance(body["error"]["message"], str)
        self.assertTrue(body["error"]["message"])
        return body

    def assert_error_with_details(self, response, status_code, code, details):
        body = self.assert_json(response, status_code)
        self.assertEqual(set(body), {"error"})
        self.assertEqual(set(body["error"]), {"code", "message", "details"})
        self.assertEqual(body["error"]["code"], code)
        self.assertTrue(body["error"]["message"])
        self.assertEqual(body["error"]["details"], details)

    def assert_sanitized_internal_error(self, response, *secrets):
        self.assertEqual(self.assert_json(response, 500), INTERNAL_ERROR_BODY)
        for secret in secrets:
            self.assertNotIn(secret, response.content.decode())


class RevisionStatusTests(SimpleTestCase):
    @staticmethod
    def _version(revision, effective_date):
        return SimpleNamespace(revision=revision, effective_date=effective_date)

    def test_statuses_follow_effective_date(self):
        statuses = revision_status.derive_statuses(
            [
                self._version(1, date(2026, 1, 1)),
                self._version(2, date(2026, 7, 15)),
                self._version(3, date(2026, 12, 1)),
            ],
            FIXED_TODAY,
        )

        self.assertEqual(
            statuses,
            {1: "superseded", 2: "current", 3: "upcoming"},
        )

    def test_revision_effective_today_is_current(self):
        statuses = revision_status.derive_statuses(
            [
                self._version(1, date(2026, 1, 1)),
                self._version(2, FIXED_TODAY),
            ],
            FIXED_TODAY,
        )

        self.assertEqual(statuses, {1: "superseded", 2: "current"})

    def test_highest_revision_wins_a_shared_effective_date(self):
        versions = [
            self._version(5, date(2026, 7, 15)),
            self._version(3, date(2026, 1, 1)),
            self._version(4, date(2026, 7, 15)),
        ]
        expected = {3: "superseded", 4: "superseded", 5: "current"}

        self.assertEqual(
            revision_status.derive_statuses(versions, FIXED_TODAY),
            expected,
        )
        self.assertEqual(
            revision_status.derive_statuses(reversed(versions), FIXED_TODAY),
            expected,
        )

    def test_effective_date_outranks_revision_number(self):
        statuses = revision_status.derive_statuses(
            [
                self._version(6, date(2026, 6, 1)),
                self._version(7, date(2026, 3, 1)),
            ],
            FIXED_TODAY,
        )

        self.assertEqual(statuses, {6: "current", 7: "superseded"})

    def test_no_revision_is_current_when_all_are_upcoming(self):
        statuses = revision_status.derive_statuses(
            [
                self._version(1, date(2027, 1, 1)),
                self._version(2, date(2027, 6, 1)),
            ],
            FIXED_TODAY,
        )

        self.assertEqual(statuses, {1: "upcoming", 2: "upcoming"})
        self.assertEqual(revision_status.derive_statuses([], FIXED_TODAY), {})

    def test_date_provider_reads_the_django_local_date(self):
        with patch(
            "documents.revision_status.timezone.localdate",
            return_value=date(2031, 2, 3),
        ) as localdate:
            self.assertEqual(revision_status.current_date(), date(2031, 2, 3))

        localdate.assert_called_once_with()


class DocumentLibraryApiTests(ApiAssertionsMixin, APITestCase):
    def test_empty_library(self):
        with fixed_today(), self.assertNumQueries(1):
            response = self.client.get(LIBRARY_URL)

        self.assertEqual(self.assert_json(response), {"documents": []})

    def test_library_response_shape_and_revision_metadata(self):
        document = make_document("DOC-A")
        version = make_version(
            document,
            2,
            date(2026, 7, 15),
            revision_date=date(2026, 7, 1),
        )

        with fixed_today():
            response = self.client.get(LIBRARY_URL)

        self.assertEqual(
            self.assert_json(response),
            {
                "documents": [
                    {
                        "id": "DOC-A",
                        "namespace": "urn:sample:fltpub:1.0",
                        "docType": "FM",
                        "availableRevisions": [
                            {
                                "revision": 2,
                                "revisionDate": "2026-07-01",
                                "effectiveDate": "2026-07-15",
                                "status": "current",
                                "metadata": version.metadata,
                            }
                        ],
                    }
                ]
            },
        )
        metadata = response.json()["documents"][0]["availableRevisions"][0][
            "metadata"
        ]
        self.assertEqual(
            list(metadata),
            [
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
            ],
        )
        self.assertIs(type(metadata["revision"]), int)

    def test_one_document_with_current_upcoming_and_superseded_revisions(self):
        document = make_document("DOC-A")
        make_version(document, 3, date(2026, 12, 1))
        make_version(document, 1, date(2026, 1, 1))
        make_version(document, 2, date(2026, 7, 15))

        with fixed_today():
            response = self.client.get(LIBRARY_URL)

        documents = self.assert_json(response)["documents"]
        self.assertEqual(len(documents), 1)
        self.assertEqual(
            [
                (entry["revision"], entry["effectiveDate"], entry["status"])
                for entry in documents[0]["availableRevisions"]
            ],
            [
                (1, "2026-01-01", "superseded"),
                (2, "2026-07-15", "current"),
                (3, "2026-12-01", "upcoming"),
            ],
        )

    def test_status_follows_the_overridden_date_provider(self):
        document = make_document("DOC-A")
        make_version(document, 1, date(2026, 1, 1))
        make_version(document, 2, date(2026, 7, 15))
        make_version(document, 3, date(2026, 12, 1))

        def statuses_on(day):
            with fixed_today(day):
                response = self.client.get(LIBRARY_URL)
            return [
                entry["status"]
                for entry in self.assert_json(response)["documents"][0][
                    "availableRevisions"
                ]
            ]

        self.assertEqual(
            statuses_on(date(2025, 12, 31)),
            ["upcoming", "upcoming", "upcoming"],
        )
        self.assertEqual(
            statuses_on(date(2026, 7, 14)),
            ["current", "upcoming", "upcoming"],
        )
        self.assertEqual(
            statuses_on(date(2026, 7, 15)),
            ["superseded", "current", "upcoming"],
        )
        self.assertEqual(
            statuses_on(date(2026, 12, 1)),
            ["superseded", "superseded", "current"],
        )

    def test_same_effective_date_tie_goes_to_the_highest_revision(self):
        document = make_document("DOC-A")
        make_version(document, 5, date(2026, 7, 15))
        make_version(document, 4, date(2026, 7, 15))
        make_version(document, 3, date(2026, 1, 1))

        with fixed_today():
            response = self.client.get(LIBRARY_URL)

        self.assertEqual(
            [
                (entry["revision"], entry["status"])
                for entry in self.assert_json(response)["documents"][0][
                    "availableRevisions"
                ]
            ],
            [(3, "superseded"), (4, "superseded"), (5, "current")],
        )

    def test_status_is_derived_per_document_and_never_stored(self):
        first = make_document("DOC-B")
        make_version(first, 1, date(2026, 1, 1))
        second = make_document("DOC-A")
        make_version(second, 9, date(2027, 1, 1))
        make_document("DOC-C")

        with fixed_today():
            response = self.client.get(LIBRARY_URL)

        self.assertEqual(
            [
                (
                    document["id"],
                    [
                        (entry["revision"], entry["status"])
                        for entry in document["availableRevisions"]
                    ],
                )
                for document in self.assert_json(response)["documents"]
            ],
            [
                ("DOC-A", [(9, "upcoming")]),
                ("DOC-B", [(1, "current")]),
                ("DOC-C", []),
            ],
        )
        self.assertNotIn(
            "status",
            [field.name for field in DocumentVersion._meta.get_fields()],
        )

    def test_query_count_does_not_grow_with_documents_or_revisions(self):
        make_version(make_document("DOC-A"), 1, date(2026, 1, 1))
        with fixed_today(), self.assertNumQueries(2):
            self.assert_json(self.client.get(LIBRARY_URL))

        for index in range(5):
            document = make_document(f"DOC-M{index}")
            for revision in range(1, 7):
                make_version(document, revision, date(2026, revision, 1))

        with fixed_today(), self.assertNumQueries(2):
            response = self.client.get(LIBRARY_URL)

        documents = self.assert_json(response)["documents"]
        self.assertEqual(len(documents), 6)
        self.assertEqual(
            sum(len(document["availableRevisions"]) for document in documents),
            31,
        )


class NavigationApiTests(ApiAssertionsMixin, APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.document = make_document("DOC-A")
        cls.version = make_version(
            cls.document,
            2,
            date(2026, 7, 15),
            revision_date=date(2026, 7, 1),
        )
        cls.nodes = make_small_tree(cls.version)
        cls.other_version = make_version(cls.document, 3, date(2026, 12, 1))
        make_node(
            cls.other_version,
            "x-c-zulu",
            DocumentNode.NodeType.CHAPTER,
            1,
            number="01",
            title="Renamed in revision 3",
        )

    def test_navigation_hierarchy_ids_and_source_order(self):
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(navigation_url("DOC-A", 2))

        self.assertEqual(
            self.assert_json(response),
            {
                "document": {
                    "id": "DOC-A",
                    "namespace": "urn:sample:fltpub:1.0",
                    "docType": "FM",
                },
                "version": {"revision": 2, "metadata": self.version.metadata},
                "chapters": SMALL_TREE_NAVIGATION,
            },
        )
        self.assertEqual(len(queries), 3)
        self.assertFalse(
            [query["sql"] for query in queries if "content_blocks" in query["sql"]]
        )
        self.assertNotIn("blocks", response.content.decode())

    def test_navigation_is_specific_to_the_requested_revision(self):
        response = self.client.get(navigation_url("DOC-A", 3))

        body = self.assert_json(response)
        self.assertEqual(body["version"]["revision"], 3)
        self.assertEqual(
            body["chapters"],
            [
                {
                    "id": "x-c-zulu",
                    "number": "01",
                    "title": "Renamed in revision 3",
                    "sections": [],
                }
            ],
        )

    def test_navigation_query_count_does_not_grow_with_the_tree(self):
        version = make_version(self.document, 4, date(2027, 1, 1))
        position = 0
        for chapter_sequence in range(1, 4):
            position += 1
            chapter = make_node(
                version,
                f"big-c{chapter_sequence}",
                DocumentNode.NodeType.CHAPTER,
                position,
                sequence=chapter_sequence,
            )
            for section_sequence in range(1, 4):
                position += 1
                section = make_node(
                    version,
                    f"big-s{chapter_sequence}{section_sequence}",
                    DocumentNode.NodeType.SECTION,
                    position,
                    sequence=section_sequence,
                    parent=chapter,
                )
                for topic_sequence in range(1, 6):
                    position += 1
                    make_node(
                        version,
                        f"big-t{chapter_sequence}{section_sequence}{topic_sequence}",
                        DocumentNode.NodeType.TOPIC,
                        position,
                        sequence=topic_sequence,
                        parent=section,
                        blocks=[],
                    )

        with self.assertNumQueries(3):
            response = self.client.get(navigation_url("DOC-A", 4))

        chapters = self.assert_json(response)["chapters"]
        self.assertEqual(
            sum(
                len(section["topics"])
                for chapter in chapters
                for section in chapter["sections"]
            ),
            45,
        )

    def test_missing_document_and_missing_revision_are_distinct(self):
        with self.assertNumQueries(2):
            missing_document = self.client.get(navigation_url("NO-SUCH-DOC", 2))
        with self.assertNumQueries(2):
            missing_revision = self.client.get(navigation_url("DOC-A", 99))

        self.assert_error(missing_document, 404, "DOCUMENT_NOT_FOUND")
        self.assert_error(missing_revision, 404, "REVISION_NOT_FOUND")

    def test_malformed_revision_is_a_400_invalid_request(self):
        for revision in (
            "abc",
            "2.0",
            "-2",
            "+2",
            "2a",
            "02",
            "%202",
            "٢",
        ):
            for doc_id in ("DOC-A", "NO-SUCH-DOC"):
                with (
                    self.subTest(revision=revision, doc_id=doc_id),
                    self.assertNumQueries(0),
                ):
                    self.assert_error(
                        self.client.get(navigation_url(doc_id, revision)),
                        400,
                        "INVALID_REQUEST",
                    )
                    self.assert_error(
                        self.client.get(topic_url(doc_id, revision, "x-t-yankee")),
                        400,
                        "INVALID_REQUEST",
                    )

    def test_well_formed_revision_that_does_not_exist_is_a_404(self):
        for revision in ("0", "99", "2147483648", "9999999999", "9" * 5000):
            with self.subTest(revision=revision[:12]):
                self.assert_error(
                    self.client.get(navigation_url("DOC-A", revision)),
                    404,
                    "REVISION_NOT_FOUND",
                )
                self.assert_error(
                    self.client.get(topic_url("DOC-A", revision, "x-t-yankee")),
                    404,
                    "REVISION_NOT_FOUND",
                )
                self.assert_error(
                    self.client.get(navigation_url("NO-SUCH-DOC", revision)),
                    404,
                    "DOCUMENT_NOT_FOUND",
                )

    def test_null_bytes_in_identifiers_are_invalid_requests_without_queries(self):
        for url in (
            navigation_url("DOC%00A", 2),
            topic_url("DOC%00A", 2, "x-t-yankee"),
            topic_url("DOC-A", 2, "x-t%00yankee"),
        ):
            with self.subTest(url=url), self.assertNumQueries(0):
                self.assert_error(self.client.get(url), 400, "INVALID_REQUEST")

    def test_corrupted_navigation_tree_returns_sanitized_error(self):
        stray = make_node(
            self.version,
            "x-t-stray",
            DocumentNode.NodeType.TOPIC,
            99,
            sequence=99,
            parent=self.nodes["x-c-alpha"],
            blocks=[],
        )

        with self.assertLogs("documents.api_errors", level="ERROR") as logs:
            response = self.client.get(navigation_url("DOC-A", 2))

        self.assert_sanitized_internal_error(
            response,
            "section parent",
            f"node {stray.pk}",
            "Traceback",
            "x-t-stray",
        )
        logged = "\n".join(logs.output)
        self.assertIn("DocumentTreeIntegrityError", logged)
        self.assertIn(f"Topic node {stray.pk} must have a section parent", logged)

    def test_database_errors_are_sanitized(self):
        secret = "no such table: documents_documentnode"
        with (
            patch(
                "documents.views.validate_version_tree",
                side_effect=OperationalError(secret),
            ),
            self.assertLogs("documents.api_errors", level="ERROR") as logs,
        ):
            response = self.client.get(navigation_url("DOC-A", 2))

        self.assert_sanitized_internal_error(response, secret, "documents_")
        self.assertIn(secret, "\n".join(logs.output))


class TopicApiTests(ApiAssertionsMixin, APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.document = make_document("DOC-A")
        cls.version = make_version(
            cls.document,
            2,
            date(2026, 7, 15),
            revision_date=date(2026, 7, 1),
        )
        cls.nodes = make_small_tree(cls.version)
        cls.other_version = make_version(cls.document, 3, date(2026, 12, 1))
        cls.other_chapter = make_node(
            cls.other_version,
            "o-c1",
            DocumentNode.NodeType.CHAPTER,
            1,
        )
        cls.other_section = make_node(
            cls.other_version,
            "o-s1",
            DocumentNode.NodeType.SECTION,
            2,
            parent=cls.other_chapter,
        )
        make_node(
            cls.other_version,
            "o-t1",
            DocumentNode.NodeType.TOPIC,
            3,
            parent=cls.other_section,
            blocks=[],
        )

    def test_topic_metadata_blocks_and_parent_ids(self):
        with self.assertNumQueries(2):
            response = self.client.get(topic_url("DOC-A", 2, "x-t-yankee"))

        self.assertEqual(
            self.assert_json(response),
            {
                "document": {
                    "id": "DOC-A",
                    "namespace": "urn:sample:fltpub:1.0",
                    "docType": "FM",
                },
                "version": {
                    "revision": 2,
                    "revisionDate": "2026-07-01",
                    "effectiveDate": "2026-07-15",
                },
                "topic": {
                    "id": "x-t-yankee",
                    "number": "01.10.1",
                    "title": "First topic",
                    "chapterId": "x-c-zulu",
                    "sectionId": "x-s-mike",
                    "blocks": FIRST_TOPIC_BLOCKS,
                },
            },
        )
        self.assertNotIn("metadata", response.json()["version"])

    def test_parent_ids_follow_the_topic(self):
        response = self.client.get(topic_url("DOC-A", 2, "x-t-kilo"))

        topic = self.assert_json(response)["topic"]
        self.assertEqual(
            (topic["chapterId"], topic["sectionId"], topic["blocks"]),
            ("x-c-zulu", "x-s-bravo", []),
        )

    def test_missing_document_revision_and_node_are_distinct(self):
        self.assert_error(
            self.client.get(topic_url("NO-SUCH-DOC", 2, "x-t-yankee")),
            404,
            "DOCUMENT_NOT_FOUND",
        )
        self.assert_error(
            self.client.get(topic_url("DOC-A", 99, "x-t-yankee")),
            404,
            "REVISION_NOT_FOUND",
        )
        with self.assertNumQueries(2):
            missing_node = self.client.get(topic_url("DOC-A", 2, "x-t-missing"))
        self.assert_error(missing_node, 404, "NODE_NOT_FOUND")

    def test_topic_from_another_revision_is_not_found(self):
        self.assert_error(
            self.client.get(topic_url("DOC-A", 2, "o-t1")),
            404,
            "NODE_NOT_FOUND",
        )
        self.assert_json(self.client.get(topic_url("DOC-A", 3, "o-t1")))

    def test_chapter_and_section_ids_are_not_topics(self):
        for node_id in ("x-c-zulu", "x-s-mike"):
            with self.subTest(node_id=node_id), self.assertNumQueries(2):
                response = self.client.get(topic_url("DOC-A", 2, node_id))
                self.assert_error(response, 404, "NODE_NOT_A_TOPIC")

    def test_corrupted_parent_chains_return_sanitized_errors(self):
        section, topic = DocumentNode.NodeType.SECTION, DocumentNode.NodeType.TOPIC
        nested_section = make_node(
            self.version,
            "bad-s-nested",
            section,
            91,
            sequence=91,
            parent=self.nodes["x-s-mike"],
        )
        foreign_chapter_section = make_node(
            self.version,
            "bad-s-foreign-chapter",
            section,
            92,
            sequence=92,
            parent=self.other_chapter,
        )
        foreign_section_only = make_node(
            self.other_version,
            "bad-s-foreign-only",
            section,
            93,
            sequence=93,
            parent=self.nodes["x-c-zulu"],
        )
        topic_under_chapter = make_node(
            self.version,
            "bad-t-parent",
            topic,
            94,
            sequence=94,
            parent=self.nodes["x-c-alpha"],
            blocks=[],
        )
        corrupted = {
            "bad-t-under-chapter": self.nodes["x-c-alpha"],
            "bad-t-under-topic": topic_under_chapter,
            "bad-t-foreign-section": self.other_section,
            "bad-t-foreign-section-only": foreign_section_only,
            "bad-t-nested-section": nested_section,
            "bad-t-foreign-chapter": foreign_chapter_section,
        }
        for position, (node_id, parent) in enumerate(corrupted.items(), 95):
            node = make_node(
                self.version,
                node_id,
                topic,
                position,
                sequence=position,
                parent=parent,
                blocks=[],
            )
            with (
                self.subTest(node_id=node_id),
                self.assertLogs("documents.api_errors", level="ERROR") as logs,
                self.assertNumQueries(2),
            ):
                response = self.client.get(topic_url("DOC-A", 2, node_id))
                self.assert_sanitized_internal_error(
                    response,
                    "parent chain",
                    f"node {node.pk}",
                    "Traceback",
                    node_id,
                )
                self.assertIn(
                    f"Topic node {node.pk} has an invalid parent chain",
                    "\n".join(logs.output),
                )

    def test_chain_check_requires_a_root_chapter_in_the_same_version(self):
        chapter, section, topic = DocumentNode.NodeType

        def chain(
            *,
            chapter_parent=None,
            chapter_version=None,
            chapter_type=chapter,
            has_section=True,
        ):
            root = DocumentNode(pk=1, version=self.version, node_type=chapter)
            chapter_node = DocumentNode(
                pk=2,
                version=chapter_version or self.version,
                node_type=chapter_type,
                parent=chapter_parent and root,
            )
            section_node = DocumentNode(
                pk=3,
                version=self.version,
                node_type=section,
                parent=chapter_node,
            )
            return DocumentNode(
                pk=4,
                version=self.version,
                node_type=topic,
                parent=section_node if has_section else None,
            )

        section_node, chapter_node = views._topic_parents(chain(), self.version)
        self.assertEqual((section_node.pk, chapter_node.pk), (3, 2))

        for label, broken in {
            "chapter has a parent": chain(chapter_parent=True),
            "chapter in another version": chain(chapter_version=self.other_version),
            "section parent is not a chapter": chain(chapter_type=section),
            "topic has no parent": chain(has_section=False),
        }.items():
            with self.subTest(case=label), self.assertRaises(
                DocumentTreeIntegrityError
            ):
                views._topic_parents(broken, self.version)

    def test_topic_without_stored_blocks_is_an_integrity_error(self):
        make_node(
            self.version,
            "bad-t-no-blocks",
            DocumentNode.NodeType.TOPIC,
            90,
            sequence=90,
            parent=self.nodes["x-s-zulu"],
            blocks=None,
        )

        with self.assertLogs("documents.api_errors", level="ERROR"):
            response = self.client.get(topic_url("DOC-A", 2, "bad-t-no-blocks"))

        self.assert_sanitized_internal_error(response, "content blocks")

    def test_topic_request_does_not_scan_the_whole_tree(self):
        make_node(
            self.version,
            "bad-t-elsewhere",
            DocumentNode.NodeType.TOPIC,
            90,
            sequence=90,
            parent=self.nodes["x-c-alpha"],
            blocks=[],
        )

        with self.assertNumQueries(2):
            topic = self.client.get(topic_url("DOC-A", 2, "x-t-yankee"))
        with self.assertLogs("documents.api_errors", level="ERROR"):
            navigation = self.client.get(navigation_url("DOC-A", 2))

        self.assertEqual(
            self.assert_json(topic)["topic"]["blocks"],
            FIRST_TOPIC_BLOCKS,
        )
        self.assert_sanitized_internal_error(navigation)


class ApiMethodAndFormatTests(ApiAssertionsMixin, APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.version = make_version(make_document("DOC-A"), 2, date(2026, 7, 15))
        make_small_tree(cls.version)
        cls.urls = {
            "library": LIBRARY_URL,
            "navigation": navigation_url("DOC-A", 2),
            "topic": topic_url("DOC-A", 2, "x-t-yankee"),
            "resolve": resolve_url("DOC-A", "x-t-yankee", 2),
            "health": "/api/health/",
        }

    def test_write_methods_return_standard_405(self):
        for name, url in self.urls.items():
            for method in ("post", "put", "patch", "delete"):
                with self.subTest(endpoint=name, method=method):
                    with self.assertNumQueries(0):
                        response = getattr(self.client, method)(
                            url,
                            {"title": "ignored"},
                            format="json",
                        )
                    self.assert_error(response, 405, "METHOD_NOT_ALLOWED")
                    self.assertEqual(
                        set(response["Allow"].split(", ")),
                        {"GET", "HEAD", "OPTIONS"},
                    )

    def test_get_head_and_options_are_allowed(self):
        for name, url in self.urls.items():
            with self.subTest(endpoint=name), fixed_today():
                self.assert_json(self.client.get(url))

                head = self.client.head(url)
                self.assertEqual(head.status_code, 200)
                self.assertEqual(head["Content-Type"], "application/json")
                self.assertEqual(head.content, b"")

                options = self.assert_json(self.client.options(url))
                self.assertEqual(options["renders"], ["application/json"])
                self.assertEqual(options["parses"], ["application/json"])

    def test_responses_are_json_whatever_the_client_accepts(self):
        for name, url in self.urls.items():
            with self.subTest(endpoint=name), fixed_today():
                self.assert_json(
                    self.client.get(url, headers={"accept": "*/*"})
                )
                for accept in ("application/xml", "text/html"):
                    self.assert_error(
                        self.client.get(url, headers={"accept": accept}),
                        406,
                        "NOT_ACCEPTABLE",
                    )
                self.assert_error(
                    self.client.get(url, {"format": "api"}),
                    404,
                    "NOT_FOUND",
                )

    def test_unknown_api_routes_use_the_standard_error_shape(self):
        for debug in (False, True):
            for url in (
                "/api/",
                "/api/unknown/",
                "/api/unknown",
                "/api/documents/DOC-A/",
                "/api/documents/DOC-A/revisions/2/",
                "/api/documents/DOC-A/revisions/2/topics/",
                "/api/documents/DOC-A/revisions/2/topics/a/b/",
            ):
                for method in ("get", "post", "delete"):
                    with (
                        self.subTest(debug=debug, url=url, method=method),
                        override_settings(DEBUG=debug),
                        self.assertNumQueries(0),
                    ):
                        response = getattr(self.client, method)(url)
                        self.assert_error(response, 404, "NOT_FOUND")
                        self.assertNotIn(b"<html", response.content.lower())

    def test_routes_outside_the_api_keep_django_behaviour(self):
        for debug in (False, True):
            with self.subTest(debug=debug), override_settings(DEBUG=debug):
                for url in ("/unknown/", "/apiary/", "/static/missing.css"):
                    response = self.client.get(url)
                    self.assertEqual(response.status_code, 404, url)
                    self.assertTrue(
                        response["Content-Type"].startswith("text/html"),
                        url,
                    )

                login = self.client.get("/admin/login/")
                self.assertEqual(login.status_code, 200)
                self.assertTrue(login["Content-Type"].startswith("text/html"))
                self.assertRedirects(
                    self.client.get("/admin/"),
                    "/admin/login/?next=/admin/",
                )

    def test_missing_trailing_slash_still_redirects(self):
        for debug in (False, True):
            for path in ("/api/documents", "/api/health"):
                with (
                    self.subTest(debug=debug, path=path),
                    override_settings(DEBUG=debug),
                ):
                    response = self.client.get(path)
                    self.assertEqual(response.status_code, 301)
                    self.assertEqual(response["Location"], f"{path}/")

    def test_unexpected_errors_are_sanitized_and_logged(self):
        secret = "boom at /Users/someone/project/db.sqlite3"
        with (
            patch(
                "documents.revision_status.current_date",
                side_effect=RuntimeError(secret),
            ),
            self.assertLogs("documents.api_errors", level="ERROR") as logs,
        ):
            response = self.client.get(LIBRARY_URL)

        self.assert_sanitized_internal_error(response, secret, "RuntimeError")
        self.assertIn(secret, "\n".join(logs.output))


class AdminAndSessionCompatibilityTests(ApiAssertionsMixin, APITestCase):
    @classmethod
    def setUpTestData(cls):
        make_version(make_document("DOC-A"), 2, date(2026, 7, 15))
        cls.admin_user = get_user_model().objects.create_superuser(
            username="synthetic-admin",
            password="synthetic-password",
        )

    def test_admin_still_requires_and_accepts_django_session_login(self):
        self.assertRedirects(
            self.client.get("/admin/"),
            "/admin/login/?next=/admin/",
        )

        self.assertTrue(
            self.client.login(
                username="synthetic-admin",
                password="synthetic-password",
            )
        )
        response = self.client.get("/admin/")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response["Content-Type"].startswith("text/html"))
        self.assertContains(response, "Site administration")

    def test_api_ignores_an_admin_session(self):
        with fixed_today():
            anonymous = self.client.get(LIBRARY_URL)
        self.client.force_login(self.admin_user)

        with fixed_today(), self.assertNumQueries(2):
            signed_in = self.client.get(LIBRARY_URL)

        self.assertEqual(self.assert_json(signed_in), self.assert_json(anonymous))

    def test_write_with_a_session_and_no_csrf_token_is_still_a_405(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.admin_user)

        response = client.post(LIBRARY_URL, {"title": "ignored"}, format="json")

        self.assert_error(response, 405, "METHOD_NOT_ALLOWED")


SMALL_TREE_ANCHORS = [
    ("x-p-0002", "para", "x-t-yankee"),
    ("x-p-0001", "checklist", "x-t-yankee"),
    ("x-p-0004", "check", "x-t-yankee"),
    ("x-p-0003", "check", "x-t-yankee"),
    ("x-p-note", "note", "x-t-alpha"),
    ("x-p-caution", "caution", "x-t-alpha"),
    ("x-p-warning", "warning", "x-t-alpha"),
    ("x-p-list", "list", "x-t-alpha"),
    ("x-p-table", "table", "x-t-alpha"),
]
REVISION_1_NAVIGATION = [
    {
        "id": "x-c-zulu",
        "number": "01",
        "title": "First chapter",
        "sections": [
            {
                "id": "x-s-bravo",
                "number": "01.10",
                "title": "Second section",
                "topics": [
                    {"id": "x-t-kilo", "number": "01.10.1", "title": "Third topic"},
                ],
            },
        ],
    },
]
REVISION_3_NAVIGATION = [
    {
        "id": "x-c-zulu",
        "number": "01",
        "title": "First chapter",
        "sections": [
            {
                "id": "x-s-mike",
                "number": "01.10",
                "title": "First section",
                "topics": [
                    {"id": "x-t-yankee", "number": "01.10.1", "title": "First topic"},
                ],
            },
            {
                "id": "x-s-bravo",
                "number": "01.20",
                "title": "Second section",
                "topics": [
                    {"id": "x-t-new", "number": "01.20.1", "title": "New topic"},
                    {"id": "x-t-alpha", "number": "01.20.2", "title": "Second topic"},
                ],
            },
        ],
    },
]
TOPIC_SUMMARIES = {
    "x-t-yankee": {"id": "x-t-yankee", "number": "01.10.1", "title": "First topic"},
    "x-t-alpha": {"id": "x-t-alpha", "number": "01.10.2", "title": "Second topic"},
    "x-t-kilo": {"id": "x-t-kilo", "number": "01.20.1", "title": "Third topic"},
}
NODE_NOT_FOUND_MESSAGE = (
    "The node ID does not exist in the selected document revision."
)


def resolution(revision, chapter_id, section_id, topic, target_id, target_type):
    return {
        "documentId": "DOC-A",
        "selectedRevision": revision,
        "chapterId": chapter_id,
        "sectionId": section_id,
        "topicId": topic["id"],
        "targetNodeId": target_id,
        "targetType": target_type,
        "topic": topic,
    }


class ResolveNodeApiTests(ApiAssertionsMixin, APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.document = make_document("DOC-A")
        cls.revision_1 = make_version(cls.document, 1, date(2026, 1, 1))
        cls.revision_2 = make_version(cls.document, 2, date(2026, 7, 15))
        cls.revision_3 = make_version(cls.document, 3, date(2026, 12, 1))
        cls.nodes_1 = make_small_tree(cls.revision_1, REVISION_1_NAVIGATION)
        cls.nodes_2 = make_small_tree(cls.revision_2)
        cls.nodes_3 = make_small_tree(cls.revision_3, REVISION_3_NAVIGATION)
        make_anchors(
            cls.revision_1,
            cls.nodes_1,
            [("x-p-0001", "checklist", "x-t-kilo")],
        )
        make_anchors(cls.revision_2, cls.nodes_2, SMALL_TREE_ANCHORS)
        make_anchors(
            cls.revision_3,
            cls.nodes_3,
            [
                ("x-p-0002", "para", "x-t-yankee"),
                ("x-p-rev3", "note", "x-t-new"),
            ],
        )

    def setUp(self):
        today = fixed_today()
        today.start()
        self.addCleanup(today.stop)

    def resolve(self, node_id, revision=None, *, queries=None, doc_id="DOC-A"):
        with CaptureQueriesContext(connection) as captured:
            response = self.client.get(resolve_url(doc_id, node_id, revision))
        if queries is not None:
            self.assertEqual(len(captured), queries, [q["sql"] for q in captured])
        self.assertFalse(
            [q["sql"] for q in captured if "content_blocks" in q["sql"]],
            "the resolver must not read topic content",
        )
        return response

    def test_topic_target(self):
        for revision in (None, 2):
            with self.subTest(revision=revision):
                response = self.resolve("x-t-alpha", revision, queries=2)

                self.assertEqual(
                    self.assert_json(response),
                    resolution(
                        2,
                        "x-c-zulu",
                        "x-s-mike",
                        TOPIC_SUMMARIES["x-t-alpha"],
                        "x-t-alpha",
                        "topic",
                    ),
                )
                self.assertEqual(
                    list(response.json()),
                    [
                        "documentId",
                        "selectedRevision",
                        "chapterId",
                        "sectionId",
                        "topicId",
                        "targetNodeId",
                        "targetType",
                        "topic",
                    ],
                )

    def test_every_block_type_and_check_target(self):
        self.assertEqual(
            {anchor_type for _, anchor_type, _ in SMALL_TREE_ANCHORS},
            set(ContentAnchor.AnchorType.values),
        )
        for anchor_id, anchor_type, topic_id in SMALL_TREE_ANCHORS:
            for revision in (None, 2):
                with self.subTest(anchor_id=anchor_id, revision=revision):
                    response = self.resolve(anchor_id, revision, queries=3)

                    self.assertEqual(
                        self.assert_json(response),
                        resolution(
                            2,
                            "x-c-zulu",
                            "x-s-mike",
                            TOPIC_SUMMARIES[topic_id],
                            anchor_id,
                            anchor_type,
                        ),
                    )

    def test_chapter_and_section_targets_open_their_first_topic(self):
        expected = {
            "x-c-zulu": ("x-s-mike", "x-t-yankee", "chapter"),
            "x-s-mike": ("x-s-mike", "x-t-yankee", "section"),
            "x-s-bravo": ("x-s-bravo", "x-t-kilo", "section"),
        }
        for node_id, (section_id, topic_id, target_type) in expected.items():
            with self.subTest(node_id=node_id):
                response = self.resolve(node_id, queries=3)

                self.assertEqual(
                    self.assert_json(response),
                    resolution(
                        2,
                        "x-c-zulu",
                        section_id,
                        TOPIC_SUMMARIES[topic_id],
                        node_id,
                        target_type,
                    ),
                )

    def test_chapter_target_uses_document_order_past_an_empty_section(self):
        version = make_version(self.document, 4, date(2027, 6, 1))
        chapter = make_node(version, "e-c1", DocumentNode.NodeType.CHAPTER, 1)
        make_node(
            version,
            "e-s-empty",
            DocumentNode.NodeType.SECTION,
            2,
            sequence=1,
            parent=chapter,
        )
        section = make_node(
            version,
            "e-s-full",
            DocumentNode.NodeType.SECTION,
            3,
            sequence=2,
            parent=chapter,
        )
        make_node(
            version,
            "e-t-zulu",
            DocumentNode.NodeType.TOPIC,
            4,
            sequence=1,
            parent=section,
            number="01.20.1",
            title="Earlier in the document",
            blocks=[],
        )
        make_node(
            version,
            "e-t-alpha",
            DocumentNode.NodeType.TOPIC,
            5,
            sequence=2,
            parent=section,
            blocks=[],
        )

        response = self.resolve("e-c1", 4, queries=3)

        self.assertEqual(
            self.assert_json(response),
            resolution(
                4,
                "e-c1",
                "e-s-full",
                {
                    "id": "e-t-zulu",
                    "number": "01.20.1",
                    "title": "Earlier in the document",
                },
                "e-c1",
                "chapter",
            ),
        )
        self.assert_error(
            self.resolve("e-s-empty", 4, queries=3),
            422,
            "UNSUPPORTED_NODE_TYPE",
        )

    def test_chapter_or_section_without_a_topic_is_unsupported(self):
        for node_id in ("x-c-alpha", "x-s-zulu"):
            with self.subTest(node_id=node_id):
                self.assert_error(
                    self.resolve(node_id, queries=3),
                    422,
                    "UNSUPPORTED_NODE_TYPE",
                )

    def test_omitted_revision_follows_the_effective_date(self):
        expected = {
            date(2026, 1, 1): 1,
            date(2026, 7, 14): 1,
            date(2026, 7, 15): 2,
            date(2026, 11, 30): 2,
            date(2026, 12, 1): 3,
            date(2030, 1, 1): 3,
        }
        for day, revision in expected.items():
            with self.subTest(day=day), fixed_today(day):
                node_id = "x-t-yankee" if revision > 1 else "x-t-kilo"
                body = self.assert_json(self.resolve(node_id, queries=2))
                self.assertEqual(body["selectedRevision"], revision)

    def test_omitted_revision_agrees_with_the_library_status(self):
        for day in (date(2026, 3, 1), FIXED_TODAY, date(2026, 12, 1)):
            with self.subTest(day=day), fixed_today(day):
                library = self.assert_json(self.client.get(LIBRARY_URL))
                current = [
                    entry["revision"]
                    for entry in library["documents"][0]["availableRevisions"]
                    if entry["status"] == "current"
                ]
                node_id = "x-t-kilo" if current == [1] else "x-t-yankee"
                resolved = self.assert_json(self.resolve(node_id))
                self.assertEqual([resolved["selectedRevision"]], current)

    def test_explicit_revision_is_never_substituted(self):
        for day in (date(2025, 1, 1), FIXED_TODAY, date(2030, 1, 1)):
            for revision, node_id in ((1, "x-t-kilo"), (2, "x-t-kilo"), (3, "x-t-new")):
                with self.subTest(day=day, revision=revision), fixed_today(day):
                    body = self.assert_json(self.resolve(node_id, revision, queries=2))
                    self.assertEqual(body["selectedRevision"], revision)

    def test_moved_topic_resolves_to_its_section_in_each_revision(self):
        in_revision_2 = self.assert_json(self.resolve("x-t-alpha", 2))
        in_revision_3 = self.assert_json(self.resolve("x-t-alpha", 3))

        self.assertEqual(
            (in_revision_2["sectionId"], in_revision_2["topic"]["number"]),
            ("x-s-mike", "01.10.2"),
        )
        self.assertEqual(
            (in_revision_3["sectionId"], in_revision_3["topic"]["number"]),
            ("x-s-bravo", "01.20.2"),
        )

    def test_node_held_only_by_other_revisions_reports_them(self):
        cases = [
            ("x-t-new", None, [3]),
            ("x-t-new", 2, [3]),
            ("x-p-rev3", 2, [3]),
            ("x-t-kilo", 3, [1, 2]),
            ("x-p-0001", 3, [1, 2]),
            ("x-p-0004", 1, [2]),
            ("x-t-yankee", 1, [2, 3]),
        ]
        for node_id, revision, available in cases:
            with self.subTest(node_id=node_id, revision=revision):
                response = self.resolve(node_id, revision, queries=5)

                self.assertEqual(
                    self.assert_json(response, 404),
                    {
                        "error": {
                            "code": "NODE_NOT_FOUND",
                            "message": NODE_NOT_FOUND_MESSAGE,
                            "details": {"availableRevisions": available},
                        }
                    },
                )

    def test_other_documents_are_never_reported_as_available(self):
        other = make_document("DOC-B")
        version = make_version(other, 7, date(2026, 1, 1))
        nodes = make_small_tree(version, REVISION_1_NAVIGATION)
        make_anchors(version, nodes, [("b-only", "para", "x-t-kilo")])

        for doc_id, node_id, revision in (
            ("DOC-A", "b-only", 2),
            ("DOC-B", "x-t-yankee", 7),
        ):
            with self.subTest(doc_id=doc_id, node_id=node_id):
                response = self.resolve(node_id, revision, doc_id=doc_id, queries=5)

                self.assertEqual(
                    self.assert_json(response, 404),
                    {
                        "error": {
                            "code": "NODE_NOT_FOUND",
                            "message": NODE_NOT_FOUND_MESSAGE,
                        }
                    },
                )

    def test_node_in_no_revision_has_no_details(self):
        for revision in (None, 2):
            with self.subTest(revision=revision):
                response = self.resolve("x-t-nowhere", revision, queries=5)

                self.assertEqual(
                    self.assert_json(response, 404),
                    {
                        "error": {
                            "code": "NODE_NOT_FOUND",
                            "message": NODE_NOT_FOUND_MESSAGE,
                        }
                    },
                )

    def test_invalid_requests_are_rejected_without_queries(self):
        base = "/api/documents/DOC-A/resolve-node/"
        invalid = [
            base,
            f"{base}?revision=2",
            f"{base}?nodeId=",
            f"{base}?nodeId=&revision=2",
            f"{base}?nodeId=x-t%00yankee",
            f"{base}?nodeId=x-t-yankee&revision=",
            f"{base}?nodeId=x-t-yankee&revision=abc",
            f"{base}?nodeId=x-t-yankee&revision=2.0",
            f"{base}?nodeId=x-t-yankee&revision=-2",
            f"{base}?nodeId=x-t-yankee&revision=%2B2",
            f"{base}?nodeId=x-t-yankee&revision=02",
            f"{base}?nodeId=x-t-yankee&revision=%202",
            f"{base}?nodeId=x-t-yankee&revision=%D9%A2",
            "/api/documents/DOC%00A/resolve-node/?nodeId=x-t-yankee",
            "/api/documents/DOC%00A/resolve-node/?nodeId=x-t-yankee&revision=2",
            "/api/documents/NO-SUCH-DOC/resolve-node/?nodeId=x-t-yankee&revision=abc",
            "/api/documents/NO-SUCH-DOC/resolve-node/",
        ]
        for url in invalid:
            with self.subTest(url=url), self.assertNumQueries(0):
                self.assert_error(self.client.get(url), 400, "INVALID_REQUEST")

    def test_repeated_node_id_or_revision_parameters_are_rejected(self):
        base = "/api/documents/DOC-A/resolve-node/"
        repeated = [
            f"{base}?nodeId=x-t-yankee&nodeId=x-t-alpha",
            f"{base}?nodeId=x-t-yankee&nodeId=x-t-yankee",
            f"{base}?nodeId=x-t-yankee&nodeId=",
            f"{base}?nodeId=&nodeId=x-t-yankee",
            f"{base}?nodeId=x-t-yankee&revision=2&revision=3",
            f"{base}?nodeId=x-t-yankee&revision=2&revision=2",
            f"{base}?revision=2&nodeId=x-t-yankee&revision=",
            f"{base}?nodeId=x-t-yankee&nodeId=x-t-alpha&revision=2&revision=3",
            "/api/documents/NO-SUCH-DOC/resolve-node/?nodeId=a&nodeId=b",
        ]
        for url in repeated:
            with self.subTest(url=url), self.assertNumQueries(0):
                body = self.assert_error(self.client.get(url), 400, "INVALID_REQUEST")
                self.assertIn("only once", body["error"]["message"])

        unrelated = self.client.get(f"{base}?nodeId=x-t-yankee&other=1&other=2")
        self.assertEqual(self.assert_json(unrelated)["topicId"], "x-t-yankee")

    def test_unknown_document(self):
        self.assert_error(
            self.resolve("x-t-yankee", doc_id="NO-SUCH-DOC", queries=2),
            404,
            "DOCUMENT_NOT_FOUND",
        )
        self.assert_error(
            self.resolve("x-t-yankee", 2, doc_id="NO-SUCH-DOC", queries=2),
            404,
            "DOCUMENT_NOT_FOUND",
        )

    def test_explicit_revision_that_does_not_exist(self):
        for revision in ("0", "99", "2147483648", "9" * 5000):
            with self.subTest(revision=revision[:12]):
                self.assert_error(
                    self.resolve("x-t-yankee", revision),
                    404,
                    "REVISION_NOT_FOUND",
                )

    def test_no_current_revision(self):
        with fixed_today(date(2025, 12, 31)):
            self.assert_error(
                self.resolve("x-t-kilo", queries=1),
                404,
                "NO_CURRENT_REVISION",
            )
            self.assertEqual(
                self.assert_json(self.resolve("x-t-kilo", 1))["selectedRevision"],
                1,
            )

        make_document("DOC-EMPTY")
        self.assert_error(
            self.resolve("x-t-kilo", doc_id="DOC-EMPTY", queries=2),
            404,
            "NO_CURRENT_REVISION",
        )

    def test_corrupt_parent_chains_return_sanitized_errors(self):
        section, topic = DocumentNode.NodeType.SECTION, DocumentNode.NodeType.TOPIC
        version = self.revision_2
        topic_under_chapter = make_node(
            version,
            "bad-t-under-chapter",
            topic,
            90,
            sequence=90,
            parent=self.nodes_2["x-c-alpha"],
            blocks=[],
        )
        foreign_chapter_section = make_node(
            version,
            "bad-s-foreign-chapter",
            section,
            91,
            sequence=91,
            parent=self.nodes_3["x-c-zulu"],
        )
        make_node(
            version,
            "bad-t-foreign-chapter",
            topic,
            92,
            sequence=92,
            parent=foreign_chapter_section,
            blocks=[],
        )
        nested_section = make_node(
            version,
            "bad-s-nested",
            section,
            93,
            sequence=93,
            parent=self.nodes_2["x-s-mike"],
        )
        make_node(
            version,
            "bad-t-nested",
            topic,
            94,
            sequence=94,
            parent=nested_section,
            blocks=[],
        )
        topic_from_another_revision = make_node(
            self.revision_3,
            "bad-t-other-revision",
            topic,
            95,
            sequence=95,
            parent=self.nodes_2["x-s-bravo"],
            blocks=[],
        )
        make_anchors(
            version,
            {
                **self.nodes_2,
                "bad-t-under-chapter": topic_under_chapter,
                "bad-s-nested": nested_section,
                "bad-t-other-revision": topic_from_another_revision,
                "x-t-foreign": self.nodes_3["x-t-new"],
            },
            [
                ("bad-p-under-chapter", "para", "bad-t-under-chapter"),
                ("bad-p-foreign-topic", "para", "x-t-foreign"),
                ("bad-p-other-revision-topic", "para", "bad-t-other-revision"),
                ("bad-p-on-nested-section", "para", "bad-s-nested"),
                ("bad-p-on-section", "para", "x-s-mike"),
                ("bad-p-on-chapter", "para", "x-c-zulu"),
            ],
        )

        corrupt = {
            "bad-t-under-chapter": 2,
            "bad-t-foreign-chapter": 2,
            "bad-s-foreign-chapter": 3,
            "bad-t-nested": 2,
            "bad-s-nested": 3,
            "bad-p-under-chapter": 3,
            "bad-p-foreign-topic": 3,
            "bad-p-other-revision-topic": 3,
            "bad-p-on-nested-section": 3,
            "bad-p-on-section": 3,
            "bad-p-on-chapter": 3,
        }
        for node_id, queries in corrupt.items():
            with (
                self.subTest(node_id=node_id),
                self.assertLogs("documents.api_errors", level="ERROR") as logs,
            ):
                response = self.resolve(node_id, 2, queries=queries)
                self.assert_sanitized_internal_error(
                    response,
                    node_id,
                    "parent chain",
                    "Anchor",
                    "Traceback",
                )
                self.assertIn("DocumentTreeIntegrityError", "\n".join(logs.output))

    def test_query_counts_do_not_grow_with_the_tree(self):
        version = make_version(self.document, 5, date(2027, 1, 1))
        navigation = [
            {
                "id": f"big-c{chapter}",
                "number": f"{chapter:02d}",
                "title": f"Chapter {chapter}",
                "sections": [
                    {
                        "id": f"big-s{chapter}{section}",
                        "number": f"{chapter:02d}.{section}0",
                        "title": f"Section {chapter}.{section}",
                        "topics": [
                            {
                                "id": f"big-t{chapter}{section}{topic}",
                                "number": f"{chapter:02d}.{section}0.{topic}",
                                "title": f"Topic {chapter}.{section}.{topic}",
                            }
                            for topic in range(1, 9)
                        ],
                    }
                    for section in range(1, 5)
                ],
            }
            for chapter in range(1, 5)
        ]
        nodes = make_small_tree(version, navigation)
        topic_ids = [node_id for node_id in nodes if node_id.startswith("big-t")]
        make_anchors(
            version,
            nodes,
            [
                (f"{topic_id}-p{index}", "para", topic_id)
                for topic_id in topic_ids
                for index in range(1, 9)
            ],
        )
        self.assertEqual(len(topic_ids), 128)
        self.assertEqual(ContentAnchor.objects.filter(version=version).count(), 1024)

        counts = {
            "big-t448": (200, 2),
            "big-t448-p8": (200, 3),
            "big-c4": (200, 3),
            "big-s44": (200, 3),
            "big-t999": (404, 5),
            "x-t-yankee": (404, 5),
        }
        for node_id, (status_code, queries) in counts.items():
            with self.subTest(node_id=node_id):
                response = self.resolve(node_id, 5, queries=queries)
                self.assertEqual(response.status_code, status_code)

        last = self.assert_json(self.resolve("big-t448-p8", 5))
        self.assertEqual(
            (last["chapterId"], last["sectionId"], last["topicId"]),
            ("big-c4", "big-s44", "big-t448"),
        )


class RealSampleResolveApiTests(ApiAssertionsMixin, APITestCase):
    SAMPLE_PARENTS = {
        "fm100-t1193": ("fm100-c01", "fm100-s001", "fm100-t1193"),
        "fm100-t0098": ("fm100-c03", "fm100-s008", "fm100-t0098"),
        "fm100-t0196": ("fm100-c03", "fm100-s012", "fm100-t0196"),
        "fm100-t0294": ("fm100-c04", "fm100-s016", "fm100-t0294"),
        "fm100-t0391": ("fm100-c05", "fm100-s022", "fm100-t0391"),
        "fm100-t0488": ("fm100-c06", "fm100-s027", "fm100-t0488"),
        "fm100-p00673": ("fm100-c03", "fm100-s008", "fm100-t0097"),
    }

    @classmethod
    def setUpTestData(cls):
        xml_directory = PROJECT_ROOT / "sample-data" / "xml"
        for name in ("FM-S100_Rev2.xml", "FM-S100_Rev3.xml"):
            result = ingest_xml(xml_directory / name)
            if not result.success:
                raise AssertionError(result.message)
        cls.contract_sample = json.loads(
            (PROJECT_ROOT / "contracts" / "provisional-sample.json").read_text(
                encoding="utf-8"
            )
        )
        cls.client_samples = json.loads(
            (PROJECT_ROOT / "sample-data" / "deep_link_samples.json").read_text(
                encoding="utf-8"
            )
        )["links"]

    def setUp(self):
        failure = AssertionError("XML must not be parsed while serving the API")
        for target in (
            patch.object(etree, "parse", side_effect=failure),
            patch.object(etree, "XMLSchema", side_effect=failure),
            patch(
                "documents.ingestion.assemble_normalized_document",
                side_effect=failure,
            ),
            fixed_today(),
        ):
            target.start()
            self.addCleanup(target.stop)

    def resolve(self, node_id, revision=None, *, queries=None):
        with CaptureQueriesContext(connection) as captured:
            response = self.client.get(resolve_url("FM-S100", node_id, revision))
        if queries is not None:
            self.assertEqual(len(captured), queries, [q["sql"] for q in captured])
        self.assertFalse(
            [q["sql"] for q in captured if "content_blocks" in q["sql"]],
            "the resolver must not read topic content",
        )
        return response

    def test_all_client_sample_links_resolve_in_the_current_revision(self):
        self.assertEqual(len(self.client_samples), 7)
        self.assertEqual(
            {link["nodeId"] for link in self.client_samples},
            set(self.SAMPLE_PARENTS),
        )
        for link in self.client_samples:
            node_id = link["nodeId"]
            chapter_id, section_id, topic_id = self.SAMPLE_PARENTS[node_id]
            is_topic = node_id == topic_id
            with self.subTest(node_id=node_id):
                response = self.client.get(resolve_url(link["docId"], node_id))
                body = self.assert_json(response)

                self.assertEqual(
                    {key: value for key, value in body.items() if key != "topic"},
                    {
                        "documentId": "FM-S100",
                        "selectedRevision": 2,
                        "chapterId": chapter_id,
                        "sectionId": section_id,
                        "topicId": topic_id,
                        "targetNodeId": node_id,
                        "targetType": "topic" if is_topic else "para",
                    },
                )
                self.assertEqual(body["topic"]["id"], topic_id)
                self.assertEqual(body["topic"]["number"], link["expectedNumber"])
                if is_topic:
                    self.assertEqual(body["topic"]["title"], link["expectedTitle"])
                self.resolve(node_id, queries=2 if is_topic else 3)

    def test_contract_deep_link_examples_are_reproduced_exactly(self):
        for name in ("paragraphDeepLinkExample", "checklistItemDeepLinkExample"):
            example = self.contract_sample[name]
            request = example["request"]
            with self.subTest(example=name):
                response = self.client.get(
                    resolve_url(
                        request["docId"],
                        request["nodeId"],
                        request["revision"],
                    )
                )

                self.assertEqual(self.assert_json(response), example["response"])
                self.assertEqual(
                    json.dumps(response.json()),
                    json.dumps(example["response"]),
                )

    def test_each_target_type_on_the_real_manual(self):
        expected = {
            "fm100-t1193": ("topic", "fm100-c01", "fm100-s001", "fm100-t1193", 2),
            "fm100-p00673": ("para", "fm100-c03", "fm100-s008", "fm100-t0097", 3),
            "fm100-p03231": ("checklist", "fm100-c05", "fm100-s019", "fm100-t0340", 3),
            "fm100-p03219": ("check", "fm100-c05", "fm100-s019", "fm100-t0340", 3),
            "fm100-c03": ("chapter", "fm100-c03", "fm100-s008", "fm100-t0097", 3),
            "fm100-s019": ("section", "fm100-c05", "fm100-s019", "fm100-t0324", 3),
        }
        for node_id, (target_type, chapter_id, section_id, topic_id, queries) in (
            expected.items()
        ):
            with self.subTest(node_id=node_id):
                body = self.assert_json(self.resolve(node_id, queries=queries))

                self.assertEqual(
                    (
                        body["targetType"],
                        body["chapterId"],
                        body["sectionId"],
                        body["topicId"],
                        body["targetNodeId"],
                        body["selectedRevision"],
                    ),
                    (target_type, chapter_id, section_id, topic_id, node_id, 2),
                )

    def test_omitted_revision_moves_to_revision_3_on_its_effective_date(self):
        for day, revision in (
            (FIXED_TODAY, 2),
            (date(2026, 11, 30), 2),
            (date(2026, 12, 1), 3),
        ):
            with self.subTest(day=day), fixed_today(day):
                body = self.assert_json(self.resolve("fm100-t0340", queries=2))
                self.assertEqual(body["selectedRevision"], revision)

    def test_explicit_revision_never_falls_back(self):
        for day in (FIXED_TODAY, date(2026, 12, 1)):
            for revision in (2, 3):
                with self.subTest(day=day, revision=revision), fixed_today(day):
                    body = self.assert_json(self.resolve("fm100-t0340", revision))
                    self.assertEqual(body["selectedRevision"], revision)

    def test_topics_held_by_one_revision_name_the_other(self):
        cases = [
            ("fm100-t1199", None, FIXED_TODAY, [3]),
            ("fm100-t1199", 2, FIXED_TODAY, [3]),
            ("fm100-t0022", 3, FIXED_TODAY, [2]),
            ("fm100-t0022", None, date(2026, 12, 1), [2]),
        ]
        for node_id, revision, day, available in cases:
            with self.subTest(node_id=node_id, revision=revision), fixed_today(day):
                self.assert_error_with_details(
                    self.resolve(node_id, revision, queries=5),
                    404,
                    "NODE_NOT_FOUND",
                    {"availableRevisions": available},
                )

        self.assertEqual(
            self.assert_json(self.resolve("fm100-t1199", 3))["selectedRevision"],
            3,
        )
        self.assertEqual(
            self.assert_json(self.resolve("fm100-t0022", 2))["selectedRevision"],
            2,
        )

    def test_moved_topic_resolves_to_a_different_section_in_each_revision(self):
        in_revision_2 = self.assert_json(self.resolve("fm100-t0043", 2))
        in_revision_3 = self.assert_json(self.resolve("fm100-t0043", 3))

        self.assertEqual(in_revision_2["topic"]["number"], "02.20.3")
        self.assertEqual(in_revision_3["topic"]["number"], "03.50.4")
        self.assertEqual(in_revision_2["topic"]["title"], "Weight Limitation 3")
        self.assertEqual(in_revision_3["topic"]["title"], "Weight Limitation 3")
        self.assertNotEqual(in_revision_2["sectionId"], in_revision_3["sectionId"])
        self.assertNotEqual(in_revision_2["chapterId"], in_revision_3["chapterId"])
        self.assertEqual(in_revision_2["topicId"], in_revision_3["topicId"])


class RealSampleApiTests(ApiAssertionsMixin, APITestCase):
    @classmethod
    def setUpTestData(cls):
        normalized = assemble_normalized_document()
        with patch(
            "documents.ingestion.assemble_normalized_document",
            return_value=normalized,
        ):
            result = ingest_xml(DEFAULT_XML_PATH)
        if not result.success:
            raise AssertionError(result.message)
        cls.payload = normalized["payload"]
        cls.contract_sample = json.loads(
            (PROJECT_ROOT / "contracts" / "provisional-sample.json").read_text(
                encoding="utf-8"
            )
        )

    def setUp(self):
        failure = AssertionError("XML must not be parsed while serving the API")
        for target in (
            patch.object(etree, "parse", side_effect=failure),
            patch.object(etree, "XMLSchema", side_effect=failure),
            patch(
                "documents.ingestion.assemble_normalized_document",
                side_effect=failure,
            ),
            fixed_today(),
        ):
            target.start()
            self.addCleanup(target.stop)

    def test_library_matches_the_contract_example(self):
        with self.assertNumQueries(2):
            response = self.client.get(LIBRARY_URL)

        self.assertEqual(
            self.assert_json(response),
            self.contract_sample["documentLibraryExample"],
        )

    def test_navigation_returns_the_complete_outline_in_source_order(self):
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(navigation_url("FM-S100", 2))

        body = self.assert_json(response)
        self.assertEqual(len(queries), 3)
        self.assertFalse(
            [query["sql"] for query in queries if "content_blocks" in query["sql"]]
        )
        self.assertEqual(
            body,
            {
                "document": self.payload["document"],
                "version": self.payload["version"],
                "chapters": self.payload["chapters"],
            },
        )
        sections = [
            section for chapter in body["chapters"] for section in chapter["sections"]
        ]
        self.assertEqual(len(body["chapters"]), 19)
        self.assertEqual(len(sections), 71)
        self.assertEqual(sum(len(section["topics"]) for section in sections), 1193)

    def test_navigation_contains_the_contract_example_excerpt(self):
        body = self.assert_json(self.client.get(navigation_url("FM-S100", 2)))
        example = self.contract_sample["navigationExample"]
        example_chapter = example["chapters"][0]
        example_section = example_chapter["sections"][0]

        self.assertEqual(body["document"], example["document"])
        self.assertEqual(body["version"], example["version"])
        chapter = next(
            chapter
            for chapter in body["chapters"]
            if chapter["id"] == example_chapter["id"]
        )
        self.assertEqual(
            (chapter["number"], chapter["title"]),
            (example_chapter["number"], example_chapter["title"]),
        )
        section = next(
            section
            for section in chapter["sections"]
            if section["id"] == example_section["id"]
        )
        self.assertEqual(
            (section["number"], section["title"]),
            (example_section["number"], example_section["title"]),
        )
        self.assertIn(example_section["topics"][0], section["topics"])

    def test_topic_matches_the_contract_example(self):
        with self.assertNumQueries(2):
            response = self.client.get(topic_url("FM-S100", 2, "fm100-t0340"))

        self.assertEqual(
            self.assert_json(response),
            self.contract_sample["topicContentExample"],
        )

    def test_table_topic_matches_the_contract_example(self):
        example = self.contract_sample["tableExample"]
        source = example["sourceTopic"]

        topic = self.assert_json(
            self.client.get(topic_url("FM-S100", 2, source["topicId"]))
        )["topic"]

        self.assertEqual(
            (
                topic["id"],
                topic["number"],
                topic["title"],
                topic["chapterId"],
                topic["sectionId"],
            ),
            (
                source["topicId"],
                source["number"],
                source["title"],
                source["chapterId"],
                source["sectionId"],
            ),
        )
        self.assertIn(example["block"], topic["blocks"])

    def test_every_topic_serves_its_stored_blocks_and_parents(self):
        for topic_id in ("fm100-t1193", "fm100-t0097", "fm100-t0001"):
            expected = self.payload["topicContentById"][topic_id]
            with self.subTest(topic_id=topic_id), self.assertNumQueries(2):
                response = self.client.get(topic_url("FM-S100", 2, topic_id))
                self.assertEqual(self.assert_json(response)["topic"], expected)

    def test_real_chapter_and_section_ids_are_not_topics(self):
        for node_id in ("fm100-c05", "fm100-s019"):
            with self.subTest(node_id=node_id):
                self.assert_error(
                    self.client.get(topic_url("FM-S100", 2, node_id)),
                    404,
                    "NODE_NOT_A_TOPIC",
                )
