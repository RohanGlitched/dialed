"use client";
import { useId, useState } from "react";
import { Unroll } from "@/components/Unroll";
import type { Inspect } from "@/lib/types";
import { STAGES, StageView, type StageKey } from "./Stages";
import s from "./inspect.module.css";

const ACCEPT_AT = 0.9;

/** Everything the reader saw on one photo: the sequence, the result, then every stage up close. */
export function InspectView({ ins, compact = false }: { ins: Inspect; compact?: boolean }) {
  const [stage, setStage] = useState<StageKey>("find");
  const id = useId();
  const r = ins.reading;
  const g = ins.geometry;
  const span = (r.max ?? 1) - (r.min ?? 0);
  const dp = span <= 20 ? 2 : span <= 200 ? 1 : 0;
  const blocked = r.issues.some((i) => i.level === "block");
  const verdict = r.value == null || blocked ? "reshoot" : r.confidence < ACCEPT_AT ? "reshoot" : "logged";
  const canSequence = !!(ins.images?.photo && ins.images?.face && g.center && g.M);
  const idx = STAGES.findIndex((x) => x.key === stage);

  return (
    <div className={s.inspect}>
      <div className={s.top}>
        <div className={s.seq}>
          {canSequence ? (
            <Unroll ins={ins} photo={ins.images!.photo!} face={ins.images!.face!} />
          ) : (
            <StageView ins={ins} stage="find" />
          )}
        </div>
        <div className={s.result}>
          {r.value != null ? (
            <p className={s.value}>
              {r.value.toFixed(dp)}
              <small>{r.unit ?? ""}</small>
            </p>
          ) : (
            <p className={s.noValue}>No reading</p>
          )}
          <p className={s.conf}>
            <b>{Math.round(r.confidence * 100)}%</b> confidence {r.confidence >= ACCEPT_AT ? "(enough to log)" : `(needs ${Math.round(ACCEPT_AT * 100)}% to log)`}
          </p>
          <span className={`tag ${verdict}`}>{verdict === "logged" ? "WOULD LOG" : "RE-SHOOT"}</span>
          {r.issues.length > 0 && (
            <ul className={s.issues}>
              {r.issues.map((i, k) => (
                <li key={k} className={i.level === "block" ? s.block : s.warn}>
                  {i.text}
                </li>
              ))}
            </ul>
          )}
          {!compact && (
            <dl className={s.kv}>
              <div><dt>Camera tilt</dt><dd>{r.tilt != null ? `${Math.round(r.tilt)}°` : "–"}</dd></div>
              <div><dt>Needle</dt><dd>{r.needle_angle != null ? `${r.needle_angle.toFixed(1)}°` : "–"}</dd></div>
              <div><dt>Scale read</dt><dd>{r.numbers.length ? `${r.numbers.length} numbers, ${r.min}–${r.max}` : "–"}</dd></div>
              <div><dt>Time</dt><dd>{r.timings.total ? `${Math.round(r.timings.total)} ms` : "–"}</dd></div>
            </dl>
          )}
        </div>
      </div>

      <div className={s.stagesWrap}>
        <div role="tablist" aria-label="Pipeline stages" className={s.tabs}>
          {STAGES.map((st, i) => (
            <button
              key={st.key}
              role="tab"
              id={`${id}-${st.key}`}
              aria-selected={stage === st.key}
              aria-controls={`${id}-panel`}
              tabIndex={stage === st.key ? 0 : -1}
              className={s.tab}
              onClick={() => setStage(st.key)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  const n = (i + (e.key === "ArrowRight" ? 1 : STAGES.length - 1)) % STAGES.length;
                  setStage(STAGES[n].key);
                  document.getElementById(`${id}-${STAGES[n].key}`)?.focus();
                }
              }}
            >
              <span className={s.tabNo}>{i + 1}</span>
              {st.title}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${stage}`} className={s.panel}>
          <div className={s.panelFig}>
            <StageView ins={ins} stage={stage} />
          </div>
          <div className={s.panelText}>
            <p className={s.stageNo}>Stage {idx + 1} of {STAGES.length}</p>
            <h3 className="h3">{STAGES[idx].title}</h3>
            <p className={s.fn}>OpenCV: {STAGES[idx].fn}</p>
            <p className={s.caption}>{caption(stage, ins)}</p>
            <div className={s.panelNav}>
              <button className="btn ghost" disabled={idx === 0} onClick={() => setStage(STAGES[idx - 1].key)}>Previous</button>
              <button className="btn ghost" disabled={idx === STAGES.length - 1} onClick={() => setStage(STAGES[idx + 1].key)}>Next stage</button>
            </div>
          </div>
        </div>
      </div>

      {!compact && <Measurements ins={ins} />}
    </div>
  );
}

export function caption(stage: StageKey, ins: Inspect): string {
  const g = ins.geometry;
  const r = ins.reading;
  const n = g.candidates.length;
  switch (stage) {
    case "find":
      return g.ellipse
        ? `${n} ellipse${n === 1 ? "" : "s"} fitted to edge contours and bright or dark regions. Each is scored by how much of its outline lies on real edges, its size and its roundness; the red one won.`
        : "No outline in the photo looked enough like a dial. Fill most of the frame with the gauge.";
    case "edges":
      return "Canny edges with thresholds taken from the gradient itself, so pale and dark scenes both work. The dial's rim is the longest closed curve.";
    case "straight":
      return r.tilt != null ? `The ellipse becomes a circle: one affine warp undoes about ${Math.round(r.tilt)}° of camera tilt. Upright text stays upright.` : "The dial was not straightened.";
    case "centre": {
      const k = g.tick_lines?.length ?? 0;
      const d = g.center ? Math.hypot(g.center[0] - g.dial_size / 2, g.center[1] - g.dial_size / 2) : 0;
      return k
        ? `${k} tick marks were measured as short lines. Lines stay straight under perspective, so where they meet is the true pivot: ${d.toFixed(0)} px from the rim's centre (cross). Angles are measured from here.`
        : "Too few tick marks were clear enough to locate the pivot, so the rim's centre is used.";
    }
    case "ink":
      return "Black-hat (or top-hat on dark faces) keeps only strokes thinner than about a tenth of the radius: needle, ticks, numbers. Glare, shading and the face colour drop out, so the needle stands alone.";
    case "unroll": {
      const span = (r.max ?? 1) - (r.min ?? 0);
      const v = r.value != null ? r.value.toFixed(span <= 20 ? 2 : span <= 200 ? 1 : 0) : null;
      return `The ring between the numbers and the rim is unwrapped into a straight strip around the true centre. The needle becomes one vertical line on a ruler${v != null ? `, at ${v} ${r.unit ?? ""}` : ""}.`;
    }
    case "numbers": {
      const t = g.text?.length ?? 0;
      const used = g.text?.filter((x) => x.used).length ?? 0;
      return `${t} text regions found by PP-OCRv3 and read by CRNN (OpenCV Model Zoo, cv.dnn classic engine). ${used} printed numbers agreed on one scale and were used; the rest were units, brand names or misreads.`;
    }
    case "fit":
      return "Each number's angle and value; RANSAC throws out misreads, then the value is interpolated between neighbouring numbers, which absorbs leftover perspective error.";
    case "needle":
      return "For every quarter degree, how much ink runs the whole inner band. The needle is the one angle where a stroke reaches from the hub to the ticks.";
  }
}

function Measurements({ ins }: { ins: Inspect }) {
  const f = ins.reading.features;
  const t = ins.reading.timings;
  const rows: [string, string, string][] = [
    ["Needle contrast", fmt(f.contrast), "How clearly the best needle angle beats the second best (0 to 1)"],
    ["Numbers used", fmt(f.inliers, 0), "Printed numbers that agree on one scale"],
    ["Share of numbers used", pct(f.inlier_share), "Numbers used out of all numbers read"],
    ["Fit residual", pct(f.resid), "Spread of the numbers around the fitted scale, as a share of the span"],
    ["Local vs global fit", pct(f.disagree), "Difference between the interpolated and straight-line value"],
    ["Camera tilt", fmt((f.tilt ?? 0) * 90, 0) + "°", "From the rim ellipse's axis ratio"],
    ["Glare", pct(f.glare), "Share of the face that is blown out"],
    ["Rim support", pct(f.support), "Share of the rim outline that sits on detected edges"],
    ["Tick lines", fmt((f.tick_lines ?? 0) * 30, 0), "Tick marks used to locate the true centre"],
  ];
  return (
    <section className={s.meas} aria-label="Measurements">
      <h3 className="h3">Every measurement behind the confidence</h3>
      <p className="muted small">Confidence is a logistic model of these measurements, fitted on held-out synthetic gauges with known answers. It estimates the chance that the reading is within 2% of the scale.</p>
      <table className={s.table}>
        <thead>
          <tr><th scope="col">Measurement</th><th scope="col">Value</th><th scope="col">What it means</th></tr>
        </thead>
        <tbody>
          {rows.map(([a, b, c]) => (
            <tr key={a}><td>{a}</td><td className={s.mono}>{b}</td><td>{c}</td></tr>
          ))}
        </tbody>
      </table>
      <table className={s.table}>
        <thead>
          <tr><th scope="col">Stage</th><th scope="col">Time</th></tr>
        </thead>
        <tbody>
          {Object.entries(t).map(([k, v]) => (
            <tr key={k}><td>{{ dial: "Find the dial", geometry: "Straighten, centre, ticks, needle", text: "Read the numbers", total: "Total" }[k] ?? k}</td><td className={s.mono}>{Math.round(v)} ms</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const fmt = (v: number | undefined, d = 2) => (v == null ? "–" : v.toFixed(d));
const pct = (v: number | undefined) => (v == null ? "–" : `${(v * 100).toFixed(1)}%`);
