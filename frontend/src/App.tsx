import { useState, useEffect } from 'react';
import { Dashboard } from './screens/Dashboard';
import { WebThreats } from './screens/WebThreats';
import { CallLogs } from './screens/CallLogs';
import { Settings } from './screens/Settings';
import { ToastContainer } from './components/ui/Toast';
import { BottomNav } from './components/BottomNav';
import type { Screen } from './types';

const NAV_LINKS: Array<{ id: Screen; label: string; desktopLabel: string }> = [
  { id: 'dashboard',  label: 'Home',     desktopLabel: 'Command Center'   },
  { id: 'webthreats', label: 'Scanner',  desktopLabel: 'Surveillance'     },
  { id: 'calllogs',   label: 'Voice',    desktopLabel: 'Neural Net'        },
  { id: 'settings',   label: 'Settings', desktopLabel: 'Encrypted Logs'   },
];

// Background ambience — shared across all screens
function BgAmbience() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-electricCyan/5 rounded-full blur-[120px]" />
      <div className="absolute top-1/3 right-1/4 w-[400px] h-[400px] bg-electricMagenta/5 rounded-full blur-[100px]" />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(255,255,255,0.05) 1px, transparent 0)',
          backgroundSize: '40px 40px',
        }}
      />
    </div>
  );
}

// Fixed threat stream footer
function ThreatStreamFooter() {
  return (
    <footer className="fixed bottom-0 left-0 w-full h-12 glass-panel border-t border-white/5 flex items-center z-50 overflow-hidden">
      <div className="bg-electricCyan px-4 h-full flex items-center shrink-0">
        <span className="text-charcoal font-black text-[10px] tracking-[0.2em] uppercase italic">Threat Stream</span>
      </div>
      <div className="flex-grow font-mono text-[10px] text-white/40 tracking-widest whitespace-nowrap overflow-hidden relative">
        <div className="absolute inset-0 flex items-center animate-terminal-scroll space-x-12 pl-8">
          <span>[INFO] REDIRECT DETECTED FROM: 221.18.99.102 ... [CLEAN]</span>
          <span className="text-electricMagenta">[ALERT] UNUSUAL HEADER INJECTION AT 09:44:21</span>
          <span>[INFO] IP GEOLOCATION: NETHERLANDS (EU-W1)</span>
          <span>[INFO] SCANNING PAYLOAD 4492-X ... [PASSED]</span>
          <span className="text-electricCyan">[NEURAL] SIMILARITY MATCH 4% WITH KNOWN DB</span>
          <span>[INFO] MALWARE SIGNATURE CHECK CLEAN</span>
          <span className="text-electricMagenta">[ALERT] SUSPICIOUS DNS PATTERN FLAGGED</span>
          <span>[INFO] SSL CERTIFICATE CHAIN ... [VERIFIED]</span>
          {/* duplicate for seamless loop */}
          <span>[INFO] REDIRECT DETECTED FROM: 221.18.99.102 ... [CLEAN]</span>
          <span className="text-electricMagenta">[ALERT] UNUSUAL HEADER INJECTION AT 09:44:21</span>
          <span>[INFO] IP GEOLOCATION: NETHERLANDS (EU-W1)</span>
          <span>[INFO] SCANNING PAYLOAD 4492-X ... [PASSED]</span>
          <span className="text-electricCyan">[NEURAL] SIMILARITY MATCH 4% WITH KNOWN DB</span>
          <span>[INFO] MALWARE SIGNATURE CHECK CLEAN</span>
          <span className="text-electricMagenta">[ALERT] SUSPICIOUS DNS PATTERN FLAGGED</span>
          <span>[INFO] SSL CERTIFICATE CHAIN ... [VERIFIED]</span>
        </div>
      </div>
      <div className="bg-white/5 px-6 h-full flex items-center shrink-0 text-[10px] font-mono space-x-4">
        <span className="text-electricCyan">CPU: 12%</span>
        <span className="text-white/40">SECURE_LINK_ESTABLISHED</span>
      </div>
    </footer>
  );
}

export default function App() {
  console.log("[ScamDefy] App Component Rendering...");
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768);
  // Track which screens have been visited — they are mounted once and kept alive.
  // This avoids mounting all screens at startup (slow) while still preserving state
  // when navigating away and back.
  const [visited, setVisited] = useState<Set<Screen>>(new Set(['dashboard']));

  const navigate = (s: Screen) => {
    setScreen(s);
    setVisited(prev => { const n = new Set(prev); n.add(s); return n; });
  };

  useEffect(() => {
    const handler = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);


  return (
    <div className="min-h-screen bg-charcoal text-white selection:bg-electricCyan/30">
      <BgAmbience />
      <ToastContainer />

      {/* Desktop top nav */}
      {isDesktop && (
        <header className="fixed top-0 left-0 w-full z-50 px-6 py-4 flex justify-between items-center mix-blend-lighten glass-panel border-b border-white/5">
          {/* Logo */}
          <button
            onClick={() => navigate('dashboard')}
            className="flex items-center space-x-3 cursor-pointer"
          >
            <div className="w-9 h-9 border-2 border-electricCyan hexagon-clip flex items-center justify-center animate-pulse">
              <div className="w-3.5 h-3.5 bg-electricCyan hexagon-clip" />
            </div>
            <h1 className="text-xl font-bold tracking-tighter uppercase italic">
              ScamDefy
            </h1>
          </button>

          {/* Nav links */}
          <nav className="flex space-x-8 text-xs font-medium tracking-[0.3em] uppercase">
            {NAV_LINKS.map(link => {
              const active = screen === link.id;
              return (
                <button
                  key={link.id}
                  onClick={() => navigate(link.id)}
                  className={`transition-colors ${
                    active
                      ? 'text-electricMagenta border-b border-electricMagenta pb-0.5'
                      : 'opacity-60 hover:text-electricCyan hover:opacity-100'
                  }`}
                >
                  {link.desktopLabel}
                </button>
              );
            })}
          </nav>

          {/* Status */}
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest opacity-50">System Status</p>
            <p className="text-xs text-electricCyan font-mono">OPTIMAL // PROTECTED</p>
          </div>
        </header>
      )}

      {/* Lazy-mount: only mount a screen after first visit, then keep it alive to
          preserve voice results, selected file, message text, etc. across navigation. */}
      <main className={`relative z-10 ${isDesktop ? 'pt-20 pb-16' : 'pb-28'}`}>
        {visited.has('dashboard')  && <div style={{ display: screen === 'dashboard'  ? 'block' : 'none' }}><Dashboard /></div>}
        {visited.has('webthreats') && <div style={{ display: screen === 'webthreats' ? 'block' : 'none' }}><WebThreats /></div>}
        {visited.has('calllogs')   && <div style={{ display: screen === 'calllogs'   ? 'block' : 'none' }}><CallLogs /></div>}
        {visited.has('settings')   && <div style={{ display: screen === 'settings'   ? 'block' : 'none' }}><Settings /></div>}
      </main>

      {/* Mobile bottom nav */}
      {!isDesktop && (
        <BottomNav active={screen} onNav={navigate} />
      )}

      {/* Threat stream footer — always visible */}
      <ThreatStreamFooter />
    </div>
  );
}
