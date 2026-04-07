import React from 'react';
import type { Screen } from '../types';

interface Props { active: Screen; onNav: (s: Screen) => void; }

const TABS: Array<{ id: Screen; icon: string; label: string }> = [
  { id: 'dashboard',  icon: '⬡', label: 'HOME'    },
  { id: 'webthreats', icon: '◉', label: 'SCAN'    },
  { id: 'calllogs',   icon: '◈', label: 'VOICE'   },
  { id: 'settings',   icon: '⊛', label: 'CONFIG'  },
];

export function BottomNav({ active, onNav }: Props) {
  return (
    <nav className="fixed bottom-12 left-0 w-full z-40 glass-panel border-t border-white/10">
      <div className="flex">
        {TABS.map(tab => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onNav(tab.id)}
              className="flex-1 py-3 flex flex-col items-center gap-1 transition-all"
            >
              <span
                className="text-lg leading-none transition-all"
                style={{ color: isActive ? '#00f2ff' : 'rgba(255,255,255,0.3)', textShadow: isActive ? '0 0 8px #00f2ff' : 'none' }}
              >
                {tab.icon}
              </span>
              <span
                className="text-[9px] font-mono tracking-widest uppercase"
                style={{ color: isActive ? '#00f2ff' : 'rgba(255,255,255,0.25)' }}
              >
                {tab.label}
              </span>
              {isActive && (
                <div className="absolute bottom-0 h-px w-8 bg-electricCyan" style={{ boxShadow: '0 0 8px #00f2ff' }} />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
