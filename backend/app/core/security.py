from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.core.config import settings

bearer_scheme = HTTPBearer()

ALGORITHM = "HS256"


def verify_jwt(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> dict:
    """
    Verify a Supabase-issued JWT and return its decoded payload.
    Raises 401 if the token is missing, expired, or has an invalid signature.
    """
    token = credentials.credentials
    try:
        payload = jwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET,
            algorithms=[ALGORITHM],
            options={"verify_aud": False},   # Supabase sets aud=authenticated
        )
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


def get_current_user_id(payload: dict = Depends(verify_jwt)) -> str:
    """Extract the user UUID from the verified JWT payload."""
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing subject claim")
    return user_id


def get_current_role(payload: dict = Depends(verify_jwt)) -> str:
    """Extract the app role from app_metadata. Defaults to 'user'."""
    return payload.get("app_metadata", {}).get("role", "user")


def require_role(required: str):
    """
    FastAPI dependency factory — enforces a minimum role.

    Usage:
        @router.get("/admin/users")
        def list_users(_=Depends(require_role("admin"))):
            ...
    """
    def checker(role: str = Depends(get_current_role)):
        if role != required:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{required}' required",
            )
    return checker
