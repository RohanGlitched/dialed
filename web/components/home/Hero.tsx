"use client";
import Link from "next/link";
import { useState } from "react";
import { Unroll } from "@/components/Unroll";
import type { Inspect } from "@/lib/types";
import type { Phase } from "@/lib/unroll";
import hero from "@/public/showcase/hero/inspect.json";
import s from "./home.module.css";

const ins = hero as unknown as Inspect;
const STEPS = ["Found the dial", "Straightened it", "Unrolled the scale", "Read the needle"];

export function Hero() {
  const [stage, setStage] = useState(0);
  const [done, setDone] = useState(false);
  const onPhase = (p: Phase) => {
    setStage(p.stage);
    setDone(p.done);
  };
  const r = ins.reading;
  const span = (r.max ?? 1) - (r.min ?? 0);
  const dp = span <= 20 ? 2 : span <= 200 ? 1 : 0;
  return (
    <section className={`wrap ${s.hero}`} aria-labelledby="hero-title">
      <div className={s.heroText}>
        <h1 id="hero-title" className={`display ${s.h1}`}>
          Read any analog gauge from a phone photo.
        </h1>
        <p className="lede">
          Dialed finds the dial, straightens it, unrolls the scale and reads the needle with OpenCV&nbsp;5. Then an agent decides what happens next: log the reading, ask for a better photo, or hold a work order until someone signs it off.
        </p>
        <div className={s.ctas}>
          <Link className="btn" href="/read/">Read a gauge</Link>
          <Link className="btn ghost" href="/round/">Walk the sample round</Link>
        </div>
        <dl className={s.heroFacts}>
          <div><dt>Reads</dt><dd>Pressure and temperature dials with 180° to 300° scales</dd></div>
          <div><dt>Runs</dt><dd>OpenCV 5 on AWS Lambda, coaching on your phone with OpenCV.js</dd></div>
        </dl>
      </div>
      <figure className={s.stage}>
        <Unroll ins={ins} photo={ins.images!.photo!} face={ins.images!.face!} onPhase={onPhase} />
        <ol className={s.steps}>
          {STEPS.map((t, i) => (
            <li key={t} className={i === stage && !done ? s.on : i < stage || done ? s.done : ""}>
              <b>{i + 1}</b>
              {t}
            </li>
          ))}
        </ol>
        <div className={`${s.readout} ${done ? s.readoutOn : ""}`} aria-live="polite">
          <p className={s.value}>
            {r.value?.toFixed(dp)}
            <small>{r.unit}</small>
          </p>
          <ul className={s.facts}>
            <li><b>{Math.round(r.confidence * 100)}%</b> confidence</li>
            <li><b>{Math.round(r.tilt ?? 0)}°</b> camera tilt corrected</li>
            <li><b>{r.numbers.length}</b> scale numbers read</li>
            <li><b>{Math.round(r.timings.total ?? 0)} ms</b> to read</li>
          </ul>
          <div className={s.hangTag}>
            READ
            <span>Boiler steam pressure, steamship Virginia V (1922)</span>
          </div>
        </div>
        <figcaption className={s.credit}>
          <span className="sr">A photo of a boiler pressure gauge taken at an angle is straightened, its scale unrolled into a ruler, and the needle read. </span>
          Photo: <a href="https://commons.wikimedia.org/wiki/File:Virginia_V_(ship,_1922)_engine_room_16_-_Babcock_%26_Wilcox_pressure_gauge_on_boiler.jpg">Joe Mabel</a>, CC BY-SA 4.0, via Wikimedia Commons. Derived images under the same licence.
        </figcaption>
      </figure>
    </section>
  );
}
