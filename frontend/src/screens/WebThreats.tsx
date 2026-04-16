import { useThreatHistory } from '../hooks/useThreatHistory';
import { ThreatCard } from '../components/threats/ThreatCard';
import { ThreatFilters } from '../components/threats/ThreatFilters';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { EmptyState } from '../components/ui/EmptyState';
import { SkeletonCard } from '../components/ui/SkeletonCard';

export function WebThreats() {
  const { threats, loading: threatLoading, error: threatError, load, clear, activeFilter, applyFilter } = useThreatHistory();

  return (
    <div className="min-h-screen px-4 md:px-8 py-8 max-w-4xl mx-auto">
      {/* HUD Header */}
      <div className="flex gap-3 mb-8 items-center">
        <div className="text-[11px] font-mono tracking-[0.2em] uppercase px-5 py-2.5 rounded bg-electricCyan/10 text-electricCyan border border-electricCyan/30 shadow-[0_0_16px_rgba(0,242,255,0.2)]">
          [ ENCRYPTED THREAT LOG ]
        </div>
        {threats.length > 0 && (
          <span className="ml-auto text-[10px] font-mono text-electricCyan/60 tracking-widest uppercase">
            {threats.length} ENTRIES LOGGED
          </span>
        )}
      </div>

      <div>
        {/* Log header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-white/70">Neural Threat Registry</h2>
            <p className="text-[10px] font-mono text-white/25 mt-0.5">READ-ONLY AUDIT · SORTED BY TIMESTAMP</p>
          </div>
          {threats.length > 0 && (
            <button
              onClick={clear}
              className="text-[10px] font-mono uppercase tracking-[0.15em] px-4 py-2 rounded border border-electricMagenta/40 text-electricMagenta hover:bg-electricMagenta/10 transition-all"
              style={{ boxShadow: '0 0 12px rgba(255,0,229,0.1)' }}
            >
              PURGE DATA
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
    </div>
  );
}
