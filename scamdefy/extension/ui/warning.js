/**
 * warning.js — ScamDefy Threat Warning Page
 *
 * Reads scan data from ?url=&data= query params (set by service_worker.js).
 * Falls back to chrome.storage if data param is absent.
 *
 * Button behaviour (matching ScamDefy-main video):
 *   "Take Me to Safety"  → history.back() or close tab
 *   "Proceed Anyway"     → native confirm() dialog, then whitelist + navigate
 */

import ENV from '../config/env.js';

document.addEventListener('DOMContentLoaded', async () => {

  // ── Parse URL params ──────────────────────────────────────────────────────
  const params    = new URLSearchParams(window.location.search);
  const targetUrl = params.get('url')     || '';
  const rawData   = params.get('data')    || '';

  // ── Risk config ───────────────────────────────────────────────────────────
  const RISK = {
    LOW:      { icon: '✅', label: 'LOW RISK',      color: '#00f2ff' },
    MEDIUM:   { icon: '⚠️', label: 'MEDIUM RISK',   color: '#f59e0b' },
    HIGH:     { icon: '⚠️', label: 'HIGH RISK',     color: '#ef4444' },
    CRITICAL: { icon: '☠️', label: 'CRITICAL RISK', color: '#ff00e5' },
  };

  // ── Verdict → display level map (backend uses BLOCKED/DANGER/CAUTION/SAFE)
  const VERDICT_TO_LEVEL = {
    BLOCKED: 'CRITICAL',
    DANGER:  'HIGH',
    CAUTION: 'MEDIUM',
    SAFE:    'LOW',
    ERROR:   'HIGH',
  };

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const card           = document.getElementById('warningCard');
  const shield         = document.getElementById('warningShield');
  const levelBadge     = document.getElementById('levelBadge');
  const levelText      = document.getElementById('levelText');
  const scamTypeEl     = document.getElementById('scamTypeText');
  const scoreVal       = document.getElementById('riskScoreValue');
  const barFill        = document.getElementById('barFill');
  const blockedUrlEl   = document.getElementById('blockedUrl');
  const explanationEl  = document.getElementById('explanationText');
  const aiBadge        = document.getElementById('aiBadge');
  const signalsSection = document.getElementById('signalsSection');
  const signalsList    = document.getElementById('signalsList');

  // ── Apply risk-level styling ──────────────────────────────────────────────
  function applyRiskLevel(level, score) {
    const cfg = RISK[level] || RISK.HIGH;

    if (shield) {
      shield.textContent = cfg.icon;
      if (level === 'CRITICAL') shield.classList.add('critical');
    }
    if (card && level === 'CRITICAL') {
      card.classList.add('critical');
      document.body.classList.add('critical-mode');
    }
    if (levelBadge) {
      levelBadge.style.color       = cfg.color;
      levelBadge.style.borderColor = cfg.color + '55';
      levelBadge.style.background  = cfg.color + '18';
      if (level === 'CRITICAL') levelBadge.classList.add('CRITICAL');
    }
    if (levelText) levelText.textContent = cfg.label;
    if (scoreVal) {
      scoreVal.textContent = `${score}/100`;
      scoreVal.style.color = cfg.color;
      if (level === 'CRITICAL') scoreVal.classList.add('CRITICAL');
    }
    if (barFill) {
      if (level === 'CRITICAL') barFill.classList.add('CRITICAL');
      // Animate bar fill after short delay for visual effect
      setTimeout(() => { barFill.style.width = `${Math.min(score, 100)}%`; }, 200);
    }
  }

  // ── Render threat signals ─────────────────────────────────────────────────
  function renderSignals(flags, level, score, scamType) {
    const items = [];

    if (flags && flags.length > 0) {
      // Use real flags from scan
      flags.forEach(f => items.push(
        f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      ));
    } else if (level === 'HIGH' || level === 'CRITICAL') {
      // Auto-generate contextual signals
      const t = (scamType || '').toLowerCase();
      if (t.includes('phish'))       items.push('Detected in phishing threat databases');
      if (t.includes('impersonat'))  items.push('Domain impersonates a well-known brand');
      if (t.includes('credential'))  items.push('Login form sends data to external server');
      if (items.length === 0)        items.push('Multiple security engines flagged this URL');
      items.push(`Risk score: ${score}/100 — exceeds danger threshold`);
    }

    if (items.length > 0 && signalsSection && signalsList) {
      signalsSection.style.display = 'block';
      items.forEach(sig => {
        const li = document.createElement('li');
        li.className = 'signal-item';
        li.textContent = sig;
        signalsList.appendChild(li);
      });
    }
  }

  // ── Load and render scan data ─────────────────────────────────────────────
  let data = null;

  // Primary: data is base64-encoded in the URL (set by service_worker.js)
  if (rawData) {
    try {
      data = JSON.parse(atob(rawData));
    } catch (e) {
      console.warn('[ScamDefy] Could not decode data param, falling back to storage');
    }
  }

  // Fallback: poll chrome.storage
  if (!data && targetUrl) {
    const res = await new Promise(resolve =>
      chrome.storage.local.get([`scan_${targetUrl}`], resolve)
    );
    data = res[`scan_${targetUrl}`] || null;
  }

  // Determine display values from scan data
  const displayLevel = data
    ? (VERDICT_TO_LEVEL[data.verdict] || 'HIGH')
    : 'HIGH';
  const displayScore = data ? Math.round(data.score ?? 70) : 70;
  const displayType  = data?.scam_type  || 'Suspicious Website';
  const displayExpl  = data?.explanation || 'This website has been flagged as potentially dangerous by multiple AI security systems. It may attempt to steal your credentials, install malware, or defraud you. We strongly recommend you go back to safety.';
  const displayFlags = data?.flags || [];

  // Render blocked URL
  if (blockedUrlEl) {
    const disp = targetUrl.length > 72 ? targetUrl.slice(0, 69) + '…' : (targetUrl || 'Unknown URL');
    blockedUrlEl.textContent = disp;
  }

  // Apply styling
  applyRiskLevel(displayLevel, displayScore);

  // Scam type
  if (scamTypeEl) {
    scamTypeEl.textContent = displayType;
    if (displayLevel === 'CRITICAL') scamTypeEl.classList.add('CRITICAL');
  }

  // AI explanation
  if (explanationEl) {
    explanationEl.textContent = displayExpl;
  }
  if (aiBadge && data?.explanation) {
    aiBadge.textContent = '✨ GEMINI AI';
  } else if (aiBadge) {
    aiBadge.textContent = 'AI ANALYSIS';
    aiBadge.style.background = '#374151';
    aiBadge.style.color = '#9ca3af';
  }

  // Threat signals
  renderSignals(displayFlags, displayLevel, displayScore, displayType);

  // ── Button: Take Me to Safety ─────────────────────────────────────────────
  const btnGoBack = document.getElementById('btnGoBack');
  if (btnGoBack) {
    btnGoBack.addEventListener('click', () => {
      if (window.history.length > 2) {
        window.history.back();
      } else {
        // No history to go back to — close the tab
        chrome.tabs.getCurrent(tab => tab && chrome.tabs.remove(tab.id));
      }
    });
  }

  // ── Button: Proceed Anyway ────────────────────────────────────────────────
  // Matches video EXACTLY:
  //   1. Shows native confirm() dialog with scam type, risk score, warning text
  //   2. If user confirms: adds URL to whitelist, then navigates to the real URL
  //   3. If user cancels: stays on warning page (nothing happens)
  const btnProceed = document.getElementById('btnProceed');
  if (btnProceed) {
    btnProceed.addEventListener('click', async () => {
      const destination = targetUrl;
      if (!destination) return;

      // Native confirm dialog — exactly as shown in video
      const confirmed = window.confirm(
        `⚠️ ScamDefy Warning\n\nYou are about to visit a site flagged as:\n${displayType}\n\nRisk Score: ${displayScore}/100\n\nProceeding may put your personal data at risk.\n\nAre you sure you want to continue?`
      );

      if (!confirmed) return; // User clicked Cancel — stay on warning page

      // Add to whitelist so this URL is not blocked again this session
      try {
        const storageResult = await new Promise(res =>
          chrome.storage.local.get(['whitelist'], res)
        );
        const whitelist = storageResult.whitelist || [];
        if (!whitelist.includes(destination)) {
          whitelist.push(destination);
          await new Promise(res => chrome.storage.local.set({ whitelist }, res));
        }
      } catch (e) {
        console.warn('[ScamDefy] Could not update whitelist:', e);
      }

      // Navigate to the original URL
      window.location.replace(destination);
    });
  }

});
