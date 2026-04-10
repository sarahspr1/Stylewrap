# Stylewrap — Backend

FastAPI backend for the Stylewrap platform. The frontend (React/Vite) continues to write data directly to Supabase as always. The backend **reads from that same Supabase database** to provide analytics, metrics, and processed data — without touching the frontend at all.

```
Frontend (React)  →  Supabase  (writes data, auth, storage)
                          ↓
                     PostgreSQL  ←── Backend (reads, analyzes, exposes API)
                          ↓
                     Metabase / /docs / /metrics
```

## user_events — tracked events

The frontend writes directly to the `user_events` table in Supabase. Each event has an `event_name` and a `properties` JSON object with extra context.

| Event | Triggered when | Properties |
|---|---|---|
| `user_signed_up` | A new user completes registration | `username` |
| `user_signed_in` | An existing user logs in | _(none)_ |
| `outfit_created` | A photo is uploaded and AI analysis completes | `date_key`, `items_count`, `style`, `season` |
| `favourite_toggled` | A user stars or unstars a wardrobe item | `item_name`, `action` (`"added"` or `"removed"`) |
| `screen_viewed` | User navigates to a new screen | `screen` (`"home"`, `"calendar"`, `"wardrobe"`, `"favorites"`) |
| `outfit_deleted` | User removes an outfit log | `date_key` |
| `ai_analysis_failed` | AI analysis throws an error | `error`, `date_key` |
| `onboarding_completed` | User uploads their very first outfit | `items_count` |
| `session_ended` | User closes or refreshes the tab | `session_duration_seconds` |

### Useful queries on user_events

```sql
-- Events per type (what users do most)
SELECT event_name, COUNT(*) AS total
FROM user_events
GROUP BY event_name
ORDER BY total DESC;

-- Daily signups
SELECT DATE(created_at) AS day, COUNT(*) AS signups
FROM user_events
WHERE event_name = 'user_signed_up'
GROUP BY day
ORDER BY day DESC;

-- Daily active users (unique users per day)
SELECT DATE(created_at) AS day, COUNT(DISTINCT user_id) AS dau
FROM user_events
GROUP BY day
ORDER BY day DESC;

-- Outfits created per day with avg items
SELECT
    DATE(created_at) AS day,
    COUNT(*) AS outfits,
    AVG((properties->>'items_count')::int) AS avg_items
FROM user_events
WHERE event_name = 'outfit_created'
GROUP BY day
ORDER BY day DESC;

-- Most common outfit styles
SELECT
    properties->>'style' AS style,
    COUNT(*) AS total
FROM user_events
WHERE event_name = 'outfit_created'
GROUP BY style
ORDER BY total DESC;

-- Favourite add vs remove ratio
SELECT
    properties->>'action' AS action,
    COUNT(*) AS total
FROM user_events
WHERE event_name = 'favourite_toggled'
GROUP BY action;
```

### Adding a new event

In `OutfitApp.jsx`, call the `track()` function (defined at the top of the file):

```js
track("event_name", { key: "value", other_key: 123 });
```

Then add it to the table above.

---

## Requirements

- Python 3.12+
- PostgreSQL 16 (via Supabase or Neon)
- A Supabase project (for Auth + Storage)

## Setup

```bash
# 1. Create a virtual environment
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env
# Fill in the values in .env

# 4. Run DB migrations
alembic upgrade head

# 5. Start the server
uvicorn main:app --reload --port 8000
```

API docs available at: http://localhost:8000/docs (development only)
Health check: http://localhost:8000/health

## Folder structure

```
backend/
  main.py                  ← FastAPI app entry point, CORS, Prometheus
  requirements.txt         ← Python dependencies
  .env.example             ← Environment variable template
  alembic.ini              ← Alembic migration config
  app/
    core/                  ← Config, DB engine, JWT security
    models/                ← SQLAlchemy table definitions
    schemas/               ← Pydantic request/response models
    api/v1/endpoints/      ← Route handlers (one file per resource)
    services/              ← Storage, event tracking, AI
  alembic/
    env.py                 ← Alembic runtime config
    versions/              ← Migration files (one per schema change)
```

## Environment variables

Copy `.env.example` to `.env` and fill in each value following the guide below.

---

### DATABASE_URL

**Format:** `postgresql+asyncpg://user:password@host:5432/dbname`

**Option A — Supabase (recommended, already in the stack):**
1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → your project
2. **Settings** → **Database** → scroll to **Connection string**
3. Select the **URI** tab, copy it
4. Replace `postgresql://` with `postgresql+asyncpg://`

**Option B — Neon (better for heavy data work):**
1. Go to [neon.tech](https://neon.tech) → your project → **Dashboard**
2. Click **Connection Details** → select **SQLAlchemy (async)**
3. Copy the URL directly — it already uses the `asyncpg` driver

---

### SUPABASE_URL

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → your project
2. **Settings** → **API**
3. Copy the **Project URL** (looks like `https://abcdefgh.supabase.co`)

---

### SUPABASE_SERVICE_ROLE_KEY

> **Never expose this key to the frontend or commit it to git. It bypasses Row Level Security.**

1. Same page: **Settings** → **API**
2. Under **Project API keys**, copy the **`service_role`** key (click the eye icon to reveal it)

---

### SUPABASE_JWT_SECRET

1. Same page: **Settings** → **API**
2. Under **JWT Settings**, copy the **JWT Secret**

---

### STORAGE_BUCKET

Leave as `outfit-photos` unless you created the bucket with a different name in Supabase Storage.

To verify: **Supabase dashboard** → **Storage** → check the bucket name.

---

### CDN_BASE_URL

Leave **empty** during development — photos will be served directly from Supabase Storage.

For production with Cloudflare R2:
1. Create a bucket in [Cloudflare R2](https://dash.cloudflare.com) and set up a custom domain
2. Set `CDN_BASE_URL=https://your-custom-domain.com`

For production with AWS CloudFront:
1. Create a CloudFront distribution pointing to your Supabase Storage URL as origin
2. Set `CDN_BASE_URL=https://your-distribution-id.cloudfront.net`

---

### OPENAI_API_KEY

1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Click **Create new secret key**
3. Copy it immediately — it won't be shown again

Leave empty if you are not using OpenAI for AI analysis.

---

### REMOVEBG_API_KEY

1. Go to [remove.bg/dashboard#api-key](https://www.remove.bg/dashboard#api-key)
2. Copy your API key from the **API Key** section

Free tier: 50 preview calls/month. Paid plans start at $0.20/image.

---

### APP_ENCRYPTION_KEY

This key is used by `pgcrypto` to encrypt sensitive columns (`date_of_birth`, `phone`, `weight_kg`).

Generate one locally — never use an online generator for secrets:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

**Rules:**
- Store it somewhere safe (a password manager)
- Rotate it quarterly — document the rotation date
- If you lose this key, encrypted data is permanently unreadable

---

### POSTHOG_API_KEY and POSTHOG_HOST

**Option A — PostHog Cloud (easiest):**
1. Sign up at [posthog.com](https://posthog.com)
2. Go to **Project Settings** → **Project API Key**
3. Leave `POSTHOG_HOST=https://app.posthog.com`

**Option B — Self-hosted PostHog (recommended for privacy):**
1. Deploy PostHog via Docker on Railway: [posthog.com/docs/self-host](https://posthog.com/docs/self-host)
2. Set `POSTHOG_HOST=https://your-posthog-instance.com`
3. Get the API key from your self-hosted instance's project settings

Leave both empty to disable event tracking entirely.

---

### ENVIRONMENT and DEBUG

| Value | Use |
|---|---|
| `ENVIRONMENT=development` | Local dev — verbose logs, no rate limiting |
| `ENVIRONMENT=staging` | Pre-production testing |
| `ENVIRONMENT=production` | Live — hides `/docs`, enables strict error handling |
| `DEBUG=true` | Logs all SQL queries to console (development only) |
| `DEBUG=false` | Silent SQL — always use in staging/production |

---

### ALLOWED_ORIGINS

Comma-separated list of frontend URLs that are allowed to call this API (CORS).

```
# Development
ALLOWED_ORIGINS=http://localhost:3000

# Production (add your deployed frontend URL)
ALLOWED_ORIGINS=http://localhost:3000,https://stylewrap.app
```

---

## How to access your data

The backend is running and connected to Supabase. Here is every way to see and query what's in the database.

---

### 1. Supabase Dashboard — browse tables visually

> Best for: quickly checking what data exists, running one-off SQL queries.

**URL:** [supabase.com/dashboard](https://supabase.com/dashboard) → project `jatyjbpvndvbdwzcatxc`

| Section | What you see |
|---|---|
| **Table Editor** | Browse rows in any table. Filter, sort, edit inline. |
| **SQL Editor** | Run raw SQL against the live database. |
| **Storage** | See the `outfit-photos` bucket — all user photos. |
| **Auth → Users** | All registered users, their emails, last sign-in. |
| **Logs → Postgres** | Live query logs — useful for debugging slow queries. |

**Useful SQL queries to run in the SQL Editor:**

```sql
-- All users and their wardrobe size
SELECT u.username, u.email, u.total_items, u.total_outfits, u.created_at
FROM users u
ORDER BY u.created_at DESC;

-- What the frontend currently stores (old profiles table)
SELECT id, "Username", jsonb_object_keys(photo_data) as date_keys
FROM profiles
LIMIT 20;

-- Events by type — what users are doing
SELECT event_name, COUNT(*) as total
FROM user_events
GROUP BY event_name
ORDER BY total DESC;

-- AI analysis cost (tokens used per model)
SELECT model_name, SUM(input_tokens) as total_input, SUM(output_tokens) as total_output
FROM ai_analyses
GROUP BY model_name;

-- Wardrobe stats per user (from materialized view)
SELECT * FROM mv_user_wardrobe_stats ORDER BY total_items DESC;

-- Refresh the materialized view after data changes
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_wardrobe_stats;
```

---

### 2. FastAPI `/docs` — interactive API explorer

> Best for: testing endpoints, understanding what the API returns, debugging.

**Requires:** backend running (`uvicorn main:app --reload --port 8000`)

**URL:** [http://localhost:8000/docs](http://localhost:8000/docs)

What you can do here:
- Click any endpoint → **Try it out** → **Execute**
- See the exact JSON response structure
- Test auth-protected routes by pasting a Supabase JWT in the **Authorize** button (top right)

**Key endpoints to explore:**

| Endpoint | What it returns |
|---|---|
| `GET /api/v1/analytics/me/summary` | Wardrobe breakdown + outfit count for a user |
| `GET /api/v1/analytics/platform/overview` | Total users, pro users, avg items (analyst role) |
| `GET /api/v1/wardrobe/` | All wardrobe items for the authenticated user |
| `GET /api/v1/outfits/` | All outfits, filterable by date range |
| `GET /health` | Server status — no auth required |

**How to get a JWT for testing:**
```js
// Run this in the browser console while the frontend app is open
const { data } = await supabase.auth.getSession()
console.log(data.session.access_token)
```
Paste that token in the `/docs` Authorize dialog.

---

### 3. `/metrics` — Prometheus metrics (infrastructure)

> Best for: API performance, request counts, error rates.

**Requires:** backend running

**URL:** [http://localhost:8000/metrics](http://localhost:8000/metrics)

This is a raw text endpoint. The most useful metrics:

```
http_requests_total                    ← total requests by route and status code
http_request_duration_seconds          ← latency histogram per route
http_requests_in_progress              ← concurrent requests right now
```

To visualize these, connect Prometheus + Grafana (see Architecture doc).

---

### 4. Metabase — dashboards without writing SQL

> Best for: recurring reports, sharing charts with non-technical team members.

**Setup (one time, ~5 min):**
```bash
docker run -d -p 3002:3000 --name metabase metabase/metabase
```
Then open [http://localhost:3002](http://localhost:3002) and connect with:
- **Database type:** PostgreSQL
- **Host:** `aws-0-eu-west-1.pooler.supabase.com`
- **Port:** `5432`
- **Database name:** `postgres`
- **Username:** `postgres.jatyjbpvndvbdwzcatxc`
- **Password:** your DB password from `.env`

**Dashboards to build first:**
- Daily active users (from `user_events` grouped by day)
- Wardrobe items by category (from `mv_user_wardrobe_stats`)
- Outfit creation trend (from `outfits` grouped by week)
- AI analysis cost over time (from `ai_analyses` — tokens × price)

---

### 5. Direct Python queries (for data engineering)

> Best for: one-off analysis, pandas DataFrames, Jupyter notebooks.

```bash
pip install psycopg2-binary pandas sqlalchemy
```

```python
import pandas as pd
from sqlalchemy import create_engine

# Use the session pooler URL from your .env (replace asyncpg with psycopg2)
engine = create_engine(
    "postgresql://postgres.jatyjbpvndvbdwzcatxc:YOUR_PASSWORD"
    "@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"
)

# Load the wardrobe stats view into a DataFrame
df = pd.read_sql("SELECT * FROM mv_user_wardrobe_stats", engine)
print(df.describe())

# Load all user events
events = pd.read_sql("""
    SELECT event_name, DATE(created_at) as day, COUNT(*) as count
    FROM user_events
    GROUP BY event_name, day
    ORDER BY day DESC
""", engine)
```

---

## Running in production

Deploy to Railway or Render. Set all `.env` variables as environment secrets in the platform UI. The `DATABASE_URL` must point to your Supabase or Neon PostgreSQL instance.

```bash
# Production start command
uvicorn main:app --host 0.0.0.0 --port $PORT --workers 4
```
