import uuid

from sqlalchemy import ForeignKey, Integer, Numeric, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin


class AIAnalysis(Base, TimestampMixin):
    __tablename__ = "ai_analyses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    outfit_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("outfits.id", ondelete="SET NULL"), nullable=True)
    item_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("wardrobe_items.id", ondelete="SET NULL"), nullable=True)

    model_name: Mapped[str] = mapped_column(Text, nullable=False)   # e.g. "gpt-4o"
    model_version: Mapped[str | None] = mapped_column(Text)
    analysis_type: Mapped[str] = mapped_column(Text, nullable=False) # "outfit_score", "item_classify", "style_match"
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    result: Mapped[dict] = mapped_column(JSONB, nullable=False)      # raw JSON from the model
    confidence: Mapped[float | None] = mapped_column(Numeric(4, 3))  # 0.000 – 1.000
    processing_ms: Mapped[int | None] = mapped_column(Integer)

    # Relationships
    outfit: Mapped["Outfit | None"] = relationship(back_populates="ai_analyses")
    item: Mapped["WardrobeItem | None"] = relationship(back_populates="ai_analyses")
