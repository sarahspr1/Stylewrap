import uuid

from sqlalchemy import ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin


class UserEvent(Base, TimestampMixin):
    """
    Behavioral event log — every meaningful user action.
    Powers product analytics, funnels, and retention metrics.
    Never stores PII directly — only user_id references.
    """
    __tablename__ = "user_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    session_id: Mapped[str | None] = mapped_column(Text)
    event_name: Mapped[str] = mapped_column(Text, nullable=False)   # e.g. "outfit_created"
    properties: Mapped[dict | None] = mapped_column(JSONB)          # flexible payload per event
    platform: Mapped[str | None] = mapped_column(Text)              # "web", "ios", "android"
    ip_hash: Mapped[str | None] = mapped_column(Text)               # sha256(ip+salt), never raw

    user: Mapped["User | None"] = relationship(back_populates="events")
