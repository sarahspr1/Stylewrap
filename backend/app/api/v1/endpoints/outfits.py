import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id, get_db
from app.models.outfit import Outfit
from app.models.outfit_item import OutfitItem
from app.schemas.outfit import OutfitCreate, OutfitOut, OutfitUpdate
from app.services.events import track

router = APIRouter()


@router.get("/", response_model=list[OutfitOut])
async def list_outfits(
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    favourites_only: bool = Query(False),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """List outfits for the authenticated user with optional date range filter."""
    q = select(Outfit).where(
        Outfit.user_id == uuid.UUID(user_id),
        Outfit.deleted_at.is_(None),
    )
    if from_date:
        q = q.where(Outfit.date_key >= from_date)
    if to_date:
        q = q.where(Outfit.date_key <= to_date)
    if favourites_only:
        q = q.where(Outfit.is_favourite.is_(True))
    q = q.order_by(Outfit.date_key.desc()).limit(limit).offset(offset)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/", response_model=OutfitOut, status_code=status.HTTP_201_CREATED)
async def create_outfit(
    body: OutfitCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Create an outfit and link wardrobe items to it."""
    outfit = Outfit(
        user_id=uuid.UUID(user_id),
        date_key=body.date_key,
        occasion=body.occasion,
        weather=body.weather,
        notes=body.notes,
        is_favourite=body.is_favourite,
    )
    db.add(outfit)
    await db.flush()

    for i, item_id in enumerate(body.item_ids):
        db.add(OutfitItem(outfit_id=outfit.id, item_id=item_id, position=i))

    await db.flush()
    await track(db, user_id, "outfit_created", {"outfit_id": str(outfit.id), "date_key": str(body.date_key)})
    return outfit


@router.patch("/{outfit_id}", response_model=OutfitOut)
async def update_outfit(
    outfit_id: uuid.UUID,
    body: OutfitUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Outfit).where(
            Outfit.id == outfit_id,
            Outfit.user_id == uuid.UUID(user_id),
            Outfit.deleted_at.is_(None),
        )
    )
    outfit = result.scalar_one_or_none()
    if not outfit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Outfit not found")

    for field, value in body.model_dump(exclude_unset=True, exclude={"item_ids"}).items():
        setattr(outfit, field, value)

    if body.item_ids is not None:
        await db.execute(
            OutfitItem.__table__.delete().where(OutfitItem.outfit_id == outfit_id)
        )
        for i, item_id in enumerate(body.item_ids):
            db.add(OutfitItem(outfit_id=outfit.id, item_id=item_id, position=i))

    await db.flush()
    return outfit


@router.delete("/{outfit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_outfit(
    outfit_id: uuid.UUID,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    from datetime import datetime, timezone
    result = await db.execute(
        select(Outfit).where(Outfit.id == outfit_id, Outfit.user_id == uuid.UUID(user_id))
    )
    outfit = result.scalar_one_or_none()
    if outfit:
        outfit.deleted_at = datetime.now(timezone.utc)
        await db.flush()
