import { useState } from 'react';
import type { ScanResult } from '../../types';
import { RiskBadge } from '../ui/RiskBadge';
import { ScoreGauge } from '../ui/ScoreGauge';
import { apiClient } from '../../api/client';

interface Props { result: ScanResult }

const VERDICT_COLOR: Record<string, string> = {
  SAFE:    '#00f2ff',
  CAUTION: '#f59e0b',
  DANGER:  '#f97316',
  BLOCKED: '#ef4444',
};


export function ScanResultCard({ result }: Props) {
  const color = VERDICT_COLOR[result.verdict] ?? '#00f2ff';
  const isScam = result.verdict === 'BLOCKED' || result.verdict === 'DANGER';

  // Community report state
  const [communityReports, setCommunityReports] = useState(
    result.community_reports ?? { scam_reports: 0, false_positive_reports: 0, total_reports: 0 }
  );
  const [reportStatus, setReportStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [reportedType, setReportedType] = useState<'scam' | 'false_positive' | null>(null);

  const handleReport = async (type: 'scam' | 'false_positive') => {
    if (reportStatus !== 'idle') return;
    setReportStatus('loading');
    try {
      const resp = await apiClient.post('/api/report', {
        url: result.url, reason: type, notes: '',
      });
      setCommunityReports(resp.data.community_reports);
      setReportedType(type);
      setReportStatus('done');
    } catch {
      setReportStatus('idle');
    }
  };

  const scamCount = communityReports.scam_reports;
  const fpCount   = communityReports.false_positive_reports;

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

      {/* Community Reports Section */}
      <div
        className="rounded-xl p-4 mb-5"
        style={{
          background: scamCount > 0 ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.03)',
          border: scamCount > 0 ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-[9px] font-mono uppercase tracking-widest text-white/30">Community Intel</p>
          {scamCount > 0 && (
            <span
              className="text-[9px] font-mono px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
            >
              ⚠ {scamCount} USER{scamCount !== 1 ? 'S' : ''} REPORTED SCAM
            </span>
          )}
          {scamCount === 0 && fpCount === 0 && (
            <span className="text-[9px] font-mono text-white/20">No reports yet</span>
          )}
        </div>

        {/* Report counts bar */}
        {(scamCount > 0 || fpCount > 0) && (
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${(scamCount / Math.max(scamCount + fpCount, 1)) * 100}%`,
                  background: 'linear-gradient(90deg, #ef4444, #f97316)',
                }}
              />
            </div>
            <span className="text-[9px] font-mono text-white/30 shrink-0">
              {scamCount} scam · {fpCount} safe
            </span>
          </div>
        )}

        {/* Report Buttons */}
        <div className="flex gap-2">
          {reportStatus === 'done' ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono"
                style={{ color: reportedType === 'scam' ? '#ef4444' : '#22c55e' }}>
                ✓ {reportedType === 'scam' ? 'Reported as scam' : 'Reported as safe'} — thank you!
              </span>
            </div>
          ) : (
            <>
              {/* Show "Report as scam" only if currently SAFE/CAUTION, or always */}
              <button
                id={`btn-report-scam-${result.id}`}
                onClick={() => handleReport('scam')}
                disabled={reportStatus === 'loading'}
                className="text-[10px] font-mono px-3 py-1.5 rounded-lg transition-all duration-200 disabled:opacity-40"
                style={{
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.25)',
                  color: '#ef4444',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.2)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.1)')}
              >
                {reportStatus === 'loading' ? '…' : '🚨 Report as Scam'}
              </button>

              {/* "Report false positive" only shown if verdict is DANGER/BLOCKED */}
              {isScam && (
                <button
                  id={`btn-report-fp-${result.id}`}
                  onClick={() => handleReport('false_positive')}
                  disabled={reportStatus === 'loading'}
                  className="text-[10px] font-mono px-3 py-1.5 rounded-lg transition-all duration-200 disabled:opacity-40"
                  style={{
                    background: 'rgba(34,197,94,0.08)',
                    border: '1px solid rgba(34,197,94,0.2)',
                    color: '#86efac',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(34,197,94,0.18)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(34,197,94,0.08)')}
                >
                  ✓ Report as Safe
                </button>
              )}
            </>
          )}
        </div>
      </div>

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
