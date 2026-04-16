import { useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import type { Guardian, SafetyCircleSettings } from '../types';

const COOLDOWN_MS = 0; // Immediate (no cooldown)

export function useSafetyCircle() {
  const { scSettings: settings, scUpdate: update } = useAppStore();

  const toggle = useCallback((enabled: boolean) => {
    update({ enabled });
  }, [update]);

  const addGuardian = useCallback((name: string, email: string): boolean => {
    if (settings.guardians.length >= 2) return false;
    const emailLower = email.trim().toLowerCase();
    if (settings.guardians.some(g => g.email === emailLower)) return false;

    const newGuardian: Guardian = {
      id: `g_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim(),
      email: emailLower,
      addedAt: new Date().toISOString(),
    };
    update({ guardians: [...settings.guardians, newGuardian] });
    return true;
  }, [settings.guardians, update]);

  const removeGuardian = useCallback((id: string) => {
    const remaining = settings.guardians.filter(g => g.id !== id);
    // Clean up lastNotified for removed guardians
    const removedEmails = settings.guardians
      .filter(g => g.id === id)
      .map(g => g.email);
    const lastNotified = { ...settings.lastNotified };
    removedEmails.forEach(e => delete lastNotified[e]);
    update({ guardians: remaining, lastNotified });
  }, [settings.guardians, settings.lastNotified, update]);

  /** Returns true if the guardian can be notified (cooldown passed) */
  const canNotify = useCallback((email: string): boolean => {
    const last = settings.lastNotified[email.toLowerCase()] ?? 0;
    return Date.now() - last > COOLDOWN_MS;
  }, [settings.lastNotified]);

  /** Mark a guardian as notified now (starts cooldown) */
  const markNotified = useCallback((email: string) => {
    const lastNotified = { ...settings.lastNotified, [email.toLowerCase()]: Date.now() };
    update({ lastNotified });
  }, [settings.lastNotified, update]);

  /** Returns guardians that are eligible for notification right now */
  const eligibleGuardians = useCallback((): Guardian[] => {
    if (!settings.enabled || settings.guardians.length === 0) return [];
    return settings.guardians.filter(g => canNotify(g.email));
  }, [settings.enabled, settings.guardians, canNotify]);

  const setThreshold = useCallback((threshold: number) => {
    update({ threshold: Math.min(90, Math.max(30, threshold)) });
  }, [update]);

  const setUserName = useCallback((userName: string) => {
    update({ userName: userName.trim().slice(0, 40) });
  }, [update]);

  return {
    settings,
    toggle,
    addGuardian,
    removeGuardian,
    canNotify,
    markNotified,
    eligibleGuardians,
    setThreshold,
    setUserName,
    update,
  };
}

export type { Guardian, SafetyCircleSettings };
