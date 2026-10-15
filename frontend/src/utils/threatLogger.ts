
import type { ThreatEntry, ScanResult, VoiceResult, MessageAnalysis } from '../types';
import { apiClient } from '../api/client';

const THREATS_STORAGE_KEY = 'scamdefy_threats';

export function saveThreatLocally(threat: ThreatEntry) {
  try {
    const existing: ThreatEntry[] = JSON.parse(localStorage.getItem(THREATS_STORAGE_KEY) || '[]');
    // Avoid double logging if same ID exists
    if (existing.some(t => t.id === threat.id)) return;
    
    const updated = [threat, ...existing].slice(0, 100);
    localStorage.setItem(THREATS_STORAGE_KEY, JSON.stringify(updated));
  } catch {}
}

export function scanResultToThreat(result: ScanResult): ThreatEntry | null {
  if (result.score < 30) return null;
  return {
    id: result.id,
    url: result.url,
    risk_level: result.risk_level,
    score: result.score,
    scam_type: result.scam_type,
    explanation: result.explanation || '',
    signals: result.signals.map((s: any) => typeof s === 'string' ? s : s.name) || [],
    user_proceeded: false,
    blocked: result.should_block,
    timestamp: result.timestamp,
    breakdown: result.breakdown,
    domain_age: result.domain_age,
  };
}

export function voiceResultToThreat(result: VoiceResult): ThreatEntry | null {
  if (result.verdict !== 'SYNTHETIC' && result.verdict !== 'AI' && result.verdict !== 'UNCERTAIN') return null;
  return {
    id: result.id,
    url: `Voice Payload: ${result.id.slice(0,8)}`, // Placeholder
    risk_level: (result.verdict === 'SYNTHETIC' || result.verdict === 'AI') ? 'CRITICAL' : 'MEDIUM',
    score: result.confidence_pct,
    scam_type: 'AI Voice Clone',
    explanation: result.reason || 'Detected synthetic audio patterns.',
    signals: ['NEURAL_PROSODY_MATCH', 'AI_ARTIFACT_DETECTED'],
    user_proceeded: false,
    blocked: result.verdict === 'SYNTHETIC' || result.verdict === 'AI',
    timestamp: result.timestamp,
  };
}

export function messageResultToThreat(result: MessageAnalysis, text: string): ThreatEntry | null {
  if (result.risk_level === 'SAFE') return null;
  return {
    id: `msg-${Date.now()}`,
    url: `Message: ${text.slice(0, 30)}...`,
    risk_level: result.risk_level as any,
    score: result.risk_score,
    scam_type: result.scam_category,
    explanation: result.user_alert,
    signals: result.signals_triggered.map(s => s.name),
    user_proceeded: false,
    blocked: result.risk_level === 'CRITICAL' || result.risk_level === 'HIGH',
    timestamp: new Date().toISOString(),
  };
}

export async function logThreat(threat: ThreatEntry) {
  saveThreatLocally(threat);
  try {
    await apiClient.post('/api/threats', threat);
  } catch (err) {
    console.error('[ScamDefy] Backend logging failed', err);
  }
}
