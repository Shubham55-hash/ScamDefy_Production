from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import scan, voice, health
from dotenv import load_dotenv

load_dotenv()

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
