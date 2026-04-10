from fastapi import APIRouter

from app.api.v1.endpoints import brands, outfits, users, wardrobe, analytics

api_router = APIRouter()

api_router.include_router(users.router,     prefix="/users",     tags=["users"])
api_router.include_router(wardrobe.router,  prefix="/wardrobe",  tags=["wardrobe"])
api_router.include_router(outfits.router,   prefix="/outfits",   tags=["outfits"])
api_router.include_router(brands.router,    prefix="/brands",    tags=["brands"])
api_router.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
