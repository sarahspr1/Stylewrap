"""
Supabase Storage service — generates signed URLs for private photo access.
All buckets are private; photos are never served with public permanent URLs.
"""
import httpx

from app.core.config import settings

SIGNED_URL_EXPIRY_SECONDS = 3600   # 1 hour


async def get_signed_url(storage_path: str) -> str | None:
    """
    Generate a short-lived signed URL for a file in Supabase Storage.
    storage_path: e.g. "{user_id}/items/{item_id}/original.jpg"
    Returns the signed URL string, or None on failure.
    """
    url = f"{settings.SUPABASE_URL}/storage/v1/object/sign/{settings.STORAGE_BUCKET}/{storage_path}"
    headers = {
        "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
    }
    payload = {"expiresIn": SIGNED_URL_EXPIRY_SECONDS}

    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code != 200:
            return None
        data = resp.json()

    signed_url = data.get("signedURL", "")
    if settings.CDN_BASE_URL and signed_url:
        # Replace Supabase origin with CDN for edge caching
        supabase_origin = settings.SUPABASE_URL
        signed_url = signed_url.replace(supabase_origin, settings.CDN_BASE_URL, 1)

    return signed_url or None


def item_path(user_id: str, item_id: str, variant: str = "original") -> str:
    """Return the Storage path for a wardrobe item photo."""
    return f"{user_id}/items/{item_id}/{variant}.jpg"


def outfit_path(user_id: str, outfit_id: str) -> str:
    """Return the Storage path for a full outfit photo."""
    return f"{user_id}/outfits/{outfit_id}/original.jpg"


def avatar_path(user_id: str, variant: str = "original") -> str:
    """Return the Storage path for a user avatar."""
    return f"{user_id}/avatar/{variant}.jpg"
