import { useState, useRef } from 'react';
import jsQR from 'jsqr';

interface QRUploadViewProps {
  onScan: (decodedText: string) => void;
  onError?: (error: string) => void;
}

export function QRUploadView({ onScan, onError }: QRUploadViewProps) {
  const [isHovering, setIsHovering] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file) return;
    setPreviewUrl(URL.createObjectURL(file));
    setDecoding(true);
    
    try {
      const img = new Image();
      const imageUrl = URL.createObjectURL(file);
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = imageUrl;
      });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      
      // Use original dimensions to avoid resolution loss
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // Pass 1: Standard Search (includes inversion check)
      let code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "attemptBoth",
      });

      if (!code) {
        // Pass 2: High Contrast Binary Threshold
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
          const val = avg > 120 ? 255 : 0;
          data[i] = val; data[i + 1] = val; data[i + 2] = val;
        }
        ctx.putImageData(imageData, 0, 0);
        code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
      }

      if (code) {
        onScan(code.data);
      } else {
        throw new Error("No QR patterns found in exhaustive search.");
      }

      URL.revokeObjectURL(imageUrl);
    } catch (err: any) {
      console.warn("[QR] Exhaustive search failed:", err);
      if (onError) onError("Failed to detect QR code. Pulse signals too weak or image incompatible.");
    } finally {
      setDecoding(false);
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

      <div className={`relative w-16 h-16 rounded-full flex items-center justify-center mb-6 transition-all overflow-hidden ${isHovering ? 'bg-electricCyan text-charcoal' : 'bg-white/5 text-white/40 group-hover:bg-white/10'}`}>
        {previewUrl ? (
          <img src={previewUrl} alt="Preview" className="w-full h-full object-cover opacity-60" />
        ) : decoding ? (
          <div className="w-6 h-6 border-2 border-electricCyan border-t-transparent animate-spin rounded-full" />
        ) : (
          <span className="text-2xl">📁</span>
        )}
        {decoding && previewUrl && (
          <div className="absolute inset-0 bg-charcoal/40 flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-electricCyan border-t-transparent animate-spin rounded-full" />
          </div>
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
