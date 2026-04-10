import { useState } from 'react';
import { scanUrl } from '../api/scanService';
import type { Screen, ScanResult } from '../types';

interface LandingPageProps {
  onNavigate: (s: Screen) => void;
}

export function LandingPage({ onNavigate }: LandingPageProps) {
  const [url, setUrl] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState('');

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    
    setIsScanning(true);
    setScanResult(null);
    setScanError('');
    
    try {
      const formattedUrl = url.startsWith('http') ? url : `http://${url}`;
      const res = await scanUrl(formattedUrl);
      setScanResult(res);
    } catch (err: any) {
      setScanError(err.message || 'Failed to scan the URL. The system might be unreachable.');
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#0e172a_0%,_#020617_100%)] text-white font-sans overflow-x-hidden pt-6">
      
      {/* LOCAL TOP NAV */}
      <header className="fixed top-0 left-0 w-full z-50 px-6 lg:px-12 py-4 flex justify-between items-center bg-[#070b14]/90 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center space-x-3">
          <h1 className="text-2xl font-black tracking-tight uppercase">
            ScamDefy
          </h1>
        </div>
        
        {/* Desktop Nav Links */}
        <nav className="hidden md:flex items-center space-x-8 text-sm font-semibold text-white/90">
          <a href="#features" className="hover:text-electricCyan transition-colors">Features</a>
          <a href="#how-it-works" className="hover:text-electricCyan transition-colors">How it Works</a>
          <a href="#security" className="hover:text-electricCyan transition-colors">Security</a>
          <a href="#pricing" className="hover:text-electricCyan transition-colors">Pricing</a>
        </nav>

        <button 
          onClick={() => onNavigate('dashboard')}
          className="hidden md:block px-6 py-2 bg-electricCyan text-charcoal rounded-full hover:glow-cyan transition-all text-sm font-bold"
        >
          Scan a Message
        </button>
      </header>

      {/* 1. HERO SECTION */}
      <section className="relative min-h-[90vh] flex flex-col justify-center px-6 lg:px-12 max-w-7xl mx-auto pt-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          
          {/* Left Content */}
          <div className="text-left space-y-8 screen-enter z-10">
            <h2 className="text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.1] tracking-tight">
               Detect Scams <br />
               <span className="text-[#38bdf8]">Instantly with AI</span>
            </h2>
            <p className="text-lg md:text-xl text-white/80 max-w-lg leading-relaxed">
              AI-powered fraud detection for your messages and calls. Stop cybercriminals before they stop you.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <button 
                onClick={() => onNavigate('dashboard')}
                className="px-8 py-4 bg-[#0ea5e9] text-white rounded-full font-bold shadow-lg hover:bg-[#38bdf8] transition-colors flex items-center justify-center gap-2"
              >
                Scan a Message Now <span className="text-xl">→</span>
              </button>
              <a 
                href="#how-it-works"
                className="px-8 py-4 rounded-full border border-white/10 bg-[#161b22]/50 hover:bg-[#161b22] text-white font-bold transition-colors flex items-center justify-center"
              >
                See How it Works
              </a>
            </div>
          </div>
          
          {/* Right Content - Mockup */}
          <div className="relative z-10 slide-up" style={{ animationDelay: '0.2s' }}>
            <div className="bg-[#1c212b] rounded-2xl p-6 md:p-8 shadow-2xl border border-white/5">
              
              {/* Header inside mockup */}
              <div className="flex items-center gap-4 mb-6">
                 <div className="w-10 h-10 rounded-full bg-[#0ea5e9]/20 flex items-center justify-center text-[#0ea5e9]">
                   <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                 </div>
                 <div className="flex flex-col gap-2">
                   <div className="w-24 h-2 bg-white/10 rounded-full"></div>
                   <div className="w-16 h-2 bg-white/5 rounded-full"></div>
                 </div>
              </div>

              {/* Message Bubble */}
              <div className="bg-[#2d3342] text-white/90 p-4 rounded-r-xl rounded-bl-xl text-sm leading-relaxed mb-6 border border-white/5">
                "Hi Mom, I've lost my phone. Can you send money to this temporary account for a new one? Urgent!"
              </div>

              {/* Alert Box */}
              <div className="bg-[#3e1d28]/90 border border-[#ff4d4f]/60 rounded-xl p-4 flex flex-col gap-1 shadow-[0_0_25px_rgba(248,113,113,0.35)] relative overflow-hidden backdrop-blur-sm">
                 <div className="flex items-center gap-2 text-[#ff4d4f] font-bold text-sm drop-shadow-[0_0_8px_rgba(255,77,79,0.6)]">
                   <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                   <span>Scam Detected</span>
                 </div>
                 <div className="text-[#ff4d4f]/90 text-xs pl-6 drop-shadow-[0_0_4px_rgba(255,77,79,0.3)]">
                   98.4% Probability of "Family Impersonation" fraud.
                 </div>
              </div>

            </div>
            
            {/* Soft background glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[#0ea5e9]/10 blur-[100px] -z-10 rounded-full"></div>
          </div>

        </div>
      </section>

      {/* Transition Section */}
      <section className="py-20 text-center max-w-3xl mx-auto px-6">
        <p className="text-[#f87171] font-bold text-xs uppercase tracking-[0.2em] mb-4">The threat is real</p>
        <h2 className="text-4xl md:text-5xl font-bold text-white">Anyone can be targeted</h2>
      </section>

      {/* 2. FEATURE SECTION */}
      <section className="py-24 px-6 md:px-12 bg-black/40 border-y border-white/5 relative z-10 scroll-mt-20" id="features">
        <div className="max-w-6xl mx-auto">
          <div className="text-left mb-12">
            <h3 className="text-3xl font-black tracking-tight text-white mb-4">Core Intelligence</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 auto-rows-fr">
            {/* Message Guard - spans 2 cols */}
            <div 
              onClick={() => onNavigate('dashboard')}
              className="glass-panel p-8 hover:transform hover:-translate-y-1 transition-all md:col-span-2 shadow-xl border border-white/5 flex flex-col justify-between cursor-pointer group relative overflow-hidden"
            >
              <div>
                <div className="flex items-center gap-4 mb-4">
                  <div className="text-electricCyan group-hover:animate-pulse">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} className="w-8 h-8"><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
                  </div>
                  <h4 className="text-xl font-black font-mono tracking-wider uppercase text-white group-hover:text-electricCyan transition-colors">Message Guard</h4>
                </div>
                <p className="text-white/60 text-sm leading-relaxed max-w-lg">Advanced linguistic analysis that detects high-pressure tactics, fake urgency, and impersonation patterns used by SMS scammers.</p>
              </div>
              <div className="mt-8">
                 <span className="text-xs font-mono text-electricCyan opacity-0 group-hover:opacity-100 transition-transform -translate-x-4 group-hover:translate-x-0 flex items-center gap-2 duration-300">
                   [ ACCESS MODULE ] <span className="opacity-50">→</span>
                 </span>
              </div>
            </div>

            {/* Link Inspector - spans 1 col */}
            <div 
              onClick={() => onNavigate('webthreats')}
              className="glass-panel p-8 hover:transform hover:-translate-y-1 transition-all shadow-xl border border-white/5 flex flex-col justify-between cursor-pointer group"
            >
              <div>
                <div className="flex items-center gap-4 mb-4">
                  <div className="text-[#10b981] group-hover:animate-pulse">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} className="w-8 h-8"><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
                  </div>
                  <h4 className="text-xl font-black font-mono tracking-wider uppercase text-white group-hover:text-[#10b981] transition-colors">Link Inspector</h4>
                </div>
                <p className="text-white/60 text-sm leading-relaxed">Don't click that! We scan URLs for zero-day phishing sites and hidden redirects before you land on them.</p>
              </div>
              <div className="mt-8">
                 <span className="text-xs font-mono text-[#10b981] opacity-0 group-hover:opacity-100 transition-transform -translate-x-4 group-hover:translate-x-0 flex items-center gap-2 duration-300">
                   [ ACCESS MODULE ] <span className="opacity-50">→</span>
                 </span>
              </div>
            </div>

            {/* Voice Biometrics - spans 1 col */}
            <div 
              onClick={() => onNavigate('calllogs')}
              className="glass-panel p-8 hover:transform hover:-translate-y-1 transition-all shadow-xl border border-white/5 flex flex-col justify-between cursor-pointer group border-electricMagenta/10 hover:border-electricMagenta/40"
            >
              <div>
                <div className="flex items-center gap-4 mb-4">
                  <div className="text-white/50 group-hover:text-electricMagenta transition-colors group-hover:animate-pulse">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} className="w-8 h-8"><path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>
                  </div>
                  <h4 className="text-xl font-black font-mono tracking-wider uppercase text-white group-hover:text-electricMagenta transition-colors">Voice Biometrics</h4>
                </div>
                <p className="text-white/60 text-sm leading-relaxed">Protecting against AI voice clones. We verify the biological authenticity of the speaker's voice in real-time.</p>
              </div>
              <div className="mt-8">
                 <span className="text-xs font-mono text-electricMagenta opacity-0 group-hover:opacity-100 transition-transform -translate-x-4 group-hover:translate-x-0 flex items-center gap-2 duration-300">
                   [ ACCESS MODULE ] <span className="opacity-50">→</span>
                 </span>
              </div>
            </div>

            {/* Privacy Shield - spans 2 cols */}
            <div 
              onClick={() => onNavigate('settings')}
              className="glass-panel border-electricCyan/30 p-8 hover:transform hover:-translate-y-1 transition-all md:col-span-2 shadow-[0_0_15px_rgba(6,182,212,0.1)] hover:shadow-[0_0_30px_rgba(6,182,212,0.2)] flex flex-col justify-between cursor-pointer group relative overflow-hidden"
            >
              <div className="relative z-10">
                <div className="flex items-center gap-4 mb-4">
                  <div className="text-electricCyan group-hover:animate-pulse">
                     <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
                  </div>
                  <h4 className="text-xl font-black font-mono tracking-wider uppercase text-white group-hover:text-electricCyan transition-colors">Privacy Shield</h4>
                </div>
                <p className="text-white/70 text-sm leading-relaxed max-w-md">Integrate ScamDefy's protection directly into your device safely. We process threats locally whenever possible and never store personal communication data.</p>
              </div>
              <div className="mt-8 relative z-10">
                 <span className="text-xs font-mono text-electricCyan opacity-0 group-hover:opacity-100 transition-transform -translate-x-4 group-hover:translate-x-0 flex items-center gap-2 duration-300">
                   [ CONFIGURE PROTOCOLS ] <span className="opacity-50">→</span>
                 </span>
              </div>
              {/* Backlight Glow for the Privacy Shield block */}
              <div className="absolute right-0 top-0 w-80 h-80 bg-electricCyan/10 blur-[80px] rounded-full translate-x-1/3 -translate-y-1/3 pointer-events-none -z-0 group-hover:bg-electricCyan/20 transition-colors duration-500"></div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. HOW IT WORKS */}
      <section className="py-24 px-6 relative z-10 hidden md:block scroll-mt-20" id="how-it-works">
        <div className="max-w-5xl mx-auto text-center">
          <h3 className="text-3xl font-black uppercase tracking-widest text-white/90 mb-16">Operational Flow</h3>
          
          <div className="flex items-center justify-between">
            <div className="flex-1 flex flex-col items-center">
              <div className="w-16 h-16 rounded-full border border-white/20 bg-white/5 flex items-center justify-center text-xl font-bold mb-4 font-mono">1</div>
              <h5 className="font-bold uppercase tracking-wide mb-2 text-electricCyan text-sm">Intercept</h5>
              <p className="text-xs text-white/50 px-4">Detects link click or active incoming call context.</p>
            </div>
            
            <div className="w-24 h-[1px] bg-white/20 relative">
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 border-t border-r border-white/20"></div>
            </div>

            <div className="flex-1 flex flex-col items-center">
              <div className="w-16 h-16 rounded-full border border-electricMagenta/50 bg-electricMagenta/10 flex items-center justify-center text-xl font-bold mb-4 font-mono">2</div>
              <h5 className="font-bold uppercase tracking-wide mb-2 text-electricMagenta text-sm">Analyze</h5>
              <p className="text-xs text-white/50 px-4">Neural models run heuristic & signature checks.</p>
            </div>

            <div className="w-24 h-[1px] bg-white/20 relative">
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 border-t border-r border-white/20"></div>
            </div>

            <div className="flex-1 flex flex-col items-center">
              <div className="w-16 h-16 rounded-full border border-electricCyan/50 glow-cyan flex items-center justify-center text-xl font-bold mb-4 font-mono text-charcoal bg-electricCyan">3</div>
              <h5 className="font-bold uppercase tracking-wide mb-2 text-electricCyan text-sm">Neutralize</h5>
              <p className="text-xs text-white/50 px-4">Instantly prevents action or blocks the attempt.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. LIVE DEMO SECTION */}
      <section className="py-24 px-4 bg-charcoal relative border-y border-white/5 z-10" id="live-demo">
        <div className="max-w-3xl mx-auto flex flex-col items-center">
          <h3 className="text-3xl font-black uppercase tracking-widest text-glow-cyan mb-8 text-center">Threat Scanner</h3>
          
          <form className="w-full flex flex-col md:flex-row gap-4 mb-8" onSubmit={handleScan}>
            <input 
              type="text" 
              placeholder="Paste suspicious URL or domain..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 bg-white/5 border border-white/20 focus:border-electricCyan focus:outline-none p-4 font-mono text-sm shadow-inner transition-colors rounded-none placeholder-white/30"
              required
            />
            <button 
              type="submit"
              disabled={isScanning}
              className={`px-8 py-4 font-bold uppercase tracking-widest transition-all min-w-[200px] ${isScanning ? 'bg-electricCyan/20 text-electricCyan/50 border border-electricCyan/50 animate-pulse' : 'bg-electricCyan text-charcoal hover:glow-cyan hover:scale-[1.02]'}`}
            >
              {isScanning ? 'Scanning...' : 'Scan Payload'}
            </button>
          </form>

          <div className="w-full min-h-[160px] glass-panel border border-white/10 p-6 flex flex-col justify-center relative overflow-hidden transition-all">
            {!scanResult && !scanError && !isScanning && (
               <div className="text-center font-mono text-white/30 uppercase tracking-widest text-sm flex flex-col items-center gap-3">
                 <svg className="w-8 h-8 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 16l2.879-2.879m0 0a3 3 0 104.243-4.242 3 3 0 00-4.243 4.242zM21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                 AWAITING TARGET PAYLOAD
               </div>
            )}
            
            {isScanning && (
               <div className="flex flex-col items-center justify-center">
                 <div className="w-64 h-1 bg-white/10 overflow-hidden relative mb-4">
                    <div className="absolute top-0 left-0 h-full bg-electricCyan w-1/3 animate-[scanline_1s_infinite_linear] shadow-[0_0_10px_#00f2ff]"></div>
                 </div>
                 <span className="font-mono text-xs text-electricCyan animate-pulse tracking-widest">[ EXECUTING NEURAL ANALYSIS... ]</span>
               </div>
            )}

            {scanError && (
              <div className="text-center text-electricMagenta font-mono border border-electricMagenta/20 bg-electricMagenta/5 p-4 uppercase">
                 [ ERROR ]: {scanError}
              </div>
            )}

            {scanResult && !isScanning && (
              <div className={`flex flex-col w-full h-full screen-enter ${scanResult.risk_level === 'CRITICAL' || scanResult.risk_level === 'HIGH' ? 'text-electricMagenta' : 'text-electricCyan'}`}>
                 <div className="flex justify-between items-start mb-4 border-b border-white/10 pb-4">
                    <div>
                      <h4 className="text-xl font-bold mb-1 break-all uppercase tracking-tight">{scanResult.final_url}</h4>
                      <p className="text-xs uppercase tracking-widest opacity-70 font-mono">Verdict: {scanResult.verdict}</p>
                    </div>
                    <div className="text-right">
                       <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Threat Score</p>
                       <p className={`text-4xl font-black ${scanResult.score > 60 ? 'text-glow-magenta' : 'text-glow-cyan'}`}>{scanResult.score}</p>
                    </div>
                 </div>
                 <p className="text-white/80 text-sm leading-relaxed mb-4">{scanResult.explanation}</p>
                 
                 {scanResult.signals && scanResult.signals.length > 0 && (
                   <div className="flex flex-wrap gap-2">
                     {scanResult.signals.map((sig, idx) => (
                        <span key={idx} className="text-[10px] font-mono px-2 py-1 bg-white/5 border border-white/10 rounded uppercase">
                          {sig.name} +{sig.points}
                        </span>
                     ))}
                   </div>
                 )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 5. TRUST / STATS SECTION */}
      <section className="py-16 px-6 bg-black/60 relative z-10 border-b border-white/5 scroll-mt-20" id="security">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center divide-x divide-white/5">
           <div>
              <p className="text-3xl md:text-5xl font-black text-electricCyan mb-2 font-mono">99.8%</p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/50 font-bold">Detection Accuracy</p>
           </div>
           <div>
              <p className="text-3xl md:text-5xl font-black text-white/90 mb-2 font-mono">4.2M+</p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/50 font-bold">Scams Blocked</p>
           </div>
           <div>
              <p className="text-3xl md:text-5xl font-black text-white/90 mb-2 font-mono">&lt;50ms</p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/50 font-bold">Inference Time</p>
           </div>
           <div>
              <p className="text-3xl md:text-5xl font-black text-electricMagenta mb-2 font-mono text-glow-magenta">Zero</p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/50 font-bold">PIM Data Stored</p>
           </div>
        </div>
      </section>

      {/* 6. BOTTOM CTA */}
      <section className="py-32 px-6 flex flex-col items-center text-center relative z-10 scroll-mt-20" id="pricing">
        <h2 className="text-4xl md:text-5xl font-black uppercase tracking-widest mb-8 text-white">
          Don't Fall For Scams Again.
        </h2>
        <button 
          onClick={() => onNavigate('dashboard')}
          className="px-10 py-5 bg-electricCyan text-charcoal font-black uppercase tracking-[0.2em] text-xl hover:glow-cyan hover:scale-[1.03] transition-all"
        >
          Activate ScamDefy
        </button>
      </section>

      {/* 7. FOOTER */}
      <footer className="py-12 border-t border-white/10 text-center relative z-10">
        <div className="flex flex-col md:flex-row justify-center items-center gap-6 mb-8 text-xs font-bold uppercase tracking-widest text-white/50">
          <button className="hover:text-electricCyan transition-colors">Documentation</button>
          <button className="hover:text-electricCyan transition-colors">Privacy Deep-Dive</button>
          <button className="hover:text-electricCyan transition-colors">Security Whitepaper</button>
          <button className="hover:text-electricCyan transition-colors">Threat Intel API</button>
        </div>
        <div className="text-[10px] font-mono text-white/30 tracking-widest">
           © 2026 SCAMDEFY NEURAL SYSTEMS. ALL RIGHTS RESERVED.
        </div>
      </footer>

    </div>
  );
}
