"""Keyword search over the published revision of every document.

Search is non-generative and predictable: a result is a place in a manual
that contains every query word, ranked by a fixed score. The same rules are
implemented in the reader (``frontend/src/utils/searchIndex.ts``) for offline
search over a downloaded index, so both must change together.

Rules
-----
* Text is lowercased and split into words of letters and digits.
* A query word matches a text word that starts with it ("hydraul" matches
  "hydraulic"). A one-character query word ("A" in "System A") matches only
  the whole word.
* An entry matches when every query word matches its text or its topic's
  number and title.
* Score per query word: 3 if it matches the title, plus 1 if it matches the
  text, plus 1 if it equals a whole word in either. Plus 5 when the whole
  query appears as consecutive words in the title or text.
* Results are grouped by topic: the best entry of each topic is returned,
  with the number of matching entries in that topic. Ties keep document order.
* A content filter (warnings, procedures) keeps only blocks of those types,
  and every query word must then match the block's own text: a caution is
  not a result just because its topic's title matches.
* The snippet comes from the best entry's text; when that is the topic
  heading, which has no text, it comes from the topic's first block.
"""

from dataclasses import dataclass
from functools import lru_cache
import re

from documents import revision_status
from documents.models import DocumentNode, DocumentVersion

_WORD = re.compile(r"[^\W_]+", re.UNICODE)
MASTER = "master"
FLEET = "fleet"
# Content filters: which block types each one keeps. The sample data has no
# warnings, so the warnings filter also keeps cautions.
CONTENT_TYPES = {
    "warnings": frozenset({"warning", "caution"}),
    "procedures": frozenset({"checklist"}),
}


def words(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def word_key(text: str) -> str:
    """Words joined by single spaces, with a space at each end."""
    return f" {' '.join(words(text))} "


def block_text(block: dict) -> str:
    if "segments" in block:
        return "".join(segment["text"] for segment in block["segments"])
    if block["type"] == "list":
        return "\n".join(block["items"])
    if block["type"] == "table":
        return "\n".join(" | ".join(row["cells"]) for row in block["rows"])
    if block["type"] == "checklist":
        return "\n".join(f"{c['challenge']} — {c['response']}" for c in block["checks"])
    return ""


def category_for(applicability: str) -> str:
    """Master documents apply to all fleets; the rest are fleet manuals."""
    return MASTER if applicability.strip().upper() == "ALL" else FLEET


@dataclass(frozen=True)
class Entry:
    doc_id: str
    revision: int
    topic_id: str
    node_id: str
    node_type: str
    number: str
    title: str
    section_number: str
    section_title: str
    text: str
    # " word word word " forms of the title and text, for fast word matching.
    title_key: str = ""
    text_key: str = ""


@dataclass(frozen=True)
class IndexedDocument:
    doc_id: str
    title: str
    doc_type: str
    applicability: str
    category: str
    revision: int
    effective_date: str
    entries: tuple[Entry, ...]

    def topics(self) -> list[dict]:
        """Entries grouped by topic, the compact form used for offline search."""
        grouped: list[dict] = []
        for entry in self.entries:
            if entry.node_type == "topic":
                grouped.append(
                    {
                        "id": entry.topic_id,
                        "number": entry.number,
                        "title": entry.title,
                        "sectionNumber": entry.section_number,
                        "sectionTitle": entry.section_title,
                        "blocks": [],
                    }
                )
            else:
                grouped[-1]["blocks"].append([entry.node_id, entry.node_type, entry.text])
        return grouped

    def summary(self) -> dict:
        return {
            "docId": self.doc_id,
            "title": self.title,
            "docType": self.doc_type,
            "applicability": self.applicability,
            "category": self.category,
            "revision": self.revision,
            "effectiveDate": self.effective_date,
        }


def _index_version(version: DocumentVersion) -> IndexedDocument:
    return _index_cached(version.pk, version.ingested_at.isoformat(), version)


@lru_cache(maxsize=16)
def _index_cached(pk: int, ingested_at: str, version: DocumentVersion) -> IndexedDocument:
    del pk, ingested_at  # Cache key only.
    nodes = list(
        DocumentNode.objects.filter(version=version)
        .order_by("position")
        .values("pk", "node_id", "node_type", "number", "title", "parent_id", "content_blocks")
    )
    sections = {
        node["pk"]: node for node in nodes if node["node_type"] == DocumentNode.NodeType.SECTION
    }
    entries: list[Entry] = []
    for node in nodes:
        if node["node_type"] != DocumentNode.NodeType.TOPIC:
            continue
        section = sections[node["parent_id"]]
        common = {
            "doc_id": version.document_id,
            "revision": version.revision,
            "topic_id": node["node_id"],
            "number": node["number"],
            "title": node["title"],
            "section_number": section["number"],
            "section_title": section["title"],
        }
        title_key = word_key(f"{node['number']} {node['title']}")
        entries.append(
            Entry(
                node_id=node["node_id"],
                node_type="topic",
                text="",
                title_key=title_key,
                text_key=" ",
                **common,
            )
        )
        for block in node["content_blocks"] or ():
            text = block_text(block)
            entries.append(
                Entry(
                    node_id=block["id"],
                    node_type=block["type"],
                    text=text,
                    title_key=title_key,
                    text_key=word_key(text),
                    **common,
                )
            )
    metadata = version.metadata
    applicability = metadata.get("applicability", "")
    return IndexedDocument(
        doc_id=version.document_id,
        title=metadata.get("title", version.document_id),
        doc_type=metadata.get("docType", ""),
        applicability=applicability,
        category=category_for(applicability),
        revision=version.revision,
        effective_date=version.effective_date.isoformat(),
        entries=tuple(entries),
    )


def published_documents() -> list[IndexedDocument]:
    """The current revision of every document, in document ID order."""
    today = revision_status.current_date()
    by_document: dict[str, list[DocumentVersion]] = {}
    for version in DocumentVersion.objects.order_by("document_id", "revision"):
        by_document.setdefault(version.document_id, []).append(version)
    indexed = []
    for versions in by_document.values():
        current = revision_status.current_revision(versions, today)
        if current is not None:
            indexed.append(_index_version(current))
    return indexed


def _term_keys(term: str) -> tuple[str, str]:
    """(match, whole-word match) keys; one-character words match whole words only."""
    whole = f" {term} "
    return (f" {term}" if len(term) > 1 else whole), whole


def text_matches_all(terms: list[str], entry: Entry) -> bool:
    return all(_term_keys(term)[0] in entry.text_key for term in terms)


def score_entry(terms: list[str], entry: Entry) -> int | None:
    """Return the entry's score, or None when some query word is missing.

    With keys of the form " word word ", " term" in a key is a word-prefix
    match and " term " is a whole-word match.
    """
    score = 0
    for term in terms:
        prefix, whole = _term_keys(term)
        in_title = prefix in entry.title_key
        in_text = prefix in entry.text_key
        if not (in_title or in_text):
            return None
        score += (3 if in_title else 0) + (1 if in_text else 0)
        if whole in entry.title_key or whole in entry.text_key:
            score += 1
    if len(terms) > 1:
        phrase = f" {' '.join(terms)} "
        if phrase in entry.title_key or phrase in entry.text_key:
            score += 5
    return score


def _sentence_bounds(text: str, position: int) -> tuple[int, int]:
    """Start and end of the sentence or line around ``position``."""
    stop = text.rfind(". ", 0, position)
    line = text.rfind("\n", 0, position)
    start = max(stop + 2, line + 1) if stop >= 0 else line + 1
    ends = []
    next_stop = text.find(". ", position)
    if next_stop >= 0:
        ends.append(next_stop + 1)
    next_line = text.find("\n", position)
    if next_line >= 0:
        ends.append(next_line)
    return start, min(ends, default=len(text))


def snippet(
    text: str,
    terms: list[str],
    sentence_limit: int = 220,
    before: int = 70,
    after: int = 160,
) -> str:
    """The sentence holding the first matching word, or a window around it.

    A sentence (or list item, or table row) longer than ``sentence_limit`` is
    cut to a window at word boundaries instead.
    """
    if not text:
        return ""
    first = None
    for match in _WORD.finditer(text):
        word = match.group().lower()
        if any(word == term or (len(term) > 1 and word.startswith(term)) for term in terms):
            first = match.start()
            break
    if first is None:
        first = 0
    sentence_start, sentence_end = _sentence_bounds(text, first)
    if sentence_end - sentence_start <= sentence_limit:
        return " ".join(text[sentence_start:sentence_end].split())

    start = max(0, first - before)
    end = min(len(text), first + after)
    if start > 0:
        space = text.find(" ", start)
        start = space + 1 if 0 <= space < first else start
    if end < len(text):
        space = text.rfind(" ", first, end)
        end = space if space > first else end
    excerpt = " ".join(text[start:end].split())
    return f"{'… ' if start > 0 else ''}{excerpt}{' …' if end < len(text) else ''}"


def search(
    query: str,
    documents: list[IndexedDocument],
    *,
    doc_types: set[str] | None = None,
    fleet: str | None = None,
    categories: set[str] | None = None,
    content_types: set[str] | None = None,
    limit: int = 50,
) -> dict:
    terms = list(dict.fromkeys(words(query)))
    block_types = (
        frozenset().union(*(CONTENT_TYPES[name] for name in content_types))
        if content_types
        else None
    )

    def included(document: IndexedDocument) -> bool:
        if doc_types and document.doc_type not in doc_types:
            return False
        if categories and document.category not in categories:
            return False
        # A fleet filter keeps that fleet's manuals and the master documents.
        if fleet and document.category != MASTER and document.applicability != fleet:
            return False
        return True

    best: dict[tuple[str, str], tuple[int, int, Entry, IndexedDocument]] = {}
    counts: dict[tuple[str, str], int] = {}
    first_text: dict[tuple[str, str], str] = {}
    order = 0
    for document in documents:
        if not included(document):
            continue
        for entry in document.entries:
            order += 1
            if entry.node_type != "topic":
                first_text.setdefault((entry.doc_id, entry.topic_id), entry.text)
            if block_types is not None and (
                entry.node_type not in block_types or not text_matches_all(terms, entry)
            ):
                continue
            score = score_entry(terms, entry)
            if score is None:
                continue
            key = (entry.doc_id, entry.topic_id)
            counts[key] = counts.get(key, 0) + 1
            if key not in best or score > best[key][0]:
                best[key] = (score, order, entry, document)

    ranked = sorted(best.values(), key=lambda item: (-item[0], item[1]))
    by_document: dict[str, int] = {}
    for _, _, entry, _ in ranked:
        by_document[entry.doc_id] = by_document.get(entry.doc_id, 0) + 1
    results = []
    for score, _, entry, document in ranked[:limit]:
        results.append(
            {
                "docId": entry.doc_id,
                "docTitle": document.title,
                "docType": document.doc_type,
                "revision": entry.revision,
                "topicId": entry.topic_id,
                "nodeId": entry.node_id,
                "nodeType": entry.node_type,
                "number": entry.number,
                "title": entry.title,
                "section": {"number": entry.section_number, "title": entry.section_title},
                "snippet": snippet(
                    entry.text or first_text.get((entry.doc_id, entry.topic_id), ""), terms
                ),
                "score": score,
                "matchCount": counts[(entry.doc_id, entry.topic_id)],
            }
        )
    return {
        "query": query,
        "terms": terms,
        "total": len(ranked),
        "byDocument": by_document,
        "results": results,
    }
