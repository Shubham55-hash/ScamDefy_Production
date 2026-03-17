import type { ScanBreakdown } from '../../types';

interface Props { 
  breakdown?: ScanBreakdown;
  noContainer?: boolean;
}

const SOURCES = [
  { key: 'gsb',           label: 'Google Safe Browse' },
  { key: 'urlhaus',       label: 'URLhaus'            },
  { key: 'domain',        label: 'Domain Reputation'  },
  { key: 'impersonation', label: 'Brand Integrity'    },
  { key: 'domain_age',    label: 'Domain Age'         },
  { key: 'heuristics',    label: 'Heuristics'         },
];

export function ThreatBreakdown({ breakdown, noContainer }: Props) {
  if (!breakdown) return null;

  const content = (
    <div className={noContainer ? "" : "glass-panel rounded-xl p-5 mt-4"}>
      <p className="text-[9px] font-mono uppercase tracking-widest text-white/30 mb-4">Score Breakdown</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {SOURCES.map(src => {
          const val = (breakdown as any)[src.key] ?? 0;
          const pct = Math.min(100, Math.abs(val));
          const color = val > 10 ? '#ef4444' : val > 5 ? '#f59e0b' : '#00f2ff';
          return (
            <div key={src.key}>
              <div className="flex justify-between text-[10px] font-mono mb-1">
                <span className="text-white/40">{src.label}</span>
                <span style={{ color }}>{val > 0 ? '+' : ''}{val}</span>
              </div>
              <div className="h-1 rounded-full bg-white/5">
                <div
                  className="h-1 rounded-full transition-all duration-700"
                  style={{ width: `${pct}%`, background: color, boxShadow: `0 0 4px ${color}` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return content;
}
