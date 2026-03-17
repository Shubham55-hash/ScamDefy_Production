from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import scan, voice, health, threats
from dotenv import load_dotenv
import logging
import threading

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="ScamDefy Backend", version="1.0.0")

CORS_ORIGINS = [
    "https://*.vercel.app",             # Vercel preview & production deployments
    "chrome-extension://*",             # ScamDefy Chrome extension
    "http://localhost:5173",            # Vite dev server
    "http://localhost:4173",            # Vite preview server
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_methods=["*"],
    allow_headers=["*"],
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