
import type { VoiceResult as VoiceResultType } from '../../types';

interface Props { result: VoiceResultType }

export function VoiceResult({ result }: Props) {
  const isSynthetic = result.verdict === 'SYNTHETIC';
  const isUnknown = result.verdict === 'UNKNOWN' || result.verdict === 'UNCERTAIN';
  const color = isSynthetic ? '#e879f9' : isUnknown ? '#f59e0b' : '#4ade80';
  const label = isSynthetic ? 'AI VOICE DETECTED' : isUnknown ? 'INCONCLUSIVE' : 'AUTHENTIC VOICE CONFIRMED';
  const glow = isSynthetic ? 'glow-red' : isUnknown ? 'glow-orange' : 'glow-cyan';

  return (
    <div
      className={`glass-panel rounded-2xl p-6 slide-up ${glow} flex flex-col`}
      style={{ borderColor: `${color}30`, border: `1px solid ${color}30` }}
    >
      {/* Verdict */}
      <div className="flex items-center gap-4 mb-5">
        <div
          className="w-16 h-16 hexagon-clip flex items-center justify-center shrink-0"
          style={{ background: `${color}15`, border: `1px solid ${color}40` }}
        >
          <span className="text-2xl">{isSynthetic ? '🤖' : isUnknown ? '❓' : '✅'}</span>
        </div>
        <div>
          <p className="text-[9px] font-mono uppercase tracking-[0.3em] opacity-50 mb-1">Verdict</p>
          <p
            className="text-xl font-black uppercase tracking-tighter leading-none"
            style={{ color, textShadow: `0 0 12px ${color}` }}
          >
            {label}
          </p>
        </div>
      </div>

      {/* Confidence */}
      <div className="mb-4">
        <div className="flex justify-between text-[10px] font-mono mb-2">
          <span className="text-white/40 uppercase tracking-widest">Confidence</span>
          <span style={{ color }}>{result.confidence_pct?.toFixed(1)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/5">
          <div
            className="h-1.5 rounded-full transition-all duration-700"
            style={{
              width: `${result.confidence_pct}%`,
              background: color,
              boxShadow: `0 0 8px ${color}`,
            }}
          />
        </div>
      </div>

      {/* Reason — shown when synthetic or unknown */}
      {result.reason && (isSynthetic || isUnknown) && (
        <div
          className="mb-4 rounded-lg px-4 py-3"
          style={{ background: `${color}08`, border: `1px solid ${color}20` }}
        >
          <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-white/30 mb-1">Detection Reason</p>
          <p className="text-xs font-mono leading-relaxed" style={{ color: `${color}cc` }}>
            {result.reason}
          </p>
        </div>
      )}

      {/* Transcript */}
      {result.transcript && (
        <div
          className="mb-4 rounded-lg px-4 py-3"
          style={{ background: `rgba(255,255,255,0.02)`, border: `1px solid rgba(255,255,255,0.1)` }}
        >
          <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-white/30 mb-1">Captured Transcript</p>
          <p className="text-xs font-mono leading-relaxed text-white/70 italic">
            "{result.transcript}"
          </p>
        </div>
      )}

      {/* Model status */}
      <div className="flex items-center justify-between mt-auto pt-4 border-t border-white/5">
        <div className="flex items-center gap-2">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: result.model_loaded ? '#00f2ff' : '#f59e0b', boxShadow: `0 0 4px ${result.model_loaded ? '#00f2ff' : '#f59e0b'}` }}
          />
          <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest">
            {result.model_loaded ? 'PRETRAINED_MODEL_ACTIVE' : 'HEURISTIC_MODE'}
          </p>
        </div>
        <p className="text-[9px] font-mono text-white/20 uppercase">SENTINEL_V4</p>
      </div>
    </div>
  );
}
