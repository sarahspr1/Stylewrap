"""
Shared FastAPI dependencies — imported by all route modules.
"""
from app.core.database import get_db
from app.core.security import get_current_role, get_current_user_id, require_role, verify_jwt

__all__ = [
    "get_db",
    "verify_jwt",
    "get_current_user_id",
    "get_current_role",
    "require_role",
]
