"use client";
/** The pump house as a process drawing (P&ID conventions): process lines, pumps, the filter vessel,
 *  the air receiver, and an ISA instrument bubble at every gauge on the round. Bubble state is live. */
import type { RoundGauge } from "@/lib/types";
import s from "./schematic.module.css";

type Props = {
  gauges: RoundGauge[];
  selected?: string | null;
  onSelect?: (id: string) => void;
  /** Gauges captured on today's round (not seeded history). */
  doneToday?: Set<string>;
  compact?: boolean;
};

const W = 1200;
const H = 640;

export function Schematic({ gauges, selected, onSelect, doneToday, compact }: Props) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`${s.svg} ${compact ? s.compact : ""}`} role="group" aria-label="Process drawing of the high-lift pump house with each gauge on the round">
      <defs>
        <marker id="flow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" className={s.arrowHead} />
        </marker>
        <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" className={s.hatch} />
        </pattern>
      </defs>

      {/* raw water in */}
      <text x="30" y="368" className={s.label}>Raw water</text>
      <text x="30" y="386" className={s.labelSmall}>from intake well</text>
      {/* suction header */}
      <path d="M30,400 H330" className={s.pipe} markerEnd="url(#flow)" />
      <path d="M330,400 V300 H374" className={s.pipe} />
      <path d="M330,400 V460 H374" className={s.pipe} />
      {/* pumps */}
      <Pump x={400} y={300} tag="P-1" note="duty" />
      <Pump x={400} y={460} tag="P-2" note="standby" />
      {/* P-1 motor */}
      <rect x="372" y="196" width="56" height="44" className={s.equip} />
      <text x="400" y="223" textAnchor="middle" className={s.equipText}>M</text>
      <line x1="400" y1="240" x2="400" y2="274" className={s.shaft} />
      {/* discharge header */}
      <path d="M426,300 H580 V460 H426" className={s.pipe} />
      <path d="M580,380 H740" className={s.pipe} markerEnd="url(#flow)" />
      {/* filter F-1 */}
      <rect x="760" y="250" width="90" height="230" rx="40" className={s.vessel} />
      <rect x="772" y="330" width="66" height="70" fill="url(#hatch)" className={s.media} />
      <text x="805" y="285" textAnchor="middle" className={s.equipText}>F-1</text>
      <text x="805" y="455" textAnchor="middle" className={s.labelSmall}>sand filter</text>
      <path d="M740,380 H760" className={s.pipe} />
      <path d="M850,380 H1150" className={s.pipe} markerEnd="url(#flow)" />
      <text x="1150" y="410" textAnchor="end" className={s.label}>To distribution</text>
      {/* compressed air */}
      <circle cx="600" cy="590" r="24" className={s.equip} />
      <text x="600" y="595" textAnchor="middle" className={s.equipText}>C-1</text>
      <path d="M624,590 H690" className={s.pipe} />
      <rect x="690" y="565" width="200" height="50" rx="25" className={s.vessel} />
      <text x="790" y="595" textAnchor="middle" className={s.equipText}>Air receiver</text>
      <path d="M890,590 H1010" className={s.pipeThin} markerEnd="url(#flow)" />
      <text x="1018" y="595" className={s.labelSmall}>to valve actuators</text>

      {/* instrument connections (dashed, from bubble to process point) */}
      <Conn from={[200, 300]} to={[200, 400]} />
      <Conn from={[300, 150]} to={[372, 210]} />
      <Conn from={[520, 220]} to={[520, 300]} />
      <Conn from={[520, 540]} to={[520, 460]} />
      <Conn from={[680, 300]} to={[680, 380]} />
      <Conn from={[920, 300]} to={[920, 380]} />
      <Conn from={[760, 520]} to={[760, 565]} />
      <Conn from={[1090, 300]} to={[1090, 380]} />

      {gauges.map((g) => (
        <Bubble key={g.id} g={g} selected={selected === g.id} today={doneToday?.has(g.id) ?? false} onSelect={onSelect} />
      ))}
    </svg>
  );
}

function Pump({ x, y, tag, note }: { x: number; y: number; tag: string; note: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r="26" className={s.equip} />
      <path d={`M${x - 14},${y + 14} L${x + 20},${y} L${x - 14},${y - 14}`} className={s.pumpTri} />
      <text x={x} y={y + 50} textAnchor="middle" className={s.equipText}>{tag}</text>
      <text x={x} y={y + 66} textAnchor="middle" className={s.labelSmall}>{note}</text>
    </g>
  );
}

function Conn({ from, to }: { from: [number, number]; to: [number, number] }) {
  return <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} className={s.conn} />;
}

function Bubble({ g, selected, today, onSelect }: { g: RoundGauge; selected: boolean; today: boolean; onSelect?: (id: string) => void }) {
  const [x, y] = g.pos;
  const [fn, num] = g.id.split("-");
  const out = today ? g.latest?.outcome : undefined;
  const cls = [s.bubble, out ? s[out] : s.pending, selected ? s.sel : ""].join(" ");
  const latest = g.latest;
  const val = latest?.value;
  const span = g.max - g.min;
  const dp = span <= 20 ? 2 : span <= 200 ? 1 : 0;
  const status = out ? { logged: "logged", reshoot: "needs a new photo", held: "work order held", mismatch: "tag check needed" }[out] : "not read yet today";
  return (
    <g
      className={cls}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={`${g.id} ${g.name}: ${status}${val != null && out ? `, ${val.toFixed(dp)} ${g.unit}` : ""}`}
      aria-pressed={onSelect ? selected : undefined}
      onClick={() => onSelect?.(g.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.(g.id);
        }
      }}
    >
      <circle cx={x} cy={y} r="31" className={s.halo} />
      <circle cx={x} cy={y} r="26" className={s.ring} />
      <text x={x} y={y - 3} textAnchor="middle" className={s.fn}>{fn}</text>
      <text x={x} y={y + 15} textAnchor="middle" className={s.num}>{num}</text>
      {out && val != null && (
        <text x={x + 36} y={y - 14} className={s.reading}>
          {val.toFixed(dp)} {g.unit}
        </text>
      )}
      {out === "reshoot" && <text x={x + 36} y={y - 14} className={s.readingRed}>re-shoot</text>}
    </g>
  );
}
