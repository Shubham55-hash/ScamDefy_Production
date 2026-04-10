// ScamDefy Warning Banner — content/warningBanner.js
// Injected into arbitrary webpages by service_worker.js via chrome.scripting.executeScript.
// Must be fully self-contained — no imports, no Chrome API calls, no dependencies.
//
// The caller injects this script file first (registers window.__scamdefyShowBanner),
// then immediately calls window.__scamdefyShowBanner(args) in a second executeScript
// to display the banner. Two-step pattern is required because file[] and func
// execute as separate script tasks in the page world.

window.__scamdefyShowBanner = function({ verdict, score, url, color }) {
    // Guard: prevent duplicate banners if the script is injected more than once
    if (document.getElementById('__scamdefy_banner')) return;

    const banner = document.createElement('div');
    banner.id = '__scamdefy_banner';
    banner.style.cssText = [
        'position:fixed',
        'top:0',
        'left:0',
        'right:0',
        'z-index:2147483647',       // highest possible z-index — above all page content
        'padding:10px 16px',
        `background:${color}`,
        'color:#fff',
        'font:14px/1.4 system-ui,sans-serif',
        'display:flex',
        'align-items:center',
        'gap:12px',
        'box-shadow:0 2px 8px rgba(0,0,0,0.25)',
    ].join(';');

    const scoreText = score !== null ? ` — Risk Score ${score}/100` : '';
    const label = verdict === 'SCANNING'
        ? 'Scanning this page...'
        : `${verdict}${scoreText}`;

    // "View Details" link only shown when the scan has completed (not SCANNING state)
    const detailsLinkContainer = document.createElement('div');
    if (verdict !== 'SCANNING') {
        const link = document.createElement('a');
        link.href = '#';
        link.id = '__scamdefy_view_details';
        link.textContent = 'View Details';
        link.style.cssText = 'color:#fff;text-decoration:underline;white-space:nowrap;margin-left:12px;cursor:pointer;';
        
        link.addEventListener('click', (e) => {
            e.preventDefault();
            // Check if extension context is valid
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
                chrome.runtime.sendMessage({ type: 'OPEN_WARNING', payload: { url } });
            } else {
                console.warn('[ScamDefy] Extension connection lost. Please refresh the page.');
                banner.remove();
            }
        });
        detailsLinkContainer.appendChild(link);
    }

    banner.innerHTML = `
        <span style="flex:1">&#9888; ScamDefy: ${label}</span>
    `;
    
    if (detailsLinkContainer.firstChild) {
        banner.appendChild(detailsLinkContainer.firstChild);
    }

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = 'background:none;border:none;color:#fff;font-size:20px;cursor:pointer;padding:0;line-height:1;margin-left:12px;';
    closeBtn.onclick = () => banner.remove();
    banner.appendChild(closeBtn);

    // Prepend to documentElement (not body) so it works on pages with unusual body positioning
    document.documentElement.appendChild(banner);

    // Auto-remove when the user navigates away — avoids ghost banners on SPAs
    window.addEventListener('beforeunload', () => banner.remove(), { once: true });
};
