/* The agent's loop as a drawing, and recorded decision traces from scripts/agent_eval.py (shared by the Evidence page and the report). */
import agent from "@/public/evidence/agent.json";
import s from "./agentic.module.css";

type Step = { model?: string; calls?: string[]; tool?: string; args?: Record<string, unknown>; result?: Record<string, unknown>; done?: string; note?: string };
type Run = { name: string; gauge: string; outcome: string; engine: string; trace?: Step[] };

const runs = ((agent as unknown as { model?: Run[]; rules: Run[] }).model ?? (agent as unknown as { rules: Run[] }).rules);
const PICK = ["Bearing warming all week", "Shaky photo", "Wrong gauge photographed"];
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
    return r.value == null ? `no reading; blocking checks: ${issues.join(", ") || "none"}` : `${r.display}, ${Math.round(Number(r.confidence) * 100)}% confidence; printed range ${(r.range_read as number[] | undefined)?.join("–") ?? "?"}${r.range_matches === false ? " (does not match the tag)" : ""}`;
  }
  if (st.tool === "compare_history") {
    const b = (r.breaches as { text: string }[]) ?? [];
    return b.length ? b.map((x) => x.text).join("; ") : "within its normal band";
  }
  if (st.tool === "hold_work_order") return `“${String(st.args?.title ?? "")}”, ${String(r.priority ?? st.args?.priority ?? "")} priority, waiting for a supervisor`;
  if (st.tool === "request_reshoot") return String(r.guidance ?? "");
  if (st.tool === "flag_wrong_gauge") return String(r.message ?? "");
  if (st.tool === "log_reading") return "logged";
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
            {r.trace!.filter((st) => st.tool).map((st, i) => (
              <li key={i}><code>{st.tool}</code> {line(st)}</li>
            ))}
          </ol>
          <p className={s.by}>{r.engine}; each tool was chosen after reading the previous result.</p>
        </figure>
      ))}
    </div>
  );
}
