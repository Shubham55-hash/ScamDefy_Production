document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  loadCurrentPageStatus();
  loadSystemHealth();
  setupManualScan();
  setupPayloadAnalyzer();
  setupVoiceUpload();
  setupSettings();

  const refreshBtn = document.getElementById('btn-refresh-scan');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadCurrentPageStatus(true));
  }
});

function setupNavigation() {
  const navMap = { home: 'view-scanner', modules: 'view-modules', settings: 'view-settings' };
  Object.keys(navMap).forEach(view => {
    const btn = document.getElementById(`btn-${view}`);
    if (!btn) return;
    btn.addEventListener('click', () => {
      Object.keys(navMap).forEach(v => {
        document.getElementById(`btn-${v}`)?.classList.remove('active');
        const s = document.getElementById(navMap[v]);
        if (s) s.style.display = 'none';
      });
      btn.classList.add('active');
      const section = document.getElementById(navMap[view]);
      if (section) section.style.display = 'block';
      if (view === 'modules') loadSystemHealth();
    });
  });
}

function updateColors(score, verdict) {
  const gauge = document.getElementById('scoreGauge');
  const badge = document.getElementById('verdictBadge');
  if (!gauge || !badge) return;

  let color = '#94a3b8';
  let bg    = 'rgba(148, 163, 184, 0.15)';

  if      (verdict === 'SAFE')    { color = 'var(--green, #22c55e)';  bg = 'rgba(34, 197, 94, 0.2)';   }
  else if (verdict === 'CAUTION') { color = 'var(--amber, #f59e0b)';  bg = 'rgba(245, 158, 11, 0.2)';  }
  else if (verdict === 'DANGER')  { color = 'var(--orange, #f97316)'; bg = 'rgba(249, 115, 22, 0.2)';  }
  else if (verdict === 'BLOCKED') { color = 'var(--red, #ef4444)';    bg = 'rgba(239, 68, 68, 0.2)';   }
  else if (verdict === 'ERROR')   { color = '#94a3b8';                bg = 'rgba(148, 163, 184, 0.15)';}

  gauge.style.borderColor = color;
  badge.style.color       = color;
  badge.style.background  = bg;
  badge.textContent       = verdict || 'UNKNOWN';

  const sv = document.getElementById('scoreValue');
  if (sv && score !== null && score !== '--') sv.textContent = score;
}

function renderRiskPills(data) {
  const container = document.getElementById('riskPills');
  if (!container) return;
  container.innerHTML = '';
  const pills = [];

  if (data.domain_age && data.domain_age.age_days !== null && data.domain_age.age_days !== undefined) {
    const days = data.domain_age.age_days;
    if (days < 90) {
      const cls = days < 30 ? 'pill-danger' : 'pill-warn';
      pills.push(`<span class="risk-pill ${cls}">🕐 Domain: ${days}d old</span>`);
    }
  }

  if (data.flags && (data.flags.includes('BRAND_IMPERSONATION') ||
      data.flags.includes('TYPOSQUATTING') || data.flags.includes('CHARACTER_SUBSTITUTION'))) {
    pills.push(`<span class="risk-pill pill-danger">⚠️ Impersonation</span>`);
  }

  if (data.flags && data.flags.includes('GSB_THREAT')) {
    pills.push(`<span class="risk-pill pill-blocked">🚫 GSB Threat</span>`);
  }
  if (data.flags && data.flags.includes('URLHAUS_MALWARE')) {
    pills.push(`<span class="risk-pill pill-blocked">🚫 URLHaus</span>`);
  }

  container.innerHTML = pills.join('');
}

async function loadCurrentPageStatus(force = false) {
  const urlEl = document.getElementById('currentPageUrl');
  const explanationEl = document.getElementById('aiExplanation');
  const riskPills = document.getElementById('riskPills');

  let tabFound = false;
  const timeoutId = setTimeout(() => {
    if (!tabFound) urlEl.textContent = "Tab detection timed out. Please refresh.";
  }, 2000);

  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tabFound = true;
    clearTimeout(timeoutId);

    if (!tabs || tabs.length === 0) { urlEl.textContent = "No active tab detected."; return; }

    const currentUrl = tabs[0].url;
    urlEl.textContent = currentUrl;

    if (!currentUrl || currentUrl.startsWith('chrome://') ||
        currentUrl.startsWith('about:') || currentUrl.startsWith('chrome-extension://')) {
      updateColors(0, 'SAFE');
      if (explanationEl) explanationEl.textContent = "Internal page — scanning skipped.";
      return;
    }

    if (!force) {
      const res = await new Promise(resolve =>
        chrome.storage.local.get([`scan_${currentUrl}`], resolve)
      );
      const cached = res[`scan_${currentUrl}`];
      if (cached) {
        updateColors(cached.score, cached.verdict);
        if (explanationEl) explanationEl.innerHTML = buildExplanationHTML(cached);
        renderRiskPills(cached);
        return;
      }
    } else {
      // KEY FIX: clear chrome.storage cache on force rescan
      await new Promise(resolve => chrome.storage.local.remove([`scan_${currentUrl}`], resolve));
    }

    document.getElementById('verdictBadge').textContent = "SCANNING...";
    document.getElementById('scoreValue').textContent   = "--";
    if (explanationEl) explanationEl.textContent = "Analyzing...";
    if (riskPills) riskPills.innerHTML = '';

    chrome.runtime.sendMessage(
      { type: 'SCAN_URL', payload: { url: currentUrl, bypass_cache: force } },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error("Message error:", chrome.runtime.lastError);
          urlEl.textContent = "Communication Error — is backend running?";
          updateColors('--', 'ERROR');
          return;
        }
        if (response && response.success && response.data) {
          const d = response.data;
          updateColors(d.score, d.verdict);
          if (explanationEl) explanationEl.innerHTML = buildExplanationHTML(d);
          renderRiskPills(d);
          chrome.storage.local.set({ [`scan_${currentUrl}`]: d });
        } else {
          if (explanationEl) explanationEl.textContent = "Result unavailable. Ensure Backend is running.";
          updateColors('--', 'ERROR');
        }
      }
    );
  } catch (e) {
    clearTimeout(timeoutId);
    console.error("Popup Error:", e);
    urlEl.textContent = "Error loading status.";
  }
}

function buildExplanationHTML(d) {
  const lines = [];
  if (d.explanation) lines.push(d.explanation);
  if (d.reasons && Array.isArray(d.reasons) && d.reasons.length > 0 && !d.explanation) {
    lines.push(d.reasons.slice(0, 3).join('<br>'));
  }
  if (d.domain_age && d.domain_age.age_days !== null && d.domain_age.age_days < 90) {
    const label = d.domain_age.registered_on
      ? `Registered: ${d.domain_age.registered_on}`
      : `Domain age: ${d.domain_age.age_days} days`;
    lines.push(`<span class="info-note">🕐 ${label}</span>`);
  }
  return lines.join('<br>') || `Flagged for: ${(d.flags || []).join(', ') || 'None'}`;
}

async function loadSystemHealth() {
  const sysBadge  = document.getElementById('systemBadge');
  const container = document.getElementById('moduleGrid');
  if (!container) return;

  container.innerHTML = '<div class="module-loading">Checking modules...</div>';

  chrome.runtime.sendMessage({ type: 'GET_STATUS', payload: {} }, (response) => {
    if (chrome.runtime.lastError || !response || !response.success) {
      if (sysBadge) { sysBadge.textContent = 'Backend Offline'; sysBadge.className = 'badge offline'; }
      container.innerHTML = '<div class="module-offline">⚠ Unable to connect to service worker</div>';
      return;
    }

    const statuses = response.data || [];
    if (statuses.length === 0) {
      container.innerHTML = '<div class="module-offline">No module data available</div>';
      return;
    }

    const MODULE_META = {
      "Backend Connection":   { icon: "🔗", category: "Infrastructure" },
      "Google Safe Browsing": { icon: "🛡", category: "Threat Intelligence" },
      "URLHaus":              { icon: "🔍", category: "Threat Intelligence" },
      "Voice Detector":       { icon: "🎙", category: "AI Detection" },
      "URL Expander":         { icon: "🔗", category: "Analysis" },
      "Domain Analyzer":      { icon: "🌐", category: "Analysis" },
      "Risk Scorer":          { icon: "📊", category: "Analysis" },
      "AI Explainer":         { icon: "🤖", category: "AI Detection" },
    };

    const grouped = {};
    statuses.forEach(m => {
      const meta = MODULE_META[m.module] || { icon: "◈", category: "Other" };
      if (!grouped[meta.category]) grouped[meta.category] = [];
      grouped[meta.category].push({ ...m, ...meta });
    });

    let html = '';
    for (const [category, modules] of Object.entries(grouped)) {
      html += `<div class="module-category">
        <div class="module-category-label">${category}</div>
        <div class="module-cards">`;
      modules.forEach(m => {
        const isOk   = m.status === 'ok';
        const isFail = m.status === 'fail';
        const cls    = isOk ? 'ok' : isFail ? 'fail' : 'warn';
        const statusText = isOk ? 'Online' : isFail ? 'Offline' : 'Degraded';
        const statusIcon = isOk ? '✓' : isFail ? '✗' : '!';
        html += `
          <div class="module-card ${cls}">
            <div class="module-card-icon">${m.icon}</div>
            <div class="module-card-name">${m.module}</div>
            <div class="module-card-status ${cls}"><span>${statusIcon}</span> ${statusText}</div>
            ${m.reason && !isOk ? `<div class="module-card-reason">${m.reason}</div>` : ''}
          </div>`;
      });
      html += `</div></div>`;
    }

    container.innerHTML = html;

    const anyFail = statuses.some(r => r.status === 'fail');
    if (sysBadge) {
      sysBadge.textContent = anyFail ? 'Issues Detected' : 'Protected';
      sysBadge.className   = anyFail ? 'badge issues' : 'badge protected';
    }
  });
}

function setupManualScan() {
  document.getElementById('btn-scan')?.addEventListener('click', () => {
    let url = document.getElementById('manualUrl').value.trim();
    const resDiv = document.getElementById('manualScanResult');
    if (!url) return;

    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    resDiv.innerHTML = '<span class="scanning-text">◈ Scanning...</span>';

    chrome.storage.local.remove([`scan_${url}`], () => {
      chrome.runtime.sendMessage(
        { type: 'SCAN_URL', payload: { url, bypass_cache: true } },
        (res) => {
          if (res && res.success && res.data) {
            const d = res.data;
            const verdictColor = {
              SAFE: '#22c55e', CAUTION: '#f59e0b', DANGER: '#f97316', BLOCKED: '#ef4444'
            }[d.verdict] || '#94a3b8';

            let html = `<div class="manual-verdict" style="color:${verdictColor}">${d.verdict} — ${d.score}/100</div>`;
            if (d.explanation) html += `<div class="manual-explanation">${d.explanation}</div>`;
            if (d.domain_age && d.domain_age.age_days !== null) {
              html += `<div class="manual-meta">🕐 Domain age: ${d.domain_age.age_days} days`;
              if (d.domain_age.registered_on) html += ` (registered ${d.domain_age.registered_on})`;
              html += `</div>`;
            }
            if (d.flags && (d.flags.includes('BRAND_IMPERSONATION') || d.flags.includes('TYPOSQUATTING'))) {
              html += `<div class="manual-meta warn-text">⚠️ Brand impersonation detected</div>`;
            }
            if (d.flags && d.flags.length > 0) {
              html += `<div class="manual-flags">Signals: ${d.flags.join(' · ')}</div>`;
            }
            resDiv.innerHTML = html;
            chrome.storage.local.set({ [`scan_${url}`]: d });
          } else {
            resDiv.innerHTML = `<span style="color:var(--red)">Scan failed: ${res ? res.error : 'Unknown error'}</span>`;
          }
        }
      );
    });
  });

  document.getElementById('manualUrl')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-scan')?.click();
  });
}

function setupPayloadAnalyzer() {
  document.getElementById('btn-payload')?.addEventListener('click', () => {
    const text   = document.getElementById('payloadText')?.value?.trim();
    const resDiv = document.getElementById('payloadResult');
    if (!text || !resDiv) return;

    resDiv.innerHTML = '<span class="scanning-text">◈ Analyzing message...</span>';

    // Read backend URL from storage with fallback
    chrome.storage.local.get(['backendUrl'], (s) => {
      const backendUrl = (s.backendUrl || 'http://127.0.0.1:8000').replace(/\/$/, '');
      fetch(`${backendUrl}/api/analyze-message`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text }),
      })
        .then(r => r.json())
        .then(d => {
          const levelColor = {
            CRITICAL: '#ef4444', HIGH: '#f97316', SUSPICIOUS: '#f59e0b', SAFE: '#22c55e'
          }[d.risk_level] || '#94a3b8';

          let html = `
            <div class="payload-verdict" style="color:${levelColor}">${d.risk_level} — Score: ${d.risk_score}/100</div>
            <div class="payload-category">${d.scam_category}</div>
            <div class="payload-alert">${d.user_alert}</div>`;

          if (d.signals_triggered && d.signals_triggered.length > 0) {
            html += `<div class="payload-signals-label">Signals detected:</div><div class="payload-signals">`;
            d.signals_triggered.forEach(s => {
              const sc = s.severity === 'CRITICAL' ? 'pill-blocked' :
                         s.severity === 'HIGH'     ? 'pill-danger'  : 'pill-warn';
              html += `<span class="risk-pill ${sc}">${s.name}</span>`;
            });
            html += `</div>`;
          }

          if (d.recommendation) html += `<div class="payload-rec">💡 ${d.recommendation}</div>`;
          resDiv.innerHTML = html;
        })
        .catch(err => {
          resDiv.innerHTML = `<span style="color:var(--red)">Analysis failed: ${err.message}<br>Ensure backend is running.</span>`;
        });
    });
  });
}

function setupVoiceUpload() {
  document.getElementById('btn-voice')?.addEventListener('click', () => {
    const fileInput = document.getElementById('voiceUpload');
    const resDiv    = document.getElementById('voiceResult');
    if (!fileInput || fileInput.files.length === 0) {
      if (resDiv) resDiv.innerHTML = '<span style="color:var(--amber)">Please select an audio file first.</span>';
      return;
    }

    const file = fileInput.files[0];
    resDiv.innerHTML = '<span class="scanning-text">◎ Uploading and analyzing voice...</span>';

    const reader = new FileReader();
    reader.onload = function(e) {
      const base64Audio = e.target.result;
      chrome.runtime.sendMessage(
        { type: 'ANALYZE_VOICE', payload: { base64Audio, filename: file.name } },
        (res) => {
          if (res && res.success && res.data) {
            const d   = res.data;
            const clr = d.verdict === 'SYNTHETIC' ? 'var(--red)' :
                        d.verdict === 'UNCERTAIN'  ? 'var(--amber)' : 'var(--green, #22c55e)';
            const icon = d.verdict === 'SYNTHETIC' ? '🤖' :
                         d.verdict === 'UNCERTAIN'  ? '❓' : '✅';

            let html = `<div class="voice-verdict" style="color:${clr}">${icon} ${d.verdict} — ${(d.confidence * 100).toFixed(1)}% confidence</div>`;

            if (d.verdict === 'SYNTHETIC') {
              html += `<div class="voice-reason">This voice shows signs of AI synthesis. The audio does not match patterns of natural human speech.</div>`;
              if (d.model_results) {
                const mr = d.model_results;
                if (mr.gemini_verdict && mr.gemini_verdict !== 'SKIPPED') {
                  html += `<div class="voice-meta">🤖 Gemini: ${mr.gemini_verdict} (${(mr.gemini_confidence*100).toFixed(0)}%)</div>`;
                }
                if (mr.pretrained_prob !== undefined) {
                  html += `<div class="voice-meta">🧠 Neural Model: ${(mr.pretrained_prob*100).toFixed(0)}% synthetic probability</div>`;
                }
                if (mr.heuristic_score !== undefined) {
                  html += `<div class="voice-meta">📊 Acoustic Heuristics: ${(mr.heuristic_score*100).toFixed(0)}% synthetic signature</div>`;
                }
              }
            } else if (d.verdict === 'REAL') {
              html += `<div class="voice-reason">Voice characteristics match natural human speech patterns.</div>`;
              if (d.detection_method === 'whatsapp_fingerprint') {
                html += `<div class="voice-meta">📱 Detected as WhatsApp voice message — real audio fingerprint confirmed</div>`;
              }
            } else {
              html += `<div class="voice-reason">Inconclusive — audio may be too short or have unusual encoding.</div>`;
            }

            if (d.audio_info) {
              const bw = d.audio_info.narrowband ? 'Narrowband (telephony)' : 'Wideband';
              html += `<div class="voice-meta">🔊 Bandwidth: ${bw}</div>`;
            }
            if (d.warning) html += `<div class="voice-warning">⚠️ ${d.warning}</div>`;

            resDiv.innerHTML = html;
          } else {
            resDiv.innerHTML = `<span style="color:var(--red)">Analysis failed: ${res ? res.error : 'Unknown'}</span>`;
          }
        }
      );
    };
    reader.readAsDataURL(file);
  });
}

function setupSettings() {
  chrome.storage.local.get(['backendUrl', 'autoScan', 'showBanner', 'blockDangerous'], res => {
    if (res.backendUrl) document.getElementById('backendUrl').value = res.backendUrl;
    document.getElementById('autoScanToggle').checked   = res.autoScan !== false;
    document.getElementById('bannerToggle').checked     = res.showBanner !== false;
    document.getElementById('blockToggle').checked      = res.blockDangerous !== false;
  });

  document.getElementById('btn-test-connection')?.addEventListener('click', () => {
    const url      = (document.getElementById('backendUrl')?.value?.trim()) || 'http://127.0.0.1:8000';
    const statusEl = document.getElementById('connectionStatus');
    statusEl.innerHTML = '<span class="scanning-text">Testing...</span>';
    fetch(`${url}/api/health`)
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(() => { statusEl.innerHTML = `<span style="color:#22c55e">✓ Connected — Backend online</span>`; })
      .catch(err => { statusEl.innerHTML = `<span style="color:var(--red)">✗ Connection failed: ${err}</span>`; });
  });

  document.getElementById('btn-save-settings')?.addEventListener('click', () => {
    const backendUrl     = document.getElementById('backendUrl')?.value?.trim() || 'http://127.0.0.1:8000';
    const autoScan       = document.getElementById('autoScanToggle')?.checked;
    const showBanner     = document.getElementById('bannerToggle')?.checked;
    const blockDangerous = document.getElementById('blockToggle')?.checked;

    chrome.storage.local.set({ backendUrl, autoScan, showBanner, blockDangerous }, () => {
      const btn = document.getElementById('btn-save-settings');
      const orig = btn.textContent;
      btn.textContent = '✓ Saved!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    });
  });
}
