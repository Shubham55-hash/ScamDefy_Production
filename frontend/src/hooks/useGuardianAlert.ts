import { useCallback } from 'react';
import { useSafetyCircle } from './useSafetyCircle';
import { notifyGuardians, buildNotifyPayload } from '../api/guardianService';
import type { AlertType } from '../api/guardianService';

/**
 * useGuardianAlert
 *
 * Call `checkAndAlert(alertType, scamType, riskScore)` after any scan.
 * The hook handles eligibility checks, rate-limiting, and the API call.
 *
 * Call `triggerEscalation(alertType, scamType, riskScore)` when the user
 * deliberately proceeds through a critical warning ("Proceed Anyway").
 */
export function useGuardianAlert() {
  const { settings, eligibleGuardians, markNotified } = useSafetyCircle();

  const checkAndAlert = useCallback(
    async (alertType: AlertType, scamType: string, riskScore: number): Promise<boolean> => {
      if (!settings.enabled) return false;
      if (riskScore < settings.threshold) return false;

      const eligible = eligibleGuardians();
      if (eligible.length === 0) return false;

      const userName = settings.shareUserName && settings.userName
        ? settings.userName
        : 'A ScamDefy user';

      try {
        const payload = buildNotifyPayload(
          eligible,
          alertType,
          scamType,
          riskScore,
          userName,
          false,
        );
        await notifyGuardians(payload);
        // Mark all eligible guardians as notified (start cooldown)
        eligible.forEach(g => markNotified(g.email));
        return true;
      } catch (err) {
        console.warn('[SafetyCircle] Guardian alert failed:', err);
        return false;
      }
    },
    [settings, eligibleGuardians, markNotified],
  );

  const triggerEscalation = useCallback(
    async (alertType: AlertType, scamType: string, riskScore: number): Promise<boolean> => {
      if (!settings.enabled || !settings.notifyOnEscalation) return false;
      // Escalation bypasses the threshold check — always fires if above 50
      if (riskScore < 50) return false;
      if (settings.guardians.length === 0) return false;

      const userName = settings.shareUserName && settings.userName
        ? settings.userName
        : 'A ScamDefy user';

      try {
        const payload = buildNotifyPayload(
          settings.guardians, // Use ALL guardians for escalation, ignore cooldown
          alertType,
          scamType,
          riskScore,
          userName,
          true, // is_escalation = true
        );
        await notifyGuardians(payload);
        settings.guardians.forEach(g => markNotified(g.email));
        return true;
      } catch (err) {
        console.warn('[SafetyCircle] Escalation alert failed:', err);
        return false;
      }
    },
    [settings, markNotified],
  );

  return { checkAndAlert, triggerEscalation, isEnabled: settings.enabled };
}
