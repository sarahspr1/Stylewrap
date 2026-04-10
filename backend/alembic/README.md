# alembic

Database migration management using Alembic. Every schema change (new table, new column, new index) is a versioned migration file here.

## Common commands

```bash
# Apply all pending migrations (run this on every deploy)
alembic upgrade head

# Roll back the last migration
alembic downgrade -1

# Auto-generate a migration from model changes
alembic revision --autogenerate -m "add collections table"

# See current migration state
alembic current

# See full migration history
alembic history
```

## Workflow for schema changes

1. Edit or create a model in `app/models/`
2. Run `alembic revision --autogenerate -m "describe the change"`
3. **Review the generated file** in `versions/` — autogenerate is not always perfect
4. Run `alembic upgrade head` against your local DB to test
5. Commit the migration file alongside the model change
6. On deploy, the CI pipeline runs `alembic upgrade head` before starting the server

## Migration files

| File | What it creates |
|---|---|
| `versions/001_initial_schema.py` | All tables, indexes, Row Level Security policies, the materialized view, and the analyst read-only role |

## Important rules

- Never edit a migration that has already been applied to production
- Always run `alembic upgrade head` in CI before running tests
- The `DATABASE_URL` env var must be set before running any alembic command
