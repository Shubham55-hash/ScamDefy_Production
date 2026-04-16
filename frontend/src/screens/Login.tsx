import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { apiClient } from '../api/client';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { authenticate } = useAppStore();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await apiClient.post('/api/auth/login', { email, password });
      authenticate(res.data.user);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'TERMINAL_ACCESS_DENIED: Invalid Credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden bg-charcoal">
      {/* Background Ambience */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-electricCyan/10 rounded-full blur-[120px] animate-pulse-glow" />
      <div className="absolute -bottom-20 -right-20 w-[400px] h-[400px] bg-electricMagenta/5 rounded-full blur-[100px]" />
      
      <div className="w-full max-w-md relative z-10 glass-panel rounded-[2rem] p-10 border-white/5 bg-[#0a0b0d]/80 shadow-2xl">
        {/* Brand Header */}
        <div className="text-center mb-10">
          <div className="w-16 h-16 border-2 border-electricCyan hexagon-clip flex items-center justify-center animate-pulse mx-auto mb-6">
            <div className="w-6 h-6 bg-electricCyan hexagon-clip" />
          </div>
          <h1 className="text-3xl font-black italic tracking-tighter uppercase text-white mb-2">
            Scam<span className="text-electricCyan">Defy</span>
          </h1>
          <p className="text-[10px] font-mono text-white/40 uppercase tracking-[0.4em]">Neural Security Protocol V2.4</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest pl-4">Network ID</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@scamdefy.io"
              className="w-full bg-white/5 border border-white/10 rounded-full py-4 px-6 text-white font-mono text-sm placeholder:text-white/10 focus:outline-none focus:border-electricCyan/50 transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest pl-4">Access Key</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-white/5 border border-white/10 rounded-full py-4 px-6 text-white font-mono text-sm placeholder:text-white/10 focus:outline-none focus:border-electricCyan/50 transition-all"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center gap-3">
              <span className="text-red-500 text-lg">⚠️</span>
              <p className="text-[10px] font-mono text-red-200 uppercase tracking-tight">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white text-charcoal font-black uppercase py-4 rounded-full text-sm tracking-[0.2em] hover:bg-electricCyan hover:scale-[1.02] transition-all shadow-[0_0_30px_rgba(255,255,255,0.1)] active:scale-95 disabled:opacity-50"
          >
            {loading ? 'AUTHENTICATING...' : 'ENCRYPT & ENTER'}
          </button>
        </form>

        <div className="mt-8 text-center">
          <p className="text-[10px] font-mono text-white/20 uppercase tracking-widest">
            {loading ? 'Neural handshake in progress...' : 'Connection encrypted // AES-256'}
          </p>
        </div>
      </div>
      
      {/* Floating accent line */}
      <div className="fixed bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-electricCyan to-transparent opacity-20" />
    </div>
  );
}
