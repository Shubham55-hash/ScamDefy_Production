import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const rootElement = document.getElementById('root');

if (!rootElement) {
  document.body.innerHTML = '<div style="color:red;padding:20px;">CRITICAL ERROR: Failed to find root element #root</div>';
} else {
  try {
    console.log("[ScamDefy] Attempting to mount React app...");
    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    console.log("[ScamDefy] Mount call successful.");
  } catch (err: any) {
    console.error("[ScamDefy] Mount Error:", err);
    rootElement.innerHTML = `
      <div style="background:#1a1a1a; color:#ff4444; padding:2rem; font-family:monospace; border:2px solid #ff4444; margin:1rem; border-radius:8px;">
        <h1 style="margin-top:0;">🛑 RUNTIME EXCEPTION</h1>
        <p>The application failed to initialize. Details:</p>
        <pre style="background:#000; padding:1rem; overflow:auto;">${err?.stack || err?.message || err}</pre>
        <p style="color:#666; font-size:0.8rem; margin-bottom:0;">Please check the browser console for a full trace.</p>
      </div>
    `;
  }
}

window.onerror = (message, source, lineno, colno, error) => {
  console.error("[ScamDefy Global Error]", { message, source, lineno, colno, error });
  return false; 
};
