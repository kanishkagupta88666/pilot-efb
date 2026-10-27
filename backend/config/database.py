from collections.abc import Mapping
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, unquote, urlsplit

from django.core.exceptions import ImproperlyConfigured

POSTGRES_ENGINE = "django.db.backends.postgresql"
SQLITE_ENGINE = "django.db.backends.sqlite3"
POSTGRES_VARIABLES = (
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_HOST",
    "POSTGRES_PORT",
    "POSTGRES_TEST_DB",
)
URL_SCHEMES = ("postgres", "postgresql")


def database_settings(environ: Mapping[str, str], base_dir: Path) -> dict[str, Any]:
    """Return the default database for the given environment.

    ``DATABASE_URL`` or ``POSTGRES_DB`` selects PostgreSQL. With neither set
    the database is the SQLite file used for local development. A half-set
    PostgreSQL configuration is an error, so a typing mistake can never fall
    back to SQLite without anyone noticing.
    """
    url = environ.get("DATABASE_URL", "").strip()
    variables = {
        name: environ[name].strip()
        for name in POSTGRES_VARIABLES
        if environ.get(name, "").strip()
    }
    connection_variables = sorted(set(variables) - {"POSTGRES_TEST_DB"})

    if url and connection_variables:
        raise ImproperlyConfigured(
            "Set either DATABASE_URL or the POSTGRES_* variables, not both. "
            f"Also set: {', '.join(connection_variables)}."
        )
    if url:
        settings = _from_url(url)
    elif "POSTGRES_DB" in variables:
        settings = {
            "ENGINE": POSTGRES_ENGINE,
            "NAME": variables["POSTGRES_DB"],
            "USER": variables.get("POSTGRES_USER", ""),
            "PASSWORD": variables.get("POSTGRES_PASSWORD", ""),
            "HOST": variables.get("POSTGRES_HOST", ""),
            "PORT": variables.get("POSTGRES_PORT", ""),
        }
    elif variables:
        raise ImproperlyConfigured(
            f"{', '.join(sorted(variables))} is set but POSTGRES_DB is not. "
            "Set POSTGRES_DB to use PostgreSQL, or unset them to use SQLite."
        )
    else:
        return {"ENGINE": SQLITE_ENGINE, "NAME": base_dir / "db.sqlite3"}

    if "POSTGRES_TEST_DB" in variables:
        settings["TEST"] = {"NAME": variables["POSTGRES_TEST_DB"]}
    return settings


def _from_url(url: str) -> dict[str, Any]:
    # Error messages never include the URL, because it can hold a password.
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        raise ImproperlyConfigured("DATABASE_URL is not a valid URL.") from None
    if parts.scheme not in URL_SCHEMES:
        raise ImproperlyConfigured(
            "DATABASE_URL must start with postgres:// or postgresql://."
        )
    name = unquote(parts.path.removeprefix("/"))
    if not name:
        raise ImproperlyConfigured("DATABASE_URL does not name a database.")

    settings: dict[str, Any] = {
        "ENGINE": POSTGRES_ENGINE,
        "NAME": name,
        "USER": unquote(parts.username or ""),
        "PASSWORD": unquote(parts.password or ""),
        "HOST": unquote(parts.hostname or ""),
        "PORT": str(port) if port is not None else "",
    }
    options = dict(parse_qsl(parts.query))
    if options:
        settings["OPTIONS"] = options
    return settings
