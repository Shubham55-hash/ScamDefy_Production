// BottomNav — mobile navigation bar (React JSX transform — no explicit import needed)
import type { Screen } from '../types';

interface Props { active: Screen; onNav: (s: Screen) => void; isAdmin?: boolean; }

const TABS: Array<{ id: Screen; icon: string; label: string }> = [
  { id: 'dashboard',  icon: '⬡', label: 'HOME'    },
  { id: 'webthreats', icon: '◉', label: 'SCAN'    },
  { id: 'qrscan',     icon: '⚔', label: 'QR'      },
  { id: 'calllogs',   icon: '◈', label: 'VOICE'   },
  { id: 'settings',   icon: '⊛', label: 'CONFIG'  },
];

const ADMIN_TABS: Array<{ id: Screen; icon: string; label: string }> = [
  { id: 'communityfeedback', icon: '◈', label: 'INTEL' },
  { id: 'testlab',           icon: '⚗', label: 'TEST'  },
];

export function BottomNav({ active, onNav, isAdmin }: Props) {
  const tabs = isAdmin ? [...TABS, ...ADMIN_TABS] : TABS;
  
  return (
    <nav className="fixed bottom-12 left-0 w-full z-40 glass-panel border-t border-white/10 bg-black/80">
      <div className="flex overflow-x-auto no-scrollbar">
        {tabs.map(tab => {
          const isActive = active === tab.id;
          const isDev    = tab.id === 'testlab' || tab.id === 'communityfeedback';
          
          return (
            <button
              key={tab.id}
              id={`nav-${tab.id}`}
              onClick={() => onNav(tab.id)}
              className="flex-1 min-w-[64px] py-3 flex flex-col items-center gap-1 transition-all relative"
            >
              <span
                className="text-lg leading-none transition-all"
                style={{
                  color:      isActive ? (isDev ? '#bf5af2' : '#00f2ff') : 'rgba(255,255,255,0.3)',
                  textShadow: isActive ? `0 0 8px ${isDev ? '#bf5af2' : '#00f2ff'}` : 'none',
                }}
              >
                {tab.icon}
              </span>
              <span
                className="text-[9px] font-mono tracking-widest uppercase"
                style={{ color: isActive ? (isDev ? '#bf5af2' : '#00f2ff') : 'rgba(255,255,255,0.25)' }}
              >
                {tab.label}
              </span>
              {isActive && (
                <div
                  className="absolute bottom-0 h-px w-8"
                  style={{
                    background:  isDev ? '#bf5af2' : '#00f2ff',
                    boxShadow:   `0 0 8px ${isDev ? '#bf5af2' : '#00f2ff'}`,
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
