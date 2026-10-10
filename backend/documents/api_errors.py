import logging

from django.http import Http404, JsonResponse
from rest_framework.exceptions import (
    APIException,
    MethodNotAllowed,
    NotAcceptable,
    NotFound,
)
from rest_framework.response import Response

logger = logging.getLogger(__name__)

INVALID_REQUEST = "INVALID_REQUEST"
DOCUMENT_NOT_FOUND = "DOCUMENT_NOT_FOUND"
REVISION_NOT_FOUND = "REVISION_NOT_FOUND"
NO_CURRENT_REVISION = "NO_CURRENT_REVISION"
NODE_NOT_FOUND = "NODE_NOT_FOUND"
NODE_NOT_A_TOPIC = "NODE_NOT_A_TOPIC"
NOT_FOUND = "NOT_FOUND"
METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
NOT_ACCEPTABLE = "NOT_ACCEPTABLE"
UNSUPPORTED_NODE_TYPE = "UNSUPPORTED_NODE_TYPE"
INTERNAL_ERROR = "INTERNAL_ERROR"

INTERNAL_ERROR_MESSAGE = "The server could not complete the request."
NOT_FOUND_MESSAGE = "The requested resource was not found."


class ApiError(Exception):
    """An expected failure that maps directly to one contract error response."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


def error_body(
    code: str,
    message: str,
    details: dict | None = None,
) -> dict[str, dict]:
    error: dict = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    return {"error": error}


def api_exception_handler(exc: Exception, context: dict) -> Response:
    """Render every API failure in the contract error shape.

    Anything unexpected, including stored-data integrity failures, is logged
    on the server and returned as a fixed message with no internal detail.
    """
    if isinstance(exc, ApiError):
        return Response(
            error_body(exc.code, exc.message, exc.details),
            status=exc.status_code,
        )
    if isinstance(exc, (Http404, NotFound)):
        return Response(error_body(NOT_FOUND, NOT_FOUND_MESSAGE), status=404)
    if isinstance(exc, MethodNotAllowed):
        return Response(
            error_body(
                METHOD_NOT_ALLOWED,
                "This method is not allowed for this endpoint.",
            ),
            status=405,
        )
    if isinstance(exc, NotAcceptable):
        return Response(
            error_body(NOT_ACCEPTABLE, "This API only returns JSON."),
            status=406,
        )
    if isinstance(exc, APIException) and exc.status_code < 500:
        return Response(
            error_body(INVALID_REQUEST, "The request could not be processed."),
            status=exc.status_code,
        )

    request = context.get("request")
    logger.error(
        "Unhandled error while serving %s.",
        getattr(request, "path", "an API request"),
        exc_info=exc,
    )
    return Response(
        error_body(INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE),
        status=500,
    )


class ApiNotFoundMiddleware:
    """Serve unmatched API routes in the contract error shape.

    Django answers an unmatched URL with an HTML page, and with its debug page
    when DEBUG is on. Only non-JSON 404 responses under ``/api/`` are replaced,
    so every other route, and the trailing-slash redirect, is untouched.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if (
            response.status_code == 404
            and request.path_info.startswith("/api/")
            and not response.get("Content-Type", "").startswith("application/json")
        ):
            return JsonResponse(error_body(NOT_FOUND, NOT_FOUND_MESSAGE), status=404)
        return response
