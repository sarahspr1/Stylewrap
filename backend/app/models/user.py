import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Double, Integer, Numeric, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import SoftDeleteMixin, TimestampMixin


class User(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "users"

    # Identity
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    username: Mapped[str] = mapped_column(Text, unique=True, nullable=False)

    # Personal info
    first_name: Mapped[str | None] = mapped_column(Text)
    last_name: Mapped[str | None] = mapped_column(Text)
    date_of_birth: Mapped[str | None] = mapped_column(Text)        # stored encrypted
    gender: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)                # stored encrypted

    # Location & locale
    country: Mapped[str | None] = mapped_column(String(2))         # ISO 3166-1 alpha-2
    city: Mapped[str | None] = mapped_column(Text)
    timezone: Mapped[str | None] = mapped_column(Text)             # IANA tz
    locale: Mapped[str] = mapped_column(Text, default="en")
    preferred_currency: Mapped[str] = mapped_column(String(3), default="USD")
    location_lat: Mapped[float | None] = mapped_column(Double)
    location_lng: Mapped[float | None] = mapped_column(Double)

    # Body & sizing
    height_cm: Mapped[int | None] = mapped_column(SmallInteger)
    weight_kg: Mapped[float | None] = mapped_column(Numeric(5, 1)) # stored encrypted
    body_type: Mapped[str | None] = mapped_column(Text)
    size_tops: Mapped[str | None] = mapped_column(Text)
    size_bottoms: Mapped[str | None] = mapped_column(Text)
    size_shoes: Mapped[str | None] = mapped_column(Text)
    size_dresses: Mapped[str | None] = mapped_column(Text)

    # Style preferences
    style_tags: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    favourite_colors: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    avoided_colors: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)

    # App metadata
    avatar_url: Mapped[str | None] = mapped_column(Text)
    subscription_tier: Mapped[str] = mapped_column(Text, default="free")
    subscription_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    referral_source: Mapped[str | None] = mapped_column(Text)
    onboarding_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    total_outfits: Mapped[int] = mapped_column(Integer, default=0)
    total_items: Mapped[int] = mapped_column(Integer, default=0)

    # Settings
    push_notifications: Mapped[bool] = mapped_column(Boolean, default=True)
    email_notifications: Mapped[bool] = mapped_column(Boolean, default=True)
    profile_is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_analysis_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    # Relationships
    wardrobe_items: Mapped[list["WardrobeItem"]] = relationship(back_populates="user")
    outfits: Mapped[list["Outfit"]] = relationship(back_populates="user")
    events: Mapped[list["UserEvent"]] = relationship(back_populates="user")
