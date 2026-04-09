import httpx
import logging
import ipaddress
import socket
from urllib.parse import urlparse


BLOCKED_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),  # AWS metadata, link-local
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def _is_private_url(url: str) -> bool:
    """Check if a URL resolves to a private/reserved IP address (SSRF protection)."""
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname
        if not hostname:
            return True
        # Resolve hostname to IP
        addr_info = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
        for family, _, _, _, sockaddr in addr_info:
            ip = ipaddress.ip_address(sockaddr[0])
            for net in BLOCKED_NETWORKS:
                if ip in net:
                    return True
    except (socket.gaierror, ValueError):
        pass
    return False


async def expand_url_backend(short_url: str) -> dict:
    """
    Expand a URL by following redirects up to 10 hops.
    """
    hop_count = 0
    current_url = short_url
    redirect_chain = [short_url]
    
    MAX_REDIRECTS = 10

    # Validate every hop (initial URL + each redirect target) to prevent
    # SSRF via open-redirect chains that land on private IPs.
    if _is_private_url(short_url):
        return {
            "original": short_url,
            "final_url": short_url,
            "redirect_chain": [short_url],
            "hop_count": 0,
            "error": "Blocked: URL resolves to a private/reserved IP address"
        }

    try:
        # Disable automatic redirect following so we can validate each hop.
        async with httpx.AsyncClient(follow_redirects=False, timeout=5.0) as client:
            while hop_count < MAX_REDIRECTS:
                response = await client.head(current_url)

                if response.is_redirect:
                    location = response.headers.get("Location", "")
                    if not location:
                        break
                    # Resolve relative redirects against current URL
                    location = str(response.url.join(location))
                    redirect_chain.append(location)
                    hop_count += 1

                    if _is_private_url(location):
                        return {
                            "original": short_url,
                            "final_url": current_url,
                            "redirect_chain": redirect_chain,
                            "hop_count": hop_count,
                            "error": f"Blocked: redirect hop {hop_count} resolves to a private/reserved IP address"
                        }

                    current_url = location
                else:
                    break

            return {
                "original": short_url,
                "final_url": current_url,
                "redirect_chain": redirect_chain,
                "hop_count": hop_count,
                "error": None
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
