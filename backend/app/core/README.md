# app/core

Core infrastructure — loaded once at startup, shared across the entire app.

| File | What it does |
|---|---|
| `config.py` | Reads all environment variables via `pydantic-settings`. Import `settings` anywhere to access them. Fails fast at startup if a required variable is missing. |
| `database.py` | Creates the async SQLAlchemy engine and session factory. Exports `get_db` — a FastAPI dependency that yields a DB session per request and auto-commits or rolls back. Also exports `Base`, the parent class for all models. |
| `security.py` | Verifies Supabase-issued JWTs using the `SUPABASE_JWT_SECRET`. Exports three FastAPI dependencies: `get_current_user_id` (extracts user UUID), `get_current_role` (extracts role from `app_metadata`), and `require_role("admin")` (blocks the route if role doesn't match). |

Nothing in `core/` imports from `models/`, `schemas/`, or `api/` — it has no circular dependencies.
