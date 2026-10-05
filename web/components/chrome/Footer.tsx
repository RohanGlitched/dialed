import Link from "next/link";
import { REVISIONS } from "@/lib/changelog";
import { REPO_URL, SHEETS } from "@/lib/site";
import { Mark } from "./Mark";
import s from "./chrome.module.css";

/** The footer is the drawing's title block: sheet index, revisions, credits and the project cell. */
export function Footer() {
  return (
    <footer className={s.footer}>
      <div className="wrap">
      <div className={s.closing}>
        <p className={s.closingLine}>Every analog gauge in the plant, read from a photo and acted on.</p>
        <div className={s.closingCtas}>
          <Link className="btn" href="/round/">Walk the sample round</Link>
          <Link className="btn ghost" href="/read/">Read your own gauge</Link>
        </div>
      </div>
      </div>
      <div className="wrap">
      <div className={s.block}>
        <section aria-labelledby="f-sheets">
          <h2 id="f-sheets" className={s.blockHead}>Sheet index</h2>
          <ol className={s.sheets}>
            {SHEETS.map((sh) => (
              <li key={sh.n}>
                <span className={s.sheetNo}>{String(sh.n).padStart(2, "0")}</span>
                <Link href={sh.href}>{sh.title}</Link>
              </li>
            ))}
          </ol>
        </section>
        <section aria-labelledby="f-rev">
          <h2 id="f-rev" className={s.blockHead}>Revisions</h2>
          <table className={s.rev}>
            <thead>
              <tr><th scope="col">Rev.</th><th scope="col">Date</th><th scope="col">Change</th></tr>
            </thead>
            <tbody>
              {REVISIONS.map((r) => (
                <tr key={r.rev}><td>{r.rev}</td><td>{r.date}</td><td>{r.text}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <section aria-labelledby="f-credits">
          <h2 id="f-credits" className={s.blockHead}>Built with</h2>
          <ul className={s.credits}>
            <li><a href="https://opencv.org/">OpenCV 5.0</a> in the cloud and <a href="https://docs.opencv.org/">OpenCV.js</a> on your phone</li>
            <li>Text models from the <a href="https://github.com/opencv/opencv_zoo">OpenCV Model Zoo</a> (PP-OCRv3, CRNN; Apache 2.0)</li>
            <li>AWS Lambda, S3, DynamoDB, CloudFront; Amazon Bedrock</li>
            <li>NVIDIA Nemotron on Nebius as the fallback model</li>
            <li>Sofia Sans by Lettersoup (SIL Open Font License)</li>
          </ul>
        </section>
        <section className={s.cellTitle} aria-label="Title block">
          <div className={s.titleTop}>
            <Mark size={34} />
            <div>
              <p className={s.titleName}>Dialed</p>
              <p className={s.titleSub}>Analog gauge reading agent</p>
            </div>
          </div>
          <dl className={s.titleGrid}>
            <div><dt>Drawn by</dt><dd>Rohan Borade</dd></div>
            <div><dt>For</dt><dd>OpenCV AI Competition 2026</dd></div>
            <div><dt>Licence</dt><dd>MIT</dd></div>
            <div><dt>Source</dt><dd><a href={REPO_URL}>GitHub</a></dd></div>
          </dl>
        </section>
      </div>
      </div>
    </footer>
  );
}
