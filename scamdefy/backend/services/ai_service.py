import os
import logging
import google.generativeai as genai

async def generate_explanation(url: str, score: float, verdict: str, flags_list: list) -> str:
    if score <= 30:
        return "This URL appears safe."
        
    flags_str = ", ".join(flags_list) if flags_list else "suspicious patterns"
    fallback = f"This URL scored {score}/100 risk. It was flagged for: {flags_str}. We recommend not clicking it."
    
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        logging.warning("[ScamDefy] GEMINI_API_KEY not found in environment.")
        return fallback

    try:
        genai.configure(api_key=api_key)
        # Using flash for speed and cost effectiveness
        model = genai.GenerativeModel('gemini-1.5-flash')

        system_instruction = "You are a cybersecurity assistant. Explain in plain language (2-3 sentences, max 60 words) why this URL is dangerous. Be specific about the technique (phishing, typosquat, malware etc). Write for a non-technical user."
        user_prompt = f"URL: {url}\nRisk Score: {score}/100\nVerdict: {verdict}\nFlags: {flags_str}\nExplain why this is suspicious."

        response = await model.generate_content_async(
            f"{system_instruction}\n\n{user_prompt}",
            generation_config=genai.types.GenerationConfig(
                max_output_tokens=100,
                temperature=0.3
            )
        )
        
        if response and response.text:
            return response.text.strip()
        return fallback
            
    except Exception as exc:
        logging.warning(f"[ScamDefy] Gemini Explanation Failed, using fallback. Error: {exc}")
        return fallback
