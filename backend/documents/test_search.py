from django.test import SimpleTestCase
from rest_framework.test import APITestCase

from documents import search
from documents.ingestion import ingest_xml
from documents.test_api import ApiAssertionsMixin, fixed_today
from documents.xml_validation import PROJECT_ROOT

# The same fixture and expectations are used by frontend/src/utils/searchIndex.test.ts,
# so online and offline search rank results identically.
FIXTURE = [
    ("x-t1", "01.10.1", "Engine Anti-Ice", [
        ("x-p1", "para", "Set the engine anti-ice switch ON before descent."),
    ]),
    ("x-t2", "01.10.2", "Hydraulic System A", [
        ("x-p2", "para", "Hydraulic pressure is checked during preflight. Engine anti-ice is not required."),
        ("x-p3", "note", "Hydraulic quantity is shown on the lower display."),
    ]),
]
CASES = [
    ("engine anti-ice", [("x-t1", "x-p1", 20, 2), ("x-t2", "x-p2", 11, 1)]),
    ("hydraul", [("x-t2", "x-p2", 4, 3)]),
    ("anti engine", [("x-t1", "x-p1", 10, 2), ("x-t2", "x-p2", 4, 1)]),
    ("descent zzz", []),
    ("system a", [("x-t2", "x-t2", 13, 3)]),
]

SNIPPET_CASES = [
    ("Set the switch ON. Engine anti-ice is required in icing. Check the light.", ["anti"],
     "Engine anti-ice is required in icing."),
    ("Engine anti-ice is required", ["engine"], "Engine anti-ice is required"),
    ("Condition | Value\nWindow Heat indication | 4 units\nProbe Heat | 2 units", ["window"],
     "Window Heat indication | 4 units"),
]


def fixture_document(doc_id="X", applicability="SAMPLE-1", doc_type="FM") -> search.IndexedDocument:
    entries = []
    for topic_id, number, title, blocks in FIXTURE:
        common = dict(
            doc_id=doc_id, revision=1, topic_id=topic_id, number=number, title=title,
            section_number="01.10", section_title="Section",
            title_key=search.word_key(f"{number} {title}"),
        )
        entries.append(search.Entry(node_id=topic_id, node_type="topic", text="", text_key=" ", **common))
        for node_id, node_type, text in blocks:
            entries.append(
                search.Entry(node_id=node_id, node_type=node_type, text=text,
                             text_key=search.word_key(text), **common)
            )
    return search.IndexedDocument(
        doc_id=doc_id, title=doc_id, doc_type=doc_type, applicability=applicability,
        category=search.category_for(applicability), revision=1,
        effective_date="2026-01-01", entries=tuple(entries),
    )


class SearchRulesTests(SimpleTestCase):
    def test_shared_cases(self):
        for query, expected in CASES:
            with self.subTest(query=query):
                result = search.search(query, [fixture_document()])
                self.assertEqual(
                    [(r["topicId"], r["nodeId"], r["score"], r["matchCount"]) for r in result["results"]],
                    expected,
                )

    def test_every_word_must_match(self):
        self.assertEqual(search.search("engine quantity", [fixture_document()])["total"], 0)

    def test_fleet_filter_keeps_master_documents(self):
        documents = [
            fixture_document("FLEET-1", "SAMPLE-1"),
            fixture_document("FLEET-2", "SAMPLE-2"),
            fixture_document("MASTER", "ALL", "FOM"),
        ]
        result = search.search("engine", documents, fleet="SAMPLE-1")
        self.assertEqual(set(result["byDocument"]), {"FLEET-1", "MASTER"})

    def test_fleet_filter_keeps_supplemental_documents_for_all_fleets(self):
        bulletin = fixture_document("BULLETIN", "ALL", "BULLETIN")
        bulletin = search.IndexedDocument(
            **{**bulletin.__dict__, "category": search.category_for("ALL", "pdf-only")}
        )
        self.assertEqual(bulletin.category, "supplemental")
        documents = [fixture_document("FLEET-2", "SAMPLE-2"), bulletin]
        self.assertEqual(set(search.search("engine", documents, fleet="SAMPLE-1")["byDocument"]), {"BULLETIN"})
        self.assertEqual(
            set(search.search("engine", documents, categories={"supplemental"})["byDocument"]), {"BULLETIN"}
        )

    def test_document_type_and_category_filters(self):
        documents = [fixture_document("A", "SAMPLE-1", "FM"), fixture_document("B", "ALL", "FOM")]
        self.assertEqual(set(search.search("engine", documents, doc_types={"FOM"})["byDocument"]), {"B"})
        self.assertEqual(set(search.search("engine", documents, categories={"fleet"})["byDocument"]), {"A"})

    def test_content_filter_keeps_only_those_blocks(self):
        document = fixture_document()
        warning = search.Entry(
            doc_id="X", revision=1, topic_id="x-t2", node_id="x-p4", node_type="caution",
            number="01.10.2", title="Hydraulic System A", section_number="01.10",
            section_title="Section", text="Hydraulic pump overheat.",
            title_key=search.word_key("01.10.2 Hydraulic System A"),
            text_key=search.word_key("Hydraulic pump overheat."),
        )
        document = search.IndexedDocument(**{**document.__dict__, "entries": document.entries + (warning,)})
        result = search.search("hydraulic", [document], content_types={"warnings"})
        self.assertEqual([(r["nodeId"], r["nodeType"]) for r in result["results"]], [("x-p4", "caution")])
        self.assertEqual(search.search("engine", [document], content_types={"procedures"})["total"], 0)
        # The topic title says "System A", but the caution's own text does not.
        self.assertEqual(search.search("system", [document], content_types={"warnings"})["total"], 0)

    def test_snippet_is_the_matching_sentence(self):
        for text, terms, expected in SNIPPET_CASES:
            with self.subTest(text=text[:20]):
                self.assertEqual(search.snippet(text, terms), expected)

    def test_snippet_starts_near_the_first_match(self):
        text = " ".join(["filler"] * 40) + " the transponder is tested here " + " ".join(["tail"] * 60)
        excerpt = search.snippet(text, ["transponder"])
        self.assertTrue(excerpt.startswith("… "))
        self.assertTrue(excerpt.endswith(" …"))
        self.assertIn("transponder", excerpt)


class SearchApiTests(ApiAssertionsMixin, APITestCase):
    @classmethod
    def setUpTestData(cls):
        for name in ("FM-S100_Rev2.xml", "FM-S100_Rev3.xml", "FOM_Rev12.xml"):
            result = ingest_xml(PROJECT_ROOT / "sample-data" / "xml" / name)
            if not result.success:
                raise AssertionError(result.message)

    def setUp(self):
        today = fixed_today()
        today.start()
        self.addCleanup(today.stop)

    def test_search_returns_current_revision_results(self):
        body = self.assert_json(self.client.get("/api/search/?q=transponder+test"))
        self.assertGreater(body["total"], 0)
        first = body["results"][0]
        self.assertEqual(first["title"], "Transponder Test")
        # Rev 3 is upcoming on the fixed date, so only Rev 2 is searched.
        self.assertEqual({r["revision"] for r in body["results"] if r["docId"] == "FM-S100"}, {2})
        self.assertEqual({d["docId"] for d in body["documents"]}, {"FM-S100", "FOM"})

    def test_filters(self):
        body = self.assert_json(self.client.get("/api/search/?q=engine&docType=FOM"))
        self.assertEqual(set(body["byDocument"]), {"FOM"})
        body = self.assert_json(self.client.get("/api/search/?q=engine&category=fleet"))
        self.assertEqual(set(body["byDocument"]), {"FM-S100"})

    def test_invalid_requests(self):
        for url in (
            "/api/search/?q=",
            "/api/search/?q=---",
            f"/api/search/?q={'a' * 201}",
            "/api/search/?q=engine&limit=0",
            "/api/search/?q=engine&fleet=A&fleet=B",
            "/api/search/?q=engine&contentType=diagrams",
        ):
            with self.subTest(url=url[:40]):
                self.assert_error(self.client.get(url), 400, "INVALID_REQUEST")

    def test_index_groups_entries_by_topic(self):
        body = self.assert_json(self.client.get("/api/search/index/?docId=FM-S100"))
        [document] = body["documents"]
        self.assertEqual((document["docId"], document["revision"]), ("FM-S100", 2))
        self.assertEqual(len(document["topics"]), 1193)
        node_id, node_type, text = document["topics"][0]["blocks"][0]
        self.assertTrue(node_id.startswith("fm100-p"))
        self.assertTrue(text)
