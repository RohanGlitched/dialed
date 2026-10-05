"use client";
/** One drawing per pipeline stage, all from the reader's own measurements. */
import { TOTAL } from "@/lib/unroll";
import type { Inspect } from "@/lib/types";
import { Unroll } from "@/components/Unroll";
import s from "./inspect.module.css";

export const STAGES = [
  { key: "find", title: "Find the dial", fn: "Canny, findContours, fitEllipse" },
  { key: "edges", title: "Edges", fn: "Sobel, Canny" },
  { key: "straight", title: "Straighten", fn: "warpAffine" },
  { key: "centre", title: "True centre", fn: "connectedComponents, least squares" },
  { key: "ink", title: "Strokes only", fn: "morphologyEx black-hat / top-hat" },
  { key: "unroll", title: "Unroll", fn: "warpPolar" },
  { key: "numbers", title: "Read the numbers", fn: "dnn TextDetectionModel_DB, TextRecognitionModel" },
  { key: "fit", title: "Fit the scale", fn: "RANSAC, interpolation" },
  { key: "needle", title: "Find the needle", fn: "polar ink profile" },
] as const;
export type StageKey = (typeof STAGES)[number]["key"];

const deg2xy = (c: [number, number], r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [c[0] + r * Math.sin(a), c[1] - r * Math.cos(a)];
};

export function StageView({ ins, stage }: { ins: Inspect; stage: StageKey }) {
  const g = ins.geometry;
  const im = ins.images ?? {};
  const D = g.dial_size;
  const c = g.center ?? [D / 2, D / 2];
  const r = ins.reading;
  if (stage === "find" || stage === "edges") {
    const [pw, ph] = g.photo ?? [1, 1];
    return (
      <div className={s.figure} style={{ aspectRatio: `${pw} / ${ph}`, maxWidth: `min(100%, ${Math.round((620 * pw) / ph)}px)` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={stage === "find" ? im.photo : im.edges} alt={stage === "find" ? "The photo as uploaded" : "Edge map"} />
        <svg viewBox={`0 0 ${pw} ${ph}`} className={s.over} aria-hidden="true">
          {g.candidates.map((cd, i) => (
            <ellipse key={i} cx={cd.ellipse[0]} cy={cd.ellipse[1]} rx={cd.ellipse[2] / 2} ry={cd.ellipse[3] / 2} transform={`rotate(${cd.ellipse[4]} ${cd.ellipse[0]} ${cd.ellipse[1]})`} className={s.cand} />
          ))}
          {g.ellipse && (
            <ellipse cx={g.ellipse[0]} cy={g.ellipse[1]} rx={g.ellipse[2] / 2} ry={g.ellipse[3] / 2} transform={`rotate(${g.ellipse[4]} ${g.ellipse[0]} ${g.ellipse[1]})`} className={s.win} />
          )}
        </svg>
      </div>
    );
  }
  if (stage === "unroll") {
    if (!im.photo || !im.face || !g.center) return <Missing />;
    return <Unroll ins={ins} photo={im.photo} face={im.face} ms={TOTAL} showValue />;
  }
  if (stage === "fit") return <FitChart ins={ins} />;
  if (stage === "needle") return <NeedleChart ins={ins} />;
  if (!im.dial || !g.center) return <Missing />;
  const src = stage === "ink" ? im.ink : im.dial;
  return (
    <div className={s.figure} style={{ aspectRatio: "1 / 1", maxWidth: "min(100%, 620px)" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={stage === "ink" ? "Thin strokes kept by morphology" : "The dial, straightened"} />
      <svg viewBox={`0 0 ${D} ${D}`} className={s.over} aria-hidden="true">
        {stage === "straight" && <circle cx={D / 2} cy={D / 2} r={g.rad} className={s.win} />}
        {stage === "centre" && (
          <>
            {(g.tick_lines ?? []).map((l, i) => {
              // extend each tick's own line through the dial: they meet at the true centre
              const L = D;
              return <line key={i} x1={l.p[0] - l.d[0] * L} y1={l.p[1] - l.d[1] * L} x2={l.p[0] + l.d[0] * L} y2={l.p[1] + l.d[1] * L} className={s.ray} />;
            })}
            <Cross x={D / 2} y={D / 2} className={s.crossOld} />
            <Cross x={c[0]} y={c[1]} className={s.crossNew} />
          </>
        )}
        {stage === "numbers" &&
          (g.text ?? []).map((t, i) => (
            <g key={i}>
              <rect x={t.box[0]} y={t.box[1]} width={t.box[2] - t.box[0]} height={t.box[3] - t.box[1]} className={t.used ? s.boxUsed : t.number ? s.boxNum : s.boxText} />
              <text x={t.box[0]} y={t.box[1] - 5} className={t.used ? s.labelUsed : s.label}>
                {t.text || "?"}
              </text>
            </g>
          ))}
        {stage === "ink" && r.needle_angle != null && (
          <line x1={c[0]} y1={c[1]} x2={deg2xy(c, g.rad * 0.95, r.needle_angle)[0]} y2={deg2xy(c, g.rad * 0.95, r.needle_angle)[1]} className={s.needleLine} />
        )}
      </svg>
    </div>
  );
}

function Cross({ x, y, className }: { x: number; y: number; className: string }) {
  return (
    <g className={className}>
      <line x1={x - 14} x2={x + 14} y1={y} y2={y} />
      <line x1={x} x2={x} y1={y - 14} y2={y + 14} />
      <circle cx={x} cy={y} r={6} />
    </g>
  );
}

function Missing() {
  return <div className={s.missing}>The reader stopped before this stage. See the issues above.</div>;
}

/** Value against angle (clockwise from the scale's blank gap): printed numbers, the fitted curve, the needle. */
function FitChart({ ins }: { ins: Inspect }) {
  const fit = ins.geometry.fit;
  const r = ins.reading;
  if (!fit || ins.geometry.gap == null) return <Missing />;
  const gap = ins.geometry.gap;
  const W = 640, H = 400, pl = 54, pr = 20, pt = 20, pb = 44;
  const from = (deg: number) => (((deg - gap) % 360) + 360) % 360;
  const xs = fit.points.map((p) => from(p.deg));
  const x0 = Math.max(0, Math.min(...xs) - 20);
  const x1 = Math.min(360, Math.max(...xs) + 20);
  const vals = fit.points.map((p) => p.value);
  const v0 = Math.min(...vals, r.value ?? Infinity);
  const v1 = Math.max(...vals, r.value ?? -Infinity);
  const pad = (v1 - v0) * 0.08 || 1;
  const X = (a: number) => pl + ((a - x0) / (x1 - x0)) * (W - pl - pr);
  const Y = (v: number) => H - pb - ((v - (v0 - pad)) / (v1 - v0 + 2 * pad)) * (H - pt - pb);
  const curve = fit.curve.filter((c) => c.from_gap >= x0 && c.from_gap <= x1);
  const na = r.needle_angle != null ? from(r.needle_angle) : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={s.chart} role="img" aria-label="Scale fit: value against angle">
      {[0, 0.25, 0.5, 0.75, 1].map((k) => {
        const v = v0 + k * (v1 - v0);
        return (
          <g key={k}>
            <line x1={pl} x2={W - pr} y1={Y(v)} y2={Y(v)} className={s.gridLine} />
            <text x={pl - 8} y={Y(v) + 4} textAnchor="end" className={s.axis}>{+v.toFixed(2)}</text>
          </g>
        );
      })}
      <polyline points={curve.map((c) => `${X(c.from_gap)},${Y(c.value)}`).join(" ")} className={s.curve} />
      {fit.points.map((p, i) => (
        <circle key={i} cx={X(from(p.deg))} cy={Y(p.value)} r={5} className={s.point} />
      ))}
      {na != null && r.value != null && (
        <g>
          <line x1={X(na)} x2={X(na)} y1={pt} y2={H - pb} className={s.needleLine} />
          <line x1={pl} x2={X(na)} y1={Y(r.value)} y2={Y(r.value)} className={s.needleDash} />
          <text x={X(na) + 6} y={pt + 14} className={s.needleText}>needle</text>
        </g>
      )}
      <text x={(pl + W - pr) / 2} y={H - 10} textAnchor="middle" className={s.axis}>degrees clockwise from the scale gap</text>
    </svg>
  );
}

/** The needle score around the dial: ink that runs the whole inner band, by angle. */
function NeedleChart({ ins }: { ins: Inspect }) {
  const prof = ins.geometry.needle_profile;
  const r = ins.reading;
  if (!prof || !prof.length) return <Missing />;
  const S = 480, c = S / 2, r0 = 70, r1 = 210;
  const max = Math.max(...prof) || 1;
  const pts = prof.map((v, i) => {
    const deg = (i / prof.length) * 360;
    const [x, y] = deg2xy([c, c], r0 + (v / max) * (r1 - r0), deg);
    return `${x},${y}`;
  });
  const na = r.needle_angle;
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className={s.chart} role="img" aria-label="Needle score by angle">
      <circle cx={c} cy={c} r={r0} className={s.gridLine} />
      <circle cx={c} cy={c} r={r1} className={s.gridLine} />
      {[0, 90, 180, 270].map((d) => {
        const [x, y] = deg2xy([c, c], r1 + 16, d);
        return <text key={d} x={x} y={y + 4} textAnchor="middle" className={s.axis}>{d}°</text>;
      })}
      <polygon points={pts.join(" ")} className={s.profile} />
      {na != null && <line x1={c} y1={c} x2={deg2xy([c, c], r1, na)[0]} y2={deg2xy([c, c], r1, na)[1]} className={s.needleLine} />}
      {na != null && <text x={c} y={c + 4} textAnchor="middle" className={s.needleText}>{na.toFixed(1)}°</text>}
    </svg>
  );
}
