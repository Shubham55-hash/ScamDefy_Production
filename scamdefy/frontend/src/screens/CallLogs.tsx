import { useState, useRef } from 'react';
import { useVoiceAnalysis } from '../hooks/useVoiceAnalysis';
import { AudioUploader } from '../components/voice/AudioUploader';
import { VoiceResult } from '../components/voice/VoiceResult';
import { LiveMonitor } from '../components/voice/LiveMonitor';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { analyzeMessage } from '../api/reportService';
import type { MessageAnalysis } from '../types';

type VoiceTab = 'upload' | 'live';

const MSG_BUFFER_MS = 10000;
const MSG_TICK_MS   = 80;

export function CallLogs() {
  const [activeTab, setActiveTab] = useState<VoiceTab>('upload');
  const { result, loading, error, progress, analyze } = useVoiceAnalysis();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [msgText, setMsgText] = useState('');
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgProgress, setMsgProgress] = useState(0);
  const [msgResult, setMsgResult] = useState<MessageAnalysis | null>(null);
  const [msgError, setMsgError] = useState<string | null>(null);
  const msgIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleAnalyzeMessage = async () => {
    if (!msgText.trim() || msgLoading) return;
    setMsgLoading(true); setMsgError(null); setMsgResult(null); setMsgProgress(0);

    const startTime = Date.now();
    msgIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      setMsgProgress(Math.min(90, (elapsed / MSG_BUFFER_MS) * 90));
    }, MSG_TICK_MS);

    try {
      const data = await analyzeMessage(msgText.trim());
      if (msgIntervalRef.current) clearInterval(msgIntervalRef.current);
      setMsgProgress(100);
      await new Promise(res => setTimeout(res, 400));
      setMsgResult(data);
    } catch (err: any) {
      if (msgIntervalRef.current) clearInterval(msgIntervalRef.current);
      setMsgError(err.message || 'Message analysis failed');
    } finally {
      setMsgLoading(false);
      setTimeout(() => setMsgProgress(0), 800);
    }
  };

  const msgRiskColor = (level: string) => ({
    CRITICAL: '#ef4444', HIGH: '#f97316', SUSPICIOUS: '#f59e0b', SAFE: '#00f2ff',
  }[level] ?? '#94a3b8');

  return (
    <div className="min-h-screen px-4 md:px-8 py-8 max-w-3xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-4 mb-3">
          <div className="w-12 h-12 border border-electricCyan hexagon-clip flex items-center justify-center">
            <span className="text-xl">🎙️</span>
          </div>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tighter">Neural Voice Analyzer</h1>
            <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest">AI CLONE DETECTION SYSTEM · v2.0</p>
          </div>
        </div>
        <div className="glass-panel rounded-lg px-4 py-3 border-l-2 border-electricCyan/40">
          <p className="text-xs text-white/40 font-mono leading-relaxed">
            UPLOAD AUDIO PAYLOAD TO DETECT AI_SYNTHETIC OR REAL_HUMAN VOICE.
            PROTECT AGAINST VOICE_PHISHING (VISHING) ATTACKS.
          </p>
        </div>
      </div>

      {/* Tab toggle */}
      <div className="flex mb-6 gap-1 glass-panel rounded-xl p-1" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
        {(['upload', 'live'] as VoiceTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="flex-1 py-2.5 rounded-lg text-[10px] font-mono uppercase tracking-[0.25em] transition-all duration-200 flex items-center justify-center gap-2"
            style={{
              background: activeTab === tab
                ? tab === 'live' ? 'rgba(232,121,249,0.15)' : 'rgba(0,242,255,0.12)'
                : 'transparent',
              border: activeTab === tab
                ? `1px solid ${tab === 'live' ? 'rgba(232,121,249,0.4)' : 'rgba(0,242,255,0.4)'}`
                : '1px solid transparent',
              color: activeTab === tab
                ? tab === 'live' ? '#e879f9' : '#00f2ff'
                : 'rgba(255,255,255,0.3)',
              boxShadow: activeTab === tab
                ? `0 0 12px ${tab === 'live' ? 'rgba(232,121,249,0.2)' : 'rgba(0,242,255,0.15)'}`
                : 'none',
            }}
          >
            <span>{tab === 'upload' ? '📁' : '🎤'}</span>
            {tab === 'upload' ? 'UPLOAD FILE' : 'LIVE MONITOR'}
            {tab === 'live' && activeTab !== 'live' && (
              <span className="w-1.5 h-1.5 rounded-full bg-electricMagenta animate-pulse" style={{ boxShadow: '0 0 4px #e879f9' }} />
            )}
          </button>
        ))}
      </div>

      {/* Live Monitor Tab */}
      {activeTab === 'live' && <LiveMonitor />}

      {/* Upload File Tab */}
      {activeTab === 'upload' && (
        <>
          {/* Upload zone */}
          <div className="mb-6">
            <AudioUploader
              onFile={(file) => { setSelectedFile(file); analyze(file); }}
              loading={loading}
              progress={progress}
              selectedFile={selectedFile}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="mb-6">
              <ErrorBanner error={{ message: error, retryable: true }} />
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="mb-8">
              <VoiceResult result={result} />
            </div>
          )}

          {/* How it works */}
          <div className="glass-panel rounded-xl p-6 mb-8">
            <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-white/30 mb-5">How It Works</p>
            <div className="grid grid-cols-3 gap-4">
              {[
                { icon: '📤', step: '01', label: 'Upload', desc: 'Drop a WAV or MP3 file' },
                { icon: '🧠', step: '02', label: 'Analyze', desc: 'Wav2Vec2 neural extraction' },
                { icon: '✅', step: '03', label: 'Verdict', desc: 'REAL or AI SYNTHETIC' },
              ].map((s, i) => (
                <div key={i} className="relative text-center">
                  {i < 2 && (
                    <div className="absolute top-6 right-0 w-1/2 h-px bg-gradient-to-r from-electricCyan/20 to-transparent" />
                  )}
                  <div
                    className="w-12 h-12 hexagon-clip flex items-center justify-center mx-auto mb-3 text-lg"
                    style={{ background: 'rgba(0,242,255,0.06)', border: '1px solid rgba(0,242,255,0.15)' }}
                  >
                    {s.icon}
                  </div>
                  <p className="text-[9px] font-mono text-electricCyan/40 uppercase tracking-widest mb-1">{s.step}</p>
                  <p className="text-xs font-bold text-white/70">{s.label}</p>
                  <p className="text-[10px] text-white/30 mt-1 leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Message scanner */}
          <div className="glass-panel rounded-xl p-6">
            <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-white/70 mb-1">Payload Text Analyzer</h2>
            <p className="text-[10px] font-mono text-white/25 mb-5 uppercase tracking-widest">
              PASTE SUSPICIOUS SMS / WHATSAPP / EMAIL MESSAGE
            </p>

            <div className="relative mb-4">
              <div className="absolute inset-0 rounded-lg border border-dashed border-white/10 pointer-events-none" />
              <textarea
                value={msgText}
                onChange={e => setMsgText(e.target.value)}
                placeholder={'E.g. "Your KYC has expired..."'}
                rows={4}
                className="w-full bg-transparent text-sm font-mono text-white/70 placeholder:text-white/20 resize-none outline-none p-4 rounded-lg"
                onFocus={e => (e.target.parentElement!.style.borderColor = '')}
                style={{ background: 'rgba(255,255,255,0.02)' }}
              />
            </div>

            <button
              onClick={handleAnalyzeMessage}
              disabled={!msgText.trim() || msgLoading}
              className="w-full py-3 rounded-lg text-[11px] font-mono uppercase tracking-[0.2em] flex items-center justify-center gap-3 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: msgText.trim() && !msgLoading ? 'rgba(0,242,255,0.1)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${msgText.trim() && !msgLoading ? 'rgba(0,242,255,0.4)' : 'rgba(255,255,255,0.08)'}`,
                color: msgText.trim() && !msgLoading ? '#00f2ff' : 'rgba(255,255,255,0.3)',
              }}
            >
              {msgLoading ? <><LoadingSpinner size="sm" />&nbsp;ANALYZING PAYLOAD...</> : '⬡  ANALYZE PAYLOAD'}
            </button>

            {/* Progress bar — visible during message analysis */}
            {msgLoading && (
              <div className="mt-3">
                <div className="flex justify-between text-[9px] font-mono mb-1">
                  <span className="text-electricCyan/50 uppercase tracking-widest">PROCESSING PAYLOAD</span>
                  <span className="text-electricCyan/70">{Math.round(msgProgress)}%</span>
                </div>
                <div className="h-1 rounded-full bg-white/5">
                  <div
                    className="h-1 rounded-full transition-all duration-100"
                    style={{ width: `${msgProgress}%`, background: '#00f2ff', boxShadow: '0 0 6px #00f2ff' }}
                  />
                </div>
              </div>
            )}

            {msgError && (
              <div className="mt-4">
                <ErrorBanner error={{ message: msgError, retryable: true }} onRetry={handleAnalyzeMessage} />
              </div>
            )}

            {msgResult && (
              <div
                className="mt-5 glass-panel rounded-xl p-5 slide-up"
                style={{
                  borderColor: `${msgRiskColor(msgResult.risk_level)}30`,
                  border: `1px solid ${msgRiskColor(msgResult.risk_level)}30`,
                  boxShadow: `0 0 20px ${msgRiskColor(msgResult.risk_level)}10`,
                }}
              >
                {/* Header: risk level + category */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-mono font-bold uppercase tracking-widest rounded-full px-3 py-1"
                      style={{
                        color: msgRiskColor(msgResult.risk_level),
                        background: `${msgRiskColor(msgResult.risk_level)}15`,
                        border: `1px solid ${msgRiskColor(msgResult.risk_level)}30`,
                      }}
                    >
                      {msgResult.risk_level}
                    </span>
                    <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest">
                      {msgResult.scam_category}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono tabular-nums" style={{ color: msgRiskColor(msgResult.risk_level) }}>
                    {msgResult.risk_score}/100
                  </span>
                </div>

                {/* Risk score bar */}
                <div className="mb-4">
                  <div className="flex justify-between text-[10px] font-mono mb-2">
                    <span className="text-white/40 uppercase tracking-widest">Risk Score</span>
                    <span style={{ color: msgRiskColor(msgResult.risk_level) }}>{msgResult.risk_score}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5">
                    <div
                      className="h-1.5 rounded-full transition-all duration-700"
                      style={{
                        width: `${msgResult.risk_score}%`,
                        background: msgRiskColor(msgResult.risk_level),
                        boxShadow: `0 0 8px ${msgRiskColor(msgResult.risk_level)}`,
                      }}
                    />
                  </div>
                </div>

                {/* Detection Reason */}
                <div
                  className="mb-4 rounded-lg px-4 py-3"
                  style={{
                    background: `${msgRiskColor(msgResult.risk_level)}08`,
                    border: `1px solid ${msgRiskColor(msgResult.risk_level)}20`,
                  }}
                >
                  <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-white/30 mb-1">Detection Reason</p>
                  <p className="text-xs font-mono leading-relaxed" style={{ color: `${msgRiskColor(msgResult.risk_level)}cc` }}>
                    {msgResult.user_alert}
                  </p>
                </div>

                {/* Recommendation */}
                <p className="text-[10px] font-mono text-white/25 border-t border-white/5 pt-3 leading-relaxed">
                  ⚡ {msgResult.recommendation}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
