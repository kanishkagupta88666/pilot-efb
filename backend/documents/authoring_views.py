"""API for authoring a new revision. See documents/authoring.py for the rules.

Prototype only: like the rest of the API there is no authentication yet, so
anyone who can reach the API can edit a draft and publish it. Production
needs the document owner, reviewer and approver roles from the DMS.
"""

from functools import wraps

from rest_framework.decorators import api_view
from rest_framework.response import Response

from documents import authoring
from documents.api_errors import ApiError

DRAFT_METHODS = ["GET", "POST", "DELETE"]


def _errors(view):
    """Report an authoring rule as the API's usual error shape."""

    @wraps(view)
    def wrapper(request, *args, **kwargs):
        try:
            return view(request, *args, **kwargs)
        except authoring.AuthoringError as error:
            raise ApiError(error.status, error.code, error.message) from error

    return wrapper


def _body(request) -> dict:
    if not isinstance(request.data, dict):
        raise ApiError(400, "INVALID_REQUEST", "The request body must be a JSON object.")
    return request.data


@api_view(DRAFT_METHODS)
@_errors
def draft(request, doc_id: str):
    if request.method == "POST":
        created_draft, created = authoring.start_draft(doc_id)
        return Response(authoring.draft_view(created_draft), status=201 if created else 200)
    if request.method == "DELETE":
        authoring.discard_draft(doc_id)
        return Response(status=204)
    return Response(authoring.draft_view(authoring.get_draft(doc_id)))


@api_view(["GET", "PATCH", "DELETE"])
@_errors
def draft_topic(request, doc_id: str, topic_id: str):
    if request.method == "PATCH":
        authoring.rename_topic(doc_id, topic_id, title=_body(request).get("title"))
    elif request.method == "DELETE":
        authoring.delete_topic(doc_id, topic_id)
        return Response(authoring.draft_view(authoring.get_draft(doc_id)))
    return Response(authoring.topic_view(authoring.get_draft(doc_id), topic_id))


@api_view(["POST"])
@_errors
def draft_topics(request, doc_id: str):
    body = _body(request)
    draft_, topic_id = authoring.add_topic(
        doc_id,
        after_topic_id=body.get("afterTopicId"),
        title=body.get("title"),
        text=body.get("text"),
    )
    return Response({"topicId": topic_id, **authoring.draft_view(draft_)}, status=201)


@api_view(["POST"])
@_errors
def draft_blocks(request, doc_id: str, topic_id: str):
    body = _body(request)
    draft_, block_id = authoring.add_block(
        doc_id,
        topic_id,
        after_id=body.get("afterId"),
        block_type=body.get("type"),
        text=body.get("text"),
    )
    return Response({"blockId": block_id, **authoring.topic_view(draft_, topic_id)}, status=201)


@api_view(["PATCH", "DELETE"])
@_errors
def draft_block(request, doc_id: str, topic_id: str, block_id: str):
    if request.method == "DELETE":
        draft_ = authoring.delete_block(doc_id, topic_id, block_id)
    else:
        body = _body(request)
        draft_ = authoring.update_block(
            doc_id, topic_id, block_id, text=body.get("text"), block_type=body.get("type")
        )
    return Response(authoring.topic_view(draft_, topic_id))


@api_view(["POST"])
@_errors
def publish_draft(request, doc_id: str):
    body = _body(request)
    version = authoring.publish(
        doc_id,
        change_summary=body.get("changeSummary"),
        effective_date=body.get("effectiveDate"),
    )
    return Response(
        {
            "docId": version.document_id,
            "revision": version.revision,
            "effectiveDate": version.effective_date.isoformat(),
            "baseRevision": version.metadata["baseRevision"],
        },
        status=201,
    )
