import { useMemo } from 'react';
import type { LiveVerdictEntry } from '../../types';

interface DetectionTrendProps {
  verdicts: LiveVerdictEntry[];
  height?: number;
}

export function DetectionTrend({ verdicts, height = 120 }: DetectionTrendProps) {
  // Max points to show before scrolling
  const MAX_POINTS = 20;
  const data = useMemo(() => {
    // If empty, show a baseline
    if (verdicts.length === 0) return Array(MAX_POINTS).fill(50);
    
    const slice = verdicts.slice(-MAX_POINTS);
    return slice.map(v => {
      if (v.verdict === 'SYNTHETIC') return v.confidence_pct;
      if (v.verdict === 'REAL')      return 100 - v.confidence_pct;
      return 50; // Uncertain
    });
  }, [verdicts]);

  const points = useMemo(() => {
    const w = 400; // Fixed internal coordinate system width
    const h = height;
    const len = Math.max(MAX_POINTS, data.length);
    const step = w / (len - 1);
    
    return data.map((val, i) => ({
      x: i * step,
      y: h - (val / 100) * h
    }));
  }, [data, height]);

  const pathData = useMemo(() => {
    if (points.length < 2) return '';
    
    // Create a smooth cubic bezier path
    return points.reduce((acc, point, i, arr) => {
      if (i === 0) return `M ${point.x},${point.y}`;
      
      const prev = arr[i - 1];
      const cp1x = prev.x + (point.x - prev.x) / 2;
      const cp2x = cp1x;
      
      return `${acc} C ${cp1x},${prev.y} ${cp2x},${point.y} ${point.x},${point.y}`;
    }, '');
  }, [points]);

  const areaData = useMemo(() => {
    if (!pathData) return '';
    return `${pathData} L ${points[points.length - 1].x},${height} L 0,${height} Z`;
  }, [pathData, points, height]);

  return (
    <div className="w-full h-auto glass-panel rounded-xl p-4 bg-white/[0.01] border border-white/5 mb-6 overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-[10px] font-mono text-white/40 uppercase tracking-widest">AI Confidence Wave</h3>
          <p className="text-[9px] font-mono text-white/10">REAL-TIME CLONE PROBABILITY TREND</p>
        </div>
        <div className="flex gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-electricMagenta" />
            <span className="text-[8px] font-mono text-white/30 uppercase tracking-tighter">AI CLONE</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-electricCyan" />
            <span className="text-[8px] font-mono text-white/30 uppercase tracking-tighter">HUMAN</span>
          </div>
        </div>
      </div>

      <div className="relative w-full overflow-hidden" style={{ height }}>
        {/* Horizontal grid lines */}
        <div className="absolute inset-0 flex flex-col justify-between opacity-10 pointer-events-none">
          <div className="border-t border-electricMagenta" />
          <div className="border-t border-dashed border-white/20" />
          <div className="border-t border-electricCyan" />
        </div>

        {/* Labels */}
        <div className="absolute inset-y-0 right-0 flex flex-col justify-between text-[8px] font-mono text-white/20 pointer-events-none py-1">
          <span>HIGH RISK</span>
          <span className="text-[7px]">50%</span>
          <span>LOW RISK</span>
        </div>

        <svg
          viewBox={`0 0 400 ${height}`}
          className="w-full h-full overflow-visible"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="waveGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e879f9" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#00f2ff" stopOpacity="0.05" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="2" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Area fill */}
          <path
            d={areaData}
            fill="url(#waveGradient)"
            className="transition-all duration-500 ease-in-out"
          />

          {/* The path line */}
          <path
            d={pathData}
            fill="none"
            stroke="url(#lineGradient)"
            strokeWidth="2"
            strokeLinecap="round"
            filter="url(#glow)"
            className="transition-all duration-500 ease-in-out"
          />
          
          <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#00f2ff" />
            <stop offset="100%" stopColor="#e879f9" />
          </linearGradient>

          {/* Points/Dots on the wave */}
          {points.length > 0 && points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r="2"
              fill={data[i] > 50 ? "#e879f9" : "#00f2ff"}
              className="transition-all duration-500 ease-in-out"
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
