"""API for pilots' annotations. See documents/annotations.py."""

from rest_framework.decorators import api_view
from rest_framework.response import Response

from documents import annotations
from documents.api_errors import INVALID_REQUEST, ApiError
from documents.views import _get_version


def _body(request) -> dict:
    return request.data if isinstance(request.data, dict) else {}


@api_view(["POST"])
def sync(request):
    body = _body(request)
    try:
        return Response(annotations.sync(body.get("owner"), body.get("changes", [])))
    except annotations.AnnotationError as error:
        raise ApiError(400, INVALID_REQUEST, str(error)) from error


@api_view(["POST"])
def status(request, doc_id: str, revision: str):
    version = _get_version(doc_id, revision)
    try:
        return Response({"statuses": annotations.status_for(version, _body(request).get("annotations"))})
    except annotations.AnnotationError as error:
        raise ApiError(400, INVALID_REQUEST, str(error)) from error
