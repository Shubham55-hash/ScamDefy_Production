import { create } from 'zustand';
import type { ScanResult, ThreatEntry, HealthStatus, SafetyCircleSettings } from '../types';

interface Toast { id: string; type: string; message: string; }

const SC_STORAGE_KEY = 'scamdefy_safety_circle';
const SC_DEFAULTS: SafetyCircleSettings = {
  enabled: false,
  guardians: [],
  threshold: 75,
  notifyOnEscalation: true,
  shareUserName: false,
  userName: '',
  lastNotified: {},
};

function loadSC(): SafetyCircleSettings {
  try {
    const raw = localStorage.getItem(SC_STORAGE_KEY);
    return raw ? { ...SC_DEFAULTS, ...JSON.parse(raw) } : SC_DEFAULTS;
  } catch {
    return SC_DEFAULTS;
  }
}

function persistSC(settings: SafetyCircleSettings): void {
  try {
    localStorage.setItem(SC_STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

interface AuthUser {
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
  token: string;
}

interface AppState {
  health: HealthStatus | null;
  setHealth: (h: HealthStatus) => void;
  recentScans: ScanResult[];
  addScan: (s: ScanResult) => void;
  threats: ThreatEntry[];
  setThreats: (t: ThreatEntry[]) => void;
  totalBlocked: number;
  todayBlocked: number;
  setStats: (total: number, today: number) => void;
  toasts: Toast[];
  addToast: (type: string, message: string) => void;
  removeToast: (id: string) => void;
  
  // Auth
  user: AuthUser | null;
  authenticate: (user: AuthUser) => void;
  logout: () => void;

  // Safety Circle
  scSettings: SafetyCircleSettings;
  scUpdate: (patch: Partial<SafetyCircleSettings>) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  health: null,
  setHealth: (health) => set({ health }),
  recentScans: [],
  addScan: (scan) => set(state => ({
    recentScans: [scan, ...state.recentScans].slice(0, 20)
  })),
  threats: [],
  setThreats: (threats) => set({ threats }),
  totalBlocked: 0,
  todayBlocked: 0,
  setStats: (totalBlocked, todayBlocked) => set({ totalBlocked, todayBlocked }),
  toasts: [],
  addToast: (type, message) => {
    const id = `toast_${Date.now()}_${Math.random()}`;
    set(state => ({ toasts: [...state.toasts.slice(-2), { id, type, message }] }));
    setTimeout(() => get().removeToast(id), 4000);
  },
  removeToast: (id) => set(state => ({
    toasts: state.toasts.filter(t => t.id !== id)
  })),

  // Auth
  user: (() => {
    try {
      const raw = localStorage.getItem('sd_auth');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })(),
  authenticate: (user) => {
    set({ user });
    localStorage.setItem('sd_auth', JSON.stringify(user));
  },
  logout: () => {
    set({ user: null });
    localStorage.removeItem('sd_auth');
  },

  // Safety Circle
  scSettings: loadSC(),
  scUpdate: (patch) => {
    const next = { ...get().scSettings, ...patch };
    set({ scSettings: next });
    persistSC(next);
  },
}));
