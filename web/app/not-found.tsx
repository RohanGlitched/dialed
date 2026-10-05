import Link from "next/link";

/** 404: a gauge with its needle pegged below zero. */
export default function NotFound() {
  const ticks = Array.from({ length: 11 }, (_, i) => -135 + i * 27);
  return (
    <section className="wrap" style={{ paddingTop: "8vh", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 48, alignItems: "center" }}>
      <svg viewBox="0 0 300 300" style={{ width: "100%", maxWidth: 420 }} aria-hidden="true">
        <circle cx="150" cy="150" r="138" fill="var(--paper)" stroke="var(--ink)" strokeWidth="8" />
        {ticks.map((a, i) => {
          const r = (a * Math.PI) / 180;
          return (
            <g key={a}>
              <line x1={150 + 118 * Math.sin(r)} y1={150 - 118 * Math.cos(r)} x2={150 + 100 * Math.sin(r)} y2={150 - 100 * Math.cos(r)} stroke="var(--ink)" strokeWidth={i % 5 === 0 ? 4 : 2} />
              {i % 5 === 0 && <text x={150 + 82 * Math.sin(r)} y={150 - 82 * Math.cos(r) + 6} textAnchor="middle" style={{ font: "800 18px var(--cond)", fill: "var(--ink)" }}>{i * 10}</text>}
            </g>
          );
        })}
        <line x1="150" y1="150" x2={150 + 112 * Math.sin((-150 * Math.PI) / 180)} y2={150 - 112 * Math.cos((-150 * Math.PI) / 180)} stroke="var(--needle)" strokeWidth="5" strokeLinecap="round" />
        <circle cx="150" cy="150" r="10" fill="var(--ink)" />
        <text x="150" y="215" textAnchor="middle" style={{ font: "700 16px var(--cond)", fill: "var(--steel)" }}>404</text>
      </svg>
      <div>
        <p className="cell">Sheet not found</p>
        <h1 className="display" style={{ fontSize: "clamp(48px, 6vw, 92px)", margin: "10px 0 16px" }}>The needle is below zero.</h1>
        <p className="lede" style={{ margin: "0 0 28px" }}>There&apos;s no sheet at this address. The link may be mistyped, or the page was moved.</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link className="btn" href="/">Back to the overview</Link>
          <Link className="btn ghost" href="/round/">Walk the round</Link>
        </div>
      </div>
    </section>
  );
}
