/** A small trend line drawn against the gauge's normal band. */
export function Spark({ points, lo, hi, min, max, width = 220, height = 56 }: { points: { at: string; value: number }[]; lo: number; hi: number; min: number; max: number; width?: number; height?: number }) {
  if (points.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const vs = points.map((p) => p.value);
  const a = Math.min(lo, ...vs), b = Math.max(hi, ...vs);
  const pad = (b - a) * 0.15 || (max - min) * 0.05;
  const y0 = a - pad, y1 = b + pad;
  const X = (i: number) => (i / (points.length - 1)) * (width - 8) + 4;
  const Y = (v: number) => height - 4 - ((v - y0) / (y1 - y0)) * (height - 8);
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(" ");
  const lastV = vs[vs.length - 1];
  const out = lastV < lo || lastV > hi;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Trend of the last ${points.length} readings`}>
      <rect x="0" y={Y(hi)} width={width} height={Math.max(1, Y(lo) - Y(hi))} fill="var(--rule-2)" />
      <path d={d} fill="none" stroke="var(--ink)" strokeWidth="1.8" />
      <circle cx={X(points.length - 1)} cy={Y(lastV)} r="3.5" fill={out ? "var(--needle)" : "var(--ink)"} />
    </svg>
  );
}
