import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import SoftDeleteMixin, TimestampMixin


class WardrobeItem(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "wardrobe_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    brand_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("brands.id"), nullable=True)

    category: Mapped[str] = mapped_column(Text, nullable=False)    # Top, Bottom, Shoes, etc.
    subcategory: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str | None] = mapped_column(Text)
    color_hex: Mapped[str | None] = mapped_column(String(7))       # e.g. #3A4438
    material: Mapped[str | None] = mapped_column(Text)
    price: Mapped[float | None] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    purchase_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)

    photo_url: Mapped[str | None] = mapped_column(Text)            # Supabase Storage path
    thumbnail_url: Mapped[str | None] = mapped_column(Text)

    times_worn: Mapped[int] = mapped_column(Integer, default=0)
    last_worn_at: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Relationships
    user: Mapped["User"] = relationship(back_populates="wardrobe_items")
    brand: Mapped["Brand | None"] = relationship(back_populates="wardrobe_items")
    outfit_links: Mapped[list["OutfitItem"]] = relationship(back_populates="item")
    ai_analyses: Mapped[list["AIAnalysis"]] = relationship(back_populates="item")
