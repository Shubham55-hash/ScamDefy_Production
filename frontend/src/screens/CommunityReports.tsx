import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import type { CommunityReport } from '../types';

export function CommunityReports() {
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const [reportsRes, overridesRes] = await Promise.all([
        apiClient.get<CommunityReport[]>('/api/reports/all'),
        apiClient.get<Record<string, string>>('/api/overrides/all')
      ]);
      setReports(reportsRes.data);
      setOverrides(overridesRes.data);
    } catch (err) {
      console.error("Failed to fetch dev data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOverride = async (url: string, verdict: 'SAFE' | 'BLOCKED' | 'CLEAR') => {
    setActionLoading(`${url}-${verdict}`);
    try {
      await apiClient.post('/api/overrides', { url, verdict });
      await fetchData(); // Refresh state
    } catch (err) {
      console.error("Override failed", err);
    } finally {
      setActionLoading(null);
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
                  className="px-4 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[10px] font-mono uppercase hover:bg-white/10 transition-all text-white/50 hover:text-white"
                >
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
            const currentOverride = overrides[report.url.replace('www.', '').toLowerCase().replace(/\/$/, '')];
            
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
                        disabled={!!actionLoading}
                        className={`px-3 py-1.5 rounded-md text-[9px] font-mono uppercase tracking-widest transition-all ${
                          currentOverride === 'BLOCKED' 
                            ? 'bg-red-500 text-white shadow-[0_0_10px_rgba(239,68,68,0.5)]' 
                            : 'hover:bg-red-500/20 text-white/40 hover:text-red-400'
                        }`}
                      >
                        Force Block
                      </button>
                      <button
                        onClick={() => handleOverride(report.url, 'SAFE')}
                        disabled={!!actionLoading}
                        className={`px-3 py-1.5 rounded-md text-[9px] font-mono uppercase tracking-widest transition-all ${
                          currentOverride === 'SAFE' 
                            ? 'bg-green-500 text-white shadow-[0_0_10px_rgba(34,197,94,0.5)]' 
                            : 'hover:bg-green-500/20 text-white/40 hover:text-green-400'
                        }`}
                      >
                        Force Safe
                      </button>
                      {currentOverride && (
                        <button
                          onClick={() => handleOverride(report.url, 'CLEAR')}
                          disabled={!!actionLoading}
                          className="px-3 py-1.5 rounded-md text-[9px] font-mono uppercase tracking-widest bg-white/10 text-white/60 hover:bg-white/20"
                        >
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
