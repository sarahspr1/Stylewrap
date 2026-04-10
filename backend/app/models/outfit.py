import uuid
from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import SoftDeleteMixin, TimestampMixin


class Outfit(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "outfits"
    __table_args__ = (
        UniqueConstraint("user_id", "date_key", name="uq_outfit_user_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    date_key: Mapped[date] = mapped_column(Date, nullable=False)

    photo_url: Mapped[str | None] = mapped_column(Text)            # full outfit photo (bg removed)
    occasion: Mapped[str | None] = mapped_column(Text)             # casual, work, formal, sport
    weather: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    is_favourite: Mapped[bool] = mapped_column(Boolean, default=False)

    # Relationships
    user: Mapped["User"] = relationship(back_populates="outfits")
    items: Mapped[list["OutfitItem"]] = relationship(back_populates="outfit", cascade="all, delete-orphan")
    ai_analyses: Mapped[list["AIAnalysis"]] = relationship(back_populates="outfit")
