"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, post, shrink } from "@/lib/api";
import type { Inspect } from "@/lib/types";
import samples from "@/public/samples/samples.json";
import { InspectView } from "./InspectView";
import s from "./reader.module.css";

type Sample = (typeof samples)[number];
type State = { kind: "idle" } | { kind: "reading"; preview: string; label: string } | { kind: "done"; ins: Inspect; label: string; truth?: { value: number; unit: string } } | { kind: "error"; message: string };

const STEPS = ["Uploading", "Finding the dial", "Straightening", "Reading the numbers", "Fitting the scale"];

/** Drop a photo or pick a sample; the API reads it and the full inspect view opens below. */
export function Reader({ compact = false, onCamera, incoming }: { compact?: boolean; onCamera?: () => void; incoming?: { photo: string; label: string } | null }) {
  const [st, setSt] = useState<State>({ kind: "idle" });
  const [drag, setDrag] = useState(false);
  const [tick, setTick] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const result = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (st.kind !== "reading") return;
    setTick(0);
    const t = setInterval(() => setTick((x) => Math.min(STEPS.length - 1, x + 1)), 650);
    return () => clearInterval(t);
  }, [st.kind]);

  const read = useCallback(async (photo: string, label: string, truth?: { value: number; unit: string }) => {
    setSt({ kind: "reading", preview: photo, label });
    try {
      const ins = await post<Inspect>("/api/read", { photo });
      setSt({ kind: "done", ins, label, truth });
      requestAnimationFrame(() => result.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      setSt({ kind: "error", message: e instanceof ApiError ? e.message : "Reading failed. Try another photo." });
    }
  }, []);

  useEffect(() => {
    if (incoming) read(incoming.photo, incoming.label);
  }, [incoming, read]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setSt({ kind: "error", message: "That isn't an image. Use a JPEG, PNG or HEIC photo of a gauge." });
      return;
    }
    try {
      read(await shrink(f), f.name);
    } catch {
      setSt({ kind: "error", message: "Your browser couldn't open that photo. Try a JPEG." });
    }
  };

  const onSample = async (x: Sample) => {
    const blob = await (await fetch(x.src)).blob();
    read(await shrink(blob), x.label, { value: x.truth, unit: x.unit });
  };

  return (
    <div className={s.reader}>
      <div className={s.inputs}>
        <label
          className={`${s.drop} ${drag ? s.dragging : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            onFile(e.dataTransfer.files[0]);
          }}
        >
          <input ref={input} type="file" accept="image/*" capture="environment" className="sr" onChange={(e) => onFile(e.target.files?.[0] ?? undefined)} />
          <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true" className={s.dropIcon}>
            <circle cx="28" cy="28" r="24" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 5" />
            <path d="M28 18 V38 M19 27 L28 18 L37 27" fill="none" stroke="currentColor" strokeWidth="2.5" />
          </svg>
          <span className={s.dropTitle}>Drop a gauge photo here</span>
          <span className={s.dropSub}>or choose a file. On a phone this opens the camera.</span>
        </label>
        <div className={s.side}>
          {onCamera && (
            <button type="button" className="btn red" onClick={onCamera}>
              Use the live camera guide
            </button>
          )}
          <p className={s.sideHead}>Or try a sample</p>
          <ul className={s.tray}>
            {samples.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => onSample(x)} className={s.sample} aria-label={`Read sample: ${x.label}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={x.thumb} alt="" width={120} height={90} />
                  <span>{x.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className={s.note}>Samples are rendered test gauges with known answers. Your photo is read and discarded; nothing is stored.</p>
        </div>
      </div>

      <div ref={result} className={s.result} aria-live="polite">
        {st.kind === "reading" && (
          <div className={s.reading}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={st.preview} alt="Your photo" className={s.preview} />
            <ol className={s.progress}>
              {STEPS.map((t, i) => (
                <li key={t} className={i < tick ? s.pDone : i === tick ? s.pOn : ""}>{t}</li>
              ))}
            </ol>
          </div>
        )}
        {st.kind === "error" && (
          <div className={s.error} role="alert">
            <p>{st.message}</p>
            <button className="btn ghost" onClick={() => setSt({ kind: "idle" })}>Try again</button>
          </div>
        )}
        {st.kind === "done" && (
          <>
            <div className={s.resultHead}>
              <p className={s.resultLabel}>Read: {st.label}</p>
              {st.truth && st.ins.reading.value != null && (
                <p className={s.truth}>
                  Known answer {st.truth.value} {st.truth.unit}; off by {Math.abs(st.ins.reading.value - st.truth.value).toFixed(2)} {st.truth.unit}
                </p>
              )}
            </div>
            <InspectView ins={st.ins} compact={compact} />
          </>
        )}
      </div>
    </div>
  );
}
