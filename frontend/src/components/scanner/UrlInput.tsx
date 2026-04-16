import React, { useState } from 'react';

interface Props {
  onScan: (url: string) => void;
  loading: boolean;
}

// A URL must have a valid hostname with at least one dot (e.g. google.com)
// or be a local path. Reject plain text / sentences.
function isValidUrl(raw: string): { valid: boolean; reason?: string } {
  const trimmed = raw.trim();

  // Reject empty
  if (!trimmed) return { valid: false, reason: 'Please enter a URL.' };

  // Reject if it contains spaces (messages / sentences)
  if (/\s/.test(trimmed)) {
    return { valid: false, reason: 'Invalid URL — looks like a message. Use the Message Scanner instead.' };
  }

  // Add scheme for validation if missing
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : 'http://' + trimmed;

  try {
    const parsed = new URL(withScheme);
    const host = parsed.hostname;

    // Must have a dot → reject bare words like "otp" or "bank"
    if (!host.includes('.')) {
      return { valid: false, reason: `"${trimmed}" is not a valid URL. Example: google.com` };
    }

    // Hostname must not be empty
    if (!host) {
      return { valid: false, reason: 'Invalid URL format.' };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: `"${trimmed}" is not a valid URL.` };
  }
}

export function UrlInput({ onScan, loading }: Props) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || loading) return;

    const { valid, reason } = isValidUrl(url.trim());
    if (!valid) {
      setError(reason ?? 'Invalid URL.');
      return;
    }

    setError(null);
    let target = url.trim();
    if (!/^https?:\/\//i.test(target)) {
      target = 'http://' + target;
    }
    onScan(target);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value);
    if (error) setError(null); // clear error when user types
  };

  return (
    <div className="space-y-2">
      <form onSubmit={handleSubmit} className="relative group">
        {/* Gradient glow behind */}
        <div
          className="absolute inset-0 blur-xl group-hover:opacity-40 transition-opacity rounded-full"
          style={{
            background: error
              ? 'linear-gradient(to right, #ef4444, #f97316)'
              : 'linear-gradient(to right, #00f2ff, #bf5af2)',
            opacity: 0.2,
          }}
        />
        {/* Pill input */}
        <div
          className="relative glass-panel rounded-full p-2 flex items-center transition-all duration-500"
          style={{ borderColor: error ? 'rgba(239,68,68,0.5)' : undefined }}
        >
          <div className="pl-5 shrink-0" style={{ color: error ? '#ef4444' : '#00f2ff' }}>
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
            </svg>
          </div>
          <input
            type="text"
            value={url}
            onChange={handleChange}
            placeholder="DEPLOY SCANNER: ENTER SUSPICIOUS URL..."
            disabled={loading}
            className="w-full bg-transparent border-none focus:ring-0 text-sm md:text-base py-3 px-5 font-mono placeholder:text-white/20 text-white tracking-wider outline-none"
          />
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="shrink-0 bg-white text-charcoal font-black uppercase px-8 py-3 rounded-full text-xs tracking-[0.15em] hover:bg-electricCyan hover:scale-105 transition-all shadow-[0_0_20px_rgba(255,255,255,0.2)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? '...' : 'Analyze'}
          </button>
        </div>
      </form>

      {/* Inline error message */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <span style={{ color: '#ef4444', fontSize: 12 }}>⚠</span>
          <p className="text-xs font-mono" style={{ color: '#fca5a5' }}>{error}</p>
        </div>
      )}
    </div>
  );
}
