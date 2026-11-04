import { useEffect, useRef } from "react";
export function Waveform({
  data,
  right,
  color = "var(--wave)",
  className = "",
  label,
}: {
  data?: Float32Array;
  right?: Float32Array;
  color?: string;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect(),
        dpr = devicePixelRatio || 1;
      if (!width || !height) return;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue("--line");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2 + 0.5);
      ctx.lineTo(width, height / 2 + 0.5);
      ctx.stroke();
      if (!data?.length) return;
      ctx.strokeStyle = color.startsWith("var(")
        ? getComputedStyle(canvas).getPropertyValue(color.slice(4, -1))
        : color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < width; x++) {
        let lo = 0,
          hi = 0;
        const start = Math.floor((x / width) * data.length),
          end = Math.max(
            start + 1,
            Math.floor(((x + 1) / width) * data.length),
          );
        for (let j = start; j < Math.min(data.length, end); j++) {
          lo = Math.min(lo, data[j], right?.[j] ?? 0);
          hi = Math.max(hi, data[j], right?.[j] ?? 0);
        }
        ctx.moveTo(x + 0.5, height / 2 - hi * height * 0.44);
        ctx.lineTo(x + 0.5, height / 2 - lo * height * 0.44);
      }
      ctx.stroke();
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [data, right, color]);
  return (
    <canvas
      ref={ref}
      className={`waveform ${className}`}
      role="img"
      aria-label={label}
    />
  );
}
