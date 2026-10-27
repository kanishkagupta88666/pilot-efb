from datetime import date, timedelta
from unittest.mock import patch
import uuid

from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework.test import APITestCase

from documents import audit
from documents.ingestion import ingest_xml
from documents.models import AuditEvent, DocumentNode
from documents.test_api import ApiAssertionsMixin
from documents.test_support import WriteAccessMixin, make_user
from documents.xml_validation import PROJECT_ROOT

EVENTS = "/api/audit/events/"


def device_event(**overrides) -> dict:
    event = {
        "id": str(uuid.uuid4()),
        "action": "document.opened",
        "occurredAt": "2026-10-14T09:30:00-05:00",
        "actor": "Pat Pilot",
        "actorRole": "pilot",
        "deviceId": "device-1",
        "documentId": "FM-S100",
        "revision": 2,
        "nodeId": "fm100-t0001",
        "details": {"status": "current"},
        "recordedOffline": True,
    }
    event.update(overrides)
    return event


class AuditChainTests(ApiAssertionsMixin, APITestCase):
    def test_server_events_are_numbered_and_chained(self):
        first = audit.record("document.ingested", document_id="A", revision=1)
        second = audit.record("document.ingested", document_id="B", revision=1)
        self.assertEqual((first.sequence, second.sequence), (1, 2))
        self.assertEqual(first.previous_hash, audit.GENESIS)
        self.assertEqual(second.previous_hash, first.hash)
        self.assertEqual(audit.verify_chain(), {"intact": True, "checked": 2, "problemAt": None, "problem": None})

    def test_entries_cannot_be_changed_or_deleted_through_the_application(self):
        event = audit.record("document.ingested", document_id="A")
        event.actor = "Someone else"
        with self.assertRaises(ValidationError):
            event.save()
        with self.assertRaises(ValidationError):
            event.delete()

    def test_changes_behind_the_applications_back_are_detected(self):
        audit.record("document.ingested", document_id="A")
        second = audit.record("document.ingested", document_id="B")
        audit.record("document.ingested", document_id="C")
        AuditEvent.objects.filter(pk=second.pk).update(document_id="TAMPERED")
        result = audit.verify_chain()
        self.assertFalse(result["intact"])
        self.assertEqual(result["problemAt"], 2)

    def test_removed_entries_are_detected(self):
        audit.record("document.ingested", document_id="A")
        second = audit.record("document.ingested", document_id="B")
        audit.record("document.ingested", document_id="C")
        AuditEvent.objects.filter(pk=second.pk)._raw_delete(AuditEvent.objects.db)
        result = audit.verify_chain()
        self.assertFalse(result["intact"])
        self.assertIn("missing", result["problem"])

    def test_verify_endpoint(self):
        audit.record("document.ingested", document_id="A")
        self.client.force_authenticate(make_user("auditor", ("view_auditevent",)))
        self.assertTrue(self.assert_json(self.client.get("/api/audit/verify/"))["intact"])


class DeviceEventTests(WriteAccessMixin, ApiAssertionsMixin, APITestCase):
    codenames = ("view_auditevent",)
    username = "Pat Pilot"

    def test_offline_events_are_stored_once_even_if_resent(self):
        events = [device_event(), device_event(action="search.performed", details={"query": "anti-ice"})]
        first = self.assert_json(self.client.post(EVENTS, {"events": events}, format="json"))
        self.assertEqual(len(first["accepted"]), 2)
        again = self.assert_json(self.client.post(EVENTS, {"events": events}, format="json"))
        self.assertEqual((again["accepted"], len(again["duplicates"])), ([], 2))
        self.assertEqual(AuditEvent.objects.count(), 2)
        stored = AuditEvent.objects.get(event_id=events[0]["id"])
        self.assertTrue(stored.recorded_offline)
        self.assertEqual(stored.source, "device")
        # The device's time is kept (converted to UTC); the server's receipt time is separate.
        self.assertEqual(stored.occurred_at.isoformat(), "2026-10-14T14:30:00+00:00")
        self.assertTrue(audit.verify_chain()["intact"])

    def test_events_are_stored_in_the_order_they_happened(self):
        later = device_event(occurredAt="2026-10-14T10:00:00Z")
        earlier = device_event(occurredAt="2026-10-14T08:00:00Z")
        self.client.post(EVENTS, {"events": [later, earlier]}, format="json")
        ordered = list(AuditEvent.objects.order_by("sequence").values_list("event_id", flat=True))
        self.assertEqual([str(e) for e in ordered], [earlier["id"], later["id"]])

    def test_invalid_events_are_rejected_with_a_reason(self):
        future = (timezone.now() + timedelta(days=1)).isoformat()
        body = self.assert_json(
            self.client.post(
                EVENTS,
                {"events": [
                    device_event(id="not-a-uuid"),
                    device_event(action="revision.published"),  # server-only
                    device_event(occurredAt=future),
                    device_event(deviceId=""),
                    device_event(),
                ]},
                format="json",
            )
        )
        self.assertEqual(len(body["accepted"]), 1)
        self.assertEqual(len(body["rejected"]), 4)
        self.assertTrue(all(r["reason"] for r in body["rejected"]))

    def test_the_actor_is_the_signed_in_account_not_what_the_event_says(self):
        forged = device_event(actor="Chief Pilot", actorRole="administrator")
        self.assert_json(self.client.post(EVENTS, {"events": [forged]}, format="json"))
        stored = AuditEvent.objects.get(event_id=forged["id"])
        self.assertEqual((stored.actor, stored.actor_role), ("Pat Pilot", "pilot"))

    def test_batch_limits(self):
        self.assert_error(self.client.post(EVENTS, {"events": "x"}, format="json"), 400, "INVALID_REQUEST")
        too_many = [device_event() for _ in range(audit.MAX_BATCH + 1)]
        self.assert_error(self.client.post(EVENTS, {"events": too_many}, format="json"), 400, "INVALID_REQUEST")

    def test_listing_filters_and_pages_newest_first(self):
        self.client.post(
            EVENTS,
            {"events": [device_event(documentId="FM-S100")]},
            format="json",
        )
        self.sign_in("Alex", ("view_auditevent",))
        self.client.post(EVENTS, {"events": [device_event(documentId="FOM")]}, format="json")
        audit.record("document.ingested", document_id="FM-S100")
        body = self.assert_json(self.client.get(f"{EVENTS}?documentId=FM-S100&limit=1"))
        self.assertEqual(body["events"][0]["action"], "document.ingested")
        self.assertIsNotNone(body["nextBefore"])
        older = self.assert_json(self.client.get(f"{EVENTS}?documentId=FM-S100&before={body['nextBefore']}"))
        self.assertEqual([e["action"] for e in older["events"]], ["document.opened"])
        self.assertEqual(len(self.assert_json(self.client.get(f"{EVENTS}?actor=alex"))["events"]), 1)
        self.assert_error(self.client.get(f"{EVENTS}?since=yesterday"), 400, "INVALID_REQUEST")


class AuthoringAuditTests(WriteAccessMixin, ApiAssertionsMixin, APITestCase):
    HEADERS = {"HTTP_X_EFB_ACTOR": "Ada Author", "HTTP_X_EFB_ROLE": "author", "HTTP_X_EFB_DEVICE": "ipad-7"}

    @classmethod
    def setUpTestData(cls):
        ingest_xml(PROJECT_ROOT / "sample-data" / "xml" / "FM-S200_Rev4.xml")
        cls.topic = DocumentNode.objects.filter(version__document_id="FM-S200", node_type="topic").order_by("position").first()

    def setUp(self):
        super().setUp()
        today = patch("documents.revision_status.current_date", return_value=date(2026, 10, 14))
        today.start()
        self.addCleanup(today.stop)

    def test_authoring_actions_are_logged_with_who_and_what(self):
        base = "/api/documents/FM-S200/draft/"
        self.client.post(base, **self.HEADERS)
        block = next(b for b in self.topic.content_blocks if b["type"] == "para")
        url = f"{base}topics/{self.topic.node_id}/blocks/{block['id']}/"
        self.client.patch(url, {"text": "New wording."}, format="json", **self.HEADERS)
        self.client.post(
            f"{base}publish/", {"changeSummary": "Reworded.", "effectiveDate": "2026-10-14"}, format="json", **self.HEADERS
        )
        events = list(AuditEvent.objects.order_by("sequence"))
        self.assertEqual([e.action for e in events], ["draft.started", "block.edited", "revision.published"])
        edited = events[1]
        self.assertEqual((edited.actor, edited.actor_role, edited.device_id), ("Ada Author", "administrator", "ipad-7"))
        self.assertEqual(edited.details["after"]["text"], "New wording.")
        self.assertEqual(edited.details["before"]["text"], "".join(s["text"] for s in block["segments"]))
        self.assertEqual(events[2].revision, 5)
        self.assertEqual(events[2].details["changeSummary"], "Reworded.")
        self.assertTrue(audit.verify_chain()["intact"])

    def test_refused_actions_are_not_logged(self):
        self.client.post("/api/documents/FM-S200/draft/", **self.HEADERS)
        self.client.post(
            "/api/documents/FM-S200/draft/publish/",
            {"changeSummary": "x", "effectiveDate": "2026-10-14"},
            format="json",
            **self.HEADERS,
        )
        self.assertEqual(list(AuditEvent.objects.values_list("action", flat=True)), ["draft.started"])
