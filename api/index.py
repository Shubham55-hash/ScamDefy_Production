from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import scan, voice, health, threats
from dotenv import load_dotenv
import logging
import os

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Disable interactive API docs in production to avoid exposing endpoint details.
# Set SCAMDEFY_DEBUG=true in your environment to enable /docs and /redoc.
is_debug = os.getenv("SCAMDEFY_DEBUG", "false").lower() == "true"

app = FastAPI(
    title="ScamDefy Backend",
    version="1.0.0",
    docs_url="/docs" if is_debug else None,
    redoc_url="/redoc" if is_debug else None,
    openapi_url="/openapi.json" if is_debug else None,
)

# Explicit allowed origins — no wildcards in allow_origins.
# The regex covers Vercel preview/production deployments.
CORS_ORIGINS = [
    "http://localhost:5173",            # Vite dev server
    "http://localhost:4173",            # Vite preview server
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=r"^https://scam-?defy[\w-]*\.vercel\.app$",
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(scan.router, prefix="/api")
app.include_router(voice.router, prefix="/api")
app.include_router(health.router, prefix="/api")
app.include_router(threats.router, prefix="/api")

@app.on_event("startup")
async def startup():
    # Run self-check on all services
    from services import gsb_service, urlhaus_service
    await gsb_service.health_check()
    await urlhaus_service.health_check()

    # Vercel Serverless note: We don't use a background thread for model loading 
    # here because serverless functions freeze between requests. 
    # The voice_service has lazy-loading built-in during inference.
    pass
