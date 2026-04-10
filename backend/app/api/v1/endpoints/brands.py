import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_current_user_id
from app.models.brand import Brand

router = APIRouter()


@router.get("/")
async def list_brands(
    search: str | None = Query(None),
    limit: int = Query(100, le=500),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user_id),   # require auth
):
    """List all brands. Optionally filter by name prefix."""
    q = select(Brand).order_by(Brand.name)
    if search:
        q = q.where(Brand.name.ilike(f"{search}%"))
    q = q.limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_brand(
    name: str,
    country: str | None = None,
    website: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user_id),
):
    """Create a brand if it doesn't exist yet."""
    existing = await db.execute(select(Brand).where(Brand.name == name))
    brand = existing.scalar_one_or_none()
    if brand:
        return brand
    brand = Brand(name=name, country=country, website=website)
    db.add(brand)
    await db.flush()
    return brand
