"""Make a synthetic second revision of Bulletin 26-01 to test PDF-only change tracking.

The client supplied each bulletin in one revision only, so there is nothing
to compare. This script reads the real Rev 0 from sample-data (it is never
modified), applies a fixed list of edits, and draws Rev 1 in the same layout
as the original (US Letter, Helvetica, ReportLab paragraphs, outline). It also
writes the expected changes, which the tests check the comparison against.

The result is marked on every page as a synthetic test revision made by the
project team. It is test data, not client content.

Run from backend/ (needs requirements-dev.txt):

    .venv/bin/python documents/fixtures/make_bulletin_revision.py
"""

import json
import os
from pathlib import Path
import sys
from xml.sax.saxutils import escape

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from reportlab.lib.pagesizes import letter  # noqa: E402
from reportlab.lib.styles import ParagraphStyle  # noqa: E402
from reportlab.platypus import Paragraph, SimpleDocTemplate  # noqa: E402

from documents.pdf_only import ParsedSection, parse_pdf  # noqa: E402
from documents.xml_validation import PROJECT_ROOT  # noqa: E402

SOURCE = PROJECT_ROOT / "sample-data" / "pdf-only" / "Bulletin_26-01.pdf"
OUTPUT = Path(__file__).resolve().parent / "pdf-only" / "Bulletin_26-01_Rev1.pdf"
KEY = OUTPUT.with_suffix(".expected.json")
EFFECTIVE = "2026-10-01"
TEST_NOTE = (
    "SYNTHETIC TEST REVISION: made by the project team from Rev 0 to test change "
    "tracking. Not issued by the client."
)
NEW_PARAGRAPH = (
    "During taxi in low visibility, both pilots should confirm the Probe Heat advisory "
    "before crossing any runway. The relief pilot will record the Window Heat indication "
    "once the checklist item is complete."
)
NEW_SECTION = [
    "The pilot monitoring should verify the Wing Anti-Ice status message before the first "
    "turn onto the taxiway when operating at a sample station with contaminated surfaces.",
    "If the Nosewheel Steering is inoperative, request a tow to the runway holding point and "
    "advise the Sample Operations Center before the next phase of flight.",
    "Taxi speed on contaminated surfaces is expected to stay within the sample range of 5 to "
    "8 units. The captain will brief this limit before engine start.",
]


def edit(sections: list[ParsedSection]) -> tuple[list[ParsedSection], dict]:
    """Apply the test edits. Positions in the key are Rev 0's (section, paragraph), from 1."""
    s = [ParsedSection(x.title, x.page, list(x.paragraphs)) for x in sections]

    # 1. Modify: a few words of Section 2, paragraph 3.
    old = s[1].paragraphs[2]
    s[1].paragraphs[2] = old.replace("continue parking", "continue taxi", 1).replace(
        "the Captain has", "both pilots have", 1
    )
    assert s[1].paragraphs[2] != old
    # 2. Modify: one word of Section 4, paragraph 5.
    old = s[3].paragraphs[4]
    s[3].paragraphs[4] = old.replace("descent", "approach", 1)
    assert s[3].paragraphs[4] != old
    # 3. Remove: Section 3, paragraph 2.
    del s[2].paragraphs[1]
    # 4. Add: a new paragraph in Section 1, after paragraph 2.
    s[0].paragraphs.insert(2, NEW_PARAGRAPH)
    # 5. Remove: the whole of Section 6.
    removed_section = s.pop(5)
    # 6. Add: a new section after Section 4, so the old Section 5 is renumbered 6.
    s.insert(4, ParsedSection("Section 5", 0, list(NEW_SECTION)))
    for number, section in enumerate(s, start=1):
        section.title = f"Section {number}"

    key = {
        "docId": "BUL-26-01",
        "fromRevision": 0,
        "toRevision": 1,
        "paragraphs": {
            "modified": [[2, 3], [4, 5]],
            "removed": [[3, 2]] + [[6, n] for n in range(1, len(removed_section.paragraphs) + 1)],
            "addedCount": 1 + len(NEW_SECTION),
        },
        "sections": {
            "removed": [6],
            "addedCount": 1,
            "renumbered": [[5, 6]],
        },
    }
    return s, key


def draw(title: str, meta: str, sections: list[ParsedSection]) -> None:
    title_style = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=16, leading=22, spaceAfter=6)
    body = ParagraphStyle("body", fontName="Helvetica", fontSize=9.5, leading=12.5, spaceAfter=8)
    note = ParagraphStyle("note", parent=body, leftIndent=18)
    heading = ParagraphStyle(
        "heading", fontName="Helvetica-Bold", fontSize=13, leading=16, spaceBefore=8, spaceAfter=6
    )

    class Document(SimpleDocTemplate):
        def afterFlowable(self, flowable) -> None:
            if isinstance(flowable, Paragraph) and flowable.style.name == "heading":
                text = flowable.getPlainText()
                key = text.replace(" ", "-")
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(text, key, level=0)

    def furniture(canvas, document) -> None:
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(54, 763.2, f"{title} (Rev 1, synthetic test revision)")
        canvas.drawString(54, 36, "SYNTHETIC SAMPLE - NOT FOR OPERATIONAL USE")
        canvas.drawRightString(558, 36, f"Page {document.page}")
        canvas.restoreState()

    story = [
        Paragraph(escape(title), title_style),
        Paragraph(escape(meta), body),
        Paragraph(escape("PDF-only document. No XML source exists, so navigation is page-level."), note),
        Paragraph(escape(TEST_NOTE), note),
    ]
    for section in sections:
        story.append(Paragraph(escape(section.title), heading))
        story.extend(Paragraph(escape(text), body) for text in section.paragraphs)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    Document(
        str(OUTPUT),
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=60,
        bottomMargin=54,
        title=f"{title} (Rev 1, synthetic test revision)",
        author="Pilot EFB project team (synthetic test data)",
    ).build(story, onFirstPage=furniture, onLaterPages=furniture)


def main() -> None:
    original = parse_pdf(SOURCE)
    sections, key = edit(original.sections)
    meta = (
        f"Applicability: {original.applicability}   Effective {EFFECTIVE}   "
        f"Owner: {original.owner}"
    )
    draw(original.title, meta, sections)
    KEY.write_text(json.dumps(key, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT.relative_to(BACKEND)} and {KEY.relative_to(BACKEND)}")


if __name__ == "__main__":
    main()
