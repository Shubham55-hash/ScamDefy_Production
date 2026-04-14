import { useEffect, useRef } from 'react';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';

interface QRScannerViewProps {
  onScan: (decodedText: string) => void;
  onError?: (error: string) => void;
  active: boolean;
}

export function QRScannerView({ onScan, onError, active }: QRScannerViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    if (!containerRef.current || !active) return;

    const scannerId = "qr-reader";
    const scanner = new Html5Qrcode(scannerId);
    scannerRef.current = scanner;

    const startScanner = async () => {
      try {
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0
          },
          (decodedText) => {
            onScan(decodedText);
          },
          () => {
            // Success handler for each frame (ignored)
          }
        );
      } catch (err: any) {
        console.error("[QR] Start failed:", err);
        if (onError) onError(err);
      }
    };

    startScanner();

    return () => {
      const stopScanner = async () => {
        if (scannerRef.current && scannerRef.current.getState() !== Html5QrcodeScannerState.NOT_STARTED) {
          try {
            await scannerRef.current.stop();
          } catch (stopErr) {
            console.warn("[QR] Stop failed:", stopErr);
          }
        }
      };
      stopScanner();
    };
  }, [active, onScan, onError]);

  return (
    <div className="relative w-full aspect-square max-w-sm mx-auto overflow-hidden rounded-2xl border border-white/10 bg-black/40 shadow-2xl">
      <div id="qr-reader" ref={containerRef} className="w-full h-full" />
      
      {/* Target UI Overlay */}
      <div className="absolute inset-0 pointer-events-none z-10 flex flex-col items-center justify-center">
        {/* Animated scanning line */}
        <div className="absolute w-[250px] h-0.5 bg-electricCyan shadow-[0_0_15px_#00f2ff] animate-scan-line top-1/2 -translate-y-[125px]" />
        
        {/* Corners */}
        <div className="w-[250px] h-[250px] relative border border-white/20">
          <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-electricCyan rounded-tl" />
          <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-electricCyan rounded-tr" />
          <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-electricCyan rounded-bl" />
          <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-electricCyan rounded-br" />
        </div>
      </div>
      
      {/* Background Ambience within the frame */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
    </div>
  );
}
