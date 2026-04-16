import { useState, useCallback, useRef } from 'react';
import type { VoiceResult } from '../types';
import { analyzeVoice } from '../api/voiceService';
import { useAppStore } from '../store/appStore';
import { useGuardianAlert } from './useGuardianAlert';
import { logThreat, voiceResultToThreat } from '../utils/threatLogger';

// Buffer duration in ms — progress bar fills over this period before result shows
const BUFFER_MS = 7000; // ~7 seconds
const TICK_MS   = 80;   // update every 80 ms for a smooth bar

export function useVoiceAnalysis() {
  const [result, setResult] = useState<VoiceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const { addToast } = useAppStore();
  const { checkAndAlert } = useGuardianAlert();

  // Ref to hold the interval so we can clear it from anywhere
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const analyze = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress(0);

    const startTime = Date.now();

    // Smooth progress: fill to 90% over BUFFER_MS, then hold until API returns
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(90, (elapsed / BUFFER_MS) * 90);
      setProgress(pct);
    }, TICK_MS);

    try {
      const data = await analyzeVoice(file);

      // Clear interval and snap to 100%
      if (intervalRef.current) clearInterval(intervalRef.current);
      setProgress(100);

      // Small visual pause at 100% before revealing result
      await new Promise(res => setTimeout(res, 400));

      setResult(data);

      const threat = voiceResultToThreat(data);
      if (threat) logThreat(threat);

      if (data.verdict === 'SYNTHETIC') {
        const reason = data.reason ? ` - ${data.reason}` : '';
        addToast('error', `🤖 AI voice detected${reason} (${data.confidence_pct}% confidence)`);
        
        // Trigger Guardian alert for AI Voice scam
        checkAndAlert('VOICE_SCAN', data.reason || 'AI Voice Fraud', Math.round(data.confidence_pct));
      } else if (data.verdict === 'REAL') {
        addToast('success', `✓ Voice appears real — ${data.confidence_pct}% confidence`);
      } else {
        addToast('warning', 'Voice analysis inconclusive');
      }
    } catch (err: any) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      const msg = err.message || 'Voice analysis failed';
      setError(msg);
      addToast('error', msg);
      console.error('[ScamDefy][useVoiceAnalysis]', err);
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(0), 800);
    }
  }, [addToast]);

  return { result, loading, error, progress, analyze };
}
