/* The technical report, as a printable page (A4). Rendered to PDF with Playwright: scripts/report.cjs. */
import agent from "@/public/evidence/agent.json";
import ev from "@/public/evidence/results.json";
import hero from "@/public/showcase/hero/inspect.json";
import { Coverage, IssueBars, Reliability, Scatter, type Row } from "@/components/evidence/EvidencePage";
import { REPO_URL, SITE_URL } from "@/lib/site";
import s from "./report.module.css";

type SetT = { label: string; summary: Record<string, number>; rows: Row[] };
const sets = ev.sets as unknown as Record<string, SetT>;
const oos = ((ev as unknown as { out_of_scope?: { accepted: boolean }[] }).out_of_scope ?? []);
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const LAT = (ev as unknown as { lambda?: { cold_ms: number; warm_ms_median: number; warm_ms_p90: number; memory_mb: number; n: number } }).lambda;

export function Report() {
  const allRows = Object.values(sets).flatMap((x) => x.rows);
  const synthRows = [...sets.normal.rows, ...sets.hard.rows];
  const acc = allRows.filter((r) => r.accepted);
  const r = hero as unknown as { reading: { value: number; unit: string; confidence: number; tilt: number; numbers: unknown[] }; images: Record<string, string> };
  return (
    <article className={s.doc}>
      <header className={s.title}>
        <p className={s.kicker}>OpenCV AI Competition 2026, technical report</p>
        <h1>Dialed: reading analog gauges from phone photos with OpenCV 5, and an agent that acts on them</h1>
        <p className={s.by}>Rohan Borade. Live: {SITE_URL.replace(/^https?:\/\//, "")}. Code: {REPO_URL.replace("https://", "")}</p>
      </header>

      <section className={s.abstract}>
        <h2>Summary</h2>
        <p>
          Dialed reads analog pressure and temperature gauges from ordinary phone photos. A classical OpenCV 5 pipeline finds the dial, removes the camera&apos;s tilt, locates the true pivot from the tick marks and the needle&apos;s own line, reads the printed scale with two OpenCV Model Zoo networks run through <code>cv.dnn</code>, and interpolates the needle&apos;s value. A calibrated confidence decides whether the reading is trusted. An agent then logs the reading, asks for a better photo with the measured reason, or drafts a maintenance work order that waits for a supervisor. On {sets.real?.rows.length ?? 0} photos of real gauges read by eye, accepted readings were {pct(sets.real?.summary.accepted_within_2pct ?? 0, 0)} within 2% of the scale; across {allRows.length} test photos, {acc.filter((x) => (x.err ?? 1) < 0.02).length} of {acc.length} accepted readings were within 2% and none was off by more than 5%.
        </p>
      </section>

      <section>
        <h2>1. Problem and users</h2>
        <p>Most process plants, pump stations and building plant rooms still rely on analog gauges read by people on rounds and written on paper sheets. Readings are copied twice, slow trends go unnoticed until an alarm, missed readings are invisible, and pairs of gauges (a filter&apos;s inlet and outlet) are never subtracted. The users are field operators, who need a reading in seconds with a glove on, and maintenance supervisors, who need to trust a reading before they send a fitter.</p>
        <p>Dialed turns a photo into a trusted reading and does the arithmetic on every reading: the gauge&apos;s normal band and alarm limits, the week&apos;s drift, and pressure drops between paired gauges.</p>
      </section>

      <section>
        <h2>2. Architecture</h2>
        <figure className={s.fig}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/report/architecture.png" alt="Architecture: phone with OpenCV.js, CloudFront, Lambda with OpenCV 5 and the agent, Bedrock, S3, DynamoDB" />
          <figcaption>OpenCV runs twice: OpenCV.js 5 in the phone&apos;s browser coaches the shot; OpenCV 5 on AWS Lambda reads it.</figcaption>
        </figure>
      </section>

      <section>
        <h2>3. The OpenCV 5 pipeline</h2>
        <div className={s.stages}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.images.photo} alt="Input photo" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.images.dial} alt="Straightened" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.images.ink} alt="Strokes only" />
        </div>
        <p className={s.cap}>A real photo (a 1922 steamship&apos;s boiler gauge, Joe Mabel, CC BY-SA 4.0), straightened, and its thin-stroke map. Reading: {r.reading.value.toFixed(0)} {r.reading.unit}, {Math.round(r.reading.confidence * 100)}% confidence, {Math.round(r.reading.tilt)}° tilt corrected.</p>
        <ol className={s.steps}>
          <li><b>Find the dial.</b> Canny edges with thresholds from the gradient distribution; ellipses fitted (<code>fitEllipse</code>) to edge contours and to Otsu regions, scored by edge support along the outline, size and roundness. A second strong, separate ellipse means two gauges in frame and blocks the read.</li>
          <li><b>Straighten.</b> One <code>warpAffine</code> maps the rim ellipse to a circle (640 px for geometry, 960 px from the full-resolution photo for reading text).</li>
          <li><b>Strokes only.</b> Morphological black-hat (top-hat on dark faces, chosen by which side the minority pixels fall on) keeps strokes thinner than ~0.11 R and drops glare, shading and the face colour.</li>
          <li><b>Tick ring and true centre.</b> In the polar image (<code>warpPolar</code>) the tick band is where high-pass energy along the angle peaks. Each tick is measured as a short line (connected components, principal axis); lines stay straight under perspective, so their least-squares intersection is the pivot, not the ellipse centre.</li>
          <li><b>Needle.</b> Probabilistic Hough segments (<code>HoughLinesP</code>) through the estimated centre are grouped by direction; a hub circle (<code>HoughCircles</code>) on the line fixes the pivot. The pointer is the end whose unbroken run from the pivot is longer; counterweight tails are short.</li>
          <li><b>Numbers.</b> PP-OCRv3 (<code>TextDetectionModel_DB</code>) finds text; each box is cut out along its own angle and read by CRNN in upright and inverted orientations (sideways for square boxes), with greedy CTC decoding done in Python to get a per-read confidence.</li>
          <li><b>Scale fit.</b> Numbers are grouped into rings by radius (two-scale dials), and each ring is fitted by RANSAC over every reading of every number: lost decimal points (&quot;05&quot; is 0.5) and lost minus signs (a value printed twice on a ring) are hypotheses with a cost. The value is interpolated between neighbouring numbers, which absorbs residual perspective error.</li>
          <li><b>Photo checks and confidence.</b> Tilt from the axis ratio, sharpness (Laplacian variance), glare as compact highlights that wash out the print, distance, needle contrast, fit residual. A logistic model over these measurements, fitted on 600 rendered gauges kept apart from the test sets, gives P(error &lt; 2% of span).</li>
        </ol>
        <p><b>DNN engines.</b> OpenCV 5 offers a new DNN engine beside the classic one. Measured on CPU, the text detector took {ev.bench.classic.detect_ms} ms on the classic engine and {ev.bench.new.detect_ms} ms on the new one, while the recogniser took {ev.bench.classic.recognise_ms} ms per word on the classic engine and {ev.bench.new.recognise_ms} ms on the new one. Each model is loaded with the engine that runs it faster.</p>
      </section>

      <section>
        <h2>4. The agent</h2>
        <p>A tool-calling model (Claude Haiku 4.5 on Amazon Bedrock; NVIDIA Nemotron on Nebius as the fallback; a rule engine if neither answers) chooses among six tools: read_gauge (auto, or with the gauge&apos;s enrolled scale angles), compare_history, request_reshoot, log_reading, hold_work_order and flag_wrong_gauge. The vision output changes every later step: a blocking photo issue or low confidence leads to a re-shoot with the measured reason; a unit or range that disagrees with the gauge&apos;s registration leads to a tag check; a measured breach leads to a held work order.</p>
        <p><b>Guards in code</b> decide whether each action is allowed: no reading is logged below 90% confidence; a work order needs a measured breach (alarm limit, a week&apos;s drift, or the pressure drop across a paired filter) and its priority cannot be set below the breach; every figure the model writes is checked against the measurements and unknown figures are struck through; only a person approves a work order. Each capture&apos;s full trace (model turns, tool calls, refusals, timings) is stored with the photo and shown on the approvals desk.</p>
        <table className={s.tbl}>
          <thead><tr><th>Scenario</th><th>Expected</th><th>Rule engine</th><th>Model</th></tr></thead>
          <tbody>
            {agent.rules.map((x, i) => (
              <tr key={x.name}><td>{x.name}</td><td>{x.expected}{x.expected_breach ? ` (${x.expected_breach.replace("_", " ")})` : ""}</td><td>{x.pass ? "pass" : "fail"}</td><td>{(agent as { model?: { pass: boolean }[] }).model?.[i]?.pass ? "pass" : "–"}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>5. Deployment on AWS</h2>
        <p>One CloudFormation stack: a Python 3.12 arm64 Lambda function (OpenCV 5.0 pip wheels and both models in the package) behind a Function URL; DynamoDB (gauges, readings, work orders); one S3 bucket for the static site, photos and evidence images; CloudFront in front of all three, with a directory-index function; an error alarm and 14-day logs. <code>infra/deploy.py</code> builds Linux wheels without Docker and deploys everything.{LAT ? ` Measured on the deployed function (${LAT.memory_mb} MB): cold start ${(LAT.cold_ms / 1000).toFixed(1)} s, warm reads ${(LAT.warm_ms_median / 1000).toFixed(1)} s median, ${(LAT.warm_ms_p90 / 1000).toFixed(1)} s at p90 over ${LAT.n} photos.` : ""}</p>
      </section>

      <section>
        <h2>6. Evaluation</h2>
        <table className={s.tbl}>
          <thead><tr><th>Set</th><th>n</th><th>Read</th><th>Within 2% (all reads)</th><th>Accepted</th><th>Accepted within 2%</th><th>Accepted &gt;5%</th></tr></thead>
          <tbody>
            {Object.entries(sets).map(([k, v]) => (
              <tr key={k}><td>{v.label}</td><td>{v.summary.n}</td><td>{v.summary.read}</td><td>{pct(v.summary.within_2pct_all)}</td><td>{v.summary.accepted}</td><td>{pct(v.summary.accepted_within_2pct)}</td><td>{v.summary.accepted_over_5pct}</td></tr>
            ))}
          </tbody>
        </table>
        <p>Rendered sets have exact ground truth (the generator places the needle). Real photos are from Wikimedia Commons (CC0, CC BY, CC BY-SA), read by eye from the photo with an uncertainty of about 1% of the scale; on two-scale dials the reading is scored against the scale the reader used. {oos.length} further real photos that should not be read (two needles, two gauges, dials too small) were accepted {oos.filter((x) => x.accepted).length} times.</p>
        <div className={s.charts}>
          <figure><Scatter rows={synthRows} /><figcaption>Error against camera tilt (rendered sets). Filled: accepted.</figcaption></figure>
          <figure><Coverage rows={synthRows} /><figcaption>Coverage and accuracy against the threshold.</figcaption></figure>
          <figure><Reliability rows={allRows} /><figcaption>Stated confidence against observed accuracy.</figcaption></figure>
          <figure><IssueBars rows={allRows} /><figcaption>Why photos were sent back.</figcaption></figure>
        </div>
      </section>

      <section>
        <h2>7. Limitations</h2>
        <ul>
          <li>The text model has no decimal point or minus sign; lost decimals and duplicated negatives are recovered as hypotheses, but vacuum scales labelled on every number can be misread from a single photo (on a round, the gauge&apos;s registration catches this).</li>
          <li>Two-needle dials, digital displays and sight glasses are out of scope; small or very dark dials are refused rather than read.</li>
          <li>Ground truth for real photos is a human reading of the same photo.</li>
          <li>Reading the printed numbers dominates the time; a lighter recogniser or caching the scale per enrolled gauge would cut it.</li>
        </ul>
      </section>

      <section>
        <h2>8. Responsible use</h2>
        <p>No person or face detection is used anywhere; photos are kept only on rounds, as evidence for the reading or work order. The agent cannot act on equipment: it can hold a work order, and only a named person can release it. Uncertainty is always shown: every reading carries its confidence and checks, struck figures stay visible, and refused photos say why. Dialed replaces the clipboard, not the plant&apos;s alarms and trips.</p>
      </section>

      <section>
        <h2>9. Reproducibility</h2>
        <p><code>scripts/get_models.py</code> (hash-checked models), <code>vision/synth.py</code> (rendered sets), <code>vision/calibrate.py</code>, <code>scripts/evidence.py</code>, <code>scripts/agent_eval.py --model</code>, <code>python -m pytest</code>. Photo credits: CREDITS.md. Code: MIT.</p>
      </section>
    </article>
  );
}
