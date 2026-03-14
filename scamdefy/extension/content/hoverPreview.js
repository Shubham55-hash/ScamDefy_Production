let tooltipEl = null;
let hoverTimer = null;

function createTooltip() {
  if (tooltipEl) return tooltipEl;
  
  tooltipEl = document.createElement('div');
  tooltipEl.id = 'scamdefy-tooltip';
  
  // Basic inline styles
  Object.assign(tooltipEl.style, {
    position: 'absolute',
    zIndex: '999999',
    background: '#1e293b',
    color: '#f8fafc',
    padding: '8px 12px',
    borderRadius: '6px',
    fontSize: '13px',
    fontFamily: 'system-ui, sans-serif',
    boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 0.2s',
    whiteSpace: 'nowrap',
    border: '1px solid #334155'
  });
  
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

document.addEventListener('mouseover', (e) => {
  const aTag = e.target.closest('a');
  if (!aTag) return;
  
  const score = aTag.dataset.scamdefyScore;
  const verdict = aTag.dataset.scamdefyVerdict;
  const flags = aTag.dataset.scamdefyFlags || 'Clean';
  
  if (!verdict) return; // not scanned yet
  
  // Show tooltip with pre-computed scan result
  // Never block hover for more than 200ms -> we'll show it after 200ms
  
  hoverTimer = setTimeout(() => {
    const tip = createTooltip();
    
    let color = '#22c55e'; // safe
    if (verdict === 'CAUTION') color = '#f59e0b';
    if (verdict === 'DANGER') color = '#f97316';
    if (verdict === 'BLOCKED') color = '#ef4444';
    
    const topFlag = flags !== 'Clean' ? flags.split(',')[0] : 'No issues found';
    
    tip.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
         <strong style="color: ${color};">${verdict}</strong>
         <span style="background: #0f172a; padding: 2px 6px; border-radius: 4px; font-size: 11px;">Score: ${score}</span>
      </div>
      <div style="font-size: 11px; color: #cbd5e1;">Reason: ${topFlag}</div>
    `;
    
    const rect = aTag.getBoundingClientRect();
    tip.style.left = `${rect.left + window.scrollX}px`;
    tip.style.top = `${rect.bottom + window.scrollY + 5}px`;
    tip.style.opacity = '1';
    
  }, 200);
});

document.addEventListener('mouseout', (e) => {
  const aTag = e.target.closest('a');
  if (!aTag) return;
  
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  
  if (tooltipEl) {
    tooltipEl.style.opacity = '0';
  }
});
