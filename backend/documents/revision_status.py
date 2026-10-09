from collections.abc import Iterable
from datetime import date
from typing import Protocol

from django.utils import timezone

CURRENT = "current"
UPCOMING = "upcoming"
SUPERSEDED = "superseded"


class _DatedRevision(Protocol):
    revision: int
    effective_date: date


def current_date() -> date:
    """Return today's date in the configured Django time zone.

    This is the only clock used for revision status, so tests override it here.
    """
    return timezone.localdate()


def derive_statuses(
    versions: Iterable[_DatedRevision],
    today: date,
) -> dict[int, str]:
    """Map each revision number of one document to its derived status.

    A revision whose effective date is after ``today`` is upcoming. Of the
    rest, the one with the latest effective date is current and the others are
    superseded. When several share that latest effective date, the highest
    revision number is current.
    """
    statuses: dict[int, str] = {}
    current: _DatedRevision | None = None
    for version in versions:
        if version.effective_date > today:
            statuses[version.revision] = UPCOMING
            continue
        statuses[version.revision] = SUPERSEDED
        if current is None or (version.effective_date, version.revision) > (
            current.effective_date,
            current.revision,
        ):
            current = version

    if current is not None:
        statuses[current.revision] = CURRENT
    return statuses
