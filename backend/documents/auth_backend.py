from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from documents.auth_tokens import verify_token

class DemoAccount:
    """Represents an authenticated EFB account. This is not a Django databse user."""

    def __init__(self, account):
        self.id = account["id"]
        self.role = account["role"]
        self.fleet = account["fleet"]

    @property
    def is_authenticated(self):
        return True

    @property
    def is_anonymous(self):
        return False

    def get_username(self):
        return self.id

    def __str__(self):
        return self.id

class SignedTokenAuthentication(BaseAuthentication):
    """
    Authenticate requests using EFB signed tokens.
    Expected header: 
        Authorization: Token <signed-token>
    """
    keyword = "Token"

    def authenticate(self, request):
        header = request.headers.get("Authorization", "")

        if not header:
            return None

        parts = header.split()

        if not parts or parts[0].lower() != self.keyword.lower():
            return None

        if len(parts) != 2:
            raise AuthenticationFailed("Invalid authorization header.")

        token = parts[1]
        account = verify_token(token)

        if account is None:
            raise AuthenticationFailed("Invalid or expired token.")

        return (DemoAccount(account), token)

    def authenticate_header(self, request):
        return self.keyword