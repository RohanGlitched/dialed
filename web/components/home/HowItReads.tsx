"use client";
import { useEffect, useRef, useState } from "react";
import { caption } from "@/components/inspect/InspectView";
import { STAGES, StageView, type StageKey } from "@/components/inspect/Stages";
import type { Inspect } from "@/lib/types";
import hero from "@/public/showcase/hero/inspect.json";
import s from "./how.module.css";

const ins = hero as unknown as Inspect;

/** Scroll-driven: the drawing on the left shows the stage whose paragraph is in view on the right. */
export function HowItReads() {
  const [active, setActive] = useState<StageKey>("find");
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => {
        const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive((vis[0].target as HTMLElement).dataset.key as StageKey);
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);
  const idx = STAGES.findIndex((x) => x.key === active);
  return (
    <section className="wrap section" aria-labelledby="how-h">
      <div className="section-head">
        <h2 id="how-h" className="h2">How it reads a dial</h2>
        <p className="lede">Nine stages, all classical OpenCV 5 except the two small text models. Scroll through them on the photo from the top of the page; every drawing is the reader&apos;s own output.</p>
      </div>
      <div className={s.grid}>
        <div className={s.sticky}>
          <div className={s.fig}>
            <p className={s.cell}>Stage {idx + 1} of {STAGES.length}: {STAGES[idx].title}</p>
            <StageView ins={ins} stage={active} />
          </div>
        </div>
        <ol className={s.steps}>
          {STAGES.map((st, i) => (
            <li key={st.key} data-key={st.key} ref={(el) => { refs.current[i] = el; }} className={active === st.key ? s.on : ""}>
              <span className={s.no}>{String(i + 1).padStart(2, "0")}</span>
              <h3 className="h3">{st.title}</h3>
              <p className={s.fn}>{st.fn}</p>
              <p>{caption(st.key, ins)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
