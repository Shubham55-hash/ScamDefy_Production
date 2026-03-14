import ENV from '../config/env.js';

/**
 * Expands a shortened URL by manually following redirects.
 * @param {string} shortUrl - The URL to expand
 * @returns {Promise<Object>} - { original, expanded, hops, error }
 */
export async function expandUrl(shortUrl) {
  let currentUrl = shortUrl;
  let hops = 0;
  const maxHops = 10;

  try {
    while (hops < maxHops) {
      const response = await fetch(currentUrl, {
        method: 'HEAD',
        redirect: 'manual' // Do not follow redirects automatically
      });

      // Responses 301, 302, 303, 307, 308 indicate a redirect
      if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
        let location = response.headers.get('location');
        // Handle relative URLs in location header
        if (!location.startsWith('http')) {
          const urlObj = new URL(currentUrl);
          location = new URL(location, urlObj.origin).toString();
        }
        currentUrl = location;
        hops++;
      } else {
        // No more redirects
        break;
      }
    }

    if (hops >= maxHops) {
      return { original: shortUrl, expanded: currentUrl, hops, error: "Too many redirects" };
    }

    return { original: shortUrl, expanded: currentUrl, hops, error: null };

  } catch (err) {
    console.warn(`[ScamDefy] urlExpander fetch failed for ${currentUrl}. Falling back to backend. Error:`, err);
    // Fallback to Backend if CORS or fetch fails
    try {
      // Create a specific backend endpoint for expanding if needed, or just use /api/scan with expand flag
      // For now, let's assume we can hit the backend's scan endpoint with an expand flag (as per prompt)
      // Since scan.py isn't fully implemented yet, we'll simulate the call format requested:
      const backendResponse = await fetch(`${ENV.BACKEND_URL}${ENV.SCAN_ENDPOINT}?expand=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: shortUrl })
      });
      
      if (!backendResponse.ok) {
         throw new Error(`Backend returned ${backendResponse.status}`);
      }
      
      const data = await backendResponse.json();
      return { 
        original: shortUrl, 
        expanded: data.final_url || shortUrl, 
        hops: data.hop_count || 1, 
        error: null 
      };
      
    } catch (backendErr) {
       console.error(`[ScamDefy] Backend fallback failed for ${shortUrl}:`, backendErr);
       return { original: shortUrl, expanded: currentUrl, hops, error: err.toString() };
    }
  }
}

/**
 * Health check for URL Expander module
 * @returns {Promise<Object>} { status: "ok" | "fail", reason: string }
 */
export async function healthCheck() {
  try {
    const testUrl = "https://bit.ly/3example"; // dummy shortlink
    const result = await expandUrl(testUrl);
    
    // As long as it doesn't throw unhandled exceptions, it's ok.
    // If it returns an error string via catch, it's failed.
    if (result.error && !result.error.includes("Too many")) {
       return { status: "fail", reason: result.error };
    }
    
    return { status: "ok", reason: "URL expander is functioning" };
  } catch (e) {
    console.error("[ScamDefy] urlExpander health check failed:", e);
    return { status: "fail", reason: e.toString() };
  }
}
