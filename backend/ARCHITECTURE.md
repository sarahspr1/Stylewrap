# Stylewrap — Backend Architecture

> This document describes the full backend architecture for the Stylewrap platform.
> No code is implemented here — this is the reference spec for the engineering team.

---

## Table of Contents

1. [Stack Overview](#stack-overview)
2. [Database Structure](#database-structure)
3. [Storage Structure](#storage-structure)
4. [Encryption](#encryption)
5. [Access Control & Roles](#access-control--roles)
6. [Metrics & Observability](#metrics--observability)
7. [Deployment](#deployment)

---

## Stack Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React / Vite)                   │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS / REST or WebSocket
┌───────────────────────────▼─────────────────────────────────┐
│                   FastAPI  (Python 3.12)                     │
│          SQLAlchemy ORM · Alembic migrations · Pydantic      │
└──────────┬────────────────┬────────────────┬────────────────┘
           │                │                │
┌──────────▼──────┐ ┌───────▼──────┐ ┌──────▼──────────────┐
│   PostgreSQL    │ │ Supabase Auth│ │  Supabase Storage   │
│ (Supabase/Neon) │ │  JWT · RLS   │ │  + CDN (Cloudflare) │
└─────────────────┘ └──────────────┘ └─────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────┐
│                  Metabase  (internal analytics)              │
└─────────────────────────────────────────────────────────────┘
```

### Why this stack

| Component | Choice | Reason |
|---|---|---|
| API | FastAPI (Python) | Native async, automatic OpenAPI docs, best-in-class for data-heavy backends |
| ORM | SQLAlchemy 2.x | Industry standard, works with Alembic for migrations |
| Migrations | Alembic | Version-controlled schema changes, rollback support |
| Validation | Pydantic v2 | Type-safe request/response models, auto-generated JSON Schema |
| Database | PostgreSQL 16 | ACID, JSONB support, pgcrypto, Row Level Security |
| Auth | Supabase Auth | Battle-tested JWT flow, OAuth providers, no rebuild needed |
| Storage | Supabase Storage | S3-compatible, signed URLs, already integrated |
| CDN | Cloudflare R2 / CloudFront | Global edge caching for outfit photos |
| Analytics | Metabase | Self-hosted BI on top of Postgres, no extra data warehouse needed at MVP scale |

---

## Database Structure

### Design principles

- **Normalized**: no JSON blobs for structured data. Each entity has its own table.
- **Auditable**: all mutable tables carry `created_at` and `updated_at` timestamps.
- **Soft-deletes**: `deleted_at` column instead of hard DELETE, to preserve audit trails.
- **UUIDs**: primary keys are `uuid` (not serial integers) to avoid enumeration attacks and to support future multi-region setups.

---

### Table: `users`

Mirrors Supabase Auth users. Supabase Auth is the source of truth for identity — this table extends it with app-level metadata.

```sql
CREATE TABLE users (
    -- Identity
    id                      UUID PRIMARY KEY,          -- same as supabase auth user id
    email                   TEXT UNIQUE NOT NULL,
    username                TEXT UNIQUE NOT NULL,

    -- Personal info
    first_name              TEXT,
    last_name               TEXT,
    date_of_birth           DATE,                      -- stored encrypted via pgcrypto
    gender                  TEXT,                      -- "male", "female", "non-binary", "prefer_not_to_say"
    phone                   TEXT,                      -- stored encrypted via pgcrypto

    -- Location & locale
    country                 TEXT,                      -- ISO 3166-1 alpha-2, e.g. "US", "ES", "AR"
    city                    TEXT,
    timezone                TEXT,                      -- IANA tz, e.g. "America/Buenos_Aires"
    locale                  TEXT DEFAULT 'en',         -- BCP 47 language tag, e.g. "en", "es", "fr"
    preferred_currency      TEXT DEFAULT 'USD',        -- ISO 4217, e.g. "USD", "EUR", "ARS"
    location_lat            DOUBLE PRECISION,          -- GPS from device (optional)
    location_lng            DOUBLE PRECISION,

    -- Body & sizing (for AI style recommendations)
    height_cm               SMALLINT,                  -- e.g. 170
    weight_kg               NUMERIC(5,1),              -- e.g. 65.5
    body_type               TEXT,                      -- "pear", "hourglass", "rectangle", "apple", "inverted_triangle"
    size_tops               TEXT,                      -- "XS", "S", "M", "L", "XL", "XXL"
    size_bottoms            TEXT,                      -- "XS", "S", "M", "28", "30", etc.
    size_shoes              TEXT,                      -- EU/US sizing as text to handle both
    size_dresses            TEXT,

    -- Style preferences
    style_tags              TEXT[],                    -- e.g. {"minimalist", "streetwear", "formal"}
    favourite_colors        TEXT[],                    -- e.g. {"black", "white", "navy"}
    avoided_colors          TEXT[],
    favourite_brands        UUID[],                    -- references brands(id)

    -- App metadata
    avatar_url              TEXT,                      -- signed URL, refreshed on read
    subscription_tier       TEXT NOT NULL DEFAULT 'free',  -- "free", "pro", "team"
    subscription_expires_at TIMESTAMPTZ,
    referral_source         TEXT,                      -- "instagram", "friend", "google", etc.
    onboarding_completed_at TIMESTAMPTZ,               -- NULL = still in onboarding
    last_seen_at            TIMESTAMPTZ,               -- updated on each API request
    total_outfits           INT NOT NULL DEFAULT 0,    -- denormalized counter, updated by trigger
    total_items             INT NOT NULL DEFAULT 0,    -- denormalized counter, updated by trigger

    -- Preferences & settings
    push_notifications      BOOLEAN NOT NULL DEFAULT TRUE,
    email_notifications     BOOLEAN NOT NULL DEFAULT TRUE,
    profile_is_public       BOOLEAN NOT NULL DEFAULT FALSE,
    ai_analysis_enabled     BOOLEAN NOT NULL DEFAULT TRUE,

    -- Audit
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at              TIMESTAMPTZ                -- soft delete
);

CREATE INDEX idx_users_country  ON users(country);
CREATE INDEX idx_users_tier     ON users(subscription_tier);
CREATE INDEX idx_users_last_seen ON users(last_seen_at DESC);
```

**What it stores:** identity, profile fields, body measurements, style preferences, location, and app-level metadata.
**What it does NOT store:** passwords (Supabase Auth), photos as base64, wardrobe data, or raw IP addresses.
**Encrypted columns:** `date_of_birth`, `phone`, `weight_kg` — use `pgcrypto` before writing, decrypt on read in the FastAPI layer.

---

### Table: `brands`

Shared catalog of clothing brands, normalized out of items.

```sql
CREATE TABLE brands (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT UNIQUE NOT NULL,
    country     TEXT,
    website     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**What it stores:** brand registry, reusable across all users' wardrobes.

---

### Table: `wardrobe_items`

Each individual clothing piece a user owns. Replaces the `photo_data` JSON blob.

```sql
CREATE TABLE wardrobe_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    brand_id        UUID REFERENCES brands(id),
    category        TEXT NOT NULL,             -- Top, Bottom, Shoes, Outerwear, etc.
    subcategory     TEXT,
    color           TEXT,
    color_hex       TEXT,
    material        TEXT,
    price           NUMERIC(10, 2),
    currency        TEXT DEFAULT 'USD',
    purchase_date   DATE,
    notes           TEXT,
    photo_url       TEXT,                      -- Supabase Storage signed URL
    thumbnail_url   TEXT,                      -- pre-generated thumbnail
    times_worn      INT NOT NULL DEFAULT 0,
    last_worn_at    DATE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_wardrobe_items_user    ON wardrobe_items(user_id);
CREATE INDEX idx_wardrobe_items_cat     ON wardrobe_items(user_id, category);
CREATE INDEX idx_wardrobe_items_brand   ON wardrobe_items(brand_id);
```

**What it stores:** every physical garment, its metadata, and a pointer to its photo in Storage.

---

### Table: `outfits`

One outfit per day per user — a container that groups wardrobe items together.

```sql
CREATE TABLE outfits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date_key        DATE NOT NULL,             -- the day this outfit was worn
    photo_url       TEXT,                      -- full outfit photo (bg removed)
    occasion        TEXT,                      -- casual, work, formal, sport...
    weather         TEXT,
    notes           TEXT,
    is_favourite    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,

    UNIQUE (user_id, date_key)                 -- one outfit per day per user
);

CREATE INDEX idx_outfits_user_date ON outfits(user_id, date_key DESC);
```

**What it stores:** the outfit as a whole — date, occasion, and the combined photo.

---

### Table: `outfit_items`

Many-to-many join between outfits and wardrobe items.

```sql
CREATE TABLE outfit_items (
    outfit_id       UUID NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
    item_id         UUID NOT NULL REFERENCES wardrobe_items(id) ON DELETE CASCADE,
    crop_url        TEXT,                      -- AI-cropped photo of this item in this outfit
    position        INT,                       -- display order
    PRIMARY KEY (outfit_id, item_id)
);

CREATE INDEX idx_outfit_items_item ON outfit_items(item_id);
```

**What it stores:** which items appear in each outfit, and the cropped photo of each item as it appeared that day.

---

### Table: `ai_analyses`

Results from AI calls (outfit analysis, item classification, style scoring). Kept separate so they can be reprocessed, versioned, or deleted without touching core data.

```sql
CREATE TABLE ai_analyses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outfit_id       UUID REFERENCES outfits(id) ON DELETE SET NULL,
    item_id         UUID REFERENCES wardrobe_items(id) ON DELETE SET NULL,
    model_name      TEXT NOT NULL,             -- e.g. "gpt-4o", "claude-3-5-sonnet"
    model_version   TEXT,
    analysis_type   TEXT NOT NULL,             -- "outfit_score", "item_classify", "style_match"
    input_tokens    INT,
    output_tokens   INT,
    result          JSONB NOT NULL,            -- raw JSON from the model
    confidence      NUMERIC(4, 3),             -- 0.000 – 1.000
    processing_ms   INT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_outfit    ON ai_analyses(outfit_id);
CREATE INDEX idx_ai_item      ON ai_analyses(item_id);
CREATE INDEX idx_ai_type      ON ai_analyses(analysis_type, created_at DESC);
```

**What it stores:** every AI call result, which model ran it, how many tokens it used, and the raw output. Useful for cost tracking, quality auditing, and reprocessing.

---

### Table: `user_events`

Behavioral event log. The foundation for product analytics and funnel analysis.

```sql
CREATE TABLE user_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    session_id  TEXT,
    event_name  TEXT NOT NULL,                 -- e.g. "outfit_created", "item_deleted"
    properties  JSONB,                         -- flexible payload per event type
    platform    TEXT,                          -- "web", "ios", "android"
    ip_hash     TEXT,                          -- hashed (never store raw IPs)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_user     ON user_events(user_id, created_at DESC);
CREATE INDEX idx_events_name     ON user_events(event_name, created_at DESC);
CREATE INDEX idx_events_session  ON user_events(session_id);
```

**What it stores:** every meaningful action a user takes. Powers retention, funnel, and engagement metrics. Never stores PII directly — only user_id references.

---

### Materialized views (desnormalization cache)

For dashboard queries that would be expensive to compute on every request:

```sql
-- Wardrobe summary per user (refreshed daily)
CREATE MATERIALIZED VIEW mv_user_wardrobe_stats AS
SELECT
    user_id,
    COUNT(*)                                        AS total_items,
    COUNT(*) FILTER (WHERE category = 'Top')        AS tops,
    COUNT(*) FILTER (WHERE category = 'Bottom')     AS bottoms,
    COUNT(*) FILTER (WHERE category = 'Shoes')      AS shoes,
    SUM(price)                                      AS total_wardrobe_value,
    MAX(updated_at)                                 AS last_updated
FROM wardrobe_items
WHERE deleted_at IS NULL AND is_active = TRUE
GROUP BY user_id;

CREATE UNIQUE INDEX ON mv_user_wardrobe_stats(user_id);
-- Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_wardrobe_stats;
```

---

## Storage Structure

### Where files are stored

Supabase Storage runs **in the cloud on Supabase's servers** (backed by AWS S3). Files are not stored locally on any computer. They are accessible from anywhere via HTTPS.

**Storage limits by plan:**

| Plan | Storage included | Extra |
|---|---|---|
| Free | 1 GB total | Not available |
| Pro ($25/mo) | 100 GB | $0.021 / GB |
| Team ($599/mo) | 200 GB | $0.021 / GB |

> At ~150 KB per outfit photo (compressed + bg removed), 1 GB free tier = ~6,600 photos across all users combined. Plan for Pro once you have more than ~50 active users.

---

### Bucket layout

All files live in the `outfit-photos` bucket in Supabase Storage (S3-compatible). The path structure is designed to be:
- **Predictable**: easy to generate and parse programmatically
- **User-isolated**: each user's files are under their UUID
- **Cacheable**: thumbnails are separate from originals

```
outfit-photos/
  {user_id}/
    avatar/
      original.jpg
      thumbnail.jpg
    items/
      {item_id}/
        original.jpg        ← full-size, bg-removed
        thumbnail.jpg       ← 400px max, pre-generated
    outfits/
      {outfit_id}/
        original.jpg        ← full outfit photo
        {item_id}_crop.jpg  ← AI-cropped item within this outfit
```

### CDN setup

Photos should never be served directly from Supabase Storage in production.

```
User request
    │
    ▼
Cloudflare R2 (or AWS CloudFront)    ← edge cache, global PoPs
    │  cache miss
    ▼
Supabase Storage                     ← origin, private bucket
    │
    ▼
FastAPI generates signed URL         ← valid for 1 hour, user-scoped
```

**Key rules:**
- Bucket is **private** — no public URLs. All access via signed URLs with expiry.
- FastAPI generates signed URLs on-demand, scoped to the requesting user.
- CDN caches the signed URL response, not the URL itself.
- Original photos are stored once. Thumbnails are generated on upload by a background worker.

---

## Encryption

### Encryption layers

| Layer | What it protects | How |
|---|---|---|
| **In transit** | All client ↔ API traffic | TLS 1.3 enforced (HTTPS only, HSTS header) |
| **At rest — files** | Photos in Supabase Storage | AES-256 at volume level (managed by Supabase/AWS) |
| **At rest — database** | All PostgreSQL data | Transparent Data Encryption (managed by Supabase/Neon) |
| **Column-level** | Sensitive PII (DOB, phone) | `pgcrypto` extension: `pgp_sym_encrypt` / `pgp_sym_decrypt` |
| **Signed URLs** | Photo access control | Short-lived tokens (1h), user-scoped, generated by FastAPI |
| **Passwords** | User credentials | Never stored — Supabase Auth handles bcrypt hashing |
| **API keys** | Service-to-service auth | Stored in environment variables, never in code or DB |

### Column-level encryption example

For columns like `date_of_birth` and `phone` in the `users` table:

```sql
-- Store encrypted
UPDATE users
SET phone = pgp_sym_encrypt('123456789', current_setting('app.encryption_key'))
WHERE id = '...';

-- Read decrypted
SELECT pgp_sym_decrypt(phone::bytea, current_setting('app.encryption_key'))
FROM users
WHERE id = '...';
```

The encryption key is set per session from a secret managed in the environment (never hardcoded). Rotate keys using a versioned key management approach (AWS KMS, HashiCorp Vault, or Supabase Vault).

### What to never store

- Raw IP addresses → store `sha256(ip + salt)` only
- Plaintext passwords → delegated to Supabase Auth
- API keys in the database → use environment secrets
- Full credit card numbers → not applicable here, but noted for future payments

---

## Access Control & Roles

### Authentication flow

```
Frontend  →  Supabase Auth (login/signup)
          ←  JWT token (short-lived, 1h)

Frontend  →  FastAPI (Authorization: Bearer <jwt>)
          →  FastAPI verifies JWT signature using Supabase public key
          →  Extracts user_id and role from JWT claims
          →  Enforces role permissions
```

FastAPI never issues its own tokens — it only validates tokens issued by Supabase Auth. This keeps the auth surface minimal.

---

### Roles

There are three roles in the system. Each role is stored in the JWT claim `app_metadata.role` and enforced at both the API layer (FastAPI) and the database layer (Row Level Security).

---

#### Role: `user` (default)

Assigned automatically on signup. This is every regular app user.

**Can:**
- Read, create, update, and soft-delete their own wardrobe items
- Read, create, update, and soft-delete their own outfits
- Read their own AI analyses
- Read their own event history
- Update their own profile (username, avatar, name, DOB, phone)
- Generate signed URLs for their own photos

**Cannot:**
- Read any other user's data
- Access the `/admin` or `/analytics` routes
- Read aggregated platform metrics

**Row Level Security policy example:**
```sql
-- Users can only see their own wardrobe items
CREATE POLICY user_own_items ON wardrobe_items
    FOR ALL
    USING (user_id = auth.uid());
```

---

#### Role: `analyst`

Assigned manually by an admin. Intended for internal data team members who need read access to aggregated data for reporting.

**Can:**
- Read anonymized, aggregated metrics (via materialized views)
- Query `user_events` with PII columns excluded
- Access Metabase dashboards
- Read `ai_analyses` in aggregate (not per individual user)

**Cannot:**
- Read individual user profiles or wardrobe data
- Access raw `users` table rows
- Write any data to any table
- Generate signed URLs for user photos

**Implementation:** a dedicated read-only PostgreSQL role (`stylewrap_analyst`) is granted SELECT only on views and materialized views — never on base tables directly.

```sql
CREATE ROLE stylewrap_analyst;
GRANT SELECT ON mv_user_wardrobe_stats TO stylewrap_analyst;
GRANT SELECT ON analytics_events_view  TO stylewrap_analyst;
-- No access to: users, wardrobe_items, outfits, etc.
```

---

#### Role: `admin`

Assigned manually to engineering/ops team members. Full access for support, moderation, and infrastructure work.

**Can:**
- Read and soft-delete any user's content (for moderation)
- Assign and revoke roles
- Access all FastAPI routes including `/admin/*`
- View raw event logs and AI analysis costs
- Trigger manual jobs (thumbnail regeneration, materialized view refresh)

**Cannot:**
- Read encrypted PII columns without a separate key ceremony (by design)
- Hard-delete rows (soft-delete only, preserving audit trail)

**Implementation:** admin actions are always logged to `user_events` with `event_name = "admin_action"` and the admin's `user_id` as the actor.

---

### How to assign a role

Roles are stored in Supabase Auth's `app_metadata` (server-side only, not editable by users):

```bash
# Via Supabase Management API (run from your backend or admin CLI)
curl -X PATCH https://<project>.supabase.co/auth/v1/admin/users/<user_id> \
  -H "apikey: <service_role_key>" \
  -H "Content-Type: application/json" \
  -d '{"app_metadata": {"role": "analyst"}}'
```

FastAPI reads the role from the verified JWT:
```python
# FastAPI dependency
def require_role(required: str):
    def checker(token: dict = Depends(verify_jwt)):
        role = token.get("app_metadata", {}).get("role", "user")
        if role != required:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
    return checker

# Usage on a route
@router.get("/admin/users")
def list_users(_=Depends(require_role("admin"))):
    ...
```

---

## Metrics & Observability

The observability stack is split into four concerns, each with the right tool for the job.

### Layer 1 — Product metrics (what users do)

**Tool: PostHog (self-hosted)**

PostHog is an open-source product analytics platform. Self-hosting keeps user data on your infrastructure and avoids GDPR issues with third-party processors.

**What to track:**
```
outfit_created          → user added an outfit for a date
item_added              → user added a wardrobe item
photo_uploaded          → user uploaded a photo
ai_analysis_requested   → AI analysis was triggered
favourite_toggled       → user starred/unstarred an outfit
wardrobe_viewed         → user opened wardrobe screen
onboarding_completed    → user finished signup flow
```

**Integration:** FastAPI emits events to PostHog via its Python SDK after each meaningful action. Events are also stored in the `user_events` table as a backup.

**Key dashboards to build:**
- DAU / WAU / MAU
- Outfit creation funnel (open app → add photo → AI analysis → save)
- Feature adoption (% of users with >10 items, % using AI analysis)
- Retention cohorts (D1, D7, D30)

---

### Layer 2 — Database performance

**Tool: pg_stat_statements + Grafana or Metabase**

`pg_stat_statements` is a built-in PostgreSQL extension that tracks query execution statistics. It is the standard way to identify slow queries without installing external agents.

**Enable in PostgreSQL:**
```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

**Key queries to monitor:**
```sql
-- Top 10 slowest queries
SELECT query, mean_exec_time, calls, total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Queries with most total time (optimization targets)
SELECT query, total_exec_time, calls
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

Connect Metabase (already in the stack) directly to PostgreSQL and create scheduled dashboard snapshots of these queries for the team.

**Alerts to set up:**
- Query P95 latency > 500ms
- Table bloat > 20% (dead tuples)
- Index hit rate < 95%
- Connection pool saturation > 80%

---

### Layer 3 — Infrastructure

**Tool: Prometheus + Grafana**

Prometheus scrapes metrics from FastAPI, PostgreSQL exporter, and the host system. Grafana visualizes them.

**FastAPI integration:**
```python
# Add to FastAPI app
from prometheus_fastapi_instrumentator import Instrumentator
Instrumentator().instrument(app).expose(app)
# Exposes /metrics endpoint for Prometheus to scrape
```

**Key metrics to monitor:**

| Metric | Alert threshold |
|---|---|
| API request latency (P95) | > 1s |
| API error rate (5xx) | > 1% of requests |
| API requests per second | baseline deviation > 3x |
| PostgreSQL active connections | > 80% of max |
| Storage bucket size | > 80% of quota |
| AI API cost per day | > budget threshold |

**Recommended Grafana dashboards:**
- FastAPI golden signals (latency, traffic, errors, saturation)
- PostgreSQL overview (connections, query times, cache hit ratio)
- AI analysis cost tracker (tokens used per model per day)

---

### Layer 4 — Logs

**Tool: Loki + Grafana (same Grafana instance as above)**

Loki is a log aggregation system designed to work alongside Prometheus. Logs from FastAPI are shipped to Loki using Promtail.

**Log levels and what to log:**

```python
# INFO — normal operations
logger.info("outfit_created", user_id=user_id, outfit_id=outfit_id)

# WARNING — recoverable issues
logger.warning("ai_analysis_slow", duration_ms=2300, outfit_id=outfit_id)

# ERROR — failed operations requiring attention
logger.error("photo_upload_failed", user_id=user_id, error=str(e))

# CRITICAL — service-level failures
logger.critical("database_connection_lost", pool_size=0)
```

**What to never log:**
- Passwords or tokens (even partial)
- Full photo URLs (they contain signed tokens)
- Raw PII (email, phone, DOB) — log `user_id` only
- Full request bodies if they contain file uploads

**Retention policy:**
- ERROR and CRITICAL logs: 90 days
- INFO and WARNING logs: 30 days
- `user_events` table: indefinite (it's business data, not operational logs)

---

## Deployment

### Services and where they run

| Service | Platform | Reason |
|---|---|---|
| FastAPI | Railway or Render | Simple deploys from GitHub, auto-scaling, built-in env management |
| PostgreSQL | Supabase or Neon | Managed Postgres, automatic backups, point-in-time recovery |
| Auth | Supabase Auth | Already integrated, no reason to replace |
| Storage | Supabase Storage | S3-compatible, already integrated |
| CDN | Cloudflare R2 | Free egress, global PoPs, easy to set up in front of Supabase Storage |
| PostHog | Self-hosted on Railway | One Docker container, keeps user data on your infra |
| Metabase | Self-hosted on Railway | One Docker container, connects directly to PostgreSQL |
| Prometheus + Grafana | Self-hosted on Railway | Standard monitoring stack, Grafana connects to both Prometheus and Loki |

### Environment variables (FastAPI)

```bash
# Database
DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/stylewrap

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...       # server-side only, never expose to frontend
SUPABASE_JWT_SECRET=...             # for verifying user JWTs

# Storage
STORAGE_BUCKET=outfit-photos
CDN_BASE_URL=https://your-cdn.com

# AI
OPENAI_API_KEY=...                  # or Anthropic, etc.
REMOVEBG_API_KEY=...

# Encryption
APP_ENCRYPTION_KEY=...              # for pgcrypto column encryption — rotate quarterly

# Observability
POSTHOG_API_KEY=...
SENTRY_DSN=...                      # optional, for error tracking
```

### CI/CD pipeline (GitHub Actions)

```
push to main branch
    │
    ▼
Run tests (pytest)
    │
    ▼
Run Alembic migrations against staging DB
    │
    ▼
Build Docker image
    │
    ▼
Deploy to Railway (production)
    │
    ▼
Run smoke tests against production /health endpoint
```

### Backup policy

| Asset | Frequency | Retention | Method |
|---|---|---|---|
| PostgreSQL | Continuous WAL | 7-day PITR | Supabase / Neon built-in |
| PostgreSQL | Daily snapshot | 30 days | pg_dump to S3 |
| Supabase Storage | Daily | 30 days | Rclone to separate S3 bucket |
| Grafana dashboards | On change | Git | Export JSON to repo |

---

*Last updated: April 2026*
