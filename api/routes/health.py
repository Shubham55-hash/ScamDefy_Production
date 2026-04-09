from fastapi import APIRouter
import asyncio
import logging

from utils.url_expander import health_check as hc_url
from services.gsb_service import health_check as hc_gsb
from services.urlhaus_service import health_check as hc_uh
from routes.voice import health_check as hc_voice

router = APIRouter()
logger = logging.getLogger(__name__)


async def _safe_health_check(name: str, coro):
    """Run a health-check coroutine and return a safe fallback on failure."""
    try:
        return await coro
    except Exception as exc:
        logger.error(f"Health check '{name}' raised an exception: {exc}")
        return {"status": "fail", "reason": str(exc)}


@router.get("/health")
async def health_check_all():
    url_res, gsb_res, uh_res, voice_res = await asyncio.gather(
        _safe_health_check("url_expander", hc_url()),
        _safe_health_check("gsb_service", hc_gsb()),
        _safe_health_check("urlhaus_service", hc_uh()),
        _safe_health_check("voice_cnn", hc_voice()),
    )

    modules = {
        "url_expander":    url_res.get("status") == "ok",
        "gsb_service":     gsb_res.get("status") == "ok",
        "urlhaus_service": uh_res.get("status") == "ok",
        "voice_cnn":       voice_res.get("status") == "ok",
    }

    all_ok = all(modules.values())
    return {
        "status": "ok" if all_ok else "degraded",
        "modules": modules,
        "version": "1.0.0"
    }
