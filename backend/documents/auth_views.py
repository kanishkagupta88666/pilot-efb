from rest_framework import status
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes
)
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from documents.auth_accounts import authenticate_account
from documents.auth_backend import SignedTokenAuthentication
from documents.auth_tokens import create_token, token_expiration

@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def login_view(request):
    """Authenticate a demo account and return a signed token."""

    username = request.data.get("username")
    password = request.data.get("password")

    if not isinstance(username, str) or not isinstance(password, str):
        return Response(
            {"error": "Username and password are required."},
            status=status.HTTP_400_BAD_REQUEST
        )

    account = authenticate_account(username, password)

    if account is None:
        return Response(
            {"error": "Invalid username or password."},
            status=status.HTTP_401_UNAUTHORIZED
        )

    token = create_token(account)

    return Response(
        {
            "token": token,
            "expires_at": token_expiration().isoformat(),
            "user": account
        },
        status=status.HTTP_200_OK
    )

@api_view(["GET"])
@authentication_classes([SignedTokenAuthentication])
@permission_classes([IsAuthenticated])
def me_view(request):
    """Return information about the authenticated account"""
    return Response(
        {
            "id": request.user.id,
            "role": request.user.role,
            "fleet": request.user.fleet
        }
    )

@api_view(["POST"])
@authentication_classes([SignedTokenAuthentication])
@permission_classes([IsAuthenticated])
def logout_view(request):
    """Stateless logout. The frontend must delete its stored token."""
    return Response(
        {"message": "Logged out. Discard the token on the client."},
        status=status.HTTP_200_OK
    )