import { useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import { clearThreats } from '../api/threatService';
import { useAppStore } from '../store/appStore';
import { useSafetyCircle } from '../hooks/useSafetyCircle';
import type { Screen } from '../types';

const LEVELS = [
  {
    id: 'conservative' as const,
    label: 'Conservative',
    icon: '🟡',
    code: 'PROTOCOL_ALPHA',
    desc: 'Block at ≥ 80, warn at ≥ 50. Minimal false positives.',
  },
  {
    id: 'balanced' as const,
    label: 'Balanced',
    icon: '🟠',
    code: 'PROTOCOL_BETA',
    desc: 'Block at ≥ 40, warn at ≥ 30. Recommended for most operators.',
  },
  {
    id: 'aggressive' as const,
    label: 'Aggressive',
    icon: '🔴',
    code: 'PROTOCOL_OMEGA',
    desc: 'Max sensitivity. Block at ≥ 20, warn at any risk signal.',
  },
];

export function Settings({ onNavigate }: { onNavigate?: (s: Screen) => void }) {
  const { settings, save } = useSettings();
  const { addToast, setThreats, setStats } = useAppStore();
  const { settings: sc } = useSafetyCircle();
  const [protectionLevel, setProtectionLevel] = useState(settings.protectionLevel);
  const [clearConfirm, setClearConfirm] = useState(false);

  const handleSaveAll = () => {
    save({ protectionLevel });
    // Dispatch custom event for extension content script to detect
    window.dispatchEvent(new CustomEvent('scamdefy-settings-updated', { 
      detail: { protectionLevel } 
    }));
    addToast('success', `Security protocol updated.`);
  };

  const handleClearHistory = async () => {
    if (!clearConfirm) { setClearConfirm(true); return; }
    try {
      await clearThreats();
      setThreats([]); setStats(0, 0);
      try { localStorage.removeItem('scamdefy_threats'); } catch {}
      addToast('success', 'All threat logs purged');
      setClearConfirm(false);
    } catch { addToast('error', 'Failed to purge logs'); }
  };

  return (
    <div className="min-h-screen px-4 md:px-8 py-8 max-w-2xl mx-auto">

      {/* Header */}
      <div className="mb-10">
        <div className="flex items-center gap-4 mb-2">
          <div className="w-10 h-10 border border-electricCyan hexagon-clip flex items-center justify-center text-base">⚙️</div>
          <h1 className="text-xl font-black uppercase tracking-tighter">Encrypted Settings</h1>
        </div>
        <p className="text-[10px] font-mono text-white/25 uppercase tracking-widest">
          SYSTEM CONFIGURATION · OPERATOR LEVEL CLEARANCE REQUIRED
        </p>
      </div>

      {/* ── Defense Protocol ── */}
      <div className="mb-8">
        <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-electricCyan mb-4">
          ▹ DEFENSE PROTOCOL
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          {LEVELS.map(lvl => {
            const active = protectionLevel === lvl.id;
            return (
              <button
                key={lvl.id}
                onClick={() => setProtectionLevel(lvl.id)}
                className="text-left p-5 rounded-xl transition-all"
                style={{
                  background: active ? 'rgba(0,242,255,0.06)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${active ? 'rgba(0,242,255,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  boxShadow: active ? '0 0 20px rgba(0,242,255,0.1)' : 'none',
                }}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xl">{lvl.icon}</span>
                  {active && (
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ background: '#00f2ff', boxShadow: '0 0 6px #00f2ff' }}
                    />
                  )}
                </div>
                <p className={`text-sm font-bold mb-1 ${active ? 'text-electricCyan' : 'text-white/60'}`}>
                  {lvl.label}
                </p>
                <p className="text-[9px] font-mono text-white/25 uppercase tracking-widest mb-3">{lvl.code}</p>
                <p className="text-xs text-white/40 leading-relaxed">{lvl.desc}</p>
              </button>
            );
          })}
        </div>
        <button
          onClick={handleSaveAll}
          className="text-[11px] font-mono uppercase tracking-[0.2em] px-6 py-2.5 rounded-lg transition-all"
          style={{
            background: 'rgba(0,242,255,0.1)',
            border: '1px solid rgba(0,242,255,0.4)',
            color: '#00f2ff',
            boxShadow: '0 0 12px rgba(0,242,255,0.1)',
          }}
        >
          SAVE PROTOCOL & SETTINGS
        </button>
      </div>

      {/* ── Safety Circle ── */}
      <div className="mb-8">
        <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-electricCyan mb-4">
          ▹ SAFETY CIRCLE
        </p>
        <div
          className="rounded-xl p-5 flex items-center justify-between gap-4 transition-all"
          style={{
            background: sc.enabled ? 'rgba(0,242,255,0.04)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${sc.enabled ? 'rgba(0,242,255,0.2)' : 'rgba(255,255,255,0.08)'}`,
          }}
        >
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0"
              style={{
                background: sc.enabled ? 'rgba(0,242,255,0.1)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${sc.enabled ? 'rgba(0,242,255,0.25)' : 'rgba(255,255,255,0.08)'}`,
              }}
            >
              🛡
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-bold text-white">Safety Circle</p>
                <span
                  className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full"
                  style={{
                    background: sc.enabled ? 'rgba(0,242,255,0.12)' : 'rgba(255,255,255,0.05)',
                    color: sc.enabled ? '#00f2ff' : 'rgba(255,255,255,0.3)',
                    border: `1px solid ${sc.enabled ? 'rgba(0,242,255,0.2)' : 'rgba(255,255,255,0.08)'}`,
                  }}
                >
                  {sc.enabled ? '● ACTIVE' : '○ OFF'}
                </span>
              </div>
              <p className="text-[10px] font-mono text-white/30 mt-0.5">
                {sc.guardians.length === 0
                  ? 'No guardians configured'
                  : `${sc.guardians.length} guardian${sc.guardians.length > 1 ? 's' : ''} · ≥${sc.threshold}% threshold`}
              </p>
            </div>
          </div>
          <button
            id="open-safety-circle"
            onClick={() => onNavigate?.('safetycircle')}
            className="text-[10px] font-mono uppercase tracking-[0.2em] px-4 py-2 rounded-lg shrink-0 transition-all"
            style={{
              background: 'rgba(0,242,255,0.06)',
              border: '1px solid rgba(0,242,255,0.25)',
              color: '#00f2ff',
            }}
          >
            Configure →
          </button>
        </div>
      </div>

      {/* ── System Manifest ── */}
      <div className="glass-panel rounded-xl p-5 mb-8">
        <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/30 mb-4">▹ SYSTEM MANIFEST</p>
        <div className="space-y-2">
          {[
            ['VERSION',    'ScamDefy'],
            ['CODENAME',   'SENTINEL'],
            ['STACK',      'FastAPI · React · Gemini AI'],
            ['BUILD_TYPE', 'PRODUCTION'],
            ['TAGLINE',    'AI-powered scam protection for URLs, calls, and messages.'],
          ].map(([key, val]) => (
            <div key={key} className="flex gap-4 text-xs font-mono">
              <span className="text-white/25 uppercase tracking-widest w-24 shrink-0">{key}</span>
              <span className="text-white/50">{val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Critical Operations ── */}
      <div
        className="rounded-xl p-5"
        style={{
          background: 'rgba(255,0,229,0.03)',
          border: '1px solid rgba(255,0,229,0.2)',
        }}
      >
        <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-electricMagenta mb-4">▹ CRITICAL OPERATIONS</p>
        <p className="text-xs text-white/30 font-mono leading-relaxed mb-5">
          WARNING: THE FOLLOWING ACTIONS ARE IRREVERSIBLE.<br />
          OPERATOR CONFIRMATION REQUIRED BEFORE EXECUTION.
        </p>

        <button
          onClick={handleClearHistory}
          className="w-full py-3 rounded-lg text-[11px] font-mono uppercase tracking-[0.2em] transition-all"
          style={{
            background: clearConfirm ? 'rgba(255,0,229,0.2)' : 'rgba(255,0,229,0.06)',
            border: `1px solid ${clearConfirm ? 'rgba(255,0,229,0.7)' : 'rgba(255,0,229,0.3)'}`,
            color: '#ff00e5',
            boxShadow: clearConfirm ? '0 0 20px rgba(255,0,229,0.2)' : 'none',
          }}
        >
          {clearConfirm ? '⚠ CONFIRM — PURGE ALL THREAT LOGS' : '🗑 PURGE ALL THREAT LOGS'}
        </button>

        {clearConfirm && (
          <button
            onClick={() => setClearConfirm(false)}
            className="w-full mt-3 py-2.5 rounded-lg text-[10px] font-mono uppercase tracking-widest text-white/30 border border-white/10 hover:border-white/20 transition-all"
          >
            ABORT OPERATION
          </button>
        )}
      </div>
    </div>
  );
}
