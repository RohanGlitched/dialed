"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChartRecorder } from "@/components/gauge/ChartRecorder";
import { Schematic } from "@/components/round/Schematic";
import { todaySet } from "@/components/round/RoundPage";
import { get } from "@/lib/api";
import type { Gauge, Reading, RoundData } from "@/lib/types";
import evidence from "@/public/evidence/results.json";
import s from "./sections.module.css";

/* ---------- the camera coaches the shot ---------- */
export function CoachPreview() {
  return (
    <section className="wrap section" aria-labelledby="coach-h">
      <div className={s.coachGrid}>
        <div className={s.phone} aria-hidden="true">
          <div className={s.screen}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/tips/tilt-good.jpg" alt="" />
            <svg viewBox="0 0 100 75" className={s.screenOver} preserveAspectRatio="none">
              <ellipse cx="50" cy="40" rx="22" ry="21" className={s.coachRing} />
              <path d="M46,40 H54 M50,36 V44" className={s.coachRing} />
            </svg>
            <p className={s.screenHint}>Ready. Take the photo.</p>
          </div>
          <ul className={s.chips}>
            {["Dial in view", "Close enough", "Square on", "No glare", "Steady", "In focus"].map((c) => <li key={c}>✓ {c}</li>)}
          </ul>
          <div className={s.shutter} />
        </div>
        <div className={s.coachText}>
          <h2 id="coach-h" className="h2">The camera coaches the shot</h2>
          <p className="lede">Most bad readings start as bad photos. Before you press anything, OpenCV.js 5 runs in the phone&apos;s browser on every frame: it fits the dial&apos;s outline, measures how far you&apos;re standing off-axis, outlines reflections, checks focus and whether the phone is still.</p>
          <ul className={s.list}>
            <li><b>Tilt meter.</b> An analog gauge of the camera&apos;s own angle, from the dial ellipse&apos;s axis ratio.</li>
            <li><b>Glare outlines.</b> Blown-out highlights inside the dial are boxed in red, so you can step until they move off the needle.</li>
            <li><b>The shutter waits.</b> It only lights up once all six checks have passed for half a second. You can still take it anyway.</li>
            <li><b>Nothing leaves the phone</b> until you take the photo.</li>
          </ul>
          <Link className="btn red" href="/read/">Try the camera guide</Link>
        </div>
      </div>
    </section>
  );
}

/* ---------- the round ---------- */
export function RoundPreview() {
  const [d, setD] = useState<RoundData | null>(null);
  useEffect(() => {
    get<RoundData>("/api/round/pump-house").then(setD).catch(() => setD(null));
  }, []);
  const done = todaySet(d);
  return (
    <section className="wrap section" aria-labelledby="round-h">
      <div className="section-head">
        <h2 id="round-h" className="h2">A round through a pump house</h2>
        <p className="lede">The sample plant is a water-works pump house: two high-lift pumps, a sand filter, an air receiver and eight gauges on one route. Every bubble is a gauge; filled bubbles were read today. Each gauge has a demo photo, so you can walk it from your desk.</p>
      </div>
      {d ? <Schematic gauges={d.gauges} doneToday={done} compact /> : <div className={s.skel} aria-busy="true" />}
      <div className={s.rowEnd}>
        <p className="muted small">{d ? `${done.size} of ${d.round.gauges.length} read today, ${d.held.length} work order${d.held.length === 1 ? "" : "s"} waiting for approval.` : "Loading the live round…"}</p>
        <Link className="btn" href="/round/">Walk the round</Link>
      </div>
    </section>
  );
}

/* ---------- chart recorder ---------- */
export function RecorderPreview() {
  const [d, setD] = useState<{ gauge: Gauge; readings: Reading[] } | null>(null);
  useEffect(() => {
    get<{ gauge: Gauge; readings: Reading[] }>("/api/gauge/TI-201").then(setD).catch(() => setD(null));
  }, []);
  const pts = (d?.readings ?? []).filter((r) => r.value != null).map((r) => ({ at: r.at, value: r.value as number, outcome: r.outcome }));
  return (
    <section className="wrap section" aria-labelledby="rec-h">
      <div className={s.recGrid}>
        <div>{d ? <ChartRecorder gauge={d.gauge} points={pts} /> : <div className={s.skelRound} aria-busy="true" />}</div>
        <div className={s.recText}>
          <h2 id="rec-h" className="h2">A week on a round chart</h2>
          <p className="lede">Before data loggers, plants clipped paper discs into chart recorders that turned once a week. Each gauge in Dialed gets the same chart, drawn from its photographed readings.</p>
          <p>This is TI-201, the P-1 bearing from the clipboard. The pen climbs the whole week without crossing the dashed alarm ring. The agent didn&apos;t wait for that: the trend passed 2 °C a day, so it held a work order with the evidence and the arithmetic attached.</p>
          <Link className="btn ghost" href="/gauge/?id=TI-201">Open TI-201&apos;s sheet</Link>
        </div>
      </div>
    </section>
  );
}

/* ---------- accuracy ---------- */
type Row = { err: number | null; accepted: boolean; tilt: number | null };
export function Accuracy() {
  const sets = evidence.sets as unknown as Record<string, { summary: Record<string, number>; rows: Row[] }>;
  const n = sets.normal.summary;
  const h = sets.hard.summary;
  const real = sets.real;
  const rows = Object.values(sets).flatMap((x) => x.rows);
  const accRows = rows.filter((r) => r.accepted);
  const acc = accRows.length;
  const all = rows.length;
  const within2 = accRows.filter((r) => r.err != null && r.err < 0.02).length;
  const over5 = accRows.filter((r) => r.err != null && r.err >= 0.05).length;
  const bins = Array.from({ length: 10 }, (_, i) => i * 0.5); // % of span
  const hist = bins.map((b) => rows.filter((r) => r.accepted && r.err != null && r.err * 100 >= b && r.err * 100 < b + 0.5).length);
  const max = Math.max(...hist, 1);
  return (
    <section className="wrap section" aria-labelledby="acc-h">
      <div className="section-head">
        <h2 id="acc-h" className="h2">Accuracy, measured</h2>
        <p className="lede">Scored on {all} gauges the confidence model never saw: {n.n} rendered ordinary photos, {h.n} rendered bad ones (up to 50° off-axis, heavy glare and blur){real ? `, and ${real.rows.length + (sets.blind?.rows.length ?? 0)} photos of real gauges from Wikimedia Commons, read by eye. Real photos are harder: the Evidence page keeps the development photos apart from the blind ones, and lists every failure` : ""}.</p>
      </div>
      <div className={s.accGrid}>
        <dl className={s.big}>
          <div><dt>Accepted readings within 2% of the scale</dt><dd>{Math.round((within2 / Math.max(1, acc)) * 1000) / 10}<small>% of {acc}</small></dd></div>
          <div><dt>Accepted readings off by more than 5%</dt><dd>{over5}</dd></div>
          <div><dt>Ordinary photos accepted first time</dt><dd>{Math.round((n.accepted / n.n) * 100)}<small>%</small></dd></div>
          <div><dt>{real ? "Development photos of real gauges read within 2%" : "Bad photos sent back for a re-shoot"}</dt><dd>{real ? Math.round((real.summary.within_2pct_all ?? 0) * real.summary.read) : Math.round((h.reshoot / h.n) * 100)}<small>{real ? ` of ${real.summary.n}` : "%"}</small></dd></div>
        </dl>
        <figure className={s.hist}>
          <svg viewBox="0 0 520 260" role="img" aria-label="Histogram of errors of accepted readings">
            {hist.map((v, i) => (
              <g key={i}>
                <rect x={30 + i * 48} y={220 - (v / max) * 190} width={40} height={(v / max) * 190} className={s.bar} />
                <text x={50 + i * 48} y={214 - (v / max) * 190} textAnchor="middle" className={s.barN}>{v}</text>
                <text x={30 + i * 48} y={240} className={s.axis}>{bins[i].toFixed(1)}</text>
              </g>
            ))}
            <text x={30} y={258} className={s.axis}>error as % of the scale span (accepted readings)</text>
          </svg>
          <figcaption className="muted small">Errors of every accepted reading, as a share of the scale. The confidence threshold is 90%; below it the agent asks for another photo instead of guessing. {acc - within2} of {acc} accepted readings were off by 2% or more{over5 === 0 ? ", none by more than 5%" : ""}.</figcaption>
        </figure>
      </div>
      <Link className="btn ghost" href="/evidence/">See every chart, the failures and the method</Link>
    </section>
  );
}

/* ---------- architecture ---------- */
export function Architecture() {
  return (
    <section className="wrap section" aria-labelledby="arch-h">
      <div className="section-head">
        <h2 id="arch-h" className="h2">Built with OpenCV 5 on AWS</h2>
        <p className="lede">OpenCV runs twice: in the browser to coach the shot, and in the cloud to read it. Everything else is ordinary serverless AWS.</p>
      </div>
      <svg viewBox="0 0 1200 380" className={s.arch} role="img" aria-label="Architecture: phone with OpenCV.js, CloudFront, Lambda running OpenCV 5 and the agent, Bedrock, S3 and DynamoDB, approvals desk">
        <defs><marker id="aa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" className={s.ah} /></marker></defs>
        <Node x={20} y={120} w={200} h={140} t="Phone browser" lines={["OpenCV.js 5 (WASM)", "live dial fit, tilt,", "glare, focus checks"]} />
        <Node x={290} y={140} w={170} h={100} t="CloudFront" lines={["site from S3", "/api to Lambda"]} />
        <Node x={530} y={90} w={250} h={200} t="AWS Lambda (arm64)" lines={["OpenCV 5.0 reader", "cv.dnn text models", "agent tools and guards", "Function URL"]} bold />
        <Node x={860} y={30} w={170} h={90} t="Amazon Bedrock" lines={["Amazon Nova Micro"]} />
        <Node x={860} y={150} w={170} h={90} t="S3" lines={["photos, dials, traces"]} />
        <Node x={860} y={270} w={170} h={90} t="DynamoDB" lines={["gauges, readings, orders"]} />
        <Node x={1060} y={150} w={120} h={90} t="Desk" lines={["supervisor"]} />
        <path d="M220,190 H286" className={s.line} markerEnd="url(#aa)" />
        <path d="M460,190 H526" className={s.line} markerEnd="url(#aa)" />
        <path d="M780,130 L856,80" className={s.line} markerEnd="url(#aa)" />
        <path d="M780,190 H856" className={s.line} markerEnd="url(#aa)" />
        <path d="M780,250 L856,310" className={s.line} markerEnd="url(#aa)" />
        <path d="M1030,195 H1056" className={s.line} markerEnd="url(#aa)" />
      </svg>
      <ul className={s.archNotes}>
        <li><b>One function, cold start included.</b> OpenCV 5 and both text models ship in the Lambda package; a warm read takes about two seconds on Lambda, most of it reading the printed numbers.</li>
        <li><b>Two DNN engines, each where it&apos;s faster.</b> On CPU, OpenCV 5&apos;s new engine ran the text detector 2 to 4 times faster across our runs; the classic engine ran the recogniser 3 to 4 times faster.</li>
        <li><b>Repeatable.</b> One CloudFormation template creates every resource; one script builds and deploys.</li>
      </ul>
    </section>
  );
}

function Node({ x, y, w, h, t, lines, bold }: { x: number; y: number; w: number; h: number; t: string; lines: string[]; bold?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} className={bold ? s.nodeBold : s.node} />
      <text x={x + 14} y={y + 30} className={s.nodeT}>{t}</text>
      {lines.map((l, i) => <text key={i} x={x + 14} y={y + 54 + i * 20} className={s.nodeL}>{l}</text>)}
    </g>
  );
}

/* ---------- limits ---------- */
export function Limits() {
  return (
    <section className="wrap section" aria-labelledby="lim-h">
      <div className={s.limGrid}>
        <h2 id="lim-h" className="h2">What it won&apos;t do</h2>
        <ul className={s.limits}>
          <li><b>It won&apos;t guess.</b> Below 90% confidence there is no number, only a request for a better photo and the reason.</li>
          <li><b>It won&apos;t act alone on equipment.</b> The agent can hold a work order; releasing it takes a person.</li>
          <li><b>It doesn&apos;t read digital displays, sight glasses or two-needle dials</b> reliably yet, and vacuum scales with minus-sign labels need the gauge&apos;s registered range to be caught.</li>
          <li><b>It isn&apos;t a safety system.</b> Alarms and trips stay where they are; Dialed replaces the clipboard, not the interlock.</li>
        </ul>
      </div>
    </section>
  );
}
