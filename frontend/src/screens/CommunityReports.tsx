import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../api/client';
import type { CommunityReport } from '../types';

/** Mirror the backend normalization: strip scheme, www., trailing slash */
function normalizeUrl(raw: string): string {
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    const p = new URL(withScheme);
    return (p.hostname + p.pathname)
      .replace(/^www\./, '')
      .replace(/\/$/, '')
      .toLowerCase();
  } catch {
    return raw.replace(/^www\./, '').replace(/\/$/, '').toLowerCase();
  }
}

export function CommunityReports() {
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  // Tracks the "url-verdict" keys that are syncing to backend
  const [syncingKeys, setSyncingKeys] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  // Write sequencing: every directive gets a monotonically increasing id.
  // Refreshes started before (or during) a newer write must not replace the
  // optimistic overrides map, and only the latest write per URL may roll back.
  const writeSeqRef = useRef(0);
  const pendingWritesRef = useRef(0);
  const latestSeqByUrlRef = useRef<Record<string, number>>({});

  const fetchData = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    const seqAtStart = writeSeqRef.current;
    const hadPendingWrites = pendingWritesRef.current > 0;
    try {
      const [reportsRes, overridesRes] = await Promise.all([
        apiClient.get<CommunityReport[]>('/api/reports/all'),
        apiClient.get<Record<string, string>>('/api/overrides/all')
      ]);
      setReports(reportsRes.data);
      const isStale = hadPendingWrites
        || pendingWritesRef.current > 0
        || writeSeqRef.current !== seqAtStart;
      if (!isStale) setOverrides(overridesRes.data);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch dev data", err);
      if (isInitial) setError("Failed to load data. Please refresh.");
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  const handleOverride = async (url: string, verdict: 'SAFE' | 'BLOCKED' | 'CLEAR') => {
    const key = `${url}-${verdict}`;
    setSyncingKeys(prev => new Set(prev).add(key));

    // ── OPTIMISTIC UPDATE ────────────────────────────────────────
    // Compute the normalized key the backend uses, so we update the
    // right entry in our local `overrides` map immediately.
    const normalizedKey = normalizeUrl(url);
    const previous = overrides[normalizedKey];
    const seq = ++writeSeqRef.current;
    latestSeqByUrlRef.current[normalizedKey] = seq;
    pendingWritesRef.current += 1;

    setOverrides(prev => {
      const next = { ...prev };
      if (verdict === 'CLEAR') {
        delete next[normalizedKey];
      } else {
        next[normalizedKey] = verdict;
      }
      return next;
    });
    // ────────────────────────────────────────────────────────────
    try {
      await apiClient.post('/api/overrides', { url, verdict });
    } catch (err) {
      console.error("Override failed", err);
      // ── ROLLBACK (only if no newer directive targeted this URL) ──
      if (latestSeqByUrlRef.current[normalizedKey] === seq) {
        setOverrides(prev => {
          const next = { ...prev };
          if (previous === undefined) {
            delete next[normalizedKey];
          } else {
            next[normalizedKey] = previous;
          }
          return next;
        });
        setError(`Failed to apply directive to ${url}. The change has been reverted.`);
      }
    } finally {
      pendingWritesRef.current -= 1;
      setSyncingKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      // Background sync once all directives have settled, no global loader
      if (pendingWritesRef.current === 0) fetchData(false);
    }
  };

  return (
    <div className="min-h-screen pt-16 pb-20 px-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 bg-electricCyan rounded-full animate-pulse shadow-[0_0_8px_#00f2ff]" />
            <span className="text-[10px] font-mono text-electricCyan uppercase tracking-[0.3em]">Developer Portal</span>
          </div>
          <h1 className="text-4xl font-black italic tracking-tighter uppercase text-white">
            Community <span className="text-electricCyan">Intel</span>
          </h1>
          <p className="text-white/40 text-sm mt-2 font-mono">Reviewing user-submitted threat reports & managing global overrides.</p>
        </div>

        <div className="flex gap-4">
          <div className="glass-panel px-6 py-3 rounded-xl border-white/5 bg-white/[0.02]">
            <p className="text-[9px] font-mono text-white/30 uppercase tracking-widest mb-1">Reports</p>
            <p className="text-2xl font-black text-electricCyan font-mono">{reports.length}</p>
          </div>
          <div className="glass-panel px-6 py-3 rounded-xl border-white/5 bg-white/[0.02]">
            <p className="text-[9px] font-mono text-white/30 uppercase tracking-widest mb-1">Active Overrides</p>
            <p className="text-2xl font-black text-electricMagenta font-mono">{Object.keys(overrides).length}</p>
          </div>
        </div>
      </div>

      {error && (
          <div className="mb-6 p-4 glass-panel rounded-xl border border-red-500/20 bg-red-500/10 flex items-center justify-between">
              <span className="text-xs font-mono text-red-400">{error}</span>
              <button
                onClick={() => setError(null)}
                className="text-white/50 hover:text-white"
              >✕</button>
          </div>
      )}

      {/* Active Overrides Section - Dedicated to full management */}
      {Object.keys(overrides).length > 0 && (
        <div className="mb-12">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[10px] font-mono text-electricMagenta uppercase tracking-[0.3em]">Active Directive Control</span>
            <div className="h-px bg-electricMagenta/20 flex-grow" />
          </div>
          <div className="grid gap-3">
            {Object.entries(overrides).map(([url, verdict]) => (
              <div key={url} className="glass-panel rounded-xl p-4 border-electricMagenta/20 bg-electricMagenta/5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className={`text-[9px] font-black px-2 py-1 rounded bg-white text-charcoal uppercase`}>
                    {verdict}
                  </span>
                  <p className="text-sm font-mono font-bold text-white/80">{url}</p>
                </div>
                <button
                  onClick={() => handleOverride(url, 'CLEAR')}
                  disabled={syncingKeys.has(`${url}-CLEAR`)}
                  className="px-4 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[10px] font-mono uppercase hover:bg-white/10 transition-all text-white/50 hover:text-white disabled:opacity-50 flex items-center gap-2"
                >
                  {syncingKeys.has(`${url}-CLEAR`) && <div className="w-2.5 h-2.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />}
                  Clear Directive
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Community Reports Section */}
      <div className="flex items-center gap-2 mb-6">
        <span className="text-[10px] font-mono text-white/20 uppercase tracking-[0.3em]">User Feedback Reports</span>
        <div className="h-px bg-white/5 flex-grow" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-electricCyan"></div>
        </div>
      ) : reports.length === 0 ? (
        <div className="glass-panel rounded-2xl p-20 text-center border-dashed border-white/5">
          <p className="text-white/20 font-mono">0 REPORTS_IN_DATABASE // NO DATA FOUND</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {reports.map((report) => {
            const currentOverride = overrides[normalizeUrl(report.url)];

            return (
              <div
                key={report.id}
                className={`glass-panel rounded-xl p-5 border-white/5 transition-all group ${
                  currentOverride === 'BLOCKED' ? 'bg-red-500/5 border-red-500/20' :
                  currentOverride === 'SAFE' ? 'bg-green-500/5 border-green-500/20' :
                  'bg-[#0a0f1e]/40'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-1 flex-grow min-w-0">
                    <div className="flex items-center flex-wrap gap-3">
                      <span
                        className={`text-[9px] font-mono px-2 py-0.5 rounded border uppercase tracking-widest ${
                          report.type === 'scam'
                            ? 'text-ef4444 bg-ef4444/10 border-ef4444/30'
                            : 'text-22c55e bg-22c55e/10 border-22c55e/30'
                        }`}
                        style={{
                          color: report.type === 'scam' ? '#ef4444' : '#22c55e',
                          backgroundColor: report.type === 'scam' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                          borderColor: report.type === 'scam' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'
                        }}
                      >
                        {report.type === 'scam' ? 'USER_SCAM_REPORT' : 'USER_SAFE_REPORT'}
                      </span>

                      {currentOverride && (
                        <span className={`text-[9px] font-mono px-2 py-0.5 rounded bg-white text-charcoal font-black uppercase tracking-widest`}>
                          FORCED_{currentOverride}
                        </span>
                      )}

                      <span className="text-[10px] font-mono text-white/20">
                        {new Date(report.timestamp * 1000).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-white/90 font-mono tracking-tight break-all">
                      {report.url}
                    </p>
                    {report.reason && (
                      <p className="text-xs text-white/40 font-mono italic">"{report.reason}"</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Dev Controls */}
                    <div className="flex gap-1 p-1 bg-white/5 rounded-lg border border-white/5">
                      <button
                        onClick={() => handleOverride(report.url, 'BLOCKED')}
                        disabled={syncingKeys.has(`${report.url}-BLOCKED`)}
                        className={`px-3 py-1.5 rounded-md text-[9px] font-mono uppercase tracking-widest transition-all flex items-center gap-1.5 ${
                          currentOverride === 'BLOCKED'
                            ? 'bg-red-500 text-white shadow-[0_0_10px_rgba(239,68,68,0.5)]'
                            : 'hover:bg-red-500/20 text-white/40 hover:text-red-400'
                        } disabled:opacity-50`}
                      >
                        {syncingKeys.has(`${report.url}-BLOCKED`) && <div className="w-2.5 h-2.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />}
                        Force Block
                      </button>
                      <button
                        onClick={() => handleOverride(report.url, 'SAFE')}
                        disabled={syncingKeys.has(`${report.url}-SAFE`)}
                        className={`px-3 py-1.5 rounded-md text-[9px] font-mono uppercase tracking-widest transition-all flex items-center gap-1.5 ${
                          currentOverride === 'SAFE'
                            ? 'bg-green-500 text-white shadow-[0_0_10px_rgba(34,197,94,0.5)]'
                            : 'hover:bg-green-500/20 text-white/40 hover:text-green-400'
                        } disabled:opacity-50`}
                      >
                        {syncingKeys.has(`${report.url}-SAFE`) && <div className="w-2.5 h-2.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />}
                        Force Safe
                      </button>
                      {currentOverride && (
                        <button
                          onClick={() => handleOverride(report.url, 'CLEAR')}
                          disabled={syncingKeys.has(`${report.url}-CLEAR`)}
                          className="px-3 py-1.5 rounded-md text-[9px] font-mono uppercase tracking-widest bg-white/10 text-white/60 hover:bg-white/20 disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {syncingKeys.has(`${report.url}-CLEAR`) && <div className="w-2.5 h-2.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />}
                          Clear
                        </button>
                      )}
                    </div>

                    <a
                      href={`http://${report.url}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-3 rounded-lg bg-white/5 border border-white/5 text-[10px] font-mono uppercase tracking-widest hover:bg-electricCyan/10 hover:border-electricCyan/30 hover:text-electricCyan transition-all"
                    >
                      Verify ↑
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
