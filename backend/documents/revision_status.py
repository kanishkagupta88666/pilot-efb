from collections.abc import Iterable
from datetime import date
from typing import Protocol, TypeVar

from django.utils import timezone

CURRENT = "current"
UPCOMING = "upcoming"
SUPERSEDED = "superseded"


class _DatedRevision(Protocol):
    revision: int
    effective_date: date


_DatedRevisionT = TypeVar("_DatedRevisionT", bound=_DatedRevision)


def current_date() -> date:
    """Return today's date in the configured Django time zone.

    This is the only clock used for revision status, so tests override it here.
    """
    return timezone.localdate()


def current_revision(
    versions: Iterable[_DatedRevisionT],
    today: date,
) -> _DatedRevisionT | None:
    """Return the current revision of one document, or None if there is none.

    Only revisions whose effective date is not after ``today`` qualify. The
    latest effective date wins, then the highest revision number.
    """
    return max(
        (version for version in versions if version.effective_date <= today),
        key=lambda version: (version.effective_date, version.revision),
        default=None,
    )


def derive_statuses(
    versions: Iterable[_DatedRevision],
    today: date,
) -> dict[int, str]:
    """Map each revision number of one document to its derived status.

    A revision whose effective date is after ``today`` is upcoming. Of the
    rest, ``current_revision`` picks the current one and the others are
    superseded.
    """
    versions = list(versions)
    current = current_revision(versions, today)
    statuses: dict[int, str] = {}
    for version in versions:
        if version.effective_date > today:
            statuses[version.revision] = UPCOMING
        elif version is current:
            statuses[version.revision] = CURRENT
        else:
            statuses[version.revision] = SUPERSEDED
    return statuses
