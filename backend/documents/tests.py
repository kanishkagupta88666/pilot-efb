from collections import Counter
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.test import TestCase
from lxml import etree
from rest_framework.test import APITestCase

from documents.xml_hierarchy import extract_hierarchy
from documents.xml_metadata import extract_metadata
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
