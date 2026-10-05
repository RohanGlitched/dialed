"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, get } from "@/lib/api";
import type { Reading, RoundData } from "@/lib/types";
import { Capture } from "./Capture";
import { RoundLog } from "./RoundLog";
import { Schematic } from "./Schematic";
import s from "./round.module.css";

/** Captures made today (in the viewer's time zone), not seeded history. */
export function todaySet(data: RoundData | null): Set<string> {
  const out = new Set<string>();
  if (!data) return out;
  const today = new Date().toDateString();
  for (const g of data.gauges) {
    const l = g.latest;
    if (l && !l.seeded && new Date(l.at).toDateString() === today) out.add(g.id);
  }
  return out;
}

export function RoundPage() {
  const [data, setData] = useState<RoundData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  const load = useCallback(() => {
    get<RoundData>("/api/round/pump-house")
      .then((d) => {
        setData(d);
        setErr(null);
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Couldn't load the round."));
  }, []);
  useEffect(load, [load]);

  const done = useMemo(() => todaySet(data), [data]);
  const order = data?.round.gauges ?? [];
  const next = order.find((id) => !done.has(id)) ?? null;
  const gauge = data?.gauges.find((g) => g.id === sel) ?? null;
  const counts = useMemo(() => {
    const c = { logged: 0, held: 0, reshoot: 0, mismatch: 0 };
    data?.gauges.forEach((g) => {
      if (done.has(g.id) && g.latest) c[g.latest.outcome]++;
    });
    return c;
  }, [data, done]);

  const onCaptured = (_r: Reading) => load();

  return (
    <>
      <section className={`wrap ${s.head}`}>
        <div>
          <p className="cell">Sheet 03</p>
          <h1 className={`display ${s.h1}`}>{data?.round.name ?? "The round"}</h1>
          <p className="lede">
            {data?.round.site ?? "Riverside Water Works"}, {(data?.round.shift ?? "Morning round").toLowerCase()}: eight gauges, one route. Tap a gauge on the drawing, photograph it, and the agent decides what happens to the reading. No pump house nearby? Every gauge has a demo photo.
          </p>
        </div>
        <div className={s.progress} aria-label="Round progress">
          <p className={s.progNum}>
            {done.size}
            <small> of {order.length || 8}</small>
          </p>
          <p className={s.progLabel}>gauges read today</p>
          <div className={s.bar} role="progressbar" aria-valuemin={0} aria-valuemax={order.length || 8} aria-valuenow={done.size}>
            {order.map((id) => {
              const g = data?.gauges.find((x) => x.id === id);
              const o = done.has(id) ? g?.latest?.outcome : undefined;
              return <span key={id} className={o ? s[o] : ""} title={`${id}${o ? `: ${o}` : ""}`} />;
            })}
          </div>
          <ul className={s.counts}>
            <li><span className="tag">LOGGED</span> {counts.logged}</li>
            <li><span className="tag held">HOLD</span> {counts.held}</li>
            <li><span className="tag reshoot">RE-SHOOT</span> {counts.reshoot}</li>
          </ul>
          {next ? (
            <button className="btn red" onClick={() => setSel(next)}>
              {done.size ? `Next: ${next}` : `Start the round at ${next}`}
            </button>
          ) : data ? (
            <p className={s.allDone}>Round complete. Held work orders wait on the <Link href="/desk/">approvals desk</Link>.</p>
          ) : null}
        </div>
      </section>

      <section className={`wrap ${s.drawing}`} aria-label="Plant drawing">
        {err && <p className={s.err} role="alert">{err} <button className="btn ghost" onClick={load}>Try again</button></p>}
        {data ? (
          <>
            <div className={s.scroller}>
              <Schematic gauges={data.gauges} selected={sel} onSelect={setSel} doneToday={done} />
            </div>
            <p className={s.scrollHint}>Swipe the drawing sideways to see the whole plant, or pick a gauge from the round log below.</p>
          </>
        ) : !err ? (
          <div className={s.skeleton} aria-busy="true" />
        ) : null}
        <ul className={s.legend} aria-label="Legend">
          <li><span className={`${s.dot} ${s.dPending}`} /> Not read today</li>
          <li><span className={`${s.dot} ${s.dLogged}`} /> Logged</li>
          <li><span className={`${s.dot} ${s.dHeld}`} /> Work order held</li>
          <li><span className={`${s.dot} ${s.dReshoot}`} /> Needs a new photo</li>
        </ul>
      </section>

      {gauge && data && (
        <section className={`wrap ${s.capture}`} id="capture" aria-label={`Capture ${gauge.id}`}>
          <Capture
            key={gauge.id}
            gauge={gauge}
            onCaptured={onCaptured}
            onNext={next && next !== gauge.id ? () => setSel(next) : undefined}
            onClose={() => setSel(null)}
          />
        </section>
      )}

      {data && (
        <section className="wrap section" aria-labelledby="log-h">
          <div className="section-head">
            <h2 id="log-h" className="h2">The round log</h2>
            <p className="lede">Every gauge on the route with its latest reading. Older readings are two weeks of seeded history; today&apos;s come from photos.</p>
          </div>
          <RoundLog data={data} done={done} onSelect={(id) => setSel(id)} />
        </section>
      )}

      <section className="wrap section" aria-labelledby="rules-h">
        <div className="section-head">
          <h2 id="rules-h" className="h2">What the agent may and may not do</h2>
          <p className="lede">The model chooses the next step. These guards decide whether it&apos;s allowed. They live in code, not in the prompt.</p>
        </div>
        <ol className={s.rules}>
          <li><b>No reading without confidence.</b> A value is logged only when the calibrated confidence is 90% or more and no photo issue blocks it.</li>
          <li><b>Re-shoot advice comes from measurements.</b> The guidance names the measured problem (glare on the needle, blur, tilt, distance), never a guess.</li>
          <li><b>Work orders need a measured breach.</b> A limit, a week&apos;s drift, or the pressure drop across the filter. Priority can&apos;t be set below what the breach says.</li>
          <li><b>Every figure is checked.</b> Numbers the model writes are compared with the measurements; any it can&apos;t back up are struck through on the order.</li>
          <li><b>The tag must match the dial.</b> If the printed unit or range disagrees with the gauge&apos;s registration, nothing is logged until someone checks the tag.</li>
          <li><b>A person approves every work order.</b> The agent can only hold one; a supervisor approves or rejects it on the approvals desk.</li>
        </ol>
      </section>
    </>
  );
}
