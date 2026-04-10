# app/services

Business logic that doesn't belong in route handlers — external APIs, event tracking, storage.

| File | What it does |
|---|---|
| `storage.py` | Generates short-lived signed URLs for Supabase Storage. All photos are in a **private** bucket — never served with public permanent URLs. Optionally rewrites the URL origin to the CDN base. Also exports path helpers (`item_path`, `outfit_path`, `avatar_path`) so paths are generated consistently across the codebase. |
| `events.py` | Writes behavioral events to `user_events` table and forwards them to PostHog in a single `track()` call. Import and call this from route handlers after successful operations. |

## Usage

```python
# In a route handler
from app.services.events import track
from app.services.storage import get_signed_url, item_path

# Track an event
await track(db, user_id, "outfit_created", {"outfit_id": str(outfit.id)})

# Generate a signed photo URL
url = await get_signed_url(item_path(user_id, item_id))
```

## Adding a new service

Create a new file here (e.g. `ai.py` for AI analysis calls). Keep services stateless — they receive what they need as arguments and return results. Do not import from `api/`.
