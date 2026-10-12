from collections import Counter
from copy import deepcopy
from datetime import date
from importlib import import_module
import inspect
from io import StringIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from django.apps import apps as django_apps
from django.test import TestCase
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import (
    DatabaseError,
    IntegrityError,
    connection,
    migrations,
    transaction,
)
from lxml import etree
from rest_framework.test import APITestCase

from documents import ingestion
from documents.ingestion import (
    DocumentTreeIntegrityError,
    get_normalized_document,
    ingest_xml,
    validate_version_tree,
)
from documents.models import ContentAnchor, Document, DocumentNode, DocumentVersion
from documents.xml_hierarchy import extract_hierarchy
from documents.xml_metadata import extract_metadata
from documents.xml_normalization import assemble_normalized_document
from documents.xml_content import (
    SkippedContentBlock,
    SUPPORTED_BLOCK_TYPES,
    XML_NAMESPACE,
    extract_all_topic_content,
    extract_topic_content,
)
from documents.xml_validation import (
    DEFAULT_XML_PATH,
    ValidationResult,
    XmlValidationIssue,
    secure_xml_parser,
    validate_xml,
)


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


class HierarchyExtractionTests(TestCase):
    def test_real_fm_s100_revision_2_hierarchy_counts(self):
        result = extract_hierarchy()

        self.assertTrue(result.is_valid, result.errors)
        counts = Counter(node["nodeType"] for node in result.nodes)
        self.assertEqual(counts, {"chapter": 19, "section": 71, "topic": 1193})

    def test_sample_topics_preserve_source_ids_and_parents(self):
        result = extract_hierarchy()
        self.assertTrue(result.is_valid, result.errors)
        nodes_by_id = {node["id"]: node for node in result.nodes}

        self.assertEqual(nodes_by_id["fm100-t1193"]["parentId"], "fm100-s001")
        self.assertEqual(nodes_by_id["fm100-t0340"]["parentId"], "fm100-s019")
        self.assertEqual(nodes_by_id["fm100-t0097"]["parentId"], "fm100-s008")
        self.assertEqual(nodes_by_id["fm100-t1193"]["title"], "New Sample Topic: Engine Anti-Ice")
        self.assertEqual(nodes_by_id["fm100-t0340"]["title"], "Autothrottle Crew Awareness")
        self.assertEqual(nodes_by_id["fm100-t0097"]["title"], "Briefing: Fuel Crossfeed")

    def test_ids_are_unique_and_parent_types_are_correct(self):
        result = extract_hierarchy()
        self.assertTrue(result.is_valid, result.errors)
        nodes_by_id = {node["id"]: node for node in result.nodes}

        self.assertEqual(len(nodes_by_id), len(result.nodes))
        for node in result.nodes:
            self.assertEqual(
                set(node),
                {"id", "nodeType", "number", "title", "parentId", "sequence"},
            )
            if node["nodeType"] == "chapter":
                self.assertIsNone(node["parentId"])
            elif node["nodeType"] == "section":
                self.assertEqual(
                    nodes_by_id[node["parentId"]]["nodeType"],
                    "chapter",
                )
            else:
                self.assertEqual(
                    nodes_by_id[node["parentId"]]["nodeType"],
                    "section",
                )

    def test_flat_nodes_preserve_document_order_and_sibling_sequence(self):
        result = extract_hierarchy()

        self.assertTrue(result.is_valid, result.errors)
        self.assertEqual(
            [node["id"] for node in result.nodes[:6]],
            [
                "fm100-c01",
                "fm100-s001",
                "fm100-t1193",
                "fm100-t0001",
                "fm100-t0002",
                "fm100-t0003",
            ],
        )
        nodes_by_id = {node["id"]: node for node in result.nodes}
        self.assertEqual(nodes_by_id["fm100-c01"]["sequence"], 1)
        self.assertEqual(nodes_by_id["fm100-s001"]["sequence"], 1)
        self.assertEqual(nodes_by_id["fm100-t1193"]["sequence"], 1)
        self.assertEqual(nodes_by_id["fm100-t0340"]["sequence"], 16)

    def test_nested_navigation_has_contract_shape_and_matching_counts(self):
        result = extract_hierarchy()

        self.assertTrue(result.is_valid, result.errors)
        self.assertEqual(len(result.navigation), 19)
        section_count = sum(len(chapter["sections"]) for chapter in result.navigation)
        topic_count = sum(
            len(section["topics"])
            for chapter in result.navigation
            for section in chapter["sections"]
        )
        self.assertEqual(section_count, 71)
        self.assertEqual(topic_count, 1193)
        self.assertEqual(
            set(result.navigation[0]),
            {"id", "number", "title", "sections"},
        )
        self.assertEqual(
            set(result.navigation[0]["sections"][0]),
            {"id", "number", "title", "topics"},
        )
        self.assertEqual(
            set(result.navigation[0]["sections"][0]["topics"][0]),
            {"id", "number", "title"},
        )

    def test_schema_invalid_xml_returns_validation_issues_without_nodes(self):
        invalid_xml = (
            '<manual xmlns="urn:sample:fltpub:1.0" '
            'id="FM-SAMPLE" docType="FM"><unexpected /></manual>'
        )
        with TemporaryDirectory() as temporary_directory:
            xml_path = Path(temporary_directory) / "invalid.xml"
            xml_path.write_text(invalid_xml, encoding="utf-8")

            result = extract_hierarchy(xml_path=xml_path)

        self.assertFalse(result.is_valid)
        self.assertEqual(result.nodes, [])
        self.assertEqual(result.navigation, [])
        self.assertTrue(result.errors)

    def test_missing_xml_returns_structured_validation_issue(self):
        with TemporaryDirectory() as temporary_directory:
            result = extract_hierarchy(
                xml_path=Path(temporary_directory) / "missing.xml",
            )

        self.assertFalse(result.is_valid)
        self.assertEqual(result.nodes, [])
        self.assertEqual(result.navigation, [])
        self.assertTrue(result.errors)
        self.assertIn("Unable to read XML file", result.errors[0].message)

    def test_validation_failure_prevents_xml_parsing(self):
        issue = XmlValidationIssue(
            line=1,
            column=1,
            message="Fixture validation failure.",
        )
        with (
            patch(
                "documents.xml_hierarchy.validate_xml",
                return_value=ValidationResult(is_valid=False, errors=[issue]),
            ),
            patch("documents.xml_hierarchy.secure_xml_parser") as parser,
        ):
            result = extract_hierarchy(xml_path="/missing/should-not-be-parsed.xml")

        self.assertFalse(result.is_valid)
        self.assertEqual(result.errors, [issue])
        parser.assert_not_called()


class XMLContentExtractionTests(TestCase):
    def _real_xml_root(self):
        return etree.parse(
            str(DEFAULT_XML_PATH),
            parser=secure_xml_parser(),
        ).getroot()

    def test_real_content_counts_match_independent_lxml_counts(self):
        result = extract_all_topic_content()

        self.assertTrue(result.is_valid, result.errors)
        root = self._real_xml_root()
        raw_counts = Counter(
            etree.QName(element).localname
            for element in root.iter()
            if isinstance(element.tag, str)
            and element.getparent() is not None
            and element.getparent().tag == f"{{{XML_NAMESPACE}}}topic"
            and etree.QName(element).localname != "title"
        )
        extracted_counts = Counter(
            block["type"]
            for topic in result.topics
            for block in topic["blocks"]
        )
        for block_type in SUPPORTED_BLOCK_TYPES:
            self.assertEqual(extracted_counts[block_type], raw_counts[block_type])
        self.assertEqual(raw_counts["warning"], 0)
        self.assertEqual(raw_counts["melItem"], 0)
        self.assertEqual(result.skipped_blocks, [])
        self.assertEqual(len(result.topics), 1193)

    def test_real_topic_block_order_and_source_ids_are_preserved(self):
        result = extract_topic_content("fm100-t0340")

        self.assertTrue(result.is_valid, result.errors)
        self.assertIsNotNone(result.topic)
        topic = result.topic
        self.assertEqual(topic["id"], "fm100-t0340")
        self.assertEqual(topic["sectionId"], "fm100-s019")
        self.assertEqual(
            [(block["type"], block["id"]) for block in topic["blocks"]],
            [
                ("para", "fm100-p03214"),
                ("note", "fm100-p03215"),
                ("list", "fm100-p03216"),
                ("caution", "fm100-p03217"),
                ("note", "fm100-p03218"),
                ("checklist", "fm100-p03231"),
            ],
        )
        self.assertEqual(
            topic["blocks"][2]["items"],
            [
                "If the Flight Management Computer is inoperative, continue takeoff only after both pilots has reviewed the associated sample guidance.",
                "During preflight, the Captain should record the Cockpit Voice Recorder quantity display if the indication does not stabilize within the sample interval.",
                "During taxi, the pilot flying should confirm the Probe Heat advisory when conditions permit.",
            ],
        )

    def test_checklist_preserves_permanent_check_ids_and_order(self):
        result = extract_topic_content("fm100-t0340")
        self.assertTrue(result.is_valid, result.errors)
        checklist = result.topic["blocks"][-1]

        self.assertEqual(checklist["id"], "fm100-p03231")
        self.assertEqual(
            [check["id"] for check in checklist["checks"]],
            [f"fm100-p{number:05d}" for number in range(3219, 3231)],
        )
        self.assertEqual(
            checklist["checks"][0],
            {
                "id": "fm100-p03219",
                "challenge": "Autothrottle",
                "response": "Checked",
            },
        )

    def test_real_table_retains_rows_cells_and_explicit_header_flags(self):
        result = extract_topic_content("fm100-t1086")
        self.assertTrue(result.is_valid, result.errors)
        table = next(
            block
            for block in result.topic["blocks"]
            if block["id"] == "fm100-p09258"
        )

        self.assertEqual(table["type"], "table")
        self.assertEqual(len(table["rows"]), 4)
        self.assertIs(table["rows"][0]["header"], True)
        self.assertNotIn("header", table["rows"][1])
        self.assertEqual(set(table["rows"][0]), {"header", "cells"})
        self.assertEqual(set(table["rows"][1]), {"cells"})
        self.assertTrue(all(row["cells"] for row in table["rows"]))
        self.assertTrue(
            all(isinstance(cell, str) for row in table["rows"] for cell in row["cells"])
        )

    def test_mixed_text_and_xref_segments_match_raw_xml_exactly(self):
        result = extract_topic_content("fm100-t0340")
        self.assertTrue(result.is_valid, result.errors)
        paragraph = result.topic["blocks"][0]
        root = self._real_xml_root()
        raw_paragraph = root.xpath(
            ".//flt:para[@id='fm100-p03214']",
            namespaces={"flt": XML_NAMESPACE},
        )[0]
        expected_segments = []
        if raw_paragraph.text is not None:
            expected_segments.append({"type": "text", "text": raw_paragraph.text})
        for child in raw_paragraph:
            if child.tag == f"{{{XML_NAMESPACE}}}xref":
                expected_segments.append(
                    {
                        "type": "xref",
                        "targetId": child.get("target"),
                        "text": child.text or "",
                    }
                )
                if child.tail is not None:
                    expected_segments.append({"type": "text", "text": child.tail})

        self.assertEqual(paragraph["segments"], expected_segments)
        self.assertTrue(
            any(
                segment["type"] == "text" and segment["text"].endswith("See ")
                for segment in paragraph["segments"]
            )
        )
        self.assertEqual(paragraph["segments"][-1], {"type": "text", "text": "."})

    def test_all_real_xref_targets_resolve_and_emitted_ids_exist_and_are_unique(self):
        result = extract_all_topic_content()
        self.assertTrue(result.is_valid, result.errors)
        root = self._real_xml_root()
        document_ids = {
            element.get("id")
            for element in root.iter()
            if isinstance(element.tag, str) and element.get("id") is not None
        }
        emitted_ids = []
        for topic in result.topics:
            for block in topic["blocks"]:
                emitted_ids.append(block["id"])
                if block["type"] == "checklist":
                    emitted_ids.extend(check["id"] for check in block["checks"])
                if block["type"] in {"para", "note", "caution", "warning"}:
                    for segment in block["segments"]:
                        if segment["type"] == "xref":
                            self.assertIn(segment["targetId"], document_ids)

        self.assertEqual(len(emitted_ids), len(set(emitted_ids)))
        self.assertTrue(set(emitted_ids).issubset(document_ids))

    def test_warning_fixture_is_xsd_valid_and_extracted(self):
        warning_manual = MINIMAL_VALID_MANUAL.replace(
            '<para id="sample-p1">Sample paragraph.</para>',
            '<warning id="sample-p2">  Warning text.  </warning>',
        )
        with TemporaryDirectory() as temporary_directory:
            xml_path = Path(temporary_directory) / "warning.xml"
            xml_path.write_text(warning_manual, encoding="utf-8")
            self.assertTrue(validate_xml(xml_path=xml_path).is_valid)

            result = extract_topic_content("sample-t1", xml_path=xml_path)

        self.assertTrue(result.is_valid, result.errors)
        self.assertEqual(
            result.topic["blocks"],
            [
                {
                    "type": "warning",
                    "id": "sample-p2",
                    "segments": [{"type": "text", "text": "  Warning text.  "}],
                }
            ],
        )

    def test_xsd_valid_mel_item_is_reported_as_skipped_with_topic_id(self):
        mel_manual = MINIMAL_VALID_MANUAL.replace(
            '<para id="sample-p1">Sample paragraph.</para>',
            '<melItem id="sample-p2" category="A"><remarks>Not in contract</remarks></melItem>',
        )
        with TemporaryDirectory() as temporary_directory:
            xml_path = Path(temporary_directory) / "mel-item.xml"
            xml_path.write_text(mel_manual, encoding="utf-8")
            self.assertTrue(validate_xml(xml_path=xml_path).is_valid)

            result = extract_all_topic_content(xml_path=xml_path)

        self.assertTrue(result.is_valid, result.errors)
        self.assertEqual(
            result.skipped_blocks,
            [SkippedContentBlock(type="melItem", id="sample-p2", topic_id="sample-t1")],
        )
        self.assertEqual(result.topics[0]["blocks"], [])

    def test_unresolved_xref_returns_structured_issue(self):
        unresolved_manual = MINIMAL_VALID_MANUAL.replace(
            '<para id="sample-p1">Sample paragraph.</para>',
            '<para id="sample-p1">See <xref target="missing-t9">missing topic</xref>.</para>',
        )
        with TemporaryDirectory() as temporary_directory:
            xml_path = Path(temporary_directory) / "unresolved-xref.xml"
            xml_path.write_text(unresolved_manual, encoding="utf-8")
            self.assertTrue(validate_xml(xml_path=xml_path).is_valid)

            result = extract_all_topic_content(xml_path=xml_path)

        self.assertFalse(result.is_valid)
        self.assertTrue(
            any("references unknown ID 'missing-t9'" in error.message for error in result.errors)
        )

    def test_invalid_input_returns_structured_validation_errors(self):
        invalid_manual = (
            '<manual xmlns="urn:sample:fltpub:1.0" '
            'id="FM-SAMPLE" docType="FM"><unexpected /></manual>'
        )
        with TemporaryDirectory() as temporary_directory:
            xml_path = Path(temporary_directory) / "invalid.xml"
            xml_path.write_text(invalid_manual, encoding="utf-8")

            result = extract_all_topic_content(xml_path=xml_path)

        self.assertFalse(result.is_valid)
        self.assertEqual(result.topics, [])
        self.assertTrue(result.errors)
        self.assertTrue(all(error.message for error in result.errors))

    def test_validation_failure_prevents_extraction_parsing(self):
        issue = XmlValidationIssue(
            line=1,
            column=1,
            message="Fixture validation failure.",
        )
        with (
            patch(
                "documents.xml_content.validate_xml",
                return_value=ValidationResult(is_valid=False, errors=[issue]),
            ),
            patch("documents.xml_content.secure_xml_parser") as parser,
        ):
            result = extract_all_topic_content(xml_path="/missing/should-not-parse.xml")

        self.assertFalse(result.is_valid)
        self.assertEqual(result.errors, [issue])
        parser.assert_not_called()

    def test_unknown_topic_returns_a_structured_issue(self):
        result = extract_topic_content("not-a-topic")

        self.assertFalse(result.is_valid)
        self.assertIsNone(result.topic)
        self.assertIn("was not found", result.errors[0].message)


class XMLNormalizationTests(TestCase):
    def test_real_normalized_document_counts_and_topic_id_join(self):
        result = assemble_normalized_document()

        self.assertIsNotNone(result["payload"])
        self.assertTrue(result["ingestionReport"]["is_valid"])
        payload = result["payload"]
        chapters = payload["chapters"]
        topic_ids = [
            topic["id"]
            for chapter in chapters
            for section in chapter["sections"]
            for topic in section["topics"]
        ]
        topic_content = payload["topicContentById"]

        self.assertEqual(len(chapters), 19)
        self.assertEqual(
            sum(len(chapter["sections"]) for chapter in chapters),
            71,
        )
        self.assertEqual(len(topic_ids), 1193)
        self.assertEqual(len(set(topic_ids)), 1193)
        self.assertEqual(len(topic_content), 1193)
        self.assertEqual(set(topic_ids), set(topic_content))
        self.assertTrue(
            all(topic_id == topic["id"] for topic_id, topic in topic_content.items())
        )

    def test_real_payload_matches_provisional_topic_and_table_examples(self):
        result = assemble_normalized_document()
        self.assertIsNotNone(result["payload"])
        payload = result["payload"]
        contract_path = Path(__file__).resolve().parents[2] / "contracts" / "provisional-sample.json"
        contract = json.loads(contract_path.read_text(encoding="utf-8"))
        topic_example = contract["topicContentExample"]["topic"]
        topic_id = topic_example["id"]

        self.assertEqual(payload["topicContentById"][topic_id], topic_example)
        table_example = contract["tableExample"]
        table_topic = payload["topicContentById"][table_example["sourceTopic"]["topicId"]]
        table_block = next(
            block
            for block in table_topic["blocks"]
            if block["id"] == table_example["block"]["id"]
        )
        self.assertEqual(table_block, table_example["block"])

    def test_output_is_json_serializable_and_round_trips(self):
        result = assemble_normalized_document()
        encoded = json.dumps(result, ensure_ascii=False)
        decoded = json.loads(encoded)

        self.assertEqual(decoded, result)

    def test_repeated_assembly_is_deterministic(self):
        first = assemble_normalized_document()
        second = assemble_normalized_document()

        self.assertEqual(first, second)

    def test_document_identity_and_metadata_follow_contract_types(self):
        result = assemble_normalized_document()
        self.assertIsNotNone(result["payload"])
        payload = result["payload"]
        self.assertEqual(
            payload["document"],
            {
                "id": "FM-S100",
                "namespace": XML_NAMESPACE,
                "docType": "FM",
            },
        )
        self.assertEqual(payload["version"]["revision"], 2)
        metadata = payload["version"]["metadata"]
        self.assertEqual(metadata["docId"], "FM-S100")
        self.assertEqual(metadata["revision"], 2)
        self.assertIsInstance(metadata["revision"], int)
        self.assertEqual(metadata["revisionDate"], "2026-07-01")
        self.assertEqual(metadata["effectiveDate"], "2026-07-15")

    def test_emitted_permanent_ids_are_source_ids_and_unique(self):
        result = assemble_normalized_document()
        self.assertIsNotNone(result["payload"])
        topic_content = result["payload"]["topicContentById"]
        emitted_ids = list(topic_content)
        for topic in topic_content.values():
            emitted_ids.extend(block["id"] for block in topic["blocks"])
            for block in topic["blocks"]:
                if block["type"] == "checklist":
                    emitted_ids.extend(check["id"] for check in block["checks"])

        root = etree.parse(
            str(DEFAULT_XML_PATH),
            parser=secure_xml_parser(),
        ).getroot()
        source_ids = {
            element.get("id")
            for element in root.iter()
            if isinstance(element.tag, str) and element.get("id") is not None
        }
        self.assertEqual(len(emitted_ids), len(set(emitted_ids)))
        self.assertTrue(set(emitted_ids).issubset(source_ids))

    def test_schema_invalid_and_missing_xml_return_structured_failure(self):
        with TemporaryDirectory() as temporary_directory:
            invalid_path = Path(temporary_directory) / "invalid.xml"
            invalid_path.write_text(
                '<manual xmlns="urn:sample:fltpub:1.0" id="bad" docType="FM">'
                "<unexpected /></manual>",
                encoding="utf-8",
            )
            invalid = assemble_normalized_document(xml_path=invalid_path)
            missing = assemble_normalized_document(
                xml_path=Path(temporary_directory) / "missing.xml"
            )

        for result in (invalid, missing):
            self.assertIsNone(result["payload"])
            self.assertFalse(result["ingestionReport"]["is_valid"])
            self.assertTrue(result["ingestionReport"]["errors"])
            self.assertTrue(
                all(
                    set(issue) == {"line", "column", "message"}
                    for issue in result["ingestionReport"]["errors"]
                )
            )

    def test_unresolved_xrefs_stay_in_report_and_preserve_payload(self):
        unresolved_manual = MINIMAL_VALID_MANUAL.replace(
            '<para id="sample-p1">Sample paragraph.</para>',
            '<para id="sample-p1">See <xref target="missing-t9">missing topic</xref>.</para>',
        )
        with TemporaryDirectory() as temporary_directory:
            xml_path = Path(temporary_directory) / "unresolved-xref.xml"
            xml_path.write_text(unresolved_manual, encoding="utf-8")
            self.assertTrue(validate_xml(xml_path=xml_path).is_valid)

            result = assemble_normalized_document(xml_path=xml_path)

        self.assertIsNotNone(result["payload"])
        report = result["ingestionReport"]
        self.assertFalse(report["is_valid"])
        self.assertEqual(len(report["unresolvedXrefs"]), 1)
        self.assertIn("missing-t9", report["unresolvedXrefs"][0]["message"])
        self.assertEqual(
            result["payload"]["topicContentById"]["sample-t1"]["blocks"][0]["segments"][1][
                "targetId"
            ],
            "missing-t9",
        )

    def test_skipped_blocks_are_reported_separately_from_payload(self):
        mel_manual = MINIMAL_VALID_MANUAL.replace(
            '<para id="sample-p1">Sample paragraph.</para>',
            '<melItem id="sample-p2" category="A"><remarks>Not in contract</remarks></melItem>',
        )
        with TemporaryDirectory() as temporary_directory:
            xml_path = Path(temporary_directory) / "mel-item.xml"
            xml_path.write_text(mel_manual, encoding="utf-8")
            self.assertTrue(validate_xml(xml_path=xml_path).is_valid)

            result = assemble_normalized_document(xml_path=xml_path)

        self.assertIsNotNone(result["payload"])
        self.assertEqual(
            result["ingestionReport"]["skippedBlocks"],
            [{"type": "melItem", "id": "sample-p2", "topicId": "sample-t1"}],
        )
        self.assertNotIn(
            "skippedBlocks",
            result["payload"],
        )


class DatabaseIngestionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.normalized = assemble_normalized_document()
        with patch(
            "documents.ingestion.assemble_normalized_document",
            return_value=cls.normalized,
        ):
            cls.ingestion = ingest_xml(DEFAULT_XML_PATH)
        if not cls.ingestion.success:
            raise AssertionError(cls.ingestion.message)
        cls.document = Document.objects.get(pk="FM-S100")
        cls.version = DocumentVersion.objects.get(
            document=cls.document,
            revision=2,
        )

    def test_real_sample_database_counts_and_success_report(self):
        self.assertEqual(Document.objects.count(), 1)
        self.assertEqual(DocumentVersion.objects.count(), 1)
        self.assertEqual(
            DocumentNode.objects.filter(
                version=self.version,
                node_type=DocumentNode.NodeType.CHAPTER,
            ).count(),
            19,
        )
        self.assertEqual(
            DocumentNode.objects.filter(
                version=self.version,
                node_type=DocumentNode.NodeType.SECTION,
            ).count(),
            71,
        )
        self.assertEqual(
            DocumentNode.objects.filter(
                version=self.version,
                node_type=DocumentNode.NodeType.TOPIC,
            ).count(),
            1193,
        )
        self.assertEqual(
            DocumentNode.objects.filter(version=self.version).count(),
            1283,
        )
        self.assertTrue(self.ingestion.success)
        self.assertEqual(self.ingestion.errors, [])
        self.assertGreaterEqual(self.ingestion.elapsed_seconds, 0)
        self.assertEqual(self.ingestion.skipped_blocks, [])
        self.assertEqual(self.ingestion.unresolved_xrefs, [])

    def test_sample_topic_parent_relationships_and_chapter_roots(self):
        expected_parents = {
            "fm100-t1193": "fm100-s001",
            "fm100-t0340": "fm100-s019",
            "fm100-t0097": "fm100-s008",
        }
        for topic_id, section_id in expected_parents.items():
            topic = DocumentNode.objects.get(
                version=self.version,
                node_id=topic_id,
            )
            self.assertEqual(topic.parent.node_id, section_id)
        self.assertFalse(
            DocumentNode.objects.filter(
                version=self.version,
                node_type=DocumentNode.NodeType.CHAPTER,
            )
            .exclude(parent=None)
            .exists()
        )

    def test_topic_blocks_equal_step_5e_and_other_nodes_have_null_blocks(self):
        for topic_id in ("fm100-t0340", "fm100-t1086"):
            node = DocumentNode.objects.get(
                version=self.version,
                node_id=topic_id,
            )
            self.assertEqual(
                node.content_blocks,
                self.normalized["payload"]["topicContentById"][topic_id]["blocks"],
            )
        self.assertFalse(
            DocumentNode.objects.filter(
                version=self.version,
                node_type__in=(
                    DocumentNode.NodeType.CHAPTER,
                    DocumentNode.NodeType.SECTION,
                ),
            )
            .exclude(content_blocks=None)
            .exists()
        )

    def test_permanent_ids_and_all_topics_are_retrievable_by_version(self):
        topic_nodes = DocumentNode.objects.filter(
            version=self.version,
            node_type=DocumentNode.NodeType.TOPIC,
        )
        self.assertEqual(topic_nodes.count(), 1193)
        self.assertEqual(
            set(topic_nodes.values_list("node_id", flat=True)),
            set(self.normalized["payload"]["topicContentById"]),
        )
        checklist = next(
            block
            for block in self.normalized["payload"]["topicContentById"][
                "fm100-t0340"
            ]["blocks"]
            if block["type"] == "checklist"
        )
        self.assertEqual(
            [check["id"] for check in checklist["checks"]],
            [f"fm100-p{number:05d}" for number in range(3219, 3231)],
        )

    def test_position_and_sibling_sequences_follow_xml_source_order(self):
        source_order: list[str] = []
        for chapter in self.normalized["payload"]["chapters"]:
            source_order.append(chapter["id"])
            for section in chapter["sections"]:
                source_order.append(section["id"])
                source_order.extend(topic["id"] for topic in section["topics"])
        stored_order = list(
            DocumentNode.objects.filter(version=self.version)
            .order_by("position")
            .values_list("node_id", flat=True)
        )
        self.assertEqual(stored_order, source_order)
        self.assertEqual(
            list(
                DocumentNode.objects.filter(
                    version=self.version,
                    node_type=DocumentNode.NodeType.CHAPTER,
                )
                .order_by("sequence")
                .values_list("sequence", flat=True)
            ),
            list(range(1, 20)),
        )
        for chapter_outline in self.normalized["payload"]["chapters"]:
            chapter = DocumentNode.objects.get(
                version=self.version,
                node_id=chapter_outline["id"],
            )
            sections = list(
                chapter.children.order_by("sequence").values_list(
                    "node_id",
                    flat=True,
                )
            )
            self.assertEqual(
                sections,
                [section["id"] for section in chapter_outline["sections"]],
            )
            self.assertEqual(
                list(
                    chapter.children.order_by("sequence").values_list(
                        "sequence",
                        flat=True,
                    )
                ),
                list(range(1, len(sections) + 1)),
            )
            for section_outline in chapter_outline["sections"]:
                section = DocumentNode.objects.get(
                    version=self.version,
                    node_id=section_outline["id"],
                )
                topics = list(
                    section.children.order_by("sequence").values_list(
                        "node_id",
                        flat=True,
                    )
                )
                self.assertEqual(
                    topics,
                    [topic["id"] for topic in section_outline["topics"]],
                )
                self.assertEqual(
                    list(
                        section.children.order_by("sequence").values_list(
                            "sequence",
                            flat=True,
                        )
                    ),
                    list(range(1, len(topics) + 1)),
                )

    def test_database_retrieval_reconstructs_normalized_payload_without_xml(self):
        with patch(
            "documents.xml_validation.etree.parse",
            side_effect=AssertionError("XML parsing should not be needed"),
        ):
            stored_payload = get_normalized_document("FM-S100", 2)

        self.assertEqual(stored_payload, self.normalized["payload"])
        self.assertIsNone(get_normalized_document("FM-S100", 999))

    def test_duplicate_document_revision_is_refused_without_replacement(self):
        with patch(
            "documents.ingestion.assemble_normalized_document",
            return_value=self.normalized,
        ):
            result = ingest_xml(DEFAULT_XML_PATH)

        self.assertFalse(result.success)
        self.assertTrue(result.duplicate)
        self.assertEqual(DocumentVersion.objects.count(), 1)
        self.assertEqual(DocumentNode.objects.filter(version=self.version).count(), 1283)

    def test_replace_keeps_version_pk_and_does_not_touch_other_revisions(self):
        other_version = DocumentVersion.objects.create(
            document=self.document,
            revision=3,
            revision_date=self.version.revision_date,
            effective_date=self.version.effective_date,
            metadata=self.version.metadata,
            source_filename="other.xml",
        )
        other_node = DocumentNode.objects.create(
            version=other_version,
            node_id="fm100-c01",
            node_type=DocumentNode.NodeType.CHAPTER,
            number="01",
            title="Other revision",
            sequence=1,
            position=1,
        )
        version_pk = self.version.pk
        DocumentNode.objects.filter(
            version=self.version,
            node_id="fm100-s019",
        ).update(title="Temporary replacement marker")

        with patch(
            "documents.ingestion.assemble_normalized_document",
            return_value=self.normalized,
        ):
            result = ingest_xml(DEFAULT_XML_PATH, replace=True)

        self.assertTrue(result.success, result.message)
        self.version.refresh_from_db()
        self.assertEqual(self.version.pk, version_pk)
        self.assertEqual(
            DocumentNode.objects.get(
                version=self.version,
                node_id="fm100-s019",
            ).title,
            "Air Systems",
        )
        self.assertEqual(other_node.version_id, other_version.pk)
        self.assertEqual(other_version.nodes.count(), 1)
        self.assertEqual(
            other_version.nodes.get(node_id="fm100-c01").title,
            "Other revision",
        )

    def test_database_constraints_and_node_ids_are_version_scoped(self):
        duplicate_node = DocumentNode.objects.get(
            version=self.version,
            node_id="fm100-c01",
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            DocumentNode.objects.create(
                version=self.version,
                node_id=duplicate_node.node_id,
                node_type=duplicate_node.node_type,
                number="99",
                title="Duplicate",
                sequence=999,
                position=999,
            )

        with self.assertRaises(IntegrityError), transaction.atomic():
            DocumentVersion.objects.create(
                document=self.document,
                revision=self.version.revision,
                revision_date=self.version.revision_date,
                effective_date=self.version.effective_date,
                metadata=self.version.metadata,
                source_filename="duplicate.xml",
            )

        with self.assertRaises(IntegrityError), transaction.atomic():
            Document.objects.create(
                id=self.document.id,
                title="Duplicate document",
                doc_type=self.document.doc_type,
                namespace=self.document.namespace,
            )

        root_chapter = DocumentNode.objects.filter(
            version=self.version,
            node_type=DocumentNode.NodeType.CHAPTER,
        ).order_by("position").first()
        self.assertIsNotNone(root_chapter)
        with self.assertRaises(IntegrityError), transaction.atomic():
            DocumentNode.objects.create(
                version=self.version,
                node_id="duplicate-root-sequence",
                node_type=DocumentNode.NodeType.CHAPTER,
                number="99",
                title="Duplicate root sequence",
                sequence=root_chapter.sequence,
                position=9999,
            )

        other_version = DocumentVersion.objects.create(
            document=self.document,
            revision=3,
            revision_date=self.version.revision_date,
            effective_date=self.version.effective_date,
            metadata=self.version.metadata,
            source_filename="other.xml",
        )
        same_node_id = DocumentNode.objects.create(
            version=other_version,
            node_id=duplicate_node.node_id,
            node_type=duplicate_node.node_type,
            number=duplicate_node.number,
            title="Same source ID in another revision",
            sequence=1,
            position=1,
        )
        self.assertEqual(same_node_id.node_id, duplicate_node.node_id)

    def test_ingestion_rejects_unresolved_xrefs_and_reports_skipped_counts(self):
        fixture_result = deepcopy(self.normalized)
        unresolved_xref = {
            "line": 42,
            "column": 13,
            "message": "xref references unknown ID 'sample-t9'",
        }
        fixture_result["ingestionReport"]["errors"] = [unresolved_xref]
        fixture_result["ingestionReport"]["unresolvedXrefs"] = [unresolved_xref]
        fixture_result["ingestionReport"]["skippedBlocks"] = [
            {"type": "melItem", "id": "sample-m1", "topicId": "fm100-t0340"},
            {"type": "melItem", "id": "sample-m2", "topicId": "fm100-t0340"},
            {"type": "other", "id": "sample-o1", "topicId": "fm100-t0340"},
        ]
        with patch(
            "documents.ingestion.assemble_normalized_document",
            return_value=fixture_result,
        ):
            result = ingest_xml(DEFAULT_XML_PATH, replace=True)

        self.assertFalse(result.success)
        self.assertIn("unresolved cross-references", result.message)
        self.assertEqual(result.errors, [unresolved_xref])
        self.assertEqual(result.unresolved_xrefs, [unresolved_xref])
        self.assertEqual(result.skipped_block_counts, {"melItem": 2, "other": 1})
        self.assertEqual(len(result.skipped_blocks), 3)
        self.assertEqual(
            DocumentNode.objects.filter(version=self.version).count(),
            1283,
        )

    def test_real_sample_writes_one_anchor_per_block_and_check(self):
        anchors = ContentAnchor.objects.filter(version=self.version)
        expected = set()
        for topic_id, topic in self.normalized["payload"][
            "topicContentById"
        ].items():
            for block in topic["blocks"]:
                expected.add((block["id"], block["type"], topic_id))
                for check in block.get("checks", []):
                    expected.add((check["id"], "check", topic_id))

        self.assertEqual(anchors.count(), 10041)
        self.assertEqual(
            dict(Counter(anchors.values_list("anchor_type", flat=True))),
            {
                "para": 4289,
                "note": 1032,
                "caution": 1031,
                "list": 1045,
                "table": 1011,
                "checklist": 159,
                "check": 1474,
            },
        )
        self.assertEqual(anchors.exclude(anchor_type="check").count(), 8567)
        self.assertEqual(
            set(anchors.values_list("anchor_id", "anchor_type", "topic__node_id")),
            expected,
        )
        self.assertFalse(
            anchors.exclude(
                topic__version=self.version,
                topic__node_type=DocumentNode.NodeType.TOPIC,
            ).exists()
        )
        self.assertFalse(
            DocumentNode.objects.filter(
                version=self.version,
                node_id__in=anchors.values("anchor_id"),
            ).exists()
        )

    def test_replace_rebuilds_anchors_and_leaves_none_stale(self):
        topic = DocumentNode.objects.get(
            version=self.version,
            node_id="fm100-t0340",
        )
        ContentAnchor.objects.create(
            version=self.version,
            topic=topic,
            anchor_id="stale-anchor",
            anchor_type=ContentAnchor.AnchorType.PARA,
        )
        old_anchor_pks = set(
            ContentAnchor.objects.filter(version=self.version).values_list(
                "pk",
                flat=True,
            )
        )
        self.assertEqual(len(old_anchor_pks), 10042)

        with patch(
            "documents.ingestion.assemble_normalized_document",
            return_value=self.normalized,
        ):
            result = ingest_xml(DEFAULT_XML_PATH, replace=True)

        self.assertTrue(result.success, result.message)
        anchors = ContentAnchor.objects.filter(version=self.version)
        self.assertEqual(ContentAnchor.objects.count(), 10041)
        self.assertEqual(anchors.count(), 10041)
        self.assertFalse(anchors.filter(anchor_id="stale-anchor").exists())
        self.assertFalse(anchors.filter(pk__in=old_anchor_pks).exists())
        self.assertFalse(
            anchors.exclude(
                topic__in=DocumentNode.objects.filter(version=self.version)
            ).exists()
        )
        self.assertEqual(
            anchors.get(anchor_id="fm100-p03219").topic.node_id,
            "fm100-t0340",
        )

    def test_database_rejects_duplicate_anchor_id_within_a_version(self):
        topic = DocumentNode.objects.get(
            version=self.version,
            node_id="fm100-t0340",
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            ContentAnchor.objects.create(
                version=self.version,
                topic=topic,
                anchor_id="fm100-p03219",
                anchor_type=ContentAnchor.AnchorType.NOTE,
            )

        other_version = DocumentVersion.objects.create(
            document=self.document,
            revision=3,
            revision_date=self.version.revision_date,
            effective_date=self.version.effective_date,
            metadata=self.version.metadata,
            source_filename="other.xml",
        )
        other_topic = DocumentNode.objects.create(
            version=other_version,
            node_id="fm100-c01",
            node_type=DocumentNode.NodeType.CHAPTER,
            number="01",
            title="Other revision",
            sequence=1,
            position=1,
        )
        same_id = ContentAnchor.objects.create(
            version=other_version,
            topic=other_topic,
            anchor_id="fm100-p03219",
            anchor_type=ContentAnchor.AnchorType.CHECK,
        )
        self.assertEqual(same_id.anchor_id, "fm100-p03219")

    def test_backfill_migration_rebuilds_the_same_anchors_as_ingestion(self):
        migration = import_module("documents.migrations.0004_contentanchor")
        fields = ("version_id", "topic_id", "anchor_id", "anchor_type")
        ingested = set(ContentAnchor.objects.values_list(*fields))
        self.assertEqual(len(ingested), 10041)
        ContentAnchor.objects.all().delete()

        migration.backfill_content_anchors(
            django_apps,
            SimpleNamespace(connection=connection),
        )

        self.assertEqual(ContentAnchor.objects.count(), 10041)
        self.assertEqual(set(ContentAnchor.objects.values_list(*fields)), ingested)
        with patch(
            "documents.xml_validation.etree.parse",
            side_effect=AssertionError("XML parsing should not be needed"),
        ):
            self.assertEqual(
                get_normalized_document("FM-S100", 2),
                self.normalized["payload"],
            )

    def test_command_reports_successful_replace(self):
        output = StringIO()
        with patch(
            "documents.ingestion.assemble_normalized_document",
            return_value=self.normalized,
        ):
            call_command(
                "ingest_xml",
                str(DEFAULT_XML_PATH),
                replace=True,
                stdout=output,
            )

        self.assertIn("FM-S100 Rev 2", output.getvalue())
        self.assertIn("19 chapters", output.getvalue())

    def test_command_refuses_duplicate_revision_without_replace(self):
        with (
            patch(
                "documents.ingestion.assemble_normalized_document",
                return_value=self.normalized,
            ),
            self.assertRaisesRegex(CommandError, "already exists"),
        ):
            call_command("ingest_xml", str(DEFAULT_XML_PATH), stderr=StringIO())

        self.assertEqual(
            DocumentNode.objects.filter(version=self.version).count(),
            1283,
        )

    def test_read_back_uses_a_constant_number_of_queries(self):
        with self.assertNumQueries(3):
            stored_payload = get_normalized_document("FM-S100", 2)

        self.assertEqual(len(stored_payload["topicContentById"]), 1193)

    def test_database_rejects_duplicate_order_values_and_bad_parent_shape(self):
        section = DocumentNode.objects.get(
            version=self.version,
            node_id="fm100-s001",
        )
        topic = section.children.order_by("position").first()
        chapter = section.parent
        rejected = {
            "duplicate position": {
                "node_type": DocumentNode.NodeType.TOPIC,
                "parent": section,
                "sequence": 9999,
                "position": topic.position,
            },
            "duplicate sibling sequence": {
                "node_type": DocumentNode.NodeType.TOPIC,
                "parent": section,
                "sequence": topic.sequence,
                "position": 99999,
            },
            "chapter with parent": {
                "node_type": DocumentNode.NodeType.CHAPTER,
                "parent": chapter,
                "sequence": 9999,
                "position": 99999,
            },
            "section without parent": {
                "node_type": DocumentNode.NodeType.SECTION,
                "parent": None,
                "sequence": 9999,
                "position": 99999,
            },
            "topic without parent": {
                "node_type": DocumentNode.NodeType.TOPIC,
                "parent": None,
                "sequence": 9999,
                "position": 99999,
            },
            "unsupported node type": {
                "node_type": "appendix",
                "parent": None,
                "sequence": 9999,
                "position": 99999,
            },
        }
        for label, fields in rejected.items():
            with (
                self.subTest(case=label),
                self.assertRaises(IntegrityError),
                transaction.atomic(),
            ):
                DocumentNode.objects.create(
                    version=self.version,
                    node_id=f"rejected-{label}",
                    number="99",
                    title=label,
                    **fields,
                )

        self.assertEqual(
            DocumentNode.objects.filter(version=self.version).count(),
            1283,
        )


class IngestionFailureTests(TestCase):
    @staticmethod
    def _version_snapshot(version):
        version_fields = [
            field.attname for field in DocumentVersion._meta.concrete_fields
        ]
        node_fields = [
            field.attname for field in DocumentNode._meta.concrete_fields
        ]
        anchor_fields = [
            field.attname for field in ContentAnchor._meta.concrete_fields
        ]
        return (
            tuple(
                DocumentVersion.objects.filter(pk=version.pk)
                .values_list(*version_fields)
                .get()
            ),
            tuple(
                tuple(row)
                for row in version.nodes.order_by("pk").values_list(*node_fields)
            ),
            tuple(
                tuple(row)
                for row in version.anchors.order_by("pk").values_list(*anchor_fields)
            ),
        )

    def test_invalid_and_missing_xml_create_no_database_records(self):
        with TemporaryDirectory() as temporary_directory:
            invalid_path = Path(temporary_directory) / "invalid.xml"
            invalid_path.write_text(
                '<manual xmlns="urn:sample:fltpub:1.0" id="bad" docType="FM">'
                "<unexpected /></manual>",
                encoding="utf-8",
            )
            invalid_result = ingest_xml(invalid_path)
            missing_result = ingest_xml(
                Path(temporary_directory) / "missing.xml"
            )

        self.assertFalse(invalid_result.success)
        self.assertFalse(missing_result.success)
        self.assertEqual(Document.objects.count(), 0)
        self.assertEqual(DocumentVersion.objects.count(), 0)
        self.assertEqual(DocumentNode.objects.count(), 0)

    def test_invalid_assembly_report_fails_initial_ingestion_without_writes(self):
        invalid_assembly = deepcopy(assemble_normalized_document())
        issue = {
            "line": 12,
            "column": 4,
            "message": "Synthetic extraction failure.",
        }
        invalid_assembly["ingestionReport"]["is_valid"] = False
        invalid_assembly["ingestionReport"]["errors"] = [issue]

        with patch(
            "documents.ingestion.assemble_normalized_document",
            return_value=invalid_assembly,
        ):
            result = ingest_xml(DEFAULT_XML_PATH)

        self.assertFalse(result.success)
        self.assertEqual(result.errors, [issue])
        self.assertEqual(Document.objects.count(), 0)
        self.assertEqual(DocumentVersion.objects.count(), 0)
        self.assertEqual(DocumentNode.objects.count(), 0)

    def test_invalid_assembly_report_replacement_preserves_existing_version(self):
        valid_assembly = assemble_normalized_document()
        with patch(
            "documents.ingestion.assemble_normalized_document",
            return_value=valid_assembly,
        ):
            original = ingest_xml(DEFAULT_XML_PATH)
        self.assertTrue(original.success)

        version = DocumentVersion.objects.get(document_id="FM-S100", revision=2)
        before = self._version_snapshot(version)
        invalid_assembly = deepcopy(valid_assembly)
        issue = {
            "line": 12,
            "column": 4,
            "message": "Synthetic replacement extraction failure.",
        }
        invalid_assembly["ingestionReport"]["is_valid"] = False
        invalid_assembly["ingestionReport"]["errors"] = [issue]

        with patch(
            "documents.ingestion.assemble_normalized_document",
            return_value=invalid_assembly,
        ):
            result = ingest_xml(DEFAULT_XML_PATH, replace=True)

        self.assertFalse(result.success)
        self.assertEqual(result.errors, [issue])
        self.assertEqual(self._version_snapshot(version), before)

    def test_initial_database_failure_rolls_back_document_and_version(self):
        normalized = deepcopy(assemble_normalized_document())
        normalized["payload"]["document"]["id"] = "ROLLBACK-DOC"
        normalized["payload"]["version"]["metadata"]["docId"] = "ROLLBACK-DOC"

        with (
            patch(
                "documents.ingestion.assemble_normalized_document",
                return_value=normalized,
            ),
            patch(
                "documents.ingestion.DocumentNode.objects.bulk_create",
                side_effect=DatabaseError("deliberate write failure"),
            ),
            self.assertLogs("documents.ingestion", level="ERROR") as logs,
        ):
            result = ingest_xml(DEFAULT_XML_PATH)

        self.assertFalse(result.success)
        self.assertIn("Database write failed", result.message)
        self.assertNotIn("deliberate write failure", result.message)
        self.assertIn("deliberate write failure", "\n".join(logs.output))
        self.assertFalse(Document.objects.filter(pk="ROLLBACK-DOC").exists())
        self.assertEqual(DocumentVersion.objects.count(), 0)
        self.assertEqual(DocumentNode.objects.count(), 0)

    def test_failed_replacement_rolls_back_existing_revision_and_nodes(self):
        normalized = assemble_normalized_document()
        with patch(
            "documents.ingestion.assemble_normalized_document",
            return_value=normalized,
        ):
            original = ingest_xml(DEFAULT_XML_PATH)
        self.assertTrue(original.success)
        version = DocumentVersion.objects.get(document_id="FM-S100", revision=2)
        other_version = DocumentVersion.objects.create(
            document=version.document,
            revision=3,
            revision_date=version.revision_date,
            effective_date=version.effective_date,
            metadata=deepcopy(version.metadata),
            source_filename="other-revision.xml",
        )
        DocumentNode.objects.create(
            version=other_version,
            node_id="other-revision-chapter",
            node_type=DocumentNode.NodeType.CHAPTER,
            number="01",
            title="Other revision",
            sequence=1,
            position=1,
        )
        before = self._version_snapshot(version)
        other_before = self._version_snapshot(other_version)
        original_bulk_create = DocumentNode.objects.bulk_create
        bulk_create_count = 0

        def fail_during_replacement(records, *args, **kwargs):
            nonlocal bulk_create_count
            bulk_create_count += 1
            if bulk_create_count == 2:
                raise DatabaseError("deliberate replacement failure")
            return original_bulk_create(records, *args, **kwargs)

        with (
            patch(
                "documents.ingestion.assemble_normalized_document",
                return_value=normalized,
            ),
            patch(
                "documents.ingestion.DocumentNode.objects.bulk_create",
                side_effect=fail_during_replacement,
            ),
            self.assertLogs("documents.ingestion", level="ERROR"),
        ):
            result = ingest_xml(DEFAULT_XML_PATH, replace=True)

        self.assertFalse(result.success)
        self.assertNotIn("deliberate replacement failure", result.message)
        self.assertEqual(bulk_create_count, 2)
        self.assertEqual(self._version_snapshot(version), before)
        self.assertEqual(self._version_snapshot(other_version), other_before)

    def test_anchors_are_written_inside_the_transaction_and_rolled_back(self):
        normalized = assemble_normalized_document()
        seen_at_validation = []

        def reject_after_counting(version):
            seen_at_validation.append(
                ContentAnchor.objects.filter(version=version).count()
            )
            raise DocumentTreeIntegrityError("deliberate tree failure")

        with (
            patch(
                "documents.ingestion.assemble_normalized_document",
                return_value=normalized,
            ),
            patch(
                "documents.ingestion.validate_version_tree",
                side_effect=reject_after_counting,
            ),
        ):
            result = ingest_xml(DEFAULT_XML_PATH)

        self.assertFalse(result.success)
        self.assertEqual(seen_at_validation, [10041])
        self.assertEqual(ContentAnchor.objects.count(), 0)
        self.assertEqual(DocumentNode.objects.count(), 0)
        self.assertEqual(DocumentVersion.objects.count(), 0)

    def test_anchor_write_failure_rolls_back_the_whole_ingest(self):
        normalized = assemble_normalized_document()
        failing_anchor_write = patch(
            "documents.ingestion.ContentAnchor.objects.bulk_create",
            side_effect=DatabaseError("deliberate anchor failure"),
        )
        with (
            patch(
                "documents.ingestion.assemble_normalized_document",
                return_value=normalized,
            ),
            failing_anchor_write,
            self.assertLogs("documents.ingestion", level="ERROR"),
        ):
            initial = ingest_xml(DEFAULT_XML_PATH)

        self.assertFalse(initial.success)
        self.assertEqual(Document.objects.count(), 0)
        self.assertEqual(DocumentNode.objects.count(), 0)
        self.assertEqual(ContentAnchor.objects.count(), 0)

        with patch(
            "documents.ingestion.assemble_normalized_document",
            return_value=normalized,
        ):
            self.assertTrue(ingest_xml(DEFAULT_XML_PATH).success)
        version = DocumentVersion.objects.get(document_id="FM-S100", revision=2)
        before = self._version_snapshot(version)
        self.assertEqual(len(before[2]), 10041)

        with (
            patch(
                "documents.ingestion.assemble_normalized_document",
                return_value=normalized,
            ),
            failing_anchor_write,
            self.assertLogs("documents.ingestion", level="ERROR"),
        ):
            replacement = ingest_xml(DEFAULT_XML_PATH, replace=True)

        self.assertFalse(replacement.success)
        self.assertEqual(self._version_snapshot(version), before)

    def test_missing_xml_command_raises_readable_command_error(self):
        with TemporaryDirectory() as temporary_directory:
            missing_path = Path(temporary_directory) / "missing.xml"
            stderr = StringIO()
            with self.assertRaisesRegex(CommandError, "XML assembly is invalid"):
                call_command("ingest_xml", str(missing_path), stderr=stderr)

        self.assertIn("Unable to read XML file", stderr.getvalue())

    def test_invalid_xml_command_raises_readable_command_error(self):
        with TemporaryDirectory() as temporary_directory:
            invalid_path = Path(temporary_directory) / "invalid.xml"
            invalid_path.write_text(
                '<manual xmlns="urn:sample:fltpub:1.0" id="bad" docType="FM">'
                "<unexpected /></manual>",
                encoding="utf-8",
            )
            stderr = StringIO()
            with self.assertRaisesRegex(CommandError, "XML assembly is invalid"):
                call_command("ingest_xml", str(invalid_path), stderr=stderr)

        self.assertIn("XML assembly is invalid", stderr.getvalue())
        self.assertTrue(stderr.getvalue().strip())
        self.assertIn("line 1: ", stderr.getvalue())
        self.assertNotIn("None", stderr.getvalue())

    def test_unresolved_xref_command_raises_readable_command_error(self):
        unresolved_manual = MINIMAL_VALID_MANUAL.replace(
            '<para id="sample-p1">Sample paragraph.</para>',
            '<para id="sample-p1">See <xref target="missing-t9">'
            "missing topic</xref>.</para>",
        )
        with TemporaryDirectory() as temporary_directory:
            xml_path = Path(temporary_directory) / "unresolved-xref.xml"
            xml_path.write_text(unresolved_manual, encoding="utf-8")
            stderr = StringIO()
            with self.assertRaisesRegex(
                CommandError,
                "unresolved cross-references",
            ):
                call_command("ingest_xml", str(xml_path), stderr=stderr)

        self.assertIn("Unresolved cross-reference:", stderr.getvalue())
        self.assertIn("missing-t9", stderr.getvalue())
        self.assertEqual(Document.objects.count(), 0)
        self.assertEqual(DocumentVersion.objects.count(), 0)
        self.assertEqual(DocumentNode.objects.count(), 0)

    def test_each_invalid_assembly_condition_blocks_all_database_access(self):
        valid_assembly = assemble_normalized_document()
        issue = {"line": 7, "column": 3, "message": "Synthetic failure."}

        def without_payload(assembly):
            assembly["payload"] = None

        def not_valid(assembly):
            assembly["ingestionReport"]["is_valid"] = False

        def with_errors(assembly):
            assembly["ingestionReport"]["errors"] = [issue]

        def with_unresolved_xrefs(assembly):
            assembly["ingestionReport"]["unresolvedXrefs"] = [issue]

        conditions = {
            "payload is missing": without_payload,
            "report is not valid": not_valid,
            "errors are present": with_errors,
            "unresolved xrefs are present": with_unresolved_xrefs,
        }

        def assert_refused_without_queries(replace):
            for label, corrupt in conditions.items():
                invalid_assembly = deepcopy(valid_assembly)
                corrupt(invalid_assembly)
                with (
                    self.subTest(condition=label, replace=replace),
                    patch(
                        "documents.ingestion.assemble_normalized_document",
                        return_value=invalid_assembly,
                    ),
                    self.assertNumQueries(0),
                ):
                    result = ingest_xml(DEFAULT_XML_PATH, replace=replace)
                    self.assertFalse(result.success)
                    self.assertFalse(result.duplicate)
                    self.assertEqual(result.total_nodes_written, 0)
                    self.assertTrue(result.message)

        assert_refused_without_queries(replace=False)
        assert_refused_without_queries(replace=True)
        self.assertEqual(Document.objects.count(), 0)

        with patch(
            "documents.ingestion.assemble_normalized_document",
            return_value=valid_assembly,
        ):
            self.assertTrue(ingest_xml(DEFAULT_XML_PATH).success)
        version = DocumentVersion.objects.get(document_id="FM-S100", revision=2)
        before = self._version_snapshot(version)

        assert_refused_without_queries(replace=True)
        self.assertEqual(self._version_snapshot(version), before)

    def test_invalid_tree_is_caught_inside_transaction_and_rolled_back(self):
        valid_assembly = assemble_normalized_document()
        changed_assembly = deepcopy(valid_assembly)
        changed_assembly["payload"]["version"]["metadata"]["title"] = (
            "Changed title"
        )
        original_node_records = ingestion._node_records

        def topic_under_chapter(*args, **kwargs):
            chapters, sections, topics = original_node_records(*args, **kwargs)
            topics[0].parent = chapters[0]
            topics[0].sequence = 9999
            return chapters, sections, topics

        with (
            patch(
                "documents.ingestion.assemble_normalized_document",
                return_value=changed_assembly,
            ),
            patch(
                "documents.ingestion._node_records",
                side_effect=topic_under_chapter,
            ),
        ):
            initial = ingest_xml(DEFAULT_XML_PATH)

        self.assertFalse(initial.success)
        self.assertIn("Invalid document tree", initial.message)
        self.assertIn("must have a section parent", initial.message)
        self.assertEqual(Document.objects.count(), 0)
        self.assertEqual(DocumentVersion.objects.count(), 0)
        self.assertEqual(DocumentNode.objects.count(), 0)

        with patch(
            "documents.ingestion.assemble_normalized_document",
            return_value=valid_assembly,
        ):
            self.assertTrue(ingest_xml(DEFAULT_XML_PATH).success)
        version = DocumentVersion.objects.get(document_id="FM-S100", revision=2)
        before = self._version_snapshot(version)
        document_before = Document.objects.filter(pk="FM-S100").values().get()

        with (
            patch(
                "documents.ingestion.assemble_normalized_document",
                return_value=changed_assembly,
            ),
            patch(
                "documents.ingestion._node_records",
                side_effect=topic_under_chapter,
            ),
        ):
            replacement = ingest_xml(DEFAULT_XML_PATH, replace=True)

        self.assertFalse(replacement.success)
        self.assertIn("Invalid document tree", replacement.message)
        self.assertEqual(self._version_snapshot(version), before)
        self.assertEqual(
            Document.objects.filter(pk="FM-S100").values().get(),
            document_before,
        )
        self.assertNotEqual(document_before["title"], "Changed title")


class ContentAnchorTests(TestCase):
    ALL_BLOCK_TYPES_MANUAL = MINIMAL_VALID_MANUAL.replace(
        '<para id="sample-p1">Sample paragraph.</para>',
        '<para id="sample-p1">Sample paragraph.</para>'
        '<note id="sample-p2">Sample note.</note>'
        '<caution id="sample-p3">Sample caution.</caution>'
        '<warning id="sample-p4">Sample warning.</warning>'
        '<list id="sample-p5"><item>First</item><item>Second</item></list>'
        '<table id="sample-p6"><row header="true"><cell>A</cell></row>'
        "<row><cell>B</cell></row></table>"
        '<checklist id="sample-p7">'
        '<check id="sample-p9"><challenge>Switch</challenge>'
        "<response>On</response></check>"
        '<check id="sample-p8"><challenge>Valve</challenge>'
        "<response>Closed</response></check>"
        "</checklist>",
    )
    EXPECTED_ANCHORS = [
        ("sample-p1", "para"),
        ("sample-p2", "note"),
        ("sample-p3", "caution"),
        ("sample-p4", "warning"),
        ("sample-p5", "list"),
        ("sample-p6", "table"),
        ("sample-p7", "checklist"),
        ("sample-p9", "check"),
        ("sample-p8", "check"),
    ]

    def _ingest(self, manual, *, replace=False):
        with TemporaryDirectory() as temporary_directory:
            xml_path = Path(temporary_directory) / "FM-SAMPLE_Rev2.xml"
            xml_path.write_text(manual, encoding="utf-8")
            return ingest_xml(xml_path, replace=replace)

    def test_every_block_type_and_check_gets_exactly_one_anchor(self):
        result = self._ingest(self.ALL_BLOCK_TYPES_MANUAL)

        self.assertTrue(result.success, result.message)
        self.assertEqual(
            list(
                ContentAnchor.objects.order_by("pk").values_list(
                    "anchor_id",
                    "anchor_type",
                    "topic__node_id",
                    "version__document_id",
                    "version__revision",
                )
            ),
            [
                (anchor_id, anchor_type, "sample-t1", "FM-SAMPLE", 2)
                for anchor_id, anchor_type in self.EXPECTED_ANCHORS
            ],
        )
        self.assertEqual(
            {anchor_type for _, anchor_type in self.EXPECTED_ANCHORS},
            set(ContentAnchor.AnchorType.values),
        )

    def test_replace_with_fewer_blocks_drops_the_removed_anchors(self):
        self.assertTrue(self._ingest(self.ALL_BLOCK_TYPES_MANUAL).success)
        self.assertEqual(ContentAnchor.objects.count(), 9)

        result = self._ingest(MINIMAL_VALID_MANUAL, replace=True)

        self.assertTrue(result.success, result.message)
        self.assertEqual(
            list(ContentAnchor.objects.values_list("anchor_id", "anchor_type")),
            [("sample-p1", "para")],
        )

    def test_deleting_a_version_or_topic_cascades_to_its_anchors(self):
        self.assertTrue(self._ingest(self.ALL_BLOCK_TYPES_MANUAL).success)

        DocumentNode.objects.filter(node_id="sample-t1").delete()
        self.assertEqual(ContentAnchor.objects.count(), 0)

        self.assertTrue(
            self._ingest(self.ALL_BLOCK_TYPES_MANUAL, replace=True).success
        )
        self.assertEqual(ContentAnchor.objects.count(), 9)
        DocumentVersion.objects.all().delete()
        self.assertEqual(ContentAnchor.objects.count(), 0)

    def test_backfill_handles_an_empty_database_and_topics_without_blocks(self):
        migration = import_module("documents.migrations.0004_contentanchor")
        schema_editor = SimpleNamespace(connection=connection)

        with self.assertNumQueries(1):
            migration.backfill_content_anchors(django_apps, schema_editor)
        self.assertEqual(ContentAnchor.objects.count(), 0)

        document = Document.objects.create(
            id="BACKFILL",
            title="Backfill",
            doc_type="FM",
            namespace="urn:backfill",
        )
        version = DocumentVersion.objects.create(
            document=document,
            revision=1,
            revision_date=date(2026, 7, 1),
            effective_date=date(2026, 7, 15),
            metadata={},
            source_filename="backfill.xml",
        )
        chapter = DocumentNode.objects.create(
            version=version,
            node_id="b-c1",
            node_type=DocumentNode.NodeType.CHAPTER,
            number="01",
            title="Chapter",
            sequence=1,
            position=1,
        )
        section = DocumentNode.objects.create(
            version=version,
            node_id="b-s1",
            node_type=DocumentNode.NodeType.SECTION,
            number="01.10",
            title="Section",
            parent=chapter,
            sequence=1,
            position=2,
        )
        for sequence, blocks in enumerate(
            (None, [], [{"type": "para", "id": "b-p1", "segments": []}]),
            start=1,
        ):
            DocumentNode.objects.create(
                version=version,
                node_id=f"b-t{sequence}",
                node_type=DocumentNode.NodeType.TOPIC,
                number=f"01.10.{sequence}",
                title="Topic",
                parent=section,
                sequence=sequence,
                position=2 + sequence,
                content_blocks=blocks,
            )

        migration.backfill_content_anchors(django_apps, schema_editor)

        self.assertEqual(
            list(
                ContentAnchor.objects.values_list(
                    "anchor_id",
                    "anchor_type",
                    "topic__node_id",
                )
            ),
            [("b-p1", "para", "b-t3")],
        )

    @staticmethod
    def _stored_rows():
        return (
            list(DocumentNode.objects.order_by("pk").values_list("pk", "node_id")),
            list(
                ContentAnchor.objects.order_by("pk").values_list(
                    "pk",
                    "anchor_id",
                    "anchor_type",
                    "topic_id",
                )
            ),
        )

    def test_xml_that_reuses_an_id_is_refused_on_ingest_and_on_replace(self):
        para = '<para id="sample-p1">'
        ambiguous_manuals = {
            "block reuses the chapter ID": self.ALL_BLOCK_TYPES_MANUAL.replace(
                para, '<para id="sample-c1">'
            ),
            "block reuses the section ID": self.ALL_BLOCK_TYPES_MANUAL.replace(
                para, '<para id="sample-s1">'
            ),
            "block reuses the topic ID": self.ALL_BLOCK_TYPES_MANUAL.replace(
                para, '<para id="sample-t1">'
            ),
            "check reuses the topic ID": self.ALL_BLOCK_TYPES_MANUAL.replace(
                '<check id="sample-p9">', '<check id="sample-t1">'
            ),
            "check reuses a block ID": self.ALL_BLOCK_TYPES_MANUAL.replace(
                '<check id="sample-p9">', '<check id="sample-p1">'
            ),
        }
        for label, manual in ambiguous_manuals.items():
            with self.subTest(case=label, mode="fresh ingest"):
                self.assertNotEqual(manual, self.ALL_BLOCK_TYPES_MANUAL)
                result = self._ingest(manual)

                self.assertFalse(result.success)
                self.assertTrue(result.errors)
                self.assertEqual(Document.objects.count(), 0)
                self.assertEqual(DocumentNode.objects.count(), 0)
                self.assertEqual(ContentAnchor.objects.count(), 0)

        self.assertTrue(self._ingest(self.ALL_BLOCK_TYPES_MANUAL).success)
        before = self._stored_rows()
        self.assertEqual((len(before[0]), len(before[1])), (3, 9))
        for label, manual in ambiguous_manuals.items():
            with self.subTest(case=label, mode="replace"):
                result = self._ingest(manual, replace=True)

                self.assertFalse(result.success)
                self.assertTrue(result.errors)
                self.assertEqual(self._stored_rows(), before)

    def test_assembled_payload_with_an_ambiguous_id_is_refused_and_rolled_back(self):
        with TemporaryDirectory() as temporary_directory:
            xml_path = Path(temporary_directory) / "FM-SAMPLE_Rev2.xml"
            xml_path.write_text(self.ALL_BLOCK_TYPES_MANUAL, encoding="utf-8")
            valid = assemble_normalized_document(xml_path)
        self.assertTrue(valid["ingestionReport"]["is_valid"])

        def reuse(block_index, new_id, check_index=None):
            def corrupt(blocks):
                target = blocks[block_index]
                if check_index is not None:
                    target = target["checks"][check_index]
                target["id"] = new_id

            return corrupt

        cases = {
            "block reuses the topic ID": (reuse(0, "sample-t1"), "sample-t1"),
            "block reuses the section ID": (reuse(4, "sample-s1"), "sample-s1"),
            "check reuses the chapter ID": (reuse(6, "sample-c1", 0), "sample-c1"),
            "check reuses a block ID": (reuse(6, "sample-p5", 1), "sample-p5"),
            "two blocks share an ID": (reuse(2, "sample-p1"), "sample-p1"),
        }

        def ingest(assembly, *, replace=False):
            with patch(
                "documents.ingestion.assemble_normalized_document",
                return_value=assembly,
            ):
                return ingest_xml("FM-SAMPLE_Rev2.xml", replace=replace)

        def ambiguous(corrupt):
            assembly = deepcopy(valid)
            corrupt(assembly["payload"]["topicContentById"]["sample-t1"]["blocks"])
            self.assertTrue(assembly["ingestionReport"]["is_valid"])
            return assembly

        for label, (corrupt, repeated_id) in cases.items():
            with self.subTest(case=label, mode="fresh ingest"):
                result = ingest(ambiguous(corrupt))

                self.assertFalse(result.success)
                self.assertIn("IDs used more than once", result.message)
                self.assertIn(repeated_id, result.message)
                self.assertEqual(Document.objects.count(), 0)
                self.assertEqual(DocumentVersion.objects.count(), 0)
                self.assertEqual(DocumentNode.objects.count(), 0)
                self.assertEqual(ContentAnchor.objects.count(), 0)

        self.assertTrue(ingest(valid).success)
        version = DocumentVersion.objects.get(document_id="FM-SAMPLE", revision=2)
        before = IngestionFailureTests._version_snapshot(version)
        self.assertEqual(len(before[2]), 9)
        for label, (corrupt, repeated_id) in cases.items():
            with self.subTest(case=label, mode="replace"):
                result = ingest(ambiguous(corrupt), replace=True)

                self.assertFalse(result.success)
                self.assertIn(repeated_id, result.message)
                self.assertEqual(
                    IngestionFailureTests._version_snapshot(version),
                    before,
                )

    def test_backfill_refuses_a_revision_with_an_ambiguous_id(self):
        migration = import_module("documents.migrations.0004_contentanchor")
        schema_editor = SimpleNamespace(connection=connection)
        document = Document.objects.create(
            id="AMBIGUOUS",
            title="Ambiguous",
            doc_type="FM",
            namespace="urn:ambiguous",
        )

        def store_revision(revision, first_blocks, second_blocks):
            version = DocumentVersion.objects.create(
                document=document,
                revision=revision,
                revision_date=date(2026, 7, 1),
                effective_date=date(2026, 7, 15),
                metadata={},
                source_filename="ambiguous.xml",
            )
            chapter = DocumentNode.objects.create(
                version=version,
                node_id="a-c1",
                node_type=DocumentNode.NodeType.CHAPTER,
                number="01",
                title="Chapter",
                sequence=1,
                position=1,
            )
            section = DocumentNode.objects.create(
                version=version,
                node_id="a-s1",
                node_type=DocumentNode.NodeType.SECTION,
                number="01.10",
                title="Section",
                parent=chapter,
                sequence=1,
                position=2,
            )
            for sequence, blocks in enumerate((first_blocks, second_blocks), 1):
                DocumentNode.objects.create(
                    version=version,
                    node_id=f"a-t{sequence}",
                    node_type=DocumentNode.NodeType.TOPIC,
                    number=f"01.10.{sequence}",
                    title="Topic",
                    parent=section,
                    sequence=sequence,
                    position=2 + sequence,
                    content_blocks=blocks,
                )
            return version

        def para(block_id):
            return {"type": "para", "id": block_id, "segments": []}

        def checklist(block_id, check_id):
            return {
                "type": "checklist",
                "id": block_id,
                "checks": [{"id": check_id, "challenge": "A", "response": "B"}],
            }

        cases = {
            "block reuses the chapter ID": ([para("a-c1")], [], "a-c1"),
            "block reuses the section ID": ([para("a-p1")], [para("a-s1")], "a-s1"),
            "block reuses another topic's ID": ([para("a-t2")], [], "a-t2"),
            "check reuses its own topic's ID": (
                [checklist("a-p1", "a-t1")],
                [],
                "a-t1",
            ),
            "two topics share a block ID": ([para("a-p1")], [para("a-p1")], "a-p1"),
            "check reuses a block ID": (
                [para("a-p1")],
                [checklist("a-p2", "a-p1")],
                "a-p1",
            ),
        }
        for revision, (label, (first, second, repeated_id)) in enumerate(
            cases.items(),
            start=1,
        ):
            with self.subTest(case=label):
                version = store_revision(revision, first, second)

                with self.assertRaisesRegex(
                    RuntimeError,
                    rf"AMBIGUOUS revision {revision}: .*{repeated_id}",
                ):
                    migration.backfill_content_anchors(django_apps, schema_editor)

                self.assertEqual(ContentAnchor.objects.count(), 0)
                version.delete()

        store_revision(99, [para("a-p1")], [checklist("a-p2", "a-p3")])
        migration.backfill_content_anchors(django_apps, schema_editor)
        self.assertEqual(
            list(ContentAnchor.objects.values_list("anchor_id", "anchor_type")),
            [("a-p1", "para"), ("a-p2", "checklist"), ("a-p3", "check")],
        )

    def test_backfill_is_reversible_and_self_contained(self):
        migration = import_module("documents.migrations.0004_contentanchor")
        operations = migration.Migration.operations
        backfill = operations[-1]

        self.assertEqual(
            [type(operation) for operation in operations],
            [migrations.CreateModel, migrations.RunPython],
        )
        self.assertIs(backfill.code, migration.backfill_content_anchors)
        self.assertIs(backfill.reverse_code, migrations.RunPython.noop)
        self.assertTrue(backfill.reversible)
        source = inspect.getsource(migration)
        self.assertNotIn("from documents", source)
        self.assertNotIn("import documents", source)


class VersionTreeValidationTests(TestCase):
    def setUp(self):
        self.document = Document.objects.create(
            id="TREE-TEST",
            title="Tree test",
            doc_type="FM",
            namespace="urn:tree-test",
        )
        self.version = DocumentVersion.objects.create(
            document=self.document,
            revision=1,
            revision_date=date(2026, 7, 1),
            effective_date=date(2026, 7, 15),
            metadata={},
            source_filename="tree-test.xml",
        )

    def _node(
        self,
        *,
        node_id,
        node_type,
        position,
        sequence=1,
        parent=None,
        version=None,
    ):
        return DocumentNode.objects.create(
            version=version or self.version,
            node_id=node_id,
            node_type=node_type,
            number=node_id,
            title=node_id,
            parent=parent,
            sequence=sequence,
            position=position,
        )

    def test_validator_rejects_parent_from_another_version(self):
        other_version = DocumentVersion.objects.create(
            document=self.document,
            revision=2,
            revision_date=date(2026, 7, 1),
            effective_date=date(2026, 7, 15),
            metadata={},
            source_filename="other.xml",
        )
        chapter = self._node(
            node_id="other-chapter",
            node_type=DocumentNode.NodeType.CHAPTER,
            position=1,
            version=other_version,
        )
        self._node(
            node_id="cross-version-section",
            node_type=DocumentNode.NodeType.SECTION,
            position=2,
            parent=chapter,
        )

        with self.assertRaisesRegex(
            DocumentTreeIntegrityError,
            "outside version",
        ):
            validate_version_tree(self.version)

    def test_validator_rejects_wrong_parent_type(self):
        chapter = self._node(
            node_id="chapter",
            node_type=DocumentNode.NodeType.CHAPTER,
            position=1,
        )
        self._node(
            node_id="topic-under-chapter",
            node_type=DocumentNode.NodeType.TOPIC,
            position=2,
            parent=chapter,
        )

        with self.assertRaisesRegex(
            DocumentTreeIntegrityError,
            "must have a section parent",
        ):
            validate_version_tree(self.version)

    def test_validator_rejects_parent_cycles(self):
        chapter = self._node(
            node_id="chapter",
            node_type=DocumentNode.NodeType.CHAPTER,
            position=1,
        )
        section = self._node(
            node_id="section",
            node_type=DocumentNode.NodeType.SECTION,
            position=2,
            parent=chapter,
        )
        topic = self._node(
            node_id="topic",
            node_type=DocumentNode.NodeType.TOPIC,
            position=3,
            parent=section,
        )
        DocumentNode.objects.filter(pk=section.pk).update(parent=topic)

        with self.assertRaisesRegex(DocumentTreeIntegrityError, "parent cycle"):
            validate_version_tree(self.version)

    def test_validator_rejects_parent_that_follows_child(self):
        chapter = self._node(
            node_id="late-chapter",
            node_type=DocumentNode.NodeType.CHAPTER,
            position=2,
        )
        self._node(
            node_id="early-section",
            node_type=DocumentNode.NodeType.SECTION,
            position=1,
            parent=chapter,
        )

        with self.assertRaisesRegex(
            DocumentTreeIntegrityError,
            "must precede",
        ):
            validate_version_tree(self.version)

    def test_validator_rejects_sibling_sequence_that_contradicts_position(self):
        chapter = self._node(
            node_id="chapter",
            node_type=DocumentNode.NodeType.CHAPTER,
            position=1,
        )
        self._node(
            node_id="first-by-position",
            node_type=DocumentNode.NodeType.SECTION,
            position=2,
            sequence=2,
            parent=chapter,
        )
        self._node(
            node_id="second-by-position",
            node_type=DocumentNode.NodeType.SECTION,
            position=3,
            sequence=1,
            parent=chapter,
        )

        with self.assertRaisesRegex(
            DocumentTreeIntegrityError,
            "does not match document order",
        ):
            validate_version_tree(self.version)

    def test_validator_rejects_nodes_outside_their_parent_range(self):
        first_chapter = self._node(
            node_id="first-chapter",
            node_type=DocumentNode.NodeType.CHAPTER,
            position=1,
            sequence=1,
        )
        first_section = self._node(
            node_id="first-section",
            node_type=DocumentNode.NodeType.SECTION,
            position=2,
            sequence=1,
            parent=first_chapter,
        )
        self._node(
            node_id="second-section",
            node_type=DocumentNode.NodeType.SECTION,
            position=3,
            sequence=2,
            parent=first_chapter,
        )
        stray_topic = self._node(
            node_id="topic-after-next-section",
            node_type=DocumentNode.NodeType.TOPIC,
            position=4,
            parent=first_section,
        )

        with self.assertRaisesRegex(
            DocumentTreeIntegrityError,
            "outside its parent's range",
        ):
            validate_version_tree(self.version)

        stray_topic.delete()
        self._node(
            node_id="second-chapter",
            node_type=DocumentNode.NodeType.CHAPTER,
            position=4,
            sequence=2,
        )
        self._node(
            node_id="section-after-next-chapter",
            node_type=DocumentNode.NodeType.SECTION,
            position=5,
            sequence=3,
            parent=first_chapter,
        )

        with self.assertRaisesRegex(
            DocumentTreeIntegrityError,
            "outside its parent's range",
        ):
            validate_version_tree(self.version)

    def test_validator_accepts_well_formed_tree_with_one_query(self):
        for chapter_sequence in (1, 2):
            chapter = self._node(
                node_id=f"chapter-{chapter_sequence}",
                node_type=DocumentNode.NodeType.CHAPTER,
                position=chapter_sequence * 10,
                sequence=chapter_sequence,
            )
            for section_sequence in (1, 2):
                section = self._node(
                    node_id=f"section-{chapter_sequence}-{section_sequence}",
                    node_type=DocumentNode.NodeType.SECTION,
                    position=chapter_sequence * 10 + section_sequence * 3,
                    sequence=section_sequence,
                    parent=chapter,
                )
                self._node(
                    node_id=f"topic-{chapter_sequence}-{section_sequence}",
                    node_type=DocumentNode.NodeType.TOPIC,
                    position=chapter_sequence * 10 + section_sequence * 3 + 1,
                    parent=section,
                )

        with self.assertNumQueries(1):
            validate_version_tree(self.version)

    def test_read_back_rejects_invalid_version_tree(self):
        chapter = self._node(
            node_id="chapter",
            node_type=DocumentNode.NodeType.CHAPTER,
            position=1,
        )
        self._node(
            node_id="topic-under-chapter",
            node_type=DocumentNode.NodeType.TOPIC,
            position=2,
            parent=chapter,
        )

        with self.assertRaises(DocumentTreeIntegrityError):
            get_normalized_document(self.document.id, self.version.revision)
