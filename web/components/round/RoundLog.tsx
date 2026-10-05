"use client";
import Link from "next/link";
import type { RoundData } from "@/lib/types";
import { Spark } from "./Spark";
import s from "./round.module.css";

const OUT = { logged: "LOGGED", held: "HOLD", reshoot: "RE-SHOOT", mismatch: "CHECK TAG" } as const;

export function RoundLog({ data, done, onSelect }: { data: RoundData; done: Set<string>; onSelect: (id: string) => void }) {
  const byId = Object.fromEntries(data.gauges.map((g) => [g.id, g]));
  return (
    <div className={s.logWrap}>
      <table className={s.log}>
        <thead>
          <tr>
            <th scope="col">Tag</th>
            <th scope="col">Gauge</th>
            <th scope="col">Latest</th>
            <th scope="col">Trend</th>
            <th scope="col">Status</th>
            <th scope="col">When</th>
            <th scope="col"><span className="sr">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {data.round.gauges.map((id) => {
            const g = byId[id];
            if (!g) return null;
            const l = g.latest;
            const span = g.max - g.min;
            const dp = span <= 20 ? 2 : span <= 200 ? 1 : 0;
            const today = done.has(id);
            const val = l?.value ?? l?.read_value;
            return (
              <tr key={id}>
                <th scope="row" className={s.tagCell}>{id}</th>
                <td>
                  <span className={s.gName}>{g.name}</span>
                  <span className={s.gSvc}>{g.normal[0]}–{g.normal[1]} {g.unit} normal</span>
                </td>
                <td className={s.valCell}>{val != null ? `${val.toFixed(dp)} ${g.unit}` : "–"}</td>
                <td><Spark points={g.recent} lo={g.normal[0]} hi={g.normal[1]} min={g.min} max={g.max} width={140} height={36} /></td>
                <td>{l && today ? <span className={`tag ${l.outcome}`}>{OUT[l.outcome]}</span> : <span className={s.pend}>{l?.seeded ? "History" : "Not read"}</span>}</td>
                <td className={s.when}>{l ? new Date(l.at).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "–"}</td>
                <td className={s.actCell}>
                  <button className={s.linkBtn} onClick={() => onSelect(id)}>Read</button>
                  <Link href={`/gauge/?id=${id}`}>Sheet</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
