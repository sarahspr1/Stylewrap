"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-04-09
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto;")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_stat_statements;")

    # ── users ──────────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.Text, unique=True, nullable=False),
        sa.Column("username", sa.Text, unique=True, nullable=False),
        # Personal info
        sa.Column("first_name", sa.Text),
        sa.Column("last_name", sa.Text),
        sa.Column("date_of_birth", sa.Text),       # encrypted
        sa.Column("gender", sa.Text),
        sa.Column("phone", sa.Text),               # encrypted
        # Location & locale
        sa.Column("country", sa.String(2)),
        sa.Column("city", sa.Text),
        sa.Column("timezone", sa.Text),
        sa.Column("locale", sa.Text, server_default="en"),
        sa.Column("preferred_currency", sa.String(3), server_default="USD"),
        sa.Column("location_lat", sa.Double),
        sa.Column("location_lng", sa.Double),
        # Body & sizing
        sa.Column("height_cm", sa.SmallInteger),
        sa.Column("weight_kg", sa.Numeric(5, 1)),  # encrypted
        sa.Column("body_type", sa.Text),
        sa.Column("size_tops", sa.Text),
        sa.Column("size_bottoms", sa.Text),
        sa.Column("size_shoes", sa.Text),
        sa.Column("size_dresses", sa.Text),
        # Style preferences
        sa.Column("style_tags", postgresql.ARRAY(sa.Text), server_default="{}"),
        sa.Column("favourite_colors", postgresql.ARRAY(sa.Text), server_default="{}"),
        sa.Column("avoided_colors", postgresql.ARRAY(sa.Text), server_default="{}"),
        # App metadata
        sa.Column("avatar_url", sa.Text),
        sa.Column("subscription_tier", sa.Text, nullable=False, server_default="free"),
        sa.Column("subscription_expires_at", sa.DateTime(timezone=True)),
        sa.Column("referral_source", sa.Text),
        sa.Column("onboarding_completed_at", sa.DateTime(timezone=True)),
        sa.Column("last_seen_at", sa.DateTime(timezone=True)),
        sa.Column("total_outfits", sa.Integer, nullable=False, server_default="0"),
        sa.Column("total_items", sa.Integer, nullable=False, server_default="0"),
        # Settings
        sa.Column("push_notifications", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("email_notifications", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("profile_is_public", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("ai_analysis_enabled", sa.Boolean, nullable=False, server_default="true"),
        # Audit
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
    )
    op.create_index("idx_users_country",   "users", ["country"])
    op.create_index("idx_users_tier",      "users", ["subscription_tier"])
    op.create_index("idx_users_last_seen", "users", ["last_seen_at"], postgresql_ops={"last_seen_at": "DESC NULLS LAST"})

    # ── brands ─────────────────────────────────────────────────────────────────
    op.create_table(
        "brands",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.Text, unique=True, nullable=False),
        sa.Column("country", sa.Text),
        sa.Column("website", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )

    # ── wardrobe_items ─────────────────────────────────────────────────────────
    op.create_table(
        "wardrobe_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("brand_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("brands.id")),
        sa.Column("category", sa.Text, nullable=False),
        sa.Column("subcategory", sa.Text),
        sa.Column("color", sa.Text),
        sa.Column("color_hex", sa.String(7)),
        sa.Column("material", sa.Text),
        sa.Column("price", sa.Numeric(10, 2)),
        sa.Column("currency", sa.String(3), server_default="USD"),
        sa.Column("purchase_date", sa.Date),
        sa.Column("notes", sa.Text),
        sa.Column("photo_url", sa.Text),
        sa.Column("thumbnail_url", sa.Text),
        sa.Column("times_worn", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_worn_at", sa.Date),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
    )
    op.create_index("idx_wardrobe_user",  "wardrobe_items", ["user_id"])
    op.create_index("idx_wardrobe_cat",   "wardrobe_items", ["user_id", "category"])
    op.create_index("idx_wardrobe_brand", "wardrobe_items", ["brand_id"])

    # ── outfits ────────────────────────────────────────────────────────────────
    op.create_table(
        "outfits",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date_key", sa.Date, nullable=False),
        sa.Column("photo_url", sa.Text),
        sa.Column("occasion", sa.Text),
        sa.Column("weather", sa.Text),
        sa.Column("notes", sa.Text),
        sa.Column("is_favourite", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("user_id", "date_key", name="uq_outfit_user_date"),
    )
    op.create_index("idx_outfits_user_date", "outfits", ["user_id", "date_key"])

    # ── outfit_items ───────────────────────────────────────────────────────────
    op.create_table(
        "outfit_items",
        sa.Column("outfit_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("outfits.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("wardrobe_items.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("crop_url", sa.Text),
        sa.Column("position", sa.Integer),
    )
    op.create_index("idx_outfit_items_item", "outfit_items", ["item_id"])

    # ── ai_analyses ────────────────────────────────────────────────────────────
    op.create_table(
        "ai_analyses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("outfit_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("outfits.id", ondelete="SET NULL")),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("wardrobe_items.id", ondelete="SET NULL")),
        sa.Column("model_name", sa.Text, nullable=False),
        sa.Column("model_version", sa.Text),
        sa.Column("analysis_type", sa.Text, nullable=False),
        sa.Column("input_tokens", sa.Integer),
        sa.Column("output_tokens", sa.Integer),
        sa.Column("result", postgresql.JSONB, nullable=False),
        sa.Column("confidence", sa.Numeric(4, 3)),
        sa.Column("processing_ms", sa.Integer),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("idx_ai_outfit", "ai_analyses", ["outfit_id"])
    op.create_index("idx_ai_item",   "ai_analyses", ["item_id"])
    op.create_index("idx_ai_type",   "ai_analyses", ["analysis_type", "created_at"])

    # ── user_events ────────────────────────────────────────────────────────────
    op.create_table(
        "user_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("session_id", sa.Text),
        sa.Column("event_name", sa.Text, nullable=False),
        sa.Column("properties", postgresql.JSONB),
        sa.Column("platform", sa.Text),
        sa.Column("ip_hash", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("idx_events_user",    "user_events", ["user_id", "created_at"])
    op.create_index("idx_events_name",    "user_events", ["event_name", "created_at"])
    op.create_index("idx_events_session", "user_events", ["session_id"])

    # ── materialized view: wardrobe stats per user ─────────────────────────────
    op.execute("""
        CREATE MATERIALIZED VIEW mv_user_wardrobe_stats AS
        SELECT
            user_id,
            COUNT(*)                                        AS total_items,
            COUNT(*) FILTER (WHERE category = 'Top')        AS tops,
            COUNT(*) FILTER (WHERE category = 'Bottom')     AS bottoms,
            COUNT(*) FILTER (WHERE category = 'Shoes')      AS shoes,
            COUNT(*) FILTER (WHERE category = 'Outerwear')  AS outerwear,
            SUM(price)                                      AS total_wardrobe_value,
            MAX(updated_at)                                 AS last_updated
        FROM wardrobe_items
        WHERE deleted_at IS NULL AND is_active = TRUE
        GROUP BY user_id
    """)
    op.execute("CREATE UNIQUE INDEX ON mv_user_wardrobe_stats(user_id)")

    # ── Row Level Security ─────────────────────────────────────────────────────
    for table in ["users", "wardrobe_items", "outfits", "outfit_items", "ai_analyses", "user_events"]:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")

    op.execute("CREATE POLICY user_own_rows ON users FOR ALL USING (id = auth.uid())")
    op.execute("CREATE POLICY user_own_wardrobe ON wardrobe_items FOR ALL USING (user_id = auth.uid())")
    op.execute("CREATE POLICY user_own_outfits ON outfits FOR ALL USING (user_id = auth.uid())")

    # ── Read-only analyst role ─────────────────────────────────────────────────
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'stylewrap_analyst') THEN
                CREATE ROLE stylewrap_analyst;
            END IF;
        END $$
    """)
    op.execute("GRANT SELECT ON mv_user_wardrobe_stats TO stylewrap_analyst")
    op.execute("GRANT SELECT ON user_events TO stylewrap_analyst")


def downgrade():
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_user_wardrobe_stats;")
    for table in ["user_events", "ai_analyses", "outfit_items", "outfits", "wardrobe_items", "brands", "users"]:
        op.drop_table(table)
