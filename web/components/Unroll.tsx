"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { frame, lerpMatrix, phaseAt, plan, toDisp, TOTAL, type Phase, type Plan } from "@/lib/unroll";
import type { Inspect } from "@/lib/types";
import s from "./unroll.module.css";

const W = 900;
const H = 470;

const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;
const FRAG = `
precision highp float;
uniform sampler2D tex;
uniform vec2 size; uniform float dpr; uniform float D; uniform vec2 c;
uniform float rout; uniform float rin; uniform float rmid; uniform float rm; uniform float k;
uniform float rho; uniform float ymid; uniform float rlo; uniform float top;
uniform float Z; uniform float left; uniform float lo;
void main(){
  float px = gl_FragCoord.x / dpr;
  float py = size.y - gl_FragCoord.y / dpr;
  float x = lo + (px - left) / Z;
  float y = ymid + (py - ymid) / Z;
  float dx = x - size.x * 0.5;
  float dy = (ymid + rho) - y;
  float dist = length(vec2(dx, dy));
  float th = atan(dx, dy);
  float u = th * rho;
  if (abs(u) > 3.14159265 * rm) discard;
  float r = rmid + (dist - rho) / k;
  float a = smoothstep(rout + 0.8, rout - 0.8, r) * smoothstep(rlo - 0.8, rlo + 0.8, r);
  if (a <= 0.0) discard;
  float phi = top + u / rm;
  vec2 sp = c + r * vec2(sin(phi), -cos(phi));
  vec2 uv = sp / D;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  gl_FragColor = vec4(texture2D(tex, uv).rgb, a);
}`;

type GL = { gl: WebGLRenderingContext; prog: WebGLProgram; loc: Record<string, WebGLUniformLocation | null> };

function initGL(canvas: HTMLCanvasElement, img: HTMLImageElement): GL | null {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: false, antialias: true, preserveDrawingBuffer: true });
  if (!gl) return null;
  const sh = (type: number, src: string) => {
    const x = gl.createShader(type)!;
    gl.shaderSource(x, src);
    gl.compileShader(x);
    if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x) || "shader");
    return x;
  };
  try {
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const names = ["tex", "size", "dpr", "D", "c", "rout", "rin", "rmid", "rm", "k", "rho", "ymid", "rlo", "top", "Z", "left", "lo"];
    const loc: GL["loc"] = {};
    for (const n of names) loc[n] = gl.getUniformLocation(prog, n);
    return { gl, prog, loc };
  } catch {
    return null;
  }
}

function drawGL(g: GL, p: Plan, t: number, f: number, dpr: number) {
  const { gl, loc } = g;
  const fr = frame(p, t, f);
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform1i(loc.tex, 0);
  gl.uniform2f(loc.size, W, H);
  gl.uniform1f(loc.dpr, dpr);
  gl.uniform1f(loc.D, p.D);
  gl.uniform2f(loc.c, p.cx, p.cy);
  gl.uniform1f(loc.rout, p.R_OUT);
  gl.uniform1f(loc.rin, p.R_IN);
  gl.uniform1f(loc.rmid, p.R_MID);
  gl.uniform1f(loc.rm, p.RM);
  gl.uniform1f(loc.k, p.K);
  gl.uniform1f(loc.rho, fr.rho);
  gl.uniform1f(loc.ymid, fr.yMid);
  gl.uniform1f(loc.rlo, fr.rLo);
  gl.uniform1f(loc.top, fr.top);
  gl.uniform1f(loc.Z, fr.Z);
  gl.uniform1f(loc.left, fr.left);
  gl.uniform1f(loc.lo, p.lo);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/** Canvas 2D fallback (no WebGL): same mapping, half resolution. */
function draw2D(ctx: CanvasRenderingContext2D, texData: ImageData, p: Plan, t: number, f: number) {
  const fr = frame(p, t, f);
  const Q = 2;
  const QW = Math.ceil(W / Q);
  const QH = Math.ceil(H / Q);
  const out = new ImageData(QW, QH);
  const o = out.data;
  const d = texData.data;
  const D = texData.width;
  for (let qy = 0; qy < QH; qy++) {
    for (let qx = 0; qx < QW; qx++) {
      const x = p.lo + (qx * Q + 1 - fr.left) / fr.Z;
      const y = fr.yMid + (qy * Q + 1 - fr.yMid) / fr.Z;
      const dx = x - W / 2;
      const dy = fr.Cy - y;
      const dist = Math.hypot(dx, dy);
      const u = Math.atan2(dx, dy) * fr.rho;
      if (Math.abs(u) > Math.PI * p.RM) continue;
      const r = p.R_MID + (dist - fr.rho) / p.K;
      if (r > p.R_OUT || r < fr.rLo) continue;
      const phi = fr.top + u / p.RM;
      const ix = (p.cx + r * Math.sin(phi)) | 0;
      const iy = (p.cy - r * Math.cos(phi)) | 0;
      if (ix < 0 || iy < 0 || ix >= D || iy >= D) continue;
      const si = (iy * D + ix) * 4;
      const oi = (qy * QW + qx) * 4;
      o[oi] = d[si];
      o[oi + 1] = d[si + 1];
      o[oi + 2] = d[si + 2];
      o[oi + 3] = 255;
    }
  }
  const tmp = document.createElement("canvas");
  tmp.width = QW;
  tmp.height = QH;
  tmp.getContext("2d")!.putImageData(out, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(tmp, 0, 0, ctx.canvas.width, ctx.canvas.height);
}

export type UnrollProps = {
  ins: Inspect;
  photo: string;
  face: string;
  /** Plays once when scrolled into view (or on mount). */
  autoplay?: boolean;
  /** Controlled time in ms; overrides autoplay. */
  ms?: number;
  onPhase?: (p: Phase) => void;
  label?: string;
  showValue?: boolean;
  className?: string;
};

export function Unroll({ ins, photo, face, autoplay = true, ms, onPhase, label, showValue = true, className }: UnrollProps) {
  const plate = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const photoEl = useRef<HTMLImageElement>(null);
  const glRef = useRef<GL | null>(null);
  const tex2d = useRef<ImageData | null>(null);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>(() => phaseAt(ms ?? 0));
  const [scale, setScale] = useState(1);
  const p = useMemo(() => plan(ins, W, H), [ins]);
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // load the face texture and set up WebGL (or the 2D fallback)
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = canvas.current;
      if (!c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = W * dpr;
      c.height = H * dpr;
      glRef.current = initGL(c, img);
      if (!glRef.current) {
        const t = document.createElement("canvas");
        t.width = img.naturalWidth;
        t.height = img.naturalHeight;
        const x = t.getContext("2d")!;
        x.drawImage(img, 0, 0);
        tex2d.current = x.getImageData(0, 0, t.width, t.height);
        c.width = W;
        c.height = H;
      }
      setReady(true);
    };
    img.src = face;
  }, [face]);

  useEffect(() => {
    const el = plate.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const render = useCallback(
    (ph: Phase) => {
      const c = canvas.current;
      if (!c) return;
      const t = ph.stage >= 2 ? ph.unroll : 0;
      const f = ph.fit;
      if (glRef.current) drawGL(glRef.current, p, t, f, c.width / W);
      else if (tex2d.current) draw2D(c.getContext("2d")!, tex2d.current, p, t, f);
    },
    [p],
  );

  // controlled or autoplay timeline
  const [clock, setClock] = useState<number | null>(null);
  const replay = useCallback(() => {
    if (reduce) {
      setClock(TOTAL);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const e = now - start;
      setClock(e);
      if (e < TOTAL) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  useEffect(() => {
    if (!ready || ms !== undefined || !autoplay) return;
    const el = plate.current;
    if (!el) return;
    let stop: (() => void) | undefined;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          stop = replay();
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      stop?.();
    };
  }, [ready, ms, autoplay, replay]);

  const time = ms ?? clock ?? 0;
  useEffect(() => {
    const ph = phaseAt(time);
    setPhase(ph);
    onPhase?.(ph);
    if (ready) render(ph);
  }, [time, ready, render, onPhase]);

  // photo transform: before -> straightened
  const m = lerpMatrix(p.photoA, p.photoB, phase.straighten);
  const photoOpacity = phase.stage < 2 ? 1 : Math.max(0, 1 - phase.swap);
  const canvasOpacity = phase.stage < 2 ? 0 : phase.swap;
  const [, , ew, eh, ea] = p.ellipse;
  const ra = (ew / 2) * p.show;
  const rb = (eh / 2) * p.show;
  const perim = Math.PI * (3 * (ra + rb) - Math.sqrt((3 * ra + rb) * (ra + 3 * rb)));
  const fr = frame(p, 1, phase.fit);
  const r = ins.reading;
  const units = r.unit ?? "";
  const span = (r.max ?? 1) - (r.min ?? 0);
  const dp = span <= 20 ? 2 : span <= 200 ? 1 : 0;
  const topY = toDisp(p, fr, 0, fr.yMid - (p.R_OUT - p.R_MID) * p.K)[1];
  const botY = toDisp(p, fr, 0, fr.yMid + (p.R_MID - p.R_IN) * p.K)[1];
  const nx = r.needle_angle != null ? toDisp(p, fr, p.stripX(r.needle_angle), 0)[0] : null;

  return (
    <div className={`${s.plate} ${className ?? ""}`} ref={plate} role="img" aria-label={label ?? "The photo is straightened, then the dial's scale is unrolled into a straight ruler and read."}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={photoEl}
        className={s.photo}
        src={photo}
        alt=""
        style={{ transform: `scale(${scale}) matrix(${m.join(",")})`, opacity: photoOpacity, width: ins.geometry.photo?.[0], height: ins.geometry.photo?.[1] }}
      />
      <svg className={s.svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" style={{ opacity: phase.stage === 0 ? 1 : Math.max(0, 1 - phase.straighten * 1.6) }}>
        {phase.stage <= 1 && (
          <ellipse
            cx={W / 2}
            cy={H / 2}
            rx={ra}
            ry={rb}
            transform={`rotate(${ea} ${W / 2} ${H / 2})`}
            fill="none"
            stroke="var(--needle)"
            strokeWidth="2.5"
            strokeDasharray={perim}
            strokeDashoffset={perim * (1 - phase.trace)}
          />
        )}
      </svg>
      <canvas ref={canvas} className={s.canvas} style={{ opacity: canvasOpacity }} />
      {phase.fit > 0.98 && nx != null && (
        <svg className={`${s.svg} ${s.final}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <line x1={nx} x2={nx} y1={topY - 24} y2={botY + 8} stroke="var(--needle)" strokeWidth="2.2" />
          <circle cx={nx} cy={topY - 24} r="4.5" fill="var(--needle)" />
          {showValue && r.value != null && (
            <text x={nx + 10} y={topY - 18} className={s.valueText}>
              {r.value.toFixed(dp)} {units}
            </text>
          )}
          {(ins.geometry.fit?.points ?? []).map((pt, i) => {
            const [x] = toDisp(p, fr, p.stripX(pt.deg), 0);
            return (
              <g key={i}>
                <line x1={x} x2={x} y1={botY + 6} y2={botY + 16} stroke="var(--steel)" />
                <text x={x} y={botY + 34} textAnchor="middle" className={s.tickText}>
                  {pt.value}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {ms === undefined && (
        <button type="button" className={s.replay} onClick={() => replay()}>
          Replay
        </button>
      )}
    </div>
  );
}
