import { useState, useCallback, useRef } from 'react';
import type { LiveVerdictEntry } from '../types';
import { analyzeVoice } from '../api/voiceService';
import { useAppStore } from '../store/appStore';

export type LiveState = 'idle' | 'requesting' | 'recording' | 'stopping' | 'error';

const CHUNK_DURATION_MS = 6000; // 6-second rolling chunks

/** Release all tracks on a stream and clear the ref */
function releaseStream(streamRef: React.MutableRefObject<MediaStream | null>) {
  if (streamRef.current) {
    streamRef.current.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }
}

/** Try to create a MediaRecorder with progressively more compatible options.
 *  Starting with no mimeType (browser default) works best across Bluetooth / USB mics.
 */
function createMediaRecorder(stream: MediaStream): MediaRecorder {
  try {
    return new MediaRecorder(stream); // browser default — most compatible
  } catch {
    try {
      return new MediaRecorder(stream, { mimeType: 'audio/webm' });
    } catch {
      throw new Error('MediaRecorder is not supported in this browser');
    }
  }
}

export function useLiveMonitor() {
  const [liveState, setLiveState] = useState<LiveState>('idle');
  const [verdicts, setVerdicts] = useState<LiveVerdictEntry[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkCountRef = useRef(0);
  const { addToast } = useAppStore();

  const handleChunk = useCallback(async (blob: Blob, chunkNum: number) => {
    if (blob.size < 1000) return; // ignore tiny/empty blobs
    setIsAnalyzing(true);
    try {
      // 1. Convert WebM/Opus blob to standard WAV
      const arrayBuffer = await blob.arrayBuffer();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      // Let's import the package dynamically to avoid top-level require issues
      const toWav = (await import('audiobuffer-to-wav')).default || await import('audiobuffer-to-wav');
      
      const wavBuffer = typeof toWav === 'function' ? toWav(audioBuffer) : toWav.default(audioBuffer);
      const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });

      // 2. Send the real WAV file to the backend
      const file = new File([wavBlob], `live_chunk_${chunkNum}.wav`, { type: 'audio/wav' });
      const result = await analyzeVoice(file);
      
      const entry: LiveVerdictEntry = {
        id: result.id ?? `chunk-${chunkNum}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        verdict: result.verdict,
        confidence_pct: result.confidence_pct,
        reason: result.reason,
        chunk_number: chunkNum,
      };
      setVerdicts(prev => [entry, ...prev]); // newest first
      if (result.verdict === 'SYNTHETIC') {
        addToast('error', `🤖 AI voice detected in live stream — ${result.confidence_pct}% confidence`);
      }
    } catch (err: any) {
      console.warn('[LiveMonitor] chunk analysis failed:', err);
    } finally {
      setIsAnalyzing(false);
    }
  }, [addToast]);

  const start = useCallback(async () => {
    setErrorMsg(null);
    setLiveState('requesting');
    let ms: MediaStream | null = null;

    try {
      // 1. Request mic access — waits for browser permission dialog
      ms = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = ms;
      setStream(ms);

      // 2. Create MediaRecorder — fallback chain for broadest device compat
      const mr = createMediaRecorder(ms);
      mediaRecorderRef.current = mr;
      chunkCountRef.current = 0;

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunkCountRef.current += 1;
          handleChunk(e.data, chunkCountRef.current);
        }
      };

      mr.onerror = (e) => {
        console.error('[LiveMonitor] MediaRecorder error:', e);
        setLiveState('error');
        setErrorMsg('Recording error — please try again');
        releaseStream(streamRef);
        setStream(null);
      };

      // 3. Start chunking
      mr.start(CHUNK_DURATION_MS);
      setLiveState('recording');
    } catch (err: any) {
      // Ensure mic tracks are always released on failure
      if (ms && !streamRef.current) {
        ms.getTracks().forEach(t => t.stop());
      }
      releaseStream(streamRef);
      setStream(null);

      let msg: string;
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        msg = 'Mic access denied — click Allow in the browser dialog and try again.';
      } else if (err?.name === 'NotFoundError') {
        msg = 'No microphone found. Connect a mic and try again.';
      } else if (err?.name === 'NotReadableError') {
        msg = 'Microphone is in use by another app. Close it and try again.';
      } else {
        msg = err?.message ?? 'Could not start recording. Try again.';
      }
      console.error('[LiveMonitor] start() failed:', err?.name, err?.message);
      setErrorMsg(msg);
      setLiveState('error');
    }
  }, [handleChunk]);

  const stop = useCallback(() => {
    setLiveState('stopping');
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
    } catch (e) {
      console.warn('[LiveMonitor] stop() recorder error:', e);
    }
    releaseStream(streamRef);
    setStream(null);
    setLiveState('idle');
  }, []);

  const clearVerdicts = useCallback(() => setVerdicts([]), []);

  return {
    liveState,
    verdicts,
    errorMsg,
    stream,
    isAnalyzing,
    start,
    stop,
    clearVerdicts,
    chunkDurationMs: CHUNK_DURATION_MS,
  };
}
