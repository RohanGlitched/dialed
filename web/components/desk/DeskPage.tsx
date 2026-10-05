"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Unroll } from "@/components/Unroll";
import { Trace } from "@/components/round/Trace";
import { TrendChart } from "@/components/gauge/TrendChart";
import { ApiError, get, media, post } from "@/lib/api";
import type { Gauge, Inspect, Order, Reading } from "@/lib/types";
import s from "./desk.module.css";

type Detail = { order: Order; reading: Reading | null; gauge: Gauge | null };

const ago = (iso: string, until: number = Date.now()) => {
  const m = Math.max(0, (until - +new Date(iso)) / 60000);
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 60 * 48) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} days`;
};

/** Model-written text with figures the guard couldn't verify struck out (~~x~~). */
function Checked({ text }: { text: string }) {
  const parts = text.split(/(~~[^~]+~~)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("~~") ? (
          <del key={i} title="This figure didn't match any measurement, so it was struck out">{p.slice(2, -2)}</del>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function DeskPage() {
  const q = useSearchParams();
  const router = useRouter();
  const sel = q.get("order");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    get<{ orders: Order[] }>("/api/orders")
      .then((r) => setOrders(r.orders))
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Couldn't load work orders."));
  }, []);
  useEffect(load, [load]);
  const held = (orders ?? []).filter((o) => o.status === "held");
  const decided = (orders ?? []).filter((o) => o.status !== "held");
  const open = (id: string) => router.push(`/desk/?order=${id}`, { scroll: false });
  const oldest = held.length ? held.reduce((a, b) => (a.at < b.at ? a : b)) : null;

  return (
    <>
      <section className={`wrap ${s.head}`}>
        <div>
          <p className="cell">Sheet 05</p>
          <h1 className={`display ${s.h1}`}>Approvals</h1>
          <p className="lede">The agent can hold a work order; only a person can release it. Every order carries the photo, what the reader measured, the trend and the agent&apos;s reasoning, with any figure it couldn&apos;t back up struck out.</p>
        </div>
        <dl className={s.stats}>
          <div><dt>Waiting</dt><dd>{orders ? held.length : "–"}</dd></div>
          <div><dt>Oldest</dt><dd>{oldest ? ago(oldest.at) : "–"}</dd></div>
          <div><dt>Approved</dt><dd>{orders ? decided.filter((o) => o.status === "approved").length : "–"}</dd></div>
          <div><dt>Rejected</dt><dd>{orders ? decided.filter((o) => o.status === "rejected").length : "–"}</dd></div>
        </dl>
      </section>

      <section className={`wrap ${s.rackSec}`} aria-labelledby="rack-h">
        <h2 id="rack-h" className="sr">Held work orders</h2>
        <div className={s.rail} aria-hidden="true" />
        {err && <p role="alert">{err}</p>}
        {orders && held.length === 0 && (
          <div className={s.empty}>
            <p>Nothing is waiting. When the agent holds a work order on the round, its tag hangs here.</p>
            <Link className="btn" href="/round/">Walk the round</Link>
          </div>
        )}
        <ul className={s.rack}>
          {held.map((o) => (
            <li key={o.id}>
              <button className={`${s.hang} ${sel === o.id ? s.hangOn : ""} ${s[o.priority]}`} onClick={() => open(o.id)} aria-pressed={sel === o.id}>
                <span className={s.hole} aria-hidden="true" />
                <span className={s.hangHead}>HOLD</span>
                <span className={s.hangId}>{o.id}</span>
                <span className={s.hangGauge}>{o.gauge} {o.gauge_name}</span>
                <span className={s.hangTitle}><Checked text={o.title} /></span>
                <span className={s.hangMeta}>{o.priority} priority, waiting {ago(o.at)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {sel && <OrderDetail id={sel} onDecided={load} />}

      {decided.length > 0 && (
        <section className="wrap section" aria-labelledby="dec-h">
          <div className="section-head">
            <h2 id="dec-h" className="h2">Decided</h2>
            <p className="lede">Who released or rejected each order, when, and why.</p>
          </div>
          <table className={s.tbl}>
            <thead><tr><th scope="col">Order</th><th scope="col">Gauge</th><th scope="col">Decision</th><th scope="col">By</th><th scope="col">Waited</th><th scope="col">Note</th></tr></thead>
            <tbody>
              {decided.map((o) => (
                <tr key={o.id}>
                  <td><button className={s.linkBtn} onClick={() => open(o.id)}>{o.id}</button></td>
                  <td>{o.gauge} {o.gauge_name}</td>
                  <td><span className={`tag ${o.status}`}>{o.status.toUpperCase()}</span></td>
                  <td>{o.decided_by}</td>
                  <td>{o.decided_at ? ago(o.at, +new Date(o.decided_at)) : "–"}</td>
                  <td className={s.noteCell}>{o.note || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="wrap section" aria-labelledby="why-h">
        <div className="section-head">
          <h2 id="why-h" className="h2">Why a person signs off</h2>
          <p className="lede">A misread gauge that sends a fitter to strip a healthy pump costs a shift. A missed one costs a pump. So the agent does the reading, the arithmetic and the paperwork; a supervisor makes the call.</p>
        </div>
        <ul className={s.why}>
          <li><b>Evidence, not a summary.</b> The order shows the photo, the straightened dial and the unrolled scale, so the reading can be checked by eye in seconds.</li>
          <li><b>Checked figures.</b> Every number in the agent&apos;s text was compared with the measurements; anything that didn&apos;t match is struck through, not hidden.</li>
          <li><b>Priority floor.</b> The agent can raise priority but never set it below what the breach says: an alarm-limit breach is always urgent.</li>
          <li><b>One click, with a reason.</b> Approve or reject with a note; the decision and who made it stay on the order.</li>
        </ul>
      </section>
    </>
  );
}

function OrderDetail({ id, onDecided }: { id: string; onDecided: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [ins, setIns] = useState<Inspect | null>(null);
  const [history, setHistory] = useState<{ at: string; value: number; outcome?: string }[]>([]);
  const [note, setNote] = useState("");
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    setD(null);
    setIns(null);
    setMsg(null);
    get<Detail>(`/api/order/${id}`).then((x) => {
      setD(x);
      if (x.reading?.inspect) get<Inspect>(x.reading.inspect).then(setIns).catch(() => setIns(null));
      get<{ readings: Reading[] }>(`/api/gauge/${x.order.gauge}`)
        .then((g) => setHistory(g.readings.filter((r) => r.value != null).map((r) => ({ at: r.at, value: r.value as number, outcome: r.outcome }))))
        .catch(() => setHistory([]));
    }).catch((e) => setMsg(e instanceof ApiError ? e.message : "Couldn't open this order."));
    try {
      setBy(localStorage.getItem("dialed.name") || "");
    } catch {
      /* private mode */
    }
  }, [id]);

  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    try {
      try {
        if (by) localStorage.setItem("dialed.name", by);
      } catch {
        /* private mode */
      }
      const r = await post<{ order: Order }>(`/api/order/${id}/decision`, { decision, note, by: by || "Supervisor" });
      setD((x) => (x ? { ...x, order: r.order } : x));
      setMsg(decision === "approve" ? `${id} approved. It's released to maintenance.` : `${id} rejected. The reading stays in the log.`);
      onDecided();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "The decision didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!d) return <section className={`wrap ${s.detail}`}>{msg ? <p role="alert">{msg}</p> : <div className={s.skel} aria-busy="true" />}</section>;
  const o = d.order;
  const g = d.gauge;
  return (
    <section className={`wrap ${s.detail}`} aria-labelledby="ord-h" id="order">
      <div className={s.sheet}>
        <header className={s.ordHead}>
          <div>
            <p className={s.ordId}>{o.id} <span className={`tag ${o.status === "held" ? "held" : o.status}`}>{o.status === "held" ? "HOLD" : o.status.toUpperCase()}</span></p>
            <h2 id="ord-h" className={s.ordTitle}><Checked text={o.title} /></h2>
            <p className={s.ordMeta}>{o.gauge} {o.gauge_name}, {o.priority} priority, raised {new Date(o.at).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })} by {o.engine}</p>
          </div>
          <p className={s.ordValue}>{o.value != null && g ? o.value.toFixed(g.max - g.min <= 20 ? 2 : 1) : "–"}<small>{o.unit}</small></p>
        </header>
        <div className={s.ordGrid}>
          <div className={s.reason}>
            <h3 className="h3">Reason</h3>
            <p><Checked text={o.reason} /></p>
            {o.struck.length > 0 && <p className={s.struckNote}>Struck figures ({o.struck.join(", ")}) didn&apos;t match any measurement.</p>}
            <h3 className="h3">Measured breaches</h3>
            <ul className={s.breaches}>
              {o.breaches.map((b, i) => <li key={i} className={s[b.severity]}><b>{b.severity}</b> {b.text}</li>)}
            </ul>
          </div>
          <div className={s.evid}>
            {ins?.images?.photo && ins.images.face && ins.geometry.center ? (
              <Unroll ins={ins} photo={media(ins.images.photo)!} face={media(ins.images.face)!} label={`Evidence for ${o.id}`} />
            ) : o.evidence?.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={media(o.evidence.photo)} alt="Photo of the gauge" className={s.photo} />
            ) : null}
            {o.evidence?.dial && (
              <div className={s.thumbs}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={media(o.evidence.photo)} alt="As photographed" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={media(o.evidence.dial)} alt="Straightened" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {o.evidence.ink && <img src={media(o.evidence.ink)} alt="Strokes the reader used" />}
              </div>
            )}
          </div>
        </div>
        {g && history.length > 1 && (
          <div className={s.trend}>
            <h3 className="h3">{g.id} over two weeks</h3>
            <TrendChart gauge={g} points={history} />
          </div>
        )}
        {d.reading?.steps && (
          <div className={s.trace}>
            <h3 className="h3">How the agent got here</h3>
            <Trace steps={d.reading.steps} engine={d.reading.engine} />
          </div>
        )}
        <div className={s.decide}>
          {o.status === "held" ? (
            <>
              <label className={s.field}>
                <span>Your name</span>
                <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Supervisor" maxLength={40} autoComplete="name" />
              </label>
              <label className={`${s.field} ${s.grow}`}>
                <span>Note (optional)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. check bearing grease first" maxLength={300} />
              </label>
              <div className={s.btns}>
                <button className="btn" disabled={busy} onClick={() => decide("approve")}>Approve {o.id}</button>
                <button className="btn ghost" disabled={busy} onClick={() => decide("reject")}>Reject</button>
              </div>
            </>
          ) : (
            <p className={s.decided}>
              <span className={`tag ${o.status}`}>{o.status.toUpperCase()}</span> by {o.decided_by} {o.decided_at ? new Date(o.decided_at).toLocaleString() : ""}{o.note ? `: “${o.note}”` : ""}
            </p>
          )}
          {msg && <p className={s.msg} role="status">{msg}</p>}
        </div>
      </div>
    </section>
  );
}
