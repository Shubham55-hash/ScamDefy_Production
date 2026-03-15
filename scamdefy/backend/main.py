from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import scan, voice, health
from dotenv import load_dotenv
import logging
import threading

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="ScamDefy Backend", version="1.0.0")

app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],   # tighten to extension origin in prod
  allow_methods=["*"],
  allow_headers=["*"],
)

app.include_router(scan.router, prefix="/api")
app.include_router(voice.router, prefix="/api")
app.include_router(health.router, prefix="/api")

@app.on_event("startup")
async def startup():
    # Run self-check on all services
    from services import gsb_service, urlhaus_service
    await gsb_service.health_check()
    await urlhaus_service.health_check()

    # Load the HuggingFace pretrained voice model in a background thread
    # so it doesn't block the server from starting up
    from services.voice_service import load_model
    logger.info("[ScamDefy] Starting background download of pretrained voice model...")
    thread = threading.Thread(target=load_model, daemon=True)
    thread.start()