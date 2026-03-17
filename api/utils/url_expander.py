import httpx
import logging

async def expand_url_backend(short_url: str) -> dict:
    """
    Expand a URL by following redirects up to 10 hops.
    """
    hop_count = 0
    current_url = short_url
    redirect_chain = [short_url]
    
    try:
        async with httpx.AsyncClient(follow_redirects=True, max_redirects=10, timeout=5.0) as client:
            response = await client.head(short_url)
            # httpx.AsyncClient with follow_redirects=True handles the chain
            # To get the history:
            final_url = str(response.url)
            for r in response.history:
                redirect_chain.append(str(r.headers.get("Location", "")))
            
            hop_count = len(response.history)
            
            return {
                "original": short_url,
                "final_url": final_url,
                "redirect_chain": redirect_chain,
                "hop_count": hop_count,
                "error": None
            }
    except httpx.TooManyRedirects:
        return {
            "original": short_url,
            "final_url": current_url, # Might not be the final, but the last one attempted
            "redirect_chain": redirect_chain,
            "hop_count": 10,
            "error": "Too many redirects"
        }
    except httpx.RequestError as exc:
        logging.error(f"Request Error while expanding {short_url}: {exc}")
        return {
            "original": short_url,
            "final_url": current_url,
            "redirect_chain": redirect_chain,
            "hop_count": hop_count,
            "error": str(exc)
        }
    except Exception as exc:
        logging.error(f"Unexpected error expanding {short_url}: {exc}")
        return {
            "original": short_url,
            "final_url": current_url,
            "redirect_chain": redirect_chain,
            "hop_count": hop_count,
            "error": str(exc)
        }

async def health_check():
    test_url = "https://bit.ly/3example" # A dummy bitly link
    result = await expand_url_backend(test_url)
    if result.get("error") is None:
        # We don't necessarily know if it expands to something valid if it's a dummy link,
        # but the request itself shouldn't crash.
        return {"status": "ok", "reason": "No crash during expansion."}
    else:
        # If there's an error, we mark it as failed unless it's just a network timeout in a constrained env.
        return {"status": "fail", "reason": result.get("error")}
