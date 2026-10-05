import { Kalam } from "next/font/google";
import s from "./clipboard.module.css";

const hand = Kalam({ subsets: ["latin"], weight: ["400", "700"], display: "swap" });

/** A paper round sheet, filled in by hand: the same week of TI-201 the agent caught. */
const ROWS: { tag: string; desc: string; range: string; vals: (string | { x: string; then: string } | null)[] }[] = [
  { tag: "PI-101", desc: "Intake header", range: "1.2–2.4 bar", vals: ["1.8", "1.9", "1.8", "1.7", "1.8"] },
  { tag: "PI-102", desc: "P-1 discharge", range: "7.0–9.5 bar", vals: ["8.4", { x: "6.4", then: "8.4" }, "8.6", "8.3", "8.5"] },
  { tag: "TI-201", desc: "P-1 bearing", range: "30–70 °C", vals: ["46", "51", "55", "60", "63"] },
  { tag: "PI-104", desc: "F-1 inlet", range: "5.5–8.0 bar", vals: ["7.1", "7.2", null, "7.1", "7.2"] },
  { tag: "PI-105", desc: "F-1 outlet", range: "4.5–7.5 bar", vals: ["6.5", "6.3", "6.2", "6.?", "5.9"] },
  { tag: "PI-106", desc: "Air receiver", range: "90–125 psi", vals: ["110", "115", "112", "108", "112"] },
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export function Clipboard() {
  return (
    <section className="wrap section" aria-labelledby="clip-h">
      <div className={s.grid}>
        <div className={s.board} aria-label="A handwritten round sheet for the pump house">
          <div className={s.clip} aria-hidden="true" />
          <div className={s.paper}>
            <p className={s.formHead}>DAILY ROUND SHEET <span>High-lift pump house, 07:00 round</span></p>
            <table className={s.form}>
              <thead>
                <tr>
                  <th scope="col">Tag</th>
                  <th scope="col">Service</th>
                  <th scope="col">Normal</th>
                  {DAYS.map((d) => <th key={d} scope="col">{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.tag}>
                    <th scope="row">{r.tag}</th>
                    <td>{r.desc}</td>
                    <td className={s.range}>{r.range}</td>
                    {r.vals.map((v, i) => (
                      <td key={i} className={`${hand.className} ${s.hand}`} style={{ transform: `rotate(${((i * 7 + r.tag.length * 3) % 5) - 2}deg)` }}>
                        {v == null ? <span className={s.blank} /> : typeof v === "string" ? v : (<><del>{v.x}</del> {v.then}</>)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={`${hand.className} ${s.sign}`}>Checked: R.K.</p>
          </div>
        </div>
        <div className={s.text}>
          <h2 id="clip-h" className="h2">The numbers were on the sheet. Nobody did the arithmetic.</h2>
          <p className="lede">This is how most plants still read their gauges: a clipboard, a pen and a walk. Look at TI-201. The bearing warmed seventeen degrees in five days, every reading written down, every one inside its band. It would have been noticed when the alarm went off.</p>
          <ul className={s.points}>
            <li><b>Readings are copied twice,</b> from dial to sheet and from sheet to spreadsheet, if at all.</li>
            <li><b>Trends are invisible.</b> A value can creep for a week without ever leaving the normal band.</li>
            <li><b>A blank is silent.</b> Wednesday&apos;s PI-104 was never read, and nothing says so.</li>
            <li><b>Pairs go unchecked.</b> The pressure drop across filter F-1 lives in two rows nobody subtracts.</li>
          </ul>
          <p className={s.after}>Dialed reads the same dials from photos, keeps every reading with its evidence, and does the arithmetic on each one: band, drift, pairs.</p>
        </div>
      </div>
    </section>
  );
}
