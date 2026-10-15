"""API for authoring a new revision. See documents/authoring.py for the rules.

Prototype only: like the rest of the API there is no authentication yet, so
anyone who can reach the API can edit a draft and publish it. Production
needs the document owner, reviewer and approver roles from the DMS.
"""

from functools import wraps

from rest_framework.decorators import api_view
from rest_framework.response import Response

from documents import audit, authoring
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


def _log(request, action: str, doc_id: str, *, revision=None, node_id: str = "", **details) -> None:
    audit.record(
        action,
        **audit.actor_from_request(request),
        document_id=doc_id,
        revision=revision,
        node_id=node_id,
        details=details,
    )


@api_view(DRAFT_METHODS)
@_errors
def draft(request, doc_id: str):
    if request.method == "POST":
        created_draft, created = authoring.start_draft(doc_id)
        if created:
            _log(request, "draft.started", doc_id, revision=created_draft.base_version.revision,
                 baseRevision=created_draft.base_version.revision)
        return Response(authoring.draft_view(created_draft), status=201 if created else 200)
    if request.method == "DELETE":
        existing = authoring.draft_view(authoring.get_draft(doc_id))
        authoring.discard_draft(doc_id)
        _log(request, "draft.discarded", doc_id, revision=existing["baseRevision"],
             baseRevision=existing["baseRevision"], summary=existing["summary"])
        return Response(status=204)
    return Response(authoring.draft_view(authoring.get_draft(doc_id)))


@api_view(["GET", "PATCH", "DELETE"])
@_errors
def draft_topic(request, doc_id: str, topic_id: str):
    if request.method == "PATCH":
        before = authoring.snapshot(doc_id, topic_id)
        authoring.rename_topic(doc_id, topic_id, title=_body(request).get("title"))
        after = authoring.snapshot(doc_id, topic_id)
        if after["topicTitle"] != before["topicTitle"]:
            _log(request, "topic.renamed", doc_id, node_id=topic_id,
                 topicNumber=before["topicNumber"], before=before["topicTitle"], after=after["topicTitle"])
    elif request.method == "DELETE":
        before = authoring.snapshot(doc_id, topic_id)
        authoring.delete_topic(doc_id, topic_id)
        _log(request, "topic.deleted", doc_id, node_id=topic_id, **before)
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
    _log(request, "topic.added", doc_id, node_id=topic_id, afterTopicId=body.get("afterTopicId"),
         **authoring.snapshot(doc_id, topic_id))
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
    _log(request, "block.added", doc_id, node_id=block_id, afterId=body.get("afterId"),
         **authoring.snapshot(doc_id, topic_id, block_id))
    return Response({"blockId": block_id, **authoring.topic_view(draft_, topic_id)}, status=201)


@api_view(["PATCH", "DELETE"])
@_errors
def draft_block(request, doc_id: str, topic_id: str, block_id: str):
    before = authoring.snapshot(doc_id, topic_id, block_id)
    if request.method == "DELETE":
        draft_ = authoring.delete_block(doc_id, topic_id, block_id)
        _log(request, "block.deleted", doc_id, node_id=block_id, **before)
    else:
        body = _body(request)
        draft_ = authoring.update_block(
            doc_id, topic_id, block_id, text=body.get("text"), block_type=body.get("type")
        )
        after = authoring.snapshot(doc_id, topic_id, block_id)
        if (after["text"], after["blockType"]) != (before["text"], before["blockType"]):
            _log(request, "block.edited", doc_id, node_id=block_id,
                 topicNumber=before["topicNumber"], topicTitle=before["topicTitle"],
                 before={"type": before["blockType"], "text": before["text"]},
                 after={"type": after["blockType"], "text": after["text"]})
    return Response(authoring.topic_view(draft_, topic_id))


@api_view(["POST"])
@_errors
def publish_draft(request, doc_id: str):
    body = _body(request)
    pending = authoring.draft_view(authoring.get_draft(doc_id))
    version = authoring.publish(
        doc_id,
        change_summary=body.get("changeSummary"),
        effective_date=body.get("effectiveDate"),
    )
    _log(request, "revision.published", doc_id, revision=version.revision,
         baseRevision=version.metadata["baseRevision"], changeSummary=version.metadata["changeSummary"],
         effectiveDate=version.effective_date.isoformat(), summary=pending["summary"])
    return Response(
        {
            "docId": version.document_id,
            "revision": version.revision,
            "effectiveDate": version.effective_date.isoformat(),
            "baseRevision": version.metadata["baseRevision"],
        },
        status=201,
    )
