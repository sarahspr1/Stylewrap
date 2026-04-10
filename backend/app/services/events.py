"""
Event tracking service — writes to user_events table and forwards to PostHog.
Call track() after every meaningful user action in route handlers.
"""
import uuid

import posthog
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user_event import UserEvent

if settings.POSTHOG_API_KEY:
    posthog.project_api_key = settings.POSTHOG_API_KEY
    posthog.host = settings.POSTHOG_HOST


async def track(
    db: AsyncSession,
    user_id: str,
    event_name: str,
    properties: dict | None = None,
    platform: str = "web",
    session_id: str | None = None,
) -> None:
    """
    Persist an event to user_events and fire it to PostHog asynchronously.

    Usage:
        await track(db, user_id, "outfit_created", {"outfit_id": str(outfit.id)})
    """
    event = UserEvent(
        user_id=uuid.UUID(user_id),
        session_id=session_id,
        event_name=event_name,
        properties=properties or {},
        platform=platform,
    )
    db.add(event)

    if settings.POSTHOG_API_KEY:
        posthog.capture(
            distinct_id=user_id,
            event=event_name,
            properties=properties or {},
        )
