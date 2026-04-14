import { useState, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

interface QRUploadViewProps {
  onScan: (decodedText: string) => void;
  onError?: (error: string) => void;
}

export function QRUploadView({ onScan, onError }: QRUploadViewProps) {
  const [isHovering, setIsHovering] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file) return;
    setDecoding(true);
    
    // Create a temp element for Html5Qrcode to use (it needs a DOM ID to initialize but can scan files directly)
    const tempId = "qr-temp-reader";
    const container = document.createElement('div');
    container.id = tempId;
    container.style.display = 'none';
    document.body.appendChild(container);

    const html5QrCode = new Html5Qrcode(tempId);
    
    try {
      const decodedText = await html5QrCode.scanFile(file, true);
      onScan(decodedText);
    } catch (err: any) {
      console.warn("[QR] Decode failed:", err);
      if (onError) onError("Failed to find a valid QR code in this image. Please try another.");
    } finally {
      setDecoding(false);
      html5QrCode.clear();
      document.body.removeChild(container);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsHovering(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div 
      className={`relative w-full max-w-sm mx-auto aspect-square rounded-2xl border-2 border-dashed transition-all duration-300 flex flex-col items-center justify-center p-8 cursor-pointer group ${
        isHovering ? 'border-electricCyan bg-electricCyan/5 scale-[1.02]' : 'border-white/10 bg-white/[0.02] hover:border-white/20'
      }`}
      onDragOver={(e) => { e.preventDefault(); setIsHovering(true); }}
      onDragLeave={() => setIsHovering(false)}
      onDrop={onDrop}
      onClick={() => fileInputRef.current?.click()}
    >
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept="image/*" 
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} 
      />

      <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-6 transition-all ${isHovering ? 'bg-electricCyan text-charcoal' : 'bg-white/5 text-white/40 group-hover:bg-white/10'}`}>
        {decoding ? (
          <div className="w-6 h-6 border-2 border-current border-t-transparent animate-spin rounded-full" />
        ) : (
          <span className="text-2xl">📁</span>
        )}
      </div>

      <p className={`text-[11px] font-bold uppercase tracking-[0.2em] mb-2 ${isHovering ? 'text-electricCyan' : 'text-white/70'}`}>
        {decoding ? 'Decoding Pulse...' : 'Drop QR Image'}
      </p>
      <p className="text-[9px] font-mono text-white/25 uppercase tracking-widest text-center">
        or click to browse local storage
      </p>

      {/* Decorative corner accents */}
      <div className="absolute top-4 left-4 w-4 h-4 border-t border-l border-white/20 group-hover:border-electricCyan/40 transition-colors" />
      <div className="absolute top-4 right-4 w-4 h-4 border-t border-r border-white/20 group-hover:border-electricCyan/40 transition-colors" />
      <div className="absolute bottom-4 left-4 w-4 h-4 border-b border-l border-white/20 group-hover:border-electricCyan/40 transition-colors" />
      <div className="absolute bottom-4 right-4 w-4 h-4 border-b border-r border-white/20 group-hover:border-electricCyan/40 transition-colors" />
    </div>
  );
}
