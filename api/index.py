from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

# Load environment variables before importing routes/services
load_dotenv()

from routes import scan, voice, health, threats, guardian
import logging
import threading
import time
from starlette.middleware.base import BaseHTTPMiddleware
from utils import antigravity_logger
from contextlib import asynccontextmanager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run self-check on all services
    from services import gsb_service, urlhaus_service
    await gsb_service.health_check()
    await urlhaus_service.health_check()
    
    # Vercel Serverless note: The voice_service has lazy-loading built-in during inference.
    yield

app = FastAPI(title="ScamDefy Backend", version="1.0.0", lifespan=lifespan)

CORS_ORIGINS = [
    "https://*.vercel.app",             # Vercel preview & production deployments
    "chrome-extension://*",             # ScamDefy Chrome extension
    "http://localhost:5173",            # Vite dev server
    "http://127.0.0.1:5173",            # Local dev
    "http://localhost:4173",            # Vite preview server
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_methods=["*"],
    allow_headers=["*"],
)

class AntigravityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        start_time = time.time()
        response = await call_next(request)
        process_time = round((time.time() - start_time) * 1000)
        
        # Log metrics for scan and analyze endpoints
        path = request.url.path
        if any(x in path for x in ["/api/scan", "/api/analyze-message", "/api/voice/analyze"]):
            feature = "url" if "/scan" in path else "msg" if "message" in path else "voice"
            antigravity_logger.log_event("api_call", {
                "path": path,
                "latency_ms": process_time,
                "success": response.status_code < 400,
                "feature": feature
            })
            
        response.headers["X-Process-Time"] = str(process_time)
        return response

app.add_middleware(AntigravityMiddleware)

@app.get("/")
def read_root():
    return {
        "status": "active",
        "service": "ScamDefy API",
        "version": "1.0.0",
        "message": "Neural monitoring is operational."
    }

app.include_router(scan.router, prefix="/api")
app.include_router(voice.router, prefix="/api")
app.include_router(health.router, prefix="/api")
app.include_router(threats.router, prefix="/api")
app.include_router(guardian.router, prefix="/api")

@app.get("/api/antigravity/stats")
def get_antigravity_stats():
    return antigravity_logger.get_metrics_summary()

@app.get("/api/antigravity/report")
def get_antigravity_report():
    import json
    from pathlib import Path
    report_path = Path(__file__).parent.parent / "antigravity" / "report.json"
    if report_path.exists():
        return json.loads(report_path.read_text())
    return {"error": "Report not found. Run runner.py first."}


if __name__ == "__main__":
    import uvicorn
    # Local dev runner: python index.py
    logger.info("🚀 Starting ScamDefy Local API on port 8000 with reload...")
    uvicorn.run("index:app", host="127.0.0.1", port=8000, reload=True)
