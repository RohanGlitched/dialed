/** Load OpenCV.js 5 (self-hosted, ~13 MB, cached by the CDN) once, on demand. */
/* eslint-disable @typescript-eslint/no-explicit-any */
let loading: Promise<any> | null = null;

export function loadOpenCV(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  const w = window as any;
  if (w.cv?.Mat) return Promise.resolve(w.cv);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = "/vendor/opencv-5.0.0.js";
    sc.async = true;
    sc.onerror = () => {
      loading = null;
      reject(new Error("OpenCV.js failed to load"));
    };
    sc.onload = async () => {
      try {
        let cv = w.cv;
        if (cv instanceof Promise) cv = await cv;
        else if (!cv.Mat) await new Promise<void>((r) => (cv.onRuntimeInitialized = () => r()));
        w.cv = cv;
        resolve(cv);
      } catch (e) {
        loading = null;
        reject(e);
      }
    };
    document.head.appendChild(sc);
  });
  return loading;
}

export type Coach = {
  found: boolean;
  ellipse: { cx: number; cy: number; w: number; h: number; angle: number } | null;
  tilt: number; // degrees from square-on
  size: number; // dial's long axis / frame's short side
  glare: number; // share of the dial area that is blown out
  glareBlobs: { x: number; y: number; w: number; h: number }[];
  motion: number; // mean abs difference from the previous frame, 0..255
  sharp: number; // Laplacian variance inside the dial
};

/** One coaching pass on a small RGBA frame. All Mats are freed before returning. */
export function analyse(cv: any, rgba: ImageData, prevGray: { m: any | null }): Coach {
  const src = cv.matFromImageData(rgba);
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hier = new cv.Mat();
  const out: Coach = { found: false, ellipse: null, tilt: 0, size: 0, glare: 0, glareBlobs: [], motion: 0, sharp: 0 };
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 1.2);
    cv.Canny(blur, edges, 40, 110);
    cv.dilate(edges, edges, cv.Mat.ones(3, 3, cv.CV_8U));
    cv.findContours(edges, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_NONE);
    const W = rgba.width, H = rgba.height;
    let best: any = null;
    let bestScore = 0;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      if (c.rows >= 40) {
        const r = cv.boundingRect(c);
        if (Math.max(r.width, r.height) > 0.18 * Math.min(W, H)) {
          const e = cv.fitEllipse(c);
          const major = Math.max(e.size.width, e.size.height);
          const minor = Math.min(e.size.width, e.size.height);
          const inside = e.center.x > 0 && e.center.y > 0 && e.center.x < W && e.center.y < H;
          if (inside && minor / major > 0.3 && major < 1.1 * Math.max(W, H)) {
            // closed-ness: contour length vs ellipse perimeter
            const per = Math.PI * (3 * (major + minor) / 2 - Math.sqrt(((3 * major) / 2 + minor / 2) * (major / 2 + (3 * minor) / 2)));
            const cover = Math.min(1, cv.arcLength(c, false) / 2 / per);
            const score = cover * Math.sqrt(major / Math.max(W, H));
            if (score > bestScore) {
              bestScore = score;
              best = e;
            }
          }
        }
      }
      c.delete();
    }
    if (best && bestScore > 0.25) {
      const major = Math.max(best.size.width, best.size.height);
      const minor = Math.min(best.size.width, best.size.height);
      out.found = true;
      out.ellipse = { cx: best.center.x, cy: best.center.y, w: best.size.width, h: best.size.height, angle: best.angle };
      out.tilt = (Math.acos(Math.min(1, minor / major)) * 180) / Math.PI;
      out.size = major / Math.min(W, H);
      // glare and sharpness inside the dial
      const mask = cv.Mat.zeros(H, W, cv.CV_8U);
      cv.ellipse1(mask, best, new cv.Scalar(255), -1);
      const hsv = new cv.Mat();
      const rgb = new cv.Mat();
      cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
      cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
      const lo = new cv.Mat(H, W, hsv.type(), [0, 0, 245, 0]);
      const hi = new cv.Mat(H, W, hsv.type(), [180, 45, 255, 255]);
      const bright = new cv.Mat();
      cv.inRange(hsv, lo, hi, bright);
      cv.bitwise_and(bright, mask, bright);
      const area = cv.countNonZero(mask) || 1;
      out.glare = cv.countNonZero(bright) / area;
      const gc = new cv.MatVector();
      const gh = new cv.Mat();
      cv.findContours(bright, gc, gh, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < gc.size(); i++) {
        const c = gc.get(i);
        const r = cv.boundingRect(c);
        if (r.width * r.height > 30) out.glareBlobs.push({ x: r.x, y: r.y, w: r.width, h: r.height });
        c.delete();
      }
      const lap = new cv.Mat();
      cv.Laplacian(gray, lap, cv.CV_32F);
      const mean = new cv.Mat();
      const sd = new cv.Mat();
      cv.meanStdDev(lap, mean, sd, mask);
      out.sharp = sd.doubleAt(0, 0) ** 2;
      [mask, hsv, rgb, lo, hi, bright, gc, gh, lap, mean, sd].forEach((m) => m.delete());
    }
    if (prevGray.m && prevGray.m.rows === gray.rows) {
      const diff = new cv.Mat();
      cv.absdiff(gray, prevGray.m, diff);
      out.motion = cv.mean(diff)[0];
      diff.delete();
    }
    prevGray.m?.delete();
    prevGray.m = gray.clone();
  } finally {
    [src, gray, blur, edges, contours, hier].forEach((m) => m.delete());
  }
  return out;
}

export type Check = { key: string; ok: boolean; label: string; hint: string };

export function checks(c: Coach): Check[] {
  return [
    { key: "found", ok: c.found, label: "Dial in view", hint: "Point the camera at the gauge face." },
    { key: "size", ok: c.size > 0.42, label: "Close enough", hint: "Move closer until the dial fills most of the frame." },
    { key: "tilt", ok: c.found && c.tilt < 38, label: "Square on", hint: `Turn to face the dial; it's ${Math.round(c.tilt)}° off.` },
    { key: "glare", ok: c.found && c.glare < 0.02, label: "No glare", hint: "Step sideways or shade the dial; there's a reflection on it." },
    { key: "steady", ok: c.motion < 6, label: "Steady", hint: "Hold still for a moment." },
    { key: "sharp", ok: c.sharp > 60, label: "In focus", hint: "Tap the screen to focus." },
  ];
}
