/** Geometry of the hero sequence: photo -> straightened dial -> unrolled scale -> fitted ruler.
 *
 * Coordinates: the plate is W x H display units. The straightened dial (OpenCV's output, D x D px)
 * is drawn with scale K so its mid radius R_MID maps to RM = W / 2π (the ruler then spans the plate).
 * Unrolling bends the annulus [R_IN, R_OUT] around a centre that recedes to infinity as t -> 1
 * (curvature (1 - t) / RM), keeping arc length along the mid radius. After that, a horizontal fit
 * zooms so the printed scale fills the plate. The same maths runs in the WebGL shader (Unroll.tsx)
 * and the canvas fallback.
 */
import type { Inspect } from "./types";

export type Plan = ReturnType<typeof plan>;

export const wrapPi = (a: number) => ((((a % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
export const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

export function plan(ins: Inspect, W: number, H: number) {
  const g = ins.geometry;
  const D = g.dial_size;
  const [cx, cy] = g.center!;
  const ring = g.ring!;
  const faceEdge = g.face_edge ?? g.rad;
  const R_OUT = Math.min(ring[1] + 1, faceEdge - 2);
  const R_IN = Math.max(D * 0.09, ring[0] * 0.5);
  const R_MID = (R_OUT + R_IN) / 2;
  const RM = (W / (2 * Math.PI)) * 0.98;
  const K = RM / R_MID;
  const TOP = wrapPi((((g.gap ?? 180) + 180) * Math.PI) / 180);
  const stripX = (deg: number) => W / 2 + wrapPi((deg * Math.PI) / 180 - TOP) * RM;
  // final fit: the printed numbers and the needle fill 80% of the width
  const xs = (g.fit?.points ?? []).map((p) => stripX(p.deg)).concat(ins.reading.needle_angle != null ? [stripX(ins.reading.needle_angle)] : []);
  const lo = xs.length ? Math.min(...xs) : 0;
  const hi = xs.length ? Math.max(...xs) : W;
  const Z = Math.min(2.2, (W * 0.8) / Math.max(40, hi - lo));
  const left = (W - (hi - lo) * Z) / 2;
  // photo placement before and after straightening (2D affine as [a, b, c, d, e, f] for CSS matrix())
  const [ex, ey, ew, eh] = g.ellipse!;
  const show = (H * 0.9) / Math.max(ew, eh);
  const photoA = [show, 0, 0, show, W / 2 - ex * show, H / 2 - ey * show];
  const M = g.M!;
  const ox = W / 2 - cx * K;
  const oy = H / 2 - cy * K;
  const photoB = [M[0][0] * K, M[1][0] * K, M[0][1] * K, M[1][1] * K, M[0][2] * K + ox, M[1][2] * K + oy];
  return { W, H, D, cx, cy, R_OUT, R_IN, R_MID, RM, K, TOP, lo, Z, left, stripX, photoA, photoB, show, ellipse: g.ellipse! };
}

/** State of the unroll at progress t (bend) and f (fit). */
export function frame(p: Plan, t: number, f: number) {
  const s = Math.max(1 - t, 0.0005);
  const rho = p.RM / s;
  const yMid = p.H / 2 - p.RM + p.RM * t;
  const Z = 1 + (p.Z - 1) * f;
  const left = p.lo + (p.left - p.lo) * f;
  return { s, rho, yMid, Cx: p.W / 2, Cy: yMid + rho, rLo: p.R_IN * Math.min(1, t / 0.35), top: p.TOP * t, Z, left };
}

/** Display position of a strip point (raw strip x, raw y) after the fit. */
export function toDisp(p: Plan, fr: ReturnType<typeof frame>, x: number, y: number): [number, number] {
  return [fr.left + (x - p.lo) * fr.Z, fr.yMid + (y - fr.yMid) * fr.Z];
}

export function lerpMatrix(a: number[], b: number[], u: number) {
  return a.map((v, i) => v + (b[i] - v) * u);
}

/** Sequence timeline in ms. */
export const TIMELINE = { trace: 900, straighten: 1100, swap: 300, unroll: 1500, fit: 700 } as const;
export const TOTAL = Object.values(TIMELINE).reduce((a, b) => a + b, 0);

export type Phase = { stage: 0 | 1 | 2 | 3; trace: number; straighten: number; swap: number; unroll: number; fit: number; done: boolean };

export function phaseAt(ms: number): Phase {
  const T = TIMELINE;
  const c = (x: number, d: number) => Math.max(0, Math.min(1, x / d));
  let e = ms;
  const trace = c(e, T.trace);
  e -= T.trace;
  const straighten = c(e, T.straighten);
  e -= T.straighten;
  const swap = c(e, T.swap);
  e -= T.swap;
  const unroll = c(e, T.unroll);
  e -= T.unroll;
  const fit = c(e, T.fit);
  const stage = (straighten <= 0 ? 0 : swap <= 0 ? 1 : fit <= 0 ? 2 : 3) as Phase["stage"];
  return { stage, trace: ease(trace), straighten: ease(straighten), swap, unroll: ease(unroll), fit: ease(fit), done: ms >= TOTAL };
}
