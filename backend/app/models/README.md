# app/models

SQLAlchemy table definitions — one file per database table.

| File | Table | What it represents |
|---|---|---|
| `base.py` | — | `TimestampMixin` and `SoftDeleteMixin` — shared columns added to all tables |
| `user.py` | `users` | App user profile — extends Supabase Auth with app-level metadata, body sizing, style preferences, and settings |
| `brand.py` | `brands` | Shared catalog of clothing brands |
| `wardrobe_item.py` | `wardrobe_items` | A single physical garment owned by a user |
| `outfit.py` | `outfits` | An outfit worn on a specific date |
| `outfit_item.py` | `outfit_items` | Many-to-many join — which items appeared in which outfit |
| `ai_analysis.py` | `ai_analyses` | Results from AI calls (classification, scoring, style matching) |
| `user_event.py` | `user_events` | Behavioral event log — every meaningful action a user takes |

## Key design decisions

- **UUIDs** as primary keys — avoids enumeration attacks, works across distributed systems.
- **Soft deletes** (`deleted_at`) on user-facing tables — rows are never hard-deleted, preserving audit trails.
- **No JSON blobs** for structured data — every field has its own typed column.
- `ai_analyses.result` is the only intentional JSONB column, because AI output structure varies per model.

## Adding a new table

1. Create a new file here (e.g. `collection.py`)
2. Define the model inheriting from `Base` + the appropriate mixins
3. Import it in `alembic/env.py` so Alembic can detect it
4. Run `alembic revision --autogenerate -m "add collections table"`
5. Review the generated migration, then `alembic upgrade head`
