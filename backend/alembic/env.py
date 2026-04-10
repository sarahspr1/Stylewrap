import asyncio
import os
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine

# Load .env file so DATABASE_URL is available whether running locally or in CI
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

# Import all models so Alembic can detect them
from app.core.database import Base
from app.models import user, brand, wardrobe_item, outfit, outfit_item, ai_analysis, user_event  # noqa: F401

config = context.config
fileConfig(config.config_file_name)

DATABASE_URL = os.environ["DATABASE_URL"]

target_metadata = Base.metadata


def run_migrations_offline():
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online():
    connectable = create_async_engine(DATABASE_URL, echo=False)
    async with connectable.connect() as connection:
        await connection.run_sync(
            lambda sync_conn: context.configure(
                connection=sync_conn,
                target_metadata=target_metadata,
                compare_type=True,
            )
        )
        async with connection.begin():
            await connection.run_sync(lambda _: context.run_migrations())
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
