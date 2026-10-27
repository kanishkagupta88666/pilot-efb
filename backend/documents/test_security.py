"""Regression tests: nobody can change data without being allowed to.

Covers every endpoint that writes: authoring and publishing, annotation sync
and device audit upload. Self-declared identity (headers, body fields, a
session cookie, the browser's origin) must never grant access.
"""

import uuid
from datetime import date
from unittest.mock import patch

from django.test import override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient, APITestCase

from documents.ingestion import ingest_xml
from documents.models import Annotation, AuditEvent, DocumentNode, DocumentVersion, Draft
from documents.test_api import ApiAssertionsMixin
from documents.test_support import AUTHOR, PUBLISHER, WRITE_SETTINGS, make_user
from documents.xml_validation import PROJECT_ROOT

DOC = "/api/documents/FM-S200"
PUBLISH_BODY = {"changeSummary": "Anonymous edit.", "effectiveDate": "2026-12-01"}

# Every route that writes, as (method, url, body).
WRITE_ROUTES = [
    ("post", f"{DOC}/draft/", None),
    ("delete", f"{DOC}/draft/", None),
    ("get", f"{DOC}/draft/", None),
    ("post", f"{DOC}/draft/publish/", PUBLISH_BODY),
    ("post", f"{DOC}/draft/topics/", {"title": "x", "text": "y"}),
    ("patch", f"{DOC}/draft/topics/fm200-t0001/", {"title": "x"}),
    ("delete", f"{DOC}/draft/topics/fm200-t0001/", None),
    ("post", f"{DOC}/draft/topics/fm200-t0001/blocks/", {"type": "para", "text": "x"}),
    ("patch", f"{DOC}/draft/topics/fm200-t0001/blocks/fm200-p00001/", {"text": "x"}),
    ("delete", f"{DOC}/draft/topics/fm200-t0001/blocks/fm200-p00001/", None),
    ("post", "/api/annotations/sync/", {"owner": "Pat Pilot", "changes": []}),
    ("post", "/api/audit/events/", {"events": []}),
]


def call(client, method, url, body=None, **extra):
    return getattr(client, method)(url, body, format="json", **extra)


class SecurityTestCase(ApiAssertionsMixin, APITestCase):
    @classmethod
    def setUpTestData(cls):
        result = ingest_xml(PROJECT_ROOT / "sample-data" / "xml" / "FM-S200_Rev4.xml")
        assert result.success, result.message

    def setUp(self):
        today = patch("documents.revision_status.current_date", return_value=date(2026, 10, 14))
        today.start()
        self.addCleanup(today.stop)

    def assert_nothing_written(self):
        self.assertEqual(Draft.objects.count(), 0)
        self.assertEqual(DocumentVersion.objects.filter(document_id="FM-S200").count(), 1)
        self.assertEqual(Annotation.objects.count(), 0)
        self.assertEqual(AuditEvent.objects.filter(source="device").count(), 0)
        self.assertFalse(AuditEvent.objects.filter(action__startswith="draft.").exists())


class WritesAreOffByDefaultTests(SecurityTestCase):
    """With no setting changed, no write endpoint works for anyone."""

    def test_default_settings_leave_every_write_feature_off(self):
        from django.conf import settings

        for name in WRITE_SETTINGS:
            self.assertFalse(getattr(settings, name), name)

    def test_anonymous_requests_are_refused_on_every_write_route(self):
        for method, url, body in WRITE_ROUTES:
            with self.subTest(route=f"{method} {url}"):
                self.assert_error(call(self.client, method, url, body), 403, "FEATURE_DISABLED")
        self.assert_nothing_written()

    def test_a_signed_in_administrator_is_refused_while_the_feature_is_off(self):
        admin = make_user("root", PUBLISHER)
        admin.is_superuser = True
        admin.save()
        self.client.force_authenticate(admin)
        for method, url, body in WRITE_ROUTES:
            with self.subTest(route=f"{method} {url}"):
                self.assert_error(call(self.client, method, url, body), 403, "FEATURE_DISABLED")
        self.assert_nothing_written()

    def test_anonymous_cannot_publish_a_revision(self):
        response = call(self.client, "post", f"{DOC}/draft/publish/", PUBLISH_BODY)
        self.assertEqual(response.status_code, 403)
        self.assertFalse(DocumentVersion.objects.filter(document_id="FM-S200", revision=5).exists())


@override_settings(**WRITE_SETTINGS)
class UnauthenticatedWritesTests(SecurityTestCase):
    """Features on, but the caller has not proved who they are."""

    def test_anonymous_requests_need_a_token_on_every_write_route(self):
        for method, url, body in WRITE_ROUTES:
            with self.subTest(route=f"{method} {url}"):
                self.assert_error(call(self.client, method, url, body), 401, "AUTHENTICATION_REQUIRED")
        self.assert_nothing_written()

    def test_a_wrong_token_is_refused(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION="Token " + "0" * 40)
        self.assert_error(client.post(f"{DOC}/draft/", format="json"), 401, "AUTHENTICATION_REQUIRED")
        self.assert_nothing_written()

    def test_a_self_declared_identity_is_not_authentication(self):
        headers = {"HTTP_X_EFB_ACTOR": "Chief Pilot", "HTTP_X_EFB_ROLE": "administrator", "HTTP_X_EFB_DEVICE": "ipad-1"}
        for method, url, body in WRITE_ROUTES:
            with self.subTest(route=f"{method} {url}"):
                self.assert_error(call(self.client, method, url, body, **headers), 401, "AUTHENTICATION_REQUIRED")
        self.assert_nothing_written()

    def test_a_same_origin_request_is_not_authentication(self):
        headers = {
            "HTTP_ORIGIN": "http://testserver",
            "HTTP_REFERER": "http://testserver/reader/FM-S200/4",
            "HTTP_HOST": "testserver",
            "HTTP_SEC_FETCH_SITE": "same-origin",
        }
        for method, url, body in WRITE_ROUTES:
            with self.subTest(route=f"{method} {url}"):
                self.assert_error(call(self.client, method, url, body, **headers), 401, "AUTHENTICATION_REQUIRED")
        self.assert_nothing_written()

    def test_a_signed_in_browser_session_is_not_authentication(self):
        user = make_user("sessionuser", PUBLISHER)
        user.set_password("pw")
        user.save()
        self.assertTrue(self.client.login(username="sessionuser", password="pw"))
        self.assert_error(call(self.client, "post", f"{DOC}/draft/"), 401, "AUTHENTICATION_REQUIRED")
        self.assert_nothing_written()

    def test_reading_stays_open_without_a_token(self):
        for url in ("/api/health/", "/api/documents/", "/api/search/index/"):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 200)


@override_settings(**WRITE_SETTINGS)
class AuthorizationTests(SecurityTestCase):
    def client_for(self, username, codenames):
        user = make_user(username, codenames)
        token, _ = Token.objects.get_or_create(user=user)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        return client

    def test_an_account_without_the_draft_permissions_is_refused(self):
        client = self.client_for("pilot", ())
        self.assert_error(client.post(f"{DOC}/draft/", format="json"), 403, "FORBIDDEN")
        self.assert_nothing_written()

    def test_an_author_can_edit_but_cannot_publish(self):
        client = self.client_for("author", AUTHOR)
        self.assertEqual(client.post(f"{DOC}/draft/", format="json").status_code, 201)
        self.assert_error(client.post(f"{DOC}/draft/publish/", PUBLISH_BODY, format="json"), 403, "FORBIDDEN")
        self.assertEqual(DocumentVersion.objects.filter(document_id="FM-S200").count(), 1)

    def test_a_publisher_with_a_real_token_can_publish_and_is_named_in_the_log(self):
        client = self.client_for("publisher", PUBLISHER)
        client.post(f"{DOC}/draft/", format="json", HTTP_X_EFB_ACTOR="Someone else")
        topic = DocumentNode.objects.filter(version__document_id="FM-S200", node_type="topic").order_by("position").first()
        client.patch(f"{DOC}/draft/topics/{topic.node_id}/", {"title": "Renamed"}, format="json")
        response = client.post(f"{DOC}/draft/publish/", {**PUBLISH_BODY, "effectiveDate": "2026-12-01"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(DocumentVersion.objects.filter(document_id="FM-S200", revision=5).exists())
        event = AuditEvent.objects.get(action="revision.published")
        self.assertEqual((event.actor, event.actor_role), ("publisher", "administrator"))

    def test_annotation_sync_ignores_the_owner_in_the_body(self):
        mine = {
            "id": str(uuid.uuid4()), "kind": "highlight", "documentId": "FM-S200", "revision": 4,
            "topicId": "t", "topicNumber": "1", "nodeId": "n", "start": 0, "end": 3, "quote": "abc",
            "anchorText": "abc", "note": "", "createdAt": "2026-10-16T09:00:00Z", "updatedAt": "2026-10-16T09:00:00Z",
        }
        pat = self.client_for("pat", ())
        pat.post("/api/annotations/sync/", {"owner": "mallory", "changes": [mine]}, format="json")
        self.assertEqual(Annotation.objects.get().owner, "pat")
        # Someone else naming "pat" as the owner reads nothing of Pat's.
        mallory = self.client_for("mallory", ())
        body = mallory.post("/api/annotations/sync/", {"owner": "pat", "changes": []}, format="json").json()
        self.assertEqual(body["annotations"], [])

    def test_a_forged_audit_actor_cannot_be_written(self):
        client = self.client_for("pat", ())
        event = {
            "id": str(uuid.uuid4()), "action": "document.opened", "occurredAt": "2026-10-14T09:30:00Z",
            "actor": "Chief Pilot", "actorRole": "administrator", "deviceId": "d1",
        }
        client.post("/api/audit/events/", {"events": [event]}, format="json")
        stored = AuditEvent.objects.get(event_id=event["id"])
        self.assertEqual((stored.actor, stored.actor_role), ("pat", "pilot"))


AUDIT_READS = ["/api/audit/events/", "/api/audit/events/?documentId=FM-S200&limit=5", "/api/audit/verify/"]


class AuditLogReadTests(SecurityTestCase):
    """The audit log names people and what they did, so reading it needs permission."""

    def setUp(self):
        super().setUp()
        from documents import audit

        audit.record("document.ingested", document_id="FM-S200", revision=4)

    def test_anonymous_callers_cannot_read_the_audit_log(self):
        for url in AUDIT_READS:
            with self.subTest(url=url):
                self.assert_error(self.client.get(url), 401, "AUTHENTICATION_REQUIRED")

    def test_anonymous_callers_cannot_read_it_even_with_write_features_off_or_on(self):
        for enabled in (False, True):
            with override_settings(**{name: enabled for name in WRITE_SETTINGS}):
                for url in AUDIT_READS:
                    with self.subTest(url=url, enabled=enabled):
                        self.assertEqual(self.client.get(url).status_code, 401)

    def test_a_wrong_token_is_refused(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION="Token " + "0" * 40)
        for url in AUDIT_READS:
            with self.subTest(url=url):
                self.assert_error(client.get(url), 401, "AUTHENTICATION_REQUIRED")

    def test_identity_headers_a_cookie_session_and_other_permissions_do_not_help(self):
        headers = {"HTTP_X_EFB_ACTOR": "Chief Pilot", "HTTP_X_EFB_ROLE": "administrator"}
        for url in AUDIT_READS:
            self.assert_error(self.client.get(url, **headers), 401, "AUTHENTICATION_REQUIRED")
        user = make_user("sessionuser", ("view_auditevent",))
        user.set_password("pw")
        user.save()
        self.client.login(username="sessionuser", password="pw")
        self.assert_error(self.client.get(AUDIT_READS[0]), 401, "AUTHENTICATION_REQUIRED")

    def test_an_account_without_the_audit_permission_is_refused(self):
        # Even a publisher cannot read the log without the explicit permission.
        self.client.force_authenticate(make_user("publisher", PUBLISHER))
        for url in AUDIT_READS:
            with self.subTest(url=url):
                self.assert_error(self.client.get(url), 403, "FORBIDDEN")

    def test_an_account_with_the_permission_can_read_it(self):
        self.client.force_authenticate(make_user("auditor", ("view_auditevent",)))
        body = self.assert_json(self.client.get("/api/audit/events/"))
        self.assertEqual(body["events"][0]["action"], "document.ingested")
        self.assertTrue(self.assert_json(self.client.get("/api/audit/verify/"))["intact"])
