import { useState, useRef } from 'react';
import { useSafetyCircle } from '../hooks/useSafetyCircle';
import type { Guardian } from '../hooks/useSafetyCircle';
import { useAppStore } from '../store/appStore';

// ── Tiny sub-components ──────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-electricCyan mb-4">
      ▹ {children}
    </p>
  );
}

function GlassCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl p-6 mb-6 ${className}`}
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      {children}
    </div>
  );
}

// ── Guardian card ────────────────────────────────────────────────────────────

interface GuardianCardProps {
  guardian: Guardian;
  onRemove: (id: string) => void;
}

function GuardianCard({ guardian, onRemove }: GuardianCardProps) {
  const [confirming, setConfirming] = useState(false);

  const initials = guardian.name
    .split(' ')
    .map(p => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const added = new Date(guardian.addedAt).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  return (
    <div
      className="flex items-center gap-4 p-4 rounded-xl transition-all"
      style={{ background: 'rgba(0,242,255,0.03)', border: '1px solid rgba(0,242,255,0.12)' }}
    >
      {/* Avatar */}
      <div
        className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-sm font-bold"
        style={{ background: 'rgba(0,242,255,0.12)', color: '#00f2ff', border: '1.5px solid rgba(0,242,255,0.3)' }}
      >
        {initials}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white truncate">{guardian.name}</p>
        <p className="text-[11px] font-mono text-white/40 truncate">{guardian.email}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[9px] font-mono uppercase tracking-wider text-emerald-400/70">
            ● Immediate Alerts Enabled
          </span>
          <span className="text-[9px] font-mono text-white/20">· Added {added}</span>
        </div>
      </div>

      {/* Remove */}
      {confirming ? (
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => onRemove(guardian.id)}
            className="text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-lg transition-all"
            style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.6)', color: '#f87171' }}
          >
            Confirm
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-lg transition-all"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="w-8 h-8 flex items-center justify-center rounded-lg shrink-0 transition-all text-white/25 hover:text-red-400 hover:bg-red-400/10"
          title="Remove guardian"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ── Add guardian form ────────────────────────────────────────────────────────

interface AddGuardianFormProps {
  onAdd: (name: string, email: string) => boolean;
}

function AddGuardianForm({ onAdd }: AddGuardianFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Name is required.'); return; }
    if (!EMAIL_RE.test(email.trim())) { setError('Enter a valid email address.'); return; }

    const added = onAdd(name.trim(), email.trim());
    if (!added) {
      setError('Could not add guardian. You may already have 2 guardians, or this email is already added.');
      return;
    }
    setName('');
    setEmail('');
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
    nameRef.current?.focus();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-widest text-white/30 mb-1.5">
            Guardian's Name
          </label>
          <input
            ref={nameRef}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Mom, Rahul"
            maxLength={80}
            className="w-full px-4 py-2.5 rounded-xl text-sm text-white placeholder-white/20 outline-none transition-all"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              fontFamily: 'inherit',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'rgba(0,242,255,0.4)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')}
          />
        </div>
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-widest text-white/30 mb-1.5">
            Guardian's Email
          </label>
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="guardian@example.com"
            type="email"
            maxLength={120}
            className="w-full px-4 py-2.5 rounded-xl text-sm text-white placeholder-white/20 outline-none transition-all"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              fontFamily: 'inherit',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'rgba(0,242,255,0.4)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')}
          />
        </div>
      </div>

      {error && (
        <p className="text-[11px] text-red-400 font-mono">{error}</p>
      )}
      {success && (
        <p className="text-[11px] text-emerald-400 font-mono">✓ Guardian added successfully</p>
      )}

      <button
        type="submit"
        className="text-[11px] font-mono uppercase tracking-[0.2em] px-6 py-2.5 rounded-lg transition-all"
        style={{
          background: 'rgba(0,242,255,0.08)',
          border: '1px solid rgba(0,242,255,0.35)',
          color: '#00f2ff',
        }}
      >
        + Add Guardian
      </button>
    </form>
  );
}

// ── Threshold slider ─────────────────────────────────────────────────────────

function ThresholdSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const ticks = [
    { val: 30, label: 'Sensitive', desc: '≥ 30% risk', color: '#f97316' },
    { val: 50, label: 'Balanced', desc: '≥ 50% risk', color: '#00f2ff' },
    { val: 75, label: 'Critical only', desc: '≥ 75% risk', color: '#a78bfa' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {ticks.map(tick => {
          const active = value === tick.val;
          return (
            <button
              key={tick.val}
              onClick={() => onChange(tick.val)}
              className="p-4 rounded-xl text-left transition-all"
              style={{
                background: active ? `${tick.color}11` : 'rgba(255,255,255,0.02)',
                border: `1px solid ${active ? tick.color + '55' : 'rgba(255,255,255,0.08)'}`,
                boxShadow: active ? `0 0 16px ${tick.color}18` : 'none',
              }}
            >
              {active && (
                <div className="w-1.5 h-1.5 rounded-full mb-2" style={{ background: tick.color, boxShadow: `0 0 6px ${tick.color}` }} />
              )}
              <p
                className={`text-sm font-bold mb-0.5 ${active ? '' : 'text-white/50'}`}
                style={{ color: active ? tick.color : undefined }}
              >
                {tick.label}
              </p>
              <p className="text-[10px] font-mono text-white/25">{tick.desc}</p>
            </button>
          );
        })}
      </div>
      <p className="text-[10px] font-mono text-white/25">
        Guardian alerts fire when a scan crosses this risk threshold. Higher = fewer but more critical alerts.
      </p>
    </div>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

interface SafetyCircleProps {
  onBack?: () => void;
}

export function SafetyCircle({ onBack }: SafetyCircleProps) {
  const {
    settings,
    toggle,
    addGuardian,
    removeGuardian,
    setThreshold,
    setUserName,
    update,
  } = useSafetyCircle();
  const { addToast } = useAppStore();

  const handleToggle = () => {
    const next = !settings.enabled;
    toggle(next);
    addToast(
      next ? 'success' : 'info',
      next ? 'Safety Circle activated.' : 'Safety Circle paused.',
    );
  };

  const handleAddGuardian = (name: string, email: string): boolean => {
    const ok = addGuardian(name, email);
    if (ok) addToast('success', `${name} added as guardian.`);
    return ok;
  };

  const handleRemoveGuardian = (id: string) => {
    const g = settings.guardians.find(x => x.id === id);
    removeGuardian(id);
    if (g) addToast('info', `${g.name} removed from Safety Circle.`);
  };

  // Notification history (last notified per guardian)
  const notifiedEntries = Object.entries(settings.lastNotified).filter(
    ([email]) => settings.guardians.some(g => g.email === email),
  );

  return (
    <div className="min-h-screen px-4 md:px-8 py-8 max-w-2xl mx-auto">

      {/* ── Header ── */}
      <div className="mb-10">
        <div className="flex items-center gap-4 mb-2">
          {onBack && (
            <button
              onClick={onBack}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-white/30 hover:text-white transition-colors text-lg"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              ←
            </button>
          )}
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
            style={{ background: 'rgba(0,242,255,0.08)', border: '1px solid rgba(0,242,255,0.25)' }}
          >
            🛡
          </div>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tighter">Safety Circle</h1>
            <p className="text-[10px] font-mono text-white/25 uppercase tracking-widest">
              TRUSTED GUARDIAN ALERT SYSTEM
            </p>
          </div>
        </div>
      </div>

      {/* ── Master Toggle ── */}
      <div
        className="rounded-2xl p-6 mb-6 transition-all"
        style={{
          background: settings.enabled
            ? 'rgba(0,242,255,0.04)'
            : 'rgba(255,255,255,0.02)',
          border: `1px solid ${settings.enabled ? 'rgba(0,242,255,0.2)' : 'rgba(255,255,255,0.07)'}`,
          boxShadow: settings.enabled ? '0 0 32px rgba(0,242,255,0.05)' : 'none',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1 pr-6">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/40">▹ SYSTEM STATUS</p>
              {settings.enabled && (
                <span
                  className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(0,242,255,0.12)', color: '#00f2ff', border: '1px solid rgba(0,242,255,0.2)' }}
                >
                  ● ACTIVE
                </span>
              )}
            </div>
            <p className="text-base font-bold text-white mb-1">
              {settings.enabled ? 'Safety Circle is Active' : 'Safety Circle is Off'}
            </p>
            <p className="text-xs text-white/35 leading-relaxed">
              {settings.enabled
                ? `Guardians will be alerted when a scam risk exceeds ${settings.threshold}%.`
                : 'Enable to have trusted contacts notified when high-risk scams are detected.'}
            </p>
          </div>

          {/* Toggle switch */}
          <button
            id="safety-circle-toggle"
            onClick={handleToggle}
            className="relative shrink-0 w-14 h-7 rounded-full transition-all duration-300"
            style={{
              background: settings.enabled
                ? 'rgba(0,242,255,0.25)'
                : 'rgba(255,255,255,0.08)',
              border: `1px solid ${settings.enabled ? 'rgba(0,242,255,0.5)' : 'rgba(255,255,255,0.12)'}`,
              boxShadow: settings.enabled ? '0 0 12px rgba(0,242,255,0.2)' : 'none',
            }}
            aria-checked={settings.enabled}
            role="switch"
          >
            <span
              className="absolute top-1 transition-all duration-300 w-5 h-5 rounded-full"
              style={{
                left: settings.enabled ? '28px' : '4px',
                background: settings.enabled ? '#00f2ff' : 'rgba(255,255,255,0.3)',
                boxShadow: settings.enabled ? '0 0 8px #00f2ff' : 'none',
              }}
            />
          </button>
        </div>

        {/* Consent notice shown only when enabling */}
        {settings.enabled && (
          <div
            className="mt-5 rounded-xl p-3"
            style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}
          >
            <p className="text-[10px] font-mono text-white/30 leading-relaxed">
              🔒 CONSENT NOTICE — By enabling Safety Circle, you agree that ScamDefy will
              send a limited, privacy-preserving email to your guardians only when critical
              scam activity is detected. No personal conversations, URLs, or sensitive data
              are ever shared. You can disable this at any time.
            </p>
          </div>
        )}
      </div>

      {/* ── Guardian Roster ── */}
      <GlassCard>
        <SectionLabel>Trusted Guardians ({settings.guardians.length}/2)</SectionLabel>

        {settings.guardians.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-3xl mb-3 opacity-30">👥</p>
            <p className="text-xs font-mono text-white/25 uppercase tracking-widest">No guardians added yet</p>
          </div>
        ) : (
          <div className="space-y-3 mb-6">
            {settings.guardians.map(g => (
              <GuardianCard
                key={g.id}
                guardian={g}
                onRemove={handleRemoveGuardian}
              />
            ))}
          </div>
        )}

        {settings.guardians.length < 2 && (
          <>
            <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/25 mb-4">
              ▹ ADD A GUARDIAN
            </p>
            <AddGuardianForm onAdd={handleAddGuardian} />
          </>
        )}

        {settings.guardians.length >= 2 && (
          <p className="text-[10px] font-mono text-white/25 mt-2">
            Maximum 2 guardians reached. Remove one to add another.
          </p>
        )}
      </GlassCard>

      {/* ── Alert Preferences ── */}
      <GlassCard>
        <SectionLabel>Alert Preferences</SectionLabel>

        {/* Threshold */}
        <div className="mb-6">
          <p className="text-xs font-semibold text-white/70 mb-3">Risk Threshold</p>
          <ThresholdSlider value={settings.threshold} onChange={setThreshold} />
        </div>

        {/* Toggles */}
        <div className="space-y-4">
          {/* Escalation toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white/80">Escalation Alerts</p>
              <p className="text-[10px] font-mono text-white/30 leading-relaxed mt-0.5">
                Notify guardians if you proceed through a critical scam warning.
              </p>
            </div>
            <button
              onClick={() => update({ notifyOnEscalation: !settings.notifyOnEscalation })}
              className="relative shrink-0 ml-4 w-11 h-6 rounded-full transition-all duration-300"
              style={{
                background: settings.notifyOnEscalation ? 'rgba(0,242,255,0.2)' : 'rgba(255,255,255,0.07)',
                border: `1px solid ${settings.notifyOnEscalation ? 'rgba(0,242,255,0.4)' : 'rgba(255,255,255,0.1)'}`,
              }}
              role="switch"
              aria-checked={settings.notifyOnEscalation}
            >
              <span
                className="absolute top-0.5 w-4 h-4 rounded-full transition-all duration-300"
                style={{
                  left: settings.notifyOnEscalation ? '22px' : '4px',
                  background: settings.notifyOnEscalation ? '#00f2ff' : 'rgba(255,255,255,0.25)',
                }}
              />
            </button>
          </div>

          {/* Share name toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white/80">Share Your Name</p>
              <p className="text-[10px] font-mono text-white/30 leading-relaxed mt-0.5">
                Include your display name in guardian alerts. Off = "A ScamDefy user".
              </p>
            </div>
            <button
              onClick={() => update({ shareUserName: !settings.shareUserName })}
              className="relative shrink-0 ml-4 w-11 h-6 rounded-full transition-all duration-300"
              style={{
                background: settings.shareUserName ? 'rgba(0,242,255,0.2)' : 'rgba(255,255,255,0.07)',
                border: `1px solid ${settings.shareUserName ? 'rgba(0,242,255,0.4)' : 'rgba(255,255,255,0.1)'}`,
              }}
              role="switch"
              aria-checked={settings.shareUserName}
            >
              <span
                className="absolute top-0.5 w-4 h-4 rounded-full transition-all duration-300"
                style={{
                  left: settings.shareUserName ? '22px' : '4px',
                  background: settings.shareUserName ? '#00f2ff' : 'rgba(255,255,255,0.25)',
                }}
              />
            </button>
          </div>

          {/* Display name input (only if sharing) */}
          {settings.shareUserName && (
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-widest text-white/30 mb-1.5">
                Your Display Name (shown in alert)
              </label>
              <input
                value={settings.userName}
                onChange={e => setUserName(e.target.value)}
                placeholder="Your first name"
                maxLength={40}
                className="w-full px-4 py-2.5 rounded-xl text-sm text-white placeholder-white/20 outline-none transition-all"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  fontFamily: 'inherit',
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'rgba(0,242,255,0.4)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')}
              />
            </div>
          )}
        </div>
      </GlassCard>

      {/* ── Alert History ── */}
      {notifiedEntries.length > 0 && (
        <GlassCard>
          <SectionLabel>Recent Alert History</SectionLabel>
          <div className="space-y-2">
            {notifiedEntries.map(([email, ts]) => {
              const g = settings.guardians.find(x => x.email === email);
              const time = new Date(ts).toLocaleString('en-IN', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
              });
              return (
                <div key={email} className="flex justify-between items-center text-xs font-mono py-2 border-b border-white/5 last:border-b-0">
                  <span className="text-white/50">{g?.name ?? email}</span>
                  <span className="text-white/25">Notified {time}</span>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {/* ── Privacy Manifest ── */}
      <div
        className="rounded-2xl p-6 mb-6"
        style={{ background: 'rgba(0,18,4,0.5)', border: '1px solid rgba(34,197,94,0.15)' }}
      >
        <SectionLabel>Privacy Manifest</SectionLabel>
        <div className="space-y-3">
          {[
            { icon: '✓', label: 'What is sent to guardians', value: 'Risk level, scam category, your display name (if enabled), timestamp', ok: true },
            { icon: '✕', label: 'What is NEVER shared', value: 'Personal messages, URLs, OTPs, passwords, or any scan payload', ok: false },
            { icon: '✓', label: 'Guardian data storage', value: 'Stored only on your device (localStorage). Never uploaded to our servers.', ok: true },
            { icon: '✓', label: 'Real-time alerts', value: 'Instant notification for every detected threat above your threshold.', ok: true },
            { icon: '✓', label: 'You are in control', value: 'Disable Safety Circle or remove guardians at any time, instantly.', ok: true },
          ].map(({ icon, label, value, ok }) => (
            <div key={label} className="flex gap-3">
              <span
                className="text-sm shrink-0 mt-0.5"
                style={{ color: ok ? '#86efac' : '#f87171' }}
              >
                {icon}
              </span>
              <div>
                <p className="text-[11px] font-mono uppercase tracking-wider text-white/40 mb-0.5">{label}</p>
                <p className="text-xs text-white/60 leading-relaxed">{value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
