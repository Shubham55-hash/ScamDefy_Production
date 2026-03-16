import { useEffect, useRef, useState } from 'react';
import { useUrlScan } from '../hooks/useUrlScan';
import { useAppStore } from '../store/appStore';
import { getHealth, getStats } from '../api/threatService';
import { UrlInput } from '../components/scanner/UrlInput';
import { ErrorBanner } from '../components/ui/ErrorBanner';

// ── Particle canvas orb ──────────────────────────────────────────────────────
function OrbCanvas({ score, verdict }: { score: number | null; verdict: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Orb glow color based on verdict
  const orbColor =
    verdict === 'BLOCKED' ? '#ef4444' :
    verdict === 'DANGER'  ? '#f97316' :
    verdict === 'CAUTION' ? '#f59e0b' : '#00f2ff';

  // Orb status text
  const statusText =
    verdict
      ? `THREAT_VECTOR: ${verdict}`
      : 'Scanning... Waiting for Payload';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();

    const color = orbColor;
    interface Particle { x: number; y: number; vx: number; vy: number; size: number; alpha: number; }
    const particles: Particle[] = [];
    for (let i = 0; i < 50; i++) {
      particles.push({
        x: Math.random() * canvas.width, y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5,
        size: Math.random() * 2, alpha: Math.random() * 0.8,
      });
    }

    let raf: number;
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        ctx.fillStyle = `rgba(${r},${g},${b},${p.alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });
      raf = requestAnimationFrame(animate);
    };
    animate();

    window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [orbColor]);

  const displayScore = score !== null ? score.toFixed(2) : '0.00';

  return (
    <div className="relative w-72 h-72 md:w-[380px] md:h-[380px] flex items-center justify-center mx-auto">
      {/* Outer spinning ring */}
      <div className="absolute inset-0 border border-electricCyan/20 rounded-full animate-spin-slow">
        <div className="absolute -top-1 left-1/2 w-2 h-2 bg-electricCyan rounded-full" />
      </div>
      {/* Middle dashed ring */}
      <div className="absolute inset-6 border border-dashed border-electricMagenta/30 rounded-full animate-spin-reverse-slow" />
      {/* Inner ring */}
      <div className="absolute inset-14 border border-electricCyan/10 rounded-full" />

      {/* Orb sphere */}
      <div
        className="w-52 h-52 md:w-64 md:h-64 rounded-full relative overflow-hidden flex items-center justify-center animate-pulse-glow"
        style={{
          background: `radial-gradient(circle at 30% 30%, ${orbColor}30, transparent)`,
          boxShadow: `0 0 40px ${orbColor}20, 0 0 80px ${orbColor}10`,
          transition: 'box-shadow 0.5s, background 0.5s',
        }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        <div className="z-20 text-center px-4">
          <p className="text-[9px] font-mono uppercase tracking-[0.5em] opacity-60 mb-2">Risk Score</p>
          <h2
            className="text-6xl md:text-7xl font-black leading-none transition-all duration-500"
            style={{ color: orbColor, textShadow: `0 0 20px ${orbColor}` }}
          >
            {displayScore}
          </h2>
          <p className="mt-2 text-[9px] font-mono opacity-40 uppercase tracking-tighter">{statusText}</p>
        </div>
      </div>

      {/* Floating data markers — update after scan */}
      <div
        className="absolute -top-8 -right-16 md:-right-24 glass-panel p-3 rounded-tl-2xl rounded-br-2xl border-l-2 border-electricCyan animate-float text-left"
        style={{ minWidth: 130 }}
      >
        <p className="text-[9px] text-electricCyan font-mono">
          {verdict ? `VERDICT: ${verdict}` : 'ENCRYPT_LEVEL: AES-256'}
        </p>
        <p className="text-[9px] opacity-60 font-mono">
          {score !== null ? `SCORE: ${score.toFixed(1)}/100` : 'NODE_ID: 0x992B-X'}
        </p>
      </div>
      <div
        className="absolute -bottom-4 -left-16 md:-left-24 glass-panel p-3 rounded-tr-2xl rounded-bl-2xl border-r-2 border-electricMagenta animate-float-delay text-left"
        style={{ minWidth: 130 }}
      >
        <p className="text-[9px] text-electricMagenta font-mono">
          {score !== null ? `THREAT_VECTOR: ${verdict}` : 'THREAT_VECTOR: NULL'}
        </p>
        <p className="text-[9px] opacity-60 font-mono">ORIGIN: DECENTRALIZED</p>
      </div>
    </div>
  );
}

// ── Module health cards ───────────────────────────────────────────────────────
const MODULE_ICONS: Record<string, string> = {
  gsb_service: '🛡️',
  urlhaus_service: '🕷️',
  voice_cnn: '🎙️',
  url_expander: '🔗',
  database: '🗄️',
  gemini: '🤖'
};

// ── Dashboard screen ──────────────────────────────────────────────────────────
export function Dashboard() {
  const { result, loading: scanLoading, error: scanError, scan } = useUrlScan();
  const { health, totalBlocked, todayBlocked, setStats, setHealth } = useAppStore();
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatsLoading(true);
      try {
        const [healthData, statsData] = await Promise.all([getHealth(), getStats()]);
        if (!cancelled) { setHealth(healthData); setStats(statsData.total_blocked, statsData.today_detected); }
      } catch {}
      finally { if (!cancelled) setStatsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [setHealth, setStats]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-start pt-8 pb-20 px-6 relative">

      {/* Stats chips */}
      <div className="flex gap-3 mb-8 flex-wrap justify-center w-full max-w-3xl">
        {[
          { label: "TODAY'S THREATS", value: statsLoading ? '···' : todayBlocked, color: '#f97316' },
          { label: 'TOTAL BLOCKED',   value: statsLoading ? '···' : totalBlocked, color: '#ef4444' },
          { label: 'SYSTEM STATUS',   value: statsLoading ? '···' : (health ? 'OPTIMAL' : 'OFFLINE'), color: health ? '#00f2ff' : '#ef4444' },
        ].map(s => (
          <div key={s.label} className="glass-panel rounded-full px-5 py-2 flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: s.color, boxShadow: `0 0 6px ${s.color}` }} />
            <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">{s.label}:</span>
            <span className="text-sm font-black font-mono" style={{ color: s.color }}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* Orb */}
      <div className="mb-12">
        <OrbCanvas score={result?.score ?? null} verdict={result?.verdict ?? null} />
      </div>

      {/* Error */}
      {scanError && (
        <div className="w-full max-w-2xl mb-6">
          <ErrorBanner error={scanError} />
        </div>
      )}

      {/* AI explanation after scan */}
      {result?.explanation && (
        <div className="w-full max-w-2xl mb-6 glass-panel rounded-xl p-5 border-l-2 border-electricCyan slide-up">
          <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-electricCyan mb-2">Neural Analysis</p>
          <p className="text-sm text-white/60 leading-relaxed">{result.explanation}</p>
          {result.scam_type && (
            <p className="mt-2 text-[10px] font-mono text-white/30">
              TYPE: {result.scam_type.replace(/_/g, ' ')} · TIME: {(result.scan_time_ms + 1000).toFixed(0)}ms
            </p>
          )}
        </div>
      )}

      {/* URL input */}
      <div className="w-full max-w-2xl mb-16">
        <UrlInput onScan={scan} loading={scanLoading} />
      </div>

      {/* Module health grid */}
      {health?.modules && (
        <div className="w-full max-w-5xl">
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/30 mb-6 text-center">Detection Modules</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {Object.entries(health.modules).map(([mod, active], i) => (
              <div
                key={mod}
                className="relative group"
              >
                {/* Corner decorators shifted for 2-column layout */}
                {i % 2 === 0 && <div className="absolute -inset-1 border-l border-t border-electricCyan/20 rounded-tl-2xl pointer-events-none" />}
                {i % 2 === 1 && <div className="absolute -inset-1 border-r border-t border-electricMagenta/20 rounded-tr-2xl pointer-events-none" />}
                {i > 1 && <div className="absolute -inset-1 border-b border-electricCyan/5 rounded-2xl pointer-events-none opacity-20" />}

                <div className="glass-panel p-6 rounded-xl h-full flex flex-col">
                  {/* Hexagon icon */}
                  <div
                    className="w-11 h-11 hexagon-clip flex items-center justify-center mb-4 text-lg"
                    style={{
                      border: `1px solid ${active ? '#00f2ff' : '#ff00e5'}40`,
                      background: `${active ? '#00f2ff' : '#ff00e5'}08`,
                    }}
                  >
                    {MODULE_ICONS[mod] ?? '⚙️'}
                  </div>
                  <h3 className="text-sm font-bold mb-1 capitalize">{mod.replace(/_/g, ' ')}</h3>
                  <p className="text-xs text-white/40 font-light leading-relaxed">
                    {active
                      ? `${mod.replace(/_/g, ' ')} detection module is fully operational.`
                      : `API key required to enable ${mod.replace(/_/g, ' ')} scanning.`}
                  </p>
                  <div className="mt-auto pt-4 flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{
                        background: active ? '#00f2ff' : '#ff00e5',
                        animation: 'pulse 2s infinite',
                        boxShadow: `0 0 4px ${active ? '#00f2ff' : '#ff00e5'}`,
                      }}
                    />
                    <span className="text-[9px] font-mono uppercase tracking-[0.2em] opacity-40">
                      {active ? 'ACTIVE_SENTINEL' : 'NO_KEY_DETECTED'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
