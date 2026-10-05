"use client";
import { useEffect, useState } from "react";
import s from "./chrome.module.css";

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // drawing convention: no I or O

/** The drawing-sheet border: column numbers on top and bottom, row letters down both sides,
 *  one row per ~460 px of page so the references stay meaningful on long pages. */
export function Frame() {
  const [rows, setRows] = useState(6);
  useEffect(() => {
    const measure = () => setRows(Math.max(3, Math.min(LETTERS.length, Math.round(document.documentElement.scrollHeight / 460))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  const cols = Array.from({ length: 8 }, (_, i) => i + 1);
  const letters = LETTERS.slice(0, rows).split("");
  return (
    <div className={s.frame} aria-hidden="true">
      <div className={`${s.gridH} ${s.top}`}>{cols.map((c) => <span key={c}>{c}</span>)}</div>
      <div className={`${s.gridH} ${s.bottom}`}>{cols.map((c) => <span key={c}>{c}</span>)}</div>
      <div className={`${s.gridV} ${s.left}`}>{letters.map((l) => <span key={l}>{l}</span>)}</div>
      <div className={`${s.gridV} ${s.right}`}>{letters.map((l) => <span key={l}>{l}</span>)}</div>
    </div>
  );
}
