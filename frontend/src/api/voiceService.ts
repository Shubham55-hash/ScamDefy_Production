import { apiClient } from './client';
import type { VoiceResult } from '../types';

export async function analyzeVoice(file: File): Promise<VoiceResult> {
  const form = new FormData();
  form.append('audio', file);
  const resp = await apiClient.post<VoiceResult>('/api/voice/analyze', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
  return resp.data;
}
