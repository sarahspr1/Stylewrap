from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    DATABASE_URL: str

    # Supabase
    SUPABASE_URL: str
    SUPABASE_SERVICE_ROLE_KEY: str
    SUPABASE_JWT_SECRET: str

    # Storage
    STORAGE_BUCKET: str = "outfit-photos"
    CDN_BASE_URL: str = ""

    # AI
    OPENAI_API_KEY: str = ""
    REMOVEBG_API_KEY: str = ""

    # Encryption
    APP_ENCRYPTION_KEY: str

    # Observability
    POSTHOG_API_KEY: str = ""
    POSTHOG_HOST: str = "https://app.posthog.com"

    # App
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    ALLOWED_ORIGINS: str = "http://localhost:3000"   # comma-separated list

    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]


settings = Settings()
