import type { ScanResult } from '../../types';
import { RiskBadge } from '../ui/RiskBadge';
import { ScoreGauge } from '../ui/ScoreGauge';

interface Props { result: ScanResult }

const VERDICT_COLOR: Record<string, string> = {
  SAFE:    '#00f2ff',
  CAUTION: '#f59e0b',
  DANGER:  '#f97316',
  BLOCKED: '#ef4444',
};

export function ScanResultCard({ result }: Props) {
  const color = VERDICT_COLOR[result.verdict] ?? '#00f2ff';

  return (
    <div
      className="glass-panel rounded-2xl p-6 slide-up"
      style={{ borderColor: `${color}30`, boxShadow: `0 0 30px ${color}10` }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <RiskBadge level={result.verdict} size="md" />
            <span className="text-[10px] font-mono text-white/40 tracking-widest uppercase">
              {result.risk_level} THREAT
            </span>
          </div>
          <p className="text-xs font-mono text-white/40 truncate">{result.url}</p>
          {result.final_url && result.final_url !== result.url && (
            <p className="text-[10px] font-mono text-electricMagenta/60 truncate mt-1">
              ↳ REDIRECT: {result.final_url}
            </p>
          )}
        </div>
        <ScoreGauge score={result.score} size={90} />
      </div>

      {/* Scam type + scan time + domain age */}
      <div className={`grid ${result.domain_age ? 'grid-cols-3' : 'grid-cols-2'} gap-3 mb-5`}>
        <div className="glass-panel rounded-lg p-3">
          <p className="text-[9px] font-mono text-white/30 uppercase tracking-widest mb-1">Threat Type</p>
          <p className="text-xs font-mono text-white/80">{result.scam_type.replace(/_/g,' ')}</p>
        </div>
        <div className="glass-panel rounded-lg p-3">
          <p className="text-[9px] font-mono text-white/30 uppercase tracking-widest mb-1">Scan Time</p>
          <p className="text-xs font-mono text-electricCyan">{(result.scan_time_ms + 1000).toFixed(0)} ms</p>
        </div>
        {result.domain_age && (
          <div className="glass-panel rounded-lg p-3 border-electricCyan/20 bg-electricCyan/5">
            <p className="text-[9px] font-mono text-electricCyan/60 uppercase tracking-widest mb-1">Domain Age</p>
            <p className="text-xs font-mono text-white/80">
              {result.domain_age.age_days !== null ? (
                <>{result.domain_age.age_days} <span className="text-[8px] text-white/30">DAYS</span></>
              ) : (
                <span className="text-white/20">UNKNOWN</span>
              )}
            </p>
          </div>
        )}
      </div>

      {/* AI explanation */}
      {result.explanation && (
        <div className="border-l-2 border-electricCyan pl-4 mb-5">
          <p className="text-[9px] font-mono uppercase tracking-widest text-electricCyan mb-1">Neural Analysis</p>
          <p className="text-xs text-white/60 leading-relaxed">{result.explanation}</p>
        </div>
      )}

      {/* Signals */}
      {result.signals?.length > 0 && (
        <div>
          <p className="text-[9px] font-mono uppercase tracking-widest text-white/30 mb-2">Signal Triggers</p>
          <div className="flex flex-wrap gap-2">
            {result.signals.map((s, i) => (
              <span key={i} className="text-[10px] font-mono border border-white/10 rounded px-2 py-0.5 text-white/50">
                {typeof s === 'string' ? s : s.name} {typeof s !== 'string' && s.points ? `+${s.points}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
