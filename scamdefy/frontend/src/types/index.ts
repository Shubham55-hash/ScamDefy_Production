export type Verdict = 'SAFE' | 'CAUTION' | 'DANGER' | 'BLOCKED';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
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
}

export interface VoiceResult {
  id: string;
  verdict: VoiceVerdict;
  confidence: number;
  confidence_pct: number;
  model_loaded: boolean;
  reason?: string;
  warning?: string;
  timestamp: string;
}

export interface LiveVerdictEntry {
  id: string;
  timestamp: string;
  verdict: VoiceVerdict;
  confidence_pct: number;
  reason?: string;
  chunk_number: number;
}

export interface ThreatEntry {
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
}

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
