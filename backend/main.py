import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text

from api import media, monitoring
from api.config import settings
from api.db import engine
from api.routers.auth import router as auth_router
from api.routers.orders import router as orders_router
from api.routers.products import public_router as storefront_router
from api.routers.products import router as products_router
from api.services import meta_capi, pathao_sync
from api.routers.stores import admin_router as stores_admin_router
from api.routers.stores import check_router as store_check_router
from api.routers.stores import health_router as store_health_router
from api.routers.store_content import router as store_content_router
from api.routers.store_settings import router as store_settings_router
from api.routers.stores import me_router
from api.routers.stores import router as stores_router
from api.routers.system import router as system_router
from api.routers.track import router as track_router
from api.routers.users import router as users_router

# Uvicorn configures only its own loggers; the root logger would otherwise sit
# at WARNING and swallow the app's INFO lines — including "CAPI Purchase …
# sent", the one line that says a Meta event actually went out.
logging.basicConfig(
    level=logging.INFO, format="%(levelname)s:     %(name)s: %(message)s"
)
# httpx logs every request URL at INFO, and the Conversions API token travels
# in the query string, so that logger stays at WARNING.
logging.getLogger("httpx").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    monitoring.start()
    pathao_sync.start()
    yield
    await pathao_sync.stop()
    # Let in-flight Conversions API deliveries (retries included) finish
    # before the worker goes away, so a redeploy never loses a Purchase.
    await meta_capi.drain()
    await monitoring.stop()
    await engine.dispose()


app = FastAPI(title="nbPlatform API", version="2.0.0-dev", lifespan=lifespan)

app.add_middleware(monitoring.TrafficMiddleware)
# No CORS middleware on purpose: every browser call reaches this API through
# the web app's same-origin /api rewrite, whatever the store's domain, and the
# API port is bound to 127.0.0.1. An allow-list would only have to be kept in
# step with every store domain for requests that never happen.

app.include_router(auth_router, prefix="/api")
app.include_router(orders_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(system_router, prefix="/api")
app.include_router(products_router, prefix="/api")
app.include_router(storefront_router, prefix="/api")
app.include_router(track_router, prefix="/api")
app.include_router(stores_router, prefix="/api")
app.include_router(stores_admin_router, prefix="/api")
app.include_router(store_health_router, prefix="/api")
app.include_router(store_check_router, prefix="/api")
app.include_router(me_router, prefix="/api")
app.include_router(store_settings_router, prefix="/api")
app.include_router(store_content_router, prefix="/api")

# Uploaded product images. settings.media_root is a mounted volume, so the
# directory may not exist on a first boot; StaticFiles refuses to mount a
# missing directory, hence the mkdir.
os.makedirs(settings.media_root, exist_ok=True)
app.mount("/media", media.MediaFiles(directory=settings.media_root), name="media")


@app.get("/")
async def read_root():
    return {"name": "nbPlatform API", "status": "ready"}


@app.get("/health", tags=["Health"])
async def health_check():
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "9090")),
        reload=os.getenv("RELOAD", "true").lower() == "true",
    )
