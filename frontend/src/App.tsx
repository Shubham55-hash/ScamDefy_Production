import { useState, useEffect } from 'react';
import { Dashboard } from './screens/Dashboard';
import { WebThreats } from './screens/WebThreats';
import { QRScan } from './screens/QRScan';
import { CallLogs } from './screens/CallLogs';
import { Settings } from './screens/Settings';
import { SafetyCircle } from './screens/SafetyCircle';
import { TestDashboard } from './screens/TestDashboard';
import { LandingPage } from './screens/LandingPage';
import { ToastContainer } from './components/ui/Toast';
import { BottomNav } from './components/BottomNav';
import type { Screen } from './types';

const NAV_LINKS: Array<{ id: Screen; label: string; desktopLabel: string; testOnly?: boolean }> = [
  { id: 'dashboard',  label: 'Home',     desktopLabel: 'Command Center'   },
  { id: 'qrscan',     label: 'QR',       desktopLabel: 'QR Shield'         },
  { id: 'calllogs',   label: 'Voice',    desktopLabel: 'Neural Net'        },
  { id: 'webthreats', label: 'History',  desktopLabel: 'Threat Log'       },
  { id: 'settings',   label: 'Settings', desktopLabel: 'Security Center'   },
  { id: 'testlab',    label: 'Test',     desktopLabel: 'Test Lab ⚗',       testOnly: true },
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



export default function App() {
  console.log("[ScamDefy] App Component Rendering...");
  // Test mode: activated via ?testmode=1 URL param OR localStorage sd_testmode=1
  const [testMode] = useState<boolean>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('testmode') === '1' ||
             localStorage.getItem('sd_testmode') === '1';
    } catch (e) {
      console.warn("[ScamDefy] Failed to read localStorage/params", e);
      return false;
    }
  });

  const [screen, setScreen] = useState<Screen>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('testmode') === '1' ? 'testlab' : 'landing';
    } catch (e) {
      return 'landing';
    }
  });

  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768);

  const [visited, setVisited] = useState<Set<Screen>>(() => {
    try {
      const initial = new Set<Screen>(['landing']);
      const params = new URLSearchParams(window.location.search);
      if (params.get('testmode') === '1') initial.add('testlab');
      return initial;
    } catch (e) {
      return new Set<Screen>(['landing']);
    }
  });

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

      {/* Desktop side nav */}
      {isDesktop && screen !== 'landing' && (
        <aside className="fixed top-0 left-0 h-screen w-64 z-50 flex flex-col glass-panel border-r border-white/5 bg-slate-950/80">
          {/* Logo */}
          <div className="p-8 border-b border-white/5">
            <button
              onClick={() => navigate('dashboard')}
              className="flex items-center space-x-3 cursor-pointer group"
            >
              <div className="w-9 h-9 border-2 border-electricCyan hexagon-clip flex items-center justify-center animate-pulse shrink-0">
                <div className="w-3.5 h-3.5 bg-electricCyan hexagon-clip" />
              </div>
              <h1 className="text-xl font-bold tracking-tighter uppercase italic text-white group-hover:text-electricCyan transition-colors">
                ScamDefy
              </h1>
            </button>
          </div>

          {/* Nav links */}
          <nav className="flex-grow flex flex-col space-y-2 p-4 mt-4">
            {NAV_LINKS.filter(link => !link.testOnly || testMode).map(link => {
              const active = screen === link.id;
              const isTestLink = link.id === 'testlab';
              return (
                <button
                  key={link.id}
                  onClick={() => navigate(link.id)}
                  className={`text-left px-4 py-3 rounded-lg text-[10px] font-bold tracking-[0.2em] uppercase transition-all duration-300 ${
                    active
                      ? isTestLink
                        ? 'text-electricMagenta bg-electricMagenta/10 border-l-2 border-electricMagenta'
                        : 'text-electricCyan bg-electricCyan/10 border-l-2 border-electricCyan'
                      : 'text-slate-400 hover:text-white hover:bg-white/5 border-l-2 border-transparent'
                  }`}
                >
                  {link.desktopLabel}
                </button>
              );
            })}
          </nav>

          {/* Status */}
          <div className="p-6 border-t border-white/5 mt-auto bg-slate-900/40">
            <p className="text-[10px] uppercase tracking-widest opacity-50 mb-1">System Status</p>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-electricCyan rounded-full animate-pulse shadow-[0_0_8px_#00f2ff]" />
              <p className="text-xs text-electricCyan font-mono">OPTIMAL // PROTECTED</p>
            </div>
          </div>
        </aside>
      )}

      {/* Lazy-mount */}
      <main className={`relative z-10 ${screen === 'landing' ? '' : (isDesktop ? 'ml-64 pb-16 min-h-screen' : 'pb-28')}`}>
        {visited.has('landing')      && <div style={{ display: screen === 'landing'      ? 'block' : 'none' }}><LandingPage onNavigate={navigate} /></div>}
        {visited.has('dashboard')    && <div style={{ display: screen === 'dashboard'    ? 'block' : 'none' }}><Dashboard /></div>}
        {visited.has('webthreats')   && <div style={{ display: screen === 'webthreats'   ? 'block' : 'none' }}><WebThreats /></div>}
        {visited.has('qrscan')       && <div style={{ display: screen === 'qrscan'       ? 'block' : 'none' }}><QRScan /></div>}
        {visited.has('calllogs')     && <div style={{ display: screen === 'calllogs'     ? 'block' : 'none' }}><CallLogs /></div>}
        {visited.has('settings')     && <div style={{ display: screen === 'settings'     ? 'block' : 'none' }}><Settings onNavigate={navigate} /></div>}
        {visited.has('safetycircle') && <div style={{ display: screen === 'safetycircle' ? 'block' : 'none' }}><SafetyCircle onBack={() => navigate('settings')} /></div>}
        {testMode && visited.has('testlab') && <div style={{ display: screen === 'testlab' ? 'block' : 'none' }}><TestDashboard /></div>}
      </main>

      {/* Mobile bottom nav */}
      {!isDesktop && screen !== 'landing' && (
        <BottomNav active={screen} onNav={navigate} testMode={testMode} />
      )}


    </div>
  );
}
