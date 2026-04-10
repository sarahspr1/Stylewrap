import uuid
from datetime import date, datetime

from pydantic import BaseModel


class WardrobeItemBase(BaseModel):
    category: str
    subcategory: str | None = None
    color: str | None = None
    color_hex: str | None = None
    material: str | None = None
    price: float | None = None
    currency: str = "USD"
    purchase_date: date | None = None
    notes: str | None = None
    brand_id: uuid.UUID | None = None


class WardrobeItemCreate(WardrobeItemBase):
    pass


class WardrobeItemUpdate(WardrobeItemBase):
    category: str | None = None     # all fields optional on update


class WardrobeItemOut(WardrobeItemBase):
    id: uuid.UUID
    user_id: uuid.UUID
    photo_url: str | None
    thumbnail_url: str | None
    times_worn: int
    last_worn_at: date | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
