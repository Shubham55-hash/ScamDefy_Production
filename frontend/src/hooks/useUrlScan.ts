import { useState, useCallback, useRef } from 'react';
import type { ScanResult, AppError } from '../types';
import { scanUrl } from '../api/scanService';
import { useAppStore } from '../store/appStore';
import { logThreat, scanResultToThreat } from '../utils/threatLogger';

const BUFFER_MS = 8000;
const TICK_MS   = 100;

// functions moved to ../utils/threatLogger.ts

export function useUrlScan() {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [progress, setProgress] = useState(0);
  const { addScan, addToast } = useAppStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scan = useCallback(async (url: string) => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress(0);

    const startTime = Date.now();

    // Smooth progress: fill to 90% over BUFFER_MS, hold until API returns
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(90, (elapsed / BUFFER_MS) * 90);
      setProgress(pct);
    }, TICK_MS);

    try {
      const data = await scanUrl(url.trim());

      if (intervalRef.current) clearInterval(intervalRef.current);

      // Backend may return { error: true, message: '...' } for invalid inputs
      if ((data as any).error) {
        setProgress(0);
        const appError: AppError = { message: (data as any).message || 'Invalid input.', retryable: false };
        setError(appError);
        setLoading(false);
        return;
      }

      setProgress(100);

      // Brief pause at 100% before showing result.
      await new Promise(res => setTimeout(res, 1000));

      setResult(data);
      addScan(data);

      // Persist threat if score >= 30
      const threat = scanResultToThreat(data);
      if (threat) logThreat(threat);

      if (data.should_block) {
        addToast('error', `🚫 Blocked: ${data.scam_type} (${data.score}/100)`);
      } else if (data.score >= 30) {
        addToast('warning', `⚠️ Caution: ${data.scam_type} (${data.score}/100)`);
      } else {
        addToast('success', `✓ URL appears safe (${data.score}/100)`);
      }
    } catch (err: any) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      const appError: AppError = { message: err.message || 'Scan failed. Check backend connection.', retryable: true };
      setError(appError);
      addToast('error', appError.message);
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(0), 800);
    }
  }, [addScan, addToast]);

  const reset = useCallback(() => { setResult(null); setError(null); setProgress(0); }, []);
  return { result, loading, error, progress, scan, reset };
}
