import tips from "@/public/tips/tips.json";
import s from "./tips.module.css";

type Side = { src: string; value: number | null; truth: number; ok: boolean; confidence: number; issues: string[] };

/** Below the reader: how to take a photo it can read (with the reader's real verdicts),
 *  what happens to the photo, and what it can't read yet. */
export function Tips() {
  return (
    <>
      <section className="wrap section" aria-labelledby="tips-h">
        <div className="section-head">
          <h2 id="tips-h" className="h2">Photos it can read</h2>
          <p className="lede">The same gauge, photographed badly and well. Every verdict below is the reader&apos;s own output on that exact photo.</p>
        </div>
        <ol className={s.pairs}>
          {tips.map((t, i) => (
            <li key={t.key} className={s.pair}>
              <div className={s.pairText}>
                <span className={s.no}>{i + 1}</span>
                <h3 className="h3">{t.title}</h3>
                <p>{t.text}</p>
              </div>
              <Shot side={t.bad as Side} label="Before" />
              <Shot side={t.good as Side} label="After" />
            </li>
          ))}
        </ol>
      </section>

      <section className="wrap section" aria-labelledby="photo-h">
        <div className={s.two}>
          <div>
            <h2 id="photo-h" className="h2">What happens to your photo</h2>
          </div>
          <ol className={s.flow}>
            <li><b>On your device</b> the photo is resized to 1600 px on its long side. With the camera guide, OpenCV.js checks framing, tilt, glare and focus live and nothing leaves the phone until you take the shot.</li>
            <li><b>On AWS Lambda</b> OpenCV 5 reads it: dial, straightening, centre, needle, numbers, fit. That takes about a second.</li>
            <li><b>Back to you</b> come the reading, every intermediate image and every measurement. On this page nothing is stored; the photo exists only for that request.</li>
            <li><b>On a round</b> (sheet 03) the photo is kept with the reading as evidence, because a supervisor may need to see what the agent saw before approving a work order.</li>
          </ol>
        </div>
      </section>

      <section className="wrap section" aria-labelledby="limits-h">
        <div className={s.two}>
          <h2 id="limits-h" className="h2">What it can&apos;t read yet</h2>
          <ul className={s.limits}>
            <li><b>Vacuum and compound gauges</b> whose labels carry minus signs or decimal points (−1, −0.8 …). The text model has no minus or decimal characters, so a single photo can misread these scales. On a round, the gauge&apos;s registered range catches the mismatch and the agent asks for a check instead of logging.</li>
            <li><b>Digital displays and sight glasses.</b> Dialed reads needles on round dials only.</li>
            <li><b>Dials turned more than about 55°</b> from the camera. It asks for a better photo instead of guessing. Dials smaller than a quarter of the frame get a warning to move closer.</li>
            <li><b>Two needles</b> (max pointers, set-point needles): it reads the strongest one, and a second needle lowers its confidence.</li>
            <li><b>Non-linear scales</b> are read between printed numbers, so they work when the numbers are legible and fail when they aren&apos;t.</li>
          </ul>
        </div>
      </section>
    </>
  );
}

function Shot({ side, label }: { side: Side; label: string }) {
  const verdict = side.value == null || !side.ok ? "reshoot" : "logged";
  return (
    <figure className={s.shot}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={side.src} alt={`${label}: ${side.issues.join(" ") || "a clear photo"}`} loading="lazy" />
      <figcaption>
        <span className={`tag ${verdict}`}>{verdict === "logged" ? "READ" : "RE-SHOOT"}</span>
        <span className={s.val}>{side.value != null ? `${side.value.toFixed(2)} bar` : "no reading"}</span>
        <span className={s.why}>{side.issues.find((t) => /can.t|blurred|turned|covers/i.test(t)) ?? side.issues[0] ?? `Known answer ${side.truth} bar; ${Math.round(side.confidence * 100)}% confidence.`}</span>
      </figcaption>
    </figure>
  );
}
