import type { Gauge } from "@/lib/types";
import s from "./recorder.module.css";

/** Two weeks as a strip chart: time across, value up, the normal band shaded, limits dashed. */
export function TrendChart({ gauge, points }: { gauge: Gauge; points: { at: string; value: number; outcome?: string }[] }) {
  const W = 760, H = 420, pl = 52, pr = 16, pt = 18, pb = 40;
  const pts = [...points].sort((a, b) => +new Date(a.at) - +new Date(b.at));
  if (pts.length < 2) return <p>Not enough readings yet.</p>;
  const t0 = +new Date(pts[0].at), t1 = +new Date(pts[pts.length - 1].at);
  const vs = pts.map((p) => p.value).concat(gauge.normal, [gauge.alarm.high, gauge.alarm.low].filter((v): v is number => v != null));
  const lo = Math.min(...vs), hi = Math.max(...vs), pad = (hi - lo) * 0.08;
  const X = (t: number) => pl + ((t - t0) / Math.max(1, t1 - t0)) * (W - pl - pr);
  const Y = (v: number) => H - pb - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - pt - pb);
  const ticks = 5;
  const days = Math.ceil((t1 - t0) / 86400000);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={s.svg} style={{ maxWidth: W }} role="img" aria-label={`${gauge.id} over the past ${days} days`}>
      <rect x={pl} y={Y(gauge.normal[1])} width={W - pl - pr} height={Y(gauge.normal[0]) - Y(gauge.normal[1])} className={s.band} />
      {Array.from({ length: ticks + 1 }, (_, i) => lo - pad + ((hi - lo + 2 * pad) * i) / ticks).map((v) => (
        <g key={v}>
          <line x1={pl} x2={W - pr} y1={Y(v)} y2={Y(v)} className={s.grid} />
          <text x={pl - 8} y={Y(v) + 4} textAnchor="end" className={s.scaleText}>{v.toFixed(1)}</text>
        </g>
      ))}
      {Array.from({ length: days + 1 }, (_, i) => t0 + i * 86400000).map((t) => (
        <text key={t} x={X(t)} y={H - 14} textAnchor="middle" className={s.scaleText}>{new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</text>
      ))}
      {gauge.alarm.high != null && <line x1={pl} x2={W - pr} y1={Y(gauge.alarm.high)} y2={Y(gauge.alarm.high)} className={s.alarm} />}
      {gauge.alarm.low != null && <line x1={pl} x2={W - pr} y1={Y(gauge.alarm.low)} y2={Y(gauge.alarm.low)} className={s.alarm} />}
      <path d={pts.map((p, i) => `${i ? "L" : "M"}${X(+new Date(p.at))},${Y(p.value)}`).join(" ")} className={s.pen} />
      {pts.map((p, i) => <circle key={i} cx={X(+new Date(p.at))} cy={Y(p.value)} r={p.outcome === "held" ? 5 : 2.6} className={p.outcome === "held" ? s.markHeld : s.mark} />)}
    </svg>
  );
}
