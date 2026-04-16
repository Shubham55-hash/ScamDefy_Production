
import { useMemo } from 'react';

interface Props {
  contour: number[];
}

export function ProsodyAnalysis({ contour }: Props) {
  if (!contour || contour.length < 5) return null;

  // Calculate variance to provide a forensic insight
  const variance = useMemo(() => {
    const mean = contour.reduce((a, b) => a + b, 0) / contour.length;
    const sqDiffs = contour.map(v => Math.pow(v - mean, 2));
    return sqDiffs.reduce((a, b) => a + b, 0) / sqDiffs.length;
  }, [contour]);

  // AI often has variance < 0.005, Humans often > 0.02
  const isZero = variance === 0;
  const isStable = !isZero && variance < 0.012;
  
  const analysisLabel = isZero ? 'INCONCLUSIVE' : isStable ? 'STABLE (AI-LIKE)' : 'DYNAMIC (HUMAN-LIKE)';
  const analysisColor = isZero ? '#f59e0b' : isStable ? '#e879f9' : '#4ade80';

  const width = 300;
  const height = 60;
  const padding = 10;

  const points = useMemo(() => {
    const step = (width - padding * 2) / (contour.length - 1);
    return contour.map((val, i) => ({
      x: padding + i * step,
      y: height - padding - (val * (height - padding * 2))
    }));
  }, [contour]);

  const pathData = useMemo(() => {
    if (points.length < 2) return '';
    return points.reduce((acc, p, i, arr) => {
      if (i === 0) return `M ${p.x},${p.y}`;
      const prev = arr[i - 1];
      const cp1x = prev.x + (p.x - prev.x) / 2;
      return `${acc} C ${cp1x},${prev.y} ${cp1x},${p.y} ${p.x},${p.y}`;
    }, '');
  }, [points]);

  return (
    <div className="mt-4 mb-4 rounded-xl border border-white/5 bg-white/[0.02] p-4 slide-up">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/30">Forensic Prosody Analysis</p>
          <p className="text-[10px] font-black tracking-widest mt-0.5" style={{ color: analysisColor }}>
            {analysisLabel}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[9px] font-mono uppercase text-white/20">Variance</p>
          <p className="text-[10px] font-mono text-white/50">{(variance * 100).toFixed(3)}</p>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-lg bg-black/20" style={{ height }}>
        {/* Synthetic Stability Zone Highlight */}
        <div 
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-4 pointer-events-none opacity-20"
          style={{ background: 'linear-gradient(to bottom, transparent, #e879f9, transparent)' }}
        />
        
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full preserve-3d">
          <path
            d={pathData}
            fill="none"
            stroke={analysisColor}
            strokeWidth="2"
            strokeLinecap="round"
            className="transition-all duration-1000 ease-in-out opacity-80"
            style={{ filter: `drop-shadow(0 0 4px ${analysisColor})` }}
          />
        </svg>

        {/* Labels for the graph */}
        <div className="absolute inset-y-0 right-1 flex flex-col justify-between py-1 text-[7px] font-mono text-white/20 uppercase pointer-events-none">
          <span>High Pitch</span>
          <span>Low Pitch</span>
        </div>
      </div>
      
      <p className="mt-2 text-[8px] font-mono text-white/20 leading-relaxed uppercase tracking-tighter">
        {isZero 
          ? "Insufficient acoustic information to track pitch. This usually occurs with poor microphone quality or heavy background noise."
          : isStable 
            ? "Harmonic stability exceeds physiological human limits. Constant fundamental frequency suggests machine vocoding."
            : "Natural pitch jitter and prosodic micro-variations detected. Consistent with human articulatory dynamics."
        }
      </p>
    </div>
  );
}
