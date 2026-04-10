from fastapi import APIRouter, Depends
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id, get_db, require_role
from app.models.wardrobe_item import WardrobeItem
from app.models.outfit import Outfit
from app.models.user_event import UserEvent

router = APIRouter()


@router.get("/me/summary")
async def my_summary(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Personal stats — wardrobe breakdown, outfit count, most worn items."""
    import uuid
    uid = uuid.UUID(user_id)

    items_by_cat = await db.execute(
        select(WardrobeItem.category, func.count().label("count"))
        .where(WardrobeItem.user_id == uid, WardrobeItem.deleted_at.is_(None))
        .group_by(WardrobeItem.category)
    )

    total_outfits = await db.execute(
        select(func.count()).where(Outfit.user_id == uid, Outfit.deleted_at.is_(None))
    )

    return {
        "wardrobe_by_category": {row.category: row.count for row in items_by_cat},
        "total_outfits": total_outfits.scalar(),
    }


@router.get("/platform/overview", dependencies=[Depends(require_role("analyst"))])
async def platform_overview(db: AsyncSession = Depends(get_db)):
    """[Analyst/Admin only] Aggregated platform metrics — no PII."""
    result = await db.execute(text("""
        SELECT
            COUNT(*)                                        AS total_users,
            COUNT(*) FILTER (WHERE subscription_tier = 'pro')  AS pro_users,
            AVG(total_items)                                AS avg_items_per_user,
            AVG(total_outfits)                              AS avg_outfits_per_user
        FROM users
        WHERE deleted_at IS NULL
    """))
    row = result.mappings().one()
    return dict(row)
