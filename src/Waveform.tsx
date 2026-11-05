import { useEffect, useRef } from "react";
import { useWorkbench } from "@momo/workbench/react";
export function Waveform({
  data,
  right,
  color,
  className = "",
  label,
}: {
  data?: Float32Array;
  right?: Float32Array;
  color?: string;
  className?: string;
  label: string;
}) {
  const { appearance } = useWorkbench();
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
      const style = getComputedStyle(canvas);
      ctx.scale(dpr, dpr);
      ctx.strokeStyle = style.getPropertyValue("--line");
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2 + 0.5);
      ctx.lineTo(width, height / 2 + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (!data?.length) return;
      ctx.beginPath();
      const lower = new Float32Array(Math.ceil(width));
      let peak = 0;
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
        peak = Math.max(peak, hi, -lo);
        const top = height / 2 - hi * height * 0.44;
        if (x === 0) ctx.moveTo(0, top);
        ctx.lineTo(x + 0.5, top);
        lower[x] = height / 2 - lo * height * 0.44;
      }
      for (let x = lower.length - 1; x >= 0; x--)
        ctx.lineTo(x + 0.5, lower[x]);
      ctx.closePath();
      if (color) {
        ctx.fillStyle = color.startsWith("var(")
          ? style.getPropertyValue(color.slice(4, -1))
          : color;
      } else {
        // Fit colour to the visible envelope without scaling the audio geometry.
        const radius = Math.max(1, peak * height * 0.44),
          gradient = ctx.createLinearGradient(
            0, height / 2 - radius, 0, height / 2 + radius,
          ),
          edge = style.getPropertyValue("--wave-start").trim(),
          shoulder = style.getPropertyValue("--wave-mid").trim();
        gradient.addColorStop(0, edge);
        gradient.addColorStop(0.3, shoulder);
        gradient.addColorStop(0.5, style.getPropertyValue("--wave-end").trim());
        gradient.addColorStop(0.7, shoulder);
        gradient.addColorStop(1, edge);
        ctx.fillStyle = gradient;
      }
      ctx.fill();
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    const unsubscribe = appearance.subscribe(draw);
    draw();
    return () => {
      observer.disconnect();
      unsubscribe();
    };
  }, [data, right, color, appearance]);
  return (
    <canvas
      ref={ref}
      className={`waveform ${className}`}
      role="img"
      aria-label={label}
    />
  );
}
