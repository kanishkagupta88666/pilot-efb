from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from config.database import POSTGRES_ENGINE, SQLITE_ENGINE, database_settings

BASE_DIR = Path("/srv/pilot-efb/backend")


class DatabaseSettingsTests(SimpleTestCase):
    def test_sqlite_is_the_default_without_database_variables(self):
        for environ in ({}, {"DATABASE_URL": "", "POSTGRES_DB": "  "}):
            with self.subTest(environ=environ):
                self.assertEqual(
                    database_settings(environ, BASE_DIR),
                    {"ENGINE": SQLITE_ENGINE, "NAME": BASE_DIR / "db.sqlite3"},
                )

    def test_postgres_variables_select_postgresql(self):
        settings = database_settings(
            {
                "POSTGRES_DB": "pilot_efb",
                "POSTGRES_USER": "pilot",
                "POSTGRES_PASSWORD": "example",
                "POSTGRES_HOST": "127.0.0.1",
                "POSTGRES_PORT": "5432",
            },
            BASE_DIR,
        )

        self.assertEqual(
            settings,
            {
                "ENGINE": POSTGRES_ENGINE,
                "NAME": "pilot_efb",
                "USER": "pilot",
                "PASSWORD": "example",
                "HOST": "127.0.0.1",
                "PORT": "5432",
            },
        )

    def test_postgres_db_alone_leaves_the_rest_to_libpq_defaults(self):
        settings = database_settings({"POSTGRES_DB": "pilot_efb"}, BASE_DIR)

        self.assertEqual(settings["ENGINE"], POSTGRES_ENGINE)
        self.assertEqual(
            [settings[key] for key in ("USER", "PASSWORD", "HOST", "PORT")],
            ["", "", "", ""],
        )
        self.assertNotIn("TEST", settings)

    def test_database_url_selects_postgresql(self):
        for scheme in ("postgres", "postgresql"):
            with self.subTest(scheme=scheme):
                settings = database_settings(
                    {
                        "DATABASE_URL": (
                            f"{scheme}://pilot:p%40ss%2Fword@db.example:6543"
                            "/pilot_efb?sslmode=require"
                        )
                    },
                    BASE_DIR,
                )

                self.assertEqual(
                    settings,
                    {
                        "ENGINE": POSTGRES_ENGINE,
                        "NAME": "pilot_efb",
                        "USER": "pilot",
                        "PASSWORD": "p@ss/word",
                        "HOST": "db.example",
                        "PORT": "6543",
                        "OPTIONS": {"sslmode": "require"},
                    },
                )

    def test_test_database_name_can_be_set_for_either_form(self):
        for environ in (
            {"POSTGRES_DB": "pilot_efb", "POSTGRES_TEST_DB": "pilot_efb_ci"},
            {
                "DATABASE_URL": "postgresql://localhost/pilot_efb",
                "POSTGRES_TEST_DB": "pilot_efb_ci",
            },
        ):
            with self.subTest(environ=environ):
                settings = database_settings(environ, BASE_DIR)

                self.assertEqual(settings["TEST"], {"NAME": "pilot_efb_ci"})

    def test_half_set_postgres_variables_never_fall_back_to_sqlite(self):
        for environ in (
            {"POSTGRES_USER": "pilot"},
            {"POSTGRES_HOST": "127.0.0.1", "POSTGRES_PASSWORD": "example"},
            {"POSTGRES_TEST_DB": "pilot_efb_ci"},
        ):
            with (
                self.subTest(environ=environ),
                self.assertRaisesMessage(
                    ImproperlyConfigured, "POSTGRES_DB is not"
                ),
            ):
                database_settings(environ, BASE_DIR)

    def test_database_url_and_postgres_variables_together_are_rejected(self):
        with self.assertRaisesMessage(ImproperlyConfigured, "not both"):
            database_settings(
                {
                    "DATABASE_URL": "postgresql://localhost/pilot_efb",
                    "POSTGRES_DB": "pilot_efb",
                },
                BASE_DIR,
            )

    def test_unusable_database_urls_are_rejected_without_echoing_them(self):
        secret = "s3cret"
        for url in (
            f"mysql://pilot:{secret}@localhost/pilot_efb",
            f"postgresql://pilot:{secret}@localhost",
            f"postgresql://pilot:{secret}@localhost/",
            f"postgresql://pilot:{secret}@localhost:notaport/pilot_efb",
            f"pilot:{secret}@localhost/pilot_efb",
        ):
            with self.subTest(url=url):
                with self.assertRaises(ImproperlyConfigured) as raised:
                    database_settings({"DATABASE_URL": url}, BASE_DIR)

                self.assertNotIn(secret, str(raised.exception))
