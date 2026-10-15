"""API for the audit log. See documents/audit.py."""

from rest_framework.decorators import api_view
from rest_framework.response import Response

from documents import audit
from documents.api_errors import INVALID_REQUEST, ApiError
from documents.models import AuditEvent

MAX_PAGE = 200


@api_view(["GET", "POST"])
def events(request):
    if request.method == "POST":
        body = request.data if isinstance(request.data, dict) else {}
        try:
            result = audit.receive_device_events(body.get("events"))
        except audit.AuditError as error:
            raise ApiError(400, INVALID_REQUEST, str(error)) from error
        return Response(result)

    params = request.query_params
    try:
        since = audit.parse_bound(params.get("since"), "since")
        until = audit.parse_bound(params.get("until"), "until")
    except audit.AuditError as error:
        raise ApiError(400, INVALID_REQUEST, str(error)) from error
    limit = params.get("limit", "50")
    before = params.get("before")
    if not limit.isdigit() or not 1 <= int(limit) <= MAX_PAGE:
        raise ApiError(400, INVALID_REQUEST, f"The limit must be from 1 to {MAX_PAGE}.")
    if before is not None and not before.isdigit():
        raise ApiError(400, INVALID_REQUEST, "before must be an entry number.")

    query = AuditEvent.objects.all()
    for parameter, field in (
        ("documentId", "document_id"),
        ("action", "action"),
        ("source", "source"),
        ("deviceId", "device_id"),
    ):
        if params.get(parameter):
            query = query.filter(**{field: params[parameter]})
    if params.get("actor"):
        query = query.filter(actor__icontains=params["actor"])
    if since:
        query = query.filter(occurred_at__gte=since)
    if until:
        query = query.filter(occurred_at__lte=until)
    if before:
        query = query.filter(sequence__lt=int(before))
    page = list(query.order_by("-sequence")[: int(limit) + 1])
    more = len(page) > int(limit)
    page = page[: int(limit)]
    return Response(
        {
            "events": [audit.serialize(event) for event in page],
            "nextBefore": page[-1].sequence if more else None,
            "actions": audit.ACTIONS,
        }
    )


@api_view(["GET"])
def verify(request):
    return Response(audit.verify_chain())
