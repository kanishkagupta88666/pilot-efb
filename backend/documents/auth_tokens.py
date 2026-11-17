from datetime import timedelta

from django.conf import settings
from django.core import signing
from django.utils import timezone

from documents.auth_accounts import get_account

TOKEN_SALT = "efb.authentication.v1"

def session_duration():
    """Return the configured session duration in seconds"""
    days = int(getattr(settings, "EFB_SESSION_DAYS", 30))
    return int(timedelta(days=days).total_seconds())

def create_token(account):
    """Generate a signed authentication token for an account"""
    payload = {
        "user_id": account["id"],
    }

    return signing.dumps(payload, salt=TOKEN_SALT)

def verify_token(token):
    """Validate a token and return the corresponding account"""
    try:
        payload = signing.loads(
            token, 
            salt=TOKEN_SALT,
            max_age=session_duration()
        )
    except (signing.BadSignature, signing.SignatureExpired):
        return None

    if not isinstance(payload, dict):
        return None

    user_id = payload.get("user_id")

    if not isinstance(user_id, str):
        return None

    account = get_account(user_id)

    if account is None:
        return None

    return {
        "id": account["id"],
        "role": account["role"],
        "fleet": account["fleet"]
    }

def token_expiration():
    """Return the expiration time for newly issued token"""
    return timezone.now() + timedelta(seconds=session_duration())