import uuid
from datetime import date, datetime

from pydantic import BaseModel, EmailStr


class UserBase(BaseModel):
    username: str
    first_name: str | None = None
    last_name: str | None = None
    gender: str | None = None
    country: str | None = None
    city: str | None = None
    timezone: str | None = None
    locale: str = "en"
    preferred_currency: str = "USD"
    height_cm: int | None = None
    body_type: str | None = None
    size_tops: str | None = None
    size_bottoms: str | None = None
    size_shoes: str | None = None
    size_dresses: str | None = None
    style_tags: list[str] = []
    favourite_colors: list[str] = []
    avoided_colors: list[str] = []
    push_notifications: bool = True
    email_notifications: bool = True
    profile_is_public: bool = False
    ai_analysis_enabled: bool = True


class UserCreate(UserBase):
    email: EmailStr


class UserUpdate(UserBase):
    pass


class UserOut(UserBase):
    id: uuid.UUID
    email: str
    avatar_url: str | None
    subscription_tier: str
    total_outfits: int
    total_items: int
    last_seen_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}
