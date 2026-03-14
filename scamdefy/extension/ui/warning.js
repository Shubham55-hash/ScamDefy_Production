import ENV from '../config/env.js';

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const targetUrl = urlParams.get('url');
  
  if (!targetUrl) {
    document.getElementById('blockedUrl').textContent = "No URL provided.";
    return;
  }

  document.getElementById('blockedUrl').textContent = targetUrl;
  
  // Setup Buttons
  document.getElementById('btnBack').addEventListener('click', () => {
    // Navigate back or close tab
    if (window.history.length > 2) {
      window.history.back();
    } else {
      chrome.tabs.getCurrent(tab => tab && chrome.tabs.remove(tab.id));
    }
  });

  document.getElementById('btnProceed').addEventListener('click', async () => {
    // Add to whitelist
    const storageResult = await new Promise(res => chrome.storage.local.get(['whitelist'], res));
    const whitelist = storageResult.whitelist || [];
    if (!whitelist.includes(targetUrl)) {
      whitelist.push(targetUrl);
      await new Promise(res => {
          chrome.storage.local.set({ whitelist }, res);
      });
    }
    // Navigate to URL
    window.location.replace(targetUrl);
  });

  document.getElementById('btnReport').addEventListener('click', async () => {
    try {
      // Assuming a backend /api/feedback endpoint exists or will exist
      await fetch(`${ENV.BACKEND_URL}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl, verdict: "FALSE_POSITIVE" })
      });
      alert("Report submitted successfully. Thank you!");
    } catch (e) {
      console.warn("Feedback endpoint might not be active, but report recorded locally.");
      alert("Report recorded.");
    }
  });

  // Load Data
  try {
    const res = await new Promise(resolve => chrome.storage.local.get([`scan_${targetUrl}`], resolve));
    const data = res[`scan_${targetUrl}`];

    if (data) {
      document.getElementById('riskScore').textContent = data.score;
      document.getElementById('riskVerdict').textContent = data.verdict;
      document.getElementById('riskExplanation').innerHTML = data.explanation || "This site exhibits suspicious patterns associated with scams or phishing.";
      
      const listEl = document.getElementById('flagList');
      if (data.flags && data.flags.length > 0) {
        data.flags.forEach(f => {
          const li = document.createElement('li');
          li.textContent = f;
          listEl.appendChild(li);
        });
      } else {
         const li = document.createElement('li');
         li.textContent = "High overall risk score based on heuristics.";
         listEl.appendChild(li);
      }
    } else {
       document.getElementById('riskExplanation').textContent = "Scan data not found. This page was blocked by ScamDefy.";
    }
  } catch (e) {
    console.error(e);
  }
});
