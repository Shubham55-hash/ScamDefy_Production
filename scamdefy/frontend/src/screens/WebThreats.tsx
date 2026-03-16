import { useState } from 'react';
import { useUrlScan } from '../hooks/useUrlScan';
import { useThreatHistory } from '../hooks/useThreatHistory';
import { UrlInput } from '../components/scanner/UrlInput';
import { ScanResultCard } from '../components/scanner/ScanResultCard';
import { ThreatBreakdown } from '../components/scanner/ThreatBreakdown';
import { ThreatCard } from '../components/threats/ThreatCard';
import { ThreatFilters } from '../components/threats/ThreatFilters';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { EmptyState } from '../components/ui/EmptyState';
import { SkeletonCard } from '../components/ui/SkeletonCard';

type Tab = 'scanner' | 'history';

function HudTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-[11px] font-mono tracking-[0.2em] uppercase px-5 py-2.5 rounded transition-all"
      style={{
        color: active ? '#0a0b0d' : 'rgba(255,255,255,0.3)',
        background: active ? '#00f2ff' : 'transparent',
        border: `1px solid ${active ? '#00f2ff' : 'rgba(255,255,255,0.1)'}`,
        boxShadow: active ? '0 0 16px rgba(0,242,255,0.4)' : 'none',
      }}
    >
      [ {label} ]
    </button>
  );
}

export function WebThreats() {
  const [tab, setTab] = useState<Tab>('scanner');
  const { result, loading, error, scan, reset } = useUrlScan();
  const { threats, loading: threatLoading, error: threatError, load, clear, activeFilter, applyFilter } = useThreatHistory();

  return (
    <div className="min-h-screen px-4 md:px-8 py-8 max-w-4xl mx-auto">

      {/* HUD tab bar */}
      <div className="flex gap-3 mb-8">
        <HudTab label="SCANNER"    active={tab === 'scanner'} onClick={() => setTab('scanner')} />
        <HudTab label="THREAT LOG" active={tab === 'history'} onClick={() => setTab('history')} />
        {threats.length > 0 && (
          <span className="ml-auto self-center text-[10px] font-mono text-electricCyan/60 tracking-widest">
            {threats.length} ENTRIES LOGGED
          </span>
        )}
      </div>

      {/* SCANNER TAB */}
      {tab === 'scanner' && (
        <div className="space-y-6">
          <UrlInput onScan={scan} loading={loading} />
          {error && <ErrorBanner error={error} />}
          {result && (
            <div className="space-y-4">
              <ScanResultCard result={result} />
              <ThreatBreakdown breakdown={result.breakdown} />
              <button
                onClick={reset}
                className="w-full text-[10px] font-mono uppercase tracking-[0.2em] border border-white/10 rounded-lg py-3 text-white/40 hover:border-electricCyan/30 hover:text-electricCyan/60 transition-all"
              >
                ← SCAN ANOTHER PAYLOAD
              </button>
            </div>
          )}

          {!result && !loading && !error && (
            <div className="py-12 text-center">
              <div className="w-24 h-24 border border-electricCyan/20 hexagon-clip flex items-center justify-center mx-auto mb-6 text-3xl opacity-30">
                🔍
              </div>
              <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/25">
                AWAITING PAYLOAD · ENTER URL TO SCAN
              </p>
            </div>
          )}
        </div>
      )}

      {/* THREAT LOG TAB */}
      {tab === 'history' && (
        <div>
          {/* Log header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-white/70">Encrypted Threat Log</h2>
              <p className="text-[10px] font-mono text-white/25 mt-0.5">READ-ONLY · SORTED BY TIMESTAMP</p>
            </div>
            {threats.length > 0 && (
              <button
                onClick={clear}
                className="text-[10px] font-mono uppercase tracking-[0.15em] px-4 py-2 rounded border border-electricMagenta/40 text-electricMagenta hover:bg-electricMagenta/10 transition-all"
                style={{ boxShadow: '0 0 12px rgba(255,0,229,0.1)' }}
              >
                PURGE LOGS
              </button>
            )}
          </div>

          {/* Filters */}
          <div className="mb-5">
            <ThreatFilters active={activeFilter} onChange={applyFilter} />
          </div>

          {/* Error */}
          {threatError && (
            <div className="mb-4">
              <ErrorBanner error={{ message: threatError, retryable: true }} onRetry={() => load()} />
            </div>
          )}

          {/* List */}
          {threatLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map(i => <SkeletonCard key={i} height={80} />)}
            </div>
          ) : threats.length === 0 ? (
            <EmptyState
              icon="🛡️"
              title="NO THREATS LOGGED"
              description="Scanned URLs scoring above 30 will be logged here."
            />
          ) : (
            <div className="space-y-3">
              {threats.map(t => <ThreatCard key={t.id} threat={t} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
