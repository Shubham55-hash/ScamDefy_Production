document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  loadCurrentPageStatus(); // Don't await, let it run in parallel
  loadSystemHealth();      // Don't await
  setupManualScan();
  setupVoiceUpload();
  setupSettings();
  
  const refreshBtn = document.getElementById('btn-refresh-scan');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadCurrentPageStatus(true));
  }
});

function setupNavigation() {
  const views = ['home', 'modules', 'settings'];
  views.forEach(view => {
    const btn = document.getElementById(`btn-${view}`);
    if (btn) {
      btn.addEventListener('click', () => {
        // Toggle active buttons
        views.forEach(v => {
          const b = document.getElementById(`btn-${v}`);
          if (b) b.classList.remove('active');
        });
        btn.classList.add('active');
        
        // Toggle active sections
        // Note: home view maps to view-scanner section for consistency with other IDs if needed, 
        // but let's check HTML. HTML has view-scanner, view-modules, view-settings.
        const sectionId = view === 'home' ? 'view-scanner' : `view-${view}`;
        views.forEach(v => {
          const sid = v === 'home' ? 'view-scanner' : `view-${v}`;
          const s = document.getElementById(sid);
          if (s) s.style.display = 'none';
        });
        const activeSection = document.getElementById(sectionId);
        if (activeSection) activeSection.style.display = 'block';
      });
    }
  });
}

function updateColors(score, verdict) {
  const gauge = document.getElementById('scoreGauge');
  const badge = document.getElementById('verdictBadge');
  
  let color = '#334155';
  let bg = '#1e293b';
  
  if (verdict === 'SAFE') { color = 'var(--green)'; bg = 'rgba(34, 197, 94, 0.2)'; }
  else if (verdict === 'CAUTION') { color = 'var(--yellow)'; bg = 'rgba(245, 158, 11, 0.2)'; }
  else if (verdict === 'DANGER') { color = 'var(--orange)'; bg = 'rgba(249, 115, 22, 0.2)'; }
  else if (verdict === 'BLOCKED') { color = 'var(--red)'; bg = 'rgba(239, 68, 68, 0.2)'; }

  gauge.style.borderColor = color;
  badge.style.color = color;
  badge.style.background = bg;
  badge.textContent = verdict;
  
  if (score !== null) {
      document.getElementById('scoreValue').textContent = score;
  }
}

async function loadCurrentPageStatus(force = false) {
  const urlEl = document.getElementById('currentPageUrl');
  let tabFound = false;
  
  // Safety timeout for tabs.query
  const timeoutId = setTimeout(() => {
    if (!tabFound) {
      urlEl.textContent = "Tab detection timed out. Please refresh.";
      console.warn("[ScamDefy] chrome.tabs.query timed out.");
    }
  }, 2000);

  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tabFound = true;
    clearTimeout(timeoutId);

    if (!tabs || tabs.length === 0) {
      urlEl.textContent = "No active tab detected.";
      return;
    }

    const currentUrl = tabs[0].url;
    urlEl.textContent = currentUrl;
    
    if (!currentUrl || currentUrl.startsWith('chrome://') || currentUrl.startsWith('about:') || currentUrl.startsWith('chrome-extension://')) {
      updateColors(0, 'SAFE');
      document.getElementById('aiExplanation').textContent = "Internal page (Scanning skipped).";
      return;
    }

    // Cache check (skip if forced)
    if (!force) {
      const res = await new Promise(resolve => chrome.storage.local.get([`scan_${currentUrl}`], resolve));
      const data = res[`scan_${currentUrl}`];

      if (data) {
        updateColors(data.score, data.verdict);
        document.getElementById('aiExplanation').innerHTML = data.explanation || `Flagged for: ${data.flags.join(', ') || 'None'}`;
        return;
      }
    }

    // Show scanning state
    document.getElementById('verdictBadge').textContent = "SCANNING...";
    document.getElementById('scoreValue').textContent = "--";
    
    chrome.runtime.sendMessage({ type: 'SCAN_URL', payload: { url: currentUrl, bypass_cache: force } }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Message error:", chrome.runtime.lastError);
        urlEl.textContent = "Communication Error";
        return;
      }
      if (response && response.success && response.data) {
        const d = response.data;
        updateColors(d.score, d.verdict);
        const flagsStr = (d.flags && Array.isArray(d.flags)) ? d.flags.join(', ') : 'None';
        document.getElementById('aiExplanation').innerHTML = d.explanation || `Flagged for: ${flagsStr}`;
        
        // Save to cache
        chrome.storage.local.set({ [`scan_${currentUrl}`]: d });
      } else {
          document.getElementById('aiExplanation').textContent = "Result unavailable. Ensure Backend is running.";
          updateColors('--', 'ERROR');
      }
    });
  } catch (e) {
    clearTimeout(timeoutId);
    console.error("Popup Error:", e);
    urlEl.textContent = "Error loading status.";
  }
}

async function loadSystemHealth() {
  const sysBadge = document.getElementById('systemBadge');
  const container = document.getElementById('moduleContainer');
  
  chrome.runtime.sendMessage({ type: 'GET_STATUS', payload: {} }, (response) => {
    if (chrome.runtime.lastError || !response || !response.success) {
      sysBadge.textContent = 'Backend Offline';
      sysBadge.className = 'badge offline';
      container.innerHTML = '<h3>System Health</h3><p>Unable to connect to service worker.</p>';
      return;
    }

    const statuses = response.data;
    if (statuses.length === 0) return;

    let html = '<h3>System Health</h3>';
    let anyFail = false;

    statuses.forEach(m => {
      let icon = '???';
      let cls = 'warn';
      if (m.status === 'ok') { icon = '✓'; cls = 'ok'; }
      else if (m.status === 'fail') { 
          icon = '✗'; cls = 'fail'; anyFail = true; 
          console.error(`[ScamDefy UI] Module failed: ${m.module} -> ${m.reason}`);
      }

      html += `<div class="module-row">
        <span>${m.module}</span>
        <span class="status-icon ${cls}" title="${m.reason}">${icon}</span>
      </div>`;
    });

    container.innerHTML = html;

    if (anyFail) {
      sysBadge.textContent = 'Issues Detected';
      sysBadge.className = 'badge issues';
    } else {
      sysBadge.textContent = 'Protected';
      sysBadge.className = 'badge protected';
    }
  });
}

function setupManualScan() {
  document.getElementById('btn-scan').addEventListener('click', () => {
    const url = document.getElementById('manualUrl').value.trim();
    const resDiv = document.getElementById('manualScanResult');
    if (!url) return;
    
    resDiv.innerHTML = "Scanning...";
    chrome.runtime.sendMessage({ type: 'SCAN_URL', payload: { url } }, (res) => {
      if (res && res.success) {
         resDiv.innerHTML = `<strong>Verdict: ${res.data.verdict} (${res.data.score}/100)</strong><br>` +
                            `Flags: ${res.data.flags.join(', ') || 'None'}`;
         
         // Update cache for this URL as well
         chrome.storage.local.set({ [`scan_${url}`]: res.data });
         
         // If this is the current page, refresh the top UI
         chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
           if (tabs && tabs[0] && tabs[0].url === url) {
             updateColors(res.data.score, res.data.verdict);
             document.getElementById('aiExplanation').innerHTML = res.data.explanation || `Flagged for: ${res.data.flags.join(', ') || 'None'}`;
           }
         });
      } else {
         resDiv.innerHTML = `<span style="color:var(--red);">Scan failed: ${res ? res.error : 'Unknown'}</span>`;
      }
    });
  });
}

function setupVoiceUpload() {
  document.getElementById('btn-voice').addEventListener('click', () => {
    const fileInput = document.getElementById('voiceUpload');
    const resDiv = document.getElementById('voiceResult');
    if (fileInput.files.length === 0) return;
    
    const file = fileInput.files[0];
    resDiv.innerHTML = "Uploading and analyzing...";
    
    const reader = new FileReader();
    reader.onload = function(e) {
      const base64Audio = e.target.result; // data:audio/...;base64,...
      chrome.runtime.sendMessage({ type: 'ANALYZE_VOICE', payload: { base64Audio, filename: file.name } }, (res) => {
        if (res && res.success) {
           const d = res.data;
           const clr = d.verdict === 'SYNTHETIC' ? 'var(--red)' : 'var(--green)';
           resDiv.innerHTML = `<strong style="color:${clr}">${d.verdict}</strong> (${(d.confidence * 100).toFixed(1)}% confidence)`;
           if (d.warning) resDiv.innerHTML += `<br><small style="color:var(--yellow)">${d.warning}</small>`;
        } else {
           resDiv.innerHTML = `<span style="color:var(--red);">Analysis failed: ${res ? res.error : 'Unknown'}</span>`;
        }
      });
    };
    reader.readAsDataURL(file);
  });
}

function setupSettings() {
  chrome.storage.local.get(['GEMINI_API_KEY'], res => {
      if(res.GEMINI_API_KEY) document.getElementById('geminiKey').value = res.GEMINI_API_KEY;
  });
  
  document.getElementById('btn-save-settings').addEventListener('click', () => {
     const gemini = document.getElementById('geminiKey').value;
     
     chrome.storage.local.set({ GEMINI_API_KEY: gemini }, () => {
        alert("Settings saved!");
     });
  });
}
