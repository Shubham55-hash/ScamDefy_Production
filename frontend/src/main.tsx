import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

console.log("[ScamDefy] Entry point reached.");

const rootElement = document.getElementById('root');

if (!rootElement) {
  console.error("[ScamDefy] Root element #root not found!");
  document.body.innerHTML = '<div style="color:red;padding:20px;">CRITICAL ERROR: Failed to find root element #root</div>';
} else {
  try {
    console.log("[ScamDefy] Attempting to mount React app...");
    const root = createRoot(rootElement);
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    console.log("[ScamDefy] Render call successful.");
  } catch (err) {
    console.error("[ScamDefy] Mount Error:", err);
    rootElement.innerHTML = `
      <div style="background:#1a1a1a; color:#ff4444; padding:2rem; font-family:monospace; border:2px solid #ff4444; margin:1rem; border-radius:8px;">
        <h1 style="margin-top:0;">🛑 RUNTIME EXCEPTION</h1>
        <p>The application failed to initialize. Details:</p>
        <pre style="background:#000; padding:1rem; overflow:auto;">${err instanceof Error ? err.stack : String(err)}</pre>
      </div>
    `;
  }
}

window.onerror = (message, source, lineno, colno, error) => {
  console.error("[ScamDefy Global Error]", { message, source, lineno, colno, error });
  return false; 
};
