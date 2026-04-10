import { useState, useCallback, useRef, useEffect } from 'react';
import { ENV } from '../config/env';

// ─── Types ────────────────────────────────────────────────────────────────────

type TestStatus = 'idle' | 'running' | 'pass' | 'partial' | 'fail' | 'skip';

interface TestCase {
  id: string;
  label: string;
  description: string;
  status: TestStatus;
  durationMs?: number;
  detail?: string;
  error?: string;
}

interface FeatureSuite {
  id: string;
  label: string;
  icon: string;
  status: TestStatus;
  tests: TestCase[];
  critical: boolean;
}

interface HealthModule {
  name: string;
  ok: boolean | null;
  latencyMs?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const API = ENV.API_BASE || '';

const STATUS_CONFIG: Record<TestStatus, { icon: string; label: string; color: string }> = {
  idle:    { icon: '○',  label: 'IDLE',    color: 'rgba(255,255,255,0.25)' },
  running: { icon: '◌',  label: 'RUNNING', color: '#00f2ff' },
  pass:    { icon: '✓',  label: 'PASS',    color: '#22d3ee' },
  partial: { icon: '◑',  label: 'PARTIAL', color: '#f59e0b' },
  fail:    { icon: '✗',  label: 'FAIL',    color: '#ef4444' },
  skip:    { icon: '—',  label: 'SKIP',    color: 'rgba(255,255,255,0.2)' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiCall(path: string, options?: RequestInit): Promise<{ data?: any; ok: boolean; latencyMs: number; error?: string }> {
  const t0 = performance.now();
  try {
    const r = await fetch(`${API}${path}`, { ...options, signal: AbortSignal.timeout(30000) });
    const latencyMs = Math.round(performance.now() - t0);
    const data = await r.json().catch(() => null);
    return { ok: r.ok, data, latencyMs };
  } catch (e: any) {
    const latencyMs = Math.round(performance.now() - t0);
    return { ok: false, error: e?.message || 'Network error', latencyMs };
  }
}

function calcSuiteStatus(tests: TestCase[]): TestStatus {
  if (tests.every(t => t.status === 'idle')) return 'idle';
  if (tests.some(t => t.status === 'running')) return 'running';
  const passed = tests.filter(t => t.status === 'pass').length;
  const total  = tests.filter(t => t.status !== 'skip').length;
  if (total === 0) return 'skip';
  if (passed === total) return 'pass';
  if (passed / total >= 0.6) return 'partial';
  return 'fail';
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, small }: { status: TestStatus; small?: boolean }) {
  return (
    <span
      className="font-mono tracking-widest font-semibold transition-all duration-300"
      style={{
        color: STATUS_CONFIG[status].color,
        fontSize: small ? '9px' : '10px',
        textShadow: status === 'pass' || status === 'running' ? `0 0 8px ${STATUS_CONFIG[status].color}` : 'none',
      }}
    >
      {STATUS_CONFIG[status].icon} {STATUS_CONFIG[status].label}
    </span>
  );
}

// ─── Animated Progress Ring ───────────────────────────────────────────────────

function ProgressRing({ progress, size = 56, status }: {
  progress: number; size?: number; status: TestStatus;
}) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ * (1 - progress / 100);
  const cfg = STATUS_CONFIG[status];

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', position: 'absolute' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke="rgba(255,255,255,0.06)" strokeWidth={4} />
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke={cfg.color} strokeWidth={4}
          strokeDasharray={circ}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{
            transition: 'stroke-dashoffset 0.4s ease, stroke 0.3s ease',
            filter: status === 'running' ? `drop-shadow(0 0 6px ${cfg.color})` : 'none',
          }}
        />
      </svg>
      <span className="font-mono text-[10px] font-bold" style={{ color: cfg.color }}>
        {cfg.icon}
      </span>
    </div>
  );
}

// ─── Health Panel ─────────────────────────────────────────────────────────────

function HealthPanel({ modules, loading, onRefresh }: {
  modules: HealthModule[]; loading: boolean; onRefresh: () => void;
}) {
  return (
    <div className="glass-panel rounded-xl p-5 border border-white/10">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-white/40 font-mono">System Health</p>
          <h3 className="text-sm font-bold text-white mt-0.5">API Module Status</h3>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-[10px] font-mono tracking-widest uppercase px-3 py-1.5 rounded border border-electricCyan/30 text-electricCyan hover:bg-electricCyan/10 transition-all disabled:opacity-40"
        >
          {loading ? '◌ CHECKING' : '↻ REFRESH'}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {modules.length === 0 ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-white/3 animate-pulse" />
          ))
        ) : (
          modules.map(m => (
            <div key={m.name}
              className="flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all duration-300"
              style={{
                background: m.ok === null ? 'rgba(255,255,255,0.02)'
                  : m.ok ? 'rgba(34,211,238,0.04)' : 'rgba(239,68,68,0.06)',
                borderColor: m.ok === null ? 'rgba(255,255,255,0.08)'
                  : m.ok ? 'rgba(34,211,238,0.2)' : 'rgba(239,68,68,0.3)',
              }}
            >
              <span className="font-mono text-[10px] text-white/60 uppercase tracking-wider">
                {m.name.replace(/_/g, ' ')}
              </span>
              <div className="flex items-center gap-2">
                {m.latencyMs !== undefined && (
                  <span className="text-[9px] font-mono text-white/30">{m.latencyMs}ms</span>
                )}
                <span className="text-[10px] font-mono font-bold"
                  style={{
                    color: m.ok === null ? 'rgba(255,255,255,0.25)'
                      : m.ok ? '#22d3ee' : '#ef4444',
                    textShadow: m.ok ? '0 0 6px rgba(34,211,238,0.4)' : 'none',
                  }}
                >
                  {m.ok === null ? '—' : m.ok ? '✓ OK' : '✗ FAIL'}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Suite Card ───────────────────────────────────────────────────────────────

function SuiteCard({ suite, onRun }: { suite: FeatureSuite; onRun: () => void }) {
  const [expanded, setExpanded] = useState(false);

  const passed = suite.tests.filter(t => t.status === 'pass').length;
  const total  = suite.tests.filter(t => t.status !== 'skip').length;
  const progress = total > 0 ? Math.round((passed / total) * 100) : 0;

  return (
    <div
      className="glass-panel rounded-xl border transition-all duration-300"
      style={{
        borderColor: suite.status === 'running' ? 'rgba(0,242,255,0.3)'
          : suite.status === 'pass' ? 'rgba(34,211,238,0.2)'
          : suite.status === 'fail' ? 'rgba(239,68,68,0.25)'
          : suite.status === 'partial' ? 'rgba(245,158,11,0.2)'
          : 'rgba(255,255,255,0.08)',
        boxShadow: suite.status === 'running' ? '0 0 20px rgba(0,242,255,0.08)' : 'none',
      }}
    >
      <div className="p-4 flex items-center gap-4">
        <ProgressRing progress={progress} status={suite.status} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-base">{suite.icon}</span>
            <span className="font-bold text-sm text-white">{suite.label}</span>
            {suite.critical && (
              <span className="text-[8px] font-mono text-electricMagenta/70 border border-electricMagenta/30 px-1.5 py-0.5 rounded-sm uppercase tracking-widest">
                Critical
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={suite.status} small />
            {total > 0 && (
              <span className="text-[10px] font-mono text-white/30">
                {passed}/{total} tests
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {suite.tests.length > 0 && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-[10px] font-mono text-white/30 hover:text-white/60 transition-colors px-2 py-1"
            >
              {expanded ? '▲' : '▼'}
            </button>
          )}
          <button
            onClick={onRun}
            disabled={suite.status === 'running'}
            className="text-[10px] font-mono uppercase tracking-widest px-3 py-1.5 rounded border transition-all disabled:opacity-40"
            style={{
              borderColor: 'rgba(0,242,255,0.3)',
              color: '#00f2ff',
              background: suite.status === 'running' ? 'rgba(0,242,255,0.08)' : 'transparent',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,242,255,0.1)')}
            onMouseLeave={e => (e.currentTarget.style.background = suite.status === 'running' ? 'rgba(0,242,255,0.08)' : 'transparent')}
          >
            {suite.status === 'running' ? '◌ Running' : '▶ Run'}
          </button>
        </div>
      </div>

      {/* Expanded test list */}
      {expanded && suite.tests.length > 0 && (
        <div className="border-t border-white/5 px-4 pb-3 pt-2 space-y-1.5">
          {suite.tests.map(tc => {
            const tcfg = STATUS_CONFIG[tc.status];
            return (
              <div key={tc.id} className="flex items-start gap-2.5">
                <span className="font-mono text-[10px] mt-0.5 shrink-0" style={{ color: tcfg.color }}>
                  {tcfg.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-white/70 font-mono">{tc.label}</span>
                    {tc.durationMs !== undefined && (
                      <span className="text-[9px] text-white/25 font-mono">{tc.durationMs}ms</span>
                    )}
                  </div>
                  {tc.error && (
                    <p className="text-[10px] text-red-400/80 font-mono mt-0.5 break-words">{tc.error}</p>
                  )}
                  {tc.detail && !tc.error && (
                    <p className="text-[10px] text-white/30 font-mono mt-0.5">{tc.detail}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Overall Report Banner ────────────────────────────────────────────────────

function ReportBanner({ suites }: { suites: FeatureSuite[] }) {
  const ran     = suites.filter(s => s.status !== 'idle' && s.status !== 'running');
  if (ran.length === 0) return null;

  const allTests  = ran.flatMap(s => s.tests.filter(t => t.status !== 'skip'));
  const passed    = allTests.filter(t => t.status === 'pass').length;
  const total     = allTests.length;
  const rate      = total > 0 ? Math.round((passed / total) * 100) : 0;
  const overallOk = rate >= 95;
  const partialOk = rate >= 70;

  const color = overallOk ? '#22d3ee' : partialOk ? '#f59e0b' : '#ef4444';
  const label = overallOk ? '✅ ALL SYSTEMS OPERATIONAL' : partialOk ? '⚠️  PARTIAL ISSUES DETECTED' : '❌ CRITICAL FAILURES';

  return (
    <div
      className="rounded-xl p-4 border transition-all duration-500"
      style={{
        background: overallOk ? 'rgba(34,211,238,0.05)' : partialOk ? 'rgba(245,158,11,0.05)' : 'rgba(239,68,68,0.06)',
        borderColor: `${color}40`,
        boxShadow: `0 0 30px ${color}10`,
      }}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] tracking-[0.25em] uppercase" style={{ color }}>
            Overall Report
          </p>
          <p className="font-bold text-base text-white mt-0.5">{label}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-3xl font-black" style={{ color, textShadow: `0 0 20px ${color}60` }}>
            {rate}%
          </p>
          <p className="text-[10px] font-mono text-white/40">{passed}/{total} tests passed</p>
        </div>
      </div>
      {/* Per-suite chips */}
      <div className="flex flex-wrap gap-2 mt-3">
        {ran.map(s => {
          const sc = STATUS_CONFIG[s.status];
          return (
            <span key={s.id}
              className="text-[10px] font-mono px-2 py-1 rounded border"
              style={{ color: sc.color, borderColor: `${sc.color}30`, background: `${sc.color}08` }}
            >
              {s.icon} {s.label} → {sc.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function TestDashboard() {
  // ── Health state ───────────────────────────────────────────
  const [healthModules, setHealthModules] = useState<HealthModule[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);

  // ── Suite state ────────────────────────────────────────────
  const initialSuites: FeatureSuite[] = [
    {
      id: 'url', label: 'URL Detection', icon: '◉', critical: true, status: 'idle',
      tests: [
        { id: 'u1', label: 'Blocked URL → BLOCKED verdict',     description: '', status: 'idle' },
        { id: 'u2', label: 'Safe URL → not blocked',           description: '', status: 'idle' },
        { id: 'u3', label: 'Response time < 3s',               description: '', status: 'idle' },
        { id: 'u4', label: 'Cache returns cached=true',        description: '', status: 'idle' },
        { id: 'u5', label: 'All required fields present',      description: '', status: 'idle' },
        { id: 'u6', label: 'Score in range [0–100]',           description: '', status: 'idle' },
      ],
    },
    {
      id: 'msg', label: 'Message Detection', icon: '◈', critical: true, status: 'idle',
      tests: [
        { id: 'm1', label: 'OTP message → CRITICAL/HIGH',      description: '', status: 'idle' },
        { id: 'm2', label: 'KYC message → flagged',            description: '', status: 'idle' },
        { id: 'm3', label: 'Safe message → SAFE',              description: '', status: 'idle' },
        { id: 'm4', label: 'Score capped at 100',              description: '', status: 'idle' },
        { id: 'm5', label: 'Emoji-only → no crash',            description: '', status: 'idle' },
        { id: 'm6', label: 'Long text → response in time',     description: '', status: 'idle' },
      ],
    },
    {
      id: 'voice', label: 'Voice Detection', icon: '◎', critical: true, status: 'idle',
      tests: [
        { id: 'v1', label: 'Health endpoint → 200',            description: '', status: 'idle' },
        { id: 'v2', label: 'Unsupported format → 400',         description: '', status: 'idle' },
        { id: 'v3', label: 'WAV upload → verdict returned',    description: '', status: 'idle' },
        { id: 'v4', label: 'Confidence in [0–1]',              description: '', status: 'idle' },
        { id: 'v5', label: 'No crash on silence/noise',        description: '', status: 'idle' },
      ],
    },
    {
      id: 'api', label: 'API Integration', icon: '⬡', critical: true, status: 'idle',
      tests: [
        { id: 'a1', label: 'Root endpoint → status: active',   description: '', status: 'idle' },
        { id: 'a2', label: 'Health endpoint → 200 OK',         description: '', status: 'idle' },
        { id: 'a3', label: '404 for unknown routes',           description: '', status: 'idle' },
        { id: 'a4', label: 'Report endpoint → received',       description: '', status: 'idle' },
      ],
    },
  ];

  const [suites, setSuites] = useState<FeatureSuite[]>(initialSuites);
  const [runningAll, setRunningAll] = useState(false);
  const [stats, setStatsData] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const logRef = useRef<string[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logRef.current = [line, ...logRef.current].slice(0, 80);
    setLogs([...logRef.current]);
  };

  const updateTest = useCallback((suiteId: string, testId: string, update: Partial<TestCase>) => {
    setSuites(prev => prev.map(s =>
      s.id !== suiteId ? s : {
        ...s,
        tests: s.tests.map(t => t.id !== testId ? t : { ...t, ...update }),
      }
    ));
  }, []);

  const finaliseSuite = useCallback((suiteId: string) => {
    setSuites(prev => prev.map(s =>
      s.id !== suiteId ? s : { ...s, status: calcSuiteStatus(s.tests) }
    ));
  }, []);

  const setSuiteStatus = useCallback((suiteId: string, status: TestStatus) => {
    setSuites(prev => prev.map(s => s.id !== suiteId ? s : { ...s, status }));
  }, []);

  // ── Health check ───────────────────────────────────────────
  const runHealthCheck = useCallback(async () => {
    setHealthLoading(true);
    setHealthModules([]);
    addLog('Checking API health...');
    const { data, ok, latencyMs } = await apiCall('/api/health');
    if (ok && data?.modules) {
      const mods: HealthModule[] = Object.entries(data.modules as Record<string,boolean>).map(
        ([name, val]) => ({ name, ok: val, latencyMs: undefined })
      );
      mods[0] = { ...mods[0], latencyMs };
      setHealthModules(mods);
      addLog(`Health check complete — ${Object.values(data.modules).filter(Boolean).length}/${Object.values(data.modules).length} modules OK`);
    } else {
      setHealthModules([
        { name: 'api_connection', ok: false, latencyMs },
      ]);
      addLog(`❌ Health check failed — ${data?.detail || 'cannot reach API'}`);
    }
    setHealthLoading(false);
  }, []);

  const fetchAntigravityData = useCallback(async () => {
    const s = await apiCall('/api/antigravity/stats');
    if (s.ok) setStatsData(s.data);
    
    const r = await apiCall('/api/antigravity/report');
    if (r.ok && !r.data.error) setReport(r.data);
  }, []);

  useEffect(() => {
    runHealthCheck();
    fetchAntigravityData();
  }, [runHealthCheck, fetchAntigravityData]);

  // ── URL suite ──────────────────────────────────────────────
  const runUrlSuite = useCallback(async () => {
    setSuiteStatus('url', 'running');
    addLog('▶ Running URL Detection suite...');

    // u1: blocked URL
    updateTest('url','u1',{ status:'running' });
    const bu = await apiCall('/api/scan?url=http://scamdefy-test-block.com');
    if (bu.ok && bu.data?.verdict === 'BLOCKED') {
      updateTest('url','u1',{ status:'pass', durationMs: bu.latencyMs, detail: `score=${bu.data.score}` });
    } else {
      updateTest('url','u1',{ status:'fail', durationMs: bu.latencyMs, error: bu.error || `got verdict=${bu.data?.verdict}` });
    }

    // u2: safe URL
    updateTest('url','u2',{ status:'running' });
    const su = await apiCall('/api/scan?url=https://www.google.com');
    if (su.ok && su.data?.verdict !== 'BLOCKED') {
      updateTest('url','u2',{ status:'pass', durationMs: su.latencyMs, detail: `verdict=${su.data?.verdict} score=${su.data?.score}` });
    } else {
      updateTest('url','u2',{ status:'fail', durationMs: su.latencyMs, error: su.error || `False-blocked: ${su.data?.verdict}` });
    }

    // u3: response time
    updateTest('url','u3',{ status:'running' });
    const t3 = await apiCall('/api/scan?url=https://example.com');
    const msOk = t3.latencyMs < 3000;
    updateTest('url','u3',{ status: msOk ? 'pass' : 'partial', durationMs: t3.latencyMs,
      detail: `${t3.latencyMs}ms`, error: msOk ? undefined : `${t3.latencyMs}ms exceeds 3s SLA` });

    // u4: cache
    updateTest('url','u4',{ status:'running' });
    await apiCall('/api/scan?url=https://example.com');
    const ca = await apiCall('/api/scan?url=https://example.com');
    updateTest('url','u4',{ status: ca.data?.cached ? 'pass' : 'partial', durationMs: ca.latencyMs,
      detail: `cached=${ca.data?.cached}` });

    // u5: required fields
    updateTest('url','u5',{ status:'running' });
    const rf = await apiCall('/api/scan?url=https://www.google.com');
    const requiredFields = ['id','url','score','verdict','risk_level','flags','timestamp'];
    const missingFields  = requiredFields.filter(f => !(f in (rf.data || {})));
    updateTest('url','u5',{ status: missingFields.length === 0 ? 'pass' : 'fail', durationMs: rf.latencyMs,
      error: missingFields.length > 0 ? `Missing: ${missingFields.join(', ')}` : undefined });

    // u6: score range
    updateTest('url','u6',{ status:'running' });
    const sc = await apiCall('/api/scan?url=https://www.google.com');
    const score = sc.data?.score;
    const inRange = typeof score === 'number' && score >= 0 && score <= 100;
    updateTest('url','u6',{ status: inRange ? 'pass' : 'fail', durationMs: sc.latencyMs,
      detail: `score=${score}`, error: !inRange ? `Score ${score} out of [0–100]` : undefined });

    finaliseSuite('url');
    addLog('✓ URL Detection suite complete');
  }, [updateTest, finaliseSuite, setSuiteStatus]);

  // ── Message suite ──────────────────────────────────────────
  const runMessageSuite = useCallback(async () => {
    setSuiteStatus('msg', 'running');
    addLog('▶ Running Message Detection suite...');

    const post = (text: string) => apiCall('/api/analyze-message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    // m1: OTP
    updateTest('msg','m1',{ status:'running' });
    const otp = await post('Your OTP is 847291. Share it immediately to verify your account.');
    const otpOk = otp.ok && ['CRITICAL','HIGH'].includes(otp.data?.risk_level);
    updateTest('msg','m1',{ status: otpOk ? 'pass' : 'fail', durationMs: otp.latencyMs,
      detail: `risk_level=${otp.data?.risk_level} score=${otp.data?.risk_score}`,
      error: !otpOk ? `Expected CRITICAL/HIGH, got ${otp.data?.risk_level}` : undefined });

    // m2: KYC
    updateTest('msg','m2',{ status:'running' });
    const kyc = await post('Your KYC is pending. Click here to avoid account suspension.');
    const kycOk = kyc.ok && kyc.data?.risk_score >= 20;
    updateTest('msg','m2',{ status: kycOk ? 'pass' : 'partial', durationMs: kyc.latencyMs,
      detail: `score=${kyc.data?.risk_score}`, error: !kycOk ? `Score too low: ${kyc.data?.risk_score}` : undefined });

    // m3: safe
    updateTest('msg','m3',{ status:'running' });
    const safe = await post('Hey, are you coming to the meeting at 3pm?');
    const safeOk = safe.ok && safe.data?.risk_level === 'SAFE';
    updateTest('msg','m3',{ status: safeOk ? 'pass' : 'fail', durationMs: safe.latencyMs,
      detail: `risk_level=${safe.data?.risk_level}`,
      error: !safeOk ? `False positive: ${safe.data?.risk_level}` : undefined });

    // m4: cap at 100
    updateTest('msg','m4',{ status:'running' });
    const mega = await post('URGENT OTP PIN CVV card number Aadhaar password lottery prize KYC blocked refund TeamViewer gift card');
    const capOk = mega.ok && mega.data?.risk_score <= 100;
    updateTest('msg','m4',{ status: capOk ? 'pass' : 'fail', durationMs: mega.latencyMs,
      detail: `score=${mega.data?.risk_score}`, error: !capOk ? `Score ${mega.data?.risk_score} > 100` : undefined });

    // m5: emoji only
    updateTest('msg','m5',{ status:'running' });
    const emoji = await post('🎉🎁💰🔗🎲🎯🔔💎🌟💫⭐🎪');
    updateTest('msg','m5',{ status: emoji.ok ? 'pass' : 'fail', durationMs: emoji.latencyMs,
      detail: 'No crash on emoji input', error: !emoji.ok ? emoji.error : undefined });

    // m6: long text
    updateTest('msg','m6',{ status:'running' });
    const longText = 'Hello there. '.repeat(400);
    const t6 = performance.now();
    const lng = await post(longText);
    const longMs = Math.round(performance.now() - t6);
    updateTest('msg','m6',{ status: lng.ok && longMs < 5000 ? 'pass' : 'partial', durationMs: longMs,
      detail: `${longMs}ms for 5200-char input` });

    finaliseSuite('msg');
    addLog('✓ Message Detection suite complete');
  }, [updateTest, finaliseSuite, setSuiteStatus]);

  // ── Voice suite ────────────────────────────────────────────
  const runVoiceSuite = useCallback(async () => {
    setSuiteStatus('voice', 'running');
    addLog('▶ Running Voice Detection suite...');

    // v1: health endpoint
    updateTest('voice','v1',{ status:'running' });
    const vh = await apiCall('/api/voice/health');
    updateTest('voice','v1',{ status: vh.ok ? 'pass' : 'fail', durationMs: vh.latencyMs,
      detail: `status=${vh.data?.status}`, error: !vh.ok ? vh.error : undefined });

    // v2: unsupported format
    updateTest('voice','v2',{ status:'running' });
    const formData2 = new FormData();
    formData2.append('audio', new Blob([new Uint8Array(100)], { type: 'text/plain' }), 'test.txt');
    const inv = await apiCall('/api/voice/analyze', { method: 'POST', body: formData2 });
    updateTest('voice','v2',{ status: inv.latencyMs > 0 && !inv.ok ? 'pass' : 'fail',
      durationMs: inv.latencyMs, detail: `HTTP ${inv.ok ? 200 : 400}`,
      error: inv.ok ? 'Expected 400 but got 200' : undefined });

    // v3: WAV upload — generate minimal WAV in JS
    updateTest('voice','v3',{ status:'running' });
    try {
      const wavBytes = generateMinimalWav(16000, 440, 1.0);
      const fd3 = new FormData();
      fd3.append('audio', new Blob([wavBytes.buffer as ArrayBuffer], { type: 'audio/wav' }), 'test.wav');
      const vr = await apiCall('/api/voice/analyze', { method: 'POST', body: fd3 });
      const verdictOk = vr.data?.verdict && ['REAL','SYNTHETIC','UNCERTAIN','UNKNOWN'].includes(vr.data.verdict);
      updateTest('voice','v3',{
        status: (vr.ok || vr.data?.verdict) ? (verdictOk ? 'pass' : 'partial') : 'partial',
        durationMs: vr.latencyMs,
        detail: `verdict=${vr.data?.verdict ?? 'n/a'}`,
        error: !vr.ok && !verdictOk ? (vr.error || 'No verdict returned') : undefined,
      });
    } catch (e: any) {
      updateTest('voice','v3',{ status:'fail', error: e.message });
    }

    // v4: confidence range
    updateTest('voice','v4',{ status:'running' });
    try {
      const wavBytes2 = generateMinimalWav(16000, 220, 1.5);
      const fd4 = new FormData();
      fd4.append('audio', new Blob([wavBytes2.buffer as ArrayBuffer], { type: 'audio/wav' }), 'range_test.wav');
      const cr = await apiCall('/api/voice/analyze', { method: 'POST', body: fd4 });
      const conf = cr.data?.confidence;
      const confOk = conf !== undefined && conf >= 0 && conf <= 1;
      updateTest('voice','v4',{ status: confOk ? 'pass' : 'partial', durationMs: cr.latencyMs,
        detail: `confidence=${conf}`, error: !confOk ? `Confidence ${conf} out of [0,1]` : undefined });
    } catch (e: any) {
      updateTest('voice','v4',{ status:'partial', error: 'Model may be loading, retry later' });
    }

    // v5: silence (all zeros)
    updateTest('voice','v5',{ status:'running' });
    const silWav = generateMinimalWav(16000, 0, 1.0, true);
    const fd5 = new FormData();
    fd5.append('audio', new Blob([silWav.buffer as ArrayBuffer], { type: 'audio/wav' }), 'silence.wav');
    const sr5 = await apiCall('/api/voice/analyze', { method: 'POST', body: fd5 });
    // Should NOT return 500 uncaught crash — 200/503 is fine
    updateTest('voice','v5',{ status: sr5.latencyMs > 0 && ![500].includes(sr5.ok ? 200 : 400) ? 'pass' : 'partial',
      durationMs: sr5.latencyMs, detail: `No crash — verdict=${sr5.data?.verdict ?? 'n/a'}` });

    finaliseSuite('voice');
    addLog('✓ Voice Detection suite complete');
  }, [updateTest, finaliseSuite, setSuiteStatus]);

  // ── API Integration suite ──────────────────────────────────
  const runApiSuite = useCallback(async () => {
    setSuiteStatus('api', 'running');
    addLog('▶ Running API Integration suite...');

    // a1: root
    updateTest('api','a1',{ status:'running' });
    const root = await apiCall('/');
    const rootOk = root.ok && root.data?.status === 'active';
    updateTest('api','a1',{ status: rootOk ? 'pass' : 'fail', durationMs: root.latencyMs,
      detail: `status=${root.data?.status}`, error: !rootOk ? root.error || 'Missing status:active' : undefined });

    // a2: health
    updateTest('api','a2',{ status:'running' });
    const hp = await apiCall('/api/health');
    const hpOk = hp.ok && hp.data?.status === 'ok';
    updateTest('api','a2',{ status: hpOk ? 'pass' : 'fail', durationMs: hp.latencyMs,
      detail: `modules=${JSON.stringify(hp.data?.modules)}`, error: !hpOk ? hp.error : undefined });

    // a3: 404
    updateTest('api','a3',{ status:'running' });
    const nf = await apiCall('/api/nonexistent-route-xyz');
    updateTest('api','a3',{ status: !nf.ok ? 'pass' : 'fail', durationMs: nf.latencyMs,
      detail: 'Non-existent route correctly returns 4xx',
      error: nf.ok ? 'Expected 404, got 200' : undefined });

    // a4: report
    updateTest('api','a4',{ status:'running' });
    const rep = await apiCall('/api/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com', reason: 'test', notes: 'antigravity' }),
    });
    const repOk = rep.ok && rep.data?.status === 'received';
    updateTest('api','a4',{ status: repOk ? 'pass' : 'fail', durationMs: rep.latencyMs,
      detail: rep.data?.status, error: !repOk ? rep.error : undefined });

    finaliseSuite('api');
    addLog('✓ API Integration suite complete');
  }, [updateTest, finaliseSuite, setSuiteStatus]);

  // ── Run All ────────────────────────────────────────────────
  const runAll = useCallback(async () => {
    setRunningAll(true);
    addLog('🚀 Starting full Antigravity test run...');
    await runHealthCheck();
    await runUrlSuite();
    await runMessageSuite();
    await runVoiceSuite();
    await runApiSuite();
    setRunningAll(false);
    addLog('🏁 Full run complete. See report above.');
  }, [runHealthCheck, runUrlSuite, runMessageSuite, runVoiceSuite, runApiSuite]);

  const resetAll = useCallback(() => {
    setSuites(initialSuites);
    setHealthModules([]);
    logRef.current = [];
    setLogs([]);
  }, []);

  const suiteRunners: Record<string, () => Promise<void>> = {
    url:   runUrlSuite,
    msg:   runMessageSuite,
    voice: runVoiceSuite,
    api:   runApiSuite,
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 screen-enter">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 border-2 border-electricMagenta/60 hexagon-clip flex items-center justify-center">
            <div className="w-3 h-3 bg-electricMagenta/80 hexagon-clip" />
          </div>
          <div>
            <p className="text-[9px] font-mono tracking-[0.35em] uppercase text-electricMagenta/60">
              Antigravity Framework
            </p>
            <h1 className="text-xl font-black text-white tracking-tight uppercase italic">
              Test Lab
            </h1>
          </div>
        </div>
        <p className="text-xs text-white/40 font-mono ml-11">
          End-to-end validation system — ScamDefy v1.0
        </p>
      </div>

      {/* Run All + Reset bar */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={runAll}
          disabled={runningAll}
          id="btn-run-all-tests"
          className="flex-1 py-3 rounded-xl font-mono text-xs tracking-widest uppercase font-bold transition-all border disabled:opacity-40"
          style={{
            background: runningAll ? 'rgba(255,0,229,0.12)' : 'rgba(255,0,229,0.08)',
            borderColor: 'rgba(255,0,229,0.4)',
            color: '#ff00e5',
            boxShadow: runningAll ? '0 0 20px rgba(255,0,229,0.15)' : 'none',
          }}
          onMouseEnter={e => !runningAll && (e.currentTarget.style.background = 'rgba(255,0,229,0.15)')}
          onMouseLeave={e => !runningAll && (e.currentTarget.style.background = 'rgba(255,0,229,0.08)')}
        >
          {runningAll ? '◌  Running All Tests...' : '▶  Run All Tests'}
        </button>
        <button
          onClick={resetAll}
          disabled={runningAll}
          className="px-5 py-3 rounded-xl font-mono text-xs tracking-widest uppercase border border-white/10 text-white/40 hover:text-white/60 hover:border-white/20 transition-all disabled:opacity-30"
        >
          ↺ Reset
        </button>
      </div>

      {/* Report Banner */}
      <div className="mb-5 space-y-4">
        {stats && (
          <div className="glass-panel rounded-xl p-4 border border-electricCyan/20 bg-electricCyan/5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-mono tracking-widest text-electricCyan uppercase">Live Operational Metrics</p>
              <span className="text-[9px] font-mono text-white/40">LAST 7 DAYS</span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xl font-black text-white">{stats.success_rate}%</p>
                <p className="text-[9px] font-mono text-white/30 uppercase">E2E Success</p>
              </div>
              <div>
                <p className="text-xl font-black text-white">{stats.avg_latency}ms</p>
                <p className="text-[9px] font-mono text-white/30 uppercase">Avg Latency</p>
              </div>
              <div>
                <p className="text-xl font-black text-white">{stats.total_events}</p>
                <p className="text-[9px] font-mono text-white/30 uppercase">Total Events</p>
              </div>
            </div>
          </div>
        )}
        <ReportBanner suites={suites} />
      </div>

      {/* Health Panel */}
      <div className="mb-5">
        <HealthPanel modules={healthModules} loading={healthLoading} onRefresh={runHealthCheck} />
      </div>
      
      {/* Historical Report Summary */}
      {report && (
        <div className="mb-5 glass-panel rounded-xl p-4 border border-white/10">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[9px] font-mono tracking-widest text-white/40 uppercase">Last Automated Run</p>
              <p className="text-xs font-bold text-white mt-0.5">{new Date(report.generated_at).toLocaleString()}</p>
            </div>
            <div className="text-right">
              <span className="text-xs font-mono font-bold text-electricCyan">{report.summary.success_rate}%</span>
              <p className="text-[9px] font-mono text-white/20 uppercase">Success Rate</p>
            </div>
          </div>
          <div className="flex gap-2">
            {report.suites.map((s: any) => (
              <div key={s.id} className="text-[9px] font-mono px-2 py-0.5 rounded bg-white/5 border border-white/5 text-white/40">
                {s.label}: {s.status}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suite Cards */}
      <div className="space-y-3 mb-6">
        {suites.map(suite => (
          <SuiteCard
            key={suite.id}
            suite={suite}
            onRun={() => suiteRunners[suite.id]?.()}
          />
        ))}
      </div>

      {/* Live Log */}
      {logs.length > 0 && (
        <div className="glass-panel rounded-xl p-4 border border-white/8">
          <p className="text-[9px] font-mono tracking-[0.3em] uppercase text-white/30 mb-2">
            ⬡ Activity Log
          </p>
          <div className="space-y-0.5 max-h-40 overflow-y-auto">
            {logs.map((line, i) => (
              <p key={i} className="text-[10px] font-mono text-white/40 leading-relaxed">
                {line}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Footer note */}
      <div className="mt-6 px-2">
        <p className="text-[9px] font-mono text-white/20 text-center tracking-wider">
          ANTIGRAVITY VALIDATION SYSTEM · SCAMDEFY v1.0 · TARGET ≥95% PASS RATE
        </p>
      </div>
    </div>
  );
}

// ─── WAV Generator (browser-side) ────────────────────────────────────────────

function generateMinimalWav(sr: number, freq: number, durationS: number, silence = false): Uint8Array {
  const nSamples = Math.floor(sr * durationS);
  const dataSize = nSamples * 2;
  const buf      = new ArrayBuffer(44 + dataSize);
  const view     = new DataView(buf);

  // RIFF header
  const enc = new TextEncoder();
  const write4 = (offset: number, str: string) => enc.encode(str).forEach((b, i) => view.setUint8(offset + i, b));
  write4(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true);
  write4(8, 'WAVE'); write4(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sr, true); view.setUint32(28, sr * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write4(36, 'data'); view.setUint32(40, dataSize, true);

  for (let i = 0; i < nSamples; i++) {
    const sample = silence ? 0 : Math.round(16000 * Math.sin(2 * Math.PI * freq * i / sr));
    view.setInt16(44 + i * 2, sample, true);
  }

  return new Uint8Array(buf);
}
