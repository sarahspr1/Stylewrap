import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id, get_db
from app.models.wardrobe_item import WardrobeItem
from app.schemas.wardrobe_item import WardrobeItemCreate, WardrobeItemOut, WardrobeItemUpdate
from app.services.events import track

router = APIRouter()


@router.get("/", response_model=list[WardrobeItemOut])
async def list_items(
    category: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """List all active wardrobe items for the authenticated user."""
    q = select(WardrobeItem).where(
        WardrobeItem.user_id == uuid.UUID(user_id),
        WardrobeItem.deleted_at.is_(None),
        WardrobeItem.is_active.is_(True),
    )
    if category:
        q = q.where(WardrobeItem.category == category)
    q = q.order_by(WardrobeItem.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/", response_model=WardrobeItemOut, status_code=status.HTTP_201_CREATED)
async def create_item(
    body: WardrobeItemCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Add a new wardrobe item."""
    item = WardrobeItem(**body.model_dump(), user_id=uuid.UUID(user_id))
    db.add(item)
    await db.flush()
    await track(db, user_id, "item_added", {"item_id": str(item.id), "category": item.category})
    return item


@router.patch("/{item_id}", response_model=WardrobeItemOut)
async def update_item(
    item_id: uuid.UUID,
    body: WardrobeItemUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Update a wardrobe item owned by the authenticated user."""
    result = await db.execute(
        select(WardrobeItem).where(
            WardrobeItem.id == item_id,
            WardrobeItem.user_id == uuid.UUID(user_id),
            WardrobeItem.deleted_at.is_(None),
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    await db.flush()
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(
    item_id: uuid.UUID,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete a wardrobe item."""
    from datetime import datetime, timezone
    result = await db.execute(
        select(WardrobeItem).where(
            WardrobeItem.id == item_id,
            WardrobeItem.user_id == uuid.UUID(user_id),
        )
    )
    item = result.scalar_one_or_none()
    if item:
        item.deleted_at = datetime.now(timezone.utc)
        await db.flush()
