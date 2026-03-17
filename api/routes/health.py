from fastapi import APIRouter
import asyncio

from utils.url_expander import health_check as hc_url
from services.gsb_service import health_check as hc_gsb
from services.urlhaus_service import health_check as hc_uh
from routes.voice import health_check as hc_voice

router = APIRouter()

@router.get("/health")
async def health_check_all():
    results = await asyncio.gather(
        hc_url(),
        hc_gsb(),
        hc_uh(),
        hc_voice()
    )
    
    url_res, gsb_res, uh_res, voice_res = results
    
    modules = {
        "url_expander":    url_res.get("status") == "ok",
        "gsb_service":     gsb_res.get("status") == "ok",
        "urlhaus_service": uh_res.get("status") == "ok",
        "voice_cnn":       voice_res.get("status") == "ok",
    }
    
    # The overall status is "ok" if there are no exceptions.
    # Individual modules might be "fail" (e.g., degraded due to missing API keys)
    return {
        "status": "ok",
        "modules": modules,
        "version": "1.0.0"
    }
