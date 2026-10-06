"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { get } from "@/lib/api";
import type { Reading, RoundData } from "@/lib/types";
import s from "./logic.module.css";

/** The agent drawn as a logic diagram, then its latest real decisions from the sample round. */
export function LogicSheet() {
  const [ex, setEx] = useState<Reading[] | null>(null);
  useEffect(() => {
    get<RoundData>("/api/round/pump-house")
      .then(async (d) => {
        // the latest non-seeded capture for each outcome, across the round
        const all = await Promise.all(d.gauges.map((g) => get<{ readings: Reading[] }>(`/api/gauge/${g.id}?limit=12`).then((x) => x.readings).catch(() => [] as Reading[])));
        const live = all.flat().filter((r) => !r.seeded).sort((a, b) => (a.at < b.at ? 1 : -1));
        const pick: Reading[] = [];
        for (const o of ["held", "reshoot", "logged", "mismatch"] as const) {
          const r = live.find((x) => x.outcome === o);
          if (r) pick.push(r);
        }
        setEx(pick);
      })
      .catch(() => setEx([]));
  }, []);
  return (
    <section className="wrap section" aria-labelledby="logic-h">
      <div className="section-head">
        <h2 id="logic-h" className="h2">The agent&apos;s logic sheet</h2>
        <p className="lede">A model picks the next step from six tools. Guards written in code decide whether each step is allowed. What the camera measured changes every decision after it.</p>
      </div>
      <svg viewBox="0 0 1200 420" className={s.diagram} role="img" aria-label="Photo, OpenCV 5 reader, measurements, model with tools, guards, then three outcomes: logged, re-shoot, or hold for a person">
        <defs>
          <marker id="la" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" className={s.ah} /></marker>
        </defs>
        <Box x={20} y={170} w={130} h={80} t="Photo" sub="phone or upload" />
        <Box x={200} y={150} w={190} h={120} t="OpenCV 5 reader" sub="AWS Lambda" bold />
        <Box x={440} y={150} w={170} h={120} t="Measurements" sub="value, confidence, issues, unit, range" />
        <Box x={660} y={130} w={200} h={160} t="Model" sub="Amazon Nova Micro on Bedrock; rule engine if it doesn't answer" bold />
        <Box x={660} y={325} w={200} h={88} t="Guards" sub="confidence, breach, figures, tag" red />
        <path d="M150,210 H196" className={s.arrow} markerEnd="url(#la)" />
        <path d="M390,210 H436" className={s.arrow} markerEnd="url(#la)" />
        <path d="M610,210 H656" className={s.arrow} markerEnd="url(#la)" />
        <path d="M760,290 V326" className={s.arrowRed} markerEnd="url(#la)" />
        <path d="M700,330 V296" className={s.arrowRed} markerEnd="url(#la)" />
        <path d="M860,170 H900 V60 H936" className={s.arrow} markerEnd="url(#la)" />
        <path d="M860,210 H936" className={s.arrow} markerEnd="url(#la)" />
        <path d="M860,250 H900 V360 H936" className={s.arrow} markerEnd="url(#la)" />
        <Out x={940} y={30} label="LOGGED" sub="value in the round log" />
        <Out x={940} y={180} label="RE-SHOOT" sub="measured reason to the operator" kind="re" />
        <Out x={940} y={330} label="HOLD" sub="work order waits for a person" kind="hold" />
        <text x={230} y={300} className={s.note}>find, straighten, centre, unwrap, read, fit</text>
        <text x={455} y={300} className={s.note}>tools: read_gauge, compare_history</text>
      </svg>

      <div className={s.examples}>
        <h3 className="h3">Its latest decisions on the sample round</h3>
        {ex === null ? (
          <div className={s.skel} aria-busy="true" />
        ) : ex.length === 0 ? (
          <p className="muted">No captures yet today. <Link href="/round/">Walk the round</Link> and they appear here.</p>
        ) : (
          <ul className={s.cards}>
            {ex.map((r) => (
              <li key={r.id} className={s.card}>
                <span className={`tag ${r.outcome}`}>{{ logged: "LOGGED", held: "HOLD", reshoot: "RE-SHOOT", mismatch: "CHECK TAG" }[r.outcome]}</span>
                <p className={s.cardGauge}>{r.gauge}</p>
                <p className={s.cardMsg}>{r.message}</p>
                <p className={s.cardMeta}>{r.engine}, {r.tool_calls ?? 0} tool calls, {new Date(r.at).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}</p>
                <Link href={r.order ? `/desk/?order=${r.order}` : `/gauge/?id=${r.gauge}`}>{r.order ? `Open ${r.order}` : "Gauge sheet"}</Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Box({ x, y, w, h, t, sub, bold, red }: { x: number; y: number; w: number; h: number; t: string; sub: string; bold?: boolean; red?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} className={red ? s.boxRed : bold ? s.boxBold : s.box} />
      <text x={x + 14} y={y + 30} className={s.boxT}>{t}</text>
      <foreignObject x={x + 14} y={y + 38} width={w - 24} height={h - 42}>
        <p className={s.boxSub}>{sub}</p>
      </foreignObject>
    </g>
  );
}

function Out({ x, y, label, sub, kind }: { x: number; y: number; label: string; sub: string; kind?: "re" | "hold" }) {
  return (
    <g>
      <path d={`M${x + 18},${y} H${x + 230} V${y + 60} H${x + 18} L${x},${y + 30} Z`} className={kind === "hold" ? s.outHold : kind === "re" ? s.outRe : s.out} />
      <circle cx={x + 22} cy={y + 30} r="5" className={s.eyelet} />
      <text x={x + 38} y={y + 28} className={kind === "re" ? s.outTRe : s.outT}>{label}</text>
      <text x={x + 38} y={y + 47} className={s.outSub}>{sub}</text>
    </g>
  );
}
