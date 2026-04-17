import os
import logging
import json
from google import genai
from google.genai import types


async def generate_explanation(
    url: str,
    score: float,
    verdict: str,
    flags_list: list,
    extra_context: str = "",
    api_key: str = None,
) -> str:
    # ... (rest of the existing function)
    if score <= 30:
        return "This URL appears safe based on all checks."

    flags_str = ", ".join(flags_list) if flags_list else "suspicious patterns"
    fallback_parts = [f"Risk Score: {score}/100 — Verdict: {verdict}."]
    if extra_context:
        fallback_parts.append(extra_context)
    else:
        fallback_parts.append(f"Flagged for: {flags_str}.")
    
    fallback_parts.append("We recommend NOT visiting this URL.")
    fallback = " ".join(fallback_parts)

    if not api_key or str(api_key).lower() in ("null", "undefined", "none", ""):
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        
    if not api_key:
        logging.warning("[ScamDefy] GEMINI_API_KEY not found in environment.")
        return fallback

    try:
        client = genai.Client(api_key=api_key)
        # Use latest Gemini 2.5 Flash Lite for high speed and reliability
        model_id = "gemini-2.5-flash-lite"

        system_instruction = (
            "You are a cybersecurity expert. Explain in 2-3 sentences (max 70 words) "
            "why this URL is dangerous. Be specific about the attack technique "
            "(e.g. phishing, brand impersonation, typosquatting, malware delivery). "
            "IMPORTANT: ALWAYS mention the domain age if provided in the context (e.g. 'This domain was registered only 2 days ago'). "
            "Write for a non-technical user. "
            "Start directly with the explanation — no preamble."
        )

        context_block = f"\nAdditional signals:\n{extra_context}" if extra_context else ""
        user_prompt = (
            f"URL: {url}\n"
            f"Risk Score: {score}/100\n"
            f"Verdict: {verdict}\n"
            f"Flags: {flags_str}"
            f"{context_block}\n"
            "Explain why this is suspicious."
        )

        # New Client-based async syntax
        response = await client.aio.models.generate_content(
            model=model_id,
            contents=f"{system_instruction}\n\n{user_prompt}",
            config=types.GenerateContentConfig(
                max_output_tokens=120,
                temperature=0.3,
            ),
        )

        if response and response.text:
            return response.text.strip()
        return fallback

    except Exception as exc:
        logging.warning(f"[ScamDefy] Gemini Explanation Failed, using fallback. Error: {exc}")
        return fallback


async def analyze_message_ai(text: str, api_key: str = None) -> dict:
    """Analyze message text for social engineering and scam markers."""
    fallback = {
        "score": 0,
        "verdict": "SAFE",
        "scam_category": "Unverified",
        "explanation": "No specific scam signals detected.",
        "signals": []
    }

    if not api_key:
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    
    if not api_key:
        return fallback

    try:
        client = genai.Client(api_key=api_key)
        model_id = "gemini-2.5-flash-lite"

        prompt = (
            f"As a cybersecurity expert, analyze this message for scams or social engineering. "
            f"BE CONSERVATIVE. Do NOT flag single words, short fragments, or normal conversation "
            f"unless there is a CLEAR intent to defraud, steal credentials, or create false urgency.\n\n"
            f"RULES:\n"
            f"1. If content is just a word or short phrase (e.g. 'otp', 'login', 'bank') without context, verdict MUST be SAFE.\n"
            f"2. Only flag SUSPICIOUS if there is a 'Call to Action' (e.g. asking the user to share a code, click a link, or pay money).\n"
            f"3. Generate a 'recommendation' based on the scam type (e.g. if bank-related, suggest verifying via official bank app; if winnings-related, suggest ignoring).\n"
            f"4. Return ONLY a JSON object:\n"
            f'{{"score": number(0-100), "verdict": "SAFE"|"SUSPICIOUS"|"DANGER", '
            f'"category": "string", "explanation": "string", "recommendation": "string", '
            f'"triggered_signals": ["name1", "name2"]}}\n\n'
            f"MESSAGE CONTENT:\n{text}"
        )

        response = await client.aio.models.generate_content(
            model=model_id,
            contents=prompt,
            config=types.GenerateContentConfig(
                max_output_tokens=350,
                temperature=0.1,
                response_mime_type="application/json"
            ),
        )

        if response and response.text:
            data = json.loads(response.text)
            return {
                "score": data.get("score", 0),
                "verdict": data.get("verdict", "SAFE"),
                "scam_category": data.get("category", "General Phishing"),
                "explanation": data.get("explanation", ""),
                "recommendation": data.get("recommendation") or "Verify sender identity and avoid clicking unknown links.",
                "signals": data.get("triggered_signals", [])
            }
        return fallback

    except Exception as e:
        logging.error(f"[ScamDefy] Message AI Analysis Error: {e}")
        return fallback
