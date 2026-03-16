import os
import logging
import google.generativeai as genai


async def generate_explanation(
    url: str,
    score: float,
    verdict: str,
    flags_list: list,
    extra_context: str = "",
) -> str:
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

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        logging.warning("[ScamDefy] GEMINI_API_KEY not found in environment.")
        return fallback

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-1.5-flash")

        system_instruction = (
            "You are a cybersecurity expert. Explain in 2-3 sentences (max 70 words) "
            "why this URL is dangerous. Be specific about the attack technique "
            "(e.g. phishing, brand impersonation, typosquatting, malware delivery). "
            "Mention domain age if relevant. Write for a non-technical user. "
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

        response = await model.generate_content_async(
            f"{system_instruction}\n\n{user_prompt}",
            generation_config=genai.types.GenerationConfig(
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
