/* The real-photo benchmark: Dialed against two baselines and its own ablations, on photos it was never tuned on. */
import bench from "@/public/evidence/bench.json";
import s from "./evidence.module.css";

type Sum = { n: number; read: number; accepted: number; coverage: number | null; accepted_within_2pct: number; precision_2pct: number | null; accepted_over_5pct: number; correct_and_accepted: number | null; at_rest: { n: number; accepted: number; accepted_within_2pct: number }; needle_off_zero: { n: number; accepted: number; accepted_within_2pct: number } };
type Run = { kind: string; reader?: string; env?: Record<string, string>; spend?: { calls: number; usd: number; input_tokens: number }; sets: Record<string, { summary: Sum; summary_at_090?: Sum }>; decline: { n: number; accepted: number } | null };
type Read = { read: number | null; err: number | null; accepted: boolean; issues?: string[]; conf?: number } | null;
type Photo = { file: string; thumb: string; truth: number; min: number; max: number; unit: string; at_rest: boolean; credit: { title: string; author: string; license: string; source: string; via: string }; reads: Record<string, Read> };

const B = bench as unknown as { runs: Record<string, Run>; test_photos: Photo[]; decline_photos: unknown[] };
const R = B.runs;
const pct = (v: number | null | undefined, d = 0) => (v == null ? "–" : `${(v * 100).toFixed(d)}%`);

export const ROWS: { key: string; label: string; note: string; gated?: boolean }[] = [
  { key: "dialed", label: "Dialed, this version", note: "pointer-end check, confidence refitted with three new measurements; accepts at 90%" },
  { key: "submitted", label: "Dialed as first submitted", note: "commit dd8b575 (Oct 7), same 90% gate" },
  { key: "with-projective", label: "This version with projective straightening", note: "homography from the rim conic and the pivot instead of the affine map; not the default, see below" },
  { key: "no-ends-check", label: "This version without the pointer-end check", note: "pointer end taken from the needle line alone" },
  { key: "classic", label: "Classic OpenCV reader", note: "HoughCircles dial, longest HoughLinesP needle, told the true scale range, 270° sweep; always answers" },
  { key: "nova-lite", label: "Amazon Nova Lite, reading the photo", note: "a vision-language model on Bedrock; every answer it gave" },
  { key: "nova-lite", label: "Amazon Nova Lite, its confident answers", note: "only answers where it stated 90% confidence or more", gated: true },
];

export function benchHeadline() {
  const d = R.dialed?.sets["bench-test"]?.summary;
  const v = R["nova-lite"]?.sets["bench-test"]?.summary;
  const sub = R.submitted?.sets["bench-test"]?.summary;
  return { d, v, sub, n: d?.n ?? 0, decline: R.dialed?.decline, vDecline: R["nova-lite"]?.decline, spend: R["nova-lite"]?.spend };
}

export function BenchTable({ set = "bench-test" }: { set?: string }) {
  return (
    <div className={s.tblWrap}>
      <table className={`${s.tbl} ${s.cards}`}>
        <thead>
          <tr><th scope="col">Reader</th><th scope="col">Answered</th><th scope="col">Answers within 2% of the scale</th><th scope="col">Answers off by 5% or more</th><th scope="col">Photos read right</th><th scope="col">Photos to decline it answered</th></tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const run = R[row.key];
            const x = row.gated ? run?.sets[set]?.summary_at_090 : run?.sets[set]?.summary;
            if (!x) return null;
            return (
              <tr key={row.label}>
                <th scope="row">{row.label}<span className={s.setLabel}>{row.note}</span></th>
                <td data-label="Answered">{x.accepted} of {x.n}</td>
                <td data-label="Within 2%"><b>{x.accepted_within_2pct}</b> ({pct(x.precision_2pct)})</td>
                <td data-label="Off by 5%+">{x.accepted_over_5pct}</td>
                <td data-label="Read right">{x.accepted_within_2pct} of {x.n} ({pct(x.correct_and_accepted)})</td>
                <td data-label="Declines answered">{row.gated || !run?.decline ? "–" : `${run.decline.accepted} of ${run.decline.n}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function fmt(v: number | null | undefined, p: Photo) {
  if (v == null) return "no answer";
  const span = p.max - p.min;
  return v.toFixed(span <= 20 ? 2 : span <= 200 ? 1 : 0);
}

export function BenchPhotos() {
  const photos = B.test_photos;
  // the cases that matter most: where Dialed answered wrong, and where it answered right
  const wrong = photos.filter((p) => p.reads.dialed?.accepted && (p.reads.dialed.err ?? 1) >= 0.02);
  const right = photos.filter((p) => p.reads.dialed?.accepted && (p.reads.dialed.err ?? 1) < 0.02);
  const vlmWrong = photos.filter((p) => p.reads["nova-lite"]?.accepted && (p.reads["nova-lite"]?.err ?? 1) >= 0.05 && !p.reads.dialed?.accepted);
  const card = (p: Photo, tag: string) => (
    <li key={p.file + tag}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={p.thumb} alt={p.credit.title} loading="lazy" />
      <p className={s.failVal}>{p.truth} {p.unit} <span className={s.vs}>by eye{p.at_rest ? ", needle at rest" : ""}</span></p>
      <p className={s.failMeta}>
        Dialed: {p.reads.dialed?.accepted ? <b>{fmt(p.reads.dialed.read, p)}</b> : `re-shoot${p.reads.dialed?.read != null ? ` (would have said ${fmt(p.reads.dialed.read, p)})` : ""}`}.{" "}
        Nova Lite: {fmt(p.reads["nova-lite"]?.read, p)}. Classic: {fmt(p.reads.classic?.read, p)}.
      </p>
      <p className={s.credit}><a href={p.credit.source}>{p.credit.author}</a>, {p.credit.license}, {p.credit.via}</p>
    </li>
  );
  return (
    <>
      {wrong.length > 0 && (<><h3 className={s.h3}>Every wrong answer Dialed gave on the held-out photos</h3><ul className={s.real}>{wrong.map((p) => card(p, "w"))}</ul></>)}
      {right.length > 0 && (<><h3 className={s.h3}>Its right answers</h3><ul className={s.real}>{right.map((p) => card(p, "r"))}</ul></>)}
      {vlmWrong.length > 0 && (<><h3 className={s.h3}>Photos where the language model answered 5% or more off and Dialed asked for a re-shoot</h3><ul className={s.real}>{vlmWrong.slice(0, 12).map((p) => card(p, "v"))}</ul></>)}
    </>
  );
}
