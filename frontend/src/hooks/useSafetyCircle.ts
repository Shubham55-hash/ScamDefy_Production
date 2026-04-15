import { useState, useCallback } from 'react';

const STORAGE_KEY = 'scamdefy_safety_circle';
const COOLDOWN_MS  = 30 * 60 * 1000; // 30 minutes

export interface Guardian {
  id: string;
  name: string;
  email: string;
  addedAt: string; // ISO timestamp
}

export interface SafetyCircleSettings {
  enabled: boolean;
  guardians: Guardian[];
  /** Risk score threshold (65–90) above which guardians are notified */
  threshold: number;
  /** Also notify guardians when user proceeds through a critical warning */
  notifyOnEscalation: boolean;
  /** Privacy: share user's display name in alert (vs. "A ScamDefy user") */
  shareUserName: boolean;
  /** user's display name for alerts */
  userName: string;
  /** Per-guardian email → last notified unix ms */
  lastNotified: Record<string, number>;
}

const DEFAULTS: SafetyCircleSettings = {
  enabled: false,
  guardians: [],
  threshold: 75,
  notifyOnEscalation: true,
  shareUserName: false,
  userName: '',
  lastNotified: {},
};

function load(): SafetyCircleSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function persist(settings: SafetyCircleSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

export function useSafetyCircle() {
  const [settings, setSettingsState] = useState<SafetyCircleSettings>(load);

  const update = useCallback((patch: Partial<SafetyCircleSettings>) => {
    setSettingsState(prev => {
      const next = { ...prev, ...patch };
      persist(next);
      return next;
    });
  }, []);

  const toggle = useCallback((enabled: boolean) => {
    update({ enabled });
  }, [update]);

  const addGuardian = useCallback((name: string, email: string): boolean => {
    const current = load();
    if (current.guardians.length >= 2) return false;
    const emailLower = email.trim().toLowerCase();
    if (current.guardians.some(g => g.email === emailLower)) return false;

    const newGuardian: Guardian = {
      id: `g_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim(),
      email: emailLower,
      addedAt: new Date().toISOString(),
    };
    update({ guardians: [...current.guardians, newGuardian] });
    return true;
  }, [update]);

  const removeGuardian = useCallback((id: string) => {
    const current = load();
    const remaining = current.guardians.filter(g => g.id !== id);
    // Clean up lastNotified for removed guardians
    const removedEmails = current.guardians
      .filter(g => g.id === id)
      .map(g => g.email);
    const lastNotified = { ...current.lastNotified };
    removedEmails.forEach(e => delete lastNotified[e]);
    update({ guardians: remaining, lastNotified });
  }, [update]);

  /** Returns true if the guardian can be notified (cooldown passed) */
  const canNotify = useCallback((email: string): boolean => {
    const last = settings.lastNotified[email.toLowerCase()] ?? 0;
    return Date.now() - last > COOLDOWN_MS;
  }, [settings.lastNotified]);

  /** Mark a guardian as notified now (starts cooldown) */
  const markNotified = useCallback((email: string) => {
    const current = load();
    const lastNotified = { ...current.lastNotified, [email.toLowerCase()]: Date.now() };
    update({ lastNotified });
  }, [update]);

  /** Returns guardians that are eligible for notification right now */
  const eligibleGuardians = useCallback((): Guardian[] => {
    const current = load();
    if (!current.enabled || current.guardians.length === 0) return [];
    return current.guardians.filter(g => canNotify(g.email));
  }, [canNotify]);

  const setThreshold = useCallback((threshold: number) => {
    update({ threshold: Math.min(90, Math.max(65, threshold)) });
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
