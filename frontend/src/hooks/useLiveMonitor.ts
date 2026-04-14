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

/** Try to create a MediaRecorder with progressively more compatible options. */
function createMediaRecorder(stream: MediaStream): MediaRecorder {
  const preferredTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    '',  // browser default
  ];
  for (const mimeType of preferredTypes) {
    try {
      if (mimeType === '' || MediaRecorder.isTypeSupported(mimeType)) {
        return new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      }
    } catch { /* try next */ }
  }
  throw new Error('MediaRecorder is not supported in this browser');
}

/**
 * Encodes a decoded AudioBuffer into a standard WAV file (PCM 16-bit mono).
 * This is a pure in-memory encoder — no external package needed.
 */
function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = 1; // Always mono for voice analysis
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  // Mix down to mono
  let samples: Float32Array;
  if (buffer.numberOfChannels === 1) {
    samples = buffer.getChannelData(0);
  } else {
    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.getChannelData(1);
    samples = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) {
      samples[i] = (ch0[i] + ch1[i]) / 2;
    }
  }

  const dataLength = samples.length * (bitDepth / 8);
  const wavBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(wavBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  const blockAlign = numChannels * (bitDepth / 8);
  const byteRate = sampleRate * blockAlign;

  writeString(0, 'RIFF');
  view.setUint32(4,  36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);          // chunk size
  view.setUint16(20, format, true);      // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  // Write 16-bit PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return wavBuffer;
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
    // Ignore tiny/empty blobs — 6s of audio at 128kbps opus should be >> 5KB
    if (blob.size < 3000) {
      console.warn(`[LiveMonitor] Chunk #${chunkNum} too small (${blob.size}B), skipping`);
      return;
    }
    setIsAnalyzing(true);
    try {
      // 1. Decode the WebM/Opus blob using the browser's native AudioContext
      const arrayBuffer = await blob.arrayBuffer();
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      await audioCtx.close(); // release audio resources

      // 2. Encode decoded PCM to WAV using our inline encoder (no package needed)
      const wavBuffer = audioBufferToWav(audioBuffer);
      const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });

      // 3. Send WAV to the backend — retrieve Gemini key from settings if available
      const storedSettings = localStorage.getItem('scamdefy_settings');
      const geminiKey: string | null = storedSettings
        ? (JSON.parse(storedSettings)?.geminiApiKey ?? null)
        : null;

      const file = new File([wavBlob], `live_chunk_${chunkNum}.wav`, { type: 'audio/wav' });
      const result = await analyzeVoice(file, geminiKey);

      const entry: LiveVerdictEntry = {
        id: result.id ?? `chunk-${chunkNum}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        verdict: result.verdict,
        confidence_pct: result.confidence_pct,
        reason: result.reason,
        transcript: result.transcript,
        chunk_number: chunkNum,
      };
      setVerdicts(prev => [entry, ...prev]); // newest first
      if (result.verdict === 'SYNTHETIC') {
        addToast('error', `🤖 AI voice detected in live stream — ${result.confidence_pct.toFixed(1)}% confidence`);
      } else if (result.verdict === 'REAL') {
        addToast('success', `✅ Chunk #${chunkNum} is real — ${result.confidence_pct.toFixed(1)}%`);
      }
    } catch (err: any) {
      console.error('[LiveMonitor] chunk analysis failed:', err);
      // Show decode errors as a toast so the user knows something went wrong
      if (err?.name === 'EncodingError' || err?.message?.includes('decode')) {
        addToast('warning', `Chunk #${chunkNum} could not be decoded — mic may be incompatible`);
      }
    } finally {
      setIsAnalyzing(false);
    }
  }, [addToast]);

  const start = useCallback(async () => {
    setErrorMsg(null);
    setLiveState('requesting');
    let ms: MediaStream | null = null;

    try {
      // 1. Request mic access — Disable auto-processing to prevent "robotic" filtering
      // which often leads to false AI detections.
      ms = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,   // Re-enabled for stability
          noiseSuppression: true,   // Re-enabled to filter hiss
          autoGainControl: true,    // CRITICAL: Prevent clipping
          channelCount: 1,
          sampleRate: 44100
        }, 
        video: false 
      });
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
