# app/api

FastAPI route handlers, organized by API version.

```
api/
  deps.py          ← re-exports all shared dependencies (get_db, get_current_user_id, etc.)
  v1/
    router.py      ← mounts all endpoint routers under /api/v1
    endpoints/
      users.py     ← GET/PATCH /users/me, GET /users/{id} (admin)
      wardrobe.py  ← CRUD for /wardrobe/
      outfits.py   ← CRUD for /outfits/
      brands.py    ← GET/POST /brands/
      analytics.py ← /analytics/me/summary, /analytics/platform/overview (analyst+)
```

## Auth pattern

Every protected route uses `Depends(get_current_user_id)` to verify the JWT and extract the user's UUID. No route handler ever reads a cookie or a query-string token — all auth goes through the `Authorization: Bearer <jwt>` header.

## Role enforcement

Use `Depends(require_role("admin"))` or `Depends(require_role("analyst"))` on routes that should be restricted:

```python
@router.get("/admin/users", dependencies=[Depends(require_role("admin"))])
async def list_all_users(...):
    ...
```

## Adding a new endpoint

1. Create a file in `endpoints/` (e.g. `collections.py`)
2. Define an `APIRouter` and your route functions
3. Import and mount it in `v1/router.py`
