export type Verdict = 'SAFE' | 'CAUTION' | 'DANGER' | 'BLOCKED';
export type Screen = 'landing' | 'dashboard' | 'webthreats' | 'qrscan' | 'calllogs' | 'settings' | 'safetycircle' | 'testlab' | 'communityfeedback';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// ... (other types)

export interface CommunityReport {
  id: string;
  url: string;
  type: 'scam' | 'false_positive';
  reason: string;
  timestamp: number;
}
export type VoiceVerdict = 'REAL' | 'SYNTHETIC' | 'UNKNOWN' | 'UNCERTAIN';

export interface SignalItem {
  name: string;
  points: number;
  severity: string;
}

export interface ScanBreakdown {
  gsb: number;
  urlhaus: number;
  threatfox: number;
  domain: number;
  heuristics: number;
  virustotal: number;
  domain_age: number;
  impersonation: number;
  url_pattern: number;
}

export interface ScanResult {
  id: string;
  url: string;
  final_url: string;
  expanded: boolean;
  score: number;
  verdict: Verdict;
  risk_level: RiskLevel;
  color: string;
  should_block: boolean;
  scam_type: string;
  explanation: string;
  signals: SignalItem[];
  breakdown: ScanBreakdown;
  cached: boolean;
  scan_time_ms: number;
  timestamp: string;
  domain_age?: { age_days: number | null; registered_on: string | null; source: string };
  community_reports?: {
    scam_reports: number;
    false_positive_reports: number;
    total_reports: number;
  };
}

export interface VoiceResult {
  id: string;
  verdict: VoiceVerdict;
  confidence: number;
  confidence_pct: number;
  model_loaded: boolean;
  reason?: string;
  transcript?: string;
  warning?: string;
  timestamp: string;
}

export interface LiveVerdictEntry {
  id: string;
  timestamp: string;
  verdict: VoiceVerdict;
  confidence_pct: number;
  reason?: string;
  transcript?: string;
  chunk_number: number;
}

export type ThreatEntry = {
  id: string;
  url: string;
  risk_level: RiskLevel;
  score: number;
  scam_type: string;
  explanation: string;
  signals: string[];
  user_proceeded: boolean;
  blocked: boolean;
  timestamp: string;
  breakdown?: ScanBreakdown;
  domain_age?: { age_days: number | null; registered_on: string | null; source: string };
};

export interface HealthStatus {
  status: string;
  version: string;
  modules: Record<string, boolean>;
}

export interface AppError {
  message: string;
  code?: string;
  retryable: boolean;
}

export interface MessageAnalysis {
  scan_type: string;
  risk_level: string;
  risk_score: number;
  scam_category: string;
  signals_triggered: SignalItem[];
  recommendation: string;
  user_alert: string;
}

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
