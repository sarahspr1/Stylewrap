import uuid
from datetime import date, datetime

from pydantic import BaseModel


class OutfitBase(BaseModel):
    date_key: date
    occasion: str | None = None
    weather: str | None = None
    notes: str | None = None
    is_favourite: bool = False


class OutfitCreate(OutfitBase):
    item_ids: list[uuid.UUID] = []   # wardrobe items in this outfit


class OutfitUpdate(BaseModel):
    occasion: str | None = None
    weather: str | None = None
    notes: str | None = None
    is_favourite: bool | None = None
    item_ids: list[uuid.UUID] | None = None


class OutfitOut(OutfitBase):
    id: uuid.UUID
    user_id: uuid.UUID
    photo_url: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
