import uuid

from sqlalchemy import ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class OutfitItem(Base):
    """Many-to-many join between outfits and wardrobe_items."""
    __tablename__ = "outfit_items"

    outfit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("outfits.id", ondelete="CASCADE"), primary_key=True)
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("wardrobe_items.id", ondelete="CASCADE"), primary_key=True)

    crop_url: Mapped[str | None] = mapped_column(Text)             # AI-cropped photo of this item in this outfit
    position: Mapped[int | None] = mapped_column(Integer)          # display order

    # Relationships
    outfit: Mapped["Outfit"] = relationship(back_populates="items")
    item: Mapped["WardrobeItem"] = relationship(back_populates="outfit_links")
