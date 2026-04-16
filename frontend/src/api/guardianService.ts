import { apiClient } from './client';
import type { Guardian } from '../hooks/useSafetyCircle';

export type AlertType = 'URL_SCAN' | 'MESSAGE_SCAN' | 'VOICE_SCAN' | 'QR_SCAN';

export interface NotifyPayload {
  guardians: Array<{ name: string; email: string }>;
  alert_type: AlertType;
  scam_type: string;
  risk_score: number;
  user_name?: string;
  is_escalation?: boolean;
  bypass_cooldown?: boolean;
}

export interface NotifyResult {
  status: string;
  sent: number;
  skipped: number;
  details: Array<{
    guardian_name: string;
    guardian_email: string; // masked
    sent: boolean;
    reason: string;
  }>;
}

export async function notifyGuardians(payload: NotifyPayload): Promise<NotifyResult> {
  const res = await apiClient.post<NotifyResult>('/api/guardian/notify', payload);
  return res.data;
}

/** Helper to build a payload from Guardian objects */
export function buildNotifyPayload(
  guardians: Guardian[],
  alertType: AlertType,
  scamType: string,
  riskScore: number,
  userName: string,
  isEscalation = false,
  bypassCooldown = false,
): NotifyPayload {
  return {
    guardians: guardians.map(g => ({ name: g.name, email: g.email })),
    alert_type: alertType,
    scam_type: scamType,
    risk_score: riskScore,
    user_name: userName || 'A ScamDefy user',
    is_escalation: isEscalation,
    bypass_cooldown: bypassCooldown,
  };
}
