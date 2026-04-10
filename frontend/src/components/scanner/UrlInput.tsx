import React, { useState } from 'react';

interface Props {
  onScan: (url: string) => void;
  loading: boolean;
}

export function UrlInput({ onScan, loading }: Props) {
  const [url, setUrl] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || loading) return;

    let target = url.trim();
    if (!/^https?:\/\//i.test(target)) {
      target = 'http://' + target;
    }
    onScan(target);
  };

  return (
    <form onSubmit={handleSubmit} className="relative group">
      {/* Gradient glow behind */}
      <div className="absolute inset-0 bg-gradient-to-r from-electricCyan to-electricMagenta opacity-20 blur-xl group-hover:opacity-40 transition-opacity rounded-full" />
      {/* Pill input */}
      <div className="relative glass-panel rounded-full p-2 flex items-center hover:border-electricCyan/50 transition-all duration-500">
        <div className="pl-5 text-electricCyan shrink-0">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
          </svg>
        </div>
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
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
  );
}
