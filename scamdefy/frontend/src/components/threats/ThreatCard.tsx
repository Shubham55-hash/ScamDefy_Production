
import type { ThreatEntry } from '../../types';
import { RiskBadge } from '../ui/RiskBadge';
import { ThreatBreakdown } from '../scanner/ThreatBreakdown';

interface Props { threat: ThreatEntry }

export function ThreatCard({ threat }: Props) {
  const ts = new Date(threat.timestamp);
  const timeStr = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = ts.toLocaleDateString([], { month: 'short', day: 'numeric' });

  const scoreColor =
    threat.score >= 80 ? '#ef4444' :
    threat.score >= 60 ? '#f97316' :
    threat.score >= 30 ? '#f59e0b' : '#00f2ff';

  return (
    <div className="glass-panel rounded-xl p-4 flex flex-col hover:border-white/20 transition-all">
      <div className="flex items-center gap-4">
      {/* Score */}
      <div
        className="shrink-0 w-12 h-12 rounded-lg flex flex-col items-center justify-center"
        style={{ background: `${scoreColor}10`, border: `1px solid ${scoreColor}30` }}
      >
        <span className="text-lg font-black leading-none" style={{ color: scoreColor, textShadow: `0 0 8px ${scoreColor}` }}>
          {Math.round(threat.score)}
        </span>
        <span className="text-[8px] font-mono text-white/30 tracking-wider">RISK</span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <RiskBadge level={threat.risk_level} />
          {threat.blocked && (
            <span className="text-[9px] font-mono text-electricMagenta border border-electricMagenta/30 rounded px-1.5 py-0.5 tracking-widest">
              BLOCKED
            </span>
          )}
        </div>
        <p className="text-xs font-mono text-white/60 truncate">{threat.url}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-[10px] font-mono text-white/30 uppercase">{threat.scam_type.replace(/_/g, ' ')}</p>
          {threat.domain_age && threat.domain_age.age_days !== null && (
            <>
              <span className="text-white/10">•</span>
              <p className="text-[10px] font-mono text-electricCyan/60 uppercase">
                Age: {threat.domain_age.age_days}d
              </p>
            </>
          )}
        </div>
      </div>

      {/* Timestamp */}
      <div className="shrink-0 text-right">
        <p className="text-[10px] font-mono text-white/30">{dateStr}</p>
        <p className="text-[10px] font-mono text-electricCyan/50">{timeStr}</p>
      </div>
      </div>

      {/* Breakdown */}
      {threat.breakdown && (
        <div className="mt-4 border-t border-white/5 pt-4">
          <ThreatBreakdown breakdown={threat.breakdown} noContainer />
        </div>
      )}
    </div>
  );
}
