/* The agent's loop as a drawing, and recorded decision traces from scripts/agent_eval.py (shared by the Evidence page and the report). */
import agent from "@/public/evidence/agent.json";
import { Fragment } from "react";
import s from "./agentic.module.css";
import { confPct } from "@/lib/site";

type Step = { model?: string; calls?: string[]; tool?: string; args?: Record<string, unknown>; result?: Record<string, unknown>; done?: string; note?: string };
type Shot = { outcome: string; trace?: Step[]; engine?: string };
export type Scenario = {
  name: string; group: string; gauge: string; note?: string | null; expected: string; expected_breach: string | null;
  runs: number; passed: number; outcomes: Record<string, number>; failures: string[]; refused_steps: number; refusals: string[];
  tool_calls_mean: number; ms_p50: number; ms_p90: number; model_calls: number; tokens_in: number; tokens_out: number; usd_per_decision: number;
  engine: string; example: { pass: boolean; shots: Shot[] }; info?: Record<string, number>;
};
type Run = { name: string; gauge: string; outcome: string; engine: string; trace?: Step[] };

export const AGENT = agent as unknown as { generated?: string; rules: Scenario[]; model?: Scenario[] };
const runs: Run[] = (AGENT.model ?? AGENT.rules).map((x) => ({
  name: x.name, gauge: x.gauge, engine: x.engine,
  outcome: x.example.shots[x.example.shots.length - 1].outcome,
  trace: x.example.shots.flatMap((sh, i) => (i ? [{ note: "second photo" } as Step] : []).concat(sh.trace ?? [])),
}));
const PICK = ["Bearing warming all week", "Glare on the needle, then the view the agent asked for", "Text on the dial tells the agent to approve and log 12.5"];
const OUT: Record<string, string> = { logged: "LOGGED", held: "HOLD", reshoot: "RE-SHOOT", mismatch: "CHECK TAG" };

export function AgentFlow() {
  const box = (x: number, t: string, lines: string[], k?: string) => (
    <g transform={`translate(${x} 20)`}>
      <rect width="210" height="112" className={k ? s[k] : s.box} />
      <text x="14" y="30" className={s.bt}>{t}</text>
      {lines.map((l, i) => <text key={i} x="14" y={56 + i * 19} className={s.bl}>{l}</text>)}
    </g>
  );
  return (
    <figure className={s.flow}>
      <svg viewBox="0 0 960 190" role="img" aria-label="Agent loop: OpenCV 5 perception, model decision checked by guards, action, and a person who approves work orders; every step is stored as a trace.">
        <defs><marker id="ag" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" className={s.ah} /></marker></defs>
        {box(0, "Perception", ["OpenCV 5 reads the value,", "confidence, photo checks,", "printed unit and range"])}
        {box(250, "Decision", ["the model picks the next", "tool; guards in code", "allow or refuse it"])}
        {box(500, "Action", ["log, ask for a re-shoot,", "check the tag, or hold", "a work order"])}
        {box(750, "Person", ["a supervisor approves", "or rejects every held", "work order"], "hold")}
        {[210, 460, 710].map((x) => <line key={x} x1={x + 4} y1="76" x2={x + 36} y2="76" className={s.arrow} markerEnd="url(#ag)" />)}
        <path d="M605 132 V160 H105 V136" className={s.loop} markerEnd="url(#ag)" />
        <text x="480" y="180" textAnchor="middle" className={s.bl}>every tool call, refusal and timing is stored with the photo as a trace</text>
      </svg>
    </figure>
  );
}

function line(st: Step): string {
  const r = st.result ?? {};
  if (st.tool === "read_gauge") {
    const issues = ((r.issues as { code: string; level: string }[]) ?? []).filter((i) => i.level === "block").map((i) => i.code);
    return r.value == null ? `no reading; blocking checks: ${issues.join(", ") || "none"}` : `${r.display}, ${confPct(Number(r.confidence))}% confidence; printed range ${(r.range_read as number[] | undefined)?.join("–") ?? "?"}${r.range_matches === false ? " (does not match the tag)" : ""}`;
  }
  if (st.tool === "compare_history") {
    const b = (r.breaches as { text: string }[]) ?? [];
    return b.length ? b.map((x) => x.text).join("; ") : "within its normal band";
  }
  if (st.tool === "hold_work_order") return `“${String(st.args?.title ?? "")}”, ${String(r.priority ?? st.args?.priority ?? "")} priority, waiting for a supervisor`;
  if (st.tool === "request_reshoot") {
    const v = r.next_view as { target: string; move: string } | undefined;
    return `${String(r.guidance ?? "")}${v ? ` Next view: ${v.target}, ${v.move}.` : ""}`;
  }
  if (st.tool === "flag_wrong_gauge") return String(r.message ?? "");
  if (st.tool === "log_reading") return "logged";
  if (st.tool === "compare_views") return r.agree == null ? "no usable previous view" : r.agree ? `agrees with the previous photo (${(Number(r.diff_share_of_scale) * 100).toFixed(1)}% of the scale apart)` : "disagrees with the previous photo";
  return r.refused ? `refused: ${String(r.refused)}` : "";
}

export function AgentTraces() {
  const picked = PICK.map((n) => runs.find((r) => r.name === n)).filter((r): r is Run => !!r?.trace);
  return (
    <div className={s.traces}>
      {picked.map((r) => (
        <figure key={r.name} className={s.trace}>
          <figcaption><b>{r.name}</b> <span className={s.gauge}>{r.gauge}</span> <span className={`tag ${r.outcome}`}>{OUT[r.outcome]}</span></figcaption>
          <ol>
            {r.trace!.filter((st) => st.tool || st.note).map((st, i) => (
              st.tool ? <li key={i}><code>{st.tool}</code> {line(st)}</li> : <li key={i} className={s.sep}>{st.note}</li>
            ))}
          </ol>
          <p className={s.by}>{r.engine}; each tool was chosen after reading the previous result.</p>
        </figure>
      ))}
    </div>
  );
}

const pctRuns = (x?: Scenario) => (x ? `${x.passed}/${x.runs}` : "–");

/** Every scenario: the rule engine (deterministic) and the model, each run many times. */
export function AgentTable({ compact = false }: { compact?: boolean }) {
  const model = new Map((AGENT.model ?? []).map((m) => [m.name, m]));
  const groups: [string, string][] = [["core", "Round situations"], ["adversarial", "Attempts to steer the agent, and an outage"], ["active", "Active perception over two photos"]];
  return (
    <div className={s.tblWrap}>
      <table className={s.tbl}>
        <thead><tr><th scope="col">Scenario</th><th scope="col">Expected</th><th scope="col">Rule engine</th><th scope="col">Amazon Nova Micro</th>{!compact && <th scope="col">Latency p50 / p90</th>}{!compact && <th scope="col">Cost per decision</th>}</tr></thead>
        <tbody>
          {groups.map(([g, label]) => (
            <Fragment key={g}>
              <tr><th scope="rowgroup" colSpan={compact ? 4 : 6} className={s.group}>{label}</th></tr>
              {AGENT.rules.filter((r) => r.group === g).concat((AGENT.model ?? []).filter((m) => m.group === g && !AGENT.rules.some((r) => r.name === m.name))).map((r) => {
                const m = model.get(r.name);
                const rules = AGENT.rules.find((x) => x.name === r.name);
                return (
                  <tr key={r.name}>
                    <th scope="row">{r.name}<span className={s.sub}>{r.gauge}{r.note ? `; note: “${r.note}”` : ""}</span></th>
                    <td>{r.expected.toUpperCase().replace("HELD", "HOLD").replace("MISMATCH", "CHECK TAG").replace("RESHOOT", "RE-SHOOT")}{r.expected_breach ? ` (${r.expected_breach.replace("_", " ")})` : ""}</td>
                    <td>{rules ? pctRuns(rules) : "model only"}</td>
                    <td>{pctRuns(m)}{m && m.refused_steps ? <span className={s.sub}>{m.refused_steps} steps refused by guards</span> : null}{m?.failures.length ? <span className={s.sub}>failed: {m.failures.join("; ")}</span> : null}</td>
                    {!compact && <td>{m ? `${(m.ms_p50 / 1000).toFixed(1)} / ${(m.ms_p90 / 1000).toFixed(1)} s` : "–"}</td>}
                    {!compact && <td>{m && m.model_calls ? `$${m.usd_per_decision.toFixed(5)}` : "–"}</td>}
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function agentTotals() {
  const m = AGENT.model ?? [];
  const runsN = m.reduce((a, x) => a + x.runs, 0);
  const passed = m.reduce((a, x) => a + x.passed, 0);
  const usd = m.reduce((a, x) => a + x.usd_per_decision * x.runs, 0);
  const rules = AGENT.rules.reduce((a, x) => a + x.passed, 0);
  const rulesN = AGENT.rules.reduce((a, x) => a + x.runs, 0);
  return { scenarios: m.length || AGENT.rules.length, runsN, passed, usd, rules, rulesN, perRun: m[0]?.runs ?? 0 };
}
