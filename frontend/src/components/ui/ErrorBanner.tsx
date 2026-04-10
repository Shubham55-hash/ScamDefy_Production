import type { AppError } from '../../types';

interface Props {
  error: AppError | { message: string; retryable?: boolean };
  onRetry?: () => void;
}

export function ErrorBanner({ error, onRetry }: Props) {
  return (
    <div className="glass-panel border-l-2 border-electricMagenta rounded p-4 flex items-start gap-3">
      <span className="text-electricMagenta text-lg shrink-0">⚠</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-mono uppercase tracking-widest text-electricMagenta mb-1">System Error</p>
        <p className="text-xs text-white/60 leading-relaxed">{error.message}</p>
      </div>
      {onRetry && (error as AppError).retryable !== false && (
        <button
          onClick={onRetry}
          className="shrink-0 text-[10px] font-mono tracking-widest border border-electricCyan/40 text-electricCyan px-3 py-1 rounded hover:border-electricCyan/80 transition-colors"
        >
          RETRY
        </button>
      )}
    </div>
  );
}
