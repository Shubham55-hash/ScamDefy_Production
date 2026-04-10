import { apiClient } from './client';
import type { ThreatEntry } from '../types';

export async function getThreats(limit = 50, riskLevel?: string) {
  const params: Record<string, any> = { limit };
  if (riskLevel) params.risk_level = riskLevel;
  const resp = await apiClient.get('/api/threats', { params });
  return resp.data as { threats: ThreatEntry[]; total: number };
}

export async function clearThreats() {
  const resp = await apiClient.delete('/api/threats');
  return resp.data;
}

export async function getStats() {
  const resp = await apiClient.get('/api/threats/stats');
  return resp.data as {
    total_detected: number;
    today_detected: number;
    total_blocked: number;
  };
}

export async function getHealth() {
  const resp = await apiClient.get('/api/health');
  return resp.data;
}
