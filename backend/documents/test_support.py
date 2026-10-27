"""Shared helpers for tests of the endpoints that write data."""

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import override_settings

WRITE_SETTINGS = {
    "EFB_AUTHORING_ENABLED": True,
    "EFB_ANNOTATION_SYNC_ENABLED": True,
    "EFB_DEVICE_AUDIT_ENABLED": True,
}
AUTHOR = ("view_draft", "add_draft", "change_draft", "delete_draft")
PUBLISHER = (*AUTHOR, "add_documentversion")


def make_user(username: str, codenames: tuple[str, ...] = ()):
    user, _ = get_user_model().objects.get_or_create(username=username)
    user.user_permissions.set(Permission.objects.filter(content_type__app_label="documents", codename__in=codenames))
    return user


class WriteAccessMixin:
    """Switch the write endpoints on and sign the test client in as a publisher."""

    username = "Ada Author"
    codenames = PUBLISHER

    def setUp(self):
        super().setUp()
        override = override_settings(**WRITE_SETTINGS)
        override.enable()
        self.addCleanup(override.disable)
        self.sign_in(self.username, self.codenames)

    def sign_in(self, username: str, codenames: tuple[str, ...] = ()):
        user = make_user(username, codenames)
        self.client.force_authenticate(user)
        return user
