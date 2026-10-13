"""Compare two stored revisions of one document by permanent node ID.

The comparison never looks at numbers, titles or page positions to decide
identity: a node is the same node in both revisions exactly when its ID is the
same. Numbers are only reported, so a reader can show where a node used to be.

The topic and block lists follow the shape of the client's revision keys in
``sample-data/revision-keys/``, so a change manifest published later by the
document management system can replace this computation without changing the
API that serves it.
"""

from dataclasses import dataclass
import difflib
from functools import lru_cache
import json
import re

from documents.models import DocumentNode, DocumentVersion

UNCHANGED = "unchanged"
MODIFIED = "modified"
ADDED = "added"
REMOVED = "removed"
MOVED = "moved"

_WORD_PATTERN = re.compile(r"\S+\s*|\s+")


@dataclass(frozen=True)
class _Section:
    id: str
    number: str
    title: str
    chapter_id: str


@dataclass(frozen=True)
class _Topic:
    id: str
    number: str
    title: str
    position: int
    section: _Section
    blocks: tuple[dict, ...]


@dataclass(frozen=True)
class _Snapshot:
    version: DocumentVersion
    topics: dict[str, _Topic]
    # Block ID -> (topic ID, block). Checklist check IDs are not listed here:
    # a changed check makes its whole checklist block modified.
    blocks: dict[str, tuple[str, dict]]


def _load(version: DocumentVersion) -> _Snapshot:
    # The ingestion time is part of the key: a revision replaced with
    # ``ingest_xml --replace`` is a new row with a new time, never a stale hit.
    return _load_cached(version.pk, version.ingested_at.isoformat(), version)


@lru_cache(maxsize=8)
def _load_cached(pk: int, ingested_at: str, version: DocumentVersion) -> _Snapshot:
    del pk, ingested_at  # Cache key only.
    nodes = list(
        DocumentNode.objects.filter(version=version)
        .order_by("position")
        .values(
            "pk",
            "node_id",
            "node_type",
            "number",
            "title",
            "parent_id",
            "position",
            "content_blocks",
        )
    )
    by_pk = {node["pk"]: node for node in nodes}
    sections: dict[int, _Section] = {}
    for node in nodes:
        if node["node_type"] == DocumentNode.NodeType.SECTION:
            sections[node["pk"]] = _Section(
                id=node["node_id"],
                number=node["number"],
                title=node["title"],
                chapter_id=by_pk[node["parent_id"]]["node_id"],
            )

    topics: dict[str, _Topic] = {}
    blocks: dict[str, tuple[str, dict]] = {}
    for node in nodes:
        if node["node_type"] != DocumentNode.NodeType.TOPIC:
            continue
        topic_blocks = tuple(node["content_blocks"] or ())
        topics[node["node_id"]] = _Topic(
            id=node["node_id"],
            number=node["number"],
            title=node["title"],
            position=node["position"],
            section=sections[node["parent_id"]],
            blocks=topic_blocks,
        )
        for block in topic_blocks:
            blocks[block["id"]] = (node["node_id"], block)
    return _Snapshot(version=version, topics=topics, blocks=blocks)


def block_signature(block: dict) -> str:
    """Return a canonical form of a block for change detection.

    A cross reference is identified by its target ID only. Its display text
    carries the target's number, which changes whenever the target is
    renumbered, and that is not a change to the referring block.
    """
    if "segments" in block:
        block = {
            **block,
            "segments": [
                {"type": "xref", "targetId": segment["targetId"]}
                if segment["type"] == "xref"
                else segment
                for segment in block["segments"]
            ],
        }
    return json.dumps(block, sort_keys=True, ensure_ascii=False)


def block_text(block: dict) -> str:
    """Return the readable text of a block, for word-level comparison."""
    block_type = block["type"]
    if "segments" in block:
        return "".join(segment["text"] for segment in block["segments"])
    if block_type == "list":
        return "\n".join(block["items"])
    if block_type == "table":
        return "\n".join(" | ".join(row["cells"]) for row in block["rows"])
    if block_type == "checklist":
        return "\n".join(
            f"{check['challenge']} — {check['response']}" for check in block["checks"]
        )
    return ""


def word_diff(old: str, new: str) -> list[dict[str, str]]:
    """Split two texts into equal, deleted and inserted runs of words."""
    old_words = _WORD_PATTERN.findall(old)
    new_words = _WORD_PATTERN.findall(new)
    runs: list[dict[str, str]] = []

    def add(op: str, words: list[str]) -> None:
        text = "".join(words)
        if not text:
            return
        if runs and runs[-1]["op"] == op:
            runs[-1]["text"] += text
        else:
            runs.append({"op": op, "text": text})

    matcher = difflib.SequenceMatcher(a=old_words, b=new_words, autojunk=False)
    for tag, old_start, old_end, new_start, new_end in matcher.get_opcodes():
        if tag == "equal":
            add("equal", old_words[old_start:old_end])
            continue
        add("delete", old_words[old_start:old_end])
        add("insert", new_words[new_start:new_end])
    return runs


def _topic_summary(topic: _Topic) -> dict:
    return {
        "id": topic.id,
        "number": topic.number,
        "title": topic.title,
        "sectionId": topic.section.id,
        "chapterId": topic.section.chapter_id,
    }


def _topic_changed(old: _Topic, new: _Topic) -> bool:
    return old.title != new.title or [block_signature(b) for b in old.blocks] != [
        block_signature(b) for b in new.blocks
    ]


def compare_versions(old_version: DocumentVersion, new_version: DocumentVersion) -> dict:
    """Return the change manifest between two revisions of one document."""
    old, new = _load(old_version), _load(new_version)

    added = [new.topics[i] for i in new.topics if i not in old.topics]
    removed = [old.topics[i] for i in old.topics if i not in new.topics]
    common = [i for i in new.topics if i in old.topics]
    moved = [
        i for i in common if old.topics[i].section.id != new.topics[i].section.id
    ]
    modified = [i for i in common if _topic_changed(old.topics[i], new.topics[i])]

    block_added = [i for i in new.blocks if i not in old.blocks]
    block_removed = [i for i in old.blocks if i not in new.blocks]
    block_modified = [
        i
        for i in new.blocks
        if i in old.blocks
        and block_signature(old.blocks[i][1]) != block_signature(new.blocks[i][1])
    ]

    return {
        "docId": new_version.document_id,
        "fromRevision": old_version.revision,
        "toRevision": new_version.revision,
        "summary": {
            MODIFIED: len(modified),
            ADDED: len(added),
            REMOVED: len(removed),
            MOVED: len(moved),
        },
        "topics": {
            ADDED: [_topic_summary(topic) for topic in added],
            REMOVED: [_topic_summary(topic) for topic in removed],
            MOVED: [
                {
                    **_topic_summary(new.topics[i]),
                    "from": old.topics[i].number,
                    "to": new.topics[i].number,
                    "fromSectionId": old.topics[i].section.id,
                }
                for i in moved
            ],
            MODIFIED: [_topic_summary(new.topics[i]) for i in modified],
        },
        "blocks": {
            ADDED: block_added,
            REMOVED: block_removed,
            MODIFIED: block_modified,
        },
    }


def _block_entry(status: str, previous: dict | None, current: dict | None) -> dict:
    block = current or previous
    entry = {
        "id": block["id"],
        "type": block["type"],
        "status": status,
        "previous": previous,
        "current": current,
    }
    if status == MODIFIED:
        entry["diff"] = word_diff(block_text(previous), block_text(current))
    return entry


def _merge_blocks(old_topic: _Topic | None, new_topic: _Topic | None) -> list[dict]:
    """List the blocks of one topic in reading order, removed ones included.

    Current blocks keep their order. A removed block is placed after the
    nearest block that preceded it in the old revision and still exists.
    """
    old_blocks = {block["id"]: block for block in old_topic.blocks} if old_topic else {}
    new_blocks = new_topic.blocks if new_topic else ()
    new_ids = {block["id"] for block in new_blocks}

    removed_after: dict[str | None, list[dict]] = {}
    anchor: str | None = None
    for block in old_topic.blocks if old_topic else ():
        if block["id"] in new_ids:
            anchor = block["id"]
        else:
            removed_after.setdefault(anchor, []).append(
                _block_entry(REMOVED, block, None)
            )

    entries = list(removed_after.get(None, []))
    for block in new_blocks:
        previous = old_blocks.get(block["id"])
        if previous is None:
            status = ADDED
        elif block_signature(previous) != block_signature(block):
            status = MODIFIED
        else:
            status = UNCHANGED
        entries.append(_block_entry(status, previous, block))
        entries.extend(removed_after.get(block["id"], []))
    return entries


def _topic_status(old_topic: _Topic | None, new_topic: _Topic | None) -> list[str]:
    if old_topic is None:
        return [ADDED]
    if new_topic is None:
        return [REMOVED]
    statuses = []
    if old_topic.section.id != new_topic.section.id:
        statuses.append(MOVED)
    if _topic_changed(old_topic, new_topic):
        statuses.append(MODIFIED)
    return statuses or [UNCHANGED]


def _section_payload(section: _Section) -> dict:
    return {"id": section.id, "number": section.number, "title": section.title}


def _topic_payload(topic: _Topic | None) -> dict | None:
    if topic is None:
        return None
    return {
        "id": topic.id,
        "number": topic.number,
        "title": topic.title,
        "section": _section_payload(topic.section),
        "chapterId": topic.section.chapter_id,
    }


def _removed_after(old: _Snapshot, new: _Snapshot, topic_id: str) -> list[dict]:
    """Return topics removed from the old revision right after ``topic_id``.

    A removed topic is shown after the nearest earlier topic of its old
    section that still exists, so a reader can mark the gap where it was.
    """
    if topic_id not in old.topics:
        return []
    section_id = old.topics[topic_id].section.id
    siblings = sorted(
        (t for t in old.topics.values() if t.section.id == section_id),
        key=lambda topic: topic.position,
    )
    result: list[dict] = []
    anchor: str | None = None
    for sibling in siblings:
        if sibling.id in new.topics:
            anchor = sibling.id
        elif anchor == topic_id:
            result.append(
                {
                    **_topic_payload(sibling),
                    "status": [REMOVED],
                    "blocks": _merge_blocks(sibling, None),
                }
            )
    return result


def compare_node(
    old_version: DocumentVersion,
    new_version: DocumentVersion,
    node_id: str,
) -> dict | None:
    """Compare the topic that holds ``node_id`` across two revisions.

    ``node_id`` may be a topic ID or a block ID. The topic is looked up in the
    new revision first, then in the old one, so a node that was removed still
    returns its previous text. Returns None when neither revision has it.
    """
    old, new = _load(old_version), _load(new_version)
    topic_id = None
    for snapshot in (new, old):
        if node_id in snapshot.topics:
            topic_id = node_id
            break
        if node_id in snapshot.blocks:
            topic_id = snapshot.blocks[node_id][0]
            break
    if topic_id is None:
        return None

    old_topic, new_topic = old.topics.get(topic_id), new.topics.get(topic_id)
    return {
        "docId": new_version.document_id,
        "fromRevision": old_version.revision,
        "toRevision": new_version.revision,
        "nodeId": node_id,
        "topicId": topic_id,
        "status": _topic_status(old_topic, new_topic),
        "previous": _topic_payload(old_topic),
        "current": _topic_payload(new_topic),
        "blocks": _merge_blocks(old_topic, new_topic),
        "removedTopicsAfter": _removed_after(old, new, topic_id),
    }
