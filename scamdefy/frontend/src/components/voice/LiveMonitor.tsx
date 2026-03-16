import { useEffect, useRef, useState } from 'react';
import { useLiveMonitor } from '../../hooks/useLiveMonitor';
import { LiveWaveform } from './LiveWaveform';
import type { LiveVerdictEntry } from '../../types';

const CHUNK_SECS = 6;

function verdictColor(v: string) {
  if (v === 'SYNTHETIC') return '#e879f9';
  if (v === 'REAL')      return '#4ade80';
  return '#f59e0b'; // UNCERTAIN / UNKNOWN
}
function verdictIcon(v: string) {
  if (v === 'SYNTHETIC') return '🤖';
  if (v === 'REAL')      return '✅';
  return '❓';
}
function verdictLabel(v: string) {
  if (v === 'SYNTHETIC') return 'AI VOICE DETECTED';
  if (v === 'REAL')      return 'AUTHENTIC';
  return 'INCONCLUSIVE';
}

function VerdictRow({ entry }: { entry: LiveVerdictEntry }) {
  const color = verdictColor(entry.verdict);
  const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div
      className="flex items-start gap-3 rounded-lg px-4 py-3 slide-up"
      style={{ background: `${color}08`, border: `1px solid ${color}20` }}
    >
      <span className="text-lg shrink-0 mt-0.5">{verdictIcon(entry.verdict)}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p
            className="text-[10px] font-black uppercase tracking-widest"
            style={{ color, textShadow: `0 0 8px ${color}` }}
          >
            {verdictLabel(entry.verdict)}
          </p>
          <span className="text-[9px] font-mono text-white/30 shrink-0">{time}</span>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <div className="flex-1 h-1 rounded-full bg-white/5">
            <div
              className="h-1 rounded-full transition-all duration-700"
              style={{ width: `${entry.confidence_pct}%`, background: color, boxShadow: `0 0 6px ${color}` }}
            />
          </div>
          <span className="text-[9px] font-mono tabular-nums shrink-0" style={{ color }}>
            {entry.confidence_pct.toFixed(1)}%
          </span>
        </div>
        {entry.reason && (
          <p className="text-[9px] font-mono text-white/30 leading-relaxed mt-1 truncate" title={entry.reason}>
            {entry.reason}
          </p>
        )}
      </div>
      <span className="text-[9px] font-mono text-white/15 shrink-0 mt-0.5">#{entry.chunk_number}</span>
    </div>
  );
}

export function LiveMonitor() {
  const { liveState, verdicts, errorMsg, stream, isAnalyzing, start, stop, clearVerdicts, chunkDurationMs } = useLiveMonitor();
  const [countdown, setCountdown] = useState(chunkDurationMs / 1000);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const isRecording = liveState === 'recording';

  // Countdown timer — resets every chunk
  useEffect(() => {
    if (!isRecording) {
      setCountdown(chunkDurationMs / 1000);
      if (countdownRef.current) clearInterval(countdownRef.current);
      return;
    }
    setCountdown(chunkDurationMs / 1000);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) return chunkDurationMs / 1000;
        return prev - 1;
      });
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [isRecording, chunkDurationMs]);

  // Synthetic count
  const syntheticCount = verdicts.filter(v => v.verdict === 'SYNTHETIC').length;

  return (
    <div className="flex flex-col gap-6">

      {/* Status banner */}
      <div
        className="glass-panel rounded-2xl p-6 flex flex-col items-center gap-5"
        style={{
          borderColor: isRecording ? 'rgba(232,121,249,0.3)' : 'rgba(0,242,255,0.15)',
          border: `1px solid ${isRecording ? 'rgba(232,121,249,0.3)' : 'rgba(0,242,255,0.15)'}`,
        }}
      >
        {/* Mic button */}
        <div className="relative">
          {isRecording && (
            <>
              <div className="absolute inset-0 rounded-full border border-electricMagenta/40 animate-ping" />
              <div className="absolute -inset-3 rounded-full border border-electricMagenta/15 animate-pulse" />
            </>
          )}
          <button
            onClick={isRecording ? stop : start}
            disabled={liveState === 'requesting' || liveState === 'stopping'}
            className="relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: isRecording
                ? 'linear-gradient(135deg, rgba(232,121,249,0.25), rgba(232,121,249,0.08))'
                : 'linear-gradient(135deg, rgba(0,242,255,0.15), rgba(0,242,255,0.05))',
              border: `2px solid ${isRecording ? 'rgba(232,121,249,0.6)' : 'rgba(0,242,255,0.4)'}`,
              boxShadow: isRecording ? '0 0 24px rgba(232,121,249,0.3)' : '0 0 12px rgba(0,242,255,0.15)',
            }}
          >
            {liveState === 'requesting' || liveState === 'stopping' ? (
              <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            ) : isRecording ? (
              // Stop icon
              <div className="w-6 h-6 rounded-sm" style={{ background: '#e879f9' }} />
            ) : (
              // Mic icon
              <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"
                style={{ color: '#00f2ff' }}>
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>

        {/* State label */}
        <div className="text-center">
          <p
            className="text-[10px] font-mono uppercase tracking-[0.3em]"
            style={{ color: isRecording ? '#e879f9' : liveState === 'error' ? '#ef4444' : '#00f2ff' }}
          >
            {liveState === 'idle'       && 'READY · CLICK TO START'}
            {liveState === 'requesting' && 'REQUESTING MIC ACCESS...'}
            {liveState === 'recording'  && 'LIVE · MONITORING AUDIO'}
            {liveState === 'stopping'   && 'STOPPING...'}
            {liveState === 'error'      && 'ERROR'}
          </p>
          {errorMsg && (
            <p className="text-[10px] font-mono text-red-400/80 mt-1 max-w-xs text-center leading-relaxed">{errorMsg}</p>
          )}
        </div>

        {/* Waveform */}
        <div className="w-full">
          <LiveWaveform stream={stream} active={isRecording} />
        </div>

        {/* Stats row */}
        {isRecording && (
          <div className="w-full flex items-center justify-between text-[10px] font-mono">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-electricMagenta animate-pulse" style={{ boxShadow: '0 0 6px #e879f9' }} />
              <span className="text-white/40 uppercase tracking-widest">Next scan in</span>
              <span className="text-electricMagenta">{countdown}s</span>
            </div>
            <div className="flex items-center gap-3">
              {isAnalyzing && (
                <span className="text-electricCyan/70 animate-pulse uppercase tracking-widest">ANALYZING...</span>
              )}
              {syntheticCount > 0 && (
                <span className="text-electricMagenta font-bold">
                  {syntheticCount} SYNTHETIC CHUNK{syntheticCount > 1 ? 'S' : ''} DETECTED
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Verdict log */}
      <div className="glass-panel rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-white/30">Live Detection Log</p>
            <p className="text-[10px] font-mono text-white/20 mt-0.5">
              {verdicts.length === 0 ? 'No chunks analyzed yet' : `${verdicts.length} chunk${verdicts.length > 1 ? 's' : ''} analyzed`}
            </p>
          </div>
          {verdicts.length > 0 && (
            <button
              onClick={clearVerdicts}
              className="text-[9px] font-mono uppercase tracking-widest text-white/20 hover:text-white/50 transition-colors px-3 py-1 rounded border border-white/10 hover:border-white/20"
            >
              CLEAR
            </button>
          )}
        </div>

        <div ref={logRef} className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1 scrollbar-thin">
          {verdicts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="w-12 h-12 hexagon-clip flex items-center justify-center"
                style={{ background: 'rgba(0,242,255,0.05)', border: '1px solid rgba(0,242,255,0.1)' }}>
                <span className="text-xl opacity-40">📡</span>
              </div>
              <p className="text-[10px] font-mono text-white/20 uppercase tracking-widest">
                Waiting for voice chunks...
              </p>
              <p className="text-[9px] font-mono text-white/10">
                {isRecording ? `Next analysis in ${countdown}s` : 'Start monitoring above'}
              </p>
            </div>
          ) : (
            verdicts.map(entry => <VerdictRow key={entry.id} entry={entry} />)
          )}
        </div>
      </div>

      {/* Info box */}
      <div className="glass-panel rounded-xl px-5 py-4 grid grid-cols-3 gap-4">
        {[
          { label: 'Chunk Size', value: `${CHUNK_SECS}s`, desc: 'Audio analyzed per chunk' },
          { label: 'Model', value: 'Wav2Vec2', desc: 'Pre-trained deepfake detector' },
          { label: 'Latency', value: '~5-8s', desc: 'Time per verdict' },
        ].map((s, i) => (
          <div key={i} className="text-center">
            <p className="text-sm font-black uppercase tracking-tight" style={{ color: '#00f2ff' }}>{s.value}</p>
            <p className="text-[9px] font-mono uppercase tracking-widest text-white/30 mt-0.5">{s.label}</p>
            <p className="text-[9px] font-mono text-white/15 mt-0.5 leading-relaxed">{s.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
