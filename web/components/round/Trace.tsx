/** The agent's logic sheet for one capture: every model turn and tool call, with what the guards said. */
import type { Step } from "@/lib/types";
import s from "./trace.module.css";

const TOOL: Record<string, string> = {
  read_gauge: "Read the gauge",
  compare_history: "Compare with history",
  request_reshoot: "Ask for a new photo",
  log_reading: "Log the reading",
  hold_work_order: "Hold a work order",
  flag_wrong_gauge: "Flag the tag",
};

/** Model text without the <thinking> blocks some models (Amazon Nova) wrap their reasoning in. */
const said = (t?: string) => (t || "").replace(/<thinking>[\s\S]*?(<\/thinking>|$)/g, "").trim();

export function Trace({ steps, engine }: { steps: Step[]; engine?: string | null }) {
  const n = steps.filter((x) => x.kind === "tool").length;
  return (
    <div className={s.trace}>
      <p className={s.engine}>
        Decided by <b>{engine || "the rule engine"}</b>, {n} tool call{n === 1 ? "" : "s"}
      </p>
      <ol className={s.steps}>
        {steps.map((st, i) => (
          <li key={i} className={s[st.kind]}>
            <StepRow st={st} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function StepRow({ st }: { st: Step }) {
  if (st.kind === "model") {
    return (
      <>
        <span className={s.kind}>Model</span>
        <div className={s.body}>
          {said(st.text) ? <p className={s.say}>&ldquo;{said(st.text)}&rdquo;</p> : null}
          {st.calls.length > 0 && <p className={s.meta}>calls {st.calls.map((c) => TOOL[c] ?? c).join(", ")}</p>}
          <p className={s.ms}>{st.model}, {st.ms} ms</p>
        </div>
      </>
    );
  }
  if (st.kind === "tool") {
    const r = st.result as Record<string, unknown>;
    const refused = typeof r.refused === "string" ? (r.refused as string) : null;
    return (
      <>
        <span className={s.kind}>Tool</span>
        <div className={s.body}>
          <p className={s.title}>
            {TOOL[st.name] ?? st.name}
            {st.name === "read_gauge" && st.args?.mode ? <span className={s.arg}> mode {String(st.args.mode)}</span> : null}
          </p>
          {refused ? <p className={s.refused}>Guard refused: {refused}</p> : <Summary name={st.name} r={r} />}
          <p className={s.ms}>{st.ms} ms</p>
        </div>
      </>
    );
  }
  if (st.kind === "note") {
    return (
      <>
        <span className={s.kind}>Note</span>
        <div className={s.body}><p className={s.meta}>{st.text}</p></div>
      </>
    );
  }
  return (
    <>
      <span className={s.kind}>Done</span>
      <div className={s.body}>
        <p className={s.title}>Outcome: {st.outcome}</p>
        <p className={s.ms}>{st.ms} ms in total</p>
      </div>
    </>
  );
}

function Summary({ name, r }: { name: string; r: Record<string, unknown> }) {
  if (r.error) return <p className={s.refused}>{String(r.error)}</p>;
  if (name === "read_gauge") {
    const issues = (r.issues as { text: string }[] | undefined) ?? [];
    return (
      <p className={s.meta}>
        {r.display ? <b>{String(r.display)}</b> : "no value"}, confidence {Math.round(Number(r.confidence ?? 0) * 100)}% (needs {Math.round(Number(r.threshold ?? 0.9) * 100)}%)
        {r.unit_matches === false || r.range_matches === false ? ", dial doesn't match the tag" : ""}
        {issues.length ? `; ${issues.map((i) => i.text).join(" ")}` : ""}
      </p>
    );
  }
  if (name === "compare_history") {
    const br = (r.breaches as { text: string }[] | undefined) ?? [];
    const last = r.last as { value: number; days_ago: number } | undefined;
    return (
      <p className={s.meta}>
        {last ? `Last ${last.value} ${String(r.unit)} ${last.days_ago < 1 ? `${Math.round(last.days_ago * 24)} h` : `${last.days_ago.toFixed(1)} days`} ago. ` : ""}
        {r.rate_per_day != null ? `Week trend ${Number(r.rate_per_day) > 0 ? "+" : ""}${Number(r.rate_per_day).toFixed(2)} a day. ` : ""}
        {br.length ? <b>{br.map((b) => b.text).join("; ")}</b> : "Inside limits, no drift."}
      </p>
    );
  }
  if (name === "request_reshoot") return <p className={s.meta}><b>{String(r.guidance ?? "")}</b></p>;
  if (name === "hold_work_order") return <p className={s.meta}>Priority {String(r.priority)}{Array.isArray(r.struck) && r.struck.length ? `; struck unverified figures: ${(r.struck as string[]).join(", ")}` : ""}</p>;
  if (name === "flag_wrong_gauge") return <p className={s.meta}>{String(r.message ?? "")}</p>;
  if (name === "log_reading") return <p className={s.meta}>Logged {String(r.value ?? "")}</p>;
  return null;
}
