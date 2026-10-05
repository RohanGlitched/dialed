"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ApiError, get, media } from "@/lib/api";
import type { Gauge, Order, Reading } from "@/lib/types";
import { ChartRecorder } from "./ChartRecorder";
import { TrendChart } from "./TrendChart";
import s from "./gauge.module.css";

type Data = { gauge: Gauge; readings: Reading[]; orders: Order[] };
const ROUTE = ["PI-101", "PI-102", "TI-201", "PI-103", "PI-104", "PI-105", "PI-106", "PI-107"];
const OUT = { logged: "LOGGED", held: "HOLD", reshoot: "RE-SHOOT", mismatch: "CHECK TAG" } as const;

export function GaugePage() {
  const q = useSearchParams();
  const id = q.get("id") || "TI-201";
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"chart" | "trend">("chart");
  useEffect(() => {
    setD(null);
    get<Data>(`/api/gauge/${encodeURIComponent(id)}`)
      .then(setD)
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Couldn't load this gauge."));
  }, [id]);

  const i = ROUTE.indexOf(id);
  const prev = i > 0 ? ROUTE[i - 1] : null;
  const next = i >= 0 && i < ROUTE.length - 1 ? ROUTE[i + 1] : null;
  const g = d?.gauge;
  const span = g ? g.max - g.min : 1;
  const dp = span <= 20 ? 2 : span <= 200 ? 1 : 0;
  const values = useMemo(() => (d?.readings ?? []).filter((r) => r.value != null).map((r) => ({ at: r.at, value: r.value as number, outcome: r.outcome })), [d]);
  const captures = (d?.readings ?? []).filter((r) => !r.seeded && r.images?.dial);
  const latest = d?.readings.find((r) => r.value != null);

  if (err) return <section className="wrap" style={{ paddingTop: 80 }}><p role="alert">{err}</p><Link href="/round/">Back to the round</Link></section>;

  return (
    <>
      <section className={`wrap ${s.head}`}>
        <div className={s.title}>
          <div className={s.bubble} aria-hidden="true"><span>{id.split("-")[0]}</span><span>{id.split("-")[1]}</span></div>
          <div>
            <p className="cell">Sheet 04, gauge sheet</p>
            <h1 className={`display ${s.h1}`}>{id} {g?.name ?? ""}</h1>
            <p className="lede" style={{ margin: "10px 0 0" }}>{g?.service ?? "Loading…"}</p>
          </div>
        </div>
        <div className={s.latest}>
          <p className={s.latestLabel}>Latest reading</p>
          <p className={s.value}>{latest?.value != null ? latest.value.toFixed(dp) : "–"}<small>{g?.unit}</small></p>
          <p className={s.latestWhen}>{latest ? new Date(latest.at).toLocaleString(undefined, { weekday: "long", hour: "2-digit", minute: "2-digit" }) : ""}{latest?.seeded ? " (history)" : ""}</p>
          <nav className={s.pager} aria-label="Other gauges on the round">
            {prev ? <Link href={`/gauge/?id=${prev}`}>Previous: {prev}</Link> : <span />}
            {next ? <Link href={`/gauge/?id=${next}`}>Next: {next}</Link> : null}
          </nav>
        </div>
      </section>

      <section className={`wrap ${s.chartSec}`} aria-labelledby="chart-h">
        <div className={s.chartHead}>
          <h2 id="chart-h" className="h2">The week on paper</h2>
          <div className={s.toggle} role="group" aria-label="Chart style">
            <button aria-pressed={view === "chart"} onClick={() => setView("chart")}>Circular chart</button>
            <button aria-pressed={view === "trend"} onClick={() => setView("trend")}>Two-week trend</button>
          </div>
        </div>
        <div className={s.chartGrid}>
          <div>{g ? (view === "chart" ? <ChartRecorder gauge={g} points={values} /> : <TrendChart gauge={g} points={values} />) : <div className={s.skel} />}</div>
          <div className={s.chartText}>
            <p>Plants used to log gauges like this on round paper charts that turned once a week. Dialed draws the same chart from photographed readings: the pen trace is every logged value, the shaded ring is the normal band, the dashed circle the alarm limit.</p>
            {g?.drift_per_day ? <p>The agent holds a work order when the week&apos;s trend moves faster than <b>{g.drift_per_day} {g.unit} a day</b>, before the reading itself leaves the band.</p> : null}
            {d && d.orders.length > 0 && (
              <div className={s.orders}>
                <h3 className="h3">Work orders on this gauge</h3>
                <ul>
                  {d.orders.map((o) => (
                    <li key={o.id}>
                      <span className={`tag ${o.status === "held" ? "held" : o.status}`}>{o.status === "held" ? "HOLD" : o.status.toUpperCase()}</span>
                      <Link href={`/desk/?order=${o.id}`}>{o.id}</Link> {o.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </section>

      {captures.length > 0 && (
        <section className="wrap section" aria-labelledby="photos-h">
          <div className="section-head">
            <h2 id="photos-h" className="h2">Every photo, straightened</h2>
            <p className="lede">Each capture as the reader saw it after straightening, so drift in the needle is visible side by side.</p>
          </div>
          <ul className={s.dials}>
            {captures.slice(0, 8).map((r) => (
              <li key={r.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={media(r.images.dial)} alt={`${id} straightened, ${r.read_value ?? "no reading"}`} loading="lazy" />
                <p><b>{r.read_value != null ? `${r.read_value.toFixed(dp)} ${g?.unit}` : "no reading"}</b> <span className={`tag ${r.outcome}`}>{OUT[r.outcome]}</span></p>
                <p className={s.dialWhen}>{new Date(r.at).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="wrap section" aria-labelledby="logtbl-h">
        <div className="section-head">
          <h2 id="logtbl-h" className="h2">Reading log</h2>
          <p className="lede">Newest first. History rows are seeded for the demo and have no photo; captured rows link to their evidence.</p>
        </div>
        <div className={s.tblWrap}>
          <table className={s.tbl}>
            <thead><tr><th scope="col">When</th><th scope="col">Value</th><th scope="col">Outcome</th><th scope="col">Confidence</th><th scope="col">Decided by</th><th scope="col">Note</th></tr></thead>
            <tbody>
              {(d?.readings ?? []).slice(0, 40).map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className={s.v}>{(r.value ?? r.read_value) != null ? `${(r.value ?? r.read_value)!.toFixed(dp)} ${g?.unit}` : "–"}</td>
                  <td>{r.seeded ? <span className={s.hist}>History</span> : <span className={`tag ${r.outcome}`}>{OUT[r.outcome]}</span>}</td>
                  <td>{r.confidence != null ? `${Math.round(r.confidence * 100)}%` : "–"}</td>
                  <td>{r.seeded ? "–" : r.engine}</td>
                  <td className={s.note}>{r.message || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {g && (
        <section className="wrap section" aria-labelledby="spec-h">
          <div className="section-head">
            <h2 id="spec-h" className="h2">Registration</h2>
            <p className="lede">What the agent checks every photo against. The scale angles are enrolled from the first confident reading, so a later photo whose numbers can&apos;t be read can still be read from the needle alone.</p>
          </div>
          <dl className={s.spec}>
            <div><dt>Scale</dt><dd>{g.min}–{g.max} {g.unit}</dd></div>
            <div><dt>Normal band</dt><dd>{g.normal[0]}–{g.normal[1]} {g.unit}</dd></div>
            <div><dt>Alarm low</dt><dd>{g.alarm.low ?? "none"}</dd></div>
            <div><dt>Alarm high</dt><dd>{g.alarm.high ?? "none"}</dd></div>
            <div><dt>Drift threshold</dt><dd>{g.drift_per_day ?? "none"} {g.drift_per_day ? `${g.unit} a day` : ""}</dd></div>
            <div><dt>Paired with</dt><dd>{g.pair ? `${g.pair.with}, ${g.pair.role} of ${g.pair.across}, drop limit ${g.pair.dp_limit} ${g.unit}` : "none"}</dd></div>
            <div><dt>Enrolled scale</dt><dd>{g.enrolled ? `starts at ${g.enrolled.start}°, sweeps ${g.enrolled.sweep}°` : "not yet: the next confident photo enrols it"}</dd></div>
          </dl>
        </section>
      )}
    </>
  );
}
