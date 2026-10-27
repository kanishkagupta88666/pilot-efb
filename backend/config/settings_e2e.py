"""Settings for the browser regression tests (frontend/e2e).

Same as the normal settings, but the database is a throwaway file named by
EFB_E2E_DB so the tests never touch backend/db.sqlite3. The write features stay
off, as in a default install.
"""

import os

from .settings import *  # noqa: F401,F403

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.environ["EFB_E2E_DB"],
    }
}
