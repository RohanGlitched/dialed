"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { analyse, checks, loadOpenCV, type Check, type Coach } from "./opencv";
import s from "./camera.module.css";

const AW = 360; // analysis width in px; the live frame is downscaled to this

type Props = {
  onShot: (photo: string) => void;
  onClose: () => void;
  /** What the operator is photographing, e.g. "PI-104 Filter F-1 inlet". */
  target?: string;
};

/** Live camera with on-device OpenCV.js coaching. The shutter unlocks only when the shot will read. */
export function CameraCoach({ onShot, onClose, target }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const work = useRef<HTMLCanvasElement | null>(null);
  const prev = useRef<{ m: unknown | null }>({ m: null });
  const goodSince = useRef<number | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "denied" | "error">("loading");
  const [msg, setMsg] = useState("Starting the camera and OpenCV.js…");
  const [coach, setCoach] = useState<Coach | null>(null);
  const [ready, setReady] = useState(false);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    let timer = 0;
    (async () => {
      try {
        const [cv, st] = await Promise.all([
          loadOpenCV(),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }),
        ]);
        stream = st;
        if (stop) return;
        const v = video.current!;
        v.srcObject = st;
        await v.play();
        setStatus("live");
        work.current = document.createElement("canvas");
        let frames = 0;
        let t0 = performance.now();
        const loop = () => {
          if (stop) return;
          const vw = v.videoWidth, vh = v.videoHeight;
          if (vw && vh) {
            const w = AW, h = Math.round((AW * vh) / vw);
            const c = work.current!;
            c.width = w;
            c.height = h;
            const x = c.getContext("2d", { willReadFrequently: true })!;
            x.drawImage(v, 0, 0, w, h);
            const res = analyse(cv, x.getImageData(0, 0, w, h), prev.current as { m: never });
            setCoach(res);
            draw(res, w, h);
            const all = checks(res).every((k) => k.ok);
            const now = performance.now();
            if (all) goodSince.current ??= now;
            else goodSince.current = null;
            setReady(!!goodSince.current && now - goodSince.current > 450);
            frames++;
            if (now - t0 > 1000) {
              setFps(Math.round((frames * 1000) / (now - t0)));
              frames = 0;
              t0 = now;
            }
          }
          timer = window.setTimeout(loop, 70);
        };
        loop();
      } catch (e) {
        const name = (e as Error)?.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          setStatus("denied");
          setMsg("Camera access was blocked. Allow the camera for this site in your browser settings, or upload a photo instead.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setStatus("error");
          setMsg("No camera was found on this device. Upload a photo instead.");
        } else {
          setStatus("error");
          setMsg("The camera guide couldn't start here. Upload a photo instead.");
        }
      }
    })();
    return () => {
      stop = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      (prev.current.m as { delete?: () => void } | null)?.delete?.();
      prev.current.m = null;
    };
  }, []);

  const draw = (c: Coach, w: number, h: number) => {
    const cv = overlay.current;
    if (!cv) return;
    cv.width = w * 2;
    cv.height = h * 2;
    const x = cv.getContext("2d")!;
    x.scale(2, 2);
    x.clearRect(0, 0, w, h);
    if (!c.ellipse) return;
    const ok = checks(c).every((k) => k.ok);
    x.lineWidth = 2.5;
    x.strokeStyle = ok ? "#ffffff" : "#e0261b";
    x.setLineDash(ok ? [] : [7, 5]);
    x.beginPath();
    x.ellipse(c.ellipse.cx, c.ellipse.cy, c.ellipse.w / 2, c.ellipse.h / 2, (c.ellipse.angle * Math.PI) / 180, 0, Math.PI * 2);
    x.stroke();
    x.setLineDash([]);
    x.strokeStyle = "#e0261b";
    x.lineWidth = 1.5;
    for (const b of c.glareBlobs) x.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
    // centre mark
    x.strokeStyle = ok ? "#ffffff" : "#e0261b";
    x.beginPath();
    x.moveTo(c.ellipse.cx - 8, c.ellipse.cy);
    x.lineTo(c.ellipse.cx + 8, c.ellipse.cy);
    x.moveTo(c.ellipse.cx, c.ellipse.cy - 8);
    x.lineTo(c.ellipse.cx, c.ellipse.cy + 8);
    x.stroke();
  };

  const shoot = useCallback(() => {
    const v = video.current;
    if (!v) return;
    const long = 1600;
    const sc = Math.min(1, long / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * sc);
    c.height = Math.round(v.videoHeight * sc);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    onShot(c.toDataURL("image/jpeg", 0.9));
  }, [onShot]);

  const list: Check[] = coach ? checks(coach) : checks({ found: false, ellipse: null, tilt: 0, size: 0, glare: 0, glareBlobs: [], motion: 99, sharp: 0 });
  const first = list.find((k) => !k.ok);

  return (
    <div className={s.coach}>
      <div className={s.viewport}>
        <video ref={video} playsInline muted className={s.video} />
        <canvas ref={overlay} className={s.overlay} aria-hidden="true" />
        {status !== "live" && <div className={s.veil}>{msg}</div>}
        {status === "live" && (
          <p className={`${s.hint} ${ready ? s.hintOk : ""}`} aria-live="polite">
            {ready ? "Ready. Take the photo." : first?.hint}
          </p>
        )}
      </div>
      <aside className={s.panel}>
        {target && <p className={s.target}>{target}</p>}
        <TiltMeter tilt={coach?.found ? coach.tilt : null} />
        <ul className={s.checks}>
          {list.map((k) => (
            <li key={k.key} className={k.ok ? s.ok : ""}>
              <span className={s.box} aria-hidden="true">{k.ok ? "✓" : ""}</span>
              {k.label}
              <span className="sr">{k.ok ? " (passed)" : " (not yet)"}</span>
            </li>
          ))}
        </ul>
        <button type="button" className={`btn ${ready ? "red" : ""} ${s.shutter}`} disabled={!ready} onClick={shoot}>
          Take the photo
        </button>
        <button type="button" className={s.skip} onClick={shoot} disabled={status !== "live"}>
          Take it anyway
        </button>
        <p className={s.small}>
          OpenCV.js 5 runs on this device{fps ? `, ${fps} checks a second` : ""}. The photo is only sent when you take it.
        </p>
        <button type="button" className="btn ghost" onClick={onClose}>
          Close the camera
        </button>
      </aside>
    </div>
  );
}

/** A small analog gauge of the camera's own tilt: the instrument reading the operator. */
function TiltMeter({ tilt }: { tilt: number | null }) {
  const a = tilt == null ? -120 : -120 + Math.min(1, tilt / 70) * 240;
  const r = (deg: number, rad: number) => [60 + rad * Math.sin((deg * Math.PI) / 180), 64 - rad * Math.cos((deg * Math.PI) / 180)];
  const okEnd = -120 + (38 / 70) * 240;
  const [ax, ay] = r(-120, 48);
  const [bx, by] = r(okEnd, 48);
  const [cx2, cy2] = r(120, 48);
  const [nx, ny] = r(a, 42);
  return (
    <figure className={s.meter}>
      <svg viewBox="0 0 120 100" aria-hidden="true">
        <path d={`M${ax},${ay} A48,48 0 0 1 ${bx},${by}`} fill="none" stroke="var(--ink)" strokeWidth="5" />
        <path d={`M${bx},${by} A48,48 0 0 1 ${cx2},${cy2}`} fill="none" stroke="var(--needle)" strokeWidth="5" />
        <line x1="60" y1="64" x2={nx} y2={ny} stroke="var(--needle)" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="60" cy="64" r="4" fill="var(--ink)" />
      </svg>
      <figcaption>
        <b>{tilt == null ? "–" : `${Math.round(tilt)}°`}</b> off square
      </figcaption>
    </figure>
  );
}
