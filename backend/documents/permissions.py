"""Who may change data through the API.

Reading stays open (the prototype serves synthetic manuals). Every endpoint
that writes is switched off unless its setting is turned on, and even then it
needs a real account: a DRF token issued with ``manage.py drf_create_token
<username>``. Who the caller says they are (the ``X-EFB-*`` headers, a name in
the request body, or a name kept in the browser) is never used to decide
access.

Prototype limits: tokens are shared secrets, there is no sign-in screen that
issues them, and roles come from Django permissions rather than the DMS.
"""

from django.conf import settings
from rest_framework.authentication import TokenAuthentication
from rest_framework.permissions import BasePermission

from documents.api_errors import AUTHENTICATION_REQUIRED, FEATURE_DISABLED, FORBIDDEN, ApiError


class WriteAccess(BasePermission):
    """Base class: the feature must be enabled, the caller signed in and allowed."""

    setting = ""
    feature = ""
    permissions: tuple[str, ...] = ()

    def has_permission(self, request, view) -> bool:
        if not getattr(settings, self.setting, False):
            raise ApiError(403, FEATURE_DISABLED, f"{self.feature} is not enabled on this server.")
        user = request.user
        if not user or not user.is_authenticated:
            raise ApiError(401, AUTHENTICATION_REQUIRED, "Sign in with a valid token to use this endpoint.")
        if not user.has_perms(self.permissions):
            raise ApiError(403, FORBIDDEN, "Your account is not allowed to do this.")
        return True


class AuthoringAccess(WriteAccess):
    setting = "EFB_AUTHORING_ENABLED"
    feature = "Authoring"
    permissions = ("documents.view_draft", "documents.add_draft", "documents.change_draft", "documents.delete_draft")


class PublishAccess(AuthoringAccess):
    permissions = (*AuthoringAccess.permissions, "documents.add_documentversion")


class AnnotationSyncAccess(WriteAccess):
    setting = "EFB_ANNOTATION_SYNC_ENABLED"
    feature = "Annotation sync"


class DeviceAuditAccess(WriteAccess):
    setting = "EFB_DEVICE_AUDIT_ENABLED"
    feature = "Device audit upload"


class AuditReadAccess(BasePermission):
    """Reading the audit log needs a token and permission to view audit events."""

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not user or not user.is_authenticated:
            raise ApiError(401, AUTHENTICATION_REQUIRED, "Sign in with a valid token to use this endpoint.")
        if not user.has_perm("documents.view_auditevent"):
            raise ApiError(403, FORBIDDEN, "Your account is not allowed to read the audit log.")
        return True


# Token authentication only: no session cookie, so same-origin pages and
# browser storage cannot authenticate a request (and CSRF does not apply).
AUTHENTICATION = [TokenAuthentication]


def acting_user(request) -> tuple[str, str]:
    """The verified name and role of the signed-in account."""
    user = request.user
    name = user.get_username()
    if user.has_perm("documents.add_documentversion"):
        return name, "administrator"
    if user.has_perm("documents.change_draft"):
        return name, "author"
    return name, "pilot"
