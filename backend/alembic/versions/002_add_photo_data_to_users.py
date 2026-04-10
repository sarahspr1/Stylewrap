"""add photo_data and favourites to users

Revision ID: 002
Revises: 001
Create Date: 2026-04-09
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("photo_data", postgresql.JSONB, server_default="{}"))
    op.add_column("users", sa.Column("favourites", postgresql.ARRAY(sa.Text), server_default="{}"))


def downgrade():
    op.drop_column("users", "photo_data")
    op.drop_column("users", "favourites")
