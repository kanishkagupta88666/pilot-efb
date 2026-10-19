"""Append-only audit log: who did what, to which document, and when.

Two sources write to it:

* The server records what it does itself: every authoring action (with the
  text before and after an edit), every publish, every document loaded.
* Devices record what a pilot did (which revision was open, deep links,
  searches, offline use). A device queues its events while offline and sends
  them when it is back online. Each event carries a unique ID chosen on the
  device, so a resend is stored once; ``occurred_at`` is the device's time,
  ``received_at`` the server's.

Integrity: entries are numbered without gaps and each stores the SHA-256 of
its content together with the previous entry's hash. ``verify_chain`` walks
the log and reports the first entry that was changed, removed or inserted
outside the application.

Identity: there is no sign-in yet, so the actor is what the device declares
(name and role) plus a device ID. Treat it as unverified until SSO exists.
"""

from datetime import UTC, datetime, timedelta
import hashlib
import json
import uuid

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from documents.models import AuditEvent

GENESIS = "0" * 64
SYSTEM_ACTOR = "System"
MAX_BATCH = 200
MAX_DETAILS_BYTES = 8000
# A device clock this far ahead of the server is not believed.
MAX_CLOCK_SKEW = timedelta(minutes=10)

ROLES = ("pilot", "author", "reviewer", "administrator", "system", "")

# Actions a device may report. Server actions are written only by the server.
DEVICE_ACTIONS = {
    "document.opened": "Opened a document topic",
    "deeplink.opened": "Followed a deep link",
    "search.performed": "Searched",
    "search.index_saved": "Saved the search index for offline use",
    "revision.compared": "Opened a revision comparison",
    "change.inspected": "Opened a change panel",
    "pdf.viewed": "Opened the PDF print view",
    "connectivity.offline": "Device went offline",
    "connectivity.online": "Device came back online",
    "profile.changed": "Changed the name or role used on this device",
    # Annotations are private: only the kind and where, never the text.
    "annotation.added": "Added a highlight, note or bookmark",
    "annotation.removed": "Removed a highlight, note or bookmark",
}
SERVER_ACTIONS = {
    "draft.started": "Started a draft",
    "draft.discarded": "Discarded a draft",
    "block.added": "Added a block to a draft",
    "block.edited": "Edited a block in a draft",
    "block.deleted": "Deleted a block from a draft",
    "topic.added": "Added a topic to a draft",
    "topic.renamed": "Renamed a topic in a draft",
    "topic.deleted": "Deleted a topic from a draft",
    "revision.published": "Published a revision",
    "document.ingested": "Loaded a document revision",
}
ACTIONS = {**DEVICE_ACTIONS, **SERVER_ACTIONS}


class AuditError(ValueError):
    """A device event that cannot be stored."""


def _instant(value: datetime) -> datetime:
    """UTC, to the millisecond: the form stored and hashed, whatever the device sent."""
    value = value.astimezone(UTC)
    return value.replace(microsecond=(value.microsecond // 1000) * 1000)


def _canonical(fields: dict) -> str:
    return json.dumps(fields, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def _content(event: AuditEvent) -> dict:
    """Everything the hash covers: the whole entry except the hashes."""
    return {
        "event_id": str(event.event_id),
        "sequence": event.sequence,
        "occurred_at": _instant(event.occurred_at).isoformat(),
        "received_at": _instant(event.received_at).isoformat(),
        "source": event.source,
        "action": event.action,
        "actor": event.actor,
        "actor_role": event.actor_role,
        "device_id": event.device_id,
        "document_id": event.document_id,
        "revision": event.revision,
        "node_id": event.node_id,
        "details": event.details,
        "recorded_offline": event.recorded_offline,
    }


def _hash(previous_hash: str, event: AuditEvent) -> str:
    return hashlib.sha256(f"{previous_hash}\n{_canonical(_content(event))}".encode()).hexdigest()


def _append(event: AuditEvent) -> AuditEvent:
    """Number, chain and store one event. Call inside a transaction."""
    last = AuditEvent.objects.select_for_update().order_by("-sequence").first()
    event.sequence = (last.sequence + 1) if last else 1
    event.previous_hash = last.hash if last else GENESIS
    event.received_at = _instant(timezone.now())
    event.hash = _hash(event.previous_hash, event)
    event.save()
    return event


def record(
    action: str,
    *,
    actor: str = SYSTEM_ACTOR,
    actor_role: str = "system",
    device_id: str = "",
    document_id: str = "",
    revision: int | None = None,
    node_id: str = "",
    details: dict | None = None,
) -> AuditEvent:
    """Record something the server itself did."""
    if action not in SERVER_ACTIONS:
        raise ValueError(f"Unknown server audit action {action!r}.")
    now = _instant(timezone.now())
    with transaction.atomic():
        return _append(
            AuditEvent(
                event_id=uuid.uuid4(),
                occurred_at=now,
                source=AuditEvent.Source.SERVER,
                action=action,
                actor=(actor or SYSTEM_ACTOR)[:120],
                actor_role=actor_role if actor_role in ROLES else "",
                device_id=device_id[:64],
                document_id=document_id,
                revision=revision,
                node_id=node_id,
                details=details or {},
            )
        )


def _text(value, label: str, limit: int, required: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise AuditError(f"{label} must be text.")
    value = value.strip()
    if required and not value:
        raise AuditError(f"{label} is required.")
    if len(value) > limit:
        raise AuditError(f"{label} must be at most {limit} characters.")
    return value


def _device_event(payload: dict) -> AuditEvent:
    if not isinstance(payload, dict):
        raise AuditError("Each event must be a JSON object.")
    try:
        event_id = uuid.UUID(str(payload.get("id")))
    except ValueError as error:
        raise AuditError("id must be a UUID.") from error
    action = _text(payload.get("action"), "action", 64, required=True)
    if action not in DEVICE_ACTIONS:
        raise AuditError(f"Unknown action {action!r}.")
    occurred = parse_datetime(str(payload.get("occurredAt") or ""))
    if occurred is None or occurred.tzinfo is None:
        raise AuditError("occurredAt must be an ISO date and time with a time zone.")
    if occurred > timezone.now() + MAX_CLOCK_SKEW:
        raise AuditError("occurredAt is in the future.")
    revision = payload.get("revision")
    if revision is not None and (not isinstance(revision, int) or isinstance(revision, bool) or revision < 0):
        raise AuditError("revision must be a whole number.")
    details = payload.get("details") or {}
    if not isinstance(details, dict):
        raise AuditError("details must be a JSON object.")
    if len(_canonical(details).encode()) > MAX_DETAILS_BYTES:
        raise AuditError("details are too large.")
    role = _text(payload.get("actorRole"), "actorRole", 32)
    if role not in ROLES or role == "system":
        raise AuditError("actorRole is not a known role.")
    occurred = _instant(occurred)
    return AuditEvent(
        event_id=event_id,
        occurred_at=occurred,
        source=AuditEvent.Source.DEVICE,
        action=action,
        actor=_text(payload.get("actor"), "actor", 120) or "Unidentified user",
        actor_role=role,
        device_id=_text(payload.get("deviceId"), "deviceId", 64, required=True),
        document_id=_text(payload.get("documentId"), "documentId", 128),
        revision=revision,
        node_id=_text(payload.get("nodeId"), "nodeId", 128),
        details=details,
        recorded_offline=bool(payload.get("recordedOffline")),
    )


def receive_device_events(events) -> dict:
    """Store a batch from a device. Already-stored IDs are reported, not stored again."""
    if not isinstance(events, list):
        raise AuditError("events must be a list.")
    if len(events) > MAX_BATCH:
        raise AuditError(f"Send at most {MAX_BATCH} events at a time.")
    accepted: list[str] = []
    duplicates: list[str] = []
    rejected: list[dict] = []
    # Oldest first, so the log reads in the order things happened on the device.
    parsed: list[AuditEvent] = []
    for payload in events:
        try:
            parsed.append(_device_event(payload))
        except AuditError as error:
            rejected.append({"id": str((payload or {}).get("id", "")) if isinstance(payload, dict) else "", "reason": str(error)})
    parsed.sort(key=lambda event: event.occurred_at)
    with transaction.atomic():
        known = set(
            AuditEvent.objects.filter(event_id__in=[e.event_id for e in parsed]).values_list("event_id", flat=True)
        )
        for event in parsed:
            if event.event_id in known:
                duplicates.append(str(event.event_id))
                continue
            _append(event)
            known.add(event.event_id)
            accepted.append(str(event.event_id))
    return {"accepted": accepted, "duplicates": duplicates, "rejected": rejected}


def serialize(event: AuditEvent) -> dict:
    return {
        "id": str(event.event_id),
        "sequence": event.sequence,
        "occurredAt": event.occurred_at.isoformat(),
        "receivedAt": event.received_at.isoformat(),
        "source": event.source,
        "action": event.action,
        "description": ACTIONS.get(event.action, event.action),
        "actor": event.actor,
        "actorRole": event.actor_role,
        "deviceId": event.device_id,
        "documentId": event.document_id,
        "revision": event.revision,
        "nodeId": event.node_id,
        "details": event.details,
        "recordedOffline": event.recorded_offline,
    }


def verify_chain() -> dict:
    """Check every entry, oldest first. Reports the first problem found."""
    previous = GENESIS
    expected_sequence = 1
    count = 0
    for event in AuditEvent.objects.order_by("sequence").iterator():
        if event.sequence != expected_sequence:
            return {"intact": False, "checked": count, "problemAt": expected_sequence,
                    "problem": f"Entry {expected_sequence} is missing."}
        if event.previous_hash != previous or event.hash != _hash(previous, event):
            return {"intact": False, "checked": count, "problemAt": event.sequence,
                    "problem": f"Entry {event.sequence} was changed after it was recorded."}
        previous = event.hash
        expected_sequence += 1
        count += 1
    return {"intact": True, "checked": count, "problemAt": None, "problem": None}


def parse_bound(value: str | None, label: str) -> datetime | None:
    if not value:
        return None
    parsed = parse_datetime(value)
    if parsed is None:
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError as error:
            raise AuditError(f"{label} must be an ISO date or date and time.") from error
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


def actor_from_request(request) -> dict:
    """The self-declared user sent by the reader with each change (unverified)."""
    role = (request.headers.get("X-EFB-Role") or "").strip().lower()
    return {
        "actor": (request.headers.get("X-EFB-Actor") or "").strip()[:120] or "Unidentified user",
        "actor_role": role if role in ROLES and role != "system" else "",
        "device_id": (request.headers.get("X-EFB-Device") or "").strip()[:64],
    }
