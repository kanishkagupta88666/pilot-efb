
import json
import os
from pathlib import Path

from django.contrib.auth.hashers import make_password

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_FILE = BASE_DIR / "auth_data" / "demo_accounts.json"

ACCOUNTS = [
    {"id": "P-100", "role": "pilot", "fleet": "fleet_1"},
    {"id": "P-200", "role": "pilot", "fleet": "fleet_2"},
    {"id": "M-001", "role": "management", "fleet": None},
    {"id": "A-001", "role": "admin", "fleet": None},
]


def main():
    password = os.environ.get("EFB_DEMO_PASSWORD")

    if not password:
        raise SystemExit(
            "Set EFB_DEMO_PASSWORD before running this script."
        )

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

    import django
    django.setup()

    if OUTPUT_FILE.exists():
        raise SystemExit(
            f"{OUTPUT_FILE} already exists. "
            "Delete it manually if you want to regenerate accounts."
        )

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    users = []

    for account in ACCOUNTS:
        users.append({
            **account,
            "password_hash": make_password(password),
        })

    # Restrict access to the account file on supported systems.
    fd = os.open(
        OUTPUT_FILE,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL,
        0o600,
    )

    with os.fdopen(fd, "w", encoding="utf-8") as file:
        json.dump({"users": users}, file, indent=2)
        file.write("\n")

    print(f"Created {len(users)} demo accounts in {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
