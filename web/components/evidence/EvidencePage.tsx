import ev from "@/public/evidence/results.json";
import { REPO_URL } from "@/lib/site";
import { AGENT, AgentFlow, AgentTable, AgentTraces, agentTotals } from "./Agentic";
import { BenchPhotos, BenchTable, benchHeadline } from "./Bench";
import s from "./evidence.module.css";
import { confPct } from "@/lib/site";

type Credit = { title: string; author: string; license: string; source: string };
export type Row = { file: string; truth: number; min: number; max: number; unit: string; read: number | null; err: number | null; ok: boolean; conf: number; accepted: boolean; tilt: number | null; glare: boolean | null; blur: number | null; issues: string[]; ms: Record<string, number>; thumb?: string; credit?: Credit; scored?: { value: number; unit: string } | null };
type Oos = { set?: string; file: string; why: string; read: number | null; ok: boolean; conf: number; accepted: boolean; issues: string[]; thumb?: string; credit: Credit };
type SetT = { label: string; summary: Record<string, number | null>; rows: Row[] };

const sets = ev.sets as unknown as Record<string, SetT>;
const oos = ((ev as unknown as { out_of_scope?: Oos[] }).out_of_scope ?? []) as Oos[];
type First = { summary: Record<string, number | null>; out_of_scope_n: number; out_of_scope_accepted: number };
const first = (ev as unknown as { blind1_first_run?: First }).blind1_first_run;
const lat = (ev as unknown as { lambda?: { cold_ms: number; warm_ms_median: number; warm_ms_p90: number; memory_mb: number; n: number } }).lambda;
const REAL = new Set(["real", "blind"]);
const NAME: Record<string, string> = { normal: "Rendered, normal", hard: "Rendered, hard", real: "Real photos, development", blind: "Real photos, blind" };
const pct = (v: number | null | undefined, d = 1) => (v == null ? "–" : `${(v * 100).toFixed(d)}%`);

function RealCard({ r }: { r: Row }) {
  return (
    <li>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {r.thumb && <img src={r.thumb} alt={r.credit?.title ?? r.file} loading="lazy" />}
      <p className={s.failVal}>{r.read == null ? "No reading" : `${r.read.toFixed(r.max - r.min <= 20 ? 2 : r.max - r.min <= 200 ? 1 : 0)}`} <span className={s.vs}>{r.scored ? r.scored.unit : r.unit} read; by eye {r.scored ? r.scored.value : r.truth} {r.scored ? r.scored.unit : r.unit}{r.scored && r.scored.unit !== r.unit ? ` (= ${r.truth} ${r.unit} on the other printed scale)` : ""}</span></p>
      <p className={s.failMeta}>
        {r.err != null ? `${(r.err * 100).toFixed(1)}% of the scale off. ` : ""}
        {r.accepted ? <b>Accepted.</b> : r.read == null ? `Refused (${r.issues.join(", ") || "low confidence"}).` : `Sent back, ${confPct(r.conf)}% confidence.`}
      </p>
      {r.credit && <p className={s.credit}><a href={r.credit.source}>{r.credit.author}</a>, {r.credit.license}</p>}
    </li>
  );
}

export function EvidencePage() {
  const all = Object.entries(sets).filter(([k]) => !REAL.has(k)).flatMap(([, x]) => x.rows);
  const realN = (sets.real?.rows.length ?? 0) + (sets.blind?.rows.length ?? 0);
  const blindOos = oos.filter((r) => r.set === "blind");
  const allWithReal = Object.values(sets).flatMap((x) => x.rows);
  const accepted = allWithReal.filter((r) => r.accepted);
  const off2 = accepted.filter((r) => (r.err ?? 0) >= 0.02).length;
  const bh = benchHeadline();
  const at = agentTotals();
  void off2;
  return (
    <>
      <section className={`wrap ${s.head}`}>
        <p className="cell">Sheet 06</p>
        <h1 className={`display ${s.h1}`}>Evidence</h1>
        <p className="lede">How accurate the reader is on real photos and on rendered ones (kept apart), how it compares with a classic OpenCV reader and a vision-language model, where it fails, and whether the agent does what it should, run many times. Every figure comes from files in the repository and can be regenerated with one command.</p>
        <p className={s.links}>
          <a className="btn ghost" href="/report/Dialed-technical-report.pdf">Technical report (PDF)</a>
          <a className="btn ghost" href="/report/architecture.png">Architecture diagram</a>
        </p>
        <dl className={s.top}>
          <div><dt>Real photos it was never tuned on: answers within 2%</dt><dd>{bh.d?.accepted_within_2pct}<small> of {bh.d?.accepted} answers</small></dd></div>
          <div><dt>Same photos, answered by Amazon Nova Lite: within 2%</dt><dd>{bh.v?.accepted_within_2pct}<small> of {bh.v?.accepted}</small></dd></div>
          <div><dt>Rendered gauges: accepted readings within 2%</dt><dd>{pct(sets.normal?.summary.accepted_within_2pct as number, 1)}</dd></div>
          <div><dt>Agent runs passing (model, {at.perRun} runs each)</dt><dd>{at.passed}<small> of {at.runsN}</small></dd></div>
        </dl>
      </section>

      <Section id="bench" title="Real photos it was never tuned on">
        <div className={s.prose}>
          <p><b>The set.</b> {bh.n} held-out photos of real analog gauges from Wikimedia Commons and Flickr (openly licensed, each credited below and in CREDITS.md), plus photos it should decline. Each was read by eye twice, independently, before any reader saw it; disagreements over 1% of the scale were re-read on a zoomed crop, and photos the two labels disagreed on as readable were left out. A fixed random split kept this half for scoring the final versions only. Many are museum or product shots with the needle at rest, which is common on a real round too (a stopped pump, an empty line).</p>
          <p><b>The readers.</b> Dialed as it is now and as first submitted; this version without each new part; a classic OpenCV reader that is even told the true scale range; and Amazon Nova Lite on Bedrock, a vision-language model, reading the photo directly ({bh.spend?.calls} photos for about ${bh.spend?.usd.toFixed(2)}).</p>
          <p><b>What did not help.</b> Full projective straightening (a homography from the rim ellipse and the pivot, the textbook fix for strong perspective) is implemented and in the table, but on real photos it measured no better than the simpler affine map, on the development photos and on these; the affine map stays the default. Fitting the confidence model on real development photos as well as rendered ones made its cross-validated precision worse, so it is fitted on rendered gauges, with three new measurements of the needle.</p>
          <p><b>What to read off the table.</b> A reader that always answers is wrong most of the time on real photos. Dialed answers far less often and is right far more often when it does; it is not right every time, and every wrong answer it gave is shown below.</p>
        </div>
        <BenchTable />
        <BenchPhotos />
      </Section>

      <Section id="method" title="Method">
        <div className={s.two}>
          <div className={s.prose}>
            <p><b>Ground truth.</b> Photos of real gauges don&apos;t come with their true reading, so the main sets are rendered: a generator draws a gauge face (scale, ticks, numbers, needle, red zone, brand text), places it in 3D at a random angle, lights it, adds glare, blur, sensor noise and JPEG compression. The needle&apos;s value is known exactly.</p>
            <p><b>Two sets the model never saw.</b> The confidence model was fitted on 600 other rendered gauges. The normal set allows up to 35° tilt and occasional glare; the hard set allows up to 50°, glare on almost half the photos and heavy blur.</p>
            <p><b>Error</b> is |read − true| as a share of the scale&apos;s span, so 1% on a 0–16 bar gauge is 0.16 bar. A reading is <b>accepted</b> when no photo check blocks it and its confidence is at least {Math.round(ev.accept_at * 100)}%; otherwise the agent asks for a new photo.</p>
            <p><b>Real photos.</b> Photos of real gauges from Wikimedia Commons (CC0, CC BY and CC BY-SA), each read by eye from the photo for its true value. Where a dial prints two scales, the reading is scored against the scale the reader used. The {sets.real?.summary.n ?? 0} in the development set were used while building the reader (its failures on them guided fixes), so their numbers are optimistic. Blind photos were labelled before the reader ever saw them and the reader was not changed afterwards; see <a href="#blind">Blind tests</a>. A further {oos.length || "set of"} photos the reader shouldn&apos;t accept (two needles, two gauges in one frame, the back of a gauge) test whether it declines.</p>
          </div>
          <ul className={s.sampleGrid} aria-label="Examples from the sets">
            {all.filter((r) => r.thumb).slice(0, 9).map((r) => (
              <li key={r.file}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.thumb} alt={`Rendered gauge, true value ${r.truth} ${r.unit}`} loading="lazy" />
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section id="results" title="Results by set">
        <div className={s.tblWrap}>
          <table className={s.tbl}>
            <thead>
              <tr><th scope="col">Set</th><th scope="col">Gauges</th><th scope="col">Read at all</th><th scope="col">Within 2% (all reads)</th><th scope="col">Accepted</th><th scope="col">Accepted within 2%</th><th scope="col">Median error, accepted</th><th scope="col">Sent back</th></tr>
            </thead>
            <tbody>
              {Object.entries(sets).map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{NAME[k] ?? k}<span className={s.setLabel}>{v.label}</span></th>
                  <td>{v.summary.n}</td>
                  <td>{v.summary.read}</td>
                  <td>{pct(v.summary.within_2pct_all as number)}</td>
                  <td>{v.summary.accepted} ({pct((v.summary.accepted as number) / (v.summary.n as number), 0)})</td>
                  <td><b>{pct(v.summary.accepted_within_2pct as number)}</b></td>
                  <td>{pct(v.summary.accepted_median_err as number, 2)}</td>
                  <td>{v.summary.reshoot}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="blind" title="Blind tests">
        <div className={s.blind}>
          <div className={s.prose}>
            <p><b>Why.</b> A reader tuned on its own test photos will look better than it is. So real photos were set aside, read by eye first, and the reader was run on them once.</p>
            {first && <p><b>Blind batch 1</b> ({first.summary.n} dials, {first.out_of_scope_n} photos to decline). On its one blind run the reader accepted {first.summary.accepted} readings; {pct(first.summary.accepted_within_2pct, 0)} of them were within 2% and {first.summary.accepted_over_5pct} was off by more than 5%. It wrongly accepted {first.out_of_scope_accepted} of the {first.out_of_scope_n} photos it should have declined. The batch exposed three weaknesses: print in the blank part of a dial taken for the needle, handwheels and pipe ends taken for a second gauge, and needles resting below the first printed number. The first two were fixed, and the batch joined the development set.</p>}
            {sets.blind && <p><b>Blind batch 2</b> was drawn at random from Commons after those fixes and read by eye before the reader saw it. Most random photos turned out not to be readable gauges ({blindOos.length} of them, used as photos to decline), so only {sets.blind.summary.n} dials could be scored: too few for a percentage, so each one is listed below. It wrongly accepted {blindOos.filter((r) => r.accepted).length} of the {blindOos.length} photos it should have declined.</p>}
          </div>
          {sets.blind && (
            <ul className={s.real}>
              {sets.blind.rows.map((r) => <RealCard key={r.file} r={r} />)}
            </ul>
          )}
        </div>
      </Section>

      {sets.real && (
        <Section id="real" title="Development photos, one by one">
          <p className={s.intro}>Every real photo in the set: what the reader said, what the gauge shows by eye, and whether the agent would have accepted the reading. Credits are the photographers&apos;; derived images keep the photos&apos; licences.</p>
          <ul className={s.real}>
            {sets.real.rows.map((r) => <RealCard key={r.file} r={r} />)}
          </ul>
        </Section>
      )}

      {oos.length > 0 && (
        <Section id="decline" title="Photos it should decline">
          <p className={s.intro}>Real photos outside what Dialed reads. The right answer is not to log a number. {oos.filter((r) => r.accepted).length === 0 ? `It accepted none of the ${oos.length}.` : `It accepted ${oos.filter((r) => r.accepted).length} of ${oos.length}; those are listed first.`}</p>
          <ul className={s.real}>
            {[...oos].sort((a, b) => Number(b.accepted) - Number(a.accepted)).map((r) => (
              <li key={r.file}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {r.thumb && <img src={r.thumb} alt={r.credit.title} loading="lazy" />}
                <p className={s.failVal}>{r.why}</p>
                <p className={s.failMeta}>{r.accepted ? <b>Accepted (wrongly).</b> : r.read == null ? `Refused (${r.issues.join(", ") || "no dial"}).` : `Not accepted, ${confPct(r.conf)}% confidence.`}</p>
                <p className={s.credit}><a href={r.credit.source}>{r.credit.author}</a>, {r.credit.license}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section id="charts" title="Where errors come from">
        <div className={s.charts}>
          <figure className={s.chart}>
            <Scatter rows={all} />
            <figcaption><b>Error against camera tilt.</b> Each dot is one gauge. Filled dots were accepted; rings were sent back. Large errors cluster at steep angles, and the reader turns them away.</figcaption>
          </figure>
          <figure className={s.chart}>
            <Coverage rows={all} />
            <figcaption><b>The threshold trade-off.</b> As the confidence threshold rises, fewer readings are accepted (coverage) and the accepted ones get cleaner. The agent accepts at {Math.round(ev.accept_at * 100)}%.</figcaption>
          </figure>
          <figure className={s.chart}>
            <Reliability rows={all} />
            <figcaption><b>Is the confidence honest?</b> Readings grouped by stated confidence, against the share that were actually within 2%. Points near the diagonal mean the number means what it says.</figcaption>
          </figure>
          <figure className={s.chart}>
            <IssueBars rows={all} />
            <figcaption><b>Why photos were sent back.</b> The checks that fired on rejected photos, from both sets.</figcaption>
          </figure>
        </div>
      </Section>

      <Section id="failures" title="The worst cases">
        <p className={s.intro}>The largest errors in each set, whether or not they were accepted, and photos the reader refused outright. Accepted readings are marked; none of these large errors got through.</p>
        <ul className={s.fails}>
          {all.filter((r) => r.thumb && (r.err == null || r.err >= 0.02)).slice(0, 12).map((r) => (
            <li key={r.file}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.thumb} alt={`True ${r.truth} ${r.unit}`} loading="lazy" />
              <p className={s.failVal}>{r.read == null ? "No reading" : `${r.read.toFixed(2)} vs ${r.truth.toFixed(2)} ${r.unit}`}</p>
              <p className={s.failMeta}>{r.err != null ? `${(r.err * 100).toFixed(1)}% off, ` : ""}{r.tilt != null ? `${Math.round(r.tilt)}° tilt, ` : ""}{r.accepted ? "accepted" : `sent back (${r.issues.join(", ") || "low confidence"})`}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="agent" title="Does the agent do the right thing, every time?">
        <p className={s.intro}>{at.scenarios} scenarios, each a rendered photo (or two) pushed through a full capture against the sample plant&apos;s history: {AGENT.model?.[0]?.runs ?? 0} runs each with Amazon Nova Micro, 3 with the rule engine. Pass means the outcome, and where it matters the breach, the priority, the value or the view asked for, is what the guards should produce. {at.passed} of {at.runsN} model runs passed.</p>
        <AgentTable />
        <p className={s.note}>What the model decides that the rules don&apos;t: nothing, by design. Its outcomes matched the rule engine&apos;s; it writes the work order&apos;s wording and the operator&apos;s sentence, and every decision boundary is in code.</p>
        <h3 className={s.h3}>How the vision result changes what happens next</h3>
        <AgentFlow />
        <p className={s.intro}>Three recorded runs. In each, the next tool the model chose depended on what the OpenCV 5 reading returned: a week&apos;s drift led to a held work order, blocking photo checks led to a re-shoot with their reasons, and a printed range that disagreed with the tag led to a tag check.</p>
        <AgentTraces />
      </Section>

      <Section id="speed" title="Speed and the two DNN engines">
        <div className={s.two}>
          <div className={s.prose}>
            <p>OpenCV 5 ships a new DNN engine next to the classic one. Measured on the same CPU, they suit the two text models differently, so the reader loads each model with the engine that runs it faster.</p>
            <p>The rest of the pipeline is classical OpenCV and takes tens of milliseconds; reading the printed numbers is most of the time.</p>
            {lat && <p><b>On AWS Lambda</b> ({lat.memory_mb} MB, arm64, Sydney), measured from the function&apos;s own logs: a cold start took {(lat.cold_ms / 1000).toFixed(1)} s, and warm reads took {(lat.warm_ms_median / 1000).toFixed(1)} s median and {(lat.warm_ms_p90 / 1000).toFixed(1)} s at p90 over {lat.n} photos. Upload and download time comes on top and depends on your network.</p>}
          </div>
          <div className={s.tblWrap}><table className={`${s.tbl} ${s.tblSmall}`}>
            <thead><tr><th scope="col">Model</th><th scope="col">Classic engine</th><th scope="col">New engine</th><th scope="col">Used</th></tr></thead>
            <tbody>
              <tr><th scope="row">PP-OCRv3 text detector, 640 × 640</th><td>{ev.bench.classic.detect_ms} ms</td><td>{ev.bench.new.detect_ms} ms</td><td>New</td></tr>
              <tr><th scope="row">CRNN recogniser, one word</th><td>{ev.bench.classic.recognise_ms} ms</td><td>{ev.bench.new.recognise_ms} ms</td><td>Classic</td></tr>
            </tbody>
          </table></div>
        </div>
      </Section>

      <Section id="responsible" title="Responsible use">
        <ul className={s.list}>
          <li><b>No people in the pictures.</b> The reader looks for dials; there is no face or person detection anywhere, and photos are only kept on a round, as evidence for the work order they support.</li>
          <li><b>A person decides.</b> The agent never releases a work order or touches a control system.</li>
          <li><b>Uncertainty is shown, not hidden.</b> Every reading carries its confidence and the checks behind it; struck-through figures stay visible.</li>
          <li><b>Known gaps are listed</b> on the read page, and refused photos say why.</li>
          <li><b>Not a safety system.</b> Alarms and trips stay in the plant&apos;s control system.</li>
        </ul>
      </Section>

      <Section id="reproduce" title="Reproduce every number">
        <ol className={s.code}>
          <li><code>python scripts/get_models.py</code> downloads the two text models and checks their hashes.</li>
          <li><code>python vision/synth.py data/synth200 200</code> and the hard set renders the gauges.</li>
          <li><code>python vision/calibrate.py</code> fits the confidence model on its own 600 gauges.</li>
          <li><code>python scripts/evidence.py</code> scores both sets and rebuilds this page&apos;s data.</li>
          <li><code>python scripts/agent_eval.py --model</code> runs the eight agent scenarios.</li>
        </ol>
        <p className={s.note}>Code and data: <a href={REPO_URL}>{REPO_URL.replace("https://", "")}</a></p>
      </Section>
    </>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section className="wrap section" aria-labelledby={`${id}-h`} id={id}>
      <h2 id={`${id}-h`} className={`h2 ${s.secTitle}`}>{title}</h2>
      {children}
    </section>
  );
}

/* ---------- charts (plain SVG) ---------- */
const W = 520, H = 330, PL = 46, PB = 38, PT = 14, PR = 14;

export function Scatter({ rows }: { rows: Row[] }) {
  const pts = rows.filter((r) => r.err != null && r.tilt != null);
  const ymax = 0.1;
  const X = (t: number) => PL + (t / 60) * (W - PL - PR);
  const Y = (e: number) => H - PB - (Math.min(e, ymax) / ymax) * (H - PB - PT);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Error against camera tilt">
      {[0, 0.02, 0.05, 0.1].map((e) => <g key={e}><line x1={PL} x2={W - PR} y1={Y(e)} y2={Y(e)} className={e === 0.02 ? s.ref : s.grid} /><text x={PL - 6} y={Y(e) + 4} textAnchor="end" className={s.ax}>{e * 100}%</text></g>)}
      {[0, 15, 30, 45, 60].map((t) => <text key={t} x={X(t)} y={H - 18} textAnchor="middle" className={s.ax}>{t}°</text>)}
      <text x={W / 2} y={H - 2} textAnchor="middle" className={s.ax}>camera tilt</text>
      {pts.map((r, i) => <circle key={i} cx={X(r.tilt!)} cy={Y(r.err!)} r={3} className={r.accepted ? s.dotAcc : s.dotRej} />)}
    </svg>
  );
}

export function Coverage({ rows }: { rows: Row[] }) {
  const ts = Array.from({ length: 20 }, (_, i) => 0.5 + i * 0.025);
  const data = ts.map((t) => {
    const acc = rows.filter((r) => r.ok && r.read != null && r.conf >= t);
    return { t, cov: acc.length / rows.length, clean: acc.length ? acc.filter((r) => (r.err ?? 1) < 0.02).length / acc.length : 1 };
  });
  const X = (t: number) => PL + ((t - 0.5) / 0.5) * (W - PL - PR);
  const Y = (v: number) => H - PB - v * (H - PB - PT);
  const line = (k: "cov" | "clean") => data.map((d, i) => `${i ? "L" : "M"}${X(d.t)},${Y(d[k])}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Coverage and accuracy against threshold">
      {[0, 0.5, 1].map((v) => <g key={v}><line x1={PL} x2={W - PR} y1={Y(v)} y2={Y(v)} className={s.grid} /><text x={PL - 6} y={Y(v) + 4} textAnchor="end" className={s.ax}>{v * 100}%</text></g>)}
      {[0.5, 0.6, 0.7, 0.8, 0.9, 1].map((t) => <text key={t} x={X(t)} y={H - 18} textAnchor="middle" className={s.ax}>{t * 100}%</text>)}
      <text x={W / 2} y={H - 2} textAnchor="middle" className={s.ax}>confidence threshold</text>
      <line x1={X(ev.accept_at)} x2={X(ev.accept_at)} y1={PT} y2={H - PB} className={s.ref} />
      <path d={line("cov")} className={s.lineInk} />
      <path d={line("clean")} className={s.lineRed} />
      <text x={X(0.52)} y={Y(data[0].cov) - 8} className={s.lab}>accepted</text>
      <text x={X(0.52)} y={Y(data[0].clean) - 8} className={s.labRed}>within 2%</text>
    </svg>
  );
}

export function Reliability({ rows }: { rows: Row[] }) {
  const bins = Array.from({ length: 10 }, (_, i) => i / 10);
  const pts = bins.map((b) => {
    const g = rows.filter((r) => r.read != null && r.conf >= b && r.conf < b + 0.1);
    return { b: b + 0.05, n: g.length, hit: g.length ? g.filter((r) => (r.err ?? 1) < 0.02).length / g.length : null };
  });
  const X = (v: number) => PL + v * (W - PL - PR);
  const Y = (v: number) => H - PB - v * (H - PB - PT);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Reliability of the confidence">
      <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} className={s.ref} />
      {[0, 0.5, 1].map((v) => <g key={v}><text x={PL - 6} y={Y(v) + 4} textAnchor="end" className={s.ax}>{v * 100}%</text><text x={X(v)} y={H - 18} textAnchor="middle" className={s.ax}>{v * 100}%</text></g>)}
      <text x={W / 2} y={H - 2} textAnchor="middle" className={s.ax}>stated confidence</text>
      {pts.filter((p) => p.hit != null).map((p, i) => <circle key={i} cx={X(p.b)} cy={Y(p.hit!)} r={Math.max(3, Math.min(14, Math.sqrt(p.n) * 1.4))} className={s.dotAcc} />)}
    </svg>
  );
}

export function IssueBars({ rows }: { rows: Row[] }) {
  const counts: Record<string, number> = {};
  rows.filter((r) => !r.accepted).forEach((r) => (r.issues.length ? r.issues : ["low confidence"]).forEach((c) => (counts[c] = (counts[c] ?? 0) + 1)));
  const names: Record<string, string> = { tilt: "Turned too far", blur: "Blurred", glare: "Glare on the face", glare_needle: "Glare on the needle", scale: "Numbers unreadable", range: "Needle off the scale", small: "Too far away", nodial: "No dial found", multiple: "Two gauges in the frame", "low confidence": "Low confidence" };
  const items = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(...items.map((x) => x[1]), 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Reasons photos were sent back">
      {items.map(([k, v], i) => (
        <g key={k}>
          <text x={150} y={PT + 18 + i * 36} textAnchor="end" className={s.lab}>{names[k] ?? k}</text>
          <rect x={160} y={PT + 4 + i * 36} width={(v / max) * (W - 220)} height={20} className={s.barInk} />
          <text x={166 + (v / max) * (W - 220)} y={PT + 19 + i * 36} className={s.ax}>{v}</text>
        </g>
      ))}
    </svg>
  );
}
