import { useState } from 'react';
import { useUrlScan } from '../hooks/useUrlScan';
import { QRScannerView } from '../components/qr/QRScannerView';
import { QRUploadView } from '../components/qr/QRUploadView';
import { ScanResultCard } from '../components/scanner/ScanResultCard';
import { ThreatBreakdown } from '../components/scanner/ThreatBreakdown';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';

export function QRScan() {
  const { result, loading, error, progress, scan, reset } = useUrlScan();
  const [scanning, setScanning] = useState(true);
  const [activeTab, setActiveTab] = useState<'live' | 'upload'>('live');
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleScan = (decodedText: string) => {
    setLocalError(null);
    setScanning(false);
    scan(decodedText);
  };

  const handleReset = () => {
    reset();
    setScanning(true);
    setCameraEnabled(false);
  };

  return (
    <div className="min-h-screen px-4 md:px-8 py-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8 flex items-center gap-4">
        <div className="w-12 h-12 border border-electricCyan hexagon-clip flex items-center justify-center">
          <span className="text-xl">📱</span>
        </div>
        <div>
          <h1 className="text-xl font-black uppercase tracking-tighter">QR SHIELD</h1>
          <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest">REAL-TIME PHYSICAL THREAT DETECTION</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Tab Toggle */}
        {!loading && !result && (
          <div className="flex gap-2 p-1 glass-panel rounded-xl mb-6">
            <button
              onClick={() => { setActiveTab('live'); setLocalError(null); }}
              className={`flex-1 py-3 rounded-lg text-[10px] font-mono uppercase tracking-[0.2em] transition-all ${activeTab === 'live' ? 'bg-electricCyan/10 text-electricCyan border border-electricCyan/30 shadow-[0_0_12px_rgba(0,242,255,0.15)]' : 'text-white/30 hover:text-white/50'}`}
            >
              🎥 Live Camera
            </button>
            <button
              onClick={() => { setActiveTab('upload'); setLocalError(null); }}
              className={`flex-1 py-3 rounded-lg text-[10px] font-mono uppercase tracking-[0.2em] transition-all ${activeTab === 'upload' ? 'bg-electricCyan/10 text-electricCyan border border-electricCyan/30 shadow-[0_0_12px_rgba(0,242,255,0.15)]' : 'text-white/30 hover:text-white/50'}`}
            >
              📤 Upload QR
            </button>
          </div>
        )}

        {/* Scanner View */}
        {scanning && !loading && !result && (
          <div className="glass-panel rounded-2xl p-8 text-center animate-fade-in">
            <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-white/70 mb-2">
              {activeTab === 'live' ? 'Align QR Code' : 'Select QR Image'}
            </h2>
            <p className="text-[10px] font-mono text-white/25 mb-8 uppercase tracking-widest">
              {activeTab === 'live' ? 'Point camera at a physical or digital QR code' : 'Upload an image containing a QR code'}
            </p>
            
            {activeTab === 'live' ? (
              cameraEnabled ? (
                <>
                  <QRScannerView onScan={handleScan} active={scanning && activeTab === 'live'} onError={e => setLocalError(typeof e === 'string' ? e : 'Camera access failed')} />
                  <button
                    onClick={() => setCameraEnabled(false)}
                    className="mt-6 text-[9px] font-mono text-white/20 hover:text-red-400 transition-colors uppercase tracking-[0.2em]"
                  >
                    [ DISCONNECT CAMERA ]
                  </button>
                </>
              ) : (
                <div className="py-10">
                  <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-6">
                    <span className="text-3xl">🛡️</span>
                  </div>
                  <button
                    onClick={() => setCameraEnabled(true)}
                    className="px-8 py-3 rounded-xl bg-electricCyan/10 border border-electricCyan/40 text-electricCyan text-[11px] font-bold uppercase tracking-[0.2em] hover:bg-electricCyan/20 transition-all shadow-[0_0_15px_rgba(0,242,255,0.1)]"
                  >
                    AUTHORIZE SCANNER
                  </button>
                  <p className="mt-4 text-[9px] font-mono text-white/20 uppercase tracking-widest leading-relaxed">
                    Camera access is required for real-time<br/>physical threat detection.
                  </p>
                </div>
              )
            ) : (
              <QRUploadView onScan={handleScan} onError={e => setLocalError(e)} />
            )}

            {localError && (
              <div className="mt-6 p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-[10px] font-mono text-red-400 uppercase tracking-widest">{localError}</p>
              </div>
            )}
            
            {activeTab === 'live' && !localError && (
              <div className="mt-8 flex items-center justify-center gap-2 text-[10px] font-mono text-white/20">
                <span className="w-1.5 h-1.5 rounded-full bg-electricCyan animate-pulse" />
                <span>SCANNER STATUS: SEARCHING...</span>
              </div>
            )}
          </div>
        )}

        {/* Loading / Progress State */}
        {loading && (
          <div className="glass-panel rounded-2xl p-12 text-center slide-up">
            <div className="mb-6">
              <LoadingSpinner size="lg" />
            </div>
            <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-electricCyan animate-pulse">Analyzing QR Payload</h2>
            <p className="text-[10px] font-mono text-white/30 mt-2 uppercase tracking-widest">Checking VirusTotal, Google Safe Browsing & Heuristics...</p>
            
            <div className="mt-8 max-w-xs mx-auto">
              <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                <div 
                  className="h-full bg-electricCyan shadow-[0_0_12px_#00f2ff] transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[9px] font-mono text-electricCyan/60 mt-2">{Math.round(progress)}% COMPLETE</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="space-y-4">
            <ErrorBanner error={error} />
            <button
              onClick={handleReset}
              className="w-full py-3 rounded-lg border border-white/10 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 hover:text-white/70 hover:bg-white/5 transition-all"
            >
              ← RESTART SCANNER
            </button>
          </div>
        )}

        {/* Result State */}
        {result && (
          <div className="space-y-6 animate-fade-in">
            <ScanResultCard result={result} />
            <ThreatBreakdown breakdown={result.breakdown} />
            
            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={handleReset}
                className="py-4 rounded-xl border border-white/10 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 hover:text-white/70 hover:bg-white/5 transition-all"
              >
                ← SCAN NEW QR
              </button>
              
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="py-4 rounded-xl flex items-center justify-center gap-3 text-[10px] font-bold uppercase tracking-[0.2em] transition-all"
                style={{
                  background: result.verdict === 'SAFE' ? 'rgba(0, 242, 255, 0.15)' : 'rgba(239, 68, 68, 0.1)',
                  border: `1px solid ${result.verdict === 'SAFE' ? 'rgba(0, 242, 255, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
                  color: result.verdict === 'SAFE' ? '#00f2ff' : '#ef4444'
                }}
              >
                {result.verdict === 'SAFE' ? '✓ PROCEED TO URL' : '⚠️ VISIT ANYWAY'}
              </a>
            </div>
            
            {result.verdict !== 'SAFE' && (
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-center">
                <p className="text-[10px] font-mono text-red-500 uppercase tracking-widest">
                  🛡️ ScamDefy restricted this URL for your safety.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
