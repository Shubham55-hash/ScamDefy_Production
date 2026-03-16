import { useEffect, useRef } from 'react';

interface Props {
  stream: MediaStream | null;
  active: boolean;
}

export function LiveWaveform({ stream, active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!stream || !active) {
      // Draw a flat idle line
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(0,242,255,0.2)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, canvas.height / 2);
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
      return;
    }

    // Set up AudioContext and AnalyserNode
    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    const analyser = audioCtx.createAnalyser();
    analyserRef.current = analyser;
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const c = canvasRef.current;
      if (!c) return;
      const ctx2d = c.getContext('2d');
      if (!ctx2d) return;

      c.width = c.offsetWidth * window.devicePixelRatio;
      c.height = c.offsetHeight * window.devicePixelRatio;
      const W = c.width;
      const H = c.height;

      analyser.getByteFrequencyData(dataArray);

      ctx2d.clearRect(0, 0, W, H);

      const barCount = 48;
      const barW = W / barCount;
      const step = Math.floor(bufferLength / barCount);

      for (let i = 0; i < barCount; i++) {
        const raw = dataArray[i * step] / 255;
        const barH = raw * H * 0.85;
        const x = i * barW;
        const y = (H - barH) / 2;
        const isPeak = raw > 0.75;

        // Gradient per bar
        const grad = ctx2d.createLinearGradient(x, y, x, y + barH);
        grad.addColorStop(0, isPeak ? 'rgba(232,121,249,0.9)' : 'rgba(0,242,255,0.8)');
        grad.addColorStop(1, isPeak ? 'rgba(232,121,249,0.2)' : 'rgba(0,242,255,0.15)');

        ctx2d.fillStyle = grad;
        const radius = Math.min(barW * 0.3, 3);
        ctx2d.beginPath();
        ctx2d.roundRect(x + barW * 0.15, y, barW * 0.7, Math.max(barH, 2), radius);
        ctx2d.fill();
      }
    };

    draw();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      audioCtx.close();
    };
  }, [stream, active]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-20 rounded-lg"
      style={{ display: 'block' }}
    />
  );
}
