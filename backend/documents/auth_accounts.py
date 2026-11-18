import json

from django.conf import settings
from django.contrib.auth.hashers import check_password

def load_accounts():
    """Load prototype accounts from the local JSON file"""
    
    accounts_file = (
        settings.BASE_DIR / "auth_data" / "demo_accounts.json"
    )

    with open(accounts_file, "r", encoding="utf-8") as file:
        data = json.load(file)

    return data["users"]

def get_account(username):
    """Find an account by its user ID"""

    accounts = load_accounts()

    for account in accounts:
        if account["id"] == username:
            return account
    
    return None

def authenticate_account(username, password):
    """Verify credentials and return the account if valid."""

    account = get_account(username)

    if account is None:
        return None

    if check_password(password, account["password_hash"]):
        return {
            "id": account["id"],
            "role": account["role"],
            "fleet": account["fleet"]
        }

    return None
