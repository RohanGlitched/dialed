"use client";
/** A 7-day circular chart, drawn the way a pen recorder draws it: the paper turns once a week,
 *  the pen swings on an arm, so time lines are arcs, not spokes. Value is radius on the gauge's own scale. */
import type { Gauge } from "@/lib/types";
import s from "./recorder.module.css";

type Pt = { at: string; value: number; outcome?: string };

const S = 640;
const C = S / 2;
const R0 = 46; // hub
const R1 = 286; // full scale
const P = R1 * 1.3; // pen-arm pivot distance from the centre
const L = R1 * 1.12; // pen-arm length
const DAY = 86400000;

// angle offset so a time line bends like the pen's arc (law of cosines), zero at the hub
const bend = (r: number) => Math.acos(Math.min(1, Math.max(-1, (r * r + P * P - L * L) / (2 * r * P)))) - Math.acos(Math.min(1, (R0 * R0 + P * P - L * L) / (2 * R0 * P)));

export function ChartRecorder({ gauge, points, now = Date.now() }: { gauge: Gauge; points: Pt[]; now?: number }) {
  const start = now - 7 * DAY;
  const rad = (v: number) => R0 + ((v - gauge.min) / (gauge.max - gauge.min)) * (R1 - R0);
  const ang = (t: number, r: number) => ((t - start) / (7 * DAY)) * Math.PI * 2 + bend(r);
  const xy = (t: number, v: number): [number, number] => {
    const r = rad(v);
    const a = ang(t, r);
    return [C + r * Math.sin(a), C - r * Math.cos(a)];
  };
  const week = points.filter((p) => +new Date(p.at) >= start).sort((a, b) => +new Date(a.at) - +new Date(b.at));
  // the pen draws continuously between readings
  const path = week.map((p, i) => {
    const [x, y] = xy(+new Date(p.at), p.value);
    return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const steps = niceSteps(gauge.min, gauge.max);
  const days = Array.from({ length: 7 }, (_, i) => start + i * DAY);
  const hours = Array.from({ length: 28 }, (_, i) => start + i * (DAY / 4));
  const arcPath = (t: number) => {
    const pts: string[] = [];
    for (let r = R0; r <= R1 + 0.1; r += 8) {
      const a = ang(t, r);
      pts.push(`${pts.length ? "L" : "M"}${(C + r * Math.sin(a)).toFixed(1)},${(C - r * Math.cos(a)).toFixed(1)}`);
    }
    return pts.join(" ");
  };
  const band = (lo: number, hi: number) => {
    const a = rad(lo), b = rad(hi);
    return `M${C},${C - b} A${b},${b} 0 1 1 ${C - 0.01},${C - b} Z M${C},${C - a} A${a},${a} 0 1 0 ${C + 0.01},${C - a} Z`;
  };
  const last = week[week.length - 1];
  const nowArc = arcPath(now);
  return (
    <figure className={s.fig}>
      <svg viewBox={`0 0 ${S} ${S}`} className={s.svg} role="img" aria-label={`Circular chart of ${gauge.id} over the past seven days`}>
        <circle cx={C} cy={C} r={R1 + 22} className={s.paper} />
        <path d={band(gauge.normal[0], gauge.normal[1])} className={s.band} fillRule="evenodd" />
        {steps.map((v) => (
          <g key={v}>
            <circle cx={C} cy={C} r={rad(v)} className={s.grid} />
            <text x={C + 4} y={C - rad(v) + 13} className={s.scaleText}>{v}</text>
          </g>
        ))}
        {hours.map((t, i) => <path key={t} d={arcPath(t)} className={i % 4 === 0 ? s.dayLine : s.hourLine} />)}
        {days.map((t) => {
          const a = ang(t + DAY / 2, R1 + 12);
          return (
            <text key={t} x={C + (R1 + 12) * Math.sin(a)} y={C - (R1 + 12) * Math.cos(a) + 4} textAnchor="middle" className={s.dayText}>
              {new Date(t + DAY / 2).toLocaleDateString(undefined, { weekday: "short" })}
            </text>
          );
        })}
        {gauge.alarm.high != null && <circle cx={C} cy={C} r={rad(gauge.alarm.high)} className={s.alarm} />}
        {gauge.alarm.low != null && <circle cx={C} cy={C} r={rad(gauge.alarm.low)} className={s.alarm} />}
        <path d={path.join(" ")} className={s.pen} />
        {week.map((p, i) => {
          const [x, y] = xy(+new Date(p.at), p.value);
          return <circle key={i} cx={x} cy={y} r={p.outcome === "held" ? 5 : 2.6} className={p.outcome === "held" ? s.markHeld : s.mark} />;
        })}
        <path d={nowArc} className={s.now} />
        <circle cx={C} cy={C} r={R0 - 6} className={s.hub} />
        <text x={C} y={C - 4} textAnchor="middle" className={s.hubText}>{gauge.id}</text>
        <text x={C} y={C + 14} textAnchor="middle" className={s.hubSub}>{gauge.unit}</text>
      </svg>
      <figcaption className={s.cap}>
        <span><i className={s.kPen} /> Readings, pen trace</span>
        <span><i className={s.kBand} /> Normal band {gauge.normal[0]}–{gauge.normal[1]} {gauge.unit}</span>
        {(gauge.alarm.high != null || gauge.alarm.low != null) && <span><i className={s.kAlarm} /> Alarm limit</span>}
        <span><i className={s.kNow} /> Now</span>
        {last && <span className={s.lastNote}>Last: {last.value.toFixed(gauge.max - gauge.min <= 20 ? 2 : gauge.max - gauge.min <= 200 ? 1 : 0)} {gauge.unit}</span>}
      </figcaption>
    </figure>
  );
}

function niceSteps(min: number, max: number): number[] {
  const span = max - min;
  const raw = span / 6;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
