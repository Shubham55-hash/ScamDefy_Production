import React, { useRef } from 'react';
import { LoadingSpinner } from '../ui/LoadingSpinner';

interface Props {
  onFile: (file: File) => void;
  loading: boolean;
  progress: number;
  selectedFile?: File | null;
}

export function AudioUploader({ onFile, loading, progress, selectedFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  const handleSelectClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    inputRef.current?.click();
  };

  if (loading) {
    return (
      <div className="glass-panel rounded-2xl border border-electricCyan/30 p-10 flex flex-col items-center gap-6">
        {/* Spinning rings */}
        <div className="relative w-24 h-24 flex items-center justify-center">
          <div className="absolute inset-0 border border-electricCyan/20 rounded-full animate-spin-slow" />
          <div className="absolute inset-3 border border-dashed border-electricMagenta/30 rounded-full animate-spin-reverse-slow" />
          <LoadingSpinner size="md" />
        </div>
        <div className="text-center w-full max-w-xs">
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-electricCyan mb-3">
            ANALYZING NEURAL PATTERNS... {Math.round(progress)}%
          </p>
          <div className="h-1 bg-white/5 rounded-full">
            <div
              className="h-1 bg-electricCyan rounded-full transition-all duration-300"
              style={{ width: `${progress}%`, boxShadow: '0 0 8px #00f2ff' }}
            />
          </div>
        </div>
      </div>
    );
  }

  // If a file is already selected, show the file name + a "select new file" button
  if (selectedFile) {
    return (
      <div
        className="glass-panel rounded-2xl border border-electricCyan/30 p-8 flex flex-col items-center gap-4"
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,audio/wav,audio/mpeg,audio/ogg,audio/mp4,audio/webm,.wav,.mp3,.ogg,.m4a,.webm"
          className="hidden"
          onChange={handleChange}
        />
        {/* File icon */}
        <div className="w-14 h-14 hexagon-clip flex items-center justify-center border border-electricCyan/40"
          style={{ background: 'rgba(0,242,255,0.08)' }}>
          <span className="text-2xl">🎵</span>
        </div>
        {/* File name */}
        <div className="text-center">
          <p className="text-[9px] font-mono uppercase tracking-widest text-white/30 mb-1">Loaded Payload</p>
          <p className="text-sm font-mono text-electricCyan truncate max-w-xs">{selectedFile.name}</p>
          <p className="text-[10px] font-mono text-white/20 mt-0.5">
            {(selectedFile.size / 1024).toFixed(0)} KB
          </p>
        </div>
        {/* Change file button */}
        <button
          onClick={handleSelectClick}
          className="inline-flex items-center gap-2 border border-electricCyan/50 text-electricCyan text-xs font-mono tracking-widest uppercase px-5 py-2 rounded-full hover:bg-electricCyan/10 transition-all"
        >
          ↺ SELECT NEW FILE
        </button>
      </div>
    );
  }

  // Default empty state
  return (
    <div
      className="glass-panel rounded-2xl border border-dashed border-electricCyan/30 p-10 flex flex-col items-center gap-6 cursor-pointer hover:border-electricCyan/60 transition-all group"
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
      onClick={() => inputRef.current?.click()}
    >
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,audio/wav,audio/mpeg,audio/ogg,audio/mp4,audio/webm,.wav,.mp3,.ogg,.m4a,.webm"
          className="hidden"
          onChange={handleChange}
        />
      {/* Hexagon icon */}
      <div className="w-20 h-20 border border-electricCyan hexagon-clip flex items-center justify-center animate-pulse-glow">
        <svg className="w-8 h-8 text-electricCyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"/>
        </svg>
      </div>
      <div className="text-center">
        <p className="text-sm font-bold uppercase tracking-[0.3em] text-white/70 mb-2">DEPLOY AUDIO PAYLOAD</p>
        <p className="text-[10px] font-mono text-white/30 mb-4">WAV · MP3 · OGG · M4A (max 10MB)</p>
        <div className="inline-flex items-center gap-2 border border-electricCyan/50 text-electricCyan text-xs font-mono tracking-widest uppercase px-5 py-2 rounded-full group-hover:bg-electricCyan/10 transition-all">
          SELECT FILE
        </div>
      </div>
    </div>
  );
}
