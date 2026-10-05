"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CameraCoach } from "@/components/camera/CameraCoach";
import { Unroll } from "@/components/Unroll";
import { ApiError, get, media, post, shrink } from "@/lib/api";
import type { Inspect, Reading, RoundGauge } from "@/lib/types";
import demo from "@/public/demo/demo.json";
import { Spark } from "./Spark";
import { Trace } from "./Trace";
import s from "./capture.module.css";

type DemoShot = { src: string; variant: string; truth: number };
const OUTCOME = { logged: "LOGGED", held: "HOLD", reshoot: "RE-SHOOT", mismatch: "CHECK TAG" } as const;

const STEPS = ["Uploading the photo", "Reading the gauge with OpenCV 5", "The agent is deciding", "Saving the evidence"];

export function Capture({ gauge, onCaptured, onNext, onClose }: { gauge: RoundGauge; onCaptured: (r: Reading) => void; onNext?: () => void; onClose: () => void }) {
  const [mode, setMode] = useState<"pick" | "camera" | "busy" | "done" | "error">("pick");
  const [rec, setRec] = useState<Reading | null>(null);
  const [ins, setIns] = useState<Inspect | null>(null);
  const [msg, setMsg] = useState("");
  const [tick, setTick] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const shots = ((demo as Record<string, DemoShot[]>)[gauge.id] ?? []) as DemoShot[];
  const span = gauge.max - gauge.min;
  const dp = span <= 20 ? 2 : span <= 200 ? 1 : 0;

  useEffect(() => {
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  useEffect(() => {
    if (mode !== "busy") return;
    setTick(0);
    const t = setInterval(() => setTick((x) => Math.min(STEPS.length - 1, x + 1)), 1100);
    return () => clearInterval(t);
  }, [mode]);

  const send = async (photo: string) => {
    setPreview(photo);
    setMode("busy");
    setIns(null);
    try {
      const r = await post<Reading>("/api/capture", { gauge: gauge.id, photo, run: new Date().toISOString().slice(0, 10) });
      setRec(r);
      setMode("done");
      onCaptured(r);
      if (r.inspect) get<Inspect>(r.inspect).then(setIns).catch(() => setIns(null));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "The capture failed. Try again.");
      setMode("error");
    }
  };

  const pickDemo = async (d: DemoShot) => {
    const blob = await (await fetch(d.src)).blob();
    send(await shrink(blob));
  };

  const onFile = async (f?: File) => {
    if (!f) return;
    try {
      send(await shrink(f));
    } catch {
      setMsg("Your browser couldn't open that photo. Try a JPEG.");
      setMode("error");
    }
  };

  const last = gauge.recent[gauge.recent.length - 1];

  return (
    <div className={s.capture} ref={top}>
      <div className={s.bar}>
        <p className={s.barLabel}>Capture</p>
        <button className={s.close} onClick={onClose} aria-label={`Close ${gauge.id}`}>Close</button>
      </div>
      <header className={s.card}>
        <div className={s.tagBubble} aria-hidden="true">
          <span>{gauge.id.split("-")[0]}</span>
          <span>{gauge.id.split("-")[1]}</span>
        </div>
        <div className={s.cardText}>
          <h2 className={s.title}>{gauge.id} {gauge.name}</h2>
          <p className={s.service}>{gauge.service}</p>
        </div>
        <dl className={s.spec}>
          <div><dt>Scale</dt><dd>{gauge.min}–{gauge.max} {gauge.unit}</dd></div>
          <div><dt>Normal</dt><dd>{gauge.normal[0]}–{gauge.normal[1]} {gauge.unit}</dd></div>
          <div><dt>Alarm</dt><dd>{[gauge.alarm.low != null ? `below ${gauge.alarm.low}` : null, gauge.alarm.high != null ? `above ${gauge.alarm.high}` : null].filter(Boolean).join(", ") || "none"}</dd></div>
          <div><dt>Last</dt><dd>{last ? `${last.value.toFixed(dp)} ${gauge.unit}` : "–"}</dd></div>
        </dl>
        <div className={s.spark}>
          <Spark points={gauge.recent} lo={gauge.normal[0]} hi={gauge.normal[1]} min={gauge.min} max={gauge.max} />
          <p className={s.sparkLabel}>Last {gauge.recent.length} readings against the normal band</p>
        </div>
      </header>

      {mode === "pick" && (
        <div className={s.pick}>
          <button className={`btn red ${s.big}`} onClick={() => setMode("camera")}>Photograph it with the camera guide</button>
          <label className={`btn ghost ${s.big}`}>
            Upload a photo
            <input type="file" accept="image/*" className="sr" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {shots.length > 0 && (
            <div className={s.demo}>
              <p className={s.demoHead}>No gauge to hand? Use a demo photo of {gauge.id}</p>
              <ul className={s.demoList}>
                {shots.map((d) => (
                  <li key={d.src}>
                    <button onClick={() => pickDemo(d)} className={s.demoBtn} aria-label={`Use the ${d.variant} demo photo`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={d.src} alt="" />
                      <span>{{ clear: "Clear shot", glare: "With glare on the needle", shaky: "Shaky, out of focus" }[d.variant] ?? d.variant}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className={s.small}>Demo photos are rendered gauges; the reader and the agent treat them like any photo.</p>
            </div>
          )}
        </div>
      )}

      {mode === "camera" && (
        <CameraCoach target={`${gauge.id} ${gauge.name}`} onClose={() => setMode("pick")} onShot={(p) => send(p)} />
      )}

      {mode === "busy" && (
        <div className={s.busy}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview && <img src={preview} alt="The photo being read" />}
          <ol className={s.progress} aria-live="polite">
            {STEPS.map((t, i) => (
              <li key={t} className={i < tick ? s.pDone : i === tick ? s.pOn : ""}>{t}</li>
            ))}
          </ol>
        </div>
      )}

      {mode === "error" && (
        <div className={s.error} role="alert">
          <p>{msg}</p>
          <button className="btn ghost" onClick={() => setMode("pick")}>Try again</button>
        </div>
      )}

      {mode === "done" && rec && (
        <div className={s.result}>
          <div className={s.outcome}>
            <span className={`tag ${rec.outcome}`}>{OUTCOME[rec.outcome]}</span>
            {rec.value != null && (
              <p className={s.value}>
                {rec.value.toFixed(dp)}
                <small>{gauge.unit}</small>
              </p>
            )}
            <p className={s.message}>{rec.message}</p>
            <div className={s.actions}>
              {rec.outcome === "reshoot" || rec.outcome === "mismatch" ? (
                <button className="btn red" onClick={() => setMode("pick")}>Take it again</button>
              ) : onNext ? (
                <button className="btn red" onClick={onNext}>Next gauge</button>
              ) : null}
              {rec.order && <Link className="btn hold" href={`/desk/?order=${rec.order}`}>Open {rec.order}</Link>}
              <Link className="btn ghost" href={`/gauge/?id=${gauge.id}`}>Gauge sheet</Link>
            </div>
          </div>
          <div className={s.evidence}>
            {ins?.images?.photo && ins.images.face && ins.geometry.center ? (
              <Unroll ins={ins} photo={media(ins.images.photo)!} face={media(ins.images.face)!} label={`${gauge.id}: the photo straightened and the scale unrolled`} />
            ) : rec.images.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={media(rec.images.photo)} alt="The photo" className={s.photo} />
            ) : null}
          </div>
          <div className={s.traceBox}>
            <h3 className="h3">How the agent decided</h3>
            <Trace steps={rec.steps ?? []} engine={rec.engine} />
          </div>
        </div>
      )}
    </div>
  );
}
