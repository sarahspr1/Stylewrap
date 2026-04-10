from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator

from app.core.config import settings
from app.api.v1.router import api_router

app = FastAPI(
    title="Stylewrap API",
    version="1.0.0",
    docs_url="/docs" if settings.DEBUG else None,   # hide Swagger in production
    redoc_url="/redoc" if settings.DEBUG else None,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Prometheus metrics at /metrics ────────────────────────────────────────────
Instrumentator().instrument(app).expose(app)

# ── Routes ────────────────────────────────────────────────────────────────────
app.include_router(api_router, prefix="/api/v1")


@app.get("/health", tags=["system"])
async def health():
    """Liveness probe — used by Railway / Render and CI smoke tests."""
    return {"status": "ok", "version": "1.0.0"}
